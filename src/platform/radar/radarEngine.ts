/**
 * radarEngine.ts — Eagle Eye Vectorial Threat Analysis Engine.
 *
 * Phase 1: heading-aware filtering, velocity-adaptive horizon, lifecycle
 * Phase 2: static + live allPoints evaluation, startRadarEngine/stopRadarEngine
 * Phase 3:
 *   • Voice Alert Engine — formatted TTS + per-radar 5-min anti-spam
 *   • Audio Ducking      — lowers music volume during TTS, restores on onEnd
 *   • Active Verification — needsVerification flag for live radars within 50m
 *   • Zero-Leak cleanup  — _radarTtsHistory cleared in stopRadarEngine
 */

import { haversineMeters, bearingDeg, angularDiffAbs } from './spatialUtils';
import { useRadarStore, getRadarSnapshot }              from './radarStore';
import type { ThreatEntry, ThreatPhase, RadarPoint }    from './radarStore';
import { startCommunitySync, stopCommunitySync }        from './radarCommunityService';
import { ttsSpeak }                                     from '../ttsService';
import { setVolume }                                    from '../systemSettingsService';
import { useStore }                                     from '../../store/useStore';

// ── Spatial constants ─────────────────────────────────────────────────────────

const BASE_ALERT_DISTANCE_M    = 300;
const SPEED_FACTOR_M_PER_KMH   = 10;
const MAX_ALERT_DISTANCE_M     = 1500;
const FRONT_CONE_DEG           = 25;
const PASSED_CONE_DEG          = 100;
const AT_POINT_M               = 30;
const APPROACHING_M            = 150;

/** Distance at which a live radar triggers the verification prompt (meters) */
const VERIFICATION_RADIUS_M    = 50;

// ── Voice alert constants ─────────────────────────────────────────────────────

/** Per-radar minimum interval between TTS alerts — prevents re-alerting on U-turns */
const RADAR_TTS_COOLDOWN_MS    = 5 * 60 * 1_000; // 5 minutes

/** How much to lower volume (0-100 scale) during TTS ducking */
const DUCK_REDUCTION           = 35;

/** Minimum volume floor during ducking — never go completely silent */
const DUCK_MIN_VOLUME          = 10;

// ── Module state ──────────────────────────────────────────────────────────────

type AlertCallback = (threat: ThreatEntry) => void;
let _alertCb: AlertCallback | null = null;

/** radarId → performance.now() of last TTS fire — persists across threat lifecycle */
const _radarTtsHistory = new Map<string, number>();

// ── Alert callback (external extension point) ─────────────────────────────────

/**
 * Register a callback that fires after a voice alert is triggered.
 * Use for supplemental notifications (haptic, UI flash). Pass null to deregister.
 * TTS is handled internally by the engine — do not call ttsSpeak here.
 */
export function setRadarAlertCallback(cb: AlertCallback | null): void {
  _alertCb = cb;
}

// ── Voice Alert Engine ────────────────────────────────────────────────────────

/** Build the Turkish TTS announcement string for a threat */
function _buildAlertText(threat: ThreatEntry): string {
  const dist    = Math.round(threat.distanceM / 50) * 50; // round to 50m steps
  const limitStr = threat.radar.speedLimit != null
    ? `, limit ${threat.radar.speedLimit}`
    : '';

  if (threat.radar.isLive) {
    // Community-sourced — uncertainty acknowledged in the phrasing
    const liveLabel: Record<string, string> = {
      speed:    'hız',
      redlight: 'kırmızı ışık',
      mobile:   'mobil',
      average:  'ortalama hız',
    };
    const t = liveLabel[threat.radar.type] ?? 'mobil';
    return `İleride ${t} radar ihbarı var, dikkat! ${dist} metre`;
  }

  const staticLabel: Record<string, string> = {
    speed:    'sabit radar',
    redlight: 'kırmızı ışık kamerası',
    mobile:   'mobil radar',
    average:  'ortalama hız kamerası',
  };
  const label = staticLabel[threat.radar.type] ?? 'radar';
  return `${dist} metre sonra ${label}${limitStr}`;
}

/**
 * Fire a TTS voice alert with audio ducking.
 * Checks per-radar 5-minute cooldown before speaking.
 * Returns true if TTS was actually fired.
 */
function _fireVoiceAlert(threat: ThreatEntry): boolean {
  const radarId = threat.radar.id;
  const now     = performance.now();

  // ── Per-radar anti-spam (5 min cooldown) ─────────────────────────────────
  const lastFired = _radarTtsHistory.get(radarId);
  if (lastFired !== undefined && (now - lastFired) < RADAR_TTS_COOLDOWN_MS) return false;
  _radarTtsHistory.set(radarId, now);

  const text = _buildAlertText(threat);

  // ── Audio ducking — lower music before TTS, restore on onEnd ─────────────
  let preVol: number | null = null;
  try {
    preVol = useStore.getState().settings.volume;
    const duckedVol = Math.max(DUCK_MIN_VOLUME, preVol - DUCK_REDUCTION);
    setVolume(duckedVol);
  } catch { /* setVolume may throw in web/test environments */ }

  ttsSpeak(text, {
    rate:  1.1,
    onEnd: () => { if (preVol !== null) setVolume(preVol); },
  });

  return true;
}

