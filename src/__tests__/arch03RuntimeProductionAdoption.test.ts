import { describe, expect, it } from 'vitest';
import { runtimeRecoverySupervisor } from '../platform/runtime/runtimeRecoverySupervisor';
import type { RuntimeServiceDescriptor } from '../platform/runtime/lifecycleContract';

const descriptor: RuntimeServiceDescriptor = { id: 'svc', owner: 'test', lifecycleDomain: 'APP_PROCESS', criticality: 'OPTIONAL', hardDependencies: [], softDependencies: [], observationDependencies: [], unknownDependencies: [], readinessKind: 'test', restartClass: 'RUNTIME_REQUESTABLE', resourceClass: 'CORE', shutdownClass: 'LIFO_CLEANUP', bootWave: 1, faultDomain: 'DOMAIN_LOCAL', isolationBoundary: 'DOMAIN_LOCAL', propagationClass: 'NO_PROPAGATION', recoveryEligibility: 'RUNTIME_FUTURE' };
describe('ARCH-03 Runtime production evidence', () => {
  it('keeps policy/execution ownership while correlating request, decision, and execution', async () => {
    runtimeRecoverySupervisor.resetForTest();
    runtimeRecoverySupervisor.configure([descriptor], { currentEpoch: () => 3, executeRestart: async () => true });
    runtimeRecoverySupervisor.request({ requestId: 'runtime-op', serviceId: 'svc', source: 'HEALTH_MONITOR', faultDomain: 'DOMAIN_LOCAL', observedLifecycle: 'FAILED', observedReadiness: 'NOT_READY', observedHealth: 'FAILED', reason: 'test', lifecycleEpoch: 3, faultEvidenceRef: 'fault-ref', requestedAt: 10, provenance: ['test'] });
    await Promise.resolve(); await Promise.resolve();
    const evidence = runtimeRecoverySupervisor.getCommandFlowEvidence();
    expect(evidence.map((x) => x.name)).toEqual(expect.arrayContaining(['runtime.recovery.request', 'runtime.recovery.decision', 'runtime.recovery.execution']));
    expect(evidence.every((x) => x.correlationId === 'runtime-op')).toBe(true);
  });
});
