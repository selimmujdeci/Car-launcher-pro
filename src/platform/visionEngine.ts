/**
 * VisionEngine — Optional Camera + Computer Vision layer.
 *
 * Architecture:
 *   Module-level service (same pattern as obdService / gpsService).
 *   State machine: idle → checking → requesting → initializing → active | error | disabled
 *   Camera via getUserMedia (Capacitor WebView, CAMERA permission already granted).
 *   Frame pipeline:
 *     60fps RAF → capture video frame to OffscreenCanvas (320×180)
 *     Every 6th frame (~10fps) → Sobel edge + Hough lane detection + color sign detection
 *     Last detection result re-used for all 6 intermediate render frames (no stale UI)
 *   AR projection: GPS waypoints → camera-relative ENU → screen pixel via pinhole model
 *   Failure contract: ANY unhandled error → state='error', navigation UNAFFECTED.
 *
 * Threading note:
 *   Detection runs on the main thread with an OffscreenCanvas.
 *   320×180 Sobel+Hough budget is ~5–8 ms/detection, well within 100ms inter-frame.
 *   UI render (lane lines + AR arrows) runs every RAF at 60fps, separate from detection.
 */

import { create } from 'zustand';
import { logError } from './crashLogger';

/* ─────────────────────────────────────────────────────────────── */
/* TYPES                                                           */
/* ─────────────────────────────────────────────────────────────── */

export type VisionState =
  | 'idle'          // not initialized
  | 'checking'      // enumerating devices
  | 'requesting'    // awaiting getUserMedia permission
  | 'initializing'  // stream acquired, waiting for first frame
  | 'active'        // camera + detection running normally
  | 'degraded'      // camera active but detection failing (use last valid frame)
  | 'disabled'      // user disabled or device has no camera
  | 'error';        // unrecoverable (stream lost, WebRTC error)

/**
 * Confidence-gated AR rendering level.
 *   full     (≥ 0.8) — all overlays: lanes + route arrows + sign bboxes
 *   degraded (0.5–0.8) — lanes only, reduced alpha
 *   off      (< 0.5) — AR hidden, map shown at full opacity
 */
export type ConfidenceLevel = 'full' | 'degraded' | 'off';

export interface LaneLine {
  /** Coordinates in VisionOverlay canvas space (0–canvasW, 0–canvasH) */
  x1: number; y1: number;
  x2: number; y2: number;
  side: 'left' | 'right';
  confidence: number;  // 0–1
}

export interface DetectedSign {
  type: 'speed_limit' | 'stop' | 'turn_warning';
  speedValue?: number;    // km/h, only for speed_limit
  confidence: number;     // 0–1
  /** Bounding box in processing-frame coords (PROC_W × PROC_H) */
  bbox: { x: number; y: number; w: number; h: number };
  timestamp: number;
}

export interface VisionFrame {
  lanes: LaneLine[];
  signs: DetectedSign[];
  /** Estimated lateral offset from lane center, metres. null if no lane pair found. */
  lateralOffsetM: number | null;
  /** CV processing time of this frame in ms */
  processingMs: number;
  timestamp: number;
}

export interface VisionStore {
  state: VisionState;
  error: string | null;
  hasCamera: boolean;
  permissionGranted: boolean;
  frame: VisionFrame | null;
  /** Composite confidence score (0–1), EMA-smoothed over last 20 detection frames */
  confidence: number;
  /** Threshold-gated rendering level derived from confidence */
  confidenceLevel: ConfidenceLevel;
}

/* ─────────────────────────────────────────────────────────────── */
/* STORE                                                           */
/* ─────────────────────────────────────────────────────────────── */

export const useVisionStore = create<VisionStore>(() => ({
  state: 'idle',
  error: null,
  hasCamera: false,
  permissionGranted: false,
  frame: null,
  confidence: 0,
  confidenceLevel: 'off',
}));

function _set(patch: Partial<VisionStore>): void {
  useVisionStore.setState(patch);
}

/* ─────────────────────────────────────────────────────────────── */
/* MODULE STATE                                                    */
/* ─────────────────────────────────────────────────────────────── */

// Processing canvas dimensions — intentionally small for CPU budget
const PROC_W = 320;
const PROC_H = 180;

// Detect every N render frames: 60fps ÷ 6 ≈ 10 detections/second
const DETECT_INTERVAL = 6;

let _stream: MediaStream | null     = null;
let _videoEl: HTMLVideoElement | null = null;
let _procCanvas: OffscreenCanvas | HTMLCanvasElement | null = null;
let _procCtx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null = null;
let _rafId: number | null           = null;
let _running = false;
let _tick    = 0;

let _lastFrame: VisionFrame = {
  lanes: [], signs: [], lateralOffsetM: null,
  processingMs: 0, timestamp: 0,
};

const _frameListeners = new Set<(f: VisionFrame) => void>();

// ── Decoupled state sync ──────────────────────────────────────
//
// RAF loop only does:  video capture → CV detection → canvas callbacks
// React store updates: batched in a setInterval at STATE_SYNC_MS (10 fps)
//
// This prevents Zustand setState() from being called inside RAF, which
// would otherwise trigger React reconciliation on every detection frame.
//
// Two flags bridge the RAF loop and the sync timer:
//   _newFrameReady — a fresh VisionFrame is available for the store
//   _pendingState  — a state machine transition (active ↔ degraded) is queued

const STATE_SYNC_MS = 100;  // 10 fps — sufficient for UI badges / alerts

let _syncTimer:    ReturnType<typeof setInterval> | null = null;
let _newFrameReady = false;
let _pendingState: VisionState | null = null;

function _startStateSync(): void {
  if (_syncTimer) return;
  _syncTimer = setInterval(() => {
    if (!_running) return;

    // State transitions (active ↔ degraded) queued by the RAF loop
    if (_pendingState !== null) {
      _set({ state: _pendingState });
      _pendingState = null;
    }

    // Push latest detection result into React store
    if (_newFrameReady) {
      _newFrameReady = false;
      _set({ frame: _lastFrame });
      _computeAndPublishConfidence(_lastFrame);
    }
  }, STATE_SYNC_MS);
}

function _stopStateSync(): void {
  if (_syncTimer) { clearInterval(_syncTimer); _syncTimer = null; }
  _newFrameReady = false;
  _pendingState  = null;
}

/* ─────────────────────────────────────────────────────────────── */
/* CONFIDENCE SCORING                                              */
/* ─────────────────────────────────────────────────────────────── */

/**
 * Rolling 20-frame window (~2 s at 10fps detection rate).
 * Composite score = 60% lane stability + 25% frame consistency + 15% sign score.
 * EMA smoothing (α = 0.15) prevents flickering at threshold boundaries.
 */
const CONF_WINDOW  = 20;
const CONF_EMA     = 0.15;   // EMA factor per detection frame

interface _ConfSample {
  hasLanes:    boolean;
  avgLaneConf: number;   // 0 when no lanes
  hasSign:     boolean;
  avgSignConf: number;   // 0 when no signs
  timestampMs: number;
}

let _confHistory: _ConfSample[] = [];
let _smoothedConf = 0;

function _levelFromConf(c: number): ConfidenceLevel {
  if (c >= 0.8) return 'full';
  if (c >= 0.5) return 'degraded';
  return 'off';
}

function _computeAndPublishConfidence(frame: VisionFrame): void {
  // --- push sample ---
  const sample: _ConfSample = {
    hasLanes: frame.lanes.length > 0,
    avgLaneConf: frame.lanes.length > 0
      ? frame.lanes.reduce((s, l) => s + l.confidence, 0) / frame.lanes.length
      : 0,
    hasSign: frame.signs.length > 0,
    avgSignConf: frame.signs.length > 0
      ? frame.signs.reduce((s, sg) => s + sg.confidence, 0) / frame.signs.length
      : 0,
    timestampMs: frame.timestamp,
  };
  _confHistory.push(sample);
  if (_confHistory.length > CONF_WINDOW) _confHistory.shift();

  const n = _confHistory.length;
  if (n < 3) return;  // not enough history yet — keep existing smoothed value

  // --- 1. Lane stability ---
  // fraction of frames with lanes × avg lane confidence × confidence variance stability
  const withLanes    = _confHistory.filter((s) => s.hasLanes);
  const laneRate     = withLanes.length / n;
  const avgLaneConf  = withLanes.length > 0
    ? withLanes.reduce((s, f) => s + f.avgLaneConf, 0) / withLanes.length
    : 0;

  // Coefficient of variation of lane confidence values → penalises jittery detection
  let laneStability = 1.0;
  if (withLanes.length >= 3) {
    const confs  = withLanes.map((f) => f.avgLaneConf);
    const mean   = confs.reduce((a, b) => a + b, 0) / confs.length;
    const stdDev = Math.sqrt(confs.reduce((a, b) => a + (b - mean) ** 2, 0) / confs.length);
    const cv     = mean > 0 ? stdDev / mean : 1;
    // CV > 0.5 → unstable; linear scale from 0 (cv=0.5) to 1 (cv=0)
    laneStability = Math.max(0, 1 - cv * 2);
  }

  const laneScore = laneRate * avgLaneConf * laneStability;

  // --- 2. Frame consistency ---
  // Expected detection interval: DETECT_INTERVAL frames ÷ 60fps = 100 ms
  const EXPECTED_INTERVAL_MS = 100;
  let frameConsistency = 1.0;
  if (n >= 4) {
    let totalInterval = 0;
    for (let i = 1; i < _confHistory.length; i++) {
      totalInterval += _confHistory[i].timestampMs - _confHistory[i - 1].timestampMs;
    }
    const avgInterval = totalInterval / (_confHistory.length - 1);
    // Drops proportionally if frames take longer than expected (heavy load / frame drops)
    frameConsistency = Math.max(0, Math.min(1, EXPECTED_INTERVAL_MS / avgInterval));
  }

  // --- 3. Object detection (sign) score ---
  // Signs present → use confidence; absent → neutral 0.5 (absence is not a failure)
  const withSigns  = _confHistory.filter((s) => s.hasSign);
  const signScore  = withSigns.length > 0
    ? withSigns.reduce((s, f) => s + f.avgSignConf, 0) / withSigns.length
    : 0.5;

  // --- composite + EMA ---
  const raw = 0.60 * laneScore + 0.25 * frameConsistency + 0.15 * signScore;
  _smoothedConf = _smoothedConf * (1 - CONF_EMA) + raw * CONF_EMA;
  const clamped = Math.max(0, Math.min(1, _smoothedConf));

  useVisionStore.setState({
    confidence:      clamped,
    confidenceLevel: _levelFromConf(clamped),
  });
}

/* ─────────────────────────────────────────────────────────────── */
/* COMPUTER VISION PIPELINE                                        */
/* ─────────────────────────────────────────────────────────────── */

/** RGBA pixel array → grayscale Uint8Array (BT.601 coefficients, no division) */
function _toGray(rgba: Uint8ClampedArray, n: number): Uint8Array {
  const g = new Uint8Array(n);
  for (let i = 0, j = 0; i < n * 4; i += 4, j++) {
    // (77*R + 150*G + 29*B) >> 8  ≈  0.299R + 0.587G + 0.114B
    g[j] = ((77 * rgba[i]) + (150 * rgba[i + 1]) + (29 * rgba[i + 2])) >> 8;
  }
  return g;
}

