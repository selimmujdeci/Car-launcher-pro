/**
 * loudnessTelemetry.ts — MUSIC F19 · Seviye kanıt deposu (bounded, salt gözlem).
 *
 * GİZLİLİK: parça/sanatçı adı · URI BURAYA GİRMEZ. Yalnız adet, kaynak
 * ETİKETİ ve sayısal seviye tutulur.
 *
 * OTORİTE SINIRI: sayaçlar hiçbir ses kararına GERİ BESLENMEZ.
 */

import type { LoudnessProvenance } from './loudnessEvidence';

const CAP = 64;
const applyMs = new Float64Array(CAP);
let applyN = 0;

function push(buf: Float64Array, count: number, value: number): number {
  buf[count % CAP] = value; return count + 1;
}
function percentile(buf: Float64Array, count: number, p: number): number | null {
  const n = Math.min(count, CAP); if (n === 0) return null;
  const copy = Array.from(buf.subarray(0, n)).sort((a, b) => a - b);
  return copy[Math.min(n - 1, Math.ceil(n * p) - 1)] ?? null;
}

export interface LoudnessCounters {
  /** Değerlendirilen parça geçişi. */
  evaluated: number;
  /** Kanıt kökeni. */
  evidenceReplayGain: number;
  evidenceR128: number;
  evidenceMeasured: number;
  evidenceNone: number;
  /** Çarpan gerçekten uygulandı · nötr bırakıldı. */
  applied: number;
  neutral: number;
  /** Nötr bırakma nedenleri. */
  bypassNoEvidence: number;
  bypassBelowThreshold: number;
  bypassBoostUnsupported: number;
  /** Kısma tavana takıldı (kanıt aşırı). */
  clamped: number;
  /** Çarpan DEĞİŞMEDİĞİ için native'e yazılmadı (gereksiz yazım yok). */
  unchangedSkipped: number;
  /** Gateway'e yazım düştü (fail-soft). */
  applyFailures: number;
}

const counters: LoudnessCounters = {
  evaluated: 0,
  evidenceReplayGain: 0, evidenceR128: 0, evidenceMeasured: 0, evidenceNone: 0,
  applied: 0, neutral: 0,
  bypassNoEvidence: 0, bypassBelowThreshold: 0, bypassBoostUnsupported: 0,
  clamped: 0, unchangedSkipped: 0, applyFailures: 0,
};

let lastProvenance: LoudnessProvenance | null = null;
let lastFactor: number | null = null;
let lastAppliedDb: number | null = null;
let lastRequestedDb: number | null = null;
let lastBypass: string | null = null;
let lastAtMs: number | null = null;

export function noteLoudnessDecision(input: {
  readonly provenance: LoudnessProvenance;
  readonly factor: number;
  readonly appliedDb: number;
  readonly requestedDb: number | null;
  readonly clamped: boolean;
  readonly bypassReason: string | null;
  readonly elapsedMs: number;
  readonly atMs: number;
}): void {
  counters.evaluated += 1;
  switch (input.provenance) {
    case 'TAG_REPLAYGAIN': counters.evidenceReplayGain += 1; break;
    case 'TAG_R128': counters.evidenceR128 += 1; break;
    case 'MEASURED_RMS': counters.evidenceMeasured += 1; break;
    default: counters.evidenceNone += 1; break;
  }
  if (input.bypassReason === null) counters.applied += 1;
  else {
    counters.neutral += 1;
    if (input.bypassReason === 'NO_EVIDENCE') counters.bypassNoEvidence += 1;
    else if (input.bypassReason === 'BELOW_THRESHOLD') counters.bypassBelowThreshold += 1;
    else if (input.bypassReason === 'BOOST_NOT_SUPPORTED') counters.bypassBoostUnsupported += 1;
  }
  if (input.clamped) counters.clamped += 1;
  if (Number.isFinite(input.elapsedMs) && input.elapsedMs >= 0) {
    applyN = push(applyMs, applyN, input.elapsedMs);
  }
  lastProvenance = input.provenance;
  lastFactor = input.factor;
  lastAppliedDb = input.appliedDb;
  lastRequestedDb = input.requestedDb;
  lastBypass = input.bypassReason;
  lastAtMs = Number.isFinite(input.atMs) ? input.atMs : null;
}

export function noteLoudnessUnchanged(): void { counters.unchangedSkipped += 1; }
export function noteLoudnessApplyFailure(): void { counters.applyFailures += 1; }

export interface LoudnessTelemetrySnapshot {
  readonly counters: Readonly<LoudnessCounters>;
  readonly samples: number;
  readonly applyP50Ms: number | null;
  readonly applyP95Ms: number | null;
  readonly lastProvenance: LoudnessProvenance | null;
  readonly lastFactor: number | null;
  readonly lastAppliedDb: number | null;
  readonly lastRequestedDb: number | null;
  readonly lastBypass: string | null;
  readonly lastAtMs: number | null;
}

export function getLoudnessTelemetry(): LoudnessTelemetrySnapshot {
  return Object.freeze({
    counters: Object.freeze({ ...counters }),
    samples: Math.min(applyN, CAP),
    applyP50Ms: percentile(applyMs, applyN, 0.5),
    applyP95Ms: percentile(applyMs, applyN, 0.95),
    lastProvenance, lastFactor, lastAppliedDb, lastRequestedDb, lastBypass, lastAtMs,
  });
}

export function _resetLoudnessTelemetryForTest(): void {
  applyN = 0; applyMs.fill(0);
  (Object.keys(counters) as (keyof LoudnessCounters)[]).forEach((k) => { counters[k] = 0; });
  lastProvenance = null; lastFactor = null; lastAppliedDb = null;
  lastRequestedDb = null; lastBypass = null; lastAtMs = null;
}
