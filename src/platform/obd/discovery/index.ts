/**
 * discovery — Otomatik PID/DID keşif yakalama boru hattı (PR-DISC-1) genel yüzeyi.
 *
 * Katmanlar (Clean Architecture):
 *   discoveryModel        → saf veri modeli + dedup kimliği/hash
 *   DiscoveryCache        → hash-tabanlı sınırlı deduplikasyon
 *   DiscoveryQueue        → offline-first kalıcı FIFO kuyruk (safeStorage; ağ YOK)
 *   discoveryExport       → yerel JSON export (Supabase YOK)
 *   DiscoveryCaptureService → merkezî orkestratör (registry filtresi + dedup + kuyruk + tanı event)
 */

export type {
  DiscoveryRecord,
  DiscoverySource,
} from './discoveryModel';
export {
  createDiscoveryRecord,
  normalizeHex,
  dedupKey,
  discoveryHash,
  fnv1a,
} from './discoveryModel';

export { DiscoveryCache } from './DiscoveryCache';
export { DiscoveryQueue } from './DiscoveryQueue';

export {
  exportDiscoveryJson,
  buildDiscoveryEnvelope,
  DISCOVERY_EXPORT_SCHEMA,
  type DiscoveryExportEnvelope,
} from './discoveryExport';

export {
  DiscoveryCaptureService,
  discoveryCaptureService,
  type DiscoveryInput,
  type CaptureResult,
  type DiscoveryCaptureOptions,
  type DiscoveryObservation,
  type DiscoveryObservationStatus,
} from './DiscoveryCaptureService';
