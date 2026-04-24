import type { GeofenceZone } from '@/types/realtime';

export const ALERT_THRESHOLDS = {
  SPEED_LIMIT_KMH: 90,
  FUEL_LOW_PCT: 15,
  ENGINE_TEMP_HIGH_C: 100,
} as const;

export const TIMING = {
  OFFLINE_TIMEOUT_MS: 10_000,
  WATCHDOG_INTERVAL_MS: 5_000,
  GEOFENCE_DEBOUNCE_MS: 5_000,
  ALERT_DEBOUNCE_MS: 30_000, // same alert type won't re-fire per vehicle for 30s
  MOCK_UPDATE_INTERVAL_MS: 1_500,
  MAP_THROTTLE_MS: 500,
  // Automotive grade: cap UI re-renders at 20Hz to protect Mali-400 GPU
  RENDER_THROTTLE_MS: 50,
} as const;

// Default geofence — covers Istanbul + surroundings (Kocaeli, Bursa)
export const DEFAULT_GEOFENCES: GeofenceZone[] = [
  {
    id: 'istanbul-zone',
    name: 'İstanbul Bölgesi',
    type: 'polygon',
    polygon: [
      [41.60, 27.80],
      [41.60, 30.00],
      [40.50, 30.00],
      [40.50, 27.80],
    ],
  },
];
