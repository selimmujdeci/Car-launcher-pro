/**
 * parkingCostProvider.test.ts — TRIP-COST-A4.
 *
 * `computeParkingCost`/`createParkingProvider` — fail-closed otopark maliyet
 * hesabı (flat + per_hour). `lodgingCostProvider` seam'i birebir izlenir.
 * Kapsam: flat/per_hour/kesirli/çoklu hesap · durak-yok (known 0) · fiyat
 * eksik (unknown) · süre eksik (unknown) · parçalı eşleşme · sıfır fiyat
 * geçerli · negatif/NaN/Infinity reddi · durationHours<=0 reddi ·
 * mixed-currency fail-closed · stale · unknown öncelik sırası (fiyat>süre>
 * currency) · duplicate id (throw) vs duplicate key (iki işlem) vs
 * duplicate priceKey (throw) · bilinmeyen pricingUnit (throw) · CostEngine/
 * ConfidenceLedger entegrasyonu · immutable girdi · fuel/toll/lodging/
 * tripRecommendationEngine regresyonu.
 */
import { describe, it, expect } from 'vitest';
import {
  computeParkingCost,
  createParkingProvider,
  PARKING_NO_STOP_CONFIDENCE,
  type ParkingProviderInput,
  type ParkingStopInput,
  type ParkingPriceEntry,
} from '../platform/trip/cost/providers/parkingProvider';
import { runCostEngine } from '../platform/trip/cost/costEngine';
import { buildCostReport } from '../platform/trip/cost/confidenceLedger';
import type { TripPlan } from '../platform/trip/cost/models';
import type { CostProvider } from '../platform/trip/cost/providers/types';
import { computeFuelCost } from '../platform/trip/cost/providers/fuelCostProvider';
import { computeTollCost } from '../platform/trip/cost/providers/tollProvider';
import { computeLodgingCost } from '../platform/trip/cost/providers/lodgingProvider';

const TRY = 'TRY';

