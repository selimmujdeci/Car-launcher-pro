import { describe, expect, it } from 'vitest';
import { createCommandMessage, gateCompletion } from '../platform/message';
const request = createCommandMessage({ messageId: 'r', kind: 'COMMAND', name: 'media.seek', source: 'ui', target: 'media.gateway', createdAtMs: 1, correlationId: 'c', operationId: 'o', generation: 4, epoch: 9, provenance: [], attempt: 0 })!;
const result = createCommandMessage({ messageId: 'z', kind: 'RESULT', name: 'media.seek.result', source: 'native', target: null, createdAtMs: 2, correlationId: 'c', operationId: 'o', generation: 4, epoch: 9, provenance: [], attempt: 0 })!;
describe('ARCH-03/F3 stale completion gate', () => it('rejects old epochs, cancellation and supersession', () => {
  expect(gateCompletion({ request, completion: result, currentGeneration: 5 })).toBe('STALE');
  expect(gateCompletion({ request, completion: result, currentEpoch: 10 })).toBe('STALE');
  expect(gateCompletion({ request, completion: result, cancelled: true })).toBe('CANCELLED');
  expect(gateCompletion({ request, completion: result, superseded: true })).toBe('STALE');
}));
