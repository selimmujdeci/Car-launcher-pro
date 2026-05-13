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
 *   Nominatim > FAST_FAIL_MS    → abort + offline fallback
 *   Nominatim ağ hatası         → offline fallback
 * Fallback: searchOffline() (IndexedDB geçmiş) + searchPOI() (SQLite FTS5)
 */

import { searchOffline, searchPOI } from './offlineSearchService';
import type { POISearchResult }      from './offlineSearchService';

const NOMINATIM          = 'https://nominatim.openstreetmap.org/search';
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
 *   - Nominatim 2s içinde yanıt vermezse → abort + _offlineFallback()
 *   - Nominatim ağ hatası → _offlineFallback()
 */
export async function geocodeAddress(
  query:       string,
  currentLat?: number,
  currentLng?: number,
): Promise<GeoResult[]> {
  /* Hızlı yol: ağ bağlantısı yok → rate-limiter atlanır, anında offline */
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return _offlineFallback(query, currentLat, currentLng);
  }

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
    .catch((): null => null); // network error veya AbortError → null

  /* 2s fast-fail timer — kazanırsa Nominatim abort edilir */
  let automotiveTimer: ReturnType<typeof setTimeout> | null = null;
  const automotiveSafe = new Promise<null>((resolve) => {
    automotiveTimer = setTimeout(() => {
      ctrl.abort();
      resolve(null);
    }, FAST_FAIL_MS);
  });

  try {
    const winner = await Promise.race([nominatimSafe, automotiveSafe]);

    // Nominatim kazandı ve geçerli dizi döndü → online sonuçlar
    if (winner !== null) return winner;

    // null → timeout veya network hatası → offline fallback
    return _offlineFallback(query, currentLat, currentLng);
  } finally {
    if (automotiveTimer !== null) clearTimeout(automotiveTimer);
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
 * Mevcut konuma yakın benzinlik veya otopark ara — max 5 sonuç, 5 km yarıçap.
 */
export async function searchNearby(
  type:   'fuel' | 'parking',
  lat:    number,
  lng:    number,
): Promise<GeoResult[]> {
  const amenity = type === 'fuel' ? 'fuel' : 'parking';
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
  for (const el of data.elements) {
    const elLat = el.lat ?? el.center?.lat;
    const elLng = el.lon ?? el.center?.lon;
    if (elLat == null || elLng == null) continue;

    const rawName  = el.tags?.name ?? el.tags?.brand ?? el.tags?.operator;
    const typeName = type === 'fuel' ? 'Benzinlik' : 'Otopark';
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
