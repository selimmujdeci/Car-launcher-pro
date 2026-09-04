/**
 * musicIntentRouter.ts — MUSIC F9 · `MusicIntent` → KANONİK müzik otoriteleri.
 *
 * Bu modül CarOS'un müzik otoritesi DEĞİLDİR; **requester**dır (Cross-Domain
 * §12). Tek işi, çözülmüş bir niyeti doğru sahibine devretmek ve dönen KANONİK
 * kanıtı dürüst bir sonuç sınıfına çevirmektir.
 *
 * PAZARLIKSIZ SINIRLAR:
 *   · Sağlayıcıya · native köprüye · IFrame'e DOĞRUDAN komut YOK.
 *   · Kendi kuyruğunu · kendi arama sıralamasını · kendi playback durumunu
 *     TUTMAZ. Sıralama F5'in, kuyruk F3'ün, ses gerçeği F0'ındır.
 *   · F8 tercih kanıtına YAZMAZ — yalnız okur.
 *   · Duck otoritesi DEĞİLDİR (F6.1); konuşma ducking'i Mavi konuşma yolundadır.
 *   · Güvenlik kapılarını (F7.2 sürüşte video) BYPASS EDEMEZ — video bir müzik
 *     niyeti değildir ve bu sözleşmede YOKTUR.
 *   · `ACCEPTED_UNVERIFIED` bir başarı DEĞİLDİR; iddia sınıfı `ATTEMPTED` olur.
 *
 * Ağır modüller DİNAMİK yüklenir (düşük-uç paket bütçesi — F3/F8'deki desen).
 */

import { logError } from '../../crashLogger';
import type { CommandTruth } from '../authority/playbackTruth';
import type { MediaCommandResult } from '../../mediaService';
import type { SearchResult } from '../search/searchResult';
import type { FavoriteEntry } from '../collection/musicCollectionEntry';
import type { Playlist } from '../playlist/musicPlaylistEntry';
import { playlistItemToUnifiedTrack } from '../playlist/musicPlaylistEntry';
import type { UnifiedTrack } from '../providers';
/* MUSIC F16 · panel görünürlüğü PRESENTATION state'idir (Cross-Domain §14),
   `videoModeStore`nun kullandığı AYNI hafif desen — port DEĞİL, doğrudan
   statik içe aktarım (bkz. `useVoiceCommandHandler.ts`'in `setVideoMode`i). */
import { setLyricsPanelVisible } from '../lyricsPanelVisibility';
import {
  makeOutcome, type MusicIntent, type MusicIntentChoice, type MusicIntentOutcome,
  type MusicIntentRoute, type MusicIntentStatus,
} from './musicIntent';
import { resolveMusicIntent } from './musicIntentResolver';
import type { TraitDirection } from '../traits/traitSelectionModel';
import {
  noteContextualRequest, noteIntentOutcome, noteIntentResolved, noteQueueCommand,
  noteSourceHeld, noteStaleIntentDrop,
} from './musicIntentTelemetry';

/** En fazla kaç netleştirme adayı okunur — sürüşte uzun liste güvenlik sorunudur. */
export const MAX_CHOICES = 3;
/** Ses adımı (%) — kullanıcı adet söylemediyse. */
export const VOLUME_STEP_PERCENT = 10;

function mono(): number {
  try { return performance.now(); } catch { return Date.now(); }
}

/* ── Kanonik kanıt → dürüst durum ────────────────────────────────────────── */

export function statusFromTruth(truth: CommandTruth): MusicIntentStatus {
  switch (truth.outcome) {
    case 'VERIFIED': return 'VERIFIED';
    case 'ACCEPTED_UNVERIFIED': return 'ACCEPTED_UNVERIFIED';
    case 'REJECTED': return 'REJECTED';
    case 'SUPERSEDED': return 'REJECTED';
    case 'TIMED_OUT': return 'FAILED';
    default: return 'FAILED';
  }
}

export function statusFromCommandResult(r: MediaCommandResult): MusicIntentStatus {
  if (!r.dispatched) return 'NOT_ATTEMPTED';
  return r.verified ? 'VERIFIED' : 'ACCEPTED_UNVERIFIED';
}

/* ── Portlar (test dikişi) ───────────────────────────────────────────────── */

export interface MusicIntentPorts {
  readonly gateway: () => Promise<typeof import('../authority/mediaCommandGateway')>;
  readonly layer: () => Promise<typeof import('../carosMediaLayer')>;
  readonly search: () => Promise<typeof import('../search/musicSearchCoordinator')>;
  readonly selection: () => Promise<typeof import('../search/searchSelection')>;
  readonly registry: () => Promise<typeof import('../search/searchRegistry')>;
  readonly sessionRuntime: () => Promise<typeof import('../session/listeningSessionRuntime')>;
  readonly playQueue: () => Promise<typeof import('../session/playQueue')>;
  readonly intelligence: () => Promise<typeof import('../intelligence/musicIntelligenceRuntime')>;
  /** MUSIC F10 · karakter (mood/energy) kanıtı — SALT OKUMA + seçim. */
  readonly traits: () => Promise<typeof import('../traits/traitRuntime')>;
  /** MUSIC F13 · TEK favori/koleksiyon otoritesi — bu router yalnız İSTER. */
  readonly collection: () => Promise<typeof import('../collection/musicCollectionAuthority')>;
  /** MUSIC F13 · "bunu" kimliği F3'ün ZATEN var olan oturumundan okunur. */
  readonly session: () => Promise<typeof import('../session/listeningSession')>;
  /** MUSIC F15 · TEK playlist otoritesi — bu router yalnız İSTER. */
  readonly playlist: () => Promise<typeof import('../playlist/musicPlaylistAuthority')>;
  /** MUSIC F16 · TEK lyrics otoritesi — bu router yalnız İSTER/SORGULAR. */
  readonly lyrics: () => Promise<typeof import('../lyrics/musicLyricsAuthority')>;
  /**
   * MUSIC F18 · aday SIRASI politikası. Kuyruk otoritesi DEĞİLDİR: yürütme
   * yine F3 (`PlayQueue` + `ListeningSession`) zincirindedir.
   */
  readonly radio: () => Promise<typeof import('../radio/smartRadioRuntime')>;
}

const DEFAULT_PORTS: MusicIntentPorts = Object.freeze({
  gateway: () => import('../authority/mediaCommandGateway'),
  layer: () => import('../carosMediaLayer'),
  search: () => import('../search/musicSearchCoordinator'),
  selection: () => import('../search/searchSelection'),
  registry: () => import('../search/searchRegistry'),
  sessionRuntime: () => import('../session/listeningSessionRuntime'),
  playQueue: () => import('../session/playQueue'),
  intelligence: () => import('../intelligence/musicIntelligenceRuntime'),
  traits: () => import('../traits/traitRuntime'),
  collection: () => import('../collection/musicCollectionAuthority'),
  session: () => import('../session/listeningSession'),
  playlist: () => import('../playlist/musicPlaylistAuthority'),
  lyrics: () => import('../lyrics/musicLyricsAuthority'),
  radio: () => import('../radio/smartRadioRuntime'),
});

