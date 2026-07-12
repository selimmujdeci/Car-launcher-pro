/// <reference lib="webworker" />

/**
 * VehicleCompute.worker — Off-main-thread hesaplama çekirdeği.
 *
 * Tüm ağır veri işleme bu worker'da çalışır:
 *   • Speed Fusion   : HAL → CAN → OBD → GPS öncelik hiyerarşisi + timeout
 *   • RPM Sanity     : OBD hız > 10 km/h && rpm == 0 → reddet
 *   • GPS Smoothing  : accuracy > 30m filtresi + Haversine odometer
 *   • Confidence     : kaynak tazeliği (staleness) + Watchdog 3s
 *   • Semantic Events: histerezis tabanlı DRIVING / FUEL / REVERSE olayları
 *
 * İletişim kuralları (Zero-allocation):
 *   • Tüm outbound mesajlar pre-allocated envelope nesneleri üzerinden gider.
 *   • postMessage() structured-clone yapar; sender nesneleri tekrar kullanabilir.
 *   • Monotonic zaman: performans.now() staleness için; Date.now() event.ts için.
 */

import type { CanAdapterData, ObdAdapterData, GpsAdapterData, VehicleState, WorkerGeofenceZone } from './types';
import type { VehicleEvent } from './VehicleEventHub';
import type { NormalizedVehicleData, SignalSource } from './valTypes';
import { OdometerGuard } from './OdometerGuard';
import { createSourceHealthGate } from './sourceHealthGate';

// ── Mesaj protokolü ──────────────────────────────────────────────────────

export type WorkerInMessage =
  | { type: 'INIT';             odoKm: number; sab?: SharedArrayBuffer }
  /** crossOriginIsolated=false ortamında SAB kullanılamaz → postMessage yolu. */
  | { type: 'INIT_FALLBACK';    odoKm: number }
  /**
   * VAL yolu: VehicleSignalResolver SignalNormalizer üzerinden normalize eder,
   * ham kaynak verisi yerine NormalizedVehicleData gönderir.
   * Fusion, hardcoded kaynak önceliği yerine IVehicleSignal.confidence kullanır.
   */
  | { type: 'VEHICLE_DATA';    source: SignalSource; signals: NormalizedVehicleData }
  /** @deprecated CAN_DATA/OBD_DATA/GPS_DATA → VEHICLE_DATA ile değiştirildi */
  | { type: 'CAN_DATA';         payload: CanAdapterData }
  | { type: 'OBD_DATA';         payload: ObdAdapterData }
  | { type: 'GPS_DATA';         payload: GpsAdapterData }
  | { type: 'UPDATE_GEOFENCE';  zones: WorkerGeofenceZone[] }
  /** Crash recovery: native storage'dan kurtarılan km değeri.
   *  Strict Monotonicity: yalnızca _odoKm'den büyükse uygulanır. */
  | { type: 'RESTORE_ODO';      km: number }
  /** DEV-only kaos: _odoTMR'a bit-flip enjekte et (median recovery testi). */
  | { type: 'CHAOS_BITFLIP' }
  /**
   * Uygulama görünürlüğü (ana thread `visibilitychange` → resolver). YALNIZ kaynak sağlığı
   * (SOURCE_HEALTH) kararını etkiler: arka planda timer kısılması + frame sessizliği sahte
   * "ölü" üretmesin. Fusion/reverse/SAB/odometre davranışına DOKUNMAZ, timer AÇMAZ/KAPATMAZ.
   */
  | { type: 'VISIBILITY';       visible: boolean }
  | { type: 'STOP' };

export type WorkerOutMessage =
  | { type: 'STATE_UPDATE'; patch: Partial<VehicleState> }
  | { type: 'ODO_UPDATE';   odoKm: number }
  | { type: 'VEHICLE_EVENT'; event: VehicleEvent }
  /**
   * GPS kalite arızası: konum 20s boyunca accuracy > 100m veya NaN.
   * active=true → arıza başladı, active=false → kalite normale döndü.
   * SystemHealthMonitor bu olayı dinler (garbage fix'ler beat'i maskeleyemez).
   */
  | { type: 'GPS_FAILURE';  active: boolean; accuracy: number; ts: number }
  /**
   * Kaynak sağlığı (PR-1 "Source Health Transport"): worker'ın ZATEN hesapladığı per-kaynak
   * canlılık (`_alive(_xLastSeen, SRC_TIMEOUT_X_MS)`) ana thread'e taşınır. YENİ TIMER YOK —
   * mevcut 1 Hz `_watchdog()` kullanılır. YALNIZ DEĞİŞİM ANINDA gönderilir (kenar-tetikli):
   * aynı durum tekrar tekrar POSTLANMAZ. Payload YALNIZ boolean + timestamp — araç verisi
   * (hız/RPM/CAN frame), VIN veya PII TAŞIMAZ.
   *
   * ⚠️ Bu mesaj sinyalleri unsupported YAPMAZ ve HAL/adapter/Event Bus/bridge davranışını
   * DEĞİŞTİRMEZ; yalnız bilgi taşır (tüketim AYRI PR).
   */
  | { type: 'SOURCE_HEALTH'; can: boolean; obd: boolean; gps: boolean; ts: number };

// ── Sabitler ─────────────────────────────────────────────────────────────

const SPEED_MAX            = 300;
const SPEED_INTERVAL_MS    = 300;   // 3Hz — gösterge için yeterli, CPU baskısı azalır
const FUEL_INTERVAL_MS     = 8_000; // 8s — yakıt çok hızlı değişmez
const ANTI_JITTER_KMH      = 20;

/* ── GPS hız: gösterim akıcılığı + yanlış-sıfır koruması ────────────────────
 * GPS Doppler hızı ~1Hz gelir ve gürültü içerir: sürüş sırasında arada 0/çok
 * düşük raporlar (deadzone) ve değer basamaklı zıplar ("akıcı değil" + "arada 0").
 * Bu eşikler YALNIZCA GPS kaynağı için, YALNIZCA gösterilen (SAB→UI) hıza uygulanır;
 * odometre/dead-reckoning ve DRIVING event mantığı ham (raw) hızı kullanmaya devam
 * eder → mesafe/olay doğruluğu korunur. Donanım kaynakları (HAL/CAN/OBD) ham gösterilir. */
const SPEED_EMA_ALPHA      = 0.5;   // GPS yumuşatma (0..1): hedefe yaklaşım hızı (~1s oturma)
const SPEED_SNAP_KMH       = 0.6;   // EMA hedefe bu kadar yaklaşınca sabitle (gereksiz mikro-adım yok)
const ZERO_HOLD_TICKS      = 3;     // GPS 0/düşük: bu kadar art arda tik (3×300ms≈0.9s) onaylanmadan 0 gösterme
const ZERO_HOLD_KMH        = 1.5;   // bu altı GPS raporu "sıfır gürültüsü" sayılır
const ZERO_HOLD_MIN_KMH    = 6;     // yalnız önceki gösterilen hız bunun üstündeyse 0-düşmeyi debounce et

const GPS_ACCURACY_MAX_M      = 30;
/** GPS kalite arızası eşiği — bu accuracy üstü "kullanılamaz fix" sayılır */
const GPS_FAILURE_ACCURACY_M  = 100;
/** GPS bu süre boyunca kesintisiz kötü kalırsa GPS_FAILURE bildirilir */
const GPS_FAILURE_WINDOW_MS   = 20_000;
const ODO_JUMP_MAX_KM         = 0.2;   // GPS tek tick max delta (Haversine sanity)
const ODO_OBD_JUMP_MAX_KM     = 5;     // OBD ani sıçrama eşiği (ilk sync hariç)
// ODO_PERSIST_THRESHOLD kaldırıldı — Google Maps mantığı: her GPS/DR tick'inde güncelle
// eMMC koruması Zustand throttledStorage 4s debounce'una devredildi
const DR_JITTER_KMH        = 3;     // GPS-only: < 3 km/h → konum kayması gürültüsü (Haversine)
const DR_MIN_HW_KMH        = 0.5;   // CAN/OBD kaynaklı DR: > 0.5 km/h trafik sürünmesi birikir
const DR_MIN_GPS_KMH       = 1.5;   // GPS-only DR: < 1.5 km/h drift birikmesini önle
const DR_MAX_INTERVAL_MS   = 500;   // dead reckoning max Δt — SPEED_INTERVAL_MS=300 üstünde olmalı

const SRC_TIMEOUT_HAL_MS   = 3_000;
const SRC_TIMEOUT_CAN_MS   = 3_000;
const SRC_TIMEOUT_OBD_MS   = 5_000;  // Native pollOBDLoop ~3s+ periyotla yayar; 5s tolerans = poll arası OBD stale sayılmaz (P1)
const SRC_TIMEOUT_GPS_MS   = 5_000;
const WATCHDOG_INTERVAL_MS = 1_000;

const OBD_REVERSE_STABILITY_MS = 500;
const REVERSE_DEBOUNCE_MS      = 300;

const DRIVE_ON_KMH  = 5;
const DRIVE_OFF_KMH = 3;
const LOW_FUEL_ON   = 15;
const LOW_FUEL_OFF  = 17;
const CRIT_FUEL_ON  = 5;
const CRIT_FUEL_OFF = 7;

