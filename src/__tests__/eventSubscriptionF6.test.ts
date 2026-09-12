import { describe, expect, it } from 'vitest';
import { createPlatformEventBus } from '../platform/eventBus';
describe('ARCH-03/F6 event subscription safety', () => it('deduplicates a listener and supports idempotent cleanup', () => {
  const bus = createPlatformEventBus({ now: () => 1 }); let calls = 0; const listener = () => { calls++; };
  const a = bus.subscribe('media.playback.started', listener); const b = bus.subscribe('media.playback.started', listener);
  expect(a).toBe(b); bus.publishName('media.playback.started'); expect(calls).toBe(1); expect(bus.unsubscribe(a!)).toBe(true); expect(bus.unsubscribe(a!)).toBe(false);
}));
