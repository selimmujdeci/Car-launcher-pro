import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
describe('ARCH-03 final production migration guards', () => {
  it('adopts the canonical contract at the sole media side-effect gateway', () => {
    const media = read('src/platform/media/authority/mediaCommandGateway.ts');
    expect(media).toContain("from '../../message'"); expect(media).toContain('getMediaCommandFlowEvidence');
    expect(media).toContain("target: 'media.command_gateway'"); expect(media).toContain("name: 'media.command.result'");
  });
  it('retains native playback, navigation session, companion correlation and OBD transaction owners', () => {
    expect(read('src/platform/media/authority/playbackTruth.ts')).toContain('observedState');
    expect(read('src/platform/navigationService.ts')).toContain('getNavSessionId');
    expect(read('src/platform/companion/messageEnvelope.ts')).toContain('matchesRequest');
    expect(read('src/platform/obd/diagnosticTransaction.ts')).toContain('sessionEpoch');
  });
  it('keeps the event bus explicit-instance and hot streams out of the command contract', () => {
    const bus = read('src/platform/eventBus/platformEventBus.ts'); expect(bus).toContain('createPlatformEventBus');
    expect(bus).not.toContain('globalThis.platformEventBus'); expect(read('src/platform/gpsService.ts')).not.toContain("from './message'");
  });
});
