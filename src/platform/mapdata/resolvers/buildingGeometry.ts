/**
 * buildingGeometry.ts — MAP DATA PLATFORM · F3 · BINA GEOMETRİ MATEMATİĞİ (SAF).
 *
 * SAF: I/O YOK · ağ YOK · timer YOK · saat YOK · rastgelelik YOK.
 *
 * ── NEDEN KENDİ MATEMATİĞİMİZ ─────────────────────────────────────────────
 * Bu katman **veri hattındadır, çalışma zamanında değildir** — MapLibre veya
 * bir geometri kütüphanesi (turf vb.) bağımlılığı EKLENMEZ: renderer veri
 * otoritesi değildir ve yeni bir bağımlılık lisans/boyut riski taşır.
 * İhtiyacımız olan üç şey vardır: alan · ağırlık merkezi · nokta-poligon.
 *
 * ── PROJEKSİYON ───────────────────────────────────────────────────────────
 * Bina ölçeğinde (onlarca metre) yerel **eşdikdörtgen (equirectangular)**
 * projeksiyon yeterlidir: enlem sabiti alınıp metreye çevrilir. Bu bir
 * yaklaşımdır ve öyle ilan edilir — Mercator alan bozulması veya jeodezik
 * kesinlik iddiası YOKTUR. Tarsus enleminde (36.9°) 400 m'lik bir pencerede
 * hata milimetre mertebesindedir.
 */

import type { LonLat, MapGeometry } from '../mapDataObservation';

/** WGS-84 ortalama yarıçapı (m). */
export const EARTH_RADIUS_M = 6_371_008.8;
const DEG = Math.PI / 180;

/** Yerel düzlem başlangıcı — kümedeki ilk halkanın ilk noktası. */
export interface LocalFrame {
  readonly lon0: number;
  readonly lat0: number;
  readonly mPerDegLon: number;
  readonly mPerDegLat: number;
}

export function makeLocalFrame(lon0: number, lat0: number): LocalFrame {
  return {
    lon0, lat0,
    mPerDegLon: DEG * EARTH_RADIUS_M * Math.cos(lat0 * DEG),
    mPerDegLat: DEG * EARTH_RADIUS_M,
  };
}

export function toLocalXY(p: LonLat, f: LocalFrame): readonly [number, number] {
  return [(p[0] - f.lon0) * f.mPerDegLon, (p[1] - f.lat0) * f.mPerDegLat];
}

/** İki nokta arası mesafe (m) — yerel düzlem yaklaşımı. */
export function distanceM(a: LonLat, b: LonLat): number {
  const f = makeLocalFrame(a[0], a[1]);
  const [x, y] = toLocalXY(b, f);
  return Math.hypot(x, y);
}

/** Poligonun DIŞ halkası. Halkasız geometri `null`. */
export function outerRing(g: MapGeometry | null | undefined): readonly LonLat[] | null {
  if (!g || (g.type !== 'POLYGON' && g.type !== 'MULTIPOLYGON')) return null;
  const ring = g.type === 'POLYGON' ? g.rings[0] : g.polygons[0]?.[0];
  return Array.isArray(ring) && ring.length >= 4 ? ring : null;
}

/** İşaretli alan (m²) — shoelace, yerel düzlemde. Yön bilgisi korunur. */
export function signedAreaM2(ring: readonly LonLat[], f: LocalFrame): number {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = toLocalXY(ring[i], f);
    const [xj, yj] = toLocalXY(ring[j], f);
    sum += xj * yi - xi * yj;
  }
  return sum / 2;
}

/**
 * Poligon alanı (m²) — dış halka eksi iç halkalar. Geçersiz geometri `null`.
 * Sıfır/negatif alan `null` döner: "alanı ölçülemedi" ≠ "alanı sıfır".
 */
export function polygonAreaM2(g: MapGeometry | null | undefined): number | null {
  if (!g || (g.type !== 'POLYGON' && g.type !== 'MULTIPOLYGON')) return null;
  const polygons = g.type === 'POLYGON' ? [g.rings] : g.polygons;
  let area = 0;
  for (const polygon of polygons) {
    const outer = polygon[0];
    if (!outer) continue;
    const f = makeLocalFrame(outer[0][0], outer[0][1]);
    let part = Math.abs(signedAreaM2(outer, f));
    for (let i = 1; i < polygon.length; i += 1) part -= Math.abs(signedAreaM2(polygon[i], f));
    if (part > 0) area += part;
  }
  return area > 0 ? area : null;
}

/**
 * Alan ağırlıklı ağırlık merkezi. Dejenere (sıfır alanlı) halkada köşe
 * ortalamasına DÜŞÜLÜR — sessizce `[0,0]` üretilmez.
 */
