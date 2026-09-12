/**
 * tripCostPipeline.test.ts — TRIP-COST-B1.
 *
 * `runTripCostPipeline`/`buildTripCostProviders` — ilk uçtan-uca SAF wiring.
 * Dört provider'ı (fuel/toll/lodging/parking) gerçek `TripPlan` üzerinden
 * `CostEngine`e bağlar. HÂLÂ canlı veri YOK — yalnız DI girdi.
 *
 * Kapsam: 4-provider toplamı · unknown/stale toplam davranışı · sabit sıra ·
 * enabled/absent semantiği · boş yolculuk · reportCurrency=plan.currency ·
 * mixed-currency fail-closed · immutable girdi · provider exception
 * izolasyonu · deterministik · her adapter'ın doğru veri aktarımı ·
 * wiring-seviyesi validation throw · saf provider regresyonları.
 */
import { describe, it, expect } from 'vitest';
import { runTripCostPipeline, buildTripCostProviders, type TripCostInput } from '../platform/trip/cost/tripCostPipeline';
import type { TripPlan } from '../platform/trip/cost/models';
import { computeFuelCost } from '../platform/trip/cost/providers/fuelCostProvider';
import { computeTollCost } from '../platform/trip/cost/providers/tollProvider';
import { computeLodgingCost } from '../platform/trip/cost/providers/lodgingProvider';
import { computeParkingCost } from '../platform/trip/cost/providers/parkingProvider';

const TRY = 'TRY';

function makePlan(overrides: Partial<TripPlan> = {}): TripPlan {
  return {
    id: 'trip-1', origin: 'Mersin', destination: 'Akyaka',
    legs: [{ id: 'leg-1', distanceKm: 100, origin: 'Mersin', destination: 'Akyaka' }],
    nights: 3, travellers: { adults: 2, children: 3 },
    vehicleProfile: { propulsion: 'fuel', consumptionL100Km: 10 },
    currency: TRY,
    ...overrides,
  };
}

/** fuel=1000 (100km × 10L/100km × 100TL/L), toll=300, lodging=1500 (3×500), parking=100 (flat). */
function fullInput(overrides: Partial<TripCostInput> = {}): TripCostInput {
  return {
    plan: makePlan(),
    fuel: { enabled: true, consumptionL100Km: 10, pricePerLiter: 100 },
    toll: {
      enabled: true,
      segments: [{ id: 'seg1', key: 'k1', hasToll: true }],
      priceEntries: [{ segmentKey: 'k1', value: 300, currency: TRY, source: 'user', confidence: 0.9 }],
    },
    lodging: {
      enabled: true,
      stays: [{ id: 's1', key: 'camp1', nights: 3, kind: 'camp' }],
      priceEntries: [{ stayKey: 'camp1', perNightValue: 500, currency: TRY, source: 'user', confidence: 0.9, pricingUnit: 'per_stay' }],
    },
    parking: {
      enabled: true,
      stops: [{ id: 'p1', key: 'pk1' }],
      priceEntries: [{ stopKey: 'pk1', pricingUnit: 'flat', value: 100, currency: TRY, source: 'user', confidence: 0.9 }],
    },
    ...overrides,
  };
}

describe('runTripCostPipeline — A) 4 provider birlikte', () => {
  it('fuel1000 + toll300 + lodging1500 + parking100 = 2900', () => {
    const report = runTripCostPipeline(fullInput());
    expect(report.knownTotal).toBe(2900);
    expect(report.isComplete).toBe(true);
    expect(report.knownItems).toHaveLength(4);
  });
});

describe('runTripCostPipeline — B) unknown toplam-dışı', () => {
  it('toll fiyatsız (unknown) → knownTotal=2600 (1000+1500+100), missingItems toll, isComplete=false', () => {
    const report = runTripCostPipeline(fullInput({
      toll: {
        enabled: true,
        segments: [{ id: 'seg1', key: 'k1', hasToll: true }],
        priceEntries: [], // fiyat yok → unknown
      },
    }));
    expect(report.knownTotal).toBe(2600);
    expect(report.isComplete).toBe(false);
    expect(report.missingItems.some(i => i.category === 'toll')).toBe(true);
    expect(report.missingItems).toHaveLength(1);
  });
});

