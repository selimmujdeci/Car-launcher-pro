/**
 * lodgingCostProvider.test.ts — TRIP-COST-A3.
 *
 * `computeLodgingCost`/`createLodgingProvider` — fail-closed konaklama (gece)
 * maliyet hesabı. `tollCostProvider` seam'i birebir izlenir. Kapsam:
 * tek/çoklu konaklama · konaklama-yok (known 0) · fiyatsız (unknown) ·
 * parçalı eşleşme · sıfır fiyat geçerli · negatif/NaN/Infinity reddi ·
 * nights<=0 reddi · mixed-currency fail-closed · stale · duplicate id
 * (throw) vs duplicate key (iki rezervasyon) vs duplicate priceKey (throw) ·
 * unsupported pricingUnit → unknown · CostEngine/ConfidenceLedger
 * entegrasyonu · immutable girdi · fuel/toll/tripRecommendationEngine
 * regresyonu.
 */
import { describe, it, expect } from 'vitest';
import {
  computeLodgingCost,
  createLodgingProvider,
  LODGING_NO_STAY_CONFIDENCE,
  type LodgingProviderInput,
  type LodgingStayInput,
  type LodgingPriceEntry,
} from '../platform/trip/cost/providers/lodgingProvider';
import { runCostEngine } from '../platform/trip/cost/costEngine';
import { buildCostReport } from '../platform/trip/cost/confidenceLedger';
import type { TripPlan } from '../platform/trip/cost/models';
import type { CostProvider } from '../platform/trip/cost/providers/types';
import { computeFuelCost } from '../platform/trip/cost/providers/fuelCostProvider';
import { computeTollCost, createTollProvider } from '../platform/trip/cost/providers/tollProvider';

const TRY = 'TRY';

function stay(id: string, key: string, nights: number, overrides: Partial<LodgingStayInput> = {}): LodgingStayInput {
  return { id, key, nights, kind: 'hotel', ...overrides };
}
function price(stayKey: string, perNightValue: number, overrides: Partial<LodgingPriceEntry> = {}): LodgingPriceEntry {
  return { stayKey, perNightValue, currency: TRY, source: 'user', confidence: 0.9, pricingUnit: 'per_stay', ...overrides };
}
function input(overrides: Partial<LodgingProviderInput> = {}): LodgingProviderInput {
  return { stays: [], priceEntries: [], reportCurrency: TRY, ...overrides };
}

function makePlan(): TripPlan {
  return {
    id: 'trip-1', origin: 'Mersin', destination: 'Akyaka',
    legs: [{ id: 'leg-1', distanceKm: 100, origin: 'Mersin', destination: 'Akyaka' }],
    nights: 3, travellers: { adults: 2, children: 3 },
    vehicleProfile: { propulsion: 'fuel', consumptionL100Km: 8 },
    currency: TRY,
  };
}

describe('computeLodgingCost — A) tek kamp', () => {
  it('nights=3 × perNightValue=500 → 1500, known', () => {
    const item = computeLodgingCost(input({
      stays: [stay('s1', 'camp-akyaka', 3, { kind: 'camp' })],
      priceEntries: [price('camp-akyaka', 500)],
    }));
    expect(item.status).toBe('known');
    expect(item.value).toBe(1500);
    expect(item.breakdown?.totalNights).toBe(3);
  });
});

describe('computeLodgingCost — B) tek otel', () => {
  it('nights=2 × perNightValue=1200 → 2400', () => {
    const item = computeLodgingCost(input({
      stays: [stay('s1', 'hotel-akyaka', 2, { kind: 'hotel' })],
      priceEntries: [price('hotel-akyaka', 1200)],
    }));
    expect(item.status).toBe('known');
    expect(item.value).toBe(2400);
  });
});

describe('computeLodgingCost — C) çoklu konaklama toplamı', () => {
  it('2 gece kamp (2×500) + 1 gece otel (1×1200) = 2200', () => {
    const item = computeLodgingCost(input({
      stays: [stay('s1', 'camp1', 2, { kind: 'camp' }), stay('s2', 'hotel1', 1, { kind: 'hotel' })],
      priceEntries: [price('camp1', 500), price('hotel1', 1200)],
    }));
    expect(item.status).toBe('known');
    expect(item.value).toBe(2200);
    expect(item.breakdown?.matchedCount).toBe(2);
    expect(item.breakdown?.totalNights).toBe(3);
  });
});