// Motor soğutma suyu (ECT, PID 0x05) — histerezis: trigger≠reset (flicker önleme).
// 105°C eşiği kod tabanındaki mevcut konvansiyonla tutarlı (ENGINE_TEMP_HIGH_C —
// livingThemeState.ts, contextEngine.ts, offlineConversationEngine.ts). 5°C reset
// bandı 8s poll periyoduna göre gürültüye karşı yeterli (motor termal kütlesi yavaş
// değişir — CLAUDE.md "Hysteresis" kuralı).
const ENGINE_OVERHEAT_ON  = 105;
const ENGINE_OVERHEAT_OFF = 100;
// Sanity: obdSanitizer.ts _BOUNDS.engineTemp ile aynı NTC sensör aralığı — PID 0x05
// formülünün ham sınırı -40..215°C'dir (StandardPidRegistry) ama gerçekçi üst sınır
// ~130°C; bunun dışı "imkânsız veri" sayılır ve reddedilir (CLAUDE.md Sensor Resiliency).
const COOLANT_TEMP_MIN = -40;
const COOLANT_TEMP_MAX = 130;

// ── Sensör durumu (in-place mutasyon, GC baskısı 0) ──────────────────────

const _can: CanAdapterData & { speed?: number; reverse?: boolean; fuel?: number; coolantTemp?: number } = {};
const _obd: ObdAdapterData & { speed?: number; fuel?: number; rpm?: number; reverse?: boolean; totalDistance?: number; coolantTemp?: number } = {};

// GPS: location buffer pre-allocated; null durumu _gpsLocActive flag ile temsil edilir
const _gpsLocBuf = { lat: 0, lng: 0, accuracy: 0 };
let _gpsLocActive = false;
const _gps: GpsAdapterData & { speed?: number; heading?: number; location?: typeof _gpsLocBuf } = {};

// ── Tazelik takibi (performance.now() monotonic) ────────────────────────

let _canLastSeen    = 0;
let _obdLastSeen    = 0;
let _gpsLastSeen    = 0;
let _prevGpsUpdateAt = 0; // önceki GPS_DATA zamanı — Doppler Δt hesabı için

// ── GPS kalite arıza takibi (Watchdog Hardening) ──────────────────────────
// _gpsBadSinceMs : kalite ilk bozulduğu performance.now() (0 = iyi/fix yok)
// _gpsFailureActive : GPS_FAILURE bildirildi mi (recovery'e dek tek-emit)
let _gpsBadSinceMs    = 0;
let _gpsFailureActive = false;

// ── VAL: Per-source normalized signal buffer ──────────────────────────────
// VEHICLE_DATA mesajı geldiğinde bu buffer'lar güncellenir.
// _emitSpeed() confidence-based fusion için bu buffer'ları kullanır.
// Pre-allocated: her mesajda yeni nesne oluşturmak yerine yerinde güncellenir.

const _valSignals: Record<'HAL' | 'CAN' | 'OBD' | 'GPS', NormalizedVehicleData | null> = {
  HAL: null,
  CAN: null,
  OBD: null,
  GPS: null,
};

/** Efektif güven: signal.confidence × tazelik faktörü */
function _effectiveConf(
  sig: { confidence: number; ts: number } | undefined,
  timeoutMs: number,
): number {
  if (!sig) return 0;
  const age = Date.now() - sig.ts;
  return sig.confidence * Math.max(0, 1 - age / timeoutMs);
}

// ── Hız durumu ────────────────────────────────────────────────────────────

let _lastKnownSpeed     = 0;
let _obdZeroConsecutive = 0;
// GPS gösterim yumuşatma durumu (yalnız SAB→UI; raw mantığını etkilemez)
let _dispSpeed          = 0;   // UI'a yazılan yumuşatılmış hız (km/h)
let _gpsZeroTicks       = 0;   // GPS art arda kaç tiktir 0/düşük raporladı
/** Hız kaynağı öncelik hiyerarşisi: HAL(0.98) > CAN(0.92) > OBD(0.85) > GPS(0.70) */
type _SpeedSource = 'HAL' | 'CAN' | 'OBD' | 'GPS';

/** Aktif hız kaynağı — kaynak farkındalıklı jitter guard ve DR mantığı için */
let _activeSpeedSource: _SpeedSource = 'GPS';
/** Kaynak değişimini algılamak için önceki değer — nativeSource patch sadece geçişte gönderilir */
let _prevActiveSource:  _SpeedSource = 'GPS';

// Compile-time güvence: 'HAL' _SpeedSource'dan çıkarılırsa aşağıdaki cast hata verir.
// typeof yerel değişken yerine named type kullanılır — akış daralmasından bağımsız.
type _HALInSpeedSource = 'HAL' extends _SpeedSource ? true : never;
void (true as _HALInSpeedSource);

// ── Geri vites durumu ─────────────────────────────────────────────────────

let _revDebounceTimer:  ReturnType<typeof setTimeout> | null = null;
let _obdRevCandidate:   boolean | null = null;
let _obdRevStableTimer: ReturnType<typeof setTimeout> | null = null;

// ── Odometer (Triple Modular Redundancy — bit-flip koruması) ──────────────
//
// _odoKm tek primitif yerine 3 kopyada saklanır (_odoTMR). Yazımda 3'ü de
// senkron güncellenir → kopyalar bir bug ile asla ayrışmaz. Okumada median-of-3
// (ortanca) uygulanır: tek bir kopyada radyasyon/donanım kaynaklı bit-flip
// olsa bile kalan 2 kopya çoğunluğu oluşturur ve sağlam değer döner; bir
// sonraki yazım tüm kopyaları median+delta ile yeniden hizalar (self-healing).
// Zero-allocation: pre-allocated Float64Array(3); median saf karşılaştırma.
const _odoTMR = new Float64Array(3); // [0,0,0] — başlangıç odo = 0

/**
 * Median-of-3 okuma + Self-Healing.
 * Tek kopya bozulsa bile çoğunluk sağlam değeri döner; ayrıca ayrışma tespit
 * edilirse (median ≠ herhangi bir kopya) bozuk kopya(lar) anında median ile
 * onarılır — bit-flip kalıcı birikemez (memory scrubbing). Sağlam durumda
 * (3 kopya eşit) yazma yapılmaz → ek maliyet yok.
 */
function _odoGet(): number {
  const a = _odoTMR[0], b = _odoTMR[1], c = _odoTMR[2];
  // ortanca = max(min(a,b), min(max(a,b), c)) — dallanmasız, alloc'suz
  const median = Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
  // Self-Healing: ayrışan kopyayı anında doğru değerle onar
  if (a !== median || b !== median || c !== median) {
    _odoTMR[0] = median;
    _odoTMR[1] = median;
    _odoTMR[2] = median;
  }
  return median;
}

/** 3 kopyayı birden yaz — senkron; kopyalar yazım dışında asla ayrışmaz. */
function _odoSet(v: number): void {
  _odoTMR[0] = v;
  _odoTMR[1] = v;
  _odoTMR[2] = v;
}

// Pre-allocated prev GPS noktası; _prevOdoActive ile "null" durumu temsil edilir
const _prevOdoBuf = { lat: 0, lng: 0 };
let _prevOdoActive    = false;
// İlk OBD sync'ten sonra true → jump guard etkinleşir (INIT atlaması için)
let _odoInitialized   = false;

// OdometerGuard — startup skip + 100 km jump protection
const _odoGuard = new OdometerGuard();
// Dead Reckoning zaman damgası (performance.now()); 0 = aktif değil
let _lastDeadReckonAt = 0;
// Son persist edilen odometer değeri — eşik kontrolü için
// INIT'te _odoKm ile senkronize edilir; böylece start'ta gereksiz disk yazması olmaz
let _lastPersistedOdo = 0;
// ODO_UPDATE IPC throttle: son postMessage zamanı (performance.now())
let _lastOdoPostAt    = 0;

// ── Null-emit tek-seferlik bayrakları ────────────────────────────────────
// Kaynaklar stale olduğunda null yalnızca bir kez iletilir — 10 Hz spam önlenir
let _speedNullEmitted = false;
let _fuelNullEmitted  = false;

// ── EventHub durumu ───────────────────────────────────────────────────────

let _isDriving     = false;
let _lowFuelFired  = false;
let _critFuelFired = false;
let _isReverse     = false;
let _overheatFired = false;

// ── Geofence durumu ───────────────────────────────────────────────────────
//
// _gfZones       : Son UPDATE_GEOFENCE'tan gelen zona listesi
// _gfActive      : Zona listesi boş olmadığında true
// _gfInsideMap   : zoneId → içeride mi? (undefined = ilk kontrol, sessizce başlat)
// _gfExitCount   : zoneId → ardışık dışarıda sayacı (debounce için)
// _gfExitFirstMs : zoneId → ilk dışarıda anın ms timestamp'i

let _gfZones:       WorkerGeofenceZone[] = [];
let _gfActive       = false;
const _gfInsideMap  = new Map<string, boolean>();
const _gfExitCount  = new Map<string, number>();
const _gfExitFirstMs = new Map<string, number>();

