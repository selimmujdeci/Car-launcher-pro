import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { RuntimeServiceDescriptor } from '../platform/runtime/lifecycleContract';
import type { RuntimeRegistryEntry } from '../platform/runtime/runtimeServiceRegistry';
import { buildRuntimeDependencyGraph, waveConsistency } from '../platform/runtime/runtimeDependencyGraph';
import { evaluateReadinessBlockers } from '../platform/runtime/runtimeReadinessBlocker';

const descriptor = (id: string, over: Partial<RuntimeServiceDescriptor> = {}): RuntimeServiceDescriptor => ({
  id, owner: id, lifecycleDomain: 'DOMAIN_SERVICE', criticality: 'OPTIONAL',
  hardDependencies: [], softDependencies: [], observationDependencies: [], unknownDependencies: [],
  readinessKind: 'test evidence', restartClass: 'NONE', resourceClass: 'OPTIONAL',
  shutdownClass: 'UNKNOWN', bootWave: null, faultDomain: 'DOMAIN_LOCAL',
  isolationBoundary: 'DOMAIN_LOCAL', propagationClass: 'NO_PROPAGATION',
  recoveryEligibility: 'UNKNOWN', ...over,
});
const entry = (id: string, over: Partial<RuntimeRegistryEntry> = {}): RuntimeRegistryEntry => ({
  descriptor: descriptor(id), lifecycle: 'STARTING', readiness: 'READY', health: 'HEALTHY',
  reason: 'test evidence', provenance: [], registeredBySystemBoot: false, ...over,
});
const evaluate = (entries: readonly RuntimeRegistryEntry[]) => {
  const graph = buildRuntimeDependencyGraph(entries);
  return { graph, blockers: evaluateReadinessBlockers(entries, graph) };
};

describe('ARCH-01/F3 deterministic dependency graph and blockers', () => {
  it('prevents READY when a hard dependency is not ready or failed', () => {
    const a = entry('a', { descriptor: descriptor('a', { hardDependencies: ['b'] }) });
    const notReady = entry('b', { readiness: 'NOT_READY' });
    const first = evaluate([a, notReady]).blockers.find((x) => x.serviceId === 'a');
    expect(first).toMatchObject({ readiness: 'NOT_READY' });
    expect(first?.blockers).toContainEqual(expect.objectContaining({ kind: 'HARD_DEPENDENCY_NOT_READY', dependency: 'b' }));
    const failed = entry('b', { health: 'FAILED' });
    const second = evaluate([a, failed]).blockers.find((x) => x.serviceId === 'a');
    expect(second?.blockers).toContainEqual(expect.objectContaining({ kind: 'HARD_DEPENDENCY_FAILED', dependency: 'b' }));
  });

  it('keeps a soft dependency degradative and preserves unknown as unknown', () => {
    const soft = entry('soft', { descriptor: descriptor('soft', { softDependencies: ['b'] }) });
    const degraded = entry('b', { readiness: 'DEGRADED' });
    expect(evaluate([soft, degraded]).blockers.find((x) => x.serviceId === 'soft')).toMatchObject({ readiness: 'DEGRADED' });
    const unknown = entry('unknown', { descriptor: descriptor('unknown', { unknownDependencies: ['absent'] }) });
    const result = evaluate([unknown]).blockers[0];
    expect(result.readiness).toBe('UNKNOWN');
    expect(result.unknownDependencies).toEqual(['absent']);
  });

  it('detects self, two-node and three-node cycles without guessing an execution order', () => {
    const self = evaluate([entry('a', { descriptor: descriptor('a', { hardDependencies: ['a'] }) })]).graph;
    expect(self.validity).toBe('INVALID'); expect(self.cycles[0]?.nodes).toEqual(['a']);
    const two = evaluate([entry('a', { descriptor: descriptor('a', { hardDependencies: ['b'] }) }), entry('b', { descriptor: descriptor('b', { hardDependencies: ['a'] }) })]).graph;
    expect(two.cycles).toHaveLength(1); expect(two.cycles[0]?.nodes).toEqual(['a', 'b']);
    const three = evaluate([entry('a', { descriptor: descriptor('a', { hardDependencies: ['b'] }) }), entry('b', { descriptor: descriptor('b', { hardDependencies: ['c'] }) }), entry('c', { descriptor: descriptor('c', { hardDependencies: ['a'] }) })]).graph;
    expect(three.cycles[0]?.nodes).toEqual(['a', 'b', 'c']);
  });

  it('deduplicates edges, keeps output deterministic, and surfaces wave order risk', () => {
    const a = entry('a', { descriptor: descriptor('a', { hardDependencies: ['b', 'b'], bootWave: 1 }) });
    const b = entry('b', { descriptor: descriptor('b', { bootWave: 2 }) });
    const first = buildRuntimeDependencyGraph([b, a]); const second = buildRuntimeDependencyGraph([a, b]);
    expect(first).toEqual(second); expect(first.edges).toHaveLength(1);
    expect(waveConsistency(first.edges[0], first.nodes)).toBe('ORDER_RISK');
  });

  it('is a SAF projection and does not become a service executor or second registry authority', () => {
    const graph = readFileSync('src/platform/runtime/runtimeDependencyGraph.ts', 'utf8');
    const blockers = readFileSync('src/platform/runtime/runtimeReadinessBlocker.ts', 'utf8');
    for (const source of [graph, blockers]) for (const forbidden of ['setTimeout(', 'setInterval(', '.start(', '.stop(', '.restart(', 'fetch(']) expect(source).not.toContain(forbidden);
    expect(graph).toContain("'HARD' | 'SOFT' | 'OBSERVATION_ONLY' | 'UNKNOWN'");
    expect(blockers).toContain('HARD_DEPENDENCY_UNKNOWN');
  });
});
