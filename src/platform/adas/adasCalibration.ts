/**
 * adasCalibration.ts — Otomatik kamera kalibrasyonu (SAF).
 *
 * Kurulum sihirbazı yok: sürücü normal sürerken (≥ 50 km/h, iki şerit çizgisi
 * de net) şerit çizgilerinin kesiştiği nokta (UFUK) ve referans satırdaki şerit
 * ortası (ARACIN MERKEZ HATTI + montaj kayması) örneklenir. Ortanca kullanılır —
 * tek tük şerit değiştirme ya da yanlış çizgi sonucu bozmaz.
 *
 * Kalibrasyon tamamlanana kadar şerit ve takip mesafesi uyarıları VERİLMEZ
 * (CALIBRATING). Tamamlandıktan sonra kamera yerinden oynarsa (ufuk kalıcı
 * olarak kayarsa) `detectCalibrationDrift` bunu yakalar ve yeniden öğrenilir.
 *
 * I/O · timer · `Date.now` · global durum YOK.
 */
import type { AdasCalibration, LaneObservation, NormPoint } from './adasTypes';
import { LANE_REF_Y, intersect, lineXAtY, mad, median } from './adasGeometry';

/** Örnek alınacak en düşük hız (km/h) — düz ve düzenli yol davranışı. */
export const CALIB_MIN_SPEED_KMH = 50;
/** Çizgi başına en düşük güven. */
export const CALIB_MIN_LANE_CONF = 0.6;
/** Tamamlanma: örnek sayısı ve zaman yayılımı (ms). */
export const CALIB_MIN_SAMPLES = 150;
export const CALIB_MIN_SPAN_MS = 45_000;
/** Tutarlılık: ufuk ve merkez için en büyük ortanca sapma. */
export const CALIB_MAX_MAD_HORIZON = 0.03;
export const CALIB_MAX_MAD_CENTER = 0.04;
/** Tutulan en fazla örnek (halka). */
export const CALIB_WINDOW = 300;
/** Kayma: son örneklerin ufku kayıtlı ufuktan bu kadar saparsa kamera oynamıştır. */
export const CALIB_DRIFT_HORIZON = 0.06;
export const CALIB_DRIFT_MIN_SAMPLES = 80;

/** Şerit gözleminden geometri — iki çizgi de makulse. */
export interface LaneGeometry {
  readonly vanishing: NormPoint;
  /** Referans satırda sol/sağ çizgi x'i. */
  readonly xLeft: number;
  readonly xRight: number;
  readonly width: number;
  readonly mid: number;
}

/**
 * İki çizgiden makul geometri çıkarır; biri eksik, ters, kaybolma noktası
 * görüntü dışı ya da genişlik anlamsızsa `null` (tahmin ÜRETİLMEZ).
 */
export function laneGeometry(obs: LaneObservation, minConf = 0): LaneGeometry | null {
  const { left, right } = obs;
  if (!left || !right) return null;
  if (left.confidence < minConf || right.confidence < minConf) return null;
  const xLeft = lineXAtY(left, LANE_REF_Y);
  const xRight = lineXAtY(right, LANE_REF_Y);
  if (xLeft === null || xRight === null) return null;
  const width = xRight - xLeft;
  if (!(width > 0.12 && width < 1.2)) return null;
  const vp = intersect(left, right);
  if (!vp || vp.y < 0.05 || vp.y > 0.75 || vp.x < -0.2 || vp.x > 1.2) return null;
  return { vanishing: vp, xLeft, xRight, width, mid: (xLeft + xRight) / 2 };
}

export interface CalibrationLearner {
  readonly horizon: readonly number[];
  readonly vanishX: readonly number[];
  readonly center: readonly number[];
  readonly width: readonly number[];
  readonly firstMs: number | null;
  readonly lastMs: number | null;
}

export const EMPTY_LEARNER: CalibrationLearner = {
  horizon: [], vanishX: [], center: [], width: [], firstMs: null, lastMs: null,
};