const GF_CONFIRM_COUNT = 3;    // ardışık "dışarıda" okuma sayısı
const GF_CONFIRM_MS    = 5_000; // veya 5 saniye

// ── SharedArrayBuffer (Zero-Copy, SEQLOCK + CACHE-LINE PADDING) ───────────
//
// Cache-line padding: her 64-bit değer AYRI 64-byte cache line'da (8 Float64
// slot aralık) → çekirdekler farklı satır sahibi olur, CPU "False Sharing"
// fiziksel olarak imkânsız.
//   Float64[0]  = speed       Float64[8]  = rpm
//   Float64[16] = fuel        Float64[24] = odometer
//   Float64[32] = isReverse   Float64[40] = lastUpdateTs (performance.now())
//   Int32[96]   = generation counter (byte 384) — AYRI cache line (veriden uzak)
//
// Seqlock protokolü (tek-yazar Worker):
//   1) Atomics.add(GEN,1) → değer TEK  (yazım başladı işareti)
//   2) Float64 alanlarını yaz
//   3) Atomics.add(GEN,1) → değer ÇİFT (yazım bitti işareti)
// UI okurken GEN tek ise yazım sürüyordur; baş≠son GEN ise Torn Read'tir.
// Atomics.add tam bellek fence'i → araya giren Float64 yazımları doğru sıralanır.
//
// Fallback: INIT'te sab yoksa _sabEnabled=false, tüm değerler postMessage'la gider.

const SAB_SPEED   = 0;   // byte 0
const SAB_RPM     = 8;   // byte 64
const SAB_FUEL    = 16;  // byte 128
const SAB_ODO     = 24;  // byte 192
const SAB_REVERSE = 32;  // byte 256
const SAB_TS      = 40;  // byte 320
const SAB_GEN_IDX = 96;  // Int32 index, byte 384 — ayrı cache line

let _sabEnabled = false;
let _sabF64:    Float64Array | null = null;
let _sabI32:    Int32Array   | null = null;

// ── Seqlock yazım sınırlayıcıları (zero-allocation) ───────────────────────
// begin: GEN'i TEK yap (yazım başladı). end: ÇİFT yap (yazım bitti).
// Yalnızca _sabEnabled iken çağrılır (tüm çağıranlar guard'lı).
function _sabBeginWrite(): void { Atomics.add(_sabI32!, SAB_GEN_IDX, 1); }
function _sabEndWrite():   void { Atomics.add(_sabI32!, SAB_GEN_IDX, 1); }

// ── Interval handles ──────────────────────────────────────────────────────

let _speedTimer:    ReturnType<typeof setInterval> | null = null;
let _fuelTimer:     ReturnType<typeof setInterval> | null = null;
let _coolantTimer:  ReturnType<typeof setInterval> | null = null;
let _watchdogTimer: ReturnType<typeof setInterval> | null = null;

// ── Pre-allocated outbound envelope'lar (zero-allocation) ────────────────

// STATE_UPDATE: patch pointer'ı dispatch öncesinde güncellenir
const _outState: { type: 'STATE_UPDATE'; patch: Partial<VehicleState> } = {
  type:  'STATE_UPDATE',
  patch: {} as Partial<VehicleState>,
};

// Patch nesneleri — her sinyal türü için ayrı pre-allocated nesne
const _patchSpeed:   Partial<VehicleState> = { speed: 0 };
const _patchFuel:    Partial<VehicleState> = { fuel:  0 };
const _patchGps:     Partial<VehicleState> = {};
const _patchReverse: Partial<VehicleState> = { reverse: false };

// ODO_UPDATE
const _outOdo: { type: 'ODO_UPDATE'; odoKm: number } = { type: 'ODO_UPDATE', odoKm: 0 };

// GPS_FAILURE (zero-allocation — yerinde mutate edilir)
const _outGpsFailure: { type: 'GPS_FAILURE'; active: boolean; accuracy: number; ts: number } = {
  type: 'GPS_FAILURE', active: false, accuracy: 0, ts: 0,
};

// VEHICLE_EVENT + pre-allocated olay nesneleri
const _outEvent: { type: 'VEHICLE_EVENT'; event: VehicleEvent } = {
  type:  'VEHICLE_EVENT',
  event: null as unknown as VehicleEvent,
};
const _evDrivingStarted:    Extract<VehicleEvent, { type: 'DRIVING_STARTED' }>    = { type: 'DRIVING_STARTED',    severity: 'INFO',     speedKmh: 0, ts: 0 };
const _evDrivingStopped:    Extract<VehicleEvent, { type: 'DRIVING_STOPPED' }>    = { type: 'DRIVING_STOPPED',    severity: 'INFO',     speedKmh: 0, ts: 0 };
const _evLowFuel:           Extract<VehicleEvent, { type: 'LOW_FUEL' }>           = { type: 'LOW_FUEL',           severity: 'WARNING',  fuelPct:  0, ts: 0 };
const _evCriticalFuel:      Extract<VehicleEvent, { type: 'CRITICAL_FUEL' }>      = { type: 'CRITICAL_FUEL',      severity: 'CRITICAL', fuelPct:  0, ts: 0 };
const _evReverseEngaged:    Extract<VehicleEvent, { type: 'REVERSE_ENGAGED' }>    = { type: 'REVERSE_ENGAGED',    severity: 'CRITICAL', ts: 0 };
const _evReverseDisengaged: Extract<VehicleEvent, { type: 'REVERSE_DISENGAGED' }> = { type: 'REVERSE_DISENGAGED', severity: 'CRITICAL', ts: 0 };
const _evGeofenceExit:  Extract<VehicleEvent, { type: 'GEOFENCE_EXIT' }>  = { type: 'GEOFENCE_EXIT',  severity: 'CRITICAL', zoneId: '', zoneName: '', ts: 0 };
const _evGeofenceEnter: Extract<VehicleEvent, { type: 'GEOFENCE_ENTER' }> = { type: 'GEOFENCE_ENTER', severity: 'INFO',     zoneId: '', zoneName: '', ts: 0 };
const _evEngineOverheat: Extract<VehicleEvent, { type: 'ENGINE_OVERHEAT' }> = { type: 'ENGINE_OVERHEAT', severity: 'CRITICAL', coolantTempC: 0, ts: 0 };

// ── Odometer persist helper ───────────────────────────────────────────────
// Google Maps mantığı: her GPS/DR tick'inde _odoKm değişince hem SAB hem Zustand güncellenir.
// eMMC koruması: Zustand throttledStorage (4s debounce) — worker threshold yok.
// Strict Monotonicity: delta <= 0 ise sessiz dön.
// Zero-allocation: _outOdo envelope mutate edilir.

function _postOdoUpdate(force: boolean): void {
  const odo   = _odoGet();              // TMR median — tek okuma
  const delta = odo - _lastPersistedOdo;
  if (delta <= 0) return;

  // SAB: her zaman anlık yaz — UI akıcılığı (next _emitSpeed tiki ~300ms içinde yansır)
  if (_sabEnabled) { _sabBeginWrite(); _sabF64![SAB_ODO] = odo; _sabEndWrite(); }

  // IPC throttle: postMessage yalnızca şu koşullarda gönderilir:
  //   • force=true  (araç durdu / STOP)
  //   • ≥ 100 m birikim  (Zustand 4s debounce zaten eMMC'yi korur)
  //   • ≥ 5 s sessizlik  (uzun sabit hız senaryoları için güvence)
  const now = performance.now();
  if (!force && delta < 0.1 && (now - _lastOdoPostAt) < 5_000) return;

  _lastPersistedOdo = odo;
  _lastOdoPostAt    = now;
  _outOdo.odoKm     = odo;
  self.postMessage(_outOdo);
}

// ── Yardımcı fonksiyonlar ─────────────────────────────────────────────────

function _haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R    = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a    =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Monotonic staleness kontrolü — performance.now() clock-jump'a bağışıktır
function _alive(lastSeen: number, timeout: number): boolean {
  return lastSeen > 0 && (performance.now() - lastSeen) < timeout;
}

function _postPatch(patch: Partial<VehicleState>): void {
  _outState.patch = patch;
  self.postMessage(_outState);
}

/* ── Kaynak sağlığı (PR-1) — kenar-tetikli, allocation'sız ────────────────────
 * Önceki durum `null` = BİLİNMİYOR (henüz hiç watchdog turu geçmedi). "unknown" ile
 * "false" KARIŞTIRILMAZ: ilk tur mutlaka gönderilir (bilinmiyor → bilinen), sonrasında
 * YALNIZ değişimde. Pre-allocated envelope (V8 hidden-class stabilitesi, zero-allocation). */
let _prevCanAlive: boolean | null = null;
let _prevObdAlive: boolean | null = null;
let _prevGpsAlive: boolean | null = null;

/* Görünürlük kapısı: arka planda watchdog kısılması + frame sessizliği SAHTE "ölü" üretmesin
 * (bkz. sourceHealthGate). Yalnız bu bloğu etkiler; fusion/reverse/SAB kararları HAM kalır. */
const _healthGate = createSourceHealthGate();

const _outSourceHealth: Extract<WorkerOutMessage, { type: 'SOURCE_HEALTH' }> = {
  type: 'SOURCE_HEALTH', can: false, obd: false, gps: false, ts: 0,
};

