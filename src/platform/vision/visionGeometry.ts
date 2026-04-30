/**
 * visionGeometry.ts — AR projeksiyon matematiği.
 *
 * Tek sorumluluk: GPS / yol koordinatları → ekran pikseli.
 *
 * İçerir:
 *   - Pinhole kamera modeli (buildCameraIntrinsics, projectGPSToScreen, screenRayToGroundPlane)
 *   - Ok projeksiyon aralığı (computeArrowProjectionRange, computeArrowDepthHints)
 *   - Yol yüzeyi oku (buildGroundArrow)
 *   - Rota chevron'ları (sampleRouteAhead, buildRouteArrows, computeOcclusionAlpha)
 *   - Şerit hizalama (estimateLaneOffset, smoothLaneOffset, resetLaneOffset)
 *   - Gecikme kompanzasyonu (predictVehicleState, updateArLatency, gatePrediction, …)
 *   - Stabilizasyon (stabilizeRouteChevrons, resetStabilization)
 *   - Vurgu (emphasizeRouteArrows)
 *   - Chevron interpolasyonu (interpolateRouteChevrons, resetChevronInterpolation)
 */

import type {
  CameraIntrinsics,
  ArrowProjectionRange,
  ArrowDepthHints,
  ArrowVertex,
  GroundArrow,
  RouteSample,
  RouteChevron,
  RouteSampleParams,
  LaneEstimate,
  LatencyPrediction,
  ChevronRole,
  EmphasizedChevron,
} from './visionTypes';
import type { LaneLine } from '../visionStore';
import { clamp01, lerpNum, lerpPt } from './visionUtils';

// ── Yardımcı (modül özel) ────────────────────────────────────────────────────

function _snapV(v: number, grid: number): number { return Math.round(v / grid) * grid; }
function _snapPt(pt: { x: number; y: number } | null, grid: number): { x: number; y: number } | null {
  return pt ? { x: _snapV(pt.x, grid), y: _snapV(pt.y, grid) } : null;
}

// ── Pinhole kamera modeli ─────────────────────────────────────────────────────

export function buildCameraIntrinsics(canvasW: number, canvasH: number, hFoVDeg: number): CameraIntrinsics {
  return {
    fx: canvasW / (2 * Math.tan((hFoVDeg * Math.PI / 180) / 2)),
    cx: canvasW / 2,
    cy: canvasH / 2,
  };
}

/**
 * ENU → kamera uzayı dönüşümü (yaw + pitch + roll).
 * Tam açıklama orijinal visionEngine.ts §GROUND PLANE PROJECTION içinde.
 */
function _enuToCam(
  dE: number, dN: number,
  headingDeg: number, camHeightM: number, pitchDeg: number, rollDeg = 0,
): readonly [number, number, number] {
  const h = headingDeg * (Math.PI / 180);
  const p = pitchDeg   * (Math.PI / 180);
  const cosH = Math.cos(h), sinH = Math.sin(h);
  const cosP = Math.cos(p), sinP = Math.sin(p);

  const vRight = dE * cosH - dN * sinH;
  const vFwd   = dE * sinH + dN * cosH;
  const vUp    = -camHeightM;

  const camXp =  vRight;
  const camZp =  vFwd * cosP + vUp * sinP;
  const camYp = -vFwd * sinP + vUp * cosP;

  if (rollDeg === 0) return [camXp, camYp, camZp] as const;
  const r    = rollDeg * (Math.PI / 180);
  const cosR = Math.cos(r), sinR = Math.sin(r);
  return [ camXp * cosR + camYp * sinR, -camXp * sinR + camYp * cosR, camZp ] as const;
}

function _camToScreen(camX: number, camY: number, camZ: number, K: CameraIntrinsics): { x: number; y: number } | null {
  if (camZ < 0.1) return null;
  return { x: (camX / camZ) * K.fx + K.cx, y: -(camY / camZ) * K.fx + K.cy };
}

