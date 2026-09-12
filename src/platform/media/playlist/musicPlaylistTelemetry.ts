/**
 * musicPlaylistTelemetry.ts — MUSIC F15 · Kanıt deposu (bounded, salt gözlem).
 *
 * GİZLİLİK (CLAUDE.md gözlemlenebilirlik kuralı 6): playlist adı · parça adı ·
 * URI · sesli komut metni BURAYA GİRMEZ. Yalnız sayaç, tür dağılımı ve
 * bounded gecikme örneklemi tutulur.
 *
 * OTORİTE SINIRI: sayaçlar hiçbir karara GERİ BESLENMEZ; LAB salt-okunur
 * gösterim için `getMusicPlaylistTelemetry()`yi okur, asla yazmaz.
 */

import type { PlaylistMutationStatus } from './musicPlaylistEntry';

const CAP = 64;
const projectionMs = new Float64Array(CAP);
let projectionN = 0;

function push(buf: Float64Array, count: number, value: number): number {
  buf[count % CAP] = value; return count + 1;
}
function percentile(buf: Float64Array, count: number, p: number): number | null {
  const n = Math.min(count, CAP); if (n === 0) return null;
  const copy = Array.from(buf.subarray(0, n)).sort((a, b) => a - b);
  return copy[Math.min(n - 1, Math.ceil(n * p) - 1)] ?? null;
}

export interface MusicPlaylistCounters {
  created: number;
  renamed: number;
  deleted: number;
  itemAdded: number;
  itemAlreadyPresent: number;
  itemRemoved: number;
  itemAlreadyAbsent: number;
  reordered: number;
  rejectedNoIdentity: number;
  rejectedNotFound: number;
  rejectedNameEmpty: number;
  rejectedPlaylistLimit: number;
  rejectedItemLimit: number;
  persistWriteFailures: number;
  persistLoadRejectedRecords: number;
  unresolvedLocalLookups: number;
}

const counters: MusicPlaylistCounters = {
  created: 0, renamed: 0, deleted: 0, itemAdded: 0, itemAlreadyPresent: 0,
  itemRemoved: 0, itemAlreadyAbsent: 0, reordered: 0,
  rejectedNoIdentity: 0, rejectedNotFound: 0, rejectedNameEmpty: 0,
  rejectedPlaylistLimit: 0, rejectedItemLimit: 0,
  persistWriteFailures: 0, persistLoadRejectedRecords: 0, unresolvedLocalLookups: 0,
};

let lastMutationStatus: PlaylistMutationStatus | null = null;
let lastMutationAtMs: number | null = null;
let lastPlaylistCount: number | null = null;
let lastItemTotal: number | null = null;
let lastLocalItemCount: number | null = null;
let lastProviderItemCount: number | null = null;

export function noteCollectionMutation(status: PlaylistMutationStatus, atMs: number): void {
  switch (status) {
    case 'CREATED': counters.created += 1; break;
    case 'RENAMED': counters.renamed += 1; break;
    case 'DELETED': counters.deleted += 1; break;
    case 'ITEM_ADDED': counters.itemAdded += 1; break;
    case 'ITEM_ALREADY_PRESENT': counters.itemAlreadyPresent += 1; break;
    case 'ITEM_REMOVED': counters.itemRemoved += 1; break;
    case 'ITEM_ALREADY_ABSENT': counters.itemAlreadyAbsent += 1; break;
    case 'REORDERED': counters.reordered += 1; break;
    case 'REJECTED_NO_IDENTITY': counters.rejectedNoIdentity += 1; break;
    case 'REJECTED_NOT_FOUND': counters.rejectedNotFound += 1; break;
    case 'REJECTED_NAME_EMPTY': counters.rejectedNameEmpty += 1; break;
    case 'REJECTED_PLAYLIST_LIMIT': counters.rejectedPlaylistLimit += 1; break;
    case 'REJECTED_ITEM_LIMIT': counters.rejectedItemLimit += 1; break;
    default: break;
  }
  lastMutationStatus = status;
  lastMutationAtMs = Number.isFinite(atMs) ? atMs : null;
}

export function notePersistWriteFailure(): void { counters.persistWriteFailures += 1; }
export function notePersistLoadRejectedRecord(): void { counters.persistLoadRejectedRecords += 1; }
export function noteUnresolvedLocalLookup(): void { counters.unresolvedLocalLookups += 1; }

export function noteProjectionLatency(elapsedMs: number): void {
  if (Number.isFinite(elapsedMs) && elapsedMs >= 0) {
    projectionN = push(projectionMs, projectionN, elapsedMs);
  }
}

export function noteCollectionSize(
  playlistCount: number, itemTotal: number, localItems: number, providerItems: number,
): void {
  lastPlaylistCount = Number.isFinite(playlistCount) ? playlistCount : null;
  lastItemTotal = Number.isFinite(itemTotal) ? itemTotal : null;
  lastLocalItemCount = Number.isFinite(localItems) ? localItems : null;
  lastProviderItemCount = Number.isFinite(providerItems) ? providerItems : null;
}

export interface MusicPlaylistTelemetrySnapshot {
  readonly counters: Readonly<MusicPlaylistCounters>;
  readonly projectionSamples: number;
  readonly projectionP50Ms: number | null;
  readonly projectionP95Ms: number | null;
  readonly lastMutationStatus: PlaylistMutationStatus | null;
  readonly lastMutationAtMs: number | null;
  readonly lastPlaylistCount: number | null;
  readonly lastItemTotal: number | null;
  readonly lastLocalItemCount: number | null;
  readonly lastProviderItemCount: number | null;
}

export function getMusicPlaylistTelemetry(): MusicPlaylistTelemetrySnapshot {
  return Object.freeze({
    counters: Object.freeze({ ...counters }),
    projectionSamples: Math.min(projectionN, CAP),
    projectionP50Ms: percentile(projectionMs, projectionN, 0.5),
    projectionP95Ms: percentile(projectionMs, projectionN, 0.95),
    lastMutationStatus, lastMutationAtMs,
    lastPlaylistCount, lastItemTotal, lastLocalItemCount, lastProviderItemCount,
  });
}

export function _resetMusicPlaylistTelemetryForTest(): void {
  projectionN = 0; projectionMs.fill(0);
  (Object.keys(counters) as (keyof MusicPlaylistCounters)[]).forEach((k) => { counters[k] = 0; });
  lastMutationStatus = null; lastMutationAtMs = null;
  lastPlaylistCount = null; lastItemTotal = null;
  lastLocalItemCount = null; lastProviderItemCount = null;
}