/** Yalnız DEĞİŞİMDE postlar (duplicate durum mesaj üretmez). Yeni timer AÇMAZ. */
function _postSourceHealthIfChanged(canRaw: boolean, obdRaw: boolean, gpsRaw: boolean): void {
  if (!_healthGate.isVisible()) return;   // arka plan → sağlık GEÇİŞİ DONDURULUR
  const now = performance.now();
  const can = _healthGate.decide(now, _canLastSeen, SRC_TIMEOUT_CAN_MS, canRaw, _prevCanAlive);
  const obd = _healthGate.decide(now, _obdLastSeen, SRC_TIMEOUT_OBD_MS, obdRaw, _prevObdAlive);
  const gps = _healthGate.decide(now, _gpsLastSeen, SRC_TIMEOUT_GPS_MS, gpsRaw, _prevGpsAlive);
  // Foreground yeniden-tabanlama penceresi: karar verilemiyor → POSTLAMA (unknown korunur)
  if (can === null || obd === null || gps === null) return;
  if (can === _prevCanAlive && obd === _prevObdAlive && gps === _prevGpsAlive) return;
  _prevCanAlive = can;
  _prevObdAlive = obd;
  _prevGpsAlive = gps;
  _outSourceHealth.can = can;
  _outSourceHealth.obd = obd;
  _outSourceHealth.gps = gps;
  _outSourceHealth.ts  = now;                 // monotonik; araç verisi/PII YOK
  self.postMessage(_outSourceHealth);
}

/** Ana thread görünürlük bildirimi — YALNIZ sağlık kapısını besler (timer'lara DOKUNMAZ). */
function _handleVisibility(msg: Extract<WorkerInMessage, { type: 'VISIBILITY' }>): void {
  _healthGate.setVisible(msg.visible === true, performance.now());
}

function _postEvent(ev: VehicleEvent): void {
  _outEvent.event = ev;
  self.postMessage(_outEvent);
}

// ── Geri vites mantığı ────────────────────────────────────────────────────

function _clearObdRevStability(): void {
  if (_obdRevStableTimer !== null) { clearTimeout(_obdRevStableTimer); _obdRevStableTimer = null; }
  _obdRevCandidate = null;
}

function _clearReverseTimers(): void {
  _clearObdRevStability();
  if (_revDebounceTimer !== null) { clearTimeout(_revDebounceTimer); _revDebounceTimer = null; }
}

function _debounceReverse(value: boolean): void {
  if (_revDebounceTimer !== null) clearTimeout(_revDebounceTimer);
  _revDebounceTimer = setTimeout(() => {
    _revDebounceTimer = null;
    if (_sabEnabled) {
      _sabBeginWrite();
      _sabF64![SAB_REVERSE] = value ? 1 : 0;
      _sabF64![SAB_TS]      = performance.now();
      _sabEndWrite();
    } else {
      _patchReverse.reverse = value;
      _postPatch(_patchReverse);
    }
    _handleEventReverse(value);
  }, REVERSE_DEBOUNCE_MS);
}

// CAN: güvenilir kaynak — doğrudan debounce'a gider; hız > 5 km/h ise reddet
function _handleCanReverse(value: boolean): void {
  if (value && _lastKnownSpeed > 5) return;
  _clearObdRevStability();
  _debounceReverse(value);
}

// OBD: 500ms kararlılık penceresi; değer tutarlı kalırsa debounce'a ilet
function _handleObdReverse(value: boolean): void {
  if (_obdRevCandidate === value) return;
  _obdRevCandidate = value;
  if (_obdRevStableTimer !== null) clearTimeout(_obdRevStableTimer);
  _obdRevStableTimer = setTimeout(() => {
    _obdRevStableTimer = null;
    _debounceReverse(value);
  }, OBD_REVERSE_STABILITY_MS);
}

// ── EventHub semantik olay üreticileri ───────────────────────────────────

function _handleEventSpeed(speed: number): void {
  if (!_isDriving && speed >= DRIVE_ON_KMH) {
    _isDriving = true;
    _evDrivingStarted.speedKmh = speed;
    _evDrivingStarted.ts       = Date.now();
    _postEvent(_evDrivingStarted);
  } else if (_isDriving && speed < DRIVE_OFF_KMH) {
    _isDriving = false;
    _evDrivingStopped.speedKmh = speed;
    _evDrivingStopped.ts       = Date.now();
    _postEvent(_evDrivingStopped);
  }
  // DRIVE_OFF_KMH ≤ speed < DRIVE_ON_KMH → histerezis bandı, olay yok
}

function _handleEventFuel(fuel: number): void {
  // Re-arming: yakıt yükselince histerezis eşiklerini aç
  if (_critFuelFired && fuel >= CRIT_FUEL_OFF) _critFuelFired = false;
  if (_lowFuelFired  && fuel >= LOW_FUEL_OFF)  _lowFuelFired  = false;

  if (!_critFuelFired && fuel <= CRIT_FUEL_ON) {
    _critFuelFired           = true;
    _lowFuelFired            = true; // kritik ise zaten düşük sayılır
    _evCriticalFuel.fuelPct  = fuel;
    _evCriticalFuel.ts       = Date.now();
    _postEvent(_evCriticalFuel);
    return; // LOW_FUEL aynı tick'te tekrar tetiklenmesin
  }
  if (!_lowFuelFired && fuel <= LOW_FUEL_ON) {
    _lowFuelFired       = true;
    _evLowFuel.fuelPct  = fuel;
    _evLowFuel.ts       = Date.now();
    _postEvent(_evLowFuel);
  }
}

function _handleEventEngineTemp(coolantTempC: number): void {
  // Re-arming: sıcaklık düşünce histerezis eşiğini aç (flicker önleme, CLAUDE.md Hysteresis)
  if (_overheatFired && coolantTempC <= ENGINE_OVERHEAT_OFF) _overheatFired = false;

  if (!_overheatFired && coolantTempC >= ENGINE_OVERHEAT_ON) {
    _overheatFired               = true;
    _evEngineOverheat.coolantTempC = coolantTempC;
    _evEngineOverheat.ts           = Date.now();
    _postEvent(_evEngineOverheat);
  }
  // ENGINE_OVERHEAT_OFF ≤ coolantTempC < ENGINE_OVERHEAT_ON → histerezis bandı, olay yok
}

function _handleEventReverse(reverse: boolean): void {
  if (_isReverse === reverse) return; // doğal deduplication
  _isReverse = reverse;
  if (reverse) {
    _evReverseEngaged.ts = Date.now();
    _postEvent(_evReverseEngaged);
  } else {
    _evReverseDisengaged.ts = Date.now();
    _postEvent(_evReverseDisengaged);
  }
}

// ── Geofence poligon & daire kontrolü ───────────────────────────────────

function _pointInPolygon(lat: number, lng: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [latI, lngI] = poly[i];
    const [latJ, lngJ] = poly[j];
    if ((lngI > lng) !== (lngJ > lng) &&
        lat < ((latJ - latI) * (lng - lngI)) / (lngJ - lngI) + latI) {
      inside = !inside;
    }
  }
  return inside;
}

function _isInsideZone(lat: number, lng: number, zone: WorkerGeofenceZone): boolean {
  if (zone.type === 'circle' && zone.center && zone.radiusM) {
    const distM = _haversineKm(lat, lng, zone.center[0], zone.center[1]) * 1000;
    return distM <= zone.radiusM;
  }
  if (zone.type === 'polygon' && zone.polygon) {
    return _pointInPolygon(lat, lng, zone.polygon);
  }
  return true; // zona tanımsızsa içeride varsay
}

/**
 * Her GPS güncellemesinde çağrılır (yalnızca araç hareket halindeyken).
 * 3 ardışık "dışarıda" okuması veya 5 saniye → GEOFENCE_EXIT.
 * İçeri girişte anlık GEOFENCE_ENTER.
 */
function _checkGeofences(lat: number, lng: number): void {
  if (!_gfActive || _gfZones.length === 0) return;

  const now = Date.now();

  for (const zone of _gfZones) {
    const inside    = _isInsideZone(lat, lng, zone);
    const prevInside = _gfInsideMap.get(zone.id);

    if (prevInside === undefined) {
      // İlk okuma — sessizce başlat; olay yok
      _gfInsideMap.set(zone.id, inside);
      continue;
    }

    if (inside) {
      // Dışarıdayken içeri girdi → ENTER
      if (!prevInside) {
        _gfInsideMap.set(zone.id, true);
        _evGeofenceEnter.zoneId   = zone.id;
        _evGeofenceEnter.zoneName = zone.name;
        _evGeofenceEnter.ts       = now;
        _postEvent(_evGeofenceEnter);
      }
      // EXIT debounce sıfırla
      _gfExitCount.delete(zone.id);
      _gfExitFirstMs.delete(zone.id);

    } else {
      // Dışarıda
      if (prevInside) {
        // İçerideyken dışarı çıktı → debounce başlat
        if (!_gfExitCount.has(zone.id)) {
          _gfExitFirstMs.set(zone.id, now);
          _gfExitCount.set(zone.id, 1);
        } else {
          const count     = (_gfExitCount.get(zone.id) ?? 0) + 1;
          const firstMs   = _gfExitFirstMs.get(zone.id) ?? now;
          _gfExitCount.set(zone.id, count);

          if (count >= GF_CONFIRM_COUNT || (now - firstMs) >= GF_CONFIRM_MS) {
            // Çıkış doğrulandı → GEOFENCE_EXIT
            _gfInsideMap.set(zone.id, false);
            _gfExitCount.delete(zone.id);
            _gfExitFirstMs.delete(zone.id);
            _evGeofenceExit.zoneId   = zone.id;
            _evGeofenceExit.zoneName = zone.name;
            _evGeofenceExit.ts       = now;
            _postEvent(_evGeofenceExit);
          }
        }
      }
      // Zaten dışarıdaysa bir şey yapma
    }
  }
}

