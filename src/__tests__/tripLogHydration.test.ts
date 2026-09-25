/**
 * tripLogHydration.test — SAHA 2026-09-25: "seyir defteri kayıt tutuyor, bir
 * süre sonra kendi kendine siliyor".
 *
 * Kök neden: native'de geçmiş yalnız dosyada durur; servis `initSafeStorageAsync`
 * bitmeden (statik içe aktarma) okunuyordu → her açılışta boş göründü ve ilk
 * yazım eski geçmişin ÜSTÜNE yazıldı.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = vi.hoisted(() => ({ hydrated: false, disk: null as string | null, writes: [] as string[], other: new Map<string, string>() }));
const TRIP_KEY = 'car-launcher-trip-log';
vi.mock('../utils/safeStorage', () => ({
  isSafeStorageHydrated: () => store.hydrated,
  // Önbellek hazır değilken native okuma "yok" döner (dosya içeriği görünmez).
  safeGetRaw: (k: string) => (!store.hydrated ? null : k === TRIP_KEY ? store.disk : store.other.get(k) ?? null),
  safeSetRaw: (k: string, v: string) => {
    if (k === TRIP_KEY) { store.writes.push(v); store.disk = v; } else store.other.set(k, v);
  },
  safeFlushKey: () => {},
}));
vi.mock('../platform/crashLogger', () => ({ logError: vi.fn() }));
vi.mock('../platform/gpsService', () => ({ onGPSLocation: () => () => {} }));
vi.mock('../platform/obdService', () => ({ onOBDData: () => () => {} }));
const journal = vi.hoisted(() => ({ ids: [] as string[] }));
vi.mock('../platform/trip/tripJournalStore', async (orig) => ({
  ...(await orig<object>()),
  listJournalIds: () => journal.ids,
  readJournal: (id: string) => ({
    schemaVersion: 1, tripId: id, startedAtMs: 5_000, endedAtMs: 5_000 + 600_000,
    endReason: id.startsWith('atildi') ? 'DISCARDED_TOO_SHORT' : 'IDLE_WINDOW',
    startLocation: null, endLocation: null, startArea: null, endArea: null,
    route: { v: 1, n: 2, lat0: 3690000, lon0: 3487000, dlat: [900], dlon: [0], t0: 0, dt: [60000], spd: [40, 50] },
    stops: [], motionEvidence: { sampleCount: 2, spanMs: 60000, sourceCount: 1 }, events: [],
  }),
  recoverOpenJournal: () => null,
}));

const trip = (id: string) => ({ id, startTime: 1, endTime: 2, distanceKm: 5, durationMin: 10 });

describe('seyir defteri açılış sırası', () => {
  beforeEach(() => {
    vi.resetModules();
    store.hydrated = false;
    store.disk = JSON.stringify([trip('eski-1'), trip('eski-2')]);
    store.writes = [];
    store.other.clear();
    journal.ids = [];
  });

  it('🔒 depo hazır olmadan okunan geçmiş diske YAZILMAZ; hazır olunca yüklenir', async () => {
    const svc = await import('../platform/tripLogService');
    expect(svc.getTripSnapshot().history).toHaveLength(0);   // henüz bilinmiyor
    svc.deleteTrip('yok');                                     // erken mutasyon
    expect(store.writes).toHaveLength(0);                      // ESKİ geçmiş ezilmedi
    store.hydrated = true;
    svc.startTripLog();
    expect(svc.getTripSnapshot().history.map((t) => t.id)).toEqual(['eski-1', 'eski-2']);
    svc.stopTripLog();
  });

  it('🔒 web / hazır depo: geçmiş modül yüklenirken okunur (davranış korunur)', async () => {
    store.hydrated = true;
    const svc = await import('../platform/tripLogService');
    expect(svc.getTripSnapshot().totalTrips).toBe(2);
  });

  it('🔒 geçmiş okunmadan "tümünü sil" silindi iddia etmez', async () => {
    const svc = await import('../platform/tripLogService');
    expect(svc.clearAllTrips()).toBe(false);
    expect(store.writes).toHaveLength(0);
    expect(JSON.parse(store.disk!)).toHaveLength(2);
  });

  it('🔒 silinmiş özetler günlükten BİR KEZ geri gelir; sonra silinen dirilmez', async () => {
    store.hydrated = true;
    store.disk = null;                                        // seyir defteri silinmiş
    journal.ids = ['j-1', 'eski-1', 'atildi-1'];   // canlı serviste atılmış olan geri GELMEZ
    let svc = await import('../platform/tripLogService');
    svc.startTripLog();
    expect(svc.getTripSnapshot().history.map((t) => t.id).sort()).toEqual(['eski-1', 'j-1']);
    expect(svc.getTripSnapshot().history[0].fuelConsumptionL).toBeNull();
    svc.stopTripLog();
    svc.deleteTrip('j-1');                                    // kullanıcı siliyor
    vi.resetModules();                                        // uygulama yeniden açılıyor
    svc = await import('../platform/tripLogService');
    svc.startTripLog();
    expect(svc.getTripSnapshot().history.map((t) => t.id)).not.toContain('j-1');
    svc.stopTripLog();
  });
});
