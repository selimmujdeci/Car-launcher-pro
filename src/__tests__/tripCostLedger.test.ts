/**
 * tripCostLedger.test.ts — TRIP-COST-A1 Faz A.
 *
 * `buildCostReport` — ConfidenceLedger. Kapsam: known toplam · unknown
 * toplama girmez · stale toplamda tutulur (ayrı işaretli) · mixed-currency
 * fail-closed · weightedConfidence num/den (den=0→0) · lowerBound=knownTotal ·
 * upperBound=null (sahte üst sınır YOK) · isComplete.
 */
import { describe, it, expect } from 'vitest';
import { makeCostItem } from '../platform/trip/cost/models';
import { buildCostReport } from '../platform/trip/cost/confidenceLedger';

const TRY = 'TRY';

function known(id: string, value: number, confidence = 1, currency = TRY) {
  return makeCostItem({ id, category: id, value, currency, source: 'calculated', confidence, editable: true });
}
function unknown(id: string) {
  return makeCostItem({ id, category: id, value: null, currency: TRY, source: 'unknown', confidence: 0, editable: false });
}
function stale(id: string, value: number, confidence = 0.4) {
  return makeCostItem({ id, category: id, value, currency: TRY, source: 'cached', confidence, editable: true, status: 'stale' });
}

describe('buildCostReport — A) known toplam', () => {
  it('fuel1000 + toll300 + lodging2000 = 3300', () => {
    const report = buildCostReport(
      [known('fuel', 1000), known('toll', 300), known('lodging', 2000)],
      TRY,
    );
    expect(report.knownTotal).toBe(3300);
    expect(report.knownItems).toHaveLength(3);
    expect(report.isComplete).toBe(true);
    expect(report.lowerBound).toBe(3300);
    expect(report.upperBound).toBeNull();
  });
});

describe('buildCostReport — B) unknown kalem toplama GİRMEZ', () => {
  it('fuel1000 known + toll unknown → knownTotal=1000, toll missingItems\'te', () => {
    const report = buildCostReport([known('fuel', 1000), unknown('toll')], TRY);
    expect(report.knownTotal).toBe(1000);
    expect(report.missingItems).toHaveLength(1);
    expect(report.missingItems[0].id).toBe('toll');
    expect(report.isComplete).toBe(false);
  });

  it('yalnız unknown kalemler → knownTotal=0, isComplete=false', () => {
    const report = buildCostReport([unknown('fuel'), unknown('toll')], TRY);
    expect(report.knownTotal).toBe(0);
    expect(report.missingItems).toHaveLength(2);
    expect(report.knownItems).toHaveLength(0);
    expect(report.isComplete).toBe(false);
  });

  it('boş liste → knownTotal=0, isComplete=true (eksik kalem YOK)', () => {
    const report = buildCostReport([], TRY);
    expect(report.knownTotal).toBe(0);
    expect(report.isComplete).toBe(true);
    expect(report.weightedConfidence).toBe(0);
  });
});

describe('buildCostReport — stale handling', () => {
  it('stale kalem TOPLAMDA TUTULUR ama staleItems\'te ayrı işaretlenir', () => {
    const report = buildCostReport([known('fuel', 1000), stale('toll', 300)], TRY);
    expect(report.knownTotal).toBe(1300); // stale toplamda TUTULDU
    expect(report.staleItems).toHaveLength(1);
    expect(report.staleItems[0].id).toBe('toll');
    expect(report.knownItems).toHaveLength(2); // stale de knownItems'e girer
    expect(report.isComplete).toBe(true); // stale eksik SAYILMAZ
  });
});

describe('buildCostReport — mixed-currency fail-closed', () => {
  it('reportCurrency ile uyuşmayan known kalem SESSİZCE toplanmaz — mismatchedItems + isComplete=false', () => {
    const eurItem = known('lodging', 500, 1, 'EUR');
    const report  = buildCostReport([known('fuel', 1000), eurItem], TRY);
    expect(report.knownTotal).toBe(1000); // EUR kalem toplama KATILMADI
    expect(report.mismatchedItems).toHaveLength(1);
    expect(report.mismatchedItems[0].currency).toBe('EUR');
    expect(report.isComplete).toBe(false);
    // Mismatched kalem knownItems'e SIZMAMALI
    expect(report.knownItems.some(i => i.currency === 'EUR')).toBe(false);
  });

  it('yalnız EUR kalemler (reportCurrency=TRY) → knownTotal=0, hepsi mismatchedItems\'te', () => {
    const report = buildCostReport([known('a', 100, 1, 'EUR'), known('b', 200, 1, 'EUR')], TRY);
    expect(report.knownTotal).toBe(0);
    expect(report.mismatchedItems).toHaveLength(2);
    expect(report.isComplete).toBe(false);
  });
});

describe('buildCostReport — weightedConfidence (değer-ağırlıklı, num/den)', () => {
  it('iki kalem: fuel(1000, conf 0.8) + toll(500, conf 0.4) → (1000*0.8+500*0.4)/(1000+500)', () => {
    const report = buildCostReport([known('fuel', 1000, 0.8), known('toll', 500, 0.4)], TRY);
    const expected = (1000 * 0.8 + 500 * 0.4) / (1000 + 500);
    expect(report.weightedConfidence).toBeCloseTo(expected, 10);
  });

  it('den=0 (tüm known kalemler value=0) → weightedConfidence=0, BÖLME HATASI YOK', () => {
    const report = buildCostReport([known('parking', 0, 1)], TRY);
    expect(() => report.weightedConfidence).not.toThrow();
    expect(report.weightedConfidence).toBe(0);
    expect(Number.isNaN(report.weightedConfidence)).toBe(false);
    expect(Number.isFinite(report.weightedConfidence)).toBe(true);
  });

  it('unknown kalemler weightedConfidence hesabına KATILMAZ', () => {
    const report = buildCostReport([known('fuel', 1000, 1), unknown('toll')], TRY);
    expect(report.weightedConfidence).toBe(1); // yalnız fuel katkı verir
  });
});

describe('buildCostReport — sahte kesin toplam YOK (no-fake-zero / dürüst band)', () => {
  it('eksik kalem varken bile knownTotal SADECE bilinenlerin toplamı — sıfıra/uydurmaya DÜŞMEZ', () => {
    const report = buildCostReport([known('fuel', 750), unknown('lodging')], TRY);
    expect(report.knownTotal).toBe(750); // ne 0 ne uydurma
    expect(report.lowerBound).toBe(750);
    expect(report.upperBound).toBeNull(); // üst sınır ASLA uydurulmaz
  });

  it('rapor currency alanı reportCurrency ile eşleşir', () => {
    const report = buildCostReport([known('fuel', 100)], 'EUR');
    expect(report.currency).toBe('EUR');
  });
});

describe('buildCostReport — saflık (immutability)', () => {
  it('girdi dizisi mutasyona uğratılmaz', () => {
    const items = [known('fuel', 1000), unknown('toll')];
    const snapshot = JSON.parse(JSON.stringify(items));
    buildCostReport(items, TRY);
    expect(items).toEqual(snapshot);
  });
});