describe('computeLodgingCost — D) konaklama yok → known 0', () => {
  it('stays boş → value=0, known, sabit yüksek confidence', () => {
    const item = computeLodgingCost(input());
    expect(item.status).toBe('known');
    expect(item.value).toBe(0);
    expect(item.confidence).toBe(LODGING_NO_STAY_CONFIDENCE);
    expect(item.source).toBe('calculated');
    expect(item.breakdown).toEqual({
      stayCount: 0, matchedCount: 0, missingCount: 0, totalNights: 0, pricingUnit: 'per_stay',
    });
  });
});

describe('computeLodgingCost — E) fiyat tablosu tamamen boş → unknown', () => {
  it('value=null, confidence=0, source=unknown, noteKey=lodging_price_required', () => {
    const item = computeLodgingCost(input({ stays: [stay('s1', 'k1', 3)], priceEntries: [] }));
    expect(item.status).toBe('unknown');
    expect(item.value).toBeNull();
    expect(item.confidence).toBe(0);
    expect(item.source).toBe('unknown');
    expect(item.noteKey).toBe('lodging_price_required');
  });

  it('sahte 0 değer YOK — value KESİNLİKLE null', () => {
    const item = computeLodgingCost(input({ stays: [stay('s1', 'k1', 3)], priceEntries: [] }));
    expect(item.value).not.toBe(0);
    expect(item.value).toBeNull();
  });
});

describe('computeLodgingCost — F) parçalı fiyat', () => {
  it('2 stay, yalnız 1 fiyatlı → ana value=null, breakdown knownSubtotal+missingStays dolu', () => {
    const item = computeLodgingCost(input({
      stays: [stay('s1', 'k1', 3), stay('s2', 'k2', 2)],
      priceEntries: [price('k1', 500)],
    }));
    expect(item.status).toBe('unknown');
    expect(item.value).toBeNull();
    expect(item.breakdown?.knownSubtotal).toBe(1500); // yalnız breakdown'da — PARÇALI
    expect(item.breakdown?.matchedCount).toBe(1);
    expect(item.breakdown?.missingCount).toBe(1);
    const missing = item.breakdown?.missingStays as Array<{ stayKey: string; nights: number }>;
    expect(missing).toHaveLength(1);
    expect(missing[0].stayKey).toBe('k2');
    expect(missing[0].nights).toBe(2);
  });
});

describe('computeLodgingCost — G) perNight 0 geçerli', () => {
  it('perNightValue=0, source=user → known (unknown DEĞİL)', () => {
    const item = computeLodgingCost(input({
      stays: [stay('s1', 'k1', 3)],
      priceEntries: [price('k1', 0, { source: 'user', confidence: 1 })],
    }));
    expect(item.status).toBe('known');
    expect(item.value).toBe(0);
  });
});

describe('computeLodgingCost — H) nights<=0 → throw', () => {
  it('nights=0 → THROW', () => {
    expect(() => computeLodgingCost(input({ stays: [stay('s1', 'k1', 0)] }))).toThrow();
  });

  it('negatif nights → THROW', () => {
    expect(() => computeLodgingCost(input({ stays: [stay('s1', 'k1', -2)] }))).toThrow();
  });

  it('NaN nights → THROW', () => {
    expect(() => computeLodgingCost(input({ stays: [stay('s1', 'k1', NaN)] }))).toThrow();
  });
});

describe('computeLodgingCost — I/J/K) negatif/NaN/Infinity fiyat + confidence reddi', () => {
  it('negatif perNightValue → THROW', () => {
    expect(() => computeLodgingCost(input({
      stays: [stay('s1', 'k1', 2)], priceEntries: [price('k1', -50)],
    }))).toThrow();
  });

  it('NaN perNightValue → THROW', () => {
    expect(() => computeLodgingCost(input({
      stays: [stay('s1', 'k1', 2)], priceEntries: [price('k1', NaN)],
    }))).toThrow();
  });

  it('Infinity perNightValue → THROW', () => {
    expect(() => computeLodgingCost(input({
      stays: [stay('s1', 'k1', 2)], priceEntries: [price('k1', Infinity)],
    }))).toThrow();
  });

  it('confidence 0..1 dışı → THROW', () => {
    expect(() => computeLodgingCost(input({
      stays: [stay('s1', 'k1', 2)], priceEntries: [price('k1', 500, { confidence: 1.2 })],
    }))).toThrow();
  });
});

describe('computeLodgingCost — L) karışık currency → fail-closed', () => {
  it('bir stay TRY bir stay EUR (reportCurrency=TRY) → unknown, mismatchedCurrencyStays dolu', () => {
    const item = computeLodgingCost(input({
      stays: [stay('s1', 'k1', 2), stay('s2', 'k2', 1)],
      priceEntries: [price('k1', 500, { currency: TRY }), price('k2', 30, { currency: 'EUR' })],
    }));
    expect(item.status).toBe('unknown');
    expect(item.value).toBeNull();
    expect(item.noteKey).toBe('lodging_currency_mismatch');
    const mism = item.breakdown?.mismatchedCurrencyStays as Array<{ stayKey: string; currency: string }>;
    expect(mism).toHaveLength(1);
    expect(mism[0].stayKey).toBe('k2');
  });
});

