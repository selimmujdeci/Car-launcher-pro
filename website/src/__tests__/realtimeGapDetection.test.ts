/**
 * realtimeGapDetection.test.ts — REALTIME BOŞLUK TESPİTİ KİLİTLERİ.
 *
 * Kilitlenen ana iddia: **reconnect sonrası akışa kör güvenilmez.**
 * Snapshot alınmadan LIVE olunamaz; boşluk sessizce atlanamaz; eski
 * kuşaktan gelen olay yeni kapsama uygulanamaz.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  RealtimeSyncAuthority, reconcile, resyncBackoffMs, isTrustworthy,
  scopeKey, realtimeStateLabel, gapReasonLabel,
  REALTIME_STATES, GAP_REASONS, COUNTER_CAP, MAX_RESYNC_ATTEMPTS,
  RESYNC_BACKOFF_MAX_MS,
  type RealtimeScope, type RealtimeEvent, type ServerSnapshot,
  type PendingLocalEntity, type SnapshotFetcher, type RealtimeState, type GapReason,
} from '@/lib/realtime/realtimeSyncAuthority';

/* ── Yardımcılar ───────────────────────────────────────────────────────── */

let clock = 1_000_000;
const now = () => clock;

const SCOPE: RealtimeScope = {
  accountId: 'u1', companyId: 'c1', generation: 1, subscriptionId: 'sub-1',
};

function evt(over: Partial<RealtimeEvent> & { revision: number }): RealtimeEvent {
  return {
    revision:   over.revision,
    entityId:   over.entityId   ?? 'v1',
    entityKind: over.entityKind ?? 'vehicle',
    action:     over.action     ?? 'UPDATE',
    scope:      over.scope      ?? SCOPE,
    receivedAt: over.receivedAt ?? clock,
  };
}

function snapshot(revision: number, entities: ServerSnapshot['entities'] = []): ServerSnapshot {
  return { revision, entities, takenAt: clock };
}

class FakeFetcher implements SnapshotFetcher {
  calls = 0;
  constructor(
    private readonly result: ServerSnapshot | Error,
    private readonly hook?: () => void,
  ) {}

  async fetchSnapshot(): Promise<ServerSnapshot> {
    this.calls += 1;
    this.hook?.();
    if (this.result instanceof Error) throw this.result;
    return this.result;
  }
}

function authority(
  fetcher: SnapshotFetcher,
  pending: readonly PendingLocalEntity[] = [],
): RealtimeSyncAuthority {
  return new RealtimeSyncAuthority({ now, fetcher, readPending: () => pending });
}

/** LIVE duruma güvenli şekilde ulaşır (snapshot uzlaştırmasından geçerek). */
async function toLive(auth: RealtimeSyncAuthority, revision = 10): Promise<void> {
  auth.start(SCOPE);
  auth.connected();
  await auth.resync();
  expect(auth.getState()).toBe('LIVE');
  void revision;
}

beforeEach(() => { clock = 1_000_000; });

/* ── 1. TEMEL SÖZLEŞME ─────────────────────────────────────────────────── */

describe('realtime · durum sözleşmesi', () => {
  it('YALNIZ LIVE güvenilir sayılır', () => {
    for (const state of REALTIME_STATES) {
      expect(isTrustworthy(state as RealtimeState)).toBe(state === 'LIVE');
    }
  });

  it('her durum ve boşluk sebebi için Türkçe etiket vardır', () => {
    for (const s of REALTIME_STATES) expect(realtimeStateLabel(s as RealtimeState).length).toBeGreaterThan(3);
    for (const g of GAP_REASONS)     expect(gapReasonLabel(g as GapReason).length).toBeGreaterThan(3);
  });

  it('kapsam anahtarı hesap, şirket ve kuşağı birlikte kimliklendirir', () => {
    expect(scopeKey(SCOPE)).not.toBe(scopeKey({ ...SCOPE, generation: 2 }));
    expect(scopeKey(SCOPE)).not.toBe(scopeKey({ ...SCOPE, accountId: 'u2' }));
    expect(scopeKey(SCOPE)).not.toBe(scopeKey({ ...SCOPE, companyId: 'c2' }));
  });

  it('başlangıçta güvenilir cursor YOKTUR — bağlanınca doğrudan LIVE olmaz', () => {
    const auth = authority(new FakeFetcher(snapshot(5)));
    auth.start(SCOPE);
    auth.connected();
    expect(auth.getState()).toBe('SUSPECTED_GAP');
    expect(auth.view().lastGapReason).toBe('MISSING_CURSOR');
  });
});

