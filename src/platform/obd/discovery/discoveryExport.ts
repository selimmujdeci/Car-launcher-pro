/**
 * discoveryExport — keşif kayıtlarının YEREL JSON export altyapısı (PR-DISC-1).
 *
 * KAPSAM (görev): yalnız yerel export; Supabase entegrasyonu YOK, ağ çağrısı YOK.
 * SAF fonksiyonlar — deterministik string üretir; I/O yapmaz (çağıran dosyaya/panoya
 * yazar). Gelecekteki Supabase gönderimi bu zarfı aynen kullanabilir (şema sürümlü).
 */

import type { DiscoveryRecord } from './discoveryModel';

/** Export şeması sürümü — ileride alan eklenirse tüketici uyum sağlayabilsin. */
export const DISCOVERY_EXPORT_SCHEMA = 1;

export interface DiscoveryExportEnvelope {
  schema:     number;
  exportedAt: number;
  count:      number;
  records:    DiscoveryRecord[];
}

/** Kayıtları sürümlü zarfa sarar (saf; export + gelecekteki upload ortak yapı). */
export function buildDiscoveryEnvelope(records: readonly DiscoveryRecord[]): DiscoveryExportEnvelope {
  return {
    schema:     DISCOVERY_EXPORT_SCHEMA,
    exportedAt: Date.now(),
    count:      records.length,
    records:    records.slice(),
  };
}

/**
 * Keşif kayıtlarını okunabilir (girintili) JSON string'e serileştirir.
 * @param pretty true (varsayılan) → 2 boşluk girinti; false → tek satır (kompakt upload).
 */
export function exportDiscoveryJson(records: readonly DiscoveryRecord[], pretty = true): string {
  const envelope = buildDiscoveryEnvelope(records);
  return JSON.stringify(envelope, null, pretty ? 2 : 0);
}
