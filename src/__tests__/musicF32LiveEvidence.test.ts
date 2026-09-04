/**
 * musicF32LiveEvidence.test.ts — MUSIC F3.2 kilitleri.
 *
 * Kilitlenen üç sözleşme:
 *   1. Gözlenen kuyruk kanıtı YALNIZ native/provider timeline'dan gelir;
 *      DesiredQueue'dan türetilmez ve bayat kanıt canlı sayılmaz.
 *   2. Oturumun `currentSource` alanı YALNIZ doğrulanmış (VERIFIED), canlı
 *      biletli ve bayat olmayan bir devirle yazılır.
 *   3. F3 telemetrisi bounded ve salt-okunurdur; PII taşımaz.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  _resetObservedQueueEvidenceForTest, getObservedQueueEvidence, observedQueueAgeMs,
  peekObservedQueueEvidence, publishObservedQueueEvidence, OBSERVED_QUEUE_MAX_AGE_MS,
  OBSERVED_QUEUE_MAX_ENTRIES,
} from '../platform/media/session/observedQueueEvidence';
import { deriveObservedQueueEvidence } from '../platform/media/session/observedQueueDerivation';
import {
  _resetF3TelemetryForTest, getF3TelemetrySnapshot, MAX_HANDOVER_RECORDS,
} from '../platform/media/session/sessionTelemetry';
import {
  _resetPlayQueueForTest, createQueue, getDesiredQueue, type QueueEntry,
} from '../platform/media/session/playQueue';
import {
  _resetListeningSessionForTest, getListeningSession, startListeningSession,
} from '../platform/media/session/listeningSession';
import {
  _resetListeningHandoverForTest, _setListeningRuntimePortsForTest,
  commitCarriedSourceAfterHandover, handoverListeningToSource, restoreListeningSession,
  type DispatchOutcome,
} from '../platform/media/session/listeningSessionRuntime';
import { _resetProjectionCacheForTest, getListeningProjection } from '../platform/media/session/sessionProjection';
import { evaluateContinuity } from '../platform/media/session/sessionContinuity';
import { audibleBackendCount, IDLE_HANDOVER, reduceHandover } from '../platform/media/authority/handoverMachine';
import type { CommandTruth } from '../platform/media/authority/playbackTruth';
import type { CanonicalMediaIdentity } from '../platform/media/session/mediaIdentityMatching';
import type { SourceClass } from '../platform/media/authority/sourceCapabilities';

/* ── Fixture'lar ─────────────────────────────────────────────────────────── */

const identity = (id: string, title = 'Parça'): CanonicalMediaIdentity => ({
  libraryId: id, providerId: id, providerNamespace: 'MEDIASTORE', contentUri: `content:///${id}`,
  title, artist: 'Sanatçı', album: 'Albüm', durationMs: 180_000, trackNumber: 1, discNumber: 1,
});

const entry = (id: string, title?: string): QueueEntry => ({
  entryId: `${id}#1`, identity: identity(id, title),
  item: { id, uri: `content:///${id}`, title: title ?? 'Parça', artist: 'Sanatçı' },
  origin: 'PROVIDER', libraryRef: null,
});

const truthOf = (over: Partial<CommandTruth> = {}): CommandTruth => ({
  commandId: 'cmd-1', sessionId: 'media-session-1', sourceId: 'LOCAL', backend: 'native_authority',
  command: 'playSource', desiredState: 'PLAYING', observedState: 'PLAYING', outcome: 'VERIFIED',
  verificationLevel: 'RENDERING_VERIFIED', startedAtMs: 0, endedAtMs: 10, elapsedMs: 10,
  failureCode: null, retryable: false, stages: [],
  ...over,
});

/** Gateway kancasını taklit eder; gerçek zincirin YERİNE geçmez, onu SINAR. */
function stubDispatch(
  outcome: (args: { source: SourceClass }) => DispatchOutcome,
): { calls: { source: SourceClass; startIndex: number; itemIds: string[] }[] } {
  const calls: { source: SourceClass; startIndex: number; itemIds: string[] }[] = [];
  _setListeningRuntimePortsForTest({
    dispatch: async (args) => {
      calls.push({
        source: args.source, startIndex: args.startIndex,
        itemIds: args.items.map((i) => i.id),
      });
      return outcome({ source: args.source });
    },
    persist: () => {},
  });
  return { calls };
}