/* ── 2. BOŞLUK SİNYALLERİ ──────────────────────────────────────────────── */

describe('realtime · boşluk tespiti', () => {
  it('revision 10 → 12 boşluk sayılır, olay KABUL EDİLMEZ', async () => {
    const auth = authority(new FakeFetcher(snapshot(10)));
    await toLive(auth);

    const result = auth.onEvent(evt({ revision: 12 }));
    expect(result.accepted).toBe(false);
    expect(result.reason).toBe('REVISION_JUMP');
    expect(auth.getState()).toBe('SUSPECTED_GAP');
    expect(isTrustworthy(auth.getState())).toBe(false);
  });

  it('ardışık revision normal akar', async () => {
    const auth = authority(new FakeFetcher(snapshot(10)));
    await toLive(auth);
    expect(auth.onEvent(evt({ revision: 11 })).accepted).toBe(true);
    expect(auth.onEvent(evt({ revision: 12, entityId: 'v2' })).accepted).toBe(true);
    expect(auth.getState()).toBe('LIVE');
  });

  it('geriye giden revision NON_MONOTONIC boşluğudur', async () => {
    const auth = authority(new FakeFetcher(snapshot(10)));
    await toLive(auth);
    const r = auth.onEvent(evt({ revision: 9 }));
    expect(r.reason).toBe('NON_MONOTONIC');
    expect(auth.getState()).toBe('SUSPECTED_GAP');
  });

  it('aynı olay iki kez gelirse ikincisi bastırılır', async () => {
    const auth = authority(new FakeFetcher(snapshot(10)));
    await toLive(auth);
    expect(auth.onEvent(evt({ revision: 11 })).accepted).toBe(true);
    const dup = auth.onEvent(evt({ revision: 11 }));
    expect(dup.accepted).toBe(false);
    expect(dup.reason).toBe('DUPLICATE');
    expect(auth.view().counters.duplicateEventCount).toBe(1);
    // Duplicate boşluk DEĞİLDİR — durum bozulmaz.
    expect(auth.getState()).toBe('LIVE');
  });

  it('disconnect + reconnect DAİMA boşluk şüphesi üretir', async () => {
    const auth = authority(new FakeFetcher(snapshot(10)));
    await toLive(auth);

    auth.disconnected();
    expect(auth.getState()).toBe('SUSPECTED_GAP');
    auth.connected();
    expect(auth.getState()).toBe('SUSPECTED_GAP');
    expect(auth.view().lastGapReason).toBe('RECONNECTED');
    expect(auth.view().counters.reconnectCount).toBe(1);
  });

  it('sunucu revizyonu yerelden ileriyse boşluk sayılır', async () => {
    const auth = authority(new FakeFetcher(snapshot(10)));
    await toLive(auth);
    auth.observeServerRevision(15);
    expect(auth.getState()).toBe('SUSPECTED_GAP');
    expect(auth.view().lastGapReason).toBe('SERVER_AHEAD');
  });

  it('var olmayan varlık olayı imleci güvenilmez kılar', async () => {
    const auth = authority(new FakeFetcher(snapshot(10)));
    await toLive(auth);
    auth.observeUnknownEntityEvent();
    expect(auth.view().lastGapReason).toBe('UNKNOWN_ENTITY_EVENT');
  });

  it('boşluk şüphesi varken gelen olay "güncel" saymaz', async () => {
    const auth = authority(new FakeFetcher(snapshot(10)));
    await toLive(auth);
    auth.disconnected();
    const r = auth.onEvent(evt({ revision: 11 }));
    expect(r.accepted).toBe(false);
    expect(auth.getState()).toBe('SUSPECTED_GAP');
  });
});

