import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AccountCleanupCoordinator,
  AccountScopedStorageRegistry,
  AccountScopedStorageVerificationParticipant,
  CleanupLedger,
  CleanupParticipantRegistry,
  VehicleAuthorityVerificationParticipant,
  VehicleCredentialCleanupParticipant,
  VehicleIdentityStorageCleanupParticipant,
  VehicleMemoryAuthorityCleanupParticipant,
  createVehicleCleanupComposition,
  type AccountCleanupParticipant,
  type CleanupContext,
  type CleanupPhase,
  type VehicleAuthorityMemoryAdapter,
  type VehicleCleanupStorage,
} from '@/security/accountCleanup';
import {
  activateAccountSecurityLockdown,
  captureCleanupGeneration,
  isCleanupGenerationCurrent,
  resetAccountSecurityLockdownForTests,
} from '@/security/accountCleanup/cleanupLockdown';
import {
  createProductionStorageRegistry,
  scanKnownClientStorage,
  type EnumerableStorageAdapter,
} from '@/security/accountCleanup/storage';
import { useVehicleStore } from '@/store/vehicleStore';

class FakeStorage implements VehicleCleanupStorage, EnumerableStorageAdapter {
  readonly backend = 'LOCAL_STORAGE' as const;
  readonly values = new Map<string, string>();
  readonly removeCalls: string[] = [];
  failHas = false;
  readonly failRemove = new Set<string>();

  remove(key: string) {
    this.removeCalls.push(key);
    if (this.failRemove.has(key)) return { ok: false as const };
    this.values.delete(key);
    return { ok: true as const };
  }

  has(key: string) {
    if (this.failHas) return { ok: false as const };
    return { ok: true as const, present: this.values.has(key) };
  }

  listKeys(limit: number) {
    if (this.failHas || this.values.size > limit) return { ok: false as const };
    return { ok: true as const, keys: Array.from(this.values.keys()) };
  }

  read(key: string) {
    if (this.failHas) return { ok: false as const };
    return { ok: true as const, value: this.values.get(key) ?? null };
  }
}

class FakeMemory implements VehicleAuthorityMemoryAdapter {
  empty = false;
  failClear = false;
  sticky = false;
  clearCalls = 0;

  clearVehicleAuthority() {
    this.clearCalls += 1;
    if (this.failClear) throw new Error('memory unavailable');
    if (!this.sticky) this.empty = true;
  }

  verifyVehicleAuthorityEmpty() {
    return this.empty;
  }
}

let context: CleanupContext;

beforeEach(() => {
  resetAccountSecurityLockdownForTests();
  const state = activateAccountSecurityLockdown('cleanup-vehicle', 'logout', 10);
  context = {
    cleanupId: 'cleanup-vehicle',
    reason: 'logout',
    startedAt: 10,
    generation: state.generation,
  };
  useVehicleStore.getState().clearVehicleAuthority();
});

describe('vehicle credential cleanup', () => {
  it.each([
    'caros_pair_api_key',
    'caros_critical_pin_hash',
  ])('removes credential key %s', async (key) => {
    const storage = new FakeStorage();
    storage.values.set(key, 'never-log-this-secret');
    const result = await new VehicleCredentialCleanupParticipant(storage).clear(context);
    expect(result).toEqual({ ok: true, code: 'CLEARED' });
    expect(storage.values.has(key)).toBe(false);
    expect(JSON.stringify(result)).not.toContain('never-log-this-secret');
  });

  it('removes API key and PIN hash together', async () => {
    const storage = new FakeStorage();
    storage.values.set('caros_pair_api_key', 'api-secret');
    storage.values.set('caros_critical_pin_hash', 'pin-secret');
    await expect(
      new VehicleCredentialCleanupParticipant(storage).clear(context),
    ).resolves.toEqual({ ok: true, code: 'CLEARED' });
    expect(storage.values.size).toBe(0);
  });

  it('is idempotent when credentials are already absent', async () => {
    const participant = new VehicleCredentialCleanupParticipant(new FakeStorage());
    await expect(participant.clear(context)).resolves.toEqual({
      ok: true, code: 'ALREADY_EMPTY',
    });
  });

  it.each([
    ['caros_pair_api_key', 'VEHICLE_API_KEY_PURGE_FAILED'],
    ['caros_critical_pin_hash', 'VEHICLE_PIN_HASH_PURGE_FAILED'],
  ])('fails closed when %s cannot be removed', async (key, failureCode) => {
    const storage = new FakeStorage();
    storage.values.set(key, 'secret');
    storage.failRemove.add(key);
    await expect(
      new VehicleCredentialCleanupParticipant(storage).clear(context),
    ).resolves.toMatchObject({ ok: false, retryable: false, failureCode });
  });

  it('fails closed when storage is unavailable', async () => {
    const storage = new FakeStorage();
    storage.failHas = true;
    await expect(
      new VehicleCredentialCleanupParticipant(storage).clear(context),
    ).resolves.toMatchObject({
      ok: false,
      failureCode: 'VEHICLE_CREDENTIAL_STORAGE_UNAVAILABLE',
    });
  });
});

