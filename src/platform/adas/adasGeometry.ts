/**
 * adasGeometry.ts — ADAS geometri ve filtre yardımcıları (SAF).
 *
 * I/O · timer · `Date.now` · global durum YOK. Koordinatlar normalize
 * (bkz. `adasTypes` KOORDİNAT SÖZLEŞMESİ).
 *
 * ── PINHOLE MODEL ────────────────────────────────────────────────────────────
 * Normalize odak uzaklığı `fN = 0.5 / tan(HFOV/2)` (görüntü GENİŞLİĞİ birimi).
 * Düz yol varsayımıyla bir noktanın mesafesi:
 *     Z = fN · aspect · H_kamera / (y − y_ufuk)
 * `aspect` = genişlik/yükseklik; y farkı yükseklik biriminde olduğu için
 * genişlik birimine çevirir.
 */
import type { NormLine, NormPoint } from './adasTypes';

/** Referans satır — şerit ölçümleri kaputun hemen önünde, burada yapılır. */
export const LANE_REF_Y = 0.9;

/** Normalize odak uzaklığı (genişlik birimi). */
export function focalNormFromHfov(hfovDeg: number): number {
  const h = Math.min(170, Math.max(20, hfovDeg));
  return 0.5 / Math.tan((h * Math.PI) / 360);
}

/** Doğrunun `y` satırındaki x'i (doğrusal uzatma). Yatay doğru → null. */
export function lineXAtY(l: NormLine, y: number): number | null {
  const dy = l.y2 - l.y1;
  if (Math.abs(dy) < 1e-6) return null;
  return l.x1 + ((y - l.y1) / dy) * (l.x2 - l.x1);
}

/** İki şerit çizgisinin kesişimi (kaybolma noktası). Paralel → null. */
export function intersect(a: NormLine, b: NormLine): NormPoint | null {
  const d = (a.x1 - a.x2) * (b.y1 - b.y2) - (a.y1 - a.y2) * (b.x1 - b.x2);
  if (Math.abs(d) < 1e-9) return null;
  const t = ((a.x1 - b.x1) * (b.y1 - b.y2) - (a.y1 - b.y1) * (b.x1 - b.x2)) / d;
  return { x: a.x1 + t * (a.x2 - a.x1), y: a.y1 + t * (a.y2 - a.y1) };
}

/**
 * Düz-yol mesafesi (m). Nokta ufkun üstünde/çok yakınında ise ölçülemez → null.
 * `minDy` altındaki farklar yüzlerce metreye patlar; ölçüm sayılmaz.
 */
export function groundDistanceM(
  y: number, horizonY: number, fN: number, aspect: number, cameraHeightM: number, minDy = 0.004,
): number | null {
  const dy = y - horizonY;
  if (!(dy > minDy) || !(cameraHeightM > 0) || !(fN > 0) || !(aspect > 0)) return null;
  return (fN * aspect * cameraHeightM) / dy;
}

/** Bilinen gerçek genişlikten mesafe (m) — çapraz doğrulama için. */
export function widthDistanceM(widthN: number, fN: number, realWidthM: number): number | null {
  if (!(widthN > 0) || !(fN > 0)) return null;
  return (fN * realWidthM) / widthN;
}

/** Kutu kesişim/birleşim oranı. */
export function iou(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): number {
  const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const uni = a.w * a.h + b.w * b.h - inter;
  return uni > 0 ? inter / uni : 0;
}

/* ── α-β filtre (konum + hız) ──────────────────────────────────────────────── */

/**
 * Sabit kazançlı α-β izleyici: gürültülü ölçümden hem değeri hem türevini
 * (hız) tahmin eder. Kalman'ın kararlı-durum çözümüdür; ölçüm aralığı
 * değişken olabilir (dt her adımda verilir). Durum DEĞİŞMEZ — her adım yeni
 * nesne döner (saf).
 */
export interface AlphaBetaState {
  readonly x: number;
  readonly v: number;
  readonly tMs: number;
  readonly n: number;
}

export function alphaBetaStart(x: number, tMs: number): AlphaBetaState {
  return { x, v: 0, tMs, n: 1 };
}

export function alphaBetaStep(
  s: AlphaBetaState, z: number, tMs: number, alpha: number, beta: number,
): AlphaBetaState {
  const dt = (tMs - s.tMs) / 1000;
  if (!(dt > 0)) return s;
  const xp = s.x + s.v * dt;
  const r = z - xp;
  return { x: xp + alpha * r, v: s.v + (beta / dt) * r, tMs, n: s.n + 1 };
}

/** Dizinin ortancası (kopya üstünde). Boş → NaN. */
export function median(xs: readonly number[]): number {
  if (xs.length === 0) return Number.NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Ortanca mutlak sapma — dağılımın sağlam ölçüsü. */
export function mad(xs: readonly number[]): number {
  const m = median(xs);
  return median(xs.map((x) => Math.abs(x - m)));
}
