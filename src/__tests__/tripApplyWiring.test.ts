/**
 * tripApplyWiring.test — MAVI4-TRIP-5B · TRIP preview+apply production wiring.
 *
 * Kapsam: LegRouter adapter yan etkisizliği · RouteStoreAdapter round-trip &
 * cumulativeDistances · navSafety fail-closed & veto · composition apply/resume/rollback ·
 * stale/onay/voice/provider-hata reddi. Gerçek ağ çağrısı YOK (fetchRouteLeg offline'a düşer
 * / LegRouter enjekte edilir); gerçek RoutingService store'u + gerçek useCognitiveStore kullanılır.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  clearRoute,
  getRouteState,
  writeActiveRoute,
  fetchRouteLeg,
  registerNavigationStyleCallback,
  type RouteStep,
} from '../platform/routingService';
import { useCognitiveStore } from '../store/useCognitiveStore';
import { createLegRouterAdapter } from '../platform/trip/wiring/legRouterAdapter';
import { createRouteStoreAdapter } from '../platform/trip/wiring/routeStoreAdapter';
import { createNavSafetyAdapter } from '../platform/trip/wiring/navSafetyAdapter';
import {
  createTripApplyComposition,
  createTripApplyRuntime,
} from '../platform/trip/wiring/tripApplyComposition';
import type { TripPreview } from '../platform/trip/tripPreviewEngine';
import type { LegRouter } from '../platform/trip/tripPreviewEngine';

/* ── Fixtures ─────────────────────────────────────────────────────────────── */

const STEP = (lon: number, lat: number, instr: string): RouteStep => ({
  instruction: instr, streetName: '', distance: 100, duration: 20,
  maneuverType: 'turn', maneuverModifier: 'left', coordinate: [lon, lat],
});

const ORIGINAL_GEOM: [number, number][] = [[32.80, 39.90], [32.85, 39.90], [32.90, 39.90]];
const ORIGINAL_STEPS: RouteStep[] = [STEP(32.80, 39.90, 'Yola çıkın'), STEP(32.90, 39.90, 'Hedef')];

/** Orijinal rotayı gerçek store'a yaz (seed). */
function seedOriginalRoute(): void {
  writeActiveRoute({
    geometry: ORIGINAL_GEOM.map(p => [p[0], p[1]] as [number, number]),
    distanceM: 8000,
    durationS: 600,
    steps: ORIGINAL_STEPS,
    serverUsed: 'osrm',
    hasToll: false,
  });
}

const VALID_PREVIEW = (): TripPreview => ({
  previewRoute:       [[32.80, 39.90], [32.85, 39.95], [32.90, 39.90]],
  previewDistance:    10000,
  previewDuration:    900,
  addedDistance:      2000,
  addedTravelMinutes: 5,
  previewETA:         1_700_000_300_000,
  selectedPoi:        { lat: 39.95, lng: 32.85 },
  isValid:            true,
  errorCategory:      'NONE',
});

/** Sabit iki-bacak router (ağ yok). */
function fixedLegRouter(): LegRouter {
  let call = 0;
  return vi.fn(async () => {
    const g: [number, number][] = call++ === 0
      ? [[32.80, 39.90], [32.85, 39.95]]
      : [[32.85, 39.95], [32.90, 39.90]];
    return { geometry: g, distanceM: 5000, durationS: 450 };
  });
}

beforeEach(() => {
  clearRoute();
  useCognitiveStore.setState({ currentMode: 'IMMERSIVE', isSuppressed: false, lastUpdateTs: 0 });
  // Gerçek ağ ÇAĞRISI YOK: fetch reddedici — fetchRouteLeg offline katmana düşer (jsdom'da
  // worker yok → null). Böylece routing sunucusuna gerçek istek gitmez.
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('no-network-in-test'))));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/* ── HEDEF 1 — LegRouter adapter yan etkisizliği ──────────────────────────── */

