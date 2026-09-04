/**
 * sonicTelemetry.ts — MUSIC F17 · Ses analizi kanıt deposu (bounded, salt gözlem).
 *
 * GİZLİLİK: parça/sanatçı adı · URI · dosya yolu · söz BURAYA GİRMEZ.
 * Yalnız adet, durum kodu, cihaz sınıfı etiketi ve süre tutulur.
 *
 * OTORİTE SINIRI: sayaçlar hiçbir kabul/seçim kararına GERİ BESLENMEZ.
 */

import type { SonicAdmissionDecision, SonicAdmissionReason } from './sonicAdmissionModel';
import type { SonicFailureReason } from './sonicDescriptor';

const CAP = 64;
const analyzeMs = new Float64Array(CAP);
let analyzeN = 0;

function push(buf: Float64Array, count: number, value: number): number {
  buf[count % CAP] = value; return count + 1;
}
function percentile(buf: Float64Array, count: number, p: number): number | null {
  const n = Math.min(count, CAP); if (n === 0) return null;
  const copy = Array.from(buf.subarray(0, n)).sort((a, b) => a - b);
  return copy[Math.min(n - 1, Math.ceil(n * p) - 1)] ?? null;
}

export interface SonicCounters {
  /** Analiz turu istenen · gerçekten açılan. */
  requested: number;
  admitted: number;
  deferred: number;
  bypassed: number;
  /** Tur sonuçları. */
  measured: number;
  failedDecode: number;
  failedUnsupported: number;
  failedTimeout: number;
  failedTooShort: number;
  failedSilent: number;
  cancelled: number;
  /** Ölçüm yapıldı ama betimleyici DOĞRULAMAYI geçemedi (bozuk/eksik alan). */
  rejectedMalformed: number;
  /** Tempo ölçüldü · tepe zayıf olduğu için tempo DÜŞÜRÜLDÜ. */
  tempoAccepted: number;
  tempoRejectedWeak: number;
  /** Önbellek isabet/ıska ve bayat (kuşak değişti) düşürme. */
  cacheHits: number;
  cacheMisses: number;
  cacheStaleDropped: number;
  /** Aynı dosya için tekrar analiz İSTENDİ ama önbellek/işaret ENGELLEDİ. */
  reanalysisPrevented: number;
  /** Eski kuşağın sonucu geldi ve YAZILMADI. */
  staleResultDropped: number;
  /** Native yüzey yok veya çağrı düştü (fail-soft). */
  nativeUnavailable: number;
  nativeErrors: number;
}

const counters: SonicCounters = {
  requested: 0, admitted: 0, deferred: 0, bypassed: 0,
  measured: 0, failedDecode: 0, failedUnsupported: 0, failedTimeout: 0,
  failedTooShort: 0, failedSilent: 0, cancelled: 0, rejectedMalformed: 0,
  tempoAccepted: 0, tempoRejectedWeak: 0,
  cacheHits: 0, cacheMisses: 0, cacheStaleDropped: 0,
  reanalysisPrevented: 0, staleResultDropped: 0,
  nativeUnavailable: 0, nativeErrors: 0,
};

let lastDecision: SonicAdmissionDecision | null = null;
let lastReason: SonicAdmissionReason | null = null;
let lastBatchSize: number | null = null;
let lastFailure: SonicFailureReason | null = null;
let lastTier: string | null = null;
let lastAtMs: number | null = null;

export function noteSonicAdmission(input: {
  readonly decision: SonicAdmissionDecision;
  readonly reason: SonicAdmissionReason;
  readonly batchSize: number;
  readonly tier: string | null;
  readonly atMs: number;
}): void {
  counters.requested += 1;
  switch (input.decision) {
    case 'ADMIT': counters.admitted += 1; break;
    case 'DEFER': counters.deferred += 1; break;
    default: counters.bypassed += 1; break;
  }
  if (input.reason === 'NATIVE_UNAVAILABLE') counters.nativeUnavailable += 1;
  lastDecision = input.decision;
  lastReason = input.reason;
  lastBatchSize = input.batchSize;
  lastTier = input.tier;
  lastAtMs = Number.isFinite(input.atMs) ? input.atMs : null;
}

export function noteSonicMeasured(tempoAccepted: boolean): void {
  counters.measured += 1;
  if (tempoAccepted) counters.tempoAccepted += 1; else counters.tempoRejectedWeak += 1;
}

export function noteSonicFailure(reason: SonicFailureReason): void {
  lastFailure = reason;
  switch (reason) {
    case 'UNSUPPORTED_CODEC': case 'NO_AUDIO_TRACK': counters.failedUnsupported += 1; break;
    case 'TIMEOUT': counters.failedTimeout += 1; break;
    case 'TOO_SHORT': counters.failedTooShort += 1; break;
    case 'SILENT': counters.failedSilent += 1; break;
    case 'CANCELLED': counters.cancelled += 1; break;
    default: counters.failedDecode += 1; break;
  }
}

export function noteSonicMalformed(): void { counters.rejectedMalformed += 1; }
export function noteSonicCache(hit: boolean): void {
  if (hit) counters.cacheHits += 1; else counters.cacheMisses += 1;
}
export function noteSonicStaleDropped(): void { counters.cacheStaleDropped += 1; }
export function noteSonicReanalysisPrevented(): void { counters.reanalysisPrevented += 1; }
export function noteSonicStaleResultDropped(): void { counters.staleResultDropped += 1; }
export function noteSonicNativeError(): void { counters.nativeErrors += 1; }

export function noteSonicRunDuration(elapsedMs: number): void {
  if (Number.isFinite(elapsedMs) && elapsedMs >= 0) {
    analyzeN = push(analyzeMs, analyzeN, elapsedMs);
  }
}

export interface SonicTelemetrySnapshot {
  readonly counters: Readonly<SonicCounters>;
  readonly samples: number;
  readonly runP50Ms: number | null;
  readonly runP95Ms: number | null;
  readonly lastDecision: SonicAdmissionDecision | null;
  readonly lastReason: SonicAdmissionReason | null;
  readonly lastBatchSize: number | null;
  readonly lastFailure: SonicFailureReason | null;
  readonly lastTier: string | null;
  readonly lastAtMs: number | null;
}

export function getSonicTelemetry(): SonicTelemetrySnapshot {
  return Object.freeze({
    counters: Object.freeze({ ...counters }),
    samples: Math.min(analyzeN, CAP),
    runP50Ms: percentile(analyzeMs, analyzeN, 0.5),
    runP95Ms: percentile(analyzeMs, analyzeN, 0.95),
    lastDecision, lastReason, lastBatchSize, lastFailure, lastTier, lastAtMs,
  });
}

export function _resetSonicTelemetryForTest(): void {
  analyzeN = 0; analyzeMs.fill(0);
  (Object.keys(counters) as (keyof SonicCounters)[]).forEach((k) => { counters[k] = 0; });
  lastDecision = null; lastReason = null; lastBatchSize = null;
  lastFailure = null; lastTier = null; lastAtMs = null;
}
