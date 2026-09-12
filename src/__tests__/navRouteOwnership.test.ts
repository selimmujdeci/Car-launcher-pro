/**
 * navRouteOwnership.test.ts — KİLİT: rota isteğinin sahibi GÖRÜNÜM DEĞİLDİR.
 *
 * SAHA ÖLÇÜMÜ 2026-08-04 (cihaz `4L45OFZDX84X55GE`, Ankara-Tarsus Otoyolu,
 * ~90 km/h, CDP ile canlı `__CAROS_NAV_FIELD__` örneklemesi):
 *
 *   Uygulama yeniden başladıktan sonra ekran "ACTIVE · 207 km · 2 sa 33 dk ·
 *   Hedefe doğru ilerleyin" gösterdi — ama ROTA HİÇ YOKTU. 40 ardışık örneğin
 *   TAMAMINDA: `geometryPts=0`, `steps=1` (sentinel), `totalM=0`,
 *   `serverUsed=null`, `match=UNKNOWN(NO_GEOMETRY)`, `routeRequest.committed=0`.
 *   Gösterilen mesafe rota değil KUŞ UÇUŞU idi; tam ekran açılıp rota gelince
 *   199,8 km → 220,1 km oldu (20 km fark, aynı ekranda iki çelişkili sayı).
 *
 * KÖK: ürün kodunda `fetchRoute(...)` YALNIZ `FullMapView.tsx:1551`'den
 * çağrılıyordu → rota hesaplamanın sahibi görünümdü.
 *
 * Bu dosya sahipliğin servise geçtiğini VE çift istek kapısının hâlâ tek
 * olduğunu (`claimRouteRequest`) kilitler.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const M = vi.hoisted(() => ({
  fetchCalls: [] as Array<{ oLat: number; oLon: number; dLat: number; dLon: number }>,
  geometry: null as Array<[number, number]> | null,
  location: { latitude: 37.65, longitude: 34.68, accuracy: 3, timestamp: 0 } as
    { latitude: number; longitude: number; accuracy: number; timestamp: number } | null,
}));

vi.mock('../platform/routingService', () => ({
  setRerouteContext: vi.fn(),
  clearRerouteContext: vi.fn(),
  registerReroutingCallback: vi.fn(() => () => {}),
  getRouteState: vi.fn(() => ({ geometry: M.geometry })),
  pointToSegmentDist: vi.fn(() => 0),
  projectOnSegment: vi.fn(() => ({ lat: 0, lon: 0 })),
  injectSentinelStepIfEmpty: vi.fn(),
  clearAltRoutes: vi.fn(),
  clearRoute: vi.fn(),
  fetchRoute: vi.fn((oLat: number, oLon: number, dLat: number, dLon: number) => {
    M.fetchCalls.push({ oLat, oLon, dLat, dLon });
    return Promise.resolve();
  }),
}));

vi.mock('../platform/vehicleDataLayer/UnifiedVehicleStore', () => ({
  useUnifiedVehicleStore: { getState: () => ({ location: M.location }) },
}));
vi.mock('../platform/ttsService', () => ({ speakNavigation: vi.fn() }));
vi.mock('../core/navigation/CorridorSyncEngine', () => ({
  corridorSync: { activate: vi.fn(), deactivate: vi.fn() },
}));
vi.mock('../platform/sensitiveKeyStore', () => ({ sensitiveKeyStore: { get: vi.fn(), set: vi.fn() } }));
vi.mock('../utils/safeStorage', () => ({
  safeSetRawImmediate: vi.fn(), safeGetRaw: vi.fn(() => null), safeRemoveRaw: vi.fn(),
}));

const DEST = {
  id: 'dst-1', name: 'Konya, Selçuklu',
  latitude: 37.87, longitude: 32.49,
} as unknown as import('../platform/addressBookService').Address;

type NavSvc = typeof import('../platform/navigationService');
async function fresh(): Promise<NavSvc> {
  vi.resetModules();
  return import('../platform/navigationService');
}

beforeEach(() => {
  M.fetchCalls = [];
  M.geometry = null;
  M.location = { latitude: 37.65, longitude: 34.68, accuracy: 3, timestamp: Date.now() };
});
afterEach(() => { vi.clearAllMocks(); });

describe('rota sahipliği görünümden bağımsızdır', () => {
  it('KRİTİK: ACTIVE"e geçince rota YOKSA servis rotayı KENDİSİ ister', async () => {
    const s = await fresh();
    s.startNavigation(DEST, false);
    expect(M.fetchCalls).toHaveLength(0);   // PREVIEW'de istek yok (davranış değişmedi)

    s.activateNavigation();

    expect(M.fetchCalls).toHaveLength(1);
    expect(M.fetchCalls[0]).toEqual({ oLat: 37.65, oLon: 34.68, dLat: 37.87, dLon: 32.49 });
  });

  it('rota ZATEN varsa yeniden istenmez (gereksiz ağ/CPU yok)', async () => {
    M.geometry = [[34.68, 37.65], [34.60, 37.70], [32.49, 37.87]];
    const s = await fresh();
    s.startNavigation(DEST, false);
    s.activateNavigation();
    expect(M.fetchCalls).toHaveLength(0);
  });

  it('SENTINEL adım "rota var" SAYILMAZ — ölçüt geometridir', async () => {
    // Sahada tam bu vardı: steps=1 ama geometryPts=0 → rota YOK demektir.
    M.geometry = [];
    const s = await fresh();
    s.startNavigation(DEST, false);
    s.activateNavigation();
    expect(M.fetchCalls).toHaveLength(1);
  });

  it('tek nokta geometri de rota SAYILMAZ', async () => {
    M.geometry = [[34.68, 37.65]];
    const s = await fresh();
    s.startNavigation(DEST, false);
    s.activateNavigation();
    expect(M.fetchCalls).toHaveLength(1);
  });

  it('GPS fix yokken istek ATILMAZ (kanıtsız origin ile rota istenmez)', async () => {
    M.location = null;
    const s = await fresh();
    s.startNavigation(DEST, false);
    s.activateNavigation();
    expect(M.fetchCalls).toHaveLength(0);
  });

  it('ÇİFT İSTEK KAPISI TEK: aynı oturumda ikinci activate istek atmaz', async () => {
    const s = await fresh();
    s.startNavigation(DEST, false);
    s.activateNavigation();
    expect(M.fetchCalls).toHaveLength(1);

    // Görünüm açılıp kapanınca ACTIVE tekrar tetiklenebilir — claim engeller.
    s.activateNavigation();
    expect(M.fetchCalls).toHaveLength(1);
  });

  it('YENİ hedef yeni oturumdur — sahiplik sıfırlanır ve rota yeniden istenir', async () => {
    const s = await fresh();
    s.startNavigation(DEST, false);
    s.activateNavigation();
    expect(M.fetchCalls).toHaveLength(1);

    const DEST2 = { ...DEST, id: 'dst-2', latitude: 38.42, longitude: 27.14 };
    // Kütük #429: hedefi KULLANICI değiştiriyor — kaynak bildirilir. Kaynaksız
    // (SYSTEM) çağrı aktif oturumda BLOCK edilir; bu testin senaryosu o değil.
    s.startNavigation(DEST2, false, 'USER_SEARCH');
    s.activateNavigation();
    expect(M.fetchCalls).toHaveLength(2);
    expect(M.fetchCalls[1].dLat).toBe(38.42);
  });

  it('hedef yokken çağrı güvenli (fail-soft)', async () => {
    const s = await fresh();
    expect(() => s.activateNavigation()).not.toThrow();
    expect(M.fetchCalls).toHaveLength(0);
  });
});