/* ── 3. KUŞAK KAPISI (hesap/şirket değişimi) ───────────────────────────── */

describe('realtime · kuşak kapısı', () => {
  it('eski kuşaktan gelen olay REDDEDİLİR', async () => {
    const auth = authority(new FakeFetcher(snapshot(10)));
    await toLive(auth);

    const stale = auth.onEvent(evt({ revision: 11, scope: { ...SCOPE, generation: 0 } }));
    expect(stale.accepted).toBe(false);
    expect(stale.reason).toBe('GENERATION_MISMATCH');
    expect(auth.view().counters.staleCallbackRejectCount).toBe(1);
  });

  it('başka HESABIN olayı bu kapsama uygulanmaz', async () => {
    const auth = authority(new FakeFetcher(snapshot(10)));
    await toLive(auth);
    const other = auth.onEvent(evt({ revision: 11, scope: { ...SCOPE, accountId: 'u2' } }));
    expect(other.accepted).toBe(false);
    expect(other.reason).toBe('GENERATION_MISMATCH');
  });

  it('başka ŞİRKETİN olayı bu kapsama uygulanmaz', async () => {
    const auth = authority(new FakeFetcher(snapshot(10)));
    await toLive(auth);
    const other = auth.onEvent(evt({ revision: 11, scope: { ...SCOPE, companyId: 'c2' } }));
    expect(other.accepted).toBe(false);
  });

  it('stop() sonrası hiçbir olay kabul edilmez', async () => {
    const auth = authority(new FakeFetcher(snapshot(10)));
    await toLive(auth);
    auth.stop();
    const r = auth.onEvent(evt({ revision: 11 }));
    expect(r.accepted).toBe(false);
    expect(r.reason).toBe('STOPPED');
  });

  it('resync sırasında hesap değişirse sonuç UYGULANMAZ', async () => {
    let auth!: RealtimeSyncAuthority;
    // Snapshot dönerken kapsam değişir (logout/hesap değişimi taklidi).
    const fetcher = new FakeFetcher(snapshot(20), () => {
      auth.start({ ...SCOPE, accountId: 'u2', generation: 2 });
    });
    auth = authority(fetcher);
    auth.start(SCOPE);
    auth.connected();

    const result = await auth.resync();
    expect(result?.ok).toBe(false);
    expect(result?.reason).toBe('STALE_SCOPE');
    expect(auth.view().counters.staleCallbackRejectCount).toBeGreaterThan(0);
  });

  it('resync sırasında stop edilirse sonuç UYGULANMAZ', async () => {
    let auth!: RealtimeSyncAuthority;
    const fetcher = new FakeFetcher(snapshot(20), () => auth.stop());
    auth = authority(fetcher);
    auth.start(SCOPE);
    auth.connected();

    const result = await auth.resync();
    expect(result?.ok).toBe(false);
    expect(auth.getState()).toBe('STOPPED');
  });
});

/* ── 4. RESYNC + BACKOFF ───────────────────────────────────────────────── */

