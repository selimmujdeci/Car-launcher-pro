import { describe, expect, it, vi } from 'vitest';
import {
  AccountCleanupCoordinator,
  CleanupLedger,
  CleanupParticipantRegistry,
  type AccountCleanupParticipant,
  type CleanupPhase,
  type CleanupContext,
} from '@/security/accountCleanup';
import {
  AccountScopedStorageRegistry,
  AccountScopedStorageVerificationParticipant,
  MAX_STORAGE_DESCRIPTORS,
  PRODUCTION_STORAGE_DESCRIPTOR_COUNT,
  buildAccountNamespace,
  buildAccountVehicleNamespace,
  buildAnonymousNamespace,
  createProductionStorageRegistry,
  parseCarosNamespace,
  scanKnownClientStorage,
  validateNamespaceOwnership,
  verifyAccountScopedStorageEmpty,
  type AccountScopedStorageDescriptor,
  type EnumerableStorageAdapter,
} from '@/security/accountCleanup/storage';

function descriptor(
  patch: Partial<AccountScopedStorageDescriptor> = {},
): AccountScopedStorageDescriptor {
  return {
    id: 'account-cache',
    backend: 'LOCAL_STORAGE',
    scope: 'ACCOUNT',
    sensitivity: 'PRIVATE',
    cleanupPolicies: ['PURGE_ON_LOGOUT'],
    physicalKey: 'caros:test:account-cache',
    namespaceVersion: 1,
    ownerRequirements: { accountId: true, vehicleId: false },
    verifyStrategy: 'KEY_ABSENT',
    valueFormat: 'JSON',
    description: 'Test descriptor',
    ...patch,
  };
}

class MemoryAdapter implements EnumerableStorageAdapter {
  readonly backend = 'LOCAL_STORAGE' as const;
  unavailable = false;
  readonly values = new Map<string, string>();

  listKeys(limit: number) {
    if (this.unavailable || this.values.size > limit) return { ok: false as const };
    return { ok: true as const, keys: Array.from(this.values.keys()) };
  }

  read(key: string) {
    if (this.unavailable) return { ok: false as const };
    return { ok: true as const, value: this.values.get(key) ?? null };
  }
}

function frozenRegistry(
  descriptors: AccountScopedStorageDescriptor[],
): AccountScopedStorageRegistry {
  const registry = new AccountScopedStorageRegistry();
  descriptors.forEach((item) => registry.registerStorageDescriptor(item));
  registry.freeze();
  return registry;
}