describe('computeLodgingCost — M) reportCurrency uyuşmazlığı → fail-closed', () => {
  it('tek fiyat reportCurrency ile uyuşmuyor → unknown (döviz OTOMATİK ÇEVRİLMEDİ)', () => {
    const item = computeLodgingCost(input({
      stays: [stay('s1', 'k1', 2)],
      priceEntries: [price('k1', 50, { currency: 'USD' })],
    }));
    expect(item.status).toBe('unknown');
    expect(item.noteKey).toBe('lodging_currency_mismatch');
  });

  it('eksik fiyat + currency mismatch birlikte → EKSİK (missing) ÖNCELİKLİDİR', () => {
    const item = computeLodgingCost(input({
      stays: [stay('s1', 'k1', 2), stay('s2', 'k2', 1)],
      priceEntries: [price('k1', 500, { currency: 'EUR' })], // k2 hiç yok + k1 currency uyumsuz
    }));
    expect(item.status).toBe('unknown');
    expect(item.noteKey).toBe('lodging_price_required'); // currency_mismatch DEĞİL
  });
});

describe('computeLodgingCost — N) stale davranışı', () => {
  it('tüm fiyat var + biri stale → toplam hesaplanır, status=stale, ledger staleItems', () => {
    const item = computeLodgingCost(input({
      stays: [stay('s1', 'k1', 2), stay('s2', 'k2', 1)],
      priceEntries: [price('k1', 500, { stale: false }), price('k2', 1200, { stale: true })],
    }));
    expect(item.status).toBe('stale');
    expect(item.value).toBe(2200);
    const staleList = item.breakdown?.staleStays as Array<{ stayKey: string }>;
    expect(staleList).toHaveLength(1);
    expect(staleList[0].stayKey).toBe('k2');

    const report = buildCostReport([item], TRY);
    expect(report.staleItems).toHaveLength(1);
    expect(report.knownTotal).toBe(2200); // stale toplamda TUTULUR
  });
});

describe('computeLodgingCost — O) eksik + stale birlikte → unknown öncelikli', () => {
  it('bir stay stale-fiyatlı, diğeri fiyatsız → value=null (unknown öncelikli)', () => {
    const item = computeLodgingCost(input({
      stays: [stay('s1', 'k1', 2), stay('s2', 'k2', 1)],
      priceEntries: [price('k1', 500, { stale: true })], // k2 eksik
    }));
    expect(item.status).toBe('unknown');
    expect(item.value).toBeNull();
    expect(item.noteKey).toBe('lodging_price_required');
  });
});

describe('computeLodgingCost — P) immutable girdi', () => {
  it('input.stays/priceEntries mutasyona uğratılmaz', () => {
    const i = input({
      stays: [stay('s1', 'k1', 3)],
      priceEntries: [price('k1', 500)],
    });
    const snapshot = JSON.parse(JSON.stringify(i));
    computeLodgingCost(i);
    expect(i).toEqual(snapshot);
  });

  it('donmuş (Object.freeze) girdiyle de çalışır', () => {
    const i = Object.freeze(input({
      stays: Object.freeze([stay('s1', 'k1', 3)]) as readonly LodgingStayInput[],
      priceEntries: Object.freeze([price('k1', 500)]) as readonly LodgingPriceEntry[],
    }));
    expect(() => computeLodgingCost(i)).not.toThrow();
  });
});

describe('computeLodgingCost — Q) deterministik', () => {
  it('aynı girdi tekrar tekrar çağrılınca AYNI sonucu verir', () => {
    const i = input({ stays: [stay('s1', 'k1', 3)], priceEntries: [price('k1', 500)] });
    const a = computeLodgingCost(i);
    const b = computeLodgingCost(i);
    expect(a.value).toBe(b.value);
    expect(a.status).toBe(b.status);
    expect(a).toEqual(b); // her çağrı yeni obje ama içerik AYNI
  });
});

