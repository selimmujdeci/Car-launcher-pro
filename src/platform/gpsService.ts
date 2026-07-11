import { create } from 'zustand';
import { logError } from './crashLogger';
import { safeSetRaw } from '../utils/safeStorage';
import { checkGeofence } from './geofenceService';
import { runtimeManager } from '../core/runtime/AdaptiveRuntimeManager';
import { useUnifiedVehicleStore } from './vehicleDataLayer/UnifiedVehicleStore';
import { applyCompassSmoothing, computeBlendedHeading } from './gps/headingCore';
import { applySpeedFilters, computeSpeedDelta, computeCourseDelta, pickRawSpeed } from './gps/speedCore';
import type { PrevPosition } from './gps/speedCore';
import { isJumpInvalid, calculateFusionRamp, DR_THRESHOLD_MS, DR_MIN_SPEED_MS } from './gps/fusionCore';
import type { FusedPosition } from './gps/fusionCore';
import {
  isNativePlatform,
  shouldSaveLastKnown,
  shouldCheckGeofence,
  LAST_KNOWN_KEY,
  GPS_FIRST_FIX_MS,
} from './gps/gpsUtils';
import { getThermalLevel } from './thermalWatchdog';
import { subscribeOrientationAbsolute, subscribeOrientation } from './sensors';

// Capacitor global tip tanımı — (window as any) yerine
declare global {
  interface Window {
    Capacitor?: { isNativePlatform(): boolean };
  }
}

// GPSLocation tipi vehicleDataLayer/types.ts'te tanımlıdır.
import type { GPSLocation } from './vehicleDataLayer/types';
export type { GPSLocation } from './vehicleDataLayer/types';

interface GPSState {
  location: GPSLocation | null;
  heading: number | null;
  isTracking: boolean;
  error: string | null;
  /** True when GPS is intentionally skipped (web/browser environment) */
  unavailable: boolean;
  /** Aktif konum kaynağı — debug ve UI için */
  source: 'native' | 'web' | 'last_known' | 'default' | null;
}

const useGPSStore = create<GPSState>(() => ({
  location: null,
  heading: null,
  isTracking: false,
  error: null,
  unavailable: false,
  source: null,
}));

// DEV-only: GPS durum override — null = gerçek GPS aktif
let _gpsTestOverride: Partial<GPSState> | null = null;

// ── UnifiedVehicleStore mirror ──────────────────────────────────────────────
// useGPSStore değişimlerini UnifiedVehicleStore'a yansıt.
// Tüm setState çağrıları (handlePosition, DR, fallback) otomatik olarak
// UnifiedVehicleStore.updateGPSState'i tetikler — her çağrı noktası değiştirilmez.
useGPSStore.subscribe((state) => {
  // DEV: override varsa merge et; production'da _gpsTestOverride her zaman null
  const eff = (import.meta.env.DEV && _gpsTestOverride)
    ? { ...state, ..._gpsTestOverride }
    : state;
  useUnifiedVehicleStore.getState().updateGPSState({
    location:    eff.location,
    heading:     eff.heading,
    isTracking:  eff.isTracking,
    error:       eff.error,
    unavailable: eff.unavailable,
    source:      eff.source,
  });
});

let watchId: number | string | null = null;
let _lastPositionPerf = 0; // performance.now() — clock-jump immune throttle
// 200ms taban throttle — 1s GPS interval'de her fix'i işle
const POSITION_THROTTLE_BASE_MS = 200;

/* ── ÇİFT GPS ABONELİĞİ TEKİLLEŞTİRME (saha fix 2026-07-11, cihaz QA) ─────────
 * BULGU (`dumpsys location`, gerçek cihaz): uygulama AYNI ANDA iki yüksek-doğruluk
 * konum akışı tutuyordu:
 *   (1) WebView  → Capacitor `Geolocation.watchPosition({enableHighAccuracy:true})`
 *                  → GMS fused provider, HIGH_ACCURACY (8219 fix)
 *   (2) Native   → CarLauncherForegroundService `LocationManager.GPS_PROVIDER` 1 Hz
 *                  → `backgroundLocation` olayı → feedBackgroundLocation() → handlePosition()
 * İkisi de AYNI `handlePosition`'a akıyor. handlePosition'ın throttle'ı ikinciyi zaten
 * atıyordu → iş iki kez yapılmıyor AMA İŞLETİM SİSTEMİ İKİ AKIŞI DA BESLİYOR (pil/CPU),
 * üstelik iki kaynağın koordinatları birkaç metre farklı olduğundan `_prevForSpeed`
 * çapası kaynaklar arası karışıyor (park hâlinde "1 km/h" gürültüsünün kaynağı).
 *
 * ÇÖZÜM: TEK ABONELİK. Native besleme CANLI olduğu KANITLANINCA (yeterli sayıda taze
 * fix) Capacitor watch'ı BIRAK — native akış tek kaynak olsun. Native besleme kesilirse
 * (FGS öldü / GPS_PROVIDER kapalı / iç mekân) watch'ı GERİ AÇ (fail-soft, self-healing).
 * Davranış değişmez: handlePosition, store, tüketiciler aynı; yalnız fazla OS aboneliği
 * kalkar.
 */
