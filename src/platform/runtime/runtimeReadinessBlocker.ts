/** ARCH-01/F3 — SAF readiness blocker projection from canonical graph evidence. */
import type { LifecycleReadiness } from './lifecycleContract';
import type { RuntimeDependencyGraph } from './runtimeDependencyGraph';
import type { RuntimeRegistryEntry } from './runtimeServiceRegistry';

export type ReadinessBlockerClass = 'HARD_DEPENDENCY_NOT_READY' | 'HARD_DEPENDENCY_FAILED' | 'HARD_DEPENDENCY_UNKNOWN' | 'SOFT_DEPENDENCY_DEGRADED' | 'DEPENDENCY_CYCLE' | 'EVIDENCE_UNAVAILABLE' | 'UNKNOWN';
export interface ReadinessBlocker { readonly kind: ReadinessBlockerClass; readonly dependency: string | null; readonly evidence: string; }
export interface ReadinessBlockerResult { readonly serviceId: string; readonly readiness: LifecycleReadiness; readonly blockers: readonly ReadinessBlocker[]; readonly degradedBy: readonly ReadinessBlocker[]; readonly unknownDependencies: readonly string[]; readonly reason: string; }

export function evaluateReadinessBlockers(entries: readonly RuntimeRegistryEntry[], graph: RuntimeDependencyGraph): readonly ReadinessBlockerResult[] {
  const byId = new Map(entries.map((x) => [x.descriptor.id, x])); const cycleIds = new Set(graph.cycles.flatMap((x) => x.nodes));
  return entries.map((entry) => { const blockers: ReadinessBlocker[] = []; const degradedBy: ReadinessBlocker[] = []; const unknown: string[] = [];
    if (cycleIds.has(entry.descriptor.id)) blockers.push({ kind: 'DEPENDENCY_CYCLE', dependency: null, evidence: 'runtimeDependencyGraph.cycles' });
    for (const dep of entry.descriptor.hardDependencies) { const target = byId.get(dep); if (!target) { blockers.push({ kind: 'HARD_DEPENDENCY_UNKNOWN', dependency: dep, evidence: 'descriptor target absent from registry' }); unknown.push(dep); } else if (target.health === 'FAILED') blockers.push({ kind: 'HARD_DEPENDENCY_FAILED', dependency: dep, evidence: 'dependency health FAILED' }); else if (target.readiness === 'UNKNOWN') { blockers.push({ kind: 'HARD_DEPENDENCY_UNKNOWN', dependency: dep, evidence: 'dependency readiness UNKNOWN' }); unknown.push(dep); } else if (target.readiness !== 'READY') blockers.push({ kind: 'HARD_DEPENDENCY_NOT_READY', dependency: dep, evidence: `dependency readiness ${target.readiness}` }); }
    for (const dep of entry.descriptor.softDependencies) { const target = byId.get(dep); if (!target || target.readiness !== 'READY') degradedBy.push({ kind: 'SOFT_DEPENDENCY_DEGRADED', dependency: dep, evidence: target ? `dependency readiness ${target.readiness}` : 'descriptor target absent from registry' }); }
    for (const dep of entry.descriptor.unknownDependencies) { unknown.push(dep); blockers.push({ kind: 'UNKNOWN', dependency: dep, evidence: 'dependency classification UNKNOWN' }); }
    if (entry.readiness === 'UNKNOWN') blockers.push({ kind: 'EVIDENCE_UNAVAILABLE', dependency: null, evidence: entry.reason });
    const readiness: LifecycleReadiness = blockers.length ? (unknown.length || blockers.some((x) => x.kind === 'EVIDENCE_UNAVAILABLE') ? 'UNKNOWN' : 'NOT_READY') : degradedBy.length ? 'DEGRADED' : entry.readiness;
    return Object.freeze({ serviceId: entry.descriptor.id, readiness, blockers: Object.freeze(blockers), degradedBy: Object.freeze(degradedBy), unknownDependencies: Object.freeze(unknown), reason: blockers.length ? blockers.map((x) => x.kind).join(' · ') : degradedBy.length ? 'SOFT_DEPENDENCY_DEGRADED' : 'No graph blocker observed.' });
  });
}
