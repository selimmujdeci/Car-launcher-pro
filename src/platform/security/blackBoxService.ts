/**
 * BlackBoxService — Araç Kara Kutusu  (U-5 · R-1 Operasyon)
 *
 * İşlevler:
 *  1. Rolling Buffer: Son 30 saniyelik araç durumu (VehicleState + OBD + G-kuvveti)
 *     sirkülasyon tamponu içinde tutulur. Zero-allocation: 300 slot önceden
 *     ayrılır, her tick mevcut slotun alanları yerinde güncellenir.
 *
 *  2. Darbe Algılama: DeviceMotionEvent.acceleration (yerçekimsiz doğrusal
 *     ivme) dinlenir. Herhangi bir eksende |ivme| > 6.0G (58.84 m/s²) ise
 *     _lockCrashData() tetiklenir.
 *     (Native High-G callback araştırması: CarLauncherPlugin'de dedicated
 *      'highG' event yok — DeviceMotionEvent tüm head unit WebView'larda çalışır.)
 *
 *  3. Veri Kilitleme: Darbe anında tampon JSON'a dönüştürülür ve
 *     safeSetRawImmediate (R-2 Atomik Filesystem) ile "crash-log-[ts]" anahtarına
 *     yazılır. Native modda Filesystem atomik yazma; web modda localStorage fallback.
 *
 *  4. Olay Yayımı: dispatchCrashDetected(peakG) → VehicleEventHub üzerinden
 *     tüm aboneler (SystemOrchestrator → GlobalAlert + TTS) uyarılır.
 *
 *  5. Adli Veri: Her slot GPS hızı + OBD hızı (çapraz kontrol) + RPM + fren tahmini
 *     içerir. Kaza analizi ve hız uyuşmazlığı tespiti için hazırdır.
 *
 * Darbe eşiği: 6.0G   Soğuma süresi: 10s (aynı çarpışma çift yazılmaz)
 * Buffer boyutu: 300 entry × 100ms/entry = 30 saniye @ 10Hz
 *
 * Zaman kaynağı — R-1 Patch (Monotonic Time):
 *   BufferSlot.ts = performance.now() - _origin   (monotonic delta, ms)
 *   CrashRecord.crashAt  = Date.now()             (duvar saati, adli raporlama)
 *   CrashRecord.crashMono = ts at crash moment    (aynı referans — "frenle çarpış arası kaç ms?")
 *   CrashRecord.originEpoch = Date.now() at _origin → slot.ts + originEpoch = duvar saati
 *   Sistem saati atlamalarında buffer kronolojisi bozulmaz (CLAUDE.md §4).
 */

import { useUnifiedVehicleStore as useVehicleStore } from '../vehicleDataLayer/UnifiedVehicleStore';
import { dispatchCrashDetected }   from '../vehicleDataLayer';
import {
  safeSetRawImmediate,
  safeGetRaw,
  safeRemoveRaw,
  listKeysWithPrefix,
}                                  from '../../utils/safeStorage';
import { onOBDData }               from '../obdService';

/* ── Sabitler ────────────────────────────────────────────────── */

const BUFFER_SIZE       = 300;   // 10Hz × 30s = 300 slot
const SAMPLE_INTERVAL   = 100;   // ms — 10Hz örnekleme
const CRASH_G_THRESHOLD = 6.0;   // G birimi — 6G gerçek darbe, 3.5G false-positive'e yol açıyordu
const G_TO_MS2          = 9.80665;
const CRASH_COOLDOWN_MS = 10_000;
const CRASH_KEY_PREFIX  = 'crash-log-';

/* ── Monotonic zaman referansı ───────────────────────────────── */

/**
 * Modül yüklendiği andaki performance.now() ve Date.now() ikilisi.
 * _origin: BufferSlot.ts değerlerinin referans noktası (performance.now() - _origin).
 * _originEpoch: slot.ts'i duvar saatine dönüştürmek için (slot.ts + _originEpoch ≈ epochMs).
 * İki değer birlikte monotonic delta ↔ wall clock dönüşümünü mümkün kılar.
 */
const _origin:      number = performance.now();
const _originEpoch: number = Date.now();

/* ── Buffer giriş yapısı ─────────────────────────────────────── */

