/**
 * musicCollectionTelemetry.ts — MUSIC F13 · Kanıt deposu (bounded, salt gözlem).
 *
 * GİZLİLİK (CLAUDE.md gözlemlenebilirlik kuralı 6): parça adı · sanatçı ·
 * URI · sesli komut metni BURAYA GİRMEZ. Yalnız sayaç, tür dağılımı ve
 * bounded gecikme örneklemi tutulur.
 *
 * OTORİTE SINIRI: sayaçlar hiçbir karara GERİ BESLENMEZ; LAB salt-okunur
 * gösterim için `getMusicCollectionTelemetry()`yi okur, asla yazmaz.
 */

import type { FavoriteMutationStatus } from './musicCollectionEntry';

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

export interface MusicCollectionCounters {
  added: number;
  removed: number;
  toggled: number;
  alreadyPresent: number;
  alreadyAbsent: number;
  rejectedNoIdentity: number;
  rejectedCollectionFull: number;
  persistWriteFailures: number;
  persistLoadRejectedRecords: number;
  migrationDrops: number;
  unresolvedLocalLookups: number;
}

const counters: MusicCollectionCounters = {
  added: 0, removed: 0, toggled: 0, alreadyPresent: 0, alreadyAbsent: 0,
  rejectedNoIdentity: 0, rejectedCollectionFull: 0, persistWriteFailures: 0,
  persistLoadRejectedRecords: 0, migrationDrops: 0, unresolvedLocalLookups: 0,
};

let lastMutationStatus: FavoriteMutationStatus | null = null;
let lastMutationAtMs: number | null = null;
let lastLocalCount: number | null = null;
let lastProviderCount: number | null = null;

export function noteCollectionMutation(status: FavoriteMutationStatus, atMs: number): void {
  switch (status) {
    case 'ADDED': counters.added += 1; break;
    case 'REMOVED': counters.removed += 1; break;
    case 'ALREADY_PRESENT': counters.alreadyPresent += 1; break;
    case 'ALREADY_ABSENT': counters.alreadyAbsent += 1; break;
    case 'REJECTED_NO_IDENTITY': counters.rejectedNoIdentity += 1; break;
    case 'REJECTED_COLLECTION_FULL': counters.rejectedCollectionFull += 1; break;
    default: break;
  }
  lastMutationStatus = status;
  lastMutationAtMs = Number.isFinite(atMs) ? atMs : null;
}

export function noteCollectionToggle(): void { counters.toggled += 1; }
export function notePersistWriteFailure(): void { counters.persistWriteFailures += 1; }
export function notePersistLoadRejectedRecord(): void { counters.persistLoadRejectedRecords += 1; }
export function noteMigrationDrop(): void { counters.migrationDrops += 1; }
export function noteUnresolvedLocalLookup(): void { counters.unresolvedLocalLookups += 1; }

export function noteProjectionLatency(elapsedMs: number): void {
  if (Number.isFinite(elapsedMs) && elapsedMs >= 0) {
    projectionN = push(projectionMs, projectionN, elapsedMs);
  }
}

export function noteCollectionSize(localCount: number, providerCount: number): void {
  lastLocalCount = Number.isFinite(localCount) ? localCount : null;
  lastProviderCount = Number.isFinite(providerCount) ? providerCount : null;
}

export interface MusicCollectionTelemetrySnapshot {
  readonly counters: Readonly<MusicCollectionCounters>;
  readonly projectionSamples: number;
  readonly projectionP50Ms: number | null;
  readonly projectionP95Ms: number | null;
  readonly lastMutationStatus: FavoriteMutationStatus | null;
  readonly lastMutationAtMs: number | null;
  readonly lastLocalCount: number | null;
  readonly lastProviderCount: number | null;
}

export function getMusicCollectionTelemetry(): MusicCollectionTelemetrySnapshot {
  return Object.freeze({
    counters: Object.freeze({ ...counters }),
    projectionSamples: Math.min(projectionN, CAP),
    projectionP50Ms: percentile(projectionMs, projectionN, 0.5),
    projectionP95Ms: percentile(projectionMs, projectionN, 0.95),
    lastMutationStatus, lastMutationAtMs, lastLocalCount, lastProviderCount,
  });
}

export function _resetMusicCollectionTelemetryForTest(): void {
  projectionN = 0; projectionMs.fill(0);
  (Object.keys(counters) as (keyof MusicCollectionCounters)[]).forEach((k) => { counters[k] = 0; });
  lastMutationStatus = null; lastMutationAtMs = null;
  lastLocalCount = null; lastProviderCount = null;
}
