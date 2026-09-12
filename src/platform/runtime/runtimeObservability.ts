/** ARCH-01/F8 — canonical, read-only observability projection. */
import type { LifecycleHealth, LifecycleReadiness, LifecycleState, RuntimeServiceDescriptor } from './lifecycleContract';
import type { RuntimeRegistryEntry } from './runtimeServiceRegistry';
import type { RuntimeDependencyGraph } from './runtimeDependencyGraph';
import type { ReadinessBlockerResult } from './runtimeReadinessBlocker';
import type { RuntimeFaultContainmentSnapshot } from './runtimeFaultContainment';
import type { RuntimeRecoverySnapshot } from './runtimeRecoverySupervisor';
import type { ShutdownRunSnapshot } from './runtimeShutdownEvidence';
import type { ResourceEvidenceSnapshot } from './runtimeResourceEvidence';

export type RuntimeEvidenceKind = 'LIFECYCLE' | 'READINESS' | 'HEALTH' | 'DEPENDENCY' | 'FAULT' | 'RECOVERY' | 'SHUTDOWN' | 'RESOURCE' | 'UNKNOWN';
export type EvidenceFreshness = 'CURRENT' | 'STALE' | 'UNAVAILABLE' | 'UNKNOWN';
export type EvidenceState = 'OBSERVED' | 'UNAVAILABLE' | 'UNKNOWN';
export type ContradictionStatus = 'CONSISTENT' | 'CONTRADICTORY' | 'INSUFFICIENT_EVIDENCE' | 'STALE_EVIDENCE' | 'UNKNOWN';

export interface RuntimeEvidenceEnvelope<TPayload = unknown> {
  readonly evidenceId: string;
  readonly serviceId: string;
  readonly lifecycleDomain: string;
  readonly kind: RuntimeEvidenceKind;
  readonly lifecycleEpoch: number | null;
  readonly operationId: string | null;
  readonly runRef: string | null;
  readonly observedAt: number | null;
  readonly freshness: EvidenceFreshness;
  readonly provenance: readonly string[];
  readonly sourceAuthority: string;
  readonly evidenceState: EvidenceState;
  readonly correlationRefs: readonly string[];
  readonly typedPayload: TPayload;
}

export interface EvidenceEnvelopeInput<TPayload> {
  readonly serviceId: string;
  readonly lifecycleDomain: string;
  readonly kind: RuntimeEvidenceKind;
  readonly lifecycleEpoch: number | null;
  readonly expectedEpoch?: number | null;
  readonly operationId?: string | null;
  readonly runRef?: string | null;
  readonly observedAt: number | null;
  readonly nowMs: number;
  readonly freshnessWindowMs?: number;
  readonly provenance: readonly string[];
  readonly sourceAuthority: string;
  readonly evidenceState: EvidenceState;
  readonly correlationRefs?: readonly string[];
  readonly typedPayload: TPayload;
}

/** Pure freshness decision; missing time is never CURRENT. */
export function resolveEvidenceFreshness(input: Pick<EvidenceEnvelopeInput<unknown>, 'observedAt' | 'nowMs' | 'lifecycleEpoch' | 'expectedEpoch' | 'evidenceState'> & { readonly freshnessWindowMs?: number }): EvidenceFreshness {
  if (input.evidenceState === 'UNAVAILABLE') return 'UNAVAILABLE';
  if (input.lifecycleEpoch !== null && input.expectedEpoch !== undefined && input.expectedEpoch !== null && input.lifecycleEpoch !== input.expectedEpoch) return 'STALE';
  if (input.observedAt === null || !Number.isFinite(input.observedAt)) return 'UNKNOWN';
  const age = input.nowMs - input.observedAt;
  if (!Number.isFinite(age) || age < 0) return 'UNKNOWN';
  return age > (input.freshnessWindowMs ?? 60_000) ? 'STALE' : 'CURRENT';
}

/** Deterministic id; no randomness and no wall-clock generation. */
export function createRuntimeEvidenceEnvelope<TPayload>(input: EvidenceEnvelopeInput<TPayload>): RuntimeEvidenceEnvelope<TPayload> {
  const operationId = input.operationId ?? null;
  const runRef = input.runRef ?? null;
  const epoch = input.lifecycleEpoch === null ? 'UNKNOWN' : String(input.lifecycleEpoch);
  const evidenceId = [input.serviceId, input.kind, epoch, operationId ?? 'NONE', runRef ?? 'NONE'].join('|');
  return Object.freeze({
    evidenceId,
    serviceId: input.serviceId,
    lifecycleDomain: input.lifecycleDomain,
    kind: input.kind,
    lifecycleEpoch: input.lifecycleEpoch,
    operationId,
    runRef,
    observedAt: input.observedAt,
    freshness: resolveEvidenceFreshness(input),
    provenance: Object.freeze([...input.provenance]),
    sourceAuthority: input.sourceAuthority,
    evidenceState: input.evidenceState,
    correlationRefs: Object.freeze([...(input.correlationRefs ?? [])]),
    typedPayload: input.typedPayload,
  });
}

