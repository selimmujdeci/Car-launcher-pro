/** ARCH-01/F3 — deterministic SAF dependency graph; never executes services. */
import type { LifecycleHealth, LifecycleReadiness, LifecycleState, RuntimeServiceDescriptor } from './lifecycleContract';
import type { RuntimeRegistryEntry } from './runtimeServiceRegistry';

export type DependencyEdgeKind = 'HARD' | 'SOFT' | 'OBSERVATION_ONLY' | 'UNKNOWN';
export type WaveConsistency = 'CONSISTENT' | 'ORDER_RISK' | 'UNKNOWN';
export interface DependencyNode { readonly serviceId: string; readonly lifecycleDomain: string; readonly criticality: string; readonly readiness: LifecycleReadiness; readonly lifecycleState: LifecycleState; readonly health: LifecycleHealth; readonly bootWave: number | null; }
export interface DependencyEdge { readonly from: string; readonly to: string; readonly kind: DependencyEdgeKind; readonly reason: string; readonly provenance: string; }
export interface DependencyCycle { readonly nodes: readonly string[]; }
export interface RuntimeDependencyGraph { readonly nodes: readonly DependencyNode[]; readonly edges: readonly DependencyEdge[]; readonly cycles: readonly DependencyCycle[]; readonly validity: 'VALID' | 'INVALID'; }

function edgeList(d: RuntimeServiceDescriptor): DependencyEdge[] {
  const mk = (to: string, kind: DependencyEdgeKind): DependencyEdge => ({ from: d.id, to, kind, reason: `${kind.toLowerCase()} descriptor metadata`, provenance: 'RuntimeServiceDescriptor' });
  return [...d.hardDependencies.map((x) => mk(x, 'HARD')), ...d.softDependencies.map((x) => mk(x, 'SOFT')), ...d.observationDependencies.map((x) => mk(x, 'OBSERVATION_ONLY')), ...d.unknownDependencies.map((x) => mk(x, 'UNKNOWN'))];
}

/** Stable de-duplication makes graph output independent of descriptor array aliases. */
export function buildRuntimeDependencyGraph(entries: readonly RuntimeRegistryEntry[]): RuntimeDependencyGraph {
  const sorted = [...entries].sort((a, b) => a.descriptor.id.localeCompare(b.descriptor.id));
  const nodes = Object.freeze(sorted.map((x) => Object.freeze({ serviceId: x.descriptor.id, lifecycleDomain: x.descriptor.lifecycleDomain, criticality: x.descriptor.criticality, readiness: x.readiness, lifecycleState: x.lifecycle, health: x.health, bootWave: x.descriptor.bootWave })));
  const unique = new Map<string, DependencyEdge>();
  for (const entry of sorted) for (const edge of edgeList(entry.descriptor)) unique.set(`${edge.from}|${edge.to}|${edge.kind}`, edge);
  const edges: readonly DependencyEdge[] = Object.freeze([...unique.values()]
    .sort((a, b) => `${a.from}|${a.to}|${a.kind}`.localeCompare(`${b.from}|${b.to}|${b.kind}`))
    .map((edge) => Object.freeze({ ...edge })));
  const validIds = new Set(nodes.map((x) => x.serviceId));
  const adjacency = new Map<string, string[]>();
  for (const id of validIds) adjacency.set(id, []);
  for (const edge of edges) if (edge.kind !== 'UNKNOWN' && validIds.has(edge.to)) adjacency.get(edge.from)?.push(edge.to);
  const cycles: DependencyCycle[] = []; const visited = new Set<string>(); const stack: string[] = []; const active = new Set<string>();
  const visit = (id: string): void => { visited.add(id); active.add(id); stack.push(id); for (const next of adjacency.get(id) ?? []) { if (!visited.has(next)) visit(next); else if (active.has(next)) { const loop = stack.slice(stack.indexOf(next)); const signature = [...loop].sort().join('|'); if (!cycles.some((c) => [...c.nodes].sort().join('|') === signature)) cycles.push(Object.freeze({ nodes: Object.freeze(loop) })); } } stack.pop(); active.delete(id); };
  for (const id of [...validIds].sort()) if (!visited.has(id)) visit(id);
  return Object.freeze({ nodes, edges, cycles: Object.freeze(cycles), validity: cycles.length ? 'INVALID' : 'VALID' });
}

export function waveConsistency(edge: DependencyEdge, nodes: readonly DependencyNode[]): WaveConsistency {
  if (edge.kind === 'OBSERVATION_ONLY' || edge.kind === 'UNKNOWN') return 'UNKNOWN';
  const from = nodes.find((x) => x.serviceId === edge.from); const to = nodes.find((x) => x.serviceId === edge.to);
  if (!from || !to || from.bootWave === null || to.bootWave === null) return 'UNKNOWN';
  return from.bootWave < to.bootWave ? 'ORDER_RISK' : 'CONSISTENT';
}
