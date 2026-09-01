import { describe, expect, it } from 'vitest';
import { runtimeManager } from '../core/runtime/AdaptiveRuntimeManager';
import { readRuntimeResourceEvidence } from '../platform/runtime/runtimeResourceEvidence';
describe('ARCH-01/F7.2 AdaptiveRuntimeManager diagnostics', () => {
  it('exposes immutable data-only diagnostics from existing manager state', () => {
    const before = runtimeManager.getMode(); const snapshot = runtimeManager.getResourceDiagnostics();
    expect(snapshot.mode).toBe(before); expect(snapshot.provenance).toContain('AdaptiveRuntimeManager._tasks');
    expect(snapshot.tasks.every((task) => !('fn' in task))).toBe(true);
    expect(snapshot.memoryPressure).toBe('UNKNOWN');
  });
  it('maps task registry metadata without inventing counters or budgets', () => {
    const cleanup = runtimeManager.scheduleTask({ id: 'f72-test', periodMs: 1000, criticality: 'NORMAL', fn: () => undefined });
    try { const task = runtimeManager.getResourceDiagnostics().tasks.find((x) => x.taskId === 'f72-test'); expect(task).toMatchObject({ cadenceMs: 1000, priority: 'NORMAL', runCount: null, requestedBudget: null, grantedBudget: null }); } finally { cleanup(); }
  });
  it('adapter consumes the single diagnostics surface and keeps absent metrics unknown', () => { const evidence = readRuntimeResourceEvidence(); expect(evidence.provenance).toContain('AdaptiveRuntimeManager._thermalActiveLevel'); expect(evidence.thermalTier).not.toBe('NORMAL'); expect(evidence.memoryPressure).toBe('UNKNOWN'); });
});
