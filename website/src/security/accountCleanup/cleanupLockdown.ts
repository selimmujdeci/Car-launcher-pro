import type { CleanupReason } from './cleanupTypes';
import {
  clearAuthCleanupMarker,
  setAuthCleanupMarker,
} from './authCleanupMarker';

export type AccountSecurityLockdownState = {
  active: boolean;
  cleanupId: string | null;
  reason: CleanupReason | null;
  generation: number;
  activatedAt: number | null;
};

type LockdownListener = (state: Readonly<AccountSecurityLockdownState>) => void;

const listeners = new Set<LockdownListener>();
let state: AccountSecurityLockdownState = {
  active: false,
  cleanupId: null,
  reason: null,
  generation: 0,
  activatedAt: null,
};

function publish(): void {
  const snapshot = getAccountSecurityLockdownState();
  listeners.forEach((listener) => listener(snapshot));
}

export function activateAccountSecurityLockdown(
  cleanupId: string,
  reason: CleanupReason,
  now: number,
): Readonly<AccountSecurityLockdownState> {
  setAuthCleanupMarker();
  state = {
    active: true,
    cleanupId,
    reason,
    generation: state.generation + 1,
    activatedAt: now,
  };
  publish();
  return getAccountSecurityLockdownState();
}

export function releaseAccountSecurityLockdown(cleanupId: string): boolean {
  if (!state.active || state.cleanupId !== cleanupId) return false;
  if (!clearAuthCleanupMarker()) return false;
  state = {
    ...state,
    active: false,
    cleanupId: null,
    reason: null,
    activatedAt: null,
  };
  publish();
  return true;
}

export function getAccountSecurityLockdownState():
Readonly<AccountSecurityLockdownState> {
  return { ...state };
}

export function isAccountAccessLocked(): boolean {
  return state.active;
}

export function getCleanupGeneration(): number {
  return state.generation;
}

export function captureCleanupGeneration(): number {
  return state.generation;
}

export function isCleanupGenerationCurrent(generation: number): boolean {
  return !state.active && generation === state.generation;
}

export function assertCleanupGenerationCurrent(generation: number): void {
  if (!isCleanupGenerationCurrent(generation)) {
    throw new Error('STALE_CLEANUP_GENERATION');
  }
}

export function assertAccountAccessAllowed(): void {
  if (state.active) throw new Error('ACCOUNT_ACCESS_LOCKED');
}

export function subscribeAccountSecurityLockdown(
  listener: LockdownListener,
): () => void {
  listeners.add(listener);
  listener(getAccountSecurityLockdownState());
  return () => listeners.delete(listener);
}

/** Test-only isolation hook; not exported from the package barrel. */
export function resetAccountSecurityLockdownForTests(): void {
  clearAuthCleanupMarker();
  state = {
    active: false,
    cleanupId: null,
    reason: null,
    generation: 0,
    activatedAt: null,
  };
  listeners.clear();
}
