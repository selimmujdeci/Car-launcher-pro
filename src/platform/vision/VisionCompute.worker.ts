/// <reference lib="webworker" />

/**
 * VisionCompute.worker — Off-main-thread CV pipeline.
 *
 * Ana thread ImageBitmap'i transferToImageBitmap() ile gönderir;
 * worker tüm Sobel + Hough + Classify hesaplamalarını (top ~20ms Mali-400)
 * çalıştırır ve VisionFrame sonucunu geri iletir.
 *
 * Protokol:
 *   IN  { type:'DETECT',  bitmap: ImageBitmap }   — frame al, tespit çalıştır
 *   IN  { type:'STOP' }                           — worker'ı temiz kapat
 *   OUT { type:'RESULT',  frame: WorkerVisionFrame } — tespit tamamlandı
 *   OUT { type:'ERROR',   message: string }          — yakalanmış hata
 */

/* ── Tip tanımları (Zustand bağımlılığı olmadan) ─────────────────────────── */

interface LaneLine {
  x1: number; y1: number; x2: number; y2: number;
  side: 'left' | 'right';
  confidence: number;
}

interface DetectedSign {
  type: 'speed_limit';
  speedValue?: number;
  confidence: number;
  bbox: { x: number; y: number; w: number; h: number };
  timestamp: number;
}

interface WorkerVisionFrame {
  lanes:          LaneLine[];
  signs:          DetectedSign[];
  lateralOffsetM: number | null;
  processingMs:   number;
  timestamp:      number;
}

/* ── İşleme sabitleri ────────────────────────────────────────────────────── */

const PROC_W = 320;
const PROC_H = 180;

/* ── Çalışma tuval (worker içi, bir kez oluştur) ─────────────────────────── */

const _canvas = new OffscreenCanvas(PROC_W, PROC_H);
const _ctx    = _canvas.getContext('2d') as OffscreenCanvasRenderingContext2D;

/* ── Grayscale ───────────────────────────────────────────────────────────── */

function _toGray(rgba: Uint8ClampedArray, n: number): Uint8Array {
  const g = new Uint8Array(n);
  for (let i = 0, j = 0; i < n * 4; i += 4, j++) {
    g[j] = ((77 * rgba[i]) + (150 * rgba[i + 1]) + (29 * rgba[i + 2])) >> 8;
  }
  return g;
}

/* ── Sobel kenar tespiti ─────────────────────────────────────────────────── */

function _sobel(g: Uint8Array, w: number, h: number): Uint8Array {
  const mag = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    const yw = y * w;
    for (let x = 1; x < w - 1; x++) {
      const i  = yw + x;
      const gx = -g[i-w-1] + g[i-w+1] - 2*g[i-1] + 2*g[i+1] - g[i+w-1] + g[i+w+1];
      const gy =  g[i-w-1] + 2*g[i-w] + g[i-w+1] - g[i+w-1] - 2*g[i+w] - g[i+w+1];
      const ax = Math.abs(gx), ay = Math.abs(gy);
      mag[i] = Math.min(255, (ax > ay ? ax + (ay * 0.414) : ay + (ax * 0.414)) | 0);
    }
  }
  return mag;
}

/* ── Olasılıksal Hough dönüşümü ─────────────────────────────────────────── */

function _hough(
  edges: Uint8Array, w: number, h: number, voteThreshold: number,
): Array<{ x1: number; y1: number; x2: number; y2: number; votes: number }> {
  const roiTop    = Math.floor(h * 0.40);
  const N_THETA   = 60;
  const THETA_0   = 15;
  const THETA_RNG = 150;
  const RHO_MAX   = Math.ceil(Math.sqrt(w * w + h * h)) + 1;

  const cosT = new Float32Array(N_THETA);
  const sinT = new Float32Array(N_THETA);
  for (let t = 0; t < N_THETA; t++) {
    const rad = ((THETA_0 + (t / N_THETA) * THETA_RNG) * Math.PI) / 180;
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
    if (good.some(q => Math.abs(p.t - q.t) < 3 && Math.abs(p.rho - q.rho) < 12)) continue;
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

/* ── Şerit sınıflandırma ─────────────────────────────────────────────────── */

function _classifyLanes(
  lines: ReturnType<typeof _hough>, w: number,
): LaneLine[] {
  const cx       = w / 2;
  const maxVotes = lines[0]?.votes ?? 1;
  const left     = lines.filter(l => l.x2 <  cx * 1.1);
  const right    = lines.filter(l => l.x2 >= cx * 0.9);
  const result: LaneLine[] = [];
  if (left.length)  { const l = left[0];  result.push({ x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2, side: 'left',  confidence: Math.min(1, l.votes / maxVotes) }); }
  if (right.length) { const l = right[0]; result.push({ x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2, side: 'right', confidence: Math.min(1, l.votes / maxVotes) }); }
  return result;
}

function _lateralOffset(lanes: LaneLine[], w: number): number | null {
  const ll = lanes.find(l => l.side === 'left');
  const rl = lanes.find(l => l.side === 'right');
  if (!ll || !rl) return null;
  const laneWidthPx = rl.x2 - ll.x2;
  if (laneWidthPx < 20) return null;
  const midPx  = (ll.x2 + rl.x2) / 2;
  const pxPerM = laneWidthPx / 3.5;
  return (w / 2 - midPx) / pxPerM;
}

/* ── Tabela tespiti ──────────────────────────────────────────────────────── */

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
  const ar = bw > 0 ? bh / bw : 0;
  if (ar < 0.5 || ar > 1.8) return [];
  const conf = Math.min(0.95, (redCount / (bw * bh)) * 3.5 * (1 - Math.abs(ar - 1)));
  return [{ type: 'speed_limit', confidence: conf, bbox: { x: minX, y: minY, w: bw, h: bh }, timestamp: Date.now() }];
}

/* ── Ana tespit döngüsü ──────────────────────────────────────────────────── */

function _runDetection(bitmap: ImageBitmap): WorkerVisionFrame {
  const t0 = performance.now();
  _ctx.drawImage(bitmap, 0, 0, PROC_W, PROC_H);
  bitmap.close(); // transferable'ı serbest bırak

  const { data } = _ctx.getImageData(0, 0, PROC_W, PROC_H);
  const gray  = _toGray(data, PROC_W * PROC_H);
  const edges = _sobel(gray, PROC_W, PROC_H);
  const lines = _hough(edges, PROC_W, PROC_H, 10);
  const lanes = _classifyLanes(lines, PROC_W);
  const signs = _detectSigns(data, PROC_W, PROC_H);

  return {
    lanes, signs,
    lateralOffsetM: _lateralOffset(lanes, PROC_W),
    processingMs:   Math.round(performance.now() - t0),
    timestamp:      Date.now(),
  };
}

/* ── Mesaj işleyici ──────────────────────────────────────────────────────── */

self.onmessage = (e: MessageEvent): void => {
  const msg = e.data as { type: string; bitmap?: ImageBitmap };

  if (msg.type === 'STOP') {
    self.close();
    return;
  }

  if (msg.type === 'DETECT' && msg.bitmap) {
    try {
      const frame = _runDetection(msg.bitmap);
      (self as unknown as Worker).postMessage({ type: 'RESULT', frame });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      (self as unknown as Worker).postMessage({ type: 'ERROR', message });
    }
  }
};