/**
 * Her slot pre-allocate edilmiş; tick başına sadece field'lar güncellenir.
 * Zero-allocation — GC baskısı minimumdur (CLAUDE.md §3).
 *
 * Adli alanlar:
 *   ts       → performance.now() - _origin (monotonic delta, ms)
 *              Sistem saati atlamasından etkilenmez.
 *              slot.ts + CrashRecord.originEpoch ≈ duvar saati (epoch ms)
 *              Ardışık slot farkı ≈ SAMPLE_INTERVAL (100ms); büyük fark = sistem dondurması.
 *   speed    → GPS hızı (km/h)
 *   obdSpeed → OBD hızı — speed ile çapraz kontrol için (R-4 hazırlığı)
 *   rpm      → motor devri (-1 = EV/OBD bağlı değil)
 *   brake    → fren tahmini: -1=bilinmiyor, 0=basılmıyor, 1=basılıyor
 */
interface BufferSlot {
  ts:       number;   // monotonic delta from _origin (ms) — NOT epoch
  speed:    number;   // GPS hızı (km/h)
  obdSpeed: number;   // OBD hızı — -1 = veri yok
  rpm:      number;   // motor RPM — -1 = veri yok
  brake:    number;   // -1=bilinmiyor | 0=yok | 1=var (throttle inferans)
  heading:  number;
  lat:      number;
  lng:      number;
  fuel:     number;   // -1 = yok
  gForce:   number;   // kombine G büyüklüğü
  gx:       number;
  gy:       number;
  gz:       number;
}

/**
 * Diske yazılan kilitli kaza kaydı formatı (version 3 — R-1 Monotonic Patch).
 *
 * Zaman alanları:
 *   crashAt     → Date.now() — "saat kaçta kaza oldu?" (duvar saati, insan okur)
 *   crashMono   → performance.now() - _origin — "frenle çarpış arası kaç ms?"
 *   originEpoch → Date.now() at _origin — slot.ts + originEpoch ≈ slot epoch ms
 *
 * Buffer slot timestamp:
 *   slot.ts = monotonic delta from _origin
 *   Ardışık slot farkı ≈ 100ms; büyük fark sistem dondurmasını gösterir.
 *   Crash-relative timing: crashMono - slot.ts = "crash öncesi kaç ms"
 */
export interface CrashRecord {
  version:     3;
  crashAt:     number;   // epoch ms — duvar saati (Date.now())
  crashMono:   number;   // monotonic ms — kaza anı _origin'den delta
  originEpoch: number;   // _origin'in epoch karşılığı — slot→wall clock dönüşümü
  peakG:       number;
  buffer:      BufferSlot[];   // ts = monotonic delta, en eski → en yeni
}

/* ── Sirkülasyon tamponu — Zero-allocation ────────────────────── */

const _slots: BufferSlot[] = Array.from({ length: BUFFER_SIZE }, () => ({
  ts: 0, speed: 0, obdSpeed: -1, rpm: -1, brake: -1,
  heading: 0, lat: 0, lng: 0, fuel: -1,
  gForce: 0, gx: 0, gy: 0, gz: 0,
}));

let _head   = 0;
let _filled = 0;

function _snapshot(): BufferSlot[] {
  if (_filled === 0) return [];
  const out: BufferSlot[] = [];
  const start = _filled < BUFFER_SIZE ? 0 : _head;
  for (let i = 0; i < _filled; i++) {
    out.push({ ..._slots[(start + i) % BUFFER_SIZE] });
  }
  return out;
}

/* ── Modül durumu ────────────────────────────────────────────── */

let _sampleTimer:        ReturnType<typeof setInterval> | null = null;
let _accelUnsub:         (() => void) | null = null;
let _obdUnsub:           (() => void) | null = null;
// Monotonic cooldown: performance.now() tabanlı → sistem saati atlamasına karşı bağışık
let _lastCrashMono       = -Infinity;
// Safety Lock hysteresis timer — manevra bitiminden 2s sonra kilidi serbest bırakır
let _safetyUnlockTimer:  ReturnType<typeof setTimeout> | null = null;

// İvmeölçer — DeviceMotionEvent'ten güncellenir (her frame)
let _lastGx = 0, _lastGy = 0, _lastGz = 0;

// OBD snapshot — onOBDData callback'ten güncellenir (push, ~3s aralık)
// _sampleVehicleState 100ms'de bir bu değerleri okur; hesaplama yok
let _lastOBDSpeed    = -1;
let _lastOBDRpm      = -1;
let _lastOBDThrottle = -1; // fren inferansı için

/* ── Safety Lock helpers — hot path'te closure allocation yok ───── */

