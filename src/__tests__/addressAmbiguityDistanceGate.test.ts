/**
 * addressAmbiguityDistanceGate.test.ts — KONUM-ÖNCELİKLİ BELİRSİZLİK ÇÖZÜMÜ.
 *
 * ── KURAL (kullanıcı sözleşmesi · 2026-08-12) ──────────────────────────────
 * Şehir belirtilmemişse → EN YAKIN öncelikli.
 * Şehir açıkça belirtilmişse → O ŞEHİR kesin (mesafeye göre REDDEDİLMEZ:
 * biri Tarsus'tayken "İstanbul …" arıyorsa oraya GİDECEĞİ için arıyordur).
 *
 * ── FIXTÜRLER GERÇEKTİR ────────────────────────────────────────────────────
 * Aşağıdaki `display_name` / koordinat değerleri UYDURULMADI; ürünün gerçek
 * istek kurulumuyla (limit=4 · countrycodes=tr · viewbox d=0.7 @Tarsus) canlı
 * Nominatim'den 2026-08-12'de çekildi. Ölçümün kendisi kusuru kanıtladı:
 *   · "Cumhuriyet Mahallesi" → ürünün SUNDUĞU ilk aday Adana (43 km) iken
 *     kullanıcının 3 km ötesindeki Tarsus adayı ÜÇÜNCÜ sıradaydı.
 *   · "İstanbul Bağlar Mahallesi" → ilk aday Tarsus'ta bir OKUL (0 km);
 *     gerçekten istenen İstanbul/Bağcılar ikinci sıradaydı.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  applyLocationBias,
  detectCitiesInQuery,
  detectCitiesInResult,
  normalizeTrKey,
  FAR_FROM_USER_KM,
  RELAXED_MAX_KM,
  TR_PROVINCE_COUNT,
} from '../platform/geo/locationBiasGate';

/** Kullanıcının konumu — saha turlarının referans noktası (Tarsus). */
const TARSUS = { lat: 36.9175, lng: 34.8621 };

/* ── Canlı ölçümden alınan adaylar ────────────────────────────────────────── */

const CUMHURIYET = [
  { id: 'a', name: 'Adana',  fullName: 'Cumhuriyet Mahallesi, Yüreğir, Adana, Akdeniz Bölgesi, 01280, Türkiye',  lat: 36.9838183, lng: 35.3426633 },
  { id: 'b', name: 'Mersin', fullName: 'Cumhuriyet Mahallesi, Yenişehir, Mersin, Akdeniz Bölgesi, Türkiye',      lat: 36.7883253, lng: 34.6062759 },
  { id: 'c', name: 'Tarsus', fullName: 'Cumhuriyet Mahallesi, Tarsus, Mersin, Akdeniz Bölgesi, Türkiye',         lat: 36.9150002, lng: 34.9010268 },
  { id: 'd', name: 'Konya',  fullName: 'Cumhuriyet Mahallesi, Halkapınar, Konya, İç Anadolu Bölgesi, Türkiye',   lat: 37.4315534, lng: 34.1883811 },
];

const ISTANBUL_BAGLAR = [
  { id: 'okul', name: 'Lise', lat: 36.9207682, lng: 34.8628651,
    fullName: 'Tarsus Borsa İstanbul Mesleki ve Teknik Anadolu Lisesi, 15, Şamil Basayev Caddesi, Bağlar Mahallesi, Tarsus, Mersin, Akdeniz Bölgesi, 33400, Türkiye' },
  { id: 'baglar', name: 'Bağlar', lat: 41.0228866, lng: 28.8248289,
    fullName: 'Bağlar Mahallesi, Bağcılar, İstanbul, Marmara Bölgesi, 34212, Türkiye' },
];

/** Yalnız UZAK bir ilde bulunan aday (şehirsiz sorgu · veri boşluğu DEĞİL). */
const ONLY_FAR = [
  { id: 'siverek', name: 'Bağlar', lat: 37.7529, lng: 39.3168,
    fullName: 'Bağlar Mahallesi, Siverek, Şanlıurfa, Güneydoğu Anadolu Bölgesi, Türkiye' },
];

/* ══════════════════════════════════════════════════════════════════════════
   A · SAF KAPI — dört zorunlu senaryo
   ══════════════════════════════════════════════════════════════════════════ */