describe('LegRouter adapter — yan etkisizlik', () => {
  it('(1) adapter çağrısı store\'u değiştirmez (provider yok → null)', async () => {
    const adapter = createLegRouterAdapter();
    const before = getRouteState().geometry;
    // navigator.onLine test ortamında undefined (falsy) → online katman atlanır,
    // offline worker jsdom\'da yok → fetchRouteLeg null döner. Store'a dokunulmaz.
    const leg = await adapter(39.90, 32.80, 39.91, 32.86);
    expect(leg).toBeNull();
    expect(getRouteState().geometry).toBe(before); // referans dahi değişmedi
  });

  it('(2) adapter speech/navigation-style callback tetiklemez', async () => {
    const navStyleSpy = vi.fn();
    const unsub = registerNavigationStyleCallback(navStyleSpy);
    const adapter = createLegRouterAdapter();
    await adapter(39.90, 32.80, 39.91, 32.86);
    expect(navStyleSpy).not.toHaveBeenCalled();
    unsub();
  });

  it('(13b) fetchRouteLeg fail-soft null, store shape sabit kalır', async () => {
    const snap = getRouteState();
    const leg = await fetchRouteLeg(39.90, 32.80, 39.91, 32.86);
    expect(leg).toBeNull();
    expect(getRouteState().geometry).toBe(snap.geometry);
    expect(getRouteState().totalDistanceMeters).toBe(snap.totalDistanceMeters);
  });

  it('geçersiz koordinat → null (ağa çıkmadan)', async () => {
    expect(await fetchRouteLeg(NaN, 32.80, 39.91, 32.86)).toBeNull();
    expect(await fetchRouteLeg(39.90, 200, 39.91, 32.86)).toBeNull();
  });
});

/* ── HEDEF 2 — RouteStoreAdapter ──────────────────────────────────────────── */

describe('RouteStoreAdapter — shape & round-trip', () => {
  it('(3) setActiveRoute doğru route shape yazar', () => {
    const store = createRouteStoreAdapter();
    store.setActiveRoute({
      geometry: [[32.80, 39.90], [32.90, 39.90]],
      distanceM: 5000, durationS: 300, etaEpochMs: 0,
      meta: { steps: ORIGINAL_STEPS, serverUsed: 'osrm', hasToll: true },
    });
    const s = getRouteState();
    expect(s.geometry).toEqual([[32.80, 39.90], [32.90, 39.90]]);
    expect(s.totalDistanceMeters).toBe(5000);
    expect(s.totalDurationSeconds).toBe(300);
    expect(s.steps).toBe(ORIGINAL_STEPS);
    expect(s.hasToll).toBe(true);
    expect(s.serverUsed).toBe('osrm');
    expect(s.currentStepIndex).toBe(0);
    expect(s.alternatives).toEqual([]); // apply sonrası alternatif temizlendi
  });

  it('(4) cumulativeDistances doğru yeniden üretilir (suffix-sum, son=0)', () => {
    const store = createRouteStoreAdapter();
    store.setActiveRoute({
      geometry: ORIGINAL_GEOM.map(p => [p[0], p[1]] as [number, number]),
      distanceM: 8000, durationS: 600, etaEpochMs: 0,
    });
    const cum = getRouteState().cumulativeDistances!;
    expect(cum).not.toBeNull();
    expect(cum.length).toBe(3);
    expect(cum[2]).toBe(0);                 // son nokta → 0 kalan
    expect(cum[0]).toBeGreaterThan(cum[1]); // monotonik azalan
    expect(cum[1]).toBeGreaterThan(0);
  });

  it('adım yoksa hedef sentinel adımı enjekte edilir', () => {
    const store = createRouteStoreAdapter();
    store.setActiveRoute({
      geometry: [[32.80, 39.90], [32.90, 39.90]],
      distanceM: 5000, durationS: 300, etaEpochMs: 0,
    });
    const s = getRouteState();
    expect(s.steps.length).toBe(1);
    expect(s.steps[0].coordinate).toEqual([32.90, 39.90]);
  });

  it('getActiveRoute geometriyi KOPYA döner (canlı store dizisi değil)', () => {
    seedOriginalRoute();
    const store = createRouteStoreAdapter();
    const a = store.getActiveRoute()!;
    expect(a.geometry).toEqual(getRouteState().geometry);
    expect(a.geometry).not.toBe(getRouteState().geometry);
  });

  it('boş store → getActiveRoute null', () => {
    const store = createRouteStoreAdapter();
    expect(store.getActiveRoute()).toBeNull();
  });
});

/* ── HEDEF 3 — Nav safety adapter ─────────────────────────────────────────── */

