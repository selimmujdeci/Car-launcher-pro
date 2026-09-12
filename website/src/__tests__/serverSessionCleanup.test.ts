import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  canApplyCurrentAuthEvent,
  canApplyAuthSessionResult,
  captureAuthSessionGeneration,
  resetAuthSessionOperationsForTests,
} from '@/security/accountCleanup/authSessionGenerationGuard';
import { AccountCleanupCoordinator } from '@/security/accountCleanup/AccountCleanupCoordinator';
import {
  CleanupLedger,
  type CleanupLedgerStorage,
} from '@/security/accountCleanup/cleanupLedger';
import {
  activateAccountSecurityLockdown,
  getAccountSecurityLockdownState,
  releaseAccountSecurityLockdown,
  resetAccountSecurityLockdownForTests,
} from '@/security/accountCleanup/cleanupLockdown';
import { CleanupParticipantRegistry } from '@/security/accountCleanup/cleanupParticipantRegistry';
import { createVehicleCleanupComposition } from '@/security/accountCleanup/createAccountCleanupRuntime';
import {
  ServerSessionRevokeParticipant,
  ServerSessionVerificationParticipant,
  SupabaseServerSessionCleanupAdapter,
  type ServerSessionAdapterResult,
  type ServerSessionCleanupAdapter,
  type ServerSessionIdentity,
} from '@/security/accountCleanup/serverSessionCleanupParticipants';
import type {
  AccountCleanupParticipant,
  CleanupContext,
} from '@/security/accountCleanup/cleanupTypes';
import {
  resetAuthSessionMutationLockForTests,
  withAuthSessionMutationLock,
} from '@/security/accountCleanup/authSessionMutationLock';
import {
  captureSupabaseAuthCookieOwnershipForPrefix,
  clearSupabaseAuthCookiesIfOwned,
} from '@/lib/supabaseBrowser';

class FakeSessionAdapter implements ServerSessionCleanupAdapter {
  identity: ServerSessionIdentity = {
    present: true,
    userId: 'account-a',
    sessionFingerprint: 'fingerprint-a',
  };
  revokeResults: Array<ServerSessionAdapterResult<undefined>> = [
    { ok: true, value: undefined },
  ];
  verifyResult: ServerSessionAdapterResult<boolean> | null = null;
  verifyResults: Array<ServerSessionAdapterResult<boolean>> = [];
  prepareCalls = 0;
  revokeCalls = 0;
  verifyCalls = 0;

  async prepare(): Promise<ServerSessionAdapterResult<ServerSessionIdentity>> {
    this.prepareCalls += 1;
    return { ok: true, value: this.identity };
  }

  async revokeCurrentSession(
    _target: Extract<ServerSessionIdentity, { present: true }>,
  ):
  Promise<ServerSessionAdapterResult<undefined>> {
    this.revokeCalls += 1;
    const result = this.revokeResults.shift() ??
      { ok: true as const, value: undefined };
    if (result.ok) this.identity = { present: false };
    return result;
  }

  async verifyEmpty(): Promise<ServerSessionAdapterResult<boolean>> {
    this.verifyCalls += 1;
    return this.verifyResults.shift() ?? this.verifyResult ??
      { ok: true, value: !this.identity.present };
  }
}

class MemoryLedgerStorage implements CleanupLedgerStorage {
  raw: string | null = null;
  read(): string | null { return this.raw; }
  write(value: string): void { this.raw = value; }
  remove(): void { this.raw = null; }
}

const noopDeviceParticipant: AccountCleanupParticipant = {
  id: 'test-device-revoke',
  phase: 'DEVICE_AND_PUSH_REVOKE',
  priority: 1,
  clear: async () => ({ ok: true, code: 'NOT_APPLICABLE' }),
};

let context: CleanupContext;

beforeEach(async () => {
  vi.useRealTimers();
  window.localStorage.clear();
  resetAccountSecurityLockdownForTests();
  resetAuthSessionOperationsForTests();
  resetAuthSessionMutationLockForTests();
  const state = activateAccountSecurityLockdown(
    'server-session-cleanup',
    'logout',
    1,
  );
  context = {
    cleanupId: 'server-session-cleanup',
    reason: 'logout',
    previousAccountHash: await hash('account-a'),
    startedAt: 1,
    generation: state.generation,
  };
});

