import { describe, expect, it } from 'vitest';
import type { RuntimeServiceDescriptor } from '../platform/runtime/lifecycleContract';
import type { RuntimeRegistryEntry } from '../platform/runtime/runtimeServiceRegistry';
import { buildRuntimeDependencyGraph } from '../platform/runtime/runtimeDependencyGraph';
import { runtimeRecoverySupervisor } from '../platform/runtime/runtimeRecoverySupervisor';
import { buildShutdownPlan } from '../platform/runtime/runtimeShutdownModel';
import type { RecoveryRequest } from '../platform/runtime/runtimeRecoveryPolicy';

const descriptor = (id: string, over: Partial<RuntimeServiceDescriptor> = {}): RuntimeServiceDescriptor => ({ id, owner: id, lifecycleDomain: 'DOMAIN_SERVICE', criticality: 'OPTIONAL', hardDependencies: [], softDependencies: [], observationDependencies: [], unknownDependencies: [], readinessKind: 'test', restartClass: 'RUNTIME_REQUESTABLE', resourceClass: 'OPTIONAL', shutdownClass: 'LIFO_CLEANUP', bootWave: null, faultDomain: 'DOMAIN_LOCAL', isolationBoundary: 'DOMAIN_LOCAL', propagationClass: 'NO_PROPAGATION', recoveryEligibility: 'RUNTIME_FUTURE', ...over });
const entry = (d: RuntimeServiceDescriptor): RuntimeRegistryEntry => ({ descriptor: d, lifecycle: 'READY', readiness: 'READY', health: 'HEALTHY', reason: 'test', provenance: [], registeredBySystemBoot: true });
const request: RecoveryRequest = { requestId: 'x', serviceId: 'a', source: 'BOOT', faultDomain: 'DOMAIN_LOCAL', observedLifecycle: 'FAILED', observedReadiness: 'NOT_READY', observedHealth: 'FAILED', reason: 'test', lifecycleEpoch: 1, faultEvidenceRef: 'test', requestedAt: 1, provenance: [] };

describe('ARCH-01/F6 shutdown planning and recovery interlock', () => {
  it('uses reverse order only for HARD edges; soft/observation/unknown do not constrain it', () => {
    const a = descriptor('a', { hardDependencies: ['b'], softDependencies: ['c'], observationDependencies: ['d'], unknownDependencies: ['e'] });
    const all = [a, descriptor('b'), descriptor('c'), descriptor('d'), descriptor('e')]; const plan = buildShutdownPlan(all, buildRuntimeDependencyGraph(all.map(entry)));
    expect(plan.orderedServiceIds.indexOf('a')).toBeLessThan(plan.orderedServiceIds.indexOf('b'));
    expect(plan.unknownOrderServices).toEqual(['a', 'e']);
  });
  it('fails closed on dependency cycles rather than inventing graph order', () => {
    const a = descriptor('a', { hardDependencies: ['b'] }); const b = descriptor('b', { hardDependencies: ['a'] });
    const plan = buildShutdownPlan([a, b], buildRuntimeDependencyGraph([entry(a), entry(b)]));
    expect(plan.cycleServices).toEqual(['a', 'b']); expect(plan.orderedServiceIds).toEqual([]);
  });
  it('suppresses recovery while shutdown is active and permits no execution', () => {
    runtimeRecoverySupervisor.resetForTest(); let calls = 0;
    runtimeRecoverySupervisor.configure([descriptor('a')], { currentEpoch: () => 1, executeRestart: async () => { calls++; return true; } });
    runtimeRecoverySupervisor.setShutdownActive(true);
    expect(runtimeRecoverySupervisor.request(request)).toMatchObject({ kind: 'DENIED', reason: expect.stringContaining('SHUTDOWN_ACTIVE') });
    expect(calls).toBe(0);
  });
});
