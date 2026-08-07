import {
  CLEANUP_REASONS,
  CLEANUP_STATES,
  isCleanupReason,
  isCleanupState,
  type CleanupLedgerEntry,
} from './cleanupTypes';

export const CLEANUP_LEDGER_KEY = 'caros:security:account-cleanup:v1';
export const CLEANUP_LEDGER_SCHEMA_VERSION = 2;
export const COMPLETED_LEDGER_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export interface CleanupLedgerStorage {
  read(): string | null;
  write(value: string): void;
  remove(): void;
}

export type CleanupLedgerReadResult =
  | { ok: true; entry: CleanupLedgerEntry | null }
  | {
      ok: false;
      failureCode:
        | 'LEDGER_READ_FAILED'
        | 'LEDGER_CORRUPTED'
        | 'LEGACY_TARGET_UNVERIFIABLE';
    };

export class BrowserCleanupLedgerStorage implements CleanupLedgerStorage {
  read(): string | null {
    return window.localStorage.getItem(CLEANUP_LEDGER_KEY);
  }

  write(value: string): void {
    window.localStorage.setItem(CLEANUP_LEDGER_KEY, value);
  }

  remove(): void {
    window.localStorage.removeItem(CLEANUP_LEDGER_KEY);
  }
}

export class CleanupLedger {
  constructor(private readonly storage: CleanupLedgerStorage) {}

  read(): CleanupLedgerReadResult {
    let raw: string | null;
    try {
      raw = this.storage.read();
    } catch {
      return { ok: false, failureCode: 'LEDGER_READ_FAILED' };
    }
    if (raw === null) return { ok: true, entry: null };

    try {
      const value: unknown = JSON.parse(raw);
      if (isLegacyActiveLedgerEntry(value)) {
        return { ok: false, failureCode: 'LEGACY_TARGET_UNVERIFIABLE' };
      }
      if (!isLedgerEntry(value)) {
        return { ok: false, failureCode: 'LEDGER_CORRUPTED' };
      }
      return { ok: true, entry: value };
    } catch {
      return { ok: false, failureCode: 'LEDGER_CORRUPTED' };
    }
  }

  write(entry: CleanupLedgerEntry): boolean {
    if (!isLedgerEntry(entry)) return false;
    try {
      this.storage.write(JSON.stringify(entry));
      return true;
    } catch {
      return false;
    }
  }

  removeCompletedIfExpired(now: number): boolean {
    const result = this.read();
    if (!result.ok) return false;
    const entry = result.entry;
    if (!entry || entry.state !== 'COMPLETED' || entry.completedAt == null) {
      return true;
    }
    if (now - entry.completedAt < COMPLETED_LEDGER_RETENTION_MS) return true;
    try {
      this.storage.remove();
      return true;
    } catch {
      return false;
    }
  }
}

function isLedgerEntry(value: unknown): value is CleanupLedgerEntry {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<CleanupLedgerEntry>;
  return (
    item.schemaVersion === CLEANUP_LEDGER_SCHEMA_VERSION &&
    typeof item.cleanupId === 'string' &&
    item.cleanupId.length > 0 &&
    typeof item.requestedAt === 'number' &&
    isCleanupReason(item.reason) &&
    isCleanupState(item.state) &&
    Array.isArray(item.completedSteps) &&
    item.completedSteps.every(isCleanupState) &&
    typeof item.retryCount === 'number' &&
    typeof item.lastAttemptAt === 'number' &&
    typeof item.generation === 'number' &&
    (!item.previousAccountHash ||
      (typeof item.previousAccountHash === 'string' &&
       item.previousAccountHash.length <= 128)) &&
    ((!item.previousAccountHash && !item.expectedSessionFingerprint) ||
      (typeof item.previousAccountHash === 'string' &&
       item.previousAccountHash.length > 0 &&
       typeof item.expectedSessionFingerprint === 'string' &&
       item.expectedSessionFingerprint.length > 0 &&
       item.expectedSessionFingerprint.length <= 128)) &&
    (!item.failedStep || isCleanupState(item.failedStep)) &&
    (!item.completedAt || typeof item.completedAt === 'number')
  );
}

function isLegacyActiveLedgerEntry(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const item = value as { schemaVersion?: unknown; state?: unknown };
  return item.schemaVersion === 1 &&
    typeof item.state === 'string' &&
    item.state !== 'COMPLETED';
}

// Keep these imports referenced so build-time union drift is caught here.
void CLEANUP_REASONS;
void CLEANUP_STATES;
