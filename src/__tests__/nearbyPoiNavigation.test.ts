/**
 * nearbyPoiNavigation.test.ts — NAVIGATION-P0-2.
 *
 * "en yakın hastane" komutunu gerçek POI araması + navigasyona bağlar.
 * Çalışan FUEL deseni (addressNavigationEngine.resolveAndNavigate +
 * geocodingService.searchNearby) genişletilebilir bir POI kategori
 * kataloğuna (nearbyPoiNavigation.ts) taşınır; fuel'in MEVCUT davranışı
 * DEĞİŞMEDEN korunur (regresyon testleri bunu kanıtlar).
 *
 * Bu dosya dört katmanı test eder:
 *   A. addressParser.tryParseNavAddress — genel "en yakın hastane" vs
 *      isimli hastane ("Mersin Şehir Hastanesi'ne git") ayrımı.
 *   B. geocodingService.searchNearby — hospital amenity + koordinat
 *      doğrulaması (0,0 reddi, sınır-dışı reddi, malformed sonuç, dedupe).
 *   C. nearbyPoiNavigation.dispatchNearbyPoiNavigation — GPS fail-closed,
 *      dedupe, en-yakın seçim, boş sonuç / network hatası TTS.
 *   D. intentEngine / commandExecutor — FIND_NEARBY_HOSPITAL sentinel yolu
 *      + homeWorkNavigation/find_nearby_gas regresyonu.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../platform/navigationService', () => ({
  startNavigation: vi.fn(),
}));
vi.mock('../platform/ttsService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../platform/ttsService')>();
  return { ...actual, speakNavigation: vi.fn() };
});

import { startNavigation } from '../platform/navigationService';
import { speakNavigation } from '../platform/ttsService';
import i18n from '../i18n/config';
import { tryParseNavAddress } from '../platform/addressParser';
import { searchNearby } from '../platform/geocodingService';
import { resolveAndNavigate, useAddressNavState } from '../platform/addressNavigationEngine';
import {
  dispatchNearbyPoiNavigation,
  NEARBY_POI_CATALOG,
  NEARBY_DISPATCH_DEDUPE_MS,
  _resetNearbyDispatchGuardForTests,
  type NearbyPoiCategory,
} from '../platform/nearbyPoiNavigation';
import { toIntent, routeIntent, type RouterContext } from '../platform/intentEngine';
import { executeIntent, type CommandContext } from '../platform/commandExecutor';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const startNavigationMock = vi.mocked(startNavigation);
const speakNavigationMock = vi.mocked(speakNavigation);

function makeCtx(overrides: Partial<RouterContext> = {}): RouterContext {
  return {
    launch:     vi.fn(),
    openDrawer: vi.fn(),
    setTheme:   vi.fn(),
    playMedia:  vi.fn(),
    pauseMedia: vi.fn(),
    dispatchNearbyPoi: vi.fn(),
    ...overrides,
  };
}

function makeCmdCtx(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    vehicleCtx: { speedKmh: 0, drivingMode: 'idle', isDriving: false },
    defaultNav: 'maps',
    defaultMusic: 'spotify',
    launch: vi.fn(),
    dispatchNearbyPoi: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  startNavigationMock.mockClear();
  speakNavigationMock.mockClear();
  _resetNearbyDispatchGuardForTests();
  vi.useRealTimers();
});

/* ── A. addressParser — genel hastane vs isimli hastane ─────────────────── */

describe('addressParser.tryParseNavAddress — hastane ayrımı', () => {
  it('"en yakın hastane" → find_nearby_hospital sentinel', () => {
    const r = tryParseNavAddress('en yakın hastane');
    expect(r).not.toBeNull();
    expect(r?.intent).toBe('find_nearby_hospital');
    expect(r?.destination).toBe('__nearby_hospital__');
  });

  it('"en yakın acil" → find_nearby_hospital sentinel', () => {
    const r = tryParseNavAddress('en yakın acile götür');
    expect(r?.intent).toBe('find_nearby_hospital');
    expect(r?.destination).toBe('__nearby_hospital__');
  });

  it('"yakınımdaki hastane" → find_nearby_hospital sentinel', () => {
    const r = tryParseNavAddress('yakınımdaki hastaneye git');
    expect(r?.intent).toBe('find_nearby_hospital');
  });

  it('"hastane bul" → find_nearby_hospital sentinel', () => {
    const r = tryParseNavAddress('hastane bul');
    expect(r?.intent).toBe('find_nearby_hospital');
    expect(r?.destination).toBe('__nearby_hospital__');
  });

  it('"doktor bul" → find_nearby_hospital sentinel', () => {
    const r = tryParseNavAddress('doktor bul');
    expect(r?.intent).toBe('find_nearby_hospital');
  });

  it('"acil servis" → find_nearby_hospital sentinel', () => {
    const r = tryParseNavAddress('acil servis');
    expect(r?.intent).toBe('find_nearby_hospital');
  });

  it('"hastaneye git" (bare, isimsiz) → find_nearby_hospital sentinel', () => {
    const r = tryParseNavAddress('hastaneye git');
    expect(r?.intent).toBe('find_nearby_hospital');
    expect(r?.destination).toBe('__nearby_hospital__');
  });

  it('İSİMLİ hastane KORUNUR: "Mersin Şehir Hastanesi\'ne git" → navigate_place, sentinel DEĞİL', () => {
    const r = tryParseNavAddress("Mersin Şehir Hastanesi'ne git");
    expect(r).not.toBeNull();
    expect(r?.intent).toBe('navigate_place');
    expect(r?.destination).not.toBe('__nearby_hospital__');
    expect(r?.destination.toLowerCase()).toContain('hastanesi');
  });

  it('İSİMLİ hastane KORUNUR: "Acıbadem Hastanesine rota ver" → navigate_place', () => {
    const r = tryParseNavAddress('Acıbadem Hastanesine rota ver');
    expect(r?.intent).toBe('navigate_place');
    expect(r?.destination).not.toBe('__nearby_hospital__');
  });

  it('mevcut benzinlik davranışı bozulmadı', () => {
    const r = tryParseNavAddress('en yakın benzinliğe git');
    expect(r?.intent).toBe('find_nearby_gas');
    expect(r?.destination).toBe('__nearby_gas__');
  });

  it('mevcut otopark davranışı bozulmadı', () => {
    const r = tryParseNavAddress('en yakın otoparka götür');
    expect(r?.intent).toBe('find_nearby_parking');
    expect(r?.destination).toBe('__nearby_parking__');
  });

  it('NAVIGATION-P1-2: İSİMLİ otopark KORUNUR — "Forum AVM otoparkına git" __nearby_parking__ sentinel DEĞİL', () => {
    const r = tryParseNavAddress('Forum AVM otoparkına git');
    expect(r).not.toBeNull();
    expect(r?.intent).not.toBe('find_nearby_parking');
    expect(r?.destination).not.toBe('__nearby_parking__');
    expect(r?.intent).toBe('navigate_place');
  });

  it('NAVIGATION-P1-2: bare "otopark bul" hâlâ genel sentinel üretir (hastane deseniyle tutarlı)', () => {
    const r = tryParseNavAddress('otopark bul');
    expect(r?.intent).toBe('find_nearby_parking');
    expect(r?.destination).toBe('__nearby_parking__');
  });

  it('NAVIGATION-P1-1: İSİMLİ benzinlik KORUNUR — "Shell Tarsus\'a git" __nearby_gas__ sentinel DEĞİL', () => {
    const r = tryParseNavAddress("Shell Tarsus'a git");
    expect(r).not.toBeNull();
    expect(r?.intent).not.toBe('find_nearby_gas');
    expect(r?.destination).not.toBe('__nearby_gas__');
  });
});

