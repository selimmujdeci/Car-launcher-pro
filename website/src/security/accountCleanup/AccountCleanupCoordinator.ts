import {
  CLEANUP_LEDGER_SCHEMA_VERSION,
  CleanupLedger,
} from './cleanupLedger';
import {
  activateAccountSecurityLockdown,
  getCleanupGeneration,
  isAccountAccessLocked,
  releaseAccountSecurityLockdown,
} from './cleanupLockdown';
import { CleanupParticipantRegistry } from './cleanupParticipantRegistry';
import { assertCleanupTransition } from './cleanupStateMachine';
import {
  CLEANUP_PHASES,
  isCleanupReason,
  type CleanupContext,
  type CleanupFailureCode,
  type CleanupLedgerEntry,
  type CleanupPhase,
  type CleanupRequest,
  type CleanupRunResult,
  type CleanupState,
} from './cleanupTypes';

type CoordinatorOptions = {
  now?: () => number;
  newId?: () => string;
  hashAccountId?: (accountId: string) => Promise<string>;
};

const PHASES: readonly CleanupPhase[] = CLEANUP_PHASES;

export class AccountCleanupCoordinator {
  private activeRun: Promise<CleanupRunResult> | null = null;
  private activeCleanupId: string | null = null;
  private readonly now: () => number;
  private readonly newId: () => string;
  private readonly hashAccountId: (accountId: string) => Promise<string>;

  constructor(
    private readonly ledger: CleanupLedger,
    private readonly registry: CleanupParticipantRegistry,
    options: CoordinatorOptions = {},
  ) {
    this.now = options.now ?? (() => Date.now());
    this.newId = options.newId ?? defaultCleanupId;
    this.hashAccountId = options.hashAccountId ?? hashAccountId;
  }

  requestCleanup(request: CleanupRequest): Promise<CleanupRunResult> {
    if (!isCleanupReason(request.reason)) {
      return Promise.resolve({
        ok: false,
        cleanupId: 'invalid',
        state: 'FAILED_BLOCKING',
        failureCode: 'UNKNOWN_CLEANUP_REASON',
      });
    }
    if (this.activeRun) return this.activeRun;

    const cleanupId = this.newId();
    // Lockdown is deliberately synchronous and happens before hashing or I/O.
    activateAccountSecurityLockdown(cleanupId, request.reason, this.now());
    this.activeCleanupId = cleanupId;
    this.activeRun = this.startNewCleanup(cleanupId, request)
      .finally(() => {
        this.activeRun = null;
        this.activeCleanupId = null;
      });
    return this.activeRun;
  }

  async recoverPendingCleanup(): Promise<CleanupRunResult | null> {
    if (this.activeRun) return this.activeRun;
    const read = this.ledger.read();
    if (!read.ok) {
      const cleanupId = this.newId();
      activateAccountSecurityLockdown(cleanupId, 'security_reset', this.now());
      return this.failWithoutLedger(read.failureCode, cleanupId);
    }
    const entry = read.entry;
    if (!entry || entry.state === 'COMPLETED') return null;

    const recoveryLockdown = activateAccountSecurityLockdown(
      entry.cleanupId,
      entry.reason,
      this.now(),
    );
    // VERIFY_EMPTY is a point-in-time assertion, not durable proof. A process
    // can die after verification and authority can be restored before boot.
    // Every recovery therefore uses the active runtime generation and repeats
    // the complete verification phase before it can write COMPLETED.
    const recoveryCompletedSteps = entry.completedSteps.filter(
      (step) => step !== 'VERIFY_EMPTY',
    );
    const recovered = this.transition(entry, 'RECOVERY_REQUIRED', {
      retryCount: entry.retryCount + 1,
      lastAttemptAt: this.now(),
      failureCode: 'RECOVERY_REQUIRED',
      generation: recoveryLockdown.generation,
      completedSteps: recoveryCompletedSteps,
    });
    if (!recovered) {
      return this.failWithoutLedger('LEDGER_WRITE_FAILED', entry.cleanupId);
    }
    this.activeCleanupId = entry.cleanupId;
    this.activeRun = this.runFromLedger(recovered)
      .finally(() => {
        this.activeRun = null;
        this.activeCleanupId = null;
      });
    return this.activeRun;
  }