describe('vehicle identity cleanup', () => {
  it('removes vehicle ID, name and plate as a bounded set', async () => {
    const storage = new FakeStorage();
    ['caros_pair_vehicle_id', 'caros_pair_vehicle_name', 'caros_pair_vehicle_plate']
      .forEach((key) => storage.values.set(key, 'value'));
    await expect(
      new VehicleIdentityStorageCleanupParticipant(storage).clear(context),
    ).resolves.toEqual({ ok: true, code: 'CLEARED' });
    expect(storage.removeCalls).toEqual([
      'caros_pair_vehicle_id',
      'caros_pair_vehicle_name',
      'caros_pair_vehicle_plate',
    ]);
  });

  it('clears partial identity state', async () => {
    const storage = new FakeStorage();
    storage.values.set('caros_pair_vehicle_plate', '34 TEST');
    await expect(
      new VehicleIdentityStorageCleanupParticipant(storage).clear(context),
    ).resolves.toEqual({ ok: true, code: 'CLEARED' });
  });

  it('continues best-effort but returns blocking failure', async () => {
    const storage = new FakeStorage();
    storage.values.set('caros_pair_vehicle_id', 'vehicle');
    storage.values.set('caros_pair_vehicle_name', 'name');
    storage.failRemove.add('caros_pair_vehicle_id');
    const result = await new VehicleIdentityStorageCleanupParticipant(storage)
      .clear(context);
    expect(result).toMatchObject({
      ok: false,
      failureCode: 'VEHICLE_IDENTITY_PURGE_FAILED',
    });
    expect(storage.removeCalls).toContain('caros_pair_vehicle_name');
  });

  it('preserves global theme and unknown CAROS keys', async () => {
    const storage = new FakeStorage();
    storage.values.set('caros_pair_vehicle_id', 'vehicle');
    storage.values.set('caros-theme', 'dark');
    storage.values.set('caros_future_unknown', 'data');
    await new VehicleIdentityStorageCleanupParticipant(storage).clear(context);
    expect(storage.values.get('caros-theme')).toBe('dark');
    expect(storage.values.get('caros_future_unknown')).toBe('data');
  });

  it('is idempotent across cleanup recovery reruns', async () => {
    const storage = new FakeStorage();
    storage.values.set('caros_pair_vehicle_id', 'vehicle');
    const participant = new VehicleIdentityStorageCleanupParticipant(storage);
    await expect(participant.clear(context)).resolves.toMatchObject({ ok: true });
    await expect(participant.clear(context)).resolves.toEqual({
      ok: true, code: 'ALREADY_EMPTY',
    });
  });
});

describe('vehicle memory authority cleanup', () => {
  it('clears and verifies memory authority', async () => {
    const memory = new FakeMemory();
    await expect(
      new VehicleMemoryAuthorityCleanupParticipant(memory).clear(context),
    ).resolves.toEqual({ ok: true, code: 'CLEARED' });
    expect(memory.empty).toBe(true);
  });

  it('returns ALREADY_EMPTY for an empty store', async () => {
    const memory = new FakeMemory();
    memory.empty = true;
    await expect(
      new VehicleMemoryAuthorityCleanupParticipant(memory).clear(context),
    ).resolves.toEqual({ ok: true, code: 'ALREADY_EMPTY' });
  });

  it('fails on memory clear exception', async () => {
    const memory = new FakeMemory();
    memory.failClear = true;
    await expect(
      new VehicleMemoryAuthorityCleanupParticipant(memory).clear(context),
    ).resolves.toMatchObject({
      ok: false, failureCode: 'VEHICLE_MEMORY_PURGE_FAILED',
    });
  });

  it('fails when memory remains non-empty after clear', async () => {
    const memory = new FakeMemory();
    memory.sticky = true;
    await expect(
      new VehicleMemoryAuthorityCleanupParticipant(memory).clear(context),
    ).resolves.toMatchObject({
      ok: false, failureCode: 'VEHICLE_MEMORY_STILL_PRESENT',
    });
  });

  it('production vehicle adapter clears cached vehicle state', () => {
    useVehicleStore.setState({
      vehicles: {
        v1: {
          id: 'v1', name: 'Car', plate: '34 X', driver: '—', status: 'offline',
          lat: 0, lng: 0, speed: 0, fuel: 0, engineTemp: 0, rpm: 0,
          odometer: 0, location: '—', lastSeen: '—', lastTimestamp: 0,
        },
      },
      connectionStatus: 'connected',
      loading: true,
      error: 'old',
    });
    useVehicleStore.getState().clearVehicleAuthority();
    expect(useVehicleStore.getState().isVehicleAuthorityEmpty()).toBe(true);
  });
});

