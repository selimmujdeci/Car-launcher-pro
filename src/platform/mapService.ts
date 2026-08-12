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
import { signalWithTimeout } from '../utils/abortCompat';
import { filterNumberedStreetMismatch } from './geocodingService';
import { searchStreetByName, extractStreetQuery } from './streetSearchService';
import { describeQueryShape, type AddressSearchStage } from './geo/addressSearchLedger';
import { recordAddressSearch } from './geo/addressSearchLedgerStore';
import { applyLocationBias } from './geo/locationBiasGate';

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
      signal:  signalWithTimeout(5_000), // Chrome <103 WebView güvenli (abortCompat)
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

  /* ── Kanıt defteri (teşhis turu 2026-08-11) ────────────────────────────────
   * Bu yüzey (harita arama çubuğu) `geocodeAddress` zincirinden AYRI çalışır ve
   * ölçümde 30 sorgunun 8'inde diğer yüzeyden FARKLI sonuç verdi. Ayrışmanın
   * sahada görünmesi için hangi yüzeyin ne bulduğu KAYDEDİLİR.
   * Sorgu METNİ deftere GİRMEZ — yalnız biçimi (gizlilik şartı #6). */
  const _t0    = Date.now();
  const _shape = describeQueryShape(query);
  let   _stage: AddressSearchStage = 'NONE';
  let   _rejected: number | null   = null;
  let   _biasDropped: number | null = null;

  /* ── KONUM/ŞEHİR KAPISI (2026-08-12) ───────────────────────────────────────
   * ÖLÇÜLDÜ: bu yüzey `countrycodes`/viewbox bias KULLANMADIĞI için "Bağlar
   * Mahallesi" sorgusuna ilk aday olarak **Siverek/Şanlıurfa 405 km** dönüyordu;
   * en yakın aday listenin SONUNDAYDI. Adres zinciriyle AYNI saf kapı burada da
   * çağrılır — iki yüzeyin ayrışması bu projenin tekrar eden saha kusurudur. */
  const _origin = (userLat != null && userLng != null) ? { lat: userLat, lng: userLng } : null;
  const _gate = (hits: StoredLocation[]): StoredLocation[] => {
    if (hits.length === 0) return hits;
    const r = applyLocationBias(
      query,
      hits.map((h) => ({ ...h, fullName: h.address ?? h.name })),
      _origin,
    );
    _biasDropped = (_biasDropped ?? 0) + r.droppedFar + r.droppedWrongCity;
    /* `fullName` yalnız kapının okuması için eklenmişti — dışarı SIZMAZ. */
    return r.kept.map((c) => {
      const { fullName: _drop, ...rest } = c.item;
      void _drop;
      return rest;
    });
  };
  const _finish = (results: StoredLocation[]): StoredLocation[] => {
    recordAddressSearch({
      surface:             'MAP_SEARCH_BAR',
      shape:               _shape,
      /* Bu yüzey ayrıştırıcıdan GEÇMEZ — kullanıcı ne yazdıysa o aranır. */
      queryRewritten:      false,
      queryLostRoadType:   false,
      stage:               _stage,
      resultCount:         results.length,
      /* Kapı da bir DOĞRULAMA filtresidir → toplam elemeye girer; ayrıştırılmış
         hâli `biasDroppedCount`tadır (bkz. geocodingService.done). */
      rejectedCount:       (_rejected === null && _biasDropped === null)
        ? null : (_rejected ?? 0) + (_biasDropped ?? 0),
      providerMs:          Date.now() - _t0,
      /* Bu yüzey fast-fail kullanmaz (tek 5 s'lik istek) → "beklemeyi bıraktık mı"
         sorusu burada ANLAMSIZ; sahte `false` yerine ölçülmedi (`null`). */
      fastFailHit:         null,
      hadLocation:         userLat != null && userLng != null,
      online:              typeof navigator === 'undefined' ? null : navigator.onLine,
      fallbackQueryUsable: (userLat != null && userLng != null)
        ? extractStreetQuery(query) !== null : null,
      biasDroppedCount:    _biasDropped,
      /* Liste kullanıcıya sunulur; SEÇİM kanıtı sonra gelir (noteAddressSearchChoice). */
      outcome:             results.length === 0 ? 'EMPTY' : 'AWAITING_CHOICE',
    }, 'mapService.searchPlaces');
    return results;
  };

  const combined: StoredLocation[] = [];

  // 1 — IndexedDB geçmiş/favoriler
  const offlineHits = await searchOffline(query, maxResults);
  for (const hit of offlineHits) combined.push(hit.location);
  if (combined.length) _stage = 'LOCAL_HISTORY';

  if (combined.length >= maxResults) return _finish(_dedup(combined).slice(0, maxResults));

  // 2 — SQLite FTS5 global POI DB
  const poiHits = await searchGlobal(query, userLat, userLng, maxResults - combined.length);
  if (poiHits.length && _stage === 'NONE') _stage = 'LOCAL_POI';
  combined.push(...poiHits);

  if (combined.length >= maxResults) return _finish(_dedup(combined).slice(0, maxResults));

  // 3 — Nominatim online geocoder (son çare)
  const onlineRaw = await _nominatimSearch(query, maxResults - combined.length);

  /* ── SAHA DÜZELTMESİ (2026-08-03, cihazda gözlendi) ───────────────────────
   * Bu çubuğa "0455 sokak" yazıldığında Nominatim **İzmir'de 701 km uzaktaki
   * "Sokak"** kaydını öneriyordu — kullanıcı dokunsa oraya rota kurulurdu.
   * Aynı koruma `geocodeAddress` zincirine eklenmişti (kütük #335) ama harita
   * arama çubuğu AYRI zinciri (`searchPlaces`) kullandığı için korumasızdı:
   * iki arama yüzeyi ayrışmıştı. Sorgu numaralı bir sokak istiyorsa, farklı
   * numaralı sonuç CEVAP DEĞİLDİR — elenir. */
  const onlineHits = filterNumberedStreetMismatch(
    query,
    onlineRaw.map((h) => ({ ...h, fullName: h.address ?? h.name })),
  );
  _rejected = onlineRaw.length - onlineHits.length;
  /* Numara doğrulamasından SONRA konum/şehir kapısı: önce "doğru sokak mı",
     sonra "doğru şehirde / ulaşılabilir mi". */
  const onlineGated = _gate(onlineHits.map(({ fullName: _f, ...rest }) => { void _f; return rest; }));
  if (onlineGated.length && _stage === 'NONE') _stage = 'NOMINATIM';
  combined.push(...onlineGated);

  /* 4 — Sokak adıyla doğrudan OSM (Overpass). Nominatim Türkçe numaralı
   *     sokakları eşleştiremiyor (ölçüldü, kütük #336); Overpass tam eşleşme
   *     verir. Fail-soft: konum yoksa/hata olursa boş döner. */
  if (combined.length === 0) {
    const streets = await searchStreetByName(query, userLat, userLng);
    const gatedStreets = _gate(streets.map((s) => ({
      id:        s.id,
      name:      s.name,
      address:   s.fullName,
      lat:       s.lat,
      lng:       s.lng,
      source:    'search' as const,
      timestamp: Date.now(),
      useCount:  0,
    })));
    if (gatedStreets.length) _stage = 'OVERPASS_STREET';
    combined.push(...gatedStreets);
  }

  return _finish(_dedup(combined).slice(0, maxResults));
}
