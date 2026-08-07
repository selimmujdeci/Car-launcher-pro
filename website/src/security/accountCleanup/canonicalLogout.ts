import { getAccountCleanupRuntime } from './accountCleanupRuntime';
import {
  captureAuthCleanupTarget,
  type AuthCleanupTarget,
} from './authCleanupTarget';
import type { CleanupRunResult } from './cleanupTypes';

type CleanupReason = 'logout' | 'account_switch';
type ActiveCleanup = {
  reason: CleanupReason;
  previousAccountId: string;
  nextAccountId: string | null;
  sessionFingerprint: string;
  promise: Promise<CleanupRunResult>;
};

let activeCleanup: ActiveCleanup | null = null;

export function requestCanonicalLogout(): Promise<CleanupRunResult> {
  // Synchronous capture deliberately precedes runtime initialization or locks.
  const target = captureAuthCleanupTarget();
  if (!target) return blockingResult('AUTH_CLEANUP_TARGET_UNAVAILABLE');
  return startOrJoin('logout', target, null);
}

export function requestCanonicalAccountTransition(
  previousTarget: AuthCleanupTarget,
  nextAccountId: string,
): Promise<CleanupRunResult> {
  return startOrJoin('account_switch', previousTarget, nextAccountId);
}

function startOrJoin(
  reason: CleanupReason,
  target: AuthCleanupTarget,
  nextAccountId: string | null,
): Promise<CleanupRunResult> {
  if (activeCleanup) {
    const same = activeCleanup.reason === reason &&
      activeCleanup.previousAccountId === target.accountId &&
      activeCleanup.nextAccountId === nextAccountId &&
      activeCleanup.sessionFingerprint === target.sessionFingerprint;
    return same
      ? activeCleanup.promise
      : blockingResult('CONCURRENT_CLEANUP_REJECTED');
  }
  const promise = startCleanup(reason, target).finally(() => {
    if (activeCleanup?.promise === promise) activeCleanup = null;
  });
  activeCleanup = {
    reason,
    previousAccountId: target.accountId,
    nextAccountId,
    sessionFingerprint: target.sessionFingerprint,
    promise,
  };
  return promise;
}

async function startCleanup(
  reason: CleanupReason,
  target: AuthCleanupTarget,
): Promise<CleanupRunResult> {
  const runtime = getAccountCleanupRuntime();
  await runtime.initialize();
  return runtime.coordinator.requestCleanup({
    reason,
    previousAccountId: target.accountId,
    expectedSessionFingerprint: target.sessionFingerprint,
  });
}

function blockingResult(
  failureCode:
    | 'AUTH_CLEANUP_TARGET_UNAVAILABLE'
    | 'CONCURRENT_CLEANUP_REJECTED',
): Promise<CleanupRunResult> {
  return Promise.resolve({
    ok: false,
    cleanupId: 'canonical-cleanup',
    state: 'FAILED_BLOCKING',
    failureCode,
  });
}

/** Test-only; production UI never resets an in-flight cleanup. */
export function resetCanonicalLogoutForTests(): void {
  activeCleanup = null;
}