let ports: MusicIntentPorts = DEFAULT_PORTS;

/** @internal test dikişi — üretimde daima gerçek kanonik modüller yüklenir. */
export function _setMusicIntentPortsForTest(next: Partial<MusicIntentPorts> | null): void {
  ports = next === null ? DEFAULT_PORTS : Object.freeze({ ...DEFAULT_PORTS, ...next });
}

/* ── Bayatlık kapısı ─────────────────────────────────────────────────────
 * Sesli komutlar üst üste gelebilir. ESKİ bir turun sonucu YENİ turun iddiasını
 * kuramaz (Cross-Domain §17): her istek bir nesil alır, yalnız en güncel nesil
 * konuşulabilir sonuç döndürür. */
let generation = 0;

function isStale(gen: number): boolean { return gen !== generation; }

/* ── Yardımcılar ─────────────────────────────────────────────────────────── */

const choiceOf = (r: SearchResult): MusicIntentChoice => Object.freeze({
  title: r.title,
  artist: r.artist,
  providerId: r.provenance.providerId,
});

function subjectOf(r: SearchResult | null): string | null {
  if (r === null) return null;
  const t = (r.title ?? '').trim();
  if (t.length === 0) return null;
  const a = (r.artist ?? '').trim();
  return a.length > 0 ? `${t} — ${a}` : t;
}

/* ── Grup yürütücüleri ───────────────────────────────────────────────────── */

async function runTransport(intent: MusicIntent): Promise<{
  route: MusicIntentRoute; status: MusicIntentStatus; reasonCode: string;
}> {
  /* Sonraki/önceki KUYRUK-FARKINDA tek girişten geçer (F7.3): sıra üst
     katmandaysa (sağlayıcı arama listesi) native `next` reddederdi. */
  if (intent.kind === 'NEXT' || intent.kind === 'PREVIOUS') {
    const layer = await ports.layer();
    const r = intent.kind === 'NEXT'
      ? await layer.next('mavi')
      : await layer.previous('mavi');
    return {
      route: 'F3_QUEUE_AUTHORITY',
      status: statusFromCommandResult(r),
      reasonCode: r.failureCode ?? 'ok',
    };
  }

  const gw = await ports.gateway();
  let truth: CommandTruth;
  switch (intent.kind) {
    case 'PLAY': truth = await gw.play(undefined, 'mavi'); break;
    case 'PAUSE': truth = await gw.pause(undefined, 'mavi'); break;
    case 'STOP': truth = await gw.stop(); break;
    case 'SEEK': truth = await gw.seek(Math.max(0, intent.amount ?? 0)); break;
    case 'RESTART_TRACK': truth = await gw.seek(0); break;
    case 'TOGGLE': {
      /* "Toggle" bir DURUM sorusudur; durumu F0 bilir. Kanıt yoksa çalma
         denenir — sessizken duraklatmaya çalışmak anlamsızdır. */
      const active = gw.getActiveSource() !== null;
      truth = active ? await gw.pause(undefined, 'mavi') : await gw.play(undefined, 'mavi');
      break;
    }
    default:
      return { route: 'NONE', status: 'NOT_ATTEMPTED', reasonCode: 'unsupported_intent' };
  }
  return {
    route: 'F0_COMMAND_GATEWAY',
    status: statusFromTruth(truth),
    reasonCode: truth.failureCode ?? 'ok',
  };
}

async function runSearch(intent: MusicIntent, gen: number): Promise<MusicIntentOutcome> {
  const startedAt = mono();
  const query = (intent.query ?? '').trim();
  if (query.length === 0) {
    return makeOutcome(intent, 'NONE', 'NOT_ATTEMPTED', 'intent_unresolved',
      { elapsedMs: mono() - startedAt });
  }

  const [{ ensureSearchSourcesConfigured }, { searchOnce }] = await Promise.all([
    ports.registry(), ports.search(),
  ]);
  await ensureSearchSourcesConfigured();
  const snapshot = await searchOnce(query);

  if (isStale(gen)) {
    noteStaleIntentDrop();
    return makeOutcome(intent, 'F5_SEARCH_SELECTION', 'REJECTED', 'superseded',
      { elapsedMs: mono() - startedAt });
  }

  if (snapshot.results.length === 0) {
    const unavailable = snapshot.emptyReason === 'ALL_SOURCES_UNAVAILABLE'
      || snapshot.emptyReason === 'ALL_SOURCES_FAILED'
      || snapshot.emptyReason === 'NO_ELIGIBLE_SOURCE';
    return makeOutcome(intent, 'F5_SEARCH_SELECTION', 'UNAVAILABLE',
      unavailable ? 'sources_unavailable' : 'no_result',
      { elapsedMs: mono() - startedAt });
  }

  /* KAYNAK NİTELEYİCİSİ (§6): kullanıcı kaynağı SÖYLEDİYSE kanonik sıra
     KORUNUR ama yalnız o kaynağın satırları kalır. Sonuç yoksa SESSİZCE başka
     kaynağa GEÇİLMEZ — dürüstçe söylenir ve alternatif TEKLİF edilir. */
  const preferred = intent.source?.providerId ?? null;
  const pool = preferred === null
    ? snapshot.results
    : snapshot.results.filter((r) => r.provenance.providerId === preferred);

  if (preferred !== null && pool.length === 0) {
    noteSourceHeld();
    return makeOutcome(intent, 'F5_SEARCH_SELECTION', 'UNAVAILABLE', 'provider_no_results', {
      subject: subjectOf(snapshot.results[0] ?? null),
      elapsedMs: mono() - startedAt,
    });
  }

  const top = pool[0];
  /* Sıralama F5'indir; burada YENİ bir sıralama yapılmaz. Yalnız F5'in kendi
     "otomatik çalmaya yetecek kanıt" ölçütü uygulanır. */
  const { isConfidentEnoughToAutoPlay } = await import('../search/voiceSearchIntent');
  if (!isConfidentEnoughToAutoPlay(top)) {
    return makeOutcome(intent, 'F5_SEARCH_SELECTION', 'AMBIGUOUS', 'ambiguous', {
      choices: pool.slice(0, MAX_CHOICES).map(choiceOf),
      elapsedMs: mono() - startedAt,
    });
  }

  const { selectSearchResult } = await ports.selection();
  const selection = await selectSearchResult(top!, pool);
  if (isStale(gen)) {
    noteStaleIntentDrop();
    return makeOutcome(intent, 'F5_SEARCH_SELECTION', 'REJECTED', 'superseded',
      { elapsedMs: mono() - startedAt });
  }

  switch (selection.outcome) {
    case 'STARTED': {
      /* F3 oturum yolu çalıştı; ses kanıtı komut gerçeğinden gelir. */
      const truth = selection.listening?.truth ?? null;
      return makeOutcome(intent, 'F5_SEARCH_SELECTION',
        truth === null ? 'ACCEPTED_UNVERIFIED' : statusFromTruth(truth),
        truth?.failureCode ?? 'ok',
        { subject: subjectOf(top!), elapsedMs: mono() - startedAt });
    }
    case 'PROVIDER_PATH': {
      /* Sağlayıcı sonucu KANONİK medya katmanından çalar (F7.6 zinciri).
         Bu yol senkron bir komut gerçeği döndürmez → iddia `ATTEMPTED`tir. */
      const layer = await ports.layer();
      const unified = pool
        .filter((r) => r.provenance.origin === 'PROVIDER')
        .map((r) => layer.unifiedFromSearchResult(r));
      const selected = unified.find((u) => u.id === (top!.identity.providerId ?? top!.resultId))
        ?? unified[0] ?? null;
      if (selected === null) {
        return makeOutcome(intent, 'F7_PROVIDER_QUEUE', 'REJECTED', 'provider_unavailable',
          { elapsedMs: mono() - startedAt });
      }
      layer.playMedia(selected, unified);
      return makeOutcome(intent, 'F7_PROVIDER_QUEUE', 'ACCEPTED_UNVERIFIED', 'provider_dispatched',
        { subject: subjectOf(top!), elapsedMs: mono() - startedAt });
    }
    case 'STALE_REFERENCE':
      return makeOutcome(intent, 'F5_SEARCH_SELECTION', 'UNAVAILABLE', 'stale_reference',
        { elapsedMs: mono() - startedAt });
    default:
      return makeOutcome(intent, 'F5_SEARCH_SELECTION', 'REJECTED', 'rejected',
        { elapsedMs: mono() - startedAt });
  }
}

