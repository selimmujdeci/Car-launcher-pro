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
import { useUnifiedVehicleStore } from './UnifiedVehicleStore';
import { initSABChannel, clearSABChannel } from './sabChannel';
import { dispatchFromWorker } from './VehicleEventHub';
import type { WorkerInMessage, WorkerOutMessage } from './VehicleCompute.worker';
import { SignalNormalizer } from '../../core/val/SignalNormalizer';
import { logError }         from '../crashLogger';
import { applyProfileGate, setGateOutcome } from '../canBus/ProfileSignalGate';
import type { HandshakeOutcome }            from '../canBus/VehicleHandshake';
import { runtimeManager }   from '../../core/runtime/AdaptiveRuntimeManager';
import { NativeHALAdapter } from './NativeHALAdapter';
import { useHALStatusStore } from './halStatusStore';
import { healthMonitor }    from '../system/SystemHealthMonitor';

type Callback = (patch: Partial<VehicleState>) => void;

// ── SAB layout (Worker ile senkron — CACHE-LINE PADDING + SEQLOCK) ────────
// Her 64-bit değer ayrı 64-byte cache line'da (False Sharing yok). GEN ayrı
// cache line'da (byte 384). SAB_BYTES, padding'i kapsayacak şekilde 512.
const SAB_BYTES    = 512;
const SAB_SPEED    = 0;   // Float64[0]  byte 0
const SAB_RPM      = 8;   // Float64[8]  byte 64
const SAB_FUEL     = 16;  // Float64[16] byte 128
const SAB_ODO      = 24;  // Float64[24] byte 192
const SAB_REVERSE  = 32;  // Float64[32] byte 256
// Float64[40] = lastUpdateTs — Worker yazar, Resolver okumaz
const SAB_GEN_IDX  = 96;  // Int32[96] byte 384 — Seqlock generation counter (ayrı cache line)

export class VehicleSignalResolver {
  private _listeners = new Set<Callback>();
  private _unsubs:    Array<() => void> = [];
  private _worker:    Worker | null = null;
  private _started    = false;
  private readonly _onCrash?: () => void;
  // Bound referans saklanır → removeEventListener doğru çalışsın
  private _onWorkerMessageBound: ((e: MessageEvent) => void) | null = null;

  // SAB zero-copy channel — null when fallback (old WebView / no COOP+COEP)
  private _sab:       SharedArrayBuffer | null = null;
  private _sabF64:    Float64Array | null      = null;
  private _sabI32:    Int32Array   | null      = null;
  private _sabLastGen = 0;
  private _sabPrev    = { speed: NaN, rpm: NaN, fuel: NaN, odo: NaN, reverse: NaN };
  private _rafHandle: number | null = null;
  private _pollInterval: ReturnType<typeof setInterval> | null = null;

  private can: CanAdapter;
  private obd: ObdAdapter;
  private gps: GpsAdapter;
  private hal: NativeHALAdapter;

  constructor(can: CanAdapter, obd: ObdAdapter, gps: GpsAdapter, onCrash?: () => void) {
    this.can = can;
    this.obd = obd;
    this.gps = gps;
    this.hal = new NativeHALAdapter();
    this._onCrash = onCrash;
    this._worker = new Worker(
      new URL('./VehicleCompute.worker.ts', import.meta.url),
      { type: 'module' },
    );
    this._onWorkerMessageBound = this._onWorkerMessage.bind(this);
    this._worker.addEventListener('message', this._onWorkerMessageBound);
    this._worker.onerror = (err) => {
      logError('VehicleCompute:onerror', new Error(err.message ?? 'Worker crash'));
      runtimeManager.reportFailure('VehicleCompute');
      runtimeManager.unregisterWorker('VehicleCompute');
      this._onWorkerMessageBound = null; // crash path'te referansı temizle
      this._worker = null;
      this._onCrash?.();
    };
  }

