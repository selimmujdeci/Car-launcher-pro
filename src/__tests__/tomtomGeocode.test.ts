/**
 * tomtomGeocode.test — TomTom adres/POI araması (premium sağlayıcı).
 *
 * Saha (2026-09-24): "Atatürk Caddesi 45 Tarsus" ve "Atatürk Bulvarı 120 Ankara"
 * TomTom'da ev numarasıyla bulundu; Nominatim caddeyi / yanlış binayı verdi.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../platform/sensitiveKeyStore', () => ({ sensitiveKeyStore: { get: vi.fn(async () => '') } }));

import { premiumGeocode, invalidateGeocodeProviderCache, getGeocodeProviderStatus } from '../platform/geocodingProviders';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); invalidateGeocodeProviderCache(); });

const RESP = {
  results: [
    { type: 'Point Address', address: { freeformAddress: 'Atatürk Caddesi 45, 33401 Tarsus, Mersin', streetName: 'Atatürk Caddesi', streetNumber: '45' },
      position: { lat: 36.9201, lon: 34.8912 },
      entryPoints: [{ type: 'main', position: { lat: 36.9202, lon: 34.8913 } }] },
    { type: 'POI', poi: { name: 'Tarsus Devlet Hastanesi' },
      address: { freeformAddress: 'Türkmenistan Caddesi, 33460 Tarsus, Mersin' }, position: { lat: 36.93, lon: 34.87 } },
  ],
};

describe('TomTom sağlayıcısı', () => {
  it('🔒 anahtar yalnız derlemede varsa TomTom seçilir; yoksa sağlayıcı YOK (ücretsiz zincir)', async () => {
    vi.stubEnv('VITE_TOMTOM_API_KEY', '');
    expect(await getGeocodeProviderStatus()).toEqual({ provider: 'NONE', hasKey: false });
    invalidateGeocodeProviderCache();
    vi.stubEnv('VITE_TOMTOM_API_KEY', 'k');
    expect(await getGeocodeProviderStatus()).toEqual({ provider: 'tomtom', hasKey: true });
  });

  it('🔒 ev numaralı adres + POI; koordinat ANA GİRİŞ noktasıdır', async () => {
    vi.stubEnv('VITE_TOMTOM_API_KEY', 'k');
    let url = '';
    vi.stubGlobal('fetch', vi.fn(async (u: string) => { url = u; return new Response(JSON.stringify(RESP), { status: 200 }); }));
    const r = await premiumGeocode('Atatürk Caddesi 45 Tarsus', 36.91, 34.89);
    expect(url).toContain('api.tomtom.com/search/2/search/');
    expect(url).toContain('countrySet=TR');
    expect(url).toContain('lat=36.91');
    expect(r[0]).toMatchObject({ name: 'Atatürk Caddesi 45', lat: 36.9202, lng: 34.8913, type: 'provider/tomtom' });
    expect(r[1]).toMatchObject({ name: 'Tarsus Devlet Hastanesi', fullName: 'Tarsus Devlet Hastanesi, Türkmenistan Caddesi, 33460 Tarsus, Mersin' });
  });

  it('hata → boş (ücretsiz zincir devam eder)', async () => {
    vi.stubEnv('VITE_TOMTOM_API_KEY', 'k');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { status: 403 })));
    expect(await premiumGeocode('x y z', 36.9, 34.8)).toEqual([]);
  });
});