describe('account-scoped storage registry', () => {
  it('registers valid descriptors and preserves stable order', () => {
    const registry = new AccountScopedStorageRegistry();
    registry.registerStorageDescriptor(descriptor({ id: 'b', physicalKey: 'b' }));
    registry.registerStorageDescriptor(descriptor({ id: 'a', physicalKey: 'a' }));
    expect(registry.listStorageDescriptors().map(({ id }) => id)).toEqual(['b', 'a']);
    expect(registry.getStorageDescriptor('a')?.id).toBe('a');
  });

  it('rejects duplicate descriptor IDs', () => {
    const registry = new AccountScopedStorageRegistry();
    registry.registerStorageDescriptor(descriptor());
    expect(() => registry.registerStorageDescriptor(
      descriptor({ physicalKey: 'other' }),
    )).toThrow('DUPLICATE_DESCRIPTOR_ID');
  });

  it('rejects duplicate physical keys', () => {
    const registry = new AccountScopedStorageRegistry();
    registry.registerStorageDescriptor(descriptor());
    expect(() => registry.registerStorageDescriptor(
      descriptor({ id: 'other' }),
    )).toThrow('DUPLICATE_PHYSICAL_KEY');
  });

  it('rejects conflicting prefix patterns', () => {
    const registry = new AccountScopedStorageRegistry();
    registry.registerStorageDescriptor(descriptor({
      id: 'one', physicalKey: undefined, keyPattern: 'caros.queue.*',
    }));
    expect(() => registry.registerStorageDescriptor(descriptor({
      id: 'two', physicalKey: undefined, keyPattern: 'caros.queue.user.*',
    }))).toThrow('CONFLICTING_KEY_PATTERN');
  });

  it('rejects persistent SECRET storage', () => {
    const registry = new AccountScopedStorageRegistry();
    expect(() => registry.registerStorageDescriptor(
      descriptor({ sensitivity: 'SECRET' }),
    )).toThrow('SECRET_PERSISTENT_BROWSER_STORAGE');
  });

  it('rejects ACCOUNT without account ownership', () => {
    const registry = new AccountScopedStorageRegistry();
    expect(() => registry.registerStorageDescriptor(descriptor({
      ownerRequirements: { accountId: false, vehicleId: false },
    }))).toThrow('ACCOUNT_OWNER_REQUIRED');
  });

  it('rejects ACCOUNT_VEHICLE without vehicle ownership', () => {
    const registry = new AccountScopedStorageRegistry();
    expect(() => registry.registerStorageDescriptor(descriptor({
      scope: 'ACCOUNT_VEHICLE',
      ownerRequirements: { accountId: true, vehicleId: false },
    }))).toThrow('VEHICLE_OWNER_REQUIRED');
  });

  it('rejects GLOBAL_DEVICE owner requirements', () => {
    const registry = new AccountScopedStorageRegistry();
    expect(() => registry.registerStorageDescriptor(descriptor({
      scope: 'GLOBAL_DEVICE',
      sensitivity: 'PREFERENCE',
      cleanupPolicies: ['RETAIN_DEVICE_PREFERENCE'],
    }))).toThrow('GLOBAL_DEVICE_OWNER_FORBIDDEN');
  });

  it('rejects empty cleanup policies and future schema', () => {
    expect(() => new AccountScopedStorageRegistry().registerStorageDescriptor(
      descriptor({ cleanupPolicies: [] }),
    )).toThrow('EMPTY_CLEANUP_POLICY');
    expect(() => new AccountScopedStorageRegistry().registerStorageDescriptor(
      descriptor({ namespaceVersion: 2 }),
    )).toThrow('INVALID_NAMESPACE_VERSION');
  });

  it('requires a bounded anonymous TTL', () => {
    expect(() => new AccountScopedStorageRegistry().registerStorageDescriptor(
      descriptor({
        scope: 'ANONYMOUS_EPHEMERAL',
        ownerRequirements: { accountId: false, vehicleId: false },
        cleanupPolicies: ['EXPIRE_EPHEMERAL'],
      }),
    )).toThrow('ANONYMOUS_TTL_REQUIRED');
  });

  it('requires a custom verifier identity for memory', () => {
    expect(() => new AccountScopedStorageRegistry().registerStorageDescriptor(
      descriptor({
        backend: 'MEMORY',
        verifyStrategy: 'CUSTOM',
        physicalKey: undefined,
      }),
    )).toThrow('CUSTOM_VERIFIER_REQUIRED');
  });

  it('enforces the registry bound', () => {
    const registry = new AccountScopedStorageRegistry();
    for (let index = 0; index < MAX_STORAGE_DESCRIPTORS; index += 1) {
      registry.registerStorageDescriptor(descriptor({
        id: `id-${index}`,
        physicalKey: `key-${index}`,
      }));
    }
    expect(() => registry.registerStorageDescriptor(descriptor({
      id: 'overflow', physicalKey: 'overflow',
    }))).toThrow('REGISTRY_LIMIT_EXCEEDED');
  });

  it('freezes registry mutation', () => {
    const registry = frozenRegistry([descriptor()]);
    expect(registry.isFrozen()).toBe(true);
    expect(() => registry.registerStorageDescriptor(
      descriptor({ id: 'late', physicalKey: 'late' }),
    )).toThrow('STORAGE_REGISTRY_FROZEN');
  });

  it('builds canonical account and vehicle namespaces', () => {
    expect(buildAccountNamespace({
      environment: 'production', accountId: 'hash_a', domain: 'queue', schemaVersion: 1,
    })).toBe('caros:production:hash_a:queue:v1');
    expect(buildAccountVehicleNamespace({
      environment: 'production', accountId: 'hash_a', vehicleId: 'veh_1',
      domain: 'telemetry', schemaVersion: 1,
    })).toBe('caros:production:hash_a:veh_1:telemetry:v1');
  });

  it.each(['', ' ', 'null', 'undefined'])(
    'rejects invalid account ID %j',
    (accountId) => {
      expect(() => buildAccountNamespace({
        environment: 'production', accountId, domain: 'queue', schemaVersion: 1,
      })).toThrow('ACCOUNT_ID_INVALID');
    },
  );

  it('rejects invalid domain and separates environments', () => {
    expect(() => buildAccountNamespace({
      environment: 'test', accountId: 'hash_a', domain: '../queue', schemaVersion: 1,
    })).toThrow('DOMAIN_INVALID');
    const prod = buildAccountNamespace({
      environment: 'production', accountId: 'hash_a', domain: 'queue', schemaVersion: 1,
    });
    const test = buildAccountNamespace({
      environment: 'test', accountId: 'hash_a', domain: 'queue', schemaVersion: 1,
    });
    expect(prod).not.toBe(test);
  });

  it('parses namespaces and validates owner/environment', () => {
    const key = 'caros:production:hash_a:veh_1:telemetry:v1';
    expect(parseCarosNamespace(key)).toEqual({
      environment: 'production',
      accountId: 'hash_a',
      vehicleId: 'veh_1',
      domain: 'telemetry',
      schemaVersion: 1,
    });
    expect(validateNamespaceOwnership(key, 'hash_a', 'veh_1', 'production')).toBe(true);
    expect(validateNamespaceOwnership(key, 'hash_b', 'veh_1', 'production')).toBe(false);
    expect(validateNamespaceOwnership(key, 'hash_a', 'veh_1', 'test')).toBe(false);
  });

  it('builds and parses a bounded anonymous namespace without account authority', () => {
    const key = buildAnonymousNamespace({
      environment: 'test',
      installationId: 'install_1',
      domain: 'pairing',
      schemaVersion: 1,
    });
    expect(parseCarosNamespace(key)).toEqual({
      environment: 'test',
      installationId: 'install_1',
      domain: 'pairing',
      schemaVersion: 1,
    });
    expect(validateNamespaceOwnership(key, 'hash_a')).toBe(false);
  });

  it('creates and freezes the evidence-backed production registry', () => {
    const registry = createProductionStorageRegistry();
    expect(registry.isFrozen()).toBe(true);
    expect(registry.listStorageDescriptors()).toHaveLength(
      PRODUCTION_STORAGE_DESCRIPTOR_COUNT,
    );
    expect(PRODUCTION_STORAGE_DESCRIPTOR_COUNT).toBe(18);
  });
});