describe('runTripCostPipeline — C) stale toplamda kalır', () => {
  it('parking stale (100) → knownTotal DEĞİŞMEZ (2900), staleItems parking içerir', () => {
    const report = runTripCostPipeline(fullInput({
      parking: {
        enabled: true,
        stops: [{ id: 'p1', key: 'pk1' }],
        priceEntries: [{ stopKey: 'pk1', pricingUnit: 'flat', value: 100, currency: TRY, source: 'user', confidence: 0.9, stale: true }],
      },
    }));
    expect(report.knownTotal).toBe(2900); // stale toplamda TUTULUR
    expect(report.staleItems).toHaveLength(1);
    expect(report.staleItems[0].category).toBe('parking');
    expect(report.isComplete).toBe(true); // stale eksik SAYILMAZ
  });
});

describe('runTripCostPipeline — D) provider SABİT sıra', () => {
  it('knownItems sırası fuel → toll → lodging → parking', () => {
    const report = runTripCostPipeline(fullInput());
    expect(report.knownItems.map(i => i.category)).toEqual(['fuel', 'toll', 'lodging', 'parking']);
  });

  it('buildTripCostProviders da AYNI sırayı üretir (fonksiyon adlarıyla doğrulanır)', () => {
    const providers = buildTripCostProviders(fullInput());
    expect(providers.map(p => p.name)).toEqual([
      'fuelCostProvider', 'tollCostProvider', 'lodgingCostProvider', 'parkingCostProvider',
    ]);
  });

  it('yalnız toll+parking enabled ise sıra toll → parking (fuel/lodging atlanır, sıra bozulmaz)', () => {
    const providers = buildTripCostProviders(fullInput({ fuel: undefined, lodging: undefined }));
    expect(providers.map(p => p.name)).toEqual(['tollCostProvider', 'parkingCostProvider']);
  });
});

describe('runTripCostPipeline — E) enabled/absent semantiği', () => {
  it('kategori girdisi hiç YOK → raporda hiç yer almaz (missing item ÜRETİLMEZ)', () => {
    const report = runTripCostPipeline({ plan: makePlan() }); // hiçbir kategori yok
    expect(report.knownItems).toHaveLength(0);
    expect(report.missingItems).toHaveLength(0);
    expect(report.knownTotal).toBe(0);
    expect(report.isComplete).toBe(true);
  });

  it('kategori enabled:false → raporda hiç yer almaz (veri dolu olsa bile)', () => {
    const report = runTripCostPipeline(fullInput({
      toll: {
        enabled: false, // veri dolu ama devre dışı
        segments: [{ id: 'seg1', key: 'k1', hasToll: true }],
        priceEntries: [{ segmentKey: 'k1', value: 300, currency: TRY, source: 'user', confidence: 0.9 }],
      },
    }));
    expect(report.knownItems.some(i => i.category === 'toll')).toBe(false);
    expect(report.missingItems.some(i => i.category === 'toll')).toBe(false);
    expect(report.knownTotal).toBe(1000 + 1500 + 100); // toll hariç
  });

  it('kategori enabled:true AMA veri eksik → provider MUTLAKA çalışır, fail-closed unknown üretir', () => {
    const report = runTripCostPipeline(fullInput({
      lodging: { enabled: true, stays: [{ id: 's1', key: 'camp1', nights: 3, kind: 'camp' }], priceEntries: [] },
    }));
    expect(report.missingItems.some(i => i.category === 'lodging')).toBe(true);
    expect(report.isComplete).toBe(false);
  });
});

describe('runTripCostPipeline — F) boş yolculuk (hiç kategori enabled değil)', () => {
  it('çökmez, isComplete=true, knownTotal=0', () => {
    expect(() => runTripCostPipeline({ plan: makePlan() })).not.toThrow();
    const report = runTripCostPipeline({ plan: makePlan() });
    expect(report.isComplete).toBe(true);
    expect(report.knownTotal).toBe(0);
    expect(report.knownItems).toHaveLength(0);
    expect(report.missingItems).toHaveLength(0);
  });

  it('tüm kategoriler enabled:false ile açıkça verilse de aynı sonuç', () => {
    const report = runTripCostPipeline({
      plan: makePlan(),
      fuel: { enabled: false },
      toll: { enabled: false, segments: [], priceEntries: [] },
      lodging: { enabled: false, stays: [], priceEntries: [] },
      parking: { enabled: false, stops: [], priceEntries: [] },
    });
    expect(report.knownTotal).toBe(0);
    expect(report.isComplete).toBe(true);
  });
});

describe('runTripCostPipeline — G) reportCurrency = plan.currency', () => {
  it('plan.currency=EUR ise rapor currency=EUR', () => {
    const report = runTripCostPipeline({
      plan: makePlan({ currency: 'EUR' }),
      parking: {
        enabled: true,
        stops: [{ id: 'p1', key: 'k1' }],
        priceEntries: [{ stopKey: 'k1', pricingUnit: 'flat', value: 50, currency: 'EUR', source: 'user', confidence: 0.9 }],
      },
    });
    expect(report.currency).toBe('EUR');
    expect(report.knownTotal).toBe(50);
  });
});

