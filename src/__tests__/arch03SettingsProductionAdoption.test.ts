import { describe, expect, it, vi } from 'vitest';
import { getPerformanceModeCommandFlowEvidence, getPerformanceMode, setPerformanceMode } from '../platform/performanceMode';

describe('ARCH-03 Settings production evidence', () => {
  it('separates storage acceptance from runtime apply and never stores a setting value in evidence', () => {
    const failingStorage = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    setPerformanceMode(getPerformanceMode() === 'lite' ? 'premium' : 'lite');
    const evidence = getPerformanceModeCommandFlowEvidence();
    expect(evidence.map((x) => x.name)).toEqual(expect.arrayContaining(['settings.declared.persist', 'settings.declared.result', 'settings.runtime.apply', 'settings.runtime.result']));
    expect(evidence.some((x) => x.causationId === 'PERSISTENCE_FAILED')).toBe(true);
    expect(evidence.every((x) => x.payload === null)).toBe(true);
    failingStorage.mockRestore();
  });
});
