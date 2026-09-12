/**
 * tollCostProvider.test.ts — TRIP-COST-A2.
 *
 * `computeTollCost`/`createTollProvider` — fail-closed toll (ücretli geçiş)
 * maliyet hesabı. `fuelCostProvider` seam'i birebir izlenir. Kapsam:
 * hiç-ücretli-segment (known 0) · tam eşleşme (known) · parçalı eşleşme
 * (unknown, PARÇALI toplam ana değere sızmaz) · sıfır fiyat geçerli ·
 * negatif/NaN/Infinity reddi · mixed-currency fail-closed · stale ·
 * duplicate segment.id (iki geçiş) vs duplicate priceEntry.segmentKey
 * (throw) · CostEngine/ConfidenceLedger entegrasyonu · immutable girdi ·
 * fuel/tripRecommendationEngine regresyonu.
 */
import { describe, it, expect } from 'vitest';
import {
  computeTollCost,
  createTollProvider,
  TOLL_NO_SEGMENT_CONFIDENCE,
  type TollProviderInput,
  type TollSegmentInput,
  type TollPriceEntry,
} from '../platform/trip/cost/providers/tollProvider';
import { runCostEngine } from '../platform/trip/cost/costEngine';
import { buildCostReport } from '../platform/trip/cost/confidenceLedger';
import type { TripPlan } from '../platform/trip/cost/models';
import type { CostProvider } from '../platform/trip/cost/providers/types';
import { computeFuelCost } from '../platform/trip/cost/providers/fuelCostProvider';

const TRY = 'TRY';

function seg(id: string, key: string, hasToll = true, overrides: Partial<TollSegmentInput> = {}): TollSegmentInput {
  return { id, key, hasToll, ...overrides };
}
function price(segmentKey: string, value: number, overrides: Partial<TollPriceEntry> = {}): TollPriceEntry {
  return { segmentKey, value, currency: TRY, source: 'user', confidence: 0.9, ...overrides };
}
function input(overrides: Partial<TollProviderInput> = {}): TollProviderInput {
  return { segments: [], priceEntries: [], reportCurrency: TRY, ...overrides };
}

describe('computeTollCost — A) hiç ücretli segment yok → known 0', () => {
  it('segments boş → value=0, known, sabit yüksek confidence', () => {
    const item = computeTollCost(input());
    expect(item.status).toBe('known');
    expect(item.value).toBe(0);
    expect(item.confidence).toBe(TOLL_NO_SEGMENT_CONFIDENCE);
    expect(item.source).toBe('calculated');
    expect(item.breakdown).toEqual({ tollSegmentCount: 0, matchedCount: 0, missingCount: 0 });
  });

  it('yalnız hasToll=false segmentler → yok sayılır, DURUM 1 ile aynı', () => {
    const item = computeTollCost(input({ segments: [seg('s1', 'free-road', false)] }));
    expect(item.status).toBe('known');
    expect(item.value).toBe(0);
  });
});

describe('computeTollCost — B) tek eşleşen toll', () => {
  it('key "tarsus-pozanti" → 200 TRY, source user, breakdown eşleşmeyi gösterir', () => {
    const item = computeTollCost(input({
      segments: [seg('leg1-seg1', 'tarsus-pozanti')],
      priceEntries: [price('tarsus-pozanti', 200, { source: 'user' })],
    }));
    expect(item.status).toBe('known');
    expect(item.value).toBe(200);
    expect(item.source).toBe('user');
    expect(item.breakdown?.matchedCount).toBe(1);
    expect(item.breakdown?.tollSegmentCount).toBe(1);
    const matched = item.breakdown?.matchedSegments as Array<{ segmentKey: string; value: number }>;
    expect(matched).toHaveLength(1);
    expect(matched[0].segmentKey).toBe('tarsus-pozanti');
    expect(matched[0].value).toBe(200);
  });
});

describe('computeTollCost — C) çoklu ücretli segment toplamı', () => {
  it('100 + 150 + 75 = 325', () => {
    const item = computeTollCost(input({
      segments: [seg('a', 'k1'), seg('b', 'k2'), seg('c', 'k3')],
      priceEntries: [price('k1', 100), price('k2', 150), price('k3', 75)],
    }));
    expect(item.status).toBe('known');
    expect(item.value).toBe(325);
    expect(item.breakdown?.matchedCount).toBe(3);
    expect(item.breakdown?.missingCount).toBe(0);
  });
});