describe('R) CostEngine DI entegrasyonu — ledger doğru katılım', () => {
  it('fuel + toll + lodging birlikte → knownTotal doğru toplanır', () => {
    const plan = makePlan();
    const fuelProvider: CostProvider = () => computeFuelCost({
      legs: plan.legs, consumptionL100Km: 8, pricePerLiter: 45, currency: TRY,
    });
    const tollProvider = createTollProvider(() => ({
      segments: [{ id: 'seg1', key: 'k1', hasToll: true }],
      priceEntries: [{ segmentKey: 'k1', value: 200, currency: TRY, source: 'user', confidence: 0.9 }],
      reportCurrency: TRY,
    }));
    const lodgingProvider = createLodgingProvider(() => input({
      stays: [stay('s1', 'camp1', 3, { kind: 'camp' })],
      priceEntries: [price('camp1', 500)],
    }));

    const report = runCostEngine(plan, [fuelProvider, tollProvider, lodgingProvider]);
    const expectedFuel = (100 * 8 / 100) * 45;
    expect(report.knownTotal).toBeCloseTo(expectedFuel + 200 + 1500, 10);
    expect(report.isComplete).toBe(true);
  });

  it('eksik lodging fiyatı → engine raporunda missingItems + isComplete=false, diğerleri etkilenmez', () => {
    const plan = makePlan();
    const fuelProvider: CostProvider = () => computeFuelCost({
      legs: plan.legs, consumptionL100Km: 8, pricePerLiter: 45, currency: TRY,
    });
    const lodgingProvider = createLodgingProvider(() => input({ stays: [stay('s1', 'k1', 3)], priceEntries: [] }));

    const report = runCostEngine(plan, [fuelProvider, lodgingProvider]);
    const expectedFuel = (100 * 8 / 100) * 45;
    expect(report.knownTotal).toBeCloseTo(expectedFuel, 10);
    expect(report.isComplete).toBe(false);
    expect(report.missingItems.some(i => i.category === 'lodging')).toBe(true);
  });
});

describe('S) provider throw → CostEngine izolasyonu', () => {
  it('lodging provider throw ederse (negatif fiyat) diğer provider etkilenmez', () => {
    const plan = makePlan();
    const fuelProvider: CostProvider = () => computeFuelCost({
      legs: plan.legs, consumptionL100Km: 8, pricePerLiter: 45, currency: TRY,
    });
    const brokenLodging = createLodgingProvider(() => input({
      stays: [stay('s1', 'k1', 2)],
      priceEntries: [price('k1', -500)], // throw tetikler
    }));

    expect(() => runCostEngine(plan, [fuelProvider, brokenLodging])).not.toThrow();
    const report = runCostEngine(plan, [fuelProvider, brokenLodging]);
    const expectedFuel = (100 * 8 / 100) * 45;
    expect(report.knownTotal).toBeCloseTo(expectedFuel, 10);
    expect(report.isComplete).toBe(false);
    expect(report.missingItems.some(i => i.noteKey === 'provider_error')).toBe(true);
  });

  it('duplicate stay.id throw eder ama CostEngine bütünü çökertmez', () => {
    const plan = makePlan();
    const dupLodging = createLodgingProvider(() => input({
      stays: [stay('same-id', 'k1', 2), stay('same-id', 'k2', 3)],
      priceEntries: [price('k1', 500), price('k2', 700)],
    }));
    const report = runCostEngine(plan, [dupLodging]);
    expect(report.missingItems).toHaveLength(1);
    expect(report.missingItems[0].noteKey).toBe('provider_error');
  });

  it('duplicate priceEntries.stayKey throw eder ama CostEngine izole eder', () => {
    const plan = makePlan();
    const dupPriceLodging = createLodgingProvider(() => input({
      stays: [stay('s1', 'k1', 2)],
      priceEntries: [price('k1', 500), price('k1', 700)],
    }));
    const report = runCostEngine(plan, [dupPriceLodging]);
    expect(report.missingItems).toHaveLength(1);
    expect(report.missingItems[0].noteKey).toBe('provider_error');
  });
});

describe('T1) duplicate kararı — id throw, key iki rezervasyon', () => {
  it('AYNI stay.id iki kez → THROW', () => {
    expect(() => computeLodgingCost(input({
      stays: [stay('same-id', 'k1', 2), stay('same-id', 'k2', 3)],
      priceEntries: [price('k1', 500), price('k2', 700)],
    }))).toThrow();
  });

  it('priceEntries içinde AYNI stayKey iki kez → AMBIGUOUS, THROW', () => {
    expect(() => computeLodgingCost(input({
      stays: [stay('s1', 'k1', 2)],
      priceEntries: [price('k1', 500), price('k1', 700)],
    }))).toThrow();
  });

  it('FARKLI id AMA AYNI key → iki gerçek rezervasyon, İKİSİ DE hesaplanır', () => {
    const item = computeLodgingCost(input({
      stays: [stay('booking-1', 'camp-akyaka', 2), stay('booking-2', 'camp-akyaka', 3)],
      priceEntries: [price('camp-akyaka', 500)],
    }));
    expect(item.status).toBe('known');
    // (2 gece × 500) + (3 gece × 500) = 2500 — iki AYRI rezervasyon, aynı fiyat kaydı kullanılır
    expect(item.value).toBe(2500);
    expect(item.breakdown?.matchedCount).toBe(2);
    expect(item.breakdown?.stayCount).toBe(2);
  });
});