export interface ObservabilityServiceRow {
  readonly serviceId: string;
  readonly lifecycle: LifecycleState;
  readonly readiness: LifecycleReadiness;
  readonly health: LifecycleHealth;
  readonly freshness: EvidenceFreshness;
  readonly evidenceKinds: readonly RuntimeEvidenceKind[];
  readonly lifecycleEpoch: number | null;
  readonly correlationRefs: readonly string[];
  readonly contradictions: readonly ContradictionFinding[];
  readonly provenance: readonly string[];
}

export interface ContradictionFinding {
  readonly serviceId: string;
  readonly rule: string;
  readonly status: ContradictionStatus;
  readonly involvedEvidenceRefs: readonly string[];
  readonly reason: string;
  readonly freshness: EvidenceFreshness;
}

export interface RuntimeObservabilitySnapshot {
  readonly evidence: readonly RuntimeEvidenceEnvelope[];
  readonly services: readonly ObservabilityServiceRow[];
  readonly contradictions: readonly ContradictionFinding[];
  readonly system: {
    readonly evidenceCount: number;
    readonly evidenceKinds: readonly RuntimeEvidenceKind[];
    readonly freshness: Readonly<Record<EvidenceFreshness, number>>;
    readonly activeRecovery: boolean | null;
    readonly activeShutdown: boolean | null;
    readonly resourcePressure: 'PRESENT' | 'ABSENT' | 'UNKNOWN';
  };
  readonly summary: Readonly<Record<'ready' | 'degraded' | 'blocked' | 'failed' | 'unknown' | 'stale', number>>;
}

export interface RuntimeObservabilityInput {
  readonly entries: readonly RuntimeRegistryEntry[];
  readonly graph: RuntimeDependencyGraph;
  readonly blockers: readonly ReadinessBlockerResult[];
  readonly faultContainment: RuntimeFaultContainmentSnapshot;
  readonly recovery: RuntimeRecoverySnapshot;
  readonly shutdown: ShutdownRunSnapshot;
  readonly resources: ResourceEvidenceSnapshot;
  readonly nowMs: number;
}

export interface RuntimeContradictionContext {
  readonly shutdownComplete?: boolean;
  readonly recoveryActive?: boolean;
  readonly resourceFreshness?: EvidenceFreshness;
  readonly resourceHealthyClaim?: boolean;
}

function envelopeFor<T>(service: RuntimeServiceDescriptor, kind: RuntimeEvidenceKind, payload: T, provenance: readonly string[], input: RuntimeObservabilityInput, refs: readonly string[] = []): RuntimeEvidenceEnvelope<T> {
  return createRuntimeEvidenceEnvelope({ serviceId: service.id, lifecycleDomain: service.lifecycleDomain, kind, lifecycleEpoch: null, observedAt: null, nowMs: input.nowMs, provenance, sourceAuthority: 'runtimeServiceRegistry', evidenceState: 'OBSERVED', correlationRefs: refs, typedPayload: payload });
}

function stateFreshness(entry: RuntimeRegistryEntry): EvidenceFreshness {
  return entry.lifecycle === 'UNKNOWN' || entry.readiness === 'UNKNOWN' || entry.health === 'UNKNOWN' ? 'UNKNOWN' : 'UNKNOWN';
}

