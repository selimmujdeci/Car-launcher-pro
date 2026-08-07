import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OfflineAuthorityVerificationParticipant,
  OfflineQueueCleanupParticipant,
  OwnershipSnapshotCleanupParticipant,
  PendingPairingCleanupParticipant,
  createProductionOfflineAuthorityAdapters,
  type OfflineAuthorityDomainAdapter,
} from '@/security/accountCleanup/offlineAuthorityCleanupParticipants';
import {
  activateAccountSecurityLockdown,
  getCleanupGeneration,
  resetAccountSecurityLockdownForTests,
} from '@/security/accountCleanup/cleanupLockdown';
import { createVehicleCleanupComposition } from '@/security/accountCleanup/createAccountCleanupRuntime';
import {
  activeQueueAccountId,
  getQueue,
  storeSnapshot,
  verifyOfflineQueueAuthorityEmpty,
  verifyOwnershipSnapshotAuthorityEmpty,
  verifyPendingPairingAuthorityEmpty,
} from '@/lib/offline/fleetOffline';
import { buildSnapshot } from '@/lib/offline/ownershipSnapshot';
import {
  createPendingPairing,
  getPendingPairingStore,
  isPendingPairingRuntimeEmpty,
} from '@/lib/offline/pendingPairingService';
import type { CleanupContext } from '@/security/accountCleanup/cleanupTypes';
import type { SecureCipher } from '@/lib/offline/offlinePairing';

const cipher: SecureCipher = {
  encrypt: async (value) => `enc:${value}`,
  decrypt: async (value) => value.startsWith('enc:') ? value.slice(4) : null,
};

function context(): CleanupContext {
  return {
    cleanupId: 'cleanup-offline-1',
    reason: 'logout',
    startedAt: 1,
    generation: getCleanupGeneration(),
  };
}

function adapter(initiallyEmpty = false): {
  adapter: OfflineAuthorityDomainAdapter;
  state: { empty: boolean };
} {
  const state = { empty: initiallyEmpty };
  return {
    state,
    adapter: {
      prepare: vi.fn(),
      cleanup: vi.fn(() => { state.empty = true; return true; }),
      verifyEmpty: vi.fn(() => state.empty),
    },
  };
}

