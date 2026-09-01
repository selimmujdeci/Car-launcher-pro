import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { RuntimeServiceDescriptor } from '../platform/runtime/lifecycleContract';
import type { RuntimeRegistryEntry } from '../platform/runtime/runtimeServiceRegistry';
import { buildRuntimeDependencyGraph } from '../platform/runtime/runtimeDependencyGraph';
import { buildRuntimeFaultContainment, projectFaultBlastRadius } from '../platform/runtime/runtimeFaultContainment';

const descriptor = (id: string, over: Partial<RuntimeServiceDescriptor> = {}): RuntimeServiceDescriptor => ({
  id, owner: id, lifecycleDomain: 'DOMAIN_SERVICE', criticality: 'EXPERIENCE', hardDependencies: [], softDependencies: [], observationDependencies: [], unknownDependencies: [], readinessKind: 'test', restartClass: 'NONE', resourceClass: 'EXPERIENCE', shutdownClass: 'UNKNOWN', bootWave: null, faultDomain: 'DOMAIN_LOCAL', isolationBoundary: 'DOMAIN_LOCAL', propagationClass: 'NO_PROPAGATION', recoveryEligibility: 'UNKNOWN', ...over,
});
const entry = (id: string, over: Partial<RuntimeRegistryEntry> = {}): RuntimeRegistryEntry => ({ descriptor: descriptor(id), lifecycle: 'READY', readiness: 'READY', health: 'HEALTHY', reason: 'test', provenance: [], registeredBySystemBoot: false, ...over });
const model = (entries: readonly RuntimeRegistryEntry[]) => {
  const graph = buildRuntimeDependencyGraph(entries);
  return { graph, containment: buildRuntimeFaultContainment(entries, graph) };
};

describe('ARCH-01/F4 fault containment projection', () => {
  it('contains independent Music and Navigation faults without cross-domain failure', () => {
    const music = entry('media-authority', { descriptor: descriptor('media-authority', { faultDomain: 'MEDIA' }), health: 'FAILED' });
    const navigation = entry('NavigationSessionRuntime', { descriptor: descriptor('NavigationSessionRuntime', { faultDomain: 'NAVIGATION' }) });
    const { graph, containment } = model([music, navigation]);
    expect(containment.entries.find((x) => x.serviceId === 'NavigationSessionRuntime')?.currentHealth).toBe('HEALTHY');
    expect(projectFaultBlastRadius('media-authority', graph).explicitlyIsolated).toContain('NavigationSessionRuntime');
    expect(projectFaultBlastRadius('NavigationSessionRuntime', graph).explicitlyIsolated).toContain('media-authority');
  });

  it('propagates only HARD edges; soft and observation edges do not block', () => {
    const dependency = entry('transport', { health: 'FAILED' });
    const hard = entry('hard-dependent', { descriptor: descriptor('hard-dependent', { hardDependencies: ['transport'], propagationClass: 'HARD_DEPENDENCY_ONLY' }) });
    const soft = entry('soft-dependent', { descriptor: descriptor('soft-dependent', { softDependencies: ['transport'], propagationClass: 'SOFT_DEGRADATION_ONLY' }) });
    const observed = entry('observer', { descriptor: descriptor('observer', { observationDependencies: ['transport'], propagationClass: 'OBSERVATION_ONLY' }) });
    const { graph, containment } = model([dependency, hard, soft, observed]);
    expect(projectFaultBlastRadius('transport', graph).directlyAffected).toEqual(['hard-dependent']);
    expect(containment.entries.find((x) => x.serviceId === 'hard-dependent')?.containment).toBe('DEGRADED_DEPENDENT');
    expect(containment.entries.find((x) => x.serviceId === 'soft-dependent')?.containment).toBe('CONTAINED');
    expect(containment.entries.find((x) => x.serviceId === 'observer')?.containment).toBe('CONTAINED');
  });

  it('does not propagate UNKNOWN edges and keeps shared-resource risk separate from domain failure', () => {
    const storage = entry('safe-storage', { descriptor: descriptor('safe-storage', { faultDomain: 'STORAGE', isolationBoundary: 'SHARED_RESOURCE', propagationClass: 'UNKNOWN' }), health: 'FAILED' });
    const consumer = entry('consumer', { descriptor: descriptor('consumer', { unknownDependencies: ['safe-storage'], propagationClass: 'UNKNOWN' }) });
    const { graph, containment } = model([storage, consumer]);
    const blast = projectFaultBlastRadius('safe-storage', graph);
    expect(blast.directlyAffected).toEqual([]);
    expect(blast.unknownImpact).toEqual(['consumer']);
    expect(containment.entries.find((x) => x.serviceId === 'safe-storage')?.containment).toBe('SHARED_RESOURCE_RISK');
  });

  it('does not equate UI visibility, transport state, health, and lifecycle state', () => {
    const ui = entry('app-ui', { descriptor: descriptor('app-ui', { lifecycleDomain: 'APP_UI' }), lifecycle: 'STOPPED', health: 'HEALTHY' });
    const transport = entry('transport', { descriptor: descriptor('transport', { lifecycleDomain: 'TRANSPORT' }), lifecycle: 'STOPPED', health: 'DEGRADED' });
    const domain = entry('domain');
    const { containment } = model([ui, transport, domain]);
    expect(containment.entries.find((x) => x.serviceId === 'app-ui')?.currentHealth).toBe('HEALTHY');
    expect(containment.entries.find((x) => x.serviceId === 'transport')?.currentHealth).toBe('DEGRADED');
    expect(containment.entries.find((x) => x.serviceId === 'domain')?.containment).toBe('CONTAINED');
  });

  it('fails closed on cycles and remains deterministic without lifecycle mutations', () => {
    const a = entry('a', { descriptor: descriptor('a', { hardDependencies: ['b'], propagationClass: 'HARD_DEPENDENCY_ONLY' }) });
    const b = entry('b', { descriptor: descriptor('b', { hardDependencies: ['a'], propagationClass: 'HARD_DEPENDENCY_ONLY' }) });
    const first = model([a, b]); const second = model([b, a]);
    expect(first.containment).toEqual(second.containment);
    expect(projectFaultBlastRadius('a', first.graph).unknownImpact).toEqual(['a', 'b']);
    const source = readFileSync('src/platform/runtime/runtimeFaultContainment.ts', 'utf8');
    for (const forbidden of ['setTimeout(', 'setInterval(', '.start(', '.stop(', '.restart(', 'fetch(', 'Date.now(']) expect(source).not.toContain(forbidden);
  });
});
