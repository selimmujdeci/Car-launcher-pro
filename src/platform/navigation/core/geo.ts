/**
 * geo.ts — Navigasyon çekirdeğinin SAF geometri primitifleri.
 *
 * NEDEN AYRI DOSYA: `hav` / `projectOnSegment` / `pointToSegmentDist` bugüne
 * kadar `routingService.ts` içinde yaşıyordu. O modül zustand · isNative ·
 * ttsService import eder; yani saf bir map-matching modeli onu import edemez
 * (yan etki + React/IO bulaşır, "model saf olmalı" kuralı çiğnenir).
 *
 * Bu dosya yalnız matematiktir: **I/O YOK · timer YOK · `Date.now` YOK ·
 * global durum YOK · React YOK**. `routingService` aynı sembolleri buradan
 * import edip YENİDEN İHRAÇ eder → mevcut tüketiciler (hazardService,
 * fuelAdvisorService, tripCorridorEngine, tripPreviewEngine, navigationService)
 * hiç değişmez ve YENİ bir geometri matematiği yazılmaz.
 */

const DEG2RAD = Math.PI / 180;
const EARTH_R_M = 6_371_000;

/** İki nokta arası büyük-daire mesafesi (metre). */
export function hav(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * DEG2RAD;
  const dLon = (lon2 - lon1) * DEG2RAD;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * DEG2RAD) *
    Math.cos(lat2 * DEG2RAD) *
    Math.sin(dLon / 2) ** 2;
  return EARTH_R_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * P noktasının AB segmenti üzerindeki skaler izdüşümü t ∈ [0,1].
 * Planar derece yaklaşımı — ≤2 km segmentlerde hata ihmal edilebilir.
 */
export function projectOnSegment(
  pLat: number, pLon: number,
  aLat: number, aLon: number,
  bLat: number, bLon: number,
): number {
  const dx    = bLon - aLon;
  const dy    = bLat - aLat;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return 0;
  return Math.max(0, Math.min(1,
    ((pLon - aLon) * dx + (pLat - aLat) * dy) / lenSq,
  ));
}

/** P noktasından AB segmentine dik (en kısa) mesafe — uçlara clamp edilir. */
export function pointToSegmentDist(
  pLat: number, pLon: number,
  aLat: number, aLon: number,
  bLat: number, bLon: number,
): number {
  const t = projectOnSegment(pLat, pLon, aLat, aLon, bLat, bLon);
  return hav(pLat, pLon, aLat + t * (bLat - aLat), aLon + t * (bLon - aLon));
}

/**
 * A→B yön açısı (derece, 0=kuzey, saat yönü). Segmentin GİDİŞ yönüdür.
 * Map-matching'de "paralel yol / ters şerit" ayrımının tek kanıtı budur.
 */
export function segmentBearingDeg(
  aLat: number, aLon: number,
  bLat: number, bLon: number,
): number {
  const dLon = (bLon - aLon) * DEG2RAD;
  const la1  = aLat * DEG2RAD;
  const la2  = bLat * DEG2RAD;
  const y = Math.sin(dLon) * Math.cos(la2);
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** İki yön arası en kısa mutlak fark (0..180). */
export function angularDeltaDeg(a: number, b: number): number {
  const d = Math.abs(((a - b) % 360) + 360) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * Suffix-sum dizisi: `cum[i]` = geometry[i]'den rotanın SONUNA kalan mesafe (m).
 * `cum[n-1] === 0`. Rota kurulunca bir kez O(N), her tick'te O(1) okunur.
 */
export function buildCumulativeDistances(geometry: readonly [number, number][]): Float64Array {
  if (!geometry || geometry.length < 2) return new Float64Array(geometry?.length ?? 0);
  const n   = geometry.length;
  const cum = new Float64Array(n);
  for (let i = n - 2; i >= 0; i--) {
    cum[i] = cum[i + 1] + hav(
      geometry[i][1],     geometry[i][0],
      geometry[i + 1][1], geometry[i + 1][0],
    );
  }
  return cum;
}
