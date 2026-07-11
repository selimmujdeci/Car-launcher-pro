/**
 * eventBus/bridges — Vehicle HAL / Capability Registry → Platform Event Bus köprüleri (barrel).
 *
 * Bu modülü import etmek YAN ETKİ ÜRETMEZ: köprü yalnız fabrika ile oluşturulup `start()`
 * çağrılınca abone olur. SystemBoot wiring · provider auto-start KAPSAM DIŞIDIR (ayrı PR).
 */

export {
  createVehicleHalEventBridge,
  VehicleHalEventBridge,
  type VehicleHalSource,
  type EventBusPublishTarget as VehicleEventBusPublishTarget,
  type HalSignalLike,
  type HalSnapshotLike,
  type HalIdentityLike,
  type VehicleHalEventBridgeDeps,
  type VehicleHalEventBridgeStatus,
} from './vehicleHalEventBridge';

export {
  createCapabilityEventBridge,
  CapabilityEventBridge,
  type CapabilityRegistrySource,
  type CapabilityChangeEventLike,
  type CapabilityRecordLike,
  type CapabilitySnapshotLike,
  type CapabilityEventBridgeDeps,
  type CapabilityEventBridgeStatus,
} from './capabilityEventBridge';
