/** ARCH-01/F4 — deterministic, read-only fault containment projection. */
import type { FaultDomain, IsolationBoundary, LifecycleHealth, PropagationClass, RuntimeServiceDescriptor } from './lifecycleContract';
import type { RuntimeDependencyGraph } from './runtimeDependencyGraph';
import type { RuntimeRegistryEntry } from './runtimeServiceRegistry';

export type ContainmentOutcome = 'CONTAINED' | 'DEGRADED_DEPENDENT' | 'BLOCKED_DEPENDENT' | 'SHARED_RESOURCE_RISK' | 'UNKNOWN_PROPAGATION';
export interface FaultContainmentEntry {
  readonly serviceId: string;
  readonly faultDomain: FaultDomain;
  readonly isolationBoundary: IsolationBoundary;
  readonly propagationClass: PropagationClass;
  readonly criticality: RuntimeServiceDescriptor['criticality'];
  readonly currentHealth: LifecycleHealth;
  readonly affectedBy: readonly string[];
  readonly canAffect: readonly string[];
  readonly containment: ContainmentOutcome;
  readonly containmentReason: string;
  readonly provenance: readonly string[];
}
export interface FaultBlastRadius {
  readonly serviceId: string;
  readonly directlyAffected: readonly string[];
  readonly transitivelyAffected: readonly string[];
  readonly explicitlyIsolated: readonly string[];
  readonly unknownImpact: readonly string[];
  readonly reason: string;
  readonly evidence: readonly string[];
}
export interface RuntimeFaultContainmentSnapshot {
  readonly entries: readonly FaultContainmentEntry[];
  readonly sharedResourceRisks: readonly string[];
  readonly unknownImpactServices: readonly string[];
}

function hardDependents(graph: RuntimeDependencyGraph, dependency: string): readonly string[] {
  return Object.freeze(graph.edges.filter((edge) => edge.kind === 'HARD' && edge.to === dependency).map((edge) => edge.from).sort());
}
function hardDependencies(graph: RuntimeDependencyGraph, dependent: string): readonly string[] {
  return Object.freeze(graph.edges.filter((edge) => edge.kind === 'HARD' && edge.from === dependent).map((edge) => edge.to).sort());
}

/** Health is evidence only: this function does not mutate health, readiness, lifecycle, or recovery. */
export function buildRuntimeFaultContainment(entries: readonly RuntimeRegistryEntry[], graph: RuntimeDependencyGraph): RuntimeFaultContainmentSnapshot {
  const byId = new Map(entries.map((entry) => [entry.descriptor.id, entry]));
  const result = entries.map((entry) => {
    const descriptor = entry.descriptor;
    const affectedBy = hardDependencies(graph, descriptor.id).filter((id) => {
      const health = byId.get(id)?.health;
      return health === 'FAILED' || health === 'UNAVAILABLE';
    });
    const canAffect = hardDependents(graph, descriptor.id);
    const failed = entry.health === 'FAILED' || entry.health === 'UNAVAILABLE';
    const containment: ContainmentOutcome = descriptor.isolationBoundary === 'SHARED_RESOURCE'
      ? 'SHARED_RESOURCE_RISK'
      : descriptor.faultDomain === 'UNKNOWN' || descriptor.propagationClass === 'UNKNOWN'
        ? 'UNKNOWN_PROPAGATION'
        : failed && canAffect.length > 0 ? 'BLOCKED_DEPENDENT'
          : affectedBy.length > 0 ? 'DEGRADED_DEPENDENT'
            : 'CONTAINED';
    const containmentReason = containment === 'SHARED_RESOURCE_RISK'
      ? 'Shared resource boundary is visible; it is not a domain failure propagation.'
      : containment === 'UNKNOWN_PROPAGATION'
        ? 'Fault boundary or propagation evidence is not established.'
        : containment === 'BLOCKED_DEPENDENT'
          ? 'FAILED/UNAVAILABLE service has canonical HARD dependents.'
          : containment === 'DEGRADED_DEPENDENT'
            ? 'A canonical HARD dependency is FAILED/UNAVAILABLE.'
            : 'No canonical HARD failure propagation is evidenced.';
    return Object.freeze({ serviceId: descriptor.id, faultDomain: descriptor.faultDomain, isolationBoundary: descriptor.isolationBoundary, propagationClass: descriptor.propagationClass, criticality: descriptor.criticality, currentHealth: entry.health, affectedBy, canAffect, containment, containmentReason, provenance: Object.freeze([...entry.provenance, 'RuntimeServiceDescriptor', 'runtimeDependencyGraph']) });
  }).sort((a, b) => a.serviceId.localeCompare(b.serviceId));
  return Object.freeze({
    entries: Object.freeze(result),
    sharedResourceRisks: Object.freeze(result.filter((entry) => entry.containment === 'SHARED_RESOURCE_RISK').map((entry) => entry.serviceId)),
    unknownImpactServices: Object.freeze(result.filter((entry) => entry.containment === 'UNKNOWN_PROPAGATION').map((entry) => entry.serviceId)),
  });
}

/** Traverses only canonical HARD edges. Cycles become visible unknown impact, never an execution order. */
export function projectFaultBlastRadius(serviceId: string, graph: RuntimeDependencyGraph): FaultBlastRadius {
  const ids = new Set(graph.nodes.map((node) => node.serviceId));
  if (!ids.has(serviceId)) return Object.freeze({ serviceId, directlyAffected: Object.freeze([]), transitivelyAffected: Object.freeze([]), explicitlyIsolated: Object.freeze([]), unknownImpact: Object.freeze([]), reason: 'Fault source is absent from the registry graph.', evidence: Object.freeze(['runtimeDependencyGraph.nodes']) });
  const cycleMembers = new Set(graph.cycles.flatMap((cycle) => cycle.nodes));
  const unknownAdjacent = new Set(graph.edges.filter((edge) => edge.kind === 'UNKNOWN' && (edge.from === serviceId || edge.to === serviceId)).flatMap((edge) => [edge.from, edge.to]));
  if (cycleMembers.has(serviceId)) return Object.freeze({ serviceId, directlyAffected: Object.freeze([]), transitivelyAffected: Object.freeze([]), explicitlyIsolated: Object.freeze([]), unknownImpact: Object.freeze([...cycleMembers].sort()), reason: 'Dependency cycle blocks a safe blast-radius conclusion.', evidence: Object.freeze(['runtimeDependencyGraph.cycles']) });
  const direct = hardDependents(graph, serviceId);
  const visited = new Set<string>(direct); const queue = [...direct];
  while (queue.length) {
    const current = queue.shift()!;
    if (cycleMembers.has(current)) { unknownAdjacent.add(current); continue; }
    for (const next of hardDependents(graph, current)) if (!visited.has(next)) { visited.add(next); queue.push(next); }
  }
  const transitive = [...visited].filter((id) => !direct.includes(id)).sort();
  const affected = new Set([...direct, ...transitive, serviceId]);
  const explicitlyIsolated = [...ids].filter((id) => !affected.has(id) && !unknownAdjacent.has(id) && !cycleMembers.has(id)).sort();
  return Object.freeze({ serviceId, directlyAffected: direct, transitivelyAffected: Object.freeze(transitive), explicitlyIsolated: Object.freeze(explicitlyIsolated), unknownImpact: Object.freeze([...unknownAdjacent].filter((id) => id !== serviceId).sort()), reason: direct.length || transitive.length ? 'Only canonical HARD dependency edges are included.' : 'No canonical HARD dependent is evidenced; fault remains contained.', evidence: Object.freeze(['runtimeDependencyGraph.HARD']) });
}
