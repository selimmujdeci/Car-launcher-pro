/**
 * fleetOfflineQueue.test.ts — OFFLINE DOMAIN KUYRUĞU · SNAPSHOT · PAIRING · SYNC.
 *
 * Kilitlenen davranışlar:
 *   · dedupe · TTL/EXPIRED · backoff · poison-item (sonsuz retry YOK)
 *   · bounded kuyruk (sessiz kayıp YOK) · yeniden başlatma sonrası geri yükleme
 *   · bozuk depo fail-soft · SYNCING kör başarı SAYILMAZ
 *   · dependsOn sırası · domain sırası · entity serileştirme
 *   · snapshot fail-closed · hesap değişimi izolasyonu
 *   · çevrimdışı pairing GERÇEK SAHİPLİK ÜRETMEZ
 *
 * ZAYIFLATMA/SİLME (CLAUDE.md Regresyon Kasası).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DomainQueue } from '@/lib/offline/domainQueue';
import { MemoryQueueStorage, type QueueStorage } from '@/lib/offline/storage';
import { backoffDelayMs, DEFAULT_MAX_ATTEMPTS, type QueueItem } from '@/lib/offline/types';
import {
  SyncOrchestrator, entityKeyOf,
  type SyncTransport, type TransportResult, type ProfileReadinessCheck,
} from '@/lib/offline/syncOrchestrator';
import {
  buildSnapshot, canOffline, canAccessVehicleOffline, isExpired, isCriticalCapability,
} from '@/lib/offline/ownershipSnapshot';
import { isSendable, expireOverdue, statusLabel, type PendingPairing } from '@/lib/offline/offlinePairing';

/* ── Yardımcılar ──────────────────────────────────────────────────────── */

let clock = 1_000_000;
const now = () => clock;

function makeQueue(storage?: QueueStorage, maxSize?: number): DomainQueue {
  let counter = 0;
  return new DomainQueue({
    storage: storage ?? new MemoryQueueStorage(),
    now,
    idFactory: () => `item-${++counter}`,
    maxSize,
  });
}

const baseInput = {
  actorId: 'user-1',
  payload: {} as Record<string, unknown>,
};

beforeEach(() => { clock = 1_000_000; });

/* ── Kuyruk temelleri ─────────────────────────────────────────────────── */

describe('domain kuyruğu · temel', () => {
  it('işlem PENDING olarak eklenir', async () => {
    const q = makeQueue();
    const item = await q.enqueue({
      ...baseInput, operationType: 'COMPANY_CREATE',
      dedupKey: 'c1', idempotencyKey: 'k1',
    });
    expect(item?.status).toBe('PENDING');
    expect(item?.attemptCount).toBe(0);
  });

  it('aynı dedupKey ile ikinci AKTİF öğe eklenmez', async () => {
    const q = makeQueue();
    const a = await q.enqueue({ ...baseInput, operationType: 'MEMBER_ADD', dedupKey: 'm1', idempotencyKey: 'k1' });
    const b = await q.enqueue({ ...baseInput, operationType: 'MEMBER_ADD', dedupKey: 'm1', idempotencyKey: 'k2' });
    expect(b?.id).toBe(a?.id);
    expect((await q.all())).toHaveLength(1);
  });

  it('terminal öğeden sonra aynı dedupKey yeniden eklenebilir', async () => {
    const q = makeQueue();
    const a = await q.enqueue({ ...baseInput, operationType: 'MEMBER_ADD', dedupKey: 'm1', idempotencyKey: 'k1' });
    await q.markSynced(a!.id);
    const b = await q.enqueue({ ...baseInput, operationType: 'MEMBER_ADD', dedupKey: 'm1', idempotencyKey: 'k2' });
    expect(b?.id).not.toBe(a?.id);
  });

  it('kuyruk BOUNDED — dolduğunda sessizce kaybetmez, null döner', async () => {
    const q = makeQueue(undefined, 2);
    await q.enqueue({ ...baseInput, operationType: 'VEHICLE_EVENT', dedupKey: 'a', idempotencyKey: '1' });
    await q.enqueue({ ...baseInput, operationType: 'VEHICLE_EVENT', dedupKey: 'b', idempotencyKey: '2' });
    const third = await q.enqueue({ ...baseInput, operationType: 'VEHICLE_EVENT', dedupKey: 'c', idempotencyKey: '3' });
    expect(third).toBeNull();
  });

  it('kuyruk dolduğunda önce terminal öğeler budanır', async () => {
    const q = makeQueue(undefined, 2);
    const a = await q.enqueue({ ...baseInput, operationType: 'VEHICLE_EVENT', dedupKey: 'a', idempotencyKey: '1' });
    await q.enqueue({ ...baseInput, operationType: 'VEHICLE_EVENT', dedupKey: 'b', idempotencyKey: '2' });
    await q.markSynced(a!.id);
    const third = await q.enqueue({ ...baseInput, operationType: 'VEHICLE_EVENT', dedupKey: 'c', idempotencyKey: '3' });
    expect(third).not.toBeNull();
  });
});

