/**
 * overpassCategorySearch — KATEGORİ + YARIÇAP araması (çevrimiçi, fail-soft).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NEDEN VAR (canlı ölçüm · 2026-08-23, Tarsus 36.9175/34.8621) ──────────
 * ══════════════════════════════════════════════════════════════════════════
 * Nominatim serbest metin araması KATEGORİ SORAMAZ; yalnız ADI sorguya benzeyen
 * yerleri döndürür. Ölçüldü:
 *
 *   "pastane" → Nominatim: 5 aday, en yakını **372 km** (hepsinin ADI "Pastane")
 *               Overpass `shop~^(pastry|bakery|confectionery)$` 5 km:
 *                 Kardeşler Fırını 1,79 km · Florya Pastanesi 2,17 km ·
 *                 Tarsus Bel. Ekmek Fabrikası 2,19 km · Flamingo Pastanesi 2,23 km
 *   "eczane"  → Nominatim: en yakını **231 km** (Lefkoşa), listede Musul/Irak var
 *               Overpass `amenity=pharmacy` 2 km: **8 eczane**, en yakını 1,39 km
 *               (5 km yarıçapta **101** eczane)
 *   "Şok Market" → Nominatim: en yakını 372 km, listede **Köln/Almanya 2706 km**
 *               Overpass `shop~^(supermarket|…)$` 4 km: **Şok 0,85 km** [supermarket]
 *
 * ── NEDEN AD ARAMASI YOK (ölçüm tasarımı ÇÜRÜTTÜ) ─────────────────────────
 * İlk tasarım Overpass'e "ad regex'i" ile de sormayı öngörüyordu. Ölçüldü ve
 * ATILDI: Türkçe harf sınıflarıyla (`[sş][oö]k`) kurulan ad sorgusu
 * **50,2 sn** sürdü ve **0 sonuç** döndürdü (Overpass ad indeksini harf
 * sınıfında kullanamıyor). Aynı yeri kategori sorgusu **0,85 km**'de ve
 * saniyeler içinde buluyor. İşletme ADI araması bu yüzden Nominatim'e
 * (viewbox yanlılığıyla) bırakılır; Overpass yalnız KATEGORİ sorar.
 *
 * ── SINIRLAR (dürüstlük) ──────────────────────────────────────────────────
 * • Konum ŞARTTIR (yarıçap sorgusu). Konum yoksa sorgu YAPILMAZ.
 * • Halka açık Overpass **429 (rate limit)** döndürebilir — ölçüldü. Bu durumda
 *   modül SOĞUMAYA girer ve süre dolana kadar ağa hiç çıkmaz; arama çökmez,
 *   diğer katmanlar aynen çalışır.
 * • Hata / timeout / HTML yanıt → **boş dizi**. Navigasyon bu yola BAĞIMLI DEĞİL.
 */

import type { PlaceCategoryDef } from './placeQueryModel';

/** Overpass ortak uç noktası — `streetSearchService` ile AYNI. */
const OVERPASS = 'https://overpass-api.de/api/interpreter';
const UA       = 'CarOSPro/1.0 (vehicle navigation)';

/**
 * Tek çağrı üst sınırı (ms).
 *
 * ÖLÇÜM (aynı nokta, halka açık sunucu):
 *   pastane  (1 etiket, node+way, 5 km) → **1425 ms** / 5 kayıt
 *   market   (4 etiket, node+way, 4 km) → **11 721 ms** / 30 kayıt  ❌
 *   market   + `qt` sıralamasıyla       → **5014 ms** / 30 kayıt    ✅
 * `qt` (quadtile) çıktı sıralamasını ucuzlatır; SIRALAMAYI zaten
 * `placeQueryModel` yaptığı için Overpass'in sıralamasına ihtiyacımız YOK.
 * 7 sn: ölçülen en ağır kategori (5,0 sn) için pay bırakır, arama çubuğunu
 * da kilitlemez — cihaz-içi katmanlar zaten `onPartial` ile boyanmıştır.
 */
export const OVERPASS_CATEGORY_TIMEOUT_MS = 7_000;

