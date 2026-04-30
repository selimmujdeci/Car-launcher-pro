/**
 * VehicleSignalResolver — Worker bridge katmanı.
 *
 * Ağır hesaplama VehicleCompute.worker'a taşındı.
 * Bu sınıf yalnızca:
 *   1. Adaptör callback'lerini worker'a iletir (postMessage)
 *   2. Worker'dan gelen STATE_UPDATE mesajlarını onResolved abonelerine dağıtır
 *   3. ODO_UPDATE → Zustand, VEHICLE_EVENT → VehicleEventHub dispatcher'ına yönlendirir
 *
 * Dışarıya açık arayüz (onResolved) değişmemiştir — TelemetryService ve
 * index.ts RAF batcher uyumsuz kalmaz.
 */

import type { CanAdapter } from './CanAdapter';
import type { ObdAdapter } from './ObdAdapter';
import type { GpsAdapter } from './GpsAdapter';
import type { VehicleState, WorkerGeofenceZone } from './types';
import { useVehicleStore } from './VehicleStateStore';
import { dispatchFromWorker } from './VehicleEventHub';
import type { WorkerInMessage, WorkerOutMessage } from './VehicleCompute.worker';

type Callback = (patch: Partial<VehicleState>) => void;

// ── SAB layout (Worker ile senkron) ──────────────────────────────────────
const SAB_BYTES    = 64;
const SAB_SPEED    = 0;  // Float64[0]
const SAB_RPM      = 1;  // Float64[1]
const SAB_FUEL     = 2;  // Float64[2]
const SAB_ODO      = 3;  // Float64[3]
const SAB_REVERSE  = 4;  // Float64[4]
// Float64[5] = lastUpdateTs — Worker yazar, Resolver okumaz (gen counter yeterli)
const SAB_GEN_IDX  = 12; // Int32[12] at byte 48 — Atomics generation counter

export class VehicleSignalResolver {
  private _listeners = new Set<Callback>();
  private _unsubs:    Array<() => void> = [];
  private _worker:    Worker;
  private _started    = false;

  // SAB zero-copy channel — null when fallback (old WebView / no COOP+COEP)
  private _sab:       SharedArrayBuffer | null = null;
  private _sabF64:    Float64Array | null      = null;
  private _sabI32:    Int32Array   | null      = null;
  private _sabLastGen = 0;
  private _sabPrev    = { speed: NaN, rpm: NaN, fuel: NaN, odo: NaN, reverse: NaN };
  private _rafHandle: number | null = null;

  private can: CanAdapter;
  private obd: ObdAdapter;
  private gps: GpsAdapter;

  constructor(can: CanAdapter, obd: ObdAdapter, gps: GpsAdapter) {
    this.can = can;
    this.obd = obd;
    this.gps = gps;
    this._worker = new Worker(
      new URL('./VehicleCompute.worker.ts', import.meta.url),
      { type: 'module' },
    );
    this._worker.addEventListener('message', this._onWorkerMessage.bind(this));
  }

  start(): void {
    if (this._started) return;
    this._started = true;

    const odoKm = useVehicleStore.getState().odometer ?? 0;

    // SAB desteği: crossOriginIsolated (COOP+COEP) + SharedArrayBuffer varlığı
    // Mali-400 gibi eski WebView'larda bu kontrol false döner → postMessage fallback
    const sabSupported =
      typeof SharedArrayBuffer !== 'undefined' &&
      (typeof crossOriginIsolated !== 'undefined' ? crossOriginIsolated : false);

    if (sabSupported) {
      this._sab    = new SharedArrayBuffer(SAB_BYTES);
      this._sabF64 = new Float64Array(this._sab);
      this._sabI32 = new Int32Array(this._sab);
      this._send({ type: 'INIT', odoKm, sab: this._sab });
      this._startSabPolling();
    } else {
      this._send({ type: 'INIT', odoKm });
    }

    // Adaptör callback'leri → worker postMessage
    // Not: CanAdapter pre-allocated _data nesnesini geçirir; postMessage onu klonlar.
    this._unsubs.push(
      this.can.onData((d) => this._send({ type: 'CAN_DATA', payload: d })),
      this.obd.onData((d) => this._send({ type: 'OBD_DATA', payload: d })),
      this.gps.onData((d) => this._send({ type: 'GPS_DATA', payload: d })),
    );

    this.can.start();
    this.obd.start();
    this.gps.start();
  }

