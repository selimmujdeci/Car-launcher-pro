/**
 * Harici uygulamaya devredilen rotada tam ekran harita AÇILMAZ (mini harita
 * sabit kalır); varsayılan davranış (sesli adres → tam ekran) korunur.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  resolveAndNavigate, dismissAddressNav, onAddressNavState, type AddressNavState,
} from '../platform/addressNavigationEngine';

const TARSUS = { lat: 36.9175, lng: 34.8621 };
const near: GeoResult = {
  id: 'near', name: 'Cumhuriyet Mahallesi, Tarsus',
  fullName: 'Cumhuriyet Mahallesi, Tarsus, Mersin, Akdeniz Bölgesi, Türkiye',
  lat: 36.9150002, lng: 34.9010268, type: 'boundary/administrative', distanceKm: 3,
};

async function settle(): Promise<void> {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

describe('resolveAndNavigate openMap seçeneği', () => {
  let confirmed: AddressNavState | null;
  let stop: () => void;
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    confirmed = null;
    stop = onAddressNavState((s) => { if (s.phase === 'confirmed') confirmed = s; });
  });
  afterEach(() => { stop(); dismissAddressNav(); });

  it('varsayılan: onayda tam ekran harita açılır (davranış korundu)', async () => {
    vi.mocked(geocodeAddress).mockResolvedValueOnce([near]);
    resolveAndNavigate('Cumhuriyet Mahallesi', TARSUS);
    await settle();
    expect(startNavigation).toHaveBeenCalledTimes(1);
    expect(confirmed?.shouldOpenMap).toBe(true);
  });

  it('openMap:false → rota kurulur ama tam ekran harita AÇILMAZ', async () => {
    vi.mocked(geocodeAddress).mockResolvedValueOnce([near]);
    resolveAndNavigate('Cumhuriyet Mahallesi', TARSUS, undefined, { openMap: false });
    await settle();
    expect(startNavigation).toHaveBeenCalledTimes(1);
    expect(confirmed?.shouldOpenMap).toBe(false);
  });

  it('sonraki varsayılan çağrı yine tam ekran açar (seçenek sızmaz)', async () => {
    vi.mocked(geocodeAddress).mockResolvedValueOnce([near]).mockResolvedValueOnce([near]);
    resolveAndNavigate('Cumhuriyet Mahallesi', TARSUS, undefined, { openMap: false });
    await settle();
    resolveAndNavigate('Cumhuriyet Mahallesi', TARSUS);
    await settle();
    expect(confirmed?.shouldOpenMap).toBe(true);
  });

  it('🔒 önceki onayın 4 sn zamanlayıcısı YENİ aramayı "boşta"ya düşürmez', async () => {
    vi.useFakeTimers();
    try {
      const phases: string[] = [];
      const off = onAddressNavState((s) => { phases.push(`${s.phase}:${s.query}`); });
      vi.mocked(geocodeAddress).mockResolvedValueOnce([near]);
      resolveAndNavigate('Cumhuriyet Mahallesi', TARSUS);
      await vi.advanceTimersByTimeAsync(0);
      expect(phases.at(-1)).toBe('confirmed:Cumhuriyet Mahallesi');
      // İkinci arama: sonuç hiç gelmiyor (uçuşta kalıyor)
      vi.mocked(geocodeAddress).mockReturnValueOnce(new Promise(() => {}));
      resolveAndNavigate('Mersin', TARSUS);
      await vi.advanceTimersByTimeAsync(4_500);   // eski kartın kapanma süresi geçer
      expect(phases.at(-1)).toBe('searching:Mersin');
      off();
    } finally {
      vi.useRealTimers();
    }
  });
});
