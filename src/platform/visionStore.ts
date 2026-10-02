/**
 * VisionStore — isolated Zustand store for camera/AR state.
 *
 * Extracted from visionEngine.ts so that modeController and FullMapView
 * can subscribe to vision state WITHOUT pulling the full 2280-line
 * visionEngine (WebGL shaders, CV algorithms, AR math) into the initial bundle.
 *
 * visionEngine.ts imports this file and re-uses the same store instance.
 */

import { create } from 'zustand';

/* ── Types ───────────────────────────────────────────────────────── */

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
  x1: number; y1: number;
  x2: number; y2: number;
  side: 'left' | 'right';
  confidence: number;
}

export interface DetectedSign {
  type: 'speed_limit' | 'stop' | 'turn_warning';
  speedValue?: number;
  confidence: number;
  bbox: { x: number; y: number; w: number; h: number };
  timestamp: number;
}

export interface VisionFrame {
  lanes: LaneLine[];
  signs: DetectedSign[];
  lateralOffsetM: number | null;
  processingMs: number;
  timestamp: number;
}

export interface VisionStore {
  state: VisionState;
  error: string | null;
  hasCamera: boolean;
  permissionGranted: boolean;
  frame: VisionFrame | null;
  confidence: number;
  confidenceLevel: ConfidenceLevel;
}

/* ── Store ───────────────────────────────────────────────────────── */

export const useVisionStore = create<VisionStore>(() => ({
  state: 'idle',
  error: null,
  hasCamera: false,
  permissionGranted: false,
  frame: null,
  confidence: 0,
  confidenceLevel: 'off',
}));

/* ── Selector hooks ──────────────────────────────────────────────── */

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
