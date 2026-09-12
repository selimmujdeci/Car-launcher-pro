/**
 * tripCostEngine.test.ts — TRIP-COST-A1 Faz A.
 *
 * `runCostEngine` — saf orkestratör. Kapsam: provider exception izolasyonu ·
 * deterministik çağrı sırası · immutable input · multi-leg fuel entegrasyonu ·
 * sync (Promise DEĞİL) · gerçek servis provider'ı YOK (yalnız DI).
 */
import { describe, it, expect } from 'vitest';
import { runCostEngine } from '../platform/trip/cost/costEngine';
import { makeCostItem, type TripPlan } from '../platform/trip/cost/models';
import type { CostProvider } from '../platform/trip/cost/providers/types';
import { createFuelCostProvider } from '../platform/trip/cost/providers/fuelCostProvider';

const TRY = 'TRY';

function makePlan(overrides: Partial<TripPlan> = {}): TripPlan {
  return {
    id: 'trip-1', origin: 'Mersin', destination: 'Akyaka',
    legs: [{ id: 'leg-1', distanceKm: 100, origin: 'Mersin', destination: 'Akyaka' }],
    nights: 3,
    travellers: { adults: 2, children: 3 },
    vehicleProfile: { propulsion: 'fuel', consumptionL100Km: 7 },
    currency: TRY,
    ...overrides,
  };
}

function knownProvider(id: string, value: number): CostProvider {
  return function namedProvider() {
    return makeCostItem({ id, category: id, value, currency: TRY, source: 'calculated', confidence: 0.8, editable: true });
  };
}

describe('runCostEngine — temel akış', () => {
  it('birden fazla known provider → CostReport doğru toplar', () => {
    const report = runCostEngine(makePlan(), [knownProvider('fuel', 1000), knownProvider('toll', 300)]);
    expect(report.knownTotal).toBe(1300);
    expect(report.isComplete).toBe(true);
  });

  it('provider yoksa (boş dizi) → boş rapor, çökme YOK', () => {
    const report = runCostEngine(makePlan(), []);
    expect(report.knownTotal).toBe(0);
    expect(report.isComplete).toBe(true);
  });

  it('reportCurrency verilmezse plan.currency kullanılır', () => {
    const report = runCostEngine(makePlan({ currency: 'EUR' }), []);
    expect(report.currency).toBe('EUR');
  });

  it('reportCurrency açıkça verilirse plan.currency\'yi EZER', () => {
    const report = runCostEngine(makePlan({ currency: 'EUR' }), [], 'TRY');
    expect(report.currency).toBe('TRY');
  });

  it('sync çalışır — Promise DEĞİL', () => {
    const result = runCostEngine(makePlan(), []);
    expect(result).not.toBeInstanceOf(Promise);
    expect(typeof (result as unknown as { then?: unknown }).then).not.toBe('function');
  });
});

describe('runCostEngine — provider exception İZOLASYONU', () => {
  it('bir provider throw eder → TÜM rapor ÇÖKMEZ, o kalem unknown olur, diğerleri normal çalışır', () => {
    const throwing: CostProvider = function brokenProvider() {
      throw new Error('boom — simüle edilmiş provider hatası');
    };
    const report = runCostEngine(makePlan(), [knownProvider('fuel', 1000), throwing, knownProvider('toll', 300)]);
    expect(report.knownTotal).toBe(1300); // fuel + toll — kırık provider'dan etkilenmedi
    expect(report.isComplete).toBe(false); // kırık provider eksik kalem üretti
    expect(report.missingItems.some(i => i.noteKey === 'provider_error')).toBe(true);
  });

  it('provider geçersiz CostItem döndürürse (negatif value) → aynı şekilde izole edilir', () => {
    const invalidProvider: CostProvider = function invalidItemProvider() {
      // makeCostItem'dan GEÇMEDEN doğrudan kötü şekilli obje döndürüyor —
      // runCostEngine'in savunma katmanı (normalizeCostItem) bunu yakalamalı.
      return {
        id: 'broken', category: 'broken', value: -50, currency: TRY,
        source: 'calculated', confidence: 0.5, editable: true, status: 'known',
      };
    };
    const report = runCostEngine(makePlan(), [knownProvider('fuel', 1000), invalidProvider]);
    expect(report.knownTotal).toBe(1000); // yalnız geçerli fuel toplama girdi
    expect(report.isComplete).toBe(false);
  });

  it('tüm provider\'lar throw ederse → boş-ama-çökmemiş rapor (hepsi missingItems\'te)', () => {
    const t1: CostProvider = function p1() { throw new Error('a'); };
    const t2: CostProvider = function p2() { throw new Error('b'); };
    expect(() => runCostEngine(makePlan(), [t1, t2])).not.toThrow();
    const report = runCostEngine(makePlan(), [t1, t2]);
    expect(report.knownTotal).toBe(0);
    expect(report.missingItems).toHaveLength(2);
    expect(report.isComplete).toBe(false);
  });

  it('array döndüren provider throw ederse → dizideki TÜM kalemler iptal edilir (kısmi sızıntı YOK)', () => {
    const arrayThrowing: CostProvider = function arrayProvider() {
      return [
        makeCostItem({ id: 'a', category: 'a', value: 100, currency: TRY, source: 'calculated', confidence: 1, editable: true }),
        // İkinci kalem geçersiz → normalizeCostItem throw eder → TÜM provider iptal
        { id: 'b', category: 'b', value: -1, currency: TRY, source: 'calculated', confidence: 1, editable: true, status: 'known' } as never,
      ];
    };
    const report = runCostEngine(makePlan(), [arrayThrowing]);
    // 'a' kalemi de İPTAL edilmeli — kısmi/yarı geçerli provider çıktısı SIZDIRILMAZ.
    expect(report.knownItems.some(i => i.id === 'a')).toBe(false);
    expect(report.missingItems).toHaveLength(1);
  });
});