async function runQueue(intent: MusicIntent): Promise<{
  route: MusicIntentRoute; status: MusicIntentStatus; reasonCode: string;
}> {
  const [runtime, queue] = await Promise.all([ports.sessionRuntime(), ports.playQueue()]);
  const state = queue.getDesiredQueue();

  if (state.entries.length === 0) {
    noteQueueCommand(false);
    return { route: 'F3_QUEUE_AUTHORITY', status: 'REJECTED', reasonCode: 'no_active_queue' };
  }

  switch (intent.kind) {
    case 'PLAY_NEXT': {
      /* Çalan öğeden hemen sonraya al. Kaynak kuyruk düzenlemeyi desteklemiyorsa
         `playQueue` dürüstçe reddeder — sahte başarı YOK. */
      const r = await runtime.playQueueEntryNext(Math.min(state.currentIndex + 1, state.entries.length - 1));
      noteQueueCommand(r.applied);
      return {
        route: 'F3_QUEUE_AUTHORITY',
        status: r.applied ? 'VERIFIED' : 'REJECTED',
        reasonCode: r.queueResult.failureCode ?? (r.applied ? 'ok' : 'rejected'),
      };
    }
    case 'REMOVE_CURRENT': {
      const r = await runtime.removeQueueEntryAt(state.currentIndex);
      noteQueueCommand(r.applied);
      return {
        route: 'F3_QUEUE_AUTHORITY',
        status: r.applied ? 'VERIFIED' : 'REJECTED',
        reasonCode: r.queueResult.failureCode ?? (r.applied ? 'ok' : 'rejected'),
      };
    }
    case 'JUMP_TO': {
      const steps = Math.max(1, Math.trunc(intent.amount ?? 1));
      const target = state.currentIndex + steps;
      const r = await runtime.jumpToQueueIndex(target);
      noteQueueCommand(r.applied);
      return {
        route: 'F3_QUEUE_AUTHORITY',
        status: r.applied ? 'VERIFIED' : 'REJECTED',
        reasonCode: r.queueResult.failureCode ?? (r.applied ? 'ok' : 'rejected'),
      };
    }
    case 'CLEAR_UPCOMING':
    case 'ADD_TO_QUEUE':
      /* Kanonik kuyrukta "yalnız sıradakileri temizle" ve "sesli sorgudan
         kuyruğa ekle" işlemleri YOKTUR. Uydurulmuş bir yarı-uygulama yerine
         dürüstçe reddedilir (§7). */
      noteQueueCommand(false);
      return {
        route: 'F3_QUEUE_AUTHORITY', status: 'REJECTED', reasonCode: 'queue_unsupported',
      };
    default:
      return { route: 'NONE', status: 'NOT_ATTEMPTED', reasonCode: 'unsupported_intent' };
  }
}

async function runContinuity(): Promise<{
  route: MusicIntentRoute; status: MusicIntentStatus; reasonCode: string;
}> {
  const layer = await ports.layer();
  const resumed = layer.resumeLastMedia();
  if (!resumed) {
    return { route: 'F3_SESSION_RESUME', status: 'UNAVAILABLE', reasonCode: 'no_resume_context' };
  }
  /* Kanonik devam yolu senkron ses kanıtı döndürmez → iddia `ATTEMPTED`. */
  return { route: 'F3_SESSION_RESUME', status: 'ACCEPTED_UNVERIFIED', reasonCode: 'resume_dispatched' };
}

/**
 * MUSIC F10 · Karakter (mood/energy) yönlü istek.
 *
 * "Daha sakin / daha enerjik" GÖRECELİDİR: referans parçanın kanıtı yoksa
 * karşılaştırma UYDURULMAZ. Seçilen aday kanonik F3 yolundan çalar; F10
 * hiçbir zaman doğrudan çalma başlatmaz.
 */
