import { describe, expect, it } from 'vitest';
import { buildRuntimeResilienceSnapshot } from '../platform/runtime/runtimeResilience';
import type { RuntimeRegistryEntry } from '../platform/runtime/runtimeServiceRegistry';
import type { RuntimeDependencyGraph } from '../platform/runtime/runtimeDependencyGraph';
import type { ReadinessBlockerResult } from '../platform/runtime/runtimeReadinessBlocker';

const descriptor = (id: string, criticality: RuntimeRegistryEntry['descriptor']['criticality'] = 'EXPERIENCE') => ({ id, owner: id, lifecycleDomain: 'DOMAIN_SERVICE' as const, criticality, hardDependencies: [], softDependencies: [], observationDependencies: [], unknownDependencies: [], readinessKind: 'evidence', restartClass: 'DOMAIN_OWNED' as const, resourceClass: 'CORE' as const, shutdownClass: 'LIFO_CLEANUP' as const, bootWave: null, faultDomain: 'DOMAIN_LOCAL' as const, isolationBoundary: 'DOMAIN_LOCAL' as const, propagationClass: 'NO_PROPAGATION' as const, recoveryEligibility: 'DOMAIN_OWNED' as const });
const graph: RuntimeDependencyGraph = { nodes: [], edges: [], cycles: [], validity: 'VALID' };
const blockers = (serviceId: string, readiness: ReadinessBlockerResult['readiness'], blocker: ReadinessBlockerResult['blockers'] = [], degradedBy: ReadinessBlockerResult['degradedBy'] = []): ReadinessBlockerResult => ({ serviceId, readiness, blockers: blocker, degradedBy, unknownDependencies: [], reason: 'test' });
const entry = (id: string, readiness: RuntimeRegistryEntry['readiness'], health: RuntimeRegistryEntry['health'], criticality: RuntimeRegistryEntry['descriptor']['criticality'] = 'EXPERIENCE'): RuntimeRegistryEntry => ({ descriptor: descriptor(id, criticality), lifecycle: readiness === 'READY' ? 'READY' : 'UNKNOWN', readiness, health, reason: 'test', provenance: ['test'], registeredBySystemBoot: true });

describe('ARCH-01/F9 degraded operation projection', () => {
  it('maps explicit readiness/health without creating fallback or operations', () => {
    const result = buildRuntimeResilienceSnapshot([entry('media-authority', 'READY', 'HEALTHY')], graph, [blockers('media-authority', 'READY')]);
    expect(result.capabilities[0]).toMatchObject({ availability: 'FULL', fallback: null, allowedOperations: [], deniedOperations: [] });
  });
  it('keeps navigation and media independent when no hard dependency is evidenced', () => {
    const result = buildRuntimeResilienceSnapshot([entry('NavigationSessionRuntime', 'READY', 'HEALTHY'), entry('media-authority', 'UNAVAILABLE', 'FAILED')], graph, [blockers('NavigationSessionRuntime', 'READY'), blockers('media-authority', 'UNKNOWN')]);
    expect(result.capabilities.find((x) => x.capabilityId === 'NavigationSessionRuntime')?.availability).toBe('FULL');
    expect(result.capabilities.find((x) => x.capabilityId === 'media-authority')?.availability).toBe('UNAVAILABLE');
  });
  it('maps soft degradation without forcing blocked and hard failure to blocked', () => {
    const soft = buildRuntimeResilienceSnapshot([entry('nav', 'READY', 'DEGRADED')], graph, [blockers('nav', 'DEGRADED', [], [{ kind: 'SOFT_DEPENDENCY_DEGRADED', dependency: 'map', evidence: 'test' }])]);
    expect(soft.capabilities[0].availability).toBe('DEGRADED');
    const hard = buildRuntimeResilienceSnapshot([entry('nav', 'NOT_READY', 'UNKNOWN')], graph, [blockers('nav', 'NOT_READY', [{ kind: 'HARD_DEPENDENCY_FAILED', dependency: 'storage', evidence: 'test' }])]);
    expect(hard.capabilities[0].availability).toBe('BLOCKED');
  });
  it('never invents FULL for unknown evidence or fallback', () => {
    const result = buildRuntimeResilienceSnapshot([entry('PhoneLink', 'UNKNOWN', 'UNKNOWN', 'OPTIONAL')], graph, [blockers('PhoneLink', 'UNKNOWN')]);
    expect(result.capabilities[0].availability).toBe('UNKNOWN'); expect(result.capabilities[0].fallback).toBeNull();
  });
  it('projects an evidence-backed offline navigation subset and rejects stale adapter evidence', () => {
    const adapter = { serviceId: 'nav', availability: 'LIMITED' as const, freshness: 'CURRENT' as const, allowedOperations: ['offline-route'], deniedOperations: ['online-reroute'], fallback: null, reason: 'offline graph observed', provenance: ['offlineRoutingStatus'] };
    const limited = buildRuntimeResilienceSnapshot([entry('nav', 'UNKNOWN', 'UNKNOWN')], graph, [blockers('nav', 'UNKNOWN')], [adapter]);
    expect(limited.capabilities[0]).toMatchObject({ availability: 'LIMITED', allowedOperations: ['offline-route'], deniedOperations: ['online-reroute'] });
    const stale = buildRuntimeResilienceSnapshot([entry('nav', 'READY', 'HEALTHY')], graph, [blockers('nav', 'READY')], [{ ...adapter, freshness: 'STALE' }]);
    expect(stale.capabilities[0].availability).toBe('UNKNOWN'); expect(stale.capabilities[0].allowedOperations).toEqual([]);
  });
  it('is deterministic, immutable and has bounded availability vocabulary', () => {
    const result = buildRuntimeResilienceSnapshot([entry('x', 'READY', 'HEALTHY')], graph, [blockers('x', 'READY')]);
    expect(buildRuntimeResilienceSnapshot([entry('x', 'READY', 'HEALTHY')], graph, [blockers('x', 'READY')])).toEqual(result); expect(Object.isFrozen(result)).toBe(true); expect(Object.isFrozen(result.capabilities)).toBe(true);
  });
});