describe('runTripCostPipeline — H) provider input currency plan ile uyuşmaz → fail-closed', () => {
  it('toll priceEntry currency EUR, plan.currency TRY → toll unknown (mismatch)', () => {
    const report = runTripCostPipeline(fullInput({
      toll: {
        enabled: true,
        segments: [{ id: 'seg1', key: 'k1', hasToll: true }],
        priceEntries: [{ segmentKey: 'k1', value: 300, currency: 'EUR', source: 'user', confidence: 0.9 }],
      },
    }));
    expect(report.missingItems.some(i => i.category === 'toll' && i.noteKey === 'toll_currency_mismatch')).toBe(true);
    expect(report.knownTotal).toBe(1000 + 1500 + 100); // toll hariç
    expect(report.isComplete).toBe(false);
  });
});

describe('runTripCostPipeline — I) input immutable', () => {
  it('TripCostInput mutasyona uğratılmaz', () => {
    const i = fullInput();
    const snapshot = JSON.parse(JSON.stringify(i));
    runTripCostPipeline(i);
    expect(i).toEqual(snapshot);
  });

  it('donmuş (Object.freeze) girdiyle de çalışır', () => {
    const i = Object.freeze(fullInput());
    expect(() => runTripCostPipeline(i)).not.toThrow();
  });
});

describe('runTripCostPipeline — J) provider throw diğer kategorileri etkilemez', () => {
  it('toll priceEntry negatif (throw tetikler) → yalnız toll unknown, fuel/lodging/parking sağlam', () => {
    const report = runTripCostPipeline(fullInput({
      toll: {
        enabled: true,
        segments: [{ id: 'seg1', key: 'k1', hasToll: true }],
        priceEntries: [{ segmentKey: 'k1', value: -300, currency: TRY, source: 'user', confidence: 0.9 }],
      },
    }));
    expect(report.knownTotal).toBe(1000 + 1500 + 100);
    expect(report.missingItems.some(i => i.noteKey === 'provider_error')).toBe(true);
    expect(report.isComplete).toBe(false);
  });
});

describe('runTripCostPipeline — K) deterministik', () => {
  it('aynı input tekrar tekrar çağrılınca AYNI sonucu verir', () => {
    const i = fullInput();
    const r1 = runTripCostPipeline(i);
    const r2 = runTripCostPipeline(i);
    expect(r1.knownTotal).toBe(r2.knownTotal);
    expect(r1.knownItems.map(x => x.category)).toEqual(r2.knownItems.map(x => x.category));
  });
});

describe('runTripCostPipeline — L) plan.legs → FuelProvider doğru aktarılır', () => {
  it('çok-bacaklı plan (120+118km) → fuel toplamı iki bacağı da kapsar', () => {
    const plan = makePlan({
      legs: [
        { id: 'out', distanceKm: 120, origin: 'A', destination: 'B' },
        { id: 'ret', distanceKm: 118, origin: 'B', destination: 'A' },
      ],
    });
    const report = runTripCostPipeline({
      plan,
      fuel: { enabled: true, consumptionL100Km: 6.5, pricePerLiter: 44 },
    });
    const expected = ((120 + 118) * 6.5 / 100) * 44;
    expect(report.knownTotal).toBeCloseTo(expected, 10);
  });
});

describe('runTripCostPipeline — M) toll segments → TollProvider', () => {
  it('çoklu segment doğru toplanır (100+150+75=325)', () => {
    const report = runTripCostPipeline({
      plan: makePlan(),
      toll: {
        enabled: true,
        segments: [{ id: 'a', key: 'k1', hasToll: true }, { id: 'b', key: 'k2', hasToll: true }, { id: 'c', key: 'k3', hasToll: true }],
        priceEntries: [
          { segmentKey: 'k1', value: 100, currency: TRY, source: 'user', confidence: 0.9 },
          { segmentKey: 'k2', value: 150, currency: TRY, source: 'user', confidence: 0.9 },
          { segmentKey: 'k3', value: 75, currency: TRY, source: 'user', confidence: 0.9 },
        ],
      },
    });
    expect(report.knownTotal).toBe(325);
  });
});

