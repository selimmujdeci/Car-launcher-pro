/**
 * searchGeocodingV2.test.ts — P0-NAV-06 ARAMA / GEOCODING V2 KİLİTLERİ.
 *
 * Bu dosya, canlı ölçümle (2026-08-23, Tarsus 36.9175/34.8621) tespit edilen
 * kusurların GERİ GELMESİNİ engeller. Kullanıcının verdiği sekiz senaryonun
 * her biri ayrı bir kilittir:
 *   "pastane" · "eczane" · gerçek işletme adı · mahalle · sokak ·
 *   yanlış yazılmış Türkçe · "en yakın benzinlik" · aynı isimli iki yer.
 *
 * ÖLÇÜLEN TEMEL (ürünün kurduğu isteğin AYNISIYLA, düzeltmeden ÖNCE):
 *   "pastane"    → en yakın aday 372 km (2,17 km'deki Florya Pastanesi YOK)
 *   "eczane"     → en yakın aday 231 km; listede Musul/Irak 743 km
 *   "Şok Market" → listede Köln/Almanya 2706 km
 *   "en yakın benzinlik" → 0 sonuç
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

import {
  normalizePlaceQuery, detectPlaceIntent, rankPlaces, dedupePlaces,
  textMatchScore, findPlaceCategory, PLACE_CATEGORIES, RELEVANCE_FLOOR,
  type RankablePlace,
} from '../platform/geo/placeQueryModel';
import {
  buildCategoryQl, searchCategoryNearby, _resetOverpassCategoryStateForTest,
  readOverpassCategoryStatus, OVERPASS_COOLDOWN_MS, RADIUS_ESCALATION,
} from '../platform/geo/overpassCategorySearch';
import { _hasStreetMatch } from '../platform/mapService';
import { extractStreetQuery } from '../platform/streetSearchService';
import type { StoredLocation } from '../platform/offlineSearchService';

/* Kullanıcı konumu — tüm saha ölçümleriyle AYNI nokta (Tarsus). */
const ME = { lat: 36.9175, lng: 34.8621 };

