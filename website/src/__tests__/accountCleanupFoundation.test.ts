import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountCleanupCoordinator } from '@/security/accountCleanup/AccountCleanupCoordinator';
import {
  CLEANUP_LEDGER_KEY,
  CleanupLedger,
  type CleanupLedgerStorage,
} from '@/security/accountCleanup/cleanupLedger';
import {
  activateAccountSecurityLockdown,
  captureCleanupGeneration,
  getAccountSecurityLockdownState,
  isCleanupGenerationCurrent,
  releaseAccountSecurityLockdown,
  resetAccountSecurityLockdownForTests,
} from '@/security/accountCleanup/cleanupLockdown';
import { CleanupParticipantRegistry } from '@/security/accountCleanup/cleanupParticipantRegistry';
import { evaluateCleanupBootGate } from '@/security/accountCleanup/cleanupBootGate';
import {
  assertCleanupTransition,
  canTransition,
} from '@/security/accountCleanup/cleanupStateMachine';
import type {
  AccountCleanupParticipant,
  CleanupContext,
  CleanupLedgerEntry,
  CleanupParticipantResult,
  CleanupPhase,
} from '@/security/accountCleanup/cleanupTypes';

class MemoryStorage implements CleanupLedgerStorage {
  raw: string | null = null;
  throwRead = false;
  throwWrite = false;

  read(): string | null {
    if (this.throwRead) throw new Error('read denied');
    return this.raw;
  }

  write(value: string): void {
    if (this.throwWrite) throw new Error('write denied');
    this.raw = value;
  }

  remove(): void {
    this.raw = null;
  }
}

function participant(
  id: string,
  phase: CleanupPhase,
  priority: number,
  result: CleanupParticipantResult = { ok: true, code: 'CLEARED' },
  verify = true,
): AccountCleanupParticipant {
  return {
    id,
    phase,
    priority,
    clear: vi.fn(async () => result),
    ...(phase === 'VERIFY_EMPTY'
      ? { verifyEmpty: vi.fn(async () => verify) }
      : {}),
  };
}

function setup(
  participants: AccountCleanupParticipant[] = defaultParticipants(),
) {
  const storage = new MemoryStorage();
  const ledger = new CleanupLedger(storage);
  const registry = new CleanupParticipantRegistry();
  participants.forEach((item) => registry.register(item));
  let id = 0;
  let now = 1_000;
  const coordinator = new AccountCleanupCoordinator(ledger, registry, {
    newId: () => `cleanup-${++id}`,
    now: () => ++now,
    hashAccountId: async (accountId) => `hash:${accountId.length}`,
  });
  return { storage, ledger, registry, coordinator };
}

function defaultParticipants(): AccountCleanupParticipant[] {
  return [
    participant('secret', 'LOCAL_SECRET_PURGE', 0),
    participant('private', 'LOCAL_PRIVATE_DATA_PURGE', 0),
    participant('queue', 'QUEUE_AND_SNAPSHOT_PURGE', 0),
    participant('session', 'SERVER_SESSION_REVOKE', 0),
    participant('device-push', 'DEVICE_AND_PUSH_REVOKE', 0),
    participant('verify', 'VERIFY_EMPTY', 0),
  ];
}

function withDefaults(
  ...overrides: AccountCleanupParticipant[]
): AccountCleanupParticipant[] {
  const byPhase = new Map<CleanupPhase, AccountCleanupParticipant>(
    defaultParticipants().map((item) => [item.phase, item]),
  );
  overrides.forEach((item) => byPhase.set(item.phase, item));
  return Array.from(byPhase.values());
}

function ledgerEntry(
  patch: Partial<CleanupLedgerEntry> = {},
): CleanupLedgerEntry {
  return {
    cleanupId: 'cleanup-recovery',
    requestedAt: 100,
    reason: 'logout',
    state: 'LOCAL_PRIVATE_DATA_PURGE',
    completedSteps: ['REQUESTED', 'LOCAL_SECRET_PURGE'],
    retryCount: 0,
    lastAttemptAt: 110,
    schemaVersion: 2,
    generation: 1,
    ...patch,
  };
}

beforeEach(() => {
  resetAccountSecurityLockdownForTests();
});

