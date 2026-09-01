import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { RuntimeServiceDescriptor } from '../platform/runtime/lifecycleContract';
import { runtimeRecoverySupervisor } from '../platform/runtime/runtimeRecoverySupervisor';
import { DEFAULT_RECOVERY_POLICY, decideRecovery, emptyRecoveryLedger, exponentialBackoffMs, type RecoveryRequest } from '../platform/runtime/runtimeRecoveryPolicy';

const descriptor = (over: Partial<RuntimeServiceDescriptor> = {}): RuntimeServiceDescriptor => ({
  id: 'VehicleDataLayer', owner: 'test', lifecycleDomain: 'TRANSPORT', criticality: 'VEHICLE_DATA', hardDependencies: [], softDependencies: [], observationDependencies: [], unknownDependencies: [], readinessKind: 'test', restartClass: 'RUNTIME_REQUESTABLE', resourceClass: 'CORE', shutdownClass: 'LIFO_CLEANUP', bootWave: 2, faultDomain: 'VEHICLE_DATA', isolationBoundary: 'DOMAIN_LOCAL', propagationClass: 'NO_PROPAGATION', recoveryEligibility: 'RUNTIME_FUTURE', ...over,
});
const request = (over: Partial<RecoveryRequest> = {}): RecoveryRequest => ({ requestId: 'r1', serviceId: 'VehicleDataLayer', source: 'HEALTH_MONITOR', faultDomain: 'VEHICLE_DATA', observedLifecycle: 'FAILED', observedReadiness: 'NOT_READY', observedHealth: 'FAILED', reason: 'heartbeat_timeout', lifecycleEpoch: 7, faultEvidenceRef: 'test', requestedAt: 10_000, provenance: ['test'], ...over });
const decide = (over: Parameters<typeof decideRecovery>[0] extends infer T ? Partial<T> : never = {}) => decideRecovery({ request: request(), descriptor: descriptor(), currentEpoch: 7, dependencyBlocker: null, ledger: emptyRecoveryLedger(), now: 10_000, ...over } as Parameters<typeof decideRecovery>[0]);

describe('ARCH-01/F5 canonical recovery supervisor', () => {
  it('does not restart healthy or degraded evidence, and rejects stale epochs', () => {
    expect(decide({ request: request({ observedHealth: 'HEALTHY' }) }).kind).toBe('NO_ACTION');
    expect(decide({ request: request({ observedHealth: 'DEGRADED' }) }).kind).toBe('NO_ACTION');
    expect(decide({ currentEpoch: 8 }).kind).toBe('STALE_REQUEST');
  });

  it('uses deterministic budget, exponential backoff and circuit half-open rules', () => {
    expect(exponentialBackoffMs(1)).toBe(5_000); expect(exponentialBackoffMs(2)).toBe(10_000); expect(exponentialBackoffMs(9)).toBe(160_000);
    const waiting = { ...emptyRecoveryLedger(), attempts: 1, windowStartedAt: 9_000, lastAttemptAt: 9_000 };
    expect(decide({ ledger: waiting, now: 12_000 }).kind).toBe('WAIT_BACKOFF');
    const exhausted = { ...emptyRecoveryLedger(), attempts: DEFAULT_RECOVERY_POLICY.maxAttempts, windowStartedAt: 9_000, lastAttemptAt: 1_000 };
    expect(decide({ ledger: exhausted, now: 20_000 }).kind).toBe('BUDGET_EXHAUSTED');
    const open = { ...emptyRecoveryLedger(), circuitState: 'OPEN' as const, attempts: 2, windowStartedAt: 9_000 };
    expect(decide({ ledger: open, now: 20_000 }).kind).toBe('CIRCUIT_OPEN');
    const half = decide({ ledger: open, now: 9_000 + DEFAULT_RECOVERY_POLICY.windowMs });
    expect(half).toMatchObject({ kind: 'RESTART_SERVICE', circuitState: 'HALF_OPEN' });
  });

  it('blocks hard dependency recovery, delegates domain recovery, and never infers unknown restartability', () => {
    expect(decide({ dependencyBlocker: 'storage' }).kind).toBe('BLOCKED_DEPENDENCY');
    expect(decide({ descriptor: descriptor({ restartClass: 'DOMAIN_OWNED' }) }).kind).toBe('DELEGATE_DOMAIN_RECOVERY');
    expect(decide({ descriptor: descriptor({ restartClass: 'UNKNOWN' }) }).kind).toBe('DENIED');
  });

  it('deduplicates in-flight recovery, executes once, and retains bounded evidence', async () => {
    runtimeRecoverySupervisor.resetForTest(); let calls = 0; let resolve!: (value: boolean) => void;
    runtimeRecoverySupervisor.configure([descriptor()], { currentEpoch: () => 7, executeRestart: async () => { calls++; return new Promise<boolean>((done) => { resolve = done; }); } });
    expect(runtimeRecoverySupervisor.request(request()).kind).toBe('RESTART_SERVICE');
    expect(runtimeRecoverySupervisor.request(request({ requestId: 'r2' })).kind).toBe('WAIT_BACKOFF');
    expect(calls).toBe(1); resolve(true); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    const snapshot = runtimeRecoverySupervisor.snapshot();
    expect(snapshot.ledgers.VehicleDataLayer?.dedupCount).toBe(1);
    expect(snapshot.evidence.at(-1)?.executionOutcome).toBe('SUCCEEDED');
  });

  it('keeps HealthMonitor as evidence only and supervisor free of timers or boot ownership', () => {
    const health = readFileSync('src/platform/system/SystemHealthMonitor.ts', 'utf8');
    const supervisor = readFileSync('src/platform/runtime/runtimeRecoverySupervisor.ts', 'utf8');
    expect(health).toContain('recoveryRequest'); expect(health).not.toContain('restartFn');
    for (const forbidden of ['setTimeout(', 'setInterval(', '.start(', '.stop(', 'SystemBoot']) expect(supervisor).not.toContain(forbidden);
  });
});
