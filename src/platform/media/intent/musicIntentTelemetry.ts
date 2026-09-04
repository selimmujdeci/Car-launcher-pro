/**
 * musicIntentTelemetry.ts — MUSIC F9 · Kanıt deposu (bounded, salt gözlem).
 *
 * GİZLİLİK (CLAUDE.md gözlemlenebilirlik kuralı 6): **söylenen metin BURAYA
 * GİRMEZ.** Sorgu · parça adı · sanatçı · transkript taşınmaz; yalnız niyet
 * TÜRÜ, rota, durum kodu, adet ve süre tutulur.
 *
 * OTORİTE SINIRI: sayaçlar hiçbir karara GERİ BESLENMEZ.
 * DÜRÜSTLÜK: ölçülmemiş alan `null` kalır — sahte 0 üretilmez.
 */

import type {
  MusicIntentKind, MusicIntentRoute, MusicIntentStatus, SpokenClaimGrade,
} from './musicIntent';

const CAP = 64;
const resolveMs = new Float64Array(CAP);
const dispatchMs = new Float64Array(CAP);
let resolveN = 0;
let dispatchN = 0;

function push(buf: Float64Array, count: number, value: number): number {
  buf[count % CAP] = value; return count + 1;
}
function percentile(buf: Float64Array, count: number, p: number): number | null {
  const n = Math.min(count, CAP); if (n === 0) return null;
  const copy = Array.from(buf.subarray(0, n)).sort((a, b) => a - b);
  return copy[Math.min(n - 1, Math.ceil(n * p) - 1)] ?? null;
}

export interface MusicIntentCounters {
  resolved: number;
  unresolved: number;
  dispatched: number;
  verified: number;
  acceptedUnverified: number;
  ambiguous: number;
  rejected: number;
  unavailable: number;
  failed: number;
  notAttempted: number;
  /** Kullanıcı açıkça kaynak söylediği istek adedi. */
  sourceQualified: number;
  /** Açık kaynakta sonuç çıkmadığı için SESSİZ geçiş YAPILMAYAN istek adedi. */
  sourceHeld: number;
  contextualRequests: number;
  contextualFulfilled: number;
  contextualNoEvidence: number;
  queueCommands: number;
  queueUnsupported: number;
  /** Bayat/eski turun sonucunun iddiaya dönüşmesi engellenen durum adedi. */
  staleDrops: number;
  /** İddia ↔ kanıt uyuşmazlığı (olmamalı; >0 ise ARIZA). */
  claimMismatch: number;
}

const counters: MusicIntentCounters = {
  resolved: 0, unresolved: 0, dispatched: 0, verified: 0, acceptedUnverified: 0,
  ambiguous: 0, rejected: 0, unavailable: 0, failed: 0, notAttempted: 0,
  sourceQualified: 0, sourceHeld: 0, contextualRequests: 0, contextualFulfilled: 0,
  contextualNoEvidence: 0, queueCommands: 0, queueUnsupported: 0,
  staleDrops: 0, claimMismatch: 0,
};

let lastKind: MusicIntentKind | null = null;
let lastRoute: MusicIntentRoute | null = null;
let lastStatus: MusicIntentStatus | null = null;
let lastClaim: SpokenClaimGrade | null = null;
let lastReasonCode: string | null = null;
let lastSourcePreference: string | null = null;
let lastUsedContextEvidence: boolean | null = null;
let lastAtMs: number | null = null;

export function noteIntentResolved(kind: MusicIntentKind | null, elapsedMs: number): void {
  if (kind === null) { counters.unresolved += 1; } else { counters.resolved += 1; lastKind = kind; }
  if (Number.isFinite(elapsedMs) && elapsedMs >= 0) {
    resolveN = push(resolveMs, resolveN, elapsedMs);
  }
}