/** Tek sorgudan alınacak en fazla kayıt — sıralamayı `placeQueryModel` yapar. */
const MAX_ELEMENTS = 25;

/**
 * 429 sonrası soğuma. Halka açık Overpass'i zorlamak hem bizi hem başkalarını
 * bloklar; ölçümde art arda sorgu **HTTP 429** üretti.
 */
export const OVERPASS_COOLDOWN_MS = 60_000;

/** Sonuç önbelleği — aynı kategori+konum için tuş vuruşu başına ağa çıkılmaz. */
const CACHE_TTL_MS = 5 * 60_000;
const CACHE_MAX    = 24;

/* ── Modül durumu (bounded) ─────────────────────────────────────────────── */

interface CacheEntry { readonly at: number; readonly hits: readonly OverpassPlace[]; }

const _cache = new Map<string, CacheEntry>();
let _cooldownUntil = 0;
/** Aynı anahtara eşzamanlı iki istek → tek ağ çağrısı. */
const _inflight = new Map<string, Promise<OverpassPlace[]>>();

/** Test izolasyonu — modül durumu testler arasında SIZMASIN. */
export function _resetOverpassCategoryStateForTest(): void {
  _cache.clear();
  _inflight.clear();
  _cooldownUntil = 0;
}

/** Salt-okunur gözlem (CAROS LAB) — ağa çıkılabilir mi, önbellekte ne var. */
export interface OverpassCategoryStatus {
  readonly cachedKeys: number;
  readonly inflight: number;
  /** Soğumanın bitmesine kalan ms; soğuma yoksa 0. */
  readonly cooldownRemainingMs: number;
}

export function readOverpassCategoryStatus(now: number = Date.now()): OverpassCategoryStatus {
  return {
    cachedKeys:          _cache.size,
    inflight:            _inflight.size,
    cooldownRemainingMs: Math.max(0, _cooldownUntil - now),
  };
}

/* ── Tipler ─────────────────────────────────────────────────────────────── */

export interface OverpassPlace {
  readonly id: string;
  readonly name: string;
  readonly address: string;
  readonly lat: number;
  readonly lng: number;
  /** Sorgulanan kanonik kategori kimliği — KANITLI (etiketten gelir). */
  readonly categoryId: string;
}

interface OverpassElement {
  id?: number;
  type?: string;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

/* ── Yardımcılar ────────────────────────────────────────────────────────── */

/** Koordinat gerçekten kullanılabilir mi (Null Island ve sınır-dışı reddi). */
function _validCoord(lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat === 0 && lng === 0) return false;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return false;
  return true;
}

/**
 * Etiketlerden GÖSTERİLEBİLİR bir ad üretir.
 *
 * ADSIZ kayda kategori adı YAZILMAZ — "Pastane" diye bir ad uydurmak
 * `poi.db` üreticisinin de reddettiği davranıştır (bkz. build-poi-db.mjs:
 * "ADSIZ POI ARANAMAZ"). Adsız kayıt ATILIR; ölçümde 5 pastaneden 1'i adsızdı.
 */
function _displayName(tags: Record<string, string> | undefined): string | null {
  const n = tags?.['name'] ?? tags?.['brand'] ?? tags?.['operator'];
  const s = typeof n === 'string' ? n.trim() : '';
  return s.length > 0 ? s : null;
}

/** Kısa adres — yalnız etiketten gelen bilgi (uydurma YOK). */
function _address(tags: Record<string, string> | undefined): string {
  if (!tags) return '';
  const street = tags['addr:street'];
  const num    = tags['addr:housenumber'];
  const city   = tags['addr:city'] ?? tags['addr:district'] ?? tags['addr:province'];
  const parts: string[] = [];
  if (street) parts.push(num ? `${street} ${num}` : street);
  if (city) parts.push(city);
  return parts.join(', ');
}

/** Konum anahtarı — ~1,1 km'lik hücre; sürücü hareket ederken önbellek tutar. */
function _cellKey(lat: number, lng: number): string {
  return `${lat.toFixed(2)}_${lng.toFixed(2)}`;
}