/* ── TTL · backoff · poison ───────────────────────────────────────────── */

describe('domain kuyruğu · TTL, backoff, poison', () => {
  it('TTL geçince öğe EXPIRED olur ve gönderilmez', async () => {
    const q = makeQueue();
    await q.enqueue({
      ...baseInput, operationType: 'COMPANY_CREATE',
      dedupKey: 'c', idempotencyKey: 'k', ttlMs: 1000,
    });
    clock += 1001;
    const ready = await q.ready();
    expect(ready).toHaveLength(0);
    expect((await q.all())[0].status).toBe('EXPIRED');
  });

  it('backoff üsteldir ve tavanla sınırlıdır', () => {
    expect(backoffDelayMs(0)).toBe(0);
    expect(backoffDelayMs(1)).toBe(2000);
    expect(backoffDelayMs(2)).toBe(4000);
    expect(backoffDelayMs(3)).toBe(8000);
    expect(backoffDelayMs(50)).toBe(300_000); // tavan
  });

  it('yeniden denenebilir hata backoff uygular; süre dolmadan gönderilmez', async () => {
    const q = makeQueue();
    const item = await q.enqueue({ ...baseInput, operationType: 'MEMBER_ADD', dedupKey: 'm', idempotencyKey: 'k' });
    await q.markRetryableFailure(item!.id, 'network_error');
    expect((await q.ready())).toHaveLength(0);
    clock += 2001;
    expect((await q.ready())).toHaveLength(1);
  });

  it('maxAttempts dolunca PERMANENT_FAILED olur — SONSUZ RETRY YOK', async () => {
    const q = makeQueue();
    const item = await q.enqueue({ ...baseInput, operationType: 'MEMBER_ADD', dedupKey: 'm', idempotencyKey: 'k' });
    for (let i = 0; i < DEFAULT_MAX_ATTEMPTS; i++) {
      await q.markRetryableFailure(item!.id, 'network_error');
      clock += 400_000;
    }
    const all = await q.all();
    expect(all[0].status).toBe('PERMANENT_FAILED');
    expect((await q.ready())).toHaveLength(0);
  });

  it('kullanıcı yeniden dene derse sayaç sıfırlanır', async () => {
    const q = makeQueue();
    const item = await q.enqueue({ ...baseInput, operationType: 'MEMBER_ADD', dedupKey: 'm', idempotencyKey: 'k' });
    await q.markRetryableFailure(item!.id, 'network_error');
    await q.retry(item!.id);
    const all = await q.all();
    expect(all[0].status).toBe('PENDING');
    expect(all[0].attemptCount).toBe(0);
  });

  it('süresi dolmuş öğe yeniden denenemez', async () => {
    const q = makeQueue();
    const item = await q.enqueue({
      ...baseInput, operationType: 'MEMBER_ADD', dedupKey: 'm', idempotencyKey: 'k', ttlMs: 100,
    });
    clock += 200;
    await q.all();               // EXPIRED işaretle
    await q.retry(item!.id);
    expect((await q.all())[0].status).toBe('EXPIRED');
  });
});

/* ── Bağımlılık ve sıralama ───────────────────────────────────────────── */

