/**
 * radarCommunityService.ts — Eagle Eye Community Intelligence (CCI) Layer.
 *
 * Phase 2: Realtime subscription, threat fusion, reportThreat, voteThreat
 * Phase 3: Exponential Decay — every 30 min confidence -1; hard expiry at 2 h
 *
 * Lifecycle: startCommunitySync() / stopCommunitySync() — called by radarEngine.
 * ALL timers and subscriptions are cleared in stopCommunitySync (Zero-Leak).
 */

import { getSupabaseClient, subscribeToTable } from '../supabaseClient';
import { getReporterDeviceId }                  from '../vehicleIdentityService';
import { haversineMeters }                       from './spatialUtils';
import { useRadarStore, getRadarSnapshot }       from './radarStore';
import type { RadarPoint }                       from './radarStore';

// ── Constants ─────────────────────────────────────────────────────────────────

const REPORT_SPAM_GUARD_MS = 60_000;           // 60 s client-side cooldown
const FUSION_RADIUS_M      = 50;               // merge reports within 50 m
const LIVE_REPORT_TTL_MS   = 30 * 60 * 1_000; // default optimistic TTL (30 min)

/** Confidence decrements by 1 for each elapsed step */
const DECAY_STEP_MS        = 30 * 60 * 1_000; // 30 min per decay step
/** Hard expiry regardless of confidence — removes stale ghost reports */
const MAX_AGE_MS           = 2  * 60 * 60 * 1_000; // 2 hours

export const HIGH_CONFIDENCE_THRESHOLD = 3;

// ── Supabase row shape ────────────────────────────────────────────────────────

interface RadarReportRow {
  id:          string;
  device_id:   string;
  lat:         number;
  lng:         number;
  type:        string;
  heading_deg: number | null;
  speed_kmh:   number | null;
  confidence:  number;
  reported_at: string;
  expires_at:  string | null;
  [key: string]: unknown;  // satisfies Record<string, unknown> for subscribeToTable<T>
}

// ── Module state ──────────────────────────────────────────────────────────────

let _stopSubscription: (() => void) | null = null;
let _decayTimer: ReturnType<typeof setInterval> | null = null;
let _ourDeviceId: string | null = null;
let _lastReportPerf = -REPORT_SPAM_GUARD_MS; // allow immediate first report

// ── Helpers ───────────────────────────────────────────────────────────────────

const VALID_TYPES = new Set<RadarPoint['type']>(['speed', 'redlight', 'mobile', 'average']);

function _rowToRadarPoint(row: RadarReportRow): RadarPoint {
  return {
    id:              `live_${row.id}`,
    lat:             row.lat,
    lng:             row.lng,
    type:            VALID_TYPES.has(row.type as RadarPoint['type'])
                       ? (row.type as RadarPoint['type'])
                       : 'mobile',
    directionDeg:    row.heading_deg ?? undefined,
    isLive:          true,
    confidenceScore: row.confidence,
    reportedAt:      new Date(row.reported_at).getTime(),
  };
}

function _blendHeading(
  existing: number | undefined,
  incoming: number | null,
): number | undefined {
  if (incoming === null)      return existing;
  if (existing === undefined) return incoming;
  const r1 = (existing * Math.PI) / 180;
  const r2 = (incoming * Math.PI) / 180;
  return (
    ((Math.atan2(
      (Math.sin(r1) + Math.sin(r2)) / 2,
      (Math.cos(r1) + Math.cos(r2)) / 2,
    ) * 180) / Math.PI + 360) % 360
  );
}

async function _ingestReport(row: RadarReportRow): Promise<void> {
  const ourId = _ourDeviceId ?? await getReporterDeviceId().catch(() => '');
  if (row.device_id === ourId) return; // echo suppression

  const { liveReports } = getRadarSnapshot();

  for (const existing of liveReports.values()) {
    const distM = haversineMeters(row.lat, row.lng, existing.lat, existing.lng);
    if (distM > FUSION_RADIUS_M) continue;

    const n  = existing.confidenceScore ?? 1;
    const n1 = n + 1;
    useRadarStore.getState().upsertLiveReport({
      ...existing,
      lat:             (existing.lat * n + row.lat) / n1,
      lng:             (existing.lng * n + row.lng) / n1,
      directionDeg:    _blendHeading(existing.directionDeg, row.heading_deg),
      confidenceScore: n1,
      reportedAt:      new Date(row.reported_at).getTime(),
    });
    return;
  }

  useRadarStore.getState().upsertLiveReport(_rowToRadarPoint(row));
}

function _handleUpdate(row: RadarReportRow): void {
  const { liveReports } = getRadarSnapshot();
  const id = `live_${row.id}`;
  const existing = liveReports.get(id);
  if (!existing) return;
  useRadarStore.getState().upsertLiveReport({
    ...existing,
    confidenceScore: row.confidence,
    reportedAt:      new Date(row.reported_at).getTime(),
  });
}

// ── Exponential Decay (Phase 3) ───────────────────────────────────────────────

/**
 * One decay cycle:
 *   • age ≥ MAX_AGE_MS → hard expiry → remove locally + DELETE from Supabase
 *   • confidence ≤ 0   → soft expiry → same removal
 *   • age ≥ DECAY_STEP_MS AND confidence > 0 → decrement confidence + UPDATE server
 *
 * Runs every DECAY_STEP_MS (30 min). Clock-gap resilience: if the device
 * sleeps and wakes up after 2h, the MAX_AGE_MS check covers missed steps.
 */
