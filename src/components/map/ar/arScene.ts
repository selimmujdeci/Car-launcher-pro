/**
 * arScene.ts — AR navigasyon sahnesinin SAF geometrisi.
 *
 * I/O · DOM · timer · global durum YOK. `VisionOverlay` her karede bu
 * fonksiyonlarla "yol yüzeyindeki rota nerede görünür?" sorusunu cevaplar;
 * çizim `arPainter`'dadır.
 *
 * ── KOORDİNATLAR ────────────────────────────────────────────────────────────
 *   Sahne (ENU)  : bir SAHNE ORİJİNİNE göre doğu `e` / kuzey `n` (metre).
 *   Araç         : `right` (sağa, m) · `fwd` (ileri, m) · `up` (yukarı, m).
 *   Kaynak görüntü: kamera karesi pikseli (`srcW × srcH`).
 *   Ekran        : CSS pikseli. Kamera `object-fit: cover` ile basıldığı için
 *                  kaynak → ekran dönüşümü KIRPMAYI hesaba katmalıdır
 *                  (`coverFit`). Eski çizim bunu yapmıyordu: 16:9 kare geniş
 *                  ekranda üstten/alttan kırpılınca bindirmeler yoldan kayıyordu.
 *
 * ── POZ OTORİTESİ ───────────────────────────────────────────────────────────
 *   1. ADAS kalibrasyonu (görüntüden ÖLÇÜLMÜŞ ufuk) — kamera ne olursa olsun doğru.
 *   2. Cihazın yerçekimi sensörü — yalnız kamera cihazın KENDİ arka kamerasıysa
 *      (USB kamerada ana ünitenin eğimi kameranın eğimi DEĞİLDİR).
 *   3. Varsayılan — kanıt zayıf sayılır; rota soluk çizilir.
 */

const DEG = Math.PI / 180;
const M_PER_DEG = 111_320;

export interface ScreenPt { readonly x: number; readonly y: number }

/* ── Kaynak → ekran (object-fit: cover) ─────────────────────────────────── */

export interface CoverFit {
  readonly scale: number;
  readonly offX: number;
  readonly offY: number;
  readonly srcW: number;
  readonly srcH: number;
}

/** Kaynak boyutu bilinmiyorsa (video henüz kare vermedi) 16:9 varsayılır. */
export function coverFit(srcW: number, srcH: number, dstW: number, dstH: number): CoverFit {
  const sw = srcW > 0 ? srcW : 1280;
  const sh = srcH > 0 ? srcH : 720;
  const scale = Math.max(dstW / sw, dstH / sh);
  return { scale, offX: (dstW - sw * scale) / 2, offY: (dstH - sh * scale) / 2, srcW: sw, srcH: sh };
}

/** Normalize kaynak noktası (0–1) → ekran. ADAS kutuları/çizgileri buradan geçer. */
export function normToScreen(fit: CoverFit, u: number, v: number): ScreenPt {
  return { x: fit.offX + u * fit.srcW * fit.scale, y: fit.offY + v * fit.srcH * fit.scale };
}

/* ── Kamera pozu ───────────────────────────────────────────────────────── */

export type ArPoseSource = 'adas' | 'sensor' | 'default';

export interface ArPose {
  /** Kamera eğimi (°) — pozitif = yukarı bakıyor (arAlignmentService sözleşmesi). */
  readonly pitchDeg: number;
  readonly hfovDeg: number;
  readonly heightM: number;
  readonly source: ArPoseSource;
  /** Kamera yola bakmıyorsa (telefon yere/göğe dönük) rota ÇİZİLMEZ. */
  readonly usable: boolean;
}

export const AR_DEFAULT_PITCH_DEG = -3;
export const AR_DEFAULT_HEIGHT_M = 1.2;
export const AR_HFOV_BACK_CAMERA_DEG = 66;
export const AR_HFOV_EXTERNAL_CAMERA_DEG = 80;
export const AR_MAX_ABS_PITCH_DEG = 30;

