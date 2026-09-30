/**
 * adasGeometry.ts — Tek kameralı (monoküler) düz-yol geometrisi. SAF.
 *
 * İğne-deliği kamera + düz yol varsayımı:
 *   Yoldaki bir noktanın görüntü satırı ufka ne kadar yakınsa o kadar uzaktır.
 *     Z = f · h / (y − y_h)                     (f piksel, h kamera yüksekliği m)
 *   Normalize koordinatlarda (u,v ∈ 0..1, f_n = f / genişlik, aspect = G/Y):
 *     Z = f_n · aspect · h / (v − v_h)
 *     X = (u − u_f) · Z / f_n                    (yanal, + sağ; u_f = ileri yön sütunu)
 *     W = (u1 − u0) · Z / f_n                    (genişlik)
 *
 * ÖNEMLİ ÖZELLİK: satırdaki beklenen nesne genişliği ODAKTAN BAĞIMSIZDIR:
 *     w_px = W_m · (y − y_h) / h
 * Worker bu sayede görüş açısı bilinmeden ego-şerit koridorunu çizebilir.
 *
 * Tüm fonksiyonlar saf; geçersiz geometri → null (sahte 0 ÜRETİLMEZ).
 */

import type { AdasCalibration } from './adasTypes';

/** Mesafe tavanı (m) — ufka çok yakın satırlar sayısal olarak anlamsızdır. */
export const ADAS_MAX_RANGE_M = 150;
/** v − v_h bu değerin altındaysa satır "ufukta" sayılır (mesafe tanımsız). */
const MIN_ROW_BELOW_HORIZON = 0.004;

export interface AdasCameraModel {
  /** Genişliğe göre normalize odak uzaklığı. */
  fN: number;
  /** Kare en-boy oranı (genişlik / yükseklik). */
  aspect: number;
  horizonV: number;
  forwardU: number;
  hoodV: number;
  cameraHeightM: number;
  lateralOffsetM: number;
  bumperOffsetM: number;
}

/** Yatay görüş açısından normalize odak uzaklığı: f_n = 0.5 / tan(hfov/2). */
export function focalFromHfov(hfovDeg: number): number {
  const half = (hfovDeg * Math.PI) / 360;
  return 0.5 / Math.tan(half);
}

export function buildCameraModel(cal: AdasCalibration, aspect: number): AdasCameraModel {
  return {
    fN: focalFromHfov(cal.hfovDeg),
    aspect: aspect > 0 && Number.isFinite(aspect) ? aspect : 16 / 9,
    horizonV: cal.horizonV,
    forwardU: cal.forwardU,
    hoodV: cal.hoodV,
    cameraHeightM: cal.cameraHeightM,
    lateralOffsetM: cal.lateralOffsetM,
    bumperOffsetM: cal.bumperOffsetM,
  };
}

/** Yol üzerindeki satırın kameradan boylamsal mesafesi (m). Ufuk/üstü → null. */
export function groundDistanceFromRow(v: number, cam: AdasCameraModel): number | null {
  const dv = v - cam.horizonV;
  if (!Number.isFinite(dv) || dv < MIN_ROW_BELOW_HORIZON) return null;
  const z = (cam.fN * cam.aspect * cam.cameraHeightM) / dv;
  if (!Number.isFinite(z) || z <= 0 || z > ADAS_MAX_RANGE_M) return null;
  return z;
}

/** Mesafe Z'deki yol noktasının görüntü satırı (v). */
export function rowForDistance(zM: number, cam: AdasCameraModel): number | null {
  if (!Number.isFinite(zM) || zM <= 0) return null;
  return cam.horizonV + (cam.fN * cam.aspect * cam.cameraHeightM) / zM;
}

/** u sütunundaki noktanın Z mesafesinde araç orta çizgisine göre yanal konumu (m). */
export function lateralFromColumn(u: number, zM: number, cam: AdasCameraModel): number {
  return ((u - cam.forwardU) * zM) / cam.fN + cam.lateralOffsetM;
}

/** Z mesafesindeki nesnenin gerçek genişliği (m). */
export function widthMetersAt(uWidth: number, zM: number, cam: AdasCameraModel): number {
  return (uWidth * zM) / cam.fN;
}

/** Bilinen gerçek genişlikten mesafe (m) — gece/far çifti gibi satırın güvenilmediği durumlar. */
export function distanceFromWidth(uWidth: number, realWidthM: number, cam: AdasCameraModel): number | null {
  if (!(uWidth > 0)) return null;
  const z = (cam.fN * realWidthM) / uWidth;
  return Number.isFinite(z) && z > 0 && z <= ADAS_MAX_RANGE_M ? z : null;
}

/**
 * v satırında, yola temas eden W_m genişliğindeki bir nesnenin normalize genişliği.
 * Odaktan bağımsız: w_px = W · (y − y_h) / h → u = W · (v − v_h) · (1/aspect) / h.
 */
export function expectedWidthAtRow(v: number, realWidthM: number, horizonV: number, cameraHeightM: number, aspect: number): number {
  const dv = v - horizonV;
  if (dv <= 0) return 0;
  return (realWidthM * dv) / (cameraHeightM * aspect);
}
