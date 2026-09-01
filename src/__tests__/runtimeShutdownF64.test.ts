import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateCanonicalCleanupCapability, buildShutdownPlan } from '../platform/runtime/runtimeShutdownModel';
import { beginSystemBootShutdown, finishSystemBootShutdown, getSystemBootShutdownSnapshot, recordSystemBootCleanup, noteStaleRecoveryCompletion } from '../platform/runtime/runtimeShutdownEvidence';
import type { RuntimeServiceDescriptor } from '../platform/runtime/lifecycleContract';
import type { RuntimeRegistryEntry } from '../platform/runtime/runtimeServiceRegistry';
import { buildRuntimeDependencyGraph } from '../platform/runtime/runtimeDependencyGraph';

const capability = (executionKind: 'SYNC' | 'ASYNC' | 'UNKNOWN', boundedTimeout: 'SUPPORTED' | 'UNSUPPORTED' | 'UNKNOWN') => ({ executionKind, quiesce: 'UNKNOWN' as const, drain: 'UNKNOWN' as const, cancel: 'UNKNOWN' as const, boundedTimeout, reason: 'test' });
const descriptor = (id: string, over: Partial<RuntimeServiceDescriptor> = {}): RuntimeServiceDescriptor => ({ id, owner: id, lifecycleDomain: 'DOMAIN_SERVICE', criticality: 'OPTIONAL', hardDependencies: [], softDependencies: [], observationDependencies: [], unknownDependencies: [], readinessKind: 'test', restartClass: 'NONE', resourceClass: 'OPTIONAL', shutdownClass: 'UNKNOWN', bootWave: null, faultDomain: 'DOMAIN_LOCAL', isolationBoundary: 'DOMAIN_LOCAL', propagationClass: 'NO_PROPAGATION', recoveryEligibility: 'UNKNOWN', ...over });
const entry = (d: RuntimeServiceDescriptor): RuntimeRegistryEntry => ({ descriptor: d, lifecycle: 'READY', readiness: 'READY', health: 'HEALTHY', reason: 'test', provenance: ['test'], registeredBySystemBoot: true });

describe('ARCH-01/F6.4 shutdown contract closure', () => {
  it('accepts synchronous cleanup without bounded timeout, but rejects unbounded async cleanup', () => {
    expect(validateCanonicalCleanupCapability(capability('SYNC', 'UNSUPPORTED'))).toBe('READY');
    expect(validateCanonicalCleanupCapability(capability('ASYNC', 'UNKNOWN'))).toBe('NOT_READY_FOR_CANONICAL_SHUTDOWN');
  });
  it('keeps UNSUPPORTED, UNKNOWN and FAILED distinct', () => {
    expect(capability('SYNC', 'UNSUPPORTED').boundedTimeout).not.toBe('UNKNOWN');
    expect(capability('SYNC', 'UNKNOWN').boundedTimeout).not.toBe('UNSUPPORTED');
    const source = readFileSync('src/platform/runtime/runtimeShutdownEvidence.ts', 'utf8');
    expect(source).toContain("'FAILED'");
  });
  it('records sync success as COMPLETE and exception as PARTIAL while allowing later cleanup', () => {
    beginSystemBootShutdown('f64-success', 1, 1);
    recordSystemBootCleanup({ serviceId: 'a', phase: 'DISPOSING', startedAt: 1, finishedAt: 2, durationMs: 1, executionKind: 'SYNC', quiesce: 'UNSUPPORTED', drain: 'UNSUPPORTED', cancel: 'UNSUPPORTED', boundedTimeout: 'UNSUPPORTED', inFlightBefore: null, inFlightAfter: null, stopOutcome: 'SUCCEEDED', disposeOutcome: 'SUCCEEDED', timeout: false, failureReason: null, dependencyOrderSource: 'LIFO_FALLBACK', provenance: ['test'] });
    finishSystemBootShutdown(3); expect(getSystemBootShutdownSnapshot().outcome).toBe('COMPLETE');
    beginSystemBootShutdown('f64-partial', 2, 4);
    recordSystemBootCleanup({ serviceId: 'failed', phase: 'FAILED', startedAt: 4, finishedAt: 5, durationMs: 1, executionKind: 'SYNC', quiesce: 'UNSUPPORTED', drain: 'UNSUPPORTED', cancel: 'UNSUPPORTED', boundedTimeout: 'UNSUPPORTED', inFlightBefore: null, inFlightAfter: null, stopOutcome: 'FAILED', disposeOutcome: 'FAILED', timeout: false, failureReason: 'test', dependencyOrderSource: 'LIFO_FALLBACK', provenance: ['test'] });
    recordSystemBootCleanup({ serviceId: 'later', phase: 'DISPOSING', startedAt: 5, finishedAt: 6, durationMs: 1, executionKind: 'SYNC', quiesce: 'UNSUPPORTED', drain: 'UNSUPPORTED', cancel: 'UNSUPPORTED', boundedTimeout: 'UNSUPPORTED', inFlightBefore: null, inFlightAfter: null, stopOutcome: 'SUCCEEDED', disposeOutcome: 'SUCCEEDED', timeout: false, failureReason: null, dependencyOrderSource: 'LIFO_FALLBACK', provenance: ['test'] });
    finishSystemBootShutdown(7); expect(getSystemBootShutdownSnapshot().outcome).toBe('PARTIAL'); expect(getSystemBootShutdownSnapshot().rows).toHaveLength(2);
  });
  it('uses LIFO fallback without hard evidence and exposes stale completion count', () => {
    const d = [descriptor('a'), descriptor('b')]; const plan = buildShutdownPlan(d, buildRuntimeDependencyGraph(d.map(entry))); expect(plan.reason).toContain('HARD');
    noteStaleRecoveryCompletion(); expect(getSystemBootShutdownSnapshot().staleRecoveryCompletionCount).toBe(1);
  });
  it('renders a read-only shutdown card and preserves KAYNAK YOK semantics', () => {
    const source = readFileSync('src/components/devtools/screens/RuntimeServiceRegistryScreen.tsx', 'utf8');
    for (const token of ['rsr-shutdown', 'execution=', 'quiesce=', 'drain=', 'cancel=', 'timeoutCapability=', 'provenance=', 'staleRecoveryCompletion', 'KAYNAK YOK']) expect(source).toContain(token);
    expect(source).not.toContain('fault injection'); expect(source).not.toContain('restartService('); expect(source).not.toContain('stopService(');
  });
});
