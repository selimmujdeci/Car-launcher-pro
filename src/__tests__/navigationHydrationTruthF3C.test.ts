import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(process.cwd(), 'src/platform/navigationService.ts'), 'utf8');
const restore = source.slice(source.indexOf('export async function restoreNavigationAsync'), source.indexOf('// ETA hysteresis'));

describe('ARCH-02/F3-C · navigation hydration truth boundary', () => {
  it('restores a persisted destination only as PREVIEW intent, not active guidance', () => {
    expect(restore).toContain("startNavigation(persist.destination, false, 'SESSION_RESTORE')");
    expect(restore).toContain('_sealNavState(persist.destination, 0, false)');
    expect(restore).not.toContain('activateNavigation()');
    expect(restore).not.toContain('useUnifiedVehicleStore.subscribe');
  });

  it('does not promote persisted step, ETA, maneuver, route or off-route state', () => {
    for (const forbidden of ['etaSeconds:', 'maneuver', 'fetchRoute(', 'updateNavigationProgress(', 'setRerouting(']) {
      expect(restore).not.toContain(forbidden);
    }
  });
});
