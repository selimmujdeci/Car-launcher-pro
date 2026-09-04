/**
 * musicF9MaviMusicCompanion.test.ts — MUSIC F9 · Mavi Müzik Companion.
 *
 * F9'un tek işi şudur: doğal dili KANONİK müzik otoritelerine devretmek ve
 * dönen kanıttan FAZLA konuşmamak. Bu paket şunları kilitler:
 *   · Mavi requester'dır — ikinci playback/queue/search/ranking otoritesi YOK
 *   · `ACCEPTED_UNVERIFIED` asla "çalıyor" cümlesi kurduramaz
 *   · belirsizlikte kör autoplay YOK
 *   · açık kaynak isteğinde SESSİZ kaynak değişimi YOK
 *   · desteklenmeyen kuyruk mutasyonu dürüstçe reddedilir
 *   · bağlamsal istek kanıt yoksa sahte öneri ÜRETMEZ
 *   · bayat tur iddiaya dönüşmez
 *   · teknik neden kodu kullanıcıya OKUNMAZ
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  claimGradeFor, makeIntent, makeOutcome, type MusicIntentOutcome,
} from '../platform/media/intent/musicIntent';
import { detectSourceQualifier, resolveMusicIntent } from '../platform/media/intent/musicIntentResolver';
import { claimIsHonest, speakMusicOutcome } from '../platform/media/intent/musicIntentSpeech';
import {
  _resetMusicIntentRouterForTest, _setMusicIntentPortsForTest, dispatchMusicIntent,
  statusFromCommandResult, statusFromTruth,
} from '../platform/media/intent/musicIntentRouter';
import {
  _resetMusicIntentTelemetryForTest, getMusicIntentTelemetry,
} from '../platform/media/intent/musicIntentTelemetry';
import type { CommandTruth } from '../platform/media/authority/playbackTruth';

const read = (p: string): string => readFileSync(resolve(process.cwd(), p), 'utf8');
const strip = (t: string): string =>
  t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

const truth = (o: Partial<CommandTruth> = {}): CommandTruth => ({
  commandId: 'c1', sessionId: 's1', sourceId: 'LOCAL', backend: 'test', command: 'play',
  desiredState: 'PLAYING', observedState: 'PLAYING', outcome: 'VERIFIED',
  verificationLevel: 'RENDERING_VERIFIED', startedAtMs: 0, endedAtMs: 1, elapsedMs: 1,
  failureCode: null, retryable: false, stages: [], ...o,
});

/** Kanonik arama sonucu — F5 şekli (yalnız testin ihtiyacı kadar). */
const searchResult = (o: {
  id: string; provider: string; origin?: 'LIBRARY' | 'PROVIDER';
  title?: string; artist?: string | null; score?: number; matchKind?: string;
}) => ({
  resultId: `${o.provider}:${o.id}`,
  kind: 'TRACK',
  title: o.title ?? `Parça ${o.id}`,
  artist: o.artist === undefined ? 'Sanatçı' : o.artist,
  album: null,
  artworkIdentity: null,
  identity: {
    libraryId: o.origin === 'PROVIDER' ? null : o.id,
    providerId: o.id,
    providerNamespace: o.provider.toUpperCase(),
    contentUri: `x://${o.id}`,
    title: o.title ?? `Parça ${o.id}`,
    artist: 'Sanatçı', album: null, durationMs: null, trackNumber: null, discNumber: null,
  },
  libraryTrackId: o.origin === 'PROVIDER' ? null : o.id,
  availability: 'AVAILABLE',
  provenance: { providerId: o.provider, origin: o.origin ?? 'LIBRARY' },
  evidence: { score: o.score ?? 10, signals: [], matchKind: o.matchKind ?? 'EXACT' },
  alternates: [],
});

