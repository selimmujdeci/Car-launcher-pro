/**
 * musicIntent.ts — MUSIC F9 · Kanonik MÜZİK NİYETİ sözleşmesi (SAF).
 *
 * Bu, "kullanıcı müzikten NE istedi" sorusunun UI-bağımsız tek cevabıdır.
 * Mavi · sesli komut · (ileride) fiziksel kısayol AYNI sözleşmeyi kullanır;
 * her biri kendi müzik diline sahip OLAMAZ.
 *
 * PAZARLIKSIZ SINIRLAR:
 *   · Bu dosya bir OTORİTE DEĞİLDİR: playback (F0) · kuyruk/oturum (F3) ·
 *     arama (F5) · DSP (F6) · sağlayıcı (F7) · tercih kanıtı (F8) yerinde kalır.
 *   · Desteklenmeyen niyet UYDURULMAZ: sözleşmede olan her niyetin ya kanonik
 *     bir yürütücüsü vardır ya da dürüstçe `UNAVAILABLE` döner.
 *   · Konuşulacak cümle BURADA üretilmez (`musicIntentSpeech`), yürütme burada
 *     yapılmaz (`musicIntentRouter`).
 *
 * SAFLIK: I/O · timer · `Date.now` · global durum · React importu YOKTUR.
 */

import type { ProviderId } from '../providers';

/* ── Niyet türleri ────────────────────────────────────────────────────────
 * Gruplar bilinçlidir: yürütücü sahibi grup başına DEĞİŞİR (transport → F0
 * kapısı · arama → F5 · kuyruk → F3 · bağlamsal → F8 okuması). */

export type TransportIntentKind =
  | 'PLAY' | 'PAUSE' | 'TOGGLE' | 'NEXT' | 'PREVIOUS' | 'STOP'
  | 'SEEK' | 'RESTART_TRACK';

export type SearchIntentKind =
  | 'PLAY_QUERY' | 'PLAY_ARTIST' | 'PLAY_ALBUM' | 'PLAY_PLAYLIST'
  | 'PLAY_LOCAL' | 'PLAY_PROVIDER';

export type QueueIntentKind =
  | 'PLAY_NEXT' | 'ADD_TO_QUEUE' | 'REMOVE_CURRENT' | 'CLEAR_UPCOMING' | 'JUMP_TO';

export type ContinuityIntentKind = 'CONTINUE_LISTENING' | 'RESUME_CONTEXT';

export type ContextualIntentKind =
  | 'PLAY_SOMETHING_FOR_DRIVE'
  | 'PLAY_SOMETHING_CALMER'
  | 'PLAY_SOMETHING_MORE_ENERGETIC'
  | 'CONTINUE_SUGGESTED';

export type AudioIntentKind = 'VOLUME_UP' | 'VOLUME_DOWN' | 'MUTE' | 'UNMUTE';

/**
 * MUSIC F13 · yürütücüsü `musicCollectionAuthority`dir (TEK favori otoritesi).
 * "Favori olmak = çalıyor olmak DEĞİLDİR" — bu grup playback truth ÜRETMEZ.
 */
export type CollectionIntentKind = 'ADD_FAVORITE' | 'REMOVE_FAVORITE' | 'PLAY_FAVORITES';

/**
 * MUSIC F15 · yürütücüsü `musicPlaylistAuthority`dir (TEK playlist otoritesi).
 * F13 `CollectionIntentKind`ten (favoriler) BİLİNÇLİ olarak AYRIDIR — ikisi
 * birbirine DÖNÜŞMEZ. `PLAY_PLAYLIST` (F5 `SearchIntentKind`) ile
 * KARIŞTIRILMAZ: o SAĞLAYICIDA adlı bir listeyi ARAYIP çalar, bu grup
 * CarOS'un KENDİ kalıcı listesini yönetir.
 */
export type PlaylistIntentKind =
  | 'CREATE_PLAYLIST' | 'ADD_TO_PLAYLIST' | 'REMOVE_FROM_PLAYLIST' | 'PLAY_MY_PLAYLIST';

/**
 * MUSIC F16 · yürütücüsü `musicLyricsAuthority`dir (TEK lyrics otoritesi).
 * Bu grup playback truth ÜRETMEZ ve `MusicIndex`/`ListeningSession`i
 * MUTATE ETMEZ — yalnız UI görünürlüğünü (`lyricsPanelVisibility`) TALEP
 * eder ve mevcut öğenin lyrics kanıtını SORGULAR.
 */
export type LyricsIntentKind = 'SHOW_LYRICS' | 'HIDE_LYRICS' | 'QUERY_LYRICS_AVAILABILITY';