function _cacheGet(key: string, now: number): readonly OverpassPlace[] | null {
  const hit = _cache.get(key);
  if (!hit) return null;
  if (now - hit.at > CACHE_TTL_MS) { _cache.delete(key); return null; }
  return hit.hits;
}

function _cachePut(key: string, hits: readonly OverpassPlace[], now: number): void {
  if (_cache.size >= CACHE_MAX) {
    const oldest = _cache.keys().next().value;
    if (oldest !== undefined) _cache.delete(oldest);
  }
  _cache.set(key, { at: now, hits });
}

/* ── Sorgu kurulumu ─────────────────────────────────────────────────────── */

/**
 * Overpass QL metnini kurar.
 *
 * ⚠️ Kullanıcı metni buraya ASLA girmez: yalnız `PLACE_CATEGORIES` içindeki
 * SABİT etiket süzgeçleri ve sayısal koordinat/yarıçap gömülür (enjeksiyon
 * yüzeyi yok). Saf fonksiyon — test edilebilir.
 */
export function buildCategoryQl(
  tags: readonly string[],
  lat: number,
  lng: number,
  radiusM: number,
  budgetMs: number = OVERPASS_CATEGORY_TIMEOUT_MS,
): string {
  const around = `around:${Math.round(radiusM)},${lat.toFixed(5)},${lng.toFixed(5)}`;
  const clauses = tags
    .map((t) => `node[${t}](${around});way[${t}](${around});`)
    .join('');
  const secs = Math.max(3, Math.round(budgetMs / 1000));
  /* `qt` = quadtile sıralaması (ölçüldü: ağır kategoride 11,7 sn → 5,0 sn).
     Sonuç sırası bizim için ÖNEMSİZDİR — sıralamayı `placeQueryModel` yapar. */
  return `[out:json][timeout:${secs}];(${clauses});out center qt ${MAX_ELEMENTS};`;
}

/**
 * Yarıçap büyütme çarpanı. İlk deneme 0 sonuç döndüyse SEYREK bir bölgedeyiz
 * demektir (şehirde 4 km'de 101 eczane var, kırda 0). Seyrek bölgede sorgu
 * UCUZDUR — bu yüzden büyütmenin bedeli düşüktür ve ölçüm bunu doğrular.
 */
export const RADIUS_ESCALATION = 3;

/** İkinci denemeye girmek için gereken en az kalan bütçe (ms). */
const ESCALATION_MIN_BUDGET_MS = 1_500;

/** TEK Overpass denemesi. Ortak SON TARİHE uyar; hata → `null` (soğuma için). */
async function _fetchOnce(
  category: PlaceCategoryDef,
  lat: number,
  lng: number,
  radiusM: number,
  deadline: number,
): Promise<OverpassPlace[] | null> {
  const budget = deadline - Date.now();
  if (budget <= 0) return null;

  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), budget);
  try {
    const ql  = buildCategoryQl(category.tags, lat, lng, radiusM, budget);
    const res = await fetch(OVERPASS, {
      method:  'POST',
      headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    `data=${encodeURIComponent(ql)}`,
      signal:  ctrl.signal,
    });

    /* 429 = hız sınırı (ölçüldü). Soğumaya gir; ürünü ZORLAMA. */
    if (res.status === 429 || res.status === 504) {
      _cooldownUntil = Date.now() + OVERPASS_COOLDOWN_MS;
      return null;
    }
    if (!res.ok) return null;

    /* Overpass meşgulken JSON değil HTML hata sayfası döner → parse patlamasın. */
    const text = await res.text();
    if (!text.startsWith('{')) return null;

    const data = JSON.parse(text) as { elements?: OverpassElement[] };
    const out: OverpassPlace[] = [];
    const seen = new Set<string>();

    for (const el of data.elements ?? []) {
      const elLat = el.lat ?? el.center?.lat;
      const elLng = el.lon ?? el.center?.lon;
      if (elLat == null || elLng == null) continue;
      if (!_validCoord(elLat, elLng)) continue;

      const name = _displayName(el.tags);
      if (name === null) continue;                 // adsız kayda ad UYDURULMAZ

      const dedupe = `${elLat.toFixed(5)}_${elLng.toFixed(5)}`;
      if (seen.has(dedupe)) continue;              // node+way aynı tesisi verebilir
      seen.add(dedupe);

      out.push({
        id:         `op-${el.type ?? 'n'}-${el.id ?? dedupe}`,
        name,
        address:    _address(el.tags),
        lat:        elLat,
        lng:        elLng,
        categoryId: category.id,
      });
    }
    return out;
  } catch {
    return null;                                   // ağ · abort · parse — fail-soft
  } finally {
    clearTimeout(timer);
  }
}