/** 3×3 Sobel edge detection → magnitude map clamped 0–255 */
function _sobel(g: Uint8Array, w: number, h: number): Uint8Array {
  const mag = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    const yw = y * w;
    for (let x = 1; x < w - 1; x++) {
      const i = yw + x;
      const gx =
        -g[i - w - 1] + g[i - w + 1]
        - 2 * g[i - 1] + 2 * g[i + 1]
        - g[i + w - 1] + g[i + w + 1];
      const gy =
        g[i - w - 1] + 2 * g[i - w] + g[i - w + 1]
        - g[i + w - 1] - 2 * g[i + w] - g[i + w + 1];
      // Fast integer magnitude approximation: max + 0.4*min
      const ax = Math.abs(gx), ay = Math.abs(gy);
      mag[i] = Math.min(255, (ax > ay ? ax + (ay * 0.414) : ay + (ax * 0.414)) | 0);
    }
  }
  return mag;
}

/**
 * Probabilistic Hough Transform for lane-line detection.
 *
 * Searches theta 15–165° (skips near-horizontal lines = sky/car hood artifacts).
 * Processes only lower 60% of frame (road-surface ROI).
 * Returns up to 8 peak lines sorted by vote count, deduplicated.
 */
function _hough(
  edges: Uint8Array,
  w: number,
  h: number,
  voteThreshold: number,
): Array<{ x1: number; y1: number; x2: number; y2: number; votes: number }> {
  const roiTop = Math.floor(h * 0.40);   // ignore sky
  const N_THETA = 60;
  const THETA_0_DEG = 15;
  const THETA_RANGE_DEG = 150;           // 15°–165°
  const RHO_MAX = Math.ceil(Math.sqrt(w * w + h * h)) + 1;

  // Pre-compute trig
  const cosT = new Float32Array(N_THETA);
  const sinT = new Float32Array(N_THETA);
  for (let t = 0; t < N_THETA; t++) {
    const deg = THETA_0_DEG + (t / N_THETA) * THETA_RANGE_DEG;
    const rad = (deg * Math.PI) / 180;
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

  // Find peaks and deduplicate
  const peaks: Array<{ t: number; rho: number; v: number }> = [];
  for (let t = 0; t < N_THETA; t++) {
    const base = t * RHO_MAX;
    for (let r = 1; r < RHO_MAX - 1; r++) {
      const v = acc[base + r];
      if (v < voteThreshold) continue;
      // Local max check
      if (v >= acc[base + r - 1] && v >= acc[base + r + 1]) {
        peaks.push({ t, rho: r, v });
      }
    }
  }
  peaks.sort((a, b) => b.v - a.v);

  const good: typeof peaks = [];
  for (const p of peaks) {
    if (good.some((q) => Math.abs(p.t - q.t) < 3 && Math.abs(p.rho - q.rho) < 12)) continue;
    good.push(p);
    if (good.length >= 8) break;
  }

  // Convert (rho, theta) → (x1,y1,x2,y2) at y=roiTop and y=h-1
  return good.map(({ t, rho, v }) => {
    const ct = cosT[t], st = sinT[t];
    const y1 = roiTop, y2 = h - 1;
    // x = (rho - y*sinT) / cosT  — guard ct≈0 (horizontal lines)
    const x1 = Math.abs(ct) > 0.01 ? Math.round((rho - y1 * st) / ct) : Math.round(rho / ct || w / 2);
    const x2 = Math.abs(ct) > 0.01 ? Math.round((rho - y2 * st) / ct) : x1;
    return { x1, y1, x2, y2, votes: v };
  });
}

/** Classify raw Hough lines into left/right lane boundaries */
function _classifyLanes(
  lines: ReturnType<typeof _hough>,
  w: number,
): LaneLine[] {
  const cx = w / 2;
  const maxVotes = lines[0]?.votes ?? 1;

  // A line is "left" if its bottom endpoint is in the left half;
  // "right" if bottom endpoint is in the right half.
  const left  = lines.filter((l) => l.x2 <  cx * 1.1);
  const right = lines.filter((l) => l.x2 >= cx * 0.9);

  const result: LaneLine[] = [];
  if (left.length) {
    const l = left[0];
    result.push({ x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2,
                  side: 'left', confidence: Math.min(1, l.votes / maxVotes) });
  }
  if (right.length) {
    const l = right[0];
    result.push({ x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2,
                  side: 'right', confidence: Math.min(1, l.votes / maxVotes) });
  }
  return result;
}

/** Lateral offset from lane center — positive = drifting right */
function _lateralOffset(lanes: LaneLine[], w: number): number | null {
  const ll = lanes.find((l) => l.side === 'left');
  const rl = lanes.find((l) => l.side === 'right');
  if (!ll || !rl) return null;

  const laneWidthPx = rl.x2 - ll.x2;
  if (laneWidthPx < 20) return null;

  const midPx   = (ll.x2 + rl.x2) / 2;
  const carPx   = w / 2;
  // Standard lane width = 3.5 m
  const pxPerM  = laneWidthPx / 3.5;
  return (carPx - midPx) / pxPerM;
}

/**
 * Speed-limit sign detection via red-circle heuristic.
 *
 * Scans upper 50% of frame for clusters of red pixels (HSV-approximated).
 * A compact, roughly circular red region → probable speed limit sign.
 * Confidence is proportional to pixel cluster size and circularity.
 *
 * This is a colour-based detector — fast, deterministic, ~0.5ms.
 * A full CNN-based detector would require ONNX Runtime / TFLite native.
 */
function _detectSigns(rgba: Uint8ClampedArray, w: number, h: number): DetectedSign[] {
  const scanH = Math.floor(h * 0.50);
  let redCount = 0;
  let minX = w, maxX = 0, minY = scanH, maxY = 0;

  for (let y = 5; y < scanH; y++) {
    for (let x = 5; x < w - 5; x++) {
      const i = (y * w + x) * 4;
      const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
      // Red: high R, low G/B, saturation check
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
  // Circular sign: aspect ratio ~1.0; allow generous 0.5–1.8
  if (aspectRatio < 0.5 || aspectRatio > 1.8) return [];

  const fillRatio = redCount / (bw * bh);
  const confidence = Math.min(0.95, fillRatio * 3.5 * (1 - Math.abs(aspectRatio - 1)));

  return [{
    type: 'speed_limit',
    confidence,
    bbox: { x: minX, y: minY, w: bw, h: bh },
    timestamp: Date.now(),
  }];
}

/** Full detection pass — called every DETECT_INTERVAL frames */
function _runDetection(
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
): VisionFrame {
  const t0 = performance.now();
  const { data } = ctx.getImageData(0, 0, PROC_W, PROC_H);

  const gray  = _toGray(data, PROC_W * PROC_H);
  const edges = _sobel(gray, PROC_W, PROC_H);
  const lines = _hough(edges, PROC_W, PROC_H, /* voteThreshold */ 10);
  const lanes = _classifyLanes(lines, PROC_W);
  const signs = _detectSigns(data, PROC_W, PROC_H);
  const lateralOffsetM = _lateralOffset(lanes, PROC_W);

  return {
    lanes, signs, lateralOffsetM,
    processingMs: Math.round(performance.now() - t0),
    timestamp: Date.now(),
  };
}

/* ─────────────────────────────────────────────────────────────── */
/* RAF LOOP                                                        */
/* ─────────────────────────────────────────────────────────────── */

/**
 * RAF loop — runs at display refresh rate (60fps target).
 *
 * Responsibilities:
 *   1. Capture video frame to processing canvas (every tick)
 *   2. Run CV detection every DETECT_INTERVAL ticks (~10fps)
 *   3. Notify canvas subscribers (frameListeners) — these draw to <canvas>,
 *      they do NOT call React setState
 *
 * Explicitly NOT done here:
 *   - useVisionStore.setState() — handled by _syncTimer at 10fps
 *   - _computeAndPublishConfidence() — handled by _syncTimer
 *
 * State machine flags (_pendingState, _newFrameReady) are set here and
 * consumed by _startStateSync's setInterval without touching React in RAF.
 */
function _loop(): void {
  if (!_running) return;

  try {
    if (_videoEl && _procCtx && _videoEl.readyState >= 2) {
      _procCtx.drawImage(_videoEl, 0, 0, PROC_W, PROC_H);

      _tick++;
      if (_tick % DETECT_INTERVAL === 0) {
        try {
          _lastFrame = _runDetection(_procCtx);

          // Canvas callbacks — safe in RAF (no React setState inside)
          _frameListeners.forEach((fn) => fn(_lastFrame));

          // Signal sync timer: new frame available for React store
          _newFrameReady = true;

          // Queue state recovery — sync timer applies the setState
          if (useVisionStore.getState().state === 'degraded') {
            _pendingState = 'active';
          }
        } catch (detErr) {
          logError('VisionEngine:detect', detErr);
          // Queue degraded transition — sync timer applies the setState
          if (useVisionStore.getState().state === 'active') {
            _pendingState = 'degraded';
          }
        }
      }
    }
  } catch (frameErr) {
    logError('VisionEngine:loop', frameErr);
  }

  _rafId = requestAnimationFrame(_loop);
}

/* ─────────────────────────────────────────────────────────────── */
/* GROUND PLANE PROJECTION (AR arrow math)                        */
/* ─────────────────────────────────────────────────────────────── */

/**
 * Pinhole camera intrinsics.
 * Square pixels assumed (fx = fy), principal point at canvas centre.
 */
export interface CameraIntrinsics {
  /** Focal length in pixels — horizontal = vertical for square pixels */
  fx: number;
  /** Principal point X (pixels) */
  cx: number;
  /** Principal point Y (pixels) */
  cy: number;
}

/**
 * Derive intrinsics from canvas size and horizontal field of view.
 * fx = W / (2 * tan(hFoV/2))
 */
export function buildCameraIntrinsics(
  canvasW: number,
  canvasH: number,
  hFoVDeg: number,
): CameraIntrinsics {
  return {
    fx: canvasW / (2 * Math.tan((hFoVDeg * Math.PI / 180) / 2)),
    cx: canvasW / 2,
    cy: canvasH / 2,
  };
}

/**
 * Transform a road-surface ENU offset [dE, dN] into camera space.
 *
 * Coordinate systems:
 *   World (ENU): X = East, Y = North, Z = Up
 *   Camera:      X = Right, Y = Up,   Z = Forward  (right-hand)
 *
 * Road surface sits at world Z = 0.
 * Camera origin is at vehicle position, height camHeightM above road.
 *
 * Step 1 — Yaw:  ENU → vehicle frame  (X=right, Y=forward, Z=up)
 *   heading clockwise from north (0=N, 90=E, 180=S, 270=W)
 *   vRight = dE·cos(h) − dN·sin(h)
 *   vFwd   = dE·sin(h) + dN·cos(h)
 *
 *   Bug in previous version: wrong signs on both terms caused arrows
 *   to appear mirrored across the vehicle heading axis.
 *
 * Step 2 — Pitch: vehicle → camera  (tilt camera up by pitchDeg)
 *   Camera Z (forward) tilts from vehicle Y toward vehicle Z:
 *     camZ = vFwd·cos(p) + vUp·sin(p)
 *     camY = −vFwd·sin(p) + vUp·cos(p)
 *   where vUp = −camHeightM (road is below camera).
 *
 *   Bug in previous version: camZc sign was inverted, making road
 *   points project ABOVE the horizon instead of below.
 *
 * Step 3 — Roll: rotate in camera X-Y plane (around camera Z = forward axis)
 *   rollDeg > 0 = camera rolled clockwise (right side tilts down, e.g. cornering).
 *   Correction rotates world points clockwise by r to un-rotate the tilted image:
 *     camX' =  camX·cos(r) + camY·sin(r)
 *     camY' = −camX·sin(r) + camY·cos(r)
 *     camZ' = camZ  (forward axis unchanged)
 *
 *   Integrating roll here — NOT as a post-render canvas.rotate() — ensures that
 *   projected vertices share a consistent ground-plane origin, avoiding the pixel
 *   creep and clipping artifacts that canvas rotation produces on AR geometry.
 *
 * @returns [camX, camY, camZ] — camZ > 0 means in front of camera
 */
function _enuToCam(
  dE: number,
  dN: number,
  headingDeg: number,
  camHeightM: number,
  pitchDeg: number,
  rollDeg = 0,
): readonly [number, number, number] {
  const h = headingDeg * (Math.PI / 180);
  const p = pitchDeg   * (Math.PI / 180);
  const cosH = Math.cos(h), sinH = Math.sin(h);
  const cosP = Math.cos(p), sinP = Math.sin(p);

  // ── Step 1: yaw ──────────────────────────────────────────────
  const vRight = dE * cosH - dN * sinH;
  const vFwd   = dE * sinH + dN * cosH;
  const vUp    = -camHeightM;            // road Z=0 is below camera

  // ── Step 2: pitch around camera X (right) axis ───────────────
  const camXp = vRight;
  const camZp = vFwd * cosP + vUp * sinP;   // forward / depth
  const camYp = -vFwd * sinP + vUp * cosP;  // up (positive = above optical axis)

  // ── Step 3: roll around camera Z (forward) axis ──────────────
  if (rollDeg === 0) return [camXp, camYp, camZp] as const;
  const r    = rollDeg * (Math.PI / 180);
  const cosR = Math.cos(r), sinR = Math.sin(r);
  const camX =  camXp * cosR + camYp * sinR;
  const camY = -camXp * sinR + camYp * cosR;

  return [camX, camY, camZp] as const;
}

/**
 * Pinhole projection from camera space to screen pixel.
 *
 * Camera: X=right, Y=up, Z=forward
 * Screen: X=right, Y=down (origin top-left)
 *
 *   sx = cx + fx · (camX / camZ)
 *   sy = cy − fx · (camY / camZ)   ← minus: cam-up → screen-down
 *
 * @returns null when point is behind the camera (camZ < near-clip)
 */
function _camToScreen(
  camX: number,
  camY: number,
  camZ: number,
  K: CameraIntrinsics,
): { x: number; y: number } | null {
  if (camZ < 0.1) return null;
  return {
    x:  (camX / camZ) * K.fx + K.cx,
    y: -(camY / camZ) * K.fx + K.cy,
  };
}

/**
 * Project a GPS waypoint on the road surface to a screen pixel.
 *
 * Corrected version — fixes two sign bugs present in the original:
 *   1. Yaw rotation: dN·sin(h) was added instead of subtracted for camX,
 *      and dE·sin(h) was subtracted instead of added for camFwd.
 *      Effect: arrows appeared mirrored when heading ≠ 0/180°.
 *   2. Pitch/vertical sign: road appeared above the horizon (sy < cy)
 *      instead of below (sy > cy) at pitch = 0°.
 *
 * @param wpLat / wpLon   Waypoint GPS (on road surface)
 * @param curLat / curLon Current vehicle GPS position
 * @param headingDeg      Camera heading — clockwise from north (0=N, 90=E)
 * @param canvasW / H     AR canvas pixel dimensions
 * @param hFoVDeg         Horizontal field of view (default 65°)
 * @param camHeightM      Camera height above road (default 1.2 m)
 * @param pitchDeg        Camera tilt above horizontal, positive = up (default 0°)
 * @param rollDeg         Camera roll clockwise, positive = right side down (default 0°)
 */
export function projectGPSToScreen(
  wpLat: number, wpLon: number,
  curLat: number, curLon: number,
  headingDeg: number,
  canvasW: number, canvasH: number,
  hFoVDeg    = 65,
  camHeightM = 1.2,
  pitchDeg   = 0,
  rollDeg    = 0,
): { x: number; y: number } | null {
  const dN = (wpLat - curLat) * 111_320;
  const dE = (wpLon - curLon) * 111_320 * Math.cos(curLat * (Math.PI / 180));

  const [camX, camY, camZ] = _enuToCam(dE, dN, headingDeg, camHeightM, pitchDeg, rollDeg);
  const K  = buildCameraIntrinsics(canvasW, canvasH, hFoVDeg);
  const px = _camToScreen(camX, camY, camZ, K);
  if (!px) return null;

  if (px.x < -120 || px.x > canvasW + 120) return null;
  if (px.y < -120 || px.y > canvasH + 120) return null;

  return { x: Math.round(px.x * 10) / 10, y: Math.round(px.y * 10) / 10 };
}

/**
 * Cast a ray from a screen pixel and intersect it with the road surface.
 *
 * Inverse of projectGPSToScreen — used for touch-to-road mapping and
 * verifying that rendered arrows actually land on the road plane.
 *
 * Derivation:
 *   1. Un-project pixel (sx, sy) → camera-space ray [rayX, rayY, 1]
 *   2. Inverse roll — undo roll correction applied in _enuToCam step 3
 *   3. Inverse pitch — convert camera ray to vehicle-frame direction [vRight, vFwd, vUpDir]
 *   4. Parametric ray: P(t) = [vRight·t, vFwd·t, camHeightM + vUpDir·t]
 *   5. Ground (Z=0): t = −camHeightM / vUpDir
 *   6. Intersection: fwd = vFwd·t, right = vRight·t  (metres from vehicle)
 *
 * @param sx / sy     Screen pixel
 * @param K           Intrinsics (from buildCameraIntrinsics)
 * @param camHeightM  Camera height above road (metres)
 * @param pitchDeg    Camera tilt above horizontal (degrees)
 * @param rollDeg     Camera roll clockwise (degrees) — must match forward projection
 * @returns           {fwd, right} metres from vehicle, or null if ray is above horizon
 */
export function screenRayToGroundPlane(
  sx: number, sy: number,
  K: CameraIntrinsics,
  camHeightM: number,
  pitchDeg: number,
  rollDeg = 0,
): { fwd: number; right: number } | null {
  // ── 1. Un-project pixel → camera-space ray ───────────────────
  const rayX0 =  (sx - K.cx) / K.fx;
  const rayY0 = -(sy - K.cy) / K.fx;  // flip: screen-down → camera-up

  // ── 2. Inverse roll (R_z(r)⁻¹ = R_z(−r), i.e. CCW by r) ────
  // Forward pass applied: camX' =  camX·cos(r) + camY·sin(r)
  //                       camY' = −camX·sin(r) + camY·cos(r)
  // Inverse (transpose of orthogonal matrix):
  //   rayX = rayX0·cos(r) − rayY0·sin(r)
  //   rayY = rayX0·sin(r) + rayY0·cos(r)
  let rayX = rayX0, rayY = rayY0;
  if (rollDeg !== 0) {
    const r    = rollDeg * (Math.PI / 180);
    const cosR = Math.cos(r), sinR = Math.sin(r);
    rayX = rayX0 * cosR - rayY0 * sinR;
    rayY = rayX0 * sinR + rayY0 * cosR;
  }

  // ── 3. Inverse pitch → vehicle-frame direction ───────────────
  // Forward pass: camZ = vFwd·cos(p) + vUp·sin(p)  [camZ=1]
  //               camY = −vFwd·sin(p) + vUp·cos(p) [camY=rayY]
  // Solve: vFwd = cos(p) − rayY·sin(p),  vUpDir = sin(p) + rayY·cos(p)
  const p    = pitchDeg * (Math.PI / 180);
  const cosP = Math.cos(p), sinP = Math.sin(p);
  const vFwd   = cosP - rayY * sinP;
  const vUpDir = sinP + rayY * cosP;

  // ── 4–6. Ground intersection ─────────────────────────────────
  if (Math.abs(vUpDir) < 1e-6) return null;  // ray parallel to ground
  const t = -camHeightM / vUpDir;
  if (t <= 0) return null;                     // intersection behind camera

  return {
    fwd:   vFwd * t,   // metres ahead of vehicle
    right: rayX * t,   // metres right of vehicle
  };
}

/* ─────────────────────────────────────────────────────────────── */
/* DEPTH SCALING                                                   */
/* ─────────────────────────────────────────────────────────────── */

// Tunable depth parameters — reasonable defaults for a dashcam at 1.2m height.
const ARROW_NEAR_FADE_M      = 4;    // full opacity below this depth
const ARROW_FAR_FADE_M       = 24;   // fully transparent at this depth
const ARROW_REF_DIST_M       = 8;    // reference distance — sizeScale = 1.0 here
// ARROW_MIN_SCREEN_SCALE removed — sizeScale now uses ARROW_PERCEPTUAL_FLOOR via _perceivedSizeScale

//
// Perceptual size scaling — Stevens' power law (γ < 1)
//
// Human perception of angular size follows a compressive power law: objects at
// 4× the distance feel closer to 2.5× smaller than 4× smaller.  For AR navigation
// arrows this means pure perspective (γ = 1) makes distant arrows feel invisible
// even when they are technically on screen.
//
// sizeScale(depth) = (depth/refDist)^(1−γ)  for depth > refDist
//                  = 1.0                      for depth ≤ refDist
//
//   γ = 1.0 → no exaggeration (pure perspective, old linear floor behaviour)
//   γ = 0.5 → √-heuristic (old intermediate step)
//   γ = 0.65 → moderate exaggeration (chosen value — barely noticeable, clearly readable)
//   γ = 0.0 → constant screen size regardless of depth (no depth cue at all)
//
// A separate hard floor (ARROW_PERCEPTUAL_FLOOR) is kept for extreme distances
// where even the power curve would produce illegibly small arrows.
//
const ARROW_PERCEPTUAL_GAMMA = 0.65;
const ARROW_PERCEPTUAL_FLOOR = 0.25;  // minimum screen fraction at any distance

// ── Speed-adaptive projection range ──────────────────────────────
//
// Lookahead scales with the "2-second rule" from defensive driving:
//   At 50 km/h (13.9 m/s) → fwdFar ≈ 28 m
//   At 100 km/h (27.8 m/s) → fwdFar ≈ 50 m (clamped)
//   Stationary → fwdFar = 9 m (minimum, useful for parking guidance)
//
// Exponential low-pass filter (α = 0.04) prevents jitter from momentary
// speed changes (GPS speed noise, braking spikes).
//   τ ≈ 1/(0.04 × 60fps) ≈ 0.4 s  — rapid enough to track acceleration
//   τ ≈ 1/(0.04 × 10fps) ≈ 2.5 s  — acceptable when called from sync timer

const ARROW_LOOKAHEAD_S     = 2.0;   // seconds of forward visibility
const ARROW_MIN_FAR_M       = 9;     // minimum tip distance (stationary / slow)
const ARROW_MAX_FAR_M       = 50;    // maximum tip distance (highway)
const ARROW_NEAR_RATIO      = 0.30;  // fwdNear = fwdFar × ratio
const ARROW_RANGE_SMOOTH_α  = 0.04;  // EMA factor per call

/** Smoothed far-distance state — reset in stopVision() */
let _arrowFarM = ARROW_MIN_FAR_M;

/**
 * Arrow projection distances, adapted to current vehicle speed.
 */
export interface ArrowProjectionRange {
  /** Arrow tail — metres ahead of vehicle */
  fwdNear: number;
  /** Arrow tip — metres ahead of vehicle */
  fwdFar:  number;
}

/**
 * Compute speed-adaptive arrow projection distances.
 *
 * Call once per render frame (or per detection tick) with the current GPS
 * speed. The result is smoothed internally so rapidly-changing speeds
 * do not cause visible arrow jumps.
 *
 * Lookahead formula:  rawFar = clamp(speedMs × 2 s, 9 m, 50 m)
 * After smoothing:    fwdFar = EMA(rawFar, α=0.04)
 *
 * @param speedKmh  Current vehicle speed (km/h); use 0 when stationary or unknown
 */
export function computeArrowProjectionRange(speedKmh: number): ArrowProjectionRange {
  const speedMs = Math.max(0, speedKmh) / 3.6;
  const rawFar  = Math.min(
    ARROW_MAX_FAR_M,
    Math.max(ARROW_MIN_FAR_M, speedMs * ARROW_LOOKAHEAD_S),
  );

  // Exponential low-pass filter — damps GPS speed noise and braking spikes
  _arrowFarM += ARROW_RANGE_SMOOTH_α * (rawFar - _arrowFarM);

  return {
    fwdNear: _arrowFarM * ARROW_NEAR_RATIO,
    fwdFar:  _arrowFarM,
  };
}

function _clamp01(x: number): number { return x < 0 ? 0 : x > 1 ? 1 : x; }

/**
 * Depth-derived rendering hints for one AR arrow.
 *
 * All values are derived from the arrow midpoint's camera-space depth (camZ),
 * not from raw forward distance, so pitch and roll are already accounted for.
 */
/**
 * Perceptual world-space size multiplier for a ground-plane arrow.
 *
 * Implements Stevens' power law (exponent γ = ARROW_PERCEPTUAL_GAMMA):
 *   depth ≤ refDistM  → 1.0  (no change — arrow is at or closer than reference)
 *   depth >  refDistM → (depth/refDistM)^(1−γ)
 *
 * The returned value is the factor by which the arrow's world-space dimensions
 * (width, shaft width) should be multiplied before projection. The resulting
 * on-screen size is (depth/refDistM)^(−γ) × reference screen size.
 *
 *   depth = 16 m (2× ref): sizeScale ≈ 1.28 → on-screen ≈ 64 % of reference
 *   depth = 24 m (3× ref): sizeScale ≈ 1.44 → on-screen ≈ 48 %
 *   depth = 50 m           sizeScale ≈ 2.00 → on-screen ≈ 32 %
 *
 * Compare to the previous hard-floor model, which gave all arrows beyond 16 m
 * exactly 50 % of reference screen size — a constant that removes depth cue.
 * The power curve retains a visible gradient while staying legible at distance.
 *
 * A secondary hard floor at ARROW_PERCEPTUAL_FLOOR = 0.25 (screen fraction)
 * is kept as a safety net for extreme lookahead distances.
 */
function _perceivedSizeScale(depth: number, refDistM: number): number {
  if (depth <= refDistM) return 1.0;
  const r = depth / refDistM;
  const perceptual = Math.pow(r, 1 - ARROW_PERCEPTUAL_GAMMA);
  const hardFloor  = ARROW_PERCEPTUAL_FLOOR * r;  // ensures screen ≥ FLOOR fraction
  return Math.max(perceptual, hardFloor);
}

export interface ArrowDepthHints {
  /** Camera-space depth of arrow midpoint (metres) */
  avgDepthM: number;
  /**
   * Opacity factor [0–1].
   *   1.0  at depth ≤ ARROW_NEAR_FADE_M
   *   0.0  at depth ≥ ARROW_FAR_FADE_M
   *   Linear in between.
   */
  alpha: number;
  /**
   * Stroke-width multiplier [0–1].
   *   ctx.lineWidth = baseStroke * hints.strokeScale
   *   Thins proportionally with depth (pure perspective).
   */
  strokeScale: number;
  /**
   * World-space size multiplier applied to arrowWidthM / shaftWidthM.
   *
   *   Computed by _perceivedSizeScale() using Stevens' power law (γ = 0.65):
   *     depth ≤ ARROW_REF_DIST_M → 1.0
   *     depth >  ARROW_REF_DIST_M → (depth/refDist)^(1−0.65) = (depth/refDist)^0.35
   *
   *   On-screen fraction of reference size = (depth/refDist)^(−0.65):
   *     16 m → 64 %   24 m → 48 %   50 m → 32 %
   *
   *   This retains a visible depth gradient at all distances (unlike the old
   *   hard floor that forced constant 50 % beyond 16 m) while still exaggerating
   *   distant arrows well above pure perspective (which would give 50 %, 33 %, 16 %).
   *
   *   Hard floor: ARROW_PERCEPTUAL_FLOOR = 0.25 screen fraction (safety net).
   */
  sizeScale: number;
}

/**
 * Compute depth-based rendering hints for an arrow centred at fwdMid metres ahead.
 *
 * Operates in camera space so pitch and roll corrections are included.
 * Call this when you need hints without rebuilding the full vertex set,
 * e.g. for culling invisible arrows before projection.
 */
export function computeArrowDepthHints(
  fwdMid:    number,
  camHeightM: number,
  pitchDeg:  number,
  rollDeg    = 0,
  nearFadeM  = ARROW_NEAR_FADE_M,
  farFadeM   = ARROW_FAR_FADE_M,
  refDistM   = ARROW_REF_DIST_M,
): ArrowDepthHints {
  // Use road-surface midpoint (right=0, heading=0 = vehicle-relative)
  const [, , camZ] = _enuToCam(0, fwdMid, 0, camHeightM, pitchDeg, rollDeg);
  const depth = Math.max(0.5, camZ);  // guard against near-zero / behind

  const alpha       = _clamp01(1 - (depth - nearFadeM) / (farFadeM - nearFadeM));
  const strokeScale = _clamp01(refDistM / depth);
  const sizeScale   = _perceivedSizeScale(depth, refDistM);

  return { avgDepthM: depth, alpha, strokeScale, sizeScale };
}

/**
 * A projected arrow vertex — 3D road-surface position + screen pixel.
 */
export interface ArrowVertex {
  /** Metres right of vehicle heading (negative = left) */
  right: number;
  /** Metres ahead of vehicle */
  fwd: number;
  /** Screen pixel after projection — null if vertex is off-screen */
  screen: { x: number; y: number } | null;
}

/**
 * Return type of buildGroundArrow — vertices with pre-computed depth hints.
 */
export interface GroundArrow {
  /** 7 chevron vertices projected through the camera model */
  vertices: ArrowVertex[];
  /** Depth-derived rendering hints (alpha, strokeScale, sizeScale) */
  hints: ArrowDepthHints;
}

/**
 * Build a navigation arrow with all vertices projected onto the road surface.
 *
 * Vertices are defined in vehicle-relative space (right/fwd in metres),
 * so perspective foreshortening is automatic and correct — no screen-space
 * scaling needed. Near vertices appear wider; far vertices appear narrower.
 *
 * Arrow shape (7 vertices, chevron):
 *
 *          tip  [0]
 *         /   \
 *   lWing[6] rWing[1]    ← arrowhead base at fwdHead
 *     |           |
 *   lShaft[5] rShaft[2]  ← same distance, shaft width
 *     |           |
 *   lTail[4]  rTail[3]   ← fwdNear
 *
 * Depth scaling is automatically applied:
 *   - arrowWidthM and shaftWidthM are multiplied by hints.sizeScale before
 *     vertex generation, so the arrow stays legible at long distances.
 *   - Pass the returned hints.alpha to ctx.globalAlpha for distance fade.
 *   - Pass hints.strokeScale × baseStroke to ctx.lineWidth for thin outlines
 *     at distance.
 *
 * @param fwdNear     Arrow tail distance ahead (metres, e.g. 4)
 * @param fwdFar      Arrow tip  distance ahead (metres, e.g. 14)
 * @param arrowWidthM Natural arrowhead width at ARROW_REF_DIST_M (metres, e.g. 2.4)
 * @param shaftWidthM Natural shaft width at ARROW_REF_DIST_M (metres, e.g. 0.7)
 * @param K           Camera intrinsics (buildCameraIntrinsics)
 * @param camHeightM  Camera height above road (metres)
 * @param pitchDeg    Camera tilt above horizontal (degrees)
 * @param rollDeg     Camera roll clockwise (degrees) — integrated into projection,
 *                    NOT applied as canvas.rotate() after rendering
 */
export function buildGroundArrow(
  fwdNear: number,
  fwdFar: number,
  arrowWidthM: number,
  shaftWidthM: number,
  K: CameraIntrinsics,
  camHeightM: number,
  pitchDeg: number,
  rollDeg = 0,
): GroundArrow {
  const fwdMid = (fwdNear + fwdFar) / 2;
  const hints  = computeArrowDepthHints(fwdMid, camHeightM, pitchDeg, rollDeg);

  // Apply sizeScale to world-space dimensions so the arrow stays readable
  // at long range without losing depth cue from perspective foreshortening.
  const hw     = (arrowWidthM * hints.sizeScale) / 2;
  const hs     = (shaftWidthM * hints.sizeScale) / 2;
  const fwdHead = fwdNear + (fwdFar - fwdNear) * 0.45;

  // All vertices in vehicle-relative (right, fwd) space — Z=0 (road surface)
  const pts: Array<[number, number]> = [
    [ 0,   fwdFar  ],  // [0] tip
    [ hw,  fwdHead ],  // [1] right wing
    [ hs,  fwdHead ],  // [2] right shaft top
    [ hs,  fwdNear ],  // [3] right tail
    [-hs,  fwdNear ],  // [4] left tail
    [-hs,  fwdHead ],  // [5] left shaft top
    [-hw,  fwdHead ],  // [6] left wing
  ];

  // Vehicle-relative [right, fwd] → camera space:
  //   headingDeg=0 bypasses yaw (already in vehicle/camera-forward frame)
  //   pitch + roll applied inside _enuToCam — no post-render rotation needed
  const vertices = pts.map(([right, fwd]) => {
    const [camX, camY, camZ] = _enuToCam(right, fwd, 0, camHeightM, pitchDeg, rollDeg);
    return {
      right,
      fwd,
      screen: _camToScreen(camX, camY, camZ, K),
    };
  });

  return { vertices, hints };
}

/* ─────────────────────────────────────────────────────────────── */
/* ROUTE CURVATURE ARROWS                                          */
/* ─────────────────────────────────────────────────────────────── */

/**
 * One sampled point along the route polyline, in vehicle-relative coordinates.
 *
 * The vehicle origin is (right=0, fwd=0); the forward axis aligns with
 * headingDeg. Same coordinate frame as buildGroundArrow / _enuToCam(…, 0, …).
 */
export interface RouteSample {
  /** Metres right of vehicle heading axis (negative = left) */
  right: number;
  /** Metres ahead along vehicle heading axis */
  fwd: number;
  /**
   * Route tangent bearing relative to vehicle heading.
   *   0°  = straight ahead · +90° = curving right · −90° = curving left
   */
  localBearingDeg: number;
  /**
   * Sum of absolute bearing changes from the vehicle to this sample (degrees).
   * Zero at the first sample; grows each time the route turns.
   *
   * Used by computeOcclusionAlpha to simulate corner blockage:
   *   90° cumulative turn ≈ arrow is around a full corner → fully occluded.
   */
  cumulativeTurnDeg: number;
}

/** A 3-vertex chevron (tip + two wings) projected to AR canvas space. */
export interface RouteChevron {
  tip:   { x: number; y: number } | null;
  left:  { x: number; y: number } | null;
  right: { x: number; y: number } | null;
  hints: ArrowDepthHints;
}

/**
 * Density parameters for route arrow sampling and rendering.
 *
 * Derived by computeRouteSampleParams() from speed + screen height.
 * Pass minSpacingM + maxSamples to sampleRouteAhead, minPixelGap to buildRouteArrows.
 */
export interface RouteSampleParams {
  /**
   * Minimum world-space gap between consecutive samples (metres).
   * Grows with speed: slow = tighter, fast = wider.
   *   0 km/h → 3 m · 50 km/h → 5 m · 100 km/h → 7 m
   */
  minSpacingM: number;
  /**
   * Hard cap on the total sample count passed to sampleRouteAhead.
   * Bounds the O(n) projection work in buildRouteArrows regardless of route density.
   */
  maxSamples: number;
  /**
   * Minimum Euclidean distance (pixels) between accepted chevron tip positions.
   * Chevrons whose tip lands within this radius of an already-accepted chevron
   * are culled after projection to eliminate screen-space overlap.
   *   4 % of canvas height — adapts to 480p head units and 1080p monitors.
   *   Floor: 20 px.
   */
  minPixelGap: number;
}

/**
 * Compute arrow density parameters from vehicle speed and canvas height.
 *
 * World spacing:
 *   Derived from a 0.04 s/m rule — comfortable readability at all speeds.
 *   Clamped to [3, 7] metres to stay legible (near) and uncrowded (far).
 *
 * Screen gap:
 *   4% of canvas height — independent of device DPI so the rule holds
 *   equally on 480p head-unit panels and 1080p monitor demos.
 *
 * @param speedKmh        Current vehicle speed in km/h
 * @param screenHeightPx  AR canvas height in pixels
 */
export function computeRouteSampleParams(
  speedKmh: number,
  screenHeightPx: number,
): RouteSampleParams {
  const v = Math.max(0, speedKmh);
  return {
    minSpacingM: Math.min(7, 3 + v * 0.04),   // 3 m @ 0 → 7 m @ 100 km/h
    maxSamples:  8,                            // ≤ 8 chevrons per frame
    minPixelGap: Math.max(20, screenHeightPx * 0.04),
  };
}

/**
 * Tangent bearing of a polyline segment in vehicle-relative space.
 * dr = delta-right, df = delta-fwd → angle from fwd axis in degrees.
 */
function _segBearing(dr: number, df: number): number {
  return Math.atan2(dr, df) * (180 / Math.PI);
}

/**
 * Sample the OSRM route polyline ahead of the vehicle.
 *
 * Algorithm:
 *   1. Convert all [lon, lat] geometry to vehicle-relative (right, fwd).
 *   2. Find the segment whose foot-of-perpendicular is closest to the vehicle.
 *   3. Collect the foot + all subsequent polyline vertices up to maxDistM.
 *   4. Re-sample the resulting path at minSpacingM intervals.
 *
 * Performance: O(n) in geometry length; designed for 200–2000 point OSRM
 * polylines on 2 GB head-unit hardware.
 *
 * @param curLat / curLon  Vehicle GPS position
 * @param headingDeg       Vehicle heading clockwise from north
 * @param geometry         OSRM route coordinates — [lon, lat][] (GeoJSON order)
 * @param maxDistM         Maximum lookahead distance (metres)
 * @param minSpacingM      Minimum gap between consecutive samples
 * @param maxSamples       Hard cap on emitted samples — stops early once reached
 */
export function sampleRouteAhead(
  curLat: number, curLon: number,
  headingDeg: number,
  geometry: [number, number][],
  maxDistM: number,
  minSpacingM = 4,
  maxSamples  = 8,
): RouteSample[] {
  if (geometry.length < 2) return [];

  const latScale = 111_320;
  const lonScale = 111_320 * Math.cos(curLat * (Math.PI / 180));
  const h    = headingDeg * (Math.PI / 180);
  const cosH = Math.cos(h), sinH = Math.sin(h);

  // [lon, lat] → vehicle-relative (right, fwd)
  const pts = geometry.map(([lon, lat]): { right: number; fwd: number } => {
    const dN = (lat - curLat) * latScale;
    const dE = (lon - curLon) * lonScale;
    return { right: dE * cosH - dN * sinH, fwd: dE * sinH + dN * cosH };
  });

  // ── Find closest segment via foot-of-perpendicular ────────────
  let startIdx  = 0;
  let startR    = pts[0].right;
  let startF    = pts[0].fwd;
  let bestDist2 = Infinity;

  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i].right,     ay = pts[i].fwd;
    const bx = pts[i + 1].right, by = pts[i + 1].fwd;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    if (len2 < 0.01) continue;

    // Parametric projection of origin (vehicle) onto segment
    const t  = Math.max(0, Math.min(1, (-ax * dx - ay * dy) / len2));
    const fx = ax + t * dx;
    const fy = ay + t * dy;
    const d2 = fx * fx + fy * fy;

    if (d2 < bestDist2) {
      bestDist2 = d2;
      startIdx  = i;
      startR    = fx;
      startF    = fy;
    }
  }

  // ── Build dense path: foot + subsequent polyline vertices ─────
  const path: { right: number; fwd: number }[] = [{ right: startR, fwd: startF }];
  for (let i = startIdx + 1; i < pts.length; i++) {
    path.push(pts[i]);
    if (pts[i].fwd > maxDistM + 20) break;  // small overshoot for last interval
  }
  if (path.length < 2) return [];

  // ── Re-sample path at minSpacingM intervals ───────────────────
  const samples: RouteSample[] = [];
  let distAccum      = 0;   // cumulative arc distance along path
  let nextEmit       = 0;   // arc distance target for next sample
  let cumulativeTurn = 0;   // running sum of |bearing delta| for occlusion
  let prevBearing: number | null = null;

  for (let i = 0; i < path.length - 1; i++) {
    const ax = path[i].right,     ay = path[i].fwd;
    const bx = path[i + 1].right, by = path[i + 1].fwd;
    const dx = bx - ax, dy = by - ay;
    const segLen = Math.sqrt(dx * dx + dy * dy);
    if (segLen < 0.01) continue;

    const bearing  = _segBearing(dx, dy);
    const segStart = distAccum;
    const segEnd   = distAccum + segLen;

    // Emit all samples whose target distance falls within this segment
    while (nextEmit <= segEnd) {
      const t  = (nextEmit - segStart) / segLen;
      const sr = ax + t * dx;
      const sf = ay + t * dy;
      if (sf >= 0 && sf <= maxDistM) {
        // Accumulate bearing change since last emitted sample
        if (prevBearing !== null) {
          const delta = ((bearing - prevBearing + 540) % 360) - 180; // [-180, 180]
          cumulativeTurn += Math.abs(delta);
        }
        prevBearing = bearing;
        samples.push({
          right: sr, fwd: sf,
          localBearingDeg: bearing,
          cumulativeTurnDeg: cumulativeTurn,
        });
        if (samples.length >= maxSamples) return samples;  // budget reached
      }
      nextEmit += minSpacingM;
    }

    distAccum = segEnd;
    if (by > maxDistM) break;
  }

  return samples;
}

/**
 * Compute a [0–1] occlusion multiplier for a route chevron — no depth sensor needed.
 *
 * Three independent factors are multiplied:
 *
 *   cornerFactor  — cos²(cumulativeTurnDeg clamped to 90°).
 *                   Simulates line-of-sight blockage by buildings and road cuts
 *                   as the route curves away from the driver's viewpoint.
 *                     0° turn → 1.0 (fully visible)
 *                    45° turn → 0.50
 *                    90° turn → 0.0  (fully hidden — arrow is "around the corner")
 *
 *   lateralFactor — fades arrows that are laterally outside the road boundary.
 *                   Simulates occlusion by kerbs, crash barriers, and parked vehicles.
 *                   |right| ≤ roadHalfWidthM        → 1.0
 *                   |right| = roadHalfWidthM + fadeM → 0.0
 *
 *   depthFactor   — alpha^1.5 (convex curve of the linear depth fade).
 *                   Barely changes near arrows; aggressively hides far ones.
 *                   Simulates atmospheric haze and road-surface grazing angle.
 *
 * @param cumulativeTurnDeg  From RouteSample.cumulativeTurnDeg
 * @param rightM             From RouteSample.right (lateral offset, metres)
 * @param linearAlpha        Raw depth-based alpha from the NEAR_FADE ↔ FAR_FADE ramp
 * @param roadHalfWidthM     Half-width of road at which lateral fade begins (default 3.5 m)
 * @param lateralFadeM       Width of lateral fade zone past road edge (default 2.0 m)
 */
export function computeOcclusionAlpha(
  cumulativeTurnDeg: number,
  rightM: number,
  linearAlpha: number,
  roadHalfWidthM = 3.5,
  lateralFadeM   = 2.0,
): number {
  const turnRad      = Math.min(cumulativeTurnDeg, 90) * (Math.PI / 180);
  const cornerFactor = Math.cos(turnRad) ** 2;

  const excess       = Math.max(0, Math.abs(rightM) - roadHalfWidthM);
  const lateralFactor = _clamp01(1 - excess / lateralFadeM);

  // alpha^1.5: convex curve — slow rolloff near vehicle, fast rolloff at distance
  const depthFactor  = Math.pow(_clamp01(linearAlpha), 1.5);

  return cornerFactor * lateralFactor * depthFactor;
}

/**
 * Build AR chevrons that follow the route curvature.
 *
 * Each RouteSample becomes a 3-vertex chevron oriented along the local route
 * bearing. Uses the same pinhole model (perspective-correct sizeScale, linear
 * alpha, strokeScale) as buildGroundArrow.
 *
 * Render each chevron as a filled or stroked triangle: tip → left → right → tip.
 *
 * @param samples     From sampleRouteAhead()
 * @param K           Camera intrinsics (buildCameraIntrinsics)
 * @param camHeightM  Camera height above road (metres)
 * @param pitchDeg    Camera pitch above horizontal (degrees)
 * @param rollDeg     Camera roll clockwise (degrees)
 * @param halfLenM      Half-length of chevron along route tangent (metres, default 1.2)
 * @param halfWidthM    Half-width of chevron perpendicular to route (metres, default 0.9)
 * @param minPixelGap   Screen-space culling radius (pixels). A chevron whose projected
 *                      tip falls within this distance of any previously accepted tip is
 *                      dropped. Pass 0 (default) to skip culling — use when samples are
 *                      already spaced by computeRouteSampleParams().minPixelGap.
 */
export function buildRouteArrows(
  samples: RouteSample[],
  K: CameraIntrinsics,
  camHeightM: number,
  pitchDeg: number,
  rollDeg     = 0,
  halfLenM    = 1.2,
  halfWidthM  = 0.9,
  minPixelGap = 0,
  laneOffsetM = 0,   // lateral shift from estimateLaneOffset / smoothLaneOffset
): RouteChevron[] {
  const result: RouteChevron[] = [];
  // Accepted tip positions for screen-space distance culling (squared threshold).
  const accepted: { x: number; y: number }[] = [];
  const gap2 = minPixelGap * minPixelGap;

  for (const s of samples) {
    // Apply lane offset — shift arrow to detected lane center
    const eRight = s.right + laneOffsetM;   // effective lateral position (metres)

    const lb    = s.localBearingDeg * (Math.PI / 180);
    const sinLb = Math.sin(lb), cosLb = Math.cos(lb);

    // Depth from effective position (lane offset has negligible effect on camZ for small shifts)
    const [, , camZ] = _enuToCam(eRight, s.fwd, 0, camHeightM, pitchDeg, rollDeg);
    const depth = Math.max(0.5, camZ);

    // Linear depth ramp — then apply occlusion factors on top
    const linearAlpha = _clamp01(1 - (depth - ARROW_NEAR_FADE_M) / (ARROW_FAR_FADE_M - ARROW_NEAR_FADE_M));
    // Pass eRight so lateral occlusion reflects the arrow's actual road position
    const alpha       = computeOcclusionAlpha(s.cumulativeTurnDeg, eRight, linearAlpha);
    const strokeScale = _clamp01(ARROW_REF_DIST_M / depth);
    const sizeScale   = _perceivedSizeScale(depth, ARROW_REF_DIST_M);

    const hLen = halfLenM   * sizeScale;
    const hWid = halfWidthM * sizeScale;

    // Route tangent: t = (sinLb, cosLb)  — forward along route in (right, fwd) space
    // Route normal:  n = (cosLb, −sinLb) — right of route
    const tipR  = eRight + sinLb * hLen;
    const tipF  = s.fwd  + cosLb * hLen;
    const leftR = eRight - sinLb * hLen - cosLb * hWid;
    const leftF = s.fwd  - cosLb * hLen + sinLb * hWid;
    const rgtR  = eRight - sinLb * hLen + cosLb * hWid;
    const rgtF  = s.fwd  - cosLb * hLen - sinLb * hWid;

    const project = (r: number, f: number): { x: number; y: number } | null => {
      const [cx, cy, cz] = _enuToCam(r, f, 0, camHeightM, pitchDeg, rollDeg);
      return _camToScreen(cx, cy, cz, K);
    };

    const tip   = project(tipR,  tipF);
    const left  = project(leftR, leftF);
    const right = project(rgtR,  rgtF);

    // Screen-space density culling — skip if tip is too close to any accepted chevron.
    // O(n²) over ≤ 8 accepted chevrons; negligible vs. projection cost.
    if (minPixelGap > 0 && tip !== null) {
      const tooClose = accepted.some((prev) => {
        const dx = tip.x - prev.x;
        const dy = tip.y - prev.y;
        return dx * dx + dy * dy < gap2;
      });
      if (tooClose) continue;
      accepted.push(tip);
    }

    result.push({ tip, left, right, hints: { avgDepthM: depth, alpha, strokeScale, sizeScale } });
  }

  return result;
}

/* ─────────────────────────────────────────────────────────────── */
/* LANE ALIGNMENT                                                  */
/* ─────────────────────────────────────────────────────────────── */

/**
 * Lane position estimate derived from Hough-detected lane markings.
 *
 * Feed into smoothLaneOffset() for EMA stabilisation, then pass the
 * result as `laneOffsetM` in buildRouteArrows().
 */
export interface LaneEstimate {
  /**
   * How far the current lane center is from the vehicle heading axis (metres).
   * Positive = lane center is to the right of vehicle → arrows shift right.
   * Zero when estimation is unavailable.
   */
  laneOffsetM: number;
  /** Measured lane width (metres). -1 when only one marking was detected. */
  laneWidthM: number;
  /**
   * Detection confidence [0–1].
   *   1.0 — both lane markings projected cleanly within sanity bounds
   *   0.5 — single marking; opposite side inferred from standard width
   *   0.0 — no markings detected; caller should hold previous value
   */
  confidence: number;
}

// Standard road geometry constants (AASHTO / European norms)
const STANDARD_LANE_WIDTH_M = 3.5;   // assumed width when only one line visible
const MIN_LANE_WIDTH_M      = 2.5;   // narrowest plausible lane (urban shared)
const MAX_LANE_WIDTH_M      = 5.0;   // widest plausible single lane (truck lane)

// EMA state for lane offset smoothing
let _smoothedLaneOffsetM = 0;
const LANE_SMOOTH_α       = 0.15;    // ~6-frame time constant at 10 fps — resists jitter
const LANE_OFFSET_CLAMP_M = 2.5;     // hard clamp — bad detections can't exceed half lane

/**
 * Estimate the vehicle's lateral offset from the detected lane center.
 *
 * Algorithm:
 *   1. Select the innermost detected marking per side (closest to image centre —
 *      this is the current lane boundary, not an adjacent lane line).
 *   2. Back-project each marking's foot point (lowest screen Y = nearest road
 *      point) through screenRayToGroundPlane to get its lateral road position.
 *   3. Compute lane centre = midpoint of the two road positions.
 *      laneOffsetM = laneCenter (vehicle is at right=0; offset moves arrows to center).
 *   4. If only one marking is visible, infer the other using STANDARD_LANE_WIDTH_M.
 *   5. Sanity-check lane width; fall through to single-line or no-data on failure.
 *
 * Coordinates: all in AR canvas space. K must match the canvas used for lane detection.
 *
 * @param lanes       From VisionFrame.lanes (AR canvas coordinates)
 * @param K           Camera intrinsics — buildCameraIntrinsics(canvasW, canvasH, hFoVDeg)
 * @param camHeightM  Camera height above road (metres)
 * @param pitchDeg    Camera pitch (degrees)
 * @param rollDeg     Camera roll (degrees)
 */
export function estimateLaneOffset(
  lanes: LaneLine[],
  K: CameraIntrinsics,
  camHeightM: number,
  pitchDeg: number,
  rollDeg = 0,
): LaneEstimate {
  const leftLines  = lanes.filter((l) => l.side === 'left');
  const rightLines = lanes.filter((l) => l.side === 'right');

  // ── Select innermost line per side ───────────────────────────
  // Left side:  innermost = rightmost (largest maxX)
  // Right side: innermost = leftmost  (smallest minX)
  const leftLine = leftLines.reduce<LaneLine | null>((best, l) => {
    const mx = Math.max(l.x1, l.x2);
    return best === null || mx > Math.max(best.x1, best.x2) ? l : best;
  }, null);

  const rightLine = rightLines.reduce<LaneLine | null>((best, l) => {
    const mx = Math.min(l.x1, l.x2);
    return best === null || mx < Math.min(best.x1, best.x2) ? l : best;
  }, null);

  // ── Back-project foot point → road lateral position ──────────
  // "Foot" = bottom-most screen point of the line = nearest ground point
  function footProject(line: LaneLine): number | null {
    const [fx, fy] = line.y1 > line.y2 ? [line.x1, line.y1] : [line.x2, line.y2];
    const gp = screenRayToGroundPlane(fx, fy, K, camHeightM, pitchDeg, rollDeg);
    return gp ? gp.right : null;
  }

  const leftRoadM  = leftLine  ? footProject(leftLine)  : null;
  const rightRoadM = rightLine ? footProject(rightLine) : null;

  // ── Both lines — direct measurement ──────────────────────────
  if (leftRoadM !== null && rightRoadM !== null) {
    const width = rightRoadM - leftRoadM;
    if (width >= MIN_LANE_WIDTH_M && width <= MAX_LANE_WIDTH_M) {
      return {
        laneOffsetM: (leftRoadM + rightRoadM) / 2,
        laneWidthM:  width,
        confidence:  1.0,
      };
    }
    // Width out of sanity range → degenerate detection; try single-line fallback
  }

  // ── Single line — infer opposite boundary from standard width ─
  if (rightRoadM !== null) {
    return {
      laneOffsetM: rightRoadM - STANDARD_LANE_WIDTH_M / 2,
      laneWidthM:  STANDARD_LANE_WIDTH_M,
      confidence:  0.5,
    };
  }
  if (leftRoadM !== null) {
    return {
      laneOffsetM: leftRoadM + STANDARD_LANE_WIDTH_M / 2,
      laneWidthM:  STANDARD_LANE_WIDTH_M,
      confidence:  0.5,
    };
  }

  // ── No markings detected ──────────────────────────────────────
  return { laneOffsetM: 0, laneWidthM: -1, confidence: 0 };
}

/**
 * Update the EMA lane offset with a new estimate and return the smoothed value.
 *
 * Call once per vision frame (10 fps); use the return value as `laneOffsetM`
 * in buildRouteArrows(). When confidence = 0 the filter holds its last value —
 * arrows don't snap back to the centreline on momentary lane marking loss.
 *
 * @param estimate  From estimateLaneOffset()
 */
export function smoothLaneOffset(estimate: LaneEstimate): number {
  if (estimate.confidence > 0) {
    // Weight the update by confidence — uncertain estimates contribute less
    _smoothedLaneOffsetM +=
      LANE_SMOOTH_α * estimate.confidence * (estimate.laneOffsetM - _smoothedLaneOffsetM);
    // Hard clamp: prevent runaway from a sequence of bad detections
    _smoothedLaneOffsetM =
      Math.max(-LANE_OFFSET_CLAMP_M, Math.min(LANE_OFFSET_CLAMP_M, _smoothedLaneOffsetM));
  }
  return _smoothedLaneOffsetM;
}

/** Reset the lane offset EMA (e.g. on new route / GPS re-localisation). */
export function resetLaneOffset(): void {
  _smoothedLaneOffsetM = 0;
}

/* ─────────────────────────────────────────────────────────────── */
/* CAMERA LATENCY COMPENSATION                                     */
/* ─────────────────────────────────────────────────────────────── */

/**
 * Predicted vehicle state at the time the current frame will reach the display.
 *
 * Pass lat/lon/headingDeg to sampleRouteAhead() instead of the raw GPS values
 * so that AR overlays are spatially aligned to the vehicle's future position,
 * not the stale position captured by the camera.
 */
export interface LatencyPrediction {
  /** Predicted latitude at display time */
  lat: number;
  /** Predicted longitude at display time */
  lon: number;
  /** Predicted heading clockwise from north (degrees) */
  headingDeg: number;
  /** Total pipeline latency used for this prediction (ms) */
  latencyMs: number;
}

// ── Module-level latency state ────────────────────────────────

/** Smoothed pipeline latency: camera capture → GPU display (ms). */
let _arLatencyMs = 150;           // conservative default for Android WebView
const LATENCY_SMOOTH_α = 0.10;   // slow EMA — latency is stable, not frame-noisy
const LATENCY_MIN_MS   = 30;     // floor: USB-MIPI camera, near-zero processing
const LATENCY_MAX_MS   = 500;    // ceiling: reject obviously stale measurements

// ── Yaw-rate state (heading change per second) ────────────────

let _yawRateDegPerS  = 0;         // smoothed heading change rate
let _prevYawHeading: number | null = null;
let _prevYawTimeMs   = 0;
const YAW_RATE_α     = 0.20;     // faster α — yaw rate changes quickly in turns

/**
 * Update the pipeline latency estimate from a measured frame-to-render delay.
 *
 * Typical call site:
 *   `updateArLatency(Date.now() - frame.timestamp)`
 *   called once per vision frame (10 fps).
 *
 * Rejects implausible values (< 30 ms or > 500 ms) to guard against
 * clock skew, system sleep, or first-frame outliers.
 */
export function updateArLatency(measuredMs: number): void {
  if (measuredMs < LATENCY_MIN_MS || measuredMs > LATENCY_MAX_MS) return;
  _arLatencyMs += LATENCY_SMOOTH_α * (measuredMs - _arLatencyMs);
}

/** Override the latency estimate from a user calibration result. */
export function setArLatency(ms: number): void {
  _arLatencyMs = Math.max(LATENCY_MIN_MS, Math.min(LATENCY_MAX_MS, ms));
}

/** Current smoothed pipeline latency (ms). */
export function getArLatency(): number { return _arLatencyMs; }

/**
 * Update the yaw-rate estimate from a new heading reading.
 *
 * Call once per GPS fix (or heading update from gpsService):
 *   `updateYawRate(headingDeg)` — uses Date.now() for the timestamp.
 *
 * Rejects intervals < 50 ms (too short for stable rate) and > 2 s
 * (vehicle may have stopped/turned discontinuously).
 */
export function updateYawRate(headingDeg: number): void {
  const nowMs = Date.now();
  if (_prevYawHeading !== null) {
    const dtS = (nowMs - _prevYawTimeMs) / 1000;
    if (dtS >= 0.05 && dtS <= 2.0) {
      // Shortest-arc delta to handle 359°→1° wraparound
      const delta = ((headingDeg - _prevYawHeading + 540) % 360) - 180;
      const rawRate = delta / dtS;
      _yawRateDegPerS += YAW_RATE_α * (rawRate - _yawRateDegPerS);
    }
  }
  _prevYawHeading = headingDeg;
  _prevYawTimeMs  = nowMs;
}

/** Current smoothed yaw rate (degrees per second, positive = turning right). */
export function getYawRate(): number { return _yawRateDegPerS; }

/**
 * Predict vehicle position and heading at display time using dead-reckoning.
 *
 * The pipeline from camera capture to screen pixel takes `latencyMs`
 * (typically 100–200 ms). During this time the vehicle has moved. Using the
 * stale capture position as the AR origin causes visible misalignment —
 * arrows appear too far behind the vehicle at highway speeds.
 *
 * Dead-reckoning model (constant velocity, constant yaw rate):
 *   position:  P(t+dt) = P(t) + speed × dt × [sin(h), cos(h)]  (ENU)
 *   heading:   h(t+dt) = h(t) + yawRate × dt
 *
 * At 100 km/h (27.8 m/s) and 150 ms latency the position error is 4.2 m —
 * easily a full lane width. At 30°/s yaw rate the heading error is 4.5°.
 * Both are corrected by this function.
 *
 * @param curLat     GPS latitude at capture time
 * @param curLon     GPS longitude at capture time
 * @param headingDeg Heading at capture time (degrees CW from north)
 * @param speedMs    Speed at capture time (m/s)
 * @param latencyMs  Override pipeline latency; defaults to smoothed estimate
 */
export function predictVehicleState(
  curLat: number, curLon: number,
  headingDeg: number,
  speedMs: number,
  latencyMs = _arLatencyMs,
): LatencyPrediction {
  const dt  = latencyMs / 1000;
  const h   = headingDeg * (Math.PI / 180);

  // ── Position dead-reckoning ───────────────────────────────────
  // ENU: East = lon axis, North = lat axis
  const dN = speedMs * Math.cos(h) * dt;
  const dE = speedMs * Math.sin(h) * dt;
  const latScale = 111_320;
  const lonScale = 111_320 * Math.cos(curLat * (Math.PI / 180));

  const lat = curLat + dN / latScale;
  const lon = curLon + dE / lonScale;

  // ── Heading dead-reckoning ────────────────────────────────────
  // Include yaw-rate compensation; clamp turn to 45° to reject runaway estimates
  const headingShift   = Math.max(-45, Math.min(45, _yawRateDegPerS * dt));
  const predictedHeading = (headingDeg + headingShift + 360) % 360;

  return { lat, lon, headingDeg: predictedHeading, latencyMs };
}

/** Reset all latency compensation state (e.g. on cold start or screen wake). */
export function resetLatencyCompensation(): void {
  _arLatencyMs       = 150;
  _yawRateDegPerS    = 0;
  _prevYawHeading    = null;
  _prevYawTimeMs     = 0;
}

/* ─────────────────────────────────────────────────────────────── */
/* AR STABILIZATION (anti-jitter)                                  */
/* ─────────────────────────────────────────────────────────────── */

// ── Default thresholds ────────────────────────────────────────
const STAB_POS_DEAD_ZONE_M    = 0.25;  // ignore position shifts < 25 cm
const STAB_HEAD_DEAD_ZONE_DEG = 0.30;  // ignore heading shifts < 0.3°
const STAB_SNAP_GRID_PX       = 0.5;   // round vertices to ½-pixel boundaries
const STAB_MOVE_THRESH_PX     = 1.5;   // hysteresis: hold position if Δ < 1.5 px

// ── Module-level stabilization state ─────────────────────────
let _stabCommittedLat:     number | null = null;
let _stabCommittedLon:     number | null = null;
let _stabCommittedHeading: number | null = null;
let _stabPrevChevrons: RouteChevron[] | null = null;

// ── Internal snap helpers ─────────────────────────────────────

function _snapV(v: number, grid: number): number {
  return Math.round(v / grid) * grid;
}

function _snapPt(
  pt: { x: number; y: number } | null,
  grid: number,
): { x: number; y: number } | null {
  return pt ? { x: _snapV(pt.x, grid), y: _snapV(pt.y, grid) } : null;
}

/**
 * Filter a LatencyPrediction through a position + heading dead zone.
 *
 * GPS receivers report new fixes even when the vehicle is effectively still —
 * noise fluctuates ±0.5–2 m. Each fluctuation propagates through
 * sampleRouteAhead → buildRouteArrows → canvas, causing visible wobble.
 *
 * gatePrediction commits a prediction only when the vehicle has moved beyond
 * posDeadZoneM OR turned beyond headDeadZoneDeg since the last commit. Until
 * then it returns the last committed values, so downstream functions see a
 * perfectly stable input and produce zero-change output.
 *
 * Call before sampleRouteAhead() every RAF. Pass the output to sampleRouteAhead
 * instead of the raw GPS values.
 *
 * @param pred            From predictVehicleState()
 * @param posDeadZoneM    Minimum displacement to trigger a commit (default 0.25 m)
 * @param headDeadZoneDeg Minimum heading change to trigger a commit (default 0.3°)
 */
export function gatePrediction(
  pred:            LatencyPrediction,
  posDeadZoneM    = STAB_POS_DEAD_ZONE_M,
  headDeadZoneDeg = STAB_HEAD_DEAD_ZONE_DEG,
): LatencyPrediction {
  // First call — no previous commit; accept immediately
  if (_stabCommittedLat === null) {
    _stabCommittedLat     = pred.lat;
    _stabCommittedLon     = pred.lon;
    _stabCommittedHeading = pred.headingDeg;
    return pred;
  }

  // Euclidean displacement in metres (ENU approximation)
  const cLat     = _stabCommittedLat;   // narrowed: non-null after first-call guard
  const cLon     = _stabCommittedLon!;
  const cHeading = _stabCommittedHeading!;
  const latScale = 111_320;
  const lonScale = 111_320 * Math.cos(cLat * (Math.PI / 180));
  const dN       = (pred.lat - cLat) * latScale;
  const dE       = (pred.lon - cLon) * lonScale;
  const posDist  = Math.sqrt(dN * dN + dE * dE);

  // Shortest-arc heading delta
  const headDelta = Math.abs(((pred.headingDeg - cHeading + 540) % 360) - 180);

  if (posDist < posDeadZoneM && headDelta < headDeadZoneDeg) {
    // Inside dead zone — return the last committed prediction unchanged
    return { lat: cLat, lon: cLon, headingDeg: cHeading, latencyMs: pred.latencyMs };
  }

  // Outside dead zone — commit new values and return them
  _stabCommittedLat     = pred.lat;
  _stabCommittedLon     = pred.lon;
  _stabCommittedHeading = pred.headingDeg;
  return pred;
}

/**
 * Stabilize projected RouteChevrons against micro-jitter in two passes.
 *
 * Pass 1 — Subpixel grid snap:
 *   Every vertex is rounded to the nearest `gridPx` boundary.
 *   Eliminates single-pixel alternation that occurs when a vertex floats between
 *   two integer pixels across consecutive frames (e.g. from floating-point noise
 *   in the projection math, not from real vehicle movement).
 *   gridPx = 0.5 → vertices land on half-integer pixels (browser sub-pixel AA).
 *   gridPx = 1.0 → integer pixels only (harder edges, more stable at small scale).
 *
 * Pass 2 — Screen-space hysteresis:
 *   After snapping, each chevron is compared to the same chevron in the previous
 *   output frame. If the largest vertex movement across tip/left/right is below
 *   moveThreshPx, the previous frame's vertex positions are kept unchanged.
 *   This absorbs GPS jitter that is larger than the snap grid (> 0.5 px) but
 *   smaller than genuine vehicle movement on screen (< 1.5 px ≈ sub-centimetre
 *   at typical AR scale and frame rate).
 *
 * The function maintains its own previous-frame state. Call once per RAF with
 * the full chevron array from buildRouteArrows(). Reset with resetStabilization()
 * on new route or camera restart.
 *
 * @param current      From buildRouteArrows()
 * @param gridPx       Snap grid size in pixels (default 0.5)
 * @param moveThreshPx Hysteresis threshold in pixels (default 1.5)
 */
export function stabilizeRouteChevrons(
  current:      RouteChevron[],
  gridPx       = STAB_SNAP_GRID_PX,
  moveThreshPx = STAB_MOVE_THRESH_PX,
): RouteChevron[] {
  const thresh2 = moveThreshPx * moveThreshPx;

  function ptDist2(
    a: { x: number; y: number } | null,
    b: { x: number; y: number } | null,
  ): number {
    if (!a || !b) return 0;
    const dx = a.x - b.x, dy = a.y - b.y;
    return dx * dx + dy * dy;
  }

  const stabilized = current.map((ch, i): RouteChevron => {
    // ── Pass 1: snap all vertices to grid ────────────────────
    const snapped: RouteChevron = {
      tip:   _snapPt(ch.tip,   gridPx),
      left:  _snapPt(ch.left,  gridPx),
      right: _snapPt(ch.right, gridPx),
      hints: ch.hints,
    };

    // ── Pass 2: hysteresis against previous frame ─────────────
    const prev = _stabPrevChevrons?.[i];
    if (!prev) return snapped;  // no history — accept unconditionally

    const maxMoved2 = Math.max(
      ptDist2(snapped.tip,   prev.tip),
      ptDist2(snapped.left,  prev.left),
      ptDist2(snapped.right, prev.right),
    );

    // All vertices within threshold — hold previous positions, keep new hints
    // (alpha/depth should still update even when position is held)
    return maxMoved2 < thresh2
      ? { tip: prev.tip, left: prev.left, right: prev.right, hints: snapped.hints }
      : snapped;
  });

  _stabPrevChevrons = stabilized;
  return stabilized;
}

/** Reset all stabilization state (new route, camera restart, screen wake). */
export function resetStabilization(): void {
  _stabCommittedLat     = null;
  _stabCommittedLon     = null;
  _stabCommittedHeading = null;
  _stabPrevChevrons     = null;
}

/* ─────────────────────────────────────────────────────────────── */
/* PRIMARY ARROW EMPHASIS                                          */
/* ─────────────────────────────────────────────────────────────── */

// ── Emphasis constants ────────────────────────────────────────
/** Minimum |localBearingDeg| that qualifies a sample as "entering a turn". */
const EMPHASIS_TURN_DEG       = 15;
/** Screen-space vertex scale factor for the primary chevron (>1 = larger). */
const EMPHASIS_PRIMARY_SCALE  = 1.40;
/** Alpha multiplier for secondary chevrons (< 1 = subdued). */
const EMPHASIS_SECONDARY_ALPHA = 0.40;
/** Vertex scale factor for secondary chevrons (< 1 = slightly smaller). */
const EMPHASIS_SECONDARY_SCALE = 0.80;

/** Role tag added by emphasizeRouteArrows(). */
export type ChevronRole = 'primary' | 'secondary';

/** RouteChevron with a role tag and emphasis-adjusted hints/vertices. */
export interface EmphasizedChevron extends RouteChevron {
  role: ChevronRole;
}

/**
 * Scale a chevron's projected screen vertices around their centroid.
 *
 * Used internally to resize chevrons post-projection without re-running the
 * full _enuToCam pipeline. Acceptable because emphasis is a perceptual weight
 * layer, not a geometric correction — small scale changes (0.8×–1.4×) on
 * already-small chevrons produce no visible perspective inconsistency.
 */
function _scaleChevronVertices(
  ch: RouteChevron,
  scale: number,
): Pick<RouteChevron, 'tip' | 'left' | 'right'> {
  type Pt = { x: number; y: number };
  const valid = ([ch.tip, ch.left, ch.right].filter(Boolean) as Pt[]);
  if (valid.length === 0) return { tip: ch.tip, left: ch.left, right: ch.right };

  // Centroid of available vertices
  const cx = valid.reduce((s, p) => s + p.x, 0) / valid.length;
  const cy = valid.reduce((s, p) => s + p.y, 0) / valid.length;

  const scalePt = (pt: Pt | null): Pt | null =>
    pt ? { x: cx + (pt.x - cx) * scale, y: cy + (pt.y - cy) * scale } : null;

  return { tip: scalePt(ch.tip), left: scalePt(ch.left), right: scalePt(ch.right) };
}

/**
 * Tag and visually differentiate route chevrons into primary and secondary roles.
 *
 * Primary chevron selection:
 *   Walk the sample bearings; the chevron immediately before the first sample
 *   whose |localBearingDeg| exceeds EMPHASIS_TURN_DEG (15°) is primary —
 *   it is where the driver must start reacting to the upcoming turn.
 *   If the route ahead is straight (no bearing above the threshold), the nearest
 *   chevron (index 0) is primary — it guides the driver into the correct lane.
 *
 * Visual adjustments (applied in screen space, vertices scaled around centroid):
 *   Primary   — vertices × 1.4 (larger footprint), alpha unchanged.
 *   Secondary — vertices × 0.8, alpha × 0.4 (subdued — present but not distracting).
 *
 * The `role` field lets the renderer apply additional differentiation:
 *   primary   → bright fill / solid stroke
 *   secondary → outline only / dimmer colour
 *
 * Call after stabilizeRouteChevrons() so the stabiliser works on natural-size
 * vertices and emphasis is applied as a final visual layer.
 *
 * @param chevrons  From stabilizeRouteChevrons() (or buildRouteArrows() directly)
 * @param samples   The RouteSample[] used to build the chevrons — same order, same length
 */
export function emphasizeRouteArrows(
  chevrons: RouteChevron[],
  samples:  RouteSample[],
): EmphasizedChevron[] {
  if (chevrons.length === 0) return [];

  // ── Find primary index ────────────────────────────────────────
  let primaryIdx = 0;
  for (let i = 1; i < Math.min(chevrons.length, samples.length); i++) {
    if (Math.abs(samples[i].localBearingDeg) > EMPHASIS_TURN_DEG) {
      primaryIdx = Math.max(0, i - 1);  // chevron just before the turn
      break;
    }
  }

  // ── Apply per-role adjustments ────────────────────────────────
  return chevrons.map((ch, i): EmphasizedChevron => {
    if (i === primaryIdx) {
      return {
        ...ch,
        ..._scaleChevronVertices(ch, EMPHASIS_PRIMARY_SCALE),
        role:  'primary',
        hints: { ...ch.hints },             // alpha unchanged — natural occlusion value
      };
    }
    return {
      ...ch,
      ..._scaleChevronVertices(ch, EMPHASIS_SECONDARY_SCALE),
      role:  'secondary',
      hints: { ...ch.hints, alpha: ch.hints.alpha * EMPHASIS_SECONDARY_ALPHA },
    };
  });
}

/* ─────────────────────────────────────────────────────────────── */
/* CHEVRON STATE INTERPOLATION                                     */
/* ─────────────────────────────────────────────────────────────── */

// ── Per-property EMA factors ──────────────────────────────────
//
// These are per-frame blend weights (α in: new = prev + α*(target−prev)).
// At 60 fps the time-to-90%-of-target is:
//   VERTEX: log(0.1)/log(1−0.30) ≈ 7 frames  ≈ 117 ms — fast, tracks movement
//   ALPHA:  log(0.1)/log(1−0.20) ≈ 10 frames ≈ 167 ms — slower, avoids harsh flicker
//   STROKE: same as vertex (lineWidth tracks position changes)
//
const INTERP_VERTEX_α = 0.30;
const INTERP_ALPHA_α  = 0.20;

// Module-level previous-frame state for interpolation
let _prevInterpChevrons: EmphasizedChevron[] | null = null;

// ── Internal lerp helpers ─────────────────────────────────────

function _lerpN(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function _lerpPt(
  a: { x: number; y: number } | null,
  b: { x: number; y: number } | null,
  t: number,
): { x: number; y: number } | null {
  if (!a && !b) return null;
  if (!a) return b;
  if (!b) return a;
  return { x: _lerpN(a.x, b.x, t), y: _lerpN(a.y, b.y, t) };
}

/**
 * Smoothly interpolate route chevrons between the previous frame and the current
 * target values, eliminating sudden jumps caused by:
 *
 *   • Role changes (secondary → primary and vice versa): the emphasis size and
 *     opacity transitions animate over ~100–170 ms instead of snapping.
 *   • Minor vertex movement between frames: even with the stabiliser holding
 *     positions within its hysteresis, occasional snap-to-new-position is smoothed.
 *   • Arrow count changes: when a chevron appears or disappears, it fades
 *     in/out rather than popping. (On count mismatch the state resets and
 *     all chevrons start from their current target — one sharp frame is acceptable
 *     vs the complexity of orphan tracking.)
 *
 * Interpolation is EMA (exponential moving average) per property:
 *   vertices / strokeScale — α = 0.30 (responsive, ~117 ms to 90% of target)
 *   alpha                  — α = 0.20 (slower, ~167 ms — opacity jumps feel harsher)
 *
 * Call once per RAF, after emphasizeRouteArrows(). The function maintains its
 * own state. Reset with resetChevronInterpolation() on new route or camera start.
 *
 * @param current      From emphasizeRouteArrows()
 * @param vertexAlpha  Override EMA factor for vertex positions / strokeScale
 * @param alphaAlpha   Override EMA factor for opacity
 */
export function interpolateRouteChevrons(
  current:     EmphasizedChevron[],
  vertexAlpha = INTERP_VERTEX_α,
  alphaAlpha  = INTERP_ALPHA_α,
): EmphasizedChevron[] {
  // Count mismatch — reset and accept current frame as-is
  if (!_prevInterpChevrons || _prevInterpChevrons.length !== current.length) {
    _prevInterpChevrons = current;
    return current;
  }

  const result = current.map((ch, i): EmphasizedChevron => {
    const prev = _prevInterpChevrons![i];

    const interpolated: EmphasizedChevron = {
      ...ch,
      // Vertex positions encode both screen location and rendered size
      tip:   _lerpPt(prev.tip,   ch.tip,   vertexAlpha),
      left:  _lerpPt(prev.left,  ch.left,  vertexAlpha),
      right: _lerpPt(prev.right, ch.right, vertexAlpha),
      hints: {
        ...ch.hints,
        // Opacity — slower transition (α = alphaAlpha)
        alpha:       _lerpN(prev.hints.alpha,       ch.hints.alpha,       alphaAlpha),
        // Stroke width — tracks position speed
        strokeScale: _lerpN(prev.hints.strokeScale, ch.hints.strokeScale, vertexAlpha),
        // avgDepthM not interpolated — used only as metadata, not rendered directly
      },
      // Role follows the target immediately — the visual change is what's smoothed,
      // not the label. Keeping the new role allows the renderer to switch colour/fill
      // on the first frame of a role change while the size/opacity animates.
      role: ch.role,
    };

    return interpolated;
  });

  _prevInterpChevrons = result;
  return result;
}

/** Reset interpolation state (new route, camera restart, screen wake). */
export function resetChevronInterpolation(): void {
  _prevInterpChevrons = null;
}

/* ─────────────────────────────────────────────────────────────── */
/* PUBLIC API                                                      */
/* ─────────────────────────────────────────────────────────────── */

/** Check camera availability without requesting permission */
export async function checkVisionCapabilities(): Promise<boolean> {
  try {
    _set({ state: 'checking' });
    if (!navigator.mediaDevices?.enumerateDevices) {
      _set({ state: 'disabled', hasCamera: false });
      return false;
    }
    const devices = await navigator.mediaDevices.enumerateDevices();
    const has = devices.some((d) => d.kind === 'videoinput');
    _set({ hasCamera: has, state: has ? 'idle' : 'disabled' });
    return has;
  } catch {
    _set({ state: 'disabled', hasCamera: false });
    return false;
  }
}

/**
 * Start the vision layer. Attaches to the provided <video> element.
 * Idempotent — safe to call when already active.
 * On failure, sets state='error' and rethrows (caller should silently ignore).
 */
export async function startVision(videoEl: HTMLVideoElement): Promise<void> {
  const cur = useVisionStore.getState().state;
  if (cur === 'active' || cur === 'initializing') return;
  if (cur === 'disabled') return;

  _running = true;
  _videoEl = videoEl;

  try {
    _set({ state: 'requesting' });

    _stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'environment',
        width:     { ideal: 1280 },
        height:    { ideal: 720  },
        frameRate: { ideal: 30, max: 60 },
      },
      audio: false,
    });

    _set({ state: 'initializing', permissionGranted: true });

    videoEl.srcObject = _stream;
    videoEl.playsInline = true;
    videoEl.muted = true;
    await videoEl.play();

    // Processing canvas (OffscreenCanvas for slightly better isolation)
    if (typeof OffscreenCanvas !== 'undefined') {
      _procCanvas = new OffscreenCanvas(PROC_W, PROC_H);
      _procCtx = (_procCanvas as OffscreenCanvas).getContext('2d') as OffscreenCanvasRenderingContext2D;
    } else {
      const c = document.createElement('canvas');
      c.width = PROC_W; c.height = PROC_H;
      _procCanvas = c;
      _procCtx = c.getContext('2d');
    }

    // Camera stream unexpectedly ended (cable unplugged, device error)
    _stream.getVideoTracks()[0]?.addEventListener('ended', () => {
      logError('VisionEngine:stream', new Error('Video track ended unexpectedly'));
      stopVision();
      _set({ state: 'error', error: 'Kamera akışı kesildi' });
    });

    _set({ state: 'active', error: null });
    _tick  = 0;
    _startStateSync();                    // 10fps React state sync starts here
    _rafId = requestAnimationFrame(_loop);

  } catch (err) {
    _running = false;
    const msg    = err instanceof Error ? err.message : String(err);
    const denied = /NotAllowed|Permission/i.test(msg);
    logError('VisionEngine:start', err);
    _set({
      state: denied ? 'disabled' : 'error',
      error: denied ? 'Kamera izni verilmedi' : msg,
      permissionGranted: !denied,
    });
    throw err;
  }
}

