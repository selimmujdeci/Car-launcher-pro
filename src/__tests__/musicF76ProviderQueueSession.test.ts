/**
 * musicF76ProviderQueueSession.test.ts — MUSIC F7.6 · Sağlayıcı kuyruğu +
 * dinleme oturumu KANONİKLEŞTİ.
 *
 * ÖLÇÜLEN KUSUR (F7.6 öncesi):
 *   `carosMediaLayer` içinde `_queue` · `_qIndex` · `_qRevision` adında MUTABLE
 *   bir sıra vardı. Kanonik `PlayQueue` YALNIZ kütüphane seçimleri için
 *   kuruluyordu → sağlayıcı tarafında İKİNCİ bir desired-queue sahibi doğuyor,
 *   `ListeningSession` hiç başlamıyordu (Cross-Domain §1: one domain = one
 *   authority).
 *
 * ÜRÜN KARARI (2026-09-02) — SAME-PROVIDER: kanonik kuyruk TEK `SourceClass`
 * taşır; birleşik arama karışık sağlayıcı üretir. Bu yüzden kuyruk SEÇİLEN
 * parçanın kaynak sınıfıyla SINIRLANIR. Karışık-sağlayıcı `PlayQueue` modeli
 * KURULMAZ. Dışarıda kalan satırlar SESSİZCE düşürülmez (`excludedIds`).
 *
 * Bu paket şunları kilitler:
 *   · sağlayıcı seçimi → kanonik `PlayQueue` + `ListeningSession`
 *   · same-provider sınırı (radyo şarkı kuyruğuna karışmaz)
 *   · sonraki/önceki tek kanonik kuyruk üzerinden
 *   · desired kuyruğun observed diye geri yansıtılmaması
 *   · kalıcı oturumun "çalıyor" iddiası üretmemesi
 *   · bayat devir tamamlanmasının commit edememesi
 *   · medya katmanında ikinci mutable sıra sahibinin geri gelmemesi
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildProviderQueueContext, entryFromProviderTrack, providerSourceClassFor,
  type ProviderTrackInput,
} from '../platform/media/session/providerQueueContext';
import {
  _resetPlayQueueForTest, addToQueue, createQueue, getCurrentEntry, getDesiredQueue,
  type QueueEntry,
} from '../platform/media/session/playQueue';
import {
  _resetListeningHandoverForTest, _setListeningRuntimePortsForTest, advanceQueue,
  commitCarriedSourceAfterHandover, startProviderListening,
  type DispatchArgs,
} from '../platform/media/session/listeningSessionRuntime';
import {
  _resetListeningSessionForTest, getListeningSession,
} from '../platform/media/session/listeningSession';
import {
  _resetObservedQueueEvidenceForTest, getObservedQueueEvidence,
} from '../platform/media/session/observedQueueEvidence';
import { deriveObservedQueueEvidence } from '../platform/media/session/observedQueueDerivation';
import { parsePersistedListeningSession } from '../platform/media/session/sessionPersistence';
import { _resetF3TelemetryForTest } from '../platform/media/session/sessionTelemetry';
import type { CommandTruth } from '../platform/media/authority/playbackTruth';
import type { ContinuityDecision } from '../platform/media/session/sessionContinuity';

const read = (p: string): string => readFileSync(resolve(process.cwd(), p), 'utf8');
const strip = (t: string): string =>
  t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

/** Statik kilitlerin okuduğu tek kaynak — yorumlar soyulmuş medya katmanı. */
const layerSource = strip(read('src/platform/media/carosMediaLayer.ts'));

/* ── Sağlayıcı satırı fixtureları — birleşik aramanın GERÇEK karışımı ─────── */

