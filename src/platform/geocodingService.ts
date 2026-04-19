/**
 * Geocoding Service — adres ve POI araması.
 *
 * Adres / mekan: Nominatim (OpenStreetMap) — Türkiye bias
 * Yakın benzinlik / otopark: Overpass API — 5 km yarıçap
 *
 * Her iki servis de rate-limit dostu; retry yok, sadece timeout.
 */

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const OVERPASS  = 'https://overpass-api.de/api/interpreter';
const UA        = 'CarLauncherPro/1.0';
const TIMEOUT   = 8_000;

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
 */
export async function geocodeAddress(
  query:       string,
  currentLat?: number,
  currentLng?: number,
): Promise<GeoResult[]> {
  const params = new URLSearchParams({
    q:            query,
    format:       'json',
    limit:        '4',
    addressdetails: '0',
    countrycodes: 'tr',
  });

  if (currentLat != null && currentLng != null) {
    // ~80 km'lik viewbox — bias ama sınırlama değil (bounded=0 default)
    const d = 0.7;
    params.set('viewbox', `${currentLng - d},${currentLat - d},${currentLng + d},${currentLat + d}`);
    params.set('bounded', '0');
  }

  await _waitNominatim();
  const { ctrl, clear } = abort(TIMEOUT);
  try {
    const res  = await fetch(`${NOMINATIM}?${params}`, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'tr' },
      signal:  ctrl.signal,
    });
    const data = (await res.json()) as NominatimItem[];

    return data.map((r) => ({
      id:       `nom-${r.place_id}`,
      name:     shortName(r.display_name),
      fullName: r.display_name,
      lat:      parseFloat(r.lat),
      lng:      parseFloat(r.lon),
      type:     `${r.class}/${r.type}`,
    }));
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
