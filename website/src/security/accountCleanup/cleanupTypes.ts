export const CLEANUP_REASONS = [
  'logout',
  'account_switch',
  'session_expired',
  'session_revoked',
  'lost_device',
  'security_reset',
] as const;

export type CleanupReason = (typeof CLEANUP_REASONS)[number];

export const CLEANUP_STATES = [
  'IDLE',
  'REQUESTED',
  'LOCAL_LOCKDOWN',
  'LOCAL_SECRET_PURGE',
  'LOCAL_PRIVATE_DATA_PURGE',
  'QUEUE_AND_SNAPSHOT_PURGE',
  'SERVER_SESSION_REVOKE',
  'DEVICE_AND_PUSH_REVOKE',
  'VERIFY_EMPTY',
  'COMPLETED',
  'FAILED_RETRYABLE',
  'FAILED_BLOCKING',
  'PARTIAL_CLEANUP',
  'RECOVERY_REQUIRED',
] as const;

export type CleanupState = (typeof CLEANUP_STATES)[number];

export const CLEANUP_PHASES = [
  'LOCAL_SECRET_PURGE',
  'LOCAL_PRIVATE_DATA_PURGE',
  'QUEUE_AND_SNAPSHOT_PURGE',
  'SERVER_SESSION_REVOKE',
  'DEVICE_AND_PUSH_REVOKE',
  'VERIFY_EMPTY',
] as const;

export type CleanupPhase = (typeof CLEANUP_PHASES)[number];

export type CleanupFailureCode =
  | 'LEDGER_READ_FAILED'
  | 'LEDGER_WRITE_FAILED'
  | 'LEDGER_CORRUPTED'
  | 'LEGACY_TARGET_UNVERIFIABLE'
  | 'INVALID_STATE_TRANSITION'
  | 'PARTICIPANT_FAILED_RETRYABLE'
  | 'PARTICIPANT_FAILED_BLOCKING'
  | 'VERIFY_EMPTY_FAILED'
  | 'MISSING_PHASE_PARTICIPANT'
  | 'MISSING_VERIFICATION_PARTICIPANT'
  | 'CONCURRENT_CLEANUP_REJECTED'
  | 'AUTH_CLEANUP_TARGET_UNAVAILABLE'
  | 'UNKNOWN_CLEANUP_REASON'
  | 'RECOVERY_REQUIRED';

export type CleanupLedgerEntry = {
  cleanupId: string;
  requestedAt: number;
  reason: CleanupReason;
  previousAccountHash?: string;
  expectedSessionFingerprint?: string;
  state: CleanupState;
  completedSteps: CleanupState[];
  failedStep?: CleanupState;
  failureCode?: CleanupFailureCode;
  retryCount: number;
  lastAttemptAt: number;
  completedAt?: number;
  schemaVersion: number;
  generation: number;
};

export type CleanupContext = {
  cleanupId: string;
  reason: CleanupReason;
  previousAccountHash?: string;
  expectedSessionFingerprint?: string;
  startedAt: number;
  generation: number;
  signal?: AbortSignal;
};

export type CleanupParticipantResult =
  | { ok: true; code: 'CLEARED' | 'ALREADY_EMPTY' | 'NOT_APPLICABLE' }
  | { ok: false; retryable: boolean; failureCode: string };

export interface AccountCleanupParticipant {
  id: string;
  phase: CleanupPhase;
  priority: number;
  clear(context: CleanupContext): Promise<CleanupParticipantResult>;
  verifyEmpty?(context: CleanupContext): Promise<boolean>;
}

export type CleanupRequest = {
  reason: CleanupReason;
  /** Raw IDs are hashed before persistence and never written to diagnostics. */
  previousAccountId?: string | null;
  /** SHA-256 only; no raw access/refresh token is persisted. */
  expectedSessionFingerprint?: string;
};

export type CleanupRunResult =
  | { ok: true; cleanupId: string; state: 'COMPLETED' }
  | {
      ok: false;
      cleanupId: string;
      state:
        | 'FAILED_RETRYABLE'
        | 'FAILED_BLOCKING'
        | 'PARTIAL_CLEANUP'
        | 'RECOVERY_REQUIRED';
      failureCode: CleanupFailureCode;
    };

export type CleanupBootGateResult =
  | { status: 'SAFE_TO_START'; coverage: 'FOUNDATION_ONLY' }
  | { status: 'AUTH_REQUIRED'; coverage: 'FOUNDATION_ONLY' }
  | {
      status: 'CLEANUP_RECOVERY_REQUIRED';
      coverage: 'FOUNDATION_ONLY';
      cleanupId?: string;
      failureCode?: CleanupFailureCode;
    }
  | { status: 'NAMESPACE_MISMATCH'; coverage: 'NOT_IMPLEMENTED' }
  | { status: 'SECURITY_RESET_REQUIRED'; coverage: 'FOUNDATION_ONLY' }
  | { status: 'STORAGE_CORRUPTED'; coverage: 'FOUNDATION_ONLY' };

export function isCleanupReason(value: unknown): value is CleanupReason {
  return typeof value === 'string' &&
    (CLEANUP_REASONS as readonly string[]).includes(value);
}

export function isCleanupState(value: unknown): value is CleanupState {
  return typeof value === 'string' &&
    (CLEANUP_STATES as readonly string[]).includes(value);
}

export function isCleanupPhase(value: unknown): value is CleanupPhase {
  return typeof value === 'string' &&
    (CLEANUP_PHASES as readonly string[]).includes(value);
}
