import { hasAuthCleanupMarker } from './authCleanupMarker';
import {
  captureCleanupGeneration,
  getCleanupGeneration,
  isAccountAccessLocked,
} from './cleanupLockdown';

const MAX_PENDING_AUTH_OPERATIONS = 32;
const pendingOperations = new Map<string, number>();
let nextOperationId = 1;

export type AuthSessionOperation = Readonly<{
  id: string;
  generation: number;
}>;

export function captureAuthSessionGeneration(): number {
  return captureCleanupGeneration();
}

export function canApplyAuthSessionResult(generation: number): boolean {
  return !isAuthSessionWriteBlocked() &&
    getCleanupGeneration() === generation;
}

export function canApplyCurrentAuthEvent(): boolean {
  return !isAuthSessionWriteBlocked();
}

export function beginAuthSessionOperation(): AuthSessionOperation | null {
  if (isAuthSessionWriteBlocked() ||
      pendingOperations.size >= MAX_PENDING_AUTH_OPERATIONS) {
    return null;
  }
  const operation: AuthSessionOperation = Object.freeze({
    id: `auth-op-${nextOperationId++}`,
    generation: getCleanupGeneration(),
  });
  pendingOperations.set(operation.id, operation.generation);
  return operation;
}

export function canApplyAuthSessionOperation(
  operation: AuthSessionOperation,
): boolean {
  return pendingOperations.get(operation.id) === operation.generation &&
    canApplyAuthSessionResult(operation.generation);
}

export function finishAuthSessionOperation(
  operation: AuthSessionOperation,
): void {
  if (pendingOperations.get(operation.id) === operation.generation) {
    pendingOperations.delete(operation.id);
  }
}

export function hasPendingAuthSessionOperations(): boolean {
  return pendingOperations.size > 0;
}

function isAuthSessionWriteBlocked(): boolean {
  return isAccountAccessLocked() || hasAuthCleanupMarker();
}

/** Test-only isolation hook; intentionally not exported from the package barrel. */
export function resetAuthSessionOperationsForTests(): void {
  pendingOperations.clear();
  nextOperationId = 1;
}
