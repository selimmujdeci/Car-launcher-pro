/**
 * tripCostRouteAdapter.test.ts — TRIP-COST-B2.
 *
 * `buildTripPlanFromActiveRoute`/`buildTripPlanFromPreviewLegs` — SAF gerçek-
 * rota → TripPlan dönüşümü. Kapsam: tek-leg (ActiveRoute) · m→km hassasiyeti ·
 * durationS aynen · çoklu-leg (preview) · sıra korunur · metadata zorunlu
 * alanlar (id/currency/origin/destination/nights) · legEndpoints zorunlu/
 * uzunluk kontrolü · negatif/NaN/Infinity reddi · 0 geçerli · boş leg listesi
 * reddi · immutable girdi · deterministik çıktı · pipeline entegrasyonu
 * (300 TRY) · ActiveRoute/tripPreviewEngine/tripApplyEngine regresyonu.
 */
import { describe, it, expect } from 'vitest';
import {
  buildTripPlanFromActiveRoute,
  buildTripPlanFromPreviewLegs,
  type TripPlanMetadata,
} from '../platform/trip/cost/tripCostRouteAdapter';
import { runTripCostPipeline, type TripCostInput } from '../platform/trip/cost/tripCostPipeline';
import type { ActiveRoute } from '../platform/trip/tripApplyEngine';
import type { LegRouteResult } from '../platform/trip/tripPreviewEngine';

const TRY = 'TRY';

function baseMetadata(overrides: Partial<TripPlanMetadata> = {}): TripPlanMetadata {
  return {
    id: 'trip-1',
    currency: TRY,
    origin: 'Mersin',
    destination: 'Akyaka',
    nights: 3,
    travellers: { adults: 2, children: 3 },
    vehicleProfile: { propulsion: 'fuel', consumptionL100Km: 8 },
    ...overrides,
  };
}

function activeRoute(overrides: Partial<ActiveRoute> = {}): ActiveRoute {
  return {
    geometry: [[34.6, 36.8], [28.9, 37.0]],
    distanceM: 12500,
    durationS: 900,
    etaEpochMs: Date.now() + 900_000,
    ...overrides,
  };
}

function legResult(distanceM: number, durationS: number): LegRouteResult {
  return { geometry: [[0, 0], [1, 1]], distanceM, durationS };
}

describe('buildTripPlanFromActiveRoute — A) tek ActiveRoute', () => {
  it('distanceM=12500, durationS=900 → legs.length=1, distanceKm=12.5, durationSeconds=900', () => {
    const plan = buildTripPlanFromActiveRoute(activeRoute({ distanceM: 12500, durationS: 900 }), baseMetadata());
    expect(plan.legs).toHaveLength(1);
    expect(plan.legs[0].distanceKm).toBe(12.5);
    expect(plan.legs[0].durationSeconds).toBe(900);
  });
});

describe('buildTripPlanFromActiveRoute — B) m→km hassasiyet (yuvarlama YOK)', () => {
  it('1234 m → 1.234 km (tam hassasiyet)', () => {
    const plan = buildTripPlanFromActiveRoute(activeRoute({ distanceM: 1234 }), baseMetadata());
    expect(plan.legs[0].distanceKm).toBe(1.234);
  });

  it('12500 m → 12.5 km', () => {
    const plan = buildTripPlanFromActiveRoute(activeRoute({ distanceM: 12500 }), baseMetadata());
    expect(plan.legs[0].distanceKm).toBe(12.5);
  });
});

describe('buildTripPlanFromActiveRoute — C) durationS aynen korunur', () => {
  it('durationS=900 → durationSeconds=900 (dönüşüm yok)', () => {
    const plan = buildTripPlanFromActiveRoute(activeRoute({ durationS: 900 }), baseMetadata());
    expect(plan.legs[0].durationSeconds).toBe(900);
  });
});

describe('buildTripPlanFromPreviewLegs — D) çoklu preview leg', () => {
  it('3 leg (10000/600, 25000/1500, 5000/300) → 3 leg, sıra korunur, tek bacağa SIKIŞMAZ', () => {
    const legs = [legResult(10000, 600), legResult(25000, 1500), legResult(5000, 300)];
    const plan = buildTripPlanFromPreviewLegs(legs, baseMetadata({
      legEndpoints: ['Mersin', 'Tarsus', 'Silifke', 'Akyaka'],
    }));
    expect(plan.legs).toHaveLength(3);
    expect(plan.legs.map(l => l.distanceKm)).toEqual([10, 25, 5]);
    expect(plan.legs.map(l => l.durationSeconds)).toEqual([600, 1500, 300]);
    // sıra korunur — origin/destination endpoint zincirine göre
    expect(plan.legs[0]).toMatchObject({ origin: 'Mersin', destination: 'Tarsus' });
    expect(plan.legs[1]).toMatchObject({ origin: 'Tarsus', destination: 'Silifke' });
    expect(plan.legs[2]).toMatchObject({ origin: 'Silifke', destination: 'Akyaka' });
  });
});