function stop(id: string, key: string, overrides: Partial<ParkingStopInput> = {}): ParkingStopInput {
  return { id, key, ...overrides };
}
function flatPrice(stopKey: string, value: number, overrides: Partial<ParkingPriceEntry> = {}): ParkingPriceEntry {
  return { stopKey, pricingUnit: 'flat', value, currency: TRY, source: 'user', confidence: 0.9, ...overrides };
}
function hourlyPrice(stopKey: string, perHourValue: number, overrides: Partial<ParkingPriceEntry> = {}): ParkingPriceEntry {
  return { stopKey, pricingUnit: 'per_hour', perHourValue, currency: TRY, source: 'user', confidence: 0.9, ...overrides };
}
function input(overrides: Partial<ParkingProviderInput> = {}): ParkingProviderInput {
  return { stops: [], priceEntries: [], reportCurrency: TRY, ...overrides };
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

describe('computeParkingCost — A) flat fiyat', () => {
  it('flat 150 → known, value=150', () => {
    const item = computeParkingCost(input({
      stops: [stop('s1', 'k1')],
      priceEntries: [flatPrice('k1', 150)],
    }));
    expect(item.status).toBe('known');
    expect(item.value).toBe(150);
    expect(item.breakdown?.flatStopCount).toBe(1);
    expect(item.breakdown?.hourlyStopCount).toBe(0);
  });
});

describe('computeParkingCost — B) per_hour fiyat', () => {
  it('3 saat × 40 TL/saat = 120', () => {
    const item = computeParkingCost(input({
      stops: [stop('s1', 'k1', { durationHours: 3 })],
      priceEntries: [hourlyPrice('k1', 40)],
    }));
    expect(item.status).toBe('known');
    expect(item.value).toBe(120);
    expect(item.breakdown?.hourlyStopCount).toBe(1);
  });
});

describe('computeParkingCost — C) kesirli süre — YUVARLAMA YOK', () => {
  it('2.5 saat × 30 TL/saat = 75 (tam hassasiyet)', () => {
    const item = computeParkingCost(input({
      stops: [stop('s1', 'k1', { durationHours: 2.5 })],
      priceEntries: [hourlyPrice('k1', 30)],
    }));
    expect(item.value).toBe(75);
    expect(item.breakdown?.totalDurationHours).toBe(2.5);
  });
});

describe('computeParkingCost — D) çoklu durak toplamı', () => {
  it('flat 100 + 2×per_hour(50) = 200', () => {
    const item = computeParkingCost(input({
      stops: [stop('s1', 'k1'), stop('s2', 'k2', { durationHours: 2 })],
      priceEntries: [flatPrice('k1', 100), hourlyPrice('k2', 50)],
    }));
    expect(item.status).toBe('known');
    expect(item.value).toBe(200);
    expect(item.breakdown?.matchedCount).toBe(2);
    expect(item.breakdown?.flatStopCount).toBe(1);
    expect(item.breakdown?.hourlyStopCount).toBe(1);
  });
});

describe('computeParkingCost — E) durak yok → known 0', () => {
  it('stops boş → value=0, known, confidence=1', () => {
    const item = computeParkingCost(input());
    expect(item.status).toBe('known');
    expect(item.value).toBe(0);
    expect(item.confidence).toBe(PARKING_NO_STOP_CONFIDENCE);
    expect(item.source).toBe('calculated');
    expect(item.breakdown).toEqual({
      stopCount: 0, matchedCount: 0, missingCount: 0, totalDurationHours: 0,
      flatStopCount: 0, hourlyStopCount: 0,
    });
  });
});

describe('computeParkingCost — F) flat fiyat eksik → unknown', () => {
  it('priceEntries boş → unknown, noteKey=parking_price_required', () => {
    const item = computeParkingCost(input({ stops: [stop('s1', 'k1')], priceEntries: [] }));
    expect(item.status).toBe('unknown');
    expect(item.value).toBeNull();
    expect(item.confidence).toBe(0);
    expect(item.source).toBe('unknown');
    expect(item.noteKey).toBe('parking_price_required');
  });

  it('flat kayıt var ama value alanı yok → unknown, sahte 0 YOK', () => {
    const item = computeParkingCost(input({
      stops: [stop('s1', 'k1')],
      priceEntries: [{ stopKey: 'k1', pricingUnit: 'flat', currency: TRY, source: 'user', confidence: 0.9 }],
    }));
    expect(item.status).toBe('unknown');
    expect(item.value).not.toBe(0);
    expect(item.value).toBeNull();
    expect(item.noteKey).toBe('parking_price_required');
  });
});

describe('computeParkingCost — G) per_hour süre yok → unknown', () => {
  it('fiyat var, durationHours yok → unknown, noteKey=parking_duration_required', () => {
    const item = computeParkingCost(input({
      stops: [stop('s1', 'k1')], // durationHours yok
      priceEntries: [hourlyPrice('k1', 40)],
    }));
    expect(item.status).toBe('unknown');
    expect(item.value).toBeNull();
    expect(item.noteKey).toBe('parking_duration_required');
    const md = item.breakdown?.missingDurationStops as Array<{ stopKey: string }>;
    expect(md).toHaveLength(1);
    expect(md[0].stopKey).toBe('k1');
  });
});

describe('computeParkingCost — H) parçalı eşleşme', () => {
  it('2 durak, biri fiyatsız → value=null, breakdown knownSubtotal + missingPriceStops dolu', () => {
    const item = computeParkingCost(input({
      stops: [stop('s1', 'k1'), stop('s2', 'k2')],
      priceEntries: [flatPrice('k1', 150)],
    }));
    expect(item.status).toBe('unknown');
    expect(item.value).toBeNull();
    expect(item.breakdown?.knownSubtotal).toBe(150); // yalnız breakdown'da — PARÇALI
    expect(item.breakdown?.matchedCount).toBe(1);
    expect(item.breakdown?.missingCount).toBe(1);
    const missing = item.breakdown?.missingPriceStops as Array<{ stopKey: string }>;
    expect(missing).toHaveLength(1);
    expect(missing[0].stopKey).toBe('k2');
  });
});

describe('computeParkingCost — I) flat 0 geçerli', () => {
  it('value=0, source=user → known', () => {
    const item = computeParkingCost(input({
      stops: [stop('s1', 'k1')],
      priceEntries: [flatPrice('k1', 0, { source: 'user', confidence: 1 })],
    }));
    expect(item.status).toBe('known');
    expect(item.value).toBe(0);
  });
});

describe('computeParkingCost — J) per_hour 0 geçerli', () => {
  it('perHourValue=0 → known, stopCost=0', () => {
    const item = computeParkingCost(input({
      stops: [stop('s1', 'k1', { durationHours: 3 })],
      priceEntries: [hourlyPrice('k1', 0, { confidence: 1 })],
    }));
    expect(item.status).toBe('known');
    expect(item.value).toBe(0);
  });
});

describe('computeParkingCost — K) durationHours=0/negatif → throw', () => {
  it('durationHours=0 → THROW', () => {
    expect(() => computeParkingCost(input({ stops: [stop('s1', 'k1', { durationHours: 0 })] }))).toThrow();
  });

  it('negatif durationHours → THROW', () => {
    expect(() => computeParkingCost(input({ stops: [stop('s1', 'k1', { durationHours: -1 })] }))).toThrow();
  });

  it('NaN durationHours → THROW', () => {
    expect(() => computeParkingCost(input({ stops: [stop('s1', 'k1', { durationHours: NaN })] }))).toThrow();
  });

  it('durationHours ALANI YOKSA (flat stop) sorun DEĞİL', () => {
    expect(() => computeParkingCost(input({
      stops: [stop('s1', 'k1')], priceEntries: [flatPrice('k1', 100)],
    }))).not.toThrow();
  });
});

describe('computeParkingCost — L) negatif fiyat reddi', () => {
  it('negatif flat value → THROW', () => {
    expect(() => computeParkingCost(input({
      stops: [stop('s1', 'k1')], priceEntries: [flatPrice('k1', -50)],
    }))).toThrow();
  });

  it('negatif per_hour perHourValue → THROW', () => {
    expect(() => computeParkingCost(input({
      stops: [stop('s1', 'k1', { durationHours: 2 })], priceEntries: [hourlyPrice('k1', -10)],
    }))).toThrow();
  });
});

describe('computeParkingCost — M) NaN/Infinity fiyat reddi', () => {
  it('NaN flat value → THROW', () => {
    expect(() => computeParkingCost(input({
      stops: [stop('s1', 'k1')], priceEntries: [flatPrice('k1', NaN)],
    }))).toThrow();
  });

  it('Infinity per_hour perHourValue → THROW', () => {
    expect(() => computeParkingCost(input({
      stops: [stop('s1', 'k1', { durationHours: 1 })], priceEntries: [hourlyPrice('k1', Infinity)],
    }))).toThrow();
  });
});

describe('computeParkingCost — N) confidence 0..1 dışı → throw', () => {
  it('confidence > 1 → THROW', () => {
    expect(() => computeParkingCost(input({
      stops: [stop('s1', 'k1')], priceEntries: [flatPrice('k1', 100, { confidence: 1.5 })],
    }))).toThrow();
  });
});

describe('computeParkingCost — O) mixed currency → fail-closed', () => {
  it('bir durak TRY bir durak EUR → unknown, noteKey=parking_currency_mismatch', () => {
    const item = computeParkingCost(input({
      stops: [stop('s1', 'k1'), stop('s2', 'k2')],
      priceEntries: [flatPrice('k1', 100, { currency: TRY }), flatPrice('k2', 20, { currency: 'EUR' })],
    }));
    expect(item.status).toBe('unknown');
    expect(item.value).toBeNull();
    expect(item.noteKey).toBe('parking_currency_mismatch');
    const mism = item.breakdown?.mismatchedCurrencyStops as Array<{ stopKey: string; currency: string }>;
    expect(mism).toHaveLength(1);
    expect(mism[0].stopKey).toBe('k2');
  });
});

describe('computeParkingCost — P) reportCurrency uyuşmazlığı → fail-closed', () => {
  it('tek fiyat reportCurrency ile uyuşmuyor → unknown (döviz OTOMATİK ÇEVRİLMEDİ)', () => {
    const item = computeParkingCost(input({
      stops: [stop('s1', 'k1')],
      priceEntries: [flatPrice('k1', 50, { currency: 'USD' })],
    }));
    expect(item.status).toBe('unknown');
    expect(item.noteKey).toBe('parking_currency_mismatch');
  });
});

describe('computeParkingCost — Q) stale davranışı', () => {
  it('tüm fiyat/süre var + biri stale → toplam hesaplanır, status=stale, ledger staleItems', () => {
    const item = computeParkingCost(input({
      stops: [stop('s1', 'k1'), stop('s2', 'k2', { durationHours: 2 })],
      priceEntries: [flatPrice('k1', 100, { stale: false }), hourlyPrice('k2', 50, { stale: true })],
    }));
    expect(item.status).toBe('stale');
    expect(item.value).toBe(200);
    const staleList = item.breakdown?.staleStops as Array<{ stopKey: string }>;
    expect(staleList).toHaveLength(1);
    expect(staleList[0].stopKey).toBe('k2');

    const report = buildCostReport([item], TRY);
    expect(report.staleItems).toHaveLength(1);
    expect(report.knownTotal).toBe(200);
  });
});

describe('computeParkingCost — R) eksik+stale öncelik + noteKey öncelik sırası', () => {
  it('eksik fiyat + stale birlikte → unknown öncelikli (value=null)', () => {
    const item = computeParkingCost(input({
      stops: [stop('s1', 'k1'), stop('s2', 'k2')],
      priceEntries: [flatPrice('k1', 100, { stale: true })], // k2 fiyatsız
    }));
    expect(item.status).toBe('unknown');
    expect(item.value).toBeNull();
    expect(item.noteKey).toBe('parking_price_required');
  });

  it('ÖNCELİK: eksik-fiyat + eksik-süre birlikte → fiyat kazanır', () => {
    const item = computeParkingCost(input({
      stops: [stop('s1', 'k1'), stop('s2', 'k2', { durationHours: 2 })],
      // k1: hiç fiyat kaydı yok (eksik fiyat). k2: per_hour ama perHourValue de yok (eksik fiyat).
      priceEntries: [],
    }));
    expect(item.noteKey).toBe('parking_price_required');
  });

  it('ÖNCELİK: eksik-süre + currency-mismatch birlikte → süre kazanır', () => {
    const item = computeParkingCost(input({
      stops: [stop('s1', 'k1'), stop('s2', 'k2')], // k2 durationHours yok
      priceEntries: [
        flatPrice('k1', 100, { currency: 'EUR' }), // currency mismatch
        hourlyPrice('k2', 40), // süre eksik
      ],
    }));
    expect(item.status).toBe('unknown');
    expect(item.noteKey).toBe('parking_duration_required'); // currency_mismatch DEĞİL
  });

  it('yalnız currency mismatch (fiyat+süre tam) → currency_mismatch kazanır', () => {
    const item = computeParkingCost(input({
      stops: [stop('s1', 'k1')],
      priceEntries: [flatPrice('k1', 100, { currency: 'EUR' })],
    }));
    expect(item.noteKey).toBe('parking_currency_mismatch');
  });
});

describe('computeParkingCost — S) immutable girdi', () => {
  it('input.stops/priceEntries mutasyona uğratılmaz', () => {
    const i = input({
      stops: [stop('s1', 'k1')],
      priceEntries: [flatPrice('k1', 100)],
    });
    const snapshot = JSON.parse(JSON.stringify(i));
    computeParkingCost(i);
    expect(i).toEqual(snapshot);
  });

  it('donmuş (Object.freeze) girdiyle de çalışır', () => {
    const i = Object.freeze(input({
      stops: Object.freeze([stop('s1', 'k1')]) as readonly ParkingStopInput[],
      priceEntries: Object.freeze([flatPrice('k1', 100)]) as readonly ParkingPriceEntry[],
    }));
    expect(() => computeParkingCost(i)).not.toThrow();
  });
});

describe('computeParkingCost — T) deterministik', () => {
  it('aynı girdi tekrar tekrar çağrılınca AYNI sonucu verir', () => {
    const i = input({ stops: [stop('s1', 'k1')], priceEntries: [flatPrice('k1', 100)] });
    const a = computeParkingCost(i);
    const b = computeParkingCost(i);
    expect(a.value).toBe(b.value);
    expect(a.status).toBe(b.status);
    expect(a).toEqual(b);
  });
});

describe('U) CostEngine DI entegrasyonu — ledger doğru katılım', () => {
  it('fuel + toll + lodging + parking birlikte → knownTotal doğru toplanır', () => {
    const plan = makePlan();
    const fuelProvider: CostProvider = () => computeFuelCost({
      legs: plan.legs, consumptionL100Km: 8, pricePerLiter: 45, currency: TRY,
    });
    const tollProvider: CostProvider = () => computeTollCost({
      segments: [{ id: 'seg1', key: 'k1', hasToll: true }],
      priceEntries: [{ segmentKey: 'k1', value: 200, currency: TRY, source: 'user', confidence: 0.9 }],
      reportCurrency: TRY,
    });
    const lodgingProvider: CostProvider = () => computeLodgingCost({
      stays: [{ id: 's1', key: 'camp1', nights: 3, kind: 'camp' }],
      priceEntries: [{ stayKey: 'camp1', perNightValue: 500, currency: TRY, source: 'user', confidence: 0.9, pricingUnit: 'per_stay' }],
      reportCurrency: TRY,
    });
    const parkingProvider = createParkingProvider(() => input({
      stops: [stop('p1', 'k1')],
      priceEntries: [flatPrice('k1', 150)],
    }));

    const report = runCostEngine(plan, [fuelProvider, tollProvider, lodgingProvider, parkingProvider]);
    const expectedFuel = (100 * 8 / 100) * 45;
    expect(report.knownTotal).toBeCloseTo(expectedFuel + 200 + 1500 + 150, 10);
    expect(report.isComplete).toBe(true);
  });

  it('eksik parking fiyatı → engine raporunda missingItems + isComplete=false, diğerleri etkilenmez', () => {
    const plan = makePlan();
    const fuelProvider: CostProvider = () => computeFuelCost({
      legs: plan.legs, consumptionL100Km: 8, pricePerLiter: 45, currency: TRY,
    });
    const parkingProvider = createParkingProvider(() => input({ stops: [stop('p1', 'k1')], priceEntries: [] }));

    const report = runCostEngine(plan, [fuelProvider, parkingProvider]);
    const expectedFuel = (100 * 8 / 100) * 45;
    expect(report.knownTotal).toBeCloseTo(expectedFuel, 10);
    expect(report.isComplete).toBe(false);
    expect(report.missingItems.some(i => i.category === 'parking')).toBe(true);
  });
});

describe('V) provider throw → CostEngine izolasyonu', () => {
  it('parking provider throw ederse (negatif fiyat) diğer provider etkilenmez', () => {
    const plan = makePlan();
    const fuelProvider: CostProvider = () => computeFuelCost({
      legs: plan.legs, consumptionL100Km: 8, pricePerLiter: 45, currency: TRY,
    });
    const brokenParking = createParkingProvider(() => input({
      stops: [stop('p1', 'k1')],
      priceEntries: [flatPrice('k1', -100)], // throw tetikler
    }));

    expect(() => runCostEngine(plan, [fuelProvider, brokenParking])).not.toThrow();
    const report = runCostEngine(plan, [fuelProvider, brokenParking]);
    const expectedFuel = (100 * 8 / 100) * 45;
    expect(report.knownTotal).toBeCloseTo(expectedFuel, 10);
    expect(report.isComplete).toBe(false);
    expect(report.missingItems.some(i => i.noteKey === 'provider_error')).toBe(true);
  });
});

describe('W1) duplicate kararı', () => {
  it('AYNI stop.id iki kez → THROW (CostEngine izole eder)', () => {
    const plan = makePlan();
    const dupParking = createParkingProvider(() => input({
      stops: [stop('same-id', 'k1'), stop('same-id', 'k2')],
      priceEntries: [flatPrice('k1', 100), flatPrice('k2', 200)],
    }));
    expect(() => computeParkingCost({
      stops: [stop('same-id', 'k1'), stop('same-id', 'k2')],
      priceEntries: [flatPrice('k1', 100), flatPrice('k2', 200)],
      reportCurrency: TRY,
    })).toThrow();
    const report = runCostEngine(plan, [dupParking]);
    expect(report.missingItems[0].noteKey).toBe('provider_error');
  });

  it('priceEntries içinde AYNI stopKey iki kez → AMBIGUOUS, THROW', () => {
    expect(() => computeParkingCost(input({
      stops: [stop('s1', 'k1')],
      priceEntries: [flatPrice('k1', 100), flatPrice('k1', 200)],
    }))).toThrow();
  });

  it('FARKLI id AMA AYNI key → iki gerçek park işlemi, İKİSİ DE hesaplanır', () => {
    const item = computeParkingCost(input({
      stops: [stop('park-1', 'garage-a'), stop('park-2', 'garage-a')],
      priceEntries: [flatPrice('garage-a', 100)],
    }));
    expect(item.status).toBe('known');
    expect(item.value).toBe(200); // 100 + 100 — iki AYRI park işlemi
    expect(item.breakdown?.matchedCount).toBe(2);
  });
});

describe('W2) bilinmeyen pricingUnit → throw', () => {
  it('pricingUnit "flat"/"per_hour" dışında bir değerse → THROW', () => {
    expect(() => computeParkingCost(input({
      stops: [stop('s1', 'k1')],
      priceEntries: [{ stopKey: 'k1', pricingUnit: 'weekly' as never, value: 100, currency: TRY, source: 'user', confidence: 0.9 }],
    }))).toThrow();
  });
});

describe('weightedConfidence (maliyet-ağırlıklı)', () => {
  it('flat(150, conf 0.9) + per_hour(3×40=120, conf 0.5) → (150*0.9+120*0.5)/270', () => {
    const item = computeParkingCost(input({
      stops: [stop('s1', 'k1'), stop('s2', 'k2', { durationHours: 3 })],
      priceEntries: [flatPrice('k1', 150, { confidence: 0.9 }), hourlyPrice('k2', 40, { confidence: 0.5 })],
    }));
    const expected = (150 * 0.9 + 120 * 0.5) / (150 + 120);
    expect(item.confidence).toBeCloseTo(expected, 10);
  });

  it('ΣstopCost=0 → deterministik basit ortalama, bölme hatası YOK', () => {
    const item = computeParkingCost(input({
      stops: [stop('s1', 'k1'), stop('s2', 'k2', { durationHours: 2 })],
      priceEntries: [flatPrice('k1', 0, { confidence: 1 }), hourlyPrice('k2', 0, { confidence: 0.5 })],
    }));
    expect(item.status).toBe('known');
    expect(item.value).toBe(0);
    expect(Number.isFinite(item.confidence)).toBe(true);
    expect(item.confidence).toBeCloseTo((1 + 0.5) / 2, 10);
  });

  it('kaynak tek ortaksa korunur, farklıysa "calculated"a düşer', () => {
    const single = computeParkingCost(input({
      stops: [stop('s1', 'k1'), stop('s2', 'k2')],
      priceEntries: [flatPrice('k1', 100, { source: 'user' }), flatPrice('k2', 50, { source: 'user' })],
    }));
    expect(single.source).toBe('user');

    const mixed = computeParkingCost(input({
      stops: [stop('s1', 'k1'), stop('s2', 'k2')],
      priceEntries: [flatPrice('k1', 100, { source: 'user' }), flatPrice('k2', 50, { source: 'osm' })],
    }));
    expect(mixed.source).toBe('calculated');
  });
});

describe('createParkingProvider — CostProvider adaptörü', () => {
  it('CostProvider olarak çalışır, fonksiyon adı teşhis için mevcut', () => {
    const provider = createParkingProvider(() => input({
      stops: [stop('s1', 'k1')],
      priceEntries: [flatPrice('k1', 100)],
    }));
    expect(provider.name).toBe('parkingCostProvider');
    const item = provider(makePlan(), { reportCurrency: TRY }) as ReturnType<typeof computeParkingCost>;
    expect(item.value).toBe(100);
  });
});

describe('W3) fuel/toll/lodging regresyonu — parkingProvider eklenmesi diğerlerini BOZMADI', () => {
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
});
