import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  LIFECYCLE_PILOT_DESCRIPTORS, allowedTransitions, decideTransition, isTransitionCurrent,
} from '../platform/runtime/lifecycleContract';
import { adaptSystemBootLifecycle } from '../platform/runtime/systemBootLifecycleAdapter';
import { CAROS_LAB_TOOLS } from '../platform/devtools/carosLabCatalog';
import { renderAvailableTool } from '../components/devtools/carosLabScreenMap';

const diag = (over: Partial<import('../platform/system/SystemBoot').SystemBootLifecycleDiagnostics> = {}) => ({
  started: false, starts: 0, stops: 0, activeCleanupCount: 0, namedCleanupKeys: [], counterMax: 1_000_000, ...over,
});

describe('ARCH-01/F1 canonical lifecycle contract', () => {
  it('whitelists valid transitions and makes invalid transitions explicit UNKNOWN violations', () => {
    expect(allowedTransitions('STARTING')).toContain('READY');
    expect(decideTransition('STARTING', 'READY')).toEqual({ allowed: true, state: 'READY', violation: null });
    expect(decideTransition('READY', 'REGISTERED')).toEqual({ allowed: false, state: 'UNKNOWN', violation: 'invalid_transition:READY->REGISTERED' });
    expect(allowedTransitions('DISPOSED')).toEqual([]);
  });

  it('keeps lifecycle, readiness and health separate in the SystemBoot pilot', () => {
    const p = adaptSystemBootLifecycle(diag({ started: true, starts: 1 }));
    expect(p.state).toBe('STARTING');
    expect(p.readiness).toBe('UNKNOWN');
    expect(p.health).toBe('UNKNOWN');
  });

  it('rejects stale generation completion', () => {
    const current = { serviceId: 'x', lifecycleEpoch: 2, operationId: 'op-2', transitionToken: 4 };
    expect(isTransitionCurrent({ ...current }, current)).toBe(true);
    expect(isTransitionCurrent({ ...current, lifecycleEpoch: 1 }, current)).toBe(false);
    expect(isTransitionCurrent({ ...current, transitionToken: 3 }, current)).toBe(false);
  });

  it('has deterministic metadata only; it does not migrate domain truth', () => {
    expect(LIFECYCLE_PILOT_DESCRIPTORS.map((x) => x.id)).toEqual(['system-boot', 'safe-storage']);
    const src = readFileSync('src/platform/runtime/lifecycleContract.ts', 'utf8');
    for (const forbidden of ['setTimeout(', 'setInterval(', '.start(', '.stop(', '.restart(', 'fetch(']) expect(src).not.toContain(forbidden);
    expect(src).toContain("'VEHICLE_SESSION'");
    expect(src).toContain("'TRANSPORT'");
  });

  it('keeps app/process facts distinct from ignition and shutdown', () => {
    const src = readFileSync('src/platform/runtime/lifecycleContract.ts', 'utf8');
    expect(src).toContain("'APP_PROCESS'");
    expect(src).toContain("'POWER'");
    expect(src).not.toMatch(/foreground\s*===\s*ignition/i);
    expect(src).not.toMatch(/process\s*===\s*shutdown/i);
  });

  it('LAB contract view is available and mapped', () => {
    expect(CAROS_LAB_TOOLS.find((x) => x.id === 'runtime-lifecycle-contract')?.status).toBe('AVAILABLE');
    expect(renderAvailableTool('runtime-lifecycle-contract')).not.toBeNull();
  });
});
