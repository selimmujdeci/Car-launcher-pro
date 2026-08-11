/**
 * Geocoding Service — adres ve POI araması.
 *
 * Adres / mekan: Nominatim (OpenStreetMap) — Türkiye bias
 * Yakın benzinlik / otopark: Overpass API — 5 km yarıçap
 *
 * Her iki servis de rate-limit dostu; retry yok, sadece timeout.
 *
 * Fast-Fail Fallback (geocodeAddress):
 *   navigator.onLine === false  → anında offline fallback (<500ms)
 *   Nominatim > FAST_FAIL_MS    → offline fallback DÖNER, istek İPTAL EDİLMEZ;
 *                                 geç gelen yanıt önbelleğe düşer (bkz. _lateCache)
 *   Nominatim ağ hatası         → offline fallback
 * Fallback: searchOffline() (IndexedDB geçmiş) + searchPOI() (SQLite FTS5)
 */

import { searchOffline, searchPOI } from './offlineSearchService';
import type { POISearchResult }      from './offlineSearchService';
import { searchStreetByName, extractStreetQuery } from './streetSearchService';
import { premiumGeocode }            from './geocodingProviders';
import type { AddressSearchStage }   from './geo/addressSearchLedger';

const NOMINATIM          = 'https://nominatim.openstreetmap.org/search';
const NOMINATIM_REVERSE  = 'https://nominatim.openstreetmap.org/reverse';
const OVERPASS           = 'https://overpass-api.de/api/interpreter';
const UA                 = 'CarLauncherPro/1.0';
const TIMEOUT            = 8_000;
const FAST_FAIL_MS       = 2_000;  // "İnternet Yok" senaryosu mühürü — 2s fast-fail
const OFFLINE_POI_GUARD_MS = 400;  // _offlineFallback içi POI araması üst sınırı

/* ── Nominatim rate limiter — max 1 req/sec (ToS) ──────────── */
let _lastNominatimMs = 0;
const NOMINATIM_GAP  = 1_100; // 1.1 s — small buffer over 1 s limit

async function _waitNominatim(): Promise<void> {
  const now   = Date.now();
  const wait  = NOMINATIM_GAP - (now - _lastNominatimMs);
  if (wait > 0) await new Promise<void>((res) => setTimeout(res, wait));
  _lastNominatimMs = Date.now();
}

/* ── Types ───────────────────────────────────────────────── */

export interface GeoResult {
  id:          string;
  name:        string;       // kısa görünen ad (ilk token)
  fullName:    string;       // tam Nominatim display_name
  lat:         number;
  lng:         number;
  type:        string;       // nominatim class/type
  distanceKm?: number;       // yalnızca nearby sonuçlarda
  source?:     'online' | 'offline'; // fallback kaynak etiketi
  /**
   * Sonuç, kullanıcının SÖYLEDİĞİ sorguyla değil GEVŞETİLMİŞ bir varyantla
   * bulunduysa `true` (bkz. relaxQueryVariants). Çağıran bunu ONAY İSTEMEK
   * için kullanır: gevşetilmiş tek sonuç bile OTOMATİK ROTAYA ÇEVRİLMEZ —
   * "Adana" yerine "Ada"ya götürmek, bulamamaktan daha kötüdür.
   */
  relaxed?:    boolean;
}

/* ── Sorgu gevşetme merdiveni ────────────────────────────────────────────────
 *
 * SAHA (2026-08-03): Nominatim serbest metin araması Türkçe POI adlarında sık
 * başarısız oluyor ("Mersin Hemşirenin Park Piknik Yeri" → 0 sonuç). Kullanıcı
 * haklı olarak "adres tarif edemiyorsak asistan gereksiz" dedi.
 *
 * TASARIM İLKESİ: sorguyu BOZMA, VARYANT ÜRET. Ayırt edici sözcükler korunur,
 * yalnız SONDAN genel/ekli sözcükler düşürülür ve baştaki şehir adı (viewbox
 * zaten oraya yanlı olduğu için) bir denemede çıkarılır. Böylece "Adana"yı
 * "Ada" yapan türden bilgi kaybı OLMAZ.
 *
 * SINIRLI: en fazla `RELAX_MAX_VARIANTS` ek deneme — Nominatim ToS hız sınırı
 * (~1 istek/sn) yüzünden her deneme gerçek zaman maliyetidir ve YALNIZ ilk
 * sorgu 0 sonuç döndüğünde koşar (timeout/çevrimdışı yolunu ETKİLEMEZ).
 */
/* Her varyant GERÇEK zaman maliyetidir: Nominatim ToS hız sınırı (~1 istek/sn)
   + 2 sn fast-fail. 2 ek deneme ≈ 4-6 sn'lik en kötü hâl demektir ve sesli
   akışta kullanıcı "aranıyor" dedikten sonra bunu bekler. Bütçe 2'de TUTULUR;
   sıralama önemlidir — en yüksek kazançlı varyant (kısaltma açılımı) ÖNCE. */
const RELAX_MAX_VARIANTS = 2;