describe('T2) unsupported pricingUnit → unknown', () => {
  it('eşleşen fiyat kaydı pricingUnit=per_person ise SESSİZCE yanlış hesaplanmaz, unknown döner', () => {
    const item = computeLodgingCost(input({
      stays: [stay('s1', 'k1', 3)],
      priceEntries: [price('k1', 500, { pricingUnit: 'per_person' })],
    }));
    expect(item.status).toBe('unknown');
    expect(item.value).toBeNull();
    expect(item.noteKey).toBe('lodging_price_required');
    const unsup = item.breakdown?.unsupportedPricingUnitStays as Array<{ stayKey: string; pricingUnit: string }>;
    expect(unsup).toHaveLength(1);
    expect(unsup[0].stayKey).toBe('k1');
    expect(unsup[0].pricingUnit).toBe('per_person');
  });

  it('per_adult / per_child de aynı şekilde unpriceable sayılır', () => {
    const adultItem = computeLodgingCost(input({
      stays: [stay('s1', 'k1', 2)], priceEntries: [price('k1', 300, { pricingUnit: 'per_adult' })],
    }));
    expect(adultItem.status).toBe('unknown');

    const childItem = computeLodgingCost(input({
      stays: [stay('s1', 'k1', 2)], priceEntries: [price('k1', 150, { pricingUnit: 'per_child' })],
    }));
    expect(childItem.status).toBe('unknown');
  });
});

describe('weightedConfidence (maliyet-ağırlıklı)', () => {
  it('iki stay: (1500, conf 0.9) + (2400, conf 0.5) → (1500*0.9+2400*0.5)/3900', () => {
    const item = computeLodgingCost(input({
      stays: [stay('s1', 'k1', 3), stay('s2', 'k2', 2)],
      priceEntries: [price('k1', 500, { confidence: 0.9 }), price('k2', 1200, { confidence: 0.5 })],
    }));
    const expected = (1500 * 0.9 + 2400 * 0.5) / (1500 + 2400);
    expect(item.confidence).toBeCloseTo(expected, 10);
  });

  it('ΣstayCost=0 (tüm eşleşen fiyatlar 0) → deterministik basit ortalama, bölme hatası YOK', () => {
    const item = computeLodgingCost(input({
      stays: [stay('s1', 'k1', 2), stay('s2', 'k2', 1)],
      priceEntries: [price('k1', 0, { confidence: 1 }), price('k2', 0, { confidence: 0.5 })],
    }));
    expect(item.status).toBe('known');
    expect(item.value).toBe(0);
    expect(Number.isFinite(item.confidence)).toBe(true);
    expect(item.confidence).toBeCloseTo((1 + 0.5) / 2, 10);
  });

  it('kaynak tek ortaksa korunur, farklıysa "calculated"a düşer', () => {
    const single = computeLodgingCost(input({
      stays: [stay('s1', 'k1', 2), stay('s2', 'k2', 1)],
      priceEntries: [price('k1', 500, { source: 'user' }), price('k2', 1200, { source: 'user' })],
    }));
    expect(single.source).toBe('user');

    const mixed = computeLodgingCost(input({
      stays: [stay('s1', 'k1', 2), stay('s2', 'k2', 1)],
      priceEntries: [price('k1', 500, { source: 'user' }), price('k2', 1200, { source: 'osm' })],
    }));
    expect(mixed.source).toBe('calculated');
  });
});

describe('createLodgingProvider — CostProvider adaptörü', () => {
  it('CostProvider olarak çalışır, fonksiyon adı teşhis için mevcut', () => {
    const provider = createLodgingProvider(() => input({
      stays: [stay('s1', 'k1', 3)],
      priceEntries: [price('k1', 500)],
    }));
    expect(provider.name).toBe('lodgingCostProvider');
    const item = provider(makePlan(), { reportCurrency: TRY }) as ReturnType<typeof computeLodgingCost>;
    expect(item.value).toBe(1500);
  });
});

describe('T3) fuel + toll regresyonu — lodgingProvider eklenmesi diğerlerini BOZMADI', () => {
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
    expect(item.status).toBe('known');
  });
});
