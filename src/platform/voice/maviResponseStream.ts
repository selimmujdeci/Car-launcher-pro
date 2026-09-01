/**
 * maviResponseStream.ts — **MAVİ F4 · AKIŞ CEVABI KOORDİNATÖRÜ.**
 *
 * ── NE YAPAR ────────────────────────────────────────────────────────────────
 * LLM token akışını **güvenli konuşmaya** çeviren TEK yer. Zinciri kurar:
 *
 *   token ──► streamSayExtractor ──► speechChunker ──► maviSpeechStream ──► TTS
 *             (yapısal ayrım)        (güvenli parça)   (sıra · tek oturum)
 *
 * ── DÖRT SERT SINIR ─────────────────────────────────────────────────────────
 *  1. **HAM TOKEN KONUŞULMAZ.** Token önce `streamSayExtractor`'dan geçer;
 *     yapısal çıktı (`action`/`web`) ise akıştan HİÇBİR ŞEY konuşulmaz.
 *  2. **LLM AKIŞI OTORİTE DEĞİLDİR.** Bu modül eylem üretmez, intent çözmez,
 *     `commandExecutor`/`dispatchIntent` çağırmaz. Eylem kanonik zincirde kalır.
 *  3. **AKIŞ TEK `answer`DIR.** `maviSpeech.claimMaviAnswerStream` ile tur
 *     başına tek-cevap slotu BİR KEZ tutulur → nihai metnin ayrıca konuşulması
 *     yapısal olarak imkânsızdır (DUPLICATE YOK).
 *  4. **SÜRÜŞTE AÇILMAZ.** Sürüşte cevap zaten ISO 15008 gereği 8 kelimeye
 *     iner; parçalamanın kazancı yok, cümleyi bölme riski var.
 *
 * ── İPTAL ZİNCİRİ ───────────────────────────────────────────────────────────
 * `cancel()` → kuyruk temizlenir → TTS kesilir → sağlayıcı akışı abort edilir →
 * konuşma oturumu bildirimSİZ kapanır (iptal bir tamamlanma DEĞİLDİR).
 *
 * ── VARSAYILAN KAPALI ───────────────────────────────────────────────────────
 * Şalter kapalıyken bu modül HİÇ devreye girmez ve `onToken` sağlayıcıya
 * verilmez → istek akış kipine bile geçmez, davranış bugünküyle BİREBİR aynıdır.
 */

import {
  claimMaviAnswerStream, speakMaviAnswerChunk, releaseMaviAnswerStream,
  releaseMaviAnswerSlot,
} from '../assistant/maviSpeech';
import {
  beginTtsSpeechSession, endTtsSpeechSession, ttsCancel, registerTtsChunkEndListener,
} from '../ttsService';
import type { MaviTurnToken } from '../assistant/maviTurn';
import { isMaviTurnCurrent } from '../assistant/maviTurn';
import { createSayExtractor, type SayExtractor } from './streamSayExtractor';
import { createSpeechChunker, DEFAULT_CHUNK_POLICY, type SpeechChunker } from './speechChunker';
import {
  openSpeechStream, pushSpeechChunk, finishSpeechStream, cancelSpeechStream,
  configureSpeechStreamPorts, activeSpeechStreamId, getSpeechStreamDiagnostics,
  type StreamEndReason,
} from './maviSpeechStream';
import { llmStreamCapability, ttsStreamCapability, supportsTokenStream } from './streamCapability';
import {
  markMaviLatency, setMaviLatencyStream, hasMaviLatencyMark,
} from '../assistant/maviLatencyTrace';
/* MAVI-F8: bounded sayaç — YENİ telemetri sistemi kurulmaz, mevcut defter artar.
   Bu import SAF sayaç modülüdür; workload ÇÖZÜMLEMESİ burada YAPILMAZ. */
import { noteStreamShortened } from '../assistant/maviWorkload';

/** Yerel/LAB kaldıracı — YALNIZ tam `"true"` açar (fail-closed). */
export const MAVI_F4_STREAM_FLAG = 'mavi.streamingResponse.enabled';
/** Uzak yapılandırma bayrağı adı (değeri composition root enjekte eder). */
export const MAVI_F4_REMOTE_FLAG = 'mavi_streaming_response';
let _remoteFlag = false;

