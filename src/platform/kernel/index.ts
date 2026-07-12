/**
 * kernel — Platform Kernel / Service Lifecycle foundation (barrel).
 *
 * Bu modülü import etmek YAN ETKİ ÜRETMEZ: timer/abonelik/native çağrı YOK ve GLOBAL
 * SINGLETON OLUŞTURULMAZ. Kernel yalnız `createPlatformKernel()` ile açıkça yaratılınca
 * çalışır. Gerçek servis wiring · SystemBoot wiring · persistence KAPSAM DIŞIDIR (ayrı PR).
 */

export {
  PlatformKernel,
  createPlatformKernel,
  computeKernelBackoffMs,
  DEFAULT_KERNEL_TIMEOUTS,
  DEFAULT_KERNEL_LIMITS,
  type PlatformServiceState,
  type PlatformServiceCriticality,
  type PlatformServiceStartPolicy,
  type PlatformServiceRestartPolicy,
  type PlatformServiceHealth,
  type PlatformServiceDescriptor,
  type PlatformServiceStatus,
  type PlatformService,
  type KernelCapabilitySource,
  type KernelEventPublisher,
  type PlatformKernelDeps,
  type KernelLimits,
  type KernelTimeouts,
  type KernelChangeType,
  type KernelChangeEvent,
  type KernelListener,
  type KernelSnapshot,
} from './platformKernel';