/**
 * MUSIC F18 · yürütücüsü `smartRadioRuntime`dır — ama o bir **kuyruk otoritesi
 * DEĞİLDİR**: yalnız aday sırası üretir, yürütme kanonik F3 (`PlayQueue` +
 * `ListeningSession`) yolundadır. F5'in `PLAY_PLAYLIST`i (sağlayıcıda adlı
 * liste arama) ve F13'ün `PLAY_FAVORITES`i (TEK favoriyi çalma) ile
 * KARIŞTIRILMAZ: bu grup SÜREN bir akış ister.
 */
export type RadioIntentKind =
  | 'CONTINUE_LIKE_THIS' | 'START_RADIO' | 'PLAY_FAVORITES_MIX' | 'LONG_DRIVE_MIX';

export type MusicIntentKind =
  | TransportIntentKind | SearchIntentKind | QueueIntentKind
  | ContinuityIntentKind | ContextualIntentKind | AudioIntentKind | CollectionIntentKind
  | PlaylistIntentKind | LyricsIntentKind | RadioIntentKind;

/** Kullanıcı açıkça bir kaynak söylediyse. `null` = kaynak belirtilmedi. */
export interface SourceQualifier {
  readonly providerId: ProviderId;
  /** Kullanıcının söylediği ham etiket (LAB'da görünür, konuşmada kullanılmaz). */
  readonly spoken: string;
}

export interface MusicIntent {
  readonly kind: MusicIntentKind;
  /** Arama niyetlerinde sorgu metni; diğerlerinde `null`. */
  readonly query: string | null;
  /** Açık kaynak niteleyici (— "YouTube'dan aç"). */
  readonly source: SourceQualifier | null;
  /** `SEEK` saniyesi · `JUMP_TO` adım sayısı · ses adımı; yoksa `null`. */
  readonly amount: number | null;
  /**
   * Niyet çözümünün kanıt derecesi.
   * `EXPLICIT` = kullanıcı açıkça söyledi · `DERIVED` = bağlamdan türetildi.
   */
  readonly evidence: 'EXPLICIT' | 'DERIVED';
  /**
   * MUSIC F15 · yalnız `PlaylistIntentKind`de dolar — kullanıcının söylediği
   * playlist adı ("Yol Müzikleri", "Gece Sürüşü"). `query` alanı arama
   * metni ANLAMINA sahip olduğundan (F5 sözleşmesi) burada TEKRAR
   * KULLANILMAZ — ayrı, dar kapsamlı bir alan.
   */
  readonly playlistName: string | null;
}

export const TRANSPORT_KINDS: readonly MusicIntentKind[] = Object.freeze([
  'PLAY', 'PAUSE', 'TOGGLE', 'NEXT', 'PREVIOUS', 'STOP', 'SEEK', 'RESTART_TRACK',
]);
export const SEARCH_KINDS: readonly MusicIntentKind[] = Object.freeze([
  'PLAY_QUERY', 'PLAY_ARTIST', 'PLAY_ALBUM', 'PLAY_PLAYLIST', 'PLAY_LOCAL', 'PLAY_PROVIDER',
]);
export const QUEUE_KINDS: readonly MusicIntentKind[] = Object.freeze([
  'PLAY_NEXT', 'ADD_TO_QUEUE', 'REMOVE_CURRENT', 'CLEAR_UPCOMING', 'JUMP_TO',
]);
export const CONTEXTUAL_KINDS: readonly MusicIntentKind[] = Object.freeze([
  'PLAY_SOMETHING_FOR_DRIVE', 'PLAY_SOMETHING_CALMER',
  'PLAY_SOMETHING_MORE_ENERGETIC', 'CONTINUE_SUGGESTED',
]);
export const COLLECTION_KINDS: readonly MusicIntentKind[] = Object.freeze([
  'ADD_FAVORITE', 'REMOVE_FAVORITE', 'PLAY_FAVORITES',
]);
export const PLAYLIST_KINDS: readonly MusicIntentKind[] = Object.freeze([
  'CREATE_PLAYLIST', 'ADD_TO_PLAYLIST', 'REMOVE_FROM_PLAYLIST', 'PLAY_MY_PLAYLIST',
]);
export const LYRICS_KINDS: readonly MusicIntentKind[] = Object.freeze([
  'SHOW_LYRICS', 'HIDE_LYRICS', 'QUERY_LYRICS_AVAILABILITY',
]);
export const RADIO_KINDS: readonly MusicIntentKind[] = Object.freeze([
  'CONTINUE_LIKE_THIS', 'START_RADIO', 'PLAY_FAVORITES_MIX', 'LONG_DRIVE_MIX',
]);

