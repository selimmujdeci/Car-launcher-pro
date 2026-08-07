import {
  getCleanupGeneration,
  isAccountAccessLocked,
} from './cleanupLockdown';
import type {
  AccountCleanupParticipant,
  CleanupContext,
  CleanupParticipantResult,
} from './cleanupTypes';

export const VEHICLE_CREDENTIAL_KEYS = [
  'caros_pair_api_key',
  'caros_critical_pin_hash',
] as const;

export const LEGACY_VEHICLE_IDENTITY_KEYS = [
  'caros_pair_vehicle_id',
  'caros_pair_vehicle_name',
  'caros_pair_vehicle_plate',
] as const;

export type VehicleCleanupFailureCode =
  | 'VEHICLE_CREDENTIAL_STORAGE_UNAVAILABLE'
  | 'VEHICLE_API_KEY_PURGE_FAILED'
  | 'VEHICLE_PIN_HASH_PURGE_FAILED'
  | 'VEHICLE_IDENTITY_PURGE_FAILED'
  | 'VEHICLE_MEMORY_PURGE_FAILED'
  | 'VEHICLE_CREDENTIAL_STILL_PRESENT'
  | 'VEHICLE_IDENTITY_STILL_PRESENT'
  | 'VEHICLE_MEMORY_STILL_PRESENT'
  | 'VEHICLE_AUTHORITY_PARTIAL_STATE'
  | 'VEHICLE_AUTHORITY_LATE_WRITE_DETECTED';

export interface VehicleCleanupStorage {
  remove(key: string): { ok: true } | { ok: false };
  has(key: string): { ok: true; present: boolean } | { ok: false };
}

export interface VehicleAuthorityMemoryAdapter {
  clearVehicleAuthority(): void | Promise<void>;
  verifyVehicleAuthorityEmpty(): boolean | Promise<boolean>;
}

export class BrowserVehicleCleanupStorage implements VehicleCleanupStorage {
  constructor(private readonly getStorage: () => Storage) {}

  remove(key: string): { ok: true } | { ok: false } {
    try {
      this.getStorage().removeItem(key);
      return { ok: true };
    } catch {
      return { ok: false };
    }
  }

  has(key: string): { ok: true; present: boolean } | { ok: false } {
    try {
      return { ok: true, present: this.getStorage().getItem(key) !== null };
    } catch {
      return { ok: false };
    }
  }
}

export class VehicleCredentialCleanupParticipant
implements AccountCleanupParticipant {
  readonly id = 'vehicle-credential-cleanup';
  readonly phase = 'LOCAL_SECRET_PURGE' as const;
  readonly priority = 10;

  constructor(private readonly storage: VehicleCleanupStorage) {}

  async clear(context: CleanupContext): Promise<CleanupParticipantResult> {
    const guard = validateContext(context);
    if (guard) return guard;
    const before = inspectKeys(this.storage, VEHICLE_CREDENTIAL_KEYS);
    if (!before.ok) return failure('VEHICLE_CREDENTIAL_STORAGE_UNAVAILABLE');

    let apiKeyFailed = false;
    let pinFailed = false;
    for (const key of VEHICLE_CREDENTIAL_KEYS) {
      const removed = this.storage.remove(key);
      if (!removed.ok) {
        if (key === 'caros_pair_api_key') apiKeyFailed = true;
        if (key === 'caros_critical_pin_hash') pinFailed = true;
      }
    }
    const after = inspectKeys(this.storage, VEHICLE_CREDENTIAL_KEYS);
    if (!after.ok) return failure('VEHICLE_CREDENTIAL_STORAGE_UNAVAILABLE');
    if (apiKeyFailed || after.present.includes('caros_pair_api_key')) {
      return failure('VEHICLE_API_KEY_PURGE_FAILED');
    }
    if (pinFailed || after.present.includes('caros_critical_pin_hash')) {
      return failure('VEHICLE_PIN_HASH_PURGE_FAILED');
    }
    return {
      ok: true,
      code: before.present.length === 0 ? 'ALREADY_EMPTY' : 'CLEARED',
    };
  }
}