describe('cleanup state machine', () => {
  it('1. canonical valid transitions are accepted', () => {
    expect(canTransition('IDLE', 'REQUESTED')).toBe(true);
    expect(canTransition('REQUESTED', 'LOCAL_LOCKDOWN')).toBe(true);
    expect(canTransition('VERIFY_EMPTY', 'COMPLETED')).toBe(true);
  });

  it('2. invalid transitions throw a typed safe code', () => {
    expect(canTransition('REQUESTED', 'COMPLETED')).toBe(false);
    expect(() => assertCleanupTransition('REQUESTED', 'COMPLETED'))
      .toThrow('INVALID_STATE_TRANSITION:REQUESTED:COMPLETED');
  });
});

describe('durable cleanup ledger', () => {
  it('3. creates and reads a valid ledger entry', () => {
    const { ledger } = setup();
    const entry = ledgerEntry();
    expect(ledger.write(entry)).toBe(true);
    expect(ledger.read()).toEqual({ ok: true, entry });
  });

  it('4. corrupted JSON fails closed', () => {
    const { storage, ledger } = setup();
    storage.raw = '{bad-json';
    expect(ledger.read()).toEqual({
      ok: false,
      failureCode: 'LEDGER_CORRUPTED',
    });
  });

  it('5. unknown future schema fails closed', () => {
    const { storage, ledger } = setup();
    storage.raw = JSON.stringify({ ...ledgerEntry(), schemaVersion: 3 });
    expect(ledger.read()).toEqual({
      ok: false,
      failureCode: 'LEDGER_CORRUPTED',
    });
  });

  it('quarantines an active fingerprintless schema-v1 ledger', () => {
    const { storage, ledger } = setup();
    storage.raw = JSON.stringify({
      ...ledgerEntry(),
      schemaVersion: 1,
      previousAccountHash: 'legacy-account-hash',
      expectedSessionFingerprint: undefined,
    });
    expect(ledger.read()).toEqual({
      ok: false,
      failureCode: 'LEGACY_TARGET_UNVERIFIABLE',
    });
  });

  it('rejects a schema-v2 account target without a fingerprint', () => {
    const { storage, ledger } = setup();
    storage.raw = JSON.stringify({
      ...ledgerEntry(),
      previousAccountHash: 'account-hash',
      expectedSessionFingerprint: undefined,
    });
    expect(ledger.read()).toEqual({
      ok: false,
      failureCode: 'LEDGER_CORRUPTED',
    });
  });

  it('19. raw account ID and known secret fields are not persisted', async () => {
    const { storage, coordinator } = setup();
    await coordinator.requestCleanup({
      reason: 'logout',
      previousAccountId: 'raw-user@example.test',
      expectedSessionFingerprint: 'fingerprint-a',
    });
    expect(storage.raw).not.toContain('raw-user@example.test');
    expect(storage.raw).not.toContain('access_token');
    expect(storage.raw).not.toContain('refresh_token');
    expect(storage.raw).not.toContain('apiKey');
    expect(storage.raw).not.toContain('pinHash');
  });

  it('uses the canonical versioned browser storage key', () => {
    expect(CLEANUP_LEDGER_KEY).toBe('caros:security:account-cleanup:v1');
  });
});

describe('synchronous lockdown and generation', () => {
  it('6. lockdown activates before the request promise settles', () => {
    const blocker = participant('slow', 'LOCAL_SECRET_PURGE', 0);
    let release!: () => void;
    blocker.clear = vi.fn(() => new Promise<CleanupParticipantResult>((resolve) => {
      release = () => resolve({ ok: true, code: 'CLEARED' });
    }));
    const { coordinator } = setup(withDefaults(
      blocker,
    ));
    const run = coordinator.requestCleanup({ reason: 'logout' });
    expect(coordinator.isLockedDown()).toBe(true);
    release();
    return run;
  });

  it('7. every cleanup start increments generation', async () => {
    const { coordinator } = setup();
    const before = captureCleanupGeneration();
    await coordinator.requestCleanup({ reason: 'logout' });
    const afterFirst = captureCleanupGeneration();
    await coordinator.requestCleanup({ reason: 'logout' });
    expect(afterFirst).toBe(before + 1);
    expect(captureCleanupGeneration()).toBe(afterFirst + 1);
  });

  it('8. a pre-cleanup generation is rejected as late', async () => {
    const { coordinator } = setup();
    const captured = captureCleanupGeneration();
    await coordinator.requestCleanup({ reason: 'logout' });
    expect(isCleanupGenerationCurrent(captured)).toBe(false);
    expect(isCleanupGenerationCurrent(captureCleanupGeneration())).toBe(true);
  });
});

