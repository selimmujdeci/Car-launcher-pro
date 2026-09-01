import { describe, expect, it } from 'vitest';
import { createPlatformEventBus } from '../platform/eventBus';
describe('ARCH-03/F10 bounded privacy-safe event observation', () => it('retains sanitized summaries without raw payload', () => {
  const bus = createPlatformEventBus({ now: () => 1 }); bus.publishName('media.playback.started', { token: 'sk_12345678901234567890', count: 1 });
  const e = bus.getRecentEvents()[0]!; expect(e.payload).toEqual({ token: '[redacted]', count: 1 }); expect(Object.isFrozen(e)).toBe(true);
}));
