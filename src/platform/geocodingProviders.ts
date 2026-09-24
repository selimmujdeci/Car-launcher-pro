/**
 * geocodingProviders — SAĞLAYICI-BAĞIMSIZ adres çözümleme katmanı (BYOK).
 *
 * ── NEDEN VAR (saha 2026-08-03) ────────────────────────────────────────────
 * Kullanıcı isteği: *"herhangi bir sokağa gidebilmeli — Google'ın yaptığını
 * yapamıyorsak uygulama çöp olur, OEM seviyesinde çöz."* Doğru istek; ama
 * sorunun yeri koddan ÖNCE VERİDİR ve bu ÖLÇÜLDÜ:
 *
 *   Hedef: "Tarsus Bağlar Mahallesi 0455. Sokak" (Google'da VAR)
 *   • Nominatim serbest metin  → istenen numara HİÇ dönmedi (rastgele sokaklar)
 *   • Nominatim yapılandırılmış → aynı sonuç
 *   • Overpass `highway[name]`  → 350 m çevrede 29 ADLI sokak var, 0455 YOK
 *   • Overpass `addr:street`    → aynı çevrede yalnız 2 adres etiketi, 0455 YOK
 *   • Aynı çevrede **41 ADSIZ yol** duruyor → yol OSM'de ÇİZİLİ ama İSİMSİZ.
 *
 * Yani Nominatim/Photon/Pelias dâhil TÜM ücretsiz OSM türevleri bu sokağı
 * bilmiyor; Google biliyor çünkü Türkiye adres verisini ayrıca lisanslıyor.
 * **Yazılımla kapatılabilecek bir açık değildir — veri satın alınır.**
 *
 * OEM ürünlerde bunun standart çözümü budur: üretici zaten bir harita/adres
 * verisi lisanslar (HERE · TomTom · Google · Yandex) ve ürün o sağlayıcıya
 * takılır. Bu modül o fişi sağlar: anahtar VARSA premium sağlayıcı ÖNCE
 * denenir, YOKSA ücretsiz OSM zinciri (Nominatim → gevşetme → Overpass sokak
 * → cihaz-içi POI/geçmiş) aynen çalışır. Anahtarsız davranış DEĞİŞMEZ.
 *
 * ── ⚖️ LİSANS UYARISI (CLAUDE.md ticari kural) ─────────────────────────────
 * Uygulamaya **gömülü/merkezi anahtar KONULMAZ** — her müşteri kendi
 * anahtarını ve kendi lisansını getirir (BYOK). Bu yalnız fatura değil
 * HUKUK meselesidir: sağlayıcıların çoğu geocoding sonucunun KENDİ harita
 * altlıkları dışında gösterilmesini kısıtlar (örn. Google Maps Platform
 * şartları "non-Google map" kullanımını yasaklar). Bu yüzden:
 *   • VARSAYILAN SAĞLAYICI YOKTUR (boş) — ürün kutudan ücretsiz OSM ile gelir.
 *   • Sağlayıcı seçmek ve şartlarına uymak müşterinin/üreticinin kararıdır.
 *   • Hiçbir sağlayıcı "önerilen" diye işaretlenmez.
 *
 * ⚠️ GELİŞTİRME İSTİSNASI (kullanıcı kararı 2026-09-24): derlemede
 * `VITE_TOMTOM_API_KEY` varsa ve kullanıcı anahtarı yoksa TomTom kullanılır
 * (rota/trafikle aynı anahtar). Bu bir SATIŞ yapılandırması DEĞİLDİR —
 * ticari sürümden önce anahtar `.env`den çıkarılır ya da lisans/proxy
 * kararı verilir (CLAUDE.md §12: lisans kanıtsızsa release'e uygun sayma).
 */

import { sensitiveKeyStore } from './sensitiveKeyStore';
import type { SensitiveKey } from './sensitiveKeyStore';
import type { GeoResult } from './geocodingService';
import { detectCitiesInQuery, haversineKm } from './geo/locationBiasGate';

export type GeocodeProviderId = 'google' | 'here' | 'yandex' | 'tomtom';

/**
 * Sağlayıcı sırası = ÖNCELİK. Birden çok anahtar kayıtlıysa üstteki kullanılır.
 * "Önerilen" işareti YOKTUR — hangi veriyi lisansladığı müşterinin kararıdır.
 */