describe('locationBiasGate — şehirsiz sorgu: EN YAKIN öncelikli', () => {
  it('senaryo 1 · şehirsiz + yakın şehirde VAR → en yakın BAŞA gelir', () => {
    const r = applyLocationBias('Cumhuriyet Mahallesi', CUMHURIYET, TARSUS);

    expect(r.mode).toBe('PROXIMITY');
    expect(r.citiesInQuery).toEqual([]);
    /* Ölçülen kusur: sağlayıcı sırası Adana(43) · Mersin(27) · Tarsus(3) ·
       Konya(83). Kapıdan sonra 3 km'lik Tarsus BİRİNCİ olmalı. */
    expect(r.kept.map((c) => c.item.id)).toEqual(['c', 'b', 'a', 'd']);
    expect(r.kept[0].distanceKm).toBeLessThan(5);
    /* Hiçbir aday ELENMEZ — meşru komşu il adayları cevap olmaya devam eder. */
    expect(r.kept).toHaveLength(4);
    expect(r.droppedFar).toBe(0);
    expect(r.droppedWrongCity).toBe(0);
    /* 100 km'nin altındaki adaylar "uzak" DEĞİLDİR → otomatik rota serbest. */
    expect(r.kept.every((c) => c.farFromUser === false)).toBe(true);
  });

  it('senaryo 2 · şehirsiz + yalnız UZAK şehirde var → ELENMEZ ama onaya düşer', () => {
    const r = applyLocationBias('Bağlar Mahallesi', ONLY_FAR, TARSUS);

    /* Veri boşluğu DEĞİL: yer gerçekten var, yalnız uzakta. Silmek "bulunamadı"
       yalanı olurdu; sessizce oraya rota kurmak ise daha kötü. Ortası: SUN, ama
       onay iste. */
    expect(r.kept).toHaveLength(1);
    expect(r.droppedFar).toBe(0);
    expect(r.kept[0].farFromUser).toBe(true);
    expect(r.kept[0].distanceKm).toBeGreaterThan(FAR_FROM_USER_KM);
  });

  it('GEVŞETİLMİŞ + çok uzak aday ELENİR (teşhis §3.5 · 379/696 km)', () => {
    const relaxedFar = [{ ...ONLY_FAR[0], relaxed: true }];
    const r = applyLocationBias('Bağlar Mahallesi', relaxedFar, TARSUS);

    /* İki zayıflık üst üste: kullanıcının YAZDIĞI sorguyla bulunmadı VE
       ulaşılabilir değil → aday cevap olmaktan çıkar. */
    expect(r.kept).toHaveLength(0);
    expect(r.droppedFar).toBe(1);
  });

  it('GEVŞETİLMİŞ ama YAKIN aday elenmez (eşik gevşekliği kanıtı)', () => {
    const relaxedNear = [{ ...CUMHURIYET[2], relaxed: true }];
    const r = applyLocationBias('Cumhuriyet Mahallesi', relaxedNear, TARSUS);
    expect(r.kept).toHaveLength(1);
    expect(r.droppedFar).toBe(0);
    expect(RELAXED_MAX_KM).toBeGreaterThan(FAR_FROM_USER_KM);
  });

  it('KONUM YOKSA hiçbir şey yapılmaz — sahte mesafe ÜRETİLMEZ', () => {
    const r = applyLocationBias('Cumhuriyet Mahallesi', CUMHURIYET, null);
    expect(r.mode).toBe('UNMEASURED');
    expect(r.kept.map((c) => c.item.id)).toEqual(['a', 'b', 'c', 'd']); // sıra KORUNUR
    expect(r.kept.every((c) => c.distanceKm === null)).toBe(true);
    expect(r.kept.every((c) => c.farFromUser === false)).toBe(true);
  });

  it('0,0 (Null Island) konum SAYILMAZ', () => {
    const r = applyLocationBias('Cumhuriyet Mahallesi', CUMHURIYET, { lat: 0, lng: 0 });
    expect(r.mode).toBe('UNMEASURED');
  });
});

