/**
 * deepScan — Deep Scan runtime foundation (barrel).
 *
 * Bu modülü import etmek YAN ETKİ ÜRETMEZ: timer açılmaz, abonelik kurulmaz,
 * araca sorgu gönderilmez. Gerçek tarama orchestration'ı ve SystemBoot wiring'i
 * bilinçli olarak KAPSAM DIŞIDIR (ayrı PR).
 */

export * from './deepScanModel';
export {
  DeepScanRuntimeService,
  deepScanRuntimeService,
  MAX_DISCOVERY_KEYS,
  type DeepScanRuntimeDeps,
} from './deepScanRuntimeService';