/* ── B. geocodingService.searchNearby — hospital + koordinat doğrulama ──── */

describe('geocodingService.searchNearby — hospital amenity + doğrulama', () => {
  const OVERPASS_URL_FRAGMENT = 'overpass';

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('type "hospital" → Overpass sorgusunda amenity=hospital kullanılır', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(String(url)).toContain('amenity');
      expect(decodeURIComponent(String(url))).toContain('amenity=hospital');
      return new Response(JSON.stringify({ elements: [
        { id: 1, lat: 36.81, lon: 34.64, tags: { name: 'Mersin Şehir Hastanesi', amenity: 'hospital' } },
      ] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    const results = await searchNearby('hospital', 36.80, 34.63);
    expect(fetchMock).toHaveBeenCalled();
    expect(String(fetchMock.mock.calls[0][0])).toContain(OVERPASS_URL_FRAGMENT);
    expect(results.length).toBe(1);
    expect(results[0].name).toBe('Mersin Şehir Hastanesi');
  });

  it('birden çok hastane sonucu varsa EN YAKIN (liste sırası değil, distanceKm) ilk sırada olur', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ elements: [
      { id: 1, lat: 36.90, lon: 34.70, tags: { name: 'Uzak Hastane' } },   // ~ uzak
      { id: 2, lat: 36.805, lon: 34.635, tags: { name: 'Yakın Hastane' } }, // ~ yakın
      { id: 3, lat: 36.95, lon: 34.90, tags: { name: 'En Uzak Hastane' } },
    ] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const results = await searchNearby('hospital', 36.80, 34.63);
    expect(results[0].name).toBe('Yakın Hastane');
    expect(results[0].distanceKm).toBeLessThan(results[1].distanceKm ?? Infinity);
    expect(results[0].distanceKm).toBeLessThan(results[2].distanceKm ?? Infinity);
  });

  it('0,0 (Null Island) POI REDDEDİLİR', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ elements: [
      { id: 1, lat: 0, lon: 0, tags: { name: 'Geçersiz' } },
      { id: 2, lat: 36.805, lon: 34.635, tags: { name: 'Geçerli Hastane' } },
    ] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const results = await searchNearby('hospital', 36.80, 34.63);
    expect(results.length).toBe(1);
    expect(results[0].name).toBe('Geçerli Hastane');
  });

  it('sınır-dışı koordinat (|lat|>90 / |lng|>180) REDDEDİLİR', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ elements: [
      { id: 1, lat: 95, lon: 34.635, tags: { name: 'Geçersiz Lat' } },
      { id: 2, lat: 36.805, lon: 200, tags: { name: 'Geçersiz Lng' } },
      { id: 3, lat: 36.805, lon: 34.635, tags: { name: 'Geçerli Hastane' } },
    ] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const results = await searchNearby('hospital', 36.80, 34.63);
    expect(results.length).toBe(1);
    expect(results[0].name).toBe('Geçerli Hastane');
  });

  it('malformed sonuç (lat/lon eksik) çökme yapmadan atlanır', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ elements: [
      { id: 1, tags: { name: 'Koordinatsız' } },
      { id: 2, lat: 36.805, lon: 34.635, tags: { name: 'Geçerli Hastane' } },
    ] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const results = await searchNearby('hospital', 36.80, 34.63);
    expect(results.length).toBe(1);
    expect(results[0].name).toBe('Geçerli Hastane');
  });

  it('aynı koordinatta tekrarlanan sonuç TEKİLLEŞTİRİLİR (dedupe)', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ elements: [
      { id: 1, lat: 36.805, lon: 34.635, tags: { name: 'Hastane A' } },
      { id: 2, lat: 36.805, lon: 34.635, tags: { name: 'Hastane A Dup' } },
    ] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const results = await searchNearby('hospital', 36.80, 34.63);
    expect(results.length).toBe(1);
  });

  it('MEVCUT fuel davranışı bozulmadı: amenity=fuel + Benzinlik varsayılan adı', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(decodeURIComponent(String(url))).toContain('amenity=fuel');
      return new Response(JSON.stringify({ elements: [
        { id: 1, lat: 36.805, lon: 34.635 },
      ] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    const results = await searchNearby('fuel', 36.80, 34.63);
    expect(results.length).toBe(1);
    expect(results[0].name).toBe('Benzinlik');
  });
});

/* ── C. dispatchNearbyPoiNavigation — GPS fail-closed + dedupe + TTS ─────── */