async function runTraitDirected(
  intent: MusicIntent, direction: TraitDirection, startedAt: number,
): Promise<MusicIntentOutcome | null> {
  const traits = await ports.traits();
  /* MUSIC F10.1 · Seçimden ÖNCE GERÇEK kanıt (gömülü BPM etiketi) sınırlı bir
     toplu işle okunur. Bu kullanıcı isteğine bağlıdır — çalma yolunda veya
     periyodik olarak ASLA çalışmaz; okunmuş dosyalar tekrar okunmaz. */
  try {
    const { getMusicLibrarySnapshot } = await import('../musicIndex');
    const tracks = getMusicLibrarySnapshot().tracks
      .filter((t) => t.availability === 'AVAILABLE');
    const pool = tracks
      .slice(0, traits.MAX_EMBEDDED_PRIME)
      .map((t) => ({ id: t.id, contentUri: t.contentUri }));
    await traits.primeEmbeddedTraits(pool);

    /* MUSIC F17 · Ses ÖLÇÜMÜ (decode + DSP) BEKLENMEZ.
       Sebep: decode dosya başına saniyeler sürebilir; sesli bir isteği bunun
       arkasında bekletmek kullanıcıya "Mavi dondu" olarak görünürdü. Ölçüm
       arka planda, kendi bütçesiyle ve kendi kabul kapısıyla ilerler; BU
       istek elindeki kanıtla karar verir, SONRAKİ istek ölçümü görür.
       Kanıt yoksa iddia da kurulmaz — beklememek sahte kesinlik ÜRETMEZ. */
    const sonicPool = tracks.slice(0, traits.MAX_EMBEDDED_PRIME).map((t) => ({
      id: t.id, contentUri: t.contentUri, generationModified: t.generationModified ?? null,
    }));
    void traits.primeSonicTraits(sonicPool).catch(() => undefined);
  } catch { /* kanıt okunamadı → seçim zayıf kanıtla sürer, uydurma YOK */ }

  const outcome = traits.selectTrackByTrait(direction);

  if (outcome.result.status !== 'SELECTED' || outcome.trackId === null) {
    /* Mutlak yönde (yol/gece) başarısızlık çağırana geri verilir: F8 kanıtı
       hâlâ denenebilir. Göreceli yönde ise dürüst red ÜRETİLİR. */
    if (direction === 'FOR_DRIVE' || direction === 'NIGHT_CALM') return null;
    const reason = outcome.result.status === 'NO_REFERENCE'
      ? 'trait_reference_unavailable'
      : outcome.result.status === 'NO_EVIDENCE'
        ? 'trait_evidence_unavailable'
        : 'trait_no_candidate';
    noteContextualRequest(false, false);
    return makeOutcome(intent, 'F10_TRAIT_EVIDENCE', 'UNAVAILABLE', reason,
      { elapsedMs: mono() - startedAt });
  }

  const runtime = await ports.sessionRuntime();
  const trackId = outcome.trackId;
  const started = (await runtime.startLibraryListening({
    kind: 'TRACKS', trackIds: [trackId], startTrackId: trackId,
  })).started;

  noteContextualRequest(started, true);
  if (!started) {
    return makeOutcome(intent, 'F10_TRAIT_EVIDENCE', 'REJECTED', 'trait_start_rejected',
      { usedContextEvidence: true, elapsedMs: mono() - startedAt });
  }
  /* Kanıt zayıfsa KESİN dil kurulmaz: `reasonCode` konuşma katmanına bunu
     taşır ("deneyeyim" ↔ "açıyorum"). */
  return makeOutcome(intent, 'F10_TRAIT_EVIDENCE', 'ACCEPTED_UNVERIFIED',
    outcome.confidentClaim ? 'trait_selected_confident' : 'trait_selected_tentative',
    { usedContextEvidence: true, elapsedMs: mono() - startedAt });
}

async function runContextual(intent: MusicIntent): Promise<MusicIntentOutcome> {
  const startedAt = mono();

  /* MUSIC F10 · "daha sakin / daha enerjik" artık GERÇEK kanıtla çalışır —
     kanıt yoksa yine dürüstçe reddedilir (uydurma karşılaştırma YOK). */
  if (intent.kind === 'PLAY_SOMETHING_CALMER' || intent.kind === 'PLAY_SOMETHING_MORE_ENERGETIC') {
    const direction: TraitDirection =
      intent.kind === 'PLAY_SOMETHING_CALMER' ? 'CALMER' : 'MORE_ENERGETIC';
    const traitOutcome = await runTraitDirected(intent, direction, startedAt);
    if (traitOutcome !== null) return traitOutcome;
    noteContextualRequest(false, false);
    return makeOutcome(intent, 'F10_TRAIT_EVIDENCE', 'UNAVAILABLE', 'trait_evidence_unavailable',
      { elapsedMs: mono() - startedAt });
  }

  const rt = await ports.intelligence();
  /* AÇIK istek: F8'in "istenmemiş otomasyon" kapıları uygulanmaz — istek
     kullanıcının kendisinden geldi. Kanıt kapısı ise KALDIRILMAZ. */
  const evaluation = rt.evaluateForExplicitRequest();
  if (!evaluation.hasEvidence || evaluation.candidate === null) {
    /* MUSIC F10 · Öğrenilmiş tercih yoksa bağlam HEDEFLİ karakter seçimi
       denenir (gece → daha sakin, yol → daha yüksek enerji). Bu da kanıtsızsa
       dürüstçe reddedilir — rastgele bir şey ÇALINMAZ. */
    const direction: TraitDirection = evaluation.bucket.endsWith('_NIGHT')
      ? 'NIGHT_CALM' : 'FOR_DRIVE';
    const traitOutcome = await runTraitDirected(intent, direction, startedAt);
    if (traitOutcome !== null) return traitOutcome;
    noteContextualRequest(false, false);
    return makeOutcome(intent, 'F8_CONTEXT_EVIDENCE', 'UNAVAILABLE', 'no_context_evidence',
      { usedContextEvidence: false, elapsedMs: mono() - startedAt });
  }

  const label = rt.resolveCandidateLabel(evaluation.candidate);
  const applied = await rt.applyIntelligenceCandidate(evaluation.candidate);
  noteContextualRequest(applied, true);
  return makeOutcome(intent, 'F8_CONTEXT_EVIDENCE',
    applied ? 'ACCEPTED_UNVERIFIED' : 'REJECTED',
    applied ? 'context_candidate_dispatched' : 'context_candidate_rejected',
    {
      subject: label?.title ?? null,
      usedContextEvidence: true,
      elapsedMs: mono() - startedAt,
    });
}

function subjectOfIdentity(identity: { title: string | null; artist: string | null } | null): string | null {
  if (identity === null) return null;
  const t = (identity.title ?? '').trim();
  if (t.length === 0) return null;
  const a = (identity.artist ?? '').trim();
  return a.length > 0 ? `${t} — ${a}` : t;
}

function subjectOfFavorite(entry: FavoriteEntry): string | null {
  return subjectOfIdentity({ title: entry.displayTitle, artist: entry.displayArtist });
}

/**
 * MUSIC F13 · Favori/koleksiyon niyeti.
 *
 * SAHİPLİK: bu fonksiyon HİÇBİR favori state'i TUTMAZ — yalnız
 * `musicCollectionAuthority`ye İSTER (Cross-Domain §12 requester rolü).
 * "Bunu" kimliği F3'ün ZATEN var olan `ListeningSession.currentItem`'ından
 * gelir; burada YENİ bir "şu an çalan" kavramı İCAT EDİLMEZ. Kanıt yoksa
 * (oturum yok / `currentItem` yok) `bunu` UYDURULMAZ — dürüstçe reddedilir.
 */