export function projectGPSToScreen(
  wpLat: number, wpLon: number,
  curLat: number, curLon: number,
  headingDeg: number,
  canvasW: number, canvasH: number,
  hFoVDeg = 65, camHeightM = 1.2, pitchDeg = 0, rollDeg = 0,
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

export function screenRayToGroundPlane(
  sx: number, sy: number,
  K: CameraIntrinsics,
  camHeightM: number, pitchDeg: number, rollDeg = 0,
): { fwd: number; right: number } | null {
  let rayX = (sx - K.cx) / K.fx;
  let rayY = -(sy - K.cy) / K.fx;
  if (rollDeg !== 0) {
    const r = rollDeg * (Math.PI / 180);
    const cosR = Math.cos(r), sinR = Math.sin(r);
    [rayX, rayY] = [rayX * cosR - rayY * sinR, rayX * sinR + rayY * cosR];
  }
  const p = pitchDeg * (Math.PI / 180);
  const vFwd   = Math.cos(p) - rayY * Math.sin(p);
  const vUpDir = Math.sin(p) + rayY * Math.cos(p);
  if (Math.abs(vUpDir) < 1e-6) return null;
  const t = -camHeightM / vUpDir;
  if (t <= 0) return null;
  return { fwd: vFwd * t, right: rayX * t };
}

// ── Derinlik ölçekleme ───────────────────────────────────────────────────────

const ARROW_NEAR_FADE_M      = 4;
const ARROW_FAR_FADE_M       = 24;
const ARROW_REF_DIST_M       = 8;
const ARROW_PERCEPTUAL_GAMMA = 0.65;
const ARROW_PERCEPTUAL_FLOOR = 0.25;
const ARROW_LOOKAHEAD_S      = 2.0;
const ARROW_MIN_FAR_M        = 9;
const ARROW_MAX_FAR_M        = 50;
const ARROW_NEAR_RATIO       = 0.30;
const ARROW_RANGE_SMOOTH_α   = 0.04;

let _arrowFarM = ARROW_MIN_FAR_M;

function _perceivedSizeScale(depth: number, refDistM: number): number {
  if (depth <= refDistM) return 1.0;
  const r = depth / refDistM;
  return Math.max(Math.pow(r, 1 - ARROW_PERCEPTUAL_GAMMA), ARROW_PERCEPTUAL_FLOOR * r);
}

export function computeArrowProjectionRange(speedKmh: number): ArrowProjectionRange {
  const speedMs = Math.max(0, speedKmh) / 3.6;
  const rawFar  = Math.min(ARROW_MAX_FAR_M, Math.max(ARROW_MIN_FAR_M, speedMs * ARROW_LOOKAHEAD_S));
  _arrowFarM   += ARROW_RANGE_SMOOTH_α * (rawFar - _arrowFarM);
  return { fwdNear: _arrowFarM * ARROW_NEAR_RATIO, fwdFar: _arrowFarM };
}

export function computeArrowDepthHints(
  fwdMid: number, camHeightM: number, pitchDeg: number, rollDeg = 0,
  nearFadeM = ARROW_NEAR_FADE_M, farFadeM = ARROW_FAR_FADE_M, refDistM = ARROW_REF_DIST_M,
): ArrowDepthHints {
  const [, , camZ] = _enuToCam(0, fwdMid, 0, camHeightM, pitchDeg, rollDeg);
  const depth = Math.max(0.5, camZ);
  return {
    avgDepthM:   depth,
    alpha:       clamp01(1 - (depth - nearFadeM) / (farFadeM - nearFadeM)),
    strokeScale: clamp01(refDistM / depth),
    sizeScale:   _perceivedSizeScale(depth, refDistM),
  };
}

export function buildGroundArrow(
  fwdNear: number, fwdFar: number, arrowWidthM: number, shaftWidthM: number,
  K: CameraIntrinsics, camHeightM: number, pitchDeg: number, rollDeg = 0,
): GroundArrow {
  const fwdMid = (fwdNear + fwdFar) / 2;
  const hints  = computeArrowDepthHints(fwdMid, camHeightM, pitchDeg, rollDeg);
  const hw     = (arrowWidthM * hints.sizeScale) / 2;
  const hs     = (shaftWidthM * hints.sizeScale) / 2;
  const fwdHead = fwdNear + (fwdFar - fwdNear) * 0.45;

  const pts: Array<[number, number]> = [
    [ 0,   fwdFar  ], [ hw,  fwdHead ], [ hs,  fwdHead ],
    [ hs,  fwdNear ], [-hs,  fwdNear ], [-hs,  fwdHead ], [-hw,  fwdHead ],
  ];

  const vertices: ArrowVertex[] = pts.map(([right, fwd]) => {
    const [camX, camY, camZ] = _enuToCam(right, fwd, 0, camHeightM, pitchDeg, rollDeg);
    return { right, fwd, screen: _camToScreen(camX, camY, camZ, K) };
  });

  return { vertices, hints };
}

// ── Rota örnekleme ───────────────────────────────────────────────────────────

export function computeRouteSampleParams(speedKmh: number, screenHeightPx: number): RouteSampleParams {
  const v = Math.max(0, speedKmh);
  return {
    minSpacingM: Math.min(7, 3 + v * 0.04),
    maxSamples:  8,
    minPixelGap: Math.max(20, screenHeightPx * 0.04),
  };
}

function _segBearing(dr: number, df: number): number {
  return Math.atan2(dr, df) * (180 / Math.PI);
}

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

  const pts = geometry.map(([lon, lat]): { right: number; fwd: number } => {
    const dN = (lat - curLat) * latScale;
    const dE = (lon - curLon) * lonScale;
    return { right: dE * cosH - dN * sinH, fwd: dE * sinH + dN * cosH };
  });

  let startIdx = 0, startR = pts[0].right, startF = pts[0].fwd, bestDist2 = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i].right, ay = pts[i].fwd;
    const bx = pts[i + 1].right, by = pts[i + 1].fwd;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    if (len2 < 0.01) continue;
    const t  = Math.max(0, Math.min(1, (-ax * dx - ay * dy) / len2));
    const fx = ax + t * dx, fy = ay + t * dy;
    const d2 = fx * fx + fy * fy;
    if (d2 < bestDist2) { bestDist2 = d2; startIdx = i; startR = fx; startF = fy; }
  }

  const path: { right: number; fwd: number }[] = [{ right: startR, fwd: startF }];
  for (let i = startIdx + 1; i < pts.length; i++) {
    path.push(pts[i]);
    if (pts[i].fwd > maxDistM + 20) break;
  }
  if (path.length < 2) return [];

  const samples: RouteSample[] = [];
  let distAccum = 0, nextEmit = 0, cumulativeTurn = 0;
  let prevBearing: number | null = null;

  for (let i = 0; i < path.length - 1; i++) {
    const ax = path[i].right, ay = path[i].fwd;
    const bx = path[i + 1].right, by = path[i + 1].fwd;
    const dx = bx - ax, dy = by - ay;
    const segLen = Math.sqrt(dx * dx + dy * dy);
    if (segLen < 0.01) continue;

    const bearing = _segBearing(dx, dy);
    const segEnd  = distAccum + segLen;

    while (nextEmit <= segEnd) {
      const t  = (nextEmit - distAccum) / segLen;
      const sr = ax + t * dx, sf = ay + t * dy;
      if (sf >= 0 && sf <= maxDistM) {
        if (prevBearing !== null) cumulativeTurn += Math.abs(((bearing - prevBearing + 540) % 360) - 180);
        prevBearing = bearing;
        samples.push({ right: sr, fwd: sf, localBearingDeg: bearing, cumulativeTurnDeg: cumulativeTurn });
        if (samples.length >= maxSamples) return samples;
      }
      nextEmit += minSpacingM;
    }
    distAccum = segEnd;
    if (by > maxDistM) break;
  }
  return samples;
}