export interface ArPoseInput {
  /** ADAS aynı kamerayı canlı işliyorsa onun kamera modeli; değilse `null`. */
  readonly adas: {
    readonly hfovDeg: number;
    readonly cameraHeightM: number;
    readonly horizonY: number | null;
  } | null;
  /** arAlignmentService — `measured` yalnız gerçek yerçekimi örneği geldiyse true. */
  readonly sensor: { readonly pitchDeg: number; readonly measured: boolean };
  /** Açık kamera cihazın kendi arka kamerası mı (sensör pozu yalnız o zaman geçerli). */
  readonly deviceBackCamera: boolean;
  readonly srcW: number;
  readonly srcH: number;
}

/** Ölçülmüş ufuk satırından (normalize y) kamera eğimi. */
export function pitchFromHorizon(horizonY: number, hfovDeg: number, srcW: number, srcH: number): number {
  const fxOverH = (srcW / srcH) / (2 * Math.tan((hfovDeg * DEG) / 2));
  return Math.atan((horizonY - 0.5) / fxOverH) / DEG;
}

export function resolveArPose(input: ArPoseInput): ArPose {
  const { adas, sensor, deviceBackCamera, srcW, srcH } = input;
  const hfovDeg = adas?.hfovDeg
    ?? (deviceBackCamera ? AR_HFOV_BACK_CAMERA_DEG : AR_HFOV_EXTERNAL_CAMERA_DEG);
  const heightM = adas?.cameraHeightM ?? AR_DEFAULT_HEIGHT_M;

  let pitchDeg: number;
  let source: ArPoseSource;
  if (adas && adas.horizonY !== null && srcW > 0 && srcH > 0) {
    pitchDeg = pitchFromHorizon(adas.horizonY, hfovDeg, srcW, srcH);
    source = 'adas';
  } else if (deviceBackCamera && sensor.measured && Number.isFinite(sensor.pitchDeg)) {
    pitchDeg = sensor.pitchDeg;
    source = 'sensor';
  } else {
    pitchDeg = AR_DEFAULT_PITCH_DEG;
    source = 'default';
  }
  return { pitchDeg, hfovDeg, heightM, source, usable: Math.abs(pitchDeg) <= AR_MAX_ABS_PITCH_DEG };
}

/* ── Yer düzlemi projeksiyonu (pinhole) ─────────────────────────────────── */

/** Kameraya bundan yakın noktalar projekte edilmez (sayısal patlama). */
export const AR_NEAR_CLIP_M = 0.5;

export type GroundProjector = (right: number, fwd: number, up?: number) => ScreenPt | null;

/**
 * Araç koordinatındaki bir noktayı ekrana düşüren projektör. Model,
 * `visionGeometry._enuToCam` ile AYNI eksen/işaret sözleşmesini kullanır.
 * Yuvarlanma (roll) bilinçli olarak 0'dır: araç montajları terazidedir ve
 * cihaz sensörünün roll'ü ekran yönüne (yatay/dikey) bağlı olduğundan kamera
 * roll'ü olarak güvenilir DEĞİLDİR.
 */
export function makeGroundProjector(pose: ArPose, fit: CoverFit): GroundProjector {
  const fx = fit.srcW / (2 * Math.tan((pose.hfovDeg * DEG) / 2));
  const cx = fit.srcW / 2;
  const cy = fit.srcH / 2;
  const p = pose.pitchDeg * DEG;
  const cosP = Math.cos(p);
  const sinP = Math.sin(p);
  const h = pose.heightM;
  return (right, fwd, up = 0) => {
    const vUp = up - h;
    const z = fwd * cosP + vUp * sinP;
    if (z < AR_NEAR_CLIP_M) return null;
    const y = -fwd * sinP + vUp * cosP;
    const u = (right / z) * fx + cx;
    const v = -(y / z) * fx + cy;
    return { x: fit.offX + u * fit.scale, y: fit.offY + v * fit.scale };
  };
}

/* ── Sahne orijini ve ENU ─────────────────────────────────────────────── */

export interface SceneOrigin { readonly lat: number; readonly lon: number }

/** Orijin bu kadar uzaklaşınca yeniden kurulur (eşdikdörtgen hata sınırı). */
export const AR_ORIGIN_RESET_M = 3_000;

export function toEnu(origin: SceneOrigin, lat: number, lon: number): { e: number; n: number } {
  return {
    e: (lon - origin.lon) * M_PER_DEG * Math.cos(origin.lat * DEG),
    n: (lat - origin.lat) * M_PER_DEG,
  };
}

