/**
 * fleetOfflineHardening.test.ts — ÇEVRİMDIŞI FİLO SERTLEŞTİRME KİLİTLERİ.
 *
 * Bu dosya, sessizce geri gelirse ÜRÜNÜ YALAN SÖYLETEN dört davranışı kilitler:
 *
 *   1. Güvenlik/sahiplik işlemleri çevrimdışı "kaydedildi" gösterilemez.
 *   2. Bilinmeyen şema sürümü yorumlanamaz (fail-closed).
 *   3. Başka hesabın kaydı bu oturumun kuyruğuna giremez.
 *   4. Hesap değişiminden sonra gelen bayat senkron yanıtı kuyruğa yazamaz.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DomainQueue } from '@/lib/offline/domainQueue';
import { MemoryQueueStorage } from '@/lib/offline/storage';
import { SyncOrchestrator, type SyncTransport, type TransportResult } from '@/lib/offline/syncOrchestrator';
import {
  QUEUE_ITEM_SCHEMA_VERSION, QUEUE_ENVELOPE_VERSION,
  type QueueItem, type EnqueueInput, OPERATION_TYPES,
} from '@/lib/offline/types';
import {
  classifyOffline, isQueueableOffline, offlineMessageFor,
  operationsByClass, OFFLINE_CLASSES, type OfflineClass,
} from '@/lib/offline/offlineClassification';
import {
  enqueueOfflineMutation, getQueue, resetOfflineState, activeQueueAccountId,
} from '@/lib/offline/fleetOffline';

/* ── Yardımcılar ───────────────────────────────────────────────────────── */

let clock = 1_000_000;
const now = () => clock;

function input(over: Partial<EnqueueInput> = {}): EnqueueInput {
  return {
    operationType:  over.operationType ?? 'COMPANY_CREATE',
    actorId:        over.actorId ?? 'u1',
    companyId:      over.companyId ?? null,
    vehicleId:      over.vehicleId ?? null,
    payload:        over.payload ?? {},
    dedupKey:       over.dedupKey ?? 'd1',
    idempotencyKey: over.idempotencyKey ?? 'k1',
    dependsOn:      over.dependsOn,
  };
}

function storedItem(over: Partial<QueueItem> = {}): QueueItem {
  return {
    schemaVersion:  QUEUE_ITEM_SCHEMA_VERSION,
    id:             'q1',
    operationType:  'COMPANY_CREATE',
    actorId:        'u1',
    companyId:      null,
    vehicleId:      null,
    payload:        {},
    createdAt:      clock,
    clientRevision: 0,
    dedupKey:       'd1',
    idempotencyKey: 'k1',
    dependsOn:      [],
    attemptCount:   0,
    maxAttempts:    6,
    nextAttemptAt:  0,
    expiresAt:      clock + 100_000,
    status:         'PENDING',
    failureCode:    null,
    ...over,
  };
}

async function seededQueue(
  raw: string,
  options: { accountId?: string } = {},
): Promise<DomainQueue> {
  const storage = new MemoryQueueStorage();
  await storage.write(raw);
  const queue = new DomainQueue({ storage, now, accountId: options.accountId });
  await queue.load();
  return queue;
}

beforeEach(() => { clock = 1_000_000; });

/* ── 1. ÇEVRİMDIŞI SINIFLANDIRMA ───────────────────────────────────────── */