export function computeOcclusionAlpha(
  cumulativeTurnDeg: number, rightM: number, linearAlpha: number,
  roadHalfWidthM = 3.5, lateralFadeM = 2.0,
): number {
  const cornerFactor  = Math.cos(Math.min(cumulativeTurnDeg, 90) * (Math.PI / 180)) ** 2;
  const lateralFactor = clamp01(1 - Math.max(0, Math.abs(rightM) - roadHalfWidthM) / lateralFadeM);
  const depthFactor   = Math.pow(clamp01(linearAlpha), 1.5);
  return cornerFactor * lateralFactor * depthFactor;
}

export function buildRouteArrows(
  samples: RouteSample[],
  K: CameraIntrinsics,
  camHeightM: number,
  pitchDeg: number,
  rollDeg     = 0,
  halfLenM    = 1.2,
  halfWidthM  = 0.9,
  minPixelGap = 0,
  laneOffsetM = 0,
): RouteChevron[] {
  const result:   RouteChevron[] = [];
  const accepted: { x: number; y: number }[] = [];
  const gap2 = minPixelGap * minPixelGap;

  for (const s of samples) {
    const eRight = s.right + laneOffsetM;
    const lb     = s.localBearingDeg * (Math.PI / 180);
    const sinLb  = Math.sin(lb), cosLb = Math.cos(lb);

    const [, , camZ]   = _enuToCam(eRight, s.fwd, 0, camHeightM, pitchDeg, rollDeg);
    const depth        = Math.max(0.5, camZ);
    const linearAlpha  = clamp01(1 - (depth - ARROW_NEAR_FADE_M) / (ARROW_FAR_FADE_M - ARROW_NEAR_FADE_M));
    const alpha        = computeOcclusionAlpha(s.cumulativeTurnDeg, eRight, linearAlpha);
    const strokeScale  = clamp01(ARROW_REF_DIST_M / depth);
    const sizeScale    = _perceivedSizeScale(depth, ARROW_REF_DIST_M);
    const hLen = halfLenM  * sizeScale, hWid = halfWidthM * sizeScale;

    const tipR  = eRight + sinLb * hLen,  tipF  = s.fwd  + cosLb * hLen;
    const leftR = eRight - sinLb * hLen - cosLb * hWid, leftF = s.fwd - cosLb * hLen + sinLb * hWid;
    const rgtR  = eRight - sinLb * hLen + cosLb * hWid, rgtF  = s.fwd - cosLb * hLen - sinLb * hWid;

    const project = (r: number, f: number): { x: number; y: number } | null => {
      const [cx, cy, cz] = _enuToCam(r, f, 0, camHeightM, pitchDeg, rollDeg);
      return _camToScreen(cx, cy, cz, K);
    };

    const tip = project(tipR, tipF), left = project(leftR, leftF), right = project(rgtR, rgtF);

    if (minPixelGap > 0 && tip !== null) {
      if (accepted.some((p) => { const dx = tip.x - p.x, dy = tip.y - p.y; return dx*dx + dy*dy < gap2; })) continue;
      accepted.push(tip);
    }
    result.push({ tip, left, right, hints: { avgDepthM: depth, alpha, strokeScale, sizeScale } });
  }
  return result;
}

