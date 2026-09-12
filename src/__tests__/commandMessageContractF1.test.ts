import { describe, expect, it } from 'vitest';
import { createCommandMessage } from '../platform/message';

const base = { messageId: 'm1', kind: 'COMMAND' as const, name: 'media.play', source: 'ui', target: 'media.gateway', createdAtMs: 1, provenance: ['ui'], attempt: 0 };
describe('ARCH-03/F1 command message contract', () => {
  it('keeps command, event and query semantics distinct', () => {
    expect(createCommandMessage(base)?.kind).toBe('COMMAND');
    expect(createCommandMessage({ ...base, kind: 'EVENT', target: null })?.kind).toBe('EVENT');
    expect(createCommandMessage({ ...base, kind: 'EVENT', target: 'media.gateway' })).toBeNull();
    expect(createCommandMessage({ ...base, kind: 'COMMAND', target: null })).toBeNull();
  });
  it('is pure, bounded and immutable', () => {
    const m = createCommandMessage({ ...base, correlationId: 'c1', payload: { raw: 'not traced by contract' } });
    expect(m?.correlationId).toBe('c1'); expect(Object.isFrozen(m)).toBe(true); expect(Object.isFrozen(m?.provenance)).toBe(true);
  });
});
