// @vitest-environment node
/**
 * Trip Cost yakıt kalemi — beyanlı fiyat tablosu + tek tüketim otoritesi.
 * Kilitler: bilinmeyen fiyat 0 YAZILMAZ · bayat tablo işaretlenir · tahmin
 * etiketi korunur · tüketim ikinci bir sayı değildir.
 */
import { describe, expect, it } from 'vitest';
import {
  BUNDLED_FUEL_PRICE_PACK, FUEL_ESTIMATE_CONFIDENCE, FUEL_PRICE_STALE_AFTER_DAYS,
  parseFuelPricePack, resolveFuelCategory,
} from '../platform/trip/cost/fuelPricePack';
import { buildTripCostOutcome } from '../platform/trip/cost/tripCostComposition';
import { computeFuelCost } from '../platform/trip/cost/providers/fuelCostProvider';
import { DEFAULT_FUEL_L_PER_100KM } from '../platform/vehicleAssumptions';

const DAY = 86_400_000;
const RAW = {
  schema: 1,
  currency: 'TRY',
  source: 'test pompa fiyatı',
  observedOn: '2026-09-01',
  pricePerLiter: { petrol: 50, diesel: 48 },
};
const PACK = parseFuelPricePack(RAW)!;
const OBSERVED = Date.UTC(2026, 8, 1);

function resolve(vehicleType: string | undefined, nowMs = OBSERVED + 3 * DAY, pack = PACK) {
  return resolveFuelCategory({ vehicleType, pack, nowMs, reportCurrency: 'TRY' });
}

describe('fiyat tablosu doğrulaması (fail-closed)', () => {
  it('geçerli tablo okunur', () => {
    expect(PACK).toMatchObject({ currency: 'TRY', source: 'test pompa fiyatı', observedOn: '2026-09-01' });
    expect(PACK.pricePerLiter).toEqual({ petrol: 50, diesel: 48 });
  });

  it('kaynaksız, tarihsiz, bozuk tarihli ya da fiyatsız tablo REDDEDİLİR', () => {
    expect(parseFuelPricePack({ ...RAW, source: ' ' })).toBeNull();
    expect(parseFuelPricePack({ ...RAW, observedOn: null })).toBeNull();
    expect(parseFuelPricePack({ ...RAW, observedOn: '2026-02-31' })).toBeNull();
    expect(parseFuelPricePack({ ...RAW, schema: 2 })).toBeNull();
    expect(parseFuelPricePack({ ...RAW, pricePerLiter: { petrol: null, diesel: -3 } })).toBeNull();
    expect(parseFuelPricePack(null)).toBeNull();
  });

  it('aralık dışı fiyat düşer, diğeri kalır', () => {
    expect(parseFuelPricePack({ ...RAW, pricePerLiter: { petrol: 0, diesel: 48 } })?.pricePerLiter)
      .toEqual({ diesel: 48 });
  });

  it('uygulamayla gelen tablo geçerli: kaynaklı, tarihli, iki yakıt fiyatı', () => {
    expect(BUNDLED_FUEL_PRICE_PACK).not.toBeNull();
    expect(BUNDLED_FUEL_PRICE_PACK!.currency).toBe('TRY');
    expect(BUNDLED_FUEL_PRICE_PACK!.source.length).toBeGreaterThan(10);
    expect(BUNDLED_FUEL_PRICE_PACK!.observedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Object.keys(BUNDLED_FUEL_PRICE_PACK!.pricePerLiter).sort()).toEqual(['diesel', 'petrol']);
  });
});

