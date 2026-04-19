/**
 * ARAlignmentService — Sensor fusion for accurate AR overlay alignment.
 *
 * Heading pipeline (priority order):
 *   1. DeviceOrientationEvent (absolute=true) — compass chip, ~60 Hz, ±2°
 *   2. Complementary filter: gyro integration + GPS heading anchor
 *   3. Route bearing fallback when vehicle is stationary (GPS heading = null)
 *
 * Camera pose estimation:
 *   DeviceMotionEvent.accelerationIncludingGravity → gravity decomposition
 *   → pitchDeg (camera tilt above horizontal) and rollDeg (camera roll)
 *   Both EMA-smoothed to suppress road vibration (effective ~25-frame tau)
 *
 * RAF loop usage pattern (zero React overhead):
 *   getARAlignment()  — synchronous module-level getter, use inside requestAnimationFrame
 *
 * React component usage:
 *   useARAlignment()  — Zustand hook, updated at ~10 fps via sync timer
 *
 * Lifecycle:
 *   startARAlignment() → attach sensors
 *   updateCompassHeading(deg | null) → feed GPS heading each fix
 *   updateRouteBearing(deg | null)   → feed route bearing when geometry changes
 *   stopARAlignment()  → detach, reset state
 */

import { create } from 'zustand';

/* ─────────────────────────────────────────────────────────────── */
/* TYPES                                                           */
/* ─────────────────────────────────────────────────────────────── */

export interface ARAlignment {
  /** Complementary-filtered heading (0–360°, clockwise from North) */
  fusedHeadingDeg:   number;
  /** Camera tilt above horizontal (°). Positive = looking up (typical dash mount). */
  pitchDeg:          number;
  /** Camera roll around optical axis (°). Positive = right side higher. */
  rollDeg:           number;
  /** Bearing to next route waypoint, or null when route unavailable */
  routeBearingDeg:   number | null;
  /** True when at least one motion/orientation sensor is providing data */
  sensorActive:      boolean;
}

/* Non-standard DOM extensions */
interface ExtOrientationEvent extends DeviceOrientationEvent {
  webkitCompassHeading?: number;  // iOS: CW from magnetic North
}

/* ─────────────────────────────────────────────────────────────── */
/* FILTER CONSTANTS                                                */
/* ─────────────────────────────────────────────────────────────── */

/**
 * Gyroscope trust coefficient for the complementary filter.
 * High-pass: gyro handles short-term changes; GPS/orientation anchors long-term.
 * 0.92 ≈ 12-sample time constant at 60 Hz ≈ 200 ms gyro dominance window.
 */
const GYRO_ALPHA   = 0.92;

/**
 * EMA alpha for pitch and roll (slow — suppress vibration from engine / road).
 * 0.04 ≈ 25-sample time constant at 60 Hz ≈ ~400 ms smoothing window.
 */
const POSE_EMA     = 0.04;

/* ─────────────────────────────────────────────────────────────── */
/* MODULE STATE                                                    */
/* ─────────────────────────────────────────────────────────────── */

let _fusedHeadingDeg   = 0;
let _pitchDeg          = 15;    // reasonable default for dashboard mount (~15° forward tilt)
let _rollDeg           = 0;
let _compassDeg: number | null = null;  // latest absolute heading from GPS or orientation
let _routeBearingDeg: number | null = null;
let _sensorActive      = false;
let _orientationActive = false;  // true once we get a reliable absolute orientation event
let _gyroLastMs        = 0;
let _initialized       = false;

let _absOrientHandler:  ((e: Event) => void) | null = null;
let _relOrientHandler:  ((e: Event) => void) | null = null;
let _motionHandler:     ((e: Event) => void) | null = null;
let _syncTimer:         ReturnType<typeof setInterval> | null = null;

/* ─────────────────────────────────────────────────────────────── */
/* ANGLE MATH                                                      */
/* ─────────────────────────────────────────────────────────────── */