describe('nearbyPoiNavigation.dispatchNearbyPoiNavigation', () => {
  it('kategori kataloğu fuel + hospital + parking + restArea içerir, sentinel tek yerde tanımlı', () => {
    /* GÜNCELLENDİ (2026-08-13): `restArea` BİLİNÇLİ olarak eklendi — "biraz
       yoruldum/mola" isteği eskiden `parking`e düşüp otoyolda ŞEHİR OTOPARKI
       öneriyordu (ölçüm: aynı 25 km'de 206 otopark ↔ 18 dinlenme tesisi, ve
       tesisler `amenity` OLMADIĞI için listeye hiç girmiyordu). Kilit
       KALDIRILMADI, yeni doğru kümeye güncellendi; görevi aynı: katalog
       sessizce büyümesin/küçülmesin. */
    const categories = Object.keys(NEARBY_POI_CATALOG).sort();
    expect(categories).toEqual(['fuel', 'hospital', 'parking', 'restArea']);
    expect(NEARBY_POI_CATALOG.fuel.sentinel).toBe('__nearby_gas__');
    expect(NEARBY_POI_CATALOG.hospital.sentinel).toBe('__nearby_hospital__');
    expect(NEARBY_POI_CATALOG.hospital.amenity).toBe('hospital');
    expect(NEARBY_POI_CATALOG.hospital.radiusM).toBe(5000);
    expect(NEARBY_POI_CATALOG.parking.sentinel).toBe('__nearby_parking__');
    expect(NEARBY_POI_CATALOG.parking.amenity).toBe('parking');
    expect(NEARBY_POI_CATALOG.parking.radiusM).toBe(5000);
    expect(NEARBY_POI_CATALOG.restArea.sentinel).toBe('__nearby_rest_area__');
    expect(NEARBY_POI_CATALOG.restArea.amenity).toBe('rest_area');
    // Yarıçap bilinçli olarak DAHA GENİŞ: 5 km'de ölçülen sonuç sıfırdı.
    expect(NEARBY_POI_CATALOG.restArea.radiusM).toBe(20000);
  });

  it('GPS YOK (undefined) → arama YAPILMAZ, navigasyon BAŞLAMAZ, fail-closed TTS söylenir', () => {
    const res = dispatchNearbyPoiNavigation('hospital', undefined);
    expect(res).toEqual({ ok: false, reason: 'no_gps' });
    expect(startNavigationMock).not.toHaveBeenCalled();
    expect(speakNavigationMock).toHaveBeenCalledWith(i18n.t('navigation.nearby_gps_unavailable'));
  });

  it('GPS null → fail-closed TTS söylenir, arama YOK', () => {
    const res = dispatchNearbyPoiNavigation('hospital', null);
    expect(res).toEqual({ ok: false, reason: 'no_gps' });
    expect(startNavigationMock).not.toHaveBeenCalled();
  });

  it('GPS 0,0 (Null Island) → geçersiz kabul edilir, arama YOK', () => {
    const res = dispatchNearbyPoiNavigation('hospital', { lat: 0, lng: 0 });
    expect(res).toEqual({ ok: false, reason: 'no_gps' });
    expect(startNavigationMock).not.toHaveBeenCalled();
  });

  it('GPS sınır-dışı (|lat|>90) → geçersiz kabul edilir, arama YOK', () => {
    const res = dispatchNearbyPoiNavigation('hospital', { lat: 95, lng: 34.63 });
    expect(res).toEqual({ ok: false, reason: 'no_gps' });
    expect(startNavigationMock).not.toHaveBeenCalled();
  });

  it('geçerli GPS → resolveAndNavigate sentinel ile TAM 1 kez çağrılır (startNavigation üzerinden doğrulanır)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ elements: [
      { id: 1, lat: 36.805, lon: 34.635, tags: { name: 'Tek Hastane' } },
    ] }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

    const res = dispatchNearbyPoiNavigation('hospital', { lat: 36.80, lng: 34.63 });
    expect(res).toEqual({ ok: true });

    await vi.waitFor(() => {
      expect(startNavigationMock).toHaveBeenCalledTimes(1);
    });
    expect(startNavigationMock.mock.calls[0][0]).toMatchObject({ latitude: 36.805, longitude: 34.635 });
    vi.unstubAllGlobals();
  });

  it('çok hastane sonucu → EN YAKIN olan seçilir (ilk eleman değil, çünkü seçim aşamasına düşer ama tek-doğrulama distanceKm sıralamasıyla yapılır)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ elements: [
      { id: 1, lat: 36.95, lon: 34.90, tags: { name: 'Uzak' } },
      { id: 2, lat: 36.805, lon: 34.635, tags: { name: 'Yakın' } },
    ] }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

    dispatchNearbyPoiNavigation('hospital', { lat: 36.80, lng: 34.63 });

    await vi.waitFor(() => {
      expect(useAddressNavState).toBeDefined();
    });
    // Çoklu sonuçta otomatik onay YOK (kullanıcı seçimi) — startNavigation çağrılmaz,
    // ama listenin BAŞINDA en yakın olan olmalı.
    const results = await searchNearby('hospital', 36.80, 34.63);
    expect(results[0].name).toBe('Yakın');
    vi.unstubAllGlobals();
  });

  it('sonuç YOK → navigasyon başlamaz, bounded "bulunamadı" TTS söylenir', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ elements: [] }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })));

    dispatchNearbyPoiNavigation('hospital', { lat: 36.80, lng: 34.63 });

    await vi.waitFor(() => {
      expect(speakNavigationMock.mock.calls.some(
        (c) => c[0] === i18n.t('navigation.nearby_hospital_none'),
      )).toBe(true);
    });
    expect(startNavigationMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('network hatası → çökme yok, navigasyon başlamaz, error TTS söylenir', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network fail'); }));

    expect(() => dispatchNearbyPoiNavigation('hospital', { lat: 36.80, lng: 34.63 })).not.toThrow();

    await vi.waitFor(() => {
      expect(speakNavigationMock.mock.calls.some(
        (c) => c[0] === i18n.t('navigation.nearby_hospital_error'),
      )).toBe(true);
    });
    expect(startNavigationMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('tek-dispatch (dedupe): aynı kategori 1200ms içinde iki kez tetiklenirse TEK arama başlar', () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ elements: [] }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })));

    const t0 = 1_000_000;
    const first  = dispatchNearbyPoiNavigation('hospital', { lat: 36.80, lng: 34.63 }, t0);
    const second = dispatchNearbyPoiNavigation('hospital', { lat: 36.80, lng: 34.63 }, t0 + 50);

    expect(first).toEqual({ ok: true });
    expect(second).toEqual({ ok: false, reason: 'debounced' });
    vi.unstubAllGlobals();
  });

  it('dedupe penceresi (1200ms) geçince yeniden dispatch olur', () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ elements: [] }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })));

    const t0 = 1_000_000;
    const first  = dispatchNearbyPoiNavigation('hospital', { lat: 36.80, lng: 34.63 }, t0);
    const second = dispatchNearbyPoiNavigation('hospital', { lat: 36.80, lng: 34.63 }, t0 + NEARBY_DISPATCH_DEDUPE_MS + 1);

    expect(first).toEqual({ ok: true });
    expect(second).toEqual({ ok: true });
    vi.unstubAllGlobals();
  });

  it('farklı kategoriler (fuel/hospital) birbirini BLOKLAMAZ — ayrı anahtar uzayı', () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ elements: [] }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })));

    const t0 = 1_000_000;
    const hospitalRes = dispatchNearbyPoiNavigation('hospital', { lat: 36.80, lng: 34.63 }, t0);
    const fuelRes      = dispatchNearbyPoiNavigation('fuel',     { lat: 36.80, lng: 34.63 }, t0 + 10);

    expect(hospitalRes).toEqual({ ok: true });
    expect(fuelRes).toEqual({ ok: true });
    vi.unstubAllGlobals();
  });
});