const NATIVE_FEED_CONFIRM_FIXES = 8;      // native akışın "canlı" sayılması için gereken fix
const NATIVE_FEED_CONFIRM_MS    = 12_000; // ve bu kadar süredir kesintisiz beslemesi
const NATIVE_FEED_STALE_MS      = 10_000; // bu kadar fix gelmezse native akış ÖLÜ sayılır
const NATIVE_FEED_WATCHDOG_MS   = 5_000;  // ölülük kontrolü periyodu

let _nativeFeedCount     = 0;
// -1 = "henüz native fix gelmedi" (0 GEÇERLİ bir performance.now() değeridir → sentinel olamaz)
let _nativeFeedFirstPerf = -1;   // ilk native fix'in performance.now()'u
let _lastNativeFixPerf   = -1;   // son native fix
let _capacitorWatchSuspended = false;
let _nativeFeedWatchdog: ReturnType<typeof setInterval> | null = null;

// ── Termal-adaptif konum throttle ───────────────────────────────────────────
// L2 (≥55°C) ve üzerinde GPS işleme sıklığını 500ms'ye düşür → her fix'te yapılan
// jump-guard / heading-blend / geofence / store-emit yükü yarıdan aza iner (CPU/ısı).
// Navigasyon yine 2 Hz'in altına inmez (L0/L1'de 200ms = 5 Hz taban korunur).
function _positionThrottleMs(): number {
  return getThermalLevel() >= 2 ? 500 : POSITION_THROTTLE_BASE_MS;
}

// ── Navigasyon GPS taban aralığı ─────────────────────────────
// RuntimeEngine SAFE_MODE (5s) / POWER_SAVE (8s) / BASIC_JS (2s) modlarında
// GPS interval'i çok uzar → hız göstergesi 2-8s'de bir güncellenir.
// Araç uygulamasında navigasyon her zaman en az 1 Hz GPS gerektirir.
// Bu taban değer tüm modlar için zorunlu alt sınırdır.
const GPS_NAV_MAX_INTERVAL_MS = 500; // 2 Hz — Google Maps seviyesi (500ms)

// ── Adaptive Runtime GPS interval ────────────────────────────
// RuntimeEngine mod değişiminde gpsUpdateMs güncellenir.
// Yeni değer startGPSTracking() sonraki çağrısında veya soft-restart'ta uygulanır.
let _gpsUpdateMs: number = Math.min(runtimeManager.getConfig().gpsUpdateMs, GPS_NAV_MAX_INTERVAL_MS);

/** runtimeManager değişince _gpsUpdateMs güncelle + gerekirse soft-restart */
const _unsubRuntimeGPS = runtimeManager.subscribe((_mode, config) => {
  const newMs = Math.min(config.gpsUpdateMs, GPS_NAV_MAX_INTERVAL_MS);
  if (newMs === _gpsUpdateMs) return;
  _gpsUpdateMs = newMs;

  // GPS aktif ise yeniden başlat — hem native (minimumUpdateInterval) hem
  // web (maximumAge) seçenekleri yeni config değeriyle kurulur.
  if (watchId !== null) {
    void stopGPSTracking().then(() => startGPSTracking()).catch((e: unknown) => {
      logError('GPS:RuntimeRestart', e);
    });
  }
});

// Geofence throttle state
let _lastGeofenceCheckTime = 0;
let _lastGeofenceCheckPos: { lat: number; lng: number } | null = null;

// ── GPS Fusion Smoothing: tünel çıkışı stabilizasyonu ─────────────────────
let _transitionStartPerf: number | null = null;
let _drLastPos: FusedPosition | null = null;

// Auto-reconnect on consecutive errors
let _consecutiveErrors = 0;
let _reconnectTimer:    ReturnType<typeof setTimeout> | null = null;
const MAX_GPS_ERRORS   = 3;
const GPS_RECONNECT_MS = 8000;

// ── Son bilinen konum (localStorage) ─────────────────────
let _lastSavePerf = 0;

function _saveLastKnown(loc: GPSLocation): void {
  const now = performance.now();
  if (!shouldSaveLastKnown(_lastSavePerf, now)) return;
  _lastSavePerf = now;
  safeSetRaw(LAST_KNOWN_KEY, JSON.stringify({ lat: loc.latitude, lng: loc.longitude }));
}

// ── İlk fix fallback ─────────────────────────────────────
let _firstFixTimer: ReturnType<typeof setTimeout> | null = null;
/** Zero-Leak: başarılı GPS fix geldiyse true — fallback timer callback'u bunu kontrol eder */
let _hasValidFirstFix = false;

function _clearFirstFixTimer(): void {
  if (_firstFixTimer) { clearTimeout(_firstFixTimer); _firstFixTimer = null; }
}

