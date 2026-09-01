import { describe, expect, it } from 'vitest';
import { createCommandMessage, OperationBoundary, retryAllowed } from '../platform/message';
describe('ARCH-03/F7 idempotency and retry boundary', () => it('dedups only owner-local idempotent operations and never retries non-idempotent work', () => {
  const m = createCommandMessage({ messageId: 'm', kind: 'COMMAND', name: 'media.pause', source: 'hardware', target: 'media.gateway', createdAtMs: 1, idempotencyKey: 'key', provenance: [], attempt: 0 })!;
  const b = new OperationBoundary(); expect(b.admit(m, 'IDEMPOTENT')).toBe('ACCEPTED'); expect(b.admit(m, 'IDEMPOTENT')).toBe('DUPLICATE');
  expect(retryAllowed('NON_IDEMPOTENT', 'FAILED')).toBe(false); expect(retryAllowed('IDEMPOTENT', 'TIMEOUT')).toBe(false);
}));
