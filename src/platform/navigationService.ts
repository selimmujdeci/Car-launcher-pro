import { create } from 'zustand';
import type { Address } from './addressBookService';

export interface NavigationState {
  isNavigating: boolean;
  destination: Address | null;
  distanceMeters?: number;
  etaSeconds?: number;
  headingToDestination?: number;
}

interface NavigationStore extends NavigationState {
  setDestination: (destination: Address | null) => void;
  updateDistance: (distance: number) => void;
  updateEta: (seconds: number) => void;
  updateHeading: (heading: number) => void;
  clearNavigation: () => void;
}

const useNavigationStore = create<NavigationStore>((set) => ({
  isNavigating: false,
  destination: null,
  distanceMeters: undefined,
  etaSeconds: undefined,
  headingToDestination: undefined,

  setDestination: (destination) =>
    set({
      destination,
      isNavigating: !!destination,
    }),

  updateDistance: (distance) => set({ distanceMeters: distance }),
  updateEta: (seconds) => set({ etaSeconds: seconds }),
  updateHeading: (heading) => set({ headingToDestination: heading }),

  clearNavigation: () =>
    set({
      isNavigating: false,
      destination: null,
      distanceMeters: undefined,
      etaSeconds: undefined,
    }),
}));

/**
 * Start navigation to destination
 */
export function startNavigation(destination: Address): void {
  useNavigationStore.getState().setDestination(destination);
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
  const heading = calculateHeading(
    currentLat,
    currentLon,
    destination.latitude,
    destination.longitude
  );

  useNavigationStore.getState().updateDistance(distance);
  useNavigationStore.getState().updateHeading(heading);

  // Estimate ETA (assumes average speed of 40 km/h)
  const avgSpeedMph = 40;
  const distanceKm = distance / 1000;
  const etaHours = distanceKm / avgSpeedMph;
  const etaSeconds = Math.round(etaHours * 3600);
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
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
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

  return {
    isNavigating,
    destination,
    distanceMeters,
    etaSeconds,
    headingToDestination,
  };
}
