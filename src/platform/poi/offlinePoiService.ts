/**
 * offlinePoiService — indirilmiş POI veritabanı araması (StoredLocation cephesi).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── ÖLÇÜLEN KUSUR: BU KATMAN YAPISAL OLARAK ÖLÜYDÜ (2026-08-23) ───────────
 * ══════════════════════════════════════════════════════════════════════════
 * Bu modül `SqliteEngine` üzerinden **ANA İŞ PARÇACIĞINDA** `/maps/search.db`
 * dosyasını açmaya çalışıyordu. Üründe böyle bir dosya YOKTUR — üretilen ve
 * paketlenen dosya `/maps/poi.db`'dir (`scripts/build-poi-db.mjs`). Fetch 404
 * dönüyor, motor "sessizce uykuda kal" sözleşmesi gereği `null` dönüyordu →
 * `searchGlobal` **her zaman 0 sonuç** veriyordu.
 *
 * Üstelik şema da uyuşmuyordu: sorgu `pois` tablosunda `name MATCH ?` ve `lng`
 * sütunu arıyordu; gerçek şema `poi(id,name,search,address,lat,lon,category)`.
 * Yani dosya bulunsaydı bile sorgu patlardı. İki ayrı sessiz ölüm üst üsteydi.
 *
 * ÖLÇÜLEN ETKİ: harita arama çubuğunun (`mapService.searchPlaces`) 2. katmanı
 * hiçbir zaman cevap vermiyordu — oysa `poi.db` içinde **84.911** POI var
 * (23.845'i eczane, 13.578 market, 6.007 benzinlik) ve "eczane" anahtarı
 * **23.850** kaydı karşılıyor. Çevrimdışı kategori araması ürünün elindeydi
 * ama ürün ona ULAŞAMIYORDU.
 *
 * ── DÜZELTME: TEK OKUYUCU ─────────────────────────────────────────────────
 * `poi.db`nin İKİ okuyucusu vardı (ana iş parçacığında `SqliteEngine`, Worker
 * içinde `NavigationCompute.worker`). İkinci otorite bu projenin tekrar eden
 * saha kusurudur. Ana iş parçacığı okuyucusu KALDIRILDI; bu modül artık
 * Worker yoluna (`offlineSearchService.searchPOI`) delege eden ince bir
 * dönüştürücüdür. Kazanç yalnız doğruluk değil: 16 MB'lık veritabanı ve
 * sql.js WASM ana iş parçacığının yığınına ARTIK GİRMİYOR (head unit bütçesi).
 */

import { searchPOI } from '../offlineSearchService';
import type { StoredLocation } from '../offlineSearchService';

/** `poi.db` kategori adı → arama sonucunda taşınan kanonik kimlik. */
export interface OfflinePoiHit extends StoredLocation {
  /** `poi.db` içindeki kategori (ör. `eczane`). Boşsa `null` — uydurma YASAK. */
  readonly categoryId: string | null;
}

/**
 * İndirilmiş POI veritabanında arama yapar (Worker üzerinden, off-main-thread).
 *
 * @param query      Ham kullanıcı sorgusu (Türkçe dahil — katlama Worker'da)
 * @param userLat    Mesafe sıralaması için (opsiyonel)
 * @param userLng    Mesafe sıralaması için (opsiyonel)
 * @param maxResults Maksimum sonuç
 * @returns Boş dizi — `poi.db` yoksa, Worker yoksa veya eşleşme yoksa (fail-soft)
 */
export async function searchGlobal(
  query:      string,
  userLat?:   number,
  userLng?:   number,
  maxResults: number = 8,
): Promise<OfflinePoiHit[]> {
  if (!query.trim()) return [];

  let hits: Awaited<ReturnType<typeof searchPOI>>;
  try {
    hits = await searchPOI(query, { lat: userLat, lon: userLng, maxResults });
  } catch {
    return [];                       // Worker yok / poi.db yok → arama ÇÖKMEZ
  }

  const out: OfflinePoiHit[] = [];
  for (const p of hits) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) continue;
    const name = (p.name ?? '').trim();
    if (!name) continue;             // adsız kayıt gösterilemez
    out.push({
      id:         p.id || `poi_${p.lat.toFixed(4)}_${p.lon.toFixed(4)}`,
      name,
      address:    p.address ? p.address : undefined,
      lat:        p.lat,
      lng:        p.lon,
      source:     'search',
      timestamp:  Date.now(),
      useCount:   0,
      categoryId: p.category ? p.category : null,
    });
  }
  return out.slice(0, maxResults);
}
