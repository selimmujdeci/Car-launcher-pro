/**
 * SAHA 2026-09-25 — "rotadan çıktık, yeni rota çizmedi, rotasız gitti, sonra
 * alakasız bir rota çizdi".
 *
 * Kök neden (iki parça):
 *  1. `fetchRoute('REROUTE')` store'u istek başında SIFIRLIYORDU → sağlayıcı
 *     zinciri sürerken adım listesi boş, ilerleme/sapma değerlendirmesi duruyor,
 *     ekran "kuş uçuşu · varış hesaplanamıyor · rota doğrulanmadı" diyordu.
 *  2. Sapma makinesi `REROUTING`e kilitleniyor, YALNIZ commit ile çıkıyordu;
 *     istek bitip rota uygulanmazsa bir daha hiç reroute gitmiyordu.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../platform/offlineRoutingService', () => ({
  tryLocalDaemon: vi.fn(() => Promise.resolve(null)),
  computeOfflineRoute: vi.fn(() => Promise.resolve(null)),
  straightLineRoute: vi.fn((fromLat: number, fromLon: number, toLat: number, toLon: number) => ({
    geometry: [[fromLon, fromLat], [toLon, toLat]] as [number, number][],
    distanceM: 1000, durationS: 60, steps: [], source: 'straight-line',
  })),
}));
vi.mock('../platform/bridge', () => ({ isNative: false }));
vi.mock('../platform/ttsService', () => ({ speakNavigation: vi.fn() }));
vi.mock('../platform/vehicleDataLayer/UnifiedVehicleStore', () => ({
  useUnifiedVehicleStore: {
    getState: () => ({
      speed: 10,
      location: { latitude: 36.80, longitude: 34.61, accuracy: 5, timestamp: Date.now() },
    }),
  },
}));

import {
  fetchRoute, updateRouteProgress, setRerouteContext, clearRerouteContext, clearRoute,
  getRouteState, getNavigationCoreSnapshot,
} from '../platform/routingService';

const route = (coords: [number, number][]) => ({
  code: 'Ok',
  routes: [{
    distance: 3500, duration: 300,
    geometry: { coordinates: coords },
    legs: [{ steps: [
      { distance: 1800, duration: 150, name: 'Test Cd', maneuver: { type: 'depart', modifier: 'straight' }, geometry: { coordinates: [coords[0]] } },
      { distance: 1700, duration: 150, name: 'Hedef Sk', maneuver: { type: 'turn', modifier: 'right' }, geometry: { coordinates: [coords[2]] } },
      { distance: 0, duration: 0, name: '', maneuver: { type: 'arrive', modifier: 'straight' }, geometry: { coordinates: [coords[coords.length - 1]] } },
    ] }],
  }],
});
const MAIN = route([[34.60, 36.80], [34.61, 36.80], [34.62, 36.80], [34.63, 36.80], [34.64, 36.80]]);
const OFF_LAT = 36.805;
const OFF_LON = 34.61;
const ok = (body: unknown) => ({ ok: true, json: () => Promise.resolve(body) } as unknown as Response);

describe('yavaş yeniden rota', () => {
  let nowMs = 0;
  let perfSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.stubGlobal('fetch', vi.fn());
    Object.defineProperty(navigator, 'onLine', { value: true, writable: true, configurable: true });
    nowMs = 0;
    perfSpy = vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
    vi.mocked(fetch).mockResolvedValue(ok(MAIN));
    await fetchRoute(36.80, 34.60, 36.80, 34.64);
    setRerouteContext(36.80, 34.64);
    nowMs = 20_000;
    vi.mocked(fetch).mockClear();
  });

  afterEach(() => {
    clearRerouteContext();
    clearRoute();
    perfSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  /** Rotadan çıkıp reroute tetiklenene kadar sapma fix'leri besler. */
  const driveOff = () => {
    for (let i = 0; i < 6 && vi.mocked(fetch).mock.calls.length === 0; i++) {
      nowMs += 1_000;
      updateRouteProgress(OFF_LAT, OFF_LON);
    }
  };

  it('🔒 istek sürerken mevcut rota KORUNUR (ekran/ilerleme boşalmaz)', async () => {
    vi.mocked(fetch).mockImplementation(() => new Promise<Response>(() => { /* hiç dönmez */ }));
    driveOff();
    expect(vi.mocked(fetch)).toHaveBeenCalled();
    const s = getRouteState();
    expect(s.loading).toBe(true);
    expect(s.steps.length).toBe(3);
    expect(s.geometry?.length).toBe(5);
    expect(getNavigationCoreSnapshot().offRoute.state).toBe('REROUTING');
  });

  it('🔒 yeni rota gelince eski rotanın alanları taşınmaz', async () => {
    let resolveReroute: (r: Response) => void = () => {};
    vi.mocked(fetch).mockImplementation(() => new Promise<Response>((r) => { resolveReroute = r; }));
    driveOff();
    resolveReroute(ok(route([[34.61, 36.805], [34.62, 36.805], [34.63, 36.805], [34.635, 36.80], [34.64, 36.80]])));
    await vi.waitFor(() => expect(getRouteState().loading).toBe(false));
    const s = getRouteState();
    expect(s.geometry?.[0]).toEqual([34.61, 36.805]);
    expect(s.alternatives).toEqual([]);
    expect(s.pendingManeuver).toBeNull();
    expect(getNavigationCoreSnapshot().offRoute.state).toBe('ON_ROUTE');
  });

  it('🔒 istek bitti ama rota uygulanmadıysa REROUTING kilidi açılır, yeni istek gider', async () => {
    const resolvers: Array<(r: Response) => void> = [];
    vi.mocked(fetch).mockImplementation(() => new Promise<Response>((r) => { resolvers.push(r); }));
    driveOff();
    const firstCalls = vi.mocked(fetch).mock.calls.length;
    const rerouteResolve = resolvers[0];
    // Uçuştaki isteği başka bir istek geçersiz kılar (ör. "daha hızlı rota" denetimi),
    // sonra eski döner → bayat, uygulanmaz; yeni istek de askıda kalır.
    const manual = fetchRoute(36.805, 34.61, 36.80, 34.64, 'REROUTE');
    rerouteResolve(ok(MAIN));
    await Promise.resolve(); await Promise.resolve();
    // Makine REROUTING'de ama uçuşta sapma kaynaklı istek yok → kilit açılmalı.
    await vi.waitFor(() => expect(getNavigationCoreSnapshot().fetchInFlight).toBe(false));
    vi.mocked(fetch).mockClear();
    vi.mocked(fetch).mockImplementation(() => new Promise<Response>(() => {}));
    nowMs += 10_000;                      // throttle penceresi geçti
    driveOff();
    expect(firstCalls).toBeGreaterThan(0);
    expect(vi.mocked(fetch)).toHaveBeenCalled();
    void manual;
  });
});
