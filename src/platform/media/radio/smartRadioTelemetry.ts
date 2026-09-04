/**
 * smartRadioTelemetry.ts — MUSIC F18 · Akış kanıt deposu (bounded, salt gözlem).
 *
 * GİZLİLİK: parça/sanatçı adı · URI · sorgu · konum BURAYA GİRMEZ.
 * Yalnız adet, durum kodu, iddia SINIFI ve süre tutulur.
 *
 * OTORİTE SINIRI: sayaçlar hiçbir sıralama kararına GERİ BESLENMEZ.
 */

import type {
  RadioClaimClass, RadioSeedKind, RadioStatus,
} from './smartRadioModel';

const CAP = 64;
const planMs = new Float64Array(CAP);
let planN = 0;

function push(buf: Float64Array, count: number, value: number): number {
  buf[count % CAP] = value; return count + 1;
}
function percentile(buf: Float64Array, count: number, p: number): number | null {
  const n = Math.min(count, CAP); if (n === 0) return null;
  const copy = Array.from(buf.subarray(0, n)).sort((a, b) => a - b);
  return copy[Math.min(n - 1, Math.ceil(n * p) - 1)] ?? null;
}

export interface SmartRadioCounters {
  requests: number;
  planned: number;
  noCandidate: number;
  emptyLibrary: number;
  /** İddia sınıfı dağılımı — "sana özel" iddiasının ne sıklıkta hak edildiği. */
  claimMeasured: number;
  claimWeak: number;
  claimFallback: number;
  /** Yürütme: mevcut kuyruğa eklendi · yeni dinleme başlatıldı · reddedildi. */
  appended: number;
  started: number;
  executionRejected: number;
  /** Kaynak kuyruğu desteklemediği için ekleme yapılamadı (F7.6 sınırı). */
  queueUnsupported: number;
  /** Açık kullanıcı niyeti akışı ezdi — otomatik sıralama uygulanmadı. */
  explicitIntentDeferred: number;
  /** Tekrar azaltma: elenen · havuz yetmediği için geri alınan. */
  recentExcluded: number;
  recentReadmitted: number;
  /** Aynı sanatçının arka arkaya gelmemesi için kaydırılan öğe. */
  artistSpacing: number;
}

const counters: SmartRadioCounters = {
  requests: 0, planned: 0, noCandidate: 0, emptyLibrary: 0,
  claimMeasured: 0, claimWeak: 0, claimFallback: 0,
  appended: 0, started: 0, executionRejected: 0, queueUnsupported: 0,
  explicitIntentDeferred: 0, recentExcluded: 0, recentReadmitted: 0, artistSpacing: 0,
};

let lastStatus: RadioStatus | null = null;
let lastClaim: RadioClaimClass | null = null;
let lastSeed: RadioSeedKind | null = null;
let lastLength: number | null = null;
let lastMeasured: number | null = null;
let lastReasonCode: string | null = null;
let lastAtMs: number | null = null;

export function noteRadioPlan(input: {
  readonly status: RadioStatus;
  readonly claimClass: RadioClaimClass;
  readonly seedKind: RadioSeedKind;
  readonly length: number;
  readonly measuredCount: number;
  readonly excludedRecent: number;
  readonly recentReadmitted: number;
  readonly artistSpacingApplied: number;
  readonly reasonCode: string;
  readonly elapsedMs: number;
  readonly atMs: number;
}): void {
  counters.requests += 1;
  switch (input.status) {
    case 'READY': counters.planned += 1; break;
    case 'EMPTY_LIBRARY': counters.emptyLibrary += 1; break;
    default: counters.noCandidate += 1; break;
  }
  if (input.status === 'READY') {
    if (input.claimClass === 'MEASURED') counters.claimMeasured += 1;
    else if (input.claimClass === 'WEAK') counters.claimWeak += 1;
    else counters.claimFallback += 1;
  }
  counters.recentExcluded += input.excludedRecent;
  counters.recentReadmitted += input.recentReadmitted;
  counters.artistSpacing += input.artistSpacingApplied;
  if (Number.isFinite(input.elapsedMs) && input.elapsedMs >= 0) {
    planN = push(planMs, planN, input.elapsedMs);
  }
  lastStatus = input.status;
  lastClaim = input.claimClass;
  lastSeed = input.seedKind;
  lastLength = input.length;
  lastMeasured = input.measuredCount;
  lastReasonCode = input.reasonCode;
  lastAtMs = Number.isFinite(input.atMs) ? input.atMs : null;
}

export function noteRadioExecution(kind: 'APPENDED' | 'STARTED' | 'REJECTED'): void {
  if (kind === 'APPENDED') counters.appended += 1;
  else if (kind === 'STARTED') counters.started += 1;
  else counters.executionRejected += 1;
}

export function noteRadioQueueUnsupported(): void { counters.queueUnsupported += 1; }
export function noteRadioExplicitDeferred(): void { counters.explicitIntentDeferred += 1; }

export interface SmartRadioTelemetrySnapshot {
  readonly counters: Readonly<SmartRadioCounters>;
  readonly samples: number;
  readonly planP50Ms: number | null;
  readonly planP95Ms: number | null;
  readonly lastStatus: RadioStatus | null;
  readonly lastClaim: RadioClaimClass | null;
  readonly lastSeed: RadioSeedKind | null;
  readonly lastLength: number | null;
  readonly lastMeasured: number | null;
  readonly lastReasonCode: string | null;
  readonly lastAtMs: number | null;
}

export function getSmartRadioTelemetry(): SmartRadioTelemetrySnapshot {
  return Object.freeze({
    counters: Object.freeze({ ...counters }),
    samples: Math.min(planN, CAP),
    planP50Ms: percentile(planMs, planN, 0.5),
    planP95Ms: percentile(planMs, planN, 0.95),
    lastStatus, lastClaim, lastSeed, lastLength, lastMeasured, lastReasonCode, lastAtMs,
  });
}

export function _resetSmartRadioTelemetryForTest(): void {
  planN = 0; planMs.fill(0);
  (Object.keys(counters) as (keyof SmartRadioCounters)[]).forEach((k) => { counters[k] = 0; });
  lastStatus = null; lastClaim = null; lastSeed = null;
  lastLength = null; lastMeasured = null; lastReasonCode = null; lastAtMs = null;
}
