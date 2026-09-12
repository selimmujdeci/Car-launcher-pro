import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CleanupRunResult } from
  '@/security/accountCleanup/cleanupTypes';

const mocks = vi.hoisted(() => ({
  initialize: vi.fn(async () => undefined),
  requestCleanup: vi.fn(),
}));

vi.mock('@/security/accountCleanup/accountCleanupRuntime', () => ({
  getAccountCleanupRuntime: () => ({
    initialize: mocks.initialize,
    coordinator: { requestCleanup: mocks.requestCleanup },
  }),
}));

import {
  requestCanonicalLogout,
  requestCanonicalAccountTransition,
  resetCanonicalLogoutForTests,
} from '@/security/accountCleanup/canonicalLogout';
import {
  captureAuthCleanupTarget,
  observeAuthCleanupTarget,
  resetAuthCleanupTargetForTests,
} from '@/security/accountCleanup/authCleanupTarget';
import { POST as legacyLogout } from '@/app/api/auth/logout/route';

describe('canonical logout transaction', () => {
  beforeEach(async () => {
    resetCanonicalLogoutForTests();
    resetAuthCleanupTargetForTests();
    await observeAuthCleanupTarget({
      access_token: 'token-a',
      user: { id: 'account-a' },
    });
    mocks.initialize.mockClear();
    mocks.requestCleanup.mockReset();
  });

  it('deduplicates double logout into one coordinator transaction', async () => {
    let resolveRun: (value: {
      ok: true;
      cleanupId: string;
      state: 'COMPLETED';
    }) => void = () => undefined;
    const run = new Promise<{
      ok: true;
      cleanupId: string;
      state: 'COMPLETED';
    }>((resolve) => { resolveRun = resolve; });
    mocks.requestCleanup.mockReturnValue(run);

    const first = requestCanonicalLogout();
    const second = requestCanonicalLogout();
    expect(first).toBe(second);
    await vi.waitFor(() => {
      expect(mocks.requestCleanup).toHaveBeenCalledTimes(1);
    });
    expect(mocks.requestCleanup).toHaveBeenCalledWith({
      reason: 'logout',
      previousAccountId: 'account-a',
      expectedSessionFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    resolveRun({
      ok: true,
      cleanupId: 'cleanup-a',
      state: 'COMPLETED',
    });
    await expect(first).resolves.toMatchObject({ ok: true });
  });

  it('returns blocking cleanup failure without a fallback signOut', async () => {
    mocks.requestCleanup.mockResolvedValue({
      ok: false,
      cleanupId: 'cleanup-a',
      state: 'FAILED_BLOCKING',
      failureCode: 'PARTICIPANT_FAILED_BLOCKING',
    });
    await expect(requestCanonicalLogout()).resolves.toMatchObject({
      ok: false,
      state: 'FAILED_BLOCKING',
    });
  });

  it('captures Account A before initialization and never retargets Account B',
    async () => {
      let releaseInitialize: () => void = () => undefined;
      mocks.initialize.mockImplementationOnce(() => new Promise<undefined>(
        (resolve) => { releaseInitialize = () => resolve(undefined); },
      ));
      mocks.requestCleanup.mockResolvedValue({
        ok: false,
        cleanupId: 'cleanup-a',
        state: 'FAILED_BLOCKING',
        failureCode: 'PARTICIPANT_FAILED_BLOCKING',
      });
      const accountA = captureAuthCleanupTarget();
      const run = requestCanonicalLogout();
      await observeAuthCleanupTarget({
        access_token: 'token-b',
        user: { id: 'account-b' },
      });
      releaseInitialize();
      await run;
      expect(mocks.requestCleanup).toHaveBeenCalledWith({
        reason: 'logout',
        previousAccountId: 'account-a',
        expectedSessionFingerprint: accountA?.sessionFingerprint,
      });
    });

  it('does not reuse an A-to-B transaction for A-to-C', async () => {
    let resolveRun: (value: CleanupRunResult) => void = () => undefined;
    const pending = new Promise<CleanupRunResult>(
      (resolve) => { resolveRun = resolve; },
    );
    mocks.requestCleanup.mockReturnValue(pending);
    const accountA = captureAuthCleanupTarget();
    if (!accountA) throw new Error('expected Account A target');
    const toB = requestCanonicalAccountTransition(accountA, 'account-b');
    await vi.waitFor(() => expect(mocks.requestCleanup).toHaveBeenCalled());
    await expect(requestCanonicalAccountTransition(accountA, 'account-c'))
      .resolves.toMatchObject({
        ok: false,
        failureCode: 'CONCURRENT_CLEANUP_REJECTED',
      });
    resolveRun({ ok: true, cleanupId: 'cleanup-a', state: 'COMPLETED' });
    await toB;
  });

  it('rejects the legacy logout API as a direct authority bypass', async () => {
    const response = await legacyLogout();
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      code: 'CANONICAL_CLEANUP_REQUIRED',
    });
  });
});