export const GEOCODE_PROVIDERS: ReadonlyArray<{
  id: GeocodeProviderId; storeKey: SensitiveKey; label: string;
}> = [
  { id: 'google', storeKey: 'geocodeGoogleApiKey', label: 'Google Geocoding' },
  { id: 'here',   storeKey: 'geocodeHereApiKey',   label: 'HERE Geocoding'   },
  { id: 'yandex', storeKey: 'geocodeYandexApiKey', label: 'Yandex Geocoder'  },
];

/** Sağlayıcı çağrısı navigasyonu BEKLETMEZ — ücretsiz zincir zaten arkada. */
const TIMEOUT_MS = 5_000;
const MAX_HITS   = 4;
/** Numaralı sokak eşleşmesi bu mesafeden uzaksa ıskalama sayılır (varyant denenir). */
const NEAR_STREET_KM = 15;

/* ── Anahtar okuma (kısa ömürlü önbellek) ───────────────────────────────── */

interface ProviderConfig { id: GeocodeProviderId; key: string; }

let _cache: { at: number; cfg: ProviderConfig | null } | null = null;
const _CACHE_MS = 30_000;

/** Ayarlar değişince önbelleği düşür (ayar ekranı çağırır). */
export function invalidateGeocodeProviderCache(): void { _cache = null; }

/**
 * Yapılandırılmış sağlayıcı; yoksa `null`.
 * Anahtarın kendisi ASLA loglanmaz/LAB'a taşınmaz — yalnız VAR/YOK bilgisi.
 */
export async function getGeocodeProvider(): Promise<ProviderConfig | null> {
  const now = Date.now();
  if (_cache && now - _cache.at < _CACHE_MS) return _cache.cfg;

  let cfg: ProviderConfig | null = null;
  try {
    // Öncelik sırası GEOCODE_PROVIDERS dizisidir — ilk KAYITLI anahtar kazanır.
    for (const p of GEOCODE_PROVIDERS) {
      const key = (await sensitiveKeyStore.get(p.storeKey)).trim();
      if (key) { cfg = { id: p.id, key }; break; }
    }
  } catch {
    cfg = null; // depo hatası → ücretsiz zincir (fail-soft)
  }
  /* Kullanıcı anahtarı yoksa: derlemeye verilmiş TomTom anahtarı (rota/trafikle
     AYNI anahtar, kullanıcı kararı 2026-09-24). Satışta `.env`den silinince
     bu dal kendiliğinden kapanır ve ücretsiz OSM zinciri aynen çalışır. */
  if (!cfg) {
    const tt = (import.meta.env['VITE_TOMTOM_API_KEY'] as string | undefined)?.trim();
    if (tt) cfg = { id: 'tomtom', key: tt };
  }
  _cache = { at: now, cfg };
  return cfg;
}

/** Salt-okunur gözlem: anahtar VAR mı, hangi sağlayıcı? (Anahtar DEĞERİ yok.) */
export async function getGeocodeProviderStatus(): Promise<{ provider: string; hasKey: boolean }> {
  const cfg = await getGeocodeProvider();
  return { provider: cfg?.id ?? 'NONE', hasKey: !!cfg };
}

/* ── Sağlayıcı adaptörleri ──────────────────────────────────────────────── */

interface RawHit { name: string; full: string; lat: number; lng: number; }