describe('yakıt kategorisi çözümü', () => {
  it('benzinli araç: tablo fiyatı + tek otorite tüketimi, tahmin etiketli', () => {
    const r = resolve('ice');
    expect(r.priceState).toBe('OK');
    expect(r.input).toMatchObject({
      enabled: true, pricePerLiter: 50, consumptionL100Km: DEFAULT_FUEL_L_PER_100KM,
      source: 'estimate', confidence: FUEL_ESTIMATE_CONFIDENCE, stale: false,
    });
    expect(r).toMatchObject({ priceSource: 'test pompa fiyatı', observedOn: '2026-09-01', ageDays: 3 });
  });

  it('dizel araç dizel fiyatını alır; hibrit benzin', () => {
    expect(resolve('diesel').input.pricePerLiter).toBe(48);
    expect(resolve('hybrid').input.pricePerLiter).toBe(50);
  });

  it('fiyat verilmeyen her durumda birim fiyat BOŞ kalır (0 değil)', () => {
    const cases: Array<[ReturnType<typeof resolve>, string]> = [
      [resolve('ev'), 'NOT_FUEL_VEHICLE'],
      [resolve(undefined), 'FUEL_TYPE_UNKNOWN'],
      [resolve('ice', OBSERVED, null as never), 'NO_PACK'],
      [resolveFuelCategory({ vehicleType: 'ice', pack: PACK, nowMs: OBSERVED, reportCurrency: 'EUR' }), 'CURRENCY_MISMATCH'],
      [resolve('diesel', OBSERVED, parseFuelPricePack({ ...RAW, pricePerLiter: { petrol: 50 } })!), 'NO_PRICE_FOR_TYPE'],
      [resolve('ice', OBSERVED - 2 * DAY), 'FUTURE_DATE'],
    ];
    for (const [r, state] of cases) {
      expect(r.priceState).toBe(state);
      expect(r.input.pricePerLiter).toBeUndefined();
      expect(r.priceSource).toBeNull();
    }
  });

  it(`tablo ${FUEL_PRICE_STALE_AFTER_DAYS} günden eskiyse BAYAT`, () => {
    expect(resolve('ice', OBSERVED + FUEL_PRICE_STALE_AFTER_DAYS * DAY).priceState).toBe('OK');
    const r = resolve('ice', OBSERVED + (FUEL_PRICE_STALE_AFTER_DAYS + 1) * DAY);
    expect(r.priceState).toBe('STALE');
    expect(r.input.stale).toBe(true);
    expect(r.input.pricePerLiter).toBe(50);
  });
});

describe('rapora etkisi', () => {
  const route = { distanceM: 200_000, durationS: 7200, hasToll: false };
  const decl = { planId: 'p', currency: 'TRY', destination: 'X' };

  it('fiyat varsa yakıt kalemi TUTAR taşır: 200 km × 8,5 L/100 km × 50 TL', () => {
    const out = buildTripCostOutcome(route, decl, { fuel: resolve('ice').input });
    const fuel = out.report!.knownItems.find((i) => i.category === 'fuel')!;
    expect(fuel.value).toBeCloseTo(200 * DEFAULT_FUEL_L_PER_100KM / 100 * 50, 6);
    expect(fuel).toMatchObject({ source: 'estimate', status: 'known', confidence: FUEL_ESTIMATE_CONFIDENCE });
    expect(out.categories.find((c) => c.category === 'fuel')?.reason).toBe('ACIK');
  });

  it('bayat fiyat toplama girer ama bayat olarak işaretlenir', () => {
    const r = resolve('ice', OBSERVED + 60 * DAY);
    const out = buildTripCostOutcome(route, decl, { fuel: r.input });
    expect(out.report!.staleItems.map((i) => i.category)).toContain('fuel');
  });

  it('fiyat yoksa kalem BİLİNMİYOR der — 0 TL yazmaz', () => {
    const out = buildTripCostOutcome(route, decl, { fuel: resolve(undefined).input });
    const fuel = out.report!.missingItems.find((i) => i.category === 'fuel')!;
    expect(fuel.value).toBeNull();
    expect(fuel.noteKey).toBe('fuel_price_unknown');
    expect(out.report!.knownItems.some((i) => i.category === 'fuel')).toBe(false);
  });

  it('bayat bayrağı bilinmeyen kalemi değiştirmez', () => {
    const item = computeFuelCost({
      legs: [{ distanceKm: 10 }], consumptionL100Km: 8, pricePerLiter: null, currency: 'TRY', stale: true,
    });
    expect(item.status).toBe('unknown');
  });
});
