import { TIMING } from './constants';
import { clamp, lerp } from './utils';
import type { VehicleUpdate, ConnectionStatus } from '@/types/realtime';

export interface RealtimeCallbacks {
  onUpdate: (update: VehicleUpdate) => void;
  onConnectionChange: (status: ConnectionStatus) => void;
}

// ── Abstract base ────────────────────────────────────────────────────────────
export abstract class BaseRealtimeEngine {
  protected cb: RealtimeCallbacks;
  constructor(callbacks: RealtimeCallbacks) { this.cb = callbacks; }
  abstract connect(): void;
  abstract disconnect(): void;
}

// ── Mock simulation ──────────────────────────────────────────────────────────

interface SimVehicle {
  id: string;
  lat: number;
  lng: number;
  speed: number;
  speedTarget: number;
  fuel: number;
  engineTemp: number;
  rpm: number;
  active: boolean;
  bearingRad: number; // rough heading
}

const INITIAL_SIM: SimVehicle[] = [
  { id: '1', lat: 40.9897, lng: 29.0269, speed: 48,  speedTarget: 50,  fuel: 72,  engineTemp: 88,  rpm: 1800, active: true,  bearingRad: 0.4 },
  { id: '2', lat: 41.0426, lng: 29.0054, speed: 0,   speedTarget: 0,   fuel: 45,  engineTemp: 72,  rpm: 0,    active: true,  bearingRad: 1.2 },
  { id: '3', lat: 39.9334, lng: 32.8597, speed: 95,  speedTarget: 98,  fuel: 28,  engineTemp: 105, rpm: 3200, active: true,  bearingRad: 2.7 }, // alarm
  { id: '4', lat: 38.4237, lng: 27.1428, speed: 0,   speedTarget: 0,   fuel: 61,  engineTemp: 20,  rpm: 0,    active: false, bearingRad: 0 },   // offline
  { id: '5', lat: 40.7978, lng: 29.4249, speed: 72,  speedTarget: 70,  fuel: 88,  engineTemp: 87,  rpm: 2100, active: true,  bearingRad: 3.9 },
  { id: '6', lat: 40.1980, lng: 29.0610, speed: 0,   speedTarget: 0,   fuel: 15,  engineTemp: 20,  rpm: 0,    active: false, bearingRad: 0 },   // offline, low fuel
];

const TICK_S = TIMING.MOCK_UPDATE_INTERVAL_MS / 1000;

export class MockRealtimeEngine extends BaseRealtimeEngine {
  private timer: ReturnType<typeof setInterval> | null = null;
  private sim: SimVehicle[] = INITIAL_SIM.map((v) => ({ ...v }));
  private tick = 0;

  connect(): void {
    this.cb.onConnectionChange('connecting');
    setTimeout(() => {
      this.cb.onConnectionChange('connected');
      this.timer = setInterval(() => this.simulate(), TIMING.MOCK_UPDATE_INTERVAL_MS);
    }, 350);
  }

  disconnect(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.cb.onConnectionChange('disconnected');
  }