describe('domain kuyruğu · bağımlılık ve sıralama', () => {
  it('dependsOn çözülmeden işlem gönderilmez (BLOCKED_BY_DEPENDENCY)', async () => {
    const q = makeQueue();
    const parent = await q.enqueue({ ...baseInput, operationType: 'COMPANY_CREATE', dedupKey: 'c', idempotencyKey: '1' });
    await q.enqueue({
      ...baseInput, operationType: 'MEMBER_ADD',
      dedupKey: 'm', idempotencyKey: '2', dependsOn: [parent!.id],
    });

    let ready = await q.ready();
    expect(ready.map((r) => r.operationType)).toEqual(['COMPANY_CREATE']);
    expect((await q.all()).find((i) => i.operationType === 'MEMBER_ADD')?.status)
      .toBe('BLOCKED_BY_DEPENDENCY');

    await q.markSynced(parent!.id);
    ready = await q.ready();
    expect(ready.map((r) => r.operationType)).toEqual(['MEMBER_ADD']);
  });

  it('domain sırası uygulanır: company → membership → ownership → pairing → assignment → event', async () => {
    const q = makeQueue();
    await q.enqueue({ ...baseInput, operationType: 'VEHICLE_EVENT',          dedupKey: 'e', idempotencyKey: '1' });
    await q.enqueue({ ...baseInput, operationType: 'VEHICLE_ASSIGN_COMPANY', dedupKey: 'a', idempotencyKey: '2' });
    await q.enqueue({ ...baseInput, operationType: 'COMPANY_CREATE',         dedupKey: 'c', idempotencyKey: '3' });
    await q.enqueue({ ...baseInput, operationType: 'VEHICLE_PAIR',           dedupKey: 'p', idempotencyKey: '4' });
    await q.enqueue({ ...baseInput, operationType: 'MEMBER_ADD',             dedupKey: 'm', idempotencyKey: '5' });
    await q.enqueue({ ...baseInput, operationType: 'OWNERSHIP_CLAIM',        dedupKey: 'o', idempotencyKey: '6' });

    const ready = await q.ready();
    expect(ready.map((r) => r.operationType)).toEqual([
      'COMPANY_CREATE', 'MEMBER_ADD', 'OWNERSHIP_CLAIM',
      'VEHICLE_PAIR', 'VEHICLE_ASSIGN_COMPANY', 'VEHICLE_EVENT',
    ]);
  });

  it('aynı araç işlemleri aynı entity anahtarını paylaşır (serileştirme)', () => {
    const mk = (op: QueueItem['operationType'], vehicleId: string): QueueItem => ({
      schemaVersion: 1,
      id: 'x', operationType: op, actorId: 'u', companyId: null, vehicleId,
      payload: {}, createdAt: 0, clientRevision: 0, dedupKey: 'd', idempotencyKey: 'i',
      dependsOn: [], attemptCount: 0, maxAttempts: 3, nextAttemptAt: 0,
      expiresAt: 0, status: 'PENDING', failureCode: null,
    });
    expect(entityKeyOf(mk('VEHICLE_PAIR', 'v1'))).toBe(entityKeyOf(mk('VEHICLE_ASSIGN_COMPANY', 'v1')));
    expect(entityKeyOf(mk('VEHICLE_PAIR', 'v1'))).not.toBe(entityKeyOf(mk('VEHICLE_PAIR', 'v2')));
  });
});

/* ── Kalıcılık ve yeniden başlatma ────────────────────────────────────── */

