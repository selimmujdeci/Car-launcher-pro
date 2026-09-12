/**
 * realtimeRuntimeIntegration.test.ts — ÜRÜN ENTEGRASYONU KİLİTLERİ.
 *
 * En kritik kilit: **reconnect hiçbir yoldan snapshot/uzlaştırma tamamlanmadan
 * LIVE olamaz.** `useRealtime`'ın motoru artık yalnız ham sinyal üretir;
 * "veriler güncel mi?" kararını YALNIZ `RealtimeSyncAuthority` verir.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  RealtimeSyncRuntime, VehicleSnapshotFetcher, SupabaseVehicleSnapshotReader,
  startRealtimeRuntime, stopRealtimeRuntime, peekRealtimeRuntime,
  type VehicleSnapshotReader, type SupabaseLikeClient, type EngineConnectionStatus,
} from '@/lib/realtime/realtimeSyncRuntime';
import {
  peekRealtimeAuthority, MAX_RESYNC_ATTEMPTS,
  type RealtimeScope, type PendingLocalEntity, type ReconciliationItem,
} from '@/lib/realtime/realtimeSyncAuthority';

let clock = 1_000_000;
const now = () => clock;

const SCOPE: RealtimeScope = {
  accountId: 'u1', companyId: 'c1', generation: 1, subscriptionId: 'sub-1',
};

class FakeReader implements VehicleSnapshotReader {
  calls = 0;
  rows: { id: string; revision: number | null; deleted?: boolean }[] = [
    { id: 'v1', revision: 5 },
  ];
  fail = false;

  async readVehicles() {
    this.calls += 1;
    if (this.fail) throw new Error('ağ yok');
    return this.rows;
  }
}

function makeRuntime(
  reader: VehicleSnapshotReader,
  pending: readonly PendingLocalEntity[] = [],
  onReconciled?: (items: readonly ReconciliationItem[]) => void,
): RealtimeSyncRuntime {
  return new RealtimeSyncRuntime({
    now, reader, readPending: () => pending, onReconciled,
  });
}

/** Kuyruğa alınmış resync zincirinin boşalmasını bekler. */
async function settle(): Promise<void> {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

beforeEach(() => {
  clock = 1_000_000;
  stopRealtimeRuntime();
});

/* ── 1. RECONNECT → SNAPSHOT ZORUNLULUĞU ───────────────────────────────── */

describe('runtime · reconnect snapshot olmadan LIVE OLAMAZ', () => {
  it('connected TEK BAŞINA güvenilir yapmaz', async () => {
    const reader = new FakeReader();
    reader.fail = true;                       // snapshot alınamıyor
    const runtime = makeRuntime(reader);
    runtime.start(SCOPE);

    runtime.onConnectionStatus('connected');
    expect(runtime.isTrustworthy()).toBe(false);   // henüz snapshot yok

    await settle();
    // Snapshot düştü → LIVE OLMADI.
    expect(runtime.isTrustworthy()).toBe(false);
    expect(runtime.getAuthority().getState()).not.toBe('LIVE');
  });

  it('snapshot başarılı olunca LIVE olur', async () => {
    const runtime = makeRuntime(new FakeReader());
    runtime.start(SCOPE);
    runtime.onConnectionStatus('connected');
    await settle();

    expect(runtime.isTrustworthy()).toBe(true);
    expect(runtime.getAuthority().view().lastServerRevision).toBe(5);
  });

  it('disconnect sonrası reconnect YENİDEN snapshot ister', async () => {
    const reader = new FakeReader();
    const runtime = makeRuntime(reader);
    runtime.start(SCOPE);

    runtime.onConnectionStatus('connected');
    await settle();
    expect(runtime.isTrustworthy()).toBe(true);
    const firstCalls = reader.calls;

    runtime.onConnectionStatus('disconnected');
    expect(runtime.isTrustworthy()).toBe(false);   // DERHAL güvenilmez

    runtime.onConnectionStatus('connected');
    expect(runtime.isTrustworthy()).toBe(false);   // snapshot beklenir
    await settle();

    expect(reader.calls).toBeGreaterThan(firstCalls);
    expect(runtime.isTrustworthy()).toBe(true);
  });

  it('error durumu da bağlantı kaybı sayılır', async () => {
    const runtime = makeRuntime(new FakeReader());
    runtime.start(SCOPE);
    runtime.onConnectionStatus('connected');
    await settle();

    runtime.onConnectionStatus('error');
    expect(runtime.isTrustworthy()).toBe(false);
  });

  it('yinelenen aynı durum bildirimi yeni resync üretmez', async () => {
    const reader = new FakeReader();
    const runtime = makeRuntime(reader);
    runtime.start(SCOPE);

    runtime.onConnectionStatus('connected');
    runtime.onConnectionStatus('connected');
    runtime.onConnectionStatus('connected');
    await settle();

    expect(reader.calls).toBe(1);
  });

  it('eşzamanlı iki reconnect bildirimi tek snapshot üretir', async () => {
    const reader = new FakeReader();
    const runtime = makeRuntime(reader);
    runtime.start(SCOPE);

    // İki bağımsız callback aynı anda tetiklenir.
    runtime.onConnectionStatus('connected');
    runtime.scheduleResync();
    runtime.scheduleResync();
    await settle();

    // Otoritenin tek-uçuş kilidi + seri zincir → tek istek.
    expect(reader.calls).toBe(1);
  });
});

/* ── 2. BAŞARISIZLIK VE RETRY ──────────────────────────────────────────── */

describe('runtime · snapshot başarısızlığı', () => {
  it('başarısız snapshot revizyonu İLERLETMEZ', async () => {
    const reader = new FakeReader();
    reader.fail = true;
    const runtime = makeRuntime(reader);
    runtime.start(SCOPE);
    runtime.onConnectionStatus('connected');
    await settle();

    expect(runtime.getAuthority().view().lastServerRevision).toBeNull();
    expect(runtime.getAuthority().view().counters.resyncFailureCount).toBeGreaterThan(0);
  });

  it('ikinci denemede başarı LIVE yapar (bounded retry)', async () => {
    const reader = new FakeReader();
    reader.fail = true;
    const runtime = makeRuntime(reader);
    runtime.start(SCOPE);
    runtime.onConnectionStatus('connected');
    await settle();
    expect(runtime.isTrustworthy()).toBe(false);

    reader.fail = false;
    clock += 120_000;              // backoff kapısını geç
    runtime.tick();
    await settle();

    expect(runtime.isTrustworthy()).toBe(true);
  });

  it('SONSUZ RETRY YOK — tavanda DEGRADED kalır', async () => {
    const reader = new FakeReader();
    reader.fail = true;
    const runtime = makeRuntime(reader);
    runtime.start(SCOPE);
    runtime.onConnectionStatus('connected');
    await settle();

    for (let i = 0; i < MAX_RESYNC_ATTEMPTS + 2; i++) {
      clock += 120_000;
      runtime.tick();
      await settle();
    }

    expect(runtime.getAuthority().getState()).toBe('DEGRADED');
    expect(runtime.isTrustworthy()).toBe(false);
  });

  it('LIVE iken tick() gereksiz snapshot İSTEMEZ', async () => {
    const reader = new FakeReader();
    const runtime = makeRuntime(reader);
    runtime.start(SCOPE);
    runtime.onConnectionStatus('connected');
    await settle();
    const calls = reader.calls;

    runtime.tick();
    await settle();
    expect(reader.calls).toBe(calls);
  });

  it('retryNow DEGRADED durumunu çözer', async () => {
    const reader = new FakeReader();
    reader.fail = true;
    const runtime = makeRuntime(reader);
    runtime.start(SCOPE);
    runtime.onConnectionStatus('connected');
    await settle();
    for (let i = 0; i < MAX_RESYNC_ATTEMPTS + 1; i++) {
      clock += 120_000; runtime.tick(); await settle();
    }
    expect(runtime.getAuthority().getState()).toBe('DEGRADED');

    reader.fail = false;
    runtime.retryNow();
    await settle();
    expect(runtime.isTrustworthy()).toBe(true);
  });
});

/* ── 3. DURDURMA / HESAP DEĞİŞİMİ ──────────────────────────────────────── */

describe('runtime · durdurma ve kapsam izolasyonu', () => {
  it('stop() sonrası snapshot sonucu UYGULANMAZ', async () => {
    const reader = new FakeReader();
    const runtime = makeRuntime(reader);
    runtime.start(SCOPE);

    runtime.onConnectionStatus('connected');
    runtime.stop();                 // çıkış / hesap değişimi
    await settle();

    expect(runtime.isTrustworthy()).toBe(false);
    expect(runtime.getAuthority().getState()).toBe('STOPPED');
  });

  it('stop() sonrası bağlantı bildirimi YOK SAYILIR (zombi callback yok)', async () => {
    const reader = new FakeReader();
    const runtime = makeRuntime(reader);
    runtime.start(SCOPE);
    runtime.stop();

    runtime.onConnectionStatus('connected');
    runtime.tick();
    runtime.retryNow();
    await settle();

    expect(reader.calls).toBe(0);
    expect(runtime.getAuthority().getState()).toBe('STOPPED');
  });

  it('stop() LAB kaydını bırakır', async () => {
    const runtime = makeRuntime(new FakeReader());
    runtime.start(SCOPE);
    expect(peekRealtimeAuthority()).not.toBeNull();

    runtime.stop();
    expect(peekRealtimeAuthority()).toBeNull();
  });

  it('🔴 İKİNCİ OTORİTE OLAMAZ — yeni runtime öncekini durdurur', async () => {
    const first = startRealtimeRuntime(SCOPE, {
      now, reader: new FakeReader(), readPending: () => [],
    });
    first.onConnectionStatus('connected');
    await settle();
    expect(first.isTrustworthy()).toBe(true);

    const second = startRealtimeRuntime(
      { ...SCOPE, accountId: 'u2', generation: 2 },
      { now, reader: new FakeReader(), readPending: () => [] },
    );

    expect(first.getAuthority().getState()).toBe('STOPPED');
    expect(peekRealtimeRuntime()).toBe(second);
    // LAB yalnız YENİ otoriteyi görür.
    expect(peekRealtimeAuthority()).toBe(second.getAuthority());
  });

  it('stopRealtimeRuntime tekil örneği temizler', () => {
    startRealtimeRuntime(SCOPE, { now, reader: new FakeReader(), readPending: () => [] });
    expect(peekRealtimeRuntime()).not.toBeNull();
    stopRealtimeRuntime();
    expect(peekRealtimeRuntime()).toBeNull();
    expect(peekRealtimeAuthority()).toBeNull();
  });
});

/* ── 4. UZLAŞTIRMA ─────────────────────────────────────────────────────── */

describe('runtime · uzlaştırma', () => {
  it('bekleyen güvenlik işlemi sunucu daha yeniyken SERVER kazanır', async () => {
    const reader = new FakeReader();
    reader.rows = [{ id: 'v1', revision: 20 }];
    const pending: PendingLocalEntity[] = [
      { entityId: 'v1', entityKind: 'vehicle', baseRevision: 5, authoritative: true },
    ];
    let received: readonly ReconciliationItem[] = [];
    const runtime = makeRuntime(reader, pending, (items) => { received = items; });

    runtime.start(SCOPE);
    runtime.onConnectionStatus('connected');
    await settle();

    expect(received).toHaveLength(1);
    expect(received[0].klass).toBe('SERVER_NEWER');
    expect(received[0].outcome).toBe('ACCEPT_SERVER');
  });

  it('sunucuda silinen araç + bekleyen sıradan mutation → stale düşürülür', async () => {
    const reader = new FakeReader();
    reader.rows = [{ id: 'v1', revision: 20, deleted: true }];
    const pending: PendingLocalEntity[] = [
      { entityId: 'v1', entityKind: 'vehicle', baseRevision: 5, authoritative: false },
    ];
    let received: readonly ReconciliationItem[] = [];
    const runtime = makeRuntime(reader, pending, (items) => { received = items; });

    runtime.start(SCOPE);
    runtime.onConnectionStatus('connected');
    await settle();

    expect(received[0].outcome).toBe('DROP_STALE_LOCAL');
  });

  it('uzlaştırma tüketicisinin hatası otoriteyi BOZMAZ', async () => {
    const runtime = makeRuntime(new FakeReader(), [], () => {
      throw new Error('tüketici patladı');
    });
    runtime.start(SCOPE);
    runtime.onConnectionStatus('connected');
    await settle();

    expect(runtime.isTrustworthy()).toBe(true);
  });
});

/* ── 5. REVİZYON KAYNAĞI DÜRÜSTLÜĞÜ ────────────────────────────────────── */

describe('runtime · revizyon kaynağı', () => {
  it('revizyon varsa SERVER_REVISION raporlanır', async () => {
    const runtime = makeRuntime(new FakeReader());
    runtime.start(SCOPE);
    runtime.onConnectionStatus('connected');
    await settle();
    expect(runtime.getRevisionSource()).toBe('SERVER_REVISION');
  });

  it('revizyon YOKSA uydurulmaz — UNAVAILABLE raporlanır', async () => {
    const reader = new FakeReader();
    reader.rows = [{ id: 'v1', revision: null }, { id: 'v2', revision: null }];
    const runtime = makeRuntime(reader);
    runtime.start(SCOPE);
    runtime.onConnectionStatus('connected');
    await settle();

    expect(runtime.getRevisionSource()).toBe('UNAVAILABLE');
    // Snapshot yine de alınır → reconnect akışı çalışmaya devam eder.
    expect(runtime.isTrustworthy()).toBe(true);
    expect(runtime.getAuthority().view().lastServerRevision).toBe(0);
  });

  it('snapshot revizyonu araçların EN BÜYÜĞÜDÜR', async () => {
    const reader = new FakeReader();
    reader.rows = [{ id: 'a', revision: 3 }, { id: 'b', revision: 11 }, { id: 'c', revision: 7 }];
    const fetcher = new VehicleSnapshotFetcher(reader);
    const snapshot = await fetcher.fetchSnapshot(SCOPE);
    expect(snapshot.revision).toBe(11);
    expect(snapshot.entities).toHaveLength(3);
  });
});

/* ── 6. SUPABASE OKUYUCU (039 yoksa fail-soft) ─────────────────────────── */

describe('runtime · Supabase okuyucu', () => {
  function client(responses: { data: unknown; error: unknown }[]): SupabaseLikeClient {
    let call = 0;
    return {
      from: () => ({
        select: async () => responses[Math.min(call++, responses.length - 1)],
      }),
    };
  }

  it('revision kolonu varsa okur', async () => {
    const reader = new SupabaseVehicleSnapshotReader(
      client([{ data: [{ id: 'v1', revision: 9 }], error: null }]),
    );
    expect(await reader.readVehicles()).toEqual([{ id: 'v1', revision: 9 }]);
  });

  it('revision kolonu YOKSA (039 uygulanmamış) revizyonsuz devam eder', async () => {
    const reader = new SupabaseVehicleSnapshotReader(
      client([
        { data: null, error: { message: 'column vehicles.revision does not exist' } },
        { data: [{ id: 'v1' }, { id: 'v2' }], error: null },
      ]),
    );
    expect(await reader.readVehicles()).toEqual([
      { id: 'v1', revision: null }, { id: 'v2', revision: null },
    ]);
  });

  it('her iki sorgu da düşerse HATA fırlatır (DEGRADED üretir)', async () => {
    const reader = new SupabaseVehicleSnapshotReader(
      client([{ data: null, error: { message: 'network' } }]),
    );
    await expect(reader.readVehicles()).rejects.toThrow('snapshot_unavailable');
  });

  it('bozuk satırlar elenir — sahte kimlik üretilmez', async () => {
    const reader = new SupabaseVehicleSnapshotReader(
      client([{ data: [{ id: 'v1', revision: 1 }, { id: null }, { revision: 5 }], error: null }]),
    );
    expect(await reader.readVehicles()).toEqual([{ id: 'v1', revision: 1 }]);
  });
});

/* ── 7. BAĞLANTI DURUMU SÖZLEŞMESİ ─────────────────────────────────────── */

describe('runtime · bağlantı durumu sözleşmesi', () => {
  it('connecting durumu güvenilirliği DEĞİŞTİRMEZ', async () => {
    const runtime = makeRuntime(new FakeReader());
    runtime.start(SCOPE);
    runtime.onConnectionStatus('connected');
    await settle();
    expect(runtime.isTrustworthy()).toBe(true);

    runtime.onConnectionStatus('connecting');
    // 'connecting' bir kayıp sinyali DEĞİLDİR; durum korunur.
    expect(runtime.getAuthority().getState()).toBe('LIVE');
  });

  it('tüm durum değerleri kabul edilir (bilinmeyen dal yok)', async () => {
    const runtime = makeRuntime(new FakeReader());
    runtime.start(SCOPE);
    const statuses: EngineConnectionStatus[] = ['connecting', 'connected', 'disconnected', 'error'];
    for (const s of statuses) runtime.onConnectionStatus(s);
    await settle();
    expect(runtime.getAuthority().getState()).not.toBe('IDLE');
  });
});