describe('vehicle authority verification and ordering', () => {
  it.each([
    ['caros_pair_api_key', 'VEHICLE_CREDENTIAL_STILL_PRESENT'],
    ['caros_critical_pin_hash', 'VEHICLE_CREDENTIAL_STILL_PRESENT'],
    ['caros_pair_vehicle_id', 'VEHICLE_AUTHORITY_PARTIAL_STATE'],
    ['caros_pair_vehicle_name', 'VEHICLE_AUTHORITY_PARTIAL_STATE'],
    ['caros_pair_vehicle_plate', 'VEHICLE_AUTHORITY_PARTIAL_STATE'],
  ])('fails verification while %s remains', async (key, failureCode) => {
    const storage = new FakeStorage();
    storage.values.set(key, 'private');
    const memory = new FakeMemory();
    memory.empty = true;
    await expect(
      new VehicleAuthorityVerificationParticipant(storage, memory).clear(context),
    ).resolves.toMatchObject({ ok: false, failureCode });
  });

  it('fails verification when memory remains', async () => {
    await expect(
      new VehicleAuthorityVerificationParticipant(
        new FakeStorage(), new FakeMemory(),
      ).clear(context),
    ).resolves.toMatchObject({
      ok: false, failureCode: 'VEHICLE_MEMORY_STILL_PRESENT',
    });
  });

  it('classifies a complete remaining identity set as still present', async () => {
    const storage = new FakeStorage();
    ['caros_pair_vehicle_id', 'caros_pair_vehicle_name', 'caros_pair_vehicle_plate']
      .forEach((key) => storage.values.set(key, 'private'));
    const memory = new FakeMemory();
    memory.empty = true;
    await expect(
      new VehicleAuthorityVerificationParticipant(storage, memory).clear(context),
    ).resolves.toMatchObject({
      ok: false, failureCode: 'VEHICLE_IDENTITY_STILL_PRESENT',
    });
  });

  it('verifies persistent and memory authority are empty', async () => {
    const memory = new FakeMemory();
    memory.empty = true;
    const participant = new VehicleAuthorityVerificationParticipant(
      new FakeStorage(), memory,
    );
    await expect(participant.clear(context)).resolves.toEqual({
      ok: true, code: 'ALREADY_EMPTY',
    });
    await expect(participant.verifyEmpty(context)).resolves.toBe(true);
  });

  it('orders secret purge before private purge and verification', () => {
    const composition = createVehicleCleanupComposition(
      () => window.localStorage,
    );
    expect(composition.participantRegistry
      .listForPhase('LOCAL_SECRET_PURGE').map(({ id }) => id))
      .toContain('vehicle-credential-cleanup');
    expect(composition.participantRegistry
      .listForPhase('LOCAL_PRIVATE_DATA_PURGE').map(({ id }) => id))
      .toEqual([
        'vehicle-identity-storage-cleanup',
        'vehicle-memory-authority-cleanup',
      ]);
    expect(composition.participantRegistry
      .listForPhase('VERIFY_EMPTY').map(({ id }) => id))
      .toEqual([
        'vehicle-authority-verification',
        'offline-authority-verification',
        'server-session-verification',
        'account-scoped-storage-verification',
      ]);
  });

  it('rejects duplicate composition registration', () => {
    const composition = createVehicleCleanupComposition(
      () => window.localStorage,
    );
    const participant = composition.participantRegistry
      .listForPhase('LOCAL_SECRET_PURGE')[0];
    expect(() => composition.participantRegistry.register(participant))
      .toThrow('DUPLICATE_PARTICIPANT_ID');
  });

  it('does not access browser storage during composition import/construction', () => {
    const getStorage = vi.fn(() => window.localStorage);
    createVehicleCleanupComposition(getStorage);
    expect(getStorage).not.toHaveBeenCalled();
  });

  it('keeps API key dangerous and unregistered in storage scanner', () => {
    const adapter = new FakeStorage();
    adapter.values.set('caros_pair_api_key', 'never-output');
    const scan = scanKnownClientStorage({
      registry: createProductionStorageRegistry(),
      adapters: [adapter],
    });
    expect(scan.unregisteredKnownEntries).toEqual([{
      key: 'caros_pair_api_key',
      backend: 'LOCAL_STORAGE',
      failureCode: 'UNREGISTERED_KNOWN_KEY',
    }]);
    expect(JSON.stringify(scan)).not.toContain('never-output');
  });

  it('integrates with AccountScopedStorageVerificationParticipant after purge', async () => {
    const storage = new FakeStorage();
    const storageRegistry = new AccountScopedStorageRegistry();
    storageRegistry.registerStorageDescriptor({
      id: 'critical-pin-hash',
      backend: 'LOCAL_STORAGE',
      scope: 'ACCOUNT',
      sensitivity: 'AUTHORITY',
      cleanupPolicies: ['PURGE_ON_LOGOUT'],
      physicalKey: 'caros_critical_pin_hash',
      namespaceVersion: 1,
      ownerRequirements: { accountId: true, vehicleId: false },
      verifyStrategy: 'KEY_ABSENT',
      valueFormat: 'OPAQUE',
      description: 'Test PIN authority',
    });
    storageRegistry.freeze();
    const participant = new AccountScopedStorageVerificationParticipant(
      storageRegistry, [storage],
    );
    await expect(participant.clear(context)).resolves.toEqual({
      ok: true, code: 'ALREADY_EMPTY',
    });
    await expect(participant.verifyEmpty(context)).resolves.toBe(true);
  });

  it('rejects a stale generation and an unlocked participant call', async () => {
    const participant = new VehicleCredentialCleanupParticipant(new FakeStorage());
    const oldContext = { ...context };
    activateAccountSecurityLockdown('cleanup-new', 'logout', 20);
    await expect(participant.clear(oldContext)).resolves.toMatchObject({
      ok: false, failureCode: 'VEHICLE_AUTHORITY_LATE_WRITE_DETECTED',
    });
  });
});