/** Rota polilini boyunca kümülatif yay uzunluğu (m). Rota başına bir kez. */
export function buildArcLengths(geometry: readonly (readonly [number, number])[]): Float64Array {
  const arc = new Float64Array(geometry.length);
  for (let i = 1; i < geometry.length; i++) {
    const [lon0, lat0] = geometry[i - 1];
    const [lon1, lat1] = geometry[i];
    const de = (lon1 - lon0) * M_PER_DEG * Math.cos(((lat0 + lat1) / 2) * DEG);
    const dn = (lat1 - lat0) * M_PER_DEG;
    arc[i] = arc[i - 1] + Math.sqrt(de * de + dn * dn);
  }
  return arc;
}

/* ── İleri rota yolu ───────────────────────────────────────────────────── */

/** `s` = rotanın BAŞINDAN yay uzunluğu → chevron'lar yola SABİTLENİR (dünya-kilitli). */
export interface PathPoint { readonly e: number; readonly n: number; readonly s: number }

export interface PathAhead {
  readonly points: readonly PathPoint[];
  /** En yakın segmentin başlangıç indeksi — sonraki aramanın ipucu. */
  readonly segIdx: number;
  /** Aracın rotaya dik uzaklığı (m). */
  readonly offRouteM: number;
  /** Araçtan ~25 m ileriye rota yönü (°, kuzeyden saat yönü) — yön yedeği. */
  readonly bearingDeg: number | null;
}

const PATH_SEARCH_BACK = 30;
const PATH_SEARCH_FWD = 600;
const PATH_FULL_SCAN_M = 80;

function nearestSegment(
  pts: readonly { e: number; n: number }[], lo: number, hi: number, pe: number, pn: number,
): { i: number; t: number; d2: number } {
  let best = { i: lo, t: 0, d2: Infinity };
  for (let i = lo; i < hi; i++) {
    const a = pts[i], b = pts[i + 1];
    const dx = b.e - a.e, dy = b.n - a.n;
    const len2 = dx * dx + dy * dy;
    const t = len2 < 1e-6 ? 0 : Math.max(0, Math.min(1, ((pe - a.e) * dx + (pn - a.n) * dy) / len2));
    const fx = a.e + t * dx - pe, fy = a.n + t * dy - pn;
    const d2 = fx * fx + fy * fy;
    if (d2 < best.d2) best = { i, t, d2 };
  }
  return best;
}

/**
 * Aracın rotadaki izdüşümünden itibaren `aheadM` metrelik yolu çıkarır.
 * `hintIdx` (önceki sonuç) aramayı pencereler; pencere sonucu uzaksa tam tarama.
 */
export function extractPathAhead(
  geometry: readonly (readonly [number, number])[],
  arc: Float64Array,
  origin: SceneOrigin,
  lat: number,
  lon: number,
  hintIdx: number,
  aheadM = 220,
): PathAhead | null {
  const n = geometry.length;
  if (n < 2 || arc.length !== n) return null;
  const pts = geometry.map(([gLon, gLat]) => toEnu(origin, gLat, gLon));
  const { e: pe, n: pn } = toEnu(origin, lat, lon);

  let best = hintIdx >= 0
    ? nearestSegment(pts, Math.max(0, hintIdx - PATH_SEARCH_BACK), Math.min(n - 1, hintIdx + PATH_SEARCH_FWD), pe, pn)
    : { i: 0, t: 0, d2: Infinity };
  if (!(best.d2 <= PATH_FULL_SCAN_M * PATH_FULL_SCAN_M)) best = nearestSegment(pts, 0, n - 1, pe, pn);

  const a = pts[best.i], b = pts[best.i + 1];
  const start: PathPoint = {
    e: a.e + best.t * (b.e - a.e),
    n: a.n + best.t * (b.n - a.n),
    s: arc[best.i] + best.t * (arc[best.i + 1] - arc[best.i]),
  };
  const out: PathPoint[] = [start];
  for (let i = best.i + 1; i < n; i++) {
    out.push({ e: pts[i].e, n: pts[i].n, s: arc[i] });
    if (arc[i] - start.s >= aheadM) break;
  }

  let bearingDeg: number | null = null;
  const probe = pointAtArc(out, start.s + 25);
  if (probe) {
    const de = probe.e - start.e, dn = probe.n - start.n;
    if (de * de + dn * dn > 1) bearingDeg = ((Math.atan2(de, dn) / DEG) + 360) % 360;
  }
  return { points: out, segIdx: best.i, offRouteM: Math.sqrt(best.d2), bearingDeg };
}