async function runCollection(intent: MusicIntent, startedAt: number): Promise<MusicIntentOutcome> {
  const [collection, sessionMod] = await Promise.all([ports.collection(), ports.session()]);

  if (intent.kind === 'PLAY_FAVORITES') {
    /* Sıralama/öneri motoru İCAT EDİLMEZ: yalnız en son eklenen ÇÖZÜLEBİLEN
       favori (F8/F9 önerisiyle KARIŞTIRILMAZ). */
    const entry = collection.resolveMostRecentPlayableFavorite();
    if (entry === null) {
      return makeOutcome(intent, 'F13_COLLECTION_AUTHORITY', 'UNAVAILABLE', 'no_playable_favorite',
        { elapsedMs: mono() - startedAt });
    }
    const target = collection.resolvePlaybackTarget(entry);
    if (entry.kind === 'LOCAL') {
      if (!target.playable || !target.libraryId) {
        return makeOutcome(intent, 'F13_COLLECTION_AUTHORITY', 'UNAVAILABLE', 'favorite_unresolved',
          { elapsedMs: mono() - startedAt });
      }
      const runtime = await ports.sessionRuntime();
      const started = (await runtime.startLibraryListening({
        kind: 'TRACKS', trackIds: [target.libraryId], startTrackId: target.libraryId,
      })).started;
      return makeOutcome(intent, 'F13_COLLECTION_AUTHORITY',
        started ? 'ACCEPTED_UNVERIFIED' : 'REJECTED',
        started ? 'favorite_playback_dispatched' : 'favorite_start_rejected',
        { elapsedMs: mono() - startedAt });
    }
    /* PROVIDER favorisi F3 yolundan gitmez — kanonik medya katmanına devir
       (`searchSelection.ts`'in PROVIDER_PATH sınırıyla BİREBİR aynı desen);
       tek-öğe tek-sağlayıcı kuyruk kurulur (karışık-sağlayıcı guard'ı). */
    if (!target.playable || !target.provider || !target.contentUri) {
      return makeOutcome(intent, 'F13_COLLECTION_AUTHORITY', 'UNAVAILABLE', 'favorite_unresolved',
        { elapsedMs: mono() - startedAt });
    }
    const layer = await ports.layer();
    const unified: UnifiedTrack = {
      id: entry.providerId ?? entry.key,
      providerId: target.provider,
      title: entry.displayTitle ?? 'Bilinmeyen parça',
      subtitle: entry.displayArtist ?? '',
      artwork: entry.displayArtwork ?? undefined,
      ...(target.contentUri.startsWith('spotify:')
        ? { spotifyUri: target.contentUri }
        : { streamUrl: target.contentUri }),
    };
    layer.playMedia(unified, [unified]);
    /* Bu yol senkron bir komut gerçeği döndürmez → iddia `ATTEMPTED`tir
       (F7_PROVIDER_QUEUE'nun `runSearch` dalıyla AYNI dürüstlük derecesi). */
    return makeOutcome(intent, 'F13_COLLECTION_AUTHORITY', 'ACCEPTED_UNVERIFIED', 'favorite_playback_dispatched',
      { subject: subjectOfFavorite(entry), elapsedMs: mono() - startedAt });
  }

  /* ADD_FAVORITE / REMOVE_FAVORITE — kimlik kanıtı ZORUNLU. */
  const session = sessionMod.getListeningSession();
  const currentItem = session?.currentItem ?? null;
  if (session === null || currentItem === null) {
    return makeOutcome(intent, 'F13_COLLECTION_AUTHORITY', 'REJECTED', 'no_current_item',
      { elapsedMs: mono() - startedAt });
  }

  const subject = subjectOfIdentity(currentItem);
  const result = intent.kind === 'ADD_FAVORITE'
    ? collection.addFavorite(currentItem, session.currentSource)
    : collection.removeFavorite(currentItem);

  switch (result.status) {
    case 'ADDED':
      return makeOutcome(intent, 'F13_COLLECTION_AUTHORITY', 'VERIFIED', 'favorite_added',
        { subject, elapsedMs: mono() - startedAt });
    case 'ALREADY_PRESENT':
      return makeOutcome(intent, 'F13_COLLECTION_AUTHORITY', 'VERIFIED', 'favorite_already_present',
        { subject, elapsedMs: mono() - startedAt });
    case 'REMOVED':
      return makeOutcome(intent, 'F13_COLLECTION_AUTHORITY', 'VERIFIED', 'favorite_removed',
        { subject, elapsedMs: mono() - startedAt });
    case 'ALREADY_ABSENT':
      return makeOutcome(intent, 'F13_COLLECTION_AUTHORITY', 'VERIFIED', 'favorite_already_absent',
        { subject, elapsedMs: mono() - startedAt });
    case 'REJECTED_COLLECTION_FULL':
      return makeOutcome(intent, 'F13_COLLECTION_AUTHORITY', 'REJECTED', 'favorite_collection_full',
        { subject, elapsedMs: mono() - startedAt });
    default:
      /* `REJECTED_NO_IDENTITY`: kanonik kimlik yetersiz (örn. sağlayıcı bir
         `providerId`/`providerNamespace` çifti vermedi) — kanıtsız favori
         UYDURULMAZ. */
      return makeOutcome(intent, 'F13_COLLECTION_AUTHORITY', 'REJECTED', 'favorite_identity_unresolved',
        { elapsedMs: mono() - startedAt });
  }
}

const choiceOfPlaylist = (p: Playlist): MusicIntentChoice => Object.freeze({
  title: p.name, artist: null, providerId: null,
});

/**
 * MUSIC F15 · Playlist niyeti.
 *
 * SAHİPLİK: bu fonksiyon HİÇBİR playlist state'i TUTMAZ — yalnız
 * `musicPlaylistAuthority`ye İSTER (Cross-Domain §12 requester rolü).
 * Belirsiz playlist adında YANLIŞ liste SEÇİLMEZ — birden fazla eşleşme
 * `AMBIGUOUS` döner, seçenekler sunulur (§F15 "clarification" kuralı).
 * "Bunu" kimliği F3'ün ZATEN var olan `ListeningSession.currentItem`'ından
 * gelir; yoksa istek dürüstçe reddedilir.
 */