/** Composition root'tan uzak bayrağı bağlar (F0/F3 deseniyle AYNI). */
export function setMaviStreamingResponseRemoteFlag(enabled: boolean): void {
  _remoteFlag = enabled === true;
}

export function isMaviStreamingResponseEnabled(): boolean {
  if (_remoteFlag) return true;
  try {
    return typeof localStorage !== 'undefined'
      && localStorage.getItem(MAVI_F4_STREAM_FLAG) === 'true';
  } catch { return false; }
}

/** Akış tüketicisi — `voiceService` bunu sağlayıcıya `onToken` olarak verir. */
export interface ResponseStreamHandle {
  /** Sağlayıcıdan gelen ham token. **Doğrudan konuşulmaz.** */
  readonly onToken: (token: string) => void;
  /** Sağlayıcı akışı normal bitirdi — tamponda kalan konuşulur. */
  readonly complete: () => void;
  /** İptal (barge-in · yeni tur · hata) — zincirin tamamı durur. */
  readonly cancel: () => void;
  /** Akış GERÇEKTEN konuştu mu (nihai metnin tekrar konuşulup konuşulmayacağı). */
  readonly spoke: () => boolean;
}

interface ActiveResponse {
  turn: MaviTurnToken | null;
  extractor: SayExtractor;
  chunker: SpeechChunker;
  streamId: number;
  spokeAny: boolean;
  cancelUpstream: (() => void) | undefined;
  closed: boolean;
  /** MAVI-F8: iş yükü yükseldiği için YENİ parça KABUL EDİLMİYOR. */
  shortened: boolean;
}

let _active: ActiveResponse | null = null;

/* ══════════════════════════════════════════════════════════════════════════
 * MAVI-F8 · GERÇEK ZAMANLI İŞ YÜKÜ KAPISI
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Akış SÜRERKEN "uzun konuşmaya hâlâ yer var mı" sorusunu yanıtlayan port.
 *
 * **NEDEN PORT:** bu modül `maviWorkload`u doğrudan okumaz — okusaydı F4 akış
 * zinciri workload adaptörünün (navigasyon store + güvenlik çekirdeği) grafiğini
 * yutardı. Port composition root'ta bağlanır; bağlı değilse akış bugünkü gibi
 * çalışır (davranış regresyonu YOK).
 */
export type ResponseStreamWorkloadPort = () => boolean;

let _workloadPort: ResponseStreamWorkloadPort | null = null;

export function setResponseStreamWorkloadPort(port: ResponseStreamWorkloadPort | null): void {
  _workloadPort = typeof port === 'function' ? port : null;
}

/** Port yoksa/düşerse `true` — kapı FAIL-OPEN'dır (akışı sessizce öldürmez). */
function _streamingStillAllowed(): boolean {
  if (!_workloadPort) return true;
  try { return _workloadPort() !== false; } catch { return true; }
}

/**
 * İş yükü yükseldi → **YENİ parça alınmaz, kuyruktaki parçalar BİTİRİLİR.**
 *
 * `cancelSpeechStream` KULLANILMAZ: o, konuşmayı kelimenin ortasından keserdi.
 * `finishSpeechStream` kuyruğun doğal olarak boşalmasını bekler → ses bütünlüğü
 * ve audio otoritesi BOZULMAZ. Bu bir SAHTE TAMAMLANMA da değildir: kesme
 * bounded telemetriye `shortened` olarak yazılır ve LAB'da görünür.
 */
function _shortenForWorkload(a: ActiveResponse): void {
  if (a.shortened || a.closed) return;
  a.shortened = true;
  _workloadShortened = bump(_workloadShortened);
  try { noteStreamShortened(); } catch { /* fail-soft */ }
  try { finishSpeechStream(a.streamId); } catch { /* fail-soft */ }
}

/* Kapanış kancası MODÜL düzeyindedir (aktif kayıt değil): akış `_active`
 * temizlendikten sonra bile kapanabilir (geç `onSessionEnd`), bekçi yine de
 * SÖKÜLMELİDİR. Tek atışlıktır — iki kez çağrılmaz. */