/** Normalize to [0, 360) */
function _wrap360(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/**
 * Complementary filter step for circular quantities.
 * Blends predicted (gyro-integrated) toward absolute (compass/GPS) by weight (1−α).
 */
function _cfBlend(predicted: number, absolute: number, alpha: number): number {
  // Compute shortest-path difference to avoid 360→0 wrap discontinuity
  let diff = ((absolute - predicted) % 360 + 360) % 360;
  if (diff > 180) diff -= 360;   // normalize to (-180, 180]
  return _wrap360(predicted + (1 - alpha) * diff);
}

/* ─────────────────────────────────────────────────────────────── */
/* SENSOR HANDLERS                                                 */
/* ─────────────────────────────────────────────────────────────── */

/**
 * Handle DeviceOrientationEvent with absolute=true (Android Chrome / WebView).
 * alpha is CCW from geographic North; we convert to CW.
 */
function _onAbsoluteOrientation(e: Event): void {
  const ev = e as ExtOrientationEvent;
  if (!ev.absolute || ev.alpha == null) return;

  // Android absolute: alpha is CCW from North → convert to CW
  const heading = _wrap360(360 - ev.alpha);
  _absorbAbsoluteHeading(heading);
}

/**
 * Handle standard DeviceOrientationEvent.
 * Extracts heading from webkitCompassHeading (iOS) or falls back to
 * alpha if absolute=true (some Android implementations use this event).
 */
function _onRelativeOrientation(e: Event): void {
  const ev = e as ExtOrientationEvent;

  let heading: number | null = null;

  if (typeof ev.webkitCompassHeading === 'number' && Number.isFinite(ev.webkitCompassHeading)) {
    // iOS: clockwise from magnetic North
    heading = ev.webkitCompassHeading;
  } else if (ev.absolute && ev.alpha != null && !_orientationActive) {
    // Android fallback if 'deviceorientationabsolute' did not fire
    heading = _wrap360(360 - ev.alpha);
  }

  if (heading !== null) _absorbAbsoluteHeading(heading);
}

function _absorbAbsoluteHeading(heading: number): void {
  _sensorActive      = true;
  _orientationActive = true;

  if (!_initialized) {
    _fusedHeadingDeg = heading;
    _initialized     = true;
  } else {
    // Complementary filter: orientation event is the low-pass anchor
    _fusedHeadingDeg = _cfBlend(_fusedHeadingDeg, heading, GYRO_ALPHA);
  }
  _compassDeg = heading;
}

/**
 * Handle DeviceMotionEvent.
 *
 * Responsibilities:
 *   1. Gyro integration — integrate yaw rate to supplement heading between
 *      orientation events or when orientation sensor is unavailable.
 *   2. Pitch/roll — decompose gravity from accelerationIncludingGravity.
 *
 * Coordinate convention (back-camera-forward mount, phone vertical):
 *   Device Z = optical axis (back camera faces +Z)
 *   Device Y = up (aligned with car vertical)
 *   Device X = right (lateral)
 *
 * Gravity decomposition:
 *   pitchDeg = asin(-gz / |g|)  — + means camera looks up
 *   rollDeg  = atan2(gx, gy)    — + means right side higher
 */
function _onMotion(e: Event): void {
  const ev = e as DeviceMotionEvent;

  /* ── Gyro integration (yaw) ── */
  const rate = ev.rotationRate;
  if (rate?.alpha != null && Number.isFinite(rate.alpha)) {
    const now = ev.timeStamp;

    if (_gyroLastMs > 0) {
      const dt = Math.min((now - _gyroLastMs) / 1000, 0.1); // cap at 100 ms

      if (!_orientationActive) {
        // No absolute orientation: integrate gyro fully and anchor to GPS heading
        // alpha = rotation rate around device Z axis (yaw for vertical phone) in deg/s
        // Sign: positive alpha = CCW rotation = heading decreases in CW convention
        const yawDelta = -(rate.alpha) * dt;
        _fusedHeadingDeg = _wrap360(_fusedHeadingDeg + GYRO_ALPHA * yawDelta);

        // Re-anchor to compass (GPS heading) to prevent drift
        if (_compassDeg !== null) {
          _fusedHeadingDeg = _cfBlend(_fusedHeadingDeg, _compassDeg, GYRO_ALPHA);
        }
        _sensorActive = true;
        _initialized  = true;
      }
      // If orientation is active, the orientation handler already covers heading.
      // Gyro integration is still useful here to smooth between orientation events.
    }

    _gyroLastMs = now;
  }

  /* ── Pitch / roll from gravity ── */
  const acc = ev.accelerationIncludingGravity;
  if (acc?.x != null && acc.y != null && acc.z != null) {
    const gx = acc.x ?? 0;
    const gy = acc.y ?? 0;
    const gz = acc.z ?? 0;
    const gMag = Math.sqrt(gx * gx + gy * gy + gz * gz);

    if (gMag > 2) {  // ignore near-zero-g (sensor dropout or free-fall)
      // Gravity along device Z (optical axis): negative gz = camera pointing down
      // pitchDeg > 0 = camera tilted up (looking toward sky)
      const pitchRaw = Math.asin(Math.max(-1, Math.min(1, -gz / gMag))) * 180 / Math.PI;
      // Roll: atan2 of lateral vs vertical gravity
      const rollRaw  = Math.atan2(gx, gy) * 180 / Math.PI;

      // Slow EMA — suppress engine vibration / road bumps
      _pitchDeg = _pitchDeg * (1 - POSE_EMA) + pitchRaw * POSE_EMA;
      _rollDeg  = _rollDeg  * (1 - POSE_EMA) + rollRaw  * POSE_EMA;
    }
  }
}

/* ─────────────────────────────────────────────────────────────── */
/* ZUSTAND STORE  (React UI — synced at 10 fps)                   */
/* ─────────────────────────────────────────────────────────────── */

const _useARStore = create<ARAlignment>(() => ({
  fusedHeadingDeg:  0,
  pitchDeg:         15,
  rollDeg:          0,
  routeBearingDeg:  null,
  sensorActive:     false,
}));

function _syncStore(): void {
  _useARStore.setState({
    fusedHeadingDeg:  _fusedHeadingDeg,
    pitchDeg:         _pitchDeg,
    rollDeg:          _rollDeg,
    routeBearingDeg:  _routeBearingDeg,
    sensorActive:     _sensorActive,
  });
}

/* ─────────────────────────────────────────────────────────────── */
/* PUBLIC API                                                      */
/* ─────────────────────────────────────────────────────────────── */

/** Start listening to device sensors. Idempotent. */
export function startARAlignment(): void {
  if (_absOrientHandler) return; // already running

  _absOrientHandler = _onAbsoluteOrientation;
  _relOrientHandler = _onRelativeOrientation;
  _motionHandler    = _onMotion;

  // Absolute orientation (primary — Android, reports at ~60 Hz)
  window.addEventListener('deviceorientationabsolute', _absOrientHandler, true);
  // Standard orientation (iOS webkitCompassHeading, or Android fallback)
  window.addEventListener('deviceorientation', _relOrientHandler, true);
  // Motion (gyro integration + pitch/roll from accelerometer)
  window.addEventListener('devicemotion', _motionHandler, true);

  // Sync to Zustand store at 10 fps (React components)
  _syncTimer = setInterval(_syncStore, 100);
}

/** Stop all sensor listeners and reset alignment state. */
export function stopARAlignment(): void {
  if (_absOrientHandler) {
    window.removeEventListener('deviceorientationabsolute', _absOrientHandler, true);
    _absOrientHandler = null;
  }
  if (_relOrientHandler) {
    window.removeEventListener('deviceorientation', _relOrientHandler, true);
    _relOrientHandler = null;
  }
  if (_motionHandler) {
    window.removeEventListener('devicemotion', _motionHandler, true);
    _motionHandler = null;
  }
  if (_syncTimer) { clearInterval(_syncTimer); _syncTimer = null; }

  _fusedHeadingDeg   = 0;
  _pitchDeg          = 15;
  _rollDeg           = 0;
  _compassDeg        = null;
  _routeBearingDeg   = null;
  _sensorActive      = false;
  _orientationActive = false;
  _gyroLastMs        = 0;
  _initialized       = false;

  _useARStore.setState({
    fusedHeadingDeg: 0, pitchDeg: 15, rollDeg: 0,
    routeBearingDeg: null, sensorActive: false,
  });
}

/**
 * Feed GPS heading into the alignment pipeline.
 * Call every time a new GPS fix arrives with a valid heading.
 * Passing null (stationary, low speed) triggers route bearing fallback.
 */
export function updateCompassHeading(headingDeg: number | null): void {
  if (headingDeg == null || !Number.isFinite(headingDeg)) {
    // GPS heading unavailable — use route bearing if we have one
    if (_routeBearingDeg !== null && !_orientationActive) {
      _compassDeg = _routeBearingDeg;
    }
    return;
  }

  _compassDeg = headingDeg;

  // Only anchor the complementary filter from GPS when the orientation chip
  // is not providing absolute data (GPS is noisier than the compass chip).
  if (!_orientationActive) {
    if (!_initialized) {
      _fusedHeadingDeg = headingDeg;
      _initialized     = true;
    } else {
      _fusedHeadingDeg = _cfBlend(_fusedHeadingDeg, headingDeg, GYRO_ALPHA);
    }
    _sensorActive = true;
  }
}

/**
 * Feed route bearing to next waypoint.
 * Used as heading fallback when GPS heading is null (vehicle stationary).
 */
export function updateRouteBearing(bearingDeg: number | null): void {
  _routeBearingDeg = bearingDeg;
  // Don't trigger a full store sync here — the 10fps timer will pick it up
}

/**
 * Synchronous snapshot of current alignment — designed for use inside
 * requestAnimationFrame loops (no Zustand, no React, no overhead).
 */
export function getARAlignment(): ARAlignment {
  return {
    fusedHeadingDeg:  _fusedHeadingDeg,
    pitchDeg:         _pitchDeg,
    rollDeg:          _rollDeg,
    routeBearingDeg:  _routeBearingDeg,
    sensorActive:     _sensorActive,
  };
}

/** React hook — updated at ~10 fps. Use in status displays, not render loops. */
export function useARAlignment(): ARAlignment {
  return _useARStore();
}

/* ─────────────────────────────────────────────────────────────── */
/* HMR CLEANUP                                                     */
/* ─────────────────────────────────────────────────────────────── */

if (import.meta.hot) {
  import.meta.hot.dispose(() => { stopARAlignment(); });
}