function pointAtArc(pts: readonly PathPoint[], s: number): PathPoint | null {
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    if (s <= b.s) {
      const t = b.s > a.s ? (s - a.s) / (b.s - a.s) : 0;
      return { e: a.e + t * (b.e - a.e), n: a.n + t * (b.n - a.n), s };
    }
  }
  return pts.length > 0 ? pts[pts.length - 1] : null;
}

/* ── Araç çerçevesi ve kırpma ──────────────────────────────────────────── */

export interface LocalPt { readonly right: number; readonly fwd: number; readonly s: number }

export function toVehicleFrame(
  pts: readonly PathPoint[], pe: number, pn: number, headingDeg: number,
): LocalPt[] {
  const h = headingDeg * DEG;
  const cosH = Math.cos(h), sinH = Math.sin(h);
  return pts.map((p) => {
    const dE = p.e - pe, dN = p.n - pn;
    return { right: dE * cosH - dN * sinH, fwd: dE * sinH + dN * cosH, s: p.s };
  });
}

function lerpAtFwd(a: LocalPt, b: LocalPt, fwd: number): LocalPt {
  const t = (fwd - a.fwd) / (b.fwd - a.fwd);
  return { right: a.right + t * (b.right - a.right), fwd, s: a.s + t * (b.s - a.s) };
}

/** Yanal sınır — bunun ötesi zaten görüş dışıdır. */
const PATH_MAX_ABS_RIGHT_M = 60;

/**
 * Yolu `[near, far]` ileri bandına kırpar. Yol banda bir kez girer; banttan
 * çıktığı (geri döndüğü / ufku aştığı) ilk yerde biter — U dönüşü kameranın
 * arkasına sarkmaz.
 */
export function clipPathForward(pts: readonly LocalPt[], near: number, far: number): LocalPt[] {
  const out: LocalPt[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    if (out.length === 0) {
      if (a.fwd >= near && a.fwd <= far) out.push(a);
      else if (a.fwd < near && b.fwd >= near) out.push(lerpAtFwd(a, b, near));
      else continue;
    }
    if (b.fwd < near) { out.push(lerpAtFwd(a, b, near)); break; }
    if (b.fwd > far) { out.push(lerpAtFwd(a, b, far)); break; }
    if (Math.abs(b.right) > PATH_MAX_ABS_RIGHT_M) { out.push(b); break; }
    out.push(b);
  }
  return out.length >= 2 ? out : [];
}

/* ── Rota halısı ve chevron'lar ────────────────────────────────────────── */

/** Her köşede yolun sol yarı-normali (yer düzleminde, birim). */
function leftNormals(pts: readonly LocalPt[]): Array<{ r: number; f: number }> {
  return pts.map((_, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const tr = b.right - a.right, tf = b.fwd - a.fwd;
    const len = Math.hypot(tr, tf) || 1;
    return { r: -tf / len, f: tr / len };
  });
}

/** Halının sol/sağ kenarları (yer düzleminde). */
export function ribbonEdges(
  pts: readonly LocalPt[], halfWidthM: number,
): { left: LocalPt[]; right: LocalPt[] } {
  const nrm = leftNormals(pts);
  return {
    left: pts.map((p, i) => ({ right: p.right + nrm[i].r * halfWidthM, fwd: p.fwd + nrm[i].f * halfWidthM, s: p.s })),
    right: pts.map((p, i) => ({ right: p.right - nrm[i].r * halfWidthM, fwd: p.fwd - nrm[i].f * halfWidthM, s: p.s })),
  };
}

export interface ChevronAnchor {
  readonly right: number;
  readonly fwd: number;
  /** Birim teğet (yer düzlemi). */
  readonly tr: number;
  readonly tf: number;
  readonly s: number;
}

/**
 * Rotanın MUTLAK yay konumunda her `spacingM` metrede bir chevron. Konum
 * rotaya bağlı olduğundan araç ilerledikçe chevron'lar yolda SABİT durur ve
 * sürücüye doğru akar (gerçek AR); GPS her güncellendiğinde zıplamaz.
 */