function _startFirstFixFallback(): void {
  _clearFirstFixTimer();
  _hasValidFirstFix = false;
  _firstFixTimer = setTimeout(() => {
    _firstFixTimer = null;
    // Zero-Leak: throttle-blocked warm start fix geldiyse fallback atla
    if (_hasValidFirstFix) return;
    // Gerçek GPS fix zaten geldiyse dokunma
    const src = useGPSStore.getState().source;
    if (src === 'native' || src === 'web') return;
    // location is intentionally NOT set — fallback/last_known coords must never
    // enter navigation state. Route fetch, origin, and geometry guards all rely
    // on location===null to block invalid routing.
    console.warn('[GPS] no real fix after timeout — location stays null, GPS state marked unavailable');
    useGPSStore.setState({
      location:   null,
      error:      'GPS alınamadı — Sinyal bekleniyor',
      isTracking: false,
      source:     null,
    });
  }, GPS_FIRST_FIX_MS);
}

// ── Heading blend: GPS course + compass ──────────────────────
//
// Strateji:
//   < 3 km/h  → %100 pusula   (GPS course güvenilmez: Geolocation spec → null/NaN)
//   > 10 km/h → %100 GPS course (GPS bearing doğru, araç yönünü yansıtır)
//   3–10 km/h → kademeli lerp  (yumuşak geçiş, sürücüyü rahatsız etmez)
//
// Angle lerp: shortest-arc (350°/10° wraparound güvenli)
// Output: exponential low-pass filter (GPS sıçramalarını bastırır)

let _compassHeading:     number | null = null;
let _smoothedHeading:    number | null = null;
let _compassListenerOn   = false;
// Orientation Sensor Gate release fonksiyonları (ham window aboneliği yerine).
let _compassAbsRelease:  (() => void) | null = null;
let _compassRelRelease:  (() => void) | null = null;

// Compass throttle: 60Hz → 10Hz (100ms) — pil tasarrufu
let _compassLastMs = 0;
const COMPASS_THROTTLE_MS = 100;

function _onDeviceOrientation(e: DeviceOrientationEvent): void {
  const now = performance.now();
  if (now - _compassLastMs < COMPASS_THROTTLE_MS) return;
  _compassLastMs = now;

  let deg: number | null = null;
  const ev = e as DeviceOrientationEvent & { webkitCompassHeading?: number };

  if (typeof ev.webkitCompassHeading === 'number' && Number.isFinite(ev.webkitCompassHeading)) {
    deg = ev.webkitCompassHeading;
  } else if (e.absolute && e.alpha !== null && Number.isFinite(e.alpha)) {
    deg = (360 - e.alpha) % 360;
  } else {
    return;
  }

  _compassHeading = applyCompassSmoothing(_compassHeading, deg);
}

function _startCompassListener(): void {
  if (_compassListenerOn) return;
  _compassListenerOn = true;
  // Ham window aboneliği yerine merkezi Orientation Sensor Gate: gate aynı ham
  // event için tek fiziksel listener paylaştırır ve arka planda (visibility
  // hidden) fiziksel listener'ı kendisi söker → gereksiz background sensör yükü
  // kalkar. Mevcut JS throttle (_onDeviceOrientation içinde) ve heading davranışı
  // KORUNUR. NOT: bu PR compass'ı Settings ekranında kapatmaz (foreground
  // demand-gating tüketici sinyali gerektirir — bkz. PR notu).
  _compassAbsRelease = subscribeOrientationAbsolute(_onDeviceOrientation);
  _compassRelRelease = subscribeOrientation(_onDeviceOrientation);
}

function _stopCompassListener(): void {
  if (!_compassListenerOn) return;
  _compassListenerOn = false;
  if (_compassAbsRelease) { _compassAbsRelease(); _compassAbsRelease = null; }
  if (_compassRelRelease) { _compassRelRelease(); _compassRelRelease = null; }
  _compassHeading  = null;
  _smoothedHeading = null;
}

function _blendHeading(gpsBearing: number | null, speedMs: number): number | null {
  const result = computeBlendedHeading(gpsBearing, speedMs, _compassHeading, _smoothedHeading);
  _smoothedHeading = result.nextSmoothed;
  return result.heading;
}

// ── Speed from position delta ─────────────────────────────
let _prevForSpeed: PrevPosition | null = null;

function _scheduleGPSReconnect(): void {
  if (_reconnectTimer) return;
  _reconnectTimer = setTimeout(async () => {
    _reconnectTimer    = null;
    _consecutiveErrors = 0;
    // Full restart: clear old watch, then reattach
    try {
      await stopGPSTracking();
      await startGPSTracking();
    } catch (e) {
      logError('GPS:Reconnect', e);
    }
  }, GPS_RECONNECT_MS);
}

/**
 * Start GPS tracking using the appropriate platform API.
 * Sıra: Native Capacitor → Web navigator.geolocation → 5s sonra last-known / Türkiye default
 */
export async function startGPSTracking(): Promise<void> {
  if (watchId != null) return;

  // 5 saniye içinde gerçek fix gelmezse fallback devreye girer
  _startFirstFixFallback();
  _startCompassListener();

  if (isNativePlatform()) {
    await startNativeGPSTracking();
  } else {
    // Web/browser ortamı: navigator.geolocation ile dene
    if (navigator.geolocation) {
      startWebGPSTracking();
    } else {
      useGPSStore.setState({ unavailable: true, source: null });
    }
  }
}

/**
 * Native (Capacitor) GPS tracking
 */