/** Varsayılan portlar — hiçbiri gerçek otoriteye inmez. */
function ports(over: Record<string, unknown> = {}) {
  const base = {
    gateway: () => Promise.resolve({
      play: () => Promise.resolve(truth()),
      pause: () => Promise.resolve(truth({ command: 'pause' })),
      stop: () => Promise.resolve(truth({ command: 'stop' })),
      seek: () => Promise.resolve(truth({ command: 'seek' })),
      getActiveSource: () => 'LOCAL',
      getEffectiveVolume: () => 0.5,
      setUserVolumePercent: () => Promise.resolve(),
      setMuted: () => Promise.resolve(),
    }),
    layer: () => Promise.resolve({
      next: () => Promise.resolve({ dispatched: true, verified: true, failureCode: null }),
      previous: () => Promise.resolve({ dispatched: true, verified: true, failureCode: null }),
      resumeLastMedia: () => true,
      playMedia: () => undefined,
      unifiedFromSearchResult: (r: { identity: { providerId: string }; title: string }) =>
        ({ id: r.identity.providerId, providerId: 'youtube', title: r.title, subtitle: '' }),
    }),
    registry: () => Promise.resolve({ ensureSearchSourcesConfigured: () => Promise.resolve() }),
    search: () => Promise.resolve({
      searchOnce: () => Promise.resolve({ results: [], emptyReason: 'NO_MATCH' }),
    }),
    selection: () => Promise.resolve({
      selectSearchResult: () => Promise.resolve({
        outcome: 'STARTED', reason: 'ok', listening: { truth: truth() },
      }),
    }),
    sessionRuntime: () => Promise.resolve({
      playQueueEntryNext: () => Promise.resolve({
        applied: true, queueResult: { failureCode: null }, truth: truth(), reason: 'ok',
      }),
      removeQueueEntryAt: () => Promise.resolve({
        applied: true, queueResult: { failureCode: null }, truth: truth(), reason: 'ok',
      }),
      jumpToQueueIndex: () => Promise.resolve({
        applied: true, queueResult: { failureCode: null }, truth: truth(), reason: 'ok',
      }),
    }),
    playQueue: () => Promise.resolve({
      getDesiredQueue: () => ({ entries: [{}, {}, {}], currentIndex: 0, source: 'LOCAL' }),
    }),
    intelligence: () => Promise.resolve({
      evaluateForExplicitRequest: () => ({
        candidate: null, confidence: 'NONE', bucket: 'UNKNOWN',
        motion: 'UNKNOWN', journey: 'UNKNOWN', hasEvidence: false,
      }),
      resolveCandidateLabel: () => null,
      applyIntelligenceCandidate: () => Promise.resolve(false),
    }),
    ...over,
  };
  _setMusicIntentPortsForTest(base as any);
}

beforeEach(() => {
  _resetMusicIntentRouterForTest();
  _resetMusicIntentTelemetryForTest();
});

/* ══════════════════════════════════════════════════════════════════════════
 * 1–3 · NİYET ÇÖZÜMÜ (yerel · deterministik · uydurmasız)
 * ════════════════════════════════════════════════════════════════════════ */