describe('offline account authority cleanup participants', () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetAccountSecurityLockdownForTests();
    activateAccountSecurityLockdown('cleanup-offline-1', 'logout', 1);
  });

  it('queue participant prepare → cleanup → verify sırasını korur', async () => {
    const calls: string[] = [];
    let empty = false;
    const subject = new OfflineQueueCleanupParticipant({
      prepare: () => { calls.push('prepare'); },
      cleanup: () => { calls.push('cleanup'); empty = true; return true; },
      verifyEmpty: () => { calls.push('verify'); return empty; },
    });

    expect(await subject.clear(context())).toEqual({ ok: true, code: 'CLEARED' });
    expect(calls).toEqual(['verify', 'prepare', 'cleanup', 'verify']);
  });

  it('ownership participant idempotent ALREADY_EMPTY üretir', async () => {
    const fixture = adapter(true);
    const subject = new OwnershipSnapshotCleanupParticipant(fixture.adapter);
    expect(await subject.clear(context())).toEqual({
      ok: true, code: 'ALREADY_EMPTY',
    });
  });

  it('pending pairing participant retry-safe çalışır', async () => {
    const fixture = adapter(false);
    const subject = new PendingPairingCleanupParticipant(fixture.adapter);
    expect((await subject.clear(context())).ok).toBe(true);
    expect((await subject.clear(context())).ok).toBe(true);
  });

  it('generation mismatch cleanup başlamadan reddedilir', async () => {
    const fixture = adapter(false);
    const stale = context();
    activateAccountSecurityLockdown('cleanup-offline-2', 'session_expired', 2);
    const result = await new OfflineQueueCleanupParticipant(fixture.adapter)
      .clear(stale);
    expect(result).toMatchObject({
      ok: false, failureCode: 'OFFLINE_AUTHORITY_GENERATION_MISMATCH',
    });
    expect(fixture.adapter.cleanup).not.toHaveBeenCalled();
  });

  it('cleanup false sonucu fail-closed olur', async () => {
    const fixture = adapter(false);
    fixture.adapter.cleanup = vi.fn(() => false);
    expect(await new OfflineQueueCleanupParticipant(fixture.adapter).clear(context()))
      .toMatchObject({ ok: false, failureCode: 'OFFLINE_QUEUE_PURGE_FAILED' });
  });

  it('verify residue fail-closed olur', async () => {
    const fixture = adapter(false);
    fixture.adapter.cleanup = vi.fn(() => true);
    expect(await new PendingPairingCleanupParticipant(fixture.adapter).clear(context()))
      .toMatchObject({ ok: false, failureCode: 'PENDING_PAIRING_STILL_PRESENT' });
  });

  it('aggregate verifier üç domain boş olmadan başarı üretmez', async () => {
    const queue = adapter(true);
    const ownership = adapter(false);
    const pairing = adapter(true);
    const subject = new OfflineAuthorityVerificationParticipant(
      queue.adapter, ownership.adapter, pairing.adapter,
    );
    expect(await subject.clear(context())).toMatchObject({
      ok: false, failureCode: 'OWNERSHIP_SNAPSHOT_STILL_PRESENT',
    });
    expect(await subject.verifyEmpty(context())).toBe(false);
  });

  it('aggregate verifier doğrulanmış empty state üretir', async () => {
    const queue = adapter(true);
    const ownership = adapter(true);
    const pairing = adapter(true);
    const subject = new OfflineAuthorityVerificationParticipant(
      queue.adapter, ownership.adapter, pairing.adapter,
    );
    expect((await subject.clear(context())).ok).toBe(true);
    expect(await subject.verifyEmpty(context())).toBe(true);
  });

  it('production queue adapter memory ve tüm queue namespace’lerini temizler', async () => {
    const queue = getQueue('account-a');
    await queue.enqueue({
      operationType: 'COMPANY_CREATE',
      actorId: 'account-a',
      payload: { name: 'A' },
      dedupKey: 'company-a',
      idempotencyKey: 'idem-a',
    });
    window.localStorage.setItem('caros.fleet.queue.corrupt.account-a', 'x');
    expect(activeQueueAccountId()).toBe('account-a');

    const result = await new OfflineQueueCleanupParticipant(
      createProductionOfflineAuthorityAdapters().queue,
    ).clear(context());

    expect(result.ok).toBe(true);
    expect(verifyOfflineQueueAuthorityEmpty()).toBe(true);
    expect(window.localStorage.getItem('caros.fleet.queue.account-a')).toBeNull();
    expect(window.localStorage.getItem('caros.fleet.queue.corrupt.account-a')).toBeNull();
  });

  it('production ownership adapter bütün snapshot namespace’lerini temizler', async () => {
    for (const userId of ['account-a', 'account-b']) {
      storeSnapshot(buildSnapshot({
        userId, companyId: null, companyRole: 'individual',
        ownedVehicleIds: [], accessibleVehicleIds: [],
        serverRevision: 1, verifiedAt: 1,
      }));
    }
    const result = await new OwnershipSnapshotCleanupParticipant(
      createProductionOfflineAuthorityAdapters().ownership,
    ).clear(context());
    expect(result.ok).toBe(true);
    expect(verifyOwnershipSnapshotAuthorityEmpty()).toBe(true);
  });

  it('production pairing adapter persistent ve singleton authority’yi temizler', async () => {
    await createPendingPairing({
      namespace: 'account-a', userId: 'account-a', code: '123456',
      now: 1, cipher, idFactory: () => 'pair-1',
    });
    expect(isPendingPairingRuntimeEmpty()).toBe(false);
    const result = await new PendingPairingCleanupParticipant(
      createProductionOfflineAuthorityAdapters().pairing,
    ).clear(context());
    expect(result.ok).toBe(true);
    expect(verifyPendingPairingAuthorityEmpty()).toBe(true);
    expect(isPendingPairingRuntimeEmpty()).toBe(true);
  });

  it('global device preferences korunur', async () => {
    window.localStorage.setItem('caros-theme', 'dark');
    await new OfflineQueueCleanupParticipant(
      createProductionOfflineAuthorityAdapters().queue,
    ).clear(context());
    expect(window.localStorage.getItem('caros-theme')).toBe('dark');
  });

  it('bilinmeyen CAROS key agresif silinmez', async () => {
    window.localStorage.setItem('caros.future.safe-key', 'value');
    await new OwnershipSnapshotCleanupParticipant(
      createProductionOfflineAuthorityAdapters().ownership,
    ).clear(context());
    expect(window.localStorage.getItem('caros.future.safe-key')).toBe('value');
  });

  it('production composition participant’ları deterministik kaydeder', () => {
    const registry = createVehicleCleanupComposition(() => window.localStorage)
      .participantRegistry;
    expect(registry.listForPhase('QUEUE_AND_SNAPSHOT_PURGE').map((item) => item.id))
      .toEqual([
        'offline-queue-cleanup',
        'ownership-snapshot-cleanup',
        'pending-pairing-cleanup',
      ]);
    expect(registry.listForPhase('VERIFY_EMPTY').map((item) => item.id))
      .toContain('offline-authority-verification');
  });

  it('pairing store tekrar hydrate edildiğinde temizdir', async () => {
    await new PendingPairingCleanupParticipant(
      createProductionOfflineAuthorityAdapters().pairing,
    ).clear(context());
    expect(await getPendingPairingStore('account-a', cipher).list()).toEqual([]);
  });
});