describe('locationBiasGate — şehir belirtilmiş: O ŞEHİR kesin', () => {
  it('senaryo 3 · şehir belirtilmiş + o şehirde VAR → mesafe REDDETMEZ', () => {
    const r = applyLocationBias('İstanbul Bağlar Mahallesi', ISTANBUL_BAGLAR, TARSUS);

    expect(r.mode).toBe('CITY_SCOPED');
    expect(r.citiesInQuery).toEqual(['istanbul']);
    expect(r.kept).toHaveLength(1);
    expect(r.kept[0].item.id).toBe('baglar');
    /* 693 km — mesafe kapısı KAPALI: şehir açıkça istendi. */
    expect(r.kept[0].distanceKm).toBeGreaterThan(600);
    expect(r.kept[0].farFromUser).toBe(false);
    expect(r.kept[0].cityEvidence).toBe('MATCH');
  });

  it('senaryo 4 · şehir belirtilmiş → YANLIŞ şehirdeki aday seçilmez', () => {
    const r = applyLocationBias('İstanbul Bağlar Mahallesi', ISTANBUL_BAGLAR, TARSUS);
    /* Ölçülen kusur: 0 km'deki Tarsus okulu BİRİNCİ adaydı. Yakınlık, açıkça
       istenen şehri EZEMEZ. */
    expect(r.kept.map((c) => c.item.id)).not.toContain('okul');
    expect(r.droppedWrongCity).toBe(1);
  });

  it('sonuç adının BAŞINDAKİ şehir sözcüğü il KANITI SAYILMAZ (kuyruk kuralı)', () => {
    /* "Tarsus Borsa **İstanbul** … Lisesi" adının BAŞINDA "İstanbul" geçer ama
       yer Mersin'dedir. Baştan tarama bu kaydı "İstanbul" sanırdı. */
    expect(detectCitiesInResult(ISTANBUL_BAGLAR[0].fullName)).toEqual(['mersin']);
    expect(detectCitiesInResult(ISTANBUL_BAGLAR[1].fullName)).toEqual(['istanbul']);
  });

  it('istenen şehirde aday YOKSA, il kanıtı OLMAYAN adaylar KORUNUR', () => {
    /* Overpass yalın sokak adı döndürür ("0469. Sokak") — hangi ilde olduğu
       BİLİNMEZ. "Bilmiyoruz" ≠ "yanlış": eleme kanıt ister. */
    const overpass = [{ id: 'w1', name: '0469. Sokak', fullName: '0469. Sokak', lat: 36.9184, lng: 34.8637 }];
    const r = applyLocationBias('Mersin Tarsus 0469 Sokak', overpass, TARSUS);
    expect(r.mode).toBe('CITY_SCOPED');
    expect(r.kept).toHaveLength(1);
    expect(r.kept[0].cityEvidence).toBe('UNKNOWN');
    expect(r.droppedWrongCity).toBe(0);
  });

  it('TÜMÜ yanlış ilde ise dürüst BOŞ döner (yakınına kaydırmaz)', () => {
    const r = applyLocationBias('Ankara Cumhuriyet Mahallesi', CUMHURIYET, TARSUS);
    expect(r.kept).toHaveLength(0);
    expect(r.droppedWrongCity).toBe(4);
  });
});

