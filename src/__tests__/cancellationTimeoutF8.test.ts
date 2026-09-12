import { describe, expect, it } from 'vitest';
import { aggregateOutcomes, retryAllowed } from '../platform/message';
describe('ARCH-03/F8 cancellation timeout and partial completion', () => it('does not convert uncertainty to failure or full success', () => {
  expect(retryAllowed('IDEMPOTENT', 'UNKNOWN_OUTCOME')).toBe(false);
  expect(aggregateOutcomes(['SUCCESS', 'FAILED'])).toBe('PARTIAL');
  expect(aggregateOutcomes(['CANCELLED', 'CANCELLED'])).toBe('CANCELLED');
}));
