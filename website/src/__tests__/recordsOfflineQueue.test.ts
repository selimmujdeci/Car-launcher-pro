/**
 * recordsOfflineQueue.test.ts — BAKIM KAYITLARI ÇEVRİMDIŞI KUYRUĞU kilitleri.
 *
 * Kapatılan borç (devir belgesi B2): "Ağ yokken kayıt yalnız yerelde kalır ve
 * **otomatik senkron edilmez**." Kuyruk altyapısı hazırdı ama kayıtlar ona
 * HİÇ bağlı değildi.
 *
 * Kilitlenen davranışlar:
 *   1. Kayıtlar `OFFLINE_DEFERRED`dir — ne yasak (ONLINE_REQUIRED) ne de
 *      "kaydedildi" denebilir (OFFLINE_ALLOWED).
 *   2. GEÇİCİ hata kuyruğa alınır; KALICI hata ALINMAZ (tutulamayacak söz).
 *   3. `23505` çift gönderim BAŞARIDIR — kayıt zaten sunucuda.
 *   4. Kuyruktaki kayıt listeden KAYBOLMAZ ve sunucudaki kopyasıyla ÇİFT
 *      GÖSTERİLMEZ.
 *   5. Bozuk kuyruk gövdesi KALICI hatadır — yarım satır yazılmaz.
 *   6. Kuyruğu PWA tarafında GERÇEKTEN süren bir tüketici vardır (#574'ün
 *      "mekanizma kodda var ≠ çalışıyor" sınıfı tekrar etmesin).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const h = vi.hoisted(() => ({
  sessionUserId: 'user-1' as string | null,
  insertError:   null as { code?: string; message?: string } | null,
  insertThrows:  null as Error | null,
  selectRows:    [] as Array<Record<string, unknown>>,
  inserts:       [] as Array<{ table: string; row: Record<string, unknown> }>,
  deleteError:   null as { code?: string; message?: string } | null,
  deletes:       [] as Array<{ table: string; filters: Record<string, unknown> }>,
}));

vi.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabaseBrowser: {
    auth: {
      getSession: async () => ({
        data: { session: h.sessionUserId ? { user: { id: h.sessionUserId } } : null },
      }),
    },
    from: (table: string) => ({
      insert: async (row: Record<string, unknown>) => {
        h.inserts.push({ table, row });
        if (h.insertThrows) throw h.insertThrows;
        return { error: h.insertError };
      },
      select: () => ({
        eq: () => ({
          order: () => ({
            limit: async () => ({ data: h.selectRows, error: null }),
          }),
        }),
      }),
      delete: () => {
        const filters: Record<string, unknown> = {};
        /* #671'de GÜNCELLENDİ: silme artık `.select('id')` ile ETKİLENEN SATIR
           kanıtı istiyor (PostgREST 200 ≠ satır etkilendi). Mock bu yüzden
           `data` da döndürür; hata yoksa bir satır silinmiş sayılır. Kilidin
           koruduğu kural (DELETE gider + yerel kopya temizlenir) DEĞİŞMEDİ. */
        const settle = (resolve: (v: { data: unknown; error: unknown }) => void) => {
          h.deletes.push({ table, filters: { ...filters } });
          resolve({ data: h.deleteError ? null : [{ id: filters.id }], error: h.deleteError });
        };
        const chain = {
          eq: (col: string, val: unknown) => {
            filters[col] = val;
            // İkinci `.eq` await edilebilir → thenable olmalı.
            return Object.assign(chain, { then: settle });
          },
          select: () => Object.assign(chain, { then: settle }),
        };
        return chain;
      },
    }),
  },
}));

import {
  addFuelEntry, loadFuelEntries, addServiceEntry, loadServiceEntries,
  deleteFuelEntry, deleteServiceEntry,
} from '@/lib/recordsService';
import { classifyOffline, offlineMessageFor } from '@/lib/offline/offlineClassification';
import { getQueue, cleanupOfflineQueueAuthority, HttpSyncTransport } from '@/lib/offline/fleetOffline';
import {
  RecordsSyncTransport,
  CompositeSyncTransport,
  isRecordOperation,
} from '@/lib/offline/recordsSyncTransport';
import { entityKeyOf } from '@/lib/offline/syncOrchestrator';
import type { QueueItem } from '@/lib/offline/types';

const V = 'vehicle-1';
const U = 'user-1';

const NETWORK_FAIL = { code: undefined, message: 'TypeError: Failed to fetch' };

