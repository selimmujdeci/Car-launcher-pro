/**
 * VisionOverlay — AR kamera + şerit/tabela katmanı.
 *
 * Katman mimarisi (z-index sırası):
 *   MapView     (z-0)  — harita, her zaman mount'ta
 *   VisionOverlay içi:
 *     <video>   (z-1)  — kamera feed'i, sadece HYBRID modunda opak
 *     <canvas>  (z-2)  — şerit çizgileri + AR rotası + tabela bbox
 *   NavigationHUD (z-3) — her zaman görünür
 *
 * Geçiş davranışı:
 *   STANDARD → HYBRID : opacity 0→1 (500ms), harita opacity azalır
 *   HYBRID  → STANDARD: opacity 1→0 (500ms), harita opacity artar
 *   Hiçbir component unmount olmaz — sadece opacity değişir.
 *
 * Hata davranışı:
 *   Camera hatası → stopVision() → STANDARD moda otomatik geçiş
 *   Detection hatası → 'degraded' state, kamera görünmeye devam eder
 *   Navigasyon bitince → stopVision() çağrılır
 */

import { memo, useEffect, useRef, useCallback } from 'react';
import { EyeOff, Camera, AlertTriangle, Gauge } from 'lucide-react';
import {
  startVision,
  stopVision,
  checkVisionCapabilities,
  projectGPSToScreen,
  useVisionState,
  useVisionConfidence,
  type LaneLine,
  type DetectedSign,
  type VisionFrame,
  type ConfidenceLevel,
} from '../../platform/vision';
import {
  useNavMode,
  useTransitioning,
  useUserVisionPref,
  setUserVisionPreference,
  useModeSync,
} from '../../platform/modeController';
import {
  startARAlignment,
  stopARAlignment,
  updateCompassHeading,
  updateRouteBearing,
  getARAlignment,
} from '../../platform/arAlignmentService';

/* ─────────────────────────────────────────────────────────────── */
/* PROPS                                                           */
/* ─────────────────────────────────────────────────────────────── */

interface VisionOverlayProps {
  /** True when turn-by-turn navigation is active */
  isNavigating: boolean;
  /** Current vehicle GPS position */
  currentLat: number | null;
  currentLon: number | null;
  /** GPS/compass heading (0=north, clockwise degrees) */
  headingDeg: number;
  /** Route waypoints [lon, lat][] — used for AR arrow projection */
  routeGeometry: [number, number][] | null;
  /** Current step index into routeGeometry */
  currentStepIndex: number;
}

/* ─────────────────────────────────────────────────────────────── */
/* AR DRAWING HELPERS                                             */
/* ─────────────────────────────────────────────────────────────── */

const PROC_W = 320;   // matches visionEngine processing width
const PROC_H = 180;   // matches visionEngine processing height

/** Scale lane line from processing-canvas coords to display-canvas coords */
function scaleLine(
  line: LaneLine,
  displayW: number,
  displayH: number,
): LaneLine {
  const sx = displayW / PROC_W;
  const sy = displayH / PROC_H;
  return {
    ...line,
    x1: line.x1 * sx, y1: line.y1 * sy,
    x2: line.x2 * sx, y2: line.y2 * sy,
  };
}

/**
 * Draw lane lines with glow effect.
 * Left lane = blue, Right lane = blue. Active lane-departure warning = red.
 * @param alpha  Overall opacity multiplier (1.0 = full, < 1.0 = degraded mode)
 */