let _closedHook: (() => void) | null = null;

function _fireClosed(): void {
  const hook = _closedHook;
  _closedHook = null;
  if (hook) { try { hook(); } catch { /* fail-soft */ } }
}

/* Bounded tanı — PII YOK. */
let _opened = 0;
let _spokeStreams = 0;
let _structuredSuppressed = 0;
let _workloadShortened = 0;
const MAX_COUNTER = 1_000_000;
const bump = (v: number): number => (v >= MAX_COUNTER ? MAX_COUNTER : v + 1);

export interface BeginResponseStreamOpts {
  readonly turn?: MaviTurnToken | null;
  /** Sağlayıcı kimliği — yetenek matrisinden akış desteği okunur. */
  readonly provider: string;
  /** Sürüşte akış AÇILMAZ (ISO 15008 — bkz. dosya başlığı). */
  readonly isDriving?: boolean;
  /** Sağlayıcı isteğini iptal eden kanca (AbortController.abort). */
  readonly cancelUpstream?: () => void;
  /** Seslendirme katmanı kimliği — yalnız yetenek BİLDİRİMİ için. */
  readonly ttsTier?: string;
  /**
   * Akış TERMİNAL oldu (tamamlandı · iptal · yapısal susma · asılma). Bileşim
   * kökü periyodik açlık bekçisini burada SÖKER. HER kapanış yolundan tam BİR
   * kez çağrılır; çağrılmazsa bekçi timer'ı sızar.
   */
  readonly onClosed?: () => void;
}

/**
 * Akış cevabını başlatır. Uygun DEĞİLSE `null` döner ve çağıran bugünkü
 * (tam cevap → tek seferde konuş) yolunu aynen kullanır.
 *
 * Uygunsuzluk sebepleri — hepsi **sessiz ve güvenli**:
 *  · şalter kapalı (varsayılan) · sürüş hâli · sağlayıcı `FINAL_ONLY` ·
 *  · tur eskimiş ya da bu turda zaten cevap konuşulmuş (`claim` reddi).
 */
export function beginResponseStream(opts: BeginResponseStreamOpts): ResponseStreamHandle | null {
  try {
    if (!isMaviStreamingResponseEnabled()) return null;
    if (opts.isDriving === true) return null;
    if (!supportsTokenStream(opts.provider)) return null;
    if (opts.turn && !isMaviTurnCurrent(opts.turn)) return null;

    // Önceki akış varsa iptal (tur izolasyonu) — iki akış aynı anda konuşamaz.
    if (_active) cancelActiveResponseStream();

    /* `answer` slotu BURADA tutulur. Reddedilirse akış HİÇ başlamaz — "önce
     * konuşmaya başla, sonra bak" yapılmaz (yarım cevap yasağı). */
    if (!claimMaviAnswerStream(opts.turn ?? null)) return null;

    const ttsTier = opts.ttsTier ?? 'edge';
    setMaviLatencyStream({
      llm: llmStreamCapability(opts.provider),
      tts: ttsStreamCapability(ttsTier),
    });

    configureSpeechStreamPorts({
      now: () => (typeof performance !== 'undefined' ? performance.now() : 0),
      speakChunk: (text, done) => {
        /* İlk parçanın sentez isteği — F0 segmenti "parça → ses" burada başlar. */
        if (!hasMaviLatencyMark('first_tts_chunk_request')) markMaviLatency('first_tts_chunk_request');
        const ok = speakMaviAnswerChunk(text, { turn: opts.turn ?? null });
        if (ok && !hasMaviLatencyMark('first_tts_chunk_ready')) markMaviLatency('first_tts_chunk_ready');
        if (!ok) { done(); return; }              // konuşma düştü → sıradakine geç
        /* `speakAssistant` bitiş bildirimini `ttsService`e yapar; oturum açık
         * olduğu için o bildirim YUTULUR. Sıradaki parçaya geçişi burada
         * tetikleriz — parçalar üst üste BİNMEZ, sıra korunur. */
        _awaitChunkEnd(done);
      },
      cancelSpeech: () => { try { ttsCancel(); } catch { /* fail-soft */ } },
      onCancelUpstream: () => { try { opts.cancelUpstream?.(); } catch { /* fail-soft */ } },
      onSessionEnd: (reason) => _onStreamEnd(reason),
    });

    _ensureChunkEndBridge();
    _closedHook = opts.onClosed ?? null;
    beginTtsSpeechSession();                     // TEK konuşma oturumu açılır
    const streamId = openSpeechStream();
    _active = {
      turn: opts.turn ?? null,
      extractor: createSayExtractor(),
      chunker: createSpeechChunker(DEFAULT_CHUNK_POLICY),
      streamId,
      spokeAny: false,
      cancelUpstream: opts.cancelUpstream,
      closed: false,
      shortened: false,
    };
    _opened = bump(_opened);

    return {
      onToken: (token: string) => _onToken(token),
      complete: () => _complete(),
      cancel: () => cancelActiveResponseStream(),
      spoke: () => _active?.spokeAny === true || _lastSpoke,
    };
  } catch {
    return null;                                  // fail-soft: akış kurulamazsa eski yol
  }
}