/** Hysteresis geri çağrısı: named function → setTimeout'a referans geçilir, lambda değil. */
function _clearSafetyLock(): void {
  (window as unknown as Record<string, unknown>).__SAFETY_LOCK__ = false;
  _safetyUnlockTimer = null;
}

/* ── Kaza verisi kilitleme ────────────────────────────────────── */

function _lockCrashData(peakG: number): void {
  const mono = performance.now() - _origin;  // monotonic delta — cooldown + crashMono için
  const now  = Date.now();                   // duvar saati — yalnızca crashAt ve dosya adı için

  // Monotonic cooldown: Date.now() atlaması çift kaydı tetikleyemez
  if (mono - _lastCrashMono < CRASH_COOLDOWN_MS) return;
  _lastCrashMono = mono;

  // Kaza anındaki G verisini mevcut slota yaz (snapshot öncesi)
  const cur = _slots[_head % BUFFER_SIZE];
  cur.gx     = _lastGx;
  cur.gy     = _lastGy;
  cur.gz     = _lastGz;
  cur.gForce = Math.sqrt(_lastGx ** 2 + _lastGy ** 2 + _lastGz ** 2);

  const record: CrashRecord = {
    version:     3,
    crashAt:     now,         // "saat kaçta kaza oldu?" — duvar saati
    crashMono:   mono,        // "frenle çarpış arası kaç ms?" — monotonic anchor
    originEpoch: _originEpoch, // slot.ts + originEpoch ≈ epoch ms (dönüşüm katsayısı)
    peakG,
    buffer: _snapshot(),
  };

  // R-2 Atomik Filesystem: native → atomik .tmp→rename; web → localStorage
  const key = `${CRASH_KEY_PREFIX}${now}`;
  void safeSetRawImmediate(key, JSON.stringify(record));

  dispatchCrashDetected(peakG);
}

/* ── İvmeölçer listener ──────────────────────────────────────── */

function _startAccelerometer(): () => void {
  if (typeof window === 'undefined' || !('DeviceMotionEvent' in window)) {
    return () => undefined;
  }

  const handler = (e: DeviceMotionEvent): void => {
    const a = e.acceleration;
    if (!a) return;

    const gx = (a.x ?? 0) / G_TO_MS2;
    const gy = (a.y ?? 0) / G_TO_MS2;
    const gz = (a.z ?? 0) / G_TO_MS2;

    _lastGx = gx;
    _lastGy = gy;
    _lastGz = gz;

    const peakG = Math.max(Math.abs(gx), Math.abs(gy), Math.abs(gz));
    if (peakG > CRASH_G_THRESHOLD) {
      _lockCrashData(peakG);
    }
  };

  window.addEventListener('devicemotion', handler);
  return () => window.removeEventListener('devicemotion', handler);
}

/* ── OBD snapshot listener ───────────────────────────────────── */

function _startOBDListener(): () => void {
  return onOBDData((obd) => {
    // Basit atama — hesaplama yok; _sampleVehicleState 10Hz'de bu değerleri okur
    _lastOBDSpeed    = obd.speed;              // -1 = desteklenmiyor
    _lastOBDRpm      = obd.rpm;               // -1 = EV/yok
    _lastOBDThrottle = obd.throttle;          // -1 = desteklenmiyor
  });
}

/* ── Buffer doldurma — 10Hz ──────────────────────────────────── */

/**
 * Her 100ms çağrılır. Ağır hesaplama yok — sadece alan atamaları.
 * gForce: tek sqrt, kaza olmayan durumda ivme verisi DeviceMotionEvent'te
 * zaten hazır; yeniden hesaplamaya gerek yok.
 */
