/**
 * capability/providers — Gerçek runtime/browser/native Capability provider kaynakları (barrel).
 *
 * Bu modülü import etmek YAN ETKİ ÜRETMEZ: fabrika çağrılana kadar probe/navigator okunmaz.
 * SystemBoot/Registry auto-start/Event Bus wiring KAPSAM DIŞIDIR (ayrı PR).
 */

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
} from './runtimeCapabilityProviders';