/** Stop all vision processing and release camera MediaStream */
export function stopVision(): void {
  _running = false;

  _stopStateSync();                       // cancel 10fps React sync before RAF stops
  if (_rafId !== null) { cancelAnimationFrame(_rafId); _rafId = null; }
  if (_stream) { _stream.getTracks().forEach((t) => t.stop()); _stream = null; }
  if (_videoEl) { _videoEl.srcObject = null; _videoEl = null; }

  _procCtx = null;
  _procCanvas = null;
  _tick = 0;
  _confHistory = [];
  _smoothedConf = 0;
  _arrowFarM = ARROW_MIN_FAR_M;  // reset smoothed projection range

  _set({ state: 'idle', frame: null, error: null, confidence: 0, confidenceLevel: 'off' });
}

/** Permanently disable (user preference or capability check failed) */
export function disableVision(): void {
  stopVision();
  _set({ state: 'disabled' });
}

/** Subscribe to every VisionFrame outside React (called at detection rate, ~10fps) */
export function onVisionFrame(fn: (f: VisionFrame) => void): () => void {
  _frameListeners.add(fn);
  return () => _frameListeners.delete(fn);
}

/**
 * Synchronous snapshot of the latest detection result.
 * Use this in canvas-drawing RAF loops to avoid React store subscription overhead.
 * Always returns the last processed frame (never null after first detection).
 */
export function getLastFrame(): VisionFrame { return _lastFrame; }

/* ─────────────────────────────────────────────────────────────── */
/* REACT HOOKS                                                     */
/* ─────────────────────────────────────────────────────────────── */

export function useVisionState(): VisionStore {
  return useVisionStore();
}

export function useLatestVisionFrame(): VisionFrame | null {
  return useVisionStore((s) => s.frame);
}

export function useVisionConfidence(): { confidence: number; level: ConfidenceLevel } {
  const confidence      = useVisionStore((s) => s.confidence);
  const confidenceLevel = useVisionStore((s) => s.confidenceLevel);
  return { confidence, level: confidenceLevel };
}

/* ─────────────────────────────────────────────────────────────── */
/* HMR CLEANUP                                                     */
/* ─────────────────────────────────────────────────────────────── */

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    _stopStateSync();
    stopVision();
    _frameListeners.clear();
  });
}
