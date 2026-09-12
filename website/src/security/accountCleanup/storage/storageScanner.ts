import type { CarosEnvironment } from './storageNamespace';
import {
  parseCarosNamespace,
  validateNamespaceOwnership,
} from './storageNamespace';
import type { AccountScopedStorageRegistry } from './storageRegistry';
import {
  KNOWN_CAROS_PREFIXES,
  KNOWN_LEGACY_SECURITY_KEYS,
} from './knownStorageDescriptors';
import type {
  EnumerableStorageAdapter,
  StorageScanEntry,
  StorageScanResult,
} from './storageTypes';

export const MAX_STORAGE_SCAN_KEYS = 256;

export function scanKnownClientStorage(input: {
  registry: AccountScopedStorageRegistry;
  adapters: readonly EnumerableStorageAdapter[];
  activeAccountId?: string;
  environment?: CarosEnvironment;
}): StorageScanResult {
  const result: StorageScanResult = {
    ok: true,
    registeredEntries: [],
    unregisteredKnownEntries: [],
    suspiciousEntries: [],
    corruptedEntries: [],
    namespaceMismatches: [],
  };
  let remaining = MAX_STORAGE_SCAN_KEYS;

  for (const adapter of input.adapters) {
    const listed = adapter.listKeys(remaining);
    if (!listed.ok) return unavailable(result, 'STORAGE_UNAVAILABLE');
    if (listed.keys.length > remaining) {
      return unavailable(result, 'STORAGE_ENUMERATION_LIMIT');
    }
    remaining -= listed.keys.length;
    for (const key of listed.keys) {
      if (!isKnownCandidate(key, input.registry)) continue;
      const descriptor = input.registry.findDescriptorByPhysicalKey(key);
      const entry: StorageScanEntry = {
        key,
        backend: adapter.backend,
        descriptorId: descriptor?.id,
      };
      const read = adapter.read(key);
      if (!read.ok) return unavailable(result, 'STORAGE_READ_FAILED');
      if (!descriptor) {
        if (KNOWN_LEGACY_SECURITY_KEYS.includes(key)) {
          result.unregisteredKnownEntries.push({
            ...entry,
            failureCode: 'UNREGISTERED_KNOWN_KEY',
          });
        } else {
          result.suspiciousEntries.push({
            ...entry,
            failureCode: 'SUSPICIOUS_CAROS_KEY',
          });
        }
        continue;
      }
      result.registeredEntries.push(entry);
      if (descriptor.valueFormat === 'JSON' && read.value !== null) {
        try {
          JSON.parse(read.value);
        } catch {
          result.corruptedEntries.push({
            ...entry,
            failureCode: 'CORRUPTED_VALUE',
          });
        }
      }
      if (input.activeAccountId && descriptor.ownerRequirements.accountId &&
          isNamespaceMismatch(key, input.activeAccountId, input.environment)) {
        result.namespaceMismatches.push({
          ...entry,
          failureCode: 'NAMESPACE_MISMATCH',
        });
      }
    }
  }

  result.ok = result.unregisteredKnownEntries.length === 0 &&
    result.suspiciousEntries.length === 0 &&
    result.corruptedEntries.length === 0 &&
    result.namespaceMismatches.length === 0;
  return result;
}

export class BrowserStorageAdapter implements EnumerableStorageAdapter {
  constructor(
    public readonly backend: 'LOCAL_STORAGE' | 'SESSION_STORAGE',
    private readonly getStorage: () => Storage,
  ) {}

  listKeys(limit: number): { ok: true; keys: string[] } | { ok: false } {
    try {
      const storage = this.getStorage();
      if (storage.length > limit) return { ok: false };
      const keys: string[] = [];
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (key !== null) keys.push(key);
      }
      return { ok: true, keys };
    } catch {
      return { ok: false };
    }
  }

  read(key: string): { ok: true; value: string | null } | { ok: false } {
    try {
      return { ok: true, value: this.getStorage().getItem(key) };
    } catch {
      return { ok: false };
    }
  }
}

function isKnownCandidate(
  key: string,
  registry: AccountScopedStorageRegistry,
): boolean {
  return registry.findDescriptorByPhysicalKey(key) !== null ||
    KNOWN_LEGACY_SECURITY_KEYS.includes(key) ||
    KNOWN_CAROS_PREFIXES.some((prefix) => key.startsWith(prefix));
}

function isNamespaceMismatch(
  key: string,
  activeAccountId: string,
  environment?: CarosEnvironment,
): boolean {
  if (key.startsWith('caros:')) {
    return !validateNamespaceOwnership(
      key,
      activeAccountId,
      undefined,
      environment,
    );
  }
  const parsed = parseCarosNamespace(key);
  if (parsed) return parsed.accountId !== activeAccountId;
  for (const prefix of [
    'caros.fleet.queue.',
    'caros.fleet.snapshot.',
    'caros.fleet.pairing.',
  ]) {
    if (key.startsWith(prefix)) {
      const owner = key.slice(prefix.length).replace(/^corrupt\./, '');
      return owner !== activeAccountId;
    }
  }
  // Owner-less legacy private keys are handled as non-empty, not as a guessed owner.
  return false;
}

function unavailable(
  result: StorageScanResult,
  failureCode: NonNullable<StorageScanResult['failureCode']>,
): StorageScanResult {
  return { ...result, ok: false, failureCode };
}