  stop(): void {
    this._started = false;
    this._stopSabPolling();
    this.can.stop();
    this.obd.stop();
    this.gps.stop();
    this._unsubs.forEach((fn) => fn());
    this._unsubs = [];
    this._listeners.clear();
    this._send({ type: 'STOP' });
    this._worker.terminate();
  }

  onResolved(cb: Callback): () => void {
    this._listeners.add(cb);
    return () => { this._listeners.delete(cb); };
  }

  /** Geofence zona listesini Worker'a ilet. */
  sendGeofence(zones: WorkerGeofenceZone[]): void {
    this._send({ type: 'UPDATE_GEOFENCE', zones });
  }

  /**
   * Crash recovery: native storage'dan kurtarılan km değerini worker'a ilet.
   * Worker yalnızca mevcut _odoKm'den büyükse uygular (Strict Monotonicity).
   */
  restoreOdometer(km: number): void {
    this._send({ type: 'RESTORE_ODO', km });
  }

  // ── SAB polling (RAF-based, ~60fps) ────────────────────────────────────
  //
  // Worker tek-yazardır; Atomics.store gen counter → release fence.
  // UI: Atomics.load gen counter → acquire fence; ardından Float64 okur.
  // Sadece değişen alanları patch'e ekler → index.ts RAF batcher minimum iş yapar.
  // reverse değişince index.ts'nin immediate-flush mantığı tetiklenir.

  private _startSabPolling(): void {
    const tick = () => {
      if (this._sabI32 && this._sabF64) {
        const gen = Atomics.load(this._sabI32, SAB_GEN_IDX);
        if (gen !== this._sabLastGen) {
          this._sabLastGen = gen;
          const f64    = this._sabF64;
          const prev   = this._sabPrev;
          const patch: Partial<VehicleState> = {};
          let   changed = false;

          // Object.is: NaN===NaN doğru karşılaştırır; NaN=null sentinel (tüm kaynaklar stale)
          const speedRaw = f64[SAB_SPEED];
          if (!Object.is(speedRaw, prev.speed)) {
            patch.speed = Number.isNaN(speedRaw) ? null : speedRaw;
            prev.speed  = speedRaw;
            changed     = true;
          }

          const rpm = f64[SAB_RPM];
          if (!Object.is(rpm, prev.rpm)) { patch.rpm = rpm; prev.rpm = rpm; changed = true; }

          const fuelRaw = f64[SAB_FUEL];
          if (!Object.is(fuelRaw, prev.fuel)) {
            patch.fuel = Number.isNaN(fuelRaw) ? null : fuelRaw;
            prev.fuel  = fuelRaw;
            changed    = true;
          }

          const odo = f64[SAB_ODO];
          if (odo !== prev.odo)     { patch.odometer = odo; prev.odo   = odo;   changed = true; }

          const revRaw = f64[SAB_REVERSE];
          if (revRaw !== prev.reverse) {
            patch.reverse  = revRaw !== 0;
            prev.reverse   = revRaw;
            changed        = true;
          }

          if (changed) this._listeners.forEach((fn) => fn(patch));
        }
      }
      this._rafHandle = requestAnimationFrame(tick);
    };
    this._rafHandle = requestAnimationFrame(tick);
  }

  private _stopSabPolling(): void {
    if (this._rafHandle !== null) {
      cancelAnimationFrame(this._rafHandle);
      this._rafHandle = null;
    }
  }

  private _send(msg: WorkerInMessage): void {
    this._worker.postMessage(msg);
  }

  private _onWorkerMessage(e: MessageEvent): void {
    const msg = e.data as WorkerOutMessage;
    switch (msg.type) {
      case 'STATE_UPDATE':
        this._listeners.forEach((fn) => fn(msg.patch));
        break;
      case 'ODO_UPDATE':
        useVehicleStore.getState().updateVehicle({ odometer: msg.odoKm });
        break;
      case 'VEHICLE_EVENT':
        dispatchFromWorker(msg.event);
        break;
    }
  }
}