describe('runCostEngine — deterministik çağrı sırası', () => {
  it('provider\'lar dizi sırasıyla çağrılır, sonuç sırası KORUNUR', () => {
    const order: string[] = [];
    const p1: CostProvider = function first() { order.push('first'); return knownProvider('a', 1)({} as TripPlan, { reportCurrency: TRY }); };
    const p2: CostProvider = function second() { order.push('second'); return knownProvider('b', 2)({} as TripPlan, { reportCurrency: TRY }); };
    const p3: CostProvider = function third() { order.push('third'); return knownProvider('c', 3)({} as TripPlan, { reportCurrency: TRY }); };
    const report = runCostEngine(makePlan(), [p1, p2, p3]);
    expect(order).toEqual(['first', 'second', 'third']);
    expect(report.knownItems.map(i => i.id)).toEqual(['a', 'b', 'c']);
  });

  it('aynı provider listesi tekrar tekrar çalıştırılınca AYNI sonucu verir (deterministik)', () => {
    const providers = [knownProvider('fuel', 1000), knownProvider('toll', 300)];
    const r1 = runCostEngine(makePlan(), providers);
    const r2 = runCostEngine(makePlan(), providers);
    expect(r1.knownTotal).toBe(r2.knownTotal);
    expect(r1.knownItems.map(i => i.id)).toEqual(r2.knownItems.map(i => i.id));
  });
});

describe('runCostEngine — immutable input (saflık)', () => {
  it('plan mutasyona uğratılmaz (donmuş plan ile de çalışır)', () => {
    const plan = Object.freeze(makePlan());
    expect(() => runCostEngine(plan, [knownProvider('fuel', 1000)])).not.toThrow();
  });

  it('plan derin içerik değişmeden kalır (snapshot karşılaştırması)', () => {
    const plan = makePlan();
    const snapshot = JSON.parse(JSON.stringify(plan));
    runCostEngine(plan, [knownProvider('fuel', 1000), knownProvider('toll', 300)]);
    expect(plan).toEqual(snapshot);
  });

  it('provider listesi mutasyona uğratılmaz', () => {
    const providers = [knownProvider('fuel', 1000)];
    const frozen = Object.freeze([...providers]);
    expect(() => runCostEngine(makePlan(), frozen)).not.toThrow();
    expect(frozen).toHaveLength(1);
  });
});

describe('runCostEngine — multi-leg fuel entegrasyonu (gerçek FuelCostProvider ile)', () => {
  it('gidiş-dönüş iki leg + FuelCostProvider → engine üzerinden doğru toplam', () => {
    const plan = makePlan({
      legs: [
        { id: 'out', distanceKm: 120, origin: 'Mersin', destination: 'Akyaka' },
        { id: 'ret', distanceKm: 118, origin: 'Akyaka', destination: 'Mersin' },
      ],
      vehicleProfile: { propulsion: 'fuel', consumptionL100Km: 6.5 },
    });
    const fuelProvider = createFuelCostProvider((p, ctx) => ({
      legs:               p.legs,
      consumptionL100Km:  p.vehicleProfile.consumptionL100Km,
      pricePerLiter:      44,
      currency:            ctx.reportCurrency,
    }));

    const report = runCostEngine(plan, [fuelProvider]);
    const expectedLiters = ((120 + 118) * 6.5) / 100;
    const expectedCost   = expectedLiters * 44;
    expect(report.knownTotal).toBeCloseTo(expectedCost, 10);
    expect(report.isComplete).toBe(true);
  });

  it('tüketim yoksa (unknown fuel) → engine raporu isComplete=false + knownTotal=0 döner, ÇÖKMEZ', () => {
    const plan = makePlan({ vehicleProfile: { propulsion: 'unknown' } });
    const fuelProvider = createFuelCostProvider((p, ctx) => ({
      legs: p.legs,
      consumptionL100Km: p.vehicleProfile.consumptionL100Km, // undefined
      pricePerLiter: 44,
      currency: ctx.reportCurrency,
    }));

    const report = runCostEngine(plan, [fuelProvider]);
    expect(report.knownTotal).toBe(0);
    expect(report.isComplete).toBe(false);
    expect(report.missingItems).toHaveLength(1);
    expect(report.missingItems[0].category).toBe('fuel');
  });

  it('gerçek servis provider\'ı EKLENMEDİ — yalnız DI ile verilen provider çalışır (kanıt: 0 provider → 0 kalem)', () => {
    const report = runCostEngine(makePlan(), []);
    expect(report.knownItems).toHaveLength(0);
    expect(report.missingItems).toHaveLength(0);
  });
});
