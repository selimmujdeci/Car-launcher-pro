/** ARCH-01/F0 — structural authority locks; no runtime lifecycle is started here. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  RUNTIME_AUTHORITY_INVARIANTS, RUNTIME_AUTHORITY_MAP,
} from '../platform/devtools/runtimeAuthorityModel';
import { CAROS_LAB_TOOLS } from '../platform/devtools/carosLabCatalog';
import { renderAvailableTool } from '../components/devtools/carosLabScreenMap';

const read = (path: string) => readFileSync(path, 'utf8');

describe('ARCH-01/F0 runtime authority locks', () => {
  it('I1: App has one TS top-level boot call and delegates it to SystemBoot', () => {
    const app = read('src/App.tsx');
    expect((app.match(/systemBoot\.start\(\)/g) ?? [])).toHaveLength(1);
    expect((app.match(/systemBoot\.stop\(\)/g) ?? [])).toHaveLength(1);
    expect(read('src/platform/system/SystemBoot.ts')).toContain('class SystemBoot');
  });

  it('I2/I3: resource execution and domain lifecycle owners stay explicit', () => {
    const resource = RUNTIME_AUTHORITY_MAP.find((x) => x.id === 'resource');
    expect(resource?.canonicalOwner).toBe('AdaptiveRuntimeManager');
    for (const id of ['vehicle-data', 'navigation', 'music', 'mavi', 'phone-link']) {
      expect(RUNTIME_AUTHORITY_MAP.some((x) => x.id === id && x.kind === 'DOMAIN_LIFECYCLE')).toBe(true);
    }
  });

  it('I4/I7/I9: real overlaps are recorded rather than hidden', () => {
    for (const id of ['health', 'foreground-service', 'hydration']) {
      const row = RUNTIME_AUTHORITY_MAP.find((x) => x.id === id);
      expect(row?.evidence).toBe('KNOWN_OVERLAP');
      expect(row?.knownDebt).toBeTruthy();
    }
    expect(read('src/platform/system/SystemHealthMonitor.ts')).toContain('recoveryRequest');
    expect(read('src/platform/system/SystemHealthMonitor.ts')).not.toContain('restartFn');
  });

  it('I5/I6: no shortcut equates app lifecycle with ignition truth', () => {
    const app = read('src/App.tsx');
    expect(app).not.toMatch(/appStateChange[\s\S]{0,160}ignition/i);
    const authority = read('src/platform/devtools/runtimeAuthorityModel.ts');
    expect(authority).toContain('UNKNOWN_IS_REAL');
    expect(authority).toContain('APP_NE_VEHICLE_LIFECYCLE');
  });

  it('I8/I10: timer and explicit shutdown ownership are present in the map', () => {
    expect(RUNTIME_AUTHORITY_MAP.some((x) => x.timerOwner !== null)).toBe(true);
    expect(RUNTIME_AUTHORITY_MAP.find((x) => x.id === 'shutdown')?.canonicalOwner).toContain('SystemBoot LIFO cleanup');
    expect(RUNTIME_AUTHORITY_INVARIANTS).toContain('I10 SHUTDOWN_MUST_BE_EXPLICIT: cleanup ownership is recorded; process death is not cleanup.');
  });

  it('LAB is available, mapped, and model remains side-effect free', () => {
    expect(CAROS_LAB_TOOLS.find((x) => x.id === 'runtime-authority-map')?.status).toBe('AVAILABLE');
    expect(renderAvailableTool('runtime-authority-map')).not.toBeNull();
    const model = read('src/platform/devtools/runtimeAuthorityModel.ts');
    for (const forbidden of ['setTimeout(', 'setInterval(', '.start(', '.stop(', '.restart(', 'fetch(']) {
      expect(model).not.toContain(forbidden);
    }
  });
});