describe('domain kuyruğu · yeniden başlatma ve bozuk depo', () => {
  it('uygulama yeniden başlayınca kuyruk geri yüklenir', async () => {
    const storage = new MemoryQueueStorage();
    const q1 = makeQueue(storage);
    await q1.enqueue({ ...baseInput, operationType: 'COMPANY_CREATE', dedupKey: 'c', idempotencyKey: 'k' });

    const q2 = makeQueue(storage);
    await q2.load();
    expect((await q2.all())).toHaveLength(1);
  });

  it('SYNCING kalan işlem KÖR ŞEKİLDE başarılı sayılmaz', async () => {
    const storage = new MemoryQueueStorage();
    const q1 = makeQueue(storage);
    const item = await q1.enqueue({ ...baseInput, operationType: 'MEMBER_ADD', dedupKey: 'm', idempotencyKey: 'k' });
    await q1.markSyncing(item!.id);

    const q2 = makeQueue(storage);
    await q2.load();
    const restored = (await q2.all())[0];
    expect(restored.status).toBe('RETRYABLE_FAILED');
    expect(restored.status).not.toBe('SYNCED');
    expect(restored.failureCode).toBe('interrupted_in_flight');
    // İdempotency anahtarı korunur → sunucudan gerçek sonuç sorulabilir.
    expect(restored.idempotencyKey).toBe('k');
  });

  it('bozuk JSON fail-soft açılır — uygulama çökmez, kayıt karantinaya alınır', async () => {
    const storage = new MemoryQueueStorage();
    await storage.write('{bozuk-json');
    const q = makeQueue(storage);
    await q.load();
    expect((await q.all())).toHaveLength(0);
    expect(q.getCorruptCount()).toBe(1);
  });

  it('geçersiz kayıtlar atılır, geçerliler korunur', async () => {
    const storage = new MemoryQueueStorage();
    await storage.write(JSON.stringify({
      version: 1,
      items: [
        { id: 'bad', operationType: 'UYDURMA_TIP' },
        {
          id: 'good', operationType: 'COMPANY_CREATE', actorId: 'u', companyId: null,
          vehicleId: null, payload: {}, createdAt: 1, clientRevision: 0, dedupKey: 'd',
          idempotencyKey: 'i', dependsOn: [], attemptCount: 0, maxAttempts: 3,
          nextAttemptAt: 0, expiresAt: 9_999_999_999_999, status: 'PENDING', failureCode: null,
        },
      ],
    }));
    const q = makeQueue(storage);
    await q.load();
    const all = await q.all();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe('good');
    expect(q.getCorruptCount()).toBe(1);
  });

  it('clear() kuyruğu tamamen siler (çıkış / hesap değişimi)', async () => {
    const storage = new MemoryQueueStorage();
    const q = makeQueue(storage);
    await q.enqueue({ ...baseInput, operationType: 'COMPANY_CREATE', dedupKey: 'c', idempotencyKey: 'k' });
    await q.clear();
    expect((await q.all())).toHaveLength(0);
    expect(await storage.read()).toBeNull();
  });
});

/* ── Sync orchestrator ────────────────────────────────────────────────── */

class FakeTransport implements SyncTransport {
  public sent: QueueItem[] = [];
  constructor(private readonly results: Map<string, TransportResult>) {}
  async send(item: QueueItem): Promise<TransportResult> {
    this.sent.push(item);
    return this.results.get(item.operationType) ?? { ok: true };
  }
}

const READY: ProfileReadinessCheck = { isReady: async () => true };
const NOT_READY: ProfileReadinessCheck = { isReady: async () => false };

