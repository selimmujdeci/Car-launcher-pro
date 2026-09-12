import { describe, expect, it } from 'vitest';
import { readRuntimeResourceEvidence } from '../platform/runtime/runtimeResourceEvidence';
import { decideResourceTask } from '../platform/runtime/runtimeResourceGovernance';
describe('ARCH-01/F7.1 resource evidence adapter', () => {
  it('maps real AdaptiveRuntimeManager mode, ceiling and worker snapshot without inventing metrics', () => { const s = readRuntimeResourceEvidence(); expect(s.runtimeMode).toBeTruthy(); expect(s.provenance).toContain('AdaptiveRuntimeManager.getWorkerSnapshot()'); expect(s.thermalTier).toBeTypeOf('number'); expect(s.memoryPressure).toBe('UNKNOWN'); expect(s.tasks).toEqual([]); });
  it('keeps pressure distinct from service failure and unknown budget unavailable', () => { const s = readRuntimeResourceEvidence(); expect(s.workerSaturation).toMatch(/AVAILABLE|BUSY|SATURATED|UNKNOWN/); expect(s.tasks).toHaveLength(0); expect(decideResourceTask({ resourceClass: 'VEHICLE_REALTIME', preemptible: false, pressure: { THERMAL: 3, MEMORY: 3 } })).toBe('RUN'); });
  it('does not create scheduler, worker, polling or recovery authority', () => { const src = readRuntimeResourceEvidence.toString(); expect(src).not.toContain('scheduleTask'); expect(src).not.toContain('registerWorker'); expect(src).not.toContain('restart'); });
});