describe('ServerSessionRevokeParticipant', () => {
  it('revokes a matching current session and verifies local absence', async () => {
    const adapter = new FakeSessionAdapter();
    await expect(new ServerSessionRevokeParticipant(adapter).clear(context))
      .resolves.toEqual({ ok: true, code: 'CLEARED' });
    expect(adapter.revokeCalls).toBe(1);
    expect(adapter.verifyCalls).toBe(1);
  });

  it('is idempotent when the session is already absent', async () => {
    const adapter = new FakeSessionAdapter();
    adapter.identity = { present: false };
    const participant = new ServerSessionRevokeParticipant(adapter);
    await expect(participant.clear(context)).resolves.toEqual({
      ok: true, code: 'ALREADY_EMPTY',
    });
    await expect(participant.clear(context)).resolves.toEqual({
      ok: true, code: 'ALREADY_EMPTY',
    });
    expect(adapter.revokeCalls).toBe(0);
  });

  it('fails closed when an active session has no account scope', async () => {
    const adapter = new FakeSessionAdapter();
    await expect(new ServerSessionRevokeParticipant(adapter).clear({
      ...context, previousAccountHash: undefined,
    })).resolves.toMatchObject({
      ok: false, retryable: false,
      failureCode: 'SERVER_SESSION_ACCOUNT_REQUIRED',
    });
    expect(adapter.revokeCalls).toBe(0);
  });

  it('does not revoke a different account session', async () => {
    const adapter = new FakeSessionAdapter();
    adapter.identity = {
      present: true,
      userId: 'account-b',
      sessionFingerprint: 'fingerprint-b',
    };
    await expect(new ServerSessionRevokeParticipant(adapter).clear(context))
      .resolves.toMatchObject({
        ok: false, failureCode: 'SERVER_SESSION_ACCOUNT_MISMATCH',
      });
    expect(adapter.revokeCalls).toBe(0);
  });

  it('keeps network failures retryable and locked down', async () => {
    const adapter = new FakeSessionAdapter();
    adapter.revokeResults = [{
      ok: false, retryable: true,
      failureCode: 'SERVER_SESSION_REVOKE_NETWORK_FAILED',
    }];
    await expect(new ServerSessionRevokeParticipant(adapter).clear(context))
      .resolves.toMatchObject({
        ok: false, retryable: true,
        failureCode: 'SERVER_SESSION_REVOKE_NETWORK_FAILED',
      });
    expect(getAccountSecurityLockdownState().active).toBe(true);
  });

  it('classifies provider failures as blocking', async () => {
    const adapter = new FakeSessionAdapter();
    adapter.revokeResults = [{
      ok: false, retryable: false,
      failureCode: 'SERVER_SESSION_REVOKE_FAILED',
    }];
    await expect(new ServerSessionRevokeParticipant(adapter).clear(context))
      .resolves.toMatchObject({
        ok: false, retryable: false,
        failureCode: 'SERVER_SESSION_REVOKE_FAILED',
      });
  });

  it('times out without writing a late success', async () => {
    const adapter = new FakeSessionAdapter();
    adapter.revokeCurrentSession = () => new Promise(() => undefined);
    await expect(new ServerSessionRevokeParticipant(adapter, 1).clear(context))
      .resolves.toMatchObject({
      ok: false, retryable: true,
      failureCode: 'SERVER_SESSION_REVOKE_TIMEOUT',
    });
  });

  it('keeps timeout failure durable when provider resolves late', async () => {
    resetAccountSecurityLockdownForTests();
    const deferred = createDeferred<ServerSessionAdapterResult<undefined>>();
    const adapter = new FakeSessionAdapter();
    adapter.revokeCurrentSession = () => deferred.promise;
    const { coordinator } = setupCoordinator(
      adapter,
      new MemoryLedgerStorage(),
      1,
    );
    const result = await coordinator.requestCleanup({
      reason: 'logout',
      previousAccountId: 'account-a',
      expectedSessionFingerprint: 'fingerprint-a',
    });
    expect(result).toMatchObject({
      ok: false,
      state: 'FAILED_RETRYABLE',
    });
    deferred.resolve({ ok: true, value: undefined });
    await Promise.resolve();
    expect(coordinator.getCurrentLedger()?.state).toBe('FAILED_RETRYABLE');
    expect(coordinator.isLockedDown()).toBe(true);
  });

  it('rejects a result when cleanup generation changes in flight', async () => {
    const deferred = createDeferred<ServerSessionAdapterResult<undefined>>();
    let revokeStarted = false;
    const adapter = new FakeSessionAdapter();
    adapter.revokeCurrentSession = () => {
      revokeStarted = true;
      return deferred.promise;
    };
    const run = new ServerSessionRevokeParticipant(adapter).clear(context);
    await vi.waitFor(() => expect(revokeStarted).toBe(true));
    activateAccountSecurityLockdown('new-cleanup', 'account_switch', 2);
    deferred.resolve({ ok: true, value: undefined });
    await expect(run).resolves.toMatchObject({
      ok: false, failureCode: 'SERVER_SESSION_GENERATION_MISMATCH',
    });
  });

  it('fails verification when auth restore leaves a session present', async () => {
    const adapter = new FakeSessionAdapter();
    adapter.verifyResult = { ok: true, value: false };
    await expect(new ServerSessionRevokeParticipant(adapter).clear(context))
      .resolves.toMatchObject({
        ok: false, failureCode: 'SERVER_SESSION_STILL_PRESENT',
      });
  });
});