describe('runTripCostPipeline — N) lodging stays → LodgingProvider', () => {
  it('çoklu konaklama doğru toplanır (2×500 + 1×1200 = 2200)', () => {
    const report = runTripCostPipeline({
      plan: makePlan(),
      lodging: {
        enabled: true,
        stays: [{ id: 's1', key: 'camp1', nights: 2, kind: 'camp' }, { id: 's2', key: 'hotel1', nights: 1, kind: 'hotel' }],
        priceEntries: [
          { stayKey: 'camp1', perNightValue: 500, currency: TRY, source: 'user', confidence: 0.9, pricingUnit: 'per_stay' },
          { stayKey: 'hotel1', perNightValue: 1200, currency: TRY, source: 'user', confidence: 0.9, pricingUnit: 'per_stay' },
        ],
      },
    });
    expect(report.knownTotal).toBe(2200);
  });
});

describe('runTripCostPipeline — O) parking stops → ParkingProvider', () => {
  it('flat + per_hour karışık doğru toplanır (100 + 2×50 = 200)', () => {
    const report = runTripCostPipeline({
      plan: makePlan(),
      parking: {
        enabled: true,
        stops: [{ id: 'p1', key: 'k1' }, { id: 'p2', key: 'k2', durationHours: 2 }],
        priceEntries: [
          { stopKey: 'k1', pricingUnit: 'flat', value: 100, currency: TRY, source: 'user', confidence: 0.9 },
          { stopKey: 'k2', pricingUnit: 'per_hour', perHourValue: 50, currency: TRY, source: 'user', confidence: 0.9 },
        ],
      },
    });
    expect(report.knownTotal).toBe(200);
  });
});

describe('runTripCostPipeline — P) wiring-seviyesi validation throw', () => {
  it('plan.id boş → THROW', () => {
    expect(() => runTripCostPipeline({ plan: makePlan({ id: '' }) })).toThrow();
  });

  it('plan.currency boş → THROW', () => {
    expect(() => runTripCostPipeline({ plan: makePlan({ currency: '' }) })).toThrow();
  });

  it('plan.legs dizi değilse → THROW', () => {
    expect(() => runTripCostPipeline({ plan: makePlan({ legs: null as never }) })).toThrow();
  });

  it('plan.legs boş AMA fuel.enabled=true → sahte mesafe EKLENMEZ, deterministik (distance=0)', () => {
    const report = runTripCostPipeline({
      plan: makePlan({ legs: [] }),
      fuel: { enabled: true, consumptionL100Km: 8, pricePerLiter: 45 },
    });
    expect(report.knownTotal).toBe(0); // 0 mesafe × tüketim × fiyat = 0, known (sahte mesafe YOK)
    expect(report.isComplete).toBe(true);
    expect(report.knownItems[0].status).toBe('known');
  });

  it('plan.legs boş + fuel.enabled=true AMA tüketim/fiyat yok → unknown (sahte 0 DEĞİL)', () => {
    const report = runTripCostPipeline({
      plan: makePlan({ legs: [] }),
      fuel: { enabled: true },
    });
    expect(report.missingItems).toHaveLength(1);
    expect(report.missingItems[0].value).toBeNull();
  });
});

describe('runTripCostPipeline — saf provider regresyonları', () => {
  it('computeFuelCost hâlâ aynı formülle çalışır', () => {
    const item = computeFuelCost({ legs: [{ distanceKm: 100 }], consumptionL100Km: 8, pricePerLiter: 45, currency: TRY });
    expect(item.value).toBeCloseTo(8 * 45, 10);
  });

  it('computeTollCost hâlâ aynı davranışla çalışır', () => {
    const item = computeTollCost({
      segments: [{ id: 'a', key: 'k1', hasToll: true }],
      priceEntries: [{ segmentKey: 'k1', value: 200, currency: TRY, source: 'user', confidence: 0.9 }],
      reportCurrency: TRY,
    });
    expect(item.value).toBe(200);
  });

  it('computeLodgingCost hâlâ aynı davranışla çalışır', () => {
    const item = computeLodgingCost({
      stays: [{ id: 's1', key: 'k1', nights: 2, kind: 'hotel' }],
      priceEntries: [{ stayKey: 'k1', perNightValue: 1200, currency: TRY, source: 'user', confidence: 0.9, pricingUnit: 'per_stay' }],
      reportCurrency: TRY,
    });
    expect(item.value).toBe(2400);
  });

  it('computeParkingCost hâlâ aynı davranışla çalışır', () => {
    const item = computeParkingCost({
      stops: [{ id: 'p1', key: 'k1' }],
      priceEntries: [{ stopKey: 'k1', pricingUnit: 'flat', value: 150, currency: TRY, source: 'user', confidence: 0.9 }],
      reportCurrency: TRY,
    });
    expect(item.value).toBe(150);
  });
});
