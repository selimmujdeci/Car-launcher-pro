import { describe, expect, it } from 'vitest';
import { buildRuntimeServiceRegistry } from '../platform/runtime/runtimeServiceRegistry';
import { CAROS_LAB_TOOLS } from '../platform/devtools/carosLabCatalog';
import { renderAvailableTool } from '../components/devtools/carosLabScreenMap';

const input = (over: Partial<Parameters<typeof buildRuntimeServiceRegistry>[0]> = {}) => ({
  systemBoot: { started: true, starts: 1, stops: 0, namedCleanupKeys: ['VehicleDataLayer', 'GuardianRuntime'] },
  vehicleData: { active: true, source: 'vdl' }, navigation: { running: true, source: 'nav' },
  media: { authorityAvailable: false, source: 'media' }, healthByService: {}, ...over,
});

describe('ARCH-01/F2 runtime service registry projection', () => {
  it('projects exact SystemBoot named registrations without executing a DAG', () => {
    const rows = buildRuntimeServiceRegistry(input());
    expect(rows.find((x) => x.descriptor.id === 'VehicleDataLayer')).toMatchObject({ registeredBySystemBoot: true, lifecycle: 'STARTING', readiness: 'UNKNOWN' });
    expect(rows.find((x) => x.descriptor.id === 'GuardianRuntime')?.registeredBySystemBoot).toBe(true);
    expect(rows.find((x) => x.descriptor.id === 'MaintenanceBrain')?.registeredBySystemBoot).toBe(false);
    expect(rows.find((x) => x.descriptor.id === 'NavigationSessionRuntime')).toMatchObject({ registeredBySystemBoot: true, lifecycle: 'STARTING', readiness: 'UNKNOWN' });
  });

  it('does not convert active/running evidence into READY', () => {
    const vdl = buildRuntimeServiceRegistry(input()).find((x) => x.descriptor.id === 'VehicleDataLayer');
    expect(vdl?.readiness).toBe('UNKNOWN');
    expect(vdl?.reason).toContain('Resolver active observed');
  });

  it('uses explicit native authority availability as media readiness evidence only', () => {
    const rows = buildRuntimeServiceRegistry(input({ media: { authorityAvailable: true, source: 'native' } }));
    expect(rows.find((x) => x.descriptor.id === 'media-authority')).toMatchObject({ lifecycle: 'READY', readiness: 'READY', health: 'UNKNOWN' });
  });

  it('maps SystemHealthMonitor evidence without acquiring recovery authority', () => {
    const rows = buildRuntimeServiceRegistry(input({ healthByService: { VehicleDataLayer: { known: true, healthy: false, source: 'health' } } }));
    expect(rows.find((x) => x.descriptor.id === 'VehicleDataLayer')?.health).toBe('DEGRADED');
  });

  it('LAB registry is available and mapped', () => {
    expect(CAROS_LAB_TOOLS.find((x) => x.id === 'runtime-service-registry')?.status).toBe('AVAILABLE');
    expect(renderAvailableTool('runtime-service-registry')).not.toBeNull();
  });
});
