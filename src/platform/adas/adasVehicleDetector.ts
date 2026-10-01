/**
 * adasVehicleDetector.ts — Ego şeritteki en yakın aracı bulan klasik görü dedektörü. SAF.
 *
 * VisionCompute worker'ında çalışır (bağımlılıksız; yalnız tip import eder).
 * ~320×180 gri görüntüde tek geçiş, tipik < 3 ms (Mali-400 bütçesi).
 *
 * YÖNTEM (gündüz, "araç altı gölgesi" + arka yapı doğrulaması):
 *   1. Yol referansı: kaput çizgisinin hemen üstündeki şerit koridorundan medyan parlaklık.
 *   2. Tarama: alttan (yakından) ufka doğru her satırda koridor içinde yoldan belirgin
 *      KOYU yatay koşu aranır. Beklenen araç genişliği satırdan türetilir ve ODAKTAN
 *      BAĞIMSIZDIR: px/m = (y − y_h) / h_kamera. Köprü gölgesi gibi tüm yolu kaplayan
 *      koşular genişlik sınırında elenir.
 *   3. Doğrulama: gölgenin ÜSTÜNDE ~1.2 m'lik bölgede yatay kenar yoğunluğu (tampon,
 *      plaka, cam alt kenarı) ve sol/sağ dikey kenar simetrisi. Ağaç gölgesinin üstü
 *      boş asfalttır → yapı yok → elenir.
 *   4. İlk (en yakın) geçerli aday döner.
 *
 * DÜRÜST SINIR: düşük ışıkta (gece/tünel) gölge ipucu yoktur → `lowLight: true`,
 * aday ÜRETİLMEZ. Üst katman bunu "kısıtlı" durum olarak kullanıcıya söyler.
 */

import type { AdasFrameDetections, AdasVehicleDetection } from './adasTypes';

export interface VehicleDetectorConfig {
  horizonV: number;
  forwardU: number;
  hoodV: number;
  cameraHeightM: number;
}

export const DETECTOR_CFG = {
  LOW_LIGHT_LUMA: 35,
  SHADOW_RATIO: 0.7,
  SHADOW_DELTA: 25,
  CORRIDOR_HALF_M: 2.6,
  CENTER_HALF_M: 1.6,
  RUN_MIN_M: 1.0,
  RUN_MAX_M: 3.2,
  RUN_MIN_PX: 6,
  RUN_GAP_PX: 2,
  REAR_HEIGHT_M: 1.2,
  EDGE_STRONG: 40,
  MIN_EDGE_DENSITY: 0.06,
  MIN_SYMMETRY: 0.35,
  MIN_CONFIDENCE: 0.35,
} as const;

const NONE_LEAD = null;

function medianOf(arr: number[]): number {
  if (arr.length === 0) return 0;
  const s = arr.slice().sort((a, b) => a - b);
  return s[s.length >> 1];
}

/** Satırdaki en uzun koyu koşu (küçük boşluklara toleranslı). */
function longestDarkRun(
  gray: Uint8Array, rowOff: number, x0: number, x1: number, thr: number,
): { s: number; e: number } | null {
  let best: { s: number; e: number } | null = null;
  let runS = -1, lastDark = -1;
  for (let x = x0; x <= x1; x++) {
    if (gray[rowOff + x] < thr) {
      if (runS < 0 || x - lastDark > DETECTOR_CFG.RUN_GAP_PX + 1) runS = x;
      lastDark = x;
      if (!best || lastDark - runS > best.e - best.s) best = { s: runS, e: lastDark };
    }
  }
  return best;
}

function darkFraction(gray: Uint8Array, rowOff: number, s: number, e: number, thr: number): number {
  let n = 0;
  for (let x = s; x <= e; x++) if (gray[rowOff + x] < thr) n++;
  return n / (e - s + 1);
}

/**
 * Tek karede ego-şerit öncü araç tespiti.
 * @param gray  - w×h gri seviye görüntü (satır-ana).
 */
