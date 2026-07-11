/**
 * eventBus — Platform Event Bus foundation (barrel).
 *
 * Bu modülü import etmek YAN ETKİ ÜRETMEZ: timer/abonelik/native çağrı YOK ve GLOBAL
 * SINGLETON OLUŞTURULMAZ. Bus yalnız `createPlatformEventBus()` / `new PlatformEventBus`
 * ile açıkça yaratılınca çalışır. Gerçek modül wiring · event migration · persistence ·
 * SystemBoot wiring KAPSAM DIŞIDIR.
 */

export {
  PlatformEventBus,
  createPlatformEventBus,
  DEFAULT_EVENT_CATALOG,
  DEFAULT_EVENT_BUS_LIMITS,
  type PlatformEventPriority,
  type PlatformEventDomain,
  type PlatformEventSource,
  type PlatformEvent,
  type PublishMetadata,
  type PublishInput,
  type PlatformEventListener,
  type SubscribeOptions,
  type PlatformEventBusStats,
  type EventCatalogEntry,
  type EventBusLimits,
  type PlatformEventBusDeps,
  type RecentEventFilter,
} from './platformEventBus';
export {
  createVehicleHalEventBridge,
  VehicleHalEventBridge,
  createCapabilityEventBridge,
  CapabilityEventBridge,
  type VehicleHalSource,
  type HalSignalLike,
  type HalSnapshotLike,
  type HalIdentityLike,
  type VehicleHalEventBridgeDeps,
  type VehicleHalEventBridgeStatus,
  type CapabilityRegistrySource,
  type CapabilityChangeEventLike,
  type CapabilityRecordLike,
  type CapabilitySnapshotLike,
  type CapabilityEventBridgeDeps,
  type CapabilityEventBridgeStatus,
} from './bridges';
