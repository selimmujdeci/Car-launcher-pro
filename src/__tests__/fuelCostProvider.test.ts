/**
 * fuelCostProvider.test.ts — TRIP-COST-A1 Faz A.
 *
 * `computeFuelCost`/`createFuelCostProvider`. Kapsam: formül (I) ·
 * gidiş-dönüş multi-leg (J) · tüketim/fiyat yoksa unknown (K) · unknown'da
 * sahte değer YOK (L) · negatif mesafe/fiyat reddi · YUVARLAMA YOK ·
 * source/breakdown şeffaflığı.
 */
import { describe, it, expect } from 'vitest';
import { computeFuelCost, createFuelCostProvider, type FuelCostInput } from '../platform/trip/cost/providers/fuelCostProvider';
import type { TripPlan } from '../platform/trip/cost/models';

const TRY = 'TRY';

function input(overrides: Partial<FuelCostInput> = {}): FuelCostInput {
  return {
    legs:              [{ distanceKm: 100 }],
    consumptionL100Km: 8,
    pricePerLiter:     45,
    currency:          TRY,
    ...overrides,
  };
}

describe('computeFuelCost — I) formül: distanceKm × L100/100 × price', () => {
  it('100km, 8L/100km, 45 TL/L → liters=8, cost=360', () => {
    const item = computeFuelCost(input());
    expect(item.status).toBe('known');
    expect(item.value).toBeCloseTo(8 * 45, 10);
    expect(item.breakdown?.estimatedLiters).toBeCloseTo(8, 10);
  });

  it('YUVARLAMA YOK — kesirli sonuç tam hassasiyetle korunur', () => {
    const item = computeFuelCost(input({ legs: [{ distanceKm: 137 }], consumptionL100Km: 7.3, pricePerLiter: 44.87 }));
    const expectedLiters = (137 * 7.3) / 100;
    const expectedCost   = expectedLiters * 44.87;
    expect(item.breakdown?.estimatedLiters).toBe(expectedLiters); // tam eşitlik — yuvarlama yapılmadı
    expect(item.value).toBe(expectedCost);
  });
});

describe('computeFuelCost — J) gidiş-dönüş iki leg toplamı', () => {
  it('out=120km + return=118km → totalDistanceKm=238, buna göre hesap', () => {
    const item = computeFuelCost(input({ legs: [{ distanceKm: 120 }, { distanceKm: 118 }], consumptionL100Km: 6.5, pricePerLiter: 44 }));
    expect(item.breakdown?.totalDistanceKm).toBe(238);
    const expectedLiters = (238 * 6.5) / 100;
    expect(item.breakdown?.estimatedLiters).toBeCloseTo(expectedLiters, 10);
    expect(item.value).toBeCloseTo(expectedLiters * 44, 10);
    expect(item.breakdown?.legCount).toBe(2);
  });
});

describe('computeFuelCost — K) tüketim/fiyat yoksa unknown', () => {
  it('consumptionL100Km yok → unknown, value:null, confidence:0', () => {
    const item = computeFuelCost(input({ consumptionL100Km: undefined }));
    expect(item.status).toBe('unknown');
    expect(item.value).toBeNull();
    expect(item.confidence).toBe(0);
  });

  it('consumptionL100Km <= 0 → unknown', () => {
    const item = computeFuelCost(input({ consumptionL100Km: 0 }));
    expect(item.status).toBe('unknown');
    const item2 = computeFuelCost(input({ consumptionL100Km: -3 }));
    expect(item2.status).toBe('unknown');
  });

  it('pricePerLiter yok (null) → unknown', () => {
    const item = computeFuelCost(input({ pricePerLiter: null }));
    expect(item.status).toBe('unknown');
    expect(item.value).toBeNull();
  });
});

