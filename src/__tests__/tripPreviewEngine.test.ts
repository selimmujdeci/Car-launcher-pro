/**
 * tripPreviewEngine.test — MAVI4-TRIP-4 saf preview motoru.
 *
 * Kapsam: geçerli/geçersiz POI · aynı hedef · uzun sapma · preview ETA ·
 * addedDistance · addedTravelMinutes · immutable route · hata durumları · performans.
 * Rota UYGULANMAZ, store/nav/voice DOKUNULMAZ — router enjekte edilir (ağ yok).
 */
import { describe, it, expect, vi } from 'vitest';
import {
  computeTripPreview,
  type PreviewInput,
  type OriginalRoute,
  type LegRouter,
  type LegRouteResult,
} from '../platform/trip/tripPreviewEngine';

// Basit düz orijinal rota: origin(32.80,39.90) → dest(32.90,39.90) [lon,lat].
const ORIGINAL: OriginalRoute = {
  geometry:  [[32.80, 39.90], [32.85, 39.90], [32.90, 39.90]],
  distanceM: 8000,
  durationS: 600, // 10 dk
};

const BASE_ETA = 1_700_000_000_000; // sabit epoch ms

function makeInput(over: Partial<PreviewInput> = {}): PreviewInput {
  return {
    original:    ORIGINAL,
    origin:      { lat: 39.90, lng: 32.80 },
    destination: { lat: 39.90, lng: 32.90 },
    poi:         { lat: 39.95, lng: 32.85 },
    currentETA:  BASE_ETA,
    ...over,
  };
}

/** Sabit iki-bacak router: her bacak verilen distance/duration döner. */
function fixedRouter(leg1: LegRouteResult, leg2: LegRouteResult): LegRouter {
  let call = 0;
  return vi.fn(async () => (call++ === 0 ? leg1 : leg2));
}

const LEG = (distanceM: number, durationS: number, geo: [number, number][]): LegRouteResult => ({
  geometry: geo, distanceM, durationS,
});

describe('computeTripPreview — geçerli preview', () => {
  it('geçerli POI → isValid, birleşik rota, gerçek mesafe/süre', async () => {
    const router = fixedRouter(
      LEG(5000, 400, [[32.80, 39.90], [32.85, 39.95]]),
      LEG(5000, 400, [[32.85, 39.95], [32.90, 39.90]]),
    );
    const res = await computeTripPreview(makeInput(), router);
    expect(res.isValid).toBe(true);
    expect(res.errorCategory).toBe('NONE');
    expect(res.previewDistance).toBe(10000);
    expect(res.previewDuration).toBe(800);
    // Birleşim noktası (POI) tekrarı atıldı: 2 + (2−1) = 3 nokta.
    expect(res.previewRoute).toEqual([[32.80, 39.90], [32.85, 39.95], [32.90, 39.90]]);
  });

  it('addedDistance = preview − original', async () => {
    const router = fixedRouter(LEG(5000, 400, [[0, 0], [1, 1]]), LEG(5000, 400, [[1, 1], [2, 2]]));
    const res = await computeTripPreview(makeInput(), router);
    expect(res.addedDistance).toBe(10000 - 8000); // 2000 m
  });

  it('addedTravelMinutes = (previewDuration − originalDuration) / 60', async () => {
    const router = fixedRouter(LEG(5000, 450, [[0, 0], [1, 1]]), LEG(5000, 450, [[1, 1], [2, 2]]));
    const res = await computeTripPreview(makeInput(), router);
    // preview 900 s − original 600 s = 300 s = 5 dk.
    expect(res.addedTravelMinutes).toBeCloseTo(5, 6);
  });

  it('previewETA = currentETA + eklenen süre (ms)', async () => {
    const router = fixedRouter(LEG(5000, 450, [[0, 0], [1, 1]]), LEG(5000, 450, [[1, 1], [2, 2]]));
    const res = await computeTripPreview(makeInput(), router);
    expect(res.previewETA).toBe(BASE_ETA + 300 * 1000); // +5 dk
  });

  it('uzun sapma → geçerli ama büyük addedDistance/Minutes', async () => {
    const router = fixedRouter(
      LEG(60000, 3600, [[0, 0], [1, 1]]),
      LEG(60000, 3600, [[1, 1], [2, 2]]),
    );
    const res = await computeTripPreview(makeInput({ poi: { lat: 40.5, lng: 32.85 } }), router);
    expect(res.isValid).toBe(true);
    expect(res.addedDistance).toBe(120000 - 8000);
    expect(res.addedTravelMinutes).toBeCloseTo((7200 - 600) / 60, 6);
  });
});

