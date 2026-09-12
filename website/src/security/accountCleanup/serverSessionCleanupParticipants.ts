import {
  getCleanupGeneration,
  isAccountAccessLocked,
} from './cleanupLockdown';
import type {
  AccountCleanupParticipant,
  CleanupContext,
  CleanupParticipantResult,
} from './cleanupTypes';
import { hasPendingAuthSessionOperations } from './authSessionGenerationGuard';
import {
  captureSupabaseAuthCookieOwnership,
  clearSupabaseAuthCookiesIfOwned,
  hasSupabaseAuthCookieChunks,
  type SupabaseAuthCookieCleanupResult,
  type SupabaseAuthCookieOwnershipSnapshot,
} from '@/lib/supabaseBrowser';
import { withAuthSessionMutationLock } from './authSessionMutationLock';

export type ServerSessionCleanupFailureCode =
  | 'SERVER_SESSION_GENERATION_MISMATCH'
  | 'SERVER_SESSION_ACCOUNT_MISMATCH'
  | 'SERVER_SESSION_ACCOUNT_REQUIRED'
  | 'SERVER_SESSION_PROVIDER_UNAVAILABLE'
  | 'SERVER_SESSION_READ_FAILED'
  | 'SERVER_SESSION_REVOKE_TIMEOUT'
  | 'SERVER_SESSION_REVOKE_NETWORK_FAILED'
  | 'SERVER_SESSION_REVOKE_FAILED'
  | 'SERVER_SESSION_STILL_PRESENT'
  | 'SERVER_SESSION_FRESH_RESTORE_PRESENT'
  | 'SERVER_SESSION_COOKIE_STILL_PRESENT'
  | 'SERVER_SESSION_COOKIE_PARTIAL_CLEANUP'
  | 'SERVER_SESSION_AUTH_OPERATION_PENDING';

export type ServerSessionIdentity =
  | { present: false }
  | {
      present: true;
      userId: string;
      sessionFingerprint: string;
    };

export type ServerSessionAdapterResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      retryable: boolean;
      failureCode: ServerSessionCleanupFailureCode;
    };

export interface ServerSessionCleanupAdapter {
  prepare(): Promise<ServerSessionAdapterResult<ServerSessionIdentity>>;
  revokeCurrentSession(
    target: Extract<ServerSessionIdentity, { present: true }>,
    signal?: AbortSignal,
  ): Promise<ServerSessionAdapterResult<undefined>>;
  verifyEmpty(): Promise<ServerSessionAdapterResult<boolean>>;
}

type SupabaseSessionClient = {
  auth: {
    getSession(): Promise<{
      data: {
        session: null | {
          access_token?: string;
          user?: { id?: string };
        };
      };
      error: null | { name: string };
    }>;
  };
};

const DEFAULT_REVOKE_TIMEOUT_MS = 10_000;

export class ServerSessionRevokeParticipant
implements AccountCleanupParticipant {
  readonly id = 'server-session-revoke';
  readonly phase = 'SERVER_SESSION_REVOKE' as const;
  readonly priority = 10;

  constructor(
    private readonly adapter: ServerSessionCleanupAdapter,
    private readonly timeoutMs = DEFAULT_REVOKE_TIMEOUT_MS,
  ) {}

  async clear(context: CleanupContext): Promise<CleanupParticipantResult> {
    const guard = validateContext(context);
    if (guard) return guard;

    const prepared = await this.adapter.prepare();
    if (!prepared.ok) return adapterFailure(prepared);
    if (!prepared.value.present) {
      const empty = await this.adapter.verifyEmpty();
      if (!empty.ok) return adapterFailure(empty);
      return empty.value
        ? { ok: true, code: 'ALREADY_EMPTY' }
        : failure('SERVER_SESSION_STILL_PRESENT', false);
    }
    if (!context.previousAccountHash) {
      return failure('SERVER_SESSION_ACCOUNT_REQUIRED', false);
    }
    if (context.expectedSessionFingerprint &&
        prepared.value.sessionFingerprint !==
          context.expectedSessionFingerprint) {
      return failure('SERVER_SESSION_ACCOUNT_MISMATCH', false);
    }
    if (await hashAccountId(prepared.value.userId) !==
        context.previousAccountHash) {
      return failure('SERVER_SESSION_ACCOUNT_MISMATCH', false);
    }

    const afterPrepareGuard = validateContext(context);
    if (afterPrepareGuard) return afterPrepareGuard;
    const target = prepared.value;
    const revoked = await withTimeout(
      (signal) => this.adapter.revokeCurrentSession(target, signal),
      this.timeoutMs,
    );
    if (!revoked.ok) return adapterFailure(revoked);

    const afterRevokeGuard = validateContext(context);
    if (afterRevokeGuard) return afterRevokeGuard;
    const empty = await this.adapter.verifyEmpty();
    if (!empty.ok) return adapterFailure(empty);
    if (!empty.value) return failure('SERVER_SESSION_STILL_PRESENT', false);
    return { ok: true, code: 'CLEARED' };
  }
}