describe('computeFuelCost — L) unknown fuel\'de sıfır/sahte değer YOK', () => {
  it('unknown durumda value KESİNLİKLE null — 0 DEĞİL', () => {
    const item = computeFuelCost(input({ pricePerLiter: null }));
    expect(item.value).toBeNull();
    expect(item.value).not.toBe(0); // 0 ile null AYRI kavramlar — 0 sahte bir "ücretsiz" izlenimi verirdi
  });

  it('unknown durumda breakdown estimatedLiters de null — uydurulmuş sayı YOK', () => {
    const item = computeFuelCost(input({ consumptionL100Km: undefined }));
    expect(item.breakdown?.estimatedLiters).toBeNull();
  });
});

describe('computeFuelCost — negatif/geçersiz girdi reddi', () => {
  it('negatif mesafe → REDDEDİLİR (throw)', () => {
    expect(() => computeFuelCost(input({ legs: [{ distanceKm: -10 }] }))).toThrow();
  });

  it('NaN mesafe → REDDEDİLİR', () => {
    expect(() => computeFuelCost(input({ legs: [{ distanceKm: NaN }] }))).toThrow();
  });

  it('negatif fiyat → REDDEDİLİR', () => {
    expect(() => computeFuelCost(input({ pricePerLiter: -5 }))).toThrow();
  });

  it('0 mesafe → geçerli (0 km rota — 0 litre, 0 maliyet, known)', () => {
    const item = computeFuelCost(input({ legs: [{ distanceKm: 0 }] }));
    expect(item.status).toBe('known');
    expect(item.value).toBe(0);
  });
});

describe('computeFuelCost — source/breakdown şeffaflığı', () => {
  it('source verilmezse "calculated"', () => {
    const item = computeFuelCost(input());
    expect(item.source).toBe('calculated');
  });

  it('source="user" verilirse KORUNUR (provider kendi kaynağını EZMEZ)', () => {
    const item = computeFuelCost(input({ source: 'user', confidence: 0.95 }));
    expect(item.source).toBe('user');
    expect(item.confidence).toBe(0.95);
  });

  it('breakdown legCount doğru sayılır (3 leg)', () => {
    const item = computeFuelCost(input({ legs: [{ distanceKm: 10 }, { distanceKm: 20 }, { distanceKm: 30 }] }));
    expect(item.breakdown?.legCount).toBe(3);
    expect(item.breakdown?.totalDistanceKm).toBe(60);
  });

  it('editable varsayılan true, açıkça false verilirse korunur', () => {
    expect(computeFuelCost(input()).editable).toBe(true);
    expect(computeFuelCost(input({ editable: false })).editable).toBe(false);
  });
});

describe('createFuelCostProvider — CostProvider adaptörü', () => {
  function makePlan(): TripPlan {
    return {
      id: 'trip-1', origin: 'A', destination: 'B',
      legs: [{ id: 'leg-1', distanceKm: 200, origin: 'A', destination: 'B' }],
      nights: 0,
      travellers: { adults: 2, children: 0 },
      vehicleProfile: { propulsion: 'fuel', consumptionL100Km: 7 },
      currency: TRY,
    };
  }

  it('plan.legs + plan.vehicleProfile.consumptionL100Km\'den doğru CostItem üretir', () => {
    const provider = createFuelCostProvider((plan, ctx) => ({
      legs: plan.legs,
      consumptionL100Km: plan.vehicleProfile.consumptionL100Km,
      pricePerLiter: 44,
      currency: ctx.reportCurrency,
    }));
    const item = provider(makePlan(), { reportCurrency: TRY }) as ReturnType<typeof computeFuelCost>;
    expect(item.status).toBe('known');
    expect(item.value).toBeCloseTo((200 * 7 / 100) * 44, 10);
  });

  it('fonksiyon adı "fuelCostProvider" — CostEngine hata teşhisinde kullanılabilir', () => {
    const provider = createFuelCostProvider(() => input());
    expect(provider.name).toBe('fuelCostProvider');
  });
});
