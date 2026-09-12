/**
 * tripCorridorEngine — MAVI 4.0 · TRIP AI · ATOMİK GÖREV MAVI4-TRIP-2
 *
 * SADECE rota üzerindeki POI öneri motoru. Bu modül:
 *   • Rota DEĞİŞTİRMEZ · Preview YOK · Apply YOK · ETA DEĞİŞTİRMEZ.
 *   • Yeni geometry engine / route store / global state / EventBus YOK.
 *   • Yan etkisiz **saf fonksiyon** — tam test edilebilir.
 *
 * Mevcut `routingService` yardımcıları (`pointToSegmentDist`, `projectOnSegment`,
 * `hav`) yeniden kullanılır; yeni geometri matematiği yazılmaz.
 *
 * Geometri formatı proje geneliyle aynıdır: `[number, number][]` = `[lon, lat][]`
 * (OSRM / offline-worker uyumlu).
 */

import { hav, pointToSegmentDist, projectOnSegment } from '../routingService';
import type { StoredLocation } from '../offlineSearchService';

/** Koridor içinde kalan bir POI adayı — yalnız öneri; kullanıcıya HENÜZ gösterilmez. */
export interface CorridorCandidate {
  /** Aday POI (girdi referansı — kopyalanmaz, mutasyona uğratılmaz). */
  location: StoredLocation;
  /** Rotaya en kısa dik mesafe (metre). */
  distanceToRoute: number;
  /** Kaba sapma tahmini (metre): rotadan sap + geri dön ≈ 2× dik mesafe. **ETA DEĞİL.** */
  estimatedDetour: number;
  /** En yakın rota noktasının rota boyunca ilerlemesi, 0 (başlangıç) .. 1 (varış). */
  routeProgress: number;
  /** Yakınlık skoru 0..1 (1 = rota üstünde). Sıralama bu skora göredir. */
  score: number;
}

/**
 * Rota koridoru içindeki POI adaylarını üretir ve yakınlığa göre sıralar.
 *
 * @param geometry           Rota geometrisi `[lon, lat][]`. <2 nokta → boş sonuç.
 * @param pois               Aday konumlar. Boş → boş sonuç.
 * @param maxCorridorMeters  Koridor yarı-genişliği (metre). Bu mesafeden uzak POI elenir.
 * @param maxCandidate       Opsiyonel: döndürülecek maksimum aday sayısı (>0).
 * @returns Koridor içi adaylar; skora göre azalan (en yakın önce), deterministik sıralı.
 *
 * Saf fonksiyon: girdi dizileri/objeleri mutasyona uğratılmaz, global durum okunmaz/yazılmaz.
 */
export function computeCorridorCandidates(
  geometry: readonly [number, number][] | null | undefined,
  pois: readonly StoredLocation[] | null | undefined,
  maxCorridorMeters: number,
  maxCandidate?: number,
): CorridorCandidate[] {
  // ── Sınır durumları ──────────────────────────────────────────────────────
  if (!geometry || geometry.length < 2) return [];
  if (!pois || pois.length === 0) return [];
  if (!Number.isFinite(maxCorridorMeters) || maxCorridorMeters <= 0) return [];

  const n = geometry.length;

  // Rota başından kümülatif segment mesafesi (metre). prefix[i] = 0..vertex(i) mesafe.
  // routeProgress için gerekli; hav() ile — yeni mesafe matematiği yok.
  const prefix = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    prefix[i] = prefix[i - 1] + hav(
      geometry[i - 1][1], geometry[i - 1][0],
      geometry[i][1],     geometry[i][0],
    );
  }
  const totalLen = prefix[n - 1];

  const out: CorridorCandidate[] = [];

  for (let p = 0; p < pois.length; p++) {
    const poi = pois[p];
    if (!poi || !Number.isFinite(poi.lat) || !Number.isFinite(poi.lng)) continue;

    // En yakın segmenti ve o segmentteki en kısa dik mesafeyi bul (pointToSegmentDist).
    let minDist = Infinity;
    let bestSeg = 0;
    for (let i = 0; i < n - 1; i++) {
      const d = pointToSegmentDist(
        poi.lat, poi.lng,
        geometry[i][1],     geometry[i][0],
        geometry[i + 1][1], geometry[i + 1][0],
      );
      if (d < minDist) {
        minDist = d;
        bestSeg = i;
        if (minDist === 0) break; // rota üstünde — daha iyisi mümkün değil
      }
    }

    // Koridor dışı → ele.
    if (minDist > maxCorridorMeters) continue;

    // En yakın segment üzerindeki projeksiyon oranı (projectOnSegment) → rota ilerlemesi.
    const t = projectOnSegment(
      poi.lat, poi.lng,
      geometry[bestSeg][1],     geometry[bestSeg][0],
      geometry[bestSeg + 1][1], geometry[bestSeg + 1][0],
    );
    const along = prefix[bestSeg] + t * (prefix[bestSeg + 1] - prefix[bestSeg]);
    const routeProgress = totalLen > 0 ? along / totalLen : 0;

    out.push({
      location:        poi,
      distanceToRoute: minDist,
      estimatedDetour: minDist * 2,
      routeProgress,
      score:           1 - minDist / maxCorridorMeters,
    });
  }

  // Deterministik sıralama: yüksek skor önce → erken ilerleme → id (kesin belirleyici).
  out.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.routeProgress !== b.routeProgress) return a.routeProgress - b.routeProgress;
    const ai = a.location.id;
    const bi = b.location.id;
    return ai < bi ? -1 : ai > bi ? 1 : 0;
  });

  if (Number.isFinite(maxCandidate) && (maxCandidate as number) > 0 && out.length > (maxCandidate as number)) {
    out.length = maxCandidate as number;
  }

  return out;
}
