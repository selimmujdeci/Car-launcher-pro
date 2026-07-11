/**
 * capability — Capability Registry foundation (barrel).
 *
 * Bu modülü import etmek YAN ETKİ ÜRETMEZ: timer/abonelik/native çağrı/donanım probu
 * YOK. Tekil `capabilityRegistry` yalnız statik kataloğu `unknown` olarak tohumlar.
 * Hardware provider wiring · persistence · OEM config · SystemBoot wiring KAPSAM DIŞIDIR.
 */

export {
  CapabilityRegistry,
  createCapabilityRegistry,
  capabilityRegistry,
  resolveCapabilityState,
  DEFAULT_CAPABILITY_CATALOG,
  MAX_CAPABILITIES,
  MAX_CAPABILITY_LISTENERS,
  CAPABILITY_STALE_MS_DEFAULT,
  MIN_AVAILABLE_CONFIDENCE,
  HIGH_CONFIDENCE,
  type CapabilityDomain,
  type CapabilityStatus,
  type CapabilitySource,
  type CapabilityQuality,
  type CapabilityRecord,
  type CapabilitySnapshot,
  type CapabilityEvidence,
  type CapabilityDefinition,
  type CapabilityInput,
  type CapabilityRequirement,
  type RequirementResult,
  type CapabilityChangeType,
  type CapabilityChangeEvent,
  type CapabilityListener,
  type CapabilityRegistryDeps,
} from './capabilityRegistry';
export {
  CapabilityProviderAdapter,
  createCapabilityProviderAdapter,
  MAX_CAPABILITY_PROVIDERS,
  type CapabilityRefreshPolicy,
  type CapabilityProviderResult,
  type CapabilityProvider,
  type CapabilityRegistryTarget,
  type CapabilityProviderAdapterDeps,
  type CapabilityProviderAdapterStatus,
} from './capabilityProviderAdapter';
export {
  createRuntimeCapabilityProviders,
  MAX_RUNTIME_CAPABILITY_PROVIDERS,
  type SecureStorageEvidence,
  type AiProviderEvidence,
  type ModuleRuntimeEvidence,
  type LocalModelEvidence,
  type ResourcePresenceEvidence,
  type AiProviderId,
  type NavigatorLike,
  type RuntimeProbeEnv,
  type RuntimeProbes,
  type RuntimeCapabilityProvidersDeps,
} from './providers';