describe('computeTollCost — D) toll var, fiyat tablosu tamamen boş → unknown', () => {
  it('value=null, confidence=0, source=unknown, noteKey=toll_price_required', () => {
    const item = computeTollCost(input({ segments: [seg('a', 'k1')], priceEntries: [] }));
    expect(item.status).toBe('unknown');
    expect(item.value).toBeNull();
    expect(item.confidence).toBe(0);
    expect(item.source).toBe('unknown');
    expect(item.noteKey).toBe('toll_price_required');
  });

  it('sahte 0 değer YOK — value KESİNLİKLE null, 0 DEĞİL', () => {
    const item = computeTollCost(input({ segments: [seg('a', 'k1')], priceEntries: [] }));
    expect(item.value).not.toBe(0);
    expect(item.value).toBeNull();
  });
});

describe('computeTollCost — E) parçalı fiyat (bazı segment fiyatlı, bazı değil)', () => {
  it('2 ücretli segment, yalnız 1 fiyatlı → ana value=null, breakdown knownSubtotal+missingSegments dolu', () => {
    const item = computeTollCost(input({
      segments: [seg('a', 'k1'), seg('b', 'k2')],
      priceEntries: [price('k1', 100)],
    }));
    expect(item.status).toBe('unknown');
    expect(item.value).toBeNull(); // PARÇALI toplam ana değere SIZMADI
    expect(item.breakdown?.knownSubtotal).toBe(100); // yalnız breakdown'da görünür
    expect(item.breakdown?.matchedCount).toBe(1);
    expect(item.breakdown?.missingCount).toBe(1);
    const missing = item.breakdown?.missingSegments as Array<{ segmentKey: string }>;
    expect(missing).toHaveLength(1);
    expect(missing[0].segmentKey).toBe('k2');
    expect(item.noteKey).toBe('toll_price_required');
  });
});

describe('computeTollCost — F) fiyat 0 geçerli', () => {
  it('value=0, source=user → known (unknown DEĞİL)', () => {
    const item = computeTollCost(input({
      segments: [seg('a', 'k1')],
      priceEntries: [price('k1', 0, { source: 'user', confidence: 1 })],
    }));
    expect(item.status).toBe('known');
    expect(item.value).toBe(0);
  });
});

describe('computeTollCost — G/H) negatif ve NaN/Infinity fiyat reddi', () => {
  it('negatif fiyat → THROW', () => {
    expect(() => computeTollCost(input({
      segments: [seg('a', 'k1')],
      priceEntries: [price('k1', -50)],
    }))).toThrow();
  });

  it('NaN fiyat → THROW', () => {
    expect(() => computeTollCost(input({
      segments: [seg('a', 'k1')],
      priceEntries: [price('k1', NaN)],
    }))).toThrow();
  });

  it('Infinity fiyat → THROW', () => {
    expect(() => computeTollCost(input({
      segments: [seg('a', 'k1')],
      priceEntries: [price('k1', Infinity)],
    }))).toThrow();
  });

  it('confidence 0..1 dışı → THROW', () => {
    expect(() => computeTollCost(input({
      segments: [seg('a', 'k1')],
      priceEntries: [price('k1', 100, { confidence: 1.5 })],
    }))).toThrow();
  });
});

describe('computeTollCost — I) currency korunur', () => {
  it('rapor EUR ise ve fiyatlar EUR ise item.currency=EUR', () => {
    const item = computeTollCost({
      segments: [seg('a', 'k1')],
      priceEntries: [price('k1', 20, { currency: 'EUR' })],
      reportCurrency: 'EUR',
    });
    expect(item.currency).toBe('EUR');
    expect(item.status).toBe('known');
    expect(item.value).toBe(20);
  });
});

