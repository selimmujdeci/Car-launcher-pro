/**
 * curveAdvisoryModel — rotada ÖNDEKİ virajın güvenli hızı. **SAF.**
 *
 * Kaynak: aktif rotanın GEOMETRİSİ (sağlayıcının çizdiği yol). Rota yoksa
 * öneri YOKTUR — aracın önündeki yolu bilmeden viraj uydurulmaz.
 *
 * Yöntem:
 *  1. Aracın rota üzerindeki konumundan ileriye `lookahead` metre, 10 m
 *     aralıkla yeniden örneklenir (düğüm yoğunluğu farkı eğriliği bozmasın).
 *  2. Her noktada ±20 m komşularla çevrel çember → yarıçap R.
 *  3. R < `CURVE_MAX_RADIUS_M` olan kesintisiz bölge = viraj; toplam yön
 *     değişimi `CURVE_MIN_TURN_DEG` altındaysa (hafif kıvrım) viraj sayılmaz.
 *  4. Önerilen hız v = √(a·R_min), a = `COMFORT_LATERAL_MPS2` (≈0,3 g —
 *     konforlu yanal ivme), 10'a AŞAĞI yuvarlanır, en az 20 km/sa.
 *  5. KAVŞAK DÖNÜŞÜ viraj DEĞİLDİR: tepe noktası bir manevraya
 *     `MANEUVER_EXCLUSION_M` kadar yakınsa atlanır (yoksa her "sağa dönün"
 *     "keskin viraj 20" olurdu).
 *  6. Öneri yasal sınırdan düşük değilse (viraj sınırda rahat alınıyorsa) ya
 *     da 90+ ise gösterilmez; model SONRAKİ virajı aramaya devam eder.
 */

export const COMFORT_LATERAL_MPS2 = 3.0;
export const CURVE_MAX_RADIUS_M = 250;
export const CURVE_MIN_TURN_DEG = 30;
/** Kavşak dönüşünün kavisi TomTom dönüş noktasından 41 m ötede ölçüldü (Tarsus,
 *  2026-09-24: "Şimdi sağa dönün"den 1 sn önce "keskin sağ viraj" dendi). */
export const MANEUVER_EXCLUSION_M = 60;
/** Bu ve üstü öneri gösterilmez (geniş kavis; sınır bilinmese de gürültü olur). */
export const CURVE_MAX_ADVISORY_KMH = 90;
const STEP_M = 10;
const ARM_M = 20;
const ARM_STEPS = ARM_M / STEP_M;

export interface CurveAdvisory {
  /** Aracın virajın BAŞINA uzaklığı (m); araç virajın içindeyse 0. */
  readonly distanceM: number;
  /** Önerilen en yüksek hız (km/sa). */
  readonly advisoryKmh: number;
  readonly direction: 'left' | 'right';
  /** Virajın en dar yarıçapı (m). */
  readonly minRadiusM: number;
  /** Tepe noktasının rota sonuna kalan mesafesi — virajın kimliği (dedup). */
  readonly apexAlongRemainingM: number;
}

export interface CurveAdvisoryInput {
  readonly geometry: readonly [number, number][] | null;       // [lon, lat]
  /** Nokta i'den rota SONUNA kalan mesafe (m) — suffix toplamı. */
  readonly cumulativeDistances: ArrayLike<number> | null;
  readonly vehicleAlongRemainingM: number | null;
  readonly lookaheadM: number;
  /** Manevra noktalarının rota sonuna kalan mesafeleri. */
  readonly maneuverAlongRemainingM: readonly number[];
  /** Geçerli yasal sınır (km/sa); bilinmiyorsa null. */
  readonly limitKmh: number | null;
}

type XY = [number, number];

/** Kalan mesafe `along` olan noktayı geometriden bulur (doğrusal). */
function _pointAt(g: readonly [number, number][], cum: ArrayLike<number>, along: number): [number, number] | null {
  if (along > cum[0]! || along < 0) return null;
  let lo = 0, hi = g.length - 1;                   // cum azalan
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid]! >= along) lo = mid; else hi = mid;
  }
  const a = cum[lo]!, b = cum[hi]!;
  const t = a === b ? 0 : (a - along) / (a - b);
  const p = g[lo]!, q = g[hi]!;
  return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
}

