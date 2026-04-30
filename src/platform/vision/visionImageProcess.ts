/**
 * visionImageProcess.ts — Görüntü işleme pipeline'ı.
 *
 * Tek sorumluluk: ham video karesinden şerit + tabela tespiti.
 *
 *   toGray     → Sobel kenar tespiti → Hough dönüşümü → şerit sınıflandırma
 *   detectSigns → kırmızı daire heuristik ile hız levhası tespiti
 *   runDetection → tam tespit geçişi, VisionFrame döner
 *   computeAndPublishConfidence → 20-kare pencereli EMA skor
 *
 * AdaptiveRuntime throttle: visionCore.ts RAF döngüsünde uygulanır;
 * bu modül yalnızca saf hesaplama sağlar.
 */

import type { VisionFrame } from '../visionStore';
import type { LaneLine, DetectedSign } from '../visionStore';
import { useVisionStore } from '../visionStore';

// ── İşleme canvas boyutları ───────────────────────────────────────────────────

/** İşleme canvas genişliği — kasıtlı olarak küçük, CPU bütçesi için */
export const PROC_W = 320;
/** İşleme canvas yüksekliği */
export const PROC_H = 180;
/** Her N render frame'de bir tespit (~10fps @ 60fps) */
export const DETECT_INTERVAL = 6;

// ── Güven skoru ───────────────────────────────────────────────────────────────

const CONF_WINDOW = 20;   // 20 karelik pencere (~2s @ 10fps)
const CONF_EMA    = 0.15; // EMA faktörü — eşik sınırında titremeyi önler

interface _ConfSample {
  hasLanes:    boolean;
  avgLaneConf: number;
  hasSign:     boolean;
  avgSignConf: number;
  timestampMs: number;
}

let _confHistory:  _ConfSample[] = [];
let _smoothedConf  = 0;

// ── Grayscale dönüşümü ────────────────────────────────────────────────────────

/** RGBA piksel dizisi → grayscale Uint8Array (BT.601 katsayıları, bölme yok) */
function _toGray(rgba: Uint8ClampedArray, n: number): Uint8Array {
  const g = new Uint8Array(n);
  for (let i = 0, j = 0; i < n * 4; i += 4, j++) {
    g[j] = ((77 * rgba[i]) + (150 * rgba[i + 1]) + (29 * rgba[i + 2])) >> 8;
  }
  return g;
}

// ── Sobel kenar tespiti ───────────────────────────────────────────────────────

/** 3×3 Sobel kenar tespiti → büyüklük haritası 0–255 arasında kırpılmış */
function _sobel(g: Uint8Array, w: number, h: number): Uint8Array {
  const mag = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    const yw = y * w;
    for (let x = 1; x < w - 1; x++) {
      const i  = yw + x;
      const gx = -g[i - w - 1] + g[i - w + 1] - 2 * g[i - 1] + 2 * g[i + 1] - g[i + w - 1] + g[i + w + 1];
      const gy =  g[i - w - 1] + 2 * g[i - w] + g[i - w + 1] - g[i + w - 1] - 2 * g[i + w] - g[i + w + 1];
      const ax = Math.abs(gx), ay = Math.abs(gy);
      mag[i] = Math.min(255, (ax > ay ? ax + (ay * 0.414) : ay + (ax * 0.414)) | 0);
    }
  }
  return mag;
}

// ── Olasılıksal Hough dönüşümü ───────────────────────────────────────────────