describe('computeTollCost — J) karışık para birimi → fail-closed unknown', () => {
  it('bir segment TRY bir segment EUR (reportCurrency=TRY) → unknown, mismatchedCurrencySegments dolu', () => {
    const item = computeTollCost(input({
      segments: [seg('a', 'k1'), seg('b', 'k2')],
      priceEntries: [price('k1', 100, { currency: TRY }), price('k2', 20, { currency: 'EUR' })],
    }));
    expect(item.status).toBe('unknown');
    expect(item.value).toBeNull();
    expect(item.noteKey).toBe('toll_currency_mismatch');
    const mism = item.breakdown?.mismatchedCurrencySegments as Array<{ segmentKey: string; currency: string }>;
    expect(mism).toHaveLength(1);
    expect(mism[0].segmentKey).toBe('k2');
    expect(mism[0].currency).toBe('EUR');
  });

  it('tek fiyat reportCurrency ile uyuşmuyor → unknown (döviz OTOMATİK ÇEVRİLMEDİ)', () => {
    const item = computeTollCost(input({
      segments: [seg('a', 'k1')],
      priceEntries: [price('k1', 50, { currency: 'USD' })],
    }));
    expect(item.status).toBe('unknown');
    expect(item.noteKey).toBe('toll_currency_mismatch');
  });

  it('eksik fiyat + currency mismatch birlikte → EKSİK (missing) ÖNCELİKLİDİR', () => {
    const item = computeTollCost(input({
      segments: [seg('a', 'k1'), seg('b', 'k2')],
      priceEntries: [price('k1', 100, { currency: 'EUR' })], // k2 hiç yok + k1 currency uyumsuz
    }));
    expect(item.status).toBe('unknown');
    expect(item.noteKey).toBe('toll_price_required'); // currency_mismatch DEĞİL
    expect(item.breakdown?.missingCount).toBe(1);
  });
});

describe('computeTollCost — stale davranışı', () => {
  it('tüm fiyat var + biri stale → toplam hesaplanır, status=stale', () => {
    const item = computeTollCost(input({
      segments: [seg('a', 'k1'), seg('b', 'k2')],
      priceEntries: [price('k1', 100, { stale: false }), price('k2', 50, { stale: true })],
    }));
    expect(item.status).toBe('stale');
    expect(item.value).toBe(150);
  });

  it('eksik fiyat + stale birlikte → UNKNOWN önceliklidir (value=null)', () => {
    const item = computeTollCost(input({
      segments: [seg('a', 'k1'), seg('b', 'k2')],
      priceEntries: [price('k1', 100, { stale: true })], // k2 eksik
    }));
    expect(item.status).toBe('unknown');
    expect(item.value).toBeNull();
    expect(item.noteKey).toBe('toll_price_required');
  });
});

describe('computeTollCost — duplicate kararı', () => {
  it('AYNI segment.id iki kez (gidiş-dönüş aynı köprü) → İKİSİ DE sayılır/toplanır', () => {
    const item = computeTollCost(input({
      segments: [seg('cross-1', 'bosphorus-bridge'), seg('cross-2', 'bosphorus-bridge')],
      priceEntries: [price('bosphorus-bridge', 60)],
    }));
    expect(item.status).toBe('known');
    expect(item.value).toBe(120); // 60 + 60 — iki gerçek geçiş
    expect(item.breakdown?.tollSegmentCount).toBe(2);
    expect(item.breakdown?.matchedCount).toBe(2);
  });

  it('priceEntries içinde AYNI segmentKey iki kez → AMBIGUOUS, THROW', () => {
    expect(() => computeTollCost(input({
      segments: [seg('a', 'k1')],
      priceEntries: [price('k1', 100), price('k1', 150)],
    }))).toThrow();
  });
});