// ── Şerit hizalama ────────────────────────────────────────────────────────────

const STANDARD_LANE_WIDTH_M = 3.5;
const MIN_LANE_WIDTH_M      = 2.5;
const MAX_LANE_WIDTH_M      = 5.0;

let _smoothedLaneOffsetM = 0;
const LANE_SMOOTH_α       = 0.15;
const LANE_OFFSET_CLAMP_M = 2.5;

export function estimateLaneOffset(
  lanes: LaneLine[], K: CameraIntrinsics, camHeightM: number, pitchDeg: number, rollDeg = 0,
): LaneEstimate {
  const leftLine  = lanes.filter((l) => l.side === 'left').reduce<LaneLine | null>(
    (best, l) => best === null || Math.max(l.x1,l.x2) > Math.max(best.x1,best.x2) ? l : best, null);
  const rightLine = lanes.filter((l) => l.side === 'right').reduce<LaneLine | null>(
    (best, l) => best === null || Math.min(l.x1,l.x2) < Math.min(best.x1,best.x2) ? l : best, null);

  function footProject(line: LaneLine): number | null {
    const [fx, fy] = line.y1 > line.y2 ? [line.x1, line.y1] : [line.x2, line.y2];
    const gp = screenRayToGroundPlane(fx, fy, K, camHeightM, pitchDeg, rollDeg);
    return gp ? gp.right : null;
  }

  const leftRoadM  = leftLine  ? footProject(leftLine)  : null;
  const rightRoadM = rightLine ? footProject(rightLine) : null;

  if (leftRoadM !== null && rightRoadM !== null) {
    const width = rightRoadM - leftRoadM;
    if (width >= MIN_LANE_WIDTH_M && width <= MAX_LANE_WIDTH_M)
      return { laneOffsetM: (leftRoadM + rightRoadM) / 2, laneWidthM: width, confidence: 1.0 };
  }
  if (rightRoadM !== null) return { laneOffsetM: rightRoadM - STANDARD_LANE_WIDTH_M / 2, laneWidthM: STANDARD_LANE_WIDTH_M, confidence: 0.5 };
  if (leftRoadM  !== null) return { laneOffsetM: leftRoadM  + STANDARD_LANE_WIDTH_M / 2, laneWidthM: STANDARD_LANE_WIDTH_M, confidence: 0.5 };
  return { laneOffsetM: 0, laneWidthM: -1, confidence: 0 };
}