describe('çevrimdışı sınıflandırma · güvenlik işlemleri kuyruğa alınamaz', () => {
  it('rol değişikliği ve üye çıkarma İNTERNET GEREKTİRİR', () => {
    expect(classifyOffline('MEMBER_ROLE_UPDATE')).toBe('ONLINE_REQUIRED');
    expect(classifyOffline('MEMBER_REMOVE')).toBe('ONLINE_REQUIRED');
    expect(isQueueableOffline('MEMBER_ROLE_UPDATE')).toBe(false);
  });

  it('eşleştirme ve sahiplik devri İNTERNET GEREKTİRİR', () => {
    for (const op of ['VEHICLE_PAIR', 'OWNERSHIP_CLAIM', 'VEHICLE_ASSIGN_COMPANY', 'VEHICLE_REMOVE_COMPANY']) {
      expect(classifyOffline(op)).toBe('ONLINE_REQUIRED');
    }
  });

  it('şirket kurma/güncelleme sıraya alınır ama TAMAMLANMIŞ sayılmaz', () => {
    expect(classifyOffline('COMPANY_CREATE')).toBe('OFFLINE_DEFERRED');
    expect(classifyOffline('COMPANY_UPDATE')).toBe('OFFLINE_DEFERRED');
    expect(offlineMessageFor('COMPANY_UPDATE')).toContain('tamamlanmış sayılmaz');
  });

  it('telemetri çevrimdışı serbesttir', () => {
    expect(classifyOffline('LOCATION_EVENT')).toBe('OFFLINE_ALLOWED');
    expect(classifyOffline('VEHICLE_EVENT')).toBe('OFFLINE_ALLOWED');
  });

  it('bilinmeyen işlem türü fail-closed ONLINE_REQUIRED olur', () => {
    expect(classifyOffline('WHATEVER_NEW_OP')).toBe('ONLINE_REQUIRED');
    expect(classifyOffline(undefined)).toBe('ONLINE_REQUIRED');
    expect(classifyOffline(42)).toBe('ONLINE_REQUIRED');
  });

  it('HER işlem türü sınıflandırılmıştır — kapsam dışı tür kalmaz', () => {
    const byClass = operationsByClass();
    const covered = (OFFLINE_CLASSES as readonly OfflineClass[]).flatMap((k) => byClass[k]);
    expect(new Set(covered)).toEqual(new Set(OPERATION_TYPES));
  });

  it('ONLINE_REQUIRED mesajı çevrimdışı "kaydedildi" DEMEZ', () => {
    const message = offlineMessageFor('VEHICLE_PAIR');
    expect(message).toContain('internet bağlantısı gerekli');
    expect(message.toLowerCase()).not.toContain('kaydedildi');
  });
});

/* ── 2. ŞEMA SÜRÜMÜ FAIL-CLOSED ────────────────────────────────────────── */

describe('kuyruk · şema sürümü fail-closed', () => {
  it('bilinmeyen ZARF sürümü yorumlanmaz — kuyruk boş açılır', async () => {
    const raw = JSON.stringify({ version: 99, items: [storedItem(), storedItem({ id: 'q2' })] });
    const queue = await seededQueue(raw);
    expect(await queue.all()).toHaveLength(0);
    expect(queue.getSchemaRejectedCount()).toBe(2);
  });

  it('sürümsüz zarf (eski/bozuk) yorumlanmaz', async () => {
    const raw = JSON.stringify({ items: [storedItem()] });
    const queue = await seededQueue(raw);
    expect(await queue.all()).toHaveLength(0);
    expect(queue.getSchemaRejectedCount()).toBeGreaterThan(0);
  });

  it('desteklenenden YENİ öğe şeması reddedilir, eskiler korunur', async () => {
    const raw = JSON.stringify({
      version: QUEUE_ENVELOPE_VERSION,
      items: [
        storedItem({ id: 'ok' }),
        storedItem({ id: 'future', schemaVersion: QUEUE_ITEM_SCHEMA_VERSION + 1 }),
      ],
    });
    const queue = await seededQueue(raw);
    const items = await queue.all();
    expect(items.map((i) => i.id)).toEqual(['ok']);
    expect(queue.getSchemaRejectedCount()).toBe(1);
  });

  it('şema alanı OLMAYAN eski kayıt geriye dönük kabul edilir', async () => {
    const legacy = storedItem({ id: 'legacy' }) as Partial<QueueItem>;
    delete legacy.schemaVersion;
    const raw = JSON.stringify({ version: QUEUE_ENVELOPE_VERSION, items: [legacy] });
    const queue = await seededQueue(raw);
    expect((await queue.all()).map((i) => i.id)).toEqual(['legacy']);
    expect(queue.getSchemaRejectedCount()).toBe(0);
  });

  it('yeni eklenen öğe güncel şema sürümünü taşır', async () => {
    const queue = new DomainQueue({ storage: new MemoryQueueStorage(), now });
    const item = await queue.enqueue(input());
    expect(item?.schemaVersion).toBe(QUEUE_ITEM_SCHEMA_VERSION);
  });
});

/* ── 3. HESAP İZOLASYONU ───────────────────────────────────────────────── */

