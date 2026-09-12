/** ARCH-01 closure — SystemBoot diagnostics expose boot/cleanup facts, not recovery policy. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const vdl = vi.hoisted(() => ({ startCalls: 0, cleanupCalls: 0 }));
vi.mock('../platform/vehicleDataLayer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../platform/vehicleDataLayer')>();
  return { ...actual, startVehicleDataLayer: () => { vdl.startCalls++; return (): void => { vdl.cleanupCalls++; }; } };
});
import { DIAG_COUNTER_MAX, systemBoot } from '../platform/system/SystemBoot';

interface BootInternals { _cleanups: Array<() => void>; _namedCleanups: Map<string, () => void>; _started: boolean; _diagStarts: number; _diagStops: number; }
const boot = (): BootInternals => systemBoot as unknown as BootInternals;
async function activate(): Promise<void> { const b = boot(); b._started = true; b._diagStarts = 1; b._cleanups.length = 0; b._namedCleanups.clear(); await systemBoot.restartService('VehicleDataLayer'); }
beforeEach(() => { vdl.startCalls = 0; vdl.cleanupCalls = 0; const b = boot(); b._started = false; b._cleanups.length = 0; b._namedCleanups.clear(); b._diagStarts = 0; b._diagStops = 0; });
afterEach(() => { try { systemBoot.stop(); } catch { /* idempotent teardown */ } vi.useRealTimers(); });

describe('SystemBoot canonical lifecycle diagnostics', () => {
  it('reports only boot-owned lifecycle and cleanup facts', () => {
    const d = systemBoot.getLifecycleDiagnostics();
    expect(d).toMatchObject({ started: false, starts: 0, stops: 0, activeCleanupCount: 0, namedCleanupKeys: [], counterMax: DIAG_COUNTER_MAX });
    expect(Object.isFrozen(d)).toBe(true); expect(Object.isFrozen(d.namedCleanupKeys)).toBe(true);
  });

  it('records a named cleanup once and clears it once during stop', async () => {
    await activate(); expect(systemBoot.getLifecycleDiagnostics()).toMatchObject({ started: true, activeCleanupCount: 1, namedCleanupKeys: ['VehicleDataLayer'] });
    systemBoot.stop(); const d = systemBoot.getLifecycleDiagnostics();
    expect(d).toMatchObject({ started: false, activeCleanupCount: 0, namedCleanupKeys: [] }); expect(vdl.cleanupCalls).toBe(1);
  });

  it('keeps the stop counter bounded without treating a duplicate stop as another cleanup run', async () => {
    await activate(); systemBoot.stop(); const once = systemBoot.getLifecycleDiagnostics().stops; systemBoot.stop();
    expect(systemBoot.getLifecycleDiagnostics().stops).toBe(once); expect(vdl.cleanupCalls).toBe(1);
    boot()._diagStops = DIAG_COUNTER_MAX - 1; boot()._started = true; boot()._cleanups.push(() => {}); systemBoot.stop();
    expect(systemBoot.getLifecycleDiagnostics().stops).toBe(DIAG_COUNTER_MAX);
  });

  it('does not retain a second restart/backoff truth after F5 migration', () => {
    const source = readFileSync('src/platform/system/SystemBoot.ts', 'utf8');
    for (const forbidden of ['_backoffState', 'restartAttempts:', 'restartSuccesses:', 'pendingRestarts:', 'rejectedPostStopRestarts:']) expect(source).not.toContain(forbidden);
    expect(source).toContain('runtimeRecoverySupervisor.request(');
  });
});
