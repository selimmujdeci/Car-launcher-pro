import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (path: string): string => readFileSync(path, 'utf8');
describe('ARCH-04/F6 foreground-service boundary', () => {
  it('makes all critical requesters use the idempotent native boundary', () => {
    const boundary = read('android/app/src/main/java/com/cockpitos/pro/ForegroundServiceBoundary.java');
    expect(boundary).toContain('requestStart');
    expect(boundary).toContain('requestStop');
    for (const path of ['BootReceiver.java', 'MainActivity.java', 'CarLauncherPlugin.java', 'CommandService.java']) {
      expect(read(`android/app/src/main/java/com/cockpitos/pro/${path}`)).toContain('ForegroundServiceBoundary.requestStart');
    }
    const plugin = read('android/app/src/main/java/com/cockpitos/pro/CarLauncherPlugin.java');
    expect(plugin).not.toMatch(/ctx\.startForegroundService\(|ctx\.startService\(/);
  });
  it('does not infer a service stop from UI visibility', () => {
    const service = read('android/app/src/main/java/com/cockpitos/pro/CarLauncherForegroundService.java');
    expect(service).toContain('START_STICKY');
    expect(service).toContain('ForegroundServiceBoundary.markStopped');
  });
});
