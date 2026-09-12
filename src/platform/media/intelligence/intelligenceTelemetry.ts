/**
 * intelligenceTelemetry.ts — MUSIC F8 · Kanıt deposu (bounded, salt gözlem).
 *
 * GİZLİLİK: parça/albüm/sanatçı adı · sorgu · konum · sağlayıcı içerik kimliği
 * BURAYA GİRMEZ. Yalnız adet, durum kodu ve süre tutulur.
 *
 * OTORİTE SINIRI: sayaçlar hiçbir karara GERİ BESLENMEZ; `musicIntelligenceModel`
 * bu modülü görmez. LAB bunu okur, karar üretmez.
 *
 * DÜRÜSTLÜK: ölçülmemiş alan `null` kalır — sahte 0 üretilmez. Host (jsdom /
 * geliştirme makinesi) süresi CİHAZ performansı DEĞİLDİR.
 */

import type { IntelligenceAction, IntelligenceReason } from './musicIntelligenceModel';

const CAP = 64;
const decideMs = new Float64Array(CAP);
let decideN = 0;

function push(buf: Float64Array, count: number, value: number): number {
  buf[count % CAP] = value; return count + 1;
}
function percentile(buf: Float64Array, count: number, p: number): number | null {
  const n = Math.min(count, CAP); if (n === 0) return null;
  const copy = Array.from(buf.subarray(0, n)).sort((a, b) => a - b);
  return copy[Math.min(n - 1, Math.ceil(n * p) - 1)] ?? null;
}

export interface IntelligenceCounters {
  evaluations: number;
  hold: number;
  suggest: number;
  autoResume: number;
  /** Otomatik/önerilen eylemin kullanıcı tarafından uygulanma adedi. */
  applied: number;
  applyFailed: number;
  /** Açık kullanıcı niyeti nedeniyle susulan değerlendirme adedi. */
  explicitOverrides: number;
  /** Kanıt yazımı (STARTED · KEPT · ABANDONED). */
  notedStarted: number;
  notedKept: number;
  notedAbandoned: number;
  /** Bağlamı bilinmediği için YAZILMAYAN gözlem adedi. */
  droppedUnknownBucket: number;
}

const counters: IntelligenceCounters = {
  evaluations: 0, hold: 0, suggest: 0, autoResume: 0,
  applied: 0, applyFailed: 0, explicitOverrides: 0,
  notedStarted: 0, notedKept: 0, notedAbandoned: 0, droppedUnknownBucket: 0,
};

let lastAction: IntelligenceAction | null = null;
let lastReason: IntelligenceReason | null = null;
let lastSuppressed: readonly IntelligenceReason[] = Object.freeze([]);
let lastBucket: string | null = null;
let lastDecidedAtMs: number | null = null;

export function noteIntelligenceDecision(input: {
  readonly action: IntelligenceAction;
  readonly reason: IntelligenceReason;
  readonly suppressedBy: readonly IntelligenceReason[];
  readonly bucket: string;
  readonly elapsedMs: number;
  readonly atMs: number;
}): void {
  counters.evaluations += 1;
  if (input.action === 'HOLD') counters.hold += 1;
  else if (input.action === 'SUGGEST') counters.suggest += 1;
  else counters.autoResume += 1;
  if (input.reason === 'explicit_user_intent') counters.explicitOverrides += 1;

  if (Number.isFinite(input.elapsedMs) && input.elapsedMs >= 0) {
    decideN = push(decideMs, decideN, input.elapsedMs);
  }
  lastAction = input.action;
  lastReason = input.reason;
  lastSuppressed = Object.freeze([...input.suppressedBy]);
  lastBucket = input.bucket;
  lastDecidedAtMs = Number.isFinite(input.atMs) ? input.atMs : null;
}

export function noteIntelligenceApplied(ok: boolean): void {
  if (ok) counters.applied += 1; else counters.applyFailed += 1;
}

export function noteIntelligenceObservation(
  outcome: 'STARTED' | 'KEPT' | 'ABANDONED' | 'DROPPED_UNKNOWN',
): void {
  if (outcome === 'STARTED') counters.notedStarted += 1;
  else if (outcome === 'KEPT') counters.notedKept += 1;
  else if (outcome === 'ABANDONED') counters.notedAbandoned += 1;
  else counters.droppedUnknownBucket += 1;
}

export interface IntelligenceTelemetrySnapshot {
  readonly counters: Readonly<IntelligenceCounters>;
  readonly samples: number;
  readonly decideP50Ms: number | null;
  readonly decideP95Ms: number | null;
  readonly lastAction: IntelligenceAction | null;
  readonly lastReason: IntelligenceReason | null;
  readonly lastSuppressed: readonly IntelligenceReason[];
  readonly lastBucket: string | null;
  readonly lastDecidedAtMs: number | null;
}

export function getIntelligenceTelemetry(): IntelligenceTelemetrySnapshot {
  return Object.freeze({
    counters: Object.freeze({ ...counters }),
    samples: Math.min(decideN, CAP),
    decideP50Ms: percentile(decideMs, decideN, 0.5),
    decideP95Ms: percentile(decideMs, decideN, 0.95),
    lastAction,
    lastReason,
    lastSuppressed,
    lastBucket,
    lastDecidedAtMs,
  });
}

export function _resetIntelligenceTelemetryForTest(): void {
  decideN = 0;
  decideMs.fill(0);
  (Object.keys(counters) as (keyof IntelligenceCounters)[]).forEach((k) => { counters[k] = 0; });
  lastAction = null; lastReason = null; lastSuppressed = Object.freeze([]);
  lastBucket = null; lastDecidedAtMs = null;
}