  start(): void {
    if (this._started) return;
    this._started = true;
    runtimeManager.registerWorker('VehicleCompute', this._worker, 'CRITICAL');

    const odoKm = useUnifiedVehicleStore.getState().odometer ?? 0;

    // SAB desteği: typeof yeterli değil — crossOriginIsolated (COOP+COEP) zorunlu.
    // Mali-400 / Android eski WebView'larda SAB tanımlı olsa bile engellenebilir.
    const sabSupported =
      typeof SharedArrayBuffer !== 'undefined' &&
      self.crossOriginIsolated === true;

    if (sabSupported) {
      this._sab    = new SharedArrayBuffer(SAB_BYTES);
      this._sabF64 = new Float64Array(this._sab);
      this._sabI32 = new Int32Array(this._sab);
      initSABChannel(this._sabF64, this._sabI32); // gauge bileşenlerine aç
      this._send({ type: 'INIT', odoKm, sab: this._sab });
      this._startSabPolling();
    } else {
      // crossOriginIsolated=false → SAB kullanılamaz; postMessage fallback (Zero-Crash)
      this._send({ type: 'INIT_FALLBACK', odoKm });
    }

    // ── VAL yolu: SignalNormalizer → VEHICLE_DATA ────────────────────────
    // Adaptör ham verisi önce normalize edilir; worker NormalizedVehicleData alır.
    // Birim dönüşümü (GpsAdapter: m/s→km/h, deadzone) SignalNormalizer'da yapılır.
    // GpsAdapterData.speed artık ham m/s içerir (GpsAdapter dönüşüm yapmaz).
    this._unsubs.push(
      this.can.onData((d) => {
        const signals = SignalNormalizer.fromCAN(applyProfileGate(d), Date.now());
        this._send({ type: 'VEHICLE_DATA', source: 'CAN', signals });
      }),
      this.obd.onData((d) => {
        const signals = SignalNormalizer.fromOBD(d, Date.now());
        this._send({ type: 'VEHICLE_DATA', source: 'OBD', signals });
      }),
      this.gps.onData((d) => {
        // GpsAdapterData.speed ham m/s — RawGpsData formatına çevir
        const signals = SignalNormalizer.fromGPS(
          { speedMs: d.speed, heading: d.heading, location: d.location },
          Date.now(),
        );
        this._send({ type: 'VEHICLE_DATA', source: 'GPS', signals });
      }),
    );

    // ── HAL yolu: CONF_HAL=0.98 → fusion'da CAN/OBD'yi override eder ─────────
    this._unsubs.push(
      this.hal.onData((d) => {
        const signals = SignalNormalizer.fromHAL(d, Date.now());
        this._send({ type: 'VEHICLE_DATA', source: 'HAL', signals });
      }),
    );
    this.hal.start();

    this.can.start();
    this.obd.start();
    this.gps.start();
  }

  stop(): void {
    this._started = false;
    clearSABChannel();
    this._stopSabPolling();
    this.can.stop();
    this.obd.stop();
    this.gps.stop();
    this.hal.stop();
    this._unsubs.forEach((fn) => fn());
    this._unsubs = [];
    this._listeners.clear();
    runtimeManager.unregisterWorker('VehicleCompute');
    this._send({ type: 'STOP' });
    // Listener'ı terminate'ten ÖNCE kaldır — deterministik temizlik
    if (this._worker && this._onWorkerMessageBound) {
      this._worker.removeEventListener('message', this._onWorkerMessageBound);
    }
    this._onWorkerMessageBound = null;
    this._worker?.terminate();
    this._worker = null;
  }

  onResolved(cb: Callback): () => void {
    this._listeners.add(cb);
    return () => { this._listeners.delete(cb); };
  }

  /** Geofence zona listesini Worker'a ilet. */
  sendGeofence(zones: WorkerGeofenceZone[]): void {
    this._send({ type: 'UPDATE_GEOFENCE', zones });
  }

  /** DEV-only kaos: worker'a bit-flip enjekte et (TMR median recovery testi). */
  chaosBitflip(): void {
    if (!import.meta.env.DEV) return;
    this._send({ type: 'CHAOS_BITFLIP' });
  }

  /**
   * VehicleHandshake tamamlandığında çağrılır.
   * Profile gate'i günceller — Safe Mode aktifse CAN-only sinyaller kesilir.
   */
  setHandshakeOutcome(outcome: HandshakeOutcome): void {
    setGateOutcome(outcome);
  }

  /**
   * Crash recovery: native storage'dan kurtarılan km değerini worker'a ilet.
   * Worker yalnızca mevcut _odoKm'den büyükse uygular (Strict Monotonicity).
   */
  restoreOdometer(km: number): void {
    this._send({ type: 'RESTORE_ODO', km });
  }

  // ── SAB polling — 50ms throttle (20Hz max) ──────────────────────────────────
  //
  // Head unit perf budget: rAF ~60fps yerine setInterval ile 20Hz throttle.
  // Gen counter zaten değişim takibi yaptığı için gereksiz frame'ler atlanır.
  // Worker tek-yazardır; Atomics.store gen counter → release fence.
  // UI: Atomics.load gen counter → acquire fence; ardından Float64 okur.
  // Sadece değişen alanları patch'e ekler → index.ts RAF batcher minimum iş yapar.
  // reverse değişince index.ts'nin immediate-flush mantığı tetiklenir.

