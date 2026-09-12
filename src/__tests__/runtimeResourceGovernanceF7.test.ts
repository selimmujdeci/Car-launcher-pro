import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cadenceForDomain, decideResourceTask } from '../platform/runtime/runtimeResourceGovernance';

describe('ARCH-01/F7 resource governance contract', () => {
  it('protects safety/vehicle work and throttles background work under thermal pressure', () => {
    const pressure = { THERMAL: 3 as const, MEMORY: 0 as const };
    expect(decideResourceTask({ resourceClass: 'VEHICLE_REALTIME', preemptible: false, pressure })).toBe('RUN');
    expect(decideResourceTask({ resourceClass: 'BACKGROUND_HIGH', preemptible: true, pressure })).toBe('THROTTLE');
    expect(decideResourceTask({ resourceClass: 'BEST_EFFORT', preemptible: true, pressure })).toBe('DENY');
  });
  it('keeps unknown conservative and delegates OBD cadence', () => {
    expect(decideResourceTask({ resourceClass: 'UNKNOWN', preemptible: null, pressure: { THERMAL: 'UNKNOWN', MEMORY: 'UNKNOWN' } })).toBe('UNKNOWN');
    expect(cadenceForDomain('OBD', 3)).toBe('DELEGATE_DOMAIN_CADENCE');
    expect(cadenceForDomain('UNKNOWN', 'UNKNOWN')).toBe('UNKNOWN');
  });
  it('does not treat resource pressure as service failure or allow media stop authority', () => {
    const source = readFileSync('src/platform/runtime/runtimeResourceGovernance.ts', 'utf8');
    expect(source).not.toContain('restart'); expect(source).not.toContain('stopMedia');
  });
  it('drops only stale best-effort work and remains deterministic', () => {
    const task = { resourceClass: 'BEST_EFFORT' as const, preemptible: true, pressure: { THERMAL: 0 as const, MEMORY: 0 as const }, stale: true };
    expect(decideResourceTask(task)).toBe('DROP_STALE'); expect(decideResourceTask(task)).toBe('DROP_STALE');
  });
});