async function startNativeGPSTracking(): Promise<void> {
  try {
    const { Geolocation } = await import('@capacitor/geolocation');

    // Check/request permissions — timeout ile sarılı (eski cihazlarda sonsuz beklemeyi önler)
    const GPS_PERMISSION_TIMEOUT_MS = 12000;
    const withTimeout = <T>(promise: Promise<T>): Promise<T | null> =>
      Promise.race([
        promise,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), GPS_PERMISSION_TIMEOUT_MS)),
      ]);

    try {
      const perms = await withTimeout(Geolocation.checkPermissions());
      if (perms === null) {
        // Timeout — permission API yanıt vermedi, yine de devam et
      } else if (perms.location !== 'granted') {
        const req = await withTimeout(Geolocation.requestPermissions());
        if (req !== null && req.location !== 'granted' && req.location !== 'prompt') {
          // İzin kesin olarak reddedildi — kullanıcı "bir daha sorma" seçti.
          // Web geolocation fallback'i ÇAĞIRMA: native platform'da navigator.geolocation
          // desteklenmeyebilir ve farklı bir hata mesajı yazarak gerçek nedeni gizler.
          useGPSStore.setState({ error: 'GPS permission denied', isTracking: false, unavailable: true });
          return;
        }
      }
    } catch {
      // Permission API may not be available on some devices/versions, proceed anyway
    }

    // Warm start: immediate fix before watchPosition fires (reduces GPS cold-start delay)
    try {
      const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 10000 });
      if (pos?.coords) handlePosition(pos.coords, pos.timestamp);
    } catch { /* watchPosition will handle it */ }

    watchId = await Geolocation.watchPosition(
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: Math.min(_gpsUpdateMs, 500), // en az 500ms taze veri
        // Android: FusedLocationProvider update interval (ms) — RuntimeEngine'den gelir
        // PERFORMANCE: 500ms | BALANCED: 1000ms | BASIC_JS: 2000ms | SAFE_MODE: 5000ms
        ...({ minimumUpdateInterval: _gpsUpdateMs } as object),
      } as Parameters<typeof Geolocation.watchPosition>[0],
      (position, err) => {
        if (err) {
          _consecutiveErrors++;
          useGPSStore.setState({ error: err.message });
          logError('GPS', err);
          if (_consecutiveErrors >= MAX_GPS_ERRORS) {
            _scheduleGPSReconnect();
          }
          return;
        }

        if (position) {
          handlePosition(position.coords, position.timestamp);
        }
      }
    );
  } catch (err) {
    logError('GPS:NativeFallback', err);
    watchId = null; // ensure clean state before web fallback
    startWebGPSTracking();
  }
}

/* ── Tek-abonelik yöneticisi ───────────────────────────────────────────────── */

/** Native besleme sayaçlarını sıfırla (stop / yeniden başlat). */
function _resetNativeFeedState(): void {
  _nativeFeedCount     = 0;
  _nativeFeedFirstPerf = -1;
  _lastNativeFixPerf   = -1;
  _capacitorWatchSuspended = false;
  if (_nativeFeedWatchdog) { clearInterval(_nativeFeedWatchdog); _nativeFeedWatchdog = null; }
}

/** Capacitor watch'ı bırak (native akış tek kaynak olur). Fail-soft: hata yutulur. */
async function _suspendCapacitorWatch(): Promise<void> {
  if (watchId == null) return;
  const id = watchId;
  watchId = null;                 // önce state → yarış koşulunda çift clearWatch olmasın
  _capacitorWatchSuspended = true;
  try {
    const { Geolocation } = await import('@capacitor/geolocation');
    await Geolocation.clearWatch({ id: String(id) });
  } catch (e) {
    logError('GPS:SuspendWatch', e);
  }
}

/** Native akış öldüyse Capacitor watch'ı geri aç (self-healing). */
async function _resumeCapacitorWatch(): Promise<void> {
  if (!_capacitorWatchSuspended || watchId != null) return;
  _capacitorWatchSuspended = false;
  _nativeFeedCount     = 0;      // yeniden kanıt iste (flapping'i engeller)
  _nativeFeedFirstPerf = -1;
  try {
    await startNativeGPSTracking();
  } catch (e) {
    logError('GPS:ResumeWatch', e);
  }
}

/** Native besleme ölülük gözcüsü — yalnız watch askıdayken çalışır (zero-leak). */
function _startNativeFeedWatchdog(): void {
  if (_nativeFeedWatchdog) return;
  _nativeFeedWatchdog = setInterval(() => {
    if (!_capacitorWatchSuspended) {
      if (_nativeFeedWatchdog) { clearInterval(_nativeFeedWatchdog); _nativeFeedWatchdog = null; }
      return;
    }
    if (performance.now() - _lastNativeFixPerf > NATIVE_FEED_STALE_MS) {
      // Native akış kesildi (FGS öldü / GPS_PROVIDER kapandı / iç mekân) → geri dön.
      if (_nativeFeedWatchdog) { clearInterval(_nativeFeedWatchdog); _nativeFeedWatchdog = null; }
      void _resumeCapacitorWatch();
    }
  }, NATIVE_FEED_WATCHDOG_MS);
}

