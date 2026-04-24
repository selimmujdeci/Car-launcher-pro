import type { CanAdapter } from './CanAdapter';
import type { ObdAdapter } from './ObdAdapter';
import type { GpsAdapter } from './GpsAdapter';
import type { CanAdapterData, ObdAdapterData, GpsAdapterData, VehicleState } from './types';
import { useVehicleStore } from './VehicleStateStore';
import {
  DEBUG_ENABLED,
  dbgPushReverse,
  dbgUpdateSignal,
  dbgUpdateFallback,
  dbgUpdateListenerCount,
  dbgIncrementDropped,
} from '../debug';

type Callback = (patch: Partial<VehicleState>) => void;

const SPEED_MAX = 300;
const SPEED_INTERVAL_MS = 100;
const FUEL_INTERVAL_MS = 5000;
// Anti-jitter: 100ms içinde ±20 km/h'yi aşan ani sıçramayı sensör gürültüsü say
const ANTI_JITTER_KMH = 20;

// Reverse confidence thresholds
const OBD_REVERSE_STABILITY_MS = 500;
const REVERSE_DEBOUNCE_MS = 300;

// Source staleness timeouts
const SRC_TIMEOUT_CAN_MS = 3_000;
const SRC_TIMEOUT_OBD_MS = 10_000;
const SRC_TIMEOUT_GPS_MS = 5_000;
const WATCHDOG_INTERVAL_MS = 1_000;

export class VehicleSignalResolver {
  private _listeners = new Set<Callback>();
  private _unsubs: Array<() => void> = [];
  private _timers: ReturnType<typeof setInterval>[] = [];

  private _can: CanAdapterData = {};
  private _obd: ObdAdapterData = {};
  private _gps: GpsAdapterData = {};

  // Reverse confidence state
  private _revDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private _obdRevCandidate: boolean | null = null;
  private _obdRevStableTimer: ReturnType<typeof setTimeout> | null = null;
  private _lastKnownSpeed = 0;

  // Source staleness tracking (0 = never seen)
  private _canLastSeen = 0;
  private _obdLastSeen = 0;
  private _gpsLastSeen = 0;

  private _started = false;

  private can: CanAdapter;
  private obd: ObdAdapter;
  private gps: GpsAdapter;

  constructor(can: CanAdapter, obd: ObdAdapter, gps: GpsAdapter) {
    this.can = can;
    this.obd = obd;
    this.gps = gps;
  }

  start(): void {
    if (this._started) return; // double-init guard
    this._started = true;
    this._unsubs.push(
      this.can.onData((d) => {
        this._can = d;
        this._canLastSeen = Date.now();
        if (d.reverse != null) this._handleCanReverse(d.reverse);
      }),
      this.obd.onData((d) => {
        this._obd = d;
        this._obdLastSeen = Date.now();
        if (d.reverse != null) this._handleObdReverse(d.reverse);
      }),
      this.gps.onData((d) => {
        this._gps = d;
        this._gpsLastSeen = Date.now();
        // GPS reverse is intentionally ignored
        this._emitGps();
      }),
    );

    this._timers.push(
      setInterval(() => this._emitSpeed(), SPEED_INTERVAL_MS),
      setInterval(() => this._emitFuel(), FUEL_INTERVAL_MS),
      setInterval(() => this._watchdog(), WATCHDOG_INTERVAL_MS),
    );

    this.can.start();
    this.obd.start();
    this.gps.start();
  }

  stop(): void {
    this._started = false;
    this.can.stop();
    this.obd.stop();
    this.gps.stop();
    this._unsubs.forEach((fn) => fn());
    this._timers.forEach((t) => clearInterval(t));
    this._clearReverseTimers();
    this._unsubs = [];
    this._timers = [];
    this._listeners.clear();
  }

  onResolved(cb: Callback): () => void {
    this._listeners.add(cb);
    if (DEBUG_ENABLED) dbgUpdateListenerCount(this._listeners.size);
    return () => {
      this._listeners.delete(cb);
      if (DEBUG_ENABLED) dbgUpdateListenerCount(this._listeners.size);
    };
  }

  // CAN: trusted source — skip stability check, go straight to debounce.
  // Defense in depth: also reject reverse=true when speed > 5 km/h (native guards this too).
  private _handleCanReverse(value: boolean): void {
    if (value && this._lastKnownSpeed > 5) {
      if (DEBUG_ENABLED) dbgPushReverse('CAN', value, this._lastKnownSpeed, 'rejected', `speed ${this._lastKnownSpeed.toFixed(1)} km/h > 5`);
      return;
    }
    if (DEBUG_ENABLED) dbgPushReverse('CAN', value, this._lastKnownSpeed, 'accepted', 'debouncing');
    this._clearObdRevStability();
    this._debounceReverse(value, 'CAN');
  }

  // OBD: must hold the same value for 500ms before considered valid
  private _handleObdReverse(value: boolean): void {
    if (this._obdRevCandidate === value) return;
    this._obdRevCandidate = value;

    if (this._obdRevStableTimer != null) clearTimeout(this._obdRevStableTimer);
    this._obdRevStableTimer = setTimeout(() => {
      this._obdRevStableTimer = null;
      if (DEBUG_ENABLED) dbgPushReverse('OBD', value, this._lastKnownSpeed, 'accepted', 'stability 500ms passed');
      this._debounceReverse(value, 'OBD');
    }, OBD_REVERSE_STABILITY_MS);
  }