describe('kuyruk · hesap izolasyonu (cross-account sızıntı kapısı)', () => {
  it('başka hesabın kaydı YÜKLENMEZ', async () => {
    const raw = JSON.stringify({
      version: QUEUE_ENVELOPE_VERSION,
      items: [
        storedItem({ id: 'mine',    actorId: 'u1' }),
        storedItem({ id: 'theirs',  actorId: 'u2' }),
      ],
    });
    const queue = await seededQueue(raw, { accountId: 'u1' });
    expect((await queue.all()).map((i) => i.id)).toEqual(['mine']);
    expect(queue.getForeignAccountCount()).toBe(1);
  });

  it('başka hesap adına EKLEME reddedilir', async () => {
    const queue = new DomainQueue({ storage: new MemoryQueueStorage(), now, accountId: 'u1' });
    expect(await queue.enqueue(input({ actorId: 'u2' }))).toBeNull();
    expect(await queue.all()).toHaveLength(0);
  });

  it('hesap bağlanmamışsa (test/telemetri) kapı uygulanmaz', async () => {
    const queue = new DomainQueue({ storage: new MemoryQueueStorage(), now });
    expect(await queue.enqueue(input({ actorId: 'u2' }))).not.toBeNull();
    expect(queue.getAccountId()).toBeNull();
  });

  it('clear() sayaçları da sıfırlar', async () => {
    const raw = JSON.stringify({
      version: QUEUE_ENVELOPE_VERSION,
      items: [storedItem({ id: 'theirs', actorId: 'u2' })],
    });
    const queue = await seededQueue(raw, { accountId: 'u1' });
    expect(queue.getForeignAccountCount()).toBe(1);
    await queue.clear();
    expect(queue.getForeignAccountCount()).toBe(0);
    expect(queue.getSchemaRejectedCount()).toBe(0);
  });
});

/* ── 3b. TEK KAPI + ÇIKIŞ TEMİZLİĞİ DOĞRULAMASI ────────────────────────── */

describe('tek kapı · enqueueOfflineMutation', () => {
  beforeEach(async () => {
    window.localStorage.clear();
    await resetOfflineState();
  });

  it('ONLINE_REQUIRED işlem kuyruğa ALINMAZ', async () => {
    const outcome = await enqueueOfflineMutation('u1', input({
      operationType: 'MEMBER_ROLE_UPDATE', actorId: 'u1',
    }));
    expect(outcome.ok).toBe(false);
    expect(outcome.errorCode).toBe('requires_online');
    expect(outcome.item).toBeNull();
    expect(await getQueue('u1').all()).toHaveLength(0);
  });

  it('OFFLINE_DEFERRED işlem kuyruğa alınır ama mesajı TAMAMLANDI DEMEZ', async () => {
    const outcome = await enqueueOfflineMutation('u1', input({
      operationType: 'COMPANY_UPDATE', actorId: 'u1',
    }));
    expect(outcome.ok).toBe(true);
    expect(outcome.klass).toBe('OFFLINE_DEFERRED');
    expect(outcome.message).toContain('tamamlanmış sayılmaz');
    expect(await getQueue('u1').all()).toHaveLength(1);
  });

  it('başka hesabın kimliğiyle yazma reddedilir', async () => {
    getQueue('u1'); // kuyruk u1'e bağlanır
    const outcome = await enqueueOfflineMutation('u1', input({
      operationType: 'COMPANY_UPDATE', actorId: 'u2',
    }));
    expect(outcome.ok).toBe(false);
    // Hesap uyuşmazlığı — "kuyruk dolu" ile KARIŞTIRILMAZ.
    expect(outcome.errorCode).toBe('permission_denied');
    expect(await getQueue('u1').all()).toHaveLength(0);
  });

  it('hesap değişiminde önceki kuyruk okunmaz', async () => {
    await enqueueOfflineMutation('u1', input({ operationType: 'COMPANY_UPDATE', actorId: 'u1' }));
    expect(await getQueue('u1').all()).toHaveLength(1);

    // Hesap değişti — yeni hesabın kuyruğu BOŞ olmalı.
    expect(await getQueue('u2').all()).toHaveLength(0);
  });

  it('çıkış temizliği DOĞRULANIR — kalıntı kalırsa ok:false döner', async () => {
    await enqueueOfflineMutation('u1', input({ operationType: 'COMPANY_UPDATE', actorId: 'u1' }));
    window.localStorage.setItem('caros.fleet.snapshot.u1', '{}');

    const result = await resetOfflineState();
    expect(result.verifiable).toBe(true);
    expect(result.residualKeys).toBe(0);
    expect(result.ok).toBe(true);

    // Depoda hiçbir filo anahtarı kalmadı.
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k) keys.push(k);
    }
    expect(keys.filter((k) => k.startsWith('caros.fleet.'))).toEqual([]);
  });

  it('temizlik sonrası hesap bağı bırakılır', async () => {
    getQueue('u1');
    expect(activeQueueAccountId()).toBe('u1');
    await resetOfflineState();
    expect(activeQueueAccountId()).toBeNull();
  });
});

/* ── 4. TEK SENKRON OTORİTESİ + KUŞAK KAPISI ───────────────────────────── */

const READY = { isReady: async () => true };

