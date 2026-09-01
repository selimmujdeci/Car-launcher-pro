/** ARCH-01/F6 — SAF shutdown planning/evidence. SystemBoot remains the only executor. */
import type { LifecycleGeneration, RuntimeServiceDescriptor } from './lifecycleContract';
import type { RuntimeDependencyGraph } from './runtimeDependencyGraph';

export type ShutdownPhase = 'RUNNING' | 'QUIESCE_REQUESTED' | 'QUIESCING' | 'STOPPING' | 'DISPOSING' | 'STOPPED' | 'BLOCKED' | 'FAILED' | 'UNKNOWN';
export type ShutdownVerdict = 'COMPLETE' | 'PARTIAL' | 'FAILED' | 'UNKNOWN';
export type CleanupExecutionKind = 'SYNC' | 'ASYNC' | 'UNKNOWN';
export type CleanupCapability = 'SUPPORTED' | 'UNSUPPORTED' | 'UNKNOWN';
export interface ShutdownCleanupCapability { readonly executionKind: CleanupExecutionKind; readonly quiesce: CleanupCapability; readonly drain: CleanupCapability; readonly cancel: CleanupCapability; readonly boundedTimeout: CleanupCapability; readonly reason: string; }
export function validateCanonicalCleanupCapability(capability: ShutdownCleanupCapability): 'READY' | 'NOT_READY_FOR_CANONICAL_SHUTDOWN' { return capability.executionKind === 'ASYNC' && capability.boundedTimeout !== 'SUPPORTED' ? 'NOT_READY_FOR_CANONICAL_SHUTDOWN' : 'READY'; }
export interface ShutdownPlan { readonly orderedServiceIds: readonly string[]; readonly cycleServices: readonly string[]; readonly unknownOrderServices: readonly string[]; readonly reason: string; }
export interface ShutdownEvidence { readonly shutdownRunId: string; readonly serviceId: string; readonly phase: ShutdownPhase; readonly generation: LifecycleGeneration | null; readonly quiesceOutcome: 'UNKNOWN' | 'DRAIN' | 'CANCEL'; readonly inFlightBefore: number | null; readonly inFlightAfter: number | null; readonly stopOutcome: 'NOT_ATTEMPTED' | 'SUCCEEDED' | 'FAILED' | 'TIMED_OUT' | 'UNKNOWN'; readonly disposeOutcome: 'NOT_ATTEMPTED' | 'SUCCEEDED' | 'FAILED' | 'TIMED_OUT' | 'UNKNOWN'; readonly recoverySuppressed: boolean; readonly provenance: readonly string[]; readonly failureReason: string | null; }

/** Dependent before dependency: only HARD edges constrain shutdown order. */
export function buildShutdownPlan(descriptors: readonly RuntimeServiceDescriptor[], graph: RuntimeDependencyGraph): ShutdownPlan {
  const ids = new Set(descriptors.map((d) => d.id)); const cycle = new Set(graph.cycles.flatMap((c) => c.nodes)); const hard = graph.edges.filter((e) => e.kind === 'HARD' && ids.has(e.from) && ids.has(e.to) && !cycle.has(e.from) && !cycle.has(e.to));
  const incoming = new Map<string, number>(); const dependents = new Map<string, string[]>(); for (const id of ids) { incoming.set(id, 0); dependents.set(id, []); }
  for (const edge of hard) { incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1); dependents.get(edge.from)?.push(edge.to); }
  const ready = [...ids].filter((id) => !cycle.has(id) && (incoming.get(id) ?? 0) === 0).sort(); const ordered: string[] = [];
  while (ready.length) { const id = ready.shift()!; ordered.push(id); for (const dep of (dependents.get(id) ?? []).sort()) { const left = (incoming.get(dep) ?? 1) - 1; incoming.set(dep, left); if (left === 0) { ready.push(dep); ready.sort(); } } }
  const unknown = graph.edges.filter((e) => e.kind === 'UNKNOWN').flatMap((e) => [e.from, e.to]).filter((id) => ids.has(id));
  return Object.freeze({ orderedServiceIds: Object.freeze(ordered), cycleServices: Object.freeze([...cycle].sort()), unknownOrderServices: Object.freeze([...new Set(unknown)].sort()), reason: cycle.size ? 'Dependency cycle: SystemBoot LIFO fallback is required and not claimed as graph order.' : 'Only canonical HARD edges constrain reverse shutdown order.' });
}