/* ── Türkçe adres kısaltmaları ───────────────────────────────────────────────
 * ÖLÇÜM (2026-08-03, canlı Nominatim):
 *   "Tarsus Bağlar mh 0455 sokak"        → 0 sonuç
 *   "Tarsus Bağlar mahallesi 0455 sokak" → 4 sonuç
 * Yani tek başına "mh" kısaltması aramayı tamamen öldürüyordu. Açılım
 * BİLGİ KAYBI DEĞİLDİR (kısaltma ile tam biçim aynı şeyi söyler), yine de
 * kullanıcının yazdığı sorgu V0 olarak KORUNUR; açılım bir VARYANTTIR. */
const _ABBREV: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bmah\.?\b/gi,  'Mahallesi'],
  [/\bmh\.?\b/gi,   'Mahallesi'],
  [/\bcad\.?\b/gi,  'Caddesi'],
  [/\bcd\.?\b/gi,   'Caddesi'],
  [/\bsok\.?\b/gi,  'Sokak'],
  [/\bsk\.?\b/gi,   'Sokak'],
  [/\bbulv\.?\b/gi, 'Bulvarı'],
  [/\bblv\.?\b/gi,  'Bulvarı'],
  [/\bapt\.?\b/gi,  'Apartmanı'],
];

/** Türkçe adres kısaltmalarını açar ("Bağlar mh" → "Bağlar Mahallesi"). Saf. */
export function expandTurkishAddressAbbrev(query: string): string {
  let out = query;
  for (const [re, full] of _ABBREV) out = out.replace(re, full);
  return out.replace(/\s+/g, ' ').trim();
}

/* ── Numaralı sokak doğrulaması ──────────────────────────────────────────────
 *
 * ÖLÇÜM (2026-08-03, canlı Nominatim — serbest metin VE yapılandırılmış sorgu):
 *   istenen "0455. Sokak, Bağlar Mah., Tarsus" için dönenler:
 *     0411 · 0452 · 0423 · 0436 · 0478 · 3232 · 1713 · 4072 · 1102 · 0655 …
 *   **İstenen numara HİÇBİR denemede dönmedi.** Nominatim numarayı bulanık
 *   eşleştirip aynı mahalledeki RASTGELE sokakları veriyor.
 *
 * Bu, "bulunamadı"dan DAHA TEHLİKELİDİR: kullanıcı 0455 istiyor, ürün onu
 * 0411'e götürüyor ve bunu sessizce yapıyor. CLAUDE.md'nin "kanıtsız bilgi
 * üretilmez" kuralı gereği bu sonuçlar cevap olarak SUNULAMAZ.
 *
 * Kural: sorgu numaralı bir sokak/cadde istiyorsa, dönen sonucun numarası
 * İSTENEN numarayla eşleşmiyorsa sonuç ELENİR. Hepsi elenirse dürüst
 * "bulunamadı" döner — yanlış yere rota kurulmaz.
 */
const _NUM_STREET_RE = /(\d{2,5})\s*\.?\s*(sokak|sk|cadde|cd)\b/i;

/** "0455" → "455" (baştaki sıfırlar OSM ile kullanıcı arasında değişiyor). */
function _normStreetNo(n: string): string {
  return n.replace(/^0+/, '') || '0';
}

/**
 * Sorgu numaralı sokak istiyorsa, FARKLI numaralı sonuçları eler.
 * Sorguda numaralı sokak yoksa liste olduğu gibi döner. Saf fonksiyon.
 */
export function filterNumberedStreetMismatch<T extends { fullName: string }>(
  query: string, results: T[],
): T[] {
  const want = _NUM_STREET_RE.exec(query);
  if (!want) return results;
  const wantNo = _normStreetNo(want[1]);

  /* KURAL: sorgu belirli bir NUMARALI sokak istiyorsa, sonuç O NUMARAYI
     taşımak ZORUNDADIR. "Yaklaşık" cevap yoktur.
     ── Bu kural cihazda ÜÇ turda öğrenildi (2026-08-03) ────────────────────
     Her turda daha gevşek bir kural denendi ve her turda Nominatim bulanık
     eşleşmeyle alakasız bir yer döndürdü:
       1) filtre yokken     → "Sokak, Turgut Reis Mah., İZMİR"      701 km
       2) "numarasız→geç"   → aynı İzmir + "Sokak, ... DENİZLİ"
       3) "numarasız ama    → "Sukok, Parkent district, TAŞKENT,
          sokak değilse geç"    ÖZBEKİSTAN"                        3031 km
     Kaçış deliği bırakıldığı her seferde arkasından yanlış bir yer geldi.
     Numaralı sokak sorgusu KESİN bir sorudur; kesin cevabı yoksa cevap
     YOKTUR. Bulamamak, 3000 km öteye rota kurmaktan iyidir. */
  return results.filter((r) => {
    const got = _NUM_STREET_RE.exec(r.fullName);
    return got !== null && _normStreetNo(got[1]) === wantNo;
  });
}

/** Baştaki şehir adı — viewbox zaten bölgeye yanlı olduğundan bir denemede atılır. */
const _TR_CITY_HEAD = /^(mersin|adana|ankara|istanbul|i̇stanbul|izmir|i̇zmir|bursa|antalya|konya|gaziantep|kayseri|eskişehir|eskisehir|samsun|trabzon|diyarbakır|diyarbakir|hatay|malatya|erzurum|van|denizli|sakarya|kocaeli|manisa|balıkesir|balikesir|aydın|aydin|tekirdağ|tekirdag|muğla|mugla)\s+/i;

