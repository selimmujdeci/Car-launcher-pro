import { create } from 'zustand';
import { logError } from './crashLogger';

// Capacitor global tip tanımı — (window as any) yerine
declare global {
  interface Window {
    Capacitor?: { isNativePlatform(): boolean };
  }
}

export interface GPSLocation {
  latitude: number;
  longitude: number;
  accuracy: number;
  altitude?: number;
  heading?: number;
  speed?: number;
  timestamp: number;
}

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

let watchId: number | string | null = null;
let _lastPositionMs = 0;
const POSITION_THROTTLE_MS = 2000;

// Auto-reconnect on consecutive errors
let _consecutiveErrors = 0;
let _reconnectTimer:    ReturnType<typeof setTimeout> | null = null;
const MAX_GPS_ERRORS   = 3;
const GPS_RECONNECT_MS = 8000;

// ── Son bilinen konum (localStorage) ─────────────────────
const LAST_KNOWN_KEY = 'car-gps-last-known';

function _saveLastKnown(loc: GPSLocation): void {
  try {
    localStorage.setItem(LAST_KNOWN_KEY, JSON.stringify({
      lat: loc.latitude, lng: loc.longitude,
    }));
  } catch { /* ignore */ }
}

function _loadLastKnown(): { lat: number; lng: number } | null {
  try {
    const v = localStorage.getItem(LAST_KNOWN_KEY);
    if (!v) return null;
    const p = JSON.parse(v) as { lat?: number; lng?: number };
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return null;
    return { lat: p.lat!, lng: p.lng! };
  } catch { return null; }
}

// ── İlk fix fallback (5 saniye) ──────────────────────────
const GPS_FIRST_FIX_MS = 5000;
// Türkiye merkezi: Adana (coğrafi merkeze yakın, iyi bilinen şehir)
const TURKEY_DEFAULT: [number, number] = [37.0, 35.3];
let _firstFixTimer: ReturnType<typeof setTimeout> | null = null;

function _clearFirstFixTimer(): void {
  if (_firstFixTimer) { clearTimeout(_firstFixTimer); _firstFixTimer = null; }
}