export function smoothLaneOffset(estimate: LaneEstimate): number {
  if (estimate.confidence > 0) {
    _smoothedLaneOffsetM += LANE_SMOOTH_α * estimate.confidence * (estimate.laneOffsetM - _smoothedLaneOffsetM);
    _smoothedLaneOffsetM  = Math.max(-LANE_OFFSET_CLAMP_M, Math.min(LANE_OFFSET_CLAMP_M, _smoothedLaneOffsetM));
  }
  return _smoothedLaneOffsetM;
}

export function resetLaneOffset(): void { _smoothedLaneOffsetM = 0; }

// ── Gecikme kompanzasyonu ─────────────────────────────────────────────────────

let _arLatencyMs = 150;
const LATENCY_SMOOTH_α = 0.10;
const LATENCY_MIN_MS   = 30;
const LATENCY_MAX_MS   = 500;

let _yawRateDegPerS  = 0;
let _prevYawHeading: number | null = null;
let _prevYawTimeMs   = 0;
const YAW_RATE_α     = 0.20;

export function updateArLatency(measuredMs: number): void {
  if (measuredMs < LATENCY_MIN_MS || measuredMs > LATENCY_MAX_MS) return;
  _arLatencyMs += LATENCY_SMOOTH_α * (measuredMs - _arLatencyMs);
}
export function setArLatency(ms: number): void { _arLatencyMs = Math.max(LATENCY_MIN_MS, Math.min(LATENCY_MAX_MS, ms)); }
export function getArLatency(): number { return _arLatencyMs; }

export function updateYawRate(headingDeg: number): void {
  const nowMs = Date.now();
  if (_prevYawHeading !== null) {
    const dtS = (nowMs - _prevYawTimeMs) / 1000;
    if (dtS >= 0.05 && dtS <= 2.0) {
      const delta = ((headingDeg - _prevYawHeading + 540) % 360) - 180;
      _yawRateDegPerS += YAW_RATE_α * (delta / dtS - _yawRateDegPerS);
    }
  }
  _prevYawHeading = headingDeg;
  _prevYawTimeMs  = nowMs;
}
export function getYawRate(): number { return _yawRateDegPerS; }

