import {
  CLEANUP_POLICY_BY_REASON,
  type AccountScopedStorageDescriptor,
  type StorageRegistryIssue,
  type StorageRegistryValidationResult,
} from './storageTypes';
import type { CleanupReason } from '../cleanupTypes';

export const MAX_STORAGE_DESCRIPTORS = 128;
export const SUPPORTED_STORAGE_NAMESPACE_VERSION = 1;

const PERSISTENT_BROWSER_BACKENDS = new Set([
  'LOCAL_STORAGE',
  'SESSION_STORAGE',
  'INDEXED_DB',
  'CACHE_STORAGE',
  'SERVICE_WORKER',
]);

export class AccountScopedStorageRegistry {
  private readonly entries = new Map<string, AccountScopedStorageDescriptor>();
  private frozen = false;

  registerStorageDescriptor(descriptor: AccountScopedStorageDescriptor): void {
    if (this.frozen) throw new Error('STORAGE_REGISTRY_FROZEN');
    if (this.entries.size >= MAX_STORAGE_DESCRIPTORS) {
      throw new Error('REGISTRY_LIMIT_EXCEEDED');
    }
    if (this.entries.has(descriptor.id)) {
      throw new Error(`DUPLICATE_DESCRIPTOR_ID:${descriptor.id}`);
    }
    const candidate = new Map(this.entries);
    candidate.set(descriptor.id, freezeDescriptor(descriptor));
    const validation = validateEntries(candidate);
    if (!validation.ok) throw new Error(validation.issues[0].code);
    this.entries.set(descriptor.id, freezeDescriptor(descriptor));
  }

  getStorageDescriptor(id: string): AccountScopedStorageDescriptor | null {
    return this.entries.get(id) ?? null;
  }

  listStorageDescriptors(): readonly AccountScopedStorageDescriptor[] {
    return Object.freeze(Array.from(this.entries.values()));
  }

  listDescriptorsForCleanup(
    reason: CleanupReason,
  ): readonly AccountScopedStorageDescriptor[] {
    const policies = CLEANUP_POLICY_BY_REASON[reason];
    return Object.freeze(this.listStorageDescriptors().filter((descriptor) =>
      descriptor.cleanupPolicies.some((policy) => policies.includes(policy))));
  }

  findDescriptorByPhysicalKey(key: string): AccountScopedStorageDescriptor | null {
    for (const descriptor of Array.from(this.entries.values())) {
      if (descriptor.physicalKey === key || descriptor.legacyKeys?.includes(key)) {
        return descriptor;
      }
      if (descriptor.keyPattern && matchesPrefixPattern(key, descriptor.keyPattern)) {
        return descriptor;
      }
    }
    return null;
  }

  validateStorageRegistry(): StorageRegistryValidationResult {
    return validateEntries(this.entries);
  }

  freeze(): void {
    const validation = this.validateStorageRegistry();
    if (!validation.ok) throw new Error('STORAGE_REGISTRY_INVALID');
    this.frozen = true;
  }

  isFrozen(): boolean {
    return this.frozen;
  }
}

function freezeDescriptor(
  descriptor: AccountScopedStorageDescriptor,
): AccountScopedStorageDescriptor {
  return Object.freeze({
    ...descriptor,
    cleanupPolicies: Object.freeze([...descriptor.cleanupPolicies]),
    legacyKeys: descriptor.legacyKeys
      ? Object.freeze([...descriptor.legacyKeys])
      : undefined,
    ownerRequirements: Object.freeze({ ...descriptor.ownerRequirements }),
  });
}

