import { CanAdapter }          from './CanAdapter';
import { ObdAdapter }          from './ObdAdapter';
import { GpsAdapter }          from './GpsAdapter';
import { VehicleSignalResolver } from './VehicleSignalResolver';
import { telemetryService }    from '../telemetryService';
import { useVehicleStore }     from './VehicleStateStore';
import { startRemoteCommands, stopRemoteCommands } from '../remoteCommandService';
import { startLiveStyleEngine }                    from '../liveStyleEngine';
import type { VehicleState, WorkerGeofenceZone }   from './types';

export { useVehicleStore }                from './VehicleStateStore';
export { setRemoteCommandContext }        from '../remoteCommandService';
export { onVehicleEvent, dispatchMaintenanceRequired, dispatchCrashDetected } from './VehicleEventHub';
export type { VehicleEvent, VehicleEventType }         from './VehicleEventHub';
export type { VehicleState, WorkerGeofenceZone }       from './types';

// Resolver referansı — geofence güncellemelerini worker'a iletmek için
let _activeResolver: VehicleSignalResolver | null = null;

/**
 * Geofence zona listesini Worker'a gönderir.
 * startVehicleDataLayer() çağrısından önce çağrılırsa sessizce yok sayılır.
 */
export function updateGeofenceZones(zones: WorkerGeofenceZone[]): void {
  _activeResolver?.sendGeofence(zones);
}

/**
 * startVehicleDataLayer — OBD/GPS/CAN veri hattını, telemetri push'unu
 * ve uzaktan komut kanalını başlatır.
 *
 * RAF-Batched Zustand Güncellemeleri:
 *   VehicleCompute.worker'dan gelen STATE_UPDATE patch'leri pre-allocated
 *   bir "pending" nesnesinde birikir. requestAnimationFrame() tetiklendiğinde
 *   tüm değişiklikler tek setState olarak flush edilir → render sayısı azalır.
 *
 *   Güvenlik kritik exception: reverse state → hemen flush (kamera gecikmez).
 *
 * Semantik olaylar (DRIVING_STARTED, LOW_FUEL vb.) worker tarafından üretilir;
 * VehicleSignalResolver onları dispatchFromWorker() aracılığıyla onVehicleEvent
 * abonelerine doğrudan iletir — RAF'ı beklemez.
 *
 * Temizleme sırası: remote → liveStyle → telemetri → resolver (worker terminate)
 */
export function startVehicleDataLayer(): () => void {
  const can      = new CanAdapter();
  const obd      = new ObdAdapter();
  const gps      = new GpsAdapter();
  const resolver = new VehicleSignalResolver(can, obd, gps);
  _activeResolver = resolver;

  // ── RAF-Batched UI State Update ─────────────────────────────────────────
  const _pendingPatch: Partial<VehicleState & { odometer?: number }> = {};
  let   _hasPending  = false;
  let   _rafId       = 0;

  function _flush(): void {
    _rafId = 0;
    if (!_hasPending) return;
    _hasPending = false;
    useVehicleStore.getState().updateVehicle(_pendingPatch);
  }

  function _scheduleFlush(): void {
    if (_rafId) return;
    _rafId = requestAnimationFrame(_flush);
  }

  resolver.onResolved((patch) => {
    // Güvenlik kritik: reverse → anında flush (kamera gecikme olmaz)
    if ('reverse' in patch) {
      if (_rafId) { cancelAnimationFrame(_rafId); _rafId = 0; }
      _hasPending = false;
      if ('speed'    in _pendingPatch) patch = { ...patch, speed:    _pendingPatch.speed };
      if ('fuel'     in _pendingPatch) patch = { ...patch, fuel:     _pendingPatch.fuel };
      if ('heading'  in _pendingPatch) patch = { ...patch, heading:  _pendingPatch.heading };
      if ('location' in _pendingPatch) patch = { ...patch, location: _pendingPatch.location };
      useVehicleStore.getState().updateVehicle(patch);
      _pendingPatch.speed = _pendingPatch.fuel = _pendingPatch.heading = undefined;
      _pendingPatch.location = undefined;
      return;
    }

    if ('speed'    in patch) _pendingPatch.speed    = patch.speed;
    if ('fuel'     in patch) _pendingPatch.fuel      = patch.fuel;
    if ('heading'  in patch) _pendingPatch.heading   = patch.heading;
    if ('location' in patch) _pendingPatch.location  = patch.location;
    if ('odometer' in patch) _pendingPatch.odometer  = patch.odometer;
    _hasPending = true;

    _scheduleFlush();
  });

  // Telemetri push hattı — cloud push için gecikme kabul edilemez; RAF dışı
  telemetryService.start(resolver);

  // Uzaktan komut kanalı — Supabase Realtime
  void startRemoteCommands();

  // Live CSS custom property sync
  const cleanupLiveStyle = startLiveStyleEngine();

  resolver.start();

  return () => {
    if (_rafId) { cancelAnimationFrame(_rafId); _rafId = 0; }
    _hasPending = false;

    _activeResolver = null;
    stopRemoteCommands();
    cleanupLiveStyle();
    telemetryService.stop();
    resolver.stop(); // → worker'ı durdurur ve terminate eder
  };
}
