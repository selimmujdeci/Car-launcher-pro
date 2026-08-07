import {
  cleanupOfflineQueueAuthority,
  cleanupOwnershipSnapshotAuthority,
  cleanupPendingPairingAuthority,
  prepareOfflineQueueCleanup,
  preparePendingPairingCleanup,
  verifyOfflineQueueAuthorityEmpty,
  verifyOwnershipSnapshotAuthorityEmpty,
  verifyPendingPairingAuthorityEmpty,
} from '@/lib/offline/fleetOffline';
import {
  getCleanupGeneration,
  isAccountAccessLocked,
} from './cleanupLockdown';
import type {
  AccountCleanupParticipant,
  CleanupContext,
  CleanupParticipantResult,
} from './cleanupTypes';

export type OfflineAuthorityCleanupFailureCode =
  | 'OFFLINE_AUTHORITY_GENERATION_MISMATCH'
  | 'OFFLINE_QUEUE_PURGE_FAILED'
  | 'OWNERSHIP_SNAPSHOT_PURGE_FAILED'
  | 'PENDING_PAIRING_PURGE_FAILED'
  | 'OFFLINE_QUEUE_STILL_PRESENT'
  | 'OWNERSHIP_SNAPSHOT_STILL_PRESENT'
  | 'PENDING_PAIRING_STILL_PRESENT';

export interface OfflineAuthorityDomainAdapter {
  prepare(): void | Promise<void>;
  cleanup(): boolean | Promise<boolean>;
  verifyEmpty(): boolean | Promise<boolean>;
}

export class OfflineQueueCleanupParticipant
implements AccountCleanupParticipant {
  readonly id = 'offline-queue-cleanup';
  readonly phase = 'QUEUE_AND_SNAPSHOT_PURGE' as const;
  readonly priority = 10;

  constructor(private readonly adapter: OfflineAuthorityDomainAdapter) {}

  async clear(context: CleanupContext): Promise<CleanupParticipantResult> {
    return runCleanup(
      context, this.adapter,
      'OFFLINE_QUEUE_PURGE_FAILED', 'OFFLINE_QUEUE_STILL_PRESENT',
    );
  }
}

export class OwnershipSnapshotCleanupParticipant
implements AccountCleanupParticipant {
  readonly id = 'ownership-snapshot-cleanup';
  readonly phase = 'QUEUE_AND_SNAPSHOT_PURGE' as const;
  readonly priority = 20;

  constructor(private readonly adapter: OfflineAuthorityDomainAdapter) {}

  async clear(context: CleanupContext): Promise<CleanupParticipantResult> {
    return runCleanup(
      context, this.adapter,
      'OWNERSHIP_SNAPSHOT_PURGE_FAILED', 'OWNERSHIP_SNAPSHOT_STILL_PRESENT',
    );
  }
}

export class PendingPairingCleanupParticipant
implements AccountCleanupParticipant {
  readonly id = 'pending-pairing-cleanup';
  readonly phase = 'QUEUE_AND_SNAPSHOT_PURGE' as const;
  readonly priority = 30;

  constructor(private readonly adapter: OfflineAuthorityDomainAdapter) {}

  async clear(context: CleanupContext): Promise<CleanupParticipantResult> {
    return runCleanup(
      context, this.adapter,
      'PENDING_PAIRING_PURGE_FAILED', 'PENDING_PAIRING_STILL_PRESENT',
    );
  }
}

export class OfflineAuthorityVerificationParticipant
implements AccountCleanupParticipant {
  readonly id = 'offline-authority-verification';
  readonly phase = 'VERIFY_EMPTY' as const;
  readonly priority = 20;
  private verified = false;

  constructor(
    private readonly queue: OfflineAuthorityDomainAdapter,
    private readonly ownership: OfflineAuthorityDomainAdapter,
    private readonly pairing: OfflineAuthorityDomainAdapter,
  ) {}

  async clear(context: CleanupContext): Promise<CleanupParticipantResult> {
    this.verified = false;
    const guard = validateContext(context);
    if (guard) return guard;
    try {
      if (!await this.queue.verifyEmpty()) {
        return failure('OFFLINE_QUEUE_STILL_PRESENT');
      }
      if (!await this.ownership.verifyEmpty()) {
        return failure('OWNERSHIP_SNAPSHOT_STILL_PRESENT');
      }
      if (!await this.pairing.verifyEmpty()) {
        return failure('PENDING_PAIRING_STILL_PRESENT');
      }
    } catch {
      return failure('OFFLINE_QUEUE_STILL_PRESENT');
    }
    this.verified = true;
    return { ok: true, code: 'ALREADY_EMPTY' };
  }

  async verifyEmpty(context: CleanupContext): Promise<boolean> {
    return this.verified && validateContext(context) === null;
  }
}

export function createProductionOfflineAuthorityAdapters(): {
  queue: OfflineAuthorityDomainAdapter;
  ownership: OfflineAuthorityDomainAdapter;
  pairing: OfflineAuthorityDomainAdapter;
} {
  return {
    queue: {
      prepare: prepareOfflineQueueCleanup,
      cleanup: cleanupOfflineQueueAuthority,
      verifyEmpty: verifyOfflineQueueAuthorityEmpty,
    },
    ownership: {
      prepare: () => undefined,
      cleanup: cleanupOwnershipSnapshotAuthority,
      verifyEmpty: verifyOwnershipSnapshotAuthorityEmpty,
    },
    pairing: {
      prepare: preparePendingPairingCleanup,
      cleanup: cleanupPendingPairingAuthority,
      verifyEmpty: verifyPendingPairingAuthorityEmpty,
    },
  };
}

async function runCleanup(
  context: CleanupContext,
  adapter: OfflineAuthorityDomainAdapter,
  purgeFailure: OfflineAuthorityCleanupFailureCode,
  verifyFailure: OfflineAuthorityCleanupFailureCode,
): Promise<CleanupParticipantResult> {
  const guard = validateContext(context);
  if (guard) return guard;
  try {
    const emptyBefore = await adapter.verifyEmpty();
    await adapter.prepare();
    const afterPrepareGuard = validateContext(context);
    if (afterPrepareGuard) return afterPrepareGuard;
    if (!await adapter.cleanup()) return failure(purgeFailure);
    if (!await adapter.verifyEmpty()) return failure(verifyFailure);
    return { ok: true, code: emptyBefore ? 'ALREADY_EMPTY' : 'CLEARED' };
  } catch {
    return failure(purgeFailure);
  }
}

function validateContext(
  context: CleanupContext,
): Extract<CleanupParticipantResult, { ok: false }> | null {
  if (!isAccountAccessLocked() || getCleanupGeneration() !== context.generation) {
    return failure('OFFLINE_AUTHORITY_GENERATION_MISMATCH');
  }
  return null;
}

function failure(
  failureCode: OfflineAuthorityCleanupFailureCode,
): Extract<CleanupParticipantResult, { ok: false }> {
  return { ok: false, retryable: false, failureCode };
}