describe('locationBiasGate — şehir adı ayıklama', () => {
  it('81 il tanınır ve diyakritiğe DUYARSIZDIR', () => {
    expect(TR_PROVINCE_COUNT).toBe(81);
    expect(detectCitiesInQuery('İstanbul Kadıköy')).toEqual(['istanbul']);
    expect(detectCitiesInQuery('Istanbul Kadikoy')).toEqual(['istanbul']);
    expect(detectCitiesInQuery('sanliurfa siverek')).toEqual(['sanliurfa']);
    expect(detectCitiesInQuery('Şanlıurfa Siverek')).toEqual(['sanliurfa']);
  });

  it('eski/halk adları kanonik ile aynı ile eşlenir', () => {
    expect(detectCitiesInQuery('Urfa Bağlar')).toEqual(['sanliurfa']);
    expect(detectCitiesInQuery('Antep Şahinbey')).toEqual(['gaziantep']);
  });

  it('il adı YER ADININ parçasıysa şehir bildirimi SAYILMAZ', () => {
    /* "Ankara Caddesi" Adana'da bir caddedir — burada şehir belirtilmemiştir,
       yani en-yakın kuralı geçerli kalmalıdır. */
    expect(detectCitiesInQuery('Ankara Caddesi')).toEqual([]);
    expect(detectCitiesInQuery('İzmir Sokak')).toEqual([]);
    expect(detectCitiesInQuery('Ankara Mahallesi')).toEqual([]);
    /* Ama gerçek şehir bildirimi bundan etkilenmez. */
    expect(detectCitiesInQuery('Ankara Kızılay Atatürk Bulvarı')).toEqual(['ankara']);
  });

  it('şehir adı sorgunun SONUNDA da tanınır (Türk adres sırası değişkendir)', () => {
    expect(detectCitiesInQuery('Kuvayimilliye Caddesi Yenişehir Mersin')).toEqual(['mersin']);
  });

  it("`İ` normalizasyonu indeks/kod-birimi kaymasına düşmez", () => {
    /* 'İ'.toLowerCase() İKİ kod birimi üretir (i + U+0307) — bu ürünün üç ayrı
       yerinde kusura yol açmıştı (teşhis §3.7). */
    expect(normalizeTrKey('İSTANBUL')).toBe('istanbul');
    expect(normalizeTrKey('İstanbul'.toLowerCase())).toBe('istanbul');
    expect(normalizeTrKey('IĞDIR')).toBe('igdir');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   B · NUMARALI YOL REGRESYONU — bu değişiklik onu BOZMAMALI
   ══════════════════════════════════════════════════════════════════════════ */

describe('numaralı yol davranışı (0469/0455) BOZULMADI', () => {
  it('sokak sorgusu çıkarımı DEĞİŞMEDİ — desen birebir aynı', async () => {
    const { extractStreetQuery } = await import('../platform/streetSearchService');
    expect(extractStreetQuery('Tarsus Bağlar Mahallesi 0469 Sokak')!.nameRegex)
      .toBe(String.raw`^0*469\.? ?Sokak.*$`);
    /* 0455 OSM'de YOKTUR — desen yine üretilir, "yakın numaraya" kaydırılmaz. */
    expect(extractStreetQuery('Tarsus Bağlar Mahallesi 0455 Sokak')!.nameRegex)
      .toBe(String.raw`^0*455\.? ?Sokak.*$`);
  });

  it('numaralı sokak sonucu kapıdan GEÇER (Tarsus içi, il kanıtı yok)', async () => {
    const { extractStreetQuery } = await import('../platform/streetSearchService');
    const sq = extractStreetQuery('Tarsus Bağlar Mahallesi 0469 Sokak');
    expect(sq!.kind).toBe('numbered');

    /* Overpass'in gerçek cevabı (ölçüldü 2026-08-03): "0469. Sokak" @3 km. */
    const overpassHit = [{ id: 'osm-way-1', name: '0469. Sokak', fullName: '0469. Sokak',
      lat: 36.9184146, lng: 34.8637155 }];
    const r = applyLocationBias('Tarsus Bağlar Mahallesi 0469 Sokak', overpassHit, TARSUS);
    /* Tarsus bir İLÇEdir, il listesinde YOKTUR → şehir belirtilmemiş sayılır →
       en-yakın modu; sonuç 3 km'de olduğu için hem kalır hem uzak DEĞİLDİR. */
    expect(r.mode).toBe('PROXIMITY');
    expect(r.kept).toHaveLength(1);
    expect(r.kept[0].farFromUser).toBe(false);
  });

  it('numara doğrulaması kapıdan BAĞIMSIZ çalışmaya devam eder', async () => {
    const { filterNumberedStreetMismatch } = await import('../platform/geocodingService');
    const results = [
      { fullName: '0411. Sokak, Bağlar Mahallesi, Tarsus, Mersin, Türkiye' },
      { fullName: '0469. Sokak, Bağlar Mahallesi, Tarsus, Mersin, Türkiye' },
    ];
    const ok = filterNumberedStreetMismatch('Tarsus Bağlar Mahallesi 0469 Sokak', results);
    expect(ok).toHaveLength(1);
    expect(ok[0].fullName).toContain('0469');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   C · ÜRÜN ZİNCİRİNE BAĞLI MI — saf fonksiyon testi YETMEZ
   ══════════════════════════════════════════════════════════════════════════ */

vi.mock('../platform/offlineSearchService', () => ({
  searchOffline: vi.fn(async () => []),
  searchPOI:     vi.fn(async () => []),
}));
vi.mock('../platform/geocodingProviders', () => ({
  premiumGeocode: vi.fn(async () => []),
}));
vi.mock('../platform/streetSearchService', async (orig) => {
  const actual = await orig<typeof import('../platform/streetSearchService')>();
  return { ...actual, searchStreetByName: vi.fn(async () => []) };
});

function nominatimPayload(items: ReadonlyArray<{ id: number; display_name: string; lat: number; lon: number }>) {
  return items.map((i) => ({
    place_id: i.id, display_name: i.display_name,
    lat: String(i.lat), lon: String(i.lon),
    class: 'boundary', type: 'administrative',
  }));
}

describe('geocodeAddress — kapı ZİNCİRE bağlı (wiring kanıtı)', () => {
  beforeEach(() => {
    vi.resetModules();
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('şehirsiz sorguda EN YAKIN sonuç birinci döner', async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify(nominatimPayload([
      { id: 209795129, display_name: CUMHURIYET[0].fullName, lat: CUMHURIYET[0].lat, lon: CUMHURIYET[0].lng },
      { id: 210445763, display_name: CUMHURIYET[1].fullName, lat: CUMHURIYET[1].lat, lon: CUMHURIYET[1].lng },
      { id: 210087355, display_name: CUMHURIYET[2].fullName, lat: CUMHURIYET[2].lat, lon: CUMHURIYET[2].lng },
      { id: 211845522, display_name: CUMHURIYET[3].fullName, lat: CUMHURIYET[3].lat, lon: CUMHURIYET[3].lng },
    ])), { status: 200 })) as typeof fetch;

    const { geocodeAddress } = await import('../platform/geocodingService');
    const out = await geocodeAddress('Cumhuriyet Mahallesi', TARSUS.lat, TARSUS.lng);

    expect(out.length).toBe(4);
    expect(out[0].fullName).toContain('Tarsus');
    expect(out[0].distanceKm).toBeLessThan(5);
  });

  it('şehir belirtilmiş sorguda YANLIŞ şehirdeki aday ürüne HİÇ ulaşmaz', async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify(nominatimPayload([
      { id: 208459514, display_name: ISTANBUL_BAGLAR[0].fullName, lat: ISTANBUL_BAGLAR[0].lat, lon: ISTANBUL_BAGLAR[0].lng },
      { id: 60815200,  display_name: ISTANBUL_BAGLAR[1].fullName, lat: ISTANBUL_BAGLAR[1].lat, lon: ISTANBUL_BAGLAR[1].lng },
    ])), { status: 200 })) as typeof fetch;

    const { geocodeAddress, readGeocodeTrace } = await import('../platform/geocodingService');
    const out = await geocodeAddress('İstanbul Bağlar Mahallesi', TARSUS.lat, TARSUS.lng);

    expect(out).toHaveLength(1);
    expect(out[0].fullName).toContain('Bağcılar');
    /* 693 km — şehir açıkça istendiği için ELENMEZ ve "uzak" işareti KONMAZ. */
    expect(out[0].farFromUser).toBeUndefined();
    expect(out[0].distanceKm).toBeGreaterThan(600);

    /* Kanıt defterine taşınan iz: kapı çalıştı ve 1 aday eledi. */
    const trace = readGeocodeTrace(out);
    expect(trace?.biasMode).toBe('CITY_SCOPED');
    expect(trace?.biasDroppedCount).toBe(1);
  });

  it('kapı bir katmanı BOŞALTIRSA merdiven durmaz (son şans yine denenir)', async () => {
    /* Nominatim yalnız YANLIŞ şehirde cevap verir → kapı boşaltır → Overpass
       son şansı yine ÇAĞRILMALIDIR (aksi hâlde kapı zinciri kısaltmış olur). */
    global.fetch = vi.fn(async () => new Response(JSON.stringify(nominatimPayload([
      { id: 1, display_name: CUMHURIYET[0].fullName, lat: CUMHURIYET[0].lat, lon: CUMHURIYET[0].lng },
    ])), { status: 200 })) as typeof fetch;

    const street = await import('../platform/streetSearchService');
    const { geocodeAddress } = await import('../platform/geocodingService');
    await geocodeAddress('Ankara Cumhuriyet Mahallesi', TARSUS.lat, TARSUS.lng);

    expect(vi.mocked(street.searchStreetByName)).toHaveBeenCalled();
  });
});
