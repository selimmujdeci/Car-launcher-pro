/**
 * trafficDemand.test — trafik verisi talep güdümlü, aralıklı ve geri çekilmeli çekilir.
 *
 * Kusur (2026-09-24): servis uygulama açıkken sürekli çalışıyor, sürüşte dakikada
 * 2 TomTom isteği atıyordu (tek kullanıcı aylık ücretsiz olay hakkını aşıyordu);
 * veri alınamayınca HER GPS tick'inde yeni istek atılıyordu.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const M = vi.hoisted(() => ({ road: 0, inc: 0, fail: false }));
vi.mock('../platform/traffic/tomtomTraffic', async (orig) => ({
  ...(await orig<typeof import('../platform/traffic/tomtomTraffic')>()),
  fetchRoad: async () => { M.road++; if (M.fail) throw new Error('HTTP 403'); return null; },
  fetchIncidents: async () => { M.inc++; if (M.fail) throw new Error('HTTP 403'); return []; },
}));

type Svc = typeof import('../platform/trafficService');
let svc: Svc;

const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
/** `sec` saniye boyunca her saniye konum güncellemesi (≈ GPS 1 Hz). */
const drive = async (sec: number) => {
  for (let i = 0; i < sec; i++) {
    svc.updateTrafficLocation(36.91 + i * 1e-5, 34.89);
    await vi.advanceTimersByTimeAsync(1_000);
    await flush();
  }
};

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-24T10:00:00Z'));
  vi.stubEnv('VITE_TOMTOM_API_KEY', 'test-key');
  vi.stubEnv('VITE_HERE_API_KEY', '');
  vi.resetModules();
  svc = await import('../platform/trafficService');
  svc._resetTrafficForTest();
  M.road = 0; M.inc = 0; M.fail = false;
  svc.startTrafficService(36.91, 34.89);
});
afterEach(() => { svc._resetTrafficForTest(); vi.useRealTimers(); vi.unstubAllEnvs(); });

describe('talep', () => {
  it('🔒 panel kapalıyken sürüşte TomTom ÇAĞRILMAZ', async () => {
    await drive(600);   // 10 dk sürüş
    expect(M.road + M.inc).toBe(0);
  });

  it('🔒 panel açıkken 3 dk\'da bir; konum değişimi araya istek sokmaz', async () => {
    const release = svc.acquireTrafficDemand();
    await flush();
    expect(M.road).toBe(1);
    await drive(170);
    expect(M.road).toBe(1);
    await drive(20);            // 3 dk doldu
    expect(M.road).toBe(2);
    release();
    await drive(600);           // panel kapandı → yeni istek yok
    expect(M.road).toBe(2);
  });
});

describe('hata', () => {
  it('🔒 veri alınamayınca GPS tick\'lerinde istek FIRTINASI olmaz; bekleme katlanır', async () => {
    M.fail = true;
    svc.acquireTrafficDemand();
    await flush();
    expect(M.road).toBe(1);
    await drive(55);            // eskiden burada ≈55 istek vardı
    expect(M.road).toBe(1);
    await drive(10);            // 1 dk geri çekilme doldu
    expect(M.road).toBe(2);
    await drive(110);           // 2. hatadan sonra 2 dk beklenir
    expect(M.road).toBe(2);
    await drive(15);
    expect(M.road).toBe(3);
  });

  it('bekleme tavanı 15 dk; başarıda normal aralığa döner', () => {
    expect(svc.trafficNextDelayMs(0)).toBe(3 * 60_000);
    expect(svc.trafficNextDelayMs(1)).toBe(60_000);
    expect(svc.trafficNextDelayMs(3)).toBe(4 * 60_000);
    expect(svc.trafficNextDelayMs(10)).toBe(15 * 60_000);
  });
});
