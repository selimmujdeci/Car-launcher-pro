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

describe('Türkiye adres sorgusu', () => {
  it('🔒 sözle söylenen sayı rakama çevrilir; "On Nisan" gibi adlar bozulmaz', async () => {
    const { trNumberWordsToDigits } = await import('../platform/geocodingProviders');
    expect(trNumberWordsToDigits('dört yüz elli beş sokak tarsus')).toBe('455 sokak tarsus');
    expect(trNumberWordsToDigits('sıfır dört yüz elli beş sokak')).toBe('0455 sokak');
    expect(trNumberWordsToDigits('iki bin on dokuz sokak numara on iki')).toBe('2019 sokak numara 12');
    expect(trNumberWordsToDigits('On Nisan Caddesi')).toBe('On Nisan Caddesi');
    expect(trNumberWordsToDigits('Beş Yol Kavşağı')).toBe('Beş Yol Kavşağı');
    expect(trNumberWordsToDigits('beş sokak')).toBe('5 sokak');
  });

  it('🔒 daire numarası atılır, "numara" → "No"', async () => {
    const { normalizeTrAddressQuery } = await import('../platform/geocodingProviders');
    expect(normalizeTrAddressQuery('0455 sk no:5/2 tarsus')).toBe('0455 sk no 5 tarsus');
    expect(normalizeTrAddressQuery('Atatürk Bulvarı numara 120 / 3 Ankara')).toBe('Atatürk Bulvarı No 120 Ankara');
  });

  it('numaralı sokak tanıma ve eşleşme (baştaki sıfır, nokta, Türkçe ek)', async () => {
    const { numberedStreetOf, mentionsNumberedStreet, numberedStreetVariants } = await import('../platform/geocodingProviders');
    expect(numberedStreetOf('455 sokak Tarsus')).toBe('455');
    expect(numberedStreetOf('0455. Sk. No 5')).toBe('455');
    expect(numberedStreetOf('Atatürk Caddesi 45')).toBeNull();
    expect(mentionsNumberedStreet('Bağlar, 0455. Sokak, 33420, Tarsus', '455')).toBe(true);
    expect(mentionsNumberedStreet('Ulaş, Ulaş Sokak 455, Tarsus', '455')).toBe(false);
    expect(mentionsNumberedStreet('1455. Sokak', '455')).toBe(false);
    expect(numberedStreetVariants('Bağlar Mah. 455 sokak Tarsus')).toEqual([
      'Bağlar Mah. 0455 sokak Tarsus', '455 sokak Tarsus',
    ]);
  });

  it('🔒 ıskalamada varyant denenir ve bulunan sokak başa alınır (ek istek yalnız ıskalamada)', async () => {
    vi.stubEnv('VITE_TOMTOM_API_KEY', 'k');
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string) => {
      urls.push(decodeURIComponent(u));
      const zero = decodeURIComponent(u).includes('0455');
      return new Response(JSON.stringify({ results: zero
        ? [{ type: 'Street', address: { freeformAddress: 'Bağlar, 0455. Sokak, 33420, Tarsus, Mersin' }, position: { lat: 36.9176, lon: 34.8621 } }]
        : [{ type: 'Point Address', address: { freeformAddress: 'Ulaş, Ulaş Sokak 455, 33403, Tarsus, Mersin' }, position: { lat: 37.0, lon: 34.78 } }],
      }), { status: 200 });
    }));
    const r = await premiumGeocode('455 sokak Tarsus', 36.91, 34.89);
    expect(urls).toHaveLength(2);
    expect(urls[1]).toContain('0455 sokak Tarsus');
    expect(r[0]!.fullName).toContain('0455. Sokak');

    urls.length = 0;
    await premiumGeocode('0455 sokak Tarsus', 36.91, 34.89);
    expect(urls).toHaveLength(1);                     // bulundu → ek istek YOK
  });

  it('🔒 eşleşme UZAKTAYSA ıskalama sayılır — yazarken de sıfırlı varyant denenir (cihaz 2026-09-24)', async () => {
    vi.stubEnv('VITE_TOMTOM_API_KEY', 'k');
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string) => {
      urls.push(decodeURIComponent(u));
      const zero = decodeURIComponent(u).includes('0455');
      return new Response(JSON.stringify({ results: zero
        ? [{ type: 'Street', address: { freeformAddress: 'Bağlar, 0455. Sokak, 33420, Tarsus, Mersin' }, position: { lat: 36.9176, lon: 34.8621 } }]
        : [{ type: 'Street', address: { freeformAddress: 'Akdeniz, 455. Sokak, 01291, Yüreğir, Adana' }, position: { lat: 36.99, lon: 35.33 } }],
      }), { status: 200 });
    }));
    const r = await premiumGeocode('455 sokak', 36.9175, 34.8622, { typeahead: true });
    expect(urls).toHaveLength(2);
    expect(r[0]!.fullName).toContain('0455. Sokak');

    urls.length = 0;                                  // yakın eşleşme → ek istek YOK
    await premiumGeocode('455 sokak', 36.99, 35.33, { typeahead: true });
    expect(urls).toHaveLength(1);
  });
});

describe('sorgu yönü', () => {
  it('"numara beş" → "No 5"', async () => {
    const { normalizeTrAddressQuery } = await import('../platform/geocodingProviders');
    expect(normalizeTrAddressQuery('dört yüz elli beş sokak numara beş tarsus')).toBe('455 sokak No 5 tarsus');
  });

  it('🔒 sorguda il adı varsa konum yanlılığı gönderilmez', async () => {
    vi.stubEnv('VITE_TOMTOM_API_KEY', 'k');
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string) => { urls.push(u); return new Response('{"results":[]}', { status: 200 }); }));
    await premiumGeocode('Atatürk Bulvarı 120 Ankara', 36.91, 34.89);
    expect(urls[0]).not.toContain('lat=');
    await premiumGeocode('Atatürk Caddesi 45 Tarsus', 36.91, 34.89);
    expect(urls[1]).toContain('lat=36.91');
  });
});