export function noteIntentOutcome(input: {
  readonly kind: MusicIntentKind;
  readonly route: MusicIntentRoute;
  readonly status: MusicIntentStatus;
  readonly claim: SpokenClaimGrade;
  readonly reasonCode: string;
  readonly sourcePreference: string | null;
  readonly usedContextEvidence: boolean;
  readonly elapsedMs: number;
  readonly atMs: number;
}): void {
  counters.dispatched += 1;
  switch (input.status) {
    case 'VERIFIED': counters.verified += 1; break;
    case 'ACCEPTED_UNVERIFIED': counters.acceptedUnverified += 1; break;
    case 'AMBIGUOUS': counters.ambiguous += 1; break;
    case 'REJECTED': counters.rejected += 1; break;
    case 'UNAVAILABLE': counters.unavailable += 1; break;
    case 'FAILED': counters.failed += 1; break;
    default: counters.notAttempted += 1; break;
  }
  if (input.sourcePreference !== null) counters.sourceQualified += 1;
  if (Number.isFinite(input.elapsedMs) && input.elapsedMs >= 0) {
    dispatchN = push(dispatchMs, dispatchN, input.elapsedMs);
  }
  lastKind = input.kind;
  lastRoute = input.route;
  lastStatus = input.status;
  lastClaim = input.claim;
  lastReasonCode = input.reasonCode;
  lastSourcePreference = input.sourcePreference;
  lastUsedContextEvidence = input.usedContextEvidence;
  lastAtMs = Number.isFinite(input.atMs) ? input.atMs : null;
}

export function noteSourceHeld(): void { counters.sourceHeld += 1; }
export function noteContextualRequest(fulfilled: boolean, hadEvidence: boolean): void {
  counters.contextualRequests += 1;
  if (fulfilled) counters.contextualFulfilled += 1;
  if (!hadEvidence) counters.contextualNoEvidence += 1;
}
export function noteQueueCommand(supported: boolean): void {
  counters.queueCommands += 1;
  if (!supported) counters.queueUnsupported += 1;
}
export function noteStaleIntentDrop(): void { counters.staleDrops += 1; }
export function noteClaimMismatch(): void { counters.claimMismatch += 1; }

export interface MusicIntentTelemetrySnapshot {
  readonly counters: Readonly<MusicIntentCounters>;
  readonly resolveSamples: number;
  readonly dispatchSamples: number;
  readonly resolveP50Ms: number | null;
  readonly resolveP95Ms: number | null;
  readonly dispatchP50Ms: number | null;
  readonly dispatchP95Ms: number | null;
  readonly lastKind: MusicIntentKind | null;
  readonly lastRoute: MusicIntentRoute | null;
  readonly lastStatus: MusicIntentStatus | null;
  readonly lastClaim: SpokenClaimGrade | null;
  readonly lastReasonCode: string | null;
  readonly lastSourcePreference: string | null;
  readonly lastUsedContextEvidence: boolean | null;
  readonly lastAtMs: number | null;
}

export function getMusicIntentTelemetry(): MusicIntentTelemetrySnapshot {
  return Object.freeze({
    counters: Object.freeze({ ...counters }),
    resolveSamples: Math.min(resolveN, CAP),
    dispatchSamples: Math.min(dispatchN, CAP),
    resolveP50Ms: percentile(resolveMs, resolveN, 0.5),
    resolveP95Ms: percentile(resolveMs, resolveN, 0.95),
    dispatchP50Ms: percentile(dispatchMs, dispatchN, 0.5),
    dispatchP95Ms: percentile(dispatchMs, dispatchN, 0.95),
    lastKind, lastRoute, lastStatus, lastClaim, lastReasonCode,
    lastSourcePreference, lastUsedContextEvidence, lastAtMs,
  });
}

export function _resetMusicIntentTelemetryForTest(): void {
  resolveN = 0; dispatchN = 0;
  resolveMs.fill(0); dispatchMs.fill(0);
  (Object.keys(counters) as (keyof MusicIntentCounters)[]).forEach((k) => { counters[k] = 0; });
  lastKind = null; lastRoute = null; lastStatus = null; lastClaim = null;
  lastReasonCode = null; lastSourcePreference = null;
  lastUsedContextEvidence = null; lastAtMs = null;
}