describe('E) iki ayrı API deterministik davranış', () => {
  it('buildTripPlanFromActiveRoute AYNI girdiyle AYNI çıktı üretir', () => {
    const route = activeRoute();
    const a = buildTripPlanFromActiveRoute(route, baseMetadata());
    const b = buildTripPlanFromActiveRoute(route, baseMetadata());
    expect(a).toEqual(b);
  });

  it('buildTripPlanFromPreviewLegs AYNI girdiyle AYNI çıktı üretir', () => {
    const legs = [legResult(1000, 60)];
    const meta = baseMetadata({ legEndpoints: ['A', 'B'] });
    const a = buildTripPlanFromPreviewLegs(legs, meta);
    const b = buildTripPlanFromPreviewLegs(legs, meta);
    expect(a).toEqual(b);
  });
});

describe('F) metadata.id yok → validation error (UUID uydurma YOK)', () => {
  it('id boş string → THROW', () => {
    expect(() => buildTripPlanFromActiveRoute(activeRoute(), baseMetadata({ id: '' }))).toThrow();
  });
});

describe('G) currency boş → reddet', () => {
  it('currency boş → THROW', () => {
    expect(() => buildTripPlanFromActiveRoute(activeRoute(), baseMetadata({ currency: '' }))).toThrow();
  });
});

describe('H) negatif distanceM → reddet', () => {
  it('negatif distanceM → THROW', () => {
    expect(() => buildTripPlanFromActiveRoute(activeRoute({ distanceM: -100 }), baseMetadata())).toThrow();
  });
});

describe('I) negatif durationS → reddet', () => {
  it('negatif durationS → THROW', () => {
    expect(() => buildTripPlanFromActiveRoute(activeRoute({ durationS: -1 }), baseMetadata())).toThrow();
  });
});

describe('J) NaN/Infinity distance → reddet', () => {
  it('NaN distanceM → THROW', () => {
    expect(() => buildTripPlanFromActiveRoute(activeRoute({ distanceM: NaN }), baseMetadata())).toThrow();
  });
  it('Infinity distanceM → THROW', () => {
    expect(() => buildTripPlanFromActiveRoute(activeRoute({ distanceM: Infinity }), baseMetadata())).toThrow();
  });
});

describe('K) NaN/Infinity duration → reddet', () => {
  it('NaN durationS → THROW', () => {
    expect(() => buildTripPlanFromActiveRoute(activeRoute({ durationS: NaN }), baseMetadata())).toThrow();
  });
  it('Infinity durationS → THROW', () => {
    expect(() => buildTripPlanFromActiveRoute(activeRoute({ durationS: Infinity }), baseMetadata())).toThrow();
  });
});

describe('L) distanceM=0 geçerli', () => {
  it('distanceM=0 → legs[0].distanceKm=0, THROW YOK', () => {
    const plan = buildTripPlanFromActiveRoute(activeRoute({ distanceM: 0 }), baseMetadata());
    expect(plan.legs[0].distanceKm).toBe(0);
  });
});

describe('M) durationS=0 geçerli', () => {
  it('durationS=0 → legs[0].durationSeconds=0, THROW YOK', () => {
    const plan = buildTripPlanFromActiveRoute(activeRoute({ durationS: 0 }), baseMetadata());
    expect(plan.legs[0].durationSeconds).toBe(0);
  });
});

describe('N) boş preview leg listesi → THROW', () => {
  it('legs=[] → THROW ("henüz rota yok" adapter çağrılmamalı)', () => {
    expect(() => buildTripPlanFromPreviewLegs([], baseMetadata({ legEndpoints: ['A'] }))).toThrow();
  });
});

describe('O) origin/destination kaynağı — metadata; legEndpoints yok/uyuşmaz → throw', () => {
  it('ActiveRoute: leg.origin/destination = metadata.origin/destination (rota modelinde yok)', () => {
    const plan = buildTripPlanFromActiveRoute(activeRoute(), baseMetadata({ origin: 'X', destination: 'Y' }));
    expect(plan.legs[0].origin).toBe('X');
    expect(plan.legs[0].destination).toBe('Y');
    expect(plan.origin).toBe('X');
    expect(plan.destination).toBe('Y');
  });

  it('çoklu-leg: legEndpoints YOK → THROW', () => {
    expect(() => buildTripPlanFromPreviewLegs([legResult(1000, 60)], baseMetadata())).toThrow();
  });

  it('çoklu-leg: legEndpoints uzunluğu uyuşmaz (legs.length+1 değil) → THROW', () => {
    expect(() => buildTripPlanFromPreviewLegs(
      [legResult(1000, 60), legResult(2000, 120)],
      baseMetadata({ legEndpoints: ['A', 'B'] }), // 3 gerekirken 2
    )).toThrow();
  });
});

describe('P) travellers aktarılır', () => {
  it('metadata.travellers aynen TripPlan.travellers olur', () => {
    const travellers = { adults: 4, children: 1, infants: 1 };
    const plan = buildTripPlanFromActiveRoute(activeRoute(), baseMetadata({ travellers }));
    expect(plan.travellers).toEqual(travellers);
  });
});

