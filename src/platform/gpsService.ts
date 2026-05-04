import { create } from 'zustand';
import { logError } from './crashLogger';
import { safeSetRaw } from '../utils/safeStorage';
import { checkGeofence } from './geofenceService';
import { runtimeManager } from '../core/runtime/AdaptiveRuntimeManager';
import { useUnifiedVehicleStore } from './vehicleDataLayer/UnifiedVehicleStore';

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

// ── UnifiedVehicleStore mirror ──────────────────────────────────────────────
// useGPSStore değişimlerini UnifiedVehicleStore'a yansıt.
// Tüm setState çağrıları (handlePosition, DR, fallback) otomatik olarak
// UnifiedVehicleStore.updateGPSState'i tetikler — her çağrı noktası değiştirilmez.
useGPSStore.subscribe((state) => {
  useUnifiedVehicleStore.getState().updateGPSState({
    location:    state.location,
    heading:     state.heading,
    isTracking:  state.isTracking,
    error:       state.error,
    unavailable: state.unavailable,
    source:      state.source,
  });
});

let watchId: number | string | null = null;
let _lastPositionPerf = 0; // performance.now() — clock-jump immune throttle
// 200ms throttle — 1s GPS interval'de her fix'i işle
const POSITION_THROTTLE_MS = 200;

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

// Geofence throttle: 5s veya 10m değişim
let _lastGeofenceCheckTime = 0;
let _lastGeofenceCheckPos: { lat: number; lng: number } | null = null;
const GEOFENCE_THROTTLE_MS = 5000;
const GEOFENCE_THROTTLE_METERS = 10;

// Auto-reconnect on consecutive errors
let _consecutiveErrors = 0;
let _reconnectTimer:    ReturnType<typeof setTimeout> | null = null;
const MAX_GPS_ERRORS   = 3;
const GPS_RECONNECT_MS = 8000;

// ── Son bilinen konum (localStorage) ─────────────────────
const LAST_KNOWN_KEY      = 'car-gps-last-known';
const SAVE_LAST_KNOWN_MS  = 5_000; // 2 Hz GPS → max 5s'de-bir yaz
let _lastSavePerf         = 0;

function _saveLastKnown(loc: GPSLocation): void {
  const now = performance.now();
  if (now - _lastSavePerf < SAVE_LAST_KNOWN_MS) return;
  _lastSavePerf = now;
  safeSetRaw(LAST_KNOWN_KEY, JSON.stringify({ lat: loc.latitude, lng: loc.longitude }));
}

// ── İlk fix fallback (5 saniye) ──────────────────────────
const GPS_FIRST_FIX_MS = 5000;
let _firstFixTimer: ReturnType<typeof setTimeout> | null = null;

function _clearFirstFixTimer(): void {
  if (_firstFixTimer) { clearTimeout(_firstFixTimer); _firstFixTimer = null; }
}