/** Gönderimi elle serbest bırakılabilen taşıyıcı (yarış kurgulamak için). */
class ManualTransport implements SyncTransport {
  sent: QueueItem[] = [];
  private pending: Array<() => void> = [];
  private arrived: Array<() => void> = [];

  async send(item: QueueItem): Promise<TransportResult> {
    this.sent.push(item);
    this.arrived.splice(0).forEach((notify) => notify());
    await new Promise<void>((resolve) => this.pending.push(resolve));
    return { ok: true };
  }

  /** En az bir gönderim taşıyıcıya ULAŞANA kadar bekler (yarış kurgusu). */
  async waitForSend(): Promise<void> {
    if (this.sent.length > 0) return;
    await new Promise<void>((resolve) => this.arrived.push(resolve));
  }

  flush(): void {
    const waiters = this.pending;
    this.pending = [];
    waiters.forEach((w) => w());
  }
}

describe('senkron · tek otorite ve kuşak kapısı', () => {
  it('ikinci eşzamanlı tur BAŞLATILMAZ (çift gönderim yok)', async () => {
    const queue = new DomainQueue({ storage: new MemoryQueueStorage(), now });
    await queue.enqueue(input({ operationType: 'LOCATION_EVENT', vehicleId: 'v1' }));

    const transport = new ManualTransport();
    const sync = new SyncOrchestrator(queue, transport, READY);

    const first = sync.runOnce();
    await transport.waitForSend();      // ilk tur gerçekten uçuşta

    const second = await sync.runOnce();
    expect(second.skippedAlreadyRunning).toBe(true);
    expect(second.attempted).toBe(0);

    transport.flush();
    const firstResult = await first;
    expect(firstResult.synced).toBe(1);
    expect(transport.sent).toHaveLength(1);
  });

  it('abort() sonrası gelen yanıt kuyruğa YAZILMAZ (bayat sonuç reddi)', async () => {
    const queue = new DomainQueue({ storage: new MemoryQueueStorage(), now });
    const item  = await queue.enqueue(input({ operationType: 'LOCATION_EVENT', vehicleId: 'v1' }));

    const transport = new ManualTransport();
    const sync = new SyncOrchestrator(queue, transport, READY);

    const run = sync.runOnce();
    await transport.waitForSend();      // istek uçuşta
    // Kullanıcı çıkış yaptı / hesap değişti.
    sync.abort();
    transport.flush();
    const result = await run;

    expect(result.staleRejected).toBeGreaterThan(0);
    expect(result.synced).toBe(0);
    expect(sync.getStaleRejectCount()).toBeGreaterThan(0);

    // Öğe SYNCED YAPILMADI — gerçek sonucu bilinmiyor, tekrar sorulabilir.
    const stored = (await queue.all()).find((i) => i.id === item?.id);
    expect(stored?.status).not.toBe('SYNCED');
  });

  it('abort() kuşağı artırır ve kilidi serbest bırakır', async () => {
    const queue = new DomainQueue({ storage: new MemoryQueueStorage(), now });
    const sync  = new SyncOrchestrator(queue, new ManualTransport(), READY);

    expect(sync.getGeneration()).toBe(0);
    sync.abort();
    expect(sync.getGeneration()).toBe(1);
    expect(sync.isRunning()).toBe(false);
  });

  it('drain kuşak değişince DERHAL durur', async () => {
    const queue = new DomainQueue({ storage: new MemoryQueueStorage(), now });
    await queue.enqueue(input({ operationType: 'LOCATION_EVENT', vehicleId: 'v1' }));

    const transport = new ManualTransport();
    const sync = new SyncOrchestrator(queue, transport, READY);

    const drained = sync.drain(5);
    sync.abort();
    transport.flush();
    const result = await drained;

    expect(result.synced).toBe(0);
    expect(result.staleRejected).toBeGreaterThan(0);
  });

  it('normal akışta kilit serbest kalır — ikinci tur çalışabilir', async () => {
    const queue = new DomainQueue({ storage: new MemoryQueueStorage(), now });
    await queue.enqueue(input({ operationType: 'LOCATION_EVENT', vehicleId: 'v1', dedupKey: 'a' }));

    const transport: SyncTransport = { async send() { return { ok: true }; } };
    const sync = new SyncOrchestrator(queue, transport, READY);

    const first = await sync.runOnce();
    expect(first.synced).toBe(1);
    expect(sync.isRunning()).toBe(false);

    await queue.enqueue(input({ operationType: 'LOCATION_EVENT', vehicleId: 'v2', dedupKey: 'b' }));
    const second = await sync.runOnce();
    expect(second.skippedAlreadyRunning).toBe(false);
    expect(second.synced).toBe(1);
  });
});