export class VehicleIdentityStorageCleanupParticipant
implements AccountCleanupParticipant {
  readonly id = 'vehicle-identity-storage-cleanup';
  readonly phase = 'LOCAL_PRIVATE_DATA_PURGE' as const;
  readonly priority = 10;

  constructor(private readonly storage: VehicleCleanupStorage) {}

  async clear(context: CleanupContext): Promise<CleanupParticipantResult> {
    const guard = validateContext(context);
    if (guard) return guard;
    const before = inspectKeys(this.storage, LEGACY_VEHICLE_IDENTITY_KEYS);
    if (!before.ok) return failure('VEHICLE_CREDENTIAL_STORAGE_UNAVAILABLE');

    let removeFailed = false;
    for (const key of LEGACY_VEHICLE_IDENTITY_KEYS) {
      if (!this.storage.remove(key).ok) removeFailed = true;
    }
    const after = inspectKeys(this.storage, LEGACY_VEHICLE_IDENTITY_KEYS);
    if (!after.ok) return failure('VEHICLE_CREDENTIAL_STORAGE_UNAVAILABLE');
    if (removeFailed || after.present.length > 0) {
      return failure('VEHICLE_IDENTITY_PURGE_FAILED');
    }
    return {
      ok: true,
      code: before.present.length === 0 ? 'ALREADY_EMPTY' : 'CLEARED',
    };
  }
}

export class VehicleMemoryAuthorityCleanupParticipant
implements AccountCleanupParticipant {
  readonly id = 'vehicle-memory-authority-cleanup';
  readonly phase = 'LOCAL_PRIVATE_DATA_PURGE' as const;
  readonly priority = 20;

  constructor(private readonly memory: VehicleAuthorityMemoryAdapter) {}

  async clear(context: CleanupContext): Promise<CleanupParticipantResult> {
    const guard = validateContext(context);
    if (guard) return guard;
    let emptyBefore = false;
    try {
      emptyBefore = await this.memory.verifyVehicleAuthorityEmpty();
      await this.memory.clearVehicleAuthority();
      if (!await this.memory.verifyVehicleAuthorityEmpty()) {
        return failure('VEHICLE_MEMORY_STILL_PRESENT');
      }
    } catch {
      return failure('VEHICLE_MEMORY_PURGE_FAILED');
    }
    return { ok: true, code: emptyBefore ? 'ALREADY_EMPTY' : 'CLEARED' };
  }
}

export class VehicleAuthorityVerificationParticipant
implements AccountCleanupParticipant {
  readonly id = 'vehicle-authority-verification';
  readonly phase = 'VERIFY_EMPTY' as const;
  readonly priority = 10;
  private lastVerified = false;

  constructor(
    private readonly storage: VehicleCleanupStorage,
    private readonly memory: VehicleAuthorityMemoryAdapter,
  ) {}

  async clear(context: CleanupContext): Promise<CleanupParticipantResult> {
    this.lastVerified = false;
    const guard = validateContext(context);
    if (guard) return guard;

    const credentials = inspectKeys(this.storage, VEHICLE_CREDENTIAL_KEYS);
    if (!credentials.ok) {
      return failure('VEHICLE_CREDENTIAL_STORAGE_UNAVAILABLE');
    }
    if (credentials.present.length > 0) {
      return failure('VEHICLE_CREDENTIAL_STILL_PRESENT');
    }
    const identity = inspectKeys(this.storage, LEGACY_VEHICLE_IDENTITY_KEYS);
    if (!identity.ok) return failure('VEHICLE_CREDENTIAL_STORAGE_UNAVAILABLE');
    if (identity.present.length > 0) {
      return failure(
        identity.present.length === LEGACY_VEHICLE_IDENTITY_KEYS.length
          ? 'VEHICLE_IDENTITY_STILL_PRESENT'
          : 'VEHICLE_AUTHORITY_PARTIAL_STATE',
      );
    }
    try {
      if (!await this.memory.verifyVehicleAuthorityEmpty()) {
        return failure('VEHICLE_MEMORY_STILL_PRESENT');
      }
    } catch {
      return failure('VEHICLE_MEMORY_PURGE_FAILED');
    }
    this.lastVerified = true;
    return { ok: true, code: 'ALREADY_EMPTY' };
  }

  async verifyEmpty(context: CleanupContext): Promise<boolean> {
    return this.lastVerified && validateContext(context) === null;
  }
}

function validateContext(
  context: CleanupContext,
): Extract<CleanupParticipantResult, { ok: false }> | null {
  if (!isAccountAccessLocked() || getCleanupGeneration() !== context.generation) {
    return failure('VEHICLE_AUTHORITY_LATE_WRITE_DETECTED');
  }
  return null;
}

function inspectKeys(
  storage: VehicleCleanupStorage,
  keys: readonly string[],
): { ok: true; present: string[] } | { ok: false } {
  const present: string[] = [];
  for (const key of keys) {
    const result = storage.has(key);
    if (!result.ok) return { ok: false };
    if (result.present) present.push(key);
  }
  return { ok: true, present };
}

function failure(
  failureCode: VehicleCleanupFailureCode,
): Extract<CleanupParticipantResult, { ok: false }> {
  return { ok: false, retryable: false, failureCode };
}