describe('Supabase adapter contract', () => {
  it('clears a verified Account A cookie snapshot', async () => {
    const prefix = 'sb-test-auth-token';
    document.cookie =
      `${prefix}=account-a-cookie; Path=/`;
    const snapshot = await captureSupabaseAuthCookieOwnershipForPrefix(prefix);
    if (!snapshot) throw new Error('expected Account A cookie snapshot');

    await expect(clearSupabaseAuthCookiesIfOwned(
      snapshot,
      prefix,
      (_name, _timeout, operation) => operation(),
    ))
      .resolves.toEqual({ ok: true, deletedCount: 1 });
    expect(document.cookie).not.toContain(prefix);
  });

  it('does not delete Account B cookies through an Account A snapshot',
    async () => {
      const prefix = 'sb-test-auth-token';
      document.cookie =
        `${prefix}=account-a-cookie; Path=/`;
      const snapshot = await captureSupabaseAuthCookieOwnershipForPrefix(prefix);
      if (!snapshot) throw new Error('expected Account A cookie snapshot');
      document.cookie =
        `${prefix}=account-b-cookie; Path=/`;

      await expect(clearSupabaseAuthCookiesIfOwned(
        snapshot,
        prefix,
        (_name, _timeout, operation) => operation(),
      ))
        .resolves.toMatchObject({ ok: false, code: 'OWNERSHIP_MISMATCH' });
      expect(document.cookie).toContain(
        `${prefix}=account-b-cookie`,
      );
      document.cookie =
        `${prefix}=; Path=/; Max-Age=0`;
    });

  it('rechecks all same-name chunks inside the SDK lock before deleting',
    async () => {
      const prefix = 'sb-race-auth-token';
      document.cookie = `${prefix}.0=account-a-0; Path=/`;
      document.cookie = `${prefix}.1=account-a-1; Path=/`;
      const snapshot =
        await captureSupabaseAuthCookieOwnershipForPrefix(prefix);
      if (!snapshot) throw new Error('expected Account A cookie snapshot');

      const entered = createDeferred<void>();
      const release = createDeferred<void>();
      const requestExclusive = async <T>(
        name: string,
        _timeout: number,
        operation: () => Promise<T>,
      ): Promise<T> => {
        expect(name).toBe(`lock:${prefix}`);
        entered.resolve();
        await release.promise;
        return operation();
      };
      const cleanup = clearSupabaseAuthCookiesIfOwned(
        snapshot,
        prefix,
        requestExclusive,
      );
      await entered.promise;
      document.cookie = `${prefix}.0=account-b-0; Path=/`;
      document.cookie = `${prefix}.1=account-b-1; Path=/`;
      release.resolve();

      await expect(cleanup).resolves.toMatchObject({
        ok: false,
        code: 'OWNERSHIP_MISMATCH',
      });
      expect(document.cookie).toContain(`${prefix}.0=account-b-0`);
      expect(document.cookie).toContain(`${prefix}.1=account-b-1`);
      document.cookie = `${prefix}.0=; Path=/; Max-Age=0`;
      document.cookie = `${prefix}.1=; Path=/; Max-Age=0`;
    });

  it('reports bounded partial cleanup when a later chunk delete fails',
    async () => {
      const prefix = 'sb-partial-auth-token';
      document.cookie = `${prefix}.0=account-a-0; Path=/`;
      document.cookie = `${prefix}.1=account-a-1; Path=/`;
      const snapshot =
        await captureSupabaseAuthCookieOwnershipForPrefix(prefix);
      if (!snapshot) throw new Error('expected Account A cookie snapshot');
      let calls = 0;
      const result = await clearSupabaseAuthCookiesIfOwned(
        snapshot,
        prefix,
        (_name, _timeout, operation) => operation(),
        (name) => {
          calls += 1;
          if (calls === 2) throw new Error('simulated delete failure');
          document.cookie = `${name}=; Path=/; Max-Age=0`;
        },
      );
      expect(result).toEqual({
        ok: false,
        code: 'PARTIAL_CLEANUP',
        deletedCount: 1,
      });
      expect(document.cookie).not.toContain(`${prefix}.0=`);
      expect(document.cookie).toContain(`${prefix}.1=account-a-1`);
      document.cookie = `${prefix}.1=; Path=/; Max-Age=0`;
    });

  it('never deletes a replacement Account B chunk after partial A cleanup',
    async () => {
      const prefix = 'sb-replacement-auth-token';
      document.cookie = `${prefix}.0=account-a-0; Path=/`;
      document.cookie = `${prefix}.1=account-a-1; Path=/`;
      const snapshot =
        await captureSupabaseAuthCookieOwnershipForPrefix(prefix);
      if (!snapshot) throw new Error('expected Account A cookie snapshot');
      const result = await clearSupabaseAuthCookiesIfOwned(
        snapshot,
        prefix,
        (_name, _timeout, operation) => operation(),
        (name) => {
          document.cookie = `${name}=; Path=/; Max-Age=0`;
          if (name === `${prefix}.0`) {
            document.cookie = `${prefix}.1=account-b-1; Path=/`;
          }
        },
      );
      expect(result).toEqual({
        ok: false,
        code: 'PARTIAL_CLEANUP',
        deletedCount: 1,
      });
      expect(document.cookie).toContain(`${prefix}.1=account-b-1`);
      document.cookie = `${prefix}.1=; Path=/; Max-Age=0`;
    });

  it('preserves Account B when it becomes active after targeted A revoke',
    async () => {
      let session = {
        user: { id: 'account-a' },
        access_token: 'token-a',
      };
      let cookieOwner = 'account-a';
      const localCleanupEntered = createDeferred<void>();
      const releaseLocalCleanup = createDeferred<void>();
      const localCleanup = vi.fn(async () => {
        localCleanupEntered.resolve();
        await releaseLocalCleanup.promise;
        return cookieOwner === 'account-a';
      });
      const getClient = async () => ({
        auth: {
          getSession: async () => ({ data: { session }, error: null }),
        },
      });
      const adapter = new SupabaseServerSessionCleanupAdapter(
        getClient,
        getClient,
        () => false,
        () => false,
        async (token) => {
          expect(token).toBe('token-a');
          return { ok: true, value: undefined };
        },
        async () => ownedCookieSnapshot('account-a'),
        localCleanup,
      );
      const prepared = await adapter.prepare();
      if (!prepared.ok || !prepared.value.present) {
        throw new Error('expected Account A session');
      }

      const revoke = adapter.revokeCurrentSession(prepared.value);
      await localCleanupEntered.promise;
      session = {
        user: { id: 'account-b' },
        access_token: 'token-b',
      };
      cookieOwner = 'account-b';
      releaseLocalCleanup.resolve();
      await expect(revoke).resolves.toMatchObject({
        ok: false,
        failureCode: 'SERVER_SESSION_ACCOUNT_MISMATCH',
      });
      expect(session).toEqual({
        user: { id: 'account-b' },
        access_token: 'token-b',
      });
      expect(localCleanup).toHaveBeenCalledTimes(1);
    });

  it('surfaces cookie partial cleanup as a blocking bounded failure',
    async () => {
      const session = {
        user: { id: 'account-a' },
        access_token: 'token-a',
      };
      const getClient = async () => ({
        auth: {
          getSession: async () => ({ data: { session }, error: null }),
        },
      });
      const adapter = new SupabaseServerSessionCleanupAdapter(
        getClient,
        getClient,
        () => true,
        () => false,
        async () => ({ ok: true, value: undefined }),
        async () => ownedCookieSnapshot('account-a'),
        async () => ({
          ok: false,
          code: 'PARTIAL_CLEANUP',
          deletedCount: 1,
        }),
      );
      const prepared = await adapter.prepare();
      if (!prepared.ok || !prepared.value.present) {
        throw new Error('expected Account A session');
      }
      await expect(adapter.revokeCurrentSession(prepared.value))
        .resolves.toMatchObject({
          ok: false,
          retryable: false,
          failureCode: 'SERVER_SESSION_COOKIE_PARTIAL_CLEANUP',
        });
    });

  it('keeps Account B intact when targeted revoke completes after timeout',
    async () => {
      vi.useFakeTimers();
      let session = {
        user: { id: 'account-a' },
        access_token: 'token-a',
      };
      const revokeEntered = createDeferred<void>();
      const releaseRevoke = createDeferred<void>();
      const localCleanup = vi.fn(async () => true);
      const getClient = async () => ({
        auth: {
          getSession: async () => ({ data: { session }, error: null }),
        },
      });
      const adapter = new SupabaseServerSessionCleanupAdapter(
        getClient,
        getClient,
        () => false,
        () => false,
        async () => {
          revokeEntered.resolve();
          await releaseRevoke.promise;
          return { ok: true, value: undefined };
        },
        async () => ownedCookieSnapshot('account-a'),
        localCleanup,
      );
      const run = new ServerSessionRevokeParticipant(adapter, 1).clear(context);
      await revokeEntered.promise;
      await vi.advanceTimersByTimeAsync(1);
      await expect(run).resolves.toMatchObject({
        ok: false,
        retryable: true,
        failureCode: 'SERVER_SESSION_REVOKE_TIMEOUT',
      });

      const bLogin = withAuthSessionMutationLock(async () => {
        session = {
          user: { id: 'account-b' },
          access_token: 'token-b',
        };
      });
      releaseRevoke.resolve();
      await bLogin;
      expect(localCleanup).not.toHaveBeenCalled();
      expect(session).toEqual({
        user: { id: 'account-b' },
        access_token: 'token-b',
      });
      expect(getAccountSecurityLockdownState().active).toBe(true);
    });

  it('preserves Account B when it replaces prepared Account A', async () => {
    let session = {
      user: { id: 'account-a' },
      access_token: 'token-a',
    };
    const getClient = async () => ({
      auth: {
        getSession: async () => ({ data: { session }, error: null }),
      },
    });
    const adapter = new SupabaseServerSessionCleanupAdapter(
      getClient, getClient, () => false, () => false,
      async () => ({ ok: true, value: undefined }),
      async () => ownedCookieSnapshot('account-a'),
      async () => true,
    );
    const prepared = await adapter.prepare();
    if (!prepared.ok || !prepared.value.present) {
      throw new Error('expected Account A session');
    }
    session = { user: { id: 'account-b' }, access_token: 'token-b' };

    await expect(adapter.revokeCurrentSession(prepared.value))
      .resolves.toMatchObject({
        ok: false,
        failureCode: 'SERVER_SESSION_ACCOUNT_MISMATCH',
      });
    expect(session.user.id).toBe('account-b');
  });

  it('clears only the prepared Account A local artifacts', async () => {
    let present = true;
    const clearOwned = vi.fn(async () => {
      present = false;
      return true;
    });
    const getClient = async () => ({
      auth: {
        getSession: async () => ({
          data: {
            session: present
              ? { user: { id: 'account-a' }, access_token: 'token-a' }
              : null,
          },
          error: null,
        }),
      },
    });
    const adapter = new SupabaseServerSessionCleanupAdapter(
      getClient,
      getClient,
      () => false,
      () => false,
      async (token) => {
        expect(token).toBe('token-a');
        return { ok: true, value: undefined };
      },
      async () => ownedCookieSnapshot('account-a'),
      clearOwned,
    );
    const prepared = await adapter.prepare();
    expect(prepared).toMatchObject({
      ok: true, value: { present: true, userId: 'account-a' },
    });
    if (!prepared.ok || !prepared.value.present) {
      throw new Error('expected prepared session');
    }
    await expect(adapter.revokeCurrentSession(prepared.value)).resolves.toEqual({
      ok: true, value: undefined,
    });
    expect(clearOwned).toHaveBeenCalledWith(ownedCookieSnapshot('account-a'));
    await expect(adapter.verifyEmpty()).resolves.toEqual({
      ok: true, value: true,
    });
  });

  it('fails closed when auth storage/provider cannot be read', async () => {
    const unavailable = new SupabaseServerSessionCleanupAdapter(
      async () => null,
    );
    await expect(unavailable.prepare()).resolves.toMatchObject({
      ok: false, failureCode: 'SERVER_SESSION_PROVIDER_UNAVAILABLE',
    });
  });

  it('checks a fresh client and rejects restored sessions', async () => {
    const emptyClient = async () => createSessionClient(null);
    const restoredClient = async () => createSessionClient({
      user: { id: 'account-a' },
      access_token: 'restored-token',
    });
    const adapter = new SupabaseServerSessionCleanupAdapter(
      emptyClient, restoredClient, () => false, () => false,
    );
    await expect(adapter.verifyEmpty()).resolves.toMatchObject({
      ok: false,
      failureCode: 'SERVER_SESSION_FRESH_RESTORE_PRESENT',
    });
  });

  it('rejects remaining Supabase auth cookie chunks', async () => {
    const emptyClient = async () => createSessionClient(null);
    const adapter = new SupabaseServerSessionCleanupAdapter(
      emptyClient, emptyClient, () => true, () => false,
    );
    await expect(adapter.verifyEmpty()).resolves.toMatchObject({
      ok: false,
      failureCode: 'SERVER_SESSION_COOKIE_STILL_PRESENT',
    });
  });

  it('sanitizes retryable provider errors to bounded codes', async () => {
    const getClient = async () => ({
      auth: {
        getSession: async () => ({
          data: {
            session: {
              user: { id: 'account-a' },
              access_token: 'token-a',
            },
          },
          error: null,
        }),
        signOut: async () => ({
          error: { name: 'AuthRetryableFetchError' },
        }),
      },
    });
    const adapter = new SupabaseServerSessionCleanupAdapter(
      getClient,
      getClient,
      () => false,
      () => false,
      async () => ({
        ok: false,
        retryable: true,
        failureCode: 'SERVER_SESSION_REVOKE_NETWORK_FAILED',
      }),
      async () => ownedCookieSnapshot('account-a'),
      async () => true,
    );
    const prepared = await adapter.prepare();
    if (!prepared.ok || !prepared.value.present) {
      throw new Error('expected prepared session');
    }
    const result = await adapter.revokeCurrentSession(prepared.value);
    expect(result).toEqual({
      ok: false, retryable: true,
      failureCode: 'SERVER_SESSION_REVOKE_NETWORK_FAILED',
    });
    expect(JSON.stringify(result)).not.toMatch(/token|session payload/i);
  });
});

