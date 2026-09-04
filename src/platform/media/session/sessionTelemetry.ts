/**
 * sessionTelemetry.ts — F3.2 · Dinleme bağlamının BOUNDED kanıt deposu.
 *
 * CLAUDE.md gözlemlenebilirlik kuralı: "gözlemlenemeyen özellik tamamlanmış
 * değildir." Bu modül CAROS LAB'ın okuyacağı sınırlı, salt-okunur özeti üretir.
 *
 * GİZLİLİK (kural 6): parça başlığı · sanatçı · albüm · URI · kapak · öğe
 * kimliği BURAYA GİRMEZ. Yalnız SAYI, durum kodu, derece ve süre tutulur.
 *
 * DÜRÜSTLÜK (kural 5): ölçülmemiş alan `null` kalır — sahte 0 üretilmez.
 *
 * OTORİTE SINIRI: burada hesaplanan hiçbir değer üretim kararına GERİ BESLENMEZ;
 * bu bir sayaç deposudur, ikinci bir gerçek kaynağı değildir.
 *
 * Bellek: sabit alanlar + sabit boyutlu halka — sınırsız büyüme YOK.
 */
import type { QueueAlignment } from '../authority/queueReconciliation';
import type { IdentityMatchGrade } from './mediaIdentityMatching';
import type { ContinuityState } from './sessionContinuity';
import type { SourceClass } from '../authority/sourceCapabilities';
import type {
  ObservedQueueAvailability, ObservedQueueCompleteness,
  ObservedQueueEvidence, ObservedQueueProvenance,
} from './observedQueueEvidence';

/** Saklanan en fazla devir kaydı — bounded. */
export const MAX_HANDOVER_RECORDS = 20;

export interface F3Counters {
  /* Gözlenen kuyruk kanıtı */
  observedPublished: number;
  observedAvailable: number;
  observedUnavailable: number;
  observedRejected: number;
  observedStaleReads: number;
  /* Hizalama (desired ↔ observed) */
  alignMatched: number;
  alignPrefix: number;
  alignDrift: number;
  alignUnsupported: number;
  alignUnknown: number;
  /* Süreklilik */
  continuityCarried: number;
  continuityDegraded: number;
  continuityBroken: number;
  continuityUnknown: number;
  /* Devir */
  handoverRequested: number;
  handoverVerified: number;
  handoverUnverified: number;
  handoverFailed: number;
  handoverRollback: number;
  /* Oturum commit kapısı */
  sessionCommitted: number;
  commitStaleDropped: number;
  commitDuplicateDropped: number;
  commitRejected: number;
  /* F4 · Kuyruk komut kapısı (UI'dan gelen atlama/çıkarma/sıralama) */
  queueCommandApplied: number;
  queueCommandRejected: number;
}

const EMPTY_COUNTERS = (): F3Counters => ({
  observedPublished: 0, observedAvailable: 0, observedUnavailable: 0,
  observedRejected: 0, observedStaleReads: 0,
  alignMatched: 0, alignPrefix: 0, alignDrift: 0, alignUnsupported: 0, alignUnknown: 0,
  continuityCarried: 0, continuityDegraded: 0, continuityBroken: 0, continuityUnknown: 0,
  handoverRequested: 0, handoverVerified: 0, handoverUnverified: 0,
  handoverFailed: 0, handoverRollback: 0,
  sessionCommitted: 0, commitStaleDropped: 0, commitDuplicateDropped: 0, commitRejected: 0,
  queueCommandApplied: 0, queueCommandRejected: 0,
});

export interface ObservedTelemetry {
  readonly source: SourceClass | null;
  readonly provenance: ObservedQueueProvenance;
  readonly availability: ObservedQueueAvailability;
  readonly completeness: ObservedQueueCompleteness;
  readonly entryCount: number;
  readonly hasCurrentIndex: boolean;
  readonly revision: number | null;
  readonly observedAtMs: number;
  readonly unavailableReason: string | null;
}

/** Devir izi — PII YOK: yalnız kaynak sınıfı, sonuç ve süre. */
export interface HandoverRecord {
  readonly token: string;
  readonly target: SourceClass;
  readonly continuity: ContinuityState;
  readonly outcome: 'REQUESTED' | 'VERIFIED' | 'UNVERIFIED' | 'FAILED' | 'ROLLBACK';
  readonly committed: boolean;
  readonly failureCode: string | null;
  readonly elapsedMs: number | null;
  readonly atMs: number;
}

const _counters: F3Counters = EMPTY_COUNTERS();
const _handovers: HandoverRecord[] = [];

let _lastObserved: ObservedTelemetry | null = null;
let _lastAlignment: QueueAlignment | null = null;
let _lastFulfillmentGrade: 'AVAILABLE' | 'UNAVAILABLE' | null = null;
let _lastIdentityFidelity: IdentityMatchGrade | null = null;
let _lastContinuity: ContinuityState | null = null;
let _lastCommitAtMs: number | null = null;
let _lastDropReason: string | null = null;

/* ── Yazma kapıları (hepsi fail-soft: kanıt yazımı akışı ASLA bozmaz) ────── */

export function noteObservedEvidence(e: ObservedQueueEvidence): void {
  try {
    _counters.observedPublished += 1;
    if (e.availability === 'AVAILABLE') _counters.observedAvailable += 1;
    else _counters.observedUnavailable += 1;
    _lastObserved = Object.freeze({
      source: e.source,
      provenance: e.provenance,
      availability: e.availability,
      completeness: e.completeness,
      entryCount: e.entries.length,
      hasCurrentIndex: e.currentIndex !== null,
      revision: e.revision,
      observedAtMs: e.observedAtMs,
      unavailableReason: e.unavailableReason,
    });
  } catch { /* fail-soft */ }
}

