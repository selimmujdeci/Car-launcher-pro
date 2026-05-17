/**
 * offlinePoiService — Global offline POI search via SQLite FTS5.
 *
 * Varsayılan DB şeması (/maps/search.db):
 *   CREATE VIRTUAL TABLE pois USING fts5(
 *     name, address, category UNINDEXED, lat UNINDEXED, lng UNINDEXED
 *   );
 *
 * Arama sıralaması: FTS5 rank skoru → Haversine mesafesi (yakın önce).
 * Türkçe karakter normalizasyonu MATCH/LIKE sorgusundan önce uygulanır.
 * Çıktı: offlineSearchService.StoredLocation[] (unified API).
 */

import { sqlQuery } from './SqliteEngine';
import type { StoredLocation } from '../offlineSearchService';

/* ── Turkish normalizer ───────────────────────────────────────────────────── */

const TR_MAP: Record<string, string> = {
  'İ': 'i', 'ı': 'i', 'Ş': 's', 'ş': 's',
  'Ğ': 'g', 'ğ': 'g', 'Ü': 'u', 'ü': 'u',
  'Ö': 'o', 'ö': 'o', 'Ç': 'c', 'ç': 'c',
};

function trNorm(text: string): string {
  return text
    .toLowerCase()
    .replace(/[İışŞğĞüÜöÖçÇ]/g, (c) => TR_MAP[c] ?? c)
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* ── Haversine ────────────────────────────────────────────────────────────── */

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R  = 6371;
  const dL = ((lat2 - lat1) * Math.PI) / 180;
  const dN = ((lng2 - lng1) * Math.PI) / 180;
  const a  =
    Math.sin(dL / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dN / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/* ── Detour ratio proxy ───────────────────────────────────────────────────── */

// No road graph available offline; nearby-POI density proxies urbanisation level.
// Dense urban (≥3 neighbours within 4 km) → roads are direct → ratio 1.25.
// Isolated / rural → roads wind around obstacles → ratio 1.68.
function _estimateDetourRatio(loc: StoredLocation, pool: StoredLocation[]): number {
  const URBAN_R = 4; // km
  let nearby = 0;
  for (const other of pool) {
    if (other !== loc && haversineKm(loc.lat, loc.lng, other.lat, other.lng) < URBAN_R) {
      if (++nearby >= 3) return 1.25; // short-circuit — confirmed urban
    }
  }
  return nearby >= 1 ? 1.42 : 1.68;
}

/* ── Result builder ───────────────────────────────────────────────────────── */

function _toStoredLocation(row: Record<string, string | number | null | Uint8Array>): StoredLocation | null {
  const lat = typeof row['lat'] === 'number' ? row['lat'] : parseFloat(String(row['lat'] ?? ''));
  const lng = typeof row['lng'] === 'number' ? row['lng'] : parseFloat(String(row['lng'] ?? ''));
  const name = String(row['name'] ?? '').trim();

  if (!name || !isFinite(lat) || !isFinite(lng)) return null;

  const id = `poi_${trNorm(name)}_${lat.toFixed(4)}_${lng.toFixed(4)}`;

  return {
    id,
    name,
    address:   row['address'] ? String(row['address']) : undefined,
    lat,
    lng,
    source:    'search',
    timestamp: Date.now(),
    useCount:  0,
  };
}

/* ── FTS5 search ──────────────────────────────────────────────────────────── */

async function _fts5Search(normalized: string, limit: number): Promise<StoredLocation[]> {
  // FTS5 MATCH: her kelime sonuna * wildcard ekle (prefix match)
  const ftsQuery = normalized
    .split(' ')
    .filter(Boolean)
    .map((w) => `${w}*`)
    .join(' ');

  const rows = await sqlQuery(
    `SELECT name, address, lat, lng FROM pois WHERE name MATCH ? ORDER BY rank LIMIT ?`,
    [ftsQuery, limit * 3], // daha fazla çek, mesafeye göre sırala
  );

  return rows.flatMap((r) => {
    const loc = _toStoredLocation(r);
    return loc ? [loc] : [];
  });
}

/* ── LIKE fallback (FTS5 yoksa) ──────────────────────────────────────────── */

async function _likeSearch(normalized: string, limit: number): Promise<StoredLocation[]> {
  const rows = await sqlQuery(
    `SELECT name, address, lat, lng FROM pois WHERE lower(name) LIKE ? LIMIT ?`,
    [`%${normalized}%`, limit * 3],
  );

  return rows.flatMap((r) => {
    const loc = _toStoredLocation(r);
    return loc ? [loc] : [];
  });
}

/* ── Public API ───────────────────────────────────────────────────────────── */

/**
 * /maps/search.db içindeki POI veritabanında FTS5 araması yapar.
 *
 * @param query      Ham kullanıcı sorgusu (Türkçe dahil)
 * @param userLat    Kullanıcı konumu — mesafe sıralaması için (opsiyonel)
 * @param userLng    Kullanıcı konumu — mesafe sıralaması için (opsiyonel)
 * @param maxResults Maksimum sonuç (varsayılan 8)
 * @returns StoredLocation[] — boş dizi eğer DB yoksa veya eşleşme yoksa
 */
export async function searchGlobal(
  query:      string,
  userLat?:   number,
  userLng?:   number,
  maxResults: number = 8,
): Promise<StoredLocation[]> {
  const normalized = trNorm(query);
  if (!normalized) return [];

  // FTS5 → LIKE fallback
  let results = await _fts5Search(normalized, maxResults);
  if (results.length === 0) {
    results = await _likeSearch(normalized, maxResults);
  }

  // Reachability-weighted sort — detour ratio penalises isolated / rural POIs
  if (userLat != null && userLng != null) {
    results.sort((a, b) => {
      const rA = haversineKm(userLat, userLng, a.lat, a.lng) * _estimateDetourRatio(a, results);
      const rB = haversineKm(userLat, userLng, b.lat, b.lng) * _estimateDetourRatio(b, results);
      return rA - rB;
    });
  }

  return results.slice(0, maxResults);
}