describe('navSafetyAdapter — fail-closed & cognitive veto', () => {
  it('IMMERSIVE/AWARE/FOCUSED → izinli', () => {
    const gate = createNavSafetyAdapter();
    for (const m of ['IMMERSIVE', 'AWARE', 'FOCUSED'] as const) {
      useCognitiveStore.setState({ currentMode: m });
      expect(gate().allowed).toBe(true);
    }
  });

  it('PROTECTION/CRITICAL/LIMP_HOME → reddet', () => {
    const gate = createNavSafetyAdapter();
    for (const m of ['PROTECTION', 'CRITICAL', 'LIMP_HOME'] as const) {
      useCognitiveStore.setState({ currentMode: m });
      const d = gate();
      expect(d.allowed).toBe(false);
      expect(d.reason).toBe(`cognitive_${m.toLowerCase()}`);
    }
  });

  it('(9) güvenlik durumu okunamazsa fail-closed', () => {
    const throwing = createNavSafetyAdapter({ readMode: () => { throw new Error('unreadable'); } });
    const d = throwing();
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('safety_state_unreadable');
  });

  it('mod bilinmiyorsa fail-closed', () => {
    const unknown = createNavSafetyAdapter({ readMode: () => 'BOGUS' as never });
    expect(unknown().allowed).toBe(false);
    expect(unknown().reason).toBe('safety_state_unknown');
  });
});

/* ── HEDEF 4 — Composition apply / resume / rollback ──────────────────────── */

describe('Composition — apply/resume/rollback (gerçek store + cognitive)', () => {
  function runtime() {
    // Gerçek adapter'lar + gerçek store/cognitive; provider testte kullanılmaz.
    return createTripApplyRuntime();
  }

  it('(5) apply sonrası aktif rota preview olur', () => {
    seedOriginalRoute();
    const comp = runtime();
    const b = comp.applyEngine.beginPreview(VALID_PREVIEW());
    expect(b.code).toBe('PREVIEW_READY');
    const res = comp.applyEngine.applyPreview(b.previewId!, { confirmed: true, source: 'user' });
    expect(res.code).toBe('APPLIED');
    expect(getRouteState().totalDistanceMeters).toBe(10000);
    expect(getRouteState().totalDurationSeconds).toBe(900);
    expect(getRouteState().geometry).toEqual(VALID_PREVIEW().previewRoute);
  });

  it('(6) resume sonrası orijinal rota birebir döner', () => {
    seedOriginalRoute();
    const comp = runtime();
    const b = comp.applyEngine.beginPreview(VALID_PREVIEW());
    comp.applyEngine.applyPreview(b.previewId!, { confirmed: true, source: 'user' });
    const res = comp.applyEngine.resumeOriginal();
    expect(res.code).toBe('RESUMED');
    const s = getRouteState();
    expect(s.geometry).toEqual(ORIGINAL_GEOM);
    expect(s.totalDistanceMeters).toBe(8000);
    expect(s.totalDurationSeconds).toBe(600);
    expect(s.steps).toEqual(ORIGINAL_STEPS);
    expect(s.serverUsed).toBe('osrm');
  });

  it('(7) rollback sonrası orijinal rota birebir döner', () => {
    seedOriginalRoute();
    const comp = runtime();
    const b = comp.applyEngine.beginPreview(VALID_PREVIEW());
    comp.applyEngine.applyPreview(b.previewId!, { confirmed: true, source: 'user' });
    expect(getRouteState().totalDistanceMeters).toBe(10000); // uygulandı
    const res = comp.applyEngine.rollback();
    expect(res.code).toBe('ROLLED_BACK');
    const s = getRouteState();
    expect(s.geometry).toEqual(ORIGINAL_GEOM);
    expect(s.totalDistanceMeters).toBe(8000);
    expect(s.steps).toEqual(ORIGINAL_STEPS);
  });

  it('(8) aktif rota dışarıdan değişirse stale preview reddedilir', () => {
    seedOriginalRoute();
    const comp = runtime();
    const b = comp.applyEngine.beginPreview(VALID_PREVIEW());
    // Dışarıdan reroute — aktif rota imzası değişti.
    writeActiveRoute({ geometry: [[10, 10], [11, 11]], distanceM: 123, durationS: 45 });
    const res = comp.applyEngine.applyPreview(b.previewId!, { confirmed: true, source: 'user' });
    expect(res.code).toBe('EXPIRED');
    expect(res.reason).toBe('active_route_changed');
  });

  it('(10) sürüş güvenliği veto ederse (CRITICAL) store yazılmaz', () => {
    seedOriginalRoute();
    const comp = runtime();
    const b = comp.applyEngine.beginPreview(VALID_PREVIEW());
    useCognitiveStore.setState({ currentMode: 'CRITICAL' }); // veto
    const res = comp.applyEngine.applyPreview(b.previewId!, { confirmed: true, source: 'user' });
    expect(res.code).toBe('SAFETY_BLOCKED');
    expect(getRouteState().totalDistanceMeters).toBe(8000); // değişmedi
  });

  it('(11) explicit confirmation yoksa store yazılmaz', () => {
    seedOriginalRoute();
    const comp = runtime();
    const b = comp.applyEngine.beginPreview(VALID_PREVIEW());
    const res = comp.applyEngine.applyPreview(b.previewId!, { confirmed: false, source: 'user' });
    expect(res.code).toBe('NOT_CONFIRMED');
    expect(getRouteState().totalDistanceMeters).toBe(8000);
  });

  it('(12) voice kaynağı tek başına ise store yazılmaz', () => {
    seedOriginalRoute();
    const comp = runtime();
    const b = comp.applyEngine.beginPreview(VALID_PREVIEW());
    const res = comp.applyEngine.applyPreview(b.previewId!, { confirmed: true, source: 'voice' });
    expect(res.code).toBe('VOICE_NOT_ALLOWED');
    expect(getRouteState().totalDistanceMeters).toBe(8000);
  });
});