describe('realtime · yeniden eşitleme', () => {
  it('başarılı resync LIVE yapar ve sunucu revizyonunu ilerletir', async () => {
    const auth = authority(new FakeFetcher(snapshot(42)));
    auth.start(SCOPE);
    auth.connected();

    const result = await auth.resync();
    expect(result?.ok).toBe(true);
    expect(auth.getState()).toBe('LIVE');
    expect(auth.view().lastServerRevision).toBe(42);
    expect(auth.view().counters.resyncSuccessCount).toBe(1);
  });

  it('BAŞARISIZ resync LIVE YAPMAZ ve revizyonu ilerletmez', async () => {
    const auth = authority(new FakeFetcher(new Error('ağ yok')));
    auth.start(SCOPE);
    auth.connected();

    const result = await auth.resync();
    expect(result?.ok).toBe(false);
    expect(result?.reason).toBe('SNAPSHOT_FAILED');
    expect(isTrustworthy(auth.getState())).toBe(false);
    expect(auth.view().lastServerRevision).toBeNull();
    expect(auth.view().counters.resyncFailureCount).toBe(1);
  });

  it('aynı anda TEK resync çalışır', async () => {
    const fetcher = new FakeFetcher(snapshot(10));
    const auth = authority(fetcher);
    auth.start(SCOPE);
    auth.connected();

    const [a, b] = await Promise.all([auth.resync(), auth.resync()]);
    // İkincisi hiç başlamaz (null döner) — çift snapshot isteği YOK.
    expect([a, b].filter((r) => r === null)).toHaveLength(1);
    expect(fetcher.calls).toBe(1);
  });

  it('backoff dolmadan ikinci resync BAŞLAMAZ', async () => {
    const auth = authority(new FakeFetcher(new Error('ağ yok')));
    auth.start(SCOPE);
    auth.connected();

    await auth.resync();
    const nextAt = auth.view().nextResyncAt;
    expect(nextAt).toBeGreaterThan(clock);

    expect(await auth.resync()).toBeNull();   // backoff kapısı
    clock = (nextAt ?? 0) + 1;
    expect(await auth.resync()).not.toBeNull();
  });

  it('SONSUZ RETRY YOK — deneme tavanında DEGRADED olur', async () => {
    const auth = authority(new FakeFetcher(new Error('ağ yok')));
    auth.start(SCOPE);
    auth.connected();

    for (let i = 0; i < MAX_RESYNC_ATTEMPTS; i++) {
      clock += 120_000;                        // backoff'u geç
      await auth.resync();
    }
    expect(auth.getState()).toBe('DEGRADED');
    expect(auth.view().nextResyncAt).toBeNull();
    expect(isTrustworthy(auth.getState())).toBe(false);
  });

  it('ikinci denemede başarı, DEGRADED durumuna düşmeden LIVE yapar', async () => {
    let fail = true;
    const fetcher: SnapshotFetcher = {
      async fetchSnapshot() {
        if (fail) { fail = false; throw new Error('geçici'); }
        return snapshot(30);
      },
    };
    const auth = authority(fetcher);
    auth.start(SCOPE);
    auth.connected();

    expect((await auth.resync())?.ok).toBe(false);
    clock += 120_000;
    expect((await auth.resync())?.ok).toBe(true);
    expect(auth.getState()).toBe('LIVE');
  });

  it('kullanıcı "tekrar dene" derse DEGRADED çözülür', async () => {
    const auth = authority(new FakeFetcher(new Error('ağ yok')));
    auth.start(SCOPE);
    auth.connected();
    for (let i = 0; i < MAX_RESYNC_ATTEMPTS; i++) { clock += 120_000; await auth.resync(); }
    expect(auth.getState()).toBe('DEGRADED');

    auth.retryNow();
    expect(auth.getState()).toBe('SUSPECTED_GAP');
    expect(auth.view().nextResyncAt).toBeNull();
  });

  it('backoff üsteldir, tavanlıdır ve jitter DETERMİNİSTİKTİR', () => {
    expect(resyncBackoffMs(0, 'sub-1')).toBe(0);
    expect(resyncBackoffMs(1, 'sub-1')).toBe(resyncBackoffMs(1, 'sub-1')); // tekrar üretilebilir
    expect(resyncBackoffMs(3, 'sub-1')).toBeGreaterThan(resyncBackoffMs(1, 'sub-1'));
    expect(resyncBackoffMs(20, 'sub-1')).toBeLessThanOrEqual(Math.round(RESYNC_BACKOFF_MAX_MS * 1.25));
    // Farklı abonelikler farklı anda dener → reconnect storm engellenir.
    const spread = new Set([1, 2, 3, 4, 5].map((i) => resyncBackoffMs(3, `sub-${i}`)));
    expect(spread.size).toBeGreaterThan(1);
  });

  it('boşluk DOĞRULANIRSA confirmedGap sayılır', async () => {
    // İlk snapshot 10'da bırakır; kopukluk sırasında sunucu 50'ye ilerler.
    let revision = 10;
    const fetcher: SnapshotFetcher = { async fetchSnapshot() { return snapshot(revision); } };
    const auth = authority(fetcher);

    auth.start(SCOPE);
    auth.connected();
    await auth.resync();
    expect(auth.view().lastServerRevision).toBe(10);

    // Bağlantı kopukken sunucuda 40 değişiklik oldu.
    auth.disconnected();
    revision = 50;
    auth.connected();
    clock += 120_000;
    await auth.resync();

    expect(auth.view().counters.confirmedGapCount).toBeGreaterThan(0);
    expect(auth.view().lastServerRevision).toBe(50);
    expect(auth.getState()).toBe('LIVE');
  });
});

