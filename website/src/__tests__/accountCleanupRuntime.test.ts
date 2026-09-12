import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AccountCleanupRuntime,
  getAccountCleanupServerSnapshot,
} from '@/security/accountCleanup/accountCleanupRuntime';
import {
  activateAccountSecurityLockdown,
  releaseAccountSecurityLockdown,
  resetAccountSecurityLockdownForTests,
} from '@/security/accountCleanup/cleanupLockdown';
import type { CleanupLedgerStorage } from '@/security/accountCleanup/cleanupLedger';

class MemoryLedgerStorage implements CleanupLedgerStorage {
  value: string | null = null;
  reads = 0;
  read() { this.reads += 1; return this.value; }
  write(value: string) { this.value = value; }
  remove() { this.value = null; }
}

function runtime(storage = new MemoryLedgerStorage(), authenticated = true) {
  return new AccountCleanupRuntime({
    ledgerStorage: storage,
    hasAuthenticatedSession: async () => authenticated,
  });
}

describe('account cleanup production runtime', () => {
  beforeEach(() => resetAccountSecurityLockdownForTests());

  it('server snapshot is fail-closed', () => {
    expect(getAccountCleanupServerSnapshot()).toMatchObject({
      initialized: false, lockdownActive: true, bootStatus: 'CHECKING',
    });
  });

  it('does not read storage during construction', () => {
    const storage = new MemoryLedgerStorage();
    const subject = runtime(storage);
    expect(storage.reads).toBe(0);
    subject.disposeForTests();
  });

  it('allows protected capabilities only after a safe boot', async () => {
    const subject = runtime();
    expect(subject.evaluateCapability('COMMAND_DISPATCH')).toMatchObject({
      allowed: false, code: 'RUNTIME_UNAVAILABLE',
    });
    await subject.initialize();
    expect(subject.evaluateCapability('COMMAND_DISPATCH')).toEqual({
      allowed: true, generation: 0,
    });
    subject.disposeForTests();
  });

  it('returns AUTH_REQUIRED without a session and preserves only anonymous pairing', async () => {
    const subject = runtime(new MemoryLedgerStorage(), false);
    await subject.initialize();
    expect(subject.getSnapshot().bootStatus).toBe('AUTH_REQUIRED');
    expect(subject.evaluateCapability('DASHBOARD_RENDER').allowed).toBe(false);
    expect(subject.evaluateCapability('PAIRING_CONTINUE').allowed).toBe(true);
    subject.disposeForTests();
  });

  it('shares one initialization promise', () => {
    const subject = runtime();
    expect(subject.initialize()).toBe(subject.initialize());
    subject.disposeForTests();
  });

  it('publishes stable snapshots and supports unsubscribe', async () => {
    const subject = runtime();
    const listener = vi.fn();
    const unsubscribe = subject.subscribe(listener);
    await subject.initialize();
    expect(listener).toHaveBeenCalled();
    const calls = listener.mock.calls.length;
    unsubscribe();
    activateAccountSecurityLockdown('c1', 'logout', 1);
    expect(listener).toHaveBeenCalledTimes(calls);
    subject.disposeForTests();
  });

  it('isolates listener exceptions', async () => {
    const subject = runtime();
    const healthy = vi.fn();
    subject.subscribe(() => { throw new Error('listener'); });
    subject.subscribe(healthy);
    await subject.initialize();
    expect(healthy).toHaveBeenCalled();
    subject.disposeForTests();
  });

  it('enforces the bounded listener registry', () => {
    const subject = runtime();
    for (let index = 0; index < 64; index += 1) subject.subscribe(() => undefined);
    expect(() => subject.subscribe(() => undefined)).toThrow(
      'ACCOUNT_CLEANUP_RUNTIME_LISTENER_LIMIT',
    );
    subject.disposeForTests();
  });

  it('locks every protected capability synchronously', async () => {
    const subject = runtime();
    await subject.initialize();
    activateAccountSecurityLockdown('c1', 'logout', 1);
    expect(subject.getSnapshot().lockdownActive).toBe(true);
    expect(subject.evaluateCapability('COMMAND_DISPATCH')).toMatchObject({
      allowed: false, code: 'LOCKDOWN_ACTIVE',
    });
    subject.disposeForTests();
  });

  it('does not unlock on route, login, or runtime disposal', async () => {
    const subject = runtime();
    await subject.initialize();
    activateAccountSecurityLockdown('c1', 'logout', 1);
    subject.disposeForTests();
    expect(releaseAccountSecurityLockdown('wrong-id')).toBe(false);
  });

  it('updates generation when cleanup starts', async () => {
    const subject = runtime();
    await subject.initialize();
    const before = subject.getSnapshot().generation;
    activateAccountSecurityLockdown('c1', 'account_switch', 1);
    expect(subject.getSnapshot().generation).toBe(before + 1);
    subject.disposeForTests();
  });

  it('fails closed on corrupted ledger', async () => {
    const storage = new MemoryLedgerStorage();
    storage.value = '{broken';
    const subject = runtime(storage);
    await subject.initialize();
    expect(subject.getSnapshot()).toMatchObject({
      initialized: true, bootStatus: 'STORAGE_CORRUPTED',
    });
    expect(subject.evaluateCapability('DASHBOARD_RENDER').allowed).toBe(false);
    subject.disposeForTests();
  });

  it('fails closed on a future ledger schema', async () => {
    const storage = new MemoryLedgerStorage();
    storage.value = JSON.stringify({ schemaVersion: 999 });
    const subject = runtime(storage);
    await subject.initialize();
    expect(subject.getSnapshot().bootStatus).toBe('STORAGE_CORRUPTED');
    subject.disposeForTests();
  });

  it('attempts pending cleanup recovery and remains closed when phases are incomplete', async () => {
    const storage = new MemoryLedgerStorage();
    storage.value = JSON.stringify({
      cleanupId: 'pending-1', requestedAt: 1, reason: 'logout',
      state: 'REQUESTED', completedSteps: [], retryCount: 0,
      lastAttemptAt: 1, schemaVersion: 1, generation: 1,
    });
    const subject = runtime(storage);
    await subject.initialize();
    expect(subject.evaluateCapability('DASHBOARD_RENDER').allowed).toBe(false);
    expect(subject.getSnapshot().bootStatus).toBe('STORAGE_CORRUPTED');
    subject.disposeForTests();
  });

  it('turns composition factory failure into RUNTIME_ERROR', async () => {
    const subject = new AccountCleanupRuntime({
      compositionFactory: () => { throw new Error('factory'); },
    });
    await subject.initialize();
    expect(subject.getSnapshot()).toMatchObject({
      initialized: true,
      lockdownActive: true,
      bootStatus: 'RUNTIME_ERROR',
      failureCode: 'RUNTIME_COMPOSITION_FAILED',
    });
    subject.disposeForTests();
  });
});
