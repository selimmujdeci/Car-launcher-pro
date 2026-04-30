import { create } from 'zustand';
import { fetchVehicles } from '@/lib/vehicles.service';
import { formatLastSeen } from '@/lib/utils';
import { TIMING, ALERT_THRESHOLDS } from '@/lib/constants';
import type { LiveVehicle, VehicleUpdate, ConnectionStatus } from '@/types/realtime';

// ── Automotive grade: render throttle (20Hz cap) ─────────────────────────────
// Module-level map — outside Zustand state to avoid triggering re-renders
const _lastRenderMs = new Map<string, number>();

// ── Sensor resiliency: reject physically impossible data ──────────────────────
function isValidSensorData(u: VehicleUpdate, existing: LiveVehicle): boolean {
  // NaN values pass through here — applyUpdate uses Number.isFinite() to
  // fall back to the last known good value, preserving sensor continuity.
  if (!Number.isFinite(u.speed))      return true;
  if (!Number.isFinite(u.rpm))        return true;
  if (!Number.isFinite(u.engineTemp)) return true;
  if (!Number.isFinite(u.fuel))       return true;

  // Absolute bounds
  if (u.speed < 0 || u.speed > 300) return false;
  if (u.rpm < 0 || u.rpm > 10_000) return false;
  if (u.engineTemp < -40 || u.engineTemp > 150) return false;
  if (u.fuel < 0 || u.fuel > 100) return false;

  // Ghost Jump: physically impossible speed change in <100 ms (sensor glitch / GPS bounce)
  const timeDelta = u.timestamp - existing.lastTimestamp;
  if (timeDelta > 0 && timeDelta < 100 && Math.abs(u.speed - existing.speed) > 40) return false;

  // Delta bounds — reject large jumps beyond plausible acceleration
  if (Math.abs(u.speed - existing.speed) > 80) return false;
  if (Math.abs(u.rpm - existing.rpm) > 5_000) return false;

  return true;
}

// ── localStorage keys (must match pairingService.ts) ────────────────────────
const LOCAL_KEYS = {
  VEHICLE_ID:    'caros_pair_vehicle_id',
  API_KEY:       'caros_pair_api_key',
  VEHICLE_NAME:  'caros_pair_vehicle_name',
  VEHICLE_PLATE: 'caros_pair_vehicle_plate',
} as const;

interface VehicleStoreState {
  vehicles: Record<string, LiveVehicle>;
  connectionStatus: ConnectionStatus;
  loading: boolean;
  error: string | null;
  /** Instant load from localStorage — no network, no auth. Call first. */
  initializeFromLocal: () => void;
  initializeFromSupabase: () => Promise<void>;
  applyUpdate: (update: VehicleUpdate) => void;
  setConnectionStatus: (status: ConnectionStatus) => void;
  startWatchdog: () => () => void; // returns cleanup fn
  getList: () => LiveVehicle[];
  /** Replace entire vehicle map (used when loading from Supabase). */
  setVehicles: (vehicles: LiveVehicle[]) => void;
  /** Add or upsert a single vehicle (used after linking a new device). */
  addVehicle: (vehicle: LiveVehicle) => void;
  /** Remove a vehicle by id (used after unlinking). */
  removeVehicle: (id: string) => void;
}

export const useVehicleStore = create<VehicleStoreState>((set, get) => ({
  vehicles: {},
  connectionStatus: 'disconnected',
  loading: true,
  error: null,

  initializeFromLocal: () => {
    try {
      const id    = localStorage.getItem(LOCAL_KEYS.VEHICLE_ID);
      const key   = localStorage.getItem(LOCAL_KEYS.API_KEY);
      if (!id || !key) { set({ loading: false }); return; }

      const existing = get().vehicles[id];
      if (existing) return; // already loaded (Supabase may have beaten us)

      const vehicle: LiveVehicle = {
        id,
        plate:         localStorage.getItem(LOCAL_KEYS.VEHICLE_PLATE) ?? id,
        name:          localStorage.getItem(LOCAL_KEYS.VEHICLE_NAME)  ?? 'Araç',
        driver:        '—',
        status:        'offline',
        lat:           0,
        lng:           0,
        speed:         0,
        fuel:          0,
        engineTemp:    0,
        rpm:           0,
        odometer:      0,
        location:      '—',
        lastSeen:      '—',
        lastTimestamp: 0,
      };
      set({ vehicles: { [id]: vehicle }, loading: false });
    } catch { set({ loading: false }); }
  },

  initializeFromSupabase: async () => {
    set({ loading: true, error: null });
    try {
      const vehicles = await fetchVehicles();
      const map: Record<string, LiveVehicle> = {};
      for (const vehicle of vehicles) {
        map[vehicle.id] = vehicle;
      }
      set({ vehicles: map, loading: false });
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : 'Araçlar yüklenemedi.',
      });
    }
  },

  applyUpdate: (update: VehicleUpdate) => {
    const { vehicleId, lat, lng, speed, fuel, engineTemp, rpm, timestamp } = update;
    const now = Date.now();

    // 20Hz throttle — skip update if last render was < RENDER_THROTTLE_MS ago
    const lastMs = _lastRenderMs.get(vehicleId) ?? 0;
    if (now - lastMs < TIMING.RENDER_THROTTLE_MS) return;

    // Sensor resiliency — reject before touching state
    const existing = get().vehicles[vehicleId];
    if (!existing) return;
    if (!isValidSensorData(update, existing)) return;

    _lastRenderMs.set(vehicleId, now);

    const nextSpeed = Number.isFinite(speed) ? speed : existing.speed;
    const nextEngineTemp = Number.isFinite(engineTemp) ? engineTemp : existing.engineTemp;
    const isAlarm = nextEngineTemp > ALERT_THRESHOLDS.ENGINE_TEMP_HIGH_C || nextSpeed > ALERT_THRESHOLDS.SPEED_LIMIT_KMH;

    set((state) => ({
      vehicles: {
        ...state.vehicles,
        [vehicleId]: {
          ...state.vehicles[vehicleId],
          lat: Number.isFinite(lat) ? lat : state.vehicles[vehicleId].lat,
          lng: Number.isFinite(lng) ? lng : state.vehicles[vehicleId].lng,
          speed: Number.isFinite(speed) ? speed : state.vehicles[vehicleId].speed,
          fuel: Number.isFinite(fuel) ? fuel : state.vehicles[vehicleId].fuel,
          engineTemp: Number.isFinite(engineTemp) ? engineTemp : state.vehicles[vehicleId].engineTemp,
          rpm: Number.isFinite(rpm) ? rpm : state.vehicles[vehicleId].rpm,
          status: isAlarm ? 'alarm' : 'online',
          lastSeen: formatLastSeen(timestamp),
          lastTimestamp: timestamp,
        },
      },
    }));
  },

  setConnectionStatus: (status) => set({ connectionStatus: status }),

  startWatchdog: () => {
    const PUSH_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
      ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/push-notify`
      : null;

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

            // Araç offline geçince push bildirim tetikle (fire-and-forget)
            if (PUSH_URL) {
              fetch(PUSH_URL, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({
                  event:     'vehicle_offline',
                  vehicleId: id,
                  payload:   { plate: v.plate, vehicle_name: v.name },
                }),
              }).catch(() => { /* best-effort */ });
            }
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

  removeVehicle: (id: string) => {
    set((state) => {
      const next = { ...state.vehicles };
      delete next[id];
      return { vehicles: next };
    });
  },
}));
