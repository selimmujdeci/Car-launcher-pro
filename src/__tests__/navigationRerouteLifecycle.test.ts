/**
 * navigationRerouteLifecycle.test.ts — NAV-CORE-P0 · C ve F kategorileri.
 *
 *   C. Reroute      — istek kimliği · iptal · bayat yanıt reddi · eşzamanlı
 *                     istek · tekrar bastırma · sağlayıcı hatası · gecikme
 *   §9 Provider     — yerel OSRM tek sınırlı yoklama, sonra hiç denenmez
 *
 * ── NEDEN BU KİLİTLER ───────────────────────────────────────────────────────
 * `fetchRoute` KİMLİKSİZDİ: iki istek yarışırsa hangisi SONRA biterse store'u
 * o yazıyordu. Sapma anında bu, aracın ESKİ konumundan hesaplanmış rotanın
 * yeni rotayı ezmesi demekti — kullanıcının "rota saçmaladı" şikâyeti.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  beginRouteRequest, isCurrentRequest, recordResponse, recordCommit,
  recordStaleRejected, recordInvalidRejected, recordFailure,
  recordSuppressedDuplicate, markOffRouteDetected, markFirstNewInstruction,
  getRouteRequestSnapshot, resetRouteRequestLedger,
} from '../platform/navigation/core/routeRequestLedger';
import {
  shouldProbeLocalDaemon, recordLocalDaemonProbe, recordRouteSource,
  resolveProviderReadiness, getProviderReadinessSnapshot,
  _resetProviderReadinessForTest, LOCAL_PROBE_TIMEOUT_MS,
} from '../platform/navigation/core/routeProviderReadiness';

/* ══════════════════════════════════════════════════════════════════════════
   C1. İSTEK YAŞAM DÖNGÜSÜ (saf defter — enjekte saat)
   ══════════════════════════════════════════════════════════════════════════ */
