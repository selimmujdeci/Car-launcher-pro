/**
 * ConfidenceLedger — Faz A saf toplama motoru — TRIP-COST-A1.
 *
 * `tripRecommendationEngine.ts`teki ağırlıklı num/den toplama deseninin
 * (`:216-224`, NO_SOURCE skora hiç girmez) maliyet tarafındaki kardeşi.
 * Bağımlılık KURULMADI — yalnız desen örnek alındı.
 *
 * ANAYASA: `status:'unknown'` kalem toplama GİRMEZ; farklı para birimi
 * SESSİZCE toplanmaz (fail-closed + açık `mismatchedItems` sinyali); sahte
 * kesin toplam YOK — yalnız dürüst alt sınır (`lowerBound`), üst sınır
 * UYDURULMAZ (`upperBound: null`).
 */
import type { CostItem, CostReport } from './models';

/**
 * `CostItem[]` → `CostReport`. SAF fonksiyon — girdi mutasyona uğratılmaz,
 * hiçbir yan etki yok.
 *
 * Kurallar:
 *   - `status:'unknown'` → `missingItems`, toplam DIŞI.
 *   - `status:'stale'` → toplamda TUTULUR (knownItems'e de girer) AMA ayrıca
 *     `staleItems`'te işaretlenir (UI "bayat" rozeti gösterebilsin).
 *   - `currency !== reportCurrency` olan known/stale kalem → `mismatchedItems`,
 *     toplam DIŞI, `isComplete=false` (sessiz para-birimi karışımı YASAK).
 *   - `weightedConfidence`: yalnız toplama giren (knownItems) kalemlerin DEĞER-
 *     ağırlıklı ortalama confidence'ı — `num = Σ(confidence×value)`,
 *     `den = Σ(value)`; `den===0` ise `0` döner (BÖLME HATASI YOK).
 *   - `isComplete = missingItems.length===0 && mismatchedItems.length===0`.
 *   - `lowerBound = knownTotal`; `upperBound = null` (uydurma yasak).
 */
export function buildCostReport(items: readonly CostItem[], reportCurrency: string): CostReport {
  const knownItems:      CostItem[] = [];
  const missingItems:    CostItem[] = [];
  const staleItems:      CostItem[] = [];
  const mismatchedItems: CostItem[] = [];

  let knownTotal = 0;
  let num        = 0; // Σ confidence × value — yalnız bilinen parasal katkılar
  let den        = 0; // Σ value

  for (const item of items) {
    if (item.status === 'unknown') {
      missingItems.push(item);
      continue;
    }

    // status ∈ {known, stale} — makeCostItem invaryantı gereği value burada finite & >=0.
    if (item.currency !== reportCurrency) {
      mismatchedItems.push(item);
      continue; // fail-closed: toplama KATILMAZ
    }

    knownItems.push(item);
    if (item.status === 'stale') staleItems.push(item);

    const value = item.value as number;
    knownTotal += value;
    num        += item.confidence * value;
    den        += value;
  }

  const weightedConfidence = den > 0 ? num / den : 0;
  const isComplete = missingItems.length === 0 && mismatchedItems.length === 0;

  return {
    knownItems,
    missingItems,
    staleItems,
    mismatchedItems,
    knownTotal,
    weightedConfidence,
    currency: reportCurrency,
    isComplete,
    lowerBound: knownTotal,
    upperBound: null,
  };
}