function drawLanes(
  ctx: CanvasRenderingContext2D,
  lanes: LaneLine[],
  w: number,
  h: number,
  lateralOffsetM: number | null,
  alpha = 1.0,
): void {
  const departing = lateralOffsetM !== null && Math.abs(lateralOffsetM) > 0.4;

  lanes.forEach((rawLane) => {
    const lane = scaleLine(rawLane, w, h);

    const color = departing
      ? `rgba(239,68,68,${0.4 + lane.confidence * 0.5})`   // red: lane departure
      : `rgba(59,130,246,${0.4 + lane.confidence * 0.5})`; // blue: normal

    // Glow pass
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth   = 8;
    ctx.lineCap     = 'round';
    ctx.filter      = 'blur(4px)';
    ctx.globalAlpha = 0.35 * alpha;
    ctx.beginPath();
    ctx.moveTo(lane.x1, lane.y1);
    ctx.lineTo(lane.x2, lane.y2);
    ctx.stroke();
    ctx.restore();

    // Crisp pass
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth   = 3;
    ctx.lineCap     = 'round';
    ctx.globalAlpha = 0.85 * alpha;
    ctx.beginPath();
    ctx.moveTo(lane.x1, lane.y1);
    ctx.lineTo(lane.x2, lane.y2);
    ctx.stroke();
    ctx.restore();
  });

  // Lane departure gradient warning at bottom edge
  if (departing) {
    const side = (lateralOffsetM ?? 0) > 0 ? 'right' : 'left';
    const grad = ctx.createLinearGradient(
      side === 'left' ? 0 : w, 0,
      side === 'left' ? w * 0.4 : w * 0.6, 0,
    );
    grad.addColorStop(0,   `rgba(239,68,68,${0.22 * alpha})`);
    grad.addColorStop(1,   'rgba(239,68,68,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, h * 0.55, w, h * 0.45);
  }
}

/**
 * Project the next N route waypoints onto the canvas and draw AR arrows.
 *
 * Uses the alignment-fused heading (gyro + compass) and camera pitch for
 * accurate real-world coordinate projection. Roll correction is applied
 * by the caller via canvas transform before this function is invoked.
 *
 * Arrows:
 *   - A glowing blue filled circle at each projected waypoint
 *   - Connecting line segments between consecutive visible points
 *   - Larger marker at the immediate next waypoint
 */
function drawRouteArrows(
  ctx: CanvasRenderingContext2D,
  routeGeometry: [number, number][] | null,
  stepIndex: number,
  curLat: number,
  curLon: number,
  fusedHeadingDeg: number,  // complementary-filtered heading (not raw GPS)
  pitchDeg: number,         // camera tilt above horizontal for Y-axis correction
  w: number,
  h: number,
): void {
  if (!routeGeometry || routeGeometry.length === 0) return;

  // Take the next 15 waypoints starting from current step
  const startIdx = Math.min(stepIndex, routeGeometry.length - 1);
  const points   = routeGeometry.slice(startIdx, startIdx + 15);

  const projected: Array<{ x: number; y: number; isNext: boolean }> = [];

  points.forEach((wp, i) => {
    const [lon, lat] = wp;
    const pt = projectGPSToScreen(
      lat, lon, curLat, curLon,
      fusedHeadingDeg, w, h,
      65,    // hFoVDeg
      1.2,   // camHeightM
      pitchDeg,
    );
    if (pt) projected.push({ ...pt, isNext: i === 0 });
  });

  if (projected.length === 0) return;

  // Draw route path
  if (projected.length > 1) {
    ctx.save();
    ctx.strokeStyle = 'rgba(59,130,246,0.7)';
    ctx.lineWidth   = 6;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    ctx.filter      = 'blur(3px)';
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.moveTo(projected[0].x, projected[0].y);
    projected.slice(1).forEach((p) => ctx.lineTo(p.x, p.y));
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = 'rgba(96,165,250,0.9)';
    ctx.lineWidth   = 3;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.moveTo(projected[0].x, projected[0].y);
    projected.slice(1).forEach((p) => ctx.lineTo(p.x, p.y));
    ctx.stroke();
    ctx.restore();
  }

  // Draw waypoint dots
  projected.forEach(({ x, y, isNext }) => {
    const r = isNext ? 10 : 5;

    // Glow
    ctx.save();
    ctx.fillStyle = 'rgba(59,130,246,0.4)';
    ctx.filter    = 'blur(6px)';
    ctx.beginPath();
    ctx.arc(x, y, r * 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Core dot
    ctx.save();
    ctx.fillStyle = isNext ? '#2563eb' : 'rgba(96,165,250,0.8)';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();

    // White border
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  });
}

/** Draw detected sign bounding boxes (scaled to canvas) */
function drawSigns(
  ctx: CanvasRenderingContext2D,
  signs: DetectedSign[],
  w: number,
  h: number,
): void {
  const sx = w / PROC_W, sy = h / PROC_H;
  signs.forEach((sign) => {
    const x = sign.bbox.x * sx;
    const y = sign.bbox.y * sy;
    const bw = sign.bbox.w * sx;
    const bh = sign.bbox.h * sy;

    ctx.save();
    ctx.strokeStyle = `rgba(239,68,68,${sign.confidence * 0.9})`;
    ctx.lineWidth   = 2;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(x, y, bw, bh);

    ctx.fillStyle = `rgba(239,68,68,${sign.confidence * 0.15})`;
    ctx.fillRect(x, y, bw, bh);
    ctx.restore();
  });
}

/* ─────────────────────────────────────────────────────────────── */
/* STATUS BADGE                                                    */
/* ─────────────────────────────────────────────────────────────── */

const VisionBadge = memo(function VisionBadge({
  visionState,
  frame,
  onToggle,
  confidence,
  confidenceLevel,
  isHybrid,
}: {
  visionState: string;
  frame: VisionFrame | null;
  onToggle: () => void;
  confidence: number;
  confidenceLevel: ConfidenceLevel;
  isHybrid: boolean;
}) {
  const isActive   = visionState === 'active';
  const isDegraded = visionState === 'degraded';

  // Colour tokens — detay sadece AR aktif (isHybrid) iken gösterilir
  const levelColor = isHybrid && confidenceLevel === 'full'
    ? '#34d399'   // emerald
    : isHybrid && confidenceLevel === 'degraded'
    ? '#fbbf24'   // amber
    : '#64748b';  // slate — AR kapalı veya pasif

  const bgColor = isHybrid && confidenceLevel === 'full'
    ? 'rgba(16,185,129,0.15)'
    : isHybrid && confidenceLevel === 'degraded'
    ? 'rgba(245,158,11,0.15)'
    : 'rgba(10,14,26,0.80)';

  const borderColor = isHybrid && confidenceLevel === 'full'
    ? 'rgba(16,185,129,0.35)'
    : isHybrid && confidenceLevel === 'degraded'
    ? 'rgba(245,158,11,0.35)'
    : 'rgba(255,255,255,0.10)';

  // Label: AR kapalıyken sade "AR", açıkken durum detayı
  const label = !isHybrid
    ? 'AR'
    : confidenceLevel === 'full'
    ? 'AR FULL'
    : confidenceLevel === 'degraded'
    ? 'AR DEGRADED'
    : 'AR';

  const pct = Math.round(confidence * 100);

  return (
    <button
      onClick={onToggle}
      className="flex flex-col gap-1 px-3 py-2 rounded-2xl active:scale-95 pointer-events-auto"
      style={{
        background:       bgColor,
        border:           `1px solid ${borderColor}`,
        backdropFilter:   'blur(20px)',
        transition:       'background 300ms ease, border-color 300ms ease, transform 100ms ease',
      }}
    >
      <div className="flex items-center gap-2">
        {/* Icon: AR kapalı → Camera (aç), açık → durum ikonları */}
        {!isHybrid
          ? <Camera className="w-4 h-4 text-slate-400" />
          : confidenceLevel === 'full'
          ? <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: '#34d399', flexShrink: 0 }} />
          : confidenceLevel === 'degraded'
          ? <AlertTriangle className="w-4 h-4 text-amber-400" />
          : <EyeOff className="w-4 h-4 text-slate-500" />
        }
        <span
          className="text-[10px] font-black uppercase tracking-widest"
          style={{ color: levelColor, transition: 'color 300ms ease' }}
        >
          {label}
        </span>
        {(isActive || isDegraded) && (
          <span
            className="text-[9px] font-mono font-bold tabular-nums"
            style={{ color: levelColor, opacity: 0.7, transition: 'color 300ms ease' }}
          >
            {pct}%
          </span>
        )}
        {isActive && frame && (
          <span className="text-[9px] text-slate-500 font-mono font-bold">
            {frame.processingMs}ms
          </span>
        )}
      </div>

      {/* Confidence bar — only when vision is running */}
      {(isActive || isDegraded) && (
        <div className="w-full h-1 rounded-full" style={{ background: 'rgba(255,255,255,0.08)' }}>
          <div
            className="h-full rounded-full"
            style={{
              width:      `${pct}%`,
              background: confidenceLevel === 'full'
                ? 'linear-gradient(90deg, #34d399, #10b981)'
                : confidenceLevel === 'degraded'
                ? 'linear-gradient(90deg, #fbbf24, #f59e0b)'
                : '#64748b',
              transition: 'width 300ms ease, background 300ms ease',
            }}
          />
        </div>
      )}
    </button>
  );
});