function _sampleVehicleState(): void {
  const vs   = useVehicleStore.getState();
  const slot = _slots[_head];

  // Fren tahmini: throttle PID destekleniyorsa ve throttle 0 iken araç hareket ediyorsa
  let brake = -1;
  if (_lastOBDThrottle >= 0) {
    brake = (_lastOBDThrottle <= 0 && _lastOBDSpeed > 2) ? 1 : 0;
  }

  // Zero-allocation: slot alanları yerinde güncellenir
  slot.ts       = performance.now() - _origin;  // monotonic delta — saat atlamasından bağımsız
  slot.speed    = vs.speed ?? 0;
  slot.obdSpeed = _lastOBDSpeed;
  slot.rpm      = _lastOBDRpm;
  slot.brake    = brake;
  slot.heading  = vs.heading  ?? 0;
  slot.lat      = vs.location ? vs.location.latitude  : 0;
  slot.lng      = vs.location ? vs.location.longitude : 0;
  slot.fuel     = vs.fuel     ?? -1;
  slot.gForce   = Math.sqrt(_lastGx ** 2 + _lastGy ** 2 + _lastGz ** 2);
  slot.gx       = _lastGx;
  slot.gy       = _lastGy;
  slot.gz       = _lastGz;

  // Maneuver Detection → Safety Lock (CLAUDE.md §2.3 Hysteresis)
  // peakG: max-abs ekseni — araç sert fren / hızlanma / viraj ivmesini yakalar.
  // Zero-allocation: primitif karşılaştırma, nesne yok.
  const peakG = Math.max(Math.abs(_lastGx), Math.abs(_lastGy), Math.abs(_lastGz));
  const _win  = window as unknown as Record<string, unknown>;
  if (peakG > 0.5) {
    _win.__SAFETY_LOCK__ = true;
    // Manevra devam ediyor — bekleyen unlock timer'ı iptal et (kilit uzasın)
    if (_safetyUnlockTimer !== null) { clearTimeout(_safetyUnlockTimer); _safetyUnlockTimer = null; }
  } else if (_win.__SAFETY_LOCK__) {
    // Manevra bitti — henüz timer yoksa 2s sonra kilidi aç (hysteresis)
    if (_safetyUnlockTimer === null) _safetyUnlockTimer = setTimeout(_clearSafetyLock, 2000);
  }

  _head   = (_head + 1) % BUFFER_SIZE;
  if (_filled < BUFFER_SIZE) _filled++;
}

/* ── Public API ──────────────────────────────────────────────── */

/** BlackBox'ı başlatır. Dönen fn cleanup'tır — App.tsx useEffect'te kullanılır. */
export function startBlackBox(): () => void {
  if (_sampleTimer !== null) return () => {};  // idempotent

  _head          = 0;
  _filled        = 0;
  _lastCrashMono = -Infinity;  // cooldown sıfırla — ilk kaza her zaman geçer
  _lastGx = _lastGy = _lastGz = 0;
  _lastOBDSpeed = _lastOBDRpm = _lastOBDThrottle = -1;

  _sampleTimer = setInterval(_sampleVehicleState, SAMPLE_INTERVAL);
  _accelUnsub  = _startAccelerometer();
  _obdUnsub    = _startOBDListener();

  return () => {
    if (_sampleTimer !== null) { clearInterval(_sampleTimer); _sampleTimer = null; }
    _accelUnsub?.();  _accelUnsub = null;
    _obdUnsub?.();    _obdUnsub   = null;
    if (_safetyUnlockTimer !== null) { clearTimeout(_safetyUnlockTimer); _safetyUnlockTimer = null; }
  };
}

/** Buffer'ın güncel anlık görüntüsü — debug veya UI için. */
export function getBlackBoxSnapshot(): CrashRecord['buffer'] {
  return _snapshot();
}

/**
 * Kaydedilmiş kaza loglarının anahtarlarını döner.
 * R-2: native modda _fsCache taranır; web modda localStorage taranır.
 * Write pipeline'daki henüz yazılmamış kayıtlar da dahildir.
 */
export function listCrashLogKeys(): string[] {
  return listKeysWithPrefix(CRASH_KEY_PREFIX);
}

/**
 * Belirli bir kaza kaydını okur.
 * safeGetRaw: buffer → _fsCache (native) → localStorage (web/migration).
 */
export function readCrashLog(key: string): CrashRecord | null {
  try {
    const raw = safeGetRaw(key);
    if (!raw) return null;
    return JSON.parse(raw) as CrashRecord;
  } catch { return null; }
}

/**
 * Belirli bir kaza kaydını siler.
 * safeRemoveRaw: native → _fsCache + Filesystem; web → localStorage.
 */
export function deleteCrashLog(key: string): void {
  safeRemoveRaw(key);
}

/* ── HMR cleanup ─────────────────────────────────────────────── */

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    if (_sampleTimer !== null) { clearInterval(_sampleTimer); _sampleTimer = null; }
    _accelUnsub?.(); _accelUnsub = null;
    _obdUnsub?.();   _obdUnsub   = null;
    if (_safetyUnlockTimer !== null) { clearTimeout(_safetyUnlockTimer); _safetyUnlockTimer = null; }
  });
}