beforeEach(async () => {
  await cleanupOfflineQueueAuthority();
  window.localStorage.clear();
  h.sessionUserId = U;
  h.insertError   = null;
  h.insertThrows  = null;
  h.selectRows    = [];
  h.inserts       = [];
  h.deleteError   = null;
  h.deletes       = [];
});

function fuel(): Parameters<typeof addFuelEntry>[1] {
  return { filledOn: '2026-08-14', odometerKm: 120_000, liters: 42.5, pricePerL: 45 };
}

/* ── 1. Sınıflandırma ─────────────────────────────────────────────────────── */

describe('çevrimdışı sınıfı', () => {
  it('KİLİT: bakım kayıtları OFFLINE_DEFERRED — ne yasak ne de "kaydedildi"', () => {
    expect(classifyOffline('FUEL_LOG_ADD')).toBe('OFFLINE_DEFERRED');
    expect(classifyOffline('SERVICE_RECORD_ADD')).toBe('OFFLINE_DEFERRED');
  });

  it('KİLİT: kuyruk mesajı TAMAMLANDI demez', () => {
    const msg = offlineMessageFor('FUEL_LOG_ADD');
    expect(msg).toContain('sıraya alındı');
    // "kaydedildi" YALNIZ OFFLINE_ALLOWED'da geçer; burada geçemez.
    expect(msg).not.toMatch(/kaydedildi/i);
  });
});

/* ── 2. Geçici hata → kuyruk ─────────────────────────────────────────────── */

describe('geçici hata kuyruğa alınır', () => {
  it('KİLİT: ağ hatası → mode QUEUED ve kuyrukta GERÇEKTEN bir öğe var', async () => {
    h.insertError = NETWORK_FAIL;

    const res = await addFuelEntry(V, fuel());
    expect(res.mode).toBe('QUEUED');
    expect(res.saved).toBe(true);

    const items = await getQueue(U).all();
    const queued = items.filter((i) => i.operationType === 'FUEL_LOG_ADD');
    expect(queued).toHaveLength(1);
    expect(queued[0].status).toBe('PENDING');
    expect(queued[0].vehicleId).toBe(V);
    // Gövde sunucuya yazılabilir olmalı — idempotency anahtarı taşınır.
    expect(typeof queued[0].payload.clientRef).toBe('string');
    expect(queued[0].idempotencyKey).toBe(queued[0].payload.clientRef);
  });

  it('KİLİT: servis kaydı da kuyruğa alınır', async () => {
    h.insertError = NETWORK_FAIL;
    const res = await addServiceEntry(V, {
      serviceKey: 'oil', performedOn: '2026-08-14', odometerKm: 120_000,
    });
    expect(res.mode).toBe('QUEUED');

    const items = await getQueue(U).all();
    expect(items.filter((i) => i.operationType === 'SERVICE_RECORD_ADD')).toHaveLength(1);
  });

  it('KİLİT: taşıyıcı istisnası da GEÇİCİ sayılır (çevrimdışı fetch throw eder)', async () => {
    h.insertThrows = new Error('Failed to fetch');
    const res = await addFuelEntry(V, fuel());
    expect(res.mode).toBe('QUEUED');
  });
});

/* ── 3. Kalıcı hata kuyruğa ALINMAZ ──────────────────────────────────────── */

describe('kalıcı hata kuyruğa ALINMAZ', () => {
  it('KİLİT: RLS reddi kuyruğa girmez — "bağlantı gelince gidecek" YALAN olurdu', async () => {
    h.insertError = { code: '42501', message: 'new row violates row-level security policy' };

    const res = await addFuelEntry(V, fuel());
    expect(res.mode).toBe('SERVER_ERROR');
    expect(res.error).toMatch(/yetkiniz yok/i);

    const items = await getQueue(U).all();
    expect(items.filter((i) => i.operationType === 'FUEL_LOG_ADD')).toHaveLength(0);
  });

  it('KİLİT: araç bulunamadı (FK) kuyruğa girmez', async () => {
    h.insertError = { code: '23503', message: 'foreign key violation' };
    const res = await addFuelEntry(V, fuel());
    expect(res.mode).toBe('SERVER_ERROR');
    expect((await getQueue(U).all()).length).toBe(0);
  });

  it('KİLİT: oturum yoksa kuyruğa ALINMAZ (kuyruk hesap kapsamlıdır)', async () => {
    h.sessionUserId = null;
    const res = await addFuelEntry(V, fuel());
    expect(res.mode).toBe('LOCAL_ONLY');
    expect((await getQueue(U).all()).length).toBe(0);
    // Sunucuya hiç yazma DENENMEZ.
    expect(h.inserts).toHaveLength(0);
  });
});