describe('participant registry', () => {
  it('9. preserves stable registration order for equal priorities', () => {
    const registry = new CleanupParticipantRegistry();
    const a = participant('a', 'LOCAL_SECRET_PURGE', 10);
    const b = participant('b', 'LOCAL_SECRET_PURGE', 10);
    const first = participant('first', 'LOCAL_SECRET_PURGE', 1);
    registry.register(a);
    registry.register(b);
    registry.register(first);
    expect(registry.listForPhase('LOCAL_SECRET_PURGE').map((item) => item.id))
      .toEqual(['first', 'a', 'b']);
  });

  it('10. rejects duplicate participant IDs', () => {
    const registry = new CleanupParticipantRegistry();
    registry.register(participant('same', 'LOCAL_SECRET_PURGE', 0));
    expect(() =>
      registry.register(participant('same', 'VERIFY_EMPTY', 0)))
      .toThrow('DUPLICATE_PARTICIPANT_ID:same');
  });
});

describe('coordinator execution', () => {
  it('11. repeated concurrent request shares one cleanup promise/run', async () => {
    let release!: () => void;
    const slow = participant('slow', 'LOCAL_SECRET_PURGE', 0);
    slow.clear = vi.fn(() => new Promise<CleanupParticipantResult>((resolve) => {
      release = () => resolve({ ok: true, code: 'CLEARED' });
    }));
    const { coordinator } = setup(withDefaults(
      slow,
    ));
    const first = coordinator.requestCleanup({ reason: 'logout' });
    const second = coordinator.requestCleanup({ reason: 'session_expired' });
    expect(first).toBe(second);
    release();
    await expect(first).resolves.toMatchObject({ ok: true });
    expect(slow.clear).toHaveBeenCalledTimes(1);
  });

  it('12. a successful completed run allows a later distinct cleanup', async () => {
    const verify = participant('verify', 'VERIFY_EMPTY', 0);
    const { coordinator } = setup(withDefaults(verify));
    const first = await coordinator.requestCleanup({ reason: 'logout' });
    const second = await coordinator.requestCleanup({ reason: 'logout' });
    expect(first.cleanupId).not.toBe(second.cleanupId);
    expect(verify.clear).toHaveBeenCalledTimes(2);
  });

  it('13. retryable participant failure stays locked and typed', async () => {
    const bad = participant('network', 'SERVER_SESSION_REVOKE', 0, {
      ok: false,
      retryable: true,
      failureCode: 'NETWORK_DOWN',
    });
    const { coordinator } = setup(withDefaults(
      bad,
    ));
    await expect(coordinator.requestCleanup({ reason: 'logout' })).resolves
      .toMatchObject({
        ok: false,
        state: 'FAILED_RETRYABLE',
        failureCode: 'PARTICIPANT_FAILED_RETRYABLE',
      });
    expect(coordinator.isLockedDown()).toBe(true);
  });

  it('14. blocking participant failure stays locked and typed', async () => {
    const bad = participant('secret', 'LOCAL_SECRET_PURGE', 0, {
      ok: false,
      retryable: false,
      failureCode: 'PURGE_DENIED',
    });
    const { coordinator } = setup(withDefaults(
      bad,
    ));
    await expect(coordinator.requestCleanup({ reason: 'logout' })).resolves
      .toMatchObject({
        ok: false,
        state: 'FAILED_BLOCKING',
        failureCode: 'PARTICIPANT_FAILED_BLOCKING',
      });
    expect(coordinator.isLockedDown()).toBe(true);
  });

  it('15. verify-empty false blocks completion', async () => {
    const { coordinator } = setup(withDefaults(
      participant('verify', 'VERIFY_EMPTY', 0, {
        ok: true,
        code: 'CLEARED',
      }, false),
    ));
    await expect(coordinator.requestCleanup({ reason: 'logout' })).resolves
      .toMatchObject({
        ok: false,
        state: 'FAILED_BLOCKING',
        failureCode: 'VERIFY_EMPTY_FAILED',
      });
  });

  it('16. completion is persisted only after verify-empty succeeds', async () => {
    const verify = participant('verify', 'VERIFY_EMPTY', 0);
    const { coordinator } = setup(withDefaults(verify));
    const result = await coordinator.requestCleanup({ reason: 'logout' });
    expect(result).toMatchObject({ ok: true, state: 'COMPLETED' });
    expect(verify.verifyEmpty).toHaveBeenCalledOnce();
    expect(coordinator.getCurrentLedger()?.state).toBe('COMPLETED');
    expect(coordinator.isLockedDown()).toBe(false);
  });

  it('fails blocking instead of completing with missing phase participants', async () => {
    const { coordinator } = setup([]);
    await expect(coordinator.requestCleanup({ reason: 'logout' })).resolves
      .toMatchObject({
        ok: false,
        failureCode: 'MISSING_PHASE_PARTICIPANT',
      });
  });

  it('20. rejects an unknown reason before creating authority state', async () => {
    const { coordinator } = setup();
    const result = await coordinator.requestCleanup({
      reason: 'other' as 'logout',
    });
    expect(result).toMatchObject({
      ok: false,
      failureCode: 'UNKNOWN_CLEANUP_REASON',
    });
    expect(coordinator.getCurrentLedger()).toBeNull();
  });
});