/**
 * Native besleme "canlı" kanıtlandıysa fazla Capacitor aboneliğini bırak.
 * Kanıt ölçütü: ≥NATIVE_FEED_CONFIRM_FIXES fix VE ≥NATIVE_FEED_CONFIRM_MS süredir akıyor.
 */
function _maybeSuspendCapacitorWatch(): void {
  if (!isNativePlatform()) return;          // web'de native besleme yok
  if (_capacitorWatchSuspended) return;
  if (watchId == null) return;              // zaten watch yok
  if (_nativeFeedCount < NATIVE_FEED_CONFIRM_FIXES) return;
  if (_nativeFeedFirstPerf < 0) return;
  if (performance.now() - _nativeFeedFirstPerf < NATIVE_FEED_CONFIRM_MS) return;

  void _suspendCapacitorWatch().then(() => {
    _startNativeFeedWatchdog();
  });
}

/**
 * Web (browser navigator.geolocation) GPS tracking
 */
function startWebGPSTracking(): void {
  if (watchId != null) return; // already tracking
  if (!navigator.geolocation) {
    useGPSStore.setState({ error: 'Geolocation not supported' });
    return;
  }

  try {
    const id = navigator.geolocation.watchPosition(
      (position) => {
        handlePosition(position.coords, position.timestamp);
      },
      (err) => {
        _consecutiveErrors++;
        useGPSStore.setState({ error: err.message });
        logError('GPS:Web', err);
        if (_consecutiveErrors >= MAX_GPS_ERRORS) {
          _scheduleGPSReconnect();
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        // RuntimeEngine config'e bağlı — SAFE_MODE'da 5s, PERFORMANCE'ta 500ms
        maximumAge: _gpsUpdateMs,
      }
    );
    watchId = id;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'GPS error';
    useGPSStore.setState({ error: msg });
  }
}

/**
 * Common handler for position updates from either platform
 */
interface CoordsLike {
  latitude: number;
  longitude: number;
  accuracy: number;
  altitude: number | null;
  altitudeAccuracy?: number | null;
  heading: number | null;
  speed: number | null;
}

function handlePosition(coords: CoordsLike, timestamp: number): void {
  const now     = Date.now();
  const perfNow = performance.now();
  if (perfNow - _lastPositionPerf < _positionThrottleMs()) return;

  if (!isFinite(coords.latitude) || !isFinite(coords.longitude)) {
    logError('GPS', new Error(`Invalid coords: ${coords.latitude},${coords.longitude}`));
    return;
  }

  // Valid coords arrived — cancel fallback timer immediately, before accuracy check
  _hasValidFirstFix = true;
  _clearFirstFixTimer();

  _lastPositionPerf  = perfNow;
  _consecutiveErrors = 0;

  // ── Jump Guard: tünel çıkışı gürültülü ilk fix koruması ─────────────────
  const _drActiveNow = isDeadReckoningActive();
  const _prevLoc     = useGPSStore.getState().location;
  if (_prevLoc && isJumpInvalid(_prevLoc, coords)) {
    console.warn(`[GPS] JumpGuard: atlama reddedildi (accuracy:${coords.accuracy.toFixed(0)}m)`);
    return;
  }

  // ── Fusion Ramp başlatıcı: DR aktifken gelen ilk gerçek GPS fix'i ─────────
  // DR true→false geçişi bu noktada yakalanır; 3s blend başlatılır
  if (_drActiveNow && _prevLoc) {
    _transitionStartPerf = performance.now();
    _drLastPos = { lat: _prevLoc.latitude, lng: _prevLoc.longitude };
  }

  // GPS speed yoksa VEYA 0'a saplanmışsa pozisyon delta'sından hesapla.
  // SAHA FIX (2026-07-04): bazı cihazlar hareket halinde coords.speed=0 bildirir;
  // 0 finite olduğundan eski `??` fallback'i hiç çalışmıyordu → hız 0 → sürüş
  // görünümü/kamera takibi/rAF uyandırma ölü ("harita ters gidiyor, takip etmiyor").
  const gpsSpeed = Number.isFinite(coords.speed ?? NaN) ? (coords.speed ?? undefined) : undefined;
  const prevPos  = _prevForSpeed;
  // Delta çapası yalnız ≥500ms'de bir ilerler: 5Hz fix akışında dt=0.2s kalıp hem
  // computeSpeedDelta (dt<0.5 guard) hem computeCourseDelta (4m eşik) hiç üretemiyordu.
  const _fixTs = timestamp ?? now;
  if (!prevPos || _fixTs - prevPos.ts >= 500) {
    _prevForSpeed = { lat: coords.latitude, lng: coords.longitude, ts: _fixTs };
  }
  const deltaSpeed = computeSpeedDelta(coords.latitude, coords.longitude, _fixTs, prevPos);
  const rawSpeed   = pickRawSpeed(gpsSpeed, deltaSpeed);

  const dataAge     = Math.abs(now - (timestamp ?? now));
  const filteredSpeed = rawSpeed != null ? applySpeedFilters(rawSpeed, dataAge) : undefined;

  // GPS course: Geolocation spec → null/NaN when stationary; safe-guard before blend
  const gpsCourse = Number.isFinite(coords.heading ?? NaN) ? (coords.heading ?? null) : null;
  // SAHA FIX: GPS bearing yoksa konum farkından "course over ground" hesapla.
  // Head unit'lerde manyetometre (pusula) yoktur ve çoğu GPS modülü heading vermez →
  // bu fallback olmadan yön null kalır, FullMapView'da `heading ?? 0` ile KUZEY'e
  // kilitlenir ve harita gidiş yönünden bağımsız döner ("harita ters dönüyor").
  const effectiveCourse = gpsCourse ?? computeCourseDelta(coords.latitude, coords.longitude, prevPos);
  // Heading blend: filteredSpeed kullan — ham gürültü pusula/GPS ağırlık hesabını bozmasın
  const heading   = _blendHeading(effectiveCourse, filteredSpeed ?? 0);

  // ── Fusion Ramp: DR→GPS weighted blend (3 saniyelik yumuşak geçiş) ────────
  let _fusedLat = coords.latitude;
  let _fusedLng = coords.longitude;
  if (_transitionStartPerf !== null && _drLastPos !== null) {
    const fused = calculateFusionRamp(performance.now() - _transitionStartPerf, _drLastPos, coords);
    if (fused !== null) {
      _fusedLat = fused.lat;
      _fusedLng = fused.lng;
    } else {
      _transitionStartPerf = null;
      _drLastPos           = null;
    }
  }

  const loc: GPSLocation = {
    latitude:  _fusedLat,
    longitude: _fusedLng,
    accuracy:  Number.isFinite(coords.accuracy) ? coords.accuracy : 999,
    altitude:  coords.altitude ?? undefined,
    heading:   heading ?? undefined,
    speed:     filteredSpeed, // ← filtreli hız (deadzone + EMA)
    timestamp,
  };

  // ── Geofence 2.0 Kontrolü (Performans Throttling) ────
  const currentPos = { lat: loc.latitude, lng: loc.longitude };
  if (shouldCheckGeofence(_lastGeofenceCheckPos, currentPos, _lastGeofenceCheckTime, now)) {
    _lastGeofenceCheckTime = now;
    _lastGeofenceCheckPos  = currentPos;
    if (filteredSpeed != null) {
      checkGeofence(loc.latitude, loc.longitude, filteredSpeed * 3.6);
    }
  }

  _saveLastKnown(loc);

  const source: GPSState['source'] = isNativePlatform() ? 'native' : 'web';

  useGPSStore.setState({
    location:   loc,
    heading,
    isTracking: true,
    error:      null,
    source,
  });
}

export async function stopGPSTracking(): Promise<void> {
  // Cancel any pending reconnect so it doesn't fire after stop
  if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null; }
  _clearFirstFixTimer();
  _hasValidFirstFix = false;
  _stopCompassListener();
  _prevForSpeed             = null;
  _smoothedHeading          = null;
  _consecutiveErrors        = 0;
  _transitionStartPerf      = null;
  _drLastPos                = null;
  _lastPositionPerf         = 0; // reset throttle — next position always accepted after restart
  _lastGeofenceCheckTime    = 0; // geofence throttle sıfırla
  _lastGeofenceCheckPos     = null;
  // Tek-abonelik durumu + gözcü timer'ı (zero-leak): watch askıdayken stop çağrılırsa
  // interval arkada kalmamalı.
  _resetNativeFeedState();

  if (watchId == null) {
    useGPSStore.setState({ isTracking: false, location: null, error: null });
    return;
  }

  try {
    if (isNativePlatform()) {
      const { Geolocation } = await import('@capacitor/geolocation');
      await Geolocation.clearWatch({ id: String(watchId) });
    } else {
      navigator.geolocation.clearWatch(Number(watchId));
    }
  } catch {
    // Ignore cleanup errors
  }

  watchId = null;
  useGPSStore.setState({ isTracking: false, location: null, error: null });
}