/* ── Genel giriş noktası ────────────────────────────────────────────────── */

/**
 * Kategoriye göre yakındaki yerleri getirir.
 *
 * Sözleşme (çağıranlar buna güvenir):
 *  · THROW ETMEZ — ağ · HTTP · 429 · HTML yanıt · JSON parse · abort → `[]`.
 *  · Konum geçersizse ağa HİÇ çıkılmaz → `[]`.
 *  · `navigator.onLine === false` iken ağa HİÇ çıkılmaz → `[]`.
 *  · 429 sonrası `OVERPASS_COOLDOWN_MS` boyunca ağa çıkılmaz → `[]`.
 *  · Aynı kategori+hücre için sonuç `CACHE_TTL_MS` önbelleklenir.
 *  · Adsız kayıtlar ATILIR (uydurma ad YASAK).
 */
export async function searchCategoryNearby(
  category: PlaceCategoryDef,
  lat: number,
  lng: number,
  radiusM: number = category.radiusM,
): Promise<OverpassPlace[]> {
  if (!_validCoord(lat, lng)) return [];
  /* YALNIZ AÇIKÇA `false` çevrimdışıdır. `!navigator.onLine` yazılsaydı, bayrağı
     TANIMLAMAYAN çalışma zamanlarında (ölçüldü: Node 24 `navigator.onLine`
     === undefined) katman sessizce KAPANIRDI — "bilmiyoruz" ≠ "internet yok".
     Yanlış tarafa düşmek bedava değil: hata zaten `[]`e indirgeniyor. */
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return [];

  const now = Date.now();
  if (now < _cooldownUntil) return [];

  const key = `${category.id}|${_cellKey(lat, lng)}|${Math.round(radiusM)}`;

  const cached = _cacheGet(key, now);
  if (cached) return cached.slice();

  const pending = _inflight.get(key);
  if (pending) return pending.then((r) => r.slice());

  const run = (async (): Promise<OverpassPlace[]> => {
    /* ORTAK SON TARİH: iki deneme birlikte bu bütçeyi AŞAMAZ. Yoğun bölgede
       ilk deneme bütçeyi bitirir (zaten sonuç oradadır); seyrek bölgede hızlı
       0 döner ve kalan bütçeyle yarıçap büyütülür. Kendi kendini dengeler. */
    const deadline = Date.now() + OVERPASS_CATEGORY_TIMEOUT_MS;
    try {
      let hits = await _fetchOnce(category, lat, lng, radiusM, deadline);

      /* Sıfır sonuç + hâlâ bütçe VAR → seyrek bölge; yarıçapı büyüt.
         `null` (hata/timeout/429) bu dala GİRMEZ: "sorgu düştü" ile
         "burada gerçekten yok" AYNI ŞEY DEĞİLDİR. */
      if (hits !== null && hits.length === 0
          && Date.now() < deadline - ESCALATION_MIN_BUDGET_MS) {
        const wider = await _fetchOnce(category, lat, lng, radiusM * RADIUS_ESCALATION, deadline);
        if (wider !== null) hits = wider;
      }

      const out = hits ?? [];
      if (hits !== null) _cachePut(key, out, Date.now());   // hatayı ÖNBELLEĞE ALMA
      return out;
    } finally {
      _inflight.delete(key);
    }
  })();

  _inflight.set(key, run);
  return run.then((r) => r.slice());
}