  getCurrentLedger(): CleanupLedgerEntry | null {
    const result = this.ledger.read();
    return result.ok ? result.entry : null;
  }

  isLockedDown(): boolean {
    return isAccountAccessLocked();
  }

  canActivateAccount(_accountId: string): boolean {
    if (isAccountAccessLocked() || this.activeRun) return false;
    const result = this.ledger.read();
    return result.ok &&
      (result.entry === null || result.entry.state === 'COMPLETED');
  }

  private async startNewCleanup(
    cleanupId: string,
    request: CleanupRequest,
  ): Promise<CleanupRunResult> {
    let previousAccountHash: string | undefined;
    if (request.previousAccountId) {
      previousAccountHash = await this.hashAccountId(request.previousAccountId);
    }
    const now = this.now();
    const entry: CleanupLedgerEntry = {
      cleanupId,
      requestedAt: now,
      reason: request.reason,
      previousAccountHash,
      expectedSessionFingerprint: request.expectedSessionFingerprint,
      state: 'REQUESTED',
      completedSteps: ['REQUESTED'],
      retryCount: 0,
      lastAttemptAt: now,
      schemaVersion: CLEANUP_LEDGER_SCHEMA_VERSION,
      generation: getCleanupGeneration(),
    };
    if (!this.ledger.write(entry)) {
      return this.failWithoutLedger('LEDGER_WRITE_FAILED', cleanupId);
    }
    return this.runFromLedger(entry);
  }

  private async runFromLedger(
    initial: CleanupLedgerEntry,
  ): Promise<CleanupRunResult> {
    let entry = initial;
    const context: CleanupContext = {
      cleanupId: entry.cleanupId,
      reason: entry.reason,
      previousAccountHash: entry.previousAccountHash,
      expectedSessionFingerprint: entry.expectedSessionFingerprint,
      startedAt: entry.requestedAt,
      generation: entry.generation,
    };

    if (entry.state === 'REQUESTED') {
      const transitioned = this.transition(entry, 'LOCAL_LOCKDOWN');
      if (!transitioned) {
        return this.failWithoutLedger('LEDGER_WRITE_FAILED', entry.cleanupId);
      }
      entry = transitioned;
    } else if (entry.state === 'RECOVERY_REQUIRED') {
      const next = this.firstIncompletePhase(entry);
      const transitioned = this.transition(entry, next);
      if (!transitioned) {
        return this.failWithoutLedger('LEDGER_WRITE_FAILED', entry.cleanupId);
      }
      entry = transitioned;
    }

    for (const phase of PHASES) {
      if (entry.completedSteps.includes(phase)) continue;
      if (entry.state !== phase) {
        const transitioned = this.transition(entry, phase);
        if (!transitioned) {
          return this.failWithoutLedger('LEDGER_WRITE_FAILED', entry.cleanupId);
        }
        entry = transitioned;
      }

      if (!this.registry.hasParticipantForPhase(phase)) {
        return this.persistFailure(
          entry,
          'FAILED_BLOCKING',
          'MISSING_PHASE_PARTICIPANT',
        );
      }
      if (phase === 'VERIFY_EMPTY' &&
          !this.registry.hasVerificationParticipant()) {
        return this.persistFailure(
          entry,
          'FAILED_BLOCKING',
          'MISSING_VERIFICATION_PARTICIPANT',
        );
      }

      const participants = this.registry.listForPhase(phase);
      for (const participant of participants) {
        let result;
        try {
          result = await participant.clear(context);
        } catch {
          result = {
            ok: false as const,
            retryable: false,
            failureCode: 'PARTICIPANT_EXCEPTION',
          };
        }
        if (!result.ok) {
          return this.persistFailure(
            entry,
            result.retryable ? 'FAILED_RETRYABLE' : 'FAILED_BLOCKING',
            result.retryable
              ? 'PARTICIPANT_FAILED_RETRYABLE'
              : 'PARTICIPANT_FAILED_BLOCKING',
          );
        }
        if (phase === 'VERIFY_EMPTY') {
          if (!participant.verifyEmpty) {
            return this.persistFailure(
              entry,
              'FAILED_BLOCKING',
              'VERIFY_EMPTY_FAILED',
            );
          }
          let empty = false;
          try {
            empty = await participant.verifyEmpty(context);
          } catch {
            empty = false;
          }
          if (!empty) {
            return this.persistFailure(
              entry,
              'FAILED_BLOCKING',
              'VERIFY_EMPTY_FAILED',
            );
          }
        }
      }
      const completedStep = this.completeStep(entry, phase);
      if (!completedStep) {
        return this.failWithoutLedger('LEDGER_WRITE_FAILED', context.cleanupId);
      }
      entry = completedStep;
    }

    const completed = this.transition(entry, 'COMPLETED', {
      completedAt: this.now(),
      failureCode: undefined,
      failedStep: undefined,
    });
    if (!completed) {
      return this.failWithoutLedger('LEDGER_WRITE_FAILED', context.cleanupId);
    }
    releaseAccountSecurityLockdown(context.cleanupId);
    return { ok: true, cleanupId: context.cleanupId, state: 'COMPLETED' };
  }

