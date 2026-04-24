import { create } from 'zustand';
import { mockVehicles } from '@/lib/mockData';
import { formatLastSeen } from '@/lib/utils';
import { TIMING } from '@/lib/constants';
import type { LiveVehicle, VehicleUpdate, ConnectionStatus } from '@/types/realtime';

// Initial lat/lng per vehicle ID (matches MockRealtimeEngine INITIAL_SIM)
const INIT_POSITIONS: Record<string, { lat: number; lng: number }> = {
  '1': { lat: 40.9897, lng: 29.0269 },
  '2': { lat: 41.0426, lng: 29.0054 },
  '3': { lat: 39.9334, lng: 32.8597 },
  '4': { lat: 38.4237, lng: 27.1428 },
  '5': { lat: 40.7978, lng: 29.4249 },
  '6': { lat: 40.1980, lng: 29.0610 },
};

// Build initial LiveVehicle record from mock data
const buildInitial = (): Record<string, LiveVehicle> => {
  const out: Record<string, LiveVehicle> = {};
  for (const v of mockVehicles) {
    const pos = INIT_POSITIONS[v.id] ?? { lat: 0, lng: 0 };
    out[v.id] = {
      ...v,
      lat: pos.lat,
      lng: pos.lng,
      // offline vehicles get an old timestamp so watchdog marks them offline
      lastTimestamp: v.status === 'offline' ? Date.now() - 20_000 : Date.now() - 1_000,
    };
  }
  return out;
};

interface VehicleStoreState {
  vehicles: Record<string, LiveVehicle>;
  connectionStatus: ConnectionStatus;
  applyUpdate: (update: VehicleUpdate) => void;
  setConnectionStatus: (status: ConnectionStatus) => void;
  startWatchdog: () => () => void; // returns cleanup fn
  getList: () => LiveVehicle[];
  /** Replace entire vehicle map (used when loading from Supabase). */
  setVehicles: (vehicles: LiveVehicle[]) => void;
  /** Add or upsert a single vehicle (used after linking a new device). */
  addVehicle: (vehicle: LiveVehicle) => void;
}

export const useVehicleStore = create<VehicleStoreState>((set, get) => ({
  vehicles: buildInitial(),
  connectionStatus: 'disconnected',

  applyUpdate: (update: VehicleUpdate) => {
    const { vehicleId, lat, lng, speed, fuel, engineTemp, rpm, timestamp } = update;

    set((state) => {
      const existing = state.vehicles[vehicleId];
      if (!existing) return state; // unknown vehicle — ignore

      const isAlarm = engineTemp > 100 || speed > 90;

      return {
        vehicles: {
          ...state.vehicles,
          [vehicleId]: {
            ...existing,
            lat,
            lng,
            speed,
            fuel,
            engineTemp,
            rpm,
            status: isAlarm ? 'alarm' : 'online',
            lastSeen: formatLastSeen(timestamp),
            lastTimestamp: timestamp,
          },
        },
      };
    });
  },

  setConnectionStatus: (status) => set({ connectionStatus: status }),

  startWatchdog: () => {
    const interval = setInterval(() => {
      const now = Date.now();
      set((state) => {
        let changed = false;
        const next = { ...state.vehicles };

        for (const [id, v] of Object.entries(next)) {
          if (v.status !== 'offline' && now - v.lastTimestamp > TIMING.OFFLINE_TIMEOUT_MS) {
            next[id] = {
              ...v,
              status: 'offline',
              speed: 0,
              rpm: 0,
              lastSeen: formatLastSeen(v.lastTimestamp),
            };
            changed = true;
          }
        }

        return changed ? { vehicles: next } : state;
      });
    }, TIMING.WATCHDOG_INTERVAL_MS);

    return () => clearInterval(interval);
  },

  getList: () => Object.values(get().vehicles),

  setVehicles: (vehicles: LiveVehicle[]) => {
    const map: Record<string, LiveVehicle> = {};
    for (const v of vehicles) map[v.id] = v;
    set({ vehicles: map });
  },

  addVehicle: (vehicle: LiveVehicle) => {
    set((state) => ({
      vehicles: { ...state.vehicles, [vehicle.id]: vehicle },
    }));
  },
}));