/* ── HEDEF 4 — Saf composition (DI fake) + provider hatası ────────────────── */

describe('Saf composition — computePreview & provider hatası', () => {
  it('computePreview enjekte LegRouter ile preview hesaplar, store\'a dokunmaz', async () => {
    seedOriginalRoute();
    const before = getRouteState().geometry;
    const comp = createTripApplyComposition({
      legRouter: fixedLegRouter(),
      store: createRouteStoreAdapter(),
      safetyCheck: createNavSafetyAdapter(),
    });
    const preview = await comp.computePreview({
      original: { geometry: ORIGINAL_GEOM, distanceM: 8000, durationS: 600 },
      origin: { lat: 39.90, lng: 32.80 },
      destination: { lat: 39.90, lng: 32.90 },
      poi: { lat: 39.95, lng: 32.85 },
      currentETA: 1_700_000_000_000,
    });
    expect(preview.isValid).toBe(true);
    expect(preview.previewDistance).toBe(10000);
    expect(getRouteState().geometry).toBe(before); // store dokunulmadı
  });

  it('(13) routing provider hatasında (LegRouter null) preview ROUTE_FAILED, store değişmez', async () => {
    seedOriginalRoute();
    const before = getRouteState().totalDistanceMeters;
    const failRouter: LegRouter = vi.fn(async () => null); // sağlayıcı düştü
    const comp = createTripApplyComposition({
      legRouter: failRouter,
      store: createRouteStoreAdapter(),
      safetyCheck: createNavSafetyAdapter(),
    });
    const preview = await comp.computePreview({
      original: { geometry: ORIGINAL_GEOM, distanceM: 8000, durationS: 600 },
      origin: { lat: 39.90, lng: 32.80 },
      destination: { lat: 39.90, lng: 32.90 },
      poi: { lat: 39.95, lng: 32.85 },
      currentETA: 1_700_000_000_000,
    });
    expect(preview.isValid).toBe(false);
    expect(preview.errorCategory).toBe('ROUTE_FAILED');
    // Geçersiz preview apply'a girse bile store yazılmaz.
    const b = comp.applyEngine.beginPreview(preview);
    expect(b.code).toBe('INVALID_PREVIEW');
    expect(getRouteState().totalDistanceMeters).toBe(before);
  });

  it('safetyCheck verilmezse fail-closed (apply reddedilir)', () => {
    seedOriginalRoute();
    const comp = createTripApplyComposition({
      legRouter: fixedLegRouter(),
      store: createRouteStoreAdapter(),
      // safetyCheck YOK → fail-closed reddedici
    });
    const b = comp.applyEngine.beginPreview(VALID_PREVIEW());
    const res = comp.applyEngine.applyPreview(b.previewId!, { confirmed: true, source: 'user' });
    expect(res.code).toBe('SAFETY_BLOCKED');
    expect(getRouteState().totalDistanceMeters).toBe(8000);
  });
});