// ── Odometer (Google Maps mantığı: Doppler speed × Δt, Haversine fallback) ──────
//
// Öncelik 1 — GPS Doppler speed × Δt:
//   coords.speed (m/s) donanım seviyesinde Doppler ile ölçülür; konum hatasından
//   bağımsız ve çok daha kararlıdır. Google Maps ile aynı mantık.
//   Avantaj: accuracy > 30m olsa bile (şehir içi, tünel çıkışı) doğru km birikir.
//
// Öncelik 2 — Haversine konum delta (fallback):
//   GPS speed yoksa (eski cihaz, NMEA-only) iki ardışık fix arası mesafe.
//   Gerektirdiği koşul: accuracy ≤ GPS_ACCURACY_MAX_M.

function _updateOdometerGps(dtMs: number): void {
  if (!_gpsLocActive) return;
  const loc = _gps.location!;

  // ── OdometerGuard: startup skip + velocity-time jump protection ───────
  // dtMs: GPS_DATA handler'ında hesaplanan fix-arası Δt (ms)
  // _lastKnownSpeed: CAN→OBD→GPS öncelik füzyonundan gelen anlık hız (km/h)
  const guardResult = _odoGuard.check(loc.lat, loc.lng, _lastKnownSpeed, dtMs);

  if (guardResult === 'skip') {
    // Startup penceresi: GPS fix yoksayılır.
    // Araç hareket halindeyse OBD/fused hız × Δt ile kaybedilen mesafeyi kompanse et.
    const startupDelta = _odoGuard.compensateStartup(_lastKnownSpeed, dtMs);
    if (startupDelta > 0) {
      _odoSet(_odoGet() + startupDelta);
      _postOdoUpdate(false);
    }
    _prevOdoBuf.lat = loc.lat;
    _prevOdoBuf.lng = loc.lng;
    _prevOdoActive  = true;
    return;
  }

  if (guardResult === 'invalid') {
    _prevOdoActive = false;
    return;
  }

  // Kaynak farkındalıklı jitter guard:
  //   CAN / OBD → donanım destekli hız; sürünme hızları güvenilir → bariyeri atla.
  //   GPS-only  → Doppler konum kayması riski; < 3 km/h hayalet km üretir → bariyeri koru.
  const speedKmh = _gps.speed ?? 0; // GpsAdapter zaten km/h'e çevirdi, deadzone uyguladı
  const hwBacked = _activeSpeedSource === 'HAL' || _activeSpeedSource === 'CAN' || _activeSpeedSource === 'OBD';
  if (!hwBacked && speedKmh < DR_JITTER_KMH) {
    _prevOdoBuf.lat = loc.lat;
    _prevOdoBuf.lng = loc.lng;
    _prevOdoActive  = true;
    return;
  }

  // ── Yöntem 1: GPS Doppler speed × Δt ─────────────────────────────────
  // GPS speed mevcut ve Δt geçerliyse bunu kullan (konum hatasından bağımsız).
  if (_gps.speed != null && dtMs >= 100 && dtMs < 3_000) {
    const deltaKm = (speedKmh / 3_600) * (dtMs / 1_000);
    if (deltaKm > 0 && deltaKm <= ODO_JUMP_MAX_KM) {
      _odoSet(_odoGet() + deltaKm);
      _postOdoUpdate(false);
      _prevOdoBuf.lat = loc.lat;
      _prevOdoBuf.lng = loc.lng;
      _prevOdoActive  = true;
      return; // Haversine'e gerek yok
    }
  }

  // ── Yöntem 2: Haversine konum delta (GPS speed yoksa) ────────────────
  if (loc.accuracy > GPS_ACCURACY_MAX_M) {
    // Kötü accuracy + speed yok → referans ilerlet, biriktirme
    _prevOdoBuf.lat = loc.lat;
    _prevOdoBuf.lng = loc.lng;
    return;
  }

  if (!_prevOdoActive) {
    _prevOdoBuf.lat = loc.lat;
    _prevOdoBuf.lng = loc.lng;
    _prevOdoActive  = true;
    return;
  }

  const deltaKm = _haversineKm(_prevOdoBuf.lat, _prevOdoBuf.lng, loc.lat, loc.lng);
  _prevOdoBuf.lat = loc.lat;
  _prevOdoBuf.lng = loc.lng;

  if (deltaKm > ODO_JUMP_MAX_KM) {
    console.debug('[ODO] Haversine jump rejected:', deltaKm.toFixed(3), 'km');
    return;
  }

  if (deltaKm > 0) {
    _odoSet(_odoGet() + deltaKm);
    _postOdoUpdate(false);
  }
}

// OBD totalDistance → mutlak kayıt; GPS birikimini senkronize et
function _syncObdOdometer(totalDistanceKm: number): void {
  const odo = _odoGet(); // TMR median — tek okuma

  // Strict Monotonicity: OBD değeri mevcut değerden küçükse negative delta → reddet
  if (totalDistanceKm < odo) {
    console.debug('[ODO] OBD negative delta rejected: new=', totalDistanceKm.toFixed(3),
      'cur=', odo.toFixed(3));
    return;
  }

  // Sanity Jump Guard (ilk sync hariç): 5 km'den büyük ani artış → sensör paraziti
  if (_odoInitialized && (totalDistanceKm - odo) > ODO_OBD_JUMP_MAX_KM) {
    console.debug('[ODO] OBD jump guard rejected: delta=',
      (totalDistanceKm - odo).toFixed(3), 'km');
    return;
  }

  // 10m altı fark gürültü — sessizce atla
  if (Math.abs(totalDistanceKm - odo) < 0.01) return;

  _odoSet(totalDistanceKm);
  _odoInitialized = true; // ilk başarılı sync; sonraki çağrılarda jump guard aktif
  _postOdoUpdate(false);  // 500 m eşiği kontrolü (OBD mutlak değerler artımlı değişir)

  // Çift sayımı önle: OBD sync sonrası GPS referansını güncelle.
  // _odoGuard da senkronize edilir; aksi hâlde sonraki GPS okuması
  // OBD-sonrası konumdan yanlış jump mesafesi hesaplar.
  if (_gpsLocActive) {
    _prevOdoBuf.lat = _gps.location!.lat;
    _prevOdoBuf.lng = _gps.location!.lng;
    _prevOdoActive  = true;
    _odoGuard.setReference(_gps.location!.lat, _gps.location!.lng);
  } else {
    _prevOdoActive = false;
  }
}

// ── Dead Reckoning Fallback ───────────────────────────────────────────────
//
// GPS zayıfken (accuracy > 30m) veya stale iken hız × Δt ile mesafeyi tahmin eder.
// GPS iyi olduğunda devre dışı kalır — Haversine ile çift sayım olmaz.
// Zero-allocation: new nesne oluşturulmaz; sadece primitif hesaplama.

function _applyDeadReckoning(speedKmh: number): void {
  const gpsGood =
    _gpsLocActive &&
    _gpsLocBuf.accuracy <= GPS_ACCURACY_MAX_M &&
    _alive(_gpsLastSeen, SRC_TIMEOUT_GPS_MS);

  if (gpsGood) {
    // GPS Haversine üstleniyor; DR zaman damgasını sıfırla (geçiş anında spike yok)
    _lastDeadReckonAt = 0;
    return;
  }

  // Kaynak farkındalıklı DR minimum eşiği:
  //   CAN/OBD: > 0.5 km/h trafik sürünmesi birikir (donanım destekli, güvenilir)
  //   GPS-only: < 1.5 km/h park kayması birikmesini önle
  const drMinKmh = (_activeSpeedSource === 'HAL' || _activeSpeedSource === 'CAN' || _activeSpeedSource === 'OBD')
    ? DR_MIN_HW_KMH
    : DR_MIN_GPS_KMH;
  if (speedKmh <= drMinKmh) {
    _lastDeadReckonAt = 0; // durağanda zaman damgasını temizle
    return;
  }

  const now = performance.now();

  if (_lastDeadReckonAt === 0) {
    _lastDeadReckonAt = now; // ilk DR tiki; referans noktası kur, delta hesaplama
    return;
  }

  const dtMs = now - _lastDeadReckonAt;
  _lastDeadReckonAt = now;

  // Stale timer veya aşırı jitter → bu tiki atla; bir sonraki tik normal çalışır
  if (dtMs <= 0 || dtMs > DR_MAX_INTERVAL_MS) return;

  // distance = speed (km/h) × Δt (h) = speed / 3600 × Δt_ms / 1000
  const deltaKm = (speedKmh / 3600) * (dtMs / 1000);
  if (deltaKm <= 0) return;

  // Monotonicity garantili: pozitif delta, odometer asla azalmaz
  _odoSet(_odoGet() + deltaKm);
  _postOdoUpdate(false); // 500 m eşiği kontrolü
}