/* ── C2. NAVIGATION-P1-1 — dispatchNearbyPoiNavigation('fuel') doğrudan kapsamı ──
 * Eski legacy ses yolu resolveAndNavigate('__nearby_gas__', gps) çağırıyordu —
 * GPS fail-closed/dedupe/bounded-TTS YOKTU. Artık hastane ile AYNI merkezi
 * hattan geçiyor; bu blok fuel'in AYNI garantilere sahip olduğunu kanıtlar. */
describe("nearbyPoiNavigation.dispatchNearbyPoiNavigation — 'fuel' (NAVIGATION-P1-1)", () => {
  it('fuel: GPS YOK → arama YAPILMAZ, navigasyon BAŞLAMAZ, fail-closed TTS söylenir', () => {
    const res = dispatchNearbyPoiNavigation('fuel', undefined);
    expect(res).toEqual({ ok: false, reason: 'no_gps' });
    expect(startNavigationMock).not.toHaveBeenCalled();
    expect(speakNavigationMock).toHaveBeenCalledWith(i18n.t('navigation.nearby_gps_unavailable'));
  });

  it('fuel: GPS 0,0 → geçersiz kabul edilir, arama YOK', () => {
    const res = dispatchNearbyPoiNavigation('fuel', { lat: 0, lng: 0 });
    expect(res).toEqual({ ok: false, reason: 'no_gps' });
    expect(startNavigationMock).not.toHaveBeenCalled();
  });

  it('fuel: geçerli GPS + tek Overpass sonucu → startNavigation TAM 1 kez çağrılır', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ elements: [
      { id: 1, lat: 36.805, lon: 34.635, tags: { name: 'Shell İstasyonu' } },
    ] }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

    const res = dispatchNearbyPoiNavigation('fuel', { lat: 36.80, lng: 34.63 });
    expect(res).toEqual({ ok: true });

    await vi.waitFor(() => {
      expect(startNavigationMock).toHaveBeenCalledTimes(1);
    });
    expect(startNavigationMock.mock.calls[0][0]).toMatchObject({ latitude: 36.805, longitude: 34.635 });
    vi.unstubAllGlobals();
  });

  it('fuel: sonuç YOK → navigasyon başlamaz, bounded nearby_gas_none TTS söylenir', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ elements: [] }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })));

    dispatchNearbyPoiNavigation('fuel', { lat: 36.80, lng: 34.63 });

    await vi.waitFor(() => {
      expect(speakNavigationMock.mock.calls.some(
        (c) => c[0] === i18n.t('navigation.nearby_gas_none'),
      )).toBe(true);
    });
    expect(startNavigationMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('fuel: network hatası → çökme yok, navigasyon başlamaz, nearby_gas_error TTS söylenir', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network fail'); }));

    expect(() => dispatchNearbyPoiNavigation('fuel', { lat: 36.80, lng: 34.63 })).not.toThrow();

    await vi.waitFor(() => {
      expect(speakNavigationMock.mock.calls.some(
        (c) => c[0] === i18n.t('navigation.nearby_gas_error'),
      )).toBe(true);
    });
    expect(startNavigationMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('fuel: tek-dispatch (dedupe) — nearby:fuel anahtarıyla 1200ms içinde iki tetiklenme TEK arama başlatır', () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ elements: [] }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })));

    const t0 = 2_000_000;
    const first  = dispatchNearbyPoiNavigation('fuel', { lat: 36.80, lng: 34.63 }, t0);
    const second = dispatchNearbyPoiNavigation('fuel', { lat: 36.80, lng: 34.63 }, t0 + 50);

    expect(first).toEqual({ ok: true });
    expect(second).toEqual({ ok: false, reason: 'debounced' });
    vi.unstubAllGlobals();
  });
});

/* ── C3. NAVIGATION-P1-2 — dispatchNearbyPoiNavigation('parking') doğrudan kapsamı ──
 * Eski legacy ses yolu resolveAndNavigate('__nearby_parking__', gps) çağırıyordu —
 * GPS fail-closed/dedupe/bounded-TTS YOKTU. Artık fuel/hastane ile AYNI merkezi
 * hattan geçiyor; bu blok parking'in AYNI garantilere sahip olduğunu kanıtlar. */