/* ── 4. Çift gönderim = BAŞARI ───────────────────────────────────────────── */

describe('idempotency', () => {
  it('KİLİT: 23505 (zaten yazılmış) HATA DEĞİL — kayıt sunucudadır', async () => {
    h.insertError = { code: '23505', message: 'duplicate key value' };
    const res = await addFuelEntry(V, fuel());
    expect(res.mode).toBe('SERVER');
    expect(res.saved).toBe(true);
    expect((await getQueue(U).all()).length).toBe(0);
  });

  it('KİLİT: kuyruk taşıyıcısı için de 23505 SYNCED sonucudur', async () => {
    h.insertError = { code: '23505', message: 'duplicate key value' };
    const item = {
      operationType: 'FUEL_LOG_ADD',
      payload: { vehicleId: V, clientRef: 'f-1', filledOn: '2026-08-14', odometerKm: 1, liters: 10, pricePerL: null },
    } as unknown as QueueItem;

    const out = await new RecordsSyncTransport().send(item);
    expect(out.ok).toBe(true);
  });
});

/* ── 5. Liste bütünlüğü ──────────────────────────────────────────────────── */

describe('kuyruktaki kayıt listede KALIR', () => {
  it('KİLİT: sunucu boş dönse bile bekleyen kayıt listeden kaybolmaz', async () => {
    h.insertError = NETWORK_FAIL;
    await addFuelEntry(V, fuel());

    // Sunucu bu kaydı henüz görmüyor.
    h.selectRows = [];
    const listed = await loadFuelEntries(V);

    expect(listed.entries).toHaveLength(1);
    expect(listed.entries[0].sync).toBe('QUEUED');
    expect(listed.entries[0].liters).toBe(42.5);
  });

  it('KİLİT: kayıt sunucuya geçince ÇİFT gösterilmez (clientRef eşleşir)', async () => {
    h.insertError = NETWORK_FAIL;
    await addFuelEntry(V, fuel());

    const local = await loadFuelEntries(V);
    const ref   = local.entries[0].clientRef as string;
    expect(ref).toBeTruthy();

    // Kuyruk sonradan gönderdi → aynı kayıt artık sunucuda.
    h.selectRows = [{
      id: 'srv-1', filled_on: '2026-08-14', odometer_km: 120_000,
      liters: 42.5, price_per_liter: 45, client_ref: ref,
    }];

    const merged = await loadFuelEntries(V);
    expect(merged.entries).toHaveLength(1);
    expect(merged.entries[0].sync).toBe('SERVER');
    expect(merged.entries[0].id).toBe('srv-1');
  });

  it('KİLİT: eski göç kaydı "sırada" DEĞİL "yalnız cihazda" etiketlenir', async () => {
    // Eski sabit anahtardan göç eden kayıt kuyrukta değildir; kendiliğinden gitmez.
    window.localStorage.setItem('caros_fuel_log', JSON.stringify([
      { id: 'legacy-1', date: '2026-07-01', km: 90_000, liters: 35, pricePerL: 44 },
    ]));
    h.selectRows = [];

    const listed = await loadFuelEntries(V);
    expect(listed.entries).toHaveLength(1);
    expect(listed.entries[0].sync).toBe('LOCAL');
  });
});

/* ── 6. Taşıyıcı sözleşmesi ──────────────────────────────────────────────── */

