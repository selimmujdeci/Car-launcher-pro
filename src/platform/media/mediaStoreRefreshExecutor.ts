/**
 * F2 MediaStore refresh executor — the missing link between the refresh policy and
 * the real provider. This is the ONLY place that scans MediaStore.
 *
 *   volume facts → storage/permission lifecycle → planMediaStoreRefresh
 *     → UNCHANGED  : zero track queries, zero revisions
 *     → DELTA      : changed volumes only (generation window) + that volume's
 *                    identity set, so deletions are OBSERVED, never invented
 *     → FULL       : every reachable volume, other volumes retained as STALE
 *   → MusicIndex reconcile → persisted per-volume state (success only) → UI
 *
 * Authority: MusicIndex stays the library truth and CarosPlaybackService stays the
 * playback truth. Library availability is NOT playback state — a detached volume
 * makes items STALE and never stops or contradicts what is currently playing.
 */
import { CarLauncher, type LocalMusicTrack, type MediaStoreVolumeFact } from '../nativePlugin';
import { isNative } from '../bridge';
import { logError } from '../crashLogger';
import { mediaTrackId, normalizeVolumeIdentity } from './mediaIdentity';
import { planMediaStoreRefresh, type RefreshDecision, type VolumeRefreshFact } from './mediaStoreRefreshPlanner';
import { evaluateStorageLifecycle, type PermissionTransition } from './storageVolumeLifecycle';
import { buildRefreshState, loadRefreshState, saveRefreshState } from './mediaStoreRefreshState';
import { applyMusicIndexDelta, markMusicVolumeStale, pruneMusicVolume, reconcileMusicIndex, getMusicLibrarySnapshot } from './musicIndex';

export type RefreshStatus = 'APPLIED' | 'SKIPPED' | 'FAILED' | 'UNAVAILABLE';

export interface RefreshOutcome {
  readonly startedAt: number;
  readonly finishedAt: number;
  readonly decision: RefreshDecision;
  readonly status: RefreshStatus;
  readonly reason: string;
  readonly permission: PermissionTransition | 'UNKNOWN';
  readonly permissionGranted: boolean | null;
  readonly supportsGeneration: boolean | null;
  /** How many track queries actually hit the provider this round (UNCHANGED ⇒ 0). */
  readonly trackQueries: number;
  readonly tracksReceived: number;
  readonly scannedVolumes: readonly string[];
  readonly staleVolumes: readonly string[];
  readonly prunedVolumes: readonly string[];
  readonly escalated: boolean;
  readonly statePersisted: boolean;
  readonly revision: number;
  readonly failureCode: string | null;
}

const COUNTERS = { rounds: 0, applied: 0, skipped: 0, failed: 0, unavailable: 0, trackQueries: 0, escalations: 0 };
let lastOutcome: RefreshOutcome | null = null;
let inFlight: Promise<RefreshOutcome> | null = null;

const toFact = (v: MediaStoreVolumeFact): VolumeRefreshFact => Object.freeze({
  volumeName: normalizeVolumeIdentity(v.name),
  version: typeof v.version === 'string' ? v.version : null,
  generation: typeof v.generation === 'number' && Number.isFinite(v.generation) ? v.generation : null,
  available: v.available === true,
});

function finish(outcome: RefreshOutcome): RefreshOutcome {
  lastOutcome = Object.freeze(outcome);
  COUNTERS.rounds += 1;
  COUNTERS.trackQueries += outcome.trackQueries;
  if (outcome.escalated) COUNTERS.escalations += 1;
  if (outcome.status === 'APPLIED') COUNTERS.applied += 1;
  else if (outcome.status === 'SKIPPED') COUNTERS.skipped += 1;
  else if (outcome.status === 'FAILED') COUNTERS.failed += 1;
  else COUNTERS.unavailable += 1;
  return lastOutcome;
}

const base = (startedAt: number) => ({
  startedAt, finishedAt: startedAt, decision: 'FULL_RECONCILE' as RefreshDecision, status: 'FAILED' as RefreshStatus,
  reason: '', permission: 'UNKNOWN' as PermissionTransition | 'UNKNOWN', permissionGranted: null as boolean | null,
  supportsGeneration: null as boolean | null, trackQueries: 0, tracksReceived: 0,
  scannedVolumes: Object.freeze([]) as readonly string[], staleVolumes: Object.freeze([]) as readonly string[],
  prunedVolumes: Object.freeze([]) as readonly string[], escalated: false, statePersisted: false,
  revision: getMusicLibrarySnapshot().revision, failureCode: null as string | null,
});

