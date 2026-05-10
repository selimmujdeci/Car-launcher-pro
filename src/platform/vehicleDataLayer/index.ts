import { CanAdapter }          from './CanAdapter';
import { ObdAdapter }          from './ObdAdapter';
import { GpsAdapter }          from './GpsAdapter';
import { VehicleSignalResolver } from './VehicleSignalResolver';
import { telemetryService }    from '../telemetryService';
import { useUnifiedVehicleStore } from './UnifiedVehicleStore';
import { startRemoteCommands, stopRemoteCommands } from '../remoteCommandService';
import { startLiveStyleEngine }                    from '../liveStyleEngine';
import { updateGpsSpeedForValidation }             from '../obdService';
import type { VehicleState, WorkerGeofenceZone }   from './types';

export { useUnifiedVehicleStore }                 from './UnifiedVehicleStore';
export { useUnifiedVehicleStore as useVehicleStore } from './UnifiedVehicleStore'; // backward compat alias
export { setRemoteCommandContext }        from '../remoteCommandService';
export { onVehicleEvent, dispatchMaintenanceRequired, dispatchCrashDetected } from './VehicleEventHub';
export type { VehicleEvent, VehicleEventType }         from './VehicleEventHub';
export type { VehicleState, WorkerGeofenceZone }       from './types';
export type { GPSLocation }                            from './types';

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
 * Crash recovery: native storage'dan kurtarılan km değerini çalışan worker'a ilet.
 * VehicleSignalResolver henüz başlamamışsa sessizce yok sayılır.
 */
export function restoreOdometer(km: number): void {
  _activeResolver?.restoreOdometer(km);
}

/**
 * startVehicleDataLayer — OBD/GPS/CAN veri hattını, telemetri push'unu
 * ve uzaktan komut kanalını başlatır.
 *
 * RAF-Batched Zustand Güncellemeleri:
 *   VehicleCompute.worker'dan gelen STATE_UPDATE patch'leri pre-allocated
 *   bir "pending" nesnesinde birikir. requestAnimationFrame() tetiklendiğinde
 *   tüm değişiklikler tek updateVehicleState olarak flush edilir.
 *
 *   Güvenlik kritik exception: reverse state → hemen flush (kamera gecikmez).
 *
 * Heading ve location: GPS tarafı (gpsService mirror subscriber) yetkilidir;
 * worker'dan gelen heading/location patch'leri biriktirilmez.
 */
export function startVehicleDataLayer(): () => void {
  const can      = new CanAdapter();
  const obd      = new ObdAdapter();
  const gps      = new GpsAdapter();
  const resolver = new VehicleSignalResolver(can, obd, gps);
  _activeResolver = resolver;

  // ── RAF-Batched UI State Update ─────────────────────────────────────────
  // Yalnızca worker'dan gelen vehicle sinyalleri (speed, rpm, fuel, odometer, reverse)
  // biriktirilir; heading ve location GPS mirror'dan gelir.
  const _pendingPatch: Partial<VehicleState> = {};
  let   _hasPending  = false;
  let   _rafId       = 0;

  function _flush(): void {
    _rafId = 0;
    if (!_hasPending) return;
    _hasPending = false;
    useUnifiedVehicleStore.getState().updateVehicleState(_pendingPatch);
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
      const immediate: Partial<VehicleState> = { reverse: patch.reverse };
      if ('speed'    in _pendingPatch) immediate.speed    = _pendingPatch.speed;
      if ('fuel'     in _pendingPatch) immediate.fuel     = _pendingPatch.fuel;
      if ('odometer' in _pendingPatch) immediate.odometer = _pendingPatch.odometer;
      useUnifiedVehicleStore.getState().updateVehicleState(immediate);
      _pendingPatch.speed = _pendingPatch.fuel = undefined;
      _pendingPatch.odometer = undefined;
      return;
    }

    if ('speed'    in patch) _pendingPatch.speed    = patch.speed;
    if ('fuel'     in patch) _pendingPatch.fuel      = patch.fuel;
    if ('odometer' in patch) _pendingPatch.odometer  = patch.odometer;
    // rpm: SAB kanalından gelir, index.ts'e STATE_UPDATE ile gelmez; gerekirse buraya ekle
    _hasPending = true;

    _scheduleFlush();
  });

  // CAN extras — worker'a gerek yok, doğrudan store'a yaz
  // Tüm sinyaller (kapı/far/TPMS/motor/güvenlik/konfor) düşük frekanslı; RAF batch gerekmez.
  const unsubCanExtras = can.onData((d) => {
    useUnifiedVehicleStore.getState().updateCanExtras({
      // Kapı / aydınlatma
      doorOpen:          d.doorOpen,
      headlightsOn:      d.headlightsOn,
      tpms:              d.tpms?.length === 4
                           ? (d.tpms as [number, number, number, number])
                           : undefined,
      // Motor
      rpm:               d.rpm         ?? null,
      coolantTemp:       d.coolantTemp ?? null,
      oilTemp:           d.oilTemp     ?? null,
      throttle:          d.throttle    ?? null,
      // Elektrik / vites / çevre
      batteryVolt:       d.batteryVolt ?? null,
      gearPos:           d.gearPos     ?? null,
      ambientTemp:       d.ambientTemp ?? null,
      // Şasi güvenliği
      abs:               d.abs,
      tractionControl:   d.tractionControl,
      stabilityControl:  d.stabilityControl,
      // Gövde / konfor
      parkingBrake:      d.parkingBrake,
      seatbelt:          d.seatbelt,
      wipers:            d.wipers,
      airCondition:      d.airCondition,
      cruiseControl:     d.cruiseControl,
    });
  });

  // ValidationGuard GPS beslemesi — GPS hızını obdService'e ilet (döngüsel import olmadan)
  const unsubGpsValidation = gps.onData((d) => {
    if (d.speed != null) {
      // GpsAdapterData.speed ham m/s — km/h'e çevir (deadzone uygulamadan)
      updateGpsSpeedForValidation(d.speed * 3.6);
    }
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
    unsubCanExtras();
    unsubGpsValidation();

    _activeResolver = null;
    stopRemoteCommands();
    cleanupLiveStyle();
    telemetryService.stop();
    resolver.stop(); // → worker'ı durdurur ve terminate eder
  };
}