  private completeStep(
    entry: CleanupLedgerEntry,
    phase: CleanupPhase,
  ): CleanupLedgerEntry | null {
    const completedSteps = entry.completedSteps.includes(phase)
      ? entry.completedSteps
      : [...entry.completedSteps, phase];
    const next: CleanupLedgerEntry = {
      ...entry,
      completedSteps,
      lastAttemptAt: this.now(),
    };
    return this.ledger.write(next) ? next : null;
  }

  private transition(
    entry: CleanupLedgerEntry,
    state: CleanupState,
    patch: Partial<CleanupLedgerEntry> = {},
  ): CleanupLedgerEntry | null {
    try {
      assertCleanupTransition(entry.state, state);
    } catch {
      return null;
    }
    const next: CleanupLedgerEntry = {
      ...entry,
      ...patch,
      state,
      lastAttemptAt: this.now(),
    };
    return this.ledger.write(next) ? next : null;
  }

  private persistFailure(
    entry: CleanupLedgerEntry,
    state: 'FAILED_RETRYABLE' | 'FAILED_BLOCKING',
    failureCode: CleanupFailureCode,
  ): CleanupRunResult {
    const failed = this.transition(entry, state, {
      failedStep: entry.state,
      failureCode,
      retryCount: entry.retryCount + 1,
    });
    if (!failed) {
      return this.failWithoutLedger('LEDGER_WRITE_FAILED', entry.cleanupId);
    }
    return {
      ok: false,
      cleanupId: entry.cleanupId,
      state,
      failureCode,
    };
  }

  private failWithoutLedger(
    failureCode: CleanupFailureCode,
    cleanupId = this.activeCleanupId ?? 'unknown',
  ): CleanupRunResult {
    return {
      ok: false,
      cleanupId,
      state: 'FAILED_BLOCKING',
      failureCode,
    };
  }

  private firstIncompletePhase(entry: CleanupLedgerEntry): CleanupPhase {
    return PHASES.find((phase) => !entry.completedSteps.includes(phase)) ??
      'VERIFY_EMPTY';
  }
}

function defaultCleanupId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `cleanup-${Date.now()}`;
}

async function hashAccountId(accountId: string): Promise<string> {
  const bytes = new TextEncoder().encode(accountId);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