function _hough(
  edges: Uint8Array,
  w: number,
  h: number,
  voteThreshold: number,
): Array<{ x1: number; y1: number; x2: number; y2: number; votes: number }> {
  const roiTop = Math.floor(h * 0.40);
  const N_THETA = 60;
  const THETA_0_DEG = 15;
  const THETA_RANGE_DEG = 150;
  const RHO_MAX = Math.ceil(Math.sqrt(w * w + h * h)) + 1;

  const cosT = new Float32Array(N_THETA);
  const sinT = new Float32Array(N_THETA);
  for (let t = 0; t < N_THETA; t++) {
    const rad = ((THETA_0_DEG + (t / N_THETA) * THETA_RANGE_DEG) * Math.PI) / 180;
    cosT[t] = Math.cos(rad);
    sinT[t] = Math.sin(rad);
  }

  const acc = new Int32Array(N_THETA * RHO_MAX);
  for (let y = roiTop; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (edges[y * w + x] < 60) continue;
      for (let t = 0; t < N_THETA; t++) {
        const rho = Math.round(x * cosT[t] + y * sinT[t]);
        if (rho >= 0 && rho < RHO_MAX) acc[t * RHO_MAX + rho]++;
      }
    }
  }

  const peaks: Array<{ t: number; rho: number; v: number }> = [];
  for (let t = 0; t < N_THETA; t++) {
    const base = t * RHO_MAX;
    for (let r = 1; r < RHO_MAX - 1; r++) {
      const v = acc[base + r];
      if (v < voteThreshold) continue;
      if (v >= acc[base + r - 1] && v >= acc[base + r + 1]) peaks.push({ t, rho: r, v });
    }
  }
  peaks.sort((a, b) => b.v - a.v);

  const good: typeof peaks = [];
  for (const p of peaks) {
    if (good.some((q) => Math.abs(p.t - q.t) < 3 && Math.abs(p.rho - q.rho) < 12)) continue;
    good.push(p);
    if (good.length >= 8) break;
  }

  return good.map(({ t, rho, v }) => {
    const ct = cosT[t], st = sinT[t];
    const y1 = roiTop, y2 = h - 1;
    const x1 = Math.abs(ct) > 0.01 ? Math.round((rho - y1 * st) / ct) : Math.round(rho / ct || w / 2);
    const x2 = Math.abs(ct) > 0.01 ? Math.round((rho - y2 * st) / ct) : x1;
    return { x1, y1, x2, y2, votes: v };
  });
}

// ── Şerit sınıflandırma ───────────────────────────────────────────────────────

function _classifyLanes(
  lines: ReturnType<typeof _hough>,
  w: number,
): LaneLine[] {
  const cx = w / 2;
  const maxVotes = lines[0]?.votes ?? 1;
  const left  = lines.filter((l) => l.x2 <  cx * 1.1);
  const right = lines.filter((l) => l.x2 >= cx * 0.9);
  const result: LaneLine[] = [];
  if (left.length)  { const l = left[0];  result.push({ x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2, side: 'left',  confidence: Math.min(1, l.votes / maxVotes) }); }
  if (right.length) { const l = right[0]; result.push({ x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2, side: 'right', confidence: Math.min(1, l.votes / maxVotes) }); }
  return result;
}

function _lateralOffset(lanes: LaneLine[], w: number): number | null {
  const ll = lanes.find((l) => l.side === 'left');
  const rl = lanes.find((l) => l.side === 'right');
  if (!ll || !rl) return null;
  const laneWidthPx = rl.x2 - ll.x2;
  if (laneWidthPx < 20) return null;
  const midPx  = (ll.x2 + rl.x2) / 2;
  const pxPerM = laneWidthPx / 3.5;
  return (w / 2 - midPx) / pxPerM;
}

// ── Tabela tespiti (kırmızı daire heuristiği) ────────────────────────────────

