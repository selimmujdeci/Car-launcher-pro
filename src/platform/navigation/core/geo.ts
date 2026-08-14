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

/**
 * Kameranın bakacağı YOL YÖNÜ: oturtulmuş noktadan rota boyunca
 * `lookAheadM` metre İLERİDEKİ noktaya olan açı (derece, 0..360).
 *
 * ── NEDEN TEK SEGMENTİN YÖNÜ YETMEZ (saha ölçümü, Siverek 2026-08-13) ───────
 * 2026-08-08'de kamera ham GPS heading'inden alınıp ROTA SEGMENTİNE bağlandı
 * ve GPS gürültüsü kesildi. Ama gürültü bitmedi, yalnız YER DEĞİŞTİRDİ:
 * OSRM `overview=full` geometrisinde düğümler yol ağının kendi düğümleridir ve
 * kavşak çevresinde çok sıklaşır. Aynı Siverek rotasında ölçüldü:
 *
 *   · segmentlerin **%23'ü 5 m'den kısa**, %29'u 10 m'den kısa
 *   · ardışık segment yön farkı: medyan 7,3° · p90 25,6° · **max 91,5°**
 *   · 10 m'den kısa segmentten sonraki ortalama sıçrama **24,8°**,
 *     30 m'den uzun segmentte **11,3°** → kısa segment 2,2× gürültülü
 *
 * Araç ilerlerken en yakın segment indeksi bu kısa parçalar arasında adım adım
 * (kimi zaman ileri-geri) atlar; kamera her atlamada o farkı YER. Ölçülen en
 * büyük tek darbe **91,5°** (şehir içi) ve **118,7°** (şehir dışı) idi —
 * kullanıcının tarifi: *"kamera saçma sapan dönüp duruyor."*
 *
 * ── PENCERE NEDEN 40 m (ölçülerek seçildi, iki rotada) ──────────────────────
 * Araç 5 m adımlarla ilerletilip her adımda kamera yönü hesaplandı; en büyük
 * tek darbe:
 *
 *   pencere │ şehir içi │ şehir dışı
 *   ────────┼───────────┼───────────
 *   tek seg │   91,5°   │  118,7°     ← bugünkü davranış
 *     15 m  │   62,0°   │   75,9°
 *     25 m  │   33,0°   │   36,5°
 *     35 m  │   30,0°   │   28,4°
 *     50 m  │   20,8°   │   24,6°
 *     75 m  │   13,3°   │   19,9°
 *
 * 75 m en stabil sonucu verir ama dönüşü ~75 m önceden kamerada başlatır ve
 * `cameraEngine.computeAnticipatedBearing` ZATEN bir dönüş-öngörü katmanıdır
 * (`ANTICIPATION_MAX_DEG`). Daha geniş pencere seçmek İKİNCİ bir öngörü
 * otoritesi kurar ve iki katman üst üste dönerdi. 40 m, gürültülü kısa-segment
 * kümelerini (hepsi <10 m) rahatça kapsayan ama öngörüyü öngörü katmanına
 * bırakan aralıktır. Düz yolda medyan fark ~0,1° — yani **gecikme eklemez**.
 *
 * SAF: I/O yok, global durum yok, girdi mutasyona uğramaz.
 *
 * @param geometry   [lon, lat] rota köşeleri
 * @param segIdx     Oturtulmuş segmentin başlangıç indeksi
 * @param t          Segment üzerindeki izdüşüm oranı (0..1)
 * @param lookAheadM İleri bakış mesafesi (metre)
 * @returns 0..360 derece; hesaplanamazsa `null` (çağıran segment yönüne düşer)
 */
export function roadBearingAheadDeg(
  geometry: readonly [number, number][],
  segIdx: number,
  t: number,
  lookAheadM: number,
): number | null {
  if (!geometry || geometry.length < 2) return null;
  if (!Number.isFinite(segIdx) || segIdx < 0 || segIdx >= geometry.length - 1) return null;
  if (!Number.isFinite(t) || !Number.isFinite(lookAheadM) || lookAheadM <= 0) return null;

  const tc = t < 0 ? 0 : t > 1 ? 1 : t;
  const [aLon, aLat] = geometry[segIdx];
  const [bLon, bLat] = geometry[segIdx + 1];

  // Başlangıç: oturtulmuş nokta (aracın rota üzerindeki izdüşümü).
  const pLon = aLon + tc * (bLon - aLon);
  const pLat = aLat + tc * (bLat - aLat);

  // Rota boyunca ileri yürü — EN YAKIN SEGMENT ARAMASI YOK (ikinci otorite
  // doğmasın diye): zaten bulunmuş `segIdx`ten İLERİ doğru gidilir.
  let remaining = lookAheadM;
  let curLon = pLon;
  let curLat = pLat;

  for (let i = segIdx; i < geometry.length - 1; i++) {
    const [nLon, nLat] = geometry[i + 1];
    const d = hav(curLat, curLon, nLat, nLon);
    if (d >= remaining) {
      const f = d > 0 ? remaining / d : 0;
      const tLon = curLon + f * (nLon - curLon);
      const tLat = curLat + f * (nLat - curLat);
      // Aynı noktaya düştüyse yön tanımsızdır → çağıran fallback'e düşsün.
      if (tLat === pLat && tLon === pLon) return null;
      return segmentBearingDeg(pLat, pLon, tLat, tLon);
    }
    remaining -= d;
    curLon = nLon;
    curLat = nLat;
  }

  // Rotanın SONUNA kadar gidildi (kalan mesafe pencereden kısa) → varış yönü.
  if (curLat === pLat && curLon === pLon) return null;
  return segmentBearingDeg(pLat, pLon, curLat, curLon);
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