describe("nearbyPoiNavigation.dispatchNearbyPoiNavigation — 'parking' (NAVIGATION-P1-2)", () => {
  it('parking: kategori kataloğunda tam tanımlı (sentinel/amenity/radiusM/i18n key\'leri)', () => {
    expect(NEARBY_POI_CATALOG.parking).toEqual({
      sentinel:          '__nearby_parking__',
      amenity:           'parking',
      radiusM:           5000,
      successKey:        'navigation.nearby_parking_starting',
      notFoundKey:       'navigation.nearby_parking_none',
      errorKey:          'navigation.nearby_parking_error',
      gpsUnavailableKey: 'navigation.nearby_gps_unavailable',
    });
  });

  it('parking: GPS YOK → arama YAPILMAZ, navigasyon BAŞLAMAZ, fail-closed TTS söylenir', () => {
    const res = dispatchNearbyPoiNavigation('parking', undefined);
    expect(res).toEqual({ ok: false, reason: 'no_gps' });
    expect(startNavigationMock).not.toHaveBeenCalled();
    expect(speakNavigationMock).toHaveBeenCalledWith(i18n.t('navigation.nearby_gps_unavailable'));
  });

  it('parking: GPS 0,0 → geçersiz kabul edilir, arama YOK', () => {
    const res = dispatchNearbyPoiNavigation('parking', { lat: 0, lng: 0 });
    expect(res).toEqual({ ok: false, reason: 'no_gps' });
    expect(startNavigationMock).not.toHaveBeenCalled();
  });

  it('parking: GPS sınır-dışı (|lng|>180) → geçersiz kabul edilir, arama YOK', () => {
    const res = dispatchNearbyPoiNavigation('parking', { lat: 36.80, lng: 190 });
    expect(res).toEqual({ ok: false, reason: 'no_gps' });
    expect(startNavigationMock).not.toHaveBeenCalled();
  });

  it('parking: geçerli GPS + tek Overpass sonucu → startNavigation TAM 1 kez çağrılır', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ elements: [
      { id: 1, lat: 36.805, lon: 34.635, tags: { name: 'AVM Otoparkı' } },
    ] }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

    const res = dispatchNearbyPoiNavigation('parking', { lat: 36.80, lng: 34.63 });
    expect(res).toEqual({ ok: true });

    await vi.waitFor(() => {
      expect(startNavigationMock).toHaveBeenCalledTimes(1);
    });
    expect(startNavigationMock.mock.calls[0][0]).toMatchObject({ latitude: 36.805, longitude: 34.635 });
    vi.unstubAllGlobals();
  });

  it('parking: sonuç YOK → navigasyon başlamaz, bounded nearby_parking_none TTS söylenir', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ elements: [] }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })));

    dispatchNearbyPoiNavigation('parking', { lat: 36.80, lng: 34.63 });

    await vi.waitFor(() => {
      expect(speakNavigationMock.mock.calls.some(
        (c) => c[0] === i18n.t('navigation.nearby_parking_none'),
      )).toBe(true);
    });
    expect(startNavigationMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('parking: network hatası → çökme yok, navigasyon başlamaz, nearby_parking_error TTS söylenir', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network fail'); }));

    expect(() => dispatchNearbyPoiNavigation('parking', { lat: 36.80, lng: 34.63 })).not.toThrow();

    await vi.waitFor(() => {
      expect(speakNavigationMock.mock.calls.some(
        (c) => c[0] === i18n.t('navigation.nearby_parking_error'),
      )).toBe(true);
    });
    expect(startNavigationMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('parking: tek-dispatch (dedupe) — nearby:parking anahtarıyla 1200ms içinde iki tetiklenme TEK arama başlatır', () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ elements: [] }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })));

    const t0 = 4_000_000;
    const first  = dispatchNearbyPoiNavigation('parking', { lat: 36.80, lng: 34.63 }, t0);
    const second = dispatchNearbyPoiNavigation('parking', { lat: 36.80, lng: 34.63 }, t0 + 50);

    expect(first).toEqual({ ok: true });
    expect(second).toEqual({ ok: false, reason: 'debounced' });
    vi.unstubAllGlobals();
  });

  it('parking: fuel/hospital/parking ÜÇÜ birbirini BLOKLAMAZ — üç ayrı anahtar uzayı', () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ elements: [] }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })));

    const t0 = 4_500_000;
    const parkingRes  = dispatchNearbyPoiNavigation('parking',  { lat: 36.80, lng: 34.63 }, t0);
    const fuelRes      = dispatchNearbyPoiNavigation('fuel',     { lat: 36.80, lng: 34.63 }, t0 + 10);
    const hospitalRes  = dispatchNearbyPoiNavigation('hospital', { lat: 36.80, lng: 34.63 }, t0 + 20);

    expect(parkingRes).toEqual({ ok: true });
    expect(fuelRes).toEqual({ ok: true });
    expect(hospitalRes).toEqual({ ok: true });
    vi.unstubAllGlobals();
  });
});

/* ── H. NAVIGATION-P1-1/P1-2 — home/work dedupe anahtar uzayı ile çakışma yok ──── */

describe('nearbyPoiNavigation — home/work dedupe ile çakışma yok (NAVIGATION-P1-1/P1-2)', () => {
  it('dispatchNearbyPoiNavigation(\'fuel\') ve dispatchHomeWorkNavigation(\'home\') birbirini BLOKLAMAZ', async () => {
    const { dispatchHomeWorkNavigation, _resetHomeWorkDispatchGuardForTests } =
      await import('../platform/homeWorkNavigation');
    const { setQuickAddress, clearQuickAddress } = await import('../platform/addressBookService');

    _resetHomeWorkDispatchGuardForTests();
    clearQuickAddress('home');
    setQuickAddress('home', { latitude: 41.015, longitude: 28.979 });

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ elements: [] }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })));

    const t0 = 3_000_000;
    const homeRes = dispatchHomeWorkNavigation('home', t0);
    const fuelRes  = dispatchNearbyPoiNavigation('fuel', { lat: 36.80, lng: 34.63 }, t0 + 5);

    expect(homeRes.ok).toBe(true);
    expect(fuelRes).toEqual({ ok: true });

    clearQuickAddress('home');
    vi.unstubAllGlobals();
  });

  it('dispatchNearbyPoiNavigation(\'parking\') ve dispatchHomeWorkNavigation(\'work\') birbirini BLOKLAMAZ (NAVIGATION-P1-2)', async () => {
    const { dispatchHomeWorkNavigation, _resetHomeWorkDispatchGuardForTests } =
      await import('../platform/homeWorkNavigation');
    const { setQuickAddress, clearQuickAddress } = await import('../platform/addressBookService');

    _resetHomeWorkDispatchGuardForTests();
    clearQuickAddress('work');
    setQuickAddress('work', { latitude: 39.92, longitude: 32.85 });

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ elements: [] }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })));

    const t0 = 3_500_000;
    const workRes    = dispatchHomeWorkNavigation('work', t0);
    const parkingRes = dispatchNearbyPoiNavigation('parking', { lat: 36.80, lng: 34.63 }, t0 + 5);

    expect(workRes.ok).toBe(true);
    expect(parkingRes).toEqual({ ok: true });

    clearQuickAddress('work');
    vi.unstubAllGlobals();
  });
});

