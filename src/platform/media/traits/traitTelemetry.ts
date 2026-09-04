/**
 * traitTelemetry.ts — MUSIC F10 · Kanıt deposu (bounded, salt gözlem).
 *
 * GİZLİLİK: parça/sanatçı adı · sorgu · konuşma · URI · konum BURAYA GİRMEZ.
 * Yalnız adet, provenance/güven ETİKETİ, durum kodu ve süre tutulur.
 *
 * OTORİTE SINIRI: sayaçlar hiçbir seçime GERİ BESLENMEZ.
 */

import type { TraitConfidence, TraitProvenance } from './musicTraitEvidence';
import type { TraitDirection, TraitSelectionStatus } from './traitSelectionModel';

const CAP = 64;
const selectMs = new Float64Array(CAP);
let selectN = 0;

function push(buf: Float64Array, count: number, value: number): number {
  buf[count % CAP] = value; return count + 1;
}
function percentile(buf: Float64Array, count: number, p: number): number | null {
  const n = Math.min(count, CAP); if (n === 0) return null;
  const copy = Array.from(buf.subarray(0, n)).sort((a, b) => a - b);
  return copy[Math.min(n - 1, Math.ceil(n * p) - 1)] ?? null;
}

export interface TraitCounters {
  requests: number;
  selected: number;
  noReference: number;
  noEvidence: number;
  noCandidate: number;
  /** Kanıt üretimi: gerçek ölçüm · türetilmiş · sezgisel · hiç. */
  /** MUSIC F17 — sesin KENDİSİNDEN ölçülen kanıt (`MEASURED_AUDIO`). */
  evidenceMeasured: number;
  evidenceProvider: number;
  /**
   * MUSIC F17 denetimi — GERÇEK KUSUR: `EMBEDDED_METADATA` (F10.1 gömülü BPM)
   * switch'te hiç YOKTU ve `evidenceNone`a düşüyordu; LAB "kanıt yok" diye
   * SAYIYORDU. Kendi sütunu artık var.
   */
  evidenceEmbedded: number;
  evidenceLibrary: number;
  evidenceDuration: number;
  evidenceHeuristic: number;
  evidenceNone: number;
  /** Kanıt zayıf olduğu için TEMKİNLİ dil kurulan istek adedi. */
  tentativeClaims: number;
  /** Kesin dil kurulan istek adedi (yalnız MEDIUM+ güven). */
  confidentClaims: number;
  /** Önbellek isabet/ıska — düşük-uçta maliyetin görünür ölçüsü. */
  cacheHits: number;
  cacheMisses: number;
  /** İddia ↔ kanıt uyuşmazlığı (olmamalı; >0 ise ARIZA). */
  claimMismatch: number;
}

const counters: TraitCounters = {
  requests: 0, selected: 0, noReference: 0, noEvidence: 0, noCandidate: 0,
  evidenceMeasured: 0, evidenceProvider: 0, evidenceEmbedded: 0,
  evidenceLibrary: 0, evidenceDuration: 0,
  evidenceHeuristic: 0, evidenceNone: 0,
  tentativeClaims: 0, confidentClaims: 0,
  cacheHits: 0, cacheMisses: 0, claimMismatch: 0,
};

let lastDirection: TraitDirection | null = null;
let lastStatus: TraitSelectionStatus | null = null;
let lastConfidence: TraitConfidence | null = null;
let lastProvenance: string | null = null;
let lastReferenceProvenance: TraitProvenance | null = null;
let lastConsidered: number | null = null;
let lastRejectedNoEvidence: number | null = null;
let lastRejectedWrongDirection: number | null = null;
let lastReasonCode: string | null = null;
let lastAtMs: number | null = null;

export function noteTraitEvidenceProduced(p: TraitProvenance): void {
  switch (p) {
    case 'MEASURED_AUDIO': counters.evidenceMeasured += 1; break;
    case 'PROVIDER_METADATA': counters.evidenceProvider += 1; break;
    case 'EMBEDDED_METADATA': counters.evidenceEmbedded += 1; break;
    case 'LIBRARY_METADATA': counters.evidenceLibrary += 1; break;
    case 'DERIVED_DURATION': counters.evidenceDuration += 1; break;
    case 'HEURISTIC_TEXT': counters.evidenceHeuristic += 1; break;
    default: counters.evidenceNone += 1; break;
  }
}