function _detectSigns(rgba: Uint8ClampedArray, w: number, h: number): DetectedSign[] {
  const scanH = Math.floor(h * 0.50);
  let redCount = 0;
  let minX = w, maxX = 0, minY = scanH, maxY = 0;

  for (let y = 5; y < scanH; y++) {
    for (let x = 5; x < w - 5; x++) {
      const i = (y * w + x) * 4;
      const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
      if (r > 160 && g < 90 && b < 90 && r > g * 1.8 && r > b * 1.8) {
        redCount++;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }

  if (redCount < 40) return [];
  const bw = maxX - minX, bh = maxY - minY;
  if (bw < 10 || bh < 10 || bw > 100 || bh > 100) return [];
  const aspectRatio = bw > 0 ? bh / bw : 0;
  if (aspectRatio < 0.5 || aspectRatio > 1.8) return [];
  const fillRatio   = redCount / (bw * bh);
  const confidence  = Math.min(0.95, fillRatio * 3.5 * (1 - Math.abs(aspectRatio - 1)));
  return [{ type: 'speed_limit', confidence, bbox: { x: minX, y: minY, w: bw, h: bh }, timestamp: Date.now() }];
}

// ── Tam tespit geçişi ─────────────────────────────────────────────────────────

/**
 * DETECT_INTERVAL karede bir visionCore.ts tarafından çağrılır.
 * AdaptiveRuntime throttle lojisi çağıran taraftadır (SRP).
 */
export function runDetection(
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
): VisionFrame {
  const t0 = performance.now();
  const { data } = ctx.getImageData(0, 0, PROC_W, PROC_H);
  const gray   = _toGray(data, PROC_W * PROC_H);
  const edges  = _sobel(gray, PROC_W, PROC_H);
  const lines  = _hough(edges, PROC_W, PROC_H, 10);
  const lanes  = _classifyLanes(lines, PROC_W);
  const signs  = _detectSigns(data, PROC_W, PROC_H);
  return {
    lanes, signs,
    lateralOffsetM: _lateralOffset(lanes, PROC_W),
    processingMs:   Math.round(performance.now() - t0),
    timestamp:      Date.now(),
  };
}

// ── Güven skoru yayımlama ─────────────────────────────────────────────────────

export function computeAndPublishConfidence(frame: VisionFrame): void {
  const sample: _ConfSample = {
    hasLanes:    frame.lanes.length > 0,
    avgLaneConf: frame.lanes.length > 0 ? frame.lanes.reduce((s, l) => s + l.confidence, 0) / frame.lanes.length : 0,
    hasSign:     frame.signs.length > 0,
    avgSignConf: frame.signs.length > 0 ? frame.signs.reduce((s, sg) => s + sg.confidence, 0) / frame.signs.length : 0,
    timestampMs: frame.timestamp,
  };
  _confHistory.push(sample);
  if (_confHistory.length > CONF_WINDOW) _confHistory.shift();

  const n = _confHistory.length;
  if (n < 3) return;

  const withLanes   = _confHistory.filter((s) => s.hasLanes);
  const laneRate    = withLanes.length / n;
  const avgLaneConf = withLanes.length > 0 ? withLanes.reduce((s, f) => s + f.avgLaneConf, 0) / withLanes.length : 0;

  let laneStability = 1.0;
  if (withLanes.length >= 3) {
    const confs   = withLanes.map((f) => f.avgLaneConf);
    const mean    = confs.reduce((a, b) => a + b, 0) / confs.length;
    const stdDev  = Math.sqrt(confs.reduce((a, b) => a + (b - mean) ** 2, 0) / confs.length);
    laneStability = Math.max(0, 1 - (mean > 0 ? stdDev / mean : 1) * 2);
  }
  const laneScore = laneRate * avgLaneConf * laneStability;

  const EXPECTED_INTERVAL_MS = 100;
  let frameConsistency = 1.0;
  if (n >= 4) {
    let totalInterval = 0;
    for (let i = 1; i < _confHistory.length; i++) totalInterval += _confHistory[i].timestampMs - _confHistory[i - 1].timestampMs;
    frameConsistency = Math.max(0, Math.min(1, EXPECTED_INTERVAL_MS / (totalInterval / (_confHistory.length - 1))));
  }

  const withSigns = _confHistory.filter((s) => s.hasSign);
  const signScore = withSigns.length > 0 ? withSigns.reduce((s, f) => s + f.avgSignConf, 0) / withSigns.length : 0.5;

  const raw = 0.60 * laneScore + 0.25 * frameConsistency + 0.15 * signScore;
  _smoothedConf = _smoothedConf * (1 - CONF_EMA) + raw * CONF_EMA;
  const clamped = Math.max(0, Math.min(1, _smoothedConf));

  useVisionStore.setState((s) => ({
    ...s,
    confidence:      clamped,
    confidenceLevel: clamped >= 0.8 ? 'full' : clamped >= 0.5 ? 'degraded' : 'off',
  }));
}

/** Tespit geçmişini sıfırla (stopVision sonrası) */
export function resetConfidenceHistory(): void {
  _confHistory  = [];
  _smoothedConf = 0;
}