function _radius(a: XY, b: XY, c: XY): number {
  const ab = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const bc = Math.hypot(c[0] - b[0], c[1] - b[1]);
  const ca = Math.hypot(a[0] - c[0], a[1] - c[1]);
  const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const area2 = Math.abs(cross);
  if (area2 < 1e-9) return Infinity;
  return (ab * bc * ca) / (2 * area2);
}

function _turnSign(a: XY, b: XY, c: XY): number {
  return (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
}

function _bearingDelta(a: XY, b: XY, c: XY): number {
  const h1 = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const h2 = Math.atan2(c[1] - b[1], c[0] - b[0]);
  let d = (h2 - h1) * 180 / Math.PI;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
}

/** Öndeki ilk virajın önerisi; yoksa `null`. */
export function decideCurveAdvisory(i: CurveAdvisoryInput): CurveAdvisory | null {
  const g = i.geometry, cum = i.cumulativeDistances, along0 = i.vehicleAlongRemainingM;
  if (!g || g.length < 3 || !cum || cum.length !== g.length || along0 === null || !Number.isFinite(along0)) return null;

  // 1) Yerel düzleme örnekle (metre). Geri 20 m de alınır ki aracın içinde olduğu viraj görülsün.
  const lat0 = g[0]![1] * Math.PI / 180;
  const kx = 111_320 * Math.cos(lat0), ky = 110_540;
  const pts: XY[] = [];
  const alongs: number[] = [];
  for (let d = -ARM_M; d <= i.lookaheadM + ARM_M; d += STEP_M) {
    const p = _pointAt(g, cum, along0 - d);
    if (!p) { if (d > 0) break; else continue; }
    pts.push([p[0] * kx, p[1] * ky]);
    alongs.push(along0 - d);
  }
  if (pts.length < 2 * ARM_STEPS + 1) return null;

  // 2) Yarıçap ve dönüş işareti
  type S = { r: number; sign: number; along: number; turn: number };
  const s: S[] = [];
  for (let k = ARM_STEPS; k < pts.length - ARM_STEPS; k++) {
    const a = pts[k - ARM_STEPS]!, b = pts[k]!, c = pts[k + ARM_STEPS]!;
    s.push({ r: _radius(a, b, c), sign: _turnSign(a, b, c), along: alongs[k]!, turn: _bearingDelta(pts[k - 1]!, b, pts[k + 1]!) });
  }

  // 3) İlk viraj bölgesi (araç önünde ya da içinde)
  let k = 0;
  while (k < s.length) {
    if (s[k]!.r >= CURVE_MAX_RADIUS_M) { k++; continue; }
    const start = k;
    let minR = Infinity, apex = k, turnSum = 0;
    const sign = Math.sign(s[k]!.sign);
    while (k < s.length && s[k]!.r < CURVE_MAX_RADIUS_M && Math.sign(s[k]!.sign) === sign) {
      if (s[k]!.r < minR) { minR = s[k]!.r; apex = k; }
      turnSum += s[k]!.turn;
      k++;
    }
    const apexAlong = s[apex]!.along;
    if (Math.abs(turnSum) < CURVE_MIN_TURN_DEG) continue;                       // hafif kıvrım
    if (along0 - apexAlong < 0) continue;                                        // tepe geride
    if (i.maneuverAlongRemainingM.some((m) => Math.abs(m - apexAlong) <= MANEUVER_EXCLUSION_M)) continue; // kavşak dönüşü
    const v = Math.sqrt(COMFORT_LATERAL_MPS2 * minR) * 3.6;
    const advisory = Math.max(20, Math.floor(v / 10) * 10);
    if (advisory >= CURVE_MAX_ADVISORY_KMH) continue;                            // geniş kavis — uyarı değil
    if (i.limitKmh !== null && advisory >= i.limitKmh) continue;                 // sınırda rahat alınır → sonrakine bak
    return {
      distanceM: Math.max(0, along0 - s[start]!.along),
      advisoryKmh: advisory,
      direction: sign > 0 ? 'left' : 'right',
      minRadiusM: minR,
      apexAlongRemainingM: apexAlong,
    };
  }
  return null;
}