// ── Periyodik görevler ────────────────────────────────────────────────────

// ── Hız çözümleme scratch çıktıları (zero-allocation) ──────────────────────
// _resolveSpeedSource() sonucunu modül-seviye scratch'e yazar; her tikte yeni
// nesne ayırmaz. _emitSpeed bu iki değeri okur.
let _resolvedSpeed: number | undefined;
let _resolvedSrc:  _SpeedSource = 'CAN';

/**
 * Confidence Fusion — aktif hız kaynağını seçer (saf alt-fonksiyon).
 *   • VAL yolu (VEHICLE_DATA doluysa): efektif güven (confidence × tazelik) ile
 *     en yüksek skorlu kaynağı seçer. Hiyerarşi HAL > CAN > OBD > GPS.
 *   • Aksi hâlde legacy hardcoded kaynak önceliği (CAN_DATA/OBD_DATA/GPS_DATA).
 * Çıktı: _resolvedSpeed (undefined = tüm kaynaklar stale) + _resolvedSrc.
 */
function _resolveSpeedSource(): void {
  _resolvedSpeed = undefined;
  _resolvedSrc   = 'CAN';

  const valHAL = _valSignals.HAL?.speed;
  const valCAN = _valSignals.CAN?.speed;
  const valOBD = _valSignals.OBD?.speed;
  const valGPS = _valSignals.GPS?.speed;

  if (valHAL || valCAN || valOBD || valGPS) {
    // Efektif güven = temel güven × tazelik — en yüksek skora sahip kaynak kazanır
    const cHAL = _effectiveConf(valHAL, SRC_TIMEOUT_HAL_MS);
    const cCAN = _effectiveConf(valCAN, SRC_TIMEOUT_CAN_MS);
    const cOBD = _effectiveConf(valOBD, SRC_TIMEOUT_OBD_MS);
    const cGPS = _effectiveConf(valGPS, SRC_TIMEOUT_GPS_MS);

    if (cHAL >= cCAN && cHAL >= cOBD && cHAL >= cGPS && cHAL > 0) {
      _resolvedSpeed = valHAL!.value; _resolvedSrc = 'HAL';
    } else if (cCAN >= cOBD && cCAN >= cGPS && cCAN > 0) {
      _resolvedSpeed = valCAN!.value; _resolvedSrc = 'CAN';
    } else if (cOBD >= cGPS && cOBD > 0) {
      _resolvedSpeed = valOBD!.value; _resolvedSrc = 'OBD';
    } else if (cGPS > 0) {
      _resolvedSpeed = valGPS!.value; _resolvedSrc = 'GPS';
    }
    // _resolvedSpeed == null → tüm kaynaklar stale (efektif güven 0) → null emit yoluna düş

    // HAL hız=0 iken GPS > 5 km/h → AAOS sensör anormalliği uyarısı
    if (_resolvedSrc === 'HAL' && (_resolvedSpeed ?? 0) < 1 && (valGPS?.value ?? 0) > 5) {
      console.warn('[HAL] Conf mismatch: HAL=0 km/h GPS=', (valGPS!.value ?? 0).toFixed(1), 'km/h');
    }
    return;
  }

  // ── Legacy yol: CAN_DATA/OBD_DATA/GPS_DATA (hardcoded kaynak önceliği) ──
  if (_alive(_canLastSeen, SRC_TIMEOUT_CAN_MS)) {
    _resolvedSpeed = _can.speed; _resolvedSrc = 'CAN';
  } else if (_alive(_obdLastSeen, SRC_TIMEOUT_OBD_MS)) {
    _resolvedSpeed = _obd.speed; _resolvedSrc = 'OBD';
  } else if (_alive(_gpsLastSeen, SRC_TIMEOUT_GPS_MS)) {
    _resolvedSpeed = _gps.speed; _resolvedSrc = 'GPS';
  }
}

/**
 * Sanity reddi — ham hız değeri geçersizse true (saf predikat, mutasyon yok).
 *   • Aralık     : 0 ≤ raw ≤ SPEED_MAX
 *   • Anti-jitter: ~100ms'de ±ANTI_JITTER_KMH sıçrama → sensör gürültüsü
 *   • RPM Cross  : OBD hız > 10 km/h ama rpm == 0 → ICE imkânsız
 * Küçük + saf → V8 inline'a uygun.
 */
function _isSpeedRejected(raw: number, src: _SpeedSource): boolean {
  if (raw < 0 || raw > SPEED_MAX) return true;
  if (raw > 0 && _lastKnownSpeed > 0 && Math.abs(raw - _lastKnownSpeed) > ANTI_JITTER_KMH) return true;
  if (src === 'OBD' && raw > 10 && _obd.rpm === 0) return true;
  return false;
}

function _emitSpeed(): void {
  _resolveSpeedSource();
  const raw = _resolvedSpeed;
  const src = _resolvedSrc;

  if (raw == null) {
    // Tüm kaynaklar stale → UI'a "sinyal yok" bildir (tek seferlik)
    _lastDeadReckonAt = 0; // DR zaman damgasını sıfırla — yalancı km birikimini durdur
    if (!_speedNullEmitted) {
      _speedNullEmitted = true;
      if (_sabEnabled) {
        _sabBeginWrite();
        _sabF64![SAB_SPEED] = NaN; // NaN = null sentinel Float64'te
        _sabF64![SAB_TS]    = performance.now();
        _sabEndWrite();
      } else {
        _patchSpeed.speed = null;
        _postPatch(_patchSpeed);
      }
    }
    return;
  }
  _speedNullEmitted = false; // geçerli kaynak geldi — bayrağı sıfırla

  // Sanity: aralık + anti-jitter + RPM cross-check (saf predikat)
  if (_isSpeedRejected(raw, src)) return;

  _lastKnownSpeed    = raw;
  _activeSpeedSource = src; // kaynak farkındalıklı ODO + DR için

  /* ── Gösterim hızı: GPS akıcılık + yanlış-sıfır debounce ──────────────────
   * Yalnız UI'a yazılan değeri etkiler (raw odometre/event için korunur).
   * GPS: EMA ile yumuşat; ani 0/düşük raporu (araç hareketliyken) ~0.9s onayla. */
  let display: number;
  if (src === 'GPS') {
    if (raw < ZERO_HOLD_KMH && _dispSpeed > ZERO_HOLD_MIN_KMH && _gpsZeroTicks < ZERO_HOLD_TICKS) {
      // Olası GPS gürültüsü: hareket halindeyken gelen ani 0 → henüz gösterme, son değeri tut
      _gpsZeroTicks++;
      display = _dispSpeed;
    } else {
      if (raw >= ZERO_HOLD_KMH) _gpsZeroTicks = 0;
      // EMA: hedefe yumuşak yaklaş (gerçek 0 onaylandıysa da buraya düşer → akıcı şekilde 0'a iner)
      _dispSpeed += (raw - _dispSpeed) * SPEED_EMA_ALPHA;
      if (Math.abs(raw - _dispSpeed) < SPEED_SNAP_KMH) _dispSpeed = raw;
      display = _dispSpeed;
    }
  } else {
    // Donanım kaynağı (HAL/CAN/OBD): kesin değer — yumuşatma/debounce yok
    _dispSpeed    = raw;
    _gpsZeroTicks = 0;
    display       = raw;
  }

  // Kaynak değişimini InspectorPanel'e bildir — SAB string taşıyamaz, her zaman postMessage
  if (src !== _prevActiveSource) {
    _prevActiveSource = src;
    _postPatch({ nativeSource: src });
  }
  if (_sabEnabled) {
    _sabBeginWrite();
    _sabF64![SAB_SPEED] = display;
    if (_obd.rpm != null) _sabF64![SAB_RPM] = _obd.rpm;
    _sabF64![SAB_TS]    = performance.now();
    _sabEndWrite();
  } else {
    _patchSpeed.speed = display;
    _postPatch(_patchSpeed);
  }
  _handleEventSpeed(raw);

  // Stop-flush: araç durduğunda birikmiş bakiyeyi persist et (< 500 m olsa bile)
  if (raw === 0) _postOdoUpdate(true);

  // Tünel/kör nokta fallback: GPS zayıfsa mesafeyi hız×Δt ile tahmin et
  _applyDeadReckoning(raw);
}