describe('Q) vehicleProfile aktarılır', () => {
  it('metadata.vehicleProfile aynen TripPlan.vehicleProfile olur', () => {
    const vehicleProfile = { propulsion: 'electric' as const, consumptionKwh100Km: 18 };
    const plan = buildTripPlanFromActiveRoute(activeRoute(), baseMetadata({ vehicleProfile }));
    expect(plan.vehicleProfile).toEqual(vehicleProfile);
  });
});

describe('R) nights aktarılır', () => {
  it('metadata.nights aynen TripPlan.nights olur', () => {
    const plan = buildTripPlanFromActiveRoute(activeRoute(), baseMetadata({ nights: 7 }));
    expect(plan.nights).toBe(7);
  });

  it('nights=0 geçerli', () => {
    const plan = buildTripPlanFromActiveRoute(activeRoute(), baseMetadata({ nights: 0 }));
    expect(plan.nights).toBe(0);
  });

  it('negatif nights → THROW', () => {
    expect(() => buildTripPlanFromActiveRoute(activeRoute(), baseMetadata({ nights: -1 }))).toThrow();
  });
});

describe('S) input immutable', () => {
  it('ActiveRoute + metadata mutasyona uğratılmaz', () => {
    const route = activeRoute();
    const meta = baseMetadata();
    const routeSnapshot = JSON.parse(JSON.stringify(route));
    const metaSnapshot = JSON.parse(JSON.stringify(meta));
    buildTripPlanFromActiveRoute(route, meta);
    expect(route).toEqual(routeSnapshot);
    expect(meta).toEqual(metaSnapshot);
  });

  it('donmuş (Object.freeze) ActiveRoute + metadata ile de çalışır', () => {
    const route = Object.freeze(activeRoute());
    const meta = Object.freeze(baseMetadata());
    expect(() => buildTripPlanFromActiveRoute(route, meta)).not.toThrow();
  });

  it('preview legs dizisi mutasyona uğratılmaz', () => {
    const legs = [legResult(1000, 60), legResult(2000, 120)];
    const snapshot = JSON.parse(JSON.stringify(legs));
    buildTripPlanFromPreviewLegs(legs, baseMetadata({ legEndpoints: ['A', 'B', 'C'] }));
    expect(legs).toEqual(snapshot);
  });

  it('donmuş preview legs dizisiyle de çalışır', () => {
    const legs = Object.freeze([legResult(1000, 60)]) as readonly LegRouteResult[];
    expect(() => buildTripPlanFromPreviewLegs(legs, baseMetadata({ legEndpoints: ['A', 'B'] }))).not.toThrow();
  });
});

describe('T) deterministik çıktı — leg id üretimi', () => {
  it('leg.id = `${metadata.id}:leg:${index}` — rastgele/UUID YOK', () => {
    const plan = buildTripPlanFromActiveRoute(activeRoute(), baseMetadata({ id: 'trip-42' }));
    expect(plan.legs[0].id).toBe('trip-42:leg:0');
  });

  it('çoklu-leg id sırayla deterministik: trip:leg:0, trip:leg:1, trip:leg:2', () => {
    const legs = [legResult(1000, 60), legResult(2000, 120), legResult(3000, 180)];
    const plan = buildTripPlanFromPreviewLegs(legs, baseMetadata({ id: 'trip-x', legEndpoints: ['A', 'B', 'C', 'D'] }));
    expect(plan.legs.map(l => l.id)).toEqual(['trip-x:leg:0', 'trip-x:leg:1', 'trip-x:leg:2']);
  });
});

describe('U) ENTEGRASYON: gerçek rota → plan → pipeline (300 TRY)', () => {
  it('ActiveRoute distanceM=100000 → TripPlan → runTripCostPipeline → fuel=300 TRY (6L×50)', () => {
    const route = activeRoute({ distanceM: 100000, durationS: 3600 });
    const plan = buildTripPlanFromActiveRoute(route, baseMetadata());

    const input: TripCostInput = {
      plan,
      fuel: { enabled: true, consumptionL100Km: 6, pricePerLiter: 50 },
    };
    const report = runTripCostPipeline(input);

    // 100000m → 100km; 100km × 6L/100km = 6L; 6L × 50 TL/L = 300 TL.
    expect(report.knownTotal).toBe(300);
    expect(report.isComplete).toBe(true);
    expect(report.knownItems[0].category).toBe('fuel');
  });
});

describe('V) ActiveRoute model regresyonu', () => {
  it('ActiveRoute şekli (geometry/distanceM/durationS/etaEpochMs/meta?) DEĞİŞMEDİ — gerçek tipten türetilen literal kabul edilir', () => {
    const route: ActiveRoute = {
      geometry: [[34.6, 36.8], [28.9, 37.0]],
      distanceM: 5000,
      durationS: 300,
      etaEpochMs: 1_700_000_000_000,
      meta: { serverUsed: 'osrm' },
    };
    const plan = buildTripPlanFromActiveRoute(route, baseMetadata());
    expect(plan.legs[0].distanceKm).toBe(5);
  });
});
