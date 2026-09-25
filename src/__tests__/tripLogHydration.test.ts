/**
 * tripLogHydration.test — SAHA 2026-09-25: "seyir defteri kayıt tutuyor, bir
 * süre sonra kendi kendine siliyor".
 *
 * Kök neden: native'de geçmiş yalnız dosyada durur; servis `initSafeStorageAsync`
 * bitmeden (statik içe aktarma) okunuyordu → her açılışta boş göründü ve ilk
 * yazım eski geçmişin ÜSTÜNE yazıldı.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = vi.hoisted(() => ({ hydrated: false, disk: null as string | null, writes: [] as string[] }));
vi.mock('../utils/safeStorage', () => ({
  isSafeStorageHydrated: () => store.hydrated,
  // Önbellek hazır değilken native okuma "yok" döner (dosya içeriği görünmez).
  safeGetRaw: () => (store.hydrated ? store.disk : null),
  safeSetRaw: (_k: string, v: string) => { store.writes.push(v); store.disk = v; },
  safeFlushKey: () => {},
}));
vi.mock('../platform/crashLogger', () => ({ logError: vi.fn() }));
vi.mock('../platform/gpsService', () => ({ onGPSLocation: () => () => {} }));
vi.mock('../platform/obdService', () => ({ onOBDData: () => () => {} }));

const trip = (id: string) => ({ id, startTime: 1, endTime: 2, distanceKm: 5, durationMin: 10 });

describe('seyir defteri açılış sırası', () => {
  beforeEach(() => {
    vi.resetModules();
    store.hydrated = false;
    store.disk = JSON.stringify([trip('eski-1'), trip('eski-2')]);
    store.writes = [];
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
});