describe('computeTripPreview — hata durumları', () => {
  it('geçersiz POI (NaN) → INVALID_POI, router çağrılmaz', async () => {
    const router = fixedRouter(LEG(1, 1, [[0, 0], [1, 1]]), LEG(1, 1, [[1, 1], [2, 2]]));
    const res = await computeTripPreview(makeInput({ poi: { lat: NaN, lng: 32.85 } }), router);
    expect(res.isValid).toBe(false);
    expect(res.errorCategory).toBe('INVALID_POI');
    expect(res.previewRoute).toBeNull();
    expect(router).not.toHaveBeenCalled();
  });

  it('POI hedefe eşit → SAME_AS_DESTINATION, router çağrılmaz', async () => {
    const router = fixedRouter(LEG(1, 1, [[0, 0], [1, 1]]), LEG(1, 1, [[1, 1], [2, 2]]));
    const res = await computeTripPreview(makeInput({ poi: { lat: 39.90, lng: 32.90 } }), router);
    expect(res.errorCategory).toBe('SAME_AS_DESTINATION');
    expect(res.isValid).toBe(false);
    expect(router).not.toHaveBeenCalled();
  });

  it('geçersiz orijinal rota → INVALID_INPUT', async () => {
    const router = fixedRouter(LEG(1, 1, [[0, 0], [1, 1]]), LEG(1, 1, [[1, 1], [2, 2]]));
    const bad = makeInput({ original: { geometry: [[0, 0]], distanceM: 1, durationS: 1 } });
    const res = await computeTripPreview(bad, router);
    expect(res.errorCategory).toBe('INVALID_INPUT');
    expect(router).not.toHaveBeenCalled();
  });

  it('geçersiz ETA → INVALID_INPUT', async () => {
    const router = fixedRouter(LEG(1, 1, [[0, 0], [1, 1]]), LEG(1, 1, [[1, 1], [2, 2]]));
    const res = await computeTripPreview(makeInput({ currentETA: NaN }), router);
    expect(res.errorCategory).toBe('INVALID_INPUT');
  });

  it('bir bacak rota getirilemezse → ROUTE_FAILED', async () => {
    const router: LegRouter = vi.fn(async (fromLat) => (fromLat === 39.90 ? LEG(5000, 400, [[0, 0], [1, 1]]) : null));
    // origin.lat=39.90 → leg1 ok; POI.lat=39.95 → leg2 null.
    const res = await computeTripPreview(makeInput(), router);
    expect(res.errorCategory).toBe('ROUTE_FAILED');
    expect(res.isValid).toBe(false);
    expect(res.previewRoute).toBeNull();
  });

  it('bacak <2 nokta → ROUTE_FAILED', async () => {
    const router = fixedRouter(LEG(5000, 400, [[0, 0]]), LEG(5000, 400, [[1, 1], [2, 2]]));
    const res = await computeTripPreview(makeInput(), router);
    expect(res.errorCategory).toBe('ROUTE_FAILED');
  });

  it('hata durumunda previewETA = currentETA (değişmez)', async () => {
    const router = fixedRouter(LEG(1, 1, [[0, 0], [1, 1]]), LEG(1, 1, [[1, 1], [2, 2]]));
    const res = await computeTripPreview(makeInput({ poi: { lat: NaN, lng: 0 } }), router);
    expect(res.previewETA).toBe(BASE_ETA);
  });
});

describe('computeTripPreview — immutable garantisi', () => {
  it('orijinal rota (geometry/distance/duration) mutasyona uğramaz', async () => {
    const original: OriginalRoute = {
      geometry:  [[32.80, 39.90], [32.85, 39.90], [32.90, 39.90]],
      distanceM: 8000,
      durationS: 600,
    };
    const snapshot = JSON.parse(JSON.stringify(original));
    const router = fixedRouter(LEG(5000, 400, [[32.80, 39.90], [32.85, 39.95]]), LEG(5000, 400, [[32.85, 39.95], [32.90, 39.90]]));
    const res = await computeTripPreview(makeInput({ original }), router);
    expect(original).toEqual(snapshot);
    // previewRoute yeni bir dizidir — orijinal geometri referansı değil.
    expect(res.previewRoute).not.toBe(original.geometry);
  });

  it('input objesi mutasyona uğramaz', async () => {
    const input = makeInput();
    const snapshot = JSON.parse(JSON.stringify(input));
    const router = fixedRouter(LEG(5000, 400, [[0, 0], [1, 1]]), LEG(5000, 400, [[1, 1], [2, 2]]));
    await computeTripPreview(input, router);
    expect(input).toEqual(snapshot);
  });
});

describe('computeTripPreview — performans', () => {
  it('büyük geometri (2×2000 nokta) < 50 ms', async () => {
    const big = (n: number): [number, number][] => {
      const g: [number, number][] = [];
      for (let i = 0; i < n; i++) g.push([32.80 + i * 0.0001, 39.90]);
      return g;
    };
    const router = fixedRouter(LEG(5000, 400, big(2000)), LEG(5000, 400, big(2000)));
    const t0 = performance.now();
    const res = await computeTripPreview(makeInput(), router);
    const dt = performance.now() - t0;
    expect(res.isValid).toBe(true);
    expect(res.previewRoute!.length).toBe(2000 + 1999);
    expect(dt).toBeLessThan(50);
  });
});