const push = (xs: readonly number[], v: number): number[] =>
  xs.length >= CALIB_WINDOW ? [...xs.slice(xs.length - CALIB_WINDOW + 1), v] : [...xs, v];

/** Bir kareyi öğreniciye ekler (koşullar sağlanmıyorsa aynen döner). */
export function learnCalibrationSample(
  l: CalibrationLearner, obs: LaneObservation, speedKmh: number | null, tMs: number,
): CalibrationLearner {
  if (speedKmh === null || !(speedKmh >= CALIB_MIN_SPEED_KMH)) return l;
  const g = laneGeometry(obs, CALIB_MIN_LANE_CONF);
  if (!g) return l;
  return {
    horizon: push(l.horizon, g.vanishing.y),
    vanishX: push(l.vanishX, g.vanishing.x),
    center: push(l.center, g.mid),
    width: push(l.width, g.width),
    firstMs: l.firstMs ?? tMs,
    lastMs: tMs,
  };
}

/** 0–1 ilerleme (örnek sayısı ve zaman yayılımının zayıf olanı). */
export function calibrationProgress(l: CalibrationLearner): number {
  const n = l.horizon.length / CALIB_MIN_SAMPLES;
  const span = l.firstMs !== null && l.lastMs !== null ? (l.lastMs - l.firstMs) / CALIB_MIN_SPAN_MS : 0;
  return Math.max(0, Math.min(1, Math.min(n, span)));
}

/** Koşullar tamamsa kalibrasyonu üretir; değilse `null`. */
export function finalizeCalibration(
  l: CalibrationLearner, cameraKey: string, wallMs: number,
): AdasCalibration | null {
  if (calibrationProgress(l) < 1) return null;
  if (mad(l.horizon) > CALIB_MAX_MAD_HORIZON || mad(l.center) > CALIB_MAX_MAD_CENTER) return null;
  return {
    horizonY: median(l.horizon),
    vanishX: median(l.vanishX),
    centerX: median(l.center),
    laneWidthAtRef: median(l.width),
    samples: l.horizon.length,
    learnedAtMs: wallMs,
    cameraKey,
    source: 'auto',
  };
}

/**
 * Manuel hizalama: kullanıcı park hâlinde ufuk ve merkez çizgisini canlı
 * görüntüde hizalar. Referans satırdaki şerit genişliği pinhole modelinden
 * TÜRETİLİR (ölçülmez): Z = fN·aspect·H/(yRef − yUfuk) mesafesinde
 * `laneWidthM` genişliği normalize olarak laneWidthM·fN/Z'dir.
 * Geometri anlamsızsa (ufuk referans satırın altında vb.) `null`.
 */
export function manualCalibration(
  p: {
    horizonY: number; centerX: number; cameraHeightM: number; aspect: number;
    laneWidthM: number; cameraKey: string; wallMs: number;
  },
): AdasCalibration | null {
  const { horizonY, centerX, cameraHeightM, aspect, laneWidthM } = p;
  const dy = LANE_REF_Y - horizonY;
  if (!(horizonY > 0.05 && dy > 0.1) || !(centerX > 0.1 && centerX < 0.9)) return null;
  if (!(cameraHeightM >= 0.5 && cameraHeightM <= 3) || !(aspect > 0)) return null;
  const width = (laneWidthM * dy) / (aspect * cameraHeightM);
  if (!(width > 0.12 && width < 1.2)) return null;
  return {
    horizonY, vanishX: centerX, centerX, laneWidthAtRef: width,
    samples: 0, learnedAtMs: p.wallMs, cameraKey: p.cameraKey, source: 'manual',
  };
}

/**
 * Kayıtlı kalibrasyon hâlâ geçerli mi? Son örneklerin ufku kalıcı olarak
 * saptıysa (kamera yerinden oynadı / başka araca takıldı) `true`.
 */
export function detectCalibrationDrift(cal: AdasCalibration, recent: CalibrationLearner): boolean {
  if (recent.horizon.length < CALIB_DRIFT_MIN_SAMPLES) return false;
  return Math.abs(median(recent.horizon) - cal.horizonY) > CALIB_DRIFT_HORIZON;
}
