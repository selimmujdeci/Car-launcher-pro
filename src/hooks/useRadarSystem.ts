/**
 * useRadarSystem.ts — Eagle Eye UI bridge hook.
 *
 * Phase 1-2: GPS → engine bridge, velocity-adaptive evaluation, reactive state
 * Phase 3:   Verification state (needsVerification), confirmRadar / denyRadar handlers
 *
 * TTS + Audio Ducking are handled internally by radarEngine._fireVoiceAlert().
 * This hook only exposes state and interaction handlers — no side-effects.
 */

import { useEffect, useRef, useMemo }              from 'react';
import { onGPSLocation }                            from '../platform/gpsService';
import { evaluateRadarThreats }                     from '../platform/radar/radarEngine';
import { useRadarStore }                            from '../platform/radar/radarStore';
import { voteThreat }                               from '../platform/radar/radarCommunityService';
import type { ThreatEntry }                         from '../platform/radar/radarStore';

// ── Velocity-adaptive evaluation intervals ────────────────────────────────────

const SPEED_INTERVALS: ReadonlyArray<readonly [number, number]> = [
  [10,        4_000],
  [40,        1_500],
  [90,          800],
  [Infinity,    400],
] as const;

function adaptiveIntervalMs(speedKmh: number): number {
  for (let i = 0; i < SPEED_INTERVALS.length; i++) {
    if (speedKmh < SPEED_INTERVALS[i][0]) return SPEED_INTERVALS[i][1];
  }
  return 400;
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface RadarSystemState {
  /** Active threats keyed by radar ID */
  threats: Map<string, ThreatEntry>;
  /** Array form — use for JSX iteration */
  threatsArray: ThreatEntry[];
  /** Nearest front-cone threat — primary HUD target */
  nearestFrontThreat: ThreatEntry | null;
  /** Current velocity-adaptive alert horizon (meters) */
  alertDistanceM: number;
  /** True when ≥1 threat is being tracked */
  isActive: boolean;
  /**
   * Live radar threats where the vehicle just passed within 50m.
   * UI should show a brief "Radar hala burada mı?" confirmation prompt.
   */
  verificationPending: ThreatEntry[];
  /**
   * Confirm a community radar is still active.
   * Increments server confidence; dismisses the verification prompt.
   */
  confirmRadar: (radarId: string) => Promise<void>;
  /**
   * Deny a community radar (it's no longer there).
   * Decrements server confidence; dismisses the verification prompt.
   * Server removes the report when confidence reaches 0.
   */
  denyRadar: (radarId: string) => Promise<void>;
}

/**
 * Eagle Eye radar system hook.
 * Mount ONCE at app root. GPS subscription + cleanup are fully managed.
 */
export function useRadarSystem(): RadarSystemState {
  const lastEvalPerfRef = useRef<number>(0);

  // ── GPS → engine bridge with velocity-adaptive throttle ──────────────────
  useEffect(() => {
    const unsub = onGPSLocation((loc) => {
      if (!loc) return;

      const now         = performance.now();
      const speedKmh    = (loc.speed ?? 0) * 3.6;
      const minInterval = adaptiveIntervalMs(speedKmh);

      if (now - lastEvalPerfRef.current < minInterval) return;
      lastEvalPerfRef.current = now;

      evaluateRadarThreats(
        loc.latitude,
        loc.longitude,
        loc.heading ?? 0,
        speedKmh,
      );
    });

    return unsub;
  }, []);

  // ── Reactive store state ──────────────────────────────────────────────────
  const threats        = useRadarStore((s) => s.threats);
  const alertDistanceM = useRadarStore((s) => s.alertDistanceM);

  const threatsArray = useMemo(
    () => Array.from(threats.values()),
    [threats],
  );

  const nearestFrontThreat = useMemo((): ThreatEntry | null => {
    let nearest: ThreatEntry | null = null;
    for (const t of threats.values()) {
      if (!t.inFrontCone) continue;
      if (!nearest || t.distanceM < nearest.distanceM) nearest = t;
    }
    return nearest;
  }, [threats]);

  // ── Verification state ────────────────────────────────────────────────────
  const verificationPending = useMemo(
    () => threatsArray.filter((t) => t.needsVerification),
    [threatsArray],
  );

  // ── Verification handlers ─────────────────────────────────────────────────

  const confirmRadar = async (radarId: string): Promise<void> => {
    // Dismiss the prompt immediately (optimistic)
    useRadarStore.getState().patchThreat(radarId, { needsVerification: false });
    try {
      await voteThreat(radarId, 'confirm');
    } catch {
      // Vote failed — prompt remains dismissed (UI already acted)
    }
  };

  const denyRadar = async (radarId: string): Promise<void> => {
    useRadarStore.getState().patchThreat(radarId, { needsVerification: false });
    try {
      await voteThreat(radarId, 'deny');
    } catch {
      // Vote failed — radar will decay naturally
    }
  };

  return {
    threats,
    threatsArray,
    nearestFrontThreat,
    alertDistanceM,
    isActive: threats.size > 0,
    verificationPending,
    confirmRadar,
    denyRadar,
  };
}
