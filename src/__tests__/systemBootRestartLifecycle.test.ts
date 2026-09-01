/** ARCH-01 closure — SystemBoot executes; RuntimeRecoverySupervisor owns policy. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runtimeRecoverySupervisor } from '../platform/runtime/runtimeRecoverySupervisor';
import { SYSTEM_BOOT_SERVICE_DESCRIPTORS } from '../platform/runtime/runtimeServiceRegistry';

const vdl = vi.hoisted(() => ({ startCalls: 0, cleanupCalls: 0, onWorkerCrash: null as (() => void) | null, cleanups: [] as Array<() => void> }));
vi.mock('../platform/vehicleDataLayer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../platform/vehicleDataLayer')>();
  return { ...actual, startVehicleDataLayer: (opts?: { onWorkerCrash?: () => void }) => {
    vdl.startCalls++; vdl.onWorkerCrash = opts?.onWorkerCrash ?? null;
    const cleanup = (): void => { vdl.cleanupCalls++; }; vdl.cleanups.push(cleanup); return cleanup;
  } };
});

import { systemBoot } from '../platform/system/SystemBoot';

interface BootInternals { _cleanups: Array<() => void>; _namedCleanups: Map<string, () => void>; _started: boolean; _diagStarts: number; }
const boot = (): BootInternals => systemBoot as unknown as BootInternals;
const flush = async (): Promise<void> => { await vi.advanceTimersByTimeAsync(600); await Promise.resolve(); await Promise.resolve(); };

function configureSupervisor(): void {
  runtimeRecoverySupervisor.resetForTest();
  runtimeRecoverySupervisor.setShutdownActive(false);
  runtimeRecoverySupervisor.configure(SYSTEM_BOOT_SERVICE_DESCRIPTORS, {
    currentEpoch: () => boot()._started ? boot()._diagStarts : null,
    executeRestart: async (serviceId) => { await systemBoot.restartService(serviceId); return boot()._started; },
  });
}

async function activate(): Promise<void> {
  vi.useRealTimers(); const b = boot(); b._started = true; b._diagStarts = 1; b._cleanups.length = 0; b._namedCleanups.clear();
  configureSupervisor(); await systemBoot.restartService('VehicleDataLayer');
  expect(vdl.startCalls).toBe(1); expect(vdl.onWorkerCrash).toBeTypeOf('function');
}

beforeEach(() => { vdl.startCalls = 0; vdl.cleanupCalls = 0; vdl.onWorkerCrash = null; vdl.cleanups.length = 0; });
afterEach(() => { try { systemBoot.stop(); } catch { /* idempotent teardown */ } runtimeRecoverySupervisor.resetForTest(); vi.clearAllTimers(); vi.useRealTimers(); });

describe('SystemBoot restart execution boundary', () => {
  it('delegates a failed worker to the supervisor and executes one named cleanup replacement', async () => {
    await activate(); const first = vdl.cleanups[0]; vi.useFakeTimers(); vdl.onWorkerCrash!(); await flush();
    expect(vdl.startCalls).toBe(2); expect(vdl.cleanupCalls).toBe(1);
    const second = vdl.cleanups[1]; expect(boot()._namedCleanups.get('VehicleDataLayer')).toBe(second);
    expect(boot()._cleanups.filter((x) => x === first)).toHaveLength(0);
    expect(boot()._cleanups.filter((x) => x === second)).toHaveLength(1);
    expect(runtimeRecoverySupervisor.snapshot().evidence.at(-1)?.executionOutcome).toBe('SUCCEEDED');
  });

  it('deduplicates a fault storm in the supervisor rather than creating SystemBoot timers', async () => {
    await activate(); vi.useFakeTimers(); vdl.onWorkerCrash!(); vdl.onWorkerCrash!(); await flush();
    expect(vdl.startCalls).toBe(2);
    expect(runtimeRecoverySupervisor.snapshot().ledgers.VehicleDataLayer?.dedupCount).toBe(1);
    expect(boot()._cleanups).toHaveLength(1);
  });

  it('suppresses recovery execution once shutdown begins and never resurrects the service', async () => {
    await activate(); vi.useFakeTimers(); runtimeRecoverySupervisor.setShutdownActive(true); vdl.onWorkerCrash!(); await flush();
    expect(vdl.startCalls).toBe(1); expect(runtimeRecoverySupervisor.snapshot().evidence.at(-1)?.decision.kind).toBe('DENIED');
    systemBoot.stop(); await vi.advanceTimersByTimeAsync(30_000);
    expect(boot()._started).toBe(false); expect(boot()._cleanups).toHaveLength(0);
  });

  it('makes duplicate stop idempotent: one cleanup execution and no new recovery', async () => {
    await activate(); systemBoot.stop(); systemBoot.stop();
    expect(vdl.cleanupCalls).toBe(1); expect(boot()._cleanups).toHaveLength(0); expect(boot()._namedCleanups.size).toBe(0);
  });
});