export function detectLeadVehicle(
  gray: Uint8Array, w: number, h: number, cfg: VehicleDetectorConfig,
): AdasFrameDetections {
  const aspect = w / h;
  const yh = Math.round(cfg.horizonV * h);
  const yHood = Math.min(h - 1, Math.round(cfg.hoodV * h));
  const cx = cfg.forwardU * w;
  const camH = cfg.cameraHeightM;
  if (yh < 2 || yHood - yh < 20 || !(camH > 0)) {
    return { lead: NONE_LEAD, lowLight: false, roadLuma: 0, aspect };
  }
  const pxPerM = (y: number): number => (y - yh) / camH;

  // ── 1. Yol referansı ───────────────────────────────────────────────────
  const samples: number[] = [];
  for (let y = yHood - 12; y <= yHood - 3; y += 2) {
    const half = 1.0 * pxPerM(y);
    const a = Math.max(0, Math.round(cx - half));
    const b = Math.min(w - 1, Math.round(cx + half));
    for (let x = a; x <= b; x += 2) samples.push(gray[y * w + x]);
  }
  const roadLuma = medianOf(samples);
  if (roadLuma < DETECTOR_CFG.LOW_LIGHT_LUMA) {
    return { lead: NONE_LEAD, lowLight: true, roadLuma, aspect };
  }
  const thr = Math.min(roadLuma * DETECTOR_CFG.SHADOW_RATIO, roadLuma - DETECTOR_CFG.SHADOW_DELTA);

  // ── 2. Alttan yukarı tarama ────────────────────────────────────────────
  for (let y = yHood - 4; y > yh + 3; y--) {
    const s = pxPerM(y);
    const x0 = Math.max(1, Math.round(cx - DETECTOR_CFG.CORRIDOR_HALF_M * s));
    const x1 = Math.min(w - 2, Math.round(cx + DETECTOR_CFG.CORRIDOR_HALF_M * s));
    if (x1 - x0 < DETECTOR_CFG.RUN_MIN_PX) continue;
    const run = longestDarkRun(gray, y * w, x0, x1, thr);
    if (!run) continue;
    const len = run.e - run.s + 1;
    if (len < Math.max(DETECTOR_CFG.RUN_MIN_PX, DETECTOR_CFG.RUN_MIN_M * s)) continue;
    if (len > DETECTOR_CFG.RUN_MAX_M * s) continue;
    const rc = (run.s + run.e) / 2;
    if (Math.abs(rc - cx) > DETECTOR_CFG.CENTER_HALF_M * s) continue;

    // Gölge bandı kalınlığı (yakında ≥ 2 satır).
    const band = s >= 10 ? 2 : 1;
    let bandOk = true;
    for (let k = 1; k <= band; k++) {
      if (y - k <= yh || darkFraction(gray, (y - k) * w, run.s, run.e, thr) < 0.5) { bandOk = false; break; }
    }
    if (!bandOk) continue;

    // ── 3. Arka yapı doğrulaması ─────────────────────────────────────────
    const yTop = Math.max(yh + 1, Math.round(y - DETECTOR_CFG.REAR_HEIGHT_M * s));
    const yEnd = y - band - 1;
    if (yEnd - yTop < 3) continue;
    let strongH = 0, strongVL = 0, strongVR = 0, total = 0;
    const third = Math.max(1, Math.floor(len / 3));
    for (let yy = yTop + 1; yy < yEnd; yy++) {
      const o = yy * w;
      for (let x = Math.max(1, run.s); x <= Math.min(w - 2, run.e); x++) {
        const gy = Math.abs(gray[o + w + x] - gray[o - w + x]);
        const gx = Math.abs(gray[o + x + 1] - gray[o + x - 1]);
        total++;
        if (gy >= DETECTOR_CFG.EDGE_STRONG) strongH++;
        if (gx >= DETECTOR_CFG.EDGE_STRONG) {
          if (x < run.s + third) strongVL++;
          else if (x > run.e - third) strongVR++;
        }
      }
    }
    if (total === 0) continue;
    const edgeDensity = strongH / total;
    if (edgeDensity < DETECTOR_CFG.MIN_EDGE_DENSITY) continue;
    const vMax = Math.max(strongVL, strongVR);
    const symmetry = vMax > 0 ? Math.min(strongVL, strongVR) / vMax : 0;
    if (symmetry < DETECTOR_CFG.MIN_SYMMETRY) continue;

    const contrast = Math.min(1, (roadLuma - darkMean(gray, y * w, run.s, run.e)) / Math.max(1, roadLuma));
    const widthM = len / s;
    const widthScore = Math.max(0, 1 - Math.abs(widthM - 1.8) / 1.4);
    const confidence = Math.min(1,
      0.35 * Math.min(1, edgeDensity / 0.2)
      + 0.25 * symmetry
      + 0.25 * Math.min(1, contrast * 2)
      + 0.15 * widthScore);
    if (confidence < DETECTOR_CFG.MIN_CONFIDENCE) continue;

    const lead: AdasVehicleDetection = {
      u0: run.s / w,
      u1: (run.e + 1) / w,
      vBottom: (y + 1) / h,
      vTop: yTop / h,
      confidence,
    };
    return { lead, lowLight: false, roadLuma, aspect };
  }
  return { lead: NONE_LEAD, lowLight: false, roadLuma, aspect };
}

function darkMean(gray: Uint8Array, rowOff: number, s: number, e: number): number {
  let sum = 0;
  for (let x = s; x <= e; x++) sum += gray[rowOff + x];
  return sum / (e - s + 1);
}