export function noteTraitCache(hit: boolean): void {
  if (hit) counters.cacheHits += 1; else counters.cacheMisses += 1;
}

export function noteTraitSelection(input: {
  readonly direction: TraitDirection;
  readonly status: TraitSelectionStatus;
  readonly confidence: TraitConfidence;
  readonly reasonCode: string;
  readonly selectedProvenance: string | null;
  readonly referenceProvenance: TraitProvenance | null;
  readonly consideredCount: number;
  readonly rejectedNoEvidence: number;
  readonly rejectedWrongDirection: number;
  readonly confidentClaim: boolean;
  readonly elapsedMs: number;
  readonly atMs: number;
}): void {
  counters.requests += 1;
  switch (input.status) {
    case 'SELECTED': counters.selected += 1; break;
    case 'NO_REFERENCE': counters.noReference += 1; break;
    case 'NO_EVIDENCE': counters.noEvidence += 1; break;
    default: counters.noCandidate += 1; break;
  }
  if (input.status === 'SELECTED') {
    if (input.confidentClaim) counters.confidentClaims += 1;
    else counters.tentativeClaims += 1;
  }
  if (Number.isFinite(input.elapsedMs) && input.elapsedMs >= 0) {
    selectN = push(selectMs, selectN, input.elapsedMs);
  }
  lastDirection = input.direction;
  lastStatus = input.status;
  lastConfidence = input.confidence;
  lastProvenance = input.selectedProvenance;
  lastReferenceProvenance = input.referenceProvenance;
  lastConsidered = input.consideredCount;
  lastRejectedNoEvidence = input.rejectedNoEvidence;
  lastRejectedWrongDirection = input.rejectedWrongDirection;
  lastReasonCode = input.reasonCode;
  lastAtMs = Number.isFinite(input.atMs) ? input.atMs : null;
}

export function noteTraitClaimMismatch(): void { counters.claimMismatch += 1; }

export interface TraitTelemetrySnapshot {
  readonly counters: Readonly<TraitCounters>;
  readonly samples: number;
  readonly selectP50Ms: number | null;
  readonly selectP95Ms: number | null;
  readonly lastDirection: TraitDirection | null;
  readonly lastStatus: TraitSelectionStatus | null;
  readonly lastConfidence: TraitConfidence | null;
  readonly lastProvenance: string | null;
  readonly lastReferenceProvenance: TraitProvenance | null;
  readonly lastConsidered: number | null;
  readonly lastRejectedNoEvidence: number | null;
  readonly lastRejectedWrongDirection: number | null;
  readonly lastReasonCode: string | null;
  readonly lastAtMs: number | null;
}

export function getTraitTelemetry(): TraitTelemetrySnapshot {
  return Object.freeze({
    counters: Object.freeze({ ...counters }),
    samples: Math.min(selectN, CAP),
    selectP50Ms: percentile(selectMs, selectN, 0.5),
    selectP95Ms: percentile(selectMs, selectN, 0.95),
    lastDirection, lastStatus, lastConfidence, lastProvenance, lastReferenceProvenance,
    lastConsidered, lastRejectedNoEvidence, lastRejectedWrongDirection,
    lastReasonCode, lastAtMs,
  });
}

export function _resetTraitTelemetryForTest(): void {
  selectN = 0; selectMs.fill(0);
  (Object.keys(counters) as (keyof TraitCounters)[]).forEach((k) => { counters[k] = 0; });
  lastDirection = null; lastStatus = null; lastConfidence = null;
  lastProvenance = null; lastReferenceProvenance = null;
  lastConsidered = null; lastRejectedNoEvidence = null;
  lastRejectedWrongDirection = null; lastReasonCode = null; lastAtMs = null;
}