  // Final gate: debounce the resolved reverse value before emitting
  private _debounceReverse(value: boolean, source: 'CAN' | 'OBD'): void {
    if (this._revDebounceTimer != null) clearTimeout(this._revDebounceTimer);
    this._revDebounceTimer = setTimeout(() => {
      this._revDebounceTimer = null;
      this._emit({ reverse: value });
      if (DEBUG_ENABLED) {
        dbgUpdateSignal('reverse', String(value), source);
        dbgPushReverse(source, value, this._lastKnownSpeed, 'accepted', 'committed after debounce');
      }
    }, REVERSE_DEBOUNCE_MS);
  }

  private _clearObdRevStability(): void {
    if (this._obdRevStableTimer != null) clearTimeout(this._obdRevStableTimer);
    this._obdRevStableTimer = null;
    this._obdRevCandidate = null;
  }

  private _alive(lastSeen: number, timeout: number): boolean {
    return lastSeen > 0 && Date.now() - lastSeen < timeout;
  }

  // Watchdog: if CAN + OBD both stale, force reverse=false to prevent stuck overlay
  private _watchdog(): void {
    const canAlive = this._alive(this._canLastSeen, SRC_TIMEOUT_CAN_MS);
    const obdAlive = this._alive(this._obdLastSeen, SRC_TIMEOUT_OBD_MS);
    const gpsAlive = this._alive(this._gpsLastSeen, SRC_TIMEOUT_GPS_MS);
    if (!canAlive && !obdAlive) {
      this._clearReverseTimers();
      this._emit({ reverse: false });
    }
    if (DEBUG_ENABLED) {
      dbgUpdateFallback(
        canAlive, obdAlive, gpsAlive,
        this._canLastSeen, this._obdLastSeen, this._gpsLastSeen,
      );
    }
  }

  private _clearReverseTimers(): void {
    this._clearObdRevStability();
    if (this._revDebounceTimer != null) clearTimeout(this._revDebounceTimer);
    this._revDebounceTimer = null;
  }

  private _emit(patch: Partial<VehicleState>): void {
    this._listeners.forEach((fn) => fn(patch));
  }

  private _emitSpeed(): void {
    let raw: number | undefined;
    let src: 'CAN' | 'OBD' | 'GPS' | 'NONE' = 'NONE';
    if (this._alive(this._canLastSeen, SRC_TIMEOUT_CAN_MS)) {
      raw = this._can.speed; src = 'CAN';
    } else if (this._alive(this._obdLastSeen, SRC_TIMEOUT_OBD_MS)) {
      raw = this._obd.speed; src = 'OBD';
    } else if (this._alive(this._gpsLastSeen, SRC_TIMEOUT_GPS_MS)) {
      raw = this._gps.speed; src = 'GPS';
    }
    if (raw == null) return;
    if (raw < 0 || raw > SPEED_MAX) {
      if (DEBUG_ENABLED) dbgIncrementDropped(src === 'NONE' ? 'CAN' : src);
      return;
    }
    // Anti-jitter: araç sıfırdan farklıysa 100ms'de ±20 km/h'yi aşan sıçramayı reddet
    if (raw > 0 && this._lastKnownSpeed > 0 &&
        Math.abs(raw - this._lastKnownSpeed) > ANTI_JITTER_KMH) {
      if (DEBUG_ENABLED) dbgIncrementDropped(src === 'NONE' ? 'CAN' : src);
      return;
    }
    this._lastKnownSpeed = raw;

    // Odometer accumulation — deltaKm = speed(km/h) × 100ms interval
    const store = useVehicleStore.getState();
    store.updateVehicle({ odometer: store.odometer + raw * (100 / 3_600_000) });

    this._emit({ speed: raw });
    if (DEBUG_ENABLED) dbgUpdateSignal('speed', `${raw.toFixed(1)} km/h`, src);
  }

  private _emitFuel(): void {
    let raw: number | undefined;
    let src: 'CAN' | 'OBD' | 'NONE' = 'NONE';
    if (this._alive(this._canLastSeen, SRC_TIMEOUT_CAN_MS)) {
      raw = this._can.fuel; src = 'CAN';
    } else if (this._alive(this._obdLastSeen, SRC_TIMEOUT_OBD_MS)) {
      raw = this._obd.fuel; src = 'OBD';
    }
    if (raw == null) return;
    if (raw < 0 || raw > 100) {
      if (DEBUG_ENABLED) dbgIncrementDropped(src === 'NONE' ? 'OBD' : src);
      return;
    }
    this._emit({ fuel: raw });
    if (DEBUG_ENABLED) dbgUpdateSignal('fuel', `${raw.toFixed(1)} %`, src);
  }

  private _emitGps(): void {
    const patch: Partial<VehicleState> = {};
    if (this._gps.heading != null) {
      patch.heading = this._gps.heading;
      if (DEBUG_ENABLED) dbgUpdateSignal('heading', `${this._gps.heading.toFixed(1)}°`, 'GPS');
    }
    if (this._gps.location != null) {
      patch.location = this._gps.location;
      if (DEBUG_ENABLED) {
        const { lat, lng } = this._gps.location;
        dbgUpdateSignal('location', `${lat.toFixed(5)}, ${lng.toFixed(5)}`, 'GPS');
      }
    }
    if (Object.keys(patch).length) this._emit(patch);
  }
}