describe('sync orchestrator', () => {
  it('profil hazır değilse HİÇBİR işlem gönderilmez', async () => {
    const q = makeQueue();
    await q.enqueue({ ...baseInput, operationType: 'COMPANY_CREATE', dedupKey: 'c', idempotencyKey: 'k' });
    const transport = new FakeTransport(new Map());
    const result = await new SyncOrchestrator(q, transport, NOT_READY).runOnce();
    expect(result.skippedNotReady).toBe(true);
    expect(transport.sent).toHaveLength(0);
  });

  it('başarılı gönderim SYNCED yapar', async () => {
    const q = makeQueue();
    await q.enqueue({ ...baseInput, operationType: 'COMPANY_CREATE', dedupKey: 'c', idempotencyKey: 'k' });
    const result = await new SyncOrchestrator(q, new FakeTransport(new Map()), READY).runOnce();
    expect(result.synced).toBe(1);
    expect((await q.all())[0].status).toBe('SYNCED');
  });

  it('sahiplik hatası CONFLICT üretir — otomatik retry YAPILMAZ', async () => {
    const q = makeQueue();
    await q.enqueue({
      ...baseInput, operationType: 'VEHICLE_PAIR', vehicleId: 'v1',
      dedupKey: 'p', idempotencyKey: 'k',
    });
    const transport = new FakeTransport(new Map([
      ['VEHICLE_PAIR', { ok: false, retryable: false, errorCode: 'vehicle_owned_by_another_user' } as TransportResult],
    ]));
    const result = await new SyncOrchestrator(q, transport, READY).runOnce();
    expect(result.conflicts).toBe(1);
    const item = (await q.all())[0];
    expect(item.status).toBe('CONFLICT');
    expect(item.failureCode).toBe('VEHICLE_ALREADY_OWNED');
    // CONFLICT öğe tekrar gönderilmeye ALINMAZ.
    expect((await q.ready())).toHaveLength(0);
  });

  it('ağ hatası retryable sayılır, kalıcı hata PERMANENT_FAILED olur', async () => {
    const q = makeQueue();
    await q.enqueue({ ...baseInput, operationType: 'COMPANY_UPDATE', dedupKey: 'a', idempotencyKey: '1' });
    const transport = new FakeTransport(new Map([
      ['COMPANY_UPDATE', { ok: false, retryable: true, errorCode: 'network_error' } as TransportResult],
    ]));
    await new SyncOrchestrator(q, transport, READY).runOnce();
    expect((await q.all())[0].status).toBe('RETRYABLE_FAILED');

    const q2 = makeQueue();
    await q2.enqueue({ ...baseInput, operationType: 'COMPANY_UPDATE', dedupKey: 'b', idempotencyKey: '2' });
    const t2 = new FakeTransport(new Map([
      ['COMPANY_UPDATE', { ok: false, retryable: false, errorCode: 'invalid_company_name' } as TransportResult],
    ]));
    await new SyncOrchestrator(q2, t2, READY).runOnce();
    expect((await q2.all())[0].status).toBe('PERMANENT_FAILED');
  });

  it('aynı entity için tek turda tek işlem gönderilir (serileştirme)', async () => {
    const q = makeQueue();
    await q.enqueue({ ...baseInput, operationType: 'VEHICLE_ASSIGN_COMPANY', vehicleId: 'v1', dedupKey: 'a1', idempotencyKey: '1' });
    await q.enqueue({ ...baseInput, operationType: 'VEHICLE_REMOVE_COMPANY', vehicleId: 'v1', dedupKey: 'r1', idempotencyKey: '2' });
    await q.enqueue({ ...baseInput, operationType: 'VEHICLE_ASSIGN_COMPANY', vehicleId: 'v2', dedupKey: 'a2', idempotencyKey: '3' });

    const transport = new FakeTransport(new Map());
    await new SyncOrchestrator(q, transport, READY).runOnce();
    // v1'den 1, v2'den 1 → toplam 2 (v1'in ikinci işlemi sonraki tura kalır)
    expect(transport.sent).toHaveLength(2);
    expect(new Set(transport.sent.map((i) => i.vehicleId))).toEqual(new Set(['v1', 'v2']));
  });

  it('drain sonsuz döngüye girmez', async () => {
    const q = makeQueue();
    await q.enqueue({ ...baseInput, operationType: 'COMPANY_CREATE', dedupKey: 'c', idempotencyKey: 'k' });
    const transport = new FakeTransport(new Map([
      ['COMPANY_CREATE', { ok: false, retryable: true, errorCode: 'network_error' } as TransportResult],
    ]));
    const result = await new SyncOrchestrator(q, transport, READY).drain(5);
    expect(result.attempted).toBeLessThanOrEqual(5);
  });
});

/* ── Ownership snapshot ───────────────────────────────────────────────── */