describe('process-death recovery', () => {
  it('17. resumes an incomplete durable ledger from first incomplete phase', async () => {
    const privatePurge = participant(
      'private',
      'LOCAL_PRIVATE_DATA_PURGE',
      0,
    );
    const { storage, ledger, coordinator } = setup(withDefaults(
      privatePurge,
    ));
    storage.raw = JSON.stringify(ledgerEntry());
    const result = await coordinator.recoverPendingCleanup();
    expect(result).toMatchObject({ ok: true, state: 'COMPLETED' });
    expect(privatePurge.clear).toHaveBeenCalledOnce();
    expect(ledger.read()).toMatchObject({
      ok: true,
      entry: { state: 'COMPLETED', retryCount: 1 },
    });
  });

  it('18. completed ledger recovery is a no-op', async () => {
    const { storage, coordinator } = setup();
    storage.raw = JSON.stringify(ledgerEntry({
      state: 'COMPLETED',
      completedAt: 200,
    }));
    await expect(coordinator.recoverPendingCleanup()).resolves.toBeNull();
  });

  it('corrupted recovery activates fail-closed lockdown', async () => {
    const { storage, coordinator } = setup();
    storage.raw = 'corrupted';
    await expect(coordinator.recoverPendingCleanup()).resolves.toMatchObject({
      ok: false,
      failureCode: 'LEDGER_CORRUPTED',
    });
    expect(coordinator.isLockedDown()).toBe(true);
  });
});

describe('foundation boot gate', () => {
  it('21. active cleanup returns recovery-required', () => {
    const { ledger } = setup();
    activateAccountSecurityLockdown('cleanup-live', 'logout', 1);
    expect(evaluateCleanupBootGate(ledger, true)).toMatchObject({
      status: 'CLEANUP_RECOVERY_REQUIRED',
      coverage: 'FOUNDATION_ONLY',
    });
    releaseAccountSecurityLockdown('cleanup-live');
  });

  it('22. corrupted storage returns STORAGE_CORRUPTED', () => {
    const { storage, ledger } = setup();
    storage.raw = '{';
    expect(evaluateCleanupBootGate(ledger, true)).toEqual({
      status: 'STORAGE_CORRUPTED',
      coverage: 'FOUNDATION_ONLY',
    });
  });

  it('does not call unauthenticated boot safe', () => {
    const { ledger } = setup();
    expect(evaluateCleanupBootGate(ledger, false)).toEqual({
      status: 'AUTH_REQUIRED',
      coverage: 'FOUNDATION_ONLY',
    });
  });

  it('marks the current implementation coverage as foundation-only', () => {
    const { ledger } = setup();
    expect(evaluateCleanupBootGate(ledger, true)).toEqual({
      status: 'SAFE_TO_START',
      coverage: 'FOUNDATION_ONLY',
    });
  });
});

describe('privacy-safe context', () => {
  it('participant context contains only account hash, never raw account ID', async () => {
    let received: CleanupContext | null = null;
    const capture = participant('capture', 'LOCAL_SECRET_PURGE', 0);
    capture.clear = vi.fn(async (context: CleanupContext): Promise<CleanupParticipantResult> => {
      received = context;
      return { ok: true, code: 'CLEARED' };
    });
    const { coordinator } = setup(withDefaults(
      capture,
    ));
    await coordinator.requestCleanup({
      reason: 'logout',
      previousAccountId: 'raw-account-id',
      expectedSessionFingerprint: 'fingerprint-a',
    });
    expect(received).toMatchObject({ previousAccountHash: 'hash:14' });
    expect(JSON.stringify(received)).not.toContain('raw-account-id');
  });

  it('lockdown snapshot exposes no account or vehicle payload', () => {
    activateAccountSecurityLockdown('cleanup-safe', 'logout', 1);
    expect(getAccountSecurityLockdownState()).toEqual({
      active: true,
      cleanupId: 'cleanup-safe',
      reason: 'logout',
      generation: 1,
      activatedAt: 1,
    });
  });
});
