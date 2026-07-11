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
export {
  DeepScanPersistenceStore,
  deepScanPersistenceStore,
  DEEP_SCAN_HISTORY_KEY,
  DEEP_SCAN_SCHEMA_VERSION,
  MAX_DEEP_SCAN_RECORDS,
  DEEP_SCAN_WRITE_DEBOUNCE_MS,
  MAX_RECORD_ECUS,
  MAX_RECORD_PIDS,
  MAX_RECORD_DIDS,
  MAX_RECORD_FIRMWARE,
  MAX_RECORD_WARNINGS,
  type DeepScanRecord,
  type DeepScanFirmwareEntry,
  type DeepScanPersistInput,
  type DeepScanStoreIO,
} from './deepScanPersistence';
export {
  DeepScanIgnitionSource,
  createDeepScanIgnitionSource,
  deepScanIgnitionSource,
  resolveIgnitionState,
  IGNITION_STALE_MS_DEFAULT,
  IGNITION_MIN_CONFIDENCE_DEFAULT,
  MAX_IGNITION_EVIDENCE,
  MAX_IGNITION_LISTENERS,
  type IgnitionState,
  type IgnitionEvidenceSource,
  type IgnitionEvidence,
  type IgnitionSnapshot,
  type IgnitionListener,
  type IgnitionEvidenceProvider,
  type DeepScanIgnitionDeps,
  type ResolveConfig,
} from './deepScanIgnitionSource';
