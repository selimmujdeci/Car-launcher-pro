/**
 * vehicleHal — Vehicle HAL foundation (barrel).
 *
 * Bu modülü import etmek YAN ETKİ ÜRETMEZ: timer/abonelik/native çağrı/donanım probu
 * YOK. Tekil `vehicleHal` yalnız statik sinyal kataloğunu `supported=false` tohumlar.
 * Gerçek kaynak wiring (VAL/UnifiedVehicleStore → ingest) · SystemBoot wiring KAPSAM DIŞI.
 */

export {
  VehicleHal,
  createVehicleHal,
  vehicleHal,
  VEHICLE_SIGNAL_IDS,
  VEHICLE_HAL_STALE_MS_DEFAULT,
  MAX_HAL_LISTENERS,
  type VehicleSignalId,
  type VehicleSignalSource,
  type SignalQuality,
  type VehicleSignal,
  type VehicleHalSnapshot,
  type VehicleIdentity,
  type VehicleSignalCapability,
  type VehicleSignalInput,
  type VehicleIdentityInput,
  type VehicleSignalProvider,
  type VehicleHalListener,
  type VehicleHalDeps,
} from './vehicleHal';
export {
  VehicleHalProviderAdapter,
  createVehicleHalProviderAdapter,
  type VehicleHalIngestTarget,
  type NormalizedVehicleSnapshot,
  type VehicleStoreSource,
  type VehicleHalProviderDeps,
  type VehicleHalProviderStatus,
} from './vehicleHalProviderAdapter';
export {
  createUnifiedVehicleStoreProvider,
  type UnifiedVehicleStateReadable,
  type UnifiedVehicleStoreLike,
  type UnifiedVehicleStoreProviderDeps,
  type UnifiedVehicleStoreProvider,
} from './providers';