describe('F9 · niyet çözümü yereldir ve uydurmaz', () => {
  it('1 · taşıma · kuyruk · devam · bağlamsal komutlar doğru niyete çözülür', () => {
    expect(resolveMusicIntent('bunu durdur')?.kind).toBe('PAUSE');
    expect(resolveMusicIntent('sonraki')?.kind).toBe('NEXT');
    expect(resolveMusicIntent('önceki')?.kind).toBe('PREVIOUS');
    expect(resolveMusicIntent('şarkıyı baştan al')?.kind).toBe('RESTART_TRACK');
    expect(resolveMusicIntent('bunu sonraki çal')?.kind).toBe('PLAY_NEXT');
    expect(resolveMusicIntent('sıradakini kaldır')?.kind).toBe('REMOVE_CURRENT');
    expect(resolveMusicIntent('sırayı temizle')?.kind).toBe('CLEAR_UPCOMING');
    expect(resolveMusicIntent('kaldığım yerden devam et')?.kind).toBe('CONTINUE_LISTENING');
    expect(resolveMusicIntent('az önce dinlediğim şeyi aç')?.kind).toBe('RESUME_CONTEXT');
    expect(resolveMusicIntent('yola uygun bir şey aç')?.kind).toBe('PLAY_SOMETHING_FOR_DRIVE');
    expect(resolveMusicIntent('biraz daha hareketli bir şey aç')?.kind)
      .toBe('PLAY_SOMETHING_MORE_ENERGETIC');
    expect(resolveMusicIntent('müziği biraz kıs')?.kind).toBe('VOLUME_DOWN');
  });

  it('2 · müzik olmayan ifade niyet ÜRETMEZ (yanlış şarkı çalmaktansa sessizlik)', () => {
    expect(resolveMusicIntent('eve git')).toBeNull();
    expect(resolveMusicIntent('hava nasıl')).toBeNull();
    expect(resolveMusicIntent('')).toBeNull();
  });

  it('3 · kaynak niteleyicisi sorgudan AYRIŞIR, sorgu metnini kirletmez', () => {
    const yt = resolveMusicIntent("youtube'dan sezen aksu aç");
    expect(yt?.kind).toBe('PLAY_QUERY');
    expect(yt?.source?.providerId).toBe('youtube');
    expect(yt?.query).toContain('sezen aksu');
    expect(yt?.query, 'kaynak adı sorguya sızmış').not.toContain('youtube');

    expect(detectSourceQualifier('spotifyden bir şey aç')?.providerId).toBe('spotify');
    expect(resolveMusicIntent('cihazdaki müzikleri aç')?.source?.providerId).toBe('local');
    /* Sorgusuz "müzik aç" rastgele bir şey çalmaz — kanonik devam yolu. */
    expect(resolveMusicIntent('müzik aç')?.kind).toBe('CONTINUE_LISTENING');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4–6 · SÖYLENEN İDDİA ↔ KANIT (en kritik kilit)
 * ════════════════════════════════════════════════════════════════════════ */

describe('F9 · söylenen iddia kanıtı AŞAMAZ', () => {
  const outcomeOf = (status: Parameters<typeof claimGradeFor>[0], reason = 'ok'): MusicIntentOutcome =>
    makeOutcome(makeIntent('PLAY'), 'F0_COMMAND_GATEWAY', status, reason);

  it('4 · kanıt sınıfları doğru iddiaya eşlenir', () => {
    expect(claimGradeFor('VERIFIED')).toBe('CONFIRMED');
    expect(claimGradeFor('ACCEPTED_UNVERIFIED')).toBe('ATTEMPTED');
    expect(claimGradeFor('AMBIGUOUS')).toBe('NEEDS_CHOICE');
    for (const s of ['REJECTED', 'UNAVAILABLE', 'FAILED', 'NOT_ATTEMPTED'] as const) {
      expect(claimGradeFor(s)).toBe('DECLINED');
    }
    expect(statusFromTruth(truth({ outcome: 'ACCEPTED_UNVERIFIED' }))).toBe('ACCEPTED_UNVERIFIED');
    expect(statusFromTruth(truth({ outcome: 'SUPERSEDED' })), 'bayat sonuç başarı sayılmış')
      .toBe('REJECTED');
    expect(statusFromCommandResult({ dispatched: false, verified: false, failureCode: 'x' }))
      .toBe('NOT_ATTEMPTED');
  });

  it('5 · doğrulanmamış komut ASLA tamamlanmış eylem cümlesi kurduramaz', () => {
    const confirmed = speakMusicOutcome(outcomeOf('VERIFIED'));
    expect(confirmed).toBe('Çalıyor.');
    expect(claimIsHonest(outcomeOf('VERIFIED'), confirmed)).toBe(true);

    for (const status of ['ACCEPTED_UNVERIFIED', 'REJECTED', 'FAILED', 'UNAVAILABLE',
      'NOT_ATTEMPTED', 'AMBIGUOUS'] as const) {
      const o = outcomeOf(status);
      const spoken = speakMusicOutcome(o);
      expect(claimIsHonest(o, spoken), `${status} için sahte başarı cümlesi: "${spoken}"`)
        .toBe(true);
      expect(spoken.toLocaleLowerCase('tr-TR'), `${status} "çalıyor" dedi`)
        .not.toContain('çalıyor');
    }
  });

  it('6 · teknik neden kodu KULLANICIYA OKUNMAZ', () => {
    for (const code of ['unsupported_capability', 'queue_unsupported', 'sources_unavailable',
      'stale_reference', 'no_context_evidence', 'provider_no_results']) {
      const spoken = speakMusicOutcome(
        makeOutcome(makeIntent('PLAY_NEXT'), 'F3_QUEUE_AUTHORITY', 'REJECTED', code),
      );
      expect(spoken, `teknik kod okundu: ${code}`).not.toContain(code);
      expect(spoken.length, 'boş/anlamsız cevap').toBeGreaterThan(5);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 7–9 · TAŞIMA · ARAMA · KAYNAK NİTELEYİCİSİ
 * ════════════════════════════════════════════════════════════════════════ */

describe('F9 · kanonik yönlendirme', () => {
  it('7 · taşıma kapıdan; sonraki/önceki KUYRUK-FARKINDA girişten geçer', async () => {
    ports();
    const play = await dispatchMusicIntent(makeIntent('PLAY'));
    expect(play.route).toBe('F0_COMMAND_GATEWAY');
    expect(play.status).toBe('VERIFIED');

    const next = await dispatchMusicIntent(makeIntent('NEXT'));
    expect(next.route, 'atlama kuyruk-farkında girişten geçmiyor').toBe('F3_QUEUE_AUTHORITY');
    expect(next.status).toBe('VERIFIED');

    /* Kuyruk-farkında giriş "gönderildi ama doğrulanmadı" derse iddia düşer. */
    ports({
      layer: () => Promise.resolve({
        next: () => Promise.resolve({ dispatched: true, verified: false, failureCode: null }),
        previous: () => Promise.resolve({ dispatched: true, verified: false, failureCode: null }),
        resumeLastMedia: () => true, playMedia: () => undefined,
        unifiedFromSearchResult: () => ({}),
      }),
    });
    const unverified = await dispatchMusicIntent(makeIntent('NEXT'));
    expect(unverified.status).toBe('ACCEPTED_UNVERIFIED');
    expect(unverified.claim).toBe('ATTEMPTED');
  });

  it('8 · arama F5 seçim yolundan geçer; belirsizde KÖR autoplay YOK', async () => {
    ports({
      search: () => Promise.resolve({
        searchOnce: () => Promise.resolve({
          results: [searchResult({ id: 'a', provider: 'local' })], emptyReason: null,
        }),
      }),
    });
    const ok = await dispatchMusicIntent(makeIntent('PLAY_QUERY', { query: 'metallica' }));
    expect(ok.route).toBe('F5_SEARCH_SELECTION');
    expect(ok.status).toBe('VERIFIED');
    expect(ok.subject, 'ne çalındığı söylenmiyor').toContain('Parça a');

    /* Kanıtsız eşleşme (matchKind NONE) → otomatik çalma YOK, netleştirme var. */
    ports({
      search: () => Promise.resolve({
        searchOnce: () => Promise.resolve({
          results: [
            searchResult({ id: 'x', provider: 'local', matchKind: 'NONE', score: 0, title: 'Duman' }),
            searchResult({ id: 'y', provider: 'youtube', matchKind: 'NONE', score: 0, title: 'Duman 2' }),
          ],
          emptyReason: null,
        }),
      }),
    });
    const ambiguous = await dispatchMusicIntent(makeIntent('PLAY_QUERY', { query: 'duman' }));
    expect(ambiguous.status).toBe('AMBIGUOUS');
    expect(ambiguous.claim).toBe('NEEDS_CHOICE');
    expect(ambiguous.choices.length).toBeGreaterThan(0);
    expect(speakMusicOutcome(ambiguous)).toContain('Hangisi');
  });

  it('9 · açık kaynak isteğinde SESSİZ kaynak değişimi YOK', async () => {
    /* Kullanıcı "Spotify'dan" dedi ama sonuçlar YouTube'da → sessizce YouTube
       çalınmaz; dürüstçe söylenir ve alternatif TEKLİF edilir. */
    ports({
      search: () => Promise.resolve({
        searchOnce: () => Promise.resolve({
          results: [searchResult({ id: 'y1', provider: 'youtube', origin: 'PROVIDER', title: 'Şarkı' })],
          emptyReason: null,
        }),
      }),
    });
    const held = await dispatchMusicIntent(makeIntent('PLAY_QUERY', {
      query: 'sezen aksu', source: { providerId: 'spotify', spoken: 'spotifyden' },
    }));
    expect(held.status).toBe('UNAVAILABLE');
    expect(held.reasonCode).toBe('provider_no_results');
    expect(getMusicIntentTelemetry().counters.sourceHeld).toBe(1);
    const spoken = speakMusicOutcome(held);
    expect(spoken).toContain('Bu kaynakta sonuç bulamadım');
    expect(spoken, 'alternatif teklif edilmiyor').toContain('ister misin');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 10–11 · KUYRUK · BAĞLAMSAL İSTEK
 * ════════════════════════════════════════════════════════════════════════ */

describe('F9 · kuyruk ve bağlamsal istekler dürüsttür', () => {
  it('10 · desteklenmeyen kuyruk mutasyonu REDDEDİLİR; sahte başarı yok', async () => {
    ports({
      sessionRuntime: () => Promise.resolve({
        playQueueEntryNext: () => Promise.resolve({
          applied: false, queueResult: { failureCode: 'unsupported_capability' },
          truth: null, reason: 'no',
        }),
        removeQueueEntryAt: () => Promise.resolve({
          applied: false, queueResult: { failureCode: 'unsupported_capability' },
          truth: null, reason: 'no',
        }),
        jumpToQueueIndex: () => Promise.resolve({
          applied: false, queueResult: { failureCode: 'unsupported_capability' },
          truth: null, reason: 'no',
        }),
      }),
    });
    const r = await dispatchMusicIntent(makeIntent('PLAY_NEXT'));
    expect(r.status).toBe('REJECTED');
    expect(r.reasonCode).toBe('unsupported_capability');
    expect(claimIsHonest(r, speakMusicOutcome(r))).toBe(true);
    expect(getMusicIntentTelemetry().counters.queueUnsupported).toBeGreaterThan(0);

    /* Kanonik kuyrukta olmayan işlem UYDURULMAZ. */
    ports();
    const clear = await dispatchMusicIntent(makeIntent('CLEAR_UPCOMING'));
    expect(clear.status).toBe('REJECTED');
    expect(clear.reasonCode).toBe('queue_unsupported');

    /* Aktif kuyruk yoksa komut denenmez. */
    ports({ playQueue: () => Promise.resolve({ getDesiredQueue: () => ({ entries: [], currentIndex: -1, source: null }) }) });
    const empty = await dispatchMusicIntent(makeIntent('REMOVE_CURRENT'));
    expect(empty.reasonCode).toBe('no_active_queue');
  });

  it('11 · bağlamsal istek: kanıt yoksa SAHTE öneri yok, varsa kanonik yol', async () => {
    ports();   // hasEvidence: false
    const none = await dispatchMusicIntent(makeIntent('PLAY_SOMETHING_FOR_DRIVE'));
    expect(none.route).toBe('F8_CONTEXT_EVIDENCE');
    expect(none.status).toBe('UNAVAILABLE');
    expect(none.reasonCode).toBe('no_context_evidence');
    expect(none.usedContextEvidence).toBe(false);
    const spoken = speakMusicOutcome(none);
    expect(spoken, 'kanıtsızken güçlü kişisel iddia kurulmuş')
      .not.toMatch(/senin için|seversin|ruh hâlin|ruh halin/i);
    expect(spoken).toContain('kaldığın yerden');

    /* MUSIC F10'da YENİDEN BAĞLANDI (kaldırılmadı): korunan değişmez aynı —
       ruh hâli isteği KANIT OLMADAN sahte seçim üretemez. Değişen tek şey
       reddin ARTIK KARAKTER YOLUNDAN gelmesidir: referans parçanın kanıtı
       yoksa göreceli kıyas kurulamaz (`trait_reference_unavailable`). */
    const mood = await dispatchMusicIntent(makeIntent('PLAY_SOMETHING_CALMER'));
    expect(mood.route).toBe('F10_TRAIT_EVIDENCE');
    expect(mood.status, 'kanıtsız ruh hâli isteği bir şey başlattı').toBe('UNAVAILABLE');
    expect(mood.reasonCode).toMatch(/^trait_(reference|evidence|no_candidate)/);
    expect(claimIsHonest(mood, speakMusicOutcome(mood))).toBe(true);

    /* Kanıt VARSA kanonik uygulama yolundan geçer. */
    const applied = vi.fn(() => Promise.resolve(true));
    ports({
      intelligence: () => Promise.resolve({
        evaluateForExplicitRequest: () => ({
          candidate: { selection: { kind: 'ALBUM', albumId: 'album:1' }, intent: 'ALBUM',
            sourceClass: 'LOCAL', keptCount: 4, abandonedCount: 0 },
          confidence: 'HIGH', bucket: 'HIGHWAY_NIGHT', motion: 'HIGHWAY',
          journey: 'START', hasEvidence: true,
        }),
        resolveCandidateLabel: () => ({ title: 'Gece Albümü', subtitle: null }),
        applyIntelligenceCandidate: applied,
      }),
    });
    const ok = await dispatchMusicIntent(makeIntent('PLAY_SOMETHING_FOR_DRIVE'));
    expect(applied).toHaveBeenCalledTimes(1);
    expect(ok.usedContextEvidence).toBe(true);
    expect(ok.status, 'kanıtsız doğrulama iddiası').toBe('ACCEPTED_UNVERIFIED');
    expect(speakMusicOutcome(ok)).toContain('Gece Albümü');
    expect(getMusicIntentTelemetry().counters.contextualFulfilled).toBe(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 12–13 · BAYATLIK · ÇEVRİMDIŞI
 * ════════════════════════════════════════════════════════════════════════ */

describe('F9 · bayat tur ve çevrimdışı davranış', () => {
  it('12 · eski turun sonucu YENİ turun iddiasını kuramaz', async () => {
    let release: (() => void) | null = null;
    const slow = new Promise<void>((r) => { release = r; });
    ports({
      search: () => Promise.resolve({
        searchOnce: async () => {
          await slow;
          return { results: [searchResult({ id: 'a', provider: 'local' })], emptyReason: null };
        },
      }),
    });
    const first = dispatchMusicIntent(makeIntent('PLAY_QUERY', { query: 'ilk' }));
    /* Araya YENİ bir komut girer → eski tur artık konuşamaz. */
    await dispatchMusicIntent(makeIntent('PAUSE'));
    release?.();
    const result = await first;
    expect(result.status, 'bayat tur başarı iddiası kurdu').toBe('REJECTED');
    expect(result.reasonCode).toBe('superseded');
    expect(getMusicIntentTelemetry().counters.staleDrops).toBeGreaterThan(0);
  });

  it('13 · bulut YOKKEN temel taşıma ve devam çalışmaya devam eder', async () => {
    /* Niyet çözümü tamamen yereldir — ağ/LLM gerektirmez. */
    expect(resolveMusicIntent('durdur')?.kind).toBe('PAUSE');
    ports();
    const pause = await dispatchMusicIntent(makeIntent('PAUSE'));
    expect(pause.status).toBe('VERIFIED');
    const resume = await dispatchMusicIntent(makeIntent('CONTINUE_LISTENING'));
    expect(resume.route).toBe('F3_SESSION_RESUME');
    expect(resume.status, 'devam yolu kanıtsız BAŞARI iddia etti').toBe('ACCEPTED_UNVERIFIED');

    /* Devam edilecek bağlam yoksa dürüstçe söylenir. */
    ports({
      layer: () => Promise.resolve({
        resumeLastMedia: () => false, next: () => Promise.resolve({}), previous: () => Promise.resolve({}),
        playMedia: () => undefined, unifiedFromSearchResult: () => ({}),
      }),
    });
    const empty = await dispatchMusicIntent(makeIntent('RESUME_CONTEXT'));
    expect(empty.reasonCode).toBe('no_resume_context');
    expect(speakMusicOutcome(empty)).toContain('Kaldığın bir yer bulamadım');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 14–15 · AUTHORITY SINIRI (statik kilit)
 * ════════════════════════════════════════════════════════════════════════ */

describe('F9 · Mavi müzik katmanı ikinci otorite DEĞİLDİR', () => {
  const router = strip(read('src/platform/media/intent/musicIntentRouter.ts'));
  const resolver = strip(read('src/platform/media/intent/musicIntentResolver.ts'));
  const speech = strip(read('src/platform/media/intent/musicIntentSpeech.ts'));

  it('14 · router sağlayıcı/native/queue mutasyonuna DOĞRUDAN inemez', () => {
    expect(router.length, 'router okunamadı — kilit boş kümeye düştü').toBeGreaterThan(2000);
    expect(router, 'native köprüye inmiş').not.toContain('nativeAuthorityBridge');
    expect(router, 'sağlayıcıya doğrudan inmiş').not.toMatch(/\bplayYouTube\s*\(/);
    expect(router, 'sağlayıcıya doğrudan inmiş').not.toMatch(/\bplaySpotifyTrack\s*\(/);
    expect(router, 'kanonik kuyruğu doğrudan mutasyona uğratmış')
      .not.toMatch(/\b(createQueue|addToQueue|reorder|removeAt|setCurrentIndex)\s*\(/);
    expect(router, 'MusicIndex yazımı yapmış').not.toContain('reconcileMusicIndex');
    expect(router, 'F8 tercih kanıtına YAZMIŞ').not.toContain('notePreferenceOutcome');
    expect(router, 'duck otoritesine el atmış').not.toContain('duckRequest');
    expect(router, 'sürüş güvenlik kapısını bypass etmiş').not.toContain('videoModeStore');
    /* Kanonik sahiplerden geçmeli. */
    expect(router, 'kanonik komut kapısı kullanılmıyor').toContain('mediaCommandGateway');
    expect(router, 'kanonik seçim yolu kullanılmıyor').toContain('searchSelection');
  });

  it('15 · saf katmanlar SAF kalır; F9 kendi sıralamasını KURMAZ', () => {
    for (const [name, src] of [['çözümleyici', resolver], ['konuşma', speech]] as const) {
      expect(src.length, `${name} okunamadı — kilit boş kümeye düştü`).toBeGreaterThan(1000);
      expect(src, `${name} zamana bağlanmış`).not.toContain('Date.now');
      expect(src, `${name} timer kurmuş`).not.toMatch(/setInterval|setTimeout/);
      expect(src, `${name} React'e bağlanmış`).not.toContain("from 'react'");
      expect(src, `${name} kanonik otoriteye inmiş`).not.toContain('mediaCommandGateway');
    }
    /* İkinci sıralama YOK: skor/popülerlik hesabı F9'da olamaz. */
    for (const [name, src] of [['router', router], ['çözümleyici', resolver]] as const) {
      expect(src, `${name} kendi sıralamasını kurmuş`).not.toMatch(/\.sort\s*\(/);
      expect(src, `${name} popülerlik tablosu kurmuş`).not.toContain('popularity');
    }
    /* Sıralama otoritesi F5'te kalmalı — kanıt eşiği oradan okunur. */
    expect(router, 'F5 otomatik çalma eşiği atlanmış').toContain('isConfidentEnoughToAutoPlay');
  });
});