export function predictVehicleState(
  curLat: number, curLon: number, headingDeg: number, speedMs: number, latencyMs = _arLatencyMs,
): LatencyPrediction {
  const dt  = latencyMs / 1000;
  const h   = headingDeg * (Math.PI / 180);
  const dN  = speedMs * Math.cos(h) * dt;
  const dE  = speedMs * Math.sin(h) * dt;
  const lat = curLat + dN / 111_320;
  const lon = curLon + dE / (111_320 * Math.cos(curLat * (Math.PI / 180)));
  const headingShift = Math.max(-45, Math.min(45, _yawRateDegPerS * dt));
  return { lat, lon, headingDeg: (headingDeg + headingShift + 360) % 360, latencyMs };
}

export function resetLatencyCompensation(): void {
  _arLatencyMs = 150; _yawRateDegPerS = 0; _prevYawHeading = null; _prevYawTimeMs = 0;
}

// ── Stabilizasyon ─────────────────────────────────────────────────────────────

const STAB_POS_DEAD_ZONE_M    = 0.25;
const STAB_HEAD_DEAD_ZONE_DEG = 0.30;
const STAB_SNAP_GRID_PX       = 0.5;
const STAB_MOVE_THRESH_PX     = 1.5;

let _stabCommittedLat:     number | null = null;
let _stabCommittedLon:     number | null = null;
let _stabCommittedHeading: number | null = null;
let _stabPrevChevrons: RouteChevron[] | null = null;

export function gatePrediction(
  pred: LatencyPrediction,
  posDeadZoneM    = STAB_POS_DEAD_ZONE_M,
  headDeadZoneDeg = STAB_HEAD_DEAD_ZONE_DEG,
): LatencyPrediction {
  if (_stabCommittedLat === null) {
    _stabCommittedLat = pred.lat; _stabCommittedLon = pred.lon; _stabCommittedHeading = pred.headingDeg;
    return pred;
  }
  const cLat = _stabCommittedLat!, cLon = _stabCommittedLon!, cHeading = _stabCommittedHeading!;
  const lonScale = 111_320 * Math.cos(cLat * (Math.PI / 180));
  const dN = (pred.lat - cLat) * 111_320, dE = (pred.lon - cLon) * lonScale;
  const posDist  = Math.sqrt(dN * dN + dE * dE);
  const headDelta = Math.abs(((pred.headingDeg - cHeading + 540) % 360) - 180);

  if (posDist < posDeadZoneM && headDelta < headDeadZoneDeg)
    return { lat: cLat, lon: cLon, headingDeg: cHeading, latencyMs: pred.latencyMs };

  _stabCommittedLat = pred.lat; _stabCommittedLon = pred.lon; _stabCommittedHeading = pred.headingDeg;
  return pred;
}

export function stabilizeRouteChevrons(
  current: RouteChevron[], gridPx = STAB_SNAP_GRID_PX, moveThreshPx = STAB_MOVE_THRESH_PX,
): RouteChevron[] {
  const thresh2 = moveThreshPx * moveThreshPx;
  function pd2(a: { x:number;y:number }|null, b: { x:number;y:number }|null): number {
    if (!a || !b) return 0;
    return (a.x-b.x)**2 + (a.y-b.y)**2;
  }

  const stabilized = current.map((ch, i): RouteChevron => {
    const snapped: RouteChevron = { tip: _snapPt(ch.tip,gridPx), left: _snapPt(ch.left,gridPx), right: _snapPt(ch.right,gridPx), hints: ch.hints };
    const prev = _stabPrevChevrons?.[i];
    if (!prev) return snapped;
    const maxMoved2 = Math.max(pd2(snapped.tip,prev.tip), pd2(snapped.left,prev.left), pd2(snapped.right,prev.right));
    return maxMoved2 < thresh2 ? { tip: prev.tip, left: prev.left, right: prev.right, hints: snapped.hints } : snapped;
  });

  _stabPrevChevrons = stabilized;
  return stabilized;
}

