/**
 * radarStore.ts — Eagle Eye radar threat state.
 *
 * Two separate collections:
 *   radars      — static database points (loaded at startup / region change)
 *   liveReports — community reports injected by CCI layer (Phase 2+)
 *
 * allPoints combines both; rebuilt atomically on any mutation so the engine
 * hot loop only needs to iterate one array.
 */

import { create } from 'zustand';

/** Radar approach lifecycle phase */
export type ThreatPhase = 'ENTERING' | 'APPROACHING' | 'AT_POINT' | 'PASSED';

/** A radar / speed camera point — static or live community report */
export interface RadarPoint {
  id: string;
  lat: number;
  lng: number;
  type: 'speed' | 'redlight' | 'mobile' | 'average';
  /** Enforced speed limit in km/h. undefined = unknown */
  speedLimit?: number;
  /** Enforcement direction 0–360° (0=North). undefined = omnidirectional */
  directionDeg?: number;
  // ── CCI fields (only present on live community reports) ──────────────────
  /** True for community-sourced (live) reports */
  isLive?: boolean;
  /** Fused vote count: 1 = single report, 3+ = high confidence */
  confidenceScore?: number;
  /** epoch ms when this point was first reported / last updated */
  reportedAt?: number;
}

/** An actively-tracked radar threat with full lifecycle metadata */
export interface ThreatEntry {
  radar: RadarPoint;
  phase: ThreatPhase;
  distanceM: number;
  bearingToRadarDeg: number;
  inFrontCone: boolean;
  detectedAt: number;        // performance.now()
  alertedAt: number | null;  // performance.now() or null
  /**
   * Set when vehicle passes within VERIFICATION_RADIUS_M of a LIVE radar.
   * UI should prompt the driver to confirm or deny the report.
   */
  needsVerification: boolean;
}

// ── Internal helper ───────────────────────────────────────────────────────────

function _buildAllPoints(
  radars:      RadarPoint[],
  liveReports: Map<string, RadarPoint>,
): RadarPoint[] {
  return liveReports.size === 0 ? radars : [...radars, ...liveReports.values()];
}

// ── Store shape ───────────────────────────────────────────────────────────────

interface RadarStoreState {
  radars:          RadarPoint[];
  liveReports:     Map<string, RadarPoint>;
  /** Combined static + live — the engine iterates this single array */
  allPoints:       RadarPoint[];
  threats:         Map<string, ThreatEntry>;
  alertDistanceM:  number;
}

interface RadarStoreActions {
  setRadars:        (radars: RadarPoint[]) => void;
  upsertLiveReport: (report: RadarPoint) => void;
  removeLiveReport: (id: string) => void;
  clearLiveReports: () => void;
  setThreats:       (threats: Map<string, ThreatEntry>) => void;
  /** Patch a single field on an existing ThreatEntry without a full Map swap */
  patchThreat:      (id: string, patch: Partial<ThreatEntry>) => void;
  setAlertDistance: (meters: number) => void;
  clearAll:         () => void;
}

export const useRadarStore = create<RadarStoreState & RadarStoreActions>((set) => ({
  radars:         [],
  liveReports:    new Map(),
  allPoints:      [],
  threats:        new Map(),
  alertDistanceM: 300,

  setRadars: (radars) =>
    set((s) => ({ radars, allPoints: _buildAllPoints(radars, s.liveReports) })),

  upsertLiveReport: (report) =>
    set((s) => {
      const liveReports = new Map(s.liveReports).set(report.id, report);
      return { liveReports, allPoints: _buildAllPoints(s.radars, liveReports) };
    }),

  removeLiveReport: (id) =>
    set((s) => {
      if (!s.liveReports.has(id)) return s;
      const liveReports = new Map(s.liveReports);
      liveReports.delete(id);
      return { liveReports, allPoints: _buildAllPoints(s.radars, liveReports) };
    }),

  clearLiveReports: () =>
    set((s) => ({ liveReports: new Map(), allPoints: s.radars })),

  setThreats: (threats) => set({ threats }),

  patchThreat: (id, patch) =>
    set((s) => {
      const prev = s.threats.get(id);
      if (!prev) return s;
      const threats = new Map(s.threats);
      threats.set(id, { ...prev, ...patch });
      return { threats };
    }),

  setAlertDistance: (meters) => set({ alertDistanceM: meters }),

  clearAll: () =>
    set({ threats: new Map(), liveReports: new Map(), allPoints: [] }),
}));

/** Synchronous store snapshot — safe outside React render cycle */
export const getRadarSnapshot = () => useRadarStore.getState();
