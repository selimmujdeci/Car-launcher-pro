import { CleanupLedger } from './cleanupLedger';
import { isAccountAccessLocked } from './cleanupLockdown';
import type { CleanupBootGateResult } from './cleanupTypes';

const RECOVERY_STATES = new Set([
  'REQUESTED',
  'LOCAL_LOCKDOWN',
  'LOCAL_SECRET_PURGE',
  'LOCAL_PRIVATE_DATA_PURGE',
  'QUEUE_AND_SNAPSHOT_PURGE',
  'SERVER_SESSION_REVOKE',
  'DEVICE_AND_PUSH_REVOKE',
  'VERIFY_EMPTY',
  'FAILED_RETRYABLE',
  'PARTIAL_CLEANUP',
  'RECOVERY_REQUIRED',
]);

export function evaluateCleanupBootGate(
  ledger: CleanupLedger,
  hasAuthenticatedSession: boolean,
): CleanupBootGateResult {
  const result = ledger.read();
  if (!result.ok) {
    return { status: 'STORAGE_CORRUPTED', coverage: 'FOUNDATION_ONLY' };
  }
  const entry = result.entry;
  if (isAccountAccessLocked()) {
    return {
      status: 'CLEANUP_RECOVERY_REQUIRED',
      coverage: 'FOUNDATION_ONLY',
      cleanupId: entry?.cleanupId,
      failureCode: entry?.failureCode,
    };
  }
  if (entry?.state === 'FAILED_BLOCKING') {
    return {
      status: 'SECURITY_RESET_REQUIRED',
      coverage: 'FOUNDATION_ONLY',
    };
  }
  if (entry && RECOVERY_STATES.has(entry.state)) {
    return {
      status: 'CLEANUP_RECOVERY_REQUIRED',
      coverage: 'FOUNDATION_ONLY',
      cleanupId: entry.cleanupId,
      failureCode: entry.failureCode,
    };
  }
  if (!hasAuthenticatedSession) {
    return { status: 'AUTH_REQUIRED', coverage: 'FOUNDATION_ONLY' };
  }
  return { status: 'SAFE_TO_START', coverage: 'FOUNDATION_ONLY' };
}
