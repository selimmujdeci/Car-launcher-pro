/**
 * routeLineAfterArrival.test — varıştan sonra rota çizgisi haritada KALMAZ.
 *
 * Smoke 2026-09-24 (telefon, sahte sürüş): ARRIVED → 5 sn → IDLE sonrasında
 * `selected-route-source` 149 noktalık tam rotayla görünür kaldı (depo boştu).
 * IDLE commit'inde `FullMapView` haritayı/depoyu temizliyor, AYNI commit'te
 * çizim efekti render anındaki eski `route.geometry` ile yeniden çiziyordu.
 * ARRIVED anında da kırpılmış rota baştan çiziliyordu.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const M = vi.hoisted(() => ({ draws: 0 }));

vi.mock('../platform/bridge', () => ({ isNative: false }));
vi.mock('../platform/mapService', () => ({
  setRouteGeometry: () => { M.draws++; },
  setTurnFocus: () => {},
  clearTurnFocus: () => {},
}));
vi.mock('../platform/map/MapLayerManager', () => ({
  applyRouteEmphasis: () => {},
  invalidateRouteEmphasis: () => {},
  routeConfidenceFrom: () => 'CONFIRMED',
}));

import { useRouteDrawingLifecycle } from '../components/map/hooks/useRouteDrawingLifecycle';

const G: [number, number][] = [[29.0, 41.0], [29.0, 41.01]];
const NONE: never[] = [];
const map = { isStyleLoaded: () => true, getLayer: () => ({}) };
const refs = {
  mapRef: { current: map as never },
  mountedRef: { current: true },
  styleChangingRef: { current: false },
  lastAppliedRef: { current: null as { hash: string; styleKey: number; navStatus: string } | null },
  routeGeometryRef: { current: null as [number, number][] | null },
  routeAltRef: { current: [] as [number, number][][] },
  routeAltIdxRef: { current: [] as number[] },
  routeAltDursRef: { current: [] as number[] },
  routeMainDurRef: { current: 0 },
  routeStepsRef: { current: [] as never[] },
  prevStepIndexRef: { current: 0 },
};

function Probe({ navStatus, isNavigating, geometry }: {
  navStatus: string; isNavigating: boolean; geometry: [number, number][] | null;
}) {
  useRouteDrawingLifecycle({
    ...refs,
    route: {
      geometry, alternatives: NONE, altRealIndices: NONE, altDurations: NONE,
      totalDurationSeconds: 60, steps: NONE, currentStepIndex: 0, distanceToNextTurnMeters: 0,
      serverUsed: 'tomtom:routing', validationVerdict: 'VALID',
    },
    mapStatus: 'READY', styleKey: 1, navStatus, isNavigating, isPreview: false,
    setRouteReady: () => {}, setRouteStartFlash: () => {}, pushDebug: () => {},
  });
  return null;
}

let root: Root;
const show = (navStatus: string, isNavigating: boolean, geometry: [number, number][] | null) =>
  act(() => root.render(<Probe navStatus={navStatus} isNavigating={isNavigating} geometry={geometry} />));

beforeEach(() => {
  M.draws = 0;
  refs.lastAppliedRef.current = null;
  refs.routeGeometryRef.current = null;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  root = createRoot(document.createElement('div'));
});
afterEach(() => {
  act(() => root.unmount());
  delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
});

describe('varıştan sonra rota çizgisi', () => {
  it('🔒 ARRIVED kırpılmış rotayı baştan ÇİZMEZ; IDLE temizliğinden sonra yeniden ÇİZİLMEZ', () => {
    show('ACTIVE', true, G);
    expect(M.draws).toBe(1);
    show('ARRIVED', true, G);
    expect(M.draws).toBe(1);
    // FullMapView'ın IDLE temizliği (lastAppliedRef/routeGeometryRef sıfırlanır) —
    // aynı render'da depo henüz boşalmamıştır: `geometry` hâlâ eski rota.
    refs.lastAppliedRef.current = null;
    refs.routeGeometryRef.current = null;
    show('IDLE', false, G);
    expect(M.draws).toBe(1);
    expect(refs.routeGeometryRef.current).toBeNull();
    show('IDLE', false, null);
    expect(M.draws).toBe(1);
  });

  it('PREVIEW → ACTIVE geçişi rotayı yine yeniden çizer (mevcut davranış)', () => {
    show('PREVIEW', true, G);
    show('ACTIVE', true, G);
    expect(M.draws).toBe(2);
  });
});