/**
 * Sorgudan, ayırt ediciliği koruyan gevşetilmiş varyantlar üretir (sırayla denenir).
 * Saf fonksiyon — test edilebilir, ağ/zaman/global durum yok.
 */
export function relaxQueryVariants(query: string): string[] {
  const q = query.trim().replace(/\s+/g, ' ');
  if (!q) return [];

  const out: string[] = [];
  const push = (v: string): void => {
    const t = v.trim();
    // Çok kısalan varyant ayırt ediciliğini yitirir → yanlış yere götürebilir.
    if (t.length < 4) return;
    if (t.toLowerCase() === q.toLowerCase()) return;
    if (!out.some((e) => e.toLowerCase() === t.toLowerCase())) out.push(t);
  };

  const tokens = q.split(' ');

  // 0) Kısaltmaları aç — ölçülen en yüksek kazançlı varyant ("mh" → 0 sonuç,
  //    "Mahallesi" → 4 sonuç). Sorgu değişmediyse push() zaten yok sayar.
  push(expandTurkishAddressAbbrev(q));

  // 1) Baştaki şehir adını at — "Mersin Hemşirenin Park Piknik Yeri"
  //    → "Hemşirenin Park Piknik Yeri" (viewbox zaten Mersin'e yanlı).
  //    En az 2 sözcük kalmalı, yoksa yalnız şehir aranmış demektir.
  if (_TR_CITY_HEAD.test(q) && tokens.length >= 3) {
    push(q.replace(_TR_CITY_HEAD, ''));
  }

  // 2) Sondan sözcük düşür — Türkçe POI adlarının kuyruğu genelde jeneriktir
  //    ("… Park Piknik Yeri" → "… Park Piknik"). Ayırt edici baş korunur.
  if (tokens.length >= 3) push(tokens.slice(0, -1).join(' '));
  if (tokens.length >= 4) push(tokens.slice(0, -2).join(' '));

  return out.slice(0, RELAX_MAX_VARIANTS);
}

/* ── ARAMA İZİ (kanıt defteri için) ──────────────────────────────────────────
 *
 * NEDEN BÖYLE: teşhis turu (2026-08-11) ürünün hiçbir arama denemesini
 * KAYDETMEDİĞİNİ ölçtü. Kaydı deftere YAZMAK `geocodeAddress`'in işi DEĞİL —
 * o bir kütüphanedir ve İKİ yüzeyden çağrılır (Mavi/adres kartı + harita arama
 * çubuğu); burada yazsaydı aynı deneme iki kez sayılırdı. Bu yüzden buradaki
 * görev yalnız "hangi katman cevapladı, ne kadar sürdü, kaç sonuç elendi"
 * bilgisini ÇAĞIRANA taşımaktır; deftere tek kayıt çağıran yazar.
 *
 * Taşıyıcı olarak WeakMap seçildi: dönüş tipi (`GeoResult[]`) DEĞİŞMEZ →
 * mevcut çağıranların hiçbiri bozulmaz, ve her çağrı taze bir dizi döndürdüğü
 * için eşzamanlı aramalar birbirinin izini EZMEZ (modül-düzeyi "son çağrı"
 * değişkeni bu yarışı sessizce kaybederdi). Anahtar diziler GC'lenir → sızıntı yok.
 */
export interface GeocodeTrace {
  /** Cevabı üreten katman. */
  readonly stage: AddressSearchStage;
  /** Doğrulama filtresinin eledİĞİ sonuç sayısı. `null` = filtre hiç çalışmadı. */
  readonly rejectedCount: number | null;
  /**
   * **ZİNCİRİN** toplam süresi (ms) — rate-limit beklemesi, gevşetme varyantları
   * ve Overpass son şansı DAHİL.
   *
   * ⚠️ Bu sayı `FAST_FAIL_MS` ile KARŞILAŞTIRILMAZ: zincir üç deneme yaptığı için
   * doğal olarak 2 saniyeyi aşar ve bu "ağ yavaş" DEMEK DEĞİLDİR (ölçüm
   * 2026-08-11: 8,6 s süren bir zincirde tek Nominatim yanıtı 606 ms'ydi).
   * "Beklemeyi bıraktık mı" sorusunun cevabı `fastFailHit` alanındadır.
   */
  readonly providerMs: number;
  /**
   * En az bir Nominatim denemesi 2 s fast-fail'i aşıp BEKLENMEDEN bırakıldı mı
   * (ya da ağ hatası verdi mi). Ölçülebilen tek gerçek "yavaşlık" sinyali budur.
   */
  readonly fastFailHit: boolean;
  readonly hadLocation: boolean;
  readonly online: boolean;
  /** Overpass son şansı için kullanılabilir sokak sorgusu üretilebildi mi. */
  readonly fallbackQueryUsable: boolean | null;
}

const _traces = new WeakMap<object, GeocodeTrace>();