describe('taşıyıcı yönlendirmesi', () => {
  it('KİLİT: kayıt işlemleri HTTP rotasına GİTMEZ', async () => {
    const httpSpy = { send: vi.fn(async () => ({ ok: true as const })) };
    const recSpy  = { send: vi.fn(async () => ({ ok: true as const })) };
    const composite = new CompositeSyncTransport(httpSpy, recSpy);

    await composite.send({ operationType: 'FUEL_LOG_ADD' } as QueueItem);
    expect(recSpy.send).toHaveBeenCalledTimes(1);
    expect(httpSpy.send).not.toHaveBeenCalled();

    await composite.send({ operationType: 'COMPANY_CREATE' } as QueueItem);
    expect(httpSpy.send).toHaveBeenCalledTimes(1);
  });

  it('KİLİT: HTTP taşıyıcısı kayıt işlemi için uç noktası TANIMAZ (yanlış yola düşerse görülür)', async () => {
    const out = await new HttpSyncTransport().send({
      operationType: 'FUEL_LOG_ADD', payload: {}, idempotencyKey: 'x',
    } as unknown as QueueItem);
    expect(out.ok).toBe(false);
  });

  it('KİLİT: bozuk kuyruk gövdesi KALICI hatadır — yarım satır yazılmaz', async () => {
    const out = await new RecordsSyncTransport().send({
      operationType: 'FUEL_LOG_ADD',
      payload: { vehicleId: V },   // clientRef ve liters YOK
    } as unknown as QueueItem);

    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.retryable).toBe(false);
      expect(out.errorCode).toBe('invalid_request');
    }
    // Sunucuya HİÇ yazma denenmez.
    expect(h.inserts).toHaveLength(0);
  });

  it('KİLİT: iki ayrı kayıt AYNI turda gider (araç kapsamında serileştirilmez)', () => {
    const a = { operationType: 'FUEL_LOG_ADD', vehicleId: V, dedupKey: 'k1', payload: {} } as unknown as QueueItem;
    const b = { operationType: 'FUEL_LOG_ADD', vehicleId: V, dedupKey: 'k2', payload: {} } as unknown as QueueItem;
    expect(entityKeyOf(a)).not.toBe(entityKeyOf(b));
  });

  it('isRecordOperation yalnız kayıt tiplerini tanır', () => {
    expect(isRecordOperation('FUEL_LOG_ADD')).toBe(true);
    expect(isRecordOperation('SERVICE_RECORD_ADD')).toBe(true);
    expect(isRecordOperation('VEHICLE_PAIR')).toBe(false);
  });
});

/* ── 7. Silme (borç B4) ──────────────────────────────────────────────────── */

describe('kayıt silme — kaydın yaşadığı HER yerden gider', () => {
  it('KİLİT: SIRADAKİ kayıt silinince kuyruktan da İPTAL edilir (yoksa sonra sunucuya giderdi)', async () => {
    h.insertError = NETWORK_FAIL;
    await addFuelEntry(V, fuel());

    const listed = await loadFuelEntries(V);
    const entry  = listed.entries[0];
    expect(entry.sync).toBe('QUEUED');

    const del = await deleteFuelEntry(V, entry);
    expect(del.deleted).toBe(true);
    expect(del.scope).toBe('QUEUE');

    // Kuyruk öğesi artık gönderilmeyecek.
    const items = await getQueue(U).all();
    const rec   = items.filter((i) => i.operationType === 'FUEL_LOG_ADD');
    expect(rec).toHaveLength(1);
    expect(rec[0].status).toBe('CANCELLED');

    // Sunucuya silme isteği GİTMEZ — satır orada hiç olmadı.
    expect(h.deletes).toHaveLength(0);

    // Liste boşalır.
    h.selectRows = [];
    expect((await loadFuelEntries(V)).entries).toHaveLength(0);
  });

  it('KİLİT: SUNUCUDAKİ kayıt silinince DELETE gider ve yerel kopya da temizlenir', async () => {
    h.insertError = null;
    await addFuelEntry(V, fuel());
    const ref = (await loadFuelEntries(V)).entries[0]?.clientRef
      ?? (h.inserts[0].row.client_ref as string);

    h.selectRows = [{
      id: 'srv-9', filled_on: '2026-08-14', odometer_km: 1,
      liters: 42.5, price_per_liter: 45, client_ref: ref,
    }];
    const entry = (await loadFuelEntries(V)).entries[0];
    expect(entry.sync).toBe('SERVER');

    const del = await deleteFuelEntry(V, entry);
    expect(del.deleted).toBe(true);
    expect(del.scope).toBe('SERVER');
    expect(h.deletes).toHaveLength(1);
    expect(h.deletes[0].table).toBe('vehicle_fuel_logs');
    expect(h.deletes[0].filters).toEqual({ vehicle_id: V, id: 'srv-9' });

    // Yerel kopya kalsaydı liste onu "yalnız cihazda" diye geri getirirdi.
    h.selectRows = [];
    expect((await loadFuelEntries(V)).entries).toHaveLength(0);
  });

  it('KİLİT: bağlantı yokken sunucudaki kayıt SİLİNMİŞ gösterilmez ve kuyruğa alınmaz', async () => {
    h.deleteError = NETWORK_FAIL;
    const entry = {
      id: 'srv-3', filledOn: '2026-08-14', odometerKm: null,
      liters: 10, pricePerL: null, clientRef: 'f-x', sync: 'SERVER' as const,
    };

    const del = await deleteFuelEntry(V, entry);
    expect(del.deleted).toBe(false);
    expect(del.error).toMatch(/çevrimdışı yapılamaz/i);
    expect((await getQueue(U).all()).length).toBe(0);
  });

  it('KİLİT: sunucu kimliği bilinmeyen kayıt için silme İDDİA EDİLMEZ', async () => {
    const del = await deleteFuelEntry(V, {
      id: '', filledOn: '2026-08-14', odometerKm: null,
      liters: 10, pricePerL: null, sync: 'SERVER',
    });
    expect(del.deleted).toBe(false);
    expect(h.deletes).toHaveLength(0);
  });

  it('KİLİT: yalnız cihazdaki kayıt için sunucuya DELETE gitmez', async () => {
    h.sessionUserId = null;
    await addFuelEntry(V, fuel());
    const entry = (await loadFuelEntries(V)).entries[0];

    const del = await deleteFuelEntry(V, entry);
    expect(del.deleted).toBe(true);
    expect(del.scope).toBe('LOCAL');
    expect(h.deletes).toHaveLength(0);
    expect((await loadFuelEntries(V)).entries).toHaveLength(0);
  });

  it('KİLİT: servis kaydı geri alınınca da aynı kurallar geçerli', async () => {
    h.insertError = NETWORK_FAIL;
    await addServiceEntry(V, { serviceKey: 'oil', performedOn: '2026-08-14', odometerKm: 1000 });

    const listed = await loadServiceEntries(V);
    const del = await deleteServiceEntry(V, listed.entries[0]);
    expect(del.deleted).toBe(true);
    expect(del.scope).toBe('QUEUE');

    const items = await getQueue(U).all();
    expect(items.find((i) => i.operationType === 'SERVICE_RECORD_ADD')?.status).toBe('CANCELLED');
  });
});