/**
 * Non-React / test-friendly snapshot of the current GPS state.
 */
export function getGPSState(): GPSState {
  const s = useUnifiedVehicleStore.getState();
  return {
    location:    s.location,
    heading:     s.heading,
    isTracking:  s.gpsTracking,
    error:       s.gpsError,
    unavailable: s.gpsUnavailable,
    source:      s.gpsSource,
  };
}

// ── React hooks — UnifiedVehicleStore'dan okur (tek kaynak) ─────────────────

export function useGPSLocation() {
  return useUnifiedVehicleStore((s) => s.location);
}

export function useGPSHeading() {
  return useUnifiedVehicleStore((s) => s.heading);
}

/**
 * Backward-compat shape: { location, heading, isTracking, error, unavailable, source }
 *
 * Her alan ayrı sabit selector ile okunur.
 * Inline obje `(s) => ({ ... })` React 19 useSyncExternalStore tutarlılık
 * kontrolünde her render'da farklı referans döndürdüğünden #185 hatasına
 * (Cannot update while rendering) neden oluyordu.
 */
export function useGPSState(): GPSState {
  const location    = useUnifiedVehicleStore((s) => s.location);
  const heading     = useUnifiedVehicleStore((s) => s.heading);
  const isTracking  = useUnifiedVehicleStore((s) => s.gpsTracking);
  const error       = useUnifiedVehicleStore((s) => s.gpsError);
  const unavailable = useUnifiedVehicleStore((s) => s.gpsUnavailable);
  const source      = useUnifiedVehicleStore((s) => s.gpsSource);
  return { location, heading, isTracking, error, unavailable, source };
}