function validateEntries(
  entries: ReadonlyMap<string, AccountScopedStorageDescriptor>,
): StorageRegistryValidationResult {
  const issues: StorageRegistryIssue[] = [];
  const keys = new Map<string, string>();
  const patterns: Array<{ pattern: string; id: string }> = [];

  if (entries.size > MAX_STORAGE_DESCRIPTORS) {
    issues.push({ code: 'REGISTRY_LIMIT_EXCEEDED', descriptorIds: [] });
  }

  for (const descriptor of Array.from(entries.values())) {
    const ids = [descriptor.id];
    if (!descriptor.id.trim() || !descriptor.description.trim()) {
      issues.push({ code: 'INVALID_DESCRIPTOR', descriptorIds: ids });
    }
    if (descriptor.cleanupPolicies.length === 0) {
      issues.push({ code: 'EMPTY_CLEANUP_POLICY', descriptorIds: ids });
    }
    if (descriptor.namespaceVersion !== SUPPORTED_STORAGE_NAMESPACE_VERSION) {
      issues.push({ code: 'INVALID_NAMESPACE_VERSION', descriptorIds: ids });
    }
    if ((descriptor.scope === 'ACCOUNT' ||
         descriptor.scope === 'ACCOUNT_VEHICLE') &&
        !descriptor.ownerRequirements.accountId) {
      issues.push({ code: 'ACCOUNT_OWNER_REQUIRED', descriptorIds: ids });
    }
    if (descriptor.scope === 'ACCOUNT_VEHICLE' &&
        !descriptor.ownerRequirements.vehicleId) {
      issues.push({ code: 'VEHICLE_OWNER_REQUIRED', descriptorIds: ids });
    }
    if (descriptor.scope === 'GLOBAL_DEVICE' &&
        (descriptor.ownerRequirements.accountId ||
         descriptor.ownerRequirements.vehicleId)) {
      issues.push({ code: 'GLOBAL_DEVICE_OWNER_FORBIDDEN', descriptorIds: ids });
    }
    if (descriptor.scope === 'ANONYMOUS_EPHEMERAL' &&
        (!descriptor.ephemeralTtlMs || descriptor.ephemeralTtlMs <= 0)) {
      issues.push({ code: 'ANONYMOUS_TTL_REQUIRED', descriptorIds: ids });
    }
    if (descriptor.sensitivity === 'SECRET' &&
        PERSISTENT_BROWSER_BACKENDS.has(descriptor.backend)) {
      issues.push({
        code: 'SECRET_PERSISTENT_BROWSER_STORAGE',
        descriptorIds: ids,
      });
    }
    if (descriptor.scope === 'SECURITY_SYSTEM' &&
        (descriptor.cleanupPolicies.includes('PURGE_ON_LOGOUT') ||
         descriptor.cleanupPolicies.includes('PURGE_ON_ACCOUNT_SWITCH'))) {
      issues.push({
        code: 'SECURITY_SYSTEM_LOGOUT_PURGE_FORBIDDEN',
        descriptorIds: ids,
      });
    }
    if (descriptor.verifyStrategy === 'CUSTOM' && !descriptor.customVerifierId) {
      issues.push({ code: 'CUSTOM_VERIFIER_REQUIRED', descriptorIds: ids });
    }
    if (descriptor.keyPattern && !isValidPrefixPattern(descriptor.keyPattern)) {
      issues.push({ code: 'INVALID_DESCRIPTOR', descriptorIds: ids });
    }

    for (const key of [
      descriptor.physicalKey,
      ...(descriptor.legacyKeys ?? []),
    ].filter((value): value is string => Boolean(value))) {
      const owner = keys.get(key);
      if (owner) {
        issues.push({
          code: descriptor.legacyKeys?.includes(key)
            ? 'LEGACY_KEY_CONFLICT'
            : 'DUPLICATE_PHYSICAL_KEY',
          descriptorIds: [owner, descriptor.id],
        });
      } else {
        keys.set(key, descriptor.id);
      }
    }
    if (descriptor.keyPattern) {
      for (const previous of patterns) {
        if (patternsOverlap(previous.pattern, descriptor.keyPattern)) {
          issues.push({
            code: 'CONFLICTING_KEY_PATTERN',
            descriptorIds: [previous.id, descriptor.id],
          });
        }
      }
      patterns.push({ pattern: descriptor.keyPattern, id: descriptor.id });
    }
  }
  return issues.length
    ? { ok: false, issues }
    : { ok: true, descriptorCount: entries.size };
}

function isValidPrefixPattern(pattern: string): boolean {
  return pattern.endsWith('*') && pattern.indexOf('*') === pattern.length - 1 &&
    pattern.length > 1;
}

function prefixOf(pattern: string): string {
  return pattern.slice(0, -1);
}

function patternsOverlap(a: string, b: string): boolean {
  const left = prefixOf(a);
  const right = prefixOf(b);
  return left.startsWith(right) || right.startsWith(left);
}

function matchesPrefixPattern(key: string, pattern: string): boolean {
  return isValidPrefixPattern(pattern) && key.startsWith(prefixOf(pattern));
}