/* ── Parça bitişi köprüsü ──────────────────────────────────────────────────
 * Sıradaki parça ancak ÖNCEKİ bitince istenir → iki TTS parçası ÜST ÜSTE
 * BİNEMEZ ve sıra korunur. Sinyal `ttsService.registerTtsChunkEndListener`ten
 * gelir: o dinleyici akış oturumu açıkken de çalışır (cevap-bitti dinleyicisi
 * ise akış boyunca YUTULUR — ikisi bilinçli olarak AYRI kanaldır).
 *
 * Motor bitiş bildirimi hiç göndermezse akış asılmaz: `maviSpeechStream`in
 * açlık kapısı (`tickSpeechStream`) oturumu dürüstçe kapatır. */
type EndHook = () => void;
const _chunkEndHooks: EndHook[] = [];
let _chunkEndUnsub: (() => void) | null = null;

function _ensureChunkEndBridge(): void {
  if (_chunkEndUnsub) return;
  _chunkEndUnsub = registerTtsChunkEndListener(() => {
    const hook = _chunkEndHooks.shift();
    if (hook) { try { hook(); } catch { /* fail-soft */ } }
  });
}

function _teardownChunkEndBridge(): void {
  _chunkEndHooks.length = 0;
  if (_chunkEndUnsub) { try { _chunkEndUnsub(); } catch { /* fail-soft */ } _chunkEndUnsub = null; }
}

function _awaitChunkEnd(done: () => void): void {
  let settled = false;
  _chunkEndHooks.push(() => { if (settled) return; settled = true; done(); });
}

function _onToken(token: string): void {
  const a = _active;
  if (!a || a.closed) return;
  if (a.turn && !isMaviTurnCurrent(a.turn)) { cancelActiveResponseStream(); return; }
  if (!hasMaviLatencyMark('brain_first_token')) markMaviLatency('brain_first_token');

  const delta = a.extractor.push(token);
  if (a.extractor.state() === 'STRUCTURED') {
    /* YAPISAL ÇIKTI: `action`/`web` — bu akıştan HİÇBİR ŞEY konuşulmaz.
     * Akış sessizce kapanır; karar ve seslendirme kanonik zincire kalır. */
    _structuredSuppressed = bump(_structuredSuppressed);
    _closeSilently();
    return;
  }
  if (!delta) return;
  /* MAVI-F8 · GERÇEK ZAMANLI KAPI: cevap sürerken iş yükü yükseldiyse (yakın
   * manevra · geri vites · kritik durum) YENİ parça KABUL EDİLMEZ. Kuyruktaki
   * parça bitirilir — kelime ortasından kesme YOK, sahte tamamlanma YOK. */
  if (a.shortened) return;
  if (!_streamingStillAllowed()) { _shortenForWorkload(a); return; }

  for (const chunk of a.chunker.push(delta)) {
    if (!hasMaviLatencyMark('first_speech_chunk_ready')) markMaviLatency('first_speech_chunk_ready');
    if (pushSpeechChunk(a.streamId, chunk)) a.spokeAny = true;
  }
}