async function _fetchJson(url: string, signal: AbortSignal): Promise<unknown | null> {
  try {
    const res = await fetch(url, { signal, headers: { 'Accept-Language': 'tr' } });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

function _num(v: unknown): number { return typeof v === 'number' ? v : NaN; }

async function _google(q: string, key: string, lat: number | undefined, lng: number | undefined, signal: AbortSignal): Promise<RawHit[]> {
  const p = new URLSearchParams({ address: q, key, language: 'tr', region: 'tr' });
  if (lat != null && lng != null) p.set('bounds', `${lat - 0.5},${lng - 0.5}|${lat + 0.5},${lng + 0.5}`);
  const j = await _fetchJson(`https://maps.googleapis.com/maps/api/geocode/json?${p}`, signal) as
    { status?: string; results?: Array<{ formatted_address?: string; geometry?: { location?: { lat?: number; lng?: number } } }> } | null;
  if (!j || j.status !== 'OK') return [];
  return (j.results ?? []).map((r) => ({
    name: (r.formatted_address ?? '').split(',')[0] || q,
    full: r.formatted_address ?? q,
    lat:  _num(r.geometry?.location?.lat),
    lng:  _num(r.geometry?.location?.lng),
  }));
}

async function _here(q: string, key: string, lat: number | undefined, lng: number | undefined, signal: AbortSignal): Promise<RawHit[]> {
  const p = new URLSearchParams({ q, apiKey: key, lang: 'tr-TR', limit: String(MAX_HITS) });
  if (lat != null && lng != null) p.set('at', `${lat},${lng}`);
  const j = await _fetchJson(`https://geocode.search.hereapi.com/v1/geocode?${p}`, signal) as
    { items?: Array<{ title?: string; address?: { label?: string }; position?: { lat?: number; lng?: number } }> } | null;
  if (!j) return [];
  return (j.items ?? []).map((r) => ({
    name: r.title ?? q,
    full: r.address?.label ?? r.title ?? q,
    lat:  _num(r.position?.lat),
    lng:  _num(r.position?.lng),
  }));
}

async function _yandex(q: string, key: string, lat: number | undefined, lng: number | undefined, signal: AbortSignal): Promise<RawHit[]> {
  const p = new URLSearchParams({ apikey: key, geocode: q, format: 'json', lang: 'tr_TR', results: String(MAX_HITS) });
  if (lat != null && lng != null) { p.set('ll', `${lng},${lat}`); p.set('spn', '0.6,0.6'); }
  const j = await _fetchJson(`https://geocode-maps.yandex.ru/1.x/?${p}`, signal) as
    { response?: { GeoObjectCollection?: { featureMember?: Array<{ GeoObject?: { name?: string; description?: string; Point?: { pos?: string } } }> } } } | null;
  const members = j?.response?.GeoObjectCollection?.featureMember ?? [];
  const out: RawHit[] = [];
  for (const m of members) {
    const g = m.GeoObject;
    const pos = (g?.Point?.pos ?? '').split(' ');            // "lon lat"
    if (pos.length !== 2) continue;
    out.push({
      name: g?.name ?? q,
      full: g?.description ? `${g.name}, ${g.description}` : (g?.name ?? q),
      lat:  parseFloat(pos[1]),
      lng:  parseFloat(pos[0]),
    });
  }
  return out;
}

/**
 * TomTom Fuzzy Search — adres (ev numarasına kadar) + POI tek sorguda.
 * Konum verilirse yakındakiler öne alınır. Koordinat olarak varsa ANA GİRİŞ
 * noktası kullanılır (bina/AVM içi değil, yoldan erişilen kapı → rota oraya biter).
 * Ölçüldü (2026-09-24): "Atatürk Caddesi 45 Tarsus", "Atatürk Bulvarı 120 Ankara"
 * ev numarasıyla bulundu; Nominatim yalnız caddeyi / yanlış binayı verdi.
 */
async function _tomtom(
  q: string, key: string, lat: number | undefined, lng: number | undefined, signal: AbortSignal,
  opts: PremiumGeocodeOptions = {},
): Promise<RawHit[]> {
  const p = new URLSearchParams({
    key, countrySet: 'TR', language: 'tr-TR',
    limit: String(opts.limit ?? MAX_HITS), typeahead: opts.typeahead ? 'true' : 'false',
  });
  if (lat != null && lng != null) { p.set('lat', String(lat)); p.set('lon', String(lng)); }
  const j = await _fetchJson(`https://api.tomtom.com/search/2/search/${encodeURIComponent(q)}.json?${p}`, signal) as
    { results?: Array<{
      poi?: { name?: string };
      address?: { freeformAddress?: string; streetName?: string; streetNumber?: string };
      position?: { lat?: number; lon?: number };
      entryPoints?: Array<{ type?: string; position?: { lat?: number; lon?: number } }>;
    }> } | null;
  if (!j) return [];
  return (j.results ?? []).map((r) => {
    const entry = r.entryPoints?.find((e) => e.type === 'main')?.position ?? r.entryPoints?.[0]?.position;
    const pos = entry ?? r.position;
    const addr = r.address?.freeformAddress ?? '';
    const street = [r.address?.streetName, r.address?.streetNumber].filter(Boolean).join(' ');
    const name = r.poi?.name ?? (street || addr.split(',')[0] || q);
    return {
      name,
      full: r.poi?.name ? `${r.poi.name}, ${addr}` : (addr || name),
      lat: _num(pos?.lat),
      lng: _num(pos?.lon),
    };
  });
}

/* ── Türkiye adres sorgusu yardımcıları (SAF, test edilir) ──────────────────
 * Ölçüldü (2026-09-24, TomTom):
 *  · "0455 sk no 5/2" → TomTom daire numarasını (2) bina sanıp 2'yi öne koydu.
 *  · "455 sokak Tarsus" → Tarsus'ta sokaklar "0455" yazılır; sıfırsız sorgu
 *    başka köylerin "Sokak 455" adreslerini getirdi (sesli komut "dört yüz elli
 *    beş" → "455" yazıya dökülür).
 *  · "Cumhuriyet Mah. 3108 Sk. No:14" → sokak başka mahallede; mahalle yanlış
 *    olunca hiç bulunamadı, mahalle çıkarılınca bulundu. */

const _TR_NUM: Readonly<Record<string, number>> = {
  'sıfır': 0, 'bir': 1, 'iki': 2, 'üç': 3, 'dört': 4, 'beş': 5, 'altı': 6, 'yedi': 7, 'sekiz': 8, 'dokuz': 9,
  'on': 10, 'yirmi': 20, 'otuz': 30, 'kırk': 40, 'elli': 50, 'altmış': 60, 'yetmiş': 70, 'seksen': 80, 'doksan': 90,
  'yüz': 100, 'bin': 1000,
};
const _NUM_CONTEXT = /^(?:sokak|sokağı|sok|sk|cadde|caddesi|cad|cd|numara|no|bulvarı|bulvar)$/;

/**
 * Sesli komutta söylenen sayıları rakama çevirir: "dört yüz elli beş sokak" →
 * "455 sokak", "sıfır dört yüz elli beş" → "0455". "On Nisan Caddesi" gibi
 * adları BOZMAMAK için yalnız ≥2 ardışık sayı sözcüğü ya da ardından
 * sokak/cadde/numara gelen TEK sayı sözcüğü çevrilir.
 */
export function trNumberWordsToDigits(q: string): string {
  const toks = q.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let i = 0;
  while (i < toks.length) {
    let j = i;
    while (j < toks.length && _TR_NUM[toks[j]!.toLocaleLowerCase('tr')] !== undefined) j++;
    const run = toks.slice(i, j).map((t) => t.toLocaleLowerCase('tr'));
    const next = toks[j]?.toLocaleLowerCase('tr').replace(/[.:]$/, '') ?? '';
    const prev = (out[out.length - 1] ?? '').toLocaleLowerCase('tr').replace(/[.:]$/, '');
    const single = run.length === 1 && (_NUM_CONTEXT.test(next) || prev === 'numara' || prev === 'no');
    if (run.length >= 2 || single) {
      let lead = '';
      let k = 0;
      while (k < run.length - 1 && run[k] === 'sıfır') { lead += '0'; k++; }
      let total = 0; let cur = 0;
      for (const w of run.slice(k)) {
        const v = _TR_NUM[w]!;
        if (v === 100) cur = (cur || 1) * 100;
        else if (v === 1000) { total += (cur || 1) * 1000; cur = 0; }
        else cur += v;
      }
      out.push(lead + String(total + cur));
      i = j;
    } else if (run.length === 1) {
      out.push(toks[i]!); i++;
    } else {
      out.push(toks[i]!); i++;
    }
  }
  return out.join(' ');
}

/** Bina/daire yazımını sadeleştirir: "No:5/2" → "No 5", "5 / 3" → "5". */
export function normalizeTrAddressQuery(q: string): string {
  return trNumberWordsToDigits(q)
    .replace(/(^|\s)numara(\s|$)/gi, '$1No$2')
    .replace(/(^|\s)(no)\s*[:.]\s*/gi, '$1$2 ')
    .replace(/(\d+)\s*\/\s*\d+[a-zA-Z]?/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/* JS `\b` Türkçe harfleri kelime saymaz ("sokağı") → sınır açık yazılır. */
const _STREET_WORD = '(?:sokağı|sokak|sok|sk|caddesi|cadde|cad|cd)';
const _END = '(?=$|[\\s.,;:/&)])';

/** Sorgudaki numaralı sokak/cadde numarası (baştaki sıfırsız); yoksa `null`. */
export function numberedStreetOf(q: string): string | null {
  const m = new RegExp(`(?:^|\\s)0*(\\d{1,5})\\.?\\s*${_STREET_WORD}${_END}`, 'i').exec(q);
  return m ? m[1]! : null;
}

/** Sonuç metni bu numaralı sokağı içeriyor mu ("0455. Sokak" = "455 sokak"). */
export function mentionsNumberedStreet(text: string, n: string): boolean {
  return new RegExp(`(?:^|[\\s,&])0*${n}\\.?\\s*${_STREET_WORD}${_END}`, 'i').test(text);
}

/**
 * Numaralı sokak bulunamazsa denenecek varyantlar (sırayla, en fazla 2):
 *  1. Sokak numarası 4 haneye sıfırla tamamlanır ("455" → "0455").
 *  2. Mahalle kısmı çıkarılır (yanlış mahalle sokağı gizlemesin).
 */
export function numberedStreetVariants(q: string): string[] {
  const n = numberedStreetOf(q);
  if (!n) return [];
  const out: string[] = [];
  if (n.length < 4) {
    const padded = n.padStart(4, '0');
    const v = q.replace(new RegExp(`(^|\\s)0*${n}(\\.?\\s*${_STREET_WORD}${_END})`, 'i'), `$1${padded}$2`);
    if (v !== q) out.push(v);
  }
  const noMah = q.replace(/\S+\s+(?:mahallesi|mahalle|mah\.?|mh\.?)(?=\s|$)/i, ' ').replace(/\s+/g, ' ').trim();
  if (noMah !== q && noMah.length >= 3) out.push(noMah);
  return out;
}

export interface PremiumGeocodeOptions {
  /** Yazarken öneri (yarım kelime) — harita arama çubuğu. */
  readonly typeahead?: boolean;
  /** Sonuç sınırı (varsayılan 4). */
  readonly limit?: number;
}

/* ── Genel giriş noktası ────────────────────────────────────────────────── */

/**
 * Yapılandırılmış premium sağlayıcıyla adres çözer.
 * Sağlayıcı yok / hata / timeout / geçersiz koordinat → **boş dizi** (fail-soft):
 * çağıran ücretsiz OSM zincirine devam eder, kullanıcı hiçbir şey kaybetmez.
 */
export async function premiumGeocode(
  query: string, lat?: number, lng?: number, opts: PremiumGeocodeOptions = {},
): Promise<GeoResult[]> {
  const q = normalizeTrAddressQuery(query);
  if (!q) return [];
  const cfg = await getGeocodeProvider();
  if (!cfg) return [];

  /* Sorguda BAŞKA bir il adı geçiyorsa ("… Ankara") konum yanlılığı KAPATILIR —
     ölçüldü: Tarsus'tayken "Atatürk Bulvarı 120 Ankara" ilk sırada Tarsus'u getirdi. */
  if (detectCitiesInQuery(q).length > 0) { lat = undefined; lng = undefined; }
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const limit = opts.limit ?? MAX_HITS;
  const run = (text: string): Promise<RawHit[]> =>
    cfg.id === 'google' ? _google(text, cfg.key, lat, lng, ctrl.signal)
      : cfg.id === 'here' ? _here(text, cfg.key, lat, lng, ctrl.signal)
      : cfg.id === 'tomtom' ? _tomtom(text, cfg.key, lat, lng, ctrl.signal, opts)
      :                     _yandex(text, cfg.key, lat, lng, ctrl.signal);
  try {
    let hits = await run(q);
    /* Numaralı sokak istendi ama hiçbir sonuç o sokağı içermiyorsa varyantlar
       denenir (yalnız ISKALAMADA ek istek → kota korunur). Bulunan varyantın
       sokağı içeren sonuçları başa alınır; bulunamazsa ilk sonuçlar aynen döner
       (sonraki numara filtresi yanlışları zaten eler). */
    /* Cihazda ölçüldü (2026-09-24): Tarsus'ta "455 sokak" → Adana'daki
       "455. Sokak" (43 km) eşleşme sayıldı, 16 m'deki "0455. Sokak" hiç
       sorulmadı. Eşleşme yalnız konuma YAKINSA (≤ NEAR_STREET_KM) ıskalama
       değildir. Yazarken yalnız sıfırlı varyant denenir (kota). */
    const n = numberedStreetOf(q);
    const nearHere = (h: RawHit): boolean =>
      lat == null || lng == null || haversineKm(lat, lng, h.lat, h.lng) <= NEAR_STREET_KM;
    if (n && !hits.some((h) => mentionsNumberedStreet(h.full, n) && nearHere(h))) {
      const variants = numberedStreetVariants(q);
      for (const v of opts.typeahead ? variants.slice(0, n.length < 4 ? 1 : 0) : variants) {
        const vh = await run(v);
        const good = vh.filter((h) => mentionsNumberedStreet(h.full, n));
        if (good.length > 0) { hits = [...good, ...hits]; break; }
      }
    }

    return hits
      .filter((h) => Number.isFinite(h.lat) && Number.isFinite(h.lng))
      .slice(0, limit)
      .map((h, i) => ({
        id:       `geo-${cfg.id}-${i}-${h.lat.toFixed(5)},${h.lng.toFixed(5)}`,
        name:     h.name,
        fullName: h.full,
        lat:      h.lat,
        lng:      h.lng,
        type:     `provider/${cfg.id}`,
        source:   'online' as const,
      }));
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}