/* ── 5. SNAPSHOT UZLAŞTIRMA ────────────────────────────────────────────── */

describe('realtime · snapshot uzlaştırma', () => {
  const pendingVehicle = (over: Partial<PendingLocalEntity> = {}): PendingLocalEntity => ({
    entityId:      over.entityId      ?? 'v1',
    entityKind:    over.entityKind    ?? 'vehicle',
    baseRevision:  over.baseRevision  ?? 10,
    authoritative: over.authoritative ?? false,
  });

  it('sunucuda olup yerelde bekleyen olmayan varlık kabul edilir', () => {
    const items = reconcile(
      snapshot(11, [{ entityId: 'v9', entityKind: 'vehicle', revision: 11, deleted: false }]),
      [],
    );
    expect(items[0].klass).toBe('SERVER_ONLY_ENTITY');
    expect(items[0].outcome).toBe('ACCEPT_SERVER');
  });

  it('eşit revizyonda yerel bekleyen KORUNUR (sessizce ezilmez)', () => {
    const items = reconcile(
      snapshot(11, [{ entityId: 'v1', entityKind: 'vehicle', revision: 10, deleted: false }]),
      [pendingVehicle({ baseRevision: 10 })],
    );
    expect(items[0].klass).toBe('MATCHED');
    expect(items[0].outcome).toBe('KEEP_LOCAL_PENDING');
  });

  it('sunucu daha yeniyse GÜVENLİK işleminde sunucu kazanır', () => {
    const items = reconcile(
      snapshot(20, [{ entityId: 'v1', entityKind: 'vehicle', revision: 20, deleted: false }]),
      [pendingVehicle({ baseRevision: 10, authoritative: true })],
    );
    expect(items[0].klass).toBe('SERVER_NEWER');
    expect(items[0].outcome).toBe('ACCEPT_SERVER');
  });

  it('sunucu daha yeniyse SIRADAN metadata kullanıcıya sorulur', () => {
    const items = reconcile(
      snapshot(20, [{ entityId: 'v1', entityKind: 'vehicle', revision: 20, deleted: false }]),
      [pendingVehicle({ baseRevision: 10, authoritative: false })],
    );
    expect(items[0].outcome).toBe('USER_ACTION');
  });

  it('sunucuda silinmiş + yerelde sıradan bekleyen → stale düşürülür', () => {
    const items = reconcile(
      snapshot(20, [{ entityId: 'v1', entityKind: 'vehicle', revision: 20, deleted: true }]),
      [pendingVehicle({ authoritative: false })],
    );
    expect(items[0].klass).toBe('SERVER_DELETED_LOCAL_PENDING');
    expect(items[0].outcome).toBe('DROP_STALE_LOCAL');
  });

  it('sunucuda silinmiş + yerelde GÜVENLİK işlemi → kullanıcı kararı', () => {
    const items = reconcile(
      snapshot(20, [{ entityId: 'v1', entityKind: 'vehicle', revision: 20, deleted: true }]),
      [pendingVehicle({ authoritative: true })],
    );
    expect(items[0].outcome).toBe('USER_ACTION');
  });

  it('yerel taban sunucudan İLERİ ise fail-closed (imleç bozuk)', () => {
    const items = reconcile(
      snapshot(20, [{ entityId: 'v1', entityKind: 'vehicle', revision: 5, deleted: false }]),
      [pendingVehicle({ baseRevision: 10 })],
    );
    expect(items[0].klass).toBe('LOCAL_PENDING_NEWER');
    expect(items[0].outcome).toBe('FAIL_CLOSED');
  });

  it('bilinmeyen revizyon "başarılı" SAYILMAZ', () => {
    const items = reconcile(
      snapshot(20, [{ entityId: 'v1', entityKind: 'vehicle', revision: 20, deleted: false }]),
      [pendingVehicle({ baseRevision: -1 })],
    );
    expect(items[0].klass).toBe('UNKNOWN_REVISION');
    expect(items[0].outcome).toBe('FAIL_CLOSED');
  });

  it('snapshot içinde olmayan yerel yaratma işlemi DÜŞÜRÜLMEZ', () => {
    const items = reconcile(snapshot(20, []), [pendingVehicle({ entityId: 'yeni' })]);
    expect(items[0].klass).toBe('LOCAL_PENDING_ENTITY');
    expect(items[0].outcome).toBe('KEEP_LOCAL_PENDING');
  });

  it('üyelik kaldırılmışsa (sunucuda silinmiş üye) uzlaştırılır', () => {
    const items = reconcile(
      snapshot(30, [{ entityId: 'm1', entityKind: 'member', revision: 30, deleted: true }]),
      [{ entityId: 'm1', entityKind: 'member', baseRevision: 10, authoritative: true }],
    );
    expect(items[0].outcome).toBe('USER_ACTION');
  });

  it('çakışmalar sayaca yansır', async () => {
    const pending: PendingLocalEntity[] = [
      { entityId: 'v1', entityKind: 'vehicle', baseRevision: 1, authoritative: false },
    ];
    const auth = authority(
      new FakeFetcher(snapshot(20, [{ entityId: 'v1', entityKind: 'vehicle', revision: 20, deleted: false }])),
      pending,
    );
    auth.start(SCOPE);
    auth.connected();
    await auth.resync();
    expect(auth.view().counters.reconciliationConflictCount).toBeGreaterThan(0);
    expect(auth.view().counters.snapshotEntityCount).toBe(1);
  });
});

/* ── 6. SAYAÇ SINIRLARI ────────────────────────────────────────────────── */

describe('realtime · bounded sayaçlar', () => {
  it('sayaçlar tavanı AŞMAZ (taşma yok)', async () => {
    const auth = authority(new FakeFetcher(snapshot(10)));
    await toLive(auth);
    for (let i = 0; i < COUNTER_CAP + 50; i++) {
      auth.onEvent(evt({ revision: 11, scope: { ...SCOPE, generation: 99 } }));
    }
    expect(auth.view().counters.staleCallbackRejectCount).toBe(COUNTER_CAP);
  });

  it('duplicate kümesi sınırsız büyümez', async () => {
    const auth = authority(new FakeFetcher(snapshot(10)));
    await toLive(auth);
    // Çok sayıda farklı olay — bellek sınırsız büyümemeli.
    for (let i = 11; i < 800; i++) auth.onEvent(evt({ revision: i, entityId: `v${i}` }));
    expect(auth.getState()).toBe('LIVE');
  });
});
