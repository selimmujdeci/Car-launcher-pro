/**
 * geocodeFarNameMatch.test — sesli "tarsus şelalesi" 32 km'deki aynı adlı spor
 * tesisine değil, 3,7 km'deki şelaleye gider.
 *
 * Saha 2026-09-24 (kullanıcı: "Tarsus şelalesine gidelim dediğimde 48 km diyor,
 * Mersin'de bir yere götürüyor"). TomTom'daki "Tarsus Şelalesi" Mezitli'de bir
 * spor tesisi; asıl şelale TomTom'da YOK, OSM'de turistik yer. Fikstürler canlı
 * yanıtlardan (ürünün istek biçimiyle, Tarsus referans noktasıyla) alındı.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const H = vi.hoisted(() => ({ premium: [] as unknown[], nominatim: [] as unknown[] }));

vi.mock('../platform/geocodingProviders', () => ({ premiumGeocode: vi.fn(async () => H.premium) }));
vi.mock('../platform/offlineSearchService', () => ({
  searchOffline: vi.fn(async () => []),
  searchPOI:     vi.fn(async () => []),
}));
vi.mock('../platform/connectivity/connectivityGate', () => ({ allowsConnectivity: () => true }));
vi.mock('../platform/geo/nominatimRateLimit', () => ({ awaitNominatimSlot: async () => {} }));

import { geocodeAddress, _resetGeocodeLateCacheForTest } from '../platform/geocodingService';

/** Saha turlarının referans noktası (Tarsus) — bkz. addressAmbiguityDistanceGate. */
const TARSUS = { lat: 36.9175, lng: 34.8621 };

const tt = (id: string, name: string, fullName: string, lat: number, lng: number) =>
  ({ id, name, fullName, lat, lng, type: 'provider/tomtom', source: 'online' as const });

/* TomTom "tarsus selalesi" (konumlu): aynı adlı TEK kayıt Mezitli'de spor tesisi (32,6 km). */
const TOMTOM = [
  tt('geo-tomtom-0', 'Tarsus Şelalesi',
    'Tarsus Şelalesi, Atatürk, Gazi Mustafa Kemal Bulvarı 646, 33200, Mezitli, Mersin', 36.76335, 34.55098),
  tt('geo-tomtom-1', 'Tarsus', 'Tarsus, Mersin', 36.91705, 34.89516),
  tt('geo-tomtom-2', 'Tarsus Batı Bağlantı Yolu',
    'Kaleburcu, Tarsus Batı Bağlantı Yolu, 33403, Tarsus, Mersin', 36.91905, 34.84674),
];

/* Nominatim (limit 4, viewbox d=0.7): şelale 3,7 km'de — iki patika + turistik yer. */
const OSM = [
  { place_id: 417400706, class: 'highway', type: 'footway', lat: '36.9333126', lon: '34.8984080',
    display_name: 'Tarsus Şelalesi, Çağlayan Mahallesi, Bolatlı, Tarsus, Mersin, Akdeniz Bölgesi, 33450, Türkiye' },
  { place_id: 417400635, class: 'highway', type: 'footway', lat: '36.9332741', lon: '34.8990072',
    display_name: 'Tarsus Şelalesi, Kemalpaşa Mahallesi, Bolatlı, Tarsus, Mersin, Akdeniz Bölgesi, 33460, Türkiye' },
  { place_id: 417400631, class: 'tourism', type: 'attraction', lat: '36.9332147', lon: '34.8983502',
    display_name: 'Tarsus Şelalesi, Çağlayan Mahallesi, Bolatlı, Tarsus, Mersin, Akdeniz Bölgesi, 33450, Türkiye' },
];

const fetchMock = vi.fn(async (url: string | URL | Request) =>
  new Response(JSON.stringify(String(url).includes('nominatim') ? H.nominatim : []), { status: 200 }));

beforeEach(() => {
  _resetGeocodeLateCacheForTest();   // aynı sorgunun Nominatim yanıtı önbellekten dönmesin
  fetchMock.mockClear();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  H.premium = TOMTOM;
  H.nominatim = OSM;
});

describe('uzaktaki ad eşleşmesi → yakındaki aynı adlı yer', () => {
  it('🔒 adı tutan tek aday uzaktaysa yakındaki aynı adlı yer seçilir (patika değil, turistik yer)', async () => {
    const r = await geocodeAddress('tarsus selalesi', TARSUS.lat, TARSUS.lng);
    expect(r).toHaveLength(1);                       // tek sonuç → sesli akış doğrudan rota kurar
    expect(r[0].type).toBe('tourism/attraction');
    expect(r[0].distanceKm).toBeLessThan(5);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('yakında OSM de bulamazsa TomTom listesi aynen döner (en yakın önce, onay listesi)', async () => {
    H.nominatim = [];
    const r = await geocodeAddress('tarsus selalesi', TARSUS.lat, TARSUS.lng);
    expect(r.map((x) => x.id)).toEqual(['geo-tomtom-2', 'geo-tomtom-1', 'geo-tomtom-0']);
  });

  it('🔒 ad eşleşmesi zaten yakındaysa EK İSTEK atılmaz', async () => {
    H.premium = [tt('m', 'Migros', 'Migros, Şehitishak, Tarsus, Mersin', 36.92, 34.87)];
    const r = await geocodeAddress('migros', TARSUS.lat, TARSUS.lng);
    expect(r).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('il adı açıkça söylenmişse uzaklık sorun sayılmaz — ek istek atılmaz', async () => {
    const r = await geocodeAddress('tarsus selalesi mersin', TARSUS.lat, TARSUS.lng);
    expect(r.length).toBeGreaterThan(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