export function chevronAnchors(pts: readonly LocalPt[], spacingM: number): ChevronAnchor[] {
  if (pts.length < 2 || !(spacingM > 0)) return [];
  const out: ChevronAnchor[] = [];
  let k = Math.ceil(pts[0].s / spacingM);
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    if (b.s <= a.s) continue;
    const tr0 = b.right - a.right, tf0 = b.fwd - a.fwd;
    const len = Math.hypot(tr0, tf0) || 1;
    while (k * spacingM <= b.s) {
      const t = (k * spacingM - a.s) / (b.s - a.s);
      out.push({
        right: a.right + t * (b.right - a.right),
        fwd: a.fwd + t * (b.fwd - a.fwd),
        tr: tr0 / len, tf: tf0 / len, s: k * spacingM,
      });
      k++;
    }
  }
  return out;
}

/**
 * Kalın "V" chevron çokgeni (yer düzleminde, 6 köşe). Boyutlar yola YATAN bir
 * şekil için seçildi: kamera ~1.2 m yükseklikte olduğundan yer düzlemi 10 m'de
 * ~8×, 30 m'de ~25× kısalır; kısa/ince chevron ekranda çizgiye dönüşüyordu.
 */
export function chevronPolygon(
  c: ChevronAnchor, halfWidthM = 0.8, lengthM = 1.6, thickM = 0.6,
): Array<readonly [number, number]> {
  const lr = -c.tf, lf = c.tr; // sol normal
  const tip = [c.right + c.tr * lengthM / 2, c.fwd + c.tf * lengthM / 2] as const;
  const back = [c.right - c.tr * lengthM / 2, c.fwd - c.tf * lengthM / 2] as const;
  const armL = [back[0] + lr * halfWidthM, back[1] + lf * halfWidthM] as const;
  const armR = [back[0] - lr * halfWidthM, back[1] - lf * halfWidthM] as const;
  const inset = (p: readonly [number, number]) => [p[0] - c.tr * thickM, p[1] - c.tf * thickM] as const;
  return [armL, tip, armR, inset(armR), inset(tip), inset(armL)];
}

/* ── Manevra işareti ───────────────────────────────────────────────────── */

/** İşaret bu ileri bandında gösterilir (çok yakında kameranın altına girer). */
export const AR_MANEUVER_MIN_FWD_M = 8;
export const AR_MANEUVER_MAX_FWD_M = 320;

/** Uzaklıkla algısal ölçek — yakında büyük, uzakta okunur kalacak kadar. */
export function billboardScale(fwdM: number): number {
  const s = Math.sqrt(60 / Math.max(fwdM, 1));
  return Math.max(0.62, Math.min(1.3, s));
}

/* ── Kanıt kapısı ──────────────────────────────────────────────────────── */

export type ArRouteEvidence = 'GOOD' | 'WEAK' | 'NONE';
export type ArEvidenceReason =
  | 'NO_FIX' | 'LOW_ACCURACY' | 'STALE_FIX' | 'OFF_ROUTE' | 'NO_HEADING' | 'CAMERA_TILT' | null;

export interface ArEvidenceInput {
  readonly accuracyM: number | null;
  readonly fixAgeMs: number | null;
  readonly offRouteM: number | null;
  readonly headingKnown: boolean;
  readonly pose: ArPose;
}

export const AR_ACC_GOOD_M = 20;
export const AR_ACC_MAX_M = 50;
export const AR_FIX_SOFT_MS = 2_500;
export const AR_FIX_MAX_MS = 6_000;
export const AR_OFF_ROUTE_MAX_M = 40;

/**
 * AR rotası YALNIZ konumsal kanıt yeterliyse çizilir. Şerit tespit güveni
 * burada ÖLÇÜT DEĞİLDİR: rota GPS + yön + kamera pozuyla yerleştirilir;
 * şerit çizgisi olmayan mahalle sokağında da doğrudur. Kanıt zayıfsa halı
 * soluk çizilir, yoksa hiç çizilmez ve neden dürüstçe söylenir.
 */
