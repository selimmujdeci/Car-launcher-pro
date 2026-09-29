// @vitest-environment node
/**
 * Rota önizlemesindeki yakıt tutarı — "Yakıt ~1.370 TL · tahmini".
 * Kilitler: ikinci hesap yok (Trip Cost zinciri) · bilinmeyen tutar GÖSTERİLMEZ
 * (0 TL yok) · bayat fiyat açıkça söylenir · etiket yalnız önizleme kartında.
 */
import { describe, expect, it } from 'vitest';
import navigationHudSrc from '../components/map/NavigationHUD.tsx?raw';
import { parseFuelPricePack, resolveFuelCategory } from '../platform/trip/cost/fuelPricePack';
import { computeRouteFuelCost, formatRouteFuelCost } from '../platform/trip/cost/routeFuelCost';
import { buildTripCostOutcome } from '../platform/trip/cost/tripCostComposition';

const DAY = 86_400_000;
const PACK = parseFuelPricePack({
  schema: 1, currency: 'TRY', source: 'test', observedOn: '2026-09-29',
  pricePerLiter: { petrol: 80.4, diesel: 93.5 },
})!;
const NOW = Date.UTC(2026, 8, 30, 9);

describe('rota yakıt tutarı', () => {
  it('200 km benzinli: 200 × 8,5/100 × 80,40 = 1366,8 → ~1.370 TL', () => {
    const v = computeRouteFuelCost({ distanceM: 200_000, vehicleType: 'ice', pack: PACK, nowMs: NOW })!;
    expect(v).toEqual({ amount: 1370, currency: 'TRY', stale: false, ageDays: 1 });
    expect(formatRouteFuelCost(v)).toBe('Yakıt ~1.370 TL · tahmini');
  });

  it('LAB yakıt kalemiyle AYNI hesap (ikinci hesap yok)', () => {
    const fuel = resolveFuelCategory({ vehicleType: 'diesel', pack: PACK, nowMs: NOW, reportCurrency: 'TRY' });
    const out = buildTripCostOutcome({ distanceM: 345_000, durationS: 1, hasToll: false },
      { planId: 'p', currency: 'TRY' }, { fuel: fuel.input });
    const labValue = out.report!.knownItems.find((i) => i.category === 'fuel')!.value!;
    const v = computeRouteFuelCost({ distanceM: 345_000, vehicleType: 'diesel', pack: PACK, nowMs: NOW })!;
    expect(v.amount).toBe(Math.round(labValue / 10) * 10);
  });

  it('bayat fiyatta kaç gün önceki fiyat olduğu yazılır', () => {
    const v = computeRouteFuelCost({ distanceM: 100_000, vehicleType: 'ice', pack: PACK, nowMs: NOW + 20 * DAY })!;
    expect(v.stale).toBe(true);
    expect(formatRouteFuelCost(v)).toBe('Yakıt ~680 TL · fiyat 21 gün önce');
  });

  it('bilinmeyen tutar GÖSTERİLMEZ — asla 0 TL yazılmaz', () => {
    const base = { distanceM: 200_000, pack: PACK, nowMs: NOW };
    expect(computeRouteFuelCost({ ...base, vehicleType: undefined })).toBeNull(); // tür bilinmiyor
    expect(computeRouteFuelCost({ ...base, vehicleType: 'ev' })).toBeNull();      // elektrikli
    expect(computeRouteFuelCost({ ...base, vehicleType: 'ice', pack: null })).toBeNull();
    expect(computeRouteFuelCost({ ...base, vehicleType: 'ice', distanceM: 0 })).toBeNull();
    expect(computeRouteFuelCost({ ...base, vehicleType: 'ice', distanceM: Number.NaN })).toBeNull();
    // 300 m ≈ 2 TL → 10'a yuvarlanınca 0 → gösterilmez
    expect(computeRouteFuelCost({ ...base, vehicleType: 'ice', distanceM: 300 })).toBeNull();
  });

  it('binlik ayırıcı Türkçe: 12.340', () => {
    expect(formatRouteFuelCost({ amount: 12340, currency: 'TRY', stale: false, ageDays: 0 }))
      .toBe('Yakıt ~12.340 TL · tahmini');
  });
});

describe('rota önizleme kartı bağlantısı', () => {
  const previewCard = navigationHudSrc.slice(
    navigationHudSrc.indexOf('const PreviewCard = memo('),
    navigationHudSrc.indexOf('function QuickCard('),
  );

  it('🔒 tutar yalnız ÖNİZLEME kartında okunur (aktif sürüşte gösterilmez)', () => {
    expect(previewCard).toContain('readRouteFuelCost(');
    expect(navigationHudSrc.match(/readRouteFuelCost\(/g)).toHaveLength(1);
  });

  it('🔒 etiket koşullu — tutar yoksa hiç çizilmez', () => {
    expect(previewCard).toMatch(/\{fuelCost && \(/);
  });
});
