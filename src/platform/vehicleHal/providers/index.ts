/**
 * vehicleHal/providers — Vehicle HAL gerçek provider kaynakları (barrel).
 *
 * Bu modülü import etmek YAN ETKİ ÜRETMEZ: fabrika çağrılana kadar store okunmaz/
 * abone olunmaz. SystemBoot/Capability/Event Bus wiring KAPSAM DIŞIDIR (ayrı PR).
 */

export {
  createUnifiedVehicleStoreProvider,
  type UnifiedVehicleStateReadable,
  type UnifiedVehicleStoreLike,
  type UnifiedVehicleStoreProviderDeps,
  type UnifiedVehicleStoreProvider,
  type HalStatusStoreLike,
  type SourceHealthReadable,
} from './unifiedVehicleStoreProvider';