describe('known storage scan and verify-empty', () => {
  it('finds a registered key without reading payload into the result', () => {
    const registry = frozenRegistry([descriptor()]);
    const adapter = new MemoryAdapter();
    adapter.values.set('caros:test:account-cache', '{"token":"do-not-log"}');
    const scan = scanKnownClientStorage({ registry, adapters: [adapter] });
    expect(scan.registeredEntries).toEqual([{
      key: 'caros:test:account-cache',
      backend: 'LOCAL_STORAGE',
      descriptorId: 'account-cache',
    }]);
    expect(JSON.stringify(scan)).not.toContain('do-not-log');
  });

  it('detects unregistered legacy API key and suspicious CAROS keys', () => {
    const registry = frozenRegistry([descriptor()]);
    const adapter = new MemoryAdapter();
    adapter.values.set('caros_pair_api_key', 'secret-value');
    adapter.values.set('caros_unknown_private', 'private-value');
    const scan = scanKnownClientStorage({ registry, adapters: [adapter] });
    expect(scan.unregisteredKnownEntries[0].failureCode).toBe('UNREGISTERED_KNOWN_KEY');
    expect(scan.suspiciousEntries[0].failureCode).toBe('SUSPICIOUS_CAROS_KEY');
    expect(JSON.stringify(scan)).not.toContain('secret-value');
  });

  it('detects corrupted structured storage', () => {
    const registry = frozenRegistry([descriptor()]);
    const adapter = new MemoryAdapter();
    adapter.values.set('caros:test:account-cache', '{broken');
    expect(scanKnownClientStorage({
      registry, adapters: [adapter],
    }).corruptedEntries[0].failureCode).toBe('CORRUPTED_VALUE');
  });

  it('fails closed when storage is unavailable', async () => {
    const registry = frozenRegistry([descriptor()]);
    const adapter = new MemoryAdapter();
    adapter.unavailable = true;
    await expect(verifyAccountScopedStorageEmpty({
      registry, adapters: [adapter],
    })).resolves.toMatchObject({ ok: false, failureCode: 'STORAGE_UNAVAILABLE' });
  });

  it('allows only a registered global preference and exempts cleanup ledger', async () => {
    const registry = frozenRegistry([
      descriptor({
        id: 'theme', scope: 'GLOBAL_DEVICE', sensitivity: 'PREFERENCE',
        cleanupPolicies: ['RETAIN_DEVICE_PREFERENCE'],
        physicalKey: 'caros-theme',
        ownerRequirements: { accountId: false, vehicleId: false },
        verifyStrategy: 'CUSTOM', customVerifierId: 'theme',
        valueFormat: 'OPAQUE',
      }),
      descriptor({
        id: 'ledger', scope: 'SECURITY_SYSTEM', sensitivity: 'OPERATIONAL',
        cleanupPolicies: ['MANAGED_EXTERNALLY'],
        physicalKey: 'caros:security:account-cleanup:v1',
        ownerRequirements: { accountId: false, vehicleId: false },
        verifyStrategy: 'CUSTOM', customVerifierId: 'ledger',
      }),
    ]);
    const adapter = new MemoryAdapter();
    adapter.values.set('caros-theme', 'dark');
    adapter.values.set('caros:security:account-cleanup:v1', '{}');
    await expect(verifyAccountScopedStorageEmpty({
      registry, adapters: [adapter],
    })).resolves.toEqual({ ok: true, checkedDescriptorIds: [] });
  });

  it('fails for authority, previous-account namespace and unregistered private key', async () => {
    const registry = frozenRegistry([descriptor({
      sensitivity: 'AUTHORITY',
      physicalKey: undefined,
      keyPattern: 'caros:production:hash_a:queue:*',
    })]);
    const authority = new MemoryAdapter();
    authority.values.set('caros:production:hash_a:queue:v1', '{}');
    await expect(verifyAccountScopedStorageEmpty({
      registry, adapters: [authority], previousAccountId: 'hash_a',
      environment: 'production',
    })).resolves.toMatchObject({
      ok: false, failureCode: 'REGISTERED_STORAGE_NOT_EMPTY',
    });

    const mismatch = new MemoryAdapter();
    mismatch.values.set('caros:production:hash_b:queue:v1', '{}');
    await expect(verifyAccountScopedStorageEmpty({
      registry, adapters: [mismatch], previousAccountId: 'hash_a',
      environment: 'production',
    })).resolves.toMatchObject({
      ok: false, failureCode: 'UNREGISTERED_ACCOUNT_STORAGE_FOUND',
    });

    const unknown = new MemoryAdapter();
    unknown.values.set('caros_unknown_private', '{}');
    await expect(verifyAccountScopedStorageEmpty({
      registry, adapters: [unknown],
    })).resolves.toMatchObject({
      ok: false, failureCode: 'UNREGISTERED_ACCOUNT_STORAGE_FOUND',
    });
  });

  it('rejects missing memory verifiers and accepts an empty custom store', async () => {
    const registry = frozenRegistry([descriptor({
      backend: 'MEMORY', physicalKey: undefined,
      verifyStrategy: 'CUSTOM', customVerifierId: 'memory-store',
    })]);
    await expect(verifyAccountScopedStorageEmpty({
      registry, adapters: [],
    })).resolves.toMatchObject({ ok: false, failureCode: 'REGISTRY_INVALID' });
    await expect(verifyAccountScopedStorageEmpty({
      registry, adapters: [], customVerifiers: { 'memory-store': () => true },
    })).resolves.toEqual({
      ok: true, checkedDescriptorIds: ['account-cache'],
    });
  });

  it('integrates the registry verifier participant with coordinator VERIFY_EMPTY', async () => {
    const registry = frozenRegistry([descriptor({
      backend: 'MEMORY', physicalKey: undefined,
      verifyStrategy: 'CUSTOM', customVerifierId: 'memory-store',
    })]);
    const cleanupRegistry = new CleanupParticipantRegistry();
    const phases: CleanupPhase[] = [
      'LOCAL_SECRET_PURGE', 'LOCAL_PRIVATE_DATA_PURGE',
      'QUEUE_AND_SNAPSHOT_PURGE', 'SERVER_SESSION_REVOKE',
      'DEVICE_AND_PUSH_REVOKE',
    ];
    phases.forEach((phase, index) => cleanupRegistry.register({
      id: `foundation-${phase}`,
      phase,
      priority: index,
      clear: async () => ({ ok: true, code: 'NOT_APPLICABLE' }),
    }));
    cleanupRegistry.register(
      new AccountScopedStorageVerificationParticipant(
        registry, [], { 'memory-store': () => true }, 'test',
      ),
    );
    let raw: string | null = null;
    const ledger = new CleanupLedger({
      read: () => raw,
      write: (value) => { raw = value; },
      remove: () => { raw = null; },
    });
    const coordinator = new AccountCleanupCoordinator(ledger, cleanupRegistry, {
      newId: () => 'cleanup-storage-test',
      now: () => 10,
      hashAccountId: async () => 'hash_a',
    });
    await expect(coordinator.requestCleanup({
      reason: 'logout', previousAccountId: 'account-a',
      expectedSessionFingerprint: 'fingerprint-a',
    })).resolves.toMatchObject({ ok: true, state: 'COMPLETED' });
  });

  it('confirms current service worker is cache-stateless by source contract', async () => {
    const { join } = await import('node:path');
    const source = await import('node:fs/promises').then(({ readFile }) =>
      readFile(join(process.cwd(), 'public', 'sw.js'), 'utf8'));
    expect(source).toContain('Zero-Leak: no caches');
    expect(source).not.toMatch(/\bcaches\.(open|match|delete)\s*\(/);
  });
});
