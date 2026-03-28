import { create } from 'zustand';

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

    // Check/request permissions — wrapped individually since these can throw on some platforms
    try {
      const perms = await Geolocation.checkPermissions();
      if (perms.location !== 'granted') {
        const req = await Geolocation.requestPermissions();
        if (req.location !== 'granted' && req.location !== 'prompt') {
          useGPSStore.setState({ error: 'GPS permission denied' });
          return;
        }
      }
    } catch {
      // Permission API may not be available, proceed anyway
    }

    watchId = await Geolocation.watchPosition(
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 3000,
      },
      (position, err) => {
        if (err) {
          useGPSStore.setState({ error: err.message });
          return;
        }

        if (position) {
          handlePosition(position.coords, position.timestamp);
        }
      }
    );
  } catch (err) {
    console.warn('Native GPS failed, falling back to web:', err);
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
        useGPSStore.setState({ error: err.message });
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
  const loc: GPSLocation = {
    latitude: coords.latitude,
    longitude: coords.longitude,
    accuracy: coords.accuracy || 0,
    altitude: coords.altitude ?? undefined,
    heading: coords.heading ?? undefined,
    speed: coords.speed ?? undefined,
    timestamp,
  };

  useGPSStore.setState({
    location: loc,
    heading: coords.heading ?? null,
    isTracking: true,
    error: null,
  });
}

export async function stopGPSTracking(): Promise<void> {
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