function _startFirstFixFallback(): void {
  _clearFirstFixTimer();
  _firstFixTimer = setTimeout(() => {
    _firstFixTimer = null;
    // Gerçek GPS fix zaten geldiyse dokunma
    if (useGPSStore.getState().source === 'native' || useGPSStore.getState().source === 'web') return;
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

const COMPASS_ONLY_KMH  = 3;
const GPS_ONLY_KMH      = 10;
const HEADING_SMOOTH_α  = 0.35; // yeni örneğin ağırlığı; 0.35 @2s tick = ~4 güncellemede %90
const COMPASS_SMOOTH_α  = 0.25; // pusula low-pass @60 Hz ≈ ~67 ms gecikme

let _compassHeading:     number | null = null;
let _smoothedHeading:    number | null = null;
let _compassListenerOn   = false;

/** 0–360° aralığında en kısa yayı kullanarak açı interpolasyonu */
function _lerpAngle(a: number, b: number, t: number): number {
  const diff = ((b - a + 540) % 360) - 180; // -180..+180
  return (a + diff * t + 360) % 360;
}

function _clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function _onDeviceOrientation(e: DeviceOrientationEvent): void {
  let deg: number | null = null;
  const ev = e as DeviceOrientationEvent & { webkitCompassHeading?: number };

  if (typeof ev.webkitCompassHeading === 'number' && Number.isFinite(ev.webkitCompassHeading)) {
    // iOS Safari: heading = webkitCompassHeading (clockwise from magnetic north)
    deg = ev.webkitCompassHeading;
  } else if (e.absolute && e.alpha !== null && Number.isFinite(e.alpha)) {
    // Android Chrome (deviceorientationabsolute): alpha = CCW from north → convert to CW
    deg = (360 - e.alpha) % 360;
  } else {
    return; // relative orientation — pusulaya güvenemeyiz
  }

  _compassHeading = _compassHeading === null
    ? deg
    : _lerpAngle(_compassHeading, deg, COMPASS_SMOOTH_α);
}

function _startCompassListener(): void {
  if (_compassListenerOn) return;
  _compassListenerOn = true;
  // deviceorientationabsolute: Android Chrome 65+ — manyetik kuzey referanslı
  window.addEventListener('deviceorientationabsolute', _onDeviceOrientation as EventListener);
  // Fallback: deviceorientation (iOS absolute=false için webkitCompassHeading kolundan okunur)
  window.addEventListener('deviceorientation', _onDeviceOrientation as EventListener);
}

function _stopCompassListener(): void {
  if (!_compassListenerOn) return;
  _compassListenerOn = false;
  window.removeEventListener('deviceorientationabsolute', _onDeviceOrientation as EventListener);
  window.removeEventListener('deviceorientation', _onDeviceOrientation as EventListener);
  _compassHeading  = null;
  _smoothedHeading = null;
}

/**
 * GPS course ve pusula başlığını hıza göre harmanlayıp tek heading döner.
 *
 * @param gpsBearing  coords.heading (GPS course, 0–360°) — null ise katkısı yok
 * @param speedMs     Anlık hız m/s
 * @returns           Smooth edilmiş blended heading veya null
 */
function _blendHeading(gpsBearing: number | null, speedMs: number): number | null {
  const speedKmh = speedMs * 3.6;
  const hasGPS   = gpsBearing !== null && Number.isFinite(gpsBearing);
  const hasCmps  = _compassHeading !== null;

  let raw: number | null = null;

  if (speedKmh <= COMPASS_ONLY_KMH) {
    raw = hasCmps ? _compassHeading : (hasGPS ? gpsBearing : null);
  } else if (speedKmh >= GPS_ONLY_KMH) {
    raw = hasGPS ? gpsBearing : (hasCmps ? _compassHeading : null);
  } else {
    const α = _clamp01((speedKmh - COMPASS_ONLY_KMH) / (GPS_ONLY_KMH - COMPASS_ONLY_KMH));
    if (hasGPS && hasCmps)      raw = _lerpAngle(_compassHeading!, gpsBearing!, α);
    else if (hasGPS)            raw = gpsBearing;
    else if (hasCmps)           raw = _compassHeading;
  }

  if (raw === null) return null;

  _smoothedHeading = _smoothedHeading === null
    ? raw
    : _lerpAngle(_smoothedHeading, raw, HEADING_SMOOTH_α);

  return Math.round(_smoothedHeading * 10) / 10; // 0.1° hassasiyet
}

// ── GPS hız filtresi ─────────────────────────────────────────
//
// GPS Doppler hız ölçümü (coords.speed) zaten donanım seviyesinde filtreli;
// yazılım EMA eklemek sadece gecikme yaratır. Örnek: α=0.40 @2s tick →
// araç 50 km/h'deyken ekranda ~32 görünür, durduğunda ~10s geç sıfırlanır.
//
// Çözüm: EMA yok. Sadece deadzone (durağan jitter bastırma).
//   < GPS_SPEED_DEADZONE_KMH → 0 (araç durmuş, GPS Doppler noise yok say)
//   Timestamp freshness: > GPS_SPEED_MAX_AGE_MS → speed undefined (stale fix)
//
/** Durağan araç jitter bastırma eşiği (km/h) — altındaki değerler 0 sayılır */
const GPS_SPEED_DEADZONE_KMH = 2.0;
/** Bu süreden eski GPS fix'inden gelen hız kabul edilmez */
const GPS_SPEED_MAX_AGE_MS   = 4000;
/** GPS Doppler spike / uydu lock jitter: bu değerin üstü fiziksel olarak imkansız */
const GPS_SPEED_MAX_KMH      = 280;

// ── Speed from position delta ─────────────────────────────
let _prevForSpeed: { lat: number; lng: number; ts: number } | null = null;

/** Haversine mesafesi (metre) — ekvatorden uzaklaşınca doğru sonuç verir */
function _haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R  = 6_371_000;
  const dL = ((lat2 - lat1) * Math.PI) / 180;
  const dG = ((lng2 - lng1) * Math.PI) / 180;
  const a  = Math.sin(dL / 2) ** 2 +
             Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
             Math.sin(dG / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function _calcSpeedFromDelta(lat: number, lng: number, ts: number): number | undefined {
  const prev = _prevForSpeed;
  _prevForSpeed = { lat, lng, ts };
  if (!prev) return undefined;
  const dt = (ts - prev.ts) / 1000; // seconds
  if (dt < 0.5 || dt > 10) return undefined;
  const distM = _haversineMeters(prev.lat, prev.lng, lat, lng);
  if (!Number.isFinite(distM)) return undefined;
  return distM / dt; // m/s
}

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
 * Detect if running on Capacitor native platform
 */
function isNativePlatform(): boolean {
  try {
    const cap = window.Capacitor;
    return typeof cap?.isNativePlatform === 'function' && cap.isNativePlatform();
  } catch {
    return false;
  }
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
  if (perfNow - _lastPositionPerf < POSITION_THROTTLE_MS) return;

  if (!isFinite(coords.latitude) || !isFinite(coords.longitude)) {
    logError('GPS', new Error(`Invalid coords: ${coords.latitude},${coords.longitude}`));
    return;
  }

  // Valid coords arrived — cancel fallback timer immediately, before accuracy check
  _clearFirstFixTimer();

  _lastPositionPerf  = perfNow;
  _consecutiveErrors = 0;

  const _src = isNativePlatform() ? 'native' : 'web';
  console.log(`[GPS] source:${_src} lat:${coords.latitude.toFixed(6)} lon:${coords.longitude.toFixed(6)} acc:${coords.accuracy?.toFixed(0)}m ts:${timestamp ?? now}`);
  console.log('[GPS]', { lat: coords.latitude, lon: coords.longitude, accuracy: coords.accuracy, source: _src });

  // GPS speed yoksa pozisyon delta'sından hesapla
  const gpsSpeed = Number.isFinite(coords.speed ?? NaN) ? (coords.speed ?? undefined) : undefined;
  const rawSpeed = gpsSpeed ?? _calcSpeedFromDelta(coords.latitude, coords.longitude, timestamp ?? now);

  // ── Hız filtresi: Sadece deadzone (EMA yok — gecikme kaynağıydı) ────
  // GPS Doppler speed donanım seviyesinde zaten doğru; EMA sadece gecikme ekler.
  // Deadzone: < 2 km/h → 0 (durağan araç jitter bastırma).
  // Timestamp freshness: > GPS_SPEED_MAX_AGE_MS → hız geçersiz say.
  let filteredSpeed: number | undefined;
  if (rawSpeed != null) {
    const dataAge = Math.abs(now - (timestamp ?? now));
    if (dataAge > GPS_SPEED_MAX_AGE_MS) {
      // Stale fix — pozisyonu güncelle ama hız verisini gösterme
      filteredSpeed = undefined;
    } else {
      const rawKmh  = rawSpeed * 3.6;
      if (rawKmh > GPS_SPEED_MAX_KMH) {
        // Fiziksel olarak imkansız hız — GPS uydu lock jitter veya antenna spike
        filteredSpeed = undefined;
      } else {
        // Deadzone: durağan araç jitter'ı bastır, ama 0'a HEMEN düş
        filteredSpeed = (rawKmh < GPS_SPEED_DEADZONE_KMH ? 0 : rawKmh) / 3.6;
      }
    }
  }

  // GPS course: Geolocation spec → null/NaN when stationary; safe-guard before blend
  const gpsCourse = Number.isFinite(coords.heading ?? NaN) ? (coords.heading ?? null) : null;
  // Heading blend: filteredSpeed kullan — ham gürültü pusula/GPS ağırlık hesabını bozmasın
  const heading   = _blendHeading(gpsCourse, filteredSpeed ?? 0);

  const loc: GPSLocation = {
    latitude:  coords.latitude,
    longitude: coords.longitude,
    accuracy:  Number.isFinite(coords.accuracy) ? coords.accuracy : 999,
    altitude:  coords.altitude ?? undefined,
    heading:   heading ?? undefined,
    speed:     filteredSpeed, // ← filtreli hız (deadzone + EMA)
    timestamp,
  };

  // ── Geofence 2.0 Kontrolü (Performans Throttling) ────
  const distChange = _lastGeofenceCheckPos
    ? _haversineMeters(_lastGeofenceCheckPos.lat, _lastGeofenceCheckPos.lng, loc.latitude, loc.longitude)
    : Infinity;
  const timeChange = now - _lastGeofenceCheckTime;

  if (timeChange >= GEOFENCE_THROTTLE_MS || distChange >= GEOFENCE_THROTTLE_METERS) {
    _lastGeofenceCheckTime = now;
    _lastGeofenceCheckPos = { lat: loc.latitude, lng: loc.longitude };

    // Hız geçerliyse (veya 0 ise) kontrolü tetikle
    if (filteredSpeed != null) {
      checkGeofence(loc.latitude, loc.longitude, filteredSpeed * 3.6);
    }
  }

  _saveLastKnown(loc);

  const source: GPSState['source'] = isNativePlatform() ? 'native' : 'web';

  console.log('[GPS_DECISION]', {
    lat:       coords.latitude,
    lon:       coords.longitude,
    accuracy:  coords.accuracy,
    ageMs:     Math.abs(now - (timestamp ?? now)),
    gpsSource: source,
    valid:     true,
    reason:    'handlePosition_accepted',
  });

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
  _stopCompassListener();
  _prevForSpeed             = null;
  _smoothedHeading          = null;
  _consecutiveErrors        = 0;
  _lastPositionPerf         = 0; // reset throttle — next position always accepted after restart
  _lastGeofenceCheckTime    = 0; // geofence throttle sıfırla
  _lastGeofenceCheckPos     = null;

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
  speed:    number;   // km/h (CarLauncherForegroundService'den geliyor)
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

const DR_THRESHOLD_MS   = 2_000;  // GPS'in kaç ms susması gerekiyor
const DR_TICK_MS        = 500;    // projeksiyon güncelleme aralığı
const DR_MAX_DURATION_MS = 45_000; // maksimum DR süresi
const DR_MIN_SPEED_MS   = 2 / 3.6; // 2 km/h (m/s)

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
  if (!_dr || _dr.active) return;
  if (_dr.speedMs < DR_MIN_SPEED_MS) return; // araç durmuşsa DR başlatma

  _dr.active    = true;
  _dr.startedAt       = performance.now();
  _dr.lastProjectedAt = performance.now();

  _drTimer = setInterval(() => {
    if (!_dr?.active) { _stopDeadReckoning(); return; }

    const nowPerf = performance.now();
    const nowMs   = Date.now();
    const elapsed = nowPerf - _dr.startedAt;

    if (elapsed > DR_MAX_DURATION_MS) { _stopDeadReckoning(); return; }

    // ── Dynamic speed: OBD/fused speed keeps projection accurate in tunnel ─
    // DR init zamanındaki donmuş GPS hızı yerine canlı UnifiedVehicleStore hızı
    // kullanılır — OBD tünelde hala veri verir, GPS vermez.
    const { speed: liveSpeedMs } = useUnifiedVehicleStore.getState();
    const currentSpeedMs = liveSpeedMs ?? _dr.speedMs;

    // Ghost movement guard: araç durmuşsa DR anında durdur, konum kaydırma
    if (currentSpeedMs < DR_MIN_SPEED_MS) { _stopDeadReckoning(); return; }

    // ── Heading: compass tünelde çalışmaya devam eder ─────────────────────
    // GPS course (coords.heading) sinyal kopunca null olur; pusula manyetik
    // kuzeyi ölçmeye devam eder ve tünel içi dönüşleri doğru yansıtır.
    if (_compassHeading !== null) _dr.bearingDeg = _compassHeading;

    const Δt  = (nowPerf - _dr.lastProjectedAt) / 1000; // clock-jump immune
    _dr.lastProjectedAt = nowPerf;

    const rad    = (_dr.bearingDeg * Math.PI) / 180;
    const cosLat = Math.cos((_dr.lat  * Math.PI) / 180);

    const deltaLat = (currentSpeedMs * Math.cos(rad) * Δt) / 111_320;
    const deltaLng = (currentSpeedMs * Math.sin(rad) * Δt) / (111_320 * Math.max(0.001, cosLat));

    _dr.lat     += deltaLat;
    _dr.lng     += deltaLng;
    _dr.speedMs  = currentSpeedMs; // DR durumunu canlı hızla senkronize tut

    const prev = useGPSStore.getState().location;
    useGPSStore.setState({
      location: {
        latitude:  _dr.lat,
        longitude: _dr.lng,
        accuracy:  50 + elapsed / 1000, // belirsizlik zamanla artar
        altitude:  prev?.altitude,
        heading:   _dr.bearingDeg,
        speed:     _dr.speedMs,
        timestamp: nowMs,
      },
    });
  }, DR_TICK_MS);
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
