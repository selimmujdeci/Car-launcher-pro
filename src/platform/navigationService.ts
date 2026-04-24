import { create } from 'zustand';
import type { Address } from './addressBookService';
import { getGPSSpeedKmh } from './gpsService';
import { sensitiveKeyStore } from './sensitiveKeyStore';

export interface NavigationState {
  isNavigating: boolean;
  destination: Address | null;
  distanceMeters?: number;
  etaSeconds?: number;
  headingToDestination?: number;
  isOfflineResult: boolean;
}

interface NavigationStore extends NavigationState {
  setDestination: (destination: Address | null, isOffline?: boolean) => void;
  updateDistance: (distance: number) => void;
  updateEta: (seconds: number) => void;
  updateHeading: (heading: number) => void;
  clearNavigation: () => void;
  setOfflineResult: (val: boolean) => void;
}

const useNavigationStore = create<NavigationStore>((set) => ({
  isNavigating: false,
  destination: null,
  distanceMeters: undefined,
  etaSeconds: undefined,
  headingToDestination: undefined,
  isOfflineResult: false,

  setDestination: (destination, isOffline = false) =>
    set({
      destination,
      isNavigating: !!destination,
      isOfflineResult: isOffline,
    }),

  updateDistance: (distance) => set({ distanceMeters: distance }),
  updateEta: (seconds) => set({ etaSeconds: seconds }),
  updateHeading: (heading) => set({ headingToDestination: heading }),

  setOfflineResult: (val) => set({ isOfflineResult: val }),

  clearNavigation: () =>
    set({
      isNavigating: false,
      destination: null,
      distanceMeters: undefined,
      etaSeconds: undefined,
      isOfflineResult: false,
    }),
}));

/**
 * Start navigation to destination
 */
export function startNavigation(destination: Address, isOffline = false): void {
  useNavigationStore.getState().setDestination(destination, isOffline);
}

/**
 * Stop navigation
 */
export function stopNavigation(): void {
  useNavigationStore.getState().clearNavigation();
}

/**
 * Get current navigation state
 */
export function getNavigationState(): NavigationState {
  const store = useNavigationStore.getState();
  return {
    isNavigating: store.isNavigating,
    destination: store.destination,
    distanceMeters: store.distanceMeters,
    etaSeconds: store.etaSeconds,
    headingToDestination: store.headingToDestination,
    isOfflineResult: store.isOfflineResult,
  };
}

/**
 * Update navigation progress (distance, ETA, heading)
 */
export function updateNavigationProgress(
  currentLat: number,
  currentLon: number,
  _currentHeading: number
): void {
  const { destination } = useNavigationStore.getState();
  if (!destination) return;

  // Calculate distance using Haversine formula
  const distance = calculateDistance(
    currentLat,
    currentLon,
    destination.latitude,
    destination.longitude
  );

  // Calculate heading to destination
  const rawHeading = calculateHeading(
    currentLat,
    currentLon,
    destination.latitude,
    destination.longitude
  );
  const heading = Number.isFinite(rawHeading) ? rawHeading : 0;

  useNavigationStore.getState().updateDistance(distance);
  useNavigationStore.getState().updateHeading(heading);

  // ETA: GPS hızı varsa onu kullan, yoksa şehir içi ortalama (50 km/h)
  const gpsSpeed = getGPSSpeedKmh();
  const avgSpeedKmh = (gpsSpeed && gpsSpeed > 5) ? gpsSpeed : 50;
  const distanceKm = distance / 1000;
  const etaSeconds = Math.round((distanceKm / avgSpeedKmh) * 3600);
  useNavigationStore.getState().updateEta(etaSeconds);
}

/**
 * Calculate distance between two points (Haversine formula)
 */
function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000; // Earth radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Calculate heading from point A to point B
 */
function calculateHeading(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const lat1Rad = (lat1 * Math.PI) / 180;
  const lat2Rad = (lat2 * Math.PI) / 180;

  const y = Math.sin(dLon) * Math.cos(lat2Rad);
  const x =
    Math.cos(lat1Rad) * Math.sin(lat2Rad) -
    Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);

  let heading = (Math.atan2(y, x) * 180) / Math.PI;
  heading = (heading + 360) % 360;
  return heading;
}

/**
 * Format distance for display
 */