async function runPlaylist(intent: MusicIntent, startedAt: number): Promise<MusicIntentOutcome> {
  const playlist = await ports.playlist();

  if (intent.kind === 'CREATE_PLAYLIST') {
    const name = intent.playlistName?.trim();
    if (!name) {
      return makeOutcome(intent, 'F15_PLAYLIST_AUTHORITY', 'REJECTED', 'playlist_name_required',
        { elapsedMs: mono() - startedAt });
    }
    const result = playlist.createPlaylist(name);
    if (result.status === 'CREATED') {
      return makeOutcome(intent, 'F15_PLAYLIST_AUTHORITY', 'VERIFIED', 'playlist_created',
        { subject: name, elapsedMs: mono() - startedAt });
    }
    return makeOutcome(intent, 'F15_PLAYLIST_AUTHORITY', 'REJECTED',
      result.status === 'REJECTED_PLAYLIST_LIMIT' ? 'playlist_limit_reached' : 'playlist_name_invalid',
      { elapsedMs: mono() - startedAt });
  }

  // ADD_TO_PLAYLIST / REMOVE_FROM_PLAYLIST / PLAY_MY_PLAYLIST hepsi bir AD gerektirir.
  const name = intent.playlistName?.trim();
  if (!name) {
    return makeOutcome(intent, 'F15_PLAYLIST_AUTHORITY', 'REJECTED', 'playlist_name_required',
      { elapsedMs: mono() - startedAt });
  }
  const matches = playlist.findPlaylistsByName(name);

  if (intent.kind === 'ADD_TO_PLAYLIST') {
    if (matches.length > 1) {
      return makeOutcome(intent, 'F15_PLAYLIST_AUTHORITY', 'AMBIGUOUS', 'playlist_name_ambiguous',
        { choices: matches.slice(0, MAX_CHOICES).map(choiceOfPlaylist), elapsedMs: mono() - startedAt });
    }
    const sessionMod = await ports.session();
    const session = sessionMod.getListeningSession();
    const currentItem = session?.currentItem ?? null;
    if (session === null || currentItem === null) {
      return makeOutcome(intent, 'F15_PLAYLIST_AUTHORITY', 'REJECTED', 'no_current_item',
        { elapsedMs: mono() - startedAt });
    }
    let target: Playlist | null = matches[0] ?? null;
    let createdNew = false;
    if (target === null) {
      /* Aynı ADDA playlist yok → kullanıcının niyeti belirgin ("X listeme
         ekle" → X yoksa X'i KUR ve ekle) — bu bir tahmin DEĞİL, deterministik
         bir politika. Birden fazla YAKIN eşleşme zaten AMBIGUOUS ile üstte
         elenmiştir. */
      const created = playlist.createPlaylist(name);
      if (created.status !== 'CREATED' || !created.playlistId) {
        return makeOutcome(intent, 'F15_PLAYLIST_AUTHORITY', 'REJECTED', 'playlist_name_invalid',
          { elapsedMs: mono() - startedAt });
      }
      target = playlist.getPlaylist(created.playlistId);
      createdNew = true;
    }
    if (target === null) {
      return makeOutcome(intent, 'F15_PLAYLIST_AUTHORITY', 'FAILED', 'playlist_create_failed',
        { elapsedMs: mono() - startedAt });
    }
    const result = playlist.addItemToPlaylist(target.id, currentItem, session.currentSource);
    const subject = subjectOfIdentity(currentItem);
    if (result.status === 'ITEM_ADDED' || result.status === 'ITEM_ALREADY_PRESENT') {
      return makeOutcome(intent, 'F15_PLAYLIST_AUTHORITY', 'VERIFIED',
        createdNew ? 'playlist_created_and_item_added'
          : result.status === 'ITEM_ADDED' ? 'playlist_item_added' : 'playlist_item_already_present',
        { subject, elapsedMs: mono() - startedAt });
    }
    return makeOutcome(intent, 'F15_PLAYLIST_AUTHORITY', 'REJECTED', 'playlist_item_identity_unresolved',
      { subject, elapsedMs: mono() - startedAt });
  }

  if (intent.kind === 'REMOVE_FROM_PLAYLIST') {
    if (matches.length === 0) {
      return makeOutcome(intent, 'F15_PLAYLIST_AUTHORITY', 'REJECTED', 'playlist_not_found',
        { elapsedMs: mono() - startedAt });
    }
    if (matches.length > 1) {
      return makeOutcome(intent, 'F15_PLAYLIST_AUTHORITY', 'AMBIGUOUS', 'playlist_name_ambiguous',
        { choices: matches.slice(0, MAX_CHOICES).map(choiceOfPlaylist), elapsedMs: mono() - startedAt });
    }
    const sessionMod = await ports.session();
    const currentItem = sessionMod.getListeningSession()?.currentItem ?? null;
    if (currentItem === null) {
      return makeOutcome(intent, 'F15_PLAYLIST_AUTHORITY', 'REJECTED', 'no_current_item',
        { elapsedMs: mono() - startedAt });
    }
    const result = playlist.removeIdentityFromPlaylist(matches[0]!.id, currentItem);
    const subject = subjectOfIdentity(currentItem);
    if (result.status === 'ITEM_REMOVED' || result.status === 'ITEM_ALREADY_ABSENT') {
      return makeOutcome(intent, 'F15_PLAYLIST_AUTHORITY', 'VERIFIED',
        result.status === 'ITEM_REMOVED' ? 'playlist_item_removed' : 'playlist_item_already_absent',
        { subject, elapsedMs: mono() - startedAt });
    }
    return makeOutcome(intent, 'F15_PLAYLIST_AUTHORITY', 'REJECTED', 'playlist_item_identity_unresolved',
      { subject, elapsedMs: mono() - startedAt });
  }

  /* PLAY_MY_PLAYLIST — dispatch YALNIZ kanonik yollardan: LOCAL → F3
     `startLibraryListening`; PROVIDER → F7.6'nın KENDİ same-provider kuyruk
     kurucusuna (`carosMediaLayer.playMedia`) devir. İkinci kuyruk YOK. */
  if (matches.length === 0) {
    return makeOutcome(intent, 'F15_PLAYLIST_AUTHORITY', 'UNAVAILABLE', 'playlist_not_found',
      { elapsedMs: mono() - startedAt });
  }
  if (matches.length > 1) {
    return makeOutcome(intent, 'F15_PLAYLIST_AUTHORITY', 'AMBIGUOUS', 'playlist_name_ambiguous',
      { choices: matches.slice(0, MAX_CHOICES).map(choiceOfPlaylist), elapsedMs: mono() - startedAt });
  }
  const target = matches[0]!;
  const plan = playlist.resolvePlaylistStartPlan(target);
  if (plan === null) {
    return makeOutcome(intent, 'F15_PLAYLIST_AUTHORITY', 'UNAVAILABLE', 'playlist_empty_or_unresolved',
      { subject: target.name, elapsedMs: mono() - startedAt });
  }
  if (plan.startLibraryId) {
    const runtime = await ports.sessionRuntime();
    const trackIds = plan.localLibraryIds.length > 0 ? plan.localLibraryIds : [plan.startLibraryId];
    const started = (await runtime.startLibraryListening({
      kind: 'TRACKS', trackIds, startTrackId: plan.startLibraryId,
    })).started;
    return makeOutcome(intent, 'F15_PLAYLIST_AUTHORITY',
      started ? 'ACCEPTED_UNVERIFIED' : 'REJECTED',
      started ? 'playlist_playback_dispatched' : 'playlist_start_rejected',
      { subject: target.name, elapsedMs: mono() - startedAt });
  }
  if (plan.providerEntries.length > 0 && plan.startProviderKey) {
    const layerMod = await ports.layer();
    const unified = plan.providerEntries.map(playlistItemToUnifiedTrack);
    const startIdx = plan.providerEntries.findIndex((e) => e.key === plan.startProviderKey);
    const startTrack = unified[Math.max(0, startIdx)] ?? unified[0];
    if (!startTrack) {
      return makeOutcome(intent, 'F15_PLAYLIST_AUTHORITY', 'UNAVAILABLE', 'playlist_empty_or_unresolved',
        { subject: target.name, elapsedMs: mono() - startedAt });
    }
    layerMod.playMedia(startTrack, unified);
    return makeOutcome(intent, 'F15_PLAYLIST_AUTHORITY', 'ACCEPTED_UNVERIFIED', 'playlist_playback_dispatched',
      { subject: target.name, elapsedMs: mono() - startedAt });
  }
  return makeOutcome(intent, 'F15_PLAYLIST_AUTHORITY', 'UNAVAILABLE', 'playlist_empty_or_unresolved',
    { subject: target.name, elapsedMs: mono() - startedAt });
}