  private simulate(): void {
    this.tick++;

    // Re-randomize speed targets periodically
    if (this.tick % 10 === 0) {
      this.sim[0].speedTarget = 25 + Math.random() * 50;
      this.sim[1].speedTarget = Math.random() > 0.4 ? 0 : 15 + Math.random() * 20;
      this.sim[2].speedTarget = 88 + Math.random() * 18; // stays in alarm range
      this.sim[4].speedTarget = 55 + Math.random() * 35;
      // drift bearings slightly
      for (const v of this.sim) {
        v.bearingRad += (Math.random() - 0.5) * 0.3;
      }
    }

    for (const v of this.sim) {
      if (!v.active) continue;

      // Speed toward target with noise
      v.speed = clamp(
        lerp(v.speed, v.speedTarget, 0.18) + (Math.random() - 0.5) * 2.5,
        0, 130
      );

      // Move position: speed km/h → degrees per tick (1° lat ≈ 111 km)
      const degPerTick = (v.speed / 111_000) * TICK_S;
      v.lat += Math.cos(v.bearingRad) * degPerTick;
      v.lng += Math.sin(v.bearingRad) * degPerTick;

      // Fuel drains: ~1% per 125 updates (~3 min at 1.5s interval)
      v.fuel = clamp(v.fuel - 0.008, 0, 100);

      // Engine temp follows speed with inertia
      const tempTarget = v.speed > 2 ? 78 + v.speed * 0.36 : 20;
      v.engineTemp = clamp(
        lerp(v.engineTemp, tempTarget, 0.04) + (Math.random() - 0.5) * 0.5,
        18, 130
      );

      // RPM roughly follows speed
      v.rpm = Math.max(0, Math.round(v.speed * 36 + (Math.random() - 0.5) * 300));

      this.cb.onUpdate({
        vehicleId: v.id,
        lat:         +v.lat.toFixed(6),
        lng:         +v.lng.toFixed(6),
        speed:       +v.speed.toFixed(1),
        fuel:        +v.fuel.toFixed(1),
        engineTemp:  +v.engineTemp.toFixed(1),
        rpm:         v.rpm,
        timestamp:   Date.now(),
      });
    }
  }
}

// ── Supabase Realtime engine ─────────────────────────────────────────────────
// Activated automatically when NEXT_PUBLIC_SUPABASE_URL + ANON_KEY are set.
// Subscribes to the broadcast channel 'vehicle-updates' and listens for
// events named 'v:{vehicleId}' that are emitted by /api/vehicle/update.

export class SupabaseRealtimeEngine extends BaseRealtimeEngine {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private channel: any = null;
  private vehicleIds: string[] = [];
  // Zero-leak: prevents connect() promise from completing after disconnect()
  private _alive = false;

  /** Pass the vehicleIds the current user is subscribed to. */
  setVehicleIds(ids: string[]) { this.vehicleIds = ids; }

  connect(): void {
    this._alive = true;
    this.cb.onConnectionChange('connecting');

    // Dynamic import avoids pulling supabase-js into mock-mode bundles
    import('@/lib/supabase').then(({ supabaseBrowser }) => {
      // Guard: disconnect() may have been called before promise resolved
      if (!this._alive) return;

      if (!supabaseBrowser) {
        this.cb.onConnectionChange('error');
        return;
      }

      this.channel = supabaseBrowser.channel('vehicle-updates');

      for (const id of this.vehicleIds) {
        this.channel.on('broadcast', { event: `v:${id}` }, ({ payload }: { payload: unknown }) => {
          if (!this._alive) return; // discard late events after disconnect
          const update = payload as import('@/types/realtime').VehicleUpdate;
          this.cb.onUpdate(update);
        });
      }

      this.channel.subscribe((status: string) => {
        if (!this._alive) return;
        if (status === 'SUBSCRIBED')    this.cb.onConnectionChange('connected');
        if (status === 'CHANNEL_ERROR') this.cb.onConnectionChange('error');
        if (status === 'CLOSED')        this.cb.onConnectionChange('disconnected');
      });
    });
  }

  disconnect(): void {
    this._alive = false; // blocks any in-flight connect() from completing

    if (this.channel) {
      const ch = this.channel;
      this.channel = null;
      import('@/lib/supabase').then(({ supabaseBrowser }) => {
        supabaseBrowser?.removeChannel(ch);
      });
    }

    this.cb.onConnectionChange('disconnected');
  }
}

// ── Factory ──────────────────────────────────────────────────────────────────
// Returns SupabaseRealtimeEngine when Supabase env vars are present,
// otherwise falls back to the in-process Mock simulation.

export function createRealtimeEngine(
  callbacks: RealtimeCallbacks,
  vehicleIds?: string[],
): BaseRealtimeEngine {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (url) {
    const engine = new SupabaseRealtimeEngine(callbacks);
    engine.setVehicleIds(vehicleIds ?? []);
    return engine;
  }
  return new MockRealtimeEngine(callbacks);
}