  private _startSabPolling(): void {
    // Polling aralığını runtime moduna göre türet: Mali-400 (BASIC_JS/20fps) → 50ms,
    // BALANCED/30fps → 33ms, PERFORMANCE/60fps → 16ms, SAFE_MODE → 100ms.
    // Sabit 50ms yerine dinamik → düşük-uç cihazlarda CPU/GPU rahatlar.
    const fps         = runtimeManager.getConfig().uiFpsTarget;
    const intervalMs  = Math.max(16, Math.round(1000 / fps));
    this._pollInterval = setInterval(() => {
      if (!this._sabI32 || !this._sabF64) return;
      const i32 = this._sabI32;
      const f64 = this._sabF64;

      // ── Seqlock acquire ──────────────────────────────────────────────────
      // 1) Başlangıç counter'ını oku. TEK ise Worker yazım ortasında → bu tiki atla.
      const g1 = Atomics.load(i32, SAB_GEN_IDX);
      if ((g1 & 1) !== 0) return;            // odd → write in progress
      if (g1 === this._sabLastGen) return;   // değişim yok

      // 2) Verileri yerel primitiflere oku (zero-allocation — stack üstünde).
      const speedRaw = f64[SAB_SPEED];
      const rpmRaw   = f64[SAB_RPM];
      const fuelRaw  = f64[SAB_FUEL];
      const odoRaw   = f64[SAB_ODO];
      const revRaw   = f64[SAB_REVERSE];

      // 3) Bitiş counter'ını oku. Başlangıç != bitiş → okuma sırasında yazım oldu
      //    (Torn Read). Okumayı GEÇERSİZ say: önceki değerleri koru, _sabLastGen'i
      //    GÜNCELLEME → sonraki tik (yazım bitince) temiz okur.
      const g2 = Atomics.load(i32, SAB_GEN_IDX);
      if (g1 !== g2) return;

      this._sabLastGen = g1;

      const prev   = this._sabPrev;
      const patch: Partial<VehicleState> = {};
      let   changed = false;

      // Object.is: NaN===NaN doğru karşılaştırır; NaN=null sentinel (tüm kaynaklar stale)
      if (!Object.is(speedRaw, prev.speed)) {
        patch.speed = Number.isNaN(speedRaw) ? null : speedRaw;
        prev.speed  = speedRaw;
        changed    = true;
      }

      if (!Object.is(rpmRaw, prev.rpm)) { patch.rpm = rpmRaw; prev.rpm = rpmRaw; changed = true; }

      if (!Object.is(fuelRaw, prev.fuel)) {
        patch.fuel = Number.isNaN(fuelRaw) ? null : fuelRaw;
        prev.fuel  = fuelRaw;
        changed    = true;
      }

      if (odoRaw !== prev.odo)     { patch.odometer = odoRaw; prev.odo   = odoRaw;   changed = true; }

      if (revRaw !== prev.reverse) {
        patch.reverse  = revRaw !== 0;
        prev.reverse   = revRaw;
        changed        = true;
      }

      if (changed) this._listeners.forEach((fn) => fn(patch));
    }, intervalMs);
  }

  private _stopSabPolling(): void {
    if (this._pollInterval !== null) {
      clearInterval(this._pollInterval);
      this._pollInterval = null;
    }
    // Legacy rAF cleanup (varsa)
    if (this._rafHandle !== null) {
      cancelAnimationFrame(this._rafHandle);
      this._rafHandle = null;
    }
  }

  private _send(msg: WorkerInMessage): void {
    this._worker?.postMessage(msg);
  }

  private _onWorkerMessage(e: MessageEvent): void {
    const msg = e.data as WorkerOutMessage;
    switch (msg.type) {
      case 'STATE_UPDATE':
        // Active source değişimini halStatusStore'a yansıt (InspectorPanel okur)
        if (msg.patch.nativeSource) {
          useHALStatusStore.getState().setActiveSource(msg.patch.nativeSource);
        }
        this._listeners.forEach((fn) => fn(msg.patch));
        break;
      case 'ODO_UPDATE':
        useUnifiedVehicleStore.getState().updateVehicleState({ odometer: msg.odoKm });
        break;
      case 'VEHICLE_EVENT':
        dispatchFromWorker(msg.event);
        break;
      case 'GPS_FAILURE':
        // Worker GPS kalite arızası → HealthMonitor bilsin (garbage fix beat'i maskelemesin)
        healthMonitor.setGpsQuality(!msg.active, msg.accuracy);
        break;
    }
  }
}