describe('ownership snapshot · fail-closed', () => {
  const snap = buildSnapshot({
    userId: 'user-1', companyId: 'co-1', companyRole: 'observer',
    ownedVehicleIds: ['v1'], accessibleVehicleIds: ['v1', 'v2'],
    serverRevision: 7, verifiedAt: 1_000_000,
  });

  it('snapshot yoksa hiçbir yetki verilmez', () => {
    expect(canOffline(null, 'user-1', 'vehicle.read', 1_000_000)).toBe(false);
  });

  it('başka kullanıcının snapshot"ı kullanılamaz (hesap izolasyonu)', () => {
    expect(canOffline(snap, 'baska-user', 'vehicle.read', 1_000_000)).toBe(false);
  });

  it('observer çevrimdışıyken admin işlemi YAPAMAZ', () => {
    expect(canOffline(snap, 'user-1', 'member.remove', 1_000_000)).toBe(false);
    expect(canOffline(snap, 'user-1', 'vehicle.assign', 1_000_000)).toBe(false);
    expect(canOffline(snap, 'user-1', 'vehicle.read', 1_000_000)).toBe(true);
  });

  it('süresi geçmiş snapshot KRİTİK yazma işlemine izin vermez', () => {
    const admin = buildSnapshot({
      userId: 'u', companyId: 'c', companyRole: 'admin',
      ownedVehicleIds: [], accessibleVehicleIds: [],
      serverRevision: 1, verifiedAt: 0, ttlMs: 1000,
    });
    expect(canOffline(admin, 'u', 'member.remove', 500)).toBe(true);
    expect(canOffline(admin, 'u', 'member.remove', 2000)).toBe(false);
    // Okuma bayat snapshot"la sürebilir
    expect(canOffline(admin, 'u', 'vehicle.read', 2000)).toBe(true);
  });

  it('bilinmeyen rol fail-closed individual olur', () => {
    const weird = buildSnapshot({
      userId: 'u', companyId: 'c', companyRole: 'kral',
      ownedVehicleIds: [], accessibleVehicleIds: [],
      serverRevision: 1, verifiedAt: 0,
    });
    expect(weird.companyRole).toBe('individual');
    expect(weird.permissions).not.toContain('member.remove');
  });

  it('kapsam dışı araca çevrimdışı erişilemez', () => {
    expect(canAccessVehicleOffline(snap, 'user-1', 'v2')).toBe(true);
    expect(canAccessVehicleOffline(snap, 'user-1', 'baska-arac')).toBe(false);
    expect(canAccessVehicleOffline(snap, 'baska-user', 'v1')).toBe(false);
  });

  it('kritik yetki listesi yazma işlemlerini kapsar', () => {
    expect(isCriticalCapability('member.remove')).toBe(true);
    expect(isCriticalCapability('vehicle.command')).toBe(true);
    expect(isCriticalCapability('vehicle.read')).toBe(false);
  });

  it('expiry hesabı doğrudur', () => {
    expect(isExpired(snap, snap.expiresAt - 1)).toBe(false);
    expect(isExpired(snap, snap.expiresAt)).toBe(true);
  });
});

/* ── Offline pairing ──────────────────────────────────────────────────── */

describe('çevrimdışı eşleştirme · dürüstlük', () => {
  const pairing: PendingPairing = {
    id: 'p1', userId: 'u1', code: '123456',
    requestedAt: 1_000_000, codeExpiresAt: 1_060_000,
    idempotencyKey: 'pair-1', status: 'PENDING_SERVER_VERIFICATION',
    conflictCode: null, attemptCount: 0,
  };

  it('durum PENDING_SERVER_VERIFICATION"dır — "eşleşti" DENMEZ', () => {
    expect(pairing.status).toBe('PENDING_SERVER_VERIFICATION');
    expect(statusLabel(pairing.status)).toBe('Sunucu doğrulaması bekleniyor');
    expect(statusLabel(pairing.status)).not.toContain('eşleşti');
  });

  it('TTL içindeyken gönderilebilir', () => {
    expect(isSendable(pairing, 1_030_000)).toBe(true);
  });

  it('TTL geçmiş claim ASLA gönderilmez', () => {
    expect(isSendable(pairing, 1_060_000)).toBe(false);
    expect(isSendable(pairing, 1_100_000)).toBe(false);
  });

  it('süresi geçen claim EXPIRED olur — sessizce silinmez', () => {
    const out = expireOverdue([pairing], 1_100_000);
    expect(out[0].status).toBe('EXPIRED');
  });

  it('doğrulanmamış claim gönderilebilir sayılmaz', () => {
    expect(isSendable({ ...pairing, status: 'REJECTED' }, 1_000_001)).toBe(false);
    expect(isSendable({ ...pairing, status: 'VERIFIED' }, 1_000_001)).toBe(false);
    expect(isSendable({ ...pairing, status: 'EXPIRED' }, 1_000_001)).toBe(false);
  });
});