export class ServerSessionVerificationParticipant
implements AccountCleanupParticipant {
  readonly id = 'server-session-verification';
  readonly phase = 'VERIFY_EMPTY' as const;
  readonly priority = 30;
  constructor(private readonly adapter: ServerSessionCleanupAdapter) {}

  async clear(context: CleanupContext): Promise<CleanupParticipantResult> {
    const guard = validateContext(context);
    if (guard) return guard;
    const empty = await this.adapter.verifyEmpty();
    if (!empty.ok) return adapterFailure(empty);
    if (!empty.value) return failure('SERVER_SESSION_STILL_PRESENT', false);
    return { ok: true, code: 'ALREADY_EMPTY' };
  }

  async verifyEmpty(context: CleanupContext): Promise<boolean> {
    if (validateContext(context) !== null) return false;
    const fresh = await this.adapter.verifyEmpty();
    return fresh.ok && fresh.value;
  }
}

export class SupabaseServerSessionCleanupAdapter
implements ServerSessionCleanupAdapter {
  private preparedAccessToken: {
    fingerprint: string;
    value: string;
  } | null = null;
  private preparedCookieOwnership:
    SupabaseAuthCookieOwnershipSnapshot | null = null;

  constructor(
    private readonly getClient: () => Promise<SupabaseSessionClient | null> =
      getProductionSupabaseClient,
    private readonly getFreshClient:
      () => Promise<SupabaseSessionClient | null> =
        getProductionFreshSupabaseClient,
    private readonly hasAuthCookies: () => boolean =
      productionHasAuthCookies,
    private readonly hasPendingAuthOperations: () => boolean =
      hasPendingAuthSessionOperations,
    private readonly revokeTargetSession:
      (accessToken: string, signal: AbortSignal) =>
        Promise<ServerSessionAdapterResult<undefined>> =
          revokeProductionTargetSession,
    private readonly captureLocalArtifacts:
      () => Promise<SupabaseAuthCookieOwnershipSnapshot | null> =
        captureSupabaseAuthCookieOwnership,
    private readonly clearOwnedLocalArtifacts:
      (snapshot: SupabaseAuthCookieOwnershipSnapshot) =>
        Promise<SupabaseAuthCookieCleanupResult | boolean> =
        clearSupabaseAuthCookiesIfOwned,
  ) {}

  async prepare(): Promise<ServerSessionAdapterResult<ServerSessionIdentity>> {
    const client = await this.getClient();
    if (!client) return adapterError('SERVER_SESSION_PROVIDER_UNAVAILABLE', false);
    const session = await this.readRawSession(client);
    if (!session.ok) return session;
    if (session.value) {
      const cookieOwnership = await this.captureLocalArtifacts();
      if (!cookieOwnership) {
        return adapterError('SERVER_SESSION_READ_FAILED', false);
      }
      const fingerprint = await hashSecret(session.value.accessToken);
      this.preparedAccessToken = {
        fingerprint,
        value: session.value.accessToken,
      };
      this.preparedCookieOwnership = cookieOwnership;
      return {
        ok: true,
        value: {
          present: true,
          userId: session.value.userId,
          sessionFingerprint: fingerprint,
        },
      };
    }
    this.preparedAccessToken = null;
    this.preparedCookieOwnership = null;
    return { ok: true, value: { present: false } };
  }

  async revokeCurrentSession(
    target: Extract<ServerSessionIdentity, { present: true }>,
    signal = new AbortController().signal,
  ): Promise<ServerSessionAdapterResult<undefined>> {
    const prepared = this.preparedAccessToken;
    const cookieOwnership = this.preparedCookieOwnership;
    if (!prepared || !cookieOwnership ||
        prepared.fingerprint !== target.sessionFingerprint) {
      return adapterError('SERVER_SESSION_ACCOUNT_MISMATCH', false);
    }
    return withAuthSessionMutationLock(async () => {
      const client = await this.getClient();
      if (!client) {
        return adapterError('SERVER_SESSION_PROVIDER_UNAVAILABLE', false);
      }
      const current = await this.readIdentity(client);
      if (!current.ok) return current;
      if (!current.value.present ||
          current.value.userId !== target.userId ||
          current.value.sessionFingerprint !== target.sessionFingerprint) {
        return adapterError('SERVER_SESSION_ACCOUNT_MISMATCH', false);
      }
      if (signal.aborted) {
        return adapterError('SERVER_SESSION_REVOKE_TIMEOUT', true);
      }
      const targeted = await this.revokeTargetSession(prepared.value, signal);
      if (!targeted.ok) return targeted;
      if (signal.aborted) {
        return adapterError('SERVER_SESSION_REVOKE_TIMEOUT', true);
      }
      const afterTarget = await this.readIdentity(client);
      if (!afterTarget.ok) return afterTarget;
      if (!afterTarget.value.present ||
          afterTarget.value.userId !== target.userId ||
          afterTarget.value.sessionFingerprint !== target.sessionFingerprint) {
        return adapterError('SERVER_SESSION_ACCOUNT_MISMATCH', false);
      }
      const localCleanup =
        await this.clearOwnedLocalArtifacts(cookieOwnership);
      if (typeof localCleanup === 'boolean') {
        if (!localCleanup) {
          return adapterError('SERVER_SESSION_ACCOUNT_MISMATCH', false);
        }
      } else if (!localCleanup.ok) {
        return adapterError(
          localCleanup.code === 'PARTIAL_CLEANUP'
            ? 'SERVER_SESSION_COOKIE_PARTIAL_CLEANUP'
            : 'SERVER_SESSION_ACCOUNT_MISMATCH',
          false,
        );
      }
      return { ok: true as const, value: undefined };
    }).catch(() => {
      return adapterError('SERVER_SESSION_REVOKE_NETWORK_FAILED', true);
    });
  }

  async verifyEmpty(): Promise<ServerSessionAdapterResult<boolean>> {
    if (this.hasPendingAuthOperations()) {
      return adapterError('SERVER_SESSION_AUTH_OPERATION_PENDING', false);
    }
    const singleton = await this.getClient();
    const fresh = await this.getFreshClient();
    if (!singleton || !fresh) {
      return adapterError('SERVER_SESSION_PROVIDER_UNAVAILABLE', false);
    }
    const singletonIdentity = await this.readIdentity(singleton);
    if (!singletonIdentity.ok) return singletonIdentity;
    if (singletonIdentity.value.present) {
      return adapterError('SERVER_SESSION_STILL_PRESENT', false);
    }
    const freshIdentity = await this.readIdentity(fresh);
    if (!freshIdentity.ok) return freshIdentity;
    if (freshIdentity.value.present) {
      return adapterError('SERVER_SESSION_FRESH_RESTORE_PRESENT', false);
    }
    if (this.hasAuthCookies()) {
      return adapterError('SERVER_SESSION_COOKIE_STILL_PRESENT', false);
    }
    return { ok: true, value: true };
  }

  private async readIdentity(
    client: SupabaseSessionClient,
  ): Promise<ServerSessionAdapterResult<ServerSessionIdentity>> {
    try {
      const { data, error } = await client.auth.getSession();
      if (error) return adapterError('SERVER_SESSION_READ_FAILED', false);
      const session = data.session;
      if (!session) return { ok: true, value: { present: false } };
      const userId = session.user?.id?.trim();
      const accessToken = session.access_token?.trim();
      if (!userId || !accessToken) {
        return adapterError('SERVER_SESSION_ACCOUNT_REQUIRED', false);
      }
      return {
        ok: true,
        value: {
          present: true,
          userId,
          sessionFingerprint: await hashSecret(accessToken),
        },
      };
    } catch {
      return adapterError('SERVER_SESSION_READ_FAILED', false);
    }
  }

  private async readRawSession(
    client: SupabaseSessionClient,
  ): Promise<ServerSessionAdapterResult<{
    accessToken: string;
    userId: string;
  } | null>> {
    try {
      const { data, error } = await client.auth.getSession();
      if (error) return adapterError('SERVER_SESSION_READ_FAILED', false);
      const accessToken = data.session?.access_token?.trim();
      const userId = data.session?.user?.id?.trim();
      if (!data.session) return { ok: true, value: null };
      if (!accessToken || !userId) {
        return adapterError('SERVER_SESSION_ACCOUNT_REQUIRED', false);
      }
      return { ok: true, value: { accessToken, userId } };
    } catch {
      return adapterError('SERVER_SESSION_READ_FAILED', false);
    }
  }
}

