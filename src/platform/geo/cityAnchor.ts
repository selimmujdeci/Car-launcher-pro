/**
 * cityAnchor — SORGUDA ADI GEÇEN ŞEHRİN merkez koordinatı (ÇAPA).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NEDEN VAR (P0-NAV-07 · canlı ölçüm 2026-08-23) ────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * `streetSearchService` sokağı KULLANICININ ÇEVRESİNDE arıyordu (20 km).
 * Bu, "yakın POI" için doğru; **hedef adres** için yanlıştır: Tarsus'taki bir
 * sürücü Mersin'deki caddeyi arayabilir. Ölçüldü (Tarsus 36.9175/34.8621):
 *
 *   `"Kuvayimilliye Caddesi"` — OSM'deki adı **"Kuvayi Milliye Caddesi"**
 *     Nominatim (viewbox'lı VE viewbox'sız) → **her ikisinde de yalnız
 *       702 km'deki bir CAMİ** ("Kuvayımilliye Cami, Beylikdüzü/İstanbul")
 *     `"Mersin Kuvayimilliye Caddesi"` → Nominatim **0 sonuç** (iki modda da)
 *   Yani bu sınıf Nominatim ile ÇÖZÜLEMEZ (boşluklu/bitişik yazım); yalnız
 *   Overpass'in boşluğa duyarsız regexi bulur — ama doğru YERDE aranırsa:
 *     kullanıcı çevresi **20 km → 0 sonuç** (793 ms)
 *     kullanıcı çevresi **60 km → 6 sonuç**, 24,6 km'de doğru cadde (1264 ms)
 *     **ÇAPA (Mersin merkezi) + 20 km → 6 sonuç**, aynı cadde (**587 ms**)
 *
 * Çapa yolu hem en UCUZ hem de en DOĞRU olanıdır: kullanıcı ne kadar uzakta
 * olursa olsun, sorguda şehir adı geçiyorsa arama ORADA yapılır. Kör yarıçap
 * büyütmesinin (halka açık Overpass'i zorlayan) yerine geçer.
 *
 * ── SINIRLAR (dürüstlük) ──────────────────────────────────────────────────
 * • YALNIZ sorguda AÇIKÇA geçen 81 ilden biri için çapa üretilir
 *   (`locationBiasGate.detectCitiesInQuery` — ilçe/mahalle sözlüğü YOKTUR).
 * • Çözülemezse `null` döner; çağıran eski davranışına devam eder (fail-soft).
 * • Çevrimdışıyken ağa HİÇ çıkılmaz.
 * • Sonuç oturum boyunca önbelleklenir — il merkezleri değişmez, tekrar
 *   sorulmasının bir anlamı yoktur (Nominatim ToS dostu).
 */

import { detectCitiesInQuery } from './locationBiasGate';
import { awaitNominatimSlot } from './nominatimRateLimit';

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const UA        = 'CarOSPro/1.0 (vehicle navigation)';

/** Tek çağrı üst sınırı (ms). Ölçüm: il merkezi çözümü **546 ms**. */
export const CITY_ANCHOR_TIMEOUT_MS = 4_000;

export interface CityAnchor {
  /** Kanonik il adı (ör. `mersin`). */
  readonly city: string;
  readonly lat: number;
  readonly lng: number;
}

/* ── Önbellek: il merkezleri DEĞİŞMEZ → süresiz, ama sınırlı ─────────────── */

const CACHE_MAX = 24;
/** `null` değeri de saklanır: "çözülemedi" bilgisi de tekrar sorulmayı hak etmez. */
const _cache = new Map<string, CityAnchor | null>();

/** Test izolasyonu — önbellek testler arasında SIZMASIN. */
export function _resetCityAnchorCacheForTest(): void { _cache.clear(); }

/** Salt-okunur gözlem (CAROS LAB): önbellekte kaç il çözülmüş. */
export function readCityAnchorCacheSize(): number { return _cache.size; }

function _valid(lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat === 0 && lng === 0) return false;                 // Null Island
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

/**
 * Sorguda geçen İLK il adının merkezini çözer. İl adı yoksa / çözülemezse `null`.
 *
 * Sözleşme:
 *  · THROW ETMEZ — ağ · HTTP · JSON · abort → `null`.
 *  · Çevrimdışıyken (`navigator.onLine === false`) ağa HİÇ çıkılmaz → `null`.
 *  · Nominatim ToS bekleyicisinden geçer (TEK otorite — `nominatimRateLimit`).
 *  · Aynı il için ağa BİR KEZ çıkılır (oturum önbelleği).
 */
export async function resolveCityAnchor(query: string): Promise<CityAnchor | null> {
  const cities = detectCitiesInQuery(query);
  if (cities.length === 0) return null;
  const city = cities[0];

  const cached = _cache.get(city);
  if (cached !== undefined) return cached;

  /* YALNIZ açıkça `false` çevrimdışıdır — bayrağı tanımlamayan çalışma
     zamanında katman sessizce kapanmaz (P0-NAV-06'da ölçülen tuzak). */
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return null;

  await awaitNominatimSlot();

  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CITY_ANCHOR_TIMEOUT_MS);
  try {
    const params = new URLSearchParams({
      q:            city,
      format:       'jsonv2',
      limit:        '1',
      countrycodes: 'tr',
      /* İdari birim ARIYORUZ: aynı adı taşıyan bir dükkân/cadde çapa OLAMAZ. */
      featureType:  'settlement',
    });
    const res = await fetch(`${NOMINATIM}?${params}`, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'tr' },
      signal:  ctrl.signal,
    });
    if (!res.ok) return null;                      // ÖNBELLEĞE ALMA — geçici hata

    const data = await res.json() as Array<{ lat?: string; lon?: string }>;
    const first = data?.[0];
    const lat = first ? parseFloat(String(first.lat)) : Number.NaN;
    const lng = first ? parseFloat(String(first.lon)) : Number.NaN;
    if (!_valid(lat, lng)) {
      _cache.set(city, null);                      // "OSM'de yok" KALICI bilgidir
      return null;
    }

    const anchor: CityAnchor = { city, lat, lng };
    if (_cache.size >= CACHE_MAX) {
      const oldest = _cache.keys().next().value;
      if (oldest !== undefined) _cache.delete(oldest);
    }
    _cache.set(city, anchor);
    return anchor;
  } catch {
    return null;                                   // ağ/abort/parse — fail-soft
  } finally {
    clearTimeout(timer);
  }
}