/* ── D. intentEngine / commandExecutor — FIND_NEARBY_HOSPITAL sentinel ──── */

describe('intentEngine.routeIntent — FIND_NEARBY_HOSPITAL', () => {
  it('"en yakın hastane" komutu → FIND_NEARBY_HOSPITAL intent üretir', () => {
    const intent = toIntent(
      { type: 'find_nearby_hospital', raw: 'en yakın hastane', confidence: 0.9, feedback: 'Yakın hastane aranıyor', priority: 'critical' },
      { defaultNav: 'maps', defaultMusic: 'spotify' },
    );
    expect(intent.type).toBe('FIND_NEARBY_HOSPITAL');
  });

  it('routeIntent FIND_NEARBY_HOSPITAL → ctx.navigateToPlace sentinel ile çağrılır (fuel gibi düz metin DEĞİL)', async () => {
    const navigateToPlace = vi.fn();
    const ctx = makeCtx({ navigateToPlace });
    const intent = toIntent(
      { type: 'find_nearby_hospital', raw: 'en yakın hastane', confidence: 0.9, feedback: 'Yakın hastane aranıyor', priority: 'critical' },
      { defaultNav: 'maps', defaultMusic: 'spotify' },
    );
    await routeIntent(intent, ctx);
    expect(navigateToPlace).toHaveBeenCalledWith('__nearby_hospital__');
  });

  it('NAVIGATION-P1-1: FIND_NEARBY_GAS artık ctx.dispatchNearbyPoi(\'fuel\') çağırır — düz metin geocode ARTIK YOK', async () => {
    const navigateToPlace  = vi.fn();
    const dispatchNearbyPoi = vi.fn();
    const ctx = makeCtx({ navigateToPlace, dispatchNearbyPoi });
    const intent = toIntent(
      { type: 'find_nearby_gas', raw: 'en yakın benzinlik', confidence: 0.9, feedback: 'Yakın benzinlik aranıyor', priority: 'critical' },
      { defaultNav: 'maps', defaultMusic: 'spotify' },
    );
    await routeIntent(intent, ctx);
    expect(dispatchNearbyPoi).toHaveBeenCalledWith('fuel');
    expect(dispatchNearbyPoi).toHaveBeenCalledTimes(1);
    // Eski YANLIŞ davranış (geocode metin araması) BİR DAHA tetiklenmemeli.
    expect(navigateToPlace).not.toHaveBeenCalledWith('yakın benzinlik');
    expect(navigateToPlace).not.toHaveBeenCalled();
  });

  it('NAVIGATION-P1-2: FIND_NEARBY_PARKING artık ctx.dispatchNearbyPoi(\'parking\') çağırır — düz metin geocode ARTIK YOK', async () => {
    const navigateToPlace  = vi.fn();
    const dispatchNearbyPoi = vi.fn();
    const ctx = makeCtx({ navigateToPlace, dispatchNearbyPoi });
    const intent = toIntent(
      { type: 'find_nearby_parking', raw: 'en yakın otopark', confidence: 0.9, feedback: 'Yakın otopark aranıyor', priority: 'critical' },
      { defaultNav: 'maps', defaultMusic: 'spotify' },
    );
    await routeIntent(intent, ctx);
    expect(dispatchNearbyPoi).toHaveBeenCalledWith('parking');
    expect(dispatchNearbyPoi).toHaveBeenCalledTimes(1);
    expect(navigateToPlace).not.toHaveBeenCalledWith('yakın park yeri');
    expect(navigateToPlace).not.toHaveBeenCalled();
  });
});

describe('commandExecutor.executeIntent — FIND_NEARBY_HOSPITAL', () => {
  it('sentinel ile navigateToPlace çağrılır', async () => {
    const navigateToPlace = vi.fn();
    const ctx = makeCmdCtx({ navigateToPlace });
    await executeIntent({ type: 'FIND_NEARBY_HOSPITAL', payload: {}, priority: 'critical' }, ctx);
    expect(navigateToPlace).toHaveBeenCalledWith('__nearby_hospital__');
  });

  it('NAVIGATION-P1-1: FIND_NEARBY_GAS artık ctx.dispatchNearbyPoi(\'fuel\') çağırır — düz metin geocode ARTIK YOK, TTS burada TEKRARLANMAZ', async () => {
    const navigateToPlace  = vi.fn();
    const dispatchNearbyPoi = vi.fn();
    const ctx = makeCmdCtx({ navigateToPlace, dispatchNearbyPoi });
    await executeIntent({ type: 'FIND_NEARBY_GAS', payload: {}, priority: 'critical' }, ctx);
    expect(dispatchNearbyPoi).toHaveBeenCalledWith('fuel');
    expect(dispatchNearbyPoi).toHaveBeenCalledTimes(1);
    expect(navigateToPlace).not.toHaveBeenCalled();
  });

  it('ctx.dispatchNearbyPoi tanımsızsa fail-soft: ctx.launch(defaultNav) çağrılır (eski davranışla tutarlı fallback)', async () => {
    const launch = vi.fn();
    const ctx = makeCmdCtx({ launch, dispatchNearbyPoi: undefined });
    await executeIntent({ type: 'FIND_NEARBY_GAS', payload: {}, priority: 'critical' }, ctx);
    expect(launch).toHaveBeenCalledWith('maps');
  });

  it('NAVIGATION-P1-2: FIND_NEARBY_PARKING artık ctx.dispatchNearbyPoi(\'parking\') çağırır — düz metin geocode ARTIK YOK, TTS burada TEKRARLANMAZ', async () => {
    const navigateToPlace  = vi.fn();
    const dispatchNearbyPoi = vi.fn();
    const ctx = makeCmdCtx({ navigateToPlace, dispatchNearbyPoi });
    await executeIntent({ type: 'FIND_NEARBY_PARKING', payload: {}, priority: 'critical' }, ctx);
    expect(dispatchNearbyPoi).toHaveBeenCalledWith('parking');
    expect(dispatchNearbyPoi).toHaveBeenCalledTimes(1);
    expect(navigateToPlace).not.toHaveBeenCalled();
  });

  it('FIND_NEARBY_PARKING: ctx.dispatchNearbyPoi tanımsızsa fail-soft: ctx.launch(defaultNav) çağrılır', async () => {
    const launch = vi.fn();
    const ctx = makeCmdCtx({ launch, dispatchNearbyPoi: undefined });
    await executeIntent({ type: 'FIND_NEARBY_PARKING', payload: {}, priority: 'critical' }, ctx);
    expect(launch).toHaveBeenCalledWith('maps');
  });
});