function _emitFuel(): void {
  let raw: number | undefined;

  if (_alive(_canLastSeen, SRC_TIMEOUT_CAN_MS)) {
    raw = _can.fuel;
  } else if (_alive(_obdLastSeen, SRC_TIMEOUT_OBD_MS)) {
    raw = _obd.fuel;
  }

  if (raw == null) {
    if (!_fuelNullEmitted) {
      _fuelNullEmitted = true;
      if (_sabEnabled) {
        _sabBeginWrite();
        _sabF64![SAB_FUEL] = NaN;
        _sabF64![SAB_TS]   = performance.now();
        _sabEndWrite();
      } else {
        _patchFuel.fuel = null;
        _postPatch(_patchFuel);
      }
    }
    return;
  }
  _fuelNullEmitted = false;

  if (raw < 0 || raw > 100) return;

  if (_sabEnabled) {
    _sabBeginWrite();
    _sabF64![SAB_FUEL] = raw;
    _sabF64![SAB_TS]   = performance.now();
    _sabEndWrite();
  } else {
    _patchFuel.fuel = raw;
    _postPatch(_patchFuel);
  }
  _handleEventFuel(raw);
}

/**
 * Motor soğutma suyu sıcaklığı — fuzyon CAN > OBD (fuel/hız ile aynı öncelik),
 * sanity reddi + histerezisli ENGINE_OVERHEAT üretimi.
 *
 * Not: fuel/speed'in aksine sürekli bir VehicleState alanı YOK — yalnızca
 * histerezis eşiği geçildiğinde semantik olay üretilir (Rule Engine deseni,
 * bkz. _handleEventFuel). Sensör yoksa (raw==null) event üretilmez (fail-soft,
 * sahte uyarı yasak — CLAUDE.md Sensor Resiliency).
 */
function _emitCoolant(): void {
  let raw: number | undefined;

  if (_alive(_canLastSeen, SRC_TIMEOUT_CAN_MS)) {
    raw = _can.coolantTemp;
  } else if (_alive(_obdLastSeen, SRC_TIMEOUT_OBD_MS)) {
    raw = _obd.coolantTemp;
  }

  if (raw == null) return; // sensör yok — sahte uyarı YASAK

  // Sanity: imkânsız/aralık dışı okuma → tüm örneği reddet (adaptör glitch'i)
  if (raw < COOLANT_TEMP_MIN || raw > COOLANT_TEMP_MAX) return;

  _handleEventEngineTemp(raw);
}

function _watchdog(): void {
  const canAlive = _alive(_canLastSeen, SRC_TIMEOUT_CAN_MS);
  const obdAlive = _alive(_obdLastSeen, SRC_TIMEOUT_OBD_MS);
  const gpsAlive = _alive(_gpsLastSeen, SRC_TIMEOUT_GPS_MS);

  // PR-1: kaynak sağlığını ana thread'e taşı — MEVCUT 1 Hz watchdog, yeni timer YOK.
  // Yalnız geçişte postlanır; sinyalleri unsupported YAPMAZ (tüketim ayrı PR).
  _postSourceHealthIfChanged(canAlive, obdAlive, gpsAlive);

  // CAN + OBD ikisi de stale → geri vites overlay'ini sıfırla
  if (!canAlive && !obdAlive) {
    _clearReverseTimers();
    if (_sabEnabled) {
      _sabBeginWrite();
      _sabF64![SAB_REVERSE] = 0;
      _sabF64![SAB_TS]      = performance.now();
      _sabEndWrite();
    } else {
      _patchReverse.reverse = false;
      _postPatch(_patchReverse);
    }
    _handleEventReverse(false);
  }

  // OBD Watchdog: GPS > 20 km/h iken OBD sürekli 0 veriyorsa → OBD stale say
  if (obdAlive && gpsAlive && (_obd.speed ?? -1) === 0 && (_gps.speed ?? 0) > 20) {
    if (++_obdZeroConsecutive >= 3) {
      _obdLastSeen        = 0; // timeout'a zorla
      _obdZeroConsecutive = 0;
    }
  } else {
    _obdZeroConsecutive = 0;
  }

  // GPS Hardening: kalite 20s kesintisiz kötüyse ana thread'e GPS_FAILURE bildir
  _checkGpsQuality();
}

/**
 * GPS kalite watchdog'u (1Hz, _watchdog içinden çağrılır).
 *
 * Fix VAR ama 20s boyunca accuracy > 100m veya koordinat NaN ise GPS_FAILURE
 * (active=true) gönderir; kalite normale dönünce bir kez active=false gönderir.
 * Hiç fix yoksa (tünel/kapalı) bu kontrol devre dışıdır — o senaryo
 * SystemHealthMonitor'ın GPS deadline'ı (20s) tarafından kapsanır.
 * Zero-allocation: önceden tahsis edilmiş _outGpsFailure mutate edilir.
 */
function _checkGpsQuality(): void {
  if (!_gpsLocActive) { _gpsBadSinceMs = 0; return; }

  const lat = _gpsLocBuf.lat;
  const lng = _gpsLocBuf.lng;
  const acc = _gpsLocBuf.accuracy;
  const bad =
    !Number.isFinite(lat) || !Number.isFinite(lng) ||
    !Number.isFinite(acc) || acc > GPS_FAILURE_ACCURACY_M;

  if (!bad) {
    // Kalite iyi → pencereyi sıfırla; arıza aktifse recovery bildir
    _gpsBadSinceMs = 0;
    if (_gpsFailureActive) {
      _gpsFailureActive     = false;
      _outGpsFailure.active   = false;
      _outGpsFailure.accuracy = acc;
      _outGpsFailure.ts       = Date.now();
      self.postMessage(_outGpsFailure);
    }
    return;
  }

  const now = performance.now();
  if (_gpsBadSinceMs === 0)  { _gpsBadSinceMs = now; return; } // pencere başlat
  if (_gpsFailureActive)      return;                          // zaten bildirildi
  if (now - _gpsBadSinceMs >= GPS_FAILURE_WINDOW_MS) {
    _gpsFailureActive       = true;
    _outGpsFailure.active   = true;
    _outGpsFailure.accuracy = Number.isFinite(acc) ? acc : NaN;
    _outGpsFailure.ts       = Date.now();
    self.postMessage(_outGpsFailure);
  }
}

// ── Mesaj işleyicileri (her vaka ayrı monomorfik fonksiyon) ────────────────
//
// Switch-case korunur ama her vaka, tipi `Extract<WorkerInMessage, …>` ile
// kesinleştirilmiş tek bir işleyiciye delege edilir. Böylece her fonksiyon
// tek bir mesaj şekli görür → V8 "Type Feedback" kirliliği (polymorphism)
// azalır ve gövdeler küçüldüğü için inline'a daha uygun hâle gelir.

/** INIT/INIT_FALLBACK ortak periyodik görev kurulumu. */
function _startTimers(): void {
  _speedTimer    = setInterval(_emitSpeed,   SPEED_INTERVAL_MS);
  _fuelTimer     = setInterval(_emitFuel,    FUEL_INTERVAL_MS);
  // Coolant, yakıttan da yavaş değişir — aynı 8s poll periyodu yeterli.
  _coolantTimer  = setInterval(_emitCoolant, FUEL_INTERVAL_MS);
  _watchdogTimer = setInterval(_watchdog,    WATCHDOG_INTERVAL_MS);
}

function _handleInit(msg: Extract<WorkerInMessage, { type: 'INIT' }>): void {
  _odoSet(msg.odoKm);            // TMR — 3 kopyaya yaz
  _lastPersistedOdo = msg.odoKm; // main thread'le senkron; ilk 500 m dolana dek disk yazması yok
  _odoGuard.reset(); // startup guard + jump referansı sıfırla
  if (msg.sab) {
    _sabF64          = new Float64Array(msg.sab);
    _sabI32          = new Int32Array(msg.sab);
    _sabEnabled      = true;
    _sabF64[SAB_ODO] = _odoGet(); // odo'yu SAB'a ilk kez yaz
  }
  _startTimers();
}

function _handleInitFallback(msg: Extract<WorkerInMessage, { type: 'INIT_FALLBACK' }>): void {
  // SAB izolasyonu yok — postMessage yolu, Zero-Crash garantisi
  _odoSet(msg.odoKm);            // TMR — 3 kopyaya yaz
  _lastPersistedOdo = msg.odoKm;
  _odoGuard.reset();
  _sabEnabled = false; // açık kısıtlama: SAB yolunu hiç deneme
  _startTimers();
}

