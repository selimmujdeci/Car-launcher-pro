// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSessionUser } from '@/hooks/useSessionUser';
import {
  activateAccountSecurityLockdown,
  releaseAccountSecurityLockdown,
  resetAccountSecurityLockdownForTests,
} from '@/security/accountCleanup/cleanupLockdown';
import { resetAuthSessionOperationsForTests } from
  '@/security/accountCleanup/authSessionGenerationGuard';

const authMocks = vi.hoisted(() => {
  let callback:
    ((event: string, session: {
      access_token: string;
      user: { id: string };
    } | null) => void) |
    null = null;
  let resolveSession:
    ((value: { data: { session: {
      access_token: string;
      user: { id: string };
    } | null } }) => void) |
    null = null;
  return {
    getSession: vi.fn(() => new Promise<{
      data: { session: {
        access_token: string;
        user: { id: string };
      } | null };
    }>((resolve) => { resolveSession = resolve; })),
    onAuthStateChange: vi.fn((listener: typeof callback) => {
      callback = listener;
      return {
        data: { subscription: { unsubscribe: vi.fn() } },
      };
    }),
    emit(userId: string | null) {
      callback?.(
        userId ? 'SIGNED_IN' : 'SIGNED_OUT',
        userId ? { access_token: `token-${userId}`, user: { id: userId } } : null,
      );
    },
    resolveUser(userId: string | null) {
      resolveSession?.({
        data: { session: userId
          ? { access_token: `token-${userId}`, user: { id: userId } }
          : null },
      });
    },
    reset() {
      callback = null;
      resolveSession = null;
    },
  };
});
const transitionMocks = vi.hoisted(() => ({
  request: vi.fn(async () => ({
    ok: false as const,
    cleanupId: 'account-transition',
    state: 'FAILED_BLOCKING' as const,
    failureCode: 'PARTICIPANT_FAILED_BLOCKING',
  })),
}));
const offlineMocks = vi.hoisted(() => ({
  reset: vi.fn(async () => undefined),
}));

vi.mock('@/lib/supabase', () => ({
  supabaseBrowser: {
    auth: {
      getSession: authMocks.getSession,
      onAuthStateChange: authMocks.onAuthStateChange,
    },
  },
}));

vi.mock('@/security/accountCleanup/canonicalLogout', () => ({
  requestCanonicalAccountTransition: transitionMocks.request,
}));
vi.mock('@/lib/offline/fleetOffline', () => ({
  resetOfflineState: offlineMocks.reset,
}));

function Probe() {
  const session = useSessionUser();
  return (
    <output data-user={session.userId ?? ''} data-loading={session.loading}>
      {session.userId ?? 'anonymous'}
    </output>
  );
}

describe('canonical auth writer integration', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    authMocks.reset();
    authMocks.getSession.mockClear();
    authMocks.onAuthStateChange.mockClear();
    transitionMocks.request.mockClear();
    offlineMocks.reset.mockClear();
    resetAuthSessionOperationsForTests();
    resetAccountSecurityLockdownForTests();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    container.remove();
  });

  it('rejects stale hydration and auth callbacks while cleanup is active',
    async () => {
      await act(async () => { root.render(<Probe />); });
      const lockdown = activateAccountSecurityLockdown(
        'auth-writer-cleanup',
        'account_switch',
        1,
      );

      await act(async () => {
        authMocks.resolveUser('account-a');
        authMocks.emit('account-a');
        await Promise.resolve();
      });

      expect(container.querySelector('output')?.dataset.user).toBe('');
      expect(container.textContent).toBe('anonymous');
      expect(releaseAccountSecurityLockdown(lockdown.cleanupId!)).toBe(true);
    });

  it('accepts Account B callback after verified cleanup without remount',
    async () => {
      await act(async () => { root.render(<Probe />); });
      const lockdown = activateAccountSecurityLockdown(
        'auth-writer-switch',
        'account_switch',
        1,
      );
      await act(async () => { authMocks.emit('account-a'); });
      expect(container.querySelector('output')?.dataset.user).toBe('');

      expect(releaseAccountSecurityLockdown(lockdown.cleanupId!)).toBe(true);
      await act(async () => { authMocks.emit('account-b'); });
      expect(container.querySelector('output')?.dataset.user).toBe('account-b');
    });

  it('does not start cleanup for same-account token refresh', async () => {
    await act(async () => { root.render(<Probe />); });
    await act(async () => {
      authMocks.resolveUser('account-a');
      await Promise.resolve();
      authMocks.emit('account-a');
    });
    expect(transitionMocks.request).not.toHaveBeenCalled();
    expect(offlineMocks.reset).not.toHaveBeenCalled();
    expect(container.querySelector('output')?.dataset.user).toBe('account-a');
  });

  it('routes Account A to B through canonical transition without applying B',
    async () => {
      await act(async () => { root.render(<Probe />); });
      await act(async () => {
        authMocks.resolveUser('account-a');
        await Promise.resolve();
        authMocks.emit('account-b');
      });
      expect(transitionMocks.request).toHaveBeenCalledWith(
        expect.objectContaining({ accountId: 'account-a' }),
        'account-b',
      );
      expect(offlineMocks.reset).not.toHaveBeenCalled();
      expect(container.querySelector('output')?.dataset.user).toBe('account-a');
    });

  it('does not start a second transaction for SIGNED_OUT during lockdown',
    async () => {
      await act(async () => { root.render(<Probe />); });
      await act(async () => {
        authMocks.resolveUser('account-a');
        await Promise.resolve();
      });
      activateAccountSecurityLockdown('canonical-logout', 'logout', 2);
      await act(async () => { authMocks.emit(null); });
      expect(transitionMocks.request).not.toHaveBeenCalled();
      expect(offlineMocks.reset).not.toHaveBeenCalled();
    });
});