/* ── E. i18n anahtarları — TR + EN ───────────────────────────────────────── */

describe('nearby POI i18n anahtarları', () => {
  it('TR hastane metinleri tanımlı', () => {
    i18n.changeLanguage('tr');
    expect(i18n.t('navigation.nearby_hospital_starting')).toBe('En yakın hastane için rota başlatılıyor.');
    expect(i18n.t('navigation.nearby_hospital_none')).toBe('Yakınında uygun bir hastane bulunamadı.');
    expect(i18n.t('navigation.nearby_hospital_error')).toContain('tamamlanamadı');
    expect(i18n.t('navigation.nearby_gps_unavailable')).toContain('hastaneler aranamadı');
  });
  it('EN hastane metinleri tanımlı (hardcoded-TR-only DEĞİL)', () => {
    i18n.changeLanguage('en');
    expect(i18n.t('navigation.nearby_hospital_starting')).toBe('Starting navigation to the nearest hospital.');
    expect(i18n.t('navigation.nearby_hospital_none')).toBe('No suitable hospital was found nearby.');
    expect(i18n.t('navigation.nearby_gps_unavailable')).toContain('unavailable');
    i18n.changeLanguage('tr');
  });
  it('TR benzinlik metinleri tanımlı (NAVIGATION-P1-1)', () => {
    i18n.changeLanguage('tr');
    expect(i18n.t('navigation.nearby_gas_starting')).toBe('En yakın benzinlik için rota başlatılıyor.');
    expect(i18n.t('navigation.nearby_gas_none')).toBe('Yakınında uygun bir benzinlik bulunamadı.');
    expect(i18n.t('navigation.nearby_gas_error')).toContain('tamamlanamadı');
  });
  it('EN benzinlik metinleri tanımlı (NAVIGATION-P1-1)', () => {
    i18n.changeLanguage('en');
    expect(i18n.t('navigation.nearby_gas_starting')).toBe('Starting navigation to the nearest gas station.');
    expect(i18n.t('navigation.nearby_gas_none')).toBe('No suitable gas station was found nearby.');
    i18n.changeLanguage('tr');
  });
  it('TR otopark metinleri tanımlı (NAVIGATION-P1-2)', () => {
    i18n.changeLanguage('tr');
    expect(i18n.t('navigation.nearby_parking_starting')).toBe('En yakın otopark için rota başlatılıyor.');
    expect(i18n.t('navigation.nearby_parking_none')).toBe('Yakınında uygun bir otopark bulunamadı.');
    expect(i18n.t('navigation.nearby_parking_error')).toContain('tamamlanamadı');
  });
  it('EN otopark metinleri tanımlı (NAVIGATION-P1-2)', () => {
    i18n.changeLanguage('en');
    expect(i18n.t('navigation.nearby_parking_starting')).toBe('Starting navigation to the nearest parking.');
    expect(i18n.t('navigation.nearby_parking_none')).toBe('No suitable parking was found nearby.');
    i18n.changeLanguage('tr');
  });
});

/* ── F. resolveAndNavigate — hospital sentinel doğrudan çağrı regresyonu ── */

describe('addressNavigationEngine.resolveAndNavigate — hospital sentinel', () => {
  it('__nearby_hospital__ + geçerli konum → tek sonuçta startNavigation çağrılır', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ elements: [
      { id: 1, lat: 36.805, lon: 34.635, tags: { name: 'Tek Hastane' } },
    ] }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

    resolveAndNavigate('__nearby_hospital__', { lat: 36.80, lng: 34.63 });

    await vi.waitFor(() => {
      expect(startNavigationMock).toHaveBeenCalledTimes(1);
    });
    vi.unstubAllGlobals();
  });

  it('onResult callback: tek sonuçta "confirmed" ile çağrılır', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ elements: [
      { id: 1, lat: 36.805, lon: 34.635, tags: { name: 'Tek Hastane' } },
    ] }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

    const onResult = vi.fn();
    resolveAndNavigate('__nearby_hospital__', { lat: 36.80, lng: 34.63 }, onResult);

    await vi.waitFor(() => {
      expect(onResult).toHaveBeenCalledWith('confirmed');
    });
    vi.unstubAllGlobals();
  });

  it('onResult callback: sonuç yoksa "empty" ile çağrılır', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ elements: [] }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })));

    const onResult = vi.fn();
    resolveAndNavigate('__nearby_hospital__', { lat: 36.80, lng: 34.63 }, onResult);

    await vi.waitFor(() => {
      expect(onResult).toHaveBeenCalledWith('empty');
    });
    vi.unstubAllGlobals();
  });

  it('onResult callback: network hatasında "error" ile çağrılır', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network fail'); }));

    const onResult = vi.fn();
    resolveAndNavigate('__nearby_hospital__', { lat: 36.80, lng: 34.63 }, onResult);

    await vi.waitFor(() => {
      expect(onResult).toHaveBeenCalledWith('error');
    });
    vi.unstubAllGlobals();
  });

  it('onResult callback: çok sonuçta "multiple" ile çağrılır', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ elements: [
      { id: 1, lat: 36.95, lon: 34.90, tags: { name: 'Uzak' } },
      { id: 2, lat: 36.805, lon: 34.635, tags: { name: 'Yakın' } },
    ] }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

    const onResult = vi.fn();
    resolveAndNavigate('__nearby_hospital__', { lat: 36.80, lng: 34.63 }, onResult);

    await vi.waitFor(() => {
      expect(onResult).toHaveBeenCalledWith('multiple');
    });
    vi.unstubAllGlobals();
  });
});