describe('C1. Rota isteği yaşam döngüsü', () => {
  beforeEach(() => resetRouteRequestLedger());

  it('yalnız EN GÜNCEL istek uygulanabilir', () => {
    const a = beginRouteRequest('INITIAL', 0);
    expect(isCurrentRequest(a)).toBe(true);
    const b = beginRouteRequest('REROUTE', 100);
    expect(isCurrentRequest(a)).toBe(false);   // eski istek artık geçersiz
    expect(isCurrentRequest(b)).toBe(true);
  });

  it('uçuşta kalan istek SUPERSEDED sayılır (sessiz kaybolmaz)', () => {
    beginRouteRequest('INITIAL', 0);
    beginRouteRequest('REROUTE', 100);
    expect(getRouteRequestSnapshot().supersededCount).toBe(1);
  });

  it('BAYAT yanıt sayılır ve UYGULANMAZ', () => {
    const a = beginRouteRequest('INITIAL', 0);
    beginRouteRequest('REROUTE', 100);
    recordStaleRejected(a);
    expect(getRouteRequestSnapshot().staleRejectedCount).toBe(1);
  });

  it('DOĞRULAMADAN düşen rota ayrı sayaçta', () => {
    const a = beginRouteRequest('INITIAL', 0);
    recordInvalidRejected(a);
    const s = getRouteRequestSnapshot();
    expect(s.invalidRejectedCount).toBe(1);
    expect(s.committedCount).toBe(0);
  });

  it('TEKRAR istek bastırma sayılır (request storm görünür olur)', () => {
    recordSuppressedDuplicate();
    recordSuppressedDuplicate();
    expect(getRouteRequestSnapshot().suppressedDuplicateCount).toBe(2);
  });

  it('sağlayıcı hatası FAILED olarak kaydedilir', () => {
    const a = beginRouteRequest('INITIAL', 0);
    recordFailure(a);
    expect(getRouteRequestSnapshot().failedCount).toBe(1);
  });

  it('GECİKME AYRIŞTIRMASI: sapma → istek → yanıt → uygulandı → ilk talimat', () => {
    markOffRouteDetected(1_000);
    const id = beginRouteRequest('REROUTE', 1_200);
    recordResponse(id, 1_900, 'osrm');
    recordCommit(id, 2_000, 'osrm');
    markFirstNewInstruction(2_400);

    const L = getRouteRequestSnapshot().latency;
    expect(L.offRouteDetectedAtMs).toBe(1_000);
    expect(L.requestStartedAtMs).toBe(1_200);
    expect(L.responseReceivedAtMs).toBe(1_900);
    expect(L.routeCommittedAtMs).toBe(2_000);
    expect(L.firstNewInstructionAtMs).toBe(2_400);
    expect(L.requestToResponseMs).toBe(700);
    expect(L.detectToCommitMs).toBe(1_000);
    expect(L.detectToFirstInstructionMs).toBe(1_400);
  });

  it('ilk talimat damgası SONRAKİ çağrılarla değişmez', () => {
    markOffRouteDetected(1_000);
    const id = beginRouteRequest('REROUTE', 1_100);
    recordCommit(id, 1_500, 'osrm');
    markFirstNewInstruction(1_800);
    markFirstNewInstruction(2_500);
    expect(getRouteRequestSnapshot().latency.firstNewInstructionAtMs).toBe(1_800);
  });

  it('commit YOKKEN ilk talimat damgalanmaz (anlamsız ölçüm üretilmez)', () => {
    markOffRouteDetected(1_000);
    beginRouteRequest('REROUTE', 1_100);
    markFirstNewInstruction(1_800);
    expect(getRouteRequestSnapshot().latency.firstNewInstructionAtMs).toBeNull();
  });

  it('navigasyon durunca defter TEMİZLENİR', () => {
    const a = beginRouteRequest('INITIAL', 0);
    recordCommit(a, 10, 'osrm');
    resetRouteRequestLedger();
    const s = getRouteRequestSnapshot();
    expect(s.committedCount).toBe(0);
    expect(s.currentId).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   C2. SAĞLAYICI HAZIRLIĞI (§9 — ölü localhost katmanı)
   ══════════════════════════════════════════════════════════════════════════ */
describe('C2. Rota sağlayıcı hazırlığı', () => {
  beforeEach(() => _resetProviderReadinessForTest());

  it('yerel daemon yoklaması SINIRLIDIR (3 sn değil)', () => {
    expect(LOCAL_PROBE_TIMEOUT_MS).toBeLessThanOrEqual(1_000);
  });

  it('yerel daemon oturumda YALNIZ BİR KEZ yoklanır', () => {
    expect(shouldProbeLocalDaemon()).toBe(true);
    recordLocalDaemonProbe(false, 1_000);
    expect(shouldProbeLocalDaemon()).toBe(false);
    expect(shouldProbeLocalDaemon()).toBe(false);
    const s = getProviderReadinessSnapshot();
    expect(s.localState).toBe('LOCAL_OSRM_UNAVAILABLE');
    expect(s.localProbeCount).toBe(1);
    expect(s.localSkippedCount).toBe(2);   // her rotada boşuna beklenmedi
  });

  it('daemon VARSA hazırlık öyle kaydedilir', () => {
    shouldProbeLocalDaemon();
    recordLocalDaemonProbe(true, 500);
    expect(getProviderReadinessSnapshot().localState).toBe('LOCAL_OSRM_AVAILABLE');
    expect(resolveProviderReadiness(false, false)).toBe('LOCAL_OSRM_AVAILABLE');
  });

  it('çevrimdışı + graf yok + yerel yok → ROTA SAĞLAYICISI YOK', () => {
    recordLocalDaemonProbe(false, 1_000);
    expect(resolveProviderReadiness(false, false)).toBe('NO_ROUTE_PROVIDER');
  });

  it('düz hat GERÇEK ROTA SAYILMAZ — ayrı kaynak sınıfı ve sayacı', () => {
    recordRouteSource('STRAIGHT_LINE_GUIDANCE', 'straight-line');
    const s = getProviderReadinessSnapshot();
    expect(s.lastSource).toBe('STRAIGHT_LINE_GUIDANCE');
    expect(s.straightLineCount).toBe(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   C3. ENTEGRASYON — eşzamanlı fetchRoute yarışı
   ══════════════════════════════════════════════════════════════════════════ */
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
      speed: 40, heading: 90,
      location: { latitude: 36.80, longitude: 34.60, accuracy: 6, timestamp: Date.now() },
    }),
  },
}));

import { fetchRoute, getRouteState, clearRoute } from '../platform/routingService';

/** İki farklı rota — hangisinin uygulandığını mesafeden ayırt ederiz. */
function osrmRoute(distance: number, lastLon: number) {
  return {
    code: 'Ok',
    routes: [{
      distance, duration: 300,
      geometry: { coordinates: [[34.60, 36.80], [34.62, 36.80], [lastLon, 36.80]] },
      legs: [{ steps: [
        { distance: distance / 2, duration: 150, name: 'A',
          maneuver: { type: 'depart', modifier: 'straight' },
          geometry: { coordinates: [[34.60, 36.80], [34.62, 36.80]] } },
        { distance: 0, duration: 0, name: '',
          maneuver: { type: 'arrive', modifier: 'straight' },
          geometry: { coordinates: [[lastLon, 36.80]] } },
      ] }],
    }],
  };
}

describe('C3. Eşzamanlı istek — bayat yanıt güncel rotayı EZEMEZ', () => {
  beforeEach(() => {
    resetRouteRequestLedger();
    vi.stubGlobal('fetch', vi.fn());
    Object.defineProperty(navigator, 'onLine', { value: true, writable: true, configurable: true });
  });
  afterEach(() => { clearRoute(); vi.unstubAllGlobals(); });

  it('ESKİ istek GEÇ bitse bile store\'u yazamaz', async () => {
    let resolveSlow: (v: unknown) => void = () => {};
    const slow = new Promise((r) => { resolveSlow = r; });

    vi.mocked(fetch)
      // 1. istek: yavaş — 3565 m'lik "eski" rota
      .mockImplementationOnce(() => slow as Promise<Response>)
      // 2. istek: hızlı — 1780 m'lik "yeni" rota
      .mockResolvedValue({
        ok: true, json: () => Promise.resolve(osrmRoute(1780, 34.62)),
      } as unknown as Response);

    const p1 = fetchRoute(36.80, 34.60, 36.80, 34.64);   // eski (yavaş)
    const p2 = fetchRoute(36.80, 34.60, 36.80, 34.62);   // yeni (hızlı)
    await p2;

    // Yeni rota uygulandı
    expect(getRouteState().totalDistanceMeters).toBe(1780);

    // Şimdi ESKİ istek biter — store'u EZMEMELİ
    resolveSlow({ ok: true, json: () => Promise.resolve(osrmRoute(3565, 34.64)) });
    await p1;

    expect(getRouteState().totalDistanceMeters).toBe(1780);   // hâlâ YENİ rota
    expect(getRouteRequestSnapshot().staleRejectedCount).toBeGreaterThanOrEqual(1);
    expect(getRouteRequestSnapshot().supersededCount).toBeGreaterThanOrEqual(1);
  });

  it('sağlayıcı düşerse düz hat GERÇEK ROTA olarak sunulmaz', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('Network error'));
    await fetchRoute(36.80, 34.60, 36.80, 34.64);
    const s = getRouteState();
    expect(s.serverUsed).toBe('straight-line');
    expect(s.geometry).not.toBeNull();
    // Düz hat DOĞRULANMAZ — "GEÇERLİ rota" iddiası üretilmez
    expect(s.validation).toBeNull();
    expect(s.error).toBeTruthy();
    expect(getProviderReadinessSnapshot().lastSource).toBe('STRAIGHT_LINE_GUIDANCE');
  });

  it('rota commit edilince manevra ÇAPALARI kurulur (yol-boyu mesafe hazır)', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true, json: () => Promise.resolve(osrmRoute(1780, 34.62)),
    } as unknown as Response);
    await fetchRoute(36.80, 34.60, 36.80, 34.62);
    const s = getRouteState();
    expect(s.maneuverAnchors.length).toBe(s.steps.length);
    expect(s.maneuverAnchors.every(a => a.geometryIndex >= 0)).toBe(true);
    expect(s.validation?.verdict).toBe('VALID');
  });
});