/**
 * MUSIC F16 · Sözler.
 *
 * Mavi burada YALNIZ SORAR ve UI görünürlüğü TALEP EDER (spec §8) — kendi
 * lyrics state'ini KURMAZ, playback'e DOKUNMAZ. Kimlik F13/F15 ile AYNI
 * kaynaktan (`ListeningSession.currentItem`) gelir; yoksa istek dürüstçe
 * reddedilir (`no_current_item`) — kanıtsız "buldum" YOK.
 *
 * `HIDE_LYRICS` istisnadır: kapatmak kimlik GEREKTİRMEZ (senkron/yerel bir
 * bayrağın indirilmesidir, her zaman doğrulanabilir).
 */
async function runLyrics(intent: MusicIntent, startedAt: number): Promise<MusicIntentOutcome> {
  if (intent.kind === 'HIDE_LYRICS') {
    setLyricsPanelVisible(false);
    return makeOutcome(intent, 'F16_LYRICS_AUTHORITY', 'VERIFIED', 'lyrics_panel_hidden',
      { elapsedMs: mono() - startedAt });
  }

  const sessionMod = await ports.session();
  const session = sessionMod.getListeningSession();
  const currentItem = session?.currentItem ?? null;
  if (session === null || currentItem === null) {
    return makeOutcome(intent, 'F16_LYRICS_AUTHORITY', 'REJECTED', 'no_current_item',
      { elapsedMs: mono() - startedAt });
  }

  const lyricsMod = await ports.lyrics();
  const query = await lyricsMod.primeLyricsForCurrentItem(currentItem, session.currentSource, Date.now());
  const subject = currentItem.title ?? null;

  if (intent.kind === 'QUERY_LYRICS_AVAILABILITY') {
    /* Yalnız SORAR — görünürlüğü DEĞİŞTİRMEZ. */
    if (query.availability === 'UNKNOWN') {
      return makeOutcome(intent, 'F16_LYRICS_AUTHORITY', 'FAILED', 'lyrics_query_failed',
        { subject, elapsedMs: mono() - startedAt });
    }
    return makeOutcome(intent, 'F16_LYRICS_AUTHORITY', 'VERIFIED',
      query.availability === 'AVAILABLE' ? 'lyrics_query_available' : 'lyrics_query_unavailable',
      { subject, elapsedMs: mono() - startedAt });
  }

  // SHOW_LYRICS — panel HER ZAMAN açılır (kendi dürüst boş/arıyor durumunu
  // gösterir, spec §6); reasonCode Mavi'nin SÖYLEYECEĞİ cümleyi belirler.
  setLyricsPanelVisible(true);
  if (query.availability === 'AVAILABLE') {
    return makeOutcome(intent, 'F16_LYRICS_AUTHORITY', 'VERIFIED', 'lyrics_panel_shown',
      { subject, elapsedMs: mono() - startedAt });
  }
  if (query.availability === 'UNKNOWN') {
    return makeOutcome(intent, 'F16_LYRICS_AUTHORITY', 'VERIFIED', 'lyrics_panel_shown_unknown',
      { subject, elapsedMs: mono() - startedAt });
  }
  return makeOutcome(intent, 'F16_LYRICS_AUTHORITY', 'VERIFIED', 'lyrics_panel_shown_no_lyrics',
    { subject, elapsedMs: mono() - startedAt });
}

async function runAudio(intent: MusicIntent): Promise<{
  route: MusicIntentRoute; status: MusicIntentStatus; reasonCode: string;
}> {
  const gw = await ports.gateway();
  try {
    switch (intent.kind) {
      case 'MUTE': await gw.setMuted(true); break;
      case 'UNMUTE': await gw.setMuted(false); break;
      default: {
        const step = Math.max(1, Math.min(50, Math.trunc(intent.amount ?? VOLUME_STEP_PERCENT)));
        const delta = intent.kind === 'VOLUME_UP' ? step : -step;
        const current = Math.round(gw.getEffectiveVolume() * 100);
        const next = Math.max(0, Math.min(100, current + delta));
        await gw.setUserVolumePercent(next);
        break;
      }
    }
    /* Kapı ses seviyesi için GÖZLEM döndürmez: istek gönderildi, sonucu
       doğrulanmadı (#1047 ile aynı dürüstlük). */
    return { route: 'F0_COMMAND_GATEWAY', status: 'ACCEPTED_UNVERIFIED', reasonCode: 'volume_dispatched' };
  } catch {
    return { route: 'F0_COMMAND_GATEWAY', status: 'FAILED', reasonCode: 'volume_unavailable' };
  }
}

/* ── Genel giriş ─────────────────────────────────────────────────────────── */

/**
 * Çözülmüş niyeti yürütür.
 *
 * HİÇBİR KOŞULDA sahte başarı üretmez: her dal ya kanonik bir kanıt taşır ya
 * da dürüst bir reddetme kodu döndürür.
 */
/* ══════════════════════════════════════════════════════════════════════════
 * MUSIC F18 · KESİNTİSİZ AKIŞ (SMART RADIO)
 *
 * Bu dal bir kuyruk otoritesi AÇMAZ: `smartRadioRuntime` yalnız aday sırası
 * üretir ve yürütmeyi kanonik F3 zincirine (PlayQueue → ListeningSession →
 * Gateway) verir. Router burada YALNIZ isteği iletir ve sonucu KANITA göre
 * sınıflandırır.
 *
 * DÜRÜSTLÜK: `MEASURED` dışındaki iddia sınıflarında "sana özel / buna
 * benzer" cümlesi KURULMAZ — bu ayrım `usedContextEvidence` ve `reasonCode`
 * üzerinden konuşma katmanına taşınır.
 * ════════════════════════════════════════════════════════════════════════ */

const RADIO_REQUEST: Readonly<Record<string, 'CONTINUE_LIKE_THIS' | 'RADIO_FROM_CURRENT'
| 'FAVORITES_MIX' | 'LONG_DRIVE_MIX'>> = Object.freeze({
  CONTINUE_LIKE_THIS: 'CONTINUE_LIKE_THIS',
  START_RADIO: 'RADIO_FROM_CURRENT',
  PLAY_FAVORITES_MIX: 'FAVORITES_MIX',
  LONG_DRIVE_MIX: 'LONG_DRIVE_MIX',
});