/** Niyetin kanonik yürütücüsü — LAB'da "hangi otorite çalıştırdı" olarak görünür. */
export type MusicIntentRoute =
  | 'F0_COMMAND_GATEWAY'
  | 'F3_QUEUE_AUTHORITY'
  | 'F3_SESSION_RESUME'
  | 'F5_SEARCH_SELECTION'
  | 'F7_PROVIDER_QUEUE'
  | 'F8_CONTEXT_EVIDENCE'
  | 'F10_TRAIT_EVIDENCE'
  | 'F13_COLLECTION_AUTHORITY'
  | 'F15_PLAYLIST_AUTHORITY'
  | 'F16_LYRICS_AUTHORITY'
  /** MUSIC F18 — aday politikası burada, YÜRÜTME kanonik F3 zincirindedir. */
  | 'F18_SMART_RADIO'
  | 'NONE';

/**
 * Yürütme sonucu — `CommandTruth` sınıflarıyla AYNI dürüstlük derecesini taşır.
 *
 * `ACCEPTED_UNVERIFIED` bir BAŞARI cümlesi kurdurmaz: komut gönderildi ama ses
 * çıktığı DOĞRULANMADI (F0 sözleşmesi).
 */
export type MusicIntentStatus =
  | 'VERIFIED'
  | 'ACCEPTED_UNVERIFIED'
  | 'AMBIGUOUS'
  | 'REJECTED'
  | 'UNAVAILABLE'
  | 'FAILED'
  | 'NOT_ATTEMPTED';

/**
 * Mavi'nin KURABİLECEĞİ iddia sınıfı.
 *
 * Bu, `MusicIntentStatus`tan TÜRETİLİR ve konuşma katmanı yalnız bunu görür —
 * "çalıyor" cümlesi tek bir yerden, kanıta bağlı olarak doğar.
 */
export type SpokenClaimGrade =
  /** Gözlendi: "çalıyor / durdurdum / geçtim" denebilir. */
  | 'CONFIRMED'
  /** Gönderildi, doğrulanmadı: yalnız "başlatmayı deniyorum" denebilir. */
  | 'ATTEMPTED'
  /** Netleştirme gerekiyor: hiçbir şey başlatılmadı. */
  | 'NEEDS_CHOICE'
  /** Yapılamadı ve bunun bilinen bir nedeni var. */
  | 'DECLINED';

export function claimGradeFor(status: MusicIntentStatus): SpokenClaimGrade {
  switch (status) {
    case 'VERIFIED': return 'CONFIRMED';
    case 'ACCEPTED_UNVERIFIED': return 'ATTEMPTED';
    case 'AMBIGUOUS': return 'NEEDS_CHOICE';
    default: return 'DECLINED';
  }
}

/** Netleştirme adayı — kullanıcıya okunacak ad, teknik skor TAŞIMAZ. */
export interface MusicIntentChoice {
  readonly title: string;
  readonly artist: string | null;
  /** MUSIC F15: playlist adı belirsizliğinde bir ProviderId'ye BAĞLI DEĞİLDİR. */
  readonly providerId: ProviderId | null;
}

export interface MusicIntentOutcome {
  readonly intent: MusicIntent;
  readonly route: MusicIntentRoute;
  readonly status: MusicIntentStatus;
  readonly claim: SpokenClaimGrade;
  /** Teknik neden kodu — LAB'a gider, KULLANICIYA OKUNMAZ. */
  readonly reasonCode: string;
  /** Konuşmada geçebilecek içerik adı (varsa) — uydurulmaz. */
  readonly subject: string | null;
  /** `AMBIGUOUS` durumunda en fazla 3 aday. */
  readonly choices: readonly MusicIntentChoice[];
  /** Bağlamsal istekte F8 kanıtı kullanıldı mı. */
  readonly usedContextEvidence: boolean;
  readonly elapsedMs: number;
}

export const makeIntent = (
  kind: MusicIntentKind,
  o: Partial<Omit<MusicIntent, 'kind'>> = {},
): MusicIntent => Object.freeze({
  kind,
  query: o.query ?? null,
  source: o.source ?? null,
  amount: o.amount ?? null,
  evidence: o.evidence ?? 'EXPLICIT',
  playlistName: o.playlistName ?? null,
});

export const makeOutcome = (
  intent: MusicIntent, route: MusicIntentRoute, status: MusicIntentStatus,
  reasonCode: string, o: Partial<Pick<MusicIntentOutcome,
    'subject' | 'choices' | 'usedContextEvidence' | 'elapsedMs'>> = {},
): MusicIntentOutcome => Object.freeze({
  intent,
  route,
  status,
  claim: claimGradeFor(status),
  reasonCode,
  subject: o.subject ?? null,
  choices: Object.freeze([...(o.choices ?? [])]),
  usedContextEvidence: o.usedContextEvidence === true,
  elapsedMs: o.elapsedMs ?? 0,
});