const yt = (id: string, title = `YT ${id}`): ProviderTrackInput => ({
  id, providerId: 'youtube', title, subtitle: 'Sanatçı',
  streamUrl: `piped:${id}`, artwork: `https://img/${id}.jpg`,
});
const sp = (id: string): ProviderTrackInput => ({
  id, providerId: 'spotify', title: `SP ${id}`, subtitle: 'Sanatçı',
  spotifyUri: `spotify:track:${id}`, spotifyDurationMs: 180_000,
});
const radio = (id: string): ProviderTrackInput => ({
  id, providerId: 'radio', title: `Radyo ${id}`, subtitle: 'Canlı',
  streamUrl: `https://radio/${id}.mp3`,
});

/* ── Enjekte edilen kapı — üretimde `mediaCommandGateway`dir ─────────────── */

interface DispatchCall { source: string; ids: string[]; startIndex: number; autoPlay: boolean }
let calls: DispatchCall[] = [];

const truthOf = (source: string, outcome: CommandTruth['outcome'] = 'VERIFIED'): CommandTruth => ({
  commandId: 'cmd-1', sessionId: 'sess-1', sourceId: source, backend: 'test',
  command: 'play', desiredState: 'PLAYING',
  observedState: outcome === 'VERIFIED' ? 'PLAYING' : 'UNKNOWN',
  outcome, verificationLevel: outcome === 'VERIFIED' ? 'RENDERING_VERIFIED' : 'NONE',
  startedAtMs: 0, endedAtMs: 1, elapsedMs: 1, failureCode: null, retryable: false, stages: [],
});