export function useGPSAvailable() {
  return useUnifiedVehicleStore((s) => !s.gpsUnavailable);
}

/** Debug: aktif GPS kaynak bilgisi */
export function useGPSSource() {
  return useUnifiedVehicleStore((s) => s.gpsSource);
}

/**
 * UnifiedVehicleStore tek yetkili hız kaynağı olduğundan parametre kullanılmaz.
 * İmza korundu — mevcut bileşenler derlemek için tekrar yazılmak zorunda kalmaz.
 */
export function resolveSpeedKmh(
  _gps: GPSLocation | null,
  obdSpeedKmh: number,
  _maxAgeMs = 4000,
): number {
  return useUnifiedVehicleStore.getState().speed ?? obdSpeedKmh;
}

/** Mevcut GPS hızını km/h olarak döner; yoksa null. */
export function getGPSSpeedKmh(): number | null {
  const loc = useUnifiedVehicleStore.getState().location;
  if (!loc?.speed || !Number.isFinite(loc.speed) || loc.speed <= 0) return null;
  return loc.speed * 3.6;
}

/* ── DEV: Fault injection hook ───────────────────────────────────── */

/**
 * GPS durumunun üzerine test değerleri yaz (DEV only).
 * `null` geçmek override'ı kaldırır ve gerçek GPS'e döner.
 *
 * Production APK'da no-op — import.meta.env.DEV tree-shaking ile elenir.
 */
export function setGPSTestOverride(data: Partial<GPSState> | null): void {
  if (!import.meta.env.DEV) return;
  _gpsTestOverride = data;
  // Mevcut GPS store'una override uygulayarak anında emit et
  const current = useGPSStore.getState();
  const eff     = data ? { ...current, ...data } : current;
  useUnifiedVehicleStore.getState().updateGPSState({
    location:    eff.location,
    heading:     eff.heading,
    isTracking:  eff.isTracking,
    error:       eff.error,
    unavailable: eff.unavailable,
    source:      eff.source,
  });
}

/**
 * Non-React GPS konum aboneliği — speedFusion gibi modül-düzey servisler için.
 * Konum nesnesi referans olarak değiştiğinde çağrılır (her GPS tick'inde).
 * Cleanup fonksiyonu döner.
 */
export function onGPSLocation(fn: (loc: GPSLocation | null) => void): () => void {
  let prevLoc = useUnifiedVehicleStore.getState().location;
  fn(prevLoc); // anlık senkronizasyon
  const unsub = useUnifiedVehicleStore.subscribe((state) => {
    if (state.location !== prevLoc) {
      prevLoc = state.location;
      fn(state.location);
    }
  });
  return unsub;
}

/**
 * Arka plan GPS servisinden gelen konum verisini store'a besle.
 * CarLauncherForegroundService → CarLauncherPlugin → backgroundLocation event → buraya.
 * Capacitor Geolocation minimize olunca dursa bile GPS takibi sürekliliği sağlanır.
 */
export function feedBackgroundLocation(data: {
  lat:      number;
  lng:      number;
  speed:    number;
  bearing:  number;
  accuracy: number;
}): void {
  // Guard against null/undefined data from native background service
  if (!data) return;
  // Guard against malformed data from native background service
  if (!Number.isFinite(data.lat) || !Number.isFinite(data.lng)) {
    logError('GPS:Background', new Error(`Invalid coords: ${data.lat},${data.lng}`));
    return;
  }
  // Range validation: GPS coordinates must be within valid ranges
  if (data.lat > 90 || data.lat < -90 || data.lng > 180 || data.lng < -180) {
    logError('GPS:Background', new Error(`Out-of-range coords: ${data.lat},${data.lng}`));
    return;
  }
  // ── Tek-abonelik kanıtı: native akış canlı mı? ──────────────────────────
  // Bu sayaçlar SADECE gerçek (doğrulanmış) native fix'lerle ilerler. Yeterli
  // kanıt birikince fazla Capacitor watch'ı bırakılır (bkz. _maybeSuspendCapacitorWatch).
  const _perfNow = performance.now();
  if (_nativeFeedFirstPerf < 0) _nativeFeedFirstPerf = _perfNow;
  _lastNativeFixPerf = _perfNow;
  _nativeFeedCount++;
  _maybeSuspendCapacitorWatch();

  handlePosition(
    {
      latitude:  data.lat,
      longitude: data.lng,
      accuracy:  data.accuracy,
      altitude:  null,
      heading:   data.bearing,
      speed:     data.speed / 3.6, // km/h → m/s (GPS API standardı)
    },
    Date.now(),
  );
}

