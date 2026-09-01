/** ARCH-01/F9 — read-only degraded-operation availability projection. */
import type { RuntimeServiceDescriptor } from './lifecycleContract';
import type { RuntimeRegistryEntry } from './runtimeServiceRegistry';
import type { RuntimeDependencyGraph } from './runtimeDependencyGraph';
import type { ReadinessBlockerResult } from './runtimeReadinessBlocker';
import type { EvidenceFreshness } from './runtimeObservability';

export type CapabilityAvailability = 'FULL' | 'DEGRADED' | 'LIMITED' | 'UNAVAILABLE' | 'BLOCKED' | 'UNKNOWN';
export type CapabilityCriticality = 'REQUIRED_FOR_BOOT' | 'REQUIRED_FOR_DRIVING_CORE' | 'OPTIONAL_INTERACTIVE' | 'OPTIONAL_BACKGROUND' | 'DEV_ONLY' | 'UNKNOWN';

export interface RuntimeCapabilityAvailability {
  readonly capabilityId: string;
  readonly owner: string;
  readonly availability: CapabilityAvailability;
  readonly criticality: CapabilityCriticality;
  readonly dependencyBlockers: readonly string[];
  readonly degradedBy: readonly string[];
  readonly allowedOperations: readonly string[];
  readonly deniedOperations: readonly string[];
  readonly fallback: string | null;
  readonly reason: string;
  readonly provenance: readonly string[];
  readonly freshness?: EvidenceFreshness;
  readonly readinessEvidence?: string;
  readonly healthEvidence?: string;
  readonly lifecycleEpoch?: number | null;
  readonly dependencyClass?: 'HARD' | 'SOFT' | 'OBSERVATION_ONLY' | 'UNKNOWN' | 'NONE';
}

export interface RuntimeResilienceSnapshot {
  readonly capabilities: readonly RuntimeCapabilityAvailability[];
  readonly summary: Readonly<Record<CapabilityAvailability, number>>;
}

export interface RuntimeDomainAvailabilityEvidence {
  readonly serviceId: string;
  readonly availability: CapabilityAvailability;
  readonly freshness: EvidenceFreshness;
  readonly allowedOperations: readonly string[];
  readonly deniedOperations: readonly string[];
  readonly fallback: string | null;
  readonly reason: string;
  readonly provenance: readonly string[];
  readonly readinessEvidence?: string;
  readonly healthEvidence?: string;
  readonly lifecycleEpoch?: number | null;
}

function criticality(descriptor: RuntimeServiceDescriptor): CapabilityCriticality {
  if (descriptor.id === 'system-boot' || descriptor.id === 'safe-storage') return 'REQUIRED_FOR_BOOT';
  if (descriptor.criticality === 'VEHICLE_DATA') return 'REQUIRED_FOR_DRIVING_CORE';
  if (descriptor.criticality === 'OPTIONAL') return 'OPTIONAL_BACKGROUND';
  if (descriptor.criticality === 'DEVTOOLS') return 'DEV_ONLY';
  if (descriptor.criticality === 'EXPERIENCE') return 'OPTIONAL_INTERACTIVE';
  return 'UNKNOWN';
}

function availability(entry: RuntimeRegistryEntry, blocker: ReadinessBlockerResult | undefined): CapabilityAvailability {
  if (entry.health === 'FAILED' || entry.health === 'UNAVAILABLE') return 'UNAVAILABLE';
  if (blocker?.blockers.some((x) => x.kind === 'HARD_DEPENDENCY_FAILED' || x.kind === 'DEPENDENCY_CYCLE')) return 'BLOCKED';
  if (entry.readiness === 'DEGRADED' || entry.health === 'DEGRADED' || (blocker?.degradedBy.length ?? 0) > 0) return 'DEGRADED';
  if (entry.readiness === 'READY' && entry.health === 'HEALTHY') return 'FULL';
  if (entry.readiness === 'READY' && entry.health === 'UNKNOWN') return 'UNKNOWN';
  if (entry.readiness === 'UNKNOWN' || entry.health === 'UNKNOWN') return 'UNKNOWN';
  return 'BLOCKED';
}

