/**
 * addressAmbiguityEngineGuard.test.ts — konum kapısının MOTOR tarafı.
 *
 * Kapının aday işaretlemesi tek başına bir şey ifade etmez; asıl soru şudur:
 * **işaretli aday sessizce rotaya çevriliyor mu?** Bu dosya o kararı kilitler.
 *
 * Ölçülen risk (teşhis §3.5 + 2026-08-12 ölçümü): tek sonuç dönen sorgu
 * DOĞRUDAN rotaya çevriliyordu. Sonuç 405 km ötede bile olsa sürücü hiçbir
 * onay görmüyordu.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../platform/navigationService', () => ({ startNavigation: vi.fn() }));
vi.mock('../platform/offlineSearchService', () => ({
  searchOffline:   vi.fn(async () => []),
  saveSearchQuery: vi.fn(async () => undefined),
  searchPOI:       vi.fn(async () => []),
}));
vi.mock('../platform/offlineDataService', () => ({
  searchOfflinePlaces: vi.fn(async () => []),
}));
vi.mock('../platform/geocodingService', async (orig) => {
  const actual = await orig<typeof import('../platform/geocodingService')>();
  return { ...actual, geocodeAddress: vi.fn(), searchNearby: vi.fn(async () => []) };
});

import { startNavigation } from '../platform/navigationService';
import { geocodeAddress, type GeoResult } from '../platform/geocodingService';
import {
  resolveAndNavigate, dismissAddressNav, onAddressNavState,
  type AddressNavState,
} from '../platform/addressNavigationEngine';

const TARSUS = { lat: 36.9175, lng: 34.8621 };

/** Motorun asenkron zinciri bitene kadar bekler (timer YOK — mikro görevler). */
async function settle(): Promise<void> {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

function watch(): { last: () => AddressNavState; stop: () => void } {
  let snap: AddressNavState | null = null;
  const stop = onAddressNavState((s) => { snap = s; });
  return { last: () => snap as AddressNavState, stop };
}

const near: GeoResult = {
  id: 'near', name: 'Cumhuriyet Mahallesi, Tarsus',
  fullName: 'Cumhuriyet Mahallesi, Tarsus, Mersin, Akdeniz Bölgesi, Türkiye',
  lat: 36.9150002, lng: 34.9010268, type: 'boundary/administrative',
};

describe('addressNavigationEngine — işaretli tek aday OTOMATİK rotaya çevrilmez', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  });
  afterEach(() => { dismissAddressNav(); });

  it('UZAK tek sonuç → onay listesi (rota BAŞLAMAZ)', async () => {
    vi.mocked(geocodeAddress).mockResolvedValueOnce([
      { ...near, id: 'far', lat: 37.7529, lng: 39.3168, distanceKm: 405, farFromUser: true },
    ]);
    const w = watch();
    resolveAndNavigate('Bağlar Mahallesi', TARSUS);
    await settle();

    expect(w.last().phase).toBe('selecting');
    expect(startNavigation).not.toHaveBeenCalled();
    w.stop();
  });

  it('ŞEHRİ DOĞRULANAMAYAN tek sonuç → onay listesi', async () => {
    vi.mocked(geocodeAddress).mockResolvedValueOnce([
      { ...near, id: 'unv', fullName: '0469. Sokak', cityUnverified: true },
    ]);
    const w = watch();
    resolveAndNavigate('İstanbul Bağdat Caddesi', TARSUS);
    await settle();

    expect(w.last().phase).toBe('selecting');
    expect(startNavigation).not.toHaveBeenCalled();
    w.stop();
  });

  it('YAKIN ve kanıtı TAM tek sonuç → doğrudan rota (davranış korundu)', async () => {
    vi.mocked(geocodeAddress).mockResolvedValueOnce([{ ...near, distanceKm: 3 }]);
    const w = watch();
    resolveAndNavigate('Cumhuriyet Mahallesi', TARSUS);
    await settle();

    expect(w.last().phase).toBe('confirmed');
    expect(startNavigation).toHaveBeenCalledTimes(1);
    w.stop();
  });

  it('şehir AÇIKÇA belirtilmiş uzak sonuç → yine doğrudan rota (kural gereği)', async () => {
    /* Biri Tarsus'tayken "İstanbul …" arıyorsa oraya GİDECEĞİ için arıyordur.
       Kapı bu sonuca `farFromUser` KOYMAZ → onay istenmez. */
    vi.mocked(geocodeAddress).mockResolvedValueOnce([{
      id: 'ist', name: 'Bağlar Mahallesi, Bağcılar',
      fullName: 'Bağlar Mahallesi, Bağcılar, İstanbul, Marmara Bölgesi, 34212, Türkiye',
      lat: 41.0228866, lng: 28.8248289, type: 'boundary/administrative', distanceKm: 693,
    }]);
    const w = watch();
    resolveAndNavigate('İstanbul Bağlar Mahallesi', TARSUS);
    await settle();

    expect(w.last().phase).toBe('confirmed');
    expect(startNavigation).toHaveBeenCalledTimes(1);
    w.stop();
  });
});
