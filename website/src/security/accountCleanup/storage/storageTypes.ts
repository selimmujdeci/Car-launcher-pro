import type { CleanupReason } from '../cleanupTypes';

export type StorageScope =
  | 'GLOBAL_DEVICE'
  | 'ACCOUNT'
  | 'ACCOUNT_VEHICLE'
  | 'ANONYMOUS_EPHEMERAL'
  | 'SECURITY_SYSTEM';

export type StorageSensitivity =
  | 'SECRET'
  | 'AUTHORITY'
  | 'PRIVATE'
  | 'OPERATIONAL'
  | 'PREFERENCE'
  | 'PUBLIC';

export type StorageBackend =
  | 'LOCAL_STORAGE'
  | 'SESSION_STORAGE'
  | 'INDEXED_DB'
  | 'CACHE_STORAGE'
  | 'MEMORY'
  | 'SERVICE_WORKER'
  | 'NATIVE_BRIDGE';

export type StorageCleanupPolicy =
  | 'PURGE_ON_LOGOUT'
  | 'PURGE_ON_ACCOUNT_SWITCH'
  | 'PURGE_ON_SECURITY_RESET'
  | 'RETAIN_DEVICE_PREFERENCE'
  | 'EXPIRE_EPHEMERAL'
  | 'MANAGED_EXTERNALLY';

export type StorageVerifyStrategy =
  | 'KEY_ABSENT'
  | 'NAMESPACE_EMPTY'
  | 'RECORD_OWNER_MATCH'
  | 'CUSTOM';

export type AccountScopedStorageDescriptor = {
  id: string;
  backend: StorageBackend;
  scope: StorageScope;
  sensitivity: StorageSensitivity;
  cleanupPolicies: readonly StorageCleanupPolicy[];
  physicalKey?: string;
  /** A prefix pattern must end in `*`; arbitrary regular expressions are forbidden. */
  keyPattern?: string;
  namespaceVersion: number;
  ownerRequirements: { accountId: boolean; vehicleId: boolean };
  verifyStrategy: StorageVerifyStrategy;
  legacyKeys?: readonly string[];
  description: string;
  /** Structured records are parsed only to establish integrity, never logged. */
  valueFormat?: 'OPAQUE' | 'JSON';
  customVerifierId?: string;
  ephemeralTtlMs?: number;
};

export type StorageRegistryIssueCode =
  | 'DUPLICATE_DESCRIPTOR_ID'
  | 'DUPLICATE_PHYSICAL_KEY'
  | 'CONFLICTING_KEY_PATTERN'
  | 'ACCOUNT_OWNER_REQUIRED'
  | 'VEHICLE_OWNER_REQUIRED'
  | 'SECRET_PERSISTENT_BROWSER_STORAGE'
  | 'SECURITY_SYSTEM_LOGOUT_PURGE_FORBIDDEN'
  | 'GLOBAL_DEVICE_OWNER_FORBIDDEN'
  | 'ANONYMOUS_TTL_REQUIRED'
  | 'EMPTY_CLEANUP_POLICY'
  | 'INVALID_NAMESPACE_VERSION'
  | 'LEGACY_KEY_CONFLICT'
  | 'CUSTOM_VERIFIER_REQUIRED'
  | 'REGISTRY_LIMIT_EXCEEDED'
  | 'INVALID_DESCRIPTOR';

export type StorageRegistryIssue = {
  code: StorageRegistryIssueCode;
  descriptorIds: readonly string[];
};

export type StorageRegistryValidationResult =
  | { ok: true; descriptorCount: number }
  | { ok: false; issues: readonly StorageRegistryIssue[] };

export type StorageScanFailureCode =
  | 'STORAGE_UNAVAILABLE'
  | 'STORAGE_ENUMERATION_LIMIT'
  | 'STORAGE_READ_FAILED'
  | 'CORRUPTED_VALUE'
  | 'UNREGISTERED_KNOWN_KEY'
  | 'SUSPICIOUS_CAROS_KEY'
  | 'NAMESPACE_MISMATCH';

export type StorageScanEntry = {
  key: string;
  backend: StorageBackend;
  descriptorId?: string;
  failureCode?: StorageScanFailureCode;
};

export type StorageScanResult = {
  ok: boolean;
  registeredEntries: StorageScanEntry[];
  unregisteredKnownEntries: StorageScanEntry[];
  suspiciousEntries: StorageScanEntry[];
  corruptedEntries: StorageScanEntry[];
  namespaceMismatches: StorageScanEntry[];
  failureCode?: StorageScanFailureCode;
};

export type StorageVerifyEmptyResult =
  | { ok: true; checkedDescriptorIds: string[] }
  | {
      ok: false;
      failureCode:
        | 'REGISTERED_STORAGE_NOT_EMPTY'
        | 'UNREGISTERED_ACCOUNT_STORAGE_FOUND'
        | 'NAMESPACE_MISMATCH'
        | 'STORAGE_CORRUPTED'
        | 'STORAGE_UNAVAILABLE'
        | 'REGISTRY_INVALID';
      descriptorIds?: string[];
      physicalKeys?: string[];
    };

export interface EnumerableStorageAdapter {
  readonly backend: 'LOCAL_STORAGE' | 'SESSION_STORAGE';
  listKeys(limit: number): { ok: true; keys: string[] } | { ok: false };
  read(key: string): { ok: true; value: string | null } | { ok: false };
}

export const CLEANUP_POLICY_BY_REASON: Readonly<
  Record<CleanupReason, readonly StorageCleanupPolicy[]>
> = {
  logout: ['PURGE_ON_LOGOUT'],
  account_switch: ['PURGE_ON_ACCOUNT_SWITCH', 'PURGE_ON_LOGOUT'],
  session_expired: ['PURGE_ON_LOGOUT'],
  session_revoked: ['PURGE_ON_LOGOUT', 'PURGE_ON_SECURITY_RESET'],
  lost_device: ['PURGE_ON_SECURITY_RESET', 'PURGE_ON_LOGOUT'],
  security_reset: ['PURGE_ON_SECURITY_RESET', 'PURGE_ON_LOGOUT'],
};