describe('computeTollCost — weightedConfidence (fiyat-ağırlıklı)', () => {
  it('iki segment: (100, conf 0.9) + (200, conf 0.5) → (100*0.9+200*0.5)/300', () => {
    const item = computeTollCost(input({
      segments: [seg('a', 'k1'), seg('b', 'k2')],
      priceEntries: [price('k1', 100, { confidence: 0.9 }), price('k2', 200, { confidence: 0.5 })],
    }));
    const expected = (100 * 0.9 + 200 * 0.5) / 300;
    expect(item.confidence).toBeCloseTo(expected, 10);
  });

  it('Σvalue=0 (tüm eşleşen fiyatlar 0) → deterministik basit ortalama, bölme hatası YOK', () => {
    const item = computeTollCost(input({
      segments: [seg('a', 'k1'), seg('b', 'k2')],
      priceEntries: [price('k1', 0, { confidence: 1 }), price('k2', 0, { confidence: 0.5 })],
    }));
    expect(item.status).toBe('known');
    expect(item.value).toBe(0);
    expect(() => item.confidence).not.toThrow();
    expect(Number.isFinite(item.confidence)).toBe(true);
    expect(item.confidence).toBeCloseTo((1 + 0.5) / 2, 10);
  });

  it('kaynak tek ortaksa korunur, farklıysa "calculated"a düşer', () => {
    const single = computeTollCost(input({
      segments: [seg('a', 'k1'), seg('b', 'k2')],
      priceEntries: [price('k1', 100, { source: 'user' }), price('k2', 50, { source: 'user' })],
    }));
    expect(single.source).toBe('user');

    const mixed = computeTollCost(input({
      segments: [seg('a', 'k1'), seg('b', 'k2')],
      priceEntries: [price('k1', 100, { source: 'user' }), price('k2', 50, { source: 'osm' })],
    }));
    expect(mixed.source).toBe('calculated');
  });
});

describe('computeTollCost — K) immutable girdi', () => {
  it('input.segments/priceEntries mutasyona uğratılmaz', () => {
    const i = input({
      segments: [seg('a', 'k1')],
      priceEntries: [price('k1', 100)],
    });
    const snapshot = JSON.parse(JSON.stringify(i));
    computeTollCost(i);
    expect(i).toEqual(snapshot);
  });

  it('donmuş (Object.freeze) girdiyle de çalışır', () => {
    const i = Object.freeze(input({
      segments: Object.freeze([seg('a', 'k1')]) as readonly TollSegmentInput[],
      priceEntries: Object.freeze([price('k1', 100)]) as readonly TollPriceEntry[],
    }));
    expect(() => computeTollCost(i)).not.toThrow();
  });
});

describe('createTollProvider — CostProvider adaptörü', () => {
  function makePlan(): TripPlan {
    return {
      id: 'trip-1', origin: 'A', destination: 'B',
      legs: [{ id: 'leg-1', distanceKm: 200, origin: 'A', destination: 'B' }],
      nights: 0, travellers: { adults: 2, children: 0 },
      vehicleProfile: { propulsion: 'fuel', consumptionL100Km: 7 },
      currency: TRY,
    };
  }

  it('CostProvider olarak çalışır, fonksiyon adı teşhis için mevcut', () => {
    const provider = createTollProvider(() => input({
      segments: [seg('a', 'k1')],
      priceEntries: [price('k1', 100)],
    }));
    expect(provider.name).toBe('tollCostProvider');
    const item = provider(makePlan(), { reportCurrency: TRY }) as ReturnType<typeof computeTollCost>;
    expect(item.value).toBe(100);
  });
});