function validateContext(
  context: CleanupContext,
): Extract<CleanupParticipantResult, { ok: false }> | null {
  if (!isAccountAccessLocked() || getCleanupGeneration() !== context.generation) {
    return failure('SERVER_SESSION_GENERATION_MISMATCH', false);
  }
  return null;
}

async function withTimeout(
  operation: (
    signal: AbortSignal,
  ) => Promise<ServerSessionAdapterResult<undefined>>,
  timeoutMs: number,
): Promise<ServerSessionAdapterResult<undefined>> {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<ServerSessionAdapterResult<undefined>>((resolve) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      resolve(adapterError('SERVER_SESSION_REVOKE_TIMEOUT', true));
    }, timeoutMs);
  });
  try {
    return await Promise.race([operation(controller.signal), timeout]);
  } finally {
    if (timeoutId !== null) clearTimeout(timeoutId);
  }
}

async function revokeProductionTargetSession(
  accessToken: string,
  signal: AbortSignal,
): Promise<ServerSessionAdapterResult<undefined>> {
  try {
    const response = await fetch('/api/auth/revoke-session', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      signal,
    });
    if (response.ok) return { ok: true, value: undefined };
    return adapterError(
      response.status >= 500
        ? 'SERVER_SESSION_REVOKE_NETWORK_FAILED'
        : 'SERVER_SESSION_REVOKE_FAILED',
      response.status >= 500,
    );
  } catch {
    return adapterError('SERVER_SESSION_REVOKE_NETWORK_FAILED', true);
  }
}

