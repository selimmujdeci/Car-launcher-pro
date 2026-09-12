import {
  AccountCleanupCoordinator,
} from './AccountCleanupCoordinator';
import {
  BrowserCleanupLedgerStorage,
  CleanupLedger,
  type CleanupLedgerStorage,
} from './cleanupLedger';
import {
  evaluateCleanupBootGate,
} from './cleanupBootGate';
import {
  getAccountSecurityLockdownState,
  subscribeAccountSecurityLockdown,
} from './cleanupLockdown';
import {
  createVehicleCleanupComposition,
  type VehicleCleanupComposition,
} from './createAccountCleanupRuntime';
import type {
  CleanupReason,
  CleanupState,
} from './cleanupTypes';
import { CleanupParticipantRegistry } from './cleanupParticipantRegistry';
import { createProductionStorageRegistry } from './storage';
import {
  beginAuthSessionOperation,
  canApplyAuthSessionOperation,
  finishAuthSessionOperation,
} from './authSessionGenerationGuard';

export type RuntimeBootStatus =
  | 'CHECKING'
  | 'SAFE_TO_START'
  | 'AUTH_REQUIRED'
  | 'CLEANUP_RECOVERY_REQUIRED'
  | 'NAMESPACE_MISMATCH'
  | 'SECURITY_RESET_REQUIRED'
  | 'STORAGE_CORRUPTED'
  | 'RUNTIME_ERROR';

export type AccountCleanupRuntimeSnapshot = Readonly<{
  initialized: boolean;
  lockdownActive: boolean;
  cleanupState: CleanupState;
  cleanupId: string | null;
  cleanupReason: CleanupReason | null;
  generation: number;
  bootStatus: RuntimeBootStatus;
  failureCode?: string;
}>;

export type AccountScopedCapability =
  | 'DASHBOARD_RENDER'
  | 'COMMAND_DISPATCH'
  | 'REALTIME_SUBSCRIBE'
  | 'QUEUE_SYNC'
  | 'PAIRING_CONTINUE'
  | 'PUSH_DEEP_LINK'
  | 'MAVI_CONTEXT';

export type AccountAccessDecision =
  | { allowed: true; generation: number }
  | {
      allowed: false;
      code:
        | 'LOCKDOWN_ACTIVE'
        | 'BOOT_NOT_SAFE'
        | 'RUNTIME_UNAVAILABLE'
        | 'RECOVERY_REQUIRED';
    };

type RuntimeOptions = {
  ledgerStorage?: CleanupLedgerStorage;
  compositionFactory?: () => VehicleCleanupComposition;
  hasAuthenticatedSession?: () => Promise<boolean>;
};

const MAX_RUNTIME_LISTENERS = 64;
const SERVER_SNAPSHOT: AccountCleanupRuntimeSnapshot = Object.freeze({
  initialized: false,
  lockdownActive: true,
  cleanupState: 'IDLE',
  cleanupId: null,
  cleanupReason: null,
  generation: 0,
  bootStatus: 'CHECKING',
});

export class AccountCleanupRuntime {
  readonly ledger: CleanupLedger;
  readonly coordinator: AccountCleanupCoordinator;
  readonly composition: VehicleCleanupComposition;
  private snapshot: AccountCleanupRuntimeSnapshot = SERVER_SNAPSHOT;
  private readonly listeners = new Set<() => void>();
  private initialization: Promise<AccountCleanupRuntimeSnapshot> | null = null;
  private recoveryAttempted = false;
  private readonly hasAuthenticatedSession: () => Promise<boolean>;
  private readonly unsubscribeLockdown: () => void;

  constructor(options: RuntimeOptions = {}) {
    let compositionFailed = false;
    try {
      this.composition = (options.compositionFactory ??
        (() => createVehicleCleanupComposition()))();
    } catch {
      compositionFailed = true;
      this.composition = createFailClosedComposition();
    }
    this.ledger = new CleanupLedger(
      options.ledgerStorage ?? new BrowserCleanupLedgerStorage(),
    );
    this.coordinator = new AccountCleanupCoordinator(
      this.ledger,
      this.composition.participantRegistry,
    );
    this.hasAuthenticatedSession = options.hasAuthenticatedSession ??
      defaultHasAuthenticatedSession;
    this.unsubscribeLockdown = subscribeAccountSecurityLockdown(() => {
      const lockdown = getAccountSecurityLockdownState();
      this.update({
        lockdownActive: lockdown.active,
        cleanupId: lockdown.cleanupId,
        cleanupReason: lockdown.reason,
        generation: lockdown.generation,
      });
    });
    if (compositionFailed) {
      this.update({
        initialized: true,
        lockdownActive: true,
        bootStatus: 'RUNTIME_ERROR',
        failureCode: 'RUNTIME_COMPOSITION_FAILED',
      });
      this.initialization = Promise.resolve(this.snapshot);
    }
  }