/* ─────────────────────────────────────────────────────────────── */
/* LATERAL OFFSET INDICATOR                                        */
/* ─────────────────────────────────────────────────────────────── */

const LateralIndicator = memo(function LateralIndicator({
  offsetM,
}: { offsetM: number | null }) {
  if (offsetM === null) return null;
  const abs = Math.abs(offsetM);
  const side = offsetM > 0 ? 'Sağa' : 'Sola';
  const warn = abs > 0.4;

  return (
    <div
      className="flex items-center gap-2 px-3 py-1.5 rounded-xl pointer-events-none"
      style={{
        background: warn ? 'rgba(239,68,68,0.15)' : 'rgba(10,14,26,0.70)',
        border: `1px solid ${warn ? 'rgba(239,68,68,0.30)' : 'rgba(255,255,255,0.08)'}`,
        backdropFilter: 'blur(16px)',
      }}
    >
      <Gauge className={`w-3.5 h-3.5 ${warn ? 'text-red-400' : 'text-blue-400'}`} />
      <span className={`text-[10px] font-black tabular-nums ${warn ? 'text-red-400' : 'text-slate-300'}`}>
        {side} {abs.toFixed(1)}m
      </span>
    </div>
  );
});

/* ─────────────────────────────────────────────────────────────── */
/* DETECTED SIGN DISPLAY                                           */
/* ─────────────────────────────────────────────────────────────── */