async function _runDecayCycle(): Promise<void> {
  const { liveReports } = getRadarSnapshot();
  if (liveReports.size === 0) return;

  const now      = Date.now();
  const supabase = getSupabaseClient();
  const store    = useRadarStore.getState();

  for (const [storeId, report] of liveReports) {
    const age        = now - (report.reportedAt ?? now);
    const confidence = report.confidenceScore ?? 1;
    const isOptimistic = storeId.startsWith('live_opt_');
    const dbId = !isOptimistic && storeId.startsWith('live_') ? storeId.slice(5) : null;

    // ── Hard expiry ───────────────────────────────────────────────────────
    if (age >= MAX_AGE_MS || confidence <= 0) {
      store.removeLiveReport(storeId);
      if (dbId && supabase) {
        supabase.from('radar_reports').delete().eq('id', dbId)
          .then(() => undefined, () => undefined);
      }
      continue;
    }

    // ── Soft decay: decrement confidence by 1 per step ───────────────────
    if (age >= DECAY_STEP_MS) {
      const newConf = confidence - 1;
      store.upsertLiveReport({ ...report, confidenceScore: newConf });
      if (dbId && supabase) {
        if (newConf <= 0) {
          supabase.from('radar_reports').delete().eq('id', dbId)
            .then(() => undefined, () => undefined);
          store.removeLiveReport(storeId);
        } else {
          supabase.from('radar_reports').update({ confidence: newConf }).eq('id', dbId)
            .then(() => undefined, () => undefined);
        }
      }
    }
  }
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

export async function startCommunitySync(): Promise<void> {
  if (_stopSubscription) return;

  _ourDeviceId = await getReporterDeviceId().catch(() => null);

  const supabase = getSupabaseClient();
  if (!supabase) return;

  _stopSubscription = subscribeToTable<RadarReportRow>(
    'radar_reports',
    ['INSERT', 'UPDATE'],
    (event, row) => {
      if (event === 'INSERT') {
        _ingestReport(row).catch(() => undefined);
      } else {
        _handleUpdate(row);
      }
    },
  );

  // ── Decay timer: runs every 30 min, cleared in stopCommunitySync ─────────
  _decayTimer = setInterval(() => {
    _runDecayCycle().catch(() => undefined);
  }, DECAY_STEP_MS);
}

/**
 * Zero-Leak teardown:
 *   ✓ Supabase Realtime channel removed
 *   ✓ Decay setInterval cleared
 *   ✓ Live reports purged from store
 */
export function stopCommunitySync(): void {
  _stopSubscription?.();
  _stopSubscription = null;

  if (_decayTimer !== null) {
    clearInterval(_decayTimer);
    _decayTimer = null;
  }

  useRadarStore.getState().clearLiveReports();
}

export function isCommunitySync(): boolean {
  return _stopSubscription !== null;
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function reportThreat(
  type:       RadarPoint['type'],
  lat:        number,
  lng:        number,
  speedKmh:   number,
  headingDeg: number,
): Promise<void> {
  const now   = performance.now();
  const since = now - _lastReportPerf;
  if (since < REPORT_SPAM_GUARD_MS) {
    const secLeft = Math.ceil((REPORT_SPAM_GUARD_MS - since) / 1_000);
    throw new Error(`Çok sık ihbar: ${secLeft} saniye bekleyin`);
  }
  _lastReportPerf = now;

  const optimisticId = `live_opt_${Date.now()}`;
  useRadarStore.getState().upsertLiveReport({
    id:              optimisticId,
    lat, lng, type,
    directionDeg:    headingDeg,
    isLive:          true,
    confidenceScore: 1,
    reportedAt:      Date.now(),
  });

  const supabase = getSupabaseClient();
  if (!supabase) return;

  const deviceId = _ourDeviceId ?? await getReporterDeviceId().catch(() => 'unknown');
  const { error } = await supabase.from('radar_reports').insert({
    device_id:   deviceId,
    lat, lng, type,
    heading_deg: headingDeg,
    speed_kmh:   speedKmh,
    confidence:  1,
    reported_at: new Date().toISOString(),
    expires_at:  new Date(Date.now() + LIVE_REPORT_TTL_MS).toISOString(),
  });

  if (error) {
    useRadarStore.getState().removeLiveReport(optimisticId);
    _lastReportPerf = -REPORT_SPAM_GUARD_MS;
    throw new Error(error.message);
  }
}

/**
 * Vote on a peer radar report.
 *
 * 'confirm' → increments confidence (triggers UPDATE Realtime for all clients)
 * 'deny'    → decrements confidence (server removes row when confidence hits 0)
 *
 * Requires Supabase RPCs:
 *   confirm_radar_report(p_report_id uuid)
 *   deny_radar_report(p_report_id uuid)
 */
export async function voteThreat(
  reportId: string,
  vote:     'confirm' | 'deny',
): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) return;

  const dbId    = reportId.startsWith('live_') ? reportId.slice(5) : reportId;
  const rpcName = vote === 'confirm' ? 'confirm_radar_report' : 'deny_radar_report';

  const { error } = await supabase.rpc(rpcName, { p_report_id: dbId });
  if (error) throw new Error(error.message);
}

// ── HMR cleanup ───────────────────────────────────────────────────────────────
if (import.meta.hot) {
  import.meta.hot.dispose(() => stopCommunitySync());
}