export function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)}m`;
  }
  return `${(meters / 1000).toFixed(1)}km`;
}
/**
 * Format ETA for display
 */
export function formatEta(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const hours   = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/**
 * Searches local navigation history for a match.
 */
async function searchOffline(query: string): Promise<Address | null> {
  try {
    const raw = await sensitiveKeyStore.get('nav_history');
    if (!raw) return null;
    const history = JSON.parse(raw) as Address[];
    const normalizedQuery = query.toLowerCase().trim();

    // Priority 1: Simple substring match
    const match = history.find(addr => 
      addr.name.toLowerCase().includes(normalizedQuery)
    );
    if (match) return match;

    // Priority 2: character overlap score ≥ 80%
    const scored = history
      .map((addr) => {
        const name    = addr.name.toLowerCase();
        const shorter = normalizedQuery.length <= name.length ? normalizedQuery : name;
        const longer  = normalizedQuery.length >  name.length ? normalizedQuery : name;
        let matches = 0;
        for (const ch of shorter) {
          if (longer.includes(ch)) matches++;
        }
        return { addr, score: shorter.length ? matches / shorter.length : 0 };
      })
      .filter((x) => x.score >= 0.8)
      .sort((a, b) => b.score - a.score);

    return scored[0]?.addr ?? null;
  } catch {
    return null;
  }
}

/**
 * Adds a successful navigation destination to local history (max 50, circular).
 */
async function addToHistory(address: Address): Promise<void> {
  try {
    const raw = await sensitiveKeyStore.get('nav_history');
    let history: Address[] = [];
    if (raw) {
      history = JSON.parse(raw) as Address[];
    }

    // Remove if already exists (to move to front/avoid duplicates)
    history = history.filter(a => 
      a.latitude !== address.latitude || a.longitude !== address.longitude
    );

    // Add to front
    history.unshift(address);

    // Limit to 50
    if (history.length > 50) {
      history = history.slice(0, 50);
    }

    await sensitiveKeyStore.set('nav_history', JSON.stringify(history));
  } catch {
    // write failure is non-fatal
  }
}

/**
 * Metin adresini Nominatim ile geocode edip navigasyonu başlatır.
 * Sesli komut entegrasyonu için kullanılır.
 * Başarısız olursa false döner (ağ yok / adres bulunamadı).
 */
export async function navigateToAddress(text: string): Promise<boolean> {
  // 1. Network Check
  if (!navigator.onLine) {
    const offlineMatch = await searchOffline(text);
    if (offlineMatch) {
      startNavigation(offlineMatch, true);
      // Move to front of history
      await addToHistory(offlineMatch);
      return true;
    }
    return false;
  }

  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6_000);
  
  try {
    const q   = encodeURIComponent(text);
    const url = `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'CarLauncherPro/1.0' },
      signal: ctrl.signal,
    });
    const data = await res.json() as Array<{ display_name: string; lat: string; lon: string }>;
    
    if (!data.length) {
      // Nominatim found nothing, try offline fallback
      const offlineMatch = await searchOffline(text);
      if (offlineMatch) {
        startNavigation(offlineMatch, true);
        await addToHistory(offlineMatch);
        return true;
      }
      return false;
    }

    const r = data[0];
    const destination: Address = {
      id:        `geo-${Date.now()}`,
      name:      r.display_name.split(',')[0].trim(),
      latitude:  parseFloat(r.lat),
      longitude: parseFloat(r.lon),
      type:      'history',
    };

    startNavigation(destination, false);
    // 2. Persistence on success (Write Throttling)
    await addToHistory(destination);
    return true;
  } catch {
    // AbortError (timeout) veya ağ hatası → yerel geçmişe fallback
    const offlineMatch = await searchOffline(text);
    if (offlineMatch) {
      startNavigation(offlineMatch, true);
      await addToHistory(offlineMatch);
      return true;
    }
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Use hook for navigation state
 */
export function useNavigation() {
  const isNavigating = useNavigationStore((s) => s.isNavigating);
  const destination = useNavigationStore((s) => s.destination);
  const distanceMeters = useNavigationStore((s) => s.distanceMeters);
  const etaSeconds = useNavigationStore((s) => s.etaSeconds);
  const headingToDestination = useNavigationStore((s) => s.headingToDestination);
  const isOfflineResult = useNavigationStore((s) => s.isOfflineResult);

  return {
    isNavigating,
    destination,
    distanceMeters,
    etaSeconds,
    headingToDestination,
    isOfflineResult,
  };
}