export function resetStabilization(): void {
  _stabCommittedLat = null; _stabCommittedLon = null; _stabCommittedHeading = null; _stabPrevChevrons = null;
}

// ── Vurgu ─────────────────────────────────────────────────────────────────────

const EMPHASIS_TURN_DEG        = 15;
const EMPHASIS_PRIMARY_SCALE   = 1.40;
const EMPHASIS_SECONDARY_ALPHA = 0.40;
const EMPHASIS_SECONDARY_SCALE = 0.80;

function _scaleChevronVertices(ch: RouteChevron, scale: number): Pick<RouteChevron, 'tip'|'left'|'right'> {
  type Pt = { x: number; y: number };
  const valid = ([ch.tip, ch.left, ch.right].filter(Boolean) as Pt[]);
  if (valid.length === 0) return { tip: ch.tip, left: ch.left, right: ch.right };
  const cx = valid.reduce((s, p) => s + p.x, 0) / valid.length;
  const cy = valid.reduce((s, p) => s + p.y, 0) / valid.length;
  const sp = (pt: Pt | null): Pt | null => pt ? { x: cx + (pt.x - cx) * scale, y: cy + (pt.y - cy) * scale } : null;
  return { tip: sp(ch.tip), left: sp(ch.left), right: sp(ch.right) };
}

export function emphasizeRouteArrows(chevrons: RouteChevron[], samples: RouteSample[]): EmphasizedChevron[] {
  if (chevrons.length === 0) return [];
  let primaryIdx = 0;
  for (let i = 1; i < Math.min(chevrons.length, samples.length); i++) {
    if (Math.abs(samples[i].localBearingDeg) > EMPHASIS_TURN_DEG) { primaryIdx = Math.max(0, i - 1); break; }
  }
  return chevrons.map((ch, i): EmphasizedChevron => {
    if (i === primaryIdx) return { ...ch, ..._scaleChevronVertices(ch, EMPHASIS_PRIMARY_SCALE), role: 'primary' as ChevronRole, hints: { ...ch.hints } };
    return { ...ch, ..._scaleChevronVertices(ch, EMPHASIS_SECONDARY_SCALE), role: 'secondary' as ChevronRole, hints: { ...ch.hints, alpha: ch.hints.alpha * EMPHASIS_SECONDARY_ALPHA } };
  });
}

// ── Chevron interpolasyonu ────────────────────────────────────────────────────

const INTERP_VERTEX_α = 0.30;
const INTERP_ALPHA_α  = 0.20;

let _prevInterpChevrons: EmphasizedChevron[] | null = null;

export function interpolateRouteChevrons(
  current: EmphasizedChevron[], vertexAlpha = INTERP_VERTEX_α, alphaAlpha = INTERP_ALPHA_α,
): EmphasizedChevron[] {
  if (!_prevInterpChevrons || _prevInterpChevrons.length !== current.length) {
    _prevInterpChevrons = current; return current;
  }
  const result = current.map((ch, i): EmphasizedChevron => {
    const prev = _prevInterpChevrons![i];
    return {
      ...ch,
      tip:   lerpPt(prev.tip,   ch.tip,   vertexAlpha),
      left:  lerpPt(prev.left,  ch.left,  vertexAlpha),
      right: lerpPt(prev.right, ch.right, vertexAlpha),
      hints: { ...ch.hints, alpha: lerpNum(prev.hints.alpha, ch.hints.alpha, alphaAlpha), strokeScale: lerpNum(prev.hints.strokeScale, ch.hints.strokeScale, vertexAlpha) },
      role:  ch.role,
    };
  });
  _prevInterpChevrons = result;
  return result;
}

export function resetChevronInterpolation(): void { _prevInterpChevrons = null; }
