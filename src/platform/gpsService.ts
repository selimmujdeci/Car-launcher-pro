import { create } from 'zustand';
import { logError } from './crashLogger';

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
}

const useGPSStore = create<GPSState>(() => ({
  location: null,
  heading: null,
  isTracking: false,
  error: null,
  unavailable: false,
}));

let watchId: number | string | null = null;
let _lastPositionMs = 0;
const POSITION_THROTTLE_MS = 2000;

// Auto-reconnect on consecutive errors
let _consecutiveErrors = 0;
let _reconnectTimer:    ReturnType<typeof setTimeout> | null = null;
const MAX_GPS_ERRORS   = 3;
const GPS_RECONNECT_MS = 8000;

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
    const cap = (window as any).Capacitor;
    return typeof cap?.isNativePlatform === 'function' && cap.isNativePlatform();
  } catch {
    return false;
  }
}

/**
 * Start GPS tracking using the appropriate platform API
 */
export async function startGPSTracking(): Promise<void> {
  if (watchId != null) return;

  if (isNativePlatform()) {
    await startNativeGPSTracking();
  } else {
    // Web/browser: GPS is not used — map defaults to Turkey center
    useGPSStore.setState({ unavailable: true });
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
          useGPSStore.setState({ error: 'GPS permission denied', isTracking: false });
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
    startWebGPSTracking();
  }
}

/**
 * Web (browser navigator.geolocation) GPS tracking
 */
function startWebGPSTracking(): void {
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

  const loc: GPSLocation = {
    latitude:  coords.latitude,
    longitude: coords.longitude,
    accuracy:  Number.isFinite(coords.accuracy) ? coords.accuracy : 0,
    altitude:  coords.altitude ?? undefined,
    heading:   coords.heading  ?? undefined,
    speed:     Number.isFinite(coords.speed ?? NaN) ? (coords.speed ?? undefined) : undefined,
    timestamp,
  };

  useGPSStore.setState({
    location:   loc,
    heading:    coords.heading ?? null,
    isTracking: true,
    error:      null,
  });
}

export async function stopGPSTracking(): Promise<void> {
  // Cancel any pending reconnect so it doesn't fire after stop
  if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null; }
  _consecutiveErrors = 0;

  if (watchId == null) return;

  try {
    if (isNativePlatform()) {
      const { Geolocation } = await import('@capacitor/geolocation');
      await Geolocation.clearWatch({ id: watchId as string });
    } else {
      navigator.geolocation.clearWatch(watchId as number);
    }
  } catch {
    // Ignore cleanup errors
  }

  watchId = null;
  useGPSStore.setState({ isTracking: false });
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

/** Mevcut GPS hızını km/h olarak döner; yoksa null. */
export function getGPSSpeedKmh(): number | null {
  const loc = useGPSStore.getState().location;
  if (!loc?.speed || !Number.isFinite(loc.speed) || loc.speed <= 0) return null;
  return loc.speed * 3.6; // m/s → km/h
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