/** `geocodeAddress` dönüşünün izini okur. İz yoksa `null` (uydurma YOK). */
export function readGeocodeTrace(results: object): GeocodeTrace | null {
  try {
    return _traces.get(results) ?? null;
  } catch { return null; }
}

function _trace(results: GeoResult[], t: GeocodeTrace): GeoResult[] {
  try { _traces.set(results, t); } catch { /* iz kaydı ürünü düşürmez */ }
  return results;
}

/* ── Helpers ─────────────────────────────────────────────── */

function abort(ms: number): { ctrl: AbortController; clear: () => void } {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return { ctrl, clear: () => clearTimeout(timer) };
}

function shortName(displayName: string): string {
  // "Bağlar Mahallesi, Yenişehir, Mersin, ..." → "Bağlar Mahallesi, Yenişehir"
  const parts = displayName.split(',').map((p) => p.trim()).filter(Boolean);
  return parts.slice(0, 2).join(', ');
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R  = 6371;
  const dL = ((lat2 - lat1) * Math.PI) / 180;
  const dG = ((lng2 - lng1) * Math.PI) / 180;
  const a  =
    Math.sin(dL / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dG / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/* ── Offline fallback ────────────────────────────────────── */

/**
 * Çevrimiçi servis kullanılamadığında yerel kaynaklardan sonuç üretir.
 *
 * Katmanlar (öncelik sırasıyla):
 *   1. searchOffline()  — IndexedDB geçmiş/favoriler (< 10ms)
 *   2. searchPOI()      — SQLite FTS5 (Worker, OFFLINE_POI_GUARD_MS cap)
 *
 * Her sonuca `source: 'offline'` etiketi eklenir.
 */
async function _offlineFallback(
  query:      string,
  currentLat?: number,
  currentLng?: number,
): Promise<GeoResult[]> {
  const results: GeoResult[] = [];
  const seen   = new Set<string>();

  const _dedup = (lat: number, lng: number) => {
    const k = `${lat.toFixed(4)}_${lng.toFixed(4)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  };

  /* 1. IndexedDB geçmiş / favoriler */
  try {
    const hits = await searchOffline(query, 4);
    for (const { location: loc } of hits) {
      if (_dedup(loc.lat, loc.lng)) {
        results.push({
          id:       loc.id,
          name:     loc.name,
          fullName: loc.address ?? loc.name,
          lat:      loc.lat,
          lng:      loc.lng,
          type:     'offline/history',
          source:   'offline',
        });
      }
    }
  } catch { /* IndexedDB erişilemez */ }

  /* 2. SQLite FTS5 POI — 400ms üst sınırlı (Worker hazır değilse atla) */
  if (results.length < 4) {
    try {
      const remaining = 4 - results.length;
      const guard     = new Promise<POISearchResult[]>((_, rej) =>
        setTimeout(() => rej(new Error('offline-poi-timeout')), OFFLINE_POI_GUARD_MS),
      );
      const pois = await Promise.race([
        searchPOI(query, { lat: currentLat, lon: currentLng, maxResults: remaining }),
        guard,
      ]).catch((): POISearchResult[] => []);

      for (const poi of pois) {
        if (_dedup(poi.lat, poi.lon)) {
          results.push({
            id:       poi.id || `poi-${poi.lat.toFixed(5)}-${poi.lon.toFixed(5)}`,
            name:     poi.name,
            fullName: poi.address ? `${poi.name}, ${poi.address}` : poi.name,
            lat:      poi.lat,
            lng:      poi.lon,
            type:     `poi/${poi.category}`,
            source:   'offline',
          });
        }
      }
    } catch { /* Worker yok veya poi.db yüklenmedi */ }
  }

  return results;
}

/* ── Nominatim ───────────────────────────────────────────── */

interface NominatimItem {
  place_id:     number;
  display_name: string;
  lat:          string;
  lon:          string;
  class:        string;
  type:         string;
}

/**
 * Adres veya mekan ara — birden fazla sonuç döner (max 4).
 * currentLat/Lng verilirse viewbox bias uygulanır.
 *
 * Fast-Fail Timeout (2s):
 *   - navigator.onLine === false → anında _offlineFallback() (rate-limiter atlanır)
 *   - Nominatim 2s içinde yanıt vermezse → _offlineFallback() DÖNER; istek
 *     iptal EDİLMEZ, geç yanıt önbelleğe yazılır → sonraki arama onu bulur
 *   - Nominatim ağ hatası → _offlineFallback()
 */
export async function geocodeAddress(
  query:       string,
  currentLat?: number,
  currentLng?: number,
): Promise<GeoResult[]> {
  /* Kanıt izi — çağıran deftere TEK kayıt yazsın diye ölçülür (bkz. GeocodeTrace).
     Ölçüm hiçbir kararı değiştirmez: aşağıdaki akış BİREBİR eskisi gibidir. */
  const t0          = Date.now();
  const hadLocation = currentLat != null && currentLng != null;
  const online      = typeof navigator === 'undefined' ? true : navigator.onLine;
  /* Son şans (Overpass) için kullanılabilir bir sokak sorgusu ÜRETİLEBİLİR Mİ.
     Ölçüm 2026-08-11: adlı sokaklarda üretilen regex şehir/mahalle önekini de
     içerdiği için OSM adıyla asla eşleşmiyor — o yüzden "üretildi" ile
     "kullanılabilir" AYNI ŞEY DEĞİL ve burada yalnız üretilebilirlik taşınır. */
  const fallbackQueryUsable = hadLocation ? extractStreetQuery(query) !== null : null;
  /** Doğrulama filtresinin bu çağrı boyunca eledİĞİ toplam sonuç. */
  let rejected = 0;
  /** Doğrulama filtresi HİÇ çalıştı mı — çalışmadıysa `rejectedCount` null kalır. */
  let filterRan = false;
  /** En az bir deneme fast-fail'e takıldı mı (ya da ağ hatası verdi mi). */
  let fastFailHit = false;

  const _offlineStage = (results: GeoResult[]): AddressSearchStage =>
    results.length === 0 ? 'NONE'
      : results[0].type === 'offline/history' ? 'LOCAL_HISTORY' : 'LOCAL_POI';

  const done = (results: GeoResult[], stage: AddressSearchStage): GeoResult[] =>
    _trace(results, {
      stage,
      rejectedCount: filterRan ? rejected : null,
      providerMs:    Date.now() - t0,
      fastFailHit,
      hadLocation,
      online,
      fallbackQueryUsable,
    });

  /* Hızlı yol: ağ bağlantısı yok → rate-limiter atlanır, anında offline */
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    const off = await _offlineFallback(query, currentLat, currentLng);
    return done(off, _offlineStage(off));
  }

  /* ── Premium sağlayıcı (BYOK) ÖNCE ────────────────────────────────────────
     Anahtar YOKSA hiç çağrılmaz ve davranış birebir eskisi gibidir. Anahtar
     varsa OSM'de ADI OLMAYAN sokaklar da çözülür — ölçülen kök sorun buydu
     (bkz. geocodingProviders.ts başlığındaki saha ölçümü). Fail-soft: sağlayıcı
     boş/hata dönerse aşağıdaki ücretsiz zincir aynen devam eder. */
  const premium = await premiumGeocode(query, currentLat, currentLng);
  if (premium.length) return done(premium, 'PREMIUM');

  const first = await _nominatimOnce(query, currentLat, currentLng);

  // null = timeout / ağ hatası → çevrimdışı yol (DAVRANIŞ DEĞİŞMEDİ).
  // Gevşetme YALNIZ "bağlandık ama 0 sonuç" durumunda anlamlıdır; ağ yokken
  // ek denemeler yalnız zaman kaybettirir.
  if (first === null) {
    /* Bekleme bırakıldı ya da ağ düştü — ikisi de bu dalda buluşur (çağıran
       ayırt edemez, bu yüzden tek bayrak). */
    fastFailHit = true;
    const off = await _offlineFallback(query, currentLat, currentLng);
    return done(off, _offlineStage(off));
  }

  // Numaralı sokak doğrulaması — istenen numarayı taşımayan sonuç CEVAP DEĞİLDİR.
  const firstOk = filterNumberedStreetMismatch(query, first);
  filterRan = true;
  rejected += first.length - firstOk.length;
  if (firstOk.length) return done(firstOk, 'NOMINATIM');

  /* 0 sonuç (veya hepsi yanlış sokak) → sorguyu BOZMADAN varyantları dene */
  for (const variant of relaxQueryVariants(query)) {
    const r = await _nominatimOnce(variant, currentLat, currentLng);
    if (r === null) { fastFailHit = true; break; }  // ağ bozuldu — merdiveni uzatma
    // Doğrulama İSTENEN sorguya göre yapılır (varyanta göre değil): varyant
    // numarayı düşürmüş olsa bile kullanıcı hâlâ o sokağı istiyor.
    const ok = filterNumberedStreetMismatch(query, r);
    rejected += r.length - ok.length;
    if (ok.length) {
      return done(ok.map((x) => ({ ...x, relaxed: true })), 'NOMINATIM_RELAXED');
    }
  }

  /* SON ŞANS — sokak/cadde ADIYLA doğrudan OSM'e sor.
     Nominatim numaralı Türk sokaklarını eşleştiremiyor (ölçüldü); Overpass
     aynı veriyi TAM eşleşmeyle veriyor. Fail-soft: hata/timeout → boş dizi,
     navigasyon bu yola bağımlı değildir. Konum yoksa hiç çağrılmaz. */
  const streets = await searchStreetByName(query, currentLat, currentLng);
  if (streets.length) return done(streets, 'OVERPASS_STREET');

  // Hâlâ yok: boş dön — çağıran (addressNavigationEngine) cihaz-içi aramayı
  // dener. Burada çevrimdışı yola sapmak o zinciri ikiye bölerdi.
  return done([], 'NONE');
}

/**
 * TEK Nominatim denemesi.
 * @returns sonuç dizisi (boş olabilir) · `null` = timeout veya ağ hatası
 */
/* ── GEÇ GELEN YANIT ÖNBELLEĞİ (saha 2026-08-08, Siverek) ────────────────────
 *
 * ÖLÇÜLEN KUSUR: `FAST_FAIL_MS` dolunca istek `ctrl.abort()` ile ÖLDÜRÜLÜYORDU.
 * Nominatim aynı sorguya doğru cevabı veriyordu (dört varyantta da
 * `leisure/park → Ofis Parkı, Ofis Mahallesi, Siverek` doğrulandı) — ama mobil
 * veride 2 saniyeyi aştığı için cevap çöpe gidiyor, ürün `_offlineFallback`'e
 * düşüyordu. Sürücünün gördüğü buydu: aradığı park yerine yalnız "Siverek" ve
 * 25 km ötedeki "Kışla" mahallesi. ("Siverek Otogarı"nın BİR KEZ görünmesi de
 * aynı teşhisi doğrular: o denemede yanıt 2 s'nin altında kalmış.)
 *
 * DÜZELTME: fast-fail artık yalnız BEKLEMEYİ bitirir, isteği İPTAL ETMEZ.
 * Çağıran anında çevrimdışı sonucu alır (yanıt hızı BİREBİR korunur); yanıt
 * geç de olsa gelince buraya yazılır ve bir sonraki tuş vuruşu/arama onu
 * ANINDA bulur. 8 saniyelik sert sınır tek gerçek üst sınır olarak KALIR.
 */
const LATE_CACHE_TTL_MS  = 5 * 60_000;
const LATE_CACHE_MAX     = 40;
const _lateCache = new Map<string, { at: number; results: GeoResult[] }>();

function _lateCacheGet(key: string): GeoResult[] | null {
  const hit = _lateCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > LATE_CACHE_TTL_MS) { _lateCache.delete(key); return null; }
  return hit.results;
}

function _lateCachePut(key: string, results: GeoResult[]): void {
  if (!results.length) return;                    // boş cevabı önbelleğe alma
  // Sınırlı boyut — en eski kayıt düşer (Map ekleme sırasını korur).
  if (_lateCache.size >= LATE_CACHE_MAX) {
    const oldest = _lateCache.keys().next().value;
    if (oldest !== undefined) _lateCache.delete(oldest);
  }
  _lateCache.set(key, { at: Date.now(), results });
}

/** Test izolasyonu — önbellek testler arasında sızmasın. */
export function _resetGeocodeLateCacheForTest(): void { _lateCache.clear(); }

async function _nominatimOnce(
  query:       string,
  currentLat?: number,
  currentLng?: number,
): Promise<GeoResult[] | null> {
  const params = new URLSearchParams({
    q:              query,
    format:         'json',
    limit:          '4',
    addressdetails: '0',
    countrycodes:   'tr',
  });

  if (currentLat != null && currentLng != null) {
    // ~80 km'lik viewbox — bias ama sınırlama değil (bounded=0 default)
    const d = 0.7;
    params.set('viewbox', `${currentLng - d},${currentLat - d},${currentLng + d},${currentLat + d}`);
    params.set('bounded', '0');
  }

  /* GEÇ GELEN YANIT: aynı sorgu daha önce (fast-fail'den SONRA) cevaplandıysa
     ağa hiç çıkmadan anında döner — sürücü ikinci denemede doğru POI'yi görür. */
  const cacheKey = params.toString();
  const cached   = _lateCacheGet(cacheKey);
  if (cached) return cached;

  /* Nominatim ToS rate-limiter — bozulmadan korunur */
  await _waitNominatim();

  const { ctrl, clear } = abort(TIMEOUT); // 8s Nominatim hard-abort

  /* Nominatim fetch — unhandled-rejection engeli için null'a indirgendi */
  const nominatimSafe = fetch(`${NOMINATIM}?${params}`, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'tr' },
    signal:  ctrl.signal,
  })
    .then(async (res): Promise<GeoResult[] | null> => {
      const data = (await res.json()) as NominatimItem[];
      return data.map((r) => ({
        id:       `nom-${r.place_id}`,
        name:     shortName(r.display_name),
        fullName: r.display_name,
        lat:      parseFloat(r.lat),
        lng:      parseFloat(r.lon),
        type:     `${r.class}/${r.type}`,
        source:   'online' as const,
      }));
    })
    .catch((): null => null) // network error veya AbortError → null
    /* Yanıt GEÇ gelse bile değerlidir: 8s sert sınır burada temizlenir ve
       sonuç önbelleğe yazılır. Bu `.then` fast-fail'den SONRA da koşar —
       istek artık iptal edilmediği için. */
    .then((v): GeoResult[] | null => {
      clear();
      if (v && v.length) _lateCachePut(cacheKey, v);
      return v;
    });

  /* 2s fast-fail — YALNIZ BEKLEMEYİ bitirir, isteği İPTAL ETMEZ.
     Eskiden burada `ctrl.abort()` vardı ve 2 saniyeyi aşan DOĞRU cevabı
     öldürüyordu (saha 2026-08-08: "Ofis Parkı" Nominatim'de vardı, ürün
     bulamıyordu). Üst sınır artık tek yerde: `abort(TIMEOUT)` = 8 s. */
  let fastFailTimer: ReturnType<typeof setTimeout> | null = null;
  const fastFailSafe = new Promise<null>((resolve) => {
    fastFailTimer = setTimeout(() => resolve(null), FAST_FAIL_MS);
  });

  try {
    // Nominatim kazandı → dizi (boş olabilir). null → fast-fail/ağ hatası;
    // çevrimdışı yola sapma kararı ÇAĞIRANA aittir (tek deneme sorumluluğu).
    return await Promise.race([nominatimSafe, fastFailSafe]);
  } finally {
    if (fastFailTimer !== null) clearTimeout(fastFailTimer);
    /* `clear()` BURADA ÇAĞRILMAZ: istek hâlâ uçuyor olabilir ve 8s sert
       sınırın yaşaması gerekir. Temizlik yukarıdaki `.then` içinde yapılır. */
  }
}

/* ── Nominatim reverse (koordinat → adres) ───────────────── */

interface NominatimReverseItem {
  display_name?: string;
  error?:        string;
}

/** Reverse geocoding toplam bütçesi (ms) — rate-limit beklemesi DAHİL. */
export const REVERSE_GEOCODE_TIMEOUT_MS = 3_000;

/**
 * Koordinattan kısa adres üretir ("Mahalle, İlçe"). Bulunamazsa/hata/timeout → **null**.
 *
 * SÖZLEŞME (çağıranlar buna güvenir):
 *  - RETRY YOK — tek deneme, sonsuz döngü riski yok.
 *  - BOUNDED — `timeoutMs` toplam bütçedir; Nominatim ToS rate-limit beklemesi de bu
 *    bütçeden harcanır, bütçe biterse istek HİÇ yapılmaz ve null döner (aşım olamaz).
 *  - THROW ETMEZ — ağ · HTTP · JSON parse · abort, hepsi null'a indirgenir.
 *  - Çevrimdışıyken (navigator.onLine === false) ağa HİÇ çıkılmaz → anında null.
 *  - LOG YOK: URL, koordinat, header ve yanıt gövdesi hiçbir yere yazılmaz (konum PII'dir;
 *    ayrıca diagnostic loglara hassas alan yazma yasağı — CLAUDE.md).
 */
export async function reverseGeocode(
  lat:       number,
  lng:       number,
  timeoutMs: number = REVERSE_GEOCODE_TIMEOUT_MS,
): Promise<string | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return null;

  const budget = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : REVERSE_GEOCODE_TIMEOUT_MS;
  const startedAt = Date.now();

  /* ToS rate-limiter — geocodeAddress ile AYNI kapı (1 req/sn) kullanılır ki iki yol
     birlikte limiti aşmasın. Bekleme bütçeden sayılır. */
  await _waitNominatim();

  const remaining = budget - (Date.now() - startedAt);
  if (remaining <= 0) return null;   // bütçe rate-limit beklemesinde bitti → istek YAPILMAZ

  const params = new URLSearchParams({
    lat:            String(lat),
    lon:            String(lng),
    format:         'json',
    zoom:           '16',            // ~mahalle/sokak ayrıntısı
    addressdetails: '0',
  });

  const { ctrl, clear } = abort(remaining);
  try {
    const res = await fetch(`${NOMINATIM_REVERSE}?${params}`, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'tr' },
      signal:  ctrl.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as NominatimReverseItem;
    const display = typeof data?.display_name === 'string' ? data.display_name.trim() : '';
    if (display.length === 0) return null;
    return shortName(display);
  } catch {
    return null;                     // ağ · abort · parse — hepsi sessiz null
  } finally {
    clear();
  }
}

/* ── Nominatim reverse — YAPILANDIRILMIŞ parçalar ────────── */

interface NominatimAddressDetail {
  road?: string; pedestrian?: string; footway?: string;
  neighbourhood?: string; suburb?: string; quarter?: string;
  town?: string; city?: string; city_district?: string;
  county?: string; province?: string; state?: string;
}

/** Koordinatın idari parçaları — bulunamayan alan `null` (uydurma YOK). */
export interface ReverseGeocodeParts {
  /** Yol / cadde adı (ör. "D330"). */
  readonly road: string | null;
  /** İlçe / semt (ör. "Meram"). */
  readonly district: string | null;
  /** Şehir / il (ör. "Konya"). */
  readonly city: string | null;
}

/**
 * `reverseGeocode`'un YAPILANDIRILMIŞ kardeşi — şehir/ilçe/yol AYRI alanlar.
 *
 * NEDEN AYRI BİR FONKSİYON: mevcut `reverseGeocode` `display_name`i ilk iki
 * virgül parçasına kısaltır ("Mahalle, İlçe") → **şehir bilgisi kaybolur** ve
 * dönüş tipi tek `string`tir. Mavi'nin bağlamı şehir/ilçe/yol'u AYRI ister.
 * Mevcut fonksiyonun sözleşmesi ve kilit testleri BOZULMASIN diye o dosyada
 * DEĞİŞTİRİLMEDİ; burada aynı uca `addressdetails=1` ile ek bir okuma yapılır.
 *
 * İKİNCİ SERVİS DEĞİLDİR: aynı modül, aynı uç, **aynı ToS rate-limiter**
 * (`_waitNominatim`) ve aynı bounded/fail-soft sözleşme kullanılır:
 *  - RETRY YOK · THROW ETMEZ · çevrimdışıyken ağa HİÇ çıkılmaz
 *  - bütçe rate-limit beklemesini DE kapsar
 *  - LOG YOK (konum PII'dir)
 */
export async function reverseGeocodeParts(
  lat:       number,
  lng:       number,
  timeoutMs: number = REVERSE_GEOCODE_TIMEOUT_MS,
): Promise<ReverseGeocodeParts | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  if (lat === 0 && lng === 0) return null;              // Null Island sentinel
  if (typeof navigator !== 'undefined' && !navigator.onLine) return null;

  const budget = Number.isFinite(timeoutMs) && timeoutMs > 0
    ? timeoutMs : REVERSE_GEOCODE_TIMEOUT_MS;
  const startedAt = Date.now();

  await _waitNominatim();

  const remaining = budget - (Date.now() - startedAt);
  if (remaining <= 0) return null;

  const params = new URLSearchParams({
    lat:            String(lat),
    lon:            String(lng),
    format:         'json',
    zoom:           '16',
    addressdetails: '1',
  });

  const { ctrl, clear } = abort(remaining);
  try {
    const res = await fetch(`${NOMINATIM_REVERSE}?${params}`, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'tr' },
      signal:  ctrl.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { address?: NominatimAddressDetail };
    const a = data?.address;
    if (!a || typeof a !== 'object') return null;

    const pick = (...keys: (keyof NominatimAddressDetail)[]): string | null => {
      for (const k of keys) {
        const v = a[k];
        if (typeof v === 'string' && v.trim().length > 0) return v.trim();
      }
      return null;
    };

    const parts: ReverseGeocodeParts = {
      road:     pick('road', 'pedestrian', 'footway'),
      district: pick('city_district', 'suburb', 'town', 'quarter', 'neighbourhood', 'county'),
      city:     pick('city', 'province', 'state'),
    };
    /* Hiçbir alan çözülemediyse "boş cevap" değil, CEVAPSIZ sayılır. */
    if (parts.road === null && parts.district === null && parts.city === null) return null;
    return parts;
  } catch {
    return null;
  } finally {
    clear();
  }
}

/* ── Overpass (nearby amenity) ───────────────────────────── */

interface OverpassElement {
  id:   number;
  lat?: number;
  lon?: number;
  tags?: {
    name?: string;
    brand?: string;
    operator?: string;
    amenity?: string;
  };
  center?: { lat: number; lon: number };
}

/**
 * Mevcut konuma yakın benzinlik / otopark / hastane ara — max 5 sonuç, 5 km yarıçap.
 *
 * NAVIGATION-P0-2: 'hospital' eklendi (amenity=hospital). Tüm tipler için
 * (fuel dahil — güvenli iyileştirme) koordinat doğrulaması eklendi:
 *   - 0,0 (Null Island) reddedilir
 *   - |lat|>90 veya |lng|>180 (sınır dışı) reddedilir
 *   - yuvarlanmış lat/lng ile tekilleştirilir (Overpass node+way aynı tesisi
 *     iki kez döndürebilir)
 */
export async function searchNearby(
  type:   'fuel' | 'parking' | 'hospital',
  lat:    number,
  lng:    number,
): Promise<GeoResult[]> {
  const amenity = type === 'fuel' ? 'fuel' : type === 'parking' ? 'parking' : 'hospital';
  const query   = `[out:json][timeout:10];(node[amenity=${amenity}](around:5000,${lat},${lng});way[amenity=${amenity}](around:5000,${lat},${lng}););out center 5;`;

  const { ctrl, clear } = abort(TIMEOUT);
  let data: { elements: OverpassElement[] };
  try {
    const res  = await fetch(`${OVERPASS}?data=${encodeURIComponent(query)}`, {
      headers: { 'User-Agent': UA },
      signal:  ctrl.signal,
    });
    data = (await res.json()) as { elements: OverpassElement[] };
  } finally {
    clear();
  }

  const results: GeoResult[] = [];
  const seen = new Set<string>();
  for (const el of data.elements) {
    const elLat = el.lat ?? el.center?.lat;
    const elLng = el.lon ?? el.center?.lon;
    if (elLat == null || elLng == null) continue;
    if (!Number.isFinite(elLat) || !Number.isFinite(elLng)) continue;   // malformed
    if (elLat === 0 && elLng === 0) continue;                          // Null Island reddi
    if (Math.abs(elLat) > 90 || Math.abs(elLng) > 180) continue;        // sınır-dışı reddi

    const dedupKey = `${elLat.toFixed(5)}_${elLng.toFixed(5)}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);

    const rawName  = el.tags?.name ?? el.tags?.brand ?? el.tags?.operator;
    const typeName = type === 'fuel' ? 'Benzinlik' : type === 'parking' ? 'Otopark' : 'Hastane';
    const name     = rawName ? String(rawName) : typeName;

    results.push({
      id:         `op-${el.id}`,
      name,
      fullName:   name,
      lat:        elLat,
      lng:        elLng,
      type:       amenity,
      distanceKm: Math.round(haversineKm(lat, lng, elLat, elLng) * 10) / 10,
    });
  }
  return results.sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0));
}
