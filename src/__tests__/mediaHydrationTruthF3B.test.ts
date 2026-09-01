import { describe, expect, it } from 'vitest';
import { decideRecovery } from '../platform/media/authority/mediaRecovery';

const NOW = 1_800_000_000_000;
const saved = (over: Record<string, unknown> = {}) => JSON.stringify({
  version: 1, source: 'LOCAL', queueRevision: 7,
  items: [{ id: 'a', uri: 'file:///a.mp3', title: 'A' }], currentIndex: 0,
  positionMs: 12_000, shuffle: false, repeat: 'off', userPaused: false,
  lastObservedPlaying: true, savedAtMs: NOW - 1_000, recoveryAttempts: 0, ...over,
});

describe('ARCH-02/F3-B · media hydration truth boundary', () => {
  it('turns persisted playing into a paused recovery proposal, never PLAYING truth', () => {
    const decision = decideRecovery(saved(), NOW);
    expect(decision.action).toBe('RESTORE_PAUSED');
    if (decision.action === 'RESTORE_PAUSED') {
      expect(decision.autoPlay).toBe(false);
      expect(decision.state.lastObservedPlaying).toBe(true);
      expect(decision.state.positionMs).toBe(12_000);
    }
  });

  it('rejects corrupt, expired, unknown-source, empty and exhausted proposals', () => {
    expect(decideRecovery('{', NOW).action).toBe('NONE');
    expect(decideRecovery(saved({ savedAtMs: NOW - 13 * 60 * 60 * 1000 }), NOW).action).toBe('NONE');
    expect(decideRecovery(saved({ source: 'NOT_A_SOURCE' }), NOW).action).toBe('NONE');
    expect(decideRecovery(saved({ items: [] }), NOW).action).toBe('NONE');
    expect(decideRecovery(saved({ recoveryAttempts: 3 }), NOW).action).toBe('NONE');
  });
});