beforeEach(() => {
  calls = [];
  _resetPlayQueueForTest();
  _resetListeningSessionForTest();
  _resetListeningHandoverForTest();
  _resetObservedQueueEvidenceForTest();
  _resetF3TelemetryForTest();
  _setListeningRuntimePortsForTest({
    dispatch: (args: DispatchArgs) => {
      calls.push({
        source: args.source, ids: args.items.map((i) => i.id),
        startIndex: args.startIndex, autoPlay: args.autoPlay,
      });
      return Promise.resolve(Object.freeze({
        truth: truthOf(args.source), gatewaySessionId: 'sess-1', generation: 1,
      }));
    },
    persist: () => true,
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 1–3 · Sağlayıcı seçimi → kanonik PlayQueue + ListeningSession
 * ════════════════════════════════════════════════════════════════════════ */

describe('F7.6 · sağlayıcı seçimi kanonik kuyruğu kurar', () => {
  it('1 · YouTube seçimi kanonik PlayQueue üretir (ikinci sıra sahibi yok)', async () => {
    const ctx = buildProviderQueueContext(yt('a'), [yt('a'), yt('b'), yt('c')]);
    expect(ctx, 'çalınabilir YouTube seçimi bağlam üretmedi').not.toBeNull();
    const result = await startProviderListening(ctx!, { nowMs: 1 });

    expect(result.started).toBe(true);
    const queue = getDesiredQueue();
    expect(queue.source, 'kanonik kuyruk sağlayıcı kaynağını taşımıyor').toBe('YOUTUBE');
    expect(queue.entries.map((e) => e.identity.providerId)).toEqual(['a', 'b', 'c']);
    expect(queue.currentIndex).toBe(0);
    expect(queue.entries.every((e) => e.origin === 'PROVIDER')).toBe(true);
    /* Komut KAPIDAN gitti — sağlayıcıya doğrudan çağrı yok. */
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ source: 'YOUTUBE', startIndex: 0, autoPlay: true });
  });

  it('2 · YouTube seçimi GERÇEK bir ListeningSession başlatır', async () => {
    const ctx = buildProviderQueueContext(yt('b'), [yt('a'), yt('b')]);
    await startProviderListening(ctx!, { nowMs: 5 });

    const session = getListeningSession();
    const queue = getDesiredQueue();
    expect(session, 'sağlayıcı çalmada oturum doğmuyor').not.toBeNull();
    expect(session!.intent, 'niyet uydurulmuş').toBe('TRACKS');
    expect(session!.originSource).toBe('YOUTUBE');
    expect(session!.queueId).toBe(queue.queueId);
    expect(session!.currentItem?.providerId).toBe('b');
    expect(session!.currentItem?.providerNamespace).toBe('YOUTUBE');
    /* Seçilen parça başa ZORLANMAZ: kullanıcının gördüğü sıra korunur. */
    expect(queue.currentIndex).toBe(1);
  });

  it('3 · Spotify seçimi same-provider kuyruk kurar', async () => {
    const ctx = buildProviderQueueContext(sp('s1'), [sp('s1'), sp('s2')]);
    expect(ctx!.source).toBe('SPOTIFY_CONNECT');
    await startProviderListening(ctx!, { nowMs: 1 });

    const queue = getDesiredQueue();
    expect(queue.source).toBe('SPOTIFY_CONNECT');
    expect(queue.entries).toHaveLength(2);
    expect(queue.entries[0]!.item.uri).toBe('spotify:track:s1');
    expect(getListeningSession()!.originSource).toBe('SPOTIFY_CONNECT');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4–5 · SAME-PROVIDER sınırı
 * ════════════════════════════════════════════════════════════════════════ */

describe('F7.6 · same-provider sınırı', () => {
  it('4 · karışık sağlayıcı sonuçlarında yabancı satırlar kuyruğa GİRMEZ', () => {
    const results = [yt('a'), sp('s1'), yt('c'), radio('r1')];
    const ctx = buildProviderQueueContext(yt('a'), results);

    expect(ctx!.source).toBe('YOUTUBE');
    expect(ctx!.entries.map((e) => e.identity.providerId)).toEqual(['a', 'c']);
    /* Sessiz düşürme YOK — dışarıda kalan satırlar sayılır (LAB'da görünür). */
    expect([...ctx!.excludedIds].sort()).toEqual(['r1', 's1']);
    /* Kullanıcının gördüğü sıra DEĞİŞMEZ: 'a' önce, 'c' sonra. */
    expect(ctx!.startIndex).toBe(0);
  });

  it('5 · radyo şarkı kuyruğuna karışmaz; kendi kaynak sınıfı ve niyetini taşır', () => {
    expect(providerSourceClassFor('radio')).toBe('INTERNET_RADIO');
    expect(providerSourceClassFor('youtube')).toBe('YOUTUBE');
    expect(providerSourceClassFor('bilinmeyen'), 'tanınmayan sağlayıcıya kaynak uydurulmuş')
      .toBeNull();

    const mixed = [yt('a'), radio('r1'), radio('r2')];
    const fromRadio = buildProviderQueueContext(radio('r1'), mixed);
    expect(fromRadio!.source).toBe('INTERNET_RADIO');
    expect(fromRadio!.intent, 'canlı yayın TRACKS sayılmış').toBe('RADIO');
    expect(fromRadio!.entries.map((e) => e.identity.providerId)).toEqual(['r1', 'r2']);
    expect(fromRadio!.excludedIds).toContain('a');

    /* Ters yön: şarkı seçimi radyoyu içeri ALMAZ. */
    const fromTrack = buildProviderQueueContext(yt('a'), mixed);
    expect(fromTrack!.intent).toBe('TRACKS');
    expect(fromTrack!.entries.map((e) => e.identity.providerId)).toEqual(['a']);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 6–7 · Sonraki / önceki: TEK kanonik yol
 * ════════════════════════════════════════════════════════════════════════ */

describe('F7.6 · sağlayıcı sonraki/önceki kanonik kuyruktan geçer', () => {
  it('6 · sonraki kanonik imleci taşır ve pencereyi kapıdan yeniden yazar', async () => {
    const ctx = buildProviderQueueContext(yt('a'), [yt('a'), yt('b'), yt('c')]);
    await startProviderListening(ctx!, { nowMs: 1 });
    calls = [];

    const result = await advanceQueue(1, 2);
    expect(result.applied).toBe(true);
    expect(getDesiredQueue().currentIndex).toBe(1);
    expect(getCurrentEntry()!.identity.providerId).toBe('b');
    expect(calls, 'ilerletme kapıya inmemiş (ikinci yürütme yolu)').toHaveLength(1);
    expect(calls[0]).toMatchObject({ source: 'YOUTUBE', startIndex: 1, autoPlay: true });
  });

  it('7 · önceki kanonik imleci geri taşır; kuyruk başında SARMA YOK', async () => {
    const ctx = buildProviderQueueContext(yt('b'), [yt('a'), yt('b')]);
    await startProviderListening(ctx!, { nowMs: 1 });
    expect(getDesiredQueue().currentIndex).toBe(1);

    expect((await advanceQueue(-1, 2)).applied).toBe(true);
    expect(getDesiredQueue().currentIndex).toBe(0);

    const past = await advanceQueue(-1, 3);
    expect(past.applied, 'kuyruk başında sarma üretilmiş').toBe(false);
    expect(past.queueResult.failureCode).toBe('index_out_of_range');
    expect(getDesiredQueue().currentIndex).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 8–9 · Eski mutable sıra sahipliği geri GELMEZ (statik kilit)
 * ════════════════════════════════════════════════════════════════════════ */

describe('F7.6 · medya katmanı kuyruk otoritesi DEĞİLDİR', () => {
  it('8 · `_queue` · `_qIndex` · `_qRevision` mutable sıra sahibi geri gelmemiş', () => {
    expect(layerSource.length, 'medya katmanı okunamadı — kilit boş kümeye düştü')
      .toBeGreaterThan(2000);
    expect(layerSource, 'ikinci mutable sıra sahibi geri gelmiş').not.toMatch(/\b_queue\b/);
    expect(layerSource, 'ikinci imleç sahibi geri gelmiş').not.toMatch(/\b_qIndex\b/);
    expect(layerSource, 'ikinci revizyon sayacı geri gelmiş').not.toMatch(/\b_qRevision\b/);
    /* Sıra/imleç KANONİK kaynaktan okunur. */
    expect(layerSource, 'kanonik kuyruk okuması kaldırılmış').toContain('getDesiredQueue');
    expect(layerSource, 'kanonik oturum başlatma kaldırılmış').toContain('startProviderListening');
  });

  it('9 · `_trackByEntryId` yalnız SUNUM önbelleğidir — sıra/imleç otoritesi değil', () => {
    /* Yalnız `Map` lookup'ı olarak kullanılmalı: dizi indeksleme, sıralama veya
       imleç aritmetiği yapılmamalı. */
    expect(layerSource, 'sunum önbelleği kaybolmuş').toContain('_trackByEntryId');
    expect(layerSource, 'önbellek dizi/sıra gibi kullanılmış')
      .not.toMatch(/_trackByEntryId\s*\[/);
    expect(layerSource, 'önbellek sıralama otoritesine dönüşmüş')
      .not.toMatch(/_trackByEntryId\.(sort|splice|indexOf|slice|unshift|push)\b/);
    /* Katmanın kendi imleç durumu OLMAMALI. */
    expect(layerSource, 'katman kendi imlecini tutmuş')
      .not.toMatch(/\blet\s+_currentIndex\b/);
    /* Kuyruk görünümü kanonik kuyruktan TÜRETİLMELİ. */
    expect(layerSource, 'kuyruk görünümü kanonik kaynaktan türetilmiyor')
      .toContain('getDesiredQueueView');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 10–13 · Dürüstlük kapıları
 * ════════════════════════════════════════════════════════════════════════ */

describe('F7.6 · desired kuyruk observed diye yansıtılmaz', () => {
  it('10 · sağlayıcı kuyruğu kurulması ObservedQueue kanıtı ÜRETMEZ', async () => {
    const ctx = buildProviderQueueContext(yt('a'), [yt('a'), yt('b')]);
    await startProviderListening(ctx!, { nowMs: 1 });

    expect(getDesiredQueue().entries).toHaveLength(2);
    expect(getObservedQueueEvidence(2), 'desired kuyruk observed diye yayımlanmış')
      .toBeNull();

    /* Native'in kendisi bile YouTube için timeline sunamaz: UNAVAILABLE + gerekçe. */
    const derived = deriveObservedQueueEvidence({
      authorityAvailable: true, activeSource: 'YOUTUBE',
      queueEntryIds: ['a', 'b'], queueLength: 2, currentIndex: 0,
      queueRevision: 1, nowMs: 2,
    });
    expect(derived.availability).toBe('UNAVAILABLE');
    expect(derived.unavailableReason).toBe('source_reports_no_timeline');
    expect(derived.entries, 'kanıtsız sıra üretilmiş').toHaveLength(0);
  });
});

describe('F7.6 · kalıcı sağlayıcı oturumu canlı gerçek DEĞİLDİR', () => {
  it('11 · geri yüklenen sağlayıcı oturumu PLAYING iddiası üretmez', () => {
    const entry: QueueEntry = entryFromProviderTrack(yt('a'), 0);
    const raw = JSON.stringify({
      schema: 1, sessionId: 's-1', intent: 'TRACKS', intentRef: null,
      originSource: 'YOUTUBE', currentSource: 'YOUTUBE', queueId: 'q-1', queueRevision: 1,
      entries: [entry], currentIndex: 0, startedAt: 1, savedAtMs: 1, ignitionRef: null,
    });
    const parsed = parsePersistedListeningSession(raw, 2);
    expect(parsed.rejection).toBeNull();
    expect(parsed.playbackClaim, 'kayıt "çalıyor" iddiası üretmiş').toBe('NONE');
    expect(parsed.restored!.currentSource).toBe('YOUTUBE');
    /* Kayıt yüklendi diye kapıya komut GİTMEZ. */
    expect(calls, 'kayıt geri yüklemesi otomatik çalma tetiklemiş').toHaveLength(0);
  });
});

describe('F7.6 · bayat sağlayıcı tamamlanması commit EDEMEZ', () => {
  it('12 · süresi geçmiş devir bileti oturuma yazamaz', async () => {
    const ctx = buildProviderQueueContext(yt('a'), [yt('a'), yt('b')]);
    await startProviderListening(ctx!, { nowMs: 1 });
    const session = getListeningSession()!;

    const decision = Object.freeze({
      state: 'CARRIED', reason: 'test', carried: [], resumeCandidateIndex: 0,
    }) as unknown as ContinuityDecision;

    /* Canlı bilet YOK (`startProviderListening` bileti sıfırlar) → commit DÜŞER. */
    const committed = commitCarriedSourceAfterHandover({
      token: 'handover-eski', sessionId: session.sessionId, target: 'YOUTUBE',
      decision, truth: truthOf('YOUTUBE'), gatewaySessionId: 'sess-1', nowMs: 3,
    });
    expect(committed, 'bayat devir tamamlanması oturuma yazabilmiş').toBe(false);
    expect(getListeningSession()!.currentSource).toBe('YOUTUBE');
  });

  it('13 · desteklenmeyen yetenek FAIL-CLOSED — sahte başarı üretilmez', async () => {
    /* Harici MediaSession: `prepare/start` gerçekten reddedilir → gezinme
       uygulanamaz; sıra düzenlemesi de sahte başarı DÖNMEZ. */
    const entries = [entryFromProviderTrack(yt('a'), 0), entryFromProviderTrack(yt('b'), 1)];
    expect(createQueue('EXTERNAL_MEDIA_SESSION', entries, 0).status).toBe('APPLIED');
    calls = [];

    const nav = await advanceQueue(1, 2);
    expect(nav.applied).toBe(false);
    expect(nav.queueResult.failureCode).toBe('unsupported_capability');
    expect(getDesiredQueue().currentIndex, 'reddedilen gezinme imleci taşımış').toBe(0);
    expect(calls, 'reddedilen mutasyon yine de nativee yazılmış').toHaveLength(0);

    /* YouTube'da kuyruk DÜZENLEMESİ (backend sırası iddiası) hâlâ reddedilir. */
    _resetPlayQueueForTest();
    createQueue('YOUTUBE', entries, 0);
    expect(addToQueue([entryFromProviderTrack(yt('c'), 2)]))
      .toMatchObject({ status: 'REJECTED', failureCode: 'unsupported_capability' });
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 14–15 · Regresyon: LOCAL yolu ve sesli seçim
 * ════════════════════════════════════════════════════════════════════════ */

describe('F7.6 · mevcut yollar bozulmadı', () => {
  it('14 · LOCAL kütüphane yolu DEĞİŞMEDİ (kuyruk düzenlemesi hâlâ meşru)', () => {
    const local: QueueEntry[] = [0, 1].map((i) => Object.freeze({
      entryId: `media:vol:${i}#${i}`,
      identity: {
        libraryId: `media:vol:${i}`, providerId: `media:vol:${i}`,
        providerNamespace: 'MEDIASTORE', contentUri: `content:///${i}`,
        title: `Parça ${i}`, artist: 'Sanatçı', album: 'Albüm',
        durationMs: 1000, trackNumber: i + 1, discNumber: 1,
      },
      item: { id: `media:vol:${i}`, uri: `content:///${i}`, title: `Parça ${i}`, artist: 'Sanatçı' },
      origin: 'LIBRARY' as const,
      libraryRef: null,
    }));
    expect(createQueue('LOCAL', local, 0).status).toBe('APPLIED');
    expect(getDesiredQueue().source).toBe('LOCAL');
    /* LOCAL backend'in GERÇEK kuyruğu vardır — düzenleme reddedilmez. */
    expect(addToQueue([entryFromProviderTrack(yt('x'), 9)]).status).toBe('APPLIED');
    expect(getDesiredQueue().entries).toHaveLength(3);

    /* Medya katmanı cihaz parçasında sağlayıcı kuyruğu KURMAZ. */
    expect(layerSource, 'yerel parça kanonik yerel ön kapısından çıkarılmış')
      .toContain('playLocalSelection');
  });

  it('15 · sesli seçim AYNI kanonik hattan iner (ikinci sağlayıcı yolu yok)', () => {
    const voice = layerSource.slice(layerSource.indexOf('export async function playByQuery'));
    expect(voice.length, 'sesli çalma yolu okunamadı — kilit boş kümeye düştü')
      .toBeGreaterThan(300);
    /* Sağlayıcı sonucu kanonik `playMedia` girişinden geçmeli. */
    expect(voice, 'sesli seçim kanonik giriş yerine başka yol kullanmış')
      .toMatch(/playMedia\s*\(/);
    /* Sesli yol kendi sağlayıcı komutunu KURMAMALI. */
    expect(voice, 'sesli yol doğrudan sağlayıcıya inmiş').not.toMatch(/\bplayYouTube\s*\(/);
    expect(voice, 'sesli yol doğrudan sağlayıcıya inmiş').not.toMatch(/\bplaySpotifyTrack\s*\(/);
    /* Sıralama/orkestrasyon kanonik arama koordinatöründen gelmeli. */
    expect(voice, 'sesli yol ikinci sıralama kurmuş').toContain('playByVoiceQuery');
    /* UI seçimi de aynı girişi kullanır — kuyruğu kendisi kurmaz. */
    const ui = strip(read('src/components/media/MediaScreen.tsx'));
    expect(ui, 'UI sağlayıcı kuyruğunu kendisi kurmuş')
      .not.toContain('buildProviderQueueContext');
    expect(ui, 'UI kanonik kuyruğu doğrudan mutasyona uğratmış')
      .not.toContain('session/playQueue');
  });
});
