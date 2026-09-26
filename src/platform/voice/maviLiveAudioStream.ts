/**
 * maviLiveAudioStream — Gemini Live turunun SES/TRANSKRİPT/TOOL çıktısını
 * Mavi'nin tur mührüne ve tek seslendirme otoritesine bağlar.
 *
 * `maviResponseStream` (F4, token akışı) ile AYNI katman ve AYNI ilke:
 *  · Sağlayıcı KONUŞMAZ — parçaları bu handle'ın sink'lerine verir.
 *  · Her parça tur mührüyle kapılanır: bayat tur (yeni komut geldi) sesi
 *    ANINDA kesilir ve sonraki parçalar düşer (duplicate cevap yasağı).
 *  · Ses `maviSpeech.beginMaviAnswerPcm` üzerinden `ttsService`e gider —
 *    ducking, `isTtsSpeaking`, self-echo kapısı, follow-up tetiği aynen.
 *  · TOOL ÇAĞRISI görülen turda ses SUSTURULUR: onayı kanonik `dispatch`
 *    söyler (tek konuşan). Tool öncesi sızan kısa ses parçası bilinen risktir
 *    (sistem talimatı "araç çağırdığın turda konuşma" der).
 *  · Latency: ilk çıktı → `brain_first_token` (Live'da ilk ses/transkript
 *    parçası ilk token'a denktir; kapasite `CHUNK_STREAM`/`TRUE_STREAMING`
 *    olarak ize yazılır — sahte iddia yok, her ikisi de gerçekten akıştır).
 *
 * Bu modül rota seçmez, sağlayıcı bilmez, ağ görmez.
 */

import { isMaviTurnCurrent, type MaviTurnToken } from '../assistant/maviTurn';
import { beginMaviAnswerPcm, releaseMaviAnswerSlot } from '../assistant/maviSpeech';
import type { PcmPlaybackHandle } from '../livePcmTtsService';
import {
  markMaviLatency, hasMaviLatencyMark, setMaviLatencyStream,
} from '../assistant/maviLatencyTrace';
import type { LiveToolCall, LiveTurnSinks } from '../ai/live/geminiLiveSession';

export interface LiveAudioStreamHandle {
  /** Sağlayıcıya verilecek sink'ler. */
  readonly sinks: LiveTurnSinks;
  /** Sağlayıcı turu tamamladı → kuyruk bitince konuşma oturumu kapanır. */
  complete(): void;
  /** Arıza/supersede → ses anında kesilir (`onEnd` tetiklenmez). */
  abort(): void;
  /** Bu turda gerçekten ses çalmaya verildi mi? (fallback yasağı kanıtı) */
  readonly spokeAudio: boolean;
  /** Biriken çıkış transkripti (geçmiş/UI; PII sağlayıcıdan zaten geçti). */
  readonly transcript: string;
  /** Turda tool çağrısı görüldü mü? */
  readonly sawToolCall: boolean;
}

export interface BeginLiveAudioStreamOpts {
  readonly turn: MaviTurnToken | null;
  readonly onToolCall?: (call: LiveToolCall) => void;
  /** Provider turunu da iptal eden lifecycle portu; ses iptali tek başına yetmez. */
  readonly cancelUpstream?: () => void;
}

let _active: {
  turn: MaviTurnToken | null;
  pcm: PcmPlaybackHandle | null;
  cancelUpstream?: () => void;
} | null = null;

/* Sayaçlar — tanı yüzeyi (PII yok). */
let _opened = 0;
let _spoke = 0;
let _staleDropped = 0;
let _toolMuted = 0;

/** Uçuştaki Live ses akışını keser (yeni dinleme / supersede). Idempotent. */
export function cancelActiveLiveAudioStream(): void {
  const a = _active;
  _active = null;
  if (a?.pcm) { try { a.pcm.cancel(); } catch { /* fail-soft */ } }
  if (a?.cancelUpstream) { try { a.cancelUpstream(); } catch { /* fail-soft */ } }
}