export function noteObservedRejected(): void { _counters.observedRejected += 1; }
export function noteObservedStaleRead(): void { _counters.observedStaleReads += 1; }

export function noteAlignment(alignment: QueueAlignment): void {
  try {
    _lastAlignment = alignment;
    switch (alignment) {
      case 'MATCHED':        _counters.alignMatched += 1; break;
      case 'PREFIX_MATCH':   _counters.alignPrefix += 1; break;
      case 'PROVIDER_DRIFT': _counters.alignDrift += 1; break;
      case 'UNSUPPORTED':    _counters.alignUnsupported += 1; break;
      default:               _counters.alignUnknown += 1; break;
    }
  } catch { /* fail-soft */ }
}

export function noteFulfillment(available: boolean): void {
  _lastFulfillmentGrade = available ? 'AVAILABLE' : 'UNAVAILABLE';
}

/** Devirde taşınan öğelerin EN DÜŞÜK kanıt derecesi — zayıf halka görünür olur. */
export function noteIdentityFidelity(grade: IdentityMatchGrade | null): void {
  _lastIdentityFidelity = grade;
}

export function noteContinuityState(state: ContinuityState): void {
  try {
    _lastContinuity = state;
    switch (state) {
      case 'CARRIED':  _counters.continuityCarried += 1; break;
      case 'DEGRADED': _counters.continuityDegraded += 1; break;
      case 'BROKEN':   _counters.continuityBroken += 1; break;
      case 'UNKNOWN':  _counters.continuityUnknown += 1; break;
      default: break;
    }
  } catch { /* fail-soft */ }
}

export function noteHandover(record: HandoverRecord): void {
  try {
    switch (record.outcome) {
      case 'REQUESTED':  _counters.handoverRequested += 1; break;
      case 'VERIFIED':   _counters.handoverVerified += 1; break;
      case 'UNVERIFIED': _counters.handoverUnverified += 1; break;
      case 'FAILED':     _counters.handoverFailed += 1; break;
      case 'ROLLBACK':   _counters.handoverRollback += 1; break;
      default: break;
    }
    _handovers.push(Object.freeze({ ...record }));
    while (_handovers.length > MAX_HANDOVER_RECORDS) _handovers.shift();
  } catch { /* fail-soft */ }
}

/**
 * F4 · Kuyruk komutu sonucu. Yetenek yokluğu nedeniyle REDDEDİLEN komut da
 * kaydedilir: sessizce yutulan istek teşhis edilemez bir kayıptır.
 */
export function noteQueueCommand(applied: boolean): void {
  if (applied) _counters.queueCommandApplied += 1;
  else _counters.queueCommandRejected += 1;
}

export function noteSessionCommitted(atMs: number): void {
  _counters.sessionCommitted += 1;
  _lastCommitAtMs = atMs;
}

/** Commit kapısında düşen sonuç — hangi kapıda düştüğü TEŞHİStir, gizlenmez. */
export function noteCommitDropped(
  kind: 'STALE' | 'DUPLICATE' | 'REJECTED', reason: string,
): void {
  if (kind === 'STALE') _counters.commitStaleDropped += 1;
  else if (kind === 'DUPLICATE') _counters.commitDuplicateDropped += 1;
  else _counters.commitRejected += 1;
  _lastDropReason = `${kind}:${reason}`;
}

/* ── Okuma ───────────────────────────────────────────────────────────────── */

export interface F3TelemetrySnapshot {
  /** OBSERVED = en az bir kanıt yayını oldu; UNAVAILABLE = hiç veri YOK. */
  readonly status: 'OBSERVED' | 'UNAVAILABLE';
  readonly counters: Readonly<F3Counters>;
  readonly lastObserved: ObservedTelemetry | null;
  readonly lastAlignment: QueueAlignment | null;
  readonly lastFulfillment: 'AVAILABLE' | 'UNAVAILABLE' | null;
  readonly lastIdentityFidelity: IdentityMatchGrade | null;
  readonly lastContinuity: ContinuityState | null;
  readonly lastCommitAtMs: number | null;
  readonly lastDropReason: string | null;
  readonly recentHandovers: readonly HandoverRecord[];
  readonly handoverCapacity: number;
}

export function getF3TelemetrySnapshot(): F3TelemetrySnapshot {
  return Object.freeze({
    status: _counters.observedPublished > 0 || _counters.handoverRequested > 0
      ? 'OBSERVED' as const : 'UNAVAILABLE' as const,
    counters: { ..._counters },
    lastObserved: _lastObserved,
    lastAlignment: _lastAlignment,
    lastFulfillment: _lastFulfillmentGrade,
    lastIdentityFidelity: _lastIdentityFidelity,
    lastContinuity: _lastContinuity,
    lastCommitAtMs: _lastCommitAtMs,
    lastDropReason: _lastDropReason,
    recentHandovers: _handovers.slice(),
    handoverCapacity: MAX_HANDOVER_RECORDS,
  });
}

export function _resetF3TelemetryForTest(): void {
  Object.assign(_counters, EMPTY_COUNTERS());
  _handovers.length = 0;
  _lastObserved = null;
  _lastAlignment = null;
  _lastFulfillmentGrade = null;
  _lastIdentityFidelity = null;
  _lastContinuity = null;
  _lastCommitAtMs = null;
  _lastDropReason = null;
}