describe('coordinator integration', () => {
  it('completes only after real vehicle verification', async () => {
    const storage = new FakeStorage();
    storage.values.set('caros_pair_api_key', 'secret');
    storage.values.set('caros_pair_vehicle_id', 'vehicle');
    const memory = new FakeMemory();
    const registry = new CleanupParticipantRegistry();
    registry.register(new VehicleCredentialCleanupParticipant(storage));
    registry.register(new VehicleIdentityStorageCleanupParticipant(storage));
    registry.register(new VehicleMemoryAuthorityCleanupParticipant(memory));
    for (const phase of [
      'QUEUE_AND_SNAPSHOT_PURGE',
      'SERVER_SESSION_REVOKE',
      'DEVICE_AND_PUSH_REVOKE',
    ] as CleanupPhase[]) {
      registry.register(noop(phase));
    }
    registry.register(new VehicleAuthorityVerificationParticipant(storage, memory));
    let raw: string | null = null;
    const coordinator = new AccountCleanupCoordinator(
      new CleanupLedger({
        read: () => raw,
        write: (value) => { raw = value; },
        remove: () => { raw = null; },
      }),
      registry,
      { newId: () => 'cleanup-integration', now: () => 20 },
    );
    await expect(coordinator.requestCleanup({ reason: 'logout' }))
      .resolves.toMatchObject({ ok: true, state: 'COMPLETED' });
    expect(memory.clearCalls).toBe(1);
  });

  it('does not complete when vehicle verification detects a late write', async () => {
    const storage = new FakeStorage();
    const memory = new FakeMemory();
    memory.sticky = true;
    const participant = new VehicleMemoryAuthorityCleanupParticipant(memory);
    await expect(participant.clear(context)).resolves.toMatchObject({
      ok: false, failureCode: 'VEHICLE_MEMORY_STILL_PRESENT',
    });
  });

  it('rejects local rehydrate while cleanup lockdown is active', () => {
    window.localStorage.setItem('caros_pair_vehicle_id', 'old-vehicle');
    window.localStorage.setItem('caros_pair_api_key', 'old-secret');
    useVehicleStore.getState().initializeFromLocal();
    expect(useVehicleStore.getState().isVehicleAuthorityEmpty()).toBe(true);
    window.localStorage.removeItem('caros_pair_vehicle_id');
    window.localStorage.removeItem('caros_pair_api_key');
  });

  it('rejects callbacks captured before a cleanup generation change', () => {
    resetAccountSecurityLockdownForTests();
    const captured = captureCleanupGeneration();
    expect(isCleanupGenerationCurrent(captured)).toBe(true);
    activateAccountSecurityLockdown('late-write', 'logout', 30);
    expect(isCleanupGenerationCurrent(captured)).toBe(false);
  });
});

function noop(phase: CleanupPhase): AccountCleanupParticipant {
  return {
    id: `noop-${phase}`,
    phase,
    priority: 50,
    clear: async () => ({ ok: true, code: 'NOT_APPLICABLE' }),
  };
}