async function runRefresh(now: () => number): Promise<RefreshOutcome> {
  const startedAt = now();
  if (!isNative) {
    return finish({ ...base(startedAt), finishedAt: now(), status: 'UNAVAILABLE', decision: 'UNCHANGED', reason: 'not_native_platform' });
  }

  let facts;
  try {
    facts = await CarLauncher.getMediaStoreVolumeFacts();
  } catch (e) {
    logError('MusicRefresh:VolumeFacts', e);
    return finish({ ...base(startedAt), finishedAt: now(), status: 'FAILED', reason: 'volume_facts_unavailable', failureCode: 'VOLUME_FACTS_FAILED' });
  }

  const permissionGranted = facts?.permissionGranted === true;
  const supportsGeneration = facts?.supportsGeneration === true;
  const observed = (facts?.volumes ?? []).map(toFact);
  const available = observed.filter((v) => v.available).map((v) => v.volumeName);
  const unavailable = observed.filter((v) => !v.available).map((v) => v.volumeName);

  const previous = loadRefreshState();
  const lifecycle = evaluateStorageLifecycle(previous, observed, permissionGranted);

  /* Permission denied is an OBSERVED fact, not a failed scan: the library goes STALE
     and the denial is persisted so the next grant is recognised as RESTORED → FULL.
     Generations are carried over untouched, so nothing can be trusted as "fresh". */
  if (!permissionGranted) {
    if (lifecycle.staleVolumes.length) markMusicVolumeStale(lifecycle.staleVolumes);
    const carried = previous?.volumes ?? observed;
    const persisted = saveRefreshState(buildRefreshState(carried, false, previous?.lastSuccessfulRefreshAt ?? 0));
    return finish({
      ...base(startedAt), finishedAt: now(), status: 'SKIPPED', decision: 'FULL_RECONCILE',
      reason: 'permission_denied', permission: lifecycle.permission, permissionGranted: false,
      supportsGeneration, staleVolumes: lifecycle.staleVolumes, statePersisted: persisted,
      revision: getMusicLibrarySnapshot().revision,
    });
  }

  const plan = planMediaStoreRefresh(previous, observed, true);
  const libraryEmpty = getMusicLibrarySnapshot().availability !== 'READY';
  let decision: RefreshDecision = plan.decision;
  let reason = plan.reason;
  let escalated = false;

  if (lifecycle.requiresFullReconcile && decision !== 'FULL_RECONCILE') {
    decision = 'FULL_RECONCILE'; reason = lifecycle.reason; escalated = true;
  }
  if (decision !== 'FULL_RECONCILE' && (libraryEmpty || !supportsGeneration)) {
    decision = 'FULL_RECONCILE'; reason = libraryEmpty ? 'no_ready_library_baseline' : 'generation_unsupported'; escalated = true;
  }

  if (decision === 'UNCHANGED') {
    // Zero track queries, zero revisions. Only the "we looked" timestamp advances.
    const persisted = saveRefreshState(buildRefreshState(observed, true, now()));
    return finish({
      ...base(startedAt), finishedAt: now(), status: 'SKIPPED', decision: 'UNCHANGED', reason,
      permission: lifecycle.permission, permissionGranted: true, supportsGeneration,
      statePersisted: persisted, revision: getMusicLibrarySnapshot().revision,
    });
  }

  const deltaVolumes = plan.deltaVolumes.filter((v) => available.includes(v));
  const targets = decision === 'DELTA' ? deltaVolumes : available;
  if (targets.length === 0) {
    // Nothing readable: mark what we knew STALE, keep it addressable, persist nothing new.
    if (lifecycle.staleVolumes.length || unavailable.length) markMusicVolumeStale([...lifecycle.staleVolumes, ...unavailable]);
    const persisted = saveRefreshState(buildRefreshState(observed, true, now()));
    return finish({
      ...base(startedAt), finishedAt: now(), status: 'SKIPPED', decision, reason: 'no_reachable_volume',
      permission: lifecycle.permission, permissionGranted: true, supportsGeneration,
      staleVolumes: Object.freeze([...new Set([...lifecycle.staleVolumes, ...unavailable])]),
      statePersisted: persisted, escalated, revision: getMusicLibrarySnapshot().revision,
    });
  }

  const sinceGeneration: Record<string, number> = {};
  if (decision === 'DELTA' && previous) {
    for (const v of previous.volumes) {
      if (deltaVolumes.includes(v.volumeName) && typeof v.generation === 'number') sinceGeneration[v.volumeName] = v.generation;
    }
  }

  let response;
  let trackQueries = 0;
  try {
    trackQueries = 1;
    response = await CarLauncher.queryMusicTracks({
      volumes: [...targets],
      mode: decision === 'DELTA' ? 'DELTA' : 'FULL',
      ...(decision === 'DELTA' ? { sinceGeneration, identityVolumes: [...deltaVolumes] } : {}),
    });
  } catch (e) {
    logError('MusicRefresh:Query', e);
    // Failed scan → persisted generation is NOT advanced; the next round retries.
    return finish({
      ...base(startedAt), finishedAt: now(), status: 'FAILED', decision, reason: 'track_query_failed',
      permission: lifecycle.permission, permissionGranted: true, supportsGeneration,
      trackQueries, escalated, failureCode: 'TRACK_QUERY_FAILED', revision: getMusicLibrarySnapshot().revision,
    });
  }

  const tracks: readonly LocalMusicTrack[] = response?.tracks ?? [];
  const staleVolumes = [...new Set([...lifecycle.staleVolumes, ...unavailable])];
  const prunedVolumes: string[] = [];

  if (decision === 'DELTA') {
    const applied = applyMusicIndexDelta(tracks);
    if (!applied) {
      // Baseline vanished mid-round: escalate rather than build a library from a delta.
      escalated = true;
      try {
        trackQueries += 1;
        const full = await CarLauncher.queryMusicTracks({ volumes: [...available], mode: 'FULL' });
        reconcileMusicIndex(full?.tracks ?? [], { scopeVolumes: available, staleVolumes });
        decision = 'FULL_RECONCILE'; reason = 'delta_without_baseline_escalated';
      } catch (e) {
        logError('MusicRefresh:DeltaEscalation', e);
        return finish({
          ...base(startedAt), finishedAt: now(), status: 'FAILED', decision, reason: 'delta_escalation_failed',
          permission: lifecycle.permission, permissionGranted: true, supportsGeneration,
          trackQueries, escalated, failureCode: 'TRACK_QUERY_FAILED', revision: getMusicLibrarySnapshot().revision,
        });
      }
    } else {
      // Deletions are only applied where the provider actually enumerated identities.
      const identities = response?.identities ?? {};
      for (const volume of deltaVolumes) {
        const ids = identities[volume];
        if (!Array.isArray(ids)) continue;
        pruneMusicVolume(volume, ids.map((raw) => mediaTrackId(volume, raw)));
        prunedVolumes.push(volume);
      }
      if (staleVolumes.length) markMusicVolumeStale(staleVolumes);
    }
  } else {
    reconcileMusicIndex(tracks, { scopeVolumes: available, staleVolumes });
  }

  // Success only: this is the single place persisted generations move forward.
  const persisted = saveRefreshState(buildRefreshState(observed, true, now()));
  return finish({
    ...base(startedAt), finishedAt: now(), status: 'APPLIED', decision, reason,
    permission: lifecycle.permission, permissionGranted: true, supportsGeneration,
    trackQueries, tracksReceived: tracks.length, scannedVolumes: Object.freeze([...targets]),
    staleVolumes: Object.freeze(staleVolumes), prunedVolumes: Object.freeze(prunedVolumes),
    escalated, statePersisted: persisted, revision: getMusicLibrarySnapshot().revision,
  });
}

/** Single-flight: overlapping callers share one round instead of double-scanning. */
export function refreshMusicLibrary(now: () => number = Date.now): Promise<RefreshOutcome> {
  if (inFlight) return inFlight;
  inFlight = runRefresh(now).finally(() => { inFlight = null; });
  return inFlight;
}

export function getLastMusicRefreshOutcome(): RefreshOutcome | null { return lastOutcome; }
export function getMusicRefreshCounters(): Readonly<typeof COUNTERS> { return Object.freeze({ ...COUNTERS }); }
export function isMusicRefreshInFlight(): boolean { return inFlight !== null; }

/** @internal */
export function _resetMusicRefreshForTest(): void {
  lastOutcome = null; inFlight = null;
  COUNTERS.rounds = 0; COUNTERS.applied = 0; COUNTERS.skipped = 0; COUNTERS.failed = 0;
  COUNTERS.unavailable = 0; COUNTERS.trackQueries = 0; COUNTERS.escalations = 0;
}
