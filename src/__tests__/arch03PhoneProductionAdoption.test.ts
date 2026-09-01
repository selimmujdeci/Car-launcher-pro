import { describe, expect, it } from 'vitest';
import { createCompanionSessionManager, createMockTransport } from '../platform/companion';

describe('ARCH-03 Phone Link production evidence', () => {
  it('records a session-bound request and its rejected result without payload leakage', () => {
    let n = 0;
    const manager = createCompanionSessionManager({ transport: createMockTransport({ adapterId: 'arch03' }), now: () => 100, newId: (p) => `${p}-${++n}` });
    manager.beginSession('redacted-peer');
    manager.send('companion.control.media', { token: 'must-not-escape' }, 999);
    const evidence = manager.getCommandFlowEvidence();
    expect(evidence).toHaveLength(2);
    expect(evidence[0]).toMatchObject({ kind: 'REQUEST', target: 'companion_session_manager' });
    expect(evidence[1]).toMatchObject({ kind: 'RESULT', correlationId: evidence[0]?.correlationId, operationId: evidence[0]?.operationId });
    expect(JSON.stringify(evidence)).not.toContain('must-not-escape');
  });
});