/** Kısa aday kurucu. */
function place(
  name: string, lat: number, lng: number,
  extra: Partial<RankablePlace> = {},
): RankablePlace {
  return {
    id: `${name}-${lat}-${lng}`,
    name,
    lat, lng,
    layer: 'NOMINATIM',
    ...extra,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   A) TÜRKÇE NORMALİZASYON — "sadece exact match" YASAĞI
   ══════════════════════════════════════════════════════════════════════════ */

describe('placeQueryModel › Türkçe normalizasyon', () => {
  it('🔒 ı/İ/I ailesinin TAMAMI aynı anahtara katlanır', () => {
    const forms = ['İstanbul', 'istanbul', 'ISTANBUL', 'Istanbul', 'ıstanbul'];
    const keys = forms.map(normalizePlaceQuery);
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toBe('istanbul');
  });

  it('🔒 ş/ğ/ü/ö/ç varyasyonları ASCII yazımla eşleşir', () => {
    expect(normalizePlaceQuery('Şifa Eczanesi')).toBe(normalizePlaceQuery('sifa eczanesi'));
    expect(normalizePlaceQuery('Çağdaş Göztepe')).toBe(normalizePlaceQuery('cagdas goztepe'));
    expect(normalizePlaceQuery('Üsküdar')).toBe('uskudar');
  });

  it('🔒 "mahallesi / mah. / mh" AYNI anahtara iner', () => {
    const a = normalizePlaceQuery('Bağlar Mahallesi');
    expect(normalizePlaceQuery('Bağlar mah.')).toBe(a);
    expect(normalizePlaceQuery('Bağlar mh')).toBe(a);
    expect(normalizePlaceQuery('BAĞLAR MAHALLESİ')).toBe(a);
  });

  it('🔒 cadde/sokak/bulvar ekleri de sadeleşir', () => {
    expect(normalizePlaceQuery('Atatürk Caddesi')).toBe(normalizePlaceQuery('Atatürk cad.'));
    expect(normalizePlaceQuery('Gül Sokağı')).toBe(normalizePlaceQuery('Gül sk'));
    expect(normalizePlaceQuery('Fatih Bulvarı')).toBe(normalizePlaceQuery('Fatih blv'));
  });

  it('🔒 eşleşme SADECE tam eşitlik değildir (önek · içerme · trigram)', () => {
    expect(textMatchScore('sifa eczanesi', 'sifa eczanesi')).toBe(1);
    expect(textMatchScore('sifa', 'sifa eczanesi ismet pasa bulvar')).toBeGreaterThan(0.8);
    expect(textMatchScore('eczanesi sifa', 'sifa eczanesi tarsus')).toBeGreaterThan(0.7);
    // Alakasız metin düşük puan alır — "fuzzy" her şeyi eşleştirmek DEĞİLDİR.
    expect(textMatchScore('sifa eczanesi', 'anadolu otoyolu dinlenme')).toBeLessThan(0.2);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   B) KATEGORİ NİYETİ — "pastane" · "eczane" · "en yakın benzinlik"
   ══════════════════════════════════════════════════════════════════════════ */

describe('placeQueryModel › kategori niyeti', () => {
  it('🔒 "pastane" bir KATEGORİDİR (ad değil)', () => {
    const i = detectPlaceIntent('pastane');
    expect(i.category?.id).toBe('pastane');
    expect(i.category?.tags.join()).toContain('pastry');
    expect(i.wantsNearest).toBe(false);
  });

  it('🔒 "eczane" kategorisi eczane etiketine bağlanır', () => {
    expect(detectPlaceIntent('eczane').category?.id).toBe('eczane');
    expect(detectPlaceIntent('ECZANE').category?.id).toBe('eczane');
    expect(detectPlaceIntent('nöbetçi eczane').category?.id).toBe('eczane');
    expect(findPlaceCategory('eczane')?.tags).toEqual(['"amenity"="pharmacy"']);
  });

  it('🔒 "en yakın benzinlik" → kategori + yakınlık bayrağı (0 sonuç DEĞİL)', () => {
    const i = detectPlaceIntent('en yakın benzinlik');
    expect(i.category?.id).toBe('benzinlik');
    expect(i.wantsNearest).toBe(true);
    expect(i.residual).toBe('');
  });

  it('🔒 "en yakın X" ailesinin tamamı tanınır', () => {
    for (const q of [
      'yakınımdaki eczane', 'civardaki benzinlik', 'en yakındaki market',
      'yakınlardaki otopark',
    ]) {
      expect(detectPlaceIntent(q).wantsNearest, q).toBe(true);
      expect(detectPlaceIntent(q).category, q).not.toBeNull();
    }
  });

  it('🔒 kategori + ayırt edici ad birlikte okunur ("florya pastanesi")', () => {
    const i = detectPlaceIntent('florya pastanesi');
    expect(i.category?.id).toBe('pastane');
    expect(i.residual).toBe('florya');
  });

  it('🔒 "Şok Market" kategoriye + marka adına ayrışır', () => {
    const i = detectPlaceIntent('Şok Market');
    expect(i.category?.id).toBe('market');
    expect(i.residual).toBe('sok');
  });

  it('🔒 mahalle/cadde sorgusu KATEGORİ SANILMAZ', () => {
    const i = detectPlaceIntent('Bağlar Mahallesi');
    expect(i.category).toBeNull();
    expect(i.hasAddressStructure).toBe(true);
    expect(i.looksLikeName).toBe(false);
  });

  it('🔒 uzun alias kısa alias\'ı EZER (spesifik kazanır)', () => {
    // "şarj istasyonu" → sarj; yalın "istasyon" benzinliğe düşer.
    expect(detectPlaceIntent('şarj istasyonu').category?.id).toBe('sarj');
    expect(detectPlaceIntent('istasyon').category?.id).toBe('benzinlik');
  });

  it('🔒 her kategori tanımı SABİT etiket taşır (kullanıcı metni GİRMEZ)', () => {
    for (const c of PLACE_CATEGORIES) {
      expect(c.tags.length, c.id).toBeGreaterThan(0);
      expect(c.radiusM, c.id).toBeGreaterThan(0);
      expect(c.aliases.length, c.id).toBeGreaterThan(0);
      // Alias'lar KATLANMIŞ olmalı — aksi hâlde asla eşleşmez (sessiz sıfır).
      for (const a of c.aliases) expect(normalizePlaceQuery(a), `${c.id}/${a}`).toBe(a);
    }
  });

  it('🔒 kategori kimlikleri TEKİLDİR', () => {
    const ids = PLACE_CATEGORIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   C) SIRALAMA — "alakasız sonucu üste taşıma"
   ══════════════════════════════════════════════════════════════════════════ */

describe('placeQueryModel › sıralama', () => {
  it('🔒 "pastane": 2 km\'deki Florya Pastanesi, 372 km\'deki "Pastane"yi GEÇER', () => {
    /* ÖLÇÜLEN KUSUR: ürün tam tersini yapıyordu — adı birebir "Pastane" olan
       372 km'deki kayıt listenin başındaydı. */
    const intent = detectPlaceIntent('pastane');
    const out = rankPlaces(intent, [
      place('Pastane', 39.90, 32.85),                                        // Ankara ~379 km
      place('Florya Pastanesi', 36.9350, 34.8800, { categoryId: 'pastane', layer: 'OVERPASS_CATEGORY' }),
      place('Flamingo Pastanesi', 36.9360, 34.8810, { categoryId: 'pastane', layer: 'OVERPASS_CATEGORY' }),
    ], { origin: ME, limit: 5 });

    expect(out[0].item.name).toBe('Florya Pastanesi');
    expect(out[0].distanceKm).toBeLessThan(5);
    /* 379 km'deki "Pastane" mesafe TAVANINA takılır: "pastane" yerel bir
       sorudur ve sorguda il adı geçmiyor (bkz. CATEGORY_MAX_KM). */
    expect(out.some((r) => r.item.name === 'Pastane')).toBe(false);
    expect(out.length).toBe(2);
  });

  it('🔒 kategori mesafe tavanı ŞEHİR ADI VARSA uygulanmaz', () => {
    /* "Ankara pastane" yazan sürücü oraya gidiyordur — 379 km RET sebebi değil.
       (Şehir kapısı `locationBiasGate`tedir; burada tavan KAPALI olmalıdır.) */
    const out = rankPlaces(detectPlaceIntent('Ankara pastane'), [
      place('Pastane', 39.90, 32.85, { address: 'Mebusevleri Mahallesi, Çankaya, Ankara' }),
    ], { origin: ME, limit: 5 });
    expect(out.length).toBe(1);
    expect(out[0].distanceKm).toBeGreaterThan(300);
  });

  it('🔒 "eczane": Musul/Irak (743 km) listenin BAŞINA çıkamaz', () => {
    const intent = detectPlaceIntent('eczane');
    const out = rankPlaces(intent, [
      place('Eczane', 36.34, 43.13),                                          // Musul
      place('Eczane', 41.02, 29.10),                                          // İstanbul
      place('Eroğlu Eczanesi', 36.9280, 34.8700, { categoryId: 'eczane', layer: 'OVERPASS_CATEGORY' }),
    ], { origin: ME, limit: 5 });

    expect(out[0].item.name).toBe('Eroğlu Eczanesi');
    expect(out[0].distanceKm).toBeLessThan(3);
  });

  it('🔒 "Şok Market": Köln/Almanya (2706 km) alaka TABANININ altında kalır', () => {
    const intent = detectPlaceIntent('Şok Market');
    const koln = place('Şok Market', 51.02, 6.86);
    const yakin = place('Şok', 36.9240, 34.8680, { categoryId: 'market', layer: 'OVERPASS_CATEGORY' });

    const out = rankPlaces(intent, [koln, yakin], { origin: ME, limit: 5 });
    expect(out[0].item.name).toBe('Şok');
    // Taban ELEDİ — 2706 km'lik aday sunulmaz.
    expect(out.some((r) => r.item.lat > 50)).toBe(false);
  });

  it('🔒 alaka tabanı listeyi BOŞALTMAZ — taban üstü aday yoksa hepsi kalır', () => {
    const intent = detectPlaceIntent('bulunamayacak bir sey');
    const out = rankPlaces(intent, [place('Uzak Yer', 51.02, 6.86)], { origin: ME, limit: 5 });
    expect(out.length).toBe(1);              // "bulamadık" UYDURULMAZ
    expect(out[0].score).toBeLessThan(RELEVANCE_FLOOR);
  });

  it('🔒 AYNI İSİMLİ İKİ YER: yakın olan üste, uzak olan ELENMEZ', () => {
    const intent = detectPlaceIntent('Cumhuriyet Mahallesi');
    const out = rankPlaces(intent, [
      place('Cumhuriyet Mahallesi', 37.87, 32.49),    // Konya ~200 km
      place('Cumhuriyet Mahallesi', 36.9420, 34.8900),  // Tarsus ~3,5 km
      place('Cumhuriyet Mahallesi', 36.8000, 34.6330),  // Mersin ~27 km
    ], { origin: ME, limit: 5 });

    expect(out.length).toBe(3);                        // üçü de SUNULUR (belirsizlik gizlenmez)
    expect(out[0].distanceKm).toBeLessThan(6);
    expect(out[1].distanceKm).toBeLessThan(out[2].distanceKm as number);
  });

  it('🔒 KONUM YOKSA mesafe ÜRETİLMEZ (sahte 0 yasağı)', () => {
    const intent = detectPlaceIntent('eczane');
    const out = rankPlaces(intent, [place('Şifa Eczanesi', 36.94, 34.88)],
      { origin: null, limit: 5 });
    expect(out[0].distanceKm).toBeNull();
  });

  it('🔒 Null Island (0,0) KONUM SAYILMAZ', () => {
    const intent = detectPlaceIntent('eczane');
    const out = rankPlaces(intent, [place('Şifa Eczanesi', 36.94, 34.88)],
      { origin: { lat: 0, lng: 0 }, limit: 5 });
    expect(out[0].distanceKm).toBeNull();
  });

  it('🔒 "en yakın" mesafe ağırlığını ARTIRIR', () => {
    const cands = [
      place('BP', 36.9800, 34.9200, { categoryId: 'benzinlik', layer: 'OVERPASS_CATEGORY' }),  // ~9 km
      place('Shell', 36.9200, 34.8650, { categoryId: 'benzinlik', layer: 'OVERPASS_CATEGORY' }), // ~0,5 km
    ];
    const near = rankPlaces(detectPlaceIntent('en yakın benzinlik'), cands, { origin: ME, limit: 5 });
    expect(near[0].item.name).toBe('Shell');
    expect(near[0].distanceKm as number).toBeLessThan(near[1].distanceKm as number);
  });

  it('🔒 bozuk koordinatlı aday listeye GİRMEZ', () => {
    const out = rankPlaces(detectPlaceIntent('eczane'), [
      place('Bozuk', Number.NaN, 34.86),
      place('Şifa Eczanesi', 36.94, 34.88, { categoryId: 'eczane' }),
    ], { origin: ME, limit: 5 });
    expect(out.length).toBe(1);
    expect(out[0].item.name).toBe('Şifa Eczanesi');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   D) TEKİLLEŞTİRME — çevrimdışı + çevrimiçi TEK LİSTE
   ══════════════════════════════════════════════════════════════════════════ */

describe('placeQueryModel › tekilleştirme', () => {
  it('🔒 aynı koordinattaki iki kayıt TEK kalır, ZENGİN katman kazanır', () => {
    const out = dedupePlaces([
      place('Eczane', 36.9280, 34.8700, { layer: 'OFFLINE_POI' }),
      place('Eroğlu Eczanesi', 36.9280, 34.8700, { layer: 'OVERPASS_CATEGORY', categoryId: 'eczane' }),
    ]);
    expect(out.length).toBe(1);
    expect(out[0].layer).toBe('OVERPASS_CATEGORY');
  });

  it('🔒 aynı adlı ama ~110 m içindeki kayıtlar birleşir', () => {
    const out = dedupePlaces([
      place('Şok', 36.92400, 34.86800, { layer: 'OFFLINE_POI' }),
      place('Şok', 36.92404, 34.86803, { layer: 'NOMINATIM' }),
    ]);
    expect(out.length).toBe(1);
  });

  it('🔒 aynı adlı ama UZAK iki yer AYRI kalır (dört farklı "Şok" ölçüldü)', () => {
    const out = dedupePlaces([
      place('Şok', 36.9240, 34.8680),
      place('Şok', 36.9350, 34.8800),
      place('Şok', 36.9500, 34.9000),
    ]);
    expect(out.length).toBe(3);
  });

  it('🔒 kullanıcının KENDİ kaydı (geçmiş) sağlayıcı kaydını EZER', () => {
    const out = dedupePlaces([
      place('Bilinmeyen', 36.9280, 34.8700, { layer: 'NOMINATIM' }),
      place('İş yerim', 36.9280, 34.8700, { layer: 'HISTORY' }),
    ]);
    expect(out[0].name).toBe('İş yerim');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   E) OVERPASS KATEGORİ KATMANI — fail-soft · enjeksiyon yok · soğuma
   ══════════════════════════════════════════════════════════════════════════ */

describe('overpassCategorySearch', () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    _resetOverpassCategoryStateForTest();
    Object.defineProperty(globalThis.navigator, 'onLine', { value: true, configurable: true });
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it('🔒 sorgu metni SABİT etiketlerden kurulur (kullanıcı girdisi GİRMEZ)', () => {
    const ql = buildCategoryQl(['"amenity"="pharmacy"'], 36.9175, 34.8621, 4000);
    expect(ql).toContain('node["amenity"="pharmacy"](around:4000,36.91750,34.86210)');
    expect(ql).toContain('way["amenity"="pharmacy"](around:4000,36.91750,34.86210)');
    expect(ql).toMatch(/^\[out:json]\[timeout:\d+];/);
    /* `qt` ÖLÇÜLMÜŞ bir maliyet kararıdır (ağır kategoride 11,7 sn → 5,0 sn);
       kaldırılırsa sorgu tavana takılıp sessizce 0 sonuç döner. */
    expect(ql).toContain('out center qt');
  });

  it('🔒 GEÇERSİZ konumda ağa HİÇ çıkılmaz', async () => {
    const f = vi.fn();
    globalThis.fetch = f as unknown as typeof fetch;
    const cat = findPlaceCategory('eczane')!;
    expect(await searchCategoryNearby(cat, 0, 0)).toEqual([]);          // Null Island
    expect(await searchCategoryNearby(cat, Number.NaN, 34.8)).toEqual([]);
    expect(await searchCategoryNearby(cat, 95, 34.8)).toEqual([]);      // sınır dışı
    expect(f).not.toHaveBeenCalled();
  });

  it('🔒 ÇEVRİMDIŞIYKEN ağa HİÇ çıkılmaz', async () => {
    Object.defineProperty(globalThis.navigator, 'onLine', { value: false, configurable: true });
    const f = vi.fn();
    globalThis.fetch = f as unknown as typeof fetch;
    expect(await searchCategoryNearby(findPlaceCategory('eczane')!, ME.lat, ME.lng)).toEqual([]);
    expect(f).not.toHaveBeenCalled();
  });

  it('🔒 ağ hatası aramayı DÜŞÜRMEZ — boş dizi döner', async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    await expect(searchCategoryNearby(findPlaceCategory('eczane')!, ME.lat, ME.lng))
      .resolves.toEqual([]);
  });

  it('🔒 HTML hata sayfası (Overpass meşgul) JSON parse PATLATMAZ', async () => {
    globalThis.fetch = vi.fn(async () => new Response('<!DOCTYPE html><h1>busy</h1>', { status: 200 })) as unknown as typeof fetch;
    await expect(searchCategoryNearby(findPlaceCategory('eczane')!, ME.lat, ME.lng))
      .resolves.toEqual([]);
  });

  it('🔒 429 SOĞUMAYA sokar — sunucu zorlanmaz (canlı ölçümde alındı)', async () => {
    const f = vi.fn(async () => new Response('rate limited', { status: 429 }));
    globalThis.fetch = f as unknown as typeof fetch;
    const cat = findPlaceCategory('eczane')!;

    expect(await searchCategoryNearby(cat, ME.lat, ME.lng)).toEqual([]);
    expect(f).toHaveBeenCalledTimes(1);

    // Soğuma penceresinde İKİNCİ istek YAPILMAZ.
    expect(await searchCategoryNearby(cat, ME.lat + 0.5, ME.lng + 0.5)).toEqual([]);
    expect(f).toHaveBeenCalledTimes(1);

    const st = readOverpassCategoryStatus();
    expect(st.cooldownRemainingMs).toBeGreaterThan(0);
    expect(st.cooldownRemainingMs).toBeLessThanOrEqual(OVERPASS_COOLDOWN_MS);
  });

  it('🔒 ADSIZ kayda ad UYDURULMAZ — atılır', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      elements: [
        { type: 'node', id: 1, lat: 36.93, lon: 34.88, tags: { shop: 'bakery' } },          // adsız
        { type: 'node', id: 2, lat: 36.94, lon: 34.89, tags: { shop: 'bakery', name: 'Florya Pastanesi' } },
      ],
    }), { status: 200 })) as unknown as typeof fetch;

    const out = await searchCategoryNearby(findPlaceCategory('pastane')!, ME.lat, ME.lng);
    expect(out.length).toBe(1);
    expect(out[0].name).toBe('Florya Pastanesi');
    expect(out[0].categoryId).toBe('pastane');
  });

  it('🔒 Null Island / sınır-dışı SONUÇ reddedilir', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      elements: [
        { type: 'node', id: 1, lat: 0, lon: 0, tags: { amenity: 'pharmacy', name: 'Hayalet' } },
        { type: 'node', id: 2, lat: 95, lon: 34.8, tags: { amenity: 'pharmacy', name: 'Sınır dışı' } },
        { type: 'node', id: 3, lat: 36.93, lon: 34.87, tags: { amenity: 'pharmacy', name: 'Merve Eczanesi' } },
      ],
    }), { status: 200 })) as unknown as typeof fetch;

    const out = await searchCategoryNearby(findPlaceCategory('eczane')!, ME.lat, ME.lng);
    expect(out.map((o) => o.name)).toEqual(['Merve Eczanesi']);
  });

  it('🔒 aynı kategori+hücre için İKİNCİ arama ağa çıkmaz (önbellek)', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({
      elements: [{ type: 'node', id: 7, lat: 36.93, lon: 34.87, tags: { amenity: 'pharmacy', name: 'Merve Eczanesi' } }],
    }), { status: 200 }));
    globalThis.fetch = f as unknown as typeof fetch;
    const cat = findPlaceCategory('eczane')!;

    const a = await searchCategoryNearby(cat, ME.lat, ME.lng);
    const b = await searchCategoryNearby(cat, ME.lat + 0.0005, ME.lng);   // aynı ~1 km hücre
    expect(a).toEqual(b);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('🔒 EŞZAMANLI iki arama TEK ağ çağrısı yapar', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({
      elements: [{ type: 'node', id: 9, lat: 36.93, lon: 34.87, tags: { amenity: 'pharmacy', name: 'Merve Eczanesi' } }],
    }), { status: 200 }));
    globalThis.fetch = f as unknown as typeof fetch;
    const cat = findPlaceCategory('eczane')!;

    const [x, y] = await Promise.all([
      searchCategoryNearby(cat, ME.lat, ME.lng),
      searchCategoryNearby(cat, ME.lat, ME.lng),
    ]);
    expect(x).toEqual(y);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('🔒 SIFIR sonuç → yarıçap büyütülür (seyrek bölge kapsamı)', async () => {
    const radii: number[] = [];
    globalThis.fetch = vi.fn(async (_url: unknown, init: unknown) => {
      const body = String((init as { body?: string } | undefined)?.body ?? '');
      const m = /around%3A(\d+)/.exec(body) ?? /around:(\d+)/.exec(decodeURIComponent(body));
      if (m) radii.push(Number(m[1]));
      // İlk deneme 0, ikinci deneme 1 sonuç.
      const elements = radii.length >= 2
        ? [{ type: 'node', id: 5, lat: 37.20, lon: 34.90, tags: { amenity: 'fuel', name: 'Kır Petrol' } }]
        : [];
      return new Response(JSON.stringify({ elements }), { status: 200 });
    }) as unknown as typeof fetch;

    const cat = findPlaceCategory('benzinlik')!;
    const out = await searchCategoryNearby(cat, ME.lat, ME.lng);
    expect(radii.length).toBe(2);
    expect(radii[1]).toBe(radii[0] * RADIUS_ESCALATION);
    expect(out.map((o) => o.name)).toEqual(['Kır Petrol']);
  });

  it('🔒 SONUÇ VARSA yarıçap büyütülmez (gereksiz ikinci istek yok)', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({
      elements: [{ type: 'node', id: 6, lat: 36.93, lon: 34.87, tags: { amenity: 'fuel', name: 'Shell' } }],
    }), { status: 200 }));
    globalThis.fetch = f as unknown as typeof fetch;
    await searchCategoryNearby(findPlaceCategory('benzinlik')!, ME.lat, ME.lng);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('🔒 HATA "burada yok" SAYILMAZ — büyütmez ve ÖNBELLEĞE ALMAZ', async () => {
    /* "sorgu düştü" ile "gerçekten yok" aynı şey değildir: hata önbelleğe
       alınsaydı 5 dakika boyunca sahte bir "sonuç yok" servis edilirdi. */
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls++;
      if (calls === 1) return new Response('bozuk', { status: 500 });
      return new Response(JSON.stringify({
        elements: [{ type: 'node', id: 8, lat: 36.93, lon: 34.87, tags: { amenity: 'fuel', name: 'Opet' } }],
      }), { status: 200 });
    }) as unknown as typeof fetch;

    const cat = findPlaceCategory('benzinlik')!;
    expect(await searchCategoryNearby(cat, ME.lat, ME.lng)).toEqual([]);
    expect(calls).toBe(1);                                   // hata → büyütme YOK
    // İkinci çağrı önbelleğe DÜŞMEZ, gerçekten yeniden sorar.
    const retry = await searchCategoryNearby(cat, ME.lat, ME.lng);
    expect(retry.map((o) => o.name)).toEqual(['Opet']);
  });

  it('🔒 önbellek dönüşü ÇAĞIRANIN diziyi bozmasına izin VERMEZ', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      elements: [{ type: 'node', id: 11, lat: 36.93, lon: 34.87, tags: { amenity: 'pharmacy', name: 'Merve Eczanesi' } }],
    }), { status: 200 })) as unknown as typeof fetch;
    const cat = findPlaceCategory('eczane')!;

    const first = await searchCategoryNearby(cat, ME.lat, ME.lng);
    first.length = 0;                                    // çağıran diziyi boşaltsın
    const second = await searchCategoryNearby(cat, ME.lat, ME.lng);
    expect(second.length).toBe(1);                       // önbellek BOZULMADI
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   F) SOKAK KATMANI — alakasız TEK sonuç onu BLOKLAYAMAZ
   ══════════════════════════════════════════════════════════════════════════ */