function _startFirstFixFallback(): void {
  _clearFirstFixTimer();
  _firstFixTimer = setTimeout(() => {
    _firstFixTimer = null;
    // Gerçek GPS fix zaten geldiyse dokunma
    if (useGPSStore.getState().location && useGPSStore.getState().source !== 'last_known' && useGPSStore.getState().source !== 'default') return;
    const last = _loadLastKnown();
    const [lat, lng] = last ? [last.lat, last.lng] : TURKEY_DEFAULT;
    const source = last ? 'last_known' : 'default';
    const errorMsg = last ? 'Son konum kullanılıyor' : 'GPS alınamadı — Çevrimdışı mod';
    useGPSStore.setState({
      location: { latitude: lat, longitude: lng, accuracy: last ? 500 : 99999, timestamp: Date.now() },
      error: errorMsg,
      source,
      isTracking: false,
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
// Problem: GPS Doppler hız ölçümü ±1-2 km/h jitter üretir. Araç tam durmuşken
//          hız 0 ile 1 km/h arasında sürekli salınır. speedFusion'a gelen gürültü
//          EMA ile kısmen bastırılsa da kökte çözmek daha temiz.
//
// Çözüm:
//   1. Deadzone  < GPS_SPEED_DEADZONE_KMH → 0 say (durağan jitter bastırma)
//   2. EMA       α = GPS_SPEED_EMA_ALPHA  → ani sıçramaları yumuşat (alçak geçiren filtre)
//
// Neden EMA @ 0.40?
//   α = 0.40 @2 s GPS tick → ~3-4 güncelleme sonra gerçek hıza %90 yaklaşır.
//   α = 0.20 çok yavaş (şehir trafiğinde ani fren/hızlanma geç yansır).
//   α = 0.70 orijinal gürültüyü çok geçirir.
//
/** EMA düzeltme katsayısı — GPS hız gürültüsü için alçak geçiren filtre */
const GPS_SPEED_EMA_ALPHA    = 0.40;
/** Durağan araç jitter bastırma eşiği (km/h) — altındaki değerler 0 sayılır */
const GPS_SPEED_DEADZONE_KMH = 1.0;

/** EMA durum değişkeni — startGPSTracking öncesi null, her fix'te güncellenir */
let _speedEmaKmh: number | null = null;

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
    const GPS_PERMISSION_TIMEOUT_MS = 6000;
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
          // İzin reddedildi — web geolocation ile son kez dene
          useGPSStore.setState({ error: 'GPS izni reddedildi — web konumu deneniyor', isTracking: false });
          startWebGPSTracking();
          return;
        }
      }
    } catch {
      // Permission API may not be available on some devices/versions, proceed anyway
    }

    watchId = await Geolocation.watchPosition(
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 3000,
      },
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
        maximumAge: 3000,
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
  const now = Date.now();
  if (now - _lastPositionMs < POSITION_THROTTLE_MS) return;

  // Validate — malformed native data should never propagate to UI
  if (
    !Number.isFinite(coords.latitude)  ||
    !Number.isFinite(coords.longitude) ||
    Math.abs(coords.latitude)  > 90    ||
    Math.abs(coords.longitude) > 180
  ) {
    logError('GPS', new Error(`Invalid coords: ${coords.latitude},${coords.longitude}`));
    return;
  }

  _lastPositionMs    = now;
  _consecutiveErrors = 0; // reset on success
  _clearFirstFixTimer(); // gerçek fix geldi, fallback iptal

  // GPS speed yoksa pozisyon delta'sından hesapla
  const gpsSpeed = Number.isFinite(coords.speed ?? NaN) ? (coords.speed ?? undefined) : undefined;
  const rawSpeed = gpsSpeed ?? _calcSpeedFromDelta(coords.latitude, coords.longitude, timestamp ?? now);

  // ── Hız filtresi: Deadzone + EMA (alçak geçiren filtre) ─────────────
  // Hedef: ham GPS Doppler/delta gürültüsünü bastır, gerçek hız değişimini koru.
  let filteredSpeed: number | undefined;
  if (rawSpeed != null) {
    const rawKmh    = rawSpeed * 3.6;
    const deadzoned = rawKmh < GPS_SPEED_DEADZONE_KMH ? 0 : rawKmh; // durağan jitter → 0
    _speedEmaKmh    = _speedEmaKmh === null
      ? deadzoned
      : _speedEmaKmh + GPS_SPEED_EMA_ALPHA * (deadzoned - _speedEmaKmh);
    filteredSpeed   = _speedEmaKmh / 3.6; // km/h → m/s (GPSLocation standardı)
  }

  // GPS course: Geolocation spec → null/NaN when stationary; safe-guard before blend
  const gpsCourse = Number.isFinite(coords.heading ?? NaN) ? (coords.heading ?? null) : null;
  // Heading blend: filteredSpeed kullan — ham gürültü pusula/GPS ağırlık hesabını bozmasın
  const heading   = _blendHeading(gpsCourse, filteredSpeed ?? 0);

  const loc: GPSLocation = {
    latitude:  coords.latitude,
    longitude: coords.longitude,
    accuracy:  Number.isFinite(coords.accuracy) ? coords.accuracy : 0,
    altitude:  coords.altitude ?? undefined,
    heading:   heading ?? undefined,
    speed:     filteredSpeed, // ← filtreli hız (deadzone + EMA)
    timestamp,
  };

  _saveLastKnown(loc);

  const source = isNativePlatform() ? 'native' : 'web';

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
  _prevForSpeed    = null;
  _smoothedHeading = null;
  _speedEmaKmh     = null; // EMA sıfırla — yeniden başlatmada eski değerle kirlenme
  _consecutiveErrors = 0;
  _lastPositionMs = 0; // reset throttle — next position always accepted after restart

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
  return useGPSStore.getState();
}

export function useGPSLocation() {
  return useGPSStore((s) => s.location);
}

export function useGPSHeading() {
  return useGPSStore((s) => s.heading);
}

export function useGPSState() {
  return useGPSStore();
}

export function useGPSAvailable() {
  return useGPSStore((s) => !s.unavailable);
}

/** Debug: aktif GPS kaynak bilgisi (native / web / last_known / default / null) */
export function useGPSSource() {
  return useGPSStore((s) => s.source);
}

/** Mevcut GPS hızını km/h olarak döner; yoksa null. */
export function getGPSSpeedKmh(): number | null {
  const loc = useGPSStore.getState().location;
  if (!loc?.speed || !Number.isFinite(loc.speed) || loc.speed <= 0) return null;
  return loc.speed * 3.6; // m/s → km/h
}

/**
 * Non-React GPS konum aboneliği — speedFusion gibi modül-düzey servisler için.
 * Konum nesnesi referans olarak değiştiğinde çağrılır (her GPS tick'inde).
 * Cleanup fonksiyonu döner.
 */
export function onGPSLocation(fn: (loc: GPSLocation | null) => void): () => void {
  let prevLoc = useGPSStore.getState().location;
  fn(prevLoc); // anlık senkronizasyon
  const unsub = useGPSStore.subscribe((state) => {
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

/* ── HMR cleanup — dev modda Hot Reload'da watchId sızıntısını önle ─ */
if (import.meta.hot) {
  import.meta.hot.dispose(() => { stopGPSTracking().catch(() => undefined); });
}
