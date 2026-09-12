import { describe, expect, it } from 'vitest';
import { createCommandMessage, resultMatchesRequest } from '../platform/message';
const req = createCommandMessage({ messageId: 'r', kind: 'REQUEST', name: 'navigation.route.request', source: 'navigation', target: 'provider', createdAtMs: 1, correlationId: 'c', operationId: 'o', provenance: [], attempt: 0 })!;
describe('ARCH-03/F2 correlation', () => it('rejects wrong correlation or operation', () => {
  const ok = createCommandMessage({ messageId: 'x', kind: 'RESULT', name: 'navigation.route.result', source: 'provider', target: null, createdAtMs: 2, correlationId: 'c', operationId: 'o', provenance: [], attempt: 0 })!;
  expect(resultMatchesRequest(req, ok)).toBe(true);
  expect(resultMatchesRequest(req, { ...ok, correlationId: 'other' })).toBe(false);
  expect(resultMatchesRequest(req, { ...ok, operationId: 'other' })).toBe(false);
}));
