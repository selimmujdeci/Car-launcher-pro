import { describe, expect, it } from 'vitest';
import { buildRuntimeResilienceSnapshot } from '../platform/runtime/runtimeResilience';
import type { RuntimeRegistryEntry } from '../platform/runtime/runtimeServiceRegistry';

const graph = { nodes: [], edges: [], cycles: [], validity: 'VALID' as const };
const descriptor = (id: string) => ({ id, owner: id, lifecycleDomain: 'DOMAIN_SERVICE' as const, criticality: 'EXPERIENCE' as const, hardDependencies: [], softDependencies: [], observationDependencies: [], unknownDependencies: [], readinessKind: 'evidence', restartClass: 'DOMAIN_OWNED' as const, resourceClass: 'CORE' as const, shutdownClass: 'LIFO_CLEANUP' as const, bootWave: null, faultDomain: 'DOMAIN_LOCAL' as const, isolationBoundary: 'DOMAIN_LOCAL' as const, propagationClass: 'NO_PROPAGATION' as const, recoveryEligibility: 'DOMAIN_OWNED' as const });
const entry = (id: string): RuntimeRegistryEntry => ({ descriptor: descriptor(id), lifecycle: 'READY', readiness: 'READY', health: 'HEALTHY', reason: 'test', provenance: ['test'], registeredBySystemBoot: true });
const blockers = (serviceId: string) => ({ serviceId, readiness: 'READY' as const, blockers: [], degradedBy: [], unknownDependencies: [], reason: 'test' });

describe('ARCH-01/F9.2 domain readiness evidence closure', () => {
  it('does not promote running/ready registry state to FULL when a domain adapter is stale', () => {
    const result = buildRuntimeResilienceSnapshot([entry('NavigationSessionRuntime')], graph, [blockers('NavigationSessionRuntime')], [{ serviceId: 'NavigationSessionRuntime', availability: 'FULL', freshness: 'STALE', allowedOperations: ['guidance'], deniedOperations: [], fallback: null, reason: 'stale route evidence', provenance: ['navigation'] }]);
    expect(result.capabilities[0].availability).toBe('UNKNOWN');
    expect(result.capabilities[0].allowedOperations).toEqual([]);
  });

  it('projects only an evidence-backed offline navigation subset', () => {
    const result = buildRuntimeResilienceSnapshot([entry('NavigationSessionRuntime')], graph, [blockers('NavigationSessionRuntime')], [{ serviceId: 'NavigationSessionRuntime', availability: 'LIMITED', freshness: 'CURRENT', allowedOperations: ['offline-route'], deniedOperations: ['online-reroute'], fallback: 'offline-map', reason: 'offline route graph observed', provenance: ['offlineRoutingStatus'], readinessEvidence: 'graph=AVAILABLE', healthEvidence: 'navigation-health=UNKNOWN' }]);
    expect(result.capabilities[0]).toMatchObject({ availability: 'LIMITED', allowedOperations: ['offline-route'], deniedOperations: ['online-reroute'], readinessEvidence: 'graph=AVAILABLE' });
  });

  it('never derives PLAYING/FULL from media authority availability alone', () => {
    const result = buildRuntimeResilienceSnapshot([entry('media-authority')], graph, [blockers('media-authority')], [{ serviceId: 'media-authority', availability: 'UNKNOWN', freshness: 'UNKNOWN', allowedOperations: [], deniedOperations: ['playback'], fallback: null, reason: 'authority present but truth not observed', provenance: ['nativeAuthorityBridge'] }]);
    expect(result.capabilities[0].availability).toBe('UNKNOWN');
    expect(result.capabilities[0].allowedOperations).toEqual([]);
  });

  it('keeps OBD admission evidence non-FULL until readiness is timestamped/current', () => {
    const result = buildRuntimeResilienceSnapshot([entry('VehicleDataLayer')], graph, [blockers('VehicleDataLayer')], [{ serviceId: 'VehicleDataLayer', availability: 'LIMITED', freshness: 'UNKNOWN', allowedOperations: ['diagnostic-read'], deniedOperations: [], fallback: null, reason: 'admission READY without freshness timestamp', provenance: ['diagnosticAdmission'] }]);
    expect(result.capabilities[0].availability).toBe('UNKNOWN');
    expect(result.capabilities[0].allowedOperations).toEqual([]);
  });

  it('does not let an unknown Phone Link owner claim FULL', () => {
    const result = buildRuntimeResilienceSnapshot([entry('PhoneLink')], graph, [blockers('PhoneLink')], [{ serviceId: 'PhoneLink', availability: 'UNKNOWN', freshness: 'CURRENT', allowedOperations: [], deniedOperations: [], fallback: null, reason: 'control plane owner unavailable', provenance: ['phoneHubLink'] }]);
    expect(result.capabilities[0].availability).toBe('UNKNOWN');
  });
});