describe('auth generation and coordinator integration', () => {
  it('rejects stale auth callbacks during and after cleanup generation change', () => {
    resetAccountSecurityLockdownForTests();
    const generation = captureAuthSessionGeneration();
    expect(canApplyAuthSessionResult(generation)).toBe(true);
    activateAccountSecurityLockdown('auth-race', 'logout', 1);
    expect(canApplyAuthSessionResult(generation)).toBe(false);
  });

  it('accepts a new Account B auth event only after verified cleanup release', () => {
    resetAccountSecurityLockdownForTests();
    const lockdown = activateAccountSecurityLockdown(
      'account-switch',
      'account_switch',
      1,
    );
    expect(canApplyCurrentAuthEvent()).toBe(false);
    expect(releaseAccountSecurityLockdown(lockdown.cleanupId!)).toBe(true);
    expect(canApplyCurrentAuthEvent()).toBe(true);
  });

  it('re-runs final verification instead of trusting a cached clear result',
    async () => {
      const adapter = new FakeSessionAdapter();
      adapter.identity = { present: false };
      adapter.verifyResults = [
        { ok: true, value: true },
        { ok: true, value: false },
      ];
      const verifier = new ServerSessionVerificationParticipant(adapter);
      await expect(verifier.clear(context)).resolves.toMatchObject({ ok: true });
      await expect(verifier.verifyEmpty(context)).resolves.toBe(false);
      expect(adapter.verifyCalls).toBe(2);
    });

  it('registers revoke and verification in deterministic phases', () => {
    const adapter = new FakeSessionAdapter();
    const composition = createVehicleCleanupComposition(
      () => window.localStorage,
      adapter,
    );
    expect(composition.participantRegistry
      .listForPhase('SERVER_SESSION_REVOKE').map(({ id }) => id))
      .toEqual(['server-session-revoke']);
    expect(composition.participantRegistry
      .listForPhase('VERIFY_EMPTY').map(({ id }) => id))
      .toContain('server-session-verification');
  });

  it('keeps coordinator incomplete and locked when revoke fails', async () => {
    resetAccountSecurityLockdownForTests();
    const adapter = new FakeSessionAdapter();
    adapter.revokeResults = [{
      ok: false, retryable: true,
      failureCode: 'SERVER_SESSION_REVOKE_NETWORK_FAILED',
    }];
    const { coordinator } = setupCoordinator(adapter);
    await expect(coordinator.requestCleanup({
      reason: 'logout', previousAccountId: 'account-a',
      expectedSessionFingerprint: 'fingerprint-a',
    })).resolves.toMatchObject({
      ok: false, state: 'FAILED_RETRYABLE',
      failureCode: 'PARTICIPANT_FAILED_RETRYABLE',
    });
    expect(coordinator.isLockedDown()).toBe(true);
    expect(coordinator.getCurrentLedger()?.completedSteps)
      .not.toContain('SERVER_SESSION_REVOKE');
  });

  it('recovers after process death/retry and completes verified revoke', async () => {
    resetAccountSecurityLockdownForTests();
    const adapter = new FakeSessionAdapter();
    adapter.revokeResults = [
      {
        ok: false, retryable: true,
        failureCode: 'SERVER_SESSION_REVOKE_NETWORK_FAILED',
      },
      { ok: true, value: undefined },
    ];
    const storage = new MemoryLedgerStorage();
    const first = setupCoordinator(adapter, storage).coordinator;
    await first.requestCleanup({
      reason: 'logout', previousAccountId: 'account-a',
      expectedSessionFingerprint: 'fingerprint-a',
    });

    resetAccountSecurityLockdownForTests();
    const recovered = setupCoordinator(adapter, storage).coordinator;
    const result = await recovered.recoverPendingCleanup();
    expect(result).toMatchObject({
      ok: true, state: 'COMPLETED',
    });
    expect(adapter.revokeCalls).toBe(2);
    expect(recovered.getCurrentLedger()?.state).toBe('COMPLETED');
  });

  it('does not complete when final session verification fails', async () => {
    resetAccountSecurityLockdownForTests();
    const adapter = new FakeSessionAdapter();
    adapter.verifyEmpty = async () => ({ ok: true, value: false });
    const { coordinator } = setupCoordinator(adapter);
    await expect(coordinator.requestCleanup({
      reason: 'logout', previousAccountId: 'account-a',
      expectedSessionFingerprint: 'fingerprint-a',
    })).resolves.toMatchObject({ ok: false });
    expect(coordinator.getCurrentLedger()?.state).not.toBe('COMPLETED');
    expect(coordinator.isLockedDown()).toBe(true);
  });

  it('re-verifies after process death even when VERIFY_EMPTY was durable',
    async () => {
      resetAccountSecurityLockdownForTests();
      const adapter = new FakeSessionAdapter();
      adapter.identity = { present: false };
      adapter.verifyResult = { ok: true, value: false };
      const storage = new MemoryLedgerStorage();
      storage.raw = JSON.stringify({
        cleanupId: 'verified-before-crash',
        requestedAt: 1,
        reason: 'logout',
        previousAccountHash: await hash('account-a'),
        expectedSessionFingerprint: 'fingerprint-a',
        state: 'VERIFY_EMPTY',
        completedSteps: [
          'REQUESTED',
          'LOCAL_SECRET_PURGE',
          'LOCAL_PRIVATE_DATA_PURGE',
          'QUEUE_AND_SNAPSHOT_PURGE',
          'SERVER_SESSION_REVOKE',
          'DEVICE_AND_PUSH_REVOKE',
          'VERIFY_EMPTY',
        ],
        retryCount: 0,
        lastAttemptAt: 2,
        schemaVersion: 2,
        generation: 7,
      });
      const coordinator = setupCoordinator(adapter, storage).coordinator;
      await expect(coordinator.recoverPendingCleanup()).resolves.toMatchObject({
        ok: false,
        state: 'FAILED_BLOCKING',
      });
      expect(adapter.verifyCalls).toBeGreaterThan(0);
      expect(coordinator.isLockedDown()).toBe(true);
      expect(coordinator.getCurrentLedger()?.state).not.toBe('COMPLETED');
    });

  it('uses the active recovery generation across repeated attempts', async () => {
    resetAccountSecurityLockdownForTests();
    activateAccountSecurityLockdown('old-1', 'logout', 1);
    activateAccountSecurityLockdown('old-2', 'logout', 2);
    const adapter = new FakeSessionAdapter();
    adapter.revokeResults = [
      {
        ok: false,
        retryable: true,
        failureCode: 'SERVER_SESSION_REVOKE_NETWORK_FAILED',
      },
      {
        ok: false,
        retryable: true,
        failureCode: 'SERVER_SESSION_REVOKE_NETWORK_FAILED',
      },
      { ok: true, value: undefined },
    ];
    const storage = new MemoryLedgerStorage();
    const first = setupCoordinator(adapter, storage).coordinator;
    await first.requestCleanup({
      reason: 'logout',
      previousAccountId: 'account-a',
      expectedSessionFingerprint: 'fingerprint-a',
    });
    const firstRecovery = await first.recoverPendingCleanup();
    expect(firstRecovery).toMatchObject({
      ok: false,
      state: 'FAILED_RETRYABLE',
    });
    const secondRecovery = await first.recoverPendingCleanup();
    expect(secondRecovery).toMatchObject({ ok: true, state: 'COMPLETED' });
    expect(first.getCurrentLedger()?.generation)
      .toBe(getAccountSecurityLockdownState().generation);
  });

  it('quarantines a fingerprintless schema-v1 recovery target', async () => {
    resetAccountSecurityLockdownForTests();
    const adapter = new FakeSessionAdapter();
    adapter.identity = {
      present: true,
      userId: 'account-a',
      sessionFingerprint: 'new-session-a2',
    };
    const storage = new MemoryLedgerStorage();
    storage.raw = JSON.stringify({
      cleanupId: 'legacy-a1',
      requestedAt: 1,
      reason: 'logout',
      previousAccountHash: await hash('account-a'),
      state: 'SERVER_SESSION_REVOKE',
      completedSteps: [
        'REQUESTED',
        'LOCAL_SECRET_PURGE',
        'LOCAL_PRIVATE_DATA_PURGE',
        'QUEUE_AND_SNAPSHOT_PURGE',
      ],
      retryCount: 0,
      lastAttemptAt: 2,
      schemaVersion: 1,
      generation: 1,
    });
    const coordinator = setupCoordinator(adapter, storage).coordinator;
    await expect(coordinator.recoverPendingCleanup()).resolves.toMatchObject({
      ok: false,
      state: 'FAILED_BLOCKING',
      failureCode: 'LEGACY_TARGET_UNVERIFIABLE',
    });
    expect(adapter.revokeCalls).toBe(0);
    expect(coordinator.isLockedDown()).toBe(true);
  });

  it('does not let a legacy Account A recovery touch Account B', async () => {
    resetAccountSecurityLockdownForTests();
    const adapter = new FakeSessionAdapter();
    adapter.identity = {
      present: true,
      userId: 'account-b',
      sessionFingerprint: 'session-b',
    };
    const storage = new MemoryLedgerStorage();
    storage.raw = JSON.stringify({
      cleanupId: 'legacy-a-to-b',
      requestedAt: 1,
      reason: 'logout',
      previousAccountHash: await hash('account-a'),
      state: 'SERVER_SESSION_REVOKE',
      completedSteps: ['REQUESTED'],
      retryCount: 0,
      lastAttemptAt: 2,
      schemaVersion: 1,
      generation: 1,
    });
    const coordinator = setupCoordinator(adapter, storage).coordinator;
    await expect(coordinator.recoverPendingCleanup()).resolves.toMatchObject({
      ok: false,
      failureCode: 'LEGACY_TARGET_UNVERIFIABLE',
    });
    expect(adapter.revokeCalls).toBe(0);
    expect(coordinator.isLockedDown()).toBe(true);
  });
});