describe('mapService › sokak eşleşme kanıtı', () => {
  const loc = (name: string, address?: string): StoredLocation => ({
    id: name, name, address, lat: 41, lng: 29,
    source: 'search', timestamp: 0, useCount: 0,
  });

  it('🔒 702 km\'deki CAMİ, sokak sorgusunu KARŞILANMIŞ saymaz', () => {
    /* ÖLÇÜLEN KUSUR: bu kayıt `combined`i doldurup Overpass sokak katmanını
       bloke ediyordu; 0,78 km'deki gerçek cadde HİÇ sorulmuyordu. */
    const sq = extractStreetQuery('Kuvayimilliye Caddesi')!;
    const mosque = loc(
      'Kuvayımilliye Cami',
      'Yakuplu Caddesi, Yakuplu Mahallesi, Beylikdüzü, İstanbul',
    );
    expect(_hasStreetMatch(sq, [mosque])).toBe(false);
  });

  it('🔒 GERÇEK cadde bulunduysa Overpass\'e tekrar sorulmaz', () => {
    const sq = extractStreetQuery('Kuvayimilliye Caddesi')!;
    expect(_hasStreetMatch(sq, [loc('Kuvayi Milliye Caddesi')])).toBe(true);
    // Boşluk yazımı değişse de eşleşir (OSM ile kullanıcı imlası ayrışır).
    expect(_hasStreetMatch(sq, [loc('Kuvayimilliye Cadde')])).toBe(true);
  });

  it('🔒 Türkçe harfsiz yazım da eşleşir', () => {
    const sq = extractStreetQuery('Sifa Sokak')!;
    expect(_hasStreetMatch(sq, [loc('Şifa Sokağı')])).toBe(true);
  });

  it('🔒 aday listesi BOŞSA eşleşme iddia edilmez', () => {
    const sq = extractStreetQuery('Kuvayimilliye Caddesi')!;
    expect(_hasStreetMatch(sq, [])).toBe(false);
  });
});