async function hashAccountId(accountId: string): Promise<string> {
  return hashSecret(accountId);
}

async function hashSecret(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function getProductionSupabaseClient():
Promise<SupabaseSessionClient | null> {
  const { supabaseBrowser } = await import('@/lib/supabase');
  return supabaseBrowser;
}

async function getProductionFreshSupabaseClient():
Promise<SupabaseSessionClient | null> {
  const { createFreshSupabaseBrowserClient } =
    await import('@/lib/supabaseBrowser');
  return createFreshSupabaseBrowserClient();
}

function productionHasAuthCookies(): boolean {
  return hasSupabaseAuthCookieChunks();
}

function adapterFailure<T>(
  result: Extract<ServerSessionAdapterResult<T>, { ok: false }>,
): Extract<CleanupParticipantResult, { ok: false }> {
  return failure(result.failureCode, result.retryable);
}

function adapterError(
  failureCode: ServerSessionCleanupFailureCode,
  retryable: boolean,
): Extract<ServerSessionAdapterResult<never>, { ok: false }> {
  return { ok: false, retryable, failureCode };
}

function failure(
  failureCode: ServerSessionCleanupFailureCode,
  retryable: boolean,
): Extract<CleanupParticipantResult, { ok: false }> {
  return { ok: false, retryable, failureCode };
}
