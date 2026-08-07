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
 */

import { sensitiveKeyStore } from './sensitiveKeyStore';
import type { SensitiveKey } from './sensitiveKeyStore';
import type { GeoResult } from './geocodingService';

export type GeocodeProviderId = 'google' | 'here' | 'yandex';

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

/* ── Genel giriş noktası ────────────────────────────────────────────────── */

/**
 * Yapılandırılmış premium sağlayıcıyla adres çözer.
 * Sağlayıcı yok / hata / timeout / geçersiz koordinat → **boş dizi** (fail-soft):
 * çağıran ücretsiz OSM zincirine devam eder, kullanıcı hiçbir şey kaybetmez.
 */
export async function premiumGeocode(
  query: string, lat?: number, lng?: number,
): Promise<GeoResult[]> {
  const q = query.trim();
  if (!q) return [];
  const cfg = await getGeocodeProvider();
  if (!cfg) return [];

  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const hits =
      cfg.id === 'google' ? await _google(q, cfg.key, lat, lng, ctrl.signal)
      : cfg.id === 'here' ? await _here(q, cfg.key, lat, lng, ctrl.signal)
      :                     await _yandex(q, cfg.key, lat, lng, ctrl.signal);

    return hits
      .filter((h) => Number.isFinite(h.lat) && Number.isFinite(h.lng))
      .slice(0, MAX_HITS)
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