// ── Static radar loading ──────────────────────────────────────────────────────

export function loadStaticRadars(points: RadarPoint[]): void {
  useRadarStore.getState().setRadars(points);
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

/** Start the engine: load static points, begin community sync. Idempotent. */
export async function startRadarEngine(staticPoints: RadarPoint[] = []): Promise<void> {
  loadStaticRadars(staticPoints);
  await startCommunitySync();
}

/**
 * Stop the engine and release ALL resources.
 *
 * Zero-Leak checklist:
 *   ✓ Supabase Realtime channel removed (via stopCommunitySync)
 *   ✓ Decay setInterval cleared (via stopCommunitySync)
 *   ✓ _radarTtsHistory Map cleared
 *   ✓ Alert callback deregistered
 *   ✓ Store threats + live reports purged
 */
export function stopRadarEngine(): void {
  stopCommunitySync();
  setRadarAlertCallback(null);
  _radarTtsHistory.clear();
  useRadarStore.getState().clearAll();
}

// ── Core evaluation ───────────────────────────────────────────────────────────

/**
 * Evaluate all radar points (static + live) against the current vehicle state.
 * Designed for 2–10 Hz GPS calls. Zero heap allocation in the hot loop.
 */
export function evaluateRadarThreats(
  lat:        number,
  lng:        number,
  headingDeg: number,
  speedKmh:   number,
): void {
  const snap = getRadarSnapshot();
  const { allPoints, threats: prevThreats } = snap;
  if (allPoints.length === 0) return;

  // ── Velocity-adaptive alert horizon ──────────────────────────────────────
  const alertDistanceM = Math.min(
    BASE_ALERT_DISTANCE_M + speedKmh * SPEED_FACTOR_M_PER_KMH,
    MAX_ALERT_DISTANCE_M,
  );

  if (alertDistanceM !== snap.alertDistanceM) {
    useRadarStore.getState().setAlertDistance(alertDistanceM);
  }

  const now         = performance.now();
  const nextThreats = new Map<string, ThreatEntry>();

  for (let i = 0; i < allPoints.length; i++) {
    const radar = allPoints[i];

    const distM = haversineMeters(lat, lng, radar.lat, radar.lng);
    const prev  = prevThreats.get(radar.id);

    if (distM > alertDistanceM && !prev) continue;

    const bearing     = bearingDeg(lat, lng, radar.lat, radar.lng);
    const angDiff     = angularDiffAbs(headingDeg, bearing);
    const inFrontCone = angDiff <= FRONT_CONE_DEG;

    // ── PASSED detection ──────────────────────────────────────────────────
    const wasClose = prev && (prev.phase === 'APPROACHING' || prev.phase === 'AT_POINT');
    if (wasClose && angDiff > PASSED_CONE_DEG) continue;

    if (distM > alertDistanceM) continue;

    // ── Phase assignment ──────────────────────────────────────────────────
    const phase: ThreatPhase = distM <= AT_POINT_M
      ? 'AT_POINT'
      : distM <= APPROACHING_M
        ? 'APPROACHING'
        : 'ENTERING';

    // ── Active Verification flag ──────────────────────────────────────────
    // Prompt driver to confirm/deny only for LIVE radars within the threshold.
    // Carry forward an existing true flag so the UI can dismiss it gracefully.
    const needsVerification =
      (radar.isLive === true && distM <= VERIFICATION_RADIUS_M) ||
      (prev?.needsVerification === true && (phase as string) !== 'PASSED');

    // ── Audio alert eligibility ───────────────────────────────────────────
    const prevAlertedAt = prev?.alertedAt ?? null;
    const shouldAlert   = inFrontCone && prevAlertedAt === null;

    const entry: ThreatEntry = {
      radar,
      phase,
      distanceM:         distM,
      bearingToRadarDeg: bearing,
      inFrontCone,
      detectedAt:        prev?.detectedAt ?? now,
      alertedAt:         shouldAlert ? now : prevAlertedAt,
      needsVerification,
    };

    nextThreats.set(radar.id, entry);

    // ── Fire voice alert (TTS + ducking) + external callback ─────────────
    if (shouldAlert) {
      _fireVoiceAlert(entry);
      _alertCb?.(entry);
    }
  }

  // ── Atomic store update (only when content changed) ──────────────────────
  let changed = nextThreats.size !== prevThreats.size;
  if (!changed) {
    for (const [id, entry] of nextThreats) {
      const p = prevThreats.get(id);
      if (
        !p ||
        p.phase             !== entry.phase             ||
        p.needsVerification !== entry.needsVerification ||
        Math.abs(p.distanceM - entry.distanceM) > 1
      ) {
        changed = true;
        break;
      }
    }
  }

  if (changed) {
    useRadarStore.getState().setThreats(nextThreats);
  }
}