/** Pure projection of F1–F7 evidence; it never mutates any authority. */
export function buildRuntimeObservabilitySnapshot(input: RuntimeObservabilityInput): RuntimeObservabilitySnapshot {
  const evidence: RuntimeEvidenceEnvelope[] = [];
  for (const entry of [...input.entries].sort((a, b) => a.descriptor.id.localeCompare(b.descriptor.id))) {
    evidence.push(envelopeFor(entry.descriptor, 'LIFECYCLE', entry.lifecycle, entry.provenance, input));
    evidence.push(envelopeFor(entry.descriptor, 'READINESS', entry.readiness, entry.provenance, input));
    evidence.push(envelopeFor(entry.descriptor, 'HEALTH', entry.health, entry.provenance, input));
  }
  evidence.push(createRuntimeEvidenceEnvelope({ serviceId: 'runtime', lifecycleDomain: 'APP_PROCESS', kind: 'DEPENDENCY', lifecycleEpoch: null, observedAt: null, nowMs: input.nowMs, provenance: ['runtimeDependencyGraph'], sourceAuthority: 'runtimeDependencyGraph', evidenceState: 'OBSERVED', typedPayload: input.graph }));
  evidence.push(createRuntimeEvidenceEnvelope({ serviceId: 'runtime', lifecycleDomain: 'APP_PROCESS', kind: 'FAULT', lifecycleEpoch: null, observedAt: null, nowMs: input.nowMs, provenance: ['runtimeFaultContainment'], sourceAuthority: 'runtimeFaultContainment', evidenceState: 'OBSERVED', typedPayload: input.faultContainment }));
  evidence.push(createRuntimeEvidenceEnvelope({ serviceId: 'runtime', lifecycleDomain: 'APP_PROCESS', kind: 'RECOVERY', lifecycleEpoch: null, observedAt: null, nowMs: input.nowMs, provenance: ['RuntimeRecoverySupervisor.snapshot()'], sourceAuthority: 'RuntimeRecoverySupervisor', evidenceState: 'OBSERVED', correlationRefs: input.recovery.evidence.map((x) => x.request.requestId), typedPayload: input.recovery }));
  evidence.push(createRuntimeEvidenceEnvelope({ serviceId: 'runtime', lifecycleDomain: 'APP_PROCESS', kind: 'SHUTDOWN', lifecycleEpoch: input.shutdown.lifecycleEpoch, runRef: input.shutdown.runId, observedAt: input.shutdown.startedAt, nowMs: input.nowMs, provenance: ['getSystemBootShutdownSnapshot()'], sourceAuthority: 'SystemBoot', evidenceState: input.shutdown.runId ? 'OBSERVED' : 'UNAVAILABLE', correlationRefs: input.shutdown.runId ? [input.shutdown.runId] : [], typedPayload: input.shutdown }));
  evidence.push(createRuntimeEvidenceEnvelope({ serviceId: 'runtime', lifecycleDomain: 'APP_PROCESS', kind: 'RESOURCE', lifecycleEpoch: null, observedAt: null, nowMs: input.nowMs, provenance: input.resources.provenance, sourceAuthority: 'AdaptiveRuntimeManager', evidenceState: 'OBSERVED', correlationRefs: input.resources.tasks.map((x) => x.taskId), typedPayload: input.resources }));

  const blockerById = new Map(input.blockers.map((x) => [x.serviceId, x]));
  const contradictions = detectRuntimeContradictions(input.entries.map((entry) => ({ serviceId: entry.descriptor.id, lifecycle: entry.lifecycle, readiness: blockerById.get(entry.descriptor.id)?.readiness ?? entry.readiness, health: entry.health, freshness: stateFreshness(entry), evidenceRefs: entry.provenance, activeWorker: input.resources.workers.some((worker) => worker.key === entry.descriptor.id && worker.status === 'active'), activeEvidence: entry.registeredBySystemBoot && entry.lifecycle === 'READY' })), { shutdownComplete: input.shutdown.finishedAt !== null && input.shutdown.outcome !== 'UNKNOWN', recoveryActive: input.recovery.evidence.some((x) => x.executionStarted && x.executionOutcome === 'NOT_RUN'), resourceFreshness: input.resources.provenance.length ? 'UNKNOWN' : 'UNAVAILABLE', resourceHealthyClaim: false });
  const services = input.entries.map((entry) => {
    const refs = evidence.filter((x) => x.serviceId === entry.descriptor.id).map((x) => x.evidenceId);
    const own = contradictions.filter((x) => x.serviceId === entry.descriptor.id);
    return Object.freeze({ serviceId: entry.descriptor.id, lifecycle: entry.lifecycle, readiness: blockerById.get(entry.descriptor.id)?.readiness ?? entry.readiness, health: entry.health, freshness: stateFreshness(entry), evidenceKinds: Object.freeze(['LIFECYCLE', 'READINESS', 'HEALTH'] as RuntimeEvidenceKind[]), lifecycleEpoch: null, correlationRefs: Object.freeze(refs), contradictions: Object.freeze(own), provenance: Object.freeze(entry.provenance) });
  }).sort((a, b) => a.serviceId.localeCompare(b.serviceId));
  const freshness = { CURRENT: 0, STALE: 0, UNAVAILABLE: 0, UNKNOWN: evidence.length } as Record<EvidenceFreshness, number>;
  const summary = { ready: 0, degraded: 0, blocked: 0, failed: 0, unknown: 0, stale: 0 } as Record<'ready' | 'degraded' | 'blocked' | 'failed' | 'unknown' | 'stale', number>;
  for (const row of services) { if (row.readiness === 'READY') summary.ready++; if (row.readiness === 'DEGRADED') summary.degraded++; if (row.lifecycle === 'BLOCKED') summary.blocked++; if (row.health === 'FAILED') summary.failed++; if (row.freshness === 'STALE') summary.stale++; if (row.freshness === 'UNKNOWN' || row.readiness === 'UNKNOWN' || row.health === 'UNKNOWN') summary.unknown++; }
  return Object.freeze({ evidence: Object.freeze(evidence), services: Object.freeze(services), contradictions: Object.freeze(contradictions), system: Object.freeze({ evidenceCount: evidence.length, evidenceKinds: Object.freeze([...new Set(evidence.map((x) => x.kind))].sort()), freshness: Object.freeze(freshness), activeRecovery: input.recovery.evidence.some((x) => x.executionOutcome === 'NOT_RUN' && x.executionStarted), activeShutdown: input.shutdown.runId !== null && input.shutdown.finishedAt === null, resourcePressure: 'UNKNOWN' }), summary: Object.freeze(summary) });
}

