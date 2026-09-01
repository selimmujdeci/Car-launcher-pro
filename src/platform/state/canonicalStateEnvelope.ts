/** ARCH-02/F1 — read-only state/truth vocabulary; never a state owner. */
import { resolveEvidenceFreshness, type EvidenceFreshness, type EvidenceState } from '../runtime/runtimeObservability';

export type StateClassification =
  | 'OBSERVED' | 'DERIVED' | 'INFERRED' | 'DECLARED'
  | 'CACHED' | 'REPLAYED' | 'IMPORTED' | 'UNKNOWN';

export type StateScopeType =
  | 'PROCESS' | 'BOOT' | 'VEHICLE' | 'VEHICLE_SESSION' | 'OBD_SESSION'
  | 'NAVIGATION_SESSION' | 'MEDIA_SESSION' | 'PHONE_SESSION' | 'MAVI_TURN'
  | 'USER' | 'GLOBAL' | 'UNKNOWN';

export interface StateScope {
  readonly type: StateScopeType;
  readonly id: string | null;
}

export interface CanonicalStateEnvelope<T> {
  readonly value: T;
  readonly classification: StateClassification;
  readonly freshness: EvidenceFreshness;
  readonly provenance: readonly string[];
  readonly scope: StateScope;
  readonly epoch: number | null;
  readonly sessionId: string | null;
  readonly generation: number | null;
  readonly observedAt: number | null;
  readonly sourceRef: string | null;
  readonly evidenceRef: string | null;
  readonly confidence: number | null;
  readonly validity: string | null;
  readonly reason: string | null;
}

export interface StateEnvelopeInput<T> {
  readonly value: T;
  readonly classification: StateClassification;
  readonly provenance: readonly string[];
  readonly scope: StateScope;
  readonly epoch?: number | null;
  readonly expectedEpoch?: number | null;
  readonly expectedScope?: StateScope | null;
  readonly sessionId?: string | null;
  readonly generation?: number | null;
  readonly observedAt?: number | null;
  readonly nowMs: number;
  readonly freshnessWindowMs?: number;
  readonly evidenceState?: EvidenceState;
  /** Only a domain owner's live observation may set this for OBSERVED CURRENT evidence. */
  readonly liveEvidence?: boolean;
  readonly sourceRef?: string | null;
  readonly evidenceRef?: string | null;
  readonly confidence?: number | null;
  readonly validity?: string | null;
  readonly reason?: string | null;
}

function sameScope(a: StateScope, b: StateScope): boolean {
  return a.type === b.type && a.id === b.id;
}

function resolvedFreshness(input: StateEnvelopeInput<unknown>): EvidenceFreshness {
  const epoch = input.epoch ?? null;
  const base = resolveEvidenceFreshness({
    observedAt: input.observedAt ?? null,
    nowMs: input.nowMs,
    lifecycleEpoch: epoch,
    expectedEpoch: input.expectedEpoch,
    freshnessWindowMs: input.freshnessWindowMs,
    evidenceState: input.evidenceState ?? 'OBSERVED',
  });
  if (input.expectedScope && !sameScope(input.scope, input.expectedScope)) return 'STALE';
  if (input.classification === 'CACHED' || input.classification === 'REPLAYED' || input.classification === 'IMPORTED') {
    return base === 'UNAVAILABLE' ? 'UNAVAILABLE' : base === 'UNKNOWN' ? 'UNKNOWN' : 'STALE';
  }
  if (input.classification === 'OBSERVED' && base === 'CURRENT' && input.liveEvidence !== true) return 'UNKNOWN';
  return base;
}

/** Deterministic, immutable projection. It does no I/O and writes no owner state. */
export function createCanonicalStateEnvelope<T>(input: StateEnvelopeInput<T>): CanonicalStateEnvelope<T> {
  return Object.freeze({
    value: input.value,
    classification: input.classification,
    freshness: resolvedFreshness(input),
    provenance: Object.freeze([...input.provenance]),
    scope: Object.freeze({ ...input.scope }),
    epoch: input.epoch ?? null,
    sessionId: input.sessionId ?? null,
    generation: input.generation ?? null,
    observedAt: input.observedAt ?? null,
    sourceRef: input.sourceRef ?? null,
    evidenceRef: input.evidenceRef ?? null,
    confidence: input.confidence ?? null,
    validity: input.validity ?? null,
    reason: input.reason ?? null,
  });
}

/** Persistence is evidence of a cached value, never a fresh live observation. */
export function hydrateState<T>(input: Omit<StateEnvelopeInput<T>, 'classification' | 'liveEvidence'>): CanonicalStateEnvelope<T> {
  return createCanonicalStateEnvelope({ ...input, classification: 'CACHED', liveEvidence: false });
}

export function isLiveTruth<T>(envelope: CanonicalStateEnvelope<T>): boolean {
  return envelope.classification === 'OBSERVED' && envelope.freshness === 'CURRENT';
}
export function isUnknown<T>(envelope: CanonicalStateEnvelope<T>): boolean {
  return envelope.classification === 'UNKNOWN' || envelope.freshness === 'UNKNOWN';
}
export function isUnavailable<T>(envelope: CanonicalStateEnvelope<T>): boolean {
  return envelope.freshness === 'UNAVAILABLE';
}
/** A measured zero remains a value; null/undefined are never transformed into zero. */
export function isMeasuredZero(value: number | null | undefined): boolean { return value === 0; }

export interface DesiredObservedReconciled<TDesired, TObserved, TReconciled> {
  readonly desired: CanonicalStateEnvelope<TDesired> | null;
  readonly observed: CanonicalStateEnvelope<TObserved> | null;
  readonly reconciled: CanonicalStateEnvelope<TReconciled> | null;
}
export function canReconcile<TDesired, TObserved>(state: DesiredObservedReconciled<TDesired, TObserved, unknown>): boolean {
  return state.desired !== null && state.observed !== null;
}

export interface StateProjection<T> {
  readonly kind: 'STATE_PROJECTION';
  readonly sourceRef: string | null;
  readonly envelope: CanonicalStateEnvelope<T>;
}
export function createStateProjection<T>(envelope: CanonicalStateEnvelope<T>): StateProjection<T> {
  return Object.freeze({ kind: 'STATE_PROJECTION' as const, sourceRef: envelope.sourceRef, envelope });
}
