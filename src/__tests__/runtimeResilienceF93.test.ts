import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildRuntimeResilienceSnapshot } from '../platform/runtime/runtimeResilience';
import { getSafeStorageDiagnostics } from '../utils/safeStorage';
import { getMaviVoiceWiringDiagnostics } from '../platform/system/platformCoreMaviVoiceWiring';

const graph = { nodes: [], edges: [], cycles: [], validity: 'VALID' as const };
const descriptor = (id: string) => ({ id, owner: id, lifecycleDomain: 'DOMAIN_SERVICE' as const, criticality: 'EXPERIENCE' as const, hardDependencies: [], softDependencies: [], observationDependencies: [], unknownDependencies: [], readinessKind: 'evidence', restartClass: 'DOMAIN_OWNED' as const, resourceClass: 'CORE' as const, shutdownClass: 'LIFO_CLEANUP' as const, bootWave: null, faultDomain: 'DOMAIN_LOCAL' as const, isolationBoundary: 'DOMAIN_LOCAL' as const, propagationClass: 'NO_PROPAGATION' as const, recoveryEligibility: 'DOMAIN_OWNED' as const });
const entry = (id: string) => ({ descriptor: descriptor(id), lifecycle: 'READY' as const, readiness: 'READY' as const, health: 'HEALTHY' as const, reason: 'test', provenance: ['test'], registeredBySystemBoot: true });
const blocker = (serviceId: string) => ({ serviceId, readiness: 'READY' as const, blockers: [], degradedBy: [], unknownDependencies: [], reason: 'test' });

describe('ARCH-01/F9.3 missing-domain evidence closure', () => {
  it('publishes read-only Mavi and storage owner diagnostics without claiming readiness', () => {
    expect(getMaviVoiceWiringDiagnostics()).toMatchObject({ active: false, observedAt: null });
    expect(getSafeStorageDiagnostics()).toMatchObject({ writable: 'UNKNOWN', observedAt: null });
  });

  it('allows Phone Link FULL only with current established control-plane evidence', () => {
    const result = buildRuntimeResilienceSnapshot([entry('PhoneLink')], graph, [blocker('PhoneLink')], [{ serviceId: 'PhoneLink', availability: 'FULL', freshness: 'CURRENT', allowedOperations: ['phone-link-control-plane'], deniedOperations: [], fallback: null, reason: 'established', provenance: ['phoneHubLink'], readinessEvidence: 'trulyEstablished=true' }]);
    expect(result.capabilities[0]).toMatchObject({ availability: 'FULL', allowedOperations: ['phone-link-control-plane'] });
  });

  it('keeps Mavi, storage and unknown network evidence out of fake FULL states', () => {
    const result = buildRuntimeResilienceSnapshot([entry('MaviRuntime'), entry('safe-storage'), entry('CommunityService')], graph, [blocker('MaviRuntime'), blocker('safe-storage'), blocker('CommunityService')], [
      { serviceId: 'MaviRuntime', availability: 'UNKNOWN', freshness: 'UNKNOWN', allowedOperations: [], deniedOperations: [], fallback: null, reason: 'no current owner timestamp', provenance: ['mavi'] },
      { serviceId: 'safe-storage', availability: 'UNKNOWN', freshness: 'UNKNOWN', allowedOperations: ['runtime-read'], deniedOperations: ['persistence-write'], fallback: null, reason: 'write unproven', provenance: ['storage'] },
      { serviceId: 'CommunityService', availability: 'UNKNOWN', freshness: 'UNKNOWN', allowedOperations: [], deniedOperations: [], fallback: null, reason: 'network unmeasured', provenance: ['network'] },
    ]);
    expect(result.capabilities.every((x) => x.availability !== 'FULL')).toBe(true);
  });

  it('keeps explicit offline-only network capability unavailable without affecting offline peers', () => {
    const result = buildRuntimeResilienceSnapshot([entry('CommunityService'), entry('NavigationSessionRuntime'), entry('media-authority')], graph, [blocker('CommunityService'), blocker('NavigationSessionRuntime'), blocker('media-authority')], [{ serviceId: 'CommunityService', availability: 'UNAVAILABLE', freshness: 'CURRENT', allowedOperations: [], deniedOperations: ['network-community-sync'], fallback: null, reason: 'offline', provenance: ['navigator.onLine=false'] }]);
    expect(result.capabilities.find((x) => x.capabilityId === 'CommunityService')?.availability).toBe('UNAVAILABLE');
    expect(result.capabilities.find((x) => x.capabilityId === 'NavigationSessionRuntime')?.availability).toBe('FULL');
    expect(result.capabilities.find((x) => x.capabilityId === 'media-authority')?.availability).toBe('FULL');
  });

  it('keeps adapters read-only: no recovery, fallback execution, timers, or native pulls', () => {
    const source = readFileSync('src/platform/runtime/runtimeDomainAvailabilityAdapters.ts', 'utf8');
    expect(source).not.toMatch(/refreshPhoneHubLink|startMaviVoiceWiring|stopMaviVoiceWiring|setInterval|setTimeout|restart|recover/i);
  });
});
