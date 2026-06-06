// ══════════════════════════════════════════════════════════════════════════
// CarOS Pro — mapService (Facade / Gateway)
//
// Bu dosya artık monolitik God-Object DEĞİL; bir geçittir. Harita yetenekleri
// üç modüle bölündü ve paylaşılan durum bir yaprak modülde toplandı:
//
//   map/_mapState.ts            → useMapStore + M (mutable state) + sabitler
//   map/MapCore.ts              → lifecycle, WebGL context, _freeContext (kritik)
//   map/MapLayerManager.ts      → layer/source/GeoJSON, marker, rota, mood/focus
//   map/MapInteractionManager.ts→ kamera (flyTo/easeTo/jumpTo), driving view, listeners
//
// Dış servisler için TÜM public metodlar AYNI İSİMLERLE buradan re-export edilir
// (geriye dönük uyumlu — import yolları değişmedi). Davranış değişikliği YOK.
// ══════════════════════════════════════════════════════════════════════════
import { searchOffline } from './offlineSearchService';
import type { StoredLocation } from './offlineSearchService';
import { searchGlobal } from './poi/offlinePoiService';
import { NOMINATIM_URL, NOMINATIM_UA } from './map/_mapState';

// ── Public API re-exports (delegation) ───────────────────────────────────────
export * from './map/MapCore';
export * from './map/MapLayerManager';
export * from './map/MapInteractionManager';
export type { MapConfig } from './map/_mapState';

/* ── Unified Place Search ───────────────────────────────────────────────────
 * Katmanlı offline-önce arama:
 *   1. offlineSearchService  — IndexedDB geçmiş/favoriler (<10ms)
 *   2. offlinePoiService     — SQLite FTS5 global POI DB (offline)
 *   3. Nominatim geocoder    — OSM online (son çare, internet gerekli)
 *
 * Tüm sonuçlar StoredLocation[] olarak döner; çakışan koordinatlar deduplicate edilir.
 */
async function _nominatimSearch(
  query:      string,
  maxResults: number,
): Promise<StoredLocation[]> {
  try {
    const params = new URLSearchParams({
      q:              query,
      format:         'jsonv2',
      limit:          String(maxResults),
      addressdetails: '1',
    });
    const res = await fetch(`${NOMINATIM_URL}?${params}`, {
      headers: { 'User-Agent': NOMINATIM_UA },
      signal:  AbortSignal.timeout(5_000),
    });
    if (!res.ok) return [];

    const data = await res.json() as Array<{
      place_id: number;
      display_name: string;
      lat: string;
      lon: string;
      address?: { road?: string; city?: string; country?: string };
    }>;

    return data.map((item): StoredLocation => ({
      id:        `nominatim_${item.place_id}`,
      name:      item.display_name.split(',')[0]?.trim() ?? item.display_name,
      address:   item.display_name,
      lat:       parseFloat(item.lat),
      lng:       parseFloat(item.lon),
      source:    'search',
      timestamp: Date.now(),
      useCount:  0,
    }));
  } catch {
    return [];
  }
}

function _dedup(list: StoredLocation[]): StoredLocation[] {
  const seen = new Set<string>();
  return list.filter((loc) => {
    const key = `${loc.lat.toFixed(4)}_${loc.lng.toFixed(4)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Unified yer arama: IndexedDB → SQLite POI → Nominatim geocoder.
 *
 * @param query      Kullanıcı arama metni
 * @param userLat    Mevcut konum (mesafe sıralaması + Nominatim bias için)
 * @param userLng    Mevcut konum
 * @param maxResults Toplam maksimum sonuç (varsayılan 8)
 */
export async function searchPlaces(
  query:      string,
  userLat?:   number,
  userLng?:   number,
  maxResults: number = 8,
): Promise<StoredLocation[]> {
  if (!query.trim()) return [];

  const combined: StoredLocation[] = [];

  // 1 — IndexedDB geçmiş/favoriler
  const offlineHits = await searchOffline(query, maxResults);
  for (const hit of offlineHits) combined.push(hit.location);

  if (combined.length >= maxResults) return _dedup(combined).slice(0, maxResults);

  // 2 — SQLite FTS5 global POI DB
  const poiHits = await searchGlobal(query, userLat, userLng, maxResults - combined.length);
  combined.push(...poiHits);

  if (combined.length >= maxResults) return _dedup(combined).slice(0, maxResults);

  // 3 — Nominatim online geocoder (son çare)
  const onlineHits = await _nominatimSearch(query, maxResults - combined.length);
  combined.push(...onlineHits);

  return _dedup(combined).slice(0, maxResults);
}
