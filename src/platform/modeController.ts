/**
 * ModeController — Navigation mode state machine.
 *
 * Modes:
 *   STANDARD_NAVIGATION  — Map always full-opacity background, standard HUD.
 *   HYBRID_AR_NAVIGATION — Camera feed background, map semi-transparent, AR canvas overlay.
 *
 * Transition rule (evaluated whenever VisionState changes or user preference changes):
 *   IF visionState === 'active'
 *      AND userPreference ≠ 'standard'
 *     → HYBRID_AR_NAVIGATION
 *   ELSE
 *     → STANDARD_NAVIGATION
 *
 * 'degraded' vision (camera up but detection failing) stays in HYBRID so the camera
 * feed remains visible — the last good detection result is reused.
 *
 * Transition is smooth: only CSS opacity values change, nothing is unmounted.
 * A `transitioning` flag is true for 500ms so components can suppress pointer events.
 */

import { create } from 'zustand';
import { useEffect } from 'react';
import { useVisionStore, type VisionState } from './visionStore';

/* ─────────────────────────────────────────────────────────────── */
/* TYPES                                                           */
/* ─────────────────────────────────────────────────────────────── */

export type NavMode = 'STANDARD_NAVIGATION' | 'HYBRID_AR_NAVIGATION';
export type UserVisionPref = 'auto' | 'standard' | 'hybrid';

interface ModeStore {
  mode: NavMode;
  /** True during the CSS cross-fade window (≤500ms) */
  transitioning: boolean;
  userPreference: UserVisionPref;
}

/* ─────────────────────────────────────────────────────────────── */
/* STORE                                                           */
/* ─────────────────────────────────────────────────────────────── */

const useModeStore = create<ModeStore>(() => ({
  mode: 'STANDARD_NAVIGATION',
  transitioning: false,
  userPreference: 'auto',
}));

/* ─────────────────────────────────────────────────────────────── */
/* TRANSITION LOGIC                                                */
/* ─────────────────────────────────────────────────────────────── */

const TRANSITION_MS = 500;   // must match CSS transition duration
let _transitionTimer: ReturnType<typeof setTimeout> | null = null;

function _resolveMode(
  visionState: VisionState,
  pref: UserVisionPref,
  confidence: number,
): NavMode {
  if (pref === 'standard') return 'STANDARD_NAVIGATION';

  // Confidence below threshold → AR unreliable, show map at full opacity
  if (confidence < 0.5) return 'STANDARD_NAVIGATION';

  const visionReady = visionState === 'active' || visionState === 'degraded';

  if (pref === 'hybrid' && visionReady) return 'HYBRID_AR_NAVIGATION';
  if (pref === 'auto'   && visionState === 'active') return 'HYBRID_AR_NAVIGATION';

  return 'STANDARD_NAVIGATION';
}

/** Called whenever VisionState, confidence, or user preference changes. */
export function applyModeUpdate(visionState: VisionState): void {
  const { mode: current, userPreference } = useModeStore.getState();
  const confidence = useVisionStore.getState().confidence;
  const target = _resolveMode(visionState, userPreference, confidence);

  if (target === current) return;

  // Start transition
  if (_transitionTimer) clearTimeout(_transitionTimer);
  useModeStore.setState({ mode: target, transitioning: true });

  _transitionTimer = setTimeout(() => {
    useModeStore.setState({ transitioning: false });
    _transitionTimer = null;
  }, TRANSITION_MS);
}

/* ─────────────────────────────────────────────────────────────── */
/* PUBLIC API                                                      */
/* ─────────────────────────────────────────────────────────────── */

/** Set user preference and immediately re-evaluate mode. */
export function setUserVisionPreference(pref: UserVisionPref): void {
  useModeStore.setState({ userPreference: pref });
  applyModeUpdate(useVisionStore.getState().state);
}

/* ─────────────────────────────────────────────────────────────── */
/* REACT HOOKS                                                     */
/* ─────────────────────────────────────────────────────────────── */

export function useNavMode(): NavMode {
  return useModeStore((s) => s.mode);
}

export function useTransitioning(): boolean {
  return useModeStore((s) => s.transitioning);
}

export function useUserVisionPref(): UserVisionPref {
  return useModeStore((s) => s.userPreference);
}

/**
 * Sync hook — subscribes to VisionState and forwards every change
 * to applyModeUpdate(). Mount this ONCE inside FullMapView when
 * navigation is active.
 */
export function useModeSync(): void {
  const visionState  = useVisionStore((s) => s.state);
  const confidence   = useVisionStore((s) => s.confidence);
  useEffect(() => {
    applyModeUpdate(visionState);
  }, [visionState, confidence]);
}

/* ─────────────────────────────────────────────────────────────── */
/* HMR CLEANUP                                                     */
/* ─────────────────────────────────────────────────────────────── */

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    if (_transitionTimer) clearTimeout(_transitionTimer);
    useModeStore.setState({ mode: 'STANDARD_NAVIGATION', transitioning: false });
  });
}
