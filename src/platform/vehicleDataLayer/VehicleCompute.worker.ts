/// <reference lib="webworker" />

/**
 * VehicleCompute.worker — Off-main-thread hesaplama çekirdeği.
 *
 * Tüm ağır veri işleme bu worker'da çalışır:
 *   • Speed Fusion   : CAN → OBD → GPS öncelik hiyerarşisi + timeout
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
import { OdometerGuard } from './OdometerGuard';

// ── Mesaj protokolü ──────────────────────────────────────────────────────

export type WorkerInMessage =
  | { type: 'INIT';             odoKm: number; sab?: SharedArrayBuffer }
  | { type: 'CAN_DATA';         payload: CanAdapterData }
  | { type: 'OBD_DATA';         payload: ObdAdapterData }
  | { type: 'GPS_DATA';         payload: GpsAdapterData }
  | { type: 'UPDATE_GEOFENCE';  zones: WorkerGeofenceZone[] }
  | { type: 'STOP' };

export type WorkerOutMessage =
  | { type: 'STATE_UPDATE'; patch: Partial<VehicleState> }
  | { type: 'ODO_UPDATE';   odoKm: number }
  | { type: 'VEHICLE_EVENT'; event: VehicleEvent };

// ── Sabitler ─────────────────────────────────────────────────────────────

const SPEED_MAX            = 300;
const SPEED_INTERVAL_MS    = 300;   // 3Hz — gösterge için yeterli, CPU baskısı azalır
const FUEL_INTERVAL_MS     = 8_000; // 8s — yakıt çok hızlı değişmez
const ANTI_JITTER_KMH      = 20;

const GPS_ACCURACY_MAX_M      = 30;
const ODO_JUMP_MAX_KM         = 0.2;   // GPS tek tick max delta (Haversine sanity)
const ODO_OBD_JUMP_MAX_KM     = 5;     // OBD ani sıçrama eşiği (ilk sync hariç)
const ODO_PERSIST_THRESHOLD_KM = 0.5;  // Disk yazma eşiği: 500 m birikince persist et
const DR_JITTER_KMH        = 3;     // GPS < 3 km/h → konum kayması gürültüsü
const DR_MAX_INTERVAL_MS   = 200;   // dead reckoning max Δt (timer jitter toleransı)

const SRC_TIMEOUT_CAN_MS   = 3_000;
const SRC_TIMEOUT_OBD_MS   = 10_000;
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

// ── Sensör durumu (in-place mutasyon, GC baskısı 0) ──────────────────────

const _can: CanAdapterData & { speed?: number; reverse?: boolean; fuel?: number } = {};
const _obd: ObdAdapterData & { speed?: number; fuel?: number; rpm?: number; reverse?: boolean; totalDistance?: number } = {};

// GPS: location buffer pre-allocated; null durumu _gpsLocActive flag ile temsil edilir
const _gpsLocBuf = { lat: 0, lng: 0, accuracy: 0 };
let _gpsLocActive = false;
const _gps: GpsAdapterData & { speed?: number; heading?: number; location?: typeof _gpsLocBuf } = {};

// ── Tazelik takibi (performance.now() monotonic) ────────────────────────

let _canLastSeen = 0;
let _obdLastSeen = 0;
let _gpsLastSeen = 0;

// ── Hız durumu ────────────────────────────────────────────────────────────

let _lastKnownSpeed     = 0;
let _obdZeroConsecutive = 0;

// ── Geri vites durumu ─────────────────────────────────────────────────────

let _revDebounceTimer:  ReturnType<typeof setTimeout> | null = null;
let _obdRevCandidate:   boolean | null = null;
let _obdRevStableTimer: ReturnType<typeof setTimeout> | null = null;

// ── Odometer ─────────────────────────────────────────────────────────────

let _odoKm = 0;
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

// ── Null-emit tek-seferlik bayrakları ────────────────────────────────────
// Kaynaklar stale olduğunda null yalnızca bir kez iletilir — 10 Hz spam önlenir
let _speedNullEmitted = false;
let _fuelNullEmitted  = false;

// ── EventHub durumu ───────────────────────────────────────────────────────

let _isDriving     = false;
let _lowFuelFired  = false;
let _critFuelFired = false;
let _isReverse     = false;

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

// ── SharedArrayBuffer (Zero-Copy) ─────────────────────────────────────────
//
// Layout (64 bytes):
//   Float64[0] = speed      Float64[1] = rpm
//   Float64[2] = fuel       Float64[3] = odometer
//   Float64[4] = isReverse  Float64[5] = lastUpdateTs (performance.now())
//   Int32[12]  = generation counter — Atomics.store signals UI that data changed
//
// Tek-yazar (Worker) + Atomics.store release-fence → Float64 okuma güvenli.
// Fallback: INIT'te sab yoksa _sabEnabled=false, tüm değerler postMessage'la gider.

const SAB_SPEED   = 0;
const SAB_RPM     = 1;
const SAB_FUEL    = 2;
const SAB_ODO     = 3;
const SAB_REVERSE = 4;
const SAB_TS      = 5;
const SAB_GEN_IDX = 12; // Int32 index at byte 48

let _sabEnabled = false;
let _sabF64:    Float64Array | null = null;
let _sabI32:    Int32Array   | null = null;
let _sabGen     = 0;

// ── Interval handles ──────────────────────────────────────────────────────

let _speedTimer:    ReturnType<typeof setInterval> | null = null;
let _fuelTimer:     ReturnType<typeof setInterval> | null = null;
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

// ── Odometer persist helper ───────────────────────────────────────────────
//
// Distance-Based Throttling (CLAUDE.md §3):
//   force=false : ancak 500 m birikmişse ODO_UPDATE gönder → disk yazma %90+ azalır
//   force=true  : araç durduğunda veya OBD ground-truth sync'te birikmiş bakiyeyi flush et
//
// Strict Monotonicity: delta <= 0 ise (zaten persist edilmiş) her iki modda da sessiz dön.
// Zero-allocation: yeni nesne oluşturulmaz; _outOdo envelope mutate edilir.

function _postOdoUpdate(force: boolean): void {
  const delta = _odoKm - _lastPersistedOdo;
  if (delta <= 0) return;                                   // birikmemiş; hiçbir şey yok
  if (!force && delta < ODO_PERSIST_THRESHOLD_KM) return;  // 500 m eşiği aşılmadı

  _lastPersistedOdo = _odoKm;
  _outOdo.odoKm     = _odoKm;
  self.postMessage(_outOdo); // Zustand persist (localStorage)
  // SAB odo güncellemesi — gen increment'siz; bir sonraki _emitSpeed tiki UI'ı haberdar eder
  if (_sabEnabled) _sabF64![SAB_ODO] = _odoKm;
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
      _sabF64![SAB_REVERSE] = value ? 1 : 0;
      _sabF64![SAB_TS]      = performance.now();
      Atomics.store(_sabI32!, SAB_GEN_IDX, (_sabGen = (_sabGen + 1) | 0));
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

// ── Odometer (GPS Haversine delta) ───────────────────────────────────────

function _updateOdometerGps(): void {
  if (!_gpsLocActive) return;
  const loc = _gps.location!;

  if (loc.accuracy > GPS_ACCURACY_MAX_M) return; // jitter guard

  // ── OdometerGuard: startup skip (ilk 3 fix) + 100 km jump protection ──
  const guardResult = _odoGuard.check(loc.lat, loc.lng);

  if (guardResult === 'skip') {
    // Startup penceresi: referansı ilerlet ama delta hesaplama.
    // Pencere kapandığında delta doğru başlangıç noktasından ölçülür.
    _prevOdoBuf.lat = loc.lat;
    _prevOdoBuf.lng = loc.lng;
    _prevOdoActive  = true;
    return;
  }

  if (guardResult === 'invalid') {
    // 100 km sıçrama: bu konum güvenilmez, _prevOdo referansını sıfırla.
    // Sonraki geçerli okuma yeni baseline oluşturur (double-counting yok).
    _prevOdoActive = false;
    return;
  }

  // guardResult === 'ok' → normal delta hesapla ───────────────────────────

  if (!_prevOdoActive) {
    // İlk geçerli GPS noktası — referans kaydet, delta yok
    _prevOdoBuf.lat  = loc.lat;
    _prevOdoBuf.lng  = loc.lng;
    _prevOdoActive   = true;
    return;
  }

  // Jitter filtresi: < 3 km/h'de GPS konum kayması gürültüsünü biriktirme
  if (_lastKnownSpeed < DR_JITTER_KMH) {
    _prevOdoBuf.lat = loc.lat;
    _prevOdoBuf.lng = loc.lng;
    return;
  }

  const deltaKm = _haversineKm(_prevOdoBuf.lat, _prevOdoBuf.lng, loc.lat, loc.lng);

  // Referansı her durumda güncelle; sonra per-tick sanity guard'ı uygula
  _prevOdoBuf.lat = loc.lat;
  _prevOdoBuf.lng = loc.lng;

  // Tek GPS tick'te 200m'den fazla → sıçrama; hata bus'ı için debug
  if (deltaKm > ODO_JUMP_MAX_KM) {
    console.debug('[ODO] GPS jump rejected: delta=', deltaKm.toFixed(3), 'km');
    return;
  }

  if (deltaKm > 0) {
    _odoKm += deltaKm;
    _postOdoUpdate(false); // 500 m eşiği kontrolü
  }
}

// OBD totalDistance → mutlak kayıt; GPS birikimini senkronize et
function _syncObdOdometer(totalDistanceKm: number): void {
  // Strict Monotonicity: OBD değeri mevcut değerden küçükse negative delta → reddet
  if (totalDistanceKm < _odoKm) {
    console.debug('[ODO] OBD negative delta rejected: new=', totalDistanceKm.toFixed(3),
      'cur=', _odoKm.toFixed(3));
    return;
  }

  // Sanity Jump Guard (ilk sync hariç): 5 km'den büyük ani artış → sensör paraziti
  if (_odoInitialized && (totalDistanceKm - _odoKm) > ODO_OBD_JUMP_MAX_KM) {
    console.debug('[ODO] OBD jump guard rejected: delta=',
      (totalDistanceKm - _odoKm).toFixed(3), 'km');
    return;
  }

  // 10m altı fark gürültü — sessizce atla
  if (Math.abs(totalDistanceKm - _odoKm) < 0.01) return;

  _odoKm          = totalDistanceKm;
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

  if (speedKmh <= 0) {
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

  // Monotonicity garantili: pozitif delta, _odoKm asla azalmaz
  _odoKm += deltaKm;
  _postOdoUpdate(false); // 500 m eşiği kontrolü
}

// ── Periyodik görevler ────────────────────────────────────────────────────

function _emitSpeed(): void {
  let raw: number | undefined;
  let src: 'CAN' | 'OBD' | 'GPS' = 'CAN';

  if (_alive(_canLastSeen, SRC_TIMEOUT_CAN_MS)) {
    raw = _can.speed; src = 'CAN';
  } else if (_alive(_obdLastSeen, SRC_TIMEOUT_OBD_MS)) {
    raw = _obd.speed; src = 'OBD';
  } else if (_alive(_gpsLastSeen, SRC_TIMEOUT_GPS_MS)) {
    raw = _gps.speed; src = 'GPS';
  }

  if (raw == null) {
    // Tüm kaynaklar stale → UI'a "sinyal yok" bildir (tek seferlik)
    _lastDeadReckonAt = 0; // DR zaman damgasını sıfırla — yalancı km birikimini durdur
    if (!_speedNullEmitted) {
      _speedNullEmitted = true;
      if (_sabEnabled) {
        _sabF64![SAB_SPEED] = NaN; // NaN = null sentinel Float64'te
        _sabF64![SAB_TS]    = performance.now();
        Atomics.store(_sabI32!, SAB_GEN_IDX, (_sabGen = (_sabGen + 1) | 0));
      } else {
        _patchSpeed.speed = null;
        _postPatch(_patchSpeed);
      }
    }
    return;
  }
  _speedNullEmitted = false; // geçerli kaynak geldi — bayrağı sıfırla

  if (raw < 0 || raw > SPEED_MAX) return;

  // Anti-jitter: 100ms'de ±20 km/h sıçrama → sensör gürültüsü
  if (raw > 0 && _lastKnownSpeed > 0 && Math.abs(raw - _lastKnownSpeed) > ANTI_JITTER_KMH) return;

  // RPM Cross-Check: OBD hız > 10 km/h ama rpm == 0 → ICE imkânsız
  if (src === 'OBD' && raw > 10 && _obd.rpm === 0) return;

  _lastKnownSpeed = raw;
  if (_sabEnabled) {
    _sabF64![SAB_SPEED] = raw;
    if (_obd.rpm != null) _sabF64![SAB_RPM] = _obd.rpm;
    _sabF64![SAB_TS]    = performance.now();
    Atomics.store(_sabI32!, SAB_GEN_IDX, (_sabGen = (_sabGen + 1) | 0));
  } else {
    _patchSpeed.speed = raw;
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
        _sabF64![SAB_FUEL] = NaN;
        _sabF64![SAB_TS]   = performance.now();
        Atomics.store(_sabI32!, SAB_GEN_IDX, (_sabGen = (_sabGen + 1) | 0));
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
    _sabF64![SAB_FUEL] = raw;
    _sabF64![SAB_TS]   = performance.now();
    Atomics.store(_sabI32!, SAB_GEN_IDX, (_sabGen = (_sabGen + 1) | 0));
  } else {
    _patchFuel.fuel = raw;
    _postPatch(_patchFuel);
  }
  _handleEventFuel(raw);
}

function _watchdog(): void {
  const canAlive = _alive(_canLastSeen, SRC_TIMEOUT_CAN_MS);
  const obdAlive = _alive(_obdLastSeen, SRC_TIMEOUT_OBD_MS);
  const gpsAlive = _alive(_gpsLastSeen, SRC_TIMEOUT_GPS_MS);

  // CAN + OBD ikisi de stale → geri vites overlay'ini sıfırla
  if (!canAlive && !obdAlive) {
    _clearReverseTimers();
    if (_sabEnabled) {
      _sabF64![SAB_REVERSE] = 0;
      _sabF64![SAB_TS]      = performance.now();
      Atomics.store(_sabI32!, SAB_GEN_IDX, (_sabGen = (_sabGen + 1) | 0));
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
}

// ── Ana mesaj işleyicisi ──────────────────────────────────────────────────

self.onmessage = (e: MessageEvent<WorkerInMessage>): void => {
  const msg = e.data;

  switch (msg.type) {

    case 'INIT':
      _odoKm            = msg.odoKm;
      _lastPersistedOdo = msg.odoKm; // main thread'le senkron; ilk 500 m dolana dek disk yazması yok
      _odoGuard.reset(); // startup guard + jump referansı sıfırla
      if (msg.sab) {
        _sabF64          = new Float64Array(msg.sab);
        _sabI32          = new Int32Array(msg.sab);
        _sabEnabled      = true;
        _sabF64[SAB_ODO] = _odoKm; // odo'yu SAB'a ilk kez yaz
      }
      _speedTimer    = setInterval(_emitSpeed,   SPEED_INTERVAL_MS);
      _fuelTimer     = setInterval(_emitFuel,    FUEL_INTERVAL_MS);
      _watchdogTimer = setInterval(_watchdog,    WATCHDOG_INTERVAL_MS);
      break;

    case 'CAN_DATA': {
      const d = msg.payload;
      _canLastSeen    = performance.now();
      _can.speed      = d.speed;
      _can.reverse    = d.reverse;
      _can.fuel       = d.fuel;
      if (d.reverse != null) _handleCanReverse(d.reverse);
      break;
    }

    case 'OBD_DATA': {
      const d = msg.payload;
      _obdLastSeen        = performance.now();
      _obd.speed          = d.speed;
      _obd.fuel           = d.fuel;
      _obd.rpm            = d.rpm;
      _obd.reverse        = d.reverse;
      _obd.totalDistance  = d.totalDistance;
      if (d.reverse        != null) _handleObdReverse(d.reverse);
      if (d.totalDistance  != null) _syncObdOdometer(d.totalDistance);
      break;
    }

    case 'GPS_DATA': {
      const d = msg.payload;
      _gpsLastSeen  = performance.now();
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

      _updateOdometerGps();

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
      break;
    }

    case 'UPDATE_GEOFENCE': {
      _gfZones  = msg.zones;
      _gfActive = msg.zones.length > 0;
      // Mevcut zona state'ini temizle — yeni zona seti için sıfırdan başlat
      _gfInsideMap.clear();
      _gfExitCount.clear();
      _gfExitFirstMs.clear();
      break;
    }

    case 'STOP':
      if (_speedTimer    !== null) { clearInterval(_speedTimer);    _speedTimer    = null; }
      if (_fuelTimer     !== null) { clearInterval(_fuelTimer);     _fuelTimer     = null; }
      if (_watchdogTimer !== null) { clearInterval(_watchdogTimer); _watchdogTimer = null; }
      _clearReverseTimers();
      break;
  }
};