function _handleVehicleData(msg: Extract<WorkerInMessage, { type: 'VEHICLE_DATA' }>): void {
  // ── VAL yolu: NormalizedVehicleData → per-source buffer güncelle ────
  const { source, signals } = msg;
  _valSignals[source as 'HAL' | 'CAN' | 'OBD' | 'GPS'] = signals;

  // ── Legacy buffer'ları da güncelle (odometer/geofence/DR uyumluluğu) ──
  const nowPerf = performance.now();
  if (source === 'CAN') {
    _canLastSeen      = nowPerf;
    _can.speed        = signals.speed?.value;
    _can.reverse      = signals.reverse?.value;
    _can.fuel         = signals.fuel?.value;
    _can.coolantTemp  = signals.coolantTemp?.value;
    if (signals.reverse?.value != null) _handleCanReverse(signals.reverse.value);
  } else if (source === 'OBD') {
    _obdLastSeen       = nowPerf;
    _obd.speed         = signals.speed?.value;
    _obd.fuel          = signals.fuel?.value;
    _obd.rpm           = signals.rpm?.value;
    _obd.reverse       = signals.reverse?.value;
    _obd.totalDistance = signals.totalDistance?.value;
    _obd.coolantTemp   = signals.coolantTemp?.value;
    if (signals.reverse?.value != null)      _handleObdReverse(signals.reverse.value);
    if (signals.totalDistance?.value != null) _syncObdOdometer(signals.totalDistance.value);
  } else if (source === 'HAL') {
    // HAL: CanAdapterData uyumlu yapı — CAN legacy buffer'larını güncelle.
    // _emitFuel() ve watchdog legacy yolu üzerinden HAL yakıt/geri vites verisini görmesi için.
    _canLastSeen      = nowPerf;
    _can.speed        = signals.speed?.value;
    _can.reverse      = signals.reverse?.value;
    _can.fuel         = signals.fuel?.value;
    _can.coolantTemp  = signals.coolantTemp?.value;
    if (signals.reverse?.value != null) _handleCanReverse(signals.reverse.value);
  } else if (source === 'GPS') {
    const dtMs = _prevGpsUpdateAt > 0 ? nowPerf - _prevGpsUpdateAt : 0;
    _prevGpsUpdateAt = nowPerf;
    _gpsLastSeen     = nowPerf;
    // GPS speed artık m/s RAW → SignalNormalizer km/h'e çevirdi, direkt kullan
    _gps.speed   = signals.speed?.value;
    _gps.heading = signals.heading?.value;

    if (signals.location?.value != null) {
      const loc = signals.location.value;
      _gpsLocBuf.lat      = loc.lat;
      _gpsLocBuf.lng      = loc.lng;
      _gpsLocBuf.accuracy = loc.accuracy;
      _gps.location       = _gpsLocBuf;
      _gpsLocActive       = true;
    } else {
      _gps.location = undefined;
      _gpsLocActive = false;
    }

    _updateOdometerGps(dtMs);

    if (_gfActive && _gpsLocActive && _lastKnownSpeed > 0) {
      _checkGeofences(_gpsLocBuf.lat, _gpsLocBuf.lng);
    }

    _patchGps.heading  = undefined;
    _patchGps.location = undefined;
    let hasGpsData = false;
    if (_gps.heading  != null) { _patchGps.heading  = _gps.heading;  hasGpsData = true; }
    if (_gpsLocActive)         { _patchGps.location = _gps.location; hasGpsData = true; }
    if (hasGpsData) _postPatch(_patchGps);
  }
}

function _handleCanData(msg: Extract<WorkerInMessage, { type: 'CAN_DATA' }>): void {
  const d = msg.payload;
  _canLastSeen    = performance.now();
  _can.speed      = d.speed;
  _can.reverse    = d.reverse;
  _can.fuel       = d.fuel;
  if (d.reverse != null) _handleCanReverse(d.reverse);
}

function _handleObdData(msg: Extract<WorkerInMessage, { type: 'OBD_DATA' }>): void {
  const d = msg.payload;
  _obdLastSeen        = performance.now();
  _obd.speed          = d.speed;
  _obd.fuel           = d.fuel;
  _obd.rpm            = d.rpm;
  _obd.reverse        = d.reverse;
  _obd.totalDistance  = d.totalDistance;
  if (d.reverse        != null) _handleObdReverse(d.reverse);
  if (d.totalDistance  != null) _syncObdOdometer(d.totalDistance);
}

function _handleGpsData(msg: Extract<WorkerInMessage, { type: 'GPS_DATA' }>): void {
  const d = msg.payload;
  const _nowGps = performance.now();
  // Δt: önceki GPS güncellemesinden bu yana geçen süre (Doppler × Δt odometer için)
  const dtMs = _prevGpsUpdateAt > 0 ? _nowGps - _prevGpsUpdateAt : 0;
  _prevGpsUpdateAt = _nowGps;
  _gpsLastSeen     = _nowGps;
  _gps.speed    = d.speed;
  _gps.heading  = d.heading;

  if (d.location != null) {
    // In-place güncelleme — yeni nesne oluşturma
    _gpsLocBuf.lat      = d.location.lat;
    _gpsLocBuf.lng      = d.location.lng;
    _gpsLocBuf.accuracy = d.location.accuracy;
    _gps.location       = _gpsLocBuf;
    _gpsLocActive       = true;
  } else {
    _gps.location = undefined;
    _gpsLocActive = false;
  }

  _updateOdometerGps(dtMs);

  // Geofence kontrolü — yalnızca araç hareket halindeyken ve konum geçerliyse
  if (_gfActive && _gpsLocActive && _lastKnownSpeed > 0) {
    _checkGeofences(_gpsLocBuf.lat, _gpsLocBuf.lng);
  }

  // GPS STATE_UPDATE: heading ve/veya location
  _patchGps.heading  = undefined;
  _patchGps.location = undefined;
  let hasGpsData = false;
  if (_gps.heading  != null) { _patchGps.heading  = _gps.heading;  hasGpsData = true; }
  if (_gpsLocActive)         { _patchGps.location = _gps.location; hasGpsData = true; }
  if (hasGpsData) _postPatch(_patchGps);
}

function _handleUpdateGeofence(msg: Extract<WorkerInMessage, { type: 'UPDATE_GEOFENCE' }>): void {
  _gfZones  = msg.zones;
  _gfActive = msg.zones.length > 0;
  // Mevcut zona state'ini temizle — yeni zona seti için sıfırdan başlat
  _gfInsideMap.clear();
  _gfExitCount.clear();
  _gfExitFirstMs.clear();
}

function _handleRestoreOdo(msg: Extract<WorkerInMessage, { type: 'RESTORE_ODO' }>): void {
  // Strict Monotonicity: native'den gelen değer yalnızca mevcut _odoKm'den
  // büyükse uygulanır — crash recovery sırasında geriye gidiş olmaz.
  if (Number.isFinite(msg.km) && msg.km > _odoGet()) {
    _odoSet(msg.km);            // TMR — 3 kopyaya yaz
    _lastPersistedOdo = msg.km; // persist eşiğini senkronize et
    _odoGuard.setInitialValue(msg.km); // startup guard geç
    if (_sabEnabled && _sabF64) { _sabBeginWrite(); _sabF64[SAB_ODO] = _odoGet(); _sabEndWrite(); }
    console.info('[ODO] Crash recovery: restored to', msg.km.toFixed(3), 'km');
  }
}

function _handleStop(): void {
  if (_speedTimer    !== null) { clearInterval(_speedTimer);    _speedTimer    = null; }
  if (_fuelTimer     !== null) { clearInterval(_fuelTimer);     _fuelTimer     = null; }
  if (_coolantTimer  !== null) { clearInterval(_coolantTimer);  _coolantTimer  = null; }
  if (_watchdogTimer !== null) { clearInterval(_watchdogTimer); _watchdogTimer = null; }
  _clearReverseTimers();
}

/**
 * DEV-only kaos: _odoTMR'daki 3 kopyadan birine aykırı bir değer yazar (bit-flip
 * simülasyonu), ardından _odoGet() median'ının doğru km'yi kurtardığını loglar.
 * Yalnızca import.meta.env.DEV altında dispatch edilir → üretimde tree-shake edilir.
 */
function _handleChaosBitflip(): void {
  const before   = _odoGet();
  const idx      = Math.floor(Math.random() * 3);
  const corrupt  = before + 9_000 + Math.random() * 1_000; // bariz aykırı değer
  _odoTMR[idx]   = corrupt;                                 // bit-flip enjekte
  const recovered = _odoGet();                              // median + self-heal (bozuk kopya onarılır)
  // Self-heal sonrası 3 kopya da median'a eşit olmalı
  const healed = _odoTMR[0] === recovered && _odoTMR[1] === recovered && _odoTMR[2] === recovered;
  console.warn(
    `[Chaos:BitFlip] _odoTMR[${idx}] bozuldu: ${before.toFixed(3)} → ${corrupt.toFixed(3)} km | ` +
    `median: ${recovered.toFixed(3)} km | sapma: ${Math.abs(recovered - before).toFixed(6)} km | ` +
    (recovered === before && healed
      ? 'TMR BAŞARILI — değer kurtarıldı ve 3 kopya self-heal ile onarıldı'
      : 'TMR BAŞARISIZ — median sapması veya onarım eksik!'),
  );
}

// ── Ana mesaj işleyicisi (ince dispatcher) ─────────────────────────────────

self.onmessage = (e: MessageEvent<WorkerInMessage>): void => {
  const msg = e.data;

  switch (msg.type) {
    case 'INIT':            _handleInit(msg);            break;
    case 'INIT_FALLBACK':   _handleInitFallback(msg);    break;
    case 'VEHICLE_DATA':    _handleVehicleData(msg);     break;
    case 'CAN_DATA':        _handleCanData(msg);         break;
    case 'OBD_DATA':        _handleObdData(msg);         break;
    case 'GPS_DATA':        _handleGpsData(msg);         break;
    case 'UPDATE_GEOFENCE': _handleUpdateGeofence(msg);  break;
    case 'RESTORE_ODO':     _handleRestoreOdo(msg);      break;
    case 'CHAOS_BITFLIP':   if (import.meta.env.DEV) _handleChaosBitflip(); break;
    case 'VISIBILITY':      _handleVisibility(msg);      break;
    case 'STOP':            _handleStop();               break;
  }
};
