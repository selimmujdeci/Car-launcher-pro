import { Geolocation } from '@capacitor/geolocation';
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
}

const useGPSStore = create<GPSState>(() => ({
  location: null,
  heading: null,
  isTracking: false,
  error: null,
}));

let watchId: string | null = null;

async function requestPermissions(): Promise<boolean> {
  try {
    const perms = await Geolocation.requestPermissions();
    return perms.location === 'granted' || perms.location === 'prompt';
  } catch (err) {
    console.warn('GPS permission error:', err);
    return false;
  }
}

async function checkPermission(): Promise<boolean> {
  try {
    const perms = await Geolocation.checkPermissions();
    return perms.location === 'granted';
  } catch (err) {
    console.warn('GPS check error:', err);
    return false;
  }
}

export async function startGPSTracking(): Promise<void> {
  if (watchId) return;

  try {
    const hasPermission = await checkPermission();
    if (!hasPermission) {
      const granted = await requestPermissions();
      if (!granted) {
        useGPSStore.setState({ error: 'GPS permission denied' });
        return;
      }
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
          const loc: GPSLocation = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy || 0,
            altitude: position.coords.altitude || undefined,
            heading: position.coords.heading || undefined,
            speed: position.coords.speed || undefined,
            timestamp: position.timestamp,
          };

          useGPSStore.setState({
            location: loc,
            heading: position.coords.heading || null,
            isTracking: true,
            error: null,
          });
        }
      }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'GPS error';
    useGPSStore.setState({ error: msg });
  }
}

export async function stopGPSTracking(): Promise<void> {
  if (watchId) {
    await Geolocation.clearWatch({ id: watchId });
    watchId = null;
    useGPSStore.setState({ isTracking: false });
  }
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