export function beginLiveAudioStream(opts: BeginLiveAudioStreamOpts): LiveAudioStreamHandle {
  cancelActiveLiveAudioStream();
  const turn = opts.turn;
  const state = { turn, pcm: null as PcmPlaybackHandle | null, cancelUpstream: opts.cancelUpstream };
  _active = state;
  _opened++;

  let transcript = '';
  let spokeAudio = false;
  let sawToolCall = false;
  let closed = false;

  const stale = (): boolean => {
    // Lifecycle sahibi bu handle'ı aktiflikten çıkardıysa (yeni voice turn,
    // barge-in veya fallback), provider'dan sonradan gelen callback artık
    // sahiplik kazanamaz. Yalnız turn token'ına bakmak yetmez: aynı Mavi turn
    // içinde Live → REST fallback'i de bu kapıdan geçer.
    if (_active !== state) {
      if (!closed) _staleDropped++;
      abort();
      return true;
    }
    if (turn && !isMaviTurnCurrent(turn)) {
      _staleDropped++;
      abort();
      return true;
    }
    return closed;
  };

  const firstOutput = (): void => {
    if (!hasMaviLatencyMark('brain_first_token')) markMaviLatency('brain_first_token');
  };

  const abort = (): void => {
    if (closed) return;
    closed = true;
    if (state.pcm) { try { state.pcm.cancel(); } catch { /* fail-soft */ } state.pcm = null; }
    if (state.cancelUpstream) {
      const cancel = state.cancelUpstream;
      state.cancelUpstream = undefined;
      try { cancel(); } catch { /* fail-soft */ }
    }
    if (_active === state) _active = null;
  };

  const sinks: LiveTurnSinks = {
    onAudioChunk: (pcm) => {
      if (stale() || sawToolCall) return;
      firstOutput();
      if (!state.pcm) {
        const h = beginMaviAnswerPcm(turn);
        if (!h) { return; }   // slot dolu / Web Audio yok → bu turda Live sesi çalmaz
        state.pcm = h;
        setMaviLatencyStream({ llm: 'CHUNK_STREAM', tts: 'TRUE_STREAMING' });
      }
      if (!spokeAudio) { spokeAudio = true; _spoke++; }
      state.pcm.push(pcm);
    },
    onTranscript: (text) => {
      if (stale()) return;
      firstOutput();
      transcript += text;
    },
    onToolCall: (call) => {
      if (stale()) return;
      firstOutput();
      sawToolCall = true;
      // Tek konuşan: tool turunda sağlayıcı sesi susar, onayı dispatch söyler.
      // Sızan ses cevap slotunu TUTMAZ → kanonik onay (dispatch feedback) bastırılmaz.
      if (state.pcm) {
        _toolMuted++;
        try { state.pcm.cancel(); } catch { /* yok */ }
        state.pcm = null;
        try { releaseMaviAnswerSlot(); } catch { /* yok */ }
      }
      try { opts.onToolCall?.(call); } catch { /* fail-soft */ }
    },
    onInterrupted: () => {
      // Sunucu üretimi kesti (yeni girdi) → kuyruktaki ses de susar.
      if (state.pcm) { try { state.pcm.cancel(); } catch { /* yok */ } state.pcm = null; }
    },
  };

  return {
    sinks,
    complete: () => {
      if (closed) return;
      closed = true;
      state.cancelUpstream = undefined;
      if (state.pcm) { try { state.pcm.end(); } catch { /* yok */ } }
      if (_active === state) _active = null;
    },
    abort,
    get spokeAudio(): boolean { return spokeAudio; },
    get transcript(): string { return transcript; },
    get sawToolCall(): boolean { return sawToolCall; },
  };
}

export function getLiveAudioStreamDiagnostics(): {
  opened: number; spoke: number; staleDropped: number; toolMuted: number; active: boolean;
} {
  return { opened: _opened, spoke: _spoke, staleDropped: _staleDropped, toolMuted: _toolMuted, active: _active !== null };
}

/** @internal */
export function _resetLiveAudioStreamForTest(): void {
  cancelActiveLiveAudioStream();
  _opened = 0; _spoke = 0; _staleDropped = 0; _toolMuted = 0;
}