const SignDisplay = memo(function SignDisplay({
  signs,
}: { signs: DetectedSign[] }) {
  const sign = signs[0];
  if (!sign || sign.confidence < 0.35) return null;

  return (
    <div
      className="flex flex-col items-center rounded-2xl overflow-hidden shadow-xl pointer-events-none"
      style={{
        background: 'rgba(10,14,26,0.85)',
        border: '1px solid rgba(255,255,255,0.10)',
        backdropFilter: 'blur(20px)',
        minWidth: 60,
      }}
    >
      <div className="px-3 py-0.5 w-full text-center"
        style={{ background: 'rgba(239,68,68,0.15)', borderBottom: '1px solid rgba(239,68,68,0.20)' }}>
        <span className="text-[8px] text-red-400 font-black uppercase tracking-widest">TABELA</span>
      </div>
      <div className="px-4 py-2 flex items-center gap-1.5">
        <Camera className="w-3 h-3 text-red-400" />
        <span className="text-[10px] text-slate-300 font-bold uppercase tracking-wide">
          {sign.type === 'speed_limit' ? 'HIZ LİMİTİ' : sign.type.replace('_', ' ').toUpperCase()}
        </span>
      </div>
    </div>
  );
});

/* ─────────────────────────────────────────────────────────────── */
/* MAIN COMPONENT                                                  */
/* ─────────────────────────────────────────────────────────────── */