export function polygonCentroid(g: MapGeometry | null | undefined): LonLat | null {
  if (!g || (g.type !== 'POLYGON' && g.type !== 'MULTIPOLYGON')) return null;
  const polygons = g.type === 'POLYGON' ? [g.rings] : g.polygons;
  const origin = polygons[0]?.[0]?.[0];
  if (!origin) return null;
  const f = makeLocalFrame(origin[0], origin[1]);
  let weightedX = 0, weightedY = 0, totalArea = 0;
  for (const polygon of polygons) {
    for (let r = 0; r < polygon.length; r += 1) {
      const ring = polygon[r];
      let cx = 0, cy = 0, a2 = 0;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = toLocalXY(ring[i], f), [xj, yj] = toLocalXY(ring[j], f);
        const cross = xj * yi - xi * yj;
        a2 += cross; cx += (xi + xj) * cross; cy += (yi + yj) * cross;
      }
      if (Math.abs(a2) < 1e-9) continue;
      const signedWeight = (r === 0 ? 1 : -1) * Math.abs(a2 / 2);
      weightedX += (cx / (3 * a2)) * signedWeight;
      weightedY += (cy / (3 * a2)) * signedWeight;
      totalArea += signedWeight;
    }
  }
  if (totalArea <= 0) return null;
  return [f.lon0 + weightedX / totalArea / f.mPerDegLon,
    f.lat0 + weightedY / totalArea / f.mPerDegLat];
}

/** Nokta halkanın içinde mi (ray casting, sınır dâhil sayılmaz). */
export function pointInRing(pt: LonLat, ring: readonly LonLat[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > pt[1]) !== (yj > pt[1])
      && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Nokta poligonun içinde mi (iç halkalar delik sayılır). */
export function pointInPolygon(pt: LonLat, g: MapGeometry | null | undefined): boolean {
  if (!g || (g.type !== 'POLYGON' && g.type !== 'MULTIPOLYGON')) return false;
  const polygons = g.type === 'POLYGON' ? [g.rings] : g.polygons;
  for (const polygon of polygons) {
    const outer = polygon[0];
    if (!outer || !pointInRing(pt, outer)) continue;
    if (!polygon.slice(1).some((hole) => pointInRing(pt, hole))) return true;
  }
  return false;
}

/** Eksen hizalı sınır kutusu `[minLon, minLat, maxLon, maxLat]`. */
export function bboxOf(g: MapGeometry | null | undefined): readonly [number, number, number, number] | null {
  if (!g || (g.type !== 'POLYGON' && g.type !== 'MULTIPOLYGON')) return null;
  const points = g.type === 'POLYGON' ? g.rings.flat() : g.polygons.flat(2);
  if (points.length === 0) return null;
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  for (const [lon, lat] of points) {
    if (lon < minLon) minLon = lon;
    if (lat < minLat) minLat = lat;
    if (lon > maxLon) maxLon = lon;
    if (lat > maxLat) maxLat = lat;
  }
  return [minLon, minLat, maxLon, maxLat];
}

export function bboxIntersects(
  a: readonly [number, number, number, number] | null,
  b: readonly [number, number, number, number] | null,
  padDeg = 0,
): boolean {
  if (!a || !b) return false;
  return a[0] - padDeg <= b[2] && a[2] + padDeg >= b[0]
    && a[1] - padDeg <= b[3] && a[3] + padDeg >= b[1];
}

/**
 * İki footprint'in ÖRTÜŞME KANITI. **Gerçek poligon kesişimi HESAPLANMAZ**
 * (kesişim algoritması bu katmanda gereksiz karmaşıklık ve sessiz hata
 * kaynağıdır); onun yerine üç ölçülebilir kanıt taşınır:
 *
 *  · `centroidDistanceM` — ağırlık merkezleri arası mesafe
 *  · `mutualContainment` — birinin merkezi diğerinin içinde mi (0 · 1 · 2)
 *  · `areaRatio`         — küçük alan / büyük alan (0..1]
 *
 * Bunlar bina ölçeğinde IoU'nun makul ve AÇIKLANABİLİR bir vekilidir; iddia
 * "kesişim oranı şudur" DEĞİL, "şu üç kanıt şu değerdedir"dir.
 */
export interface FootprintOverlap {
  readonly centroidDistanceM: number | null;
  readonly mutualContainment: 0 | 1 | 2;
  readonly areaRatio: number | null;
  readonly areaAM2: number | null;
  readonly areaBM2: number | null;
}

export const NO_OVERLAP: FootprintOverlap = {
  centroidDistanceM: null, mutualContainment: 0, areaRatio: null, areaAM2: null, areaBM2: null,
};

export function measureOverlap(
  a: MapGeometry | null | undefined,
  b: MapGeometry | null | undefined,
): FootprintOverlap {
  const ca = polygonCentroid(a);
  const cb = polygonCentroid(b);
  if (!ca || !cb) return NO_OVERLAP;
  const areaA = polygonAreaM2(a);
  const areaB = polygonAreaM2(b);
  let containment: 0 | 1 | 2 = 0;
  if (pointInPolygon(ca, b)) containment = 1;
  if (pointInPolygon(cb, a)) containment = containment === 1 ? 2 : 1;
  const areaRatio = (areaA !== null && areaB !== null && areaA > 0 && areaB > 0)
    ? Math.min(areaA, areaB) / Math.max(areaA, areaB) : null;
  return {
    centroidDistanceM: distanceM(ca, cb),
    mutualContainment: containment,
    areaRatio,
    areaAM2: areaA,
    areaBM2: areaB,
  };
}