async function runSmartRadio(
  intent: MusicIntent, startedAt: number,
): Promise<MusicIntentOutcome> {
  const request = RADIO_REQUEST[intent.kind];
  if (request === undefined) {
    return makeOutcome(intent, 'F18_SMART_RADIO', 'UNAVAILABLE', 'radio_kind_unsupported',
      { elapsedMs: mono() - startedAt });
  }

  const radio = await ports.radio();
  const result = await radio.startSmartRadio(request);

  if (result.execution === 'REJECTED') {
    /* Sahte başarı YOK: aday yoksa veya kaynak kuyruğu desteklemiyorsa
       dürüstçe reddedilir; sıra "uygulanmış gibi" GÖSTERİLMEZ. */
    const reasonCode = result.sequence.status === 'EMPTY_LIBRARY' ? 'radio_library_empty'
      : result.sequence.status === 'NO_CANDIDATES' ? 'radio_no_candidate'
        : 'radio_execution_rejected';
    return makeOutcome(intent, 'F18_SMART_RADIO', 'UNAVAILABLE', reasonCode,
      { elapsedMs: mono() - startedAt });
  }

  /* Eklemede ses ZATEN çalıyordu ve kesilmedi; başlatmada komut gönderildi
     ama duyulabilirlik DOĞRULANMADI → her iki durumda da iddia sınırı
     `ACCEPTED_UNVERIFIED`tir (F0 sözleşmesi). */
  return makeOutcome(intent, 'F18_SMART_RADIO', 'ACCEPTED_UNVERIFIED',
    result.execution === 'APPENDED'
      ? `radio_appended_${result.sequence.claimClass.toLowerCase()}`
      : `radio_started_${result.sequence.claimClass.toLowerCase()}`,
    {
      elapsedMs: mono() - startedAt,
      /* Yalnız GERÇEK ölçüme dayalı benzerlik "kanıt kullanıldı" sayılır. */
      usedContextEvidence: result.sequence.claimClass === 'MEASURED',
    });
}

export async function dispatchMusicIntent(
  intent: MusicIntent, nowMs = Date.now(),
): Promise<MusicIntentOutcome> {
  generation += 1;
  const gen = generation;
  const startedAt = mono();

  let outcome: MusicIntentOutcome;
  try {
    switch (intent.kind) {
      case 'PLAY': case 'PAUSE': case 'TOGGLE': case 'NEXT': case 'PREVIOUS':
      case 'STOP': case 'SEEK': case 'RESTART_TRACK': {
        const r = await runTransport(intent);
        outcome = makeOutcome(intent, r.route, r.status, r.reasonCode,
          { elapsedMs: mono() - startedAt });
        break;
      }
      case 'PLAY_QUERY': case 'PLAY_ARTIST': case 'PLAY_ALBUM':
      case 'PLAY_PLAYLIST': case 'PLAY_LOCAL': case 'PLAY_PROVIDER': {
        outcome = await runSearch(intent, gen);
        break;
      }
      case 'PLAY_NEXT': case 'ADD_TO_QUEUE': case 'REMOVE_CURRENT':
      case 'CLEAR_UPCOMING': case 'JUMP_TO': {
        const r = await runQueue(intent);
        outcome = makeOutcome(intent, r.route, r.status, r.reasonCode,
          { elapsedMs: mono() - startedAt });
        break;
      }
      case 'CONTINUE_LISTENING': case 'RESUME_CONTEXT': {
        const r = await runContinuity();
        outcome = makeOutcome(intent, r.route, r.status, r.reasonCode,
          { elapsedMs: mono() - startedAt });
        break;
      }
      case 'PLAY_SOMETHING_FOR_DRIVE': case 'PLAY_SOMETHING_CALMER':
      case 'PLAY_SOMETHING_MORE_ENERGETIC': case 'CONTINUE_SUGGESTED': {
        outcome = await runContextual(intent);
        break;
      }
      case 'ADD_FAVORITE': case 'REMOVE_FAVORITE': case 'PLAY_FAVORITES': {
        outcome = await runCollection(intent, startedAt);
        break;
      }
      case 'CREATE_PLAYLIST': case 'ADD_TO_PLAYLIST':
      case 'REMOVE_FROM_PLAYLIST': case 'PLAY_MY_PLAYLIST': {
        outcome = await runPlaylist(intent, startedAt);
        break;
      }
      case 'SHOW_LYRICS': case 'HIDE_LYRICS': case 'QUERY_LYRICS_AVAILABILITY': {
        outcome = await runLyrics(intent, startedAt);
        break;
      }
      case 'CONTINUE_LIKE_THIS': case 'START_RADIO':
      case 'PLAY_FAVORITES_MIX': case 'LONG_DRIVE_MIX': {
        outcome = await runSmartRadio(intent, startedAt);
        break;
      }
      default: {
        const r = await runAudio(intent);
        outcome = makeOutcome(intent, r.route, r.status, r.reasonCode,
          { elapsedMs: mono() - startedAt });
        break;
      }
    }
  } catch (e) {
    logError('MusicIntent:Dispatch', e);
    outcome = makeOutcome(intent, 'NONE', 'FAILED', 'router_threw',
      { elapsedMs: mono() - startedAt });
  }

  /* Bayat tur: sonuç konuşulabilir bir iddiaya DÖNÜŞTÜRÜLMEZ. */
  if (isStale(gen) && outcome.status !== 'REJECTED') {
    noteStaleIntentDrop();
    outcome = makeOutcome(intent, outcome.route, 'REJECTED', 'superseded',
      { elapsedMs: outcome.elapsedMs });
  }

  noteIntentOutcome({
    kind: intent.kind,
    route: outcome.route,
    status: outcome.status,
    claim: outcome.claim,
    reasonCode: outcome.reasonCode,
    sourcePreference: intent.source?.providerId ?? null,
    usedContextEvidence: outcome.usedContextEvidence,
    elapsedMs: outcome.elapsedMs,
    atMs: nowMs,
  });
  return outcome;
}

/**
 * Söylenen ifadeyi çözer ve yürütür — Mavi'nin TEK müzik girişi.
 *
 * `null` = bu bir müzik komutu değildi; çağıran kendi akışına devam eder
 * (F9 burada niyet UYDURMAZ).
 */
export async function handleMusicUtterance(
  utterance: string, nowMs = Date.now(),
): Promise<MusicIntentOutcome | null> {
  const startedAt = mono();
  const intent = resolveMusicIntent(utterance);
  noteIntentResolved(intent?.kind ?? null, mono() - startedAt);
  if (intent === null) return null;
  return dispatchMusicIntent(intent, nowMs);
}

export function _resetMusicIntentRouterForTest(): void {
  generation = 0;
  ports = DEFAULT_PORTS;
}