export function detectRuntimeContradictions(rows: readonly Readonly<{ serviceId: string; lifecycle: LifecycleState; readiness: LifecycleReadiness; health: LifecycleHealth; freshness: EvidenceFreshness; evidenceRefs: readonly string[]; activeWorker?: boolean; activeEvidence?: boolean; }>[], context: RuntimeContradictionContext = {}): readonly ContradictionFinding[] {
  const out: ContradictionFinding[] = [];
  const addGlobal = (rule: string, reason: string, freshness: EvidenceFreshness, refs: readonly string[]): void => {
    out.push(Object.freeze({ serviceId: 'runtime', rule, status: freshness === 'STALE' ? 'STALE_EVIDENCE' : freshness === 'UNKNOWN' ? 'INSUFFICIENT_EVIDENCE' : 'CONTRADICTORY', involvedEvidenceRefs: Object.freeze([...refs]), reason, freshness }));
  };
  if (context.shutdownComplete && context.recoveryActive) addGlobal('SHUTDOWN_COMPLETE_RECOVERY_ACTIVE', 'Completed shutdown cannot have active recovery execution.', 'CURRENT', ['shutdown', 'recovery']);
  if (context.resourceFreshness === 'UNKNOWN' && context.resourceHealthyClaim === true) addGlobal('UNKNOWN_RESOURCE_NORMAL', 'Unknown resource evidence cannot support a healthy/normal claim.', 'UNKNOWN', ['resource']);
  for (const row of rows) {
    const add = (rule: string, reason: string): void => {
      out.push(Object.freeze({ serviceId: row.serviceId, rule, status: row.freshness === 'STALE' ? 'STALE_EVIDENCE' : row.freshness === 'UNKNOWN' ? 'INSUFFICIENT_EVIDENCE' : 'CONTRADICTORY', involvedEvidenceRefs: Object.freeze([...row.evidenceRefs]), reason, freshness: row.freshness }));
    };
    if (row.lifecycle === 'STOPPED' && row.readiness === 'READY') add('STOPPED_READY', 'Stopped lifecycle cannot carry READY readiness.');
    if (row.lifecycle === 'DISPOSED' && row.health === 'HEALTHY') add('DISPOSED_HEALTHY', 'Disposed service cannot claim healthy active operation.');
    if (row.lifecycle === 'DISPOSED' && row.activeWorker === true) add('DISPOSED_ACTIVE_WORKER', 'Disposed service cannot retain an active worker.');
    if (row.health === 'FAILED' && row.readiness === 'READY') add('FAILED_READY', 'Failed health cannot be presented as current READY evidence.');
    if (row.lifecycle === 'UNREGISTERED' && row.activeEvidence === true) add('UNREGISTERED_ACTIVE_EVIDENCE', 'Unregistered service cannot expose active runtime evidence.');
  }
  return Object.freeze(out);
}

/** Bounded deterministic retention helper; latest observed evidence wins. */
export function retainRuntimeEvidence(envelopes: readonly RuntimeEvidenceEnvelope[], maxPerServiceKind = 4): readonly RuntimeEvidenceEnvelope[] {
  const groups = new Map<string, RuntimeEvidenceEnvelope[]>();
  for (const envelope of envelopes) { const key = `${envelope.serviceId}|${envelope.kind}`; const list = groups.get(key) ?? []; list.push(envelope); groups.set(key, list); }
  const kept: RuntimeEvidenceEnvelope[] = [];
  for (const list of groups.values()) kept.push(...list.sort((a, b) => (b.observedAt ?? -1) - (a.observedAt ?? -1) || a.evidenceId.localeCompare(b.evidenceId)).slice(0, Math.max(1, maxPerServiceKind)));
  return Object.freeze(kept.sort((a, b) => a.evidenceId.localeCompare(b.evidenceId)));
}
