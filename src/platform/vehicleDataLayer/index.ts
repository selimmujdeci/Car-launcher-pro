import { CanAdapter }          from './CanAdapter';
import { ObdAdapter }          from './ObdAdapter';
import { GpsAdapter }          from './GpsAdapter';
import { VehicleSignalResolver } from './VehicleSignalResolver';
import { telemetryService }    from '../telemetryService';
import { useVehicleStore }     from './VehicleStateStore';
import { startRemoteCommands, stopRemoteCommands } from '../remoteCommandService';
import { startLiveStyleEngine }                    from '../liveStyleEngine';

export { useVehicleStore }                from './VehicleStateStore';
export { setRemoteCommandContext }        from '../remoteCommandService';
export type { VehicleState }             from './types';

/**
 * startVehicleDataLayer — OBD/GPS/CAN veri hattını, telemetri push'unu
 * ve uzaktan komut kanalını başlatır.
 *
 * Döndürülen fonksiyon: tam temizlik (remoteCommands → telemetri → resolver).
 * Çağrı sırası önemli:
 *   1. stopRemoteCommands() — Realtime channel kapatılır
 *   2. telemetry.stop()     — listener set'ten güvenle çıkar
 *   3. resolver.stop()      — adapter'ları durdur, listener set'i temizle
 */
export function startVehicleDataLayer(): () => void {
  const can      = new CanAdapter();
  const obd      = new ObdAdapter();
  const gps      = new GpsAdapter();
  const resolver = new VehicleSignalResolver(can, obd, gps);

  // UI state store — mevcut listener (Zustand → UI)
  resolver.onResolved((patch) => {
    useVehicleStore.getState().updateVehicle(patch);
  });

  // Telemetri push hattı — cloud listener (Supabase push)
  telemetryService.start(resolver);

  // Uzaktan komut kanalı — Supabase Realtime (fire-and-forget async init)
  void startRemoteCommands();

  // Live CSS custom property sync — persisted vars'ı yükler
  const cleanupLiveStyle = startLiveStyleEngine();

  resolver.start();

  // Cleanup: remote → live style → telemetri → resolver sırasıyla durdurulur
  return () => {
    stopRemoteCommands();
    cleanupLiveStyle();
    telemetryService.stop();
    resolver.stop();
  };
}
