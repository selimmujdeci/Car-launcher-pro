/**
 * navDeadReckoningSpeed.test — tünelde (GPS yok) ölü hesaplama hızı ve birikimi.
 *
 * Kusur (navigasyon analizi 2026-09-24):
 *   1. OBD'nin GERÇEK 0 km/s değeri "hız yok" sayılıp son GPS hızına (ör. 90)
 *      düşülüyordu → trafikte duran araç tünelde ilerliyormuş gibi gösteriliyordu.
 *   2. İlerleme "şu anki hız × fix'ten beri geçen TÜM süre" idi → yavaş gidip
 *      hızlanınca geçmiş süre de yeni hızla çarpılıp işaret sıçrıyordu.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const M = vi.hoisted(() => ({ calls: [] as Array<{ lat: number; lng: number; opts?: unknown }> }));

vi.mock('../platform/navigationService', async (orig) => ({
  ...(await orig<typeof import('../platform/navigationService')>()),
  getNavigationState: () => ({ status: 'ACTIVE', destination: { latitude: 37, longitude: 35 } }),
  updateNavigationProgress: (lat: number, lng: number, _h: number, _g: unknown, opts?: unknown) => {
    M.calls.push({ lat, lng, opts });
  },
  getNavSessionId: () => 1,
  getRouteProgressPoint: () => null,   // çapa yok → yön projeksiyonu (heading fallback)
}));
vi.mock('../platform/routingService', async (orig) => ({
  ...(await orig<typeof import('../platform/routingService')>()),
  getRouteState: () => ({ geometry: null, steps: [], currentStepIndex: 0 }),
  updateRouteProgress: () => {},
}));

import {
  _resetNavigationSessionRuntimeForTest, _setLastFixForTest, _drTickForTest,
  getNavigationSessionRuntimeSnapshot,
} from '../platform/navigation/navigationSessionRuntime';
import { useUnifiedVehicleStore } from '../platform/vehicleDataLayer/UnifiedVehicleStore';

let now = 0;
const tickAt = (ms: number) => { now = ms; _drTickForTest(); };
/** Kuzeye (heading 0) kat edilen metre. */
const northM = (lat: number) => (lat - 36.8) * 111_320;

beforeEach(() => {
  M.calls.length = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  _resetNavigationSessionRuntimeForTest();
  _setLastFixForTest({ lat: 36.8, lng: 34.6, heading: 0, ts: 0, speedMs: 25 }); // son GPS: 90 km/s
});
afterEach(() => { vi.restoreAllMocks(); useUnifiedVehicleStore.setState({ speed: null }); });

describe('DR hızı', () => {
  it('🔒 araç hızı 0 (OBD) → son GPS hızıyla İLERLETİLMEZ', () => {
    useUnifiedVehicleStore.setState({ speed: 0 });
    tickAt(6_000);
    tickAt(20_000);
    expect(M.calls).toHaveLength(0);
    expect(getNavigationSessionRuntimeSnapshot().drDistanceMeters).toBe(0);
  });

  it('araç hızı bilinmiyorsa (null) son GPS hızına düşülür', () => {
    useUnifiedVehicleStore.setState({ speed: null });
    tickAt(6_000);
    expect(M.calls).toHaveLength(1);
    expect(northM(M.calls[0]!.lat)).toBeCloseTo(150, 0); // 25 m/s × 6 s
  });
});

describe('DR birikimi', () => {
  it('🔒 durulan süre sonradan yeni hızla ÇARPILMAZ', () => {
    useUnifiedVehicleStore.setState({ speed: 36 });   // 10 m/s
    tickAt(6_000);                                      // 60 m
    useUnifiedVehicleStore.setState({ speed: 0 });
    tickAt(30_000);                                     // 24 sn durdu → +0
    useUnifiedVehicleStore.setState({ speed: 36 });
    tickAt(31_000);                                     // +10 m
    const last = M.calls[M.calls.length - 1]!;
    expect(northM(last.lat)).toBeCloseTo(70, 0);        // eskiden 10 m/s × 31 s = 310 m
    expect(getNavigationSessionRuntimeSnapshot().drDistanceMeters).toBe(70);
  });

  it('🔒 DR konumu ilerlemeye TAHMİN olarak verilir (varış ilan edemez)', () => {
    useUnifiedVehicleStore.setState({ speed: 36 });
    tickAt(6_000);
    expect(M.calls[0]!.opts).toEqual({ positionEstimated: true });
  });
});