function setupCoordinator(
  adapter: ServerSessionCleanupAdapter,
  storage = new MemoryLedgerStorage(),
  revokeTimeoutMs?: number,
): {
  coordinator: AccountCleanupCoordinator;
} {
  const participantRegistry = new CleanupParticipantRegistry();
  participantRegistry.register(noopParticipant(
    'test-secret-purge', 'LOCAL_SECRET_PURGE',
  ));
  participantRegistry.register(noopParticipant(
    'test-private-purge', 'LOCAL_PRIVATE_DATA_PURGE',
  ));
  participantRegistry.register(noopParticipant(
    'test-queue-purge', 'QUEUE_AND_SNAPSHOT_PURGE',
  ));
  participantRegistry.register(
    new ServerSessionRevokeParticipant(adapter, revokeTimeoutMs),
  );
  participantRegistry.register(noopDeviceParticipant);
  participantRegistry.register(new ServerSessionVerificationParticipant(adapter));
  return {
    coordinator: new AccountCleanupCoordinator(
      new CleanupLedger(storage),
      participantRegistry,
      { newId: () => 'session-integration', now: () => 10 },
    ),
  };
}

function noopParticipant(
  id: string,
  phase: 'LOCAL_SECRET_PURGE' | 'LOCAL_PRIVATE_DATA_PURGE' |
    'QUEUE_AND_SNAPSHOT_PURGE',
): AccountCleanupParticipant {
  return {
    id,
    phase,
    priority: 1,
    clear: async () => ({ ok: true, code: 'NOT_APPLICABLE' }),
  };
}

async function hash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolvePromise: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

function ownedCookieSnapshot(owner: string) {
  return Object.freeze({
    chunks: Object.freeze([
      Object.freeze({
        name: 'sb-test-auth-token',
        valueHash: `cookie-hash-${owner}`,
      }),
    ]),
  });
}

function createSessionClient(
  session: null | { user: { id: string }; access_token: string },
) {
  return {
    auth: {
      getSession: async () => ({ data: { session }, error: null }),
      signOut: async (_options: { scope: 'local' }) => ({
        error: null,
      }),
    },
  };
}