export const VisionOverlay = memo(function VisionOverlay({
  isNavigating,
  currentLat,
  currentLon,
  headingDeg,
  routeGeometry,
  currentStepIndex,
}: VisionOverlayProps) {
  const videoRef     = useRef<HTMLVideoElement>(null);
  const arCanvasRef  = useRef<HTMLCanvasElement>(null);
  const rafRef       = useRef<number | null>(null);

  const vision       = useVisionState();
  const mode         = useNavMode();
  const transitioning = useTransitioning();
  const userPref     = useUserVisionPref();
  const { confidence, level: confidenceLevel } = useVisionConfidence();

  // Sync VisionState + confidence → ModeController whenever either changes
  useModeSync();

  const isHybrid = mode === 'HYBRID_AR_NAVIGATION';

  // Canvas opacity scales with confidence level:
  //   off      → 0
  //   degraded → 0.35 … 1.0 (linear in 0.5–0.8 range)
  //   full     → 1.0
  const canvasOpacity = !isHybrid ? 0
    : confidenceLevel === 'off'      ? 0
    : confidenceLevel === 'full'     ? 1
    : 0.35 + Math.min(1, (confidence - 0.5) / 0.3) * 0.65;

  // Alpha for in-canvas drawing (lanes in degraded mode are subtler)
  const drawAlpha = confidenceLevel === 'full' ? 1.0
    : confidenceLevel === 'degraded' ? Math.max(0.4, (confidence - 0.5) / 0.3)
    : 0;

  /* ── Start/stop vision + alignment service together ── */
  useEffect(() => {
    if (!isNavigating) {
      stopVision();
      stopARAlignment();
      return;
    }

    // Start alignment sensors immediately (no permission needed)
    startARAlignment();

    const video = videoRef.current;
    if (!video) return;

    // Non-blocking: vision failure never affects navigation
    checkVisionCapabilities().then((hasCam) => {
      if (!hasCam) return;
      return startVision(video);
    }).catch(() => {
      // Vision unavailable → STANDARD_NAVIGATION continues unaffected
    });

    return () => {
      stopVision();
      stopARAlignment();
    };
  }, [isNavigating]);

  /* ── Forward GPS heading to alignment service each GPS fix ── */
  useEffect(() => {
    updateCompassHeading(headingDeg);
  }, [headingDeg]);

  /* ── Compute route bearing and forward to alignment service ── */
  useEffect(() => {
    if (!routeGeometry || routeGeometry.length === 0 || currentLat === null || currentLon === null) {
      updateRouteBearing(null);
      return;
    }
    // Bearing from current position to the next step waypoint
    const nextIdx = Math.min(currentStepIndex + 1, routeGeometry.length - 1);
    const [nextLon, nextLat] = routeGeometry[nextIdx];
    const dN = (nextLat - currentLat) * 111_320;
    const dE = (nextLon - currentLon) * 111_320 * Math.cos(currentLat * (Math.PI / 180));
    const bearing = (Math.atan2(dE, dN) * 180 / Math.PI + 360) % 360;
    updateRouteBearing(bearing);
  }, [currentLat, currentLon, routeGeometry, currentStepIndex]);

  /* ── AR Canvas rendering loop (60fps) ── */
  const renderAR = useCallback(() => {
    const canvas = arCanvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    // Resize canvas to match element dimensions (DPR-aware)
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const cw   = rect.width  * dpr;
    const ch   = rect.height * dpr;

    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width  = cw;
      canvas.height = ch;
      ctx.scale(dpr, dpr);
    }

    const w = rect.width;
    const h = rect.height;

    ctx.clearRect(0, 0, w, h);

    const frame = vision.frame;

    // Skip all drawing when AR is off or not in hybrid mode
    if (!frame || !isHybrid || confidenceLevel === 'off') {
      rafRef.current = requestAnimationFrame(renderAR);
      return;
    }

    // Lane lines — shown in degraded AND full (primary safety feature).
    // Drawn without roll correction: lane pixels come from the camera frame
    // and already reflect the physical camera roll.
    if (frame.lanes.length > 0) {
      drawLanes(ctx, frame.lanes, w, h, frame.lateralOffsetM, drawAlpha);
    }

    // Route arrows + sign bboxes — full mode only
    if (confidenceLevel === 'full') {
      if (currentLat !== null && currentLon !== null && routeGeometry) {
        // Read alignment directly — no React subscription, always fresh at 60fps
        const alignment = getARAlignment();

        // Roll correction: counter-rotate the canvas so GPS-projected points
        // land on the correct road-surface position despite camera tilt.
        // Lane lines are NOT affected (they live in camera-pixel space).
        ctx.save();
        if (Math.abs(alignment.rollDeg) > 0.5) {
          ctx.translate(w / 2, h / 2);
          ctx.rotate((-alignment.rollDeg * Math.PI) / 180);
          ctx.translate(-w / 2, -h / 2);
        }

        drawRouteArrows(
          ctx,
          routeGeometry,
          currentStepIndex,
          currentLat,
          currentLon,
          alignment.fusedHeadingDeg,  // gyro + compass fused heading
          alignment.pitchDeg,          // camera tilt for Y-axis correction
          w,
          h,
        );

        ctx.restore();
      }

      if (frame.signs.length > 0) {
        drawSigns(ctx, frame.signs, w, h);
      }
    }

    rafRef.current = requestAnimationFrame(renderAR);
  // Note: headingDeg intentionally excluded — alignment reads from module-level
  // getARAlignment() which is always up-to-date without recreating this callback.
  }, [isHybrid, confidenceLevel, drawAlpha, vision.frame, currentLat, currentLon, routeGeometry, currentStepIndex]);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(renderAR);
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [renderAR]);

  /* ── Toggle handler ── */
  const handleToggle = useCallback(() => {
    if (vision.state === 'disabled' || vision.state === 'error') {
      // Re-enable — restart vision
      const video = videoRef.current;
      if (!video || !isNavigating) return;
      startVision(video).catch(() => {});
      setUserVisionPreference('auto');
    } else if (isHybrid) {
      // Switch to standard
      setUserVisionPreference('standard');
    } else {
      // Switch to hybrid
      setUserVisionPreference(userPref === 'standard' ? 'auto' : 'hybrid');
    }
  }, [vision.state, isHybrid, userPref, isNavigating]);

  /* ─────────────────────────────────────────────────────────── */
  /* RENDER                                                       */
  /* ─────────────────────────────────────────────────────────── */

  return (
    // Outer container — always present in DOM, no pointer-events by default
    <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 5 }}>

      {/* ── Camera feed — background when HYBRID ── */}
      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full object-cover"
        playsInline
        muted
        autoPlay
        style={{
          opacity: isHybrid ? 1 : 0,
          transition: `opacity ${transitioning ? 500 : 400}ms ease`,
          // Flip horizontally if front camera is accidentally selected
          // transform: 'scaleX(-1)',
        }}
      />

      {/* ── AR canvas — opacity controlled by confidence level ── */}
      <canvas
        ref={arCanvasRef}
        className="absolute inset-0 w-full h-full"
        style={{
          opacity: canvasOpacity,
          transition: `opacity ${transitioning ? 500 : 400}ms ease`,
        }}
      />

      {/* ── Vision-active darkening vignette (keeps HUD readable over camera) ── */}
      {isHybrid && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: 'radial-gradient(ellipse 120% 100% at 50% 100%, transparent 40%, rgba(0,0,0,0.45) 100%)',
            opacity: isHybrid ? 1 : 0,
            transition: 'opacity 500ms ease',
          }}
        />
      )}

      {/* ── UI Controls — pointer-events re-enabled here ── */}
      <div className="absolute inset-0 pointer-events-none">

        {/* Vision status badge — always visible during navigation */}
        {isNavigating && (
          <div className="absolute top-5 right-[7rem] pointer-events-auto z-10">
            <VisionBadge
              visionState={vision.state}
              frame={vision.frame}
              onToggle={handleToggle}
              confidence={confidence}
              isHybrid={isHybrid}
              confidenceLevel={confidenceLevel}
            />
          </div>
        )}

        {/* Lateral offset warning — degraded AND full (safety-critical, show when lanes visible) */}
        {isHybrid && confidenceLevel !== 'off' && vision.frame?.lateralOffsetM !== null && (
          <div
            className="absolute pointer-events-none"
            style={{ bottom: 72, left: '50%', transform: 'translateX(-50%)' }}
          >
            <LateralIndicator offsetM={vision.frame?.lateralOffsetM ?? null} />
          </div>
        )}

        {/* Sign display — full mode only (requires reliable detection) */}
        {isHybrid && confidenceLevel === 'full' && (vision.frame?.signs ?? []).length > 0 && (
          <div className="absolute top-20 right-6 pointer-events-none">
            <SignDisplay signs={vision.frame?.signs ?? []} />
          </div>
        )}
      </div>
    </div>
  );
});