  getSnapshot = (): AccountCleanupRuntimeSnapshot => this.snapshot;

  getServerSnapshot = (): AccountCleanupRuntimeSnapshot => SERVER_SNAPSHOT;

  subscribe = (listener: () => void): (() => void) => {
    if (this.listeners.has(listener)) return () => this.listeners.delete(listener);
    if (this.listeners.size >= MAX_RUNTIME_LISTENERS) {
      throw new Error('ACCOUNT_CLEANUP_RUNTIME_LISTENER_LIMIT');
    }
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  initialize(): Promise<AccountCleanupRuntimeSnapshot> {
    if (this.initialization) return this.initialization;
    this.initialization = this.initializeOnce().catch(() => {
      this.update({
        initialized: true,
        lockdownActive: true,
        bootStatus: 'RUNTIME_ERROR',
        failureCode: 'RUNTIME_INITIALIZATION_FAILED',
      });
      return this.snapshot;
    });
    return this.initialization;
  }

  async retryRecovery(): Promise<AccountCleanupRuntimeSnapshot> {
    if (this.snapshot.bootStatus !== 'CLEANUP_RECOVERY_REQUIRED') {
      return this.snapshot;
    }
    await this.coordinator.recoverPendingCleanup();
    return this.evaluateAfterRecovery();
  }

  evaluateCapability(capability: AccountScopedCapability): AccountAccessDecision {
    const current = this.snapshot;
    if (!current.initialized || current.bootStatus === 'RUNTIME_ERROR') {
      return { allowed: false, code: 'RUNTIME_UNAVAILABLE' };
    }
    if (current.lockdownActive) {
      return { allowed: false, code: 'LOCKDOWN_ACTIVE' };
    }
    if (current.bootStatus === 'CLEANUP_RECOVERY_REQUIRED') {
      return { allowed: false, code: 'RECOVERY_REQUIRED' };
    }
    const anonymousPairing =
      capability === 'PAIRING_CONTINUE' &&
      current.bootStatus === 'AUTH_REQUIRED';
    if (current.bootStatus !== 'SAFE_TO_START' && !anonymousPairing) {
      return { allowed: false, code: 'BOOT_NOT_SAFE' };
    }
    return { allowed: true, generation: current.generation };
  }

  /** Test-owned runtimes only. Production singleton is never disposed by UI. */
  disposeForTests(): void {
    this.unsubscribeLockdown();
    this.listeners.clear();
  }

  private async initializeOnce(): Promise<AccountCleanupRuntimeSnapshot> {
    this.update({ bootStatus: 'CHECKING', initialized: false });
    // Ledger integrity and pending cleanup are evaluated before auth restore.
    // A durable cleanup marker intentionally blocks auth hydration.
    const preAuth = evaluateCleanupBootGate(this.ledger, false);
    if (preAuth.status === 'CLEANUP_RECOVERY_REQUIRED' &&
        !this.recoveryAttempted) {
      this.applyBootResult(preAuth);
      this.recoveryAttempted = true;
      try {
        await this.coordinator.recoverPendingCleanup();
      } catch {
        this.update({
          initialized: true,
          lockdownActive: true,
          bootStatus: 'CLEANUP_RECOVERY_REQUIRED',
          failureCode: 'RECOVERY_REQUIRED',
        });
        return this.snapshot;
      }
      return this.evaluateAfterRecovery();
    }
    if (preAuth.status === 'STORAGE_CORRUPTED' ||
        preAuth.status === 'SECURITY_RESET_REQUIRED') {
      this.applyBootResult(preAuth);
      this.update({ initialized: true });
      return this.snapshot;
    }
    const authenticated = await this.hasAuthenticatedSession();
    const initial = evaluateCleanupBootGate(this.ledger, authenticated);
    this.applyBootResult(initial);
    this.update({ initialized: true });
    return this.snapshot;
  }

  private async evaluateAfterRecovery(
    knownAuthentication?: boolean,
  ): Promise<AccountCleanupRuntimeSnapshot> {
    const authenticated = knownAuthentication ??
      await this.hasAuthenticatedSession();
    this.applyBootResult(evaluateCleanupBootGate(this.ledger, authenticated));
    this.update({ initialized: true });
    return this.snapshot;
  }

  private applyBootResult(
    result: ReturnType<typeof evaluateCleanupBootGate>,
  ): void {
    const ledgerRead = this.ledger.read();
    const entry = ledgerRead.ok ? ledgerRead.entry : null;
    this.update({
      bootStatus: result.status,
      cleanupState: entry?.state ?? 'IDLE',
      cleanupId: 'cleanupId' in result ? result.cleanupId ?? null :
        entry?.cleanupId ?? null,
      cleanupReason: entry?.reason ?? null,
      failureCode: 'failureCode' in result
        ? result.failureCode
        : undefined,
    });
  }

  private update(
    patch: Partial<AccountCleanupRuntimeSnapshot>,
  ): void {
    const next = Object.freeze({ ...this.snapshot, ...patch });
    if (shallowEqual(this.snapshot, next)) return;
    this.snapshot = next;
    this.listeners.forEach((listener) => {
      try { listener(); } catch { /* isolate listener failure */ }
    });
  }
}

function createFailClosedComposition(): VehicleCleanupComposition {
  return {
    participantRegistry: new CleanupParticipantRegistry(),
    storageRegistry: createProductionStorageRegistry(),
    memoryAdapter: {
      clearVehicleAuthority: () => {
        throw new Error('RUNTIME_COMPOSITION_FAILED');
      },
      verifyVehicleAuthorityEmpty: () => false,
    },
  };
}

let productionRuntime: AccountCleanupRuntime | null = null;

export function getAccountCleanupRuntime(): AccountCleanupRuntime {
  if (typeof window === 'undefined') {
    throw new Error('ACCOUNT_CLEANUP_RUNTIME_BROWSER_ONLY');
  }
  if (!productionRuntime) productionRuntime = new AccountCleanupRuntime();
  return productionRuntime;
}

export function getAccountCleanupServerSnapshot(): AccountCleanupRuntimeSnapshot {
  return SERVER_SNAPSHOT;
}

export function evaluateAccountScopedCapability(
  capability: AccountScopedCapability,
): AccountAccessDecision {
  if (typeof window === 'undefined' || !productionRuntime) {
    return { allowed: false, code: 'RUNTIME_UNAVAILABLE' };
  }
  return productionRuntime.evaluateCapability(capability);
}

export async function authorizePairingContinuation(): Promise<AccountAccessDecision> {
  if (typeof window === 'undefined') {
    return { allowed: false, code: 'RUNTIME_UNAVAILABLE' };
  }
  const runtime = getAccountCleanupRuntime();
  await runtime.initialize();
  return runtime.evaluateCapability('PAIRING_CONTINUE');
}

/** Test-only; intentionally not exported from the package barrel. */
export function resetAccountCleanupRuntimeForTests(): void {
  productionRuntime?.disposeForTests();
  productionRuntime = null;
}

async function defaultHasAuthenticatedSession(): Promise<boolean> {
  const { supabaseBrowser } = await import('@/lib/supabase');
  if (!supabaseBrowser) return false;
  const operation = beginAuthSessionOperation();
  if (!operation) throw new Error('AUTH_SESSION_WRITE_BLOCKED');
  try {
    const { data } = await supabaseBrowser.auth.getSession();
    if (!canApplyAuthSessionOperation(operation)) {
      throw new Error('STALE_AUTH_SESSION_RESULT');
    }
    return Boolean(data.session);
  } finally {
    finishAuthSessionOperation(operation);
  }
}

function shallowEqual(
  left: AccountCleanupRuntimeSnapshot,
  right: AccountCleanupRuntimeSnapshot,
): boolean {
  const keys = Object.keys(left) as Array<keyof AccountCleanupRuntimeSnapshot>;
  const rightKeys = Object.keys(right);
  return keys.length === rightKeys.length &&
    keys.every((key) => left[key] === right[key]);
}