/** Derives capability availability only from existing service/readiness evidence. */
export function buildRuntimeResilienceSnapshot(entries: readonly RuntimeRegistryEntry[], graph: RuntimeDependencyGraph, blockers: readonly ReadinessBlockerResult[], adapters: readonly RuntimeDomainAvailabilityEvidence[] = []): RuntimeResilienceSnapshot {
  const blockerById = new Map(blockers.map((x) => [x.serviceId, x]));
  const adapterById = new Map(adapters.map((x) => [x.serviceId, x]));
  const capabilities = [...entries].sort((a, b) => a.descriptor.id.localeCompare(b.descriptor.id)).map((entry) => {
    const blocker = blockerById.get(entry.descriptor.id);
    const adapter = adapterById.get(entry.descriptor.id);
    // An adapter is an explicit domain claim. Without current evidence it must
    // not be replaced by a generic registry-derived FULL claim.
    const state = adapter ? (adapter.freshness === 'CURRENT' ? adapter.availability : 'UNKNOWN') : availability(entry, blocker);
    const dependencyBlockers = Object.freeze((blocker?.blockers ?? []).map((x) => `${x.kind}:${x.dependency ?? 'NONE'}`));
    const degradedBy = Object.freeze((blocker?.degradedBy ?? []).map((x) => `${x.kind}:${x.dependency ?? 'NONE'}`));
    const reason = adapter && state === adapter.availability ? adapter.reason : state === 'FULL' ? 'Explicit READY + HEALTHY evidence.' : state === 'DEGRADED' ? 'Domain evidence is present but degraded.' : state === 'BLOCKED' ? 'Readiness is blocked or not proven.' : state === 'UNAVAILABLE' ? 'Domain health is unavailable/failed.' : 'Capability evidence is insufficient; no fallback is asserted.';
    const dependencyClass = entry.descriptor.hardDependencies.length > 0 ? 'HARD' : entry.descriptor.softDependencies.length > 0 ? 'SOFT' : entry.descriptor.observationDependencies.length > 0 ? 'OBSERVATION_ONLY' : entry.descriptor.unknownDependencies.length > 0 ? 'UNKNOWN' : 'NONE';
    return Object.freeze({ capabilityId: entry.descriptor.id, owner: entry.descriptor.owner, availability: state, criticality: criticality(entry.descriptor), dependencyBlockers, degradedBy, allowedOperations: Object.freeze(adapter && state === adapter.availability ? [...adapter.allowedOperations] : []), deniedOperations: Object.freeze(adapter && state === adapter.availability ? [...adapter.deniedOperations] : []), fallback: adapter && state === adapter.availability ? adapter.fallback : null, reason, freshness: adapter?.freshness, readinessEvidence: adapter?.readinessEvidence ?? entry.reason, healthEvidence: adapter?.healthEvidence ?? `health=${entry.health}`, lifecycleEpoch: adapter?.lifecycleEpoch, dependencyClass, provenance: Object.freeze([...entry.provenance, ...(adapter?.provenance ?? []), 'runtimeServiceRegistry', 'runtimeReadinessBlocker', graph.validity === 'VALID' ? 'runtimeDependencyGraph:VALID' : 'runtimeDependencyGraph:INVALID']) });
  });
  const summary = { FULL: 0, DEGRADED: 0, LIMITED: 0, UNAVAILABLE: 0, BLOCKED: 0, UNKNOWN: 0 } as Record<CapabilityAvailability, number>;
  for (const item of capabilities) summary[item.availability]++;
  return Object.freeze({ capabilities: Object.freeze(capabilities), summary: Object.freeze(summary) });
}
