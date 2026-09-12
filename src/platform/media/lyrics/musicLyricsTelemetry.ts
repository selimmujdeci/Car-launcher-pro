/**
 * musicLyricsTelemetry.ts — MUSIC F16 · Kanıt deposu (bounded, salt gözlem).
 *
 * GİZLİLİK (CLAUDE.md gözlemlenebilirlik kuralı 6): şarkı sözü metni ·
 * satırlar · transcript · sorgu BURAYA GİRMEZ. Yalnız sayaç, kaynak sınıfı
 * ve bounded gecikme örneklemi tutulur.
 *
 * OTORİTE SINIRI: sayaçlar hiçbir karara GERİ BESLENMEZ; LAB salt-okunur
 * gösterim için `getMusicLyricsTelemetry()`yi okur, asla yazmaz.
 */

import type { LyricsFormat, LyricsProvenanceSource } from './musicLyricsEntry';

const CAP = 64;
const syncProjectionMs = new Float64Array(CAP);
let syncProjectionN = 0;

function push(buf: Float64Array, count: number, value: number): number {
  buf[count % CAP] = value; return count + 1;
}
function percentile(buf: Float64Array, count: number, p: number): number | null {
  const n = Math.min(count, CAP); if (n === 0) return null;
  const copy = Array.from(buf.subarray(0, n)).sort((a, b) => a - b);
  return copy[Math.min(n - 1, Math.ceil(n * p) - 1)] ?? null;
}

export interface MusicLyricsCounters {
  resolvedAvailablePlain: number;
  resolvedAvailableSynced: number;
  resolvedUnavailable: number;
  resolvedUnknown: number;
  cacheHits: number;
  cacheMisses: number;
  cacheStaleDropped: number;
  identityMismatchRejected: number;
  parseFailures: number;
  /** SYLT MPEG-frame formatı gibi tahmini zamanlama İSTENDİĞİ AMA reddedildiği sayısı. */
  fakeSyncPrevented: number;
  persistWriteFailures: number;
  persistLoadRejectedRecords: number;
}

const counters: MusicLyricsCounters = {
  resolvedAvailablePlain: 0, resolvedAvailableSynced: 0, resolvedUnavailable: 0, resolvedUnknown: 0,
  cacheHits: 0, cacheMisses: 0, cacheStaleDropped: 0, identityMismatchRejected: 0,
  parseFailures: 0, fakeSyncPrevented: 0, persistWriteFailures: 0, persistLoadRejectedRecords: 0,
};

let lastFormat: LyricsFormat | null = null;
let lastSource: LyricsProvenanceSource | null = null;
let lastAtMs: number | null = null;

export function noteResolved(format: LyricsFormat | null, source: LyricsProvenanceSource, atMs: number): void {
  if (format === 'SYNCED') counters.resolvedAvailableSynced += 1;
  else if (format === 'PLAIN') counters.resolvedAvailablePlain += 1;
  else counters.resolvedUnavailable += 1;
  lastFormat = format;
  lastSource = source;
  lastAtMs = Number.isFinite(atMs) ? atMs : null;
}

export function noteUnknown(): void { counters.resolvedUnknown += 1; }
export function noteCacheHit(): void { counters.cacheHits += 1; }
export function noteCacheMiss(): void { counters.cacheMisses += 1; }
export function noteCacheStaleDropped(): void { counters.cacheStaleDropped += 1; }
export function noteIdentityMismatchRejected(): void { counters.identityMismatchRejected += 1; }
export function noteParseFailure(): void { counters.parseFailures += 1; }
export function noteFakeSyncPrevented(): void { counters.fakeSyncPrevented += 1; }
export function notePersistWriteFailure(): void { counters.persistWriteFailures += 1; }
export function notePersistLoadRejectedRecord(): void { counters.persistLoadRejectedRecords += 1; }

export function noteSyncProjectionLatency(elapsedMs: number): void {
  if (Number.isFinite(elapsedMs) && elapsedMs >= 0) {
    syncProjectionN = push(syncProjectionMs, syncProjectionN, elapsedMs);
  }
}

export interface MusicLyricsTelemetrySnapshot {
  readonly counters: Readonly<MusicLyricsCounters>;
  readonly syncProjectionSamples: number;
  readonly syncProjectionP50Ms: number | null;
  readonly syncProjectionP95Ms: number | null;
  readonly lastFormat: LyricsFormat | null;
  readonly lastSource: LyricsProvenanceSource | null;
  readonly lastAtMs: number | null;
}

export function getMusicLyricsTelemetry(): MusicLyricsTelemetrySnapshot {
  return Object.freeze({
    counters: Object.freeze({ ...counters }),
    syncProjectionSamples: Math.min(syncProjectionN, CAP),
    syncProjectionP50Ms: percentile(syncProjectionMs, syncProjectionN, 0.5),
    syncProjectionP95Ms: percentile(syncProjectionMs, syncProjectionN, 0.95),
    lastFormat, lastSource, lastAtMs,
  });
}

export function _resetMusicLyricsTelemetryForTest(): void {
  syncProjectionN = 0; syncProjectionMs.fill(0);
  (Object.keys(counters) as (keyof MusicLyricsCounters)[]).forEach((k) => { counters[k] = 0; });
  lastFormat = null; lastSource = null; lastAtMs = null;
}