/* ── 8. Kuyruğun GERÇEKTEN sürüldüğü ─────────────────────────────────────── */

describe('PWA tarafında kuyruk sürülüyor (#574 sınıfı ölü uç kilidi)', () => {
  // Vitest `root` website klasörüdür (vitest.config.ts) → yol buradan çözülür.
  const read = (rel: string): string => readFileSync(resolve(process.cwd(), 'src', rel), 'utf8');

  it('KİLİT: kuyruğu boşaltan hook GERÇEKTEN drain çağırır ve online olayına abone olur', () => {
    const src = read('hooks/useRecordsSync.ts');
    expect(src).toContain('getOrchestrator');
    expect(src).toContain('.drain()');
    expect(src).toContain("addEventListener('online'");
    expect(src).toContain("removeEventListener('online'");
  });

  it('KİLİT: Kayıtlar ekranı bu hook\'u GERÇEKTEN mount eder', () => {
    const src = read('components/pwa/RecordsPanel.tsx');
    expect(src).toContain("from '@/hooks/useRecordsSync'");
    expect(src).toContain('useRecordsSync()');
    expect(src).toContain('<PendingQueueStrip />');
  });

  it('KİLİT: gönderilemeyen kayıt TEK TEK gösterilir ve kullanıcı karar verebilir', () => {
    const hook = read('hooks/useRecordsSync.ts');
    // Kuyruk gerçekten yeniden denenir / iptal edilir — sahte düğme değil.
    expect(hook).toContain('.retry(');
    expect(hook).toContain('.cancel(');

    const ui = read('components/pwa/RecordsPanel.tsx');
    expect(ui).toContain('retryItem(entry.id)');
    expect(ui).toContain('discardItem(entry.id)');
    expect(ui).toContain('queueFailureMessage(entry)');
    // Yalnız adet göstermek yetmez; her kayıt için ayrı satır çizilir.
    expect(ui).toContain('failedItems.map');
  });

  it('KİLİT: "Sırada" mesajı hesaba işlendiğini İDDİA ETMEZ', () => {
    const src = read('components/pwa/RecordsPanel.tsx');
    const queuedLine = src.split('\n').find((l) => l.includes('QUEUED:') && l.includes('sıraya alındı'));
    expect(queuedLine).toBeTruthy();
    expect(queuedLine).not.toMatch(/hesabınıza/i);
  });
});