const verifiedDispatch = (sessionId = 'media-session-7') =>
  stubDispatch(({ source }) => Object.freeze({
    truth: truthOf({ sessionId, sourceId: source }),
    gatewaySessionId: sessionId,
    generation: 7,
  }));

beforeEach(() => {
  _resetObservedQueueEvidenceForTest();
  _resetF3TelemetryForTest();
  _resetPlayQueueForTest();
  _resetListeningSessionForTest();
  _resetListeningHandoverForTest();
  _resetProjectionCacheForTest();
  _setListeningRuntimePortsForTest(null);
});

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · CANLI GÖZLENEN KUYRUK YAYINI
 * ════════════════════════════════════════════════════════════════════════ */

describe('F3.2 · live native timeline publish', () => {
  it('native Media3 timeline kanıta çevrilir ve pencere yazımı PREFIX olarak işaretlenir', () => {
    const evidence = deriveObservedQueueEvidence({
      authorityAvailable: true, activeSource: 'LOCAL',
      queueEntryIds: ['a', 'b', 'c'], queueLength: 900, currentIndex: 1,
      queueRevision: 42, nowMs: 1_000,
    });
    expect(evidence).toMatchObject({
      source: 'LOCAL', availability: 'AVAILABLE', provenance: 'NATIVE_MEDIA3',
      completeness: 'PREFIX', currentIndex: 1, revision: 42, unavailableReason: null,
    });
    expect(evidence.entries).toEqual(['a', 'b', 'c']);

    expect(publishObservedQueueEvidence(evidence)).toBe(true);
    expect(getObservedQueueEvidence(1_100)?.entries).toEqual(['a', 'b', 'c']);
    expect(getF3TelemetrySnapshot().lastObserved).toMatchObject({
      availability: 'AVAILABLE', completeness: 'PREFIX', entryCount: 3, hasCurrentIndex: true,
    });
  });

  it('timeline tam bildirildiğinde FULL olur; geçersiz indeks UYDURULMAZ', () => {
    const full = deriveObservedQueueEvidence({
      authorityAvailable: true, activeSource: 'LOCAL',
      queueEntryIds: ['a', 'b'], queueLength: 2, currentIndex: 9,
      queueRevision: 1, nowMs: 5,
    });
    expect(full.completeness).toBe('FULL');
    expect(full.currentIndex).toBeNull();
  });

  it('otorite yok / kaynak tanınmıyor / timeline bildirilmiyor → UNAVAILABLE + gerekçe', () => {
    const base = { queueEntryIds: ['a'], queueLength: 1, currentIndex: 0, queueRevision: 1, nowMs: 1 };
    expect(deriveObservedQueueEvidence({ ...base, authorityAvailable: false, activeSource: 'LOCAL' }))
      .toMatchObject({ availability: 'UNAVAILABLE', source: null, unavailableReason: 'authority_unavailable' });
    expect(deriveObservedQueueEvidence({ ...base, authorityAvailable: true, activeSource: 'NONE' }))
      .toMatchObject({ availability: 'UNAVAILABLE', unavailableReason: 'unknown_source_class' });
    expect(deriveObservedQueueEvidence({
      ...base, authorityAvailable: true, activeSource: 'LOCAL', queueEntryIds: undefined,
    })).toMatchObject({ availability: 'UNAVAILABLE', unavailableReason: 'timeline_not_reported' });
  });

  it('kuyruk semantiği olmayan sağlayıcı için DESTEK VARMIŞ GİBİ davranılmaz', () => {
    // YouTube/Spotify çok öğeli timeline sunmaz → uydurma gözlem üretilmez.
    (['YOUTUBE', 'SPOTIFY_CONNECT', 'BLUETOOTH_EXTERNAL'] as const).forEach((src) => {
      expect(deriveObservedQueueEvidence({
        authorityAvailable: true, activeSource: src, queueEntryIds: ['x'],
        queueLength: 1, currentIndex: 0, queueRevision: 1, nowMs: 1,
      })).toMatchObject({ availability: 'UNAVAILABLE', unavailableReason: 'source_reports_no_timeline' });
    });
  });

  it('bayat kanıt CANLI gözlem sayılmaz ama teşhis için ham hâliyle okunabilir', () => {
    publishObservedQueueEvidence(deriveObservedQueueEvidence({
      authorityAvailable: true, activeSource: 'LOCAL', queueEntryIds: ['a'],
      queueLength: 1, currentIndex: 0, queueRevision: 1, nowMs: 1_000,
    }));
    const stale = 1_000 + OBSERVED_QUEUE_MAX_AGE_MS + 1;
    expect(getObservedQueueEvidence(stale)).toBeNull();
    expect(peekObservedQueueEvidence()?.entries).toEqual(['a']);
    expect(observedQueueAgeMs(stale)).toBe(OBSERVED_QUEUE_MAX_AGE_MS + 1);
    expect(getF3TelemetrySnapshot().counters.observedStaleReads).toBe(1);
  });

  it('sınır aşan veya geçersiz zamanlı yük REDDEDİLİR (sessizce kabul edilmez)', () => {
    const tooMany = Array.from({ length: OBSERVED_QUEUE_MAX_ENTRIES + 1 }, (_, i) => `t${i}`);
    expect(publishObservedQueueEvidence({
      source: 'LOCAL', entries: tooMany, currentIndex: 0, revision: 1, observedAtMs: 1,
      provenance: 'NATIVE_MEDIA3', completeness: 'FULL', availability: 'AVAILABLE',
      unavailableReason: null,
    })).toBe(false);
    expect(publishObservedQueueEvidence({
      source: 'LOCAL', entries: ['a'], currentIndex: 0, revision: 1, observedAtMs: Number.NaN,
      provenance: 'NATIVE_MEDIA3', completeness: 'FULL', availability: 'AVAILABLE',
      unavailableReason: null,
    })).toBe(false);
    expect(getF3TelemetrySnapshot().counters.observedRejected).toBe(2);
    expect(getObservedQueueEvidence(2)).toBeNull();
  });

  it('canlı kanıtla MATCHED / PREFIX / DRIFT hizalaması üretilir', () => {
    createQueue('LOCAL', [entry('a'), entry('b'), entry('c')], 0);
    const q = getDesiredQueue();
    startListeningSession({
      intent: 'TRACKS', source: 'LOCAL', queueId: q.queueId, queueRevision: q.revision, nowMs: 1,
    });
    const publish = (ids: string[], length: number): void => {
      _resetProjectionCacheForTest();
      publishObservedQueueEvidence(deriveObservedQueueEvidence({
        authorityAvailable: true, activeSource: 'LOCAL', queueEntryIds: ids,
        queueLength: length, currentIndex: 0, queueRevision: 1, nowMs: Date.now(),
      }));
    };

    publish(['a', 'b', 'c'], 3);
    expect(getListeningProjection()).toMatchObject({ alignment: 'MATCHED', desiredApplied: true });

    publish(['a', 'b'], 3);
    expect(getListeningProjection()).toMatchObject({ alignment: 'PREFIX_MATCH', desiredApplied: true });

    publish(['z', 'y'], 2);
    expect(getListeningProjection()).toMatchObject({ alignment: 'PROVIDER_DRIFT', desiredApplied: false });

    const c = getF3TelemetrySnapshot().counters;
    expect(c.alignMatched).toBeGreaterThanOrEqual(1);
    expect(c.alignPrefix).toBeGreaterThanOrEqual(1);
    expect(c.alignDrift).toBeGreaterThanOrEqual(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · DOĞRULANMIŞ DEVİR → OTURUM COMMIT
 * ════════════════════════════════════════════════════════════════════════ */

function seedSession(): { sessionId: string } {
  createQueue('LOCAL', [entry('a'), entry('b')], 0);
  const q = getDesiredQueue();
  const s = startListeningSession({
    intent: 'ALBUM', intentRef: 'album:x', source: 'LOCAL',
    queueId: q.queueId, queueRevision: q.revision, nowMs: 1,
  });
  return { sessionId: s.sessionId };
}

describe('F3.2 · VERIFIED handover → session commit', () => {
  it('doğrulanmış devir oturumu yeni kaynağa taşır ve kuyruğu ADAYLARDAN kurar', async () => {
    seedSession();
    const { calls } = verifiedDispatch();

    const out = await handoverListeningToSource('STREAM', [entry('a'), entry('b')], { nowMs: 10 });

    expect(out).toMatchObject({ requested: true, committed: true });
    expect(out.decision.state).toBe('CARRIED');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ source: 'STREAM', startIndex: 0 });
    expect(getListeningSession()).toMatchObject({ currentSource: 'STREAM', continuity: 'CARRIED' });
    expect(getDesiredQueue().source).toBe('STREAM');

    const snap = getF3TelemetrySnapshot();
    expect(snap.counters).toMatchObject({
      handoverRequested: 1, handoverVerified: 1, sessionCommitted: 1,
    });
    expect(snap.lastIdentityFidelity).toBe('EXACT');
  });

  it('ACCEPTED_UNVERIFIED sonuç commit YAPAMAZ — oturum kaynağı değişmez', async () => {
    seedSession();
    stubDispatch(({ source }) => Object.freeze({
      truth: truthOf({ outcome: 'ACCEPTED_UNVERIFIED', sourceId: source, verificationLevel: 'TRANSPORT_ACK' }),
      gatewaySessionId: 'media-session-1', generation: 1,
    }));

    const out = await handoverListeningToSource('STREAM', [entry('a'), entry('b')], { nowMs: 10 });

    expect(out).toMatchObject({ requested: true, committed: false });
    expect(getListeningSession()?.currentSource).toBe('LOCAL');
    expect(getF3TelemetrySnapshot().counters).toMatchObject({
      handoverUnverified: 1, sessionCommitted: 0,
    });
  });

  it('FAILED / rollback (SUPERSEDED) sonuç commit YAPAMAZ', async () => {
    seedSession();
    stubDispatch(({ source }) => Object.freeze({
      truth: truthOf({ outcome: 'FAILED', sourceId: source, failureCode: 'source_stop_unverified' }),
      gatewaySessionId: 'media-session-1', generation: 1,
    }));
    expect(await handoverListeningToSource('STREAM', [entry('a'), entry('b')], { nowMs: 10 }))
      .toMatchObject({ requested: true, committed: false });
    expect(getListeningSession()?.currentSource).toBe('LOCAL');

    _resetListeningHandoverForTest();
    stubDispatch(({ source }) => Object.freeze({
      truth: truthOf({ outcome: 'SUPERSEDED', sourceId: source, failureCode: 'superseded' }),
      gatewaySessionId: 'media-session-1', generation: 1,
    }));
    expect(await handoverListeningToSource('STREAM', [entry('a'), entry('b')], { nowMs: 20 }))
      .toMatchObject({ requested: true, committed: false });
    expect(getListeningSession()?.currentSource).toBe('LOCAL');

    expect(getF3TelemetrySnapshot().counters).toMatchObject({
      handoverFailed: 1, handoverRollback: 1, sessionCommitted: 0,
    });
  });

  it('BROKEN süreklilikte devir komutu HİÇ gönderilmez (rastgele parça çalınmaz)', async () => {
    seedSession();
    const { calls } = verifiedDispatch();

    const out = await handoverListeningToSource('STREAM', [entry('z', 'Bambaşka')], { nowMs: 10 });

    expect(out).toMatchObject({ requested: false, committed: false });
    expect(out.decision.state).toBe('BROKEN');
    expect(calls).toHaveLength(0);
    expect(getListeningSession()).toMatchObject({ currentSource: 'LOCAL', continuity: 'BROKEN' });
  });

  it('bayat kuşak/oturum sonucu commit EDEMEZ (araya başka komut girdi)', async () => {
    seedSession();
    // Komut döndüğünde kapının kimliği İLERLEMİŞ: sonuç artık güncel dünyaya ait değil.
    stubDispatch(({ source }) => Object.freeze({
      truth: truthOf({ sessionId: 'media-session-5', sourceId: source }),
      gatewaySessionId: 'media-session-6', generation: 6,
    }));

    const out = await handoverListeningToSource('STREAM', [entry('a'), entry('b')], { nowMs: 10 });

    expect(out).toMatchObject({ requested: true, committed: false });
    expect(getListeningSession()?.currentSource).toBe('LOCAL');
    expect(getF3TelemetrySnapshot().counters.commitStaleDropped).toBe(1);
    expect(getF3TelemetrySnapshot().lastDropReason).toBe('STALE:gateway_session_advanced');
  });

  it('yinelenen VERIFIED sonuç IDEMPOTENT: ikinci commit durumu yeniden yazmaz', async () => {
    const { sessionId } = seedSession();
    verifiedDispatch();
    const out = await handoverListeningToSource('STREAM', [entry('a'), entry('b')], { nowMs: 10 });
    expect(out.committed).toBe(true);
    const afterFirst = getListeningSession();

    const again = commitCarriedSourceAfterHandover({
      token: out.token!, sessionId, target: 'STREAM', decision: out.decision,
      truth: out.truth!, gatewaySessionId: 'media-session-7', nowMs: 99,
    });

    expect(again).toBe(true);                       // idempotent: hata değil
    expect(getListeningSession()).toBe(afterFirst); // durum YENİDEN YAZILMADI
    expect(getF3TelemetrySnapshot().counters).toMatchObject({
      sessionCommitted: 1, commitDuplicateDropped: 1,
    });
  });

  it('biletsiz / superseded bilet commit EDEMEZ', async () => {
    const { sessionId } = seedSession();
    const decision = evaluateContinuity({
      previous: [identity('a')], candidates: [identity('a')], currentIndex: 0, sourceChanged: true,
    });

    expect(commitCarriedSourceAfterHandover({
      token: 'handover-uydurma', sessionId, target: 'STREAM', decision, truth: truthOf({ sourceId: 'STREAM' }),
    })).toBe(false);
    expect(getF3TelemetrySnapshot().lastDropReason).toBe('STALE:no_active_ticket');
    expect(getListeningSession()?.currentSource).toBe('LOCAL');
  });

  it('hedef uyuşmazlığı commit EDEMEZ', async () => {
    const { sessionId } = seedSession();
    verifiedDispatch();
    const out = await handoverListeningToSource('STREAM', [entry('a'), entry('b')], { nowMs: 10 });
    _resetListeningHandoverForTest();

    expect(commitCarriedSourceAfterHandover({
      token: out.token!, sessionId, target: 'YOUTUBE', decision: out.decision,
      truth: truthOf({ sourceId: 'YOUTUBE' }),
    })).toBe(false);
  });

  it('restart sonrası ESKİ devir tamamlanması geri yüklenen oturumu değiştiremez', async () => {
    const { sessionId } = seedSession();
    verifiedDispatch();
    const out = await handoverListeningToSource('STREAM', [entry('a'), entry('b')], { nowMs: 10 });
    expect(out.committed).toBe(true);

    // Süreç yeniden başladı: kalıcı kayıt okunmaya çalışılır (kayıt yok → restore false).
    _resetListeningSessionForTest();
    _resetPlayQueueForTest();
    const restored = restoreListeningSession(1_000);
    expect(restored.playbackClaim).toBe('NONE');

    // Restart ÖNCESİNE ait bilet artık hiçbir şey commit edemez.
    expect(commitCarriedSourceAfterHandover({
      token: out.token!, sessionId, target: 'STREAM', decision: out.decision, truth: out.truth!,
    })).toBe(false);
    expect(getListeningSession()).toBeNull();
  });

  it('geri yükleme ASLA çalma iddiası üretmez ve süreklilik UNKNOWN başlar', () => {
    const key = 'caros.listening.session.v1';
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
      clear: () => store.clear(),
      key: () => null, length: 0,
    });
    store.set(key, JSON.stringify({
      schema: 1, sessionId: 's', intent: 'ALBUM', intentRef: 'album:a',
      originSource: 'LOCAL', currentSource: 'LOCAL', queueId: 'q', queueRevision: 1,
      entries: [entry('a')], currentIndex: 0, startedAt: 1, savedAtMs: 1, ignitionRef: null,
    }));

    const out = restoreListeningSession(2);
    expect(out.playbackClaim).toBe('NONE');
    if (out.restored) {
      expect(getListeningSession()).toMatchObject({ continuity: 'UNKNOWN', restored: true });
    }
    vi.unstubAllGlobals();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3 · TELEMETRİ / LAB SINIRLARI + F0 REGRESYONU
 * ════════════════════════════════════════════════════════════════════════ */

describe('F3.2 · telemetry bounded ve read-only', () => {
  it('devir halkası sınırlıdır ve kayıtlar PII taşımaz', async () => {
    seedSession();
    verifiedDispatch();
    for (let i = 0; i < MAX_HANDOVER_RECORDS + 5; i += 1) {
      _resetListeningHandoverForTest();
      await handoverListeningToSource('STREAM', [entry('a'), entry('b')], { nowMs: 10 + i });
    }
    const snap = getF3TelemetrySnapshot();
    expect(snap.recentHandovers.length).toBeLessThanOrEqual(MAX_HANDOVER_RECORDS);

    const serialized = JSON.stringify(snap);
    ['content:///', 'Sanatçı', 'Albüm', 'Parça'].forEach((leak) => {
      expect(serialized).not.toContain(leak);
    });
  });

  it('telemetri okuması yan etkisizdir — okumak sayaç değiştirmez', () => {
    publishObservedQueueEvidence(deriveObservedQueueEvidence({
      authorityAvailable: true, activeSource: 'LOCAL', queueEntryIds: ['a'],
      queueLength: 1, currentIndex: 0, queueRevision: 1, nowMs: 1_000,
    }));
    const first = getF3TelemetrySnapshot().counters;
    getF3TelemetrySnapshot();
    getF3TelemetrySnapshot();
    expect(getF3TelemetrySnapshot().counters).toEqual(first);
  });

  it('LAB okuması SALT-OKUNURDUR — hiçbir üretim sayacını değiştirmez', async () => {
    const { readMediaAuthoritySnapshot } = await import('../platform/devtools/mediaAuthoritySources');
    createQueue('LOCAL', [entry('a')], 0);
    const q = getDesiredQueue();
    startListeningSession({
      intent: 'TRACKS', source: 'LOCAL', queueId: q.queueId, queueRevision: q.revision, nowMs: 1,
    });
    // Bayat kanıt: canlı yol okunsaydı `observedStaleReads` artardı.
    publishObservedQueueEvidence(deriveObservedQueueEvidence({
      authorityAvailable: true, activeSource: 'LOCAL', queueEntryIds: ['a'],
      queueLength: 1, currentIndex: 0, queueRevision: 1, nowMs: Date.now() - OBSERVED_QUEUE_MAX_AGE_MS - 5_000,
    }));
    const before = getF3TelemetrySnapshot().counters;

    const snap = readMediaAuthoritySnapshot();
    readMediaAuthoritySnapshot();

    expect(snap.observedLive).toBe(false);
    expect(snap.listeningAlignment).toBe('UNKNOWN');   // bayat kanıt "uyumlu" saymaz
    expect(getF3TelemetrySnapshot().counters).toEqual(before);
  });

  it('hiç kanıt yokken durum UNAVAILABLE — sahte 0/sağlıklı üretilmez', () => {
    const snap = getF3TelemetrySnapshot();
    expect(snap.status).toBe('UNAVAILABLE');
    expect(snap.lastObserved).toBeNull();
    expect(snap.lastCommitAtMs).toBeNull();
    expect(snap.lastIdentityFidelity).toBeNull();
  });
});

describe('F3.2 · audibleBackendCount <= 1 regresyonu', () => {
  it('devrin hiçbir fazında iki audible backend olmaz', () => {
    let state = IDLE_HANDOVER;
    const seen: number[] = [audibleBackendCount(state)];
    const events = [
      { type: 'BEGIN', to: 'STREAM' as SourceClass, atMs: 1 },
      { type: 'STOP_VERIFIED', atMs: 2 },
      { type: 'TARGET_PREPARED', atMs: 3 },
      { type: 'TARGET_PREPARED', atMs: 4 },
      { type: 'TARGET_STARTING', atMs: 5 },
      { type: 'TARGET_STARTED', atMs: 6 },
      { type: 'COMMIT', atMs: 7 },
    ] as const;
    events.forEach((e) => {
      state = reduceHandover(state, e);
      seen.push(audibleBackendCount(state));
    });
    expect(state.phase).toBe('COMMITTED');
    expect(Math.max(...seen)).toBeLessThanOrEqual(1);
  });
});
