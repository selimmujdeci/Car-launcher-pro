/**
 * F2 storage + permission lifecycle model. Pure: no I/O, no timer, no state.
 *
 * It answers ONE question — "what changed about reachable storage since the last
 * successful scan?" — and never claims playback truth: a detached volume makes
 * library items STALE, it does not stop or contradict CarosPlaybackService.
 */
import type { PersistedRefreshState, VolumeRefreshFact } from './mediaStoreRefreshPlanner';
import { normalizeVolumeIdentity } from './mediaIdentity';

export type PermissionTransition =
  | 'STILL_GRANTED' | 'STILL_DENIED' | 'GRANTED' | 'DENIED' | 'RESTORED' | 'UNKNOWN_PREVIOUS';

export interface StorageLifecycleResult {
  readonly permission: PermissionTransition;
  /** Volumes never seen in the persisted state. */
  readonly attached: readonly string[];
  /** Known volumes that are gone or reported unavailable now. */
  readonly detached: readonly string[];
  /** Known volumes that were unavailable and are reachable again. */
  readonly reattached: readonly string[];
  /** Library items on these volumes must be marked STALE (never deleted blindly). */
  readonly staleVolumes: readonly string[];
  /** Volumes that must be reconciled from scratch this round. */
  readonly reconcileVolumes: readonly string[];
  readonly requiresFullReconcile: boolean;
  readonly reason: string;
}

const identities = (facts: readonly VolumeRefreshFact[]) =>
  facts.map((f) => ({ ...f, volumeName: normalizeVolumeIdentity(f.volumeName) }));

export function evaluateStorageLifecycle(
  previous: PersistedRefreshState | null,
  current: readonly VolumeRefreshFact[],
  permissionGranted: boolean,
): StorageLifecycleResult {
  const now = identities(current);
  const available = now.filter((v) => v.available).map((v) => v.volumeName);

  if (!permissionGranted) {
    // Nothing is readable: everything previously known becomes STALE, not deleted.
    const knownStale = previous ? identities(previous.volumes).map((v) => v.volumeName) : [];
    return Object.freeze({
      permission: previous ? (previous.permissionGranted ? 'DENIED' : 'STILL_DENIED') : 'UNKNOWN_PREVIOUS',
      attached: Object.freeze([]), detached: Object.freeze(knownStale), reattached: Object.freeze([]),
      staleVolumes: Object.freeze(knownStale), reconcileVolumes: Object.freeze([]),
      requiresFullReconcile: false, reason: 'permission_denied_library_stale',
    });
  }

  if (!previous) {
    return Object.freeze({
      permission: 'UNKNOWN_PREVIOUS', attached: Object.freeze(available), detached: Object.freeze([]),
      reattached: Object.freeze([]), staleVolumes: Object.freeze([]), reconcileVolumes: Object.freeze(available),
      requiresFullReconcile: true, reason: 'no_previous_state',
    });
  }

  const before = new Map(identities(previous.volumes).map((v) => [v.volumeName, v]));
  const attached: string[] = []; const detached: string[] = []; const reattached: string[] = [];

  for (const v of now) {
    const prior = before.get(v.volumeName);
    if (!prior) { if (v.available) attached.push(v.volumeName); continue; }
    if (v.available && !prior.available) reattached.push(v.volumeName);
    else if (!v.available && prior.available) detached.push(v.volumeName);
  }
  for (const [name, prior] of before) if (prior.available && !now.some((v) => v.volumeName === name)) detached.push(name);

  const permissionRestored = previous.permissionGranted === false;
  const permission: PermissionTransition = permissionRestored ? 'RESTORED' : 'STILL_GRANTED';
  const structural = attached.length > 0 || reattached.length > 0 || detached.length > 0;

  return Object.freeze({
    permission,
    attached: Object.freeze(attached), detached: Object.freeze(detached), reattached: Object.freeze(reattached),
    staleVolumes: Object.freeze(detached),
    reconcileVolumes: Object.freeze(permissionRestored || structural ? available : []),
    requiresFullReconcile: permissionRestored || structural,
    reason: permissionRestored ? 'permission_restored'
      : structural ? `volume_topology_changed(attached=${attached.length},reattached=${reattached.length},detached=${detached.length})`
      : 'topology_stable',
  });
}