/* ── Dead Reckoning (Tünel Modu) ─────────────────────────────────────
 *
 * GPS sinyali koptuğunda (örn. tünel, otopark), son bilinen hız ve yön
 * kullanılarak konum tahmini yapılır.
 *
 * Fizik: düz hat projeksiyon (küçük mesafeler için geçerli)
 *   Δlat = (speed_ms * cos(bearing_rad) * Δt) / 111320
 *   Δlng = (speed_ms * sin(bearing_rad) * Δt) / (111320 * cos(lat_rad))
 *
 * Kısıtlar:
 *   - Yalnızca speed ≥ 2 km/h iken aktif (durakta drift yok)
 *   - Max DR_MAX_DURATION_MS (45s) sonra devre dışı kalır
 *   - GPS yeniden gelince anında durur
 *   - Histerezis: DR_THRESHOLD_MS (2s) GPS sessizliği gerekir
 */


interface DeadReckoningState {
  active:         boolean;
  lat:            number;
  lng:            number;
  speedMs:        number;
  bearingDeg:     number;
  startedAt:      number;
  lastProjectedAt: number;
}

let _dr: DeadReckoningState | null    = null;
let _drTimer: ReturnType<typeof setInterval> | null = null;
let _lastGPSPerf = 0; // performance.now() — clock-jump immune
let _drLocUnsub: (() => void) | null = null;
// Tüm DR guard cleanup (silenceChecker + _drLocUnsub) — HMR ve çoklu çağrı koruması
let _drGuardCleanup: (() => void) | null = null;

function _stopDeadReckoning(): void {
  if (_drTimer !== null) { clearInterval(_drTimer); _drTimer = null; }
  if (_dr) _dr.active = false;
}

function _startDeadReckoning(): void {
  // DR Centralization (Packet 4 Hardening): yerel konum projeksiyonu devre dışı.
  // Tüm sistem VehicleCompute.worker.ts'den gelen füzyonlanmış konumu tüketir.
  // startDeadReckoningGuard() GPS sessizliğini izlemeye devam eder; ancak
  // bu fonksiyon hiçbir zaman setInterval başlatmaz → isDeadReckoningActive() = false.
}

/**
 * GPS sessizliği izleme — startGPSTracking() başladıktan sonra çağrılır.
 *
 * GPS konumu değiştiğinde:
 *   - _lastGPSMs güncellenir
 *   - DR aktifse durdurulur (GPS geri geldi)
 *   - Son bilinen hız/yön saklanır (DR için)
 *
 * Periyodik kontrol: GPS_THRESHOLD_MS sessizliği varsa DR başlatılır.
 * Cleanup fonksiyonu döner — tüm listener + interval cleanup edilir.
 */
export function startDeadReckoningGuard(): () => void {
  // Önceki guard varsa temizle — çoklu çağrı koruması (silenceChecker sızıntısı önlenir)
  _drGuardCleanup?.();
  _drGuardCleanup = null;

  // GPS location store'u izle
  let _prevLoc = useGPSStore.getState().location;
  _lastGPSPerf  = performance.now();

  _drLocUnsub = useGPSStore.subscribe((state) => {
    const loc = state.location;
    if (!loc || loc === _prevLoc) return;
    _prevLoc     = loc;
    _lastGPSPerf = performance.now();

    if (_dr?.active) {
      // GPS geri geldi → DR durdur
      _stopDeadReckoning();
    }

    // Son bilinen hız/yönü güncelle
    if ((loc.speed ?? 0) >= DR_MIN_SPEED_MS) {
      _dr = {
        active:          false,
        lat:             loc.latitude,
        lng:             loc.longitude,
        speedMs:         loc.speed ?? 0,
        bearingDeg:      loc.heading ?? 0,
        startedAt:       0,
        lastProjectedAt: Date.now(),
      };
    }
  });

  // Sessizlik kontrolü: DR_THRESHOLD_MS suskunluk → DR başlat
  const silenceChecker = setInterval(() => {
    const silentMs = performance.now() - _lastGPSPerf;
    const { isTracking } = useGPSStore.getState();

    if (!isTracking || !_dr || _dr.active) return;
    if (silentMs >= DR_THRESHOLD_MS) {
      _startDeadReckoning();
    }
  }, DR_THRESHOLD_MS);

  const cleanup = () => {
    clearInterval(silenceChecker);
    _drLocUnsub?.();
    _drLocUnsub = null;
    _stopDeadReckoning();
    if (_drGuardCleanup === cleanup) _drGuardCleanup = null; // dangle ref temizle
  };
  _drGuardCleanup = cleanup;
  return cleanup;
}

/**
 * Dead Reckoning'in aktif olup olmadığını döndür.
 * NavigationHUD bu flag ile "Tünel modu" göstergesi açabilir.
 */
export function isDeadReckoningActive(): boolean {
  return _dr?.active === true;
}

/* ── HMR cleanup — dev modda Hot Reload'da watchId sızıntısını önle ─ */
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    stopGPSTracking().catch(() => undefined);
    _unsubRuntimeGPS();       // runtime listener temizle — Zero-Leak
    // _drGuardCleanup: silenceChecker interval + _drLocUnsub + DR timer'ı birlikte temizler
    _drGuardCleanup?.();
    _drGuardCleanup = null;
  });
}