function _complete(): void {
  const a = _active;
  if (!a || a.closed) return;
  markMaviLatency('llm_stream_complete');
  if (a.shortened) return;      // MAVI-F8: kısaltıldı → kalan metin konuşulmaz
  const tail = a.extractor.finish();
  if (a.extractor.state() === 'STRUCTURED') { _closeSilently(); return; }
  if (tail) a.chunker.push(tail);
  for (const chunk of a.chunker.flush()) {
    if (!hasMaviLatencyMark('first_speech_chunk_ready')) markMaviLatency('first_speech_chunk_ready');
    if (pushSpeechChunk(a.streamId, chunk)) a.spokeAny = true;
  }
  finishSpeechStream(a.streamId);                 // kuyruk boşalınca oturum kapanır
}

/**
 * Yapısal çıktı ya da konuşulacak metin yok → **ses üretmeden** kapan.
 * `answer` slotu bırakılır ki kanonik yol (executor/dispatch) cevabı söyleyebilsin.
 */
function _closeSilently(): void {
  const a = _active;
  if (!a || a.closed) return;
  a.closed = true;
  try { cancelSpeechStream(a.streamId); } catch { /* fail-soft */ }
  _teardownChunkEndBridge();
  endTtsSpeechSession(false);                     // bildirim YOK (konuşma olmadı)
  releaseMaviAnswerStream();
  releaseMaviAnswerSlot();                        // sessiz ölüm koruması
  _active = null;
  _fireClosed();
}

/** Son akışın konuşup konuşmadığı (handle kapandıktan sonra da sorulabilir). */
let _lastSpoke = false;

function _onStreamEnd(reason: StreamEndReason): void {
  const a = _active;
  _lastSpoke = a?.spokeAny === true;
  if (a) a.closed = true;
  _teardownChunkEndBridge();
  setMaviLatencyStream({
    endReason: reason,
    chunkCount: getSpeechStreamDiagnostics().chunksSpoken,
  });
  if (reason === 'CANCELLED') markMaviLatency('stream_cancelled');
  else markMaviLatency('tts_stream_complete');
  releaseMaviAnswerStream();
  if (_lastSpoke) _spokeStreams = bump(_spokeStreams);
  /* Konuşma GERÇEKTEN olduysa oturum kapanışı bitiş bildirimi YAYINLAR →
   * `voiceService` takip dinlemesini/idle'ı normal akışındaki gibi işler.
   * İptalde bildirim YAPILMAZ: `ttsCancel` zaten uçuştaki sözü bayatlattı ve
   * ikinci bir "bitti" yeni turun mikrofonunu kapatırdı. */
  endTtsSpeechSession(reason !== 'CANCELLED' && _lastSpoke);
  if (!_lastSpoke) releaseMaviAnswerSlot();       // sessiz ölüm koruması
  _active = null;
  _fireClosed();
}

/** Dışarıdan iptal (barge-in · yeni tur · sağlayıcı hatası). */
export function cancelActiveResponseStream(): void {
  const a = _active;
  if (!a) {
    const sid = activeSpeechStreamId();
    if (sid) cancelSpeechStream(sid);
    return;
  }
  try { cancelSpeechStream(a.streamId); } catch { /* fail-soft */ }
}

/** CAROS LAB gözlem yüzeyi — **METİN TAŞIMAZ**. */
export function getResponseStreamDiagnostics(): {
  readonly enabled: boolean;
  readonly active: boolean;
  readonly opened: number;
  readonly spokeStreams: number;
  readonly structuredSuppressed: number;
  /** MAVI-F8: iş yükü yükseldiği için erken kapatılan akış adedi. */
  readonly workloadShortened: number;
} {
  return Object.freeze({
    enabled: isMaviStreamingResponseEnabled(),
    active: _active !== null,
    opened: _opened,
    spokeStreams: _spokeStreams,
    structuredSuppressed: _structuredSuppressed,
    workloadShortened: _workloadShortened,
  });
}

/** @internal — testler arası izolasyon. */
export function _resetResponseStreamForTest(): void {
  _active = null;
  _closedHook = null;
  _remoteFlag = false;
  _lastSpoke = false;
  _teardownChunkEndBridge();
  _opened = 0;
  _spokeStreams = 0;
  _structuredSuppressed = 0;
  _workloadShortened = 0;
  _workloadPort = null;
}