export function routeEvidence(i: ArEvidenceInput): { level: ArRouteEvidence; reason: ArEvidenceReason; alpha: number } {
  if (!i.pose.usable) return { level: 'NONE', reason: 'CAMERA_TILT', alpha: 0 };
  if (i.accuracyM === null || i.fixAgeMs === null) return { level: 'NONE', reason: 'NO_FIX', alpha: 0 };
  if (!(i.accuracyM <= AR_ACC_MAX_M)) return { level: 'NONE', reason: 'LOW_ACCURACY', alpha: 0 };
  if (i.fixAgeMs > AR_FIX_MAX_MS) return { level: 'NONE', reason: 'STALE_FIX', alpha: 0 };
  if (i.offRouteM !== null && i.offRouteM > AR_OFF_ROUTE_MAX_M) return { level: 'NONE', reason: 'OFF_ROUTE', alpha: 0 };
  if (!i.headingKnown) return { level: 'NONE', reason: 'NO_HEADING', alpha: 0 };
  const weak = i.accuracyM > AR_ACC_GOOD_M || i.fixAgeMs > AR_FIX_SOFT_MS || i.pose.source === 'default';
  return weak ? { level: 'WEAK', reason: null, alpha: 0.55 } : { level: 'GOOD', reason: null, alpha: 1 };
}

/* ── Görüntü pozu yumuşatma (yalnız SUNUM) ─────────────────────────────── */

export interface DisplayPose { readonly e: number; readonly n: number; readonly headingDeg: number }

/** Son düzeltmeden bu kadar sonrasına kadar ileri kestirim yapılır, sonra beklenir. */
export const AR_EXTRAPOLATE_MAX_S = 1.0;

/**
 * GPS ~1 Hz'dir; AR 30 fps çizer. Son düzeltme hız × yön ile kısa süre ileri
 * taşınır, ardından üstel yumuşatılır. Bu yalnız ÇİZİM pozudur — konum gerçeği
 * DEĞİLDİR, hiçbir yere yazılmaz.
 */
export function extrapolateFix(
  fix: { e: number; n: number; courseDeg: number | null; speedMps: number | null }, ageS: number,
): { e: number; n: number } {
  if (fix.courseDeg === null || fix.speedMps === null || !(fix.speedMps > 0.5)) return { e: fix.e, n: fix.n };
  const d = fix.speedMps * Math.max(0, Math.min(AR_EXTRAPOLATE_MAX_S, ageS));
  const c = fix.courseDeg * DEG;
  return { e: fix.e + Math.sin(c) * d, n: fix.n + Math.cos(c) * d };
}

function wrap180(d: number): number { return ((d % 360) + 540) % 360 - 180; }

export function smoothPose(prev: DisplayPose | null, target: DisplayPose, dtS: number, tauS = 0.14): DisplayPose {
  if (!prev || !(dtS > 0)) return target;
  const k = 1 - Math.exp(-dtS / tauS);
  /* Büyük sıçrama (yeni rota, orijin değişimi, tünel çıkışı) yumuşatılmaz. */
  if (Math.hypot(target.e - prev.e, target.n - prev.n) > 40) return target;
  return {
    e: prev.e + (target.e - prev.e) * k,
    n: prev.n + (target.n - prev.n) * k,
    headingDeg: (prev.headingDeg + wrap180(target.headingDeg - prev.headingDeg) * k + 360) % 360,
  };
}

/* ── Kamera hatası sınıflandırma ───────────────────────────────────────── */

export type ArCameraNotice = 'DENIED' | 'NOT_FOUND' | 'BUSY' | 'LOST' | 'FAILED';

/** getUserMedia hatasını sürücüye söylenebilir bir nedene çevirir. */
export function classifyCameraError(err: unknown): ArCameraNotice {
  const name = err && typeof err === 'object' && 'name' in err ? String((err as { name: unknown }).name) : '';
  const msg = err instanceof Error ? err.message : String(err ?? '');
  const text = `${name} ${msg}`;
  if (/NotAllowed|Permission|SecurityError|izin/i.test(text)) return 'DENIED';
  if (/NotFound|DevicesNotFound|Overconstrained|not found/i.test(text)) return 'NOT_FOUND';
  if (/NotReadable|TrackStart|Could not start|in use/i.test(text)) return 'BUSY';
  return 'FAILED';
}

/** Açık kamera etiketinden: cihazın kendi arka kamerası mı? */
export function isDeviceBackCamera(label: string | null | undefined): boolean {
  if (!label) return false;
  return /facing back|back camera|rear|arka/i.test(label) && !/usb|external|uvc/i.test(label);
}