describe('L) CostEngine DI entegrasyonu — ledger doğru katılım', () => {
  it('fuel + toll birlikte → knownTotal doğru toplanır', () => {
    const plan: TripPlan = {
      id: 'trip-1', origin: 'A', destination: 'B',
      legs: [{ id: 'leg-1', distanceKm: 100, origin: 'A', destination: 'B' }],
      nights: 0, travellers: { adults: 2, children: 0 },
      vehicleProfile: { propulsion: 'fuel', consumptionL100Km: 8 },
      currency: TRY,
    };
    const tollProvider = createTollProvider(() => input({
      segments: [seg('a', 'k1')],
      priceEntries: [price('k1', 200)],
    }));
    const fuelProvider: CostProvider = () => computeFuelCost({
      legs: plan.legs, consumptionL100Km: 8, pricePerLiter: 45, currency: TRY,
    });

    const report = runCostEngine(plan, [fuelProvider, tollProvider]);
    const expectedFuel = (100 * 8 / 100) * 45;
    expect(report.knownTotal).toBeCloseTo(expectedFuel + 200, 10);
    expect(report.isComplete).toBe(true);
  });

  it('eksik toll fiyatı → engine raporunda missingItems + isComplete=false, diğer kalemler etkilenmez', () => {
    const plan: TripPlan = {
      id: 'trip-1', origin: 'A', destination: 'B',
      legs: [{ id: 'leg-1', distanceKm: 100, origin: 'A', destination: 'B' }],
      nights: 0, travellers: { adults: 2, children: 0 },
      vehicleProfile: { propulsion: 'fuel', consumptionL100Km: 8 },
      currency: TRY,
    };
    const tollProvider = createTollProvider(() => input({ segments: [seg('a', 'k1')], priceEntries: [] }));
    const fuelProvider: CostProvider = () => computeFuelCost({
      legs: plan.legs, consumptionL100Km: 8, pricePerLiter: 45, currency: TRY,
    });

    const report = runCostEngine(plan, [fuelProvider, tollProvider]);
    const expectedFuel = (100 * 8 / 100) * 45;
    expect(report.knownTotal).toBeCloseTo(expectedFuel, 10); // yalnız fuel — toll unknown
    expect(report.isComplete).toBe(false);
    expect(report.missingItems.some(i => i.category === 'toll')).toBe(true);
  });

  it('toll doğrudan buildCostReport ile de doğru işlenir (known+stale ayrımı)', () => {
    const known = computeTollCost(input({
      segments: [seg('a', 'k1')],
      priceEntries: [price('k1', 100, { stale: false })],
    }));
    const stale = computeTollCost(input({
      segments: [seg('b', 'k2')],
      priceEntries: [price('k2', 50, { stale: true })],
    }));
    const report = buildCostReport([known, stale], TRY);
    expect(report.knownTotal).toBe(150); // stale de toplamda TUTULUR
    expect(report.staleItems).toHaveLength(1);
    expect(report.isComplete).toBe(true); // stale eksik SAYILMAZ
  });
});

describe('M) provider throw → CostEngine izolasyonu korunur', () => {
  it('toll provider throw ederse (negatif fiyat) diğer provider etkilenmez', () => {
    const plan: TripPlan = {
      id: 'trip-1', origin: 'A', destination: 'B',
      legs: [{ id: 'leg-1', distanceKm: 100, origin: 'A', destination: 'B' }],
      nights: 0, travellers: { adults: 2, children: 0 },
      vehicleProfile: { propulsion: 'fuel', consumptionL100Km: 8 },
      currency: TRY,
    };
    const brokenToll = createTollProvider(() => input({
      segments: [seg('a', 'k1')],
      priceEntries: [price('k1', -100)], // throw tetikler
    }));
    const fuelProvider: CostProvider = () => computeFuelCost({
      legs: plan.legs, consumptionL100Km: 8, pricePerLiter: 45, currency: TRY,
    });

    expect(() => runCostEngine(plan, [fuelProvider, brokenToll])).not.toThrow();
    const report = runCostEngine(plan, [fuelProvider, brokenToll]);
    const expectedFuel = (100 * 8 / 100) * 45;
    expect(report.knownTotal).toBeCloseTo(expectedFuel, 10); // fuel sağlam
    expect(report.isComplete).toBe(false);
    expect(report.missingItems.some(i => i.noteKey === 'provider_error')).toBe(true);
  });

  it('duplicate priceKey throw eder ama CostEngine bütünü çökertmez', () => {
    const plan: TripPlan = {
      id: 'trip-1', origin: 'A', destination: 'B', legs: [],
      nights: 0, travellers: { adults: 1, children: 0 },
      vehicleProfile: { propulsion: 'unknown' }, currency: TRY,
    };
    const dupToll = createTollProvider(() => input({
      segments: [seg('a', 'k1')],
      priceEntries: [price('k1', 100), price('k1', 200)],
    }));
    const report = runCostEngine(plan, [dupToll]);
    expect(report.missingItems).toHaveLength(1);
    expect(report.missingItems[0].noteKey).toBe('provider_error');
  });
});

describe('M) FuelCostProvider regresyonu — tollProvider eklenmesi fuel\'i BOZMADI', () => {
  it('computeFuelCost hâlâ aynı formülle çalışır', () => {
    const item = computeFuelCost({ legs: [{ distanceKm: 100 }], consumptionL100Km: 8, pricePerLiter: 45, currency: TRY });
    expect(item.value).toBeCloseTo(8 * 45, 10);
  });
});