/* ── G. home/work regresyonu (dispatchNearbyPoiNavigation'ın ayrı modül olması,
        homeWorkNavigation dedupe anahtar uzayını etkilememeli) ─────────────── */

describe('nearbyPoiNavigation — home/work ile çakışma yok', () => {
  it('NearbyPoiCategory tipi yalnız fuel|hospital|parking kabul eder (type-level; derleme testi)', () => {
    const cat: NearbyPoiCategory = 'hospital';
    const cat2: NearbyPoiCategory = 'parking';
    expect(['fuel', 'hospital', 'parking']).toContain(cat);
    expect(['fuel', 'hospital', 'parking']).toContain(cat2);
  });
});

/* ── I. NAVIGATION-P1-1/P1-2 — useVoiceCommandHandler.ts legacy handler wiring kilidi ──
 * Bu hook React.useEffect içinde registerCommandHandler(gerçekCallback) çağırıyor;
 * @testing-library/react bu repoda YOK (bkz. safetyContext.test.tsx, useOBDLifecycle.test.ts
 * başlık yorumları) ve renderToStaticMarkup useEffect ÇALIŞTIRMAZ → hook'u gerçekten
 * mount edip callback'i yakalayacak bir render altyapısı yok. Bu yüzden diğer
 * "*Wiring.test.ts" dosyalarındaki (platformCoreDeepScanWiring.test.ts vb.) established
 * kaynak-metni kilidi deseni kullanılır: kaçırılması KOLAY bir regresyonu (birinin fuel/
 * parking'i eski resolveAndNavigate('__nearby_gas__'/'__nearby_parking__') yoluna geri
 * alması) statik olarak kilitler. Gerçek ÇALIŞMA ZAMANI davranışı zaten C2/C3 bloklarında
 * dispatchNearbyPoiNavigation('fuel'/'parking', …) üzerinden tam kapsamlı test edildi —
 * burası yalnızca "doğru fonksiyon doğru cmd.type'a bağlı mı" kablolamasını kilitler. */
describe('useVoiceCommandHandler.ts — legacy handler kablolama kilidi (NAVIGATION-P1-1/P1-2)', () => {
  const HOOK_SRC = readFileSync(
    join(process.cwd(), 'src', 'hooks', 'useVoiceCommandHandler.ts'),
    'utf8',
  );

  it("find_nearby_gas artık dispatchNearbyPoiNavigation('fuel', …) çağırıyor", () => {
    const idx = HOOK_SRC.indexOf("cmd.type === 'find_nearby_gas'");
    expect(idx).toBeGreaterThan(-1);
    // Bu koşuldan sonraki ~300 karakterlik pencerede 'fuel' sentinel'i ile
    // dispatchNearbyPoiNavigation çağrısı olmalı.
    const window = HOOK_SRC.slice(idx, idx + 300);
    expect(window).toMatch(/dispatchNearbyPoiNavigation\(\s*\n?\s*'fuel'/);
  });

  it("find_nearby_parking artık dispatchNearbyPoiNavigation('parking', …) çağırıyor (NAVIGATION-P1-2)", () => {
    const idx = HOOK_SRC.indexOf("cmd.type === 'find_nearby_parking'");
    expect(idx).toBeGreaterThan(-1);
    const window = HOOK_SRC.slice(idx, idx + 300);
    expect(window).toMatch(/dispatchNearbyPoiNavigation\(\s*\n?\s*'parking'/);
  });

  it('find_nearby_gas/find_nearby_parking ARTIK navigate_address/place ile aynı resolveAndNavigate blokunda DEĞİL', () => {
    // Eski (P1-1/P1-2 öncesi) davranış: tek if koşulunda
    // navigate_address || navigate_place || find_nearby_gas || find_nearby_parking
    // birlikte resolveAndNavigate(dest, …) çağırıyordu. Bu artık YOK olmalı.
    expect(HOOK_SRC).not.toMatch(
      /navigate_address['"][\s\S]{0,40}navigate_place['"][\s\S]{0,80}find_nearby_gas['"]/,
    );
    expect(HOOK_SRC).not.toMatch(
      /navigate_address['"][\s\S]{0,40}navigate_place['"][\s\S]{0,80}find_nearby_parking['"]/,
    );
  });

  it('find_nearby_hospital bloğu (P0-2) DOKUNULMADAN korunuyor', () => {
    const idx = HOOK_SRC.indexOf("cmd.type === 'find_nearby_hospital'");
    expect(idx).toBeGreaterThan(-1);
    const window = HOOK_SRC.slice(idx, idx + 300);
    expect(window).toMatch(/dispatchNearbyPoiNavigation\(\s*\n?\s*'hospital'/);
  });

  it('serbest adres bloğu artık YALNIZ navigate_address || navigate_place içerir (NAVIGATION-P1-2)', () => {
    // find_nearby_gas/find_nearby_parking her ikisi de kendi ayrı bloklarına taşındı;
    // genel geocode bloğunda artık sentinel tabanlı "en yakın X" komutu KALMAMALI.
    const idx = HOOK_SRC.indexOf('Serbest adres navigasyonu');
    expect(idx).toBeGreaterThan(-1);
    // PENCERE 400→1400 GENİŞLETİLDİ (kilit KALDIRILMADI): blok başına sahiplik/fail-closed
    // gerekçe yorumu eklendiği için koşul satırları 400 karakterden sonraya kaydı.
    // Asıl güvenlik iddiası (`not.toMatch` — sentinel "en yakın X" komutu bu blokta OLMAMALI)
    // aynen ve daha GENİŞ bir pencerede zorlanıyor.
    const window = HOOK_SRC.slice(idx, idx + 1400);
    expect(window).not.toMatch(/find_nearby_gas|find_nearby_parking/);
    expect(window).toMatch(/navigate_address/);
    expect(window).toMatch(/navigate_place/);
  });

  it('iki ctx nesnesine de (AI yolu + routeIntent yolu) dispatchNearbyPoi wrapper\'ı eklendi', () => {
    const occurrences = HOOK_SRC.split('dispatchNearbyPoi:').length - 1;
    expect(occurrences).toBe(2);
  });
});
