/**
 * GEMINI LIVE · voice katmanı — ses akışı TEK seslendirme otoritesinden geçer.
 *
 * Kilitler:
 *  · Live sesi `ttsService` üzerinden çalar: `isTtsSpeaking` kurulur, taşıma
 *    WEBVIEW_AUDIO, bitişte TTS-end dinleyicisi (takip dinlemesinin tetiği) çağrılır.
 *  · Ses çaldıktan sonra aynı turda `speakMaviAnswer(tier=answer)` DUPLICATE
 *    olarak bastırılır (voiceService'in transkripti seslendirmesi imkânsız).
 *  · Tool çağrısı turunda sızan ses susturulur ve slot BIRAKILIR → kanonik
 *    dispatch onayı konuşabilir.
 *  · Bayat tur (yeni komut) parçaları düşürür ve sesi keser.
 *  · `ttsCancel` (yeni dinleme) PCM'i keser; `onEnd` ÇAĞRILMAZ.
 *  · Web Audio yoksa handle null → Live sesi çalmaz, akış kırılmaz.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  beginLiveAudioStream, cancelActiveLiveAudioStream, getLiveAudioStreamDiagnostics,
  _resetLiveAudioStreamForTest,
} from '../platform/voice/maviLiveAudioStream';
import {
  _setPcmAudioContextFactoryForTest, pcm16ToFloat32, isPcmPlaybackActive,
} from '../platform/livePcmTtsService';
import {
  isTtsSpeaking, ttsCancel, registerTtsEndListener,
} from '../platform/ttsService';
import {
  speakMaviAnswer, getMaviSpeechDiagnostics, _resetMaviSpeechForTest,
} from '../platform/assistant/maviSpeech';
import { beginMaviTurn, completeMaviTurn, _resetMaviTurnsForTest } from '../platform/assistant/maviTurn';
import {
  openMaviLatencyTrace, hasMaviLatencyMark, _resetMaviLatencyTraceForTest, setMaviLatencyTraceRemoteFlag,
} from '../platform/assistant/maviLatencyTrace';

/* ── Sahte Web Audio ────────────────────────────────────────────────────── */

interface FakeSource { onended: (() => void) | null; started: number | null; stopped: boolean; buffer: { duration: number } | null }

function makeFakeCtx(sampleRate = 24_000) {
  const sources: FakeSource[] = [];
  const ctx = {
    sampleRate,
    state: 'running' as string,
    currentTime: 100,
    destination: {},
    resume: vi.fn(async () => {}),
    createBuffer: (_ch: number, len: number, rate: number) => ({
      duration: len / rate,
      getChannelData: () => new Float32Array(len),
    }),
    createBufferSource: () => {
      const src: FakeSource & { connect: () => void; start: (t: number) => void; stop: () => void } = {
        onended: null, started: null, stopped: false, buffer: null,
        connect: () => {},
        start: (t: number) => { src.started = t; },
        stop: () => { src.stopped = true; },
      };
      sources.push(src);
      return src;
    },
    sources,
  };
  return ctx;
}

const PCM = (samples = 2400): ArrayBuffer => new Int16Array(samples).fill(1000).buffer;

let ctx: ReturnType<typeof makeFakeCtx>;

beforeEach(() => {
  ctx = makeFakeCtx();
  _setPcmAudioContextFactoryForTest(() => ctx as unknown as AudioContext);
  _resetLiveAudioStreamForTest();
  _resetMaviSpeechForTest();
  _resetMaviTurnsForTest();
  _resetMaviLatencyTraceForTest();
  setMaviLatencyTraceRemoteFlag(true);
  ttsCancel();
});
afterEach(() => {
  ttsCancel();
  _setPcmAudioContextFactoryForTest(null);
  setMaviLatencyTraceRemoteFlag(false);
});

describe('pcm16ToFloat32', () => {
  it('24k→24k birebir; 24k→48k örnek sayısı iki katı', () => {
    const buf = new Int16Array([0, 16384, -16384, 32767]).buffer;
    const same = pcm16ToFloat32(buf, 24_000, 24_000);
    expect(same.length).toBe(4);
    expect(same[1]).toBeCloseTo(0.5, 3);
    const up = pcm16ToFloat32(buf, 24_000, 48_000);
    expect(up.length).toBe(8);
  });
});

describe('Live sesi tek seslendirme otoritesinden geçer', () => {
  it('ilk parça → konuşuyor · WEBVIEW_AUDIO · slot tüketildi · latency damgaları', () => {
    openMaviLatencyTrace();
    const turn = beginMaviTurn();
    const h = beginLiveAudioStream({ turn });
    expect(isTtsSpeaking()).toBe(false);

    h.sinks.onAudioChunk!(PCM());
    expect(isTtsSpeaking()).toBe(true);
    expect(h.spokeAudio).toBe(true);
    expect(getMaviSpeechDiagnostics().answeredThisTurn).toBe(true);
    expect(hasMaviLatencyMark('brain_first_token')).toBe(true);
    expect(hasMaviLatencyMark('tts_request')).toBe(true);
    expect(hasMaviLatencyMark('tts_audio_ready')).toBe(true);
    expect(hasMaviLatencyMark('first_audio_requested')).toBe(true);
    expect(ctx.sources).toHaveLength(1);
    expect(ctx.sources[0].started).toBeGreaterThanOrEqual(100);
    completeMaviTurn(turn);
  });

  it('ses çaldıktan sonra aynı turda speakMaviAnswer(answer) DUPLICATE bastırılır', () => {
    const turn = beginMaviTurn();
    const h = beginLiveAudioStream({ turn });
    h.sinks.onAudioChunk!(PCM());
    h.sinks.onTranscript!('İyiyim.');
    h.complete();
    const spoke = speakMaviAnswer('İyiyim.', { channel: 'assistant' });
    expect(spoke).toBe(false);
    expect(getMaviSpeechDiagnostics().suppressedDuplicate).toBe(1);
    expect(h.transcript).toBe('İyiyim.');
  });

  it('kuyruk bitince TTS-end dinleyicisi (takip dinlemesi tetiği) BİR KEZ çağrılır', () => {
    const ended = vi.fn();
    const off = registerTtsEndListener(ended);
    const turn = beginMaviTurn();
    const h = beginLiveAudioStream({ turn });
    h.sinks.onAudioChunk!(PCM());
    h.sinks.onAudioChunk!(PCM());
    h.complete();
    expect(ended).not.toHaveBeenCalled();
    ctx.sources[0].onended?.();
    expect(ended).not.toHaveBeenCalled();
    ctx.sources[1].onended?.();
    expect(ended).toHaveBeenCalledTimes(1);
    expect(isTtsSpeaking()).toBe(false);
    off();
  });

  it('ttsCancel (yeni dinleme) sesi keser; onEnd ÇAĞRILMAZ; kaynaklar durdurulur', () => {
    const ended = vi.fn();
    const off = registerTtsEndListener(ended);
    const turn = beginMaviTurn();
    const h = beginLiveAudioStream({ turn });
    h.sinks.onAudioChunk!(PCM());
    expect(isPcmPlaybackActive()).toBe(true);
    ttsCancel();
    expect(isPcmPlaybackActive()).toBe(false);
    expect(ctx.sources[0].stopped).toBe(true);
    expect(ended).not.toHaveBeenCalled();
    off();
  });
});

describe('tool çağrısı turu — sağlayıcı sesi susar, kanonik onay konuşabilir', () => {
  it('sızan ses iptal edilir, slot bırakılır, sonraki parçalar düşer', () => {
    const turn = beginMaviTurn();
    const h = beginLiveAudioStream({ turn });
    h.sinks.onAudioChunk!(PCM());
    expect(getMaviSpeechDiagnostics().answeredThisTurn).toBe(true);
    h.sinks.onToolCall!({ name: 'mavi_action', args: { intent: 'OPEN_NAVIGATION' } });
    expect(h.sawToolCall).toBe(true);
    expect(ctx.sources[0].stopped).toBe(true);
    expect(getMaviSpeechDiagnostics().answeredThisTurn).toBe(false);
    expect(getLiveAudioStreamDiagnostics().toolMuted).toBe(1);
    h.sinks.onAudioChunk!(PCM());
    expect(ctx.sources).toHaveLength(1);   // tool sonrası ses kabul edilmez
    // Kanonik onay konuşabilir (slot serbest)
    expect(speakMaviAnswer('Eve rota açılıyor', { channel: 'assistant', turn })).toBe(true);
  });
});

describe('tur sahipliği', () => {
  it('bayat tur: parçalar düşer, ses kesilir, staleDropped artar', () => {
    const t1 = beginMaviTurn();
    const h = beginLiveAudioStream({ turn: t1 });
    h.sinks.onAudioChunk!(PCM());
    beginMaviTurn();   // yeni tur → t1 superseded
    h.sinks.onAudioChunk!(PCM());
    expect(ctx.sources).toHaveLength(1);
    expect(ctx.sources[0].stopped).toBe(true);
    expect(getLiveAudioStreamDiagnostics().staleDropped).toBeGreaterThanOrEqual(1);
    expect(h.spokeAudio).toBe(true);   // kanıt korunur: bu tur ses ÇALMIŞTI (fallback yasağı)
  });

  it('yeni akış eskisini kapatır; cancelActiveLiveAudioStream idempotent', () => {
    const t = beginMaviTurn();
    const a = beginLiveAudioStream({ turn: t });
    a.sinks.onAudioChunk!(PCM());
    const b = beginLiveAudioStream({ turn: t });
    expect(ctx.sources[0].stopped).toBe(true);
    cancelActiveLiveAudioStream();
    cancelActiveLiveAudioStream();
    expect(getLiveAudioStreamDiagnostics().active).toBe(false);
    void b;
  });

  it('yeni voice turn cleanup upstream Live turunu iptal eder; geç audio/tool eventi düşer', () => {
    const cancelUpstream = vi.fn();
    const onToolCall = vi.fn();
    const turn = beginMaviTurn();
    const h = beginLiveAudioStream({ turn, cancelUpstream, onToolCall });

    cancelActiveLiveAudioStream();
    cancelActiveLiveAudioStream();
    expect(cancelUpstream).toHaveBeenCalledTimes(1);

    h.sinks.onAudioChunk!(PCM());
    h.sinks.onTranscript!('geç cevap');
    h.sinks.onToolCall!({ name: 'mavi_action', args: { intent: 'OPEN_NAVIGATION' } });
    expect(ctx.sources).toHaveLength(0);
    expect(h.transcript).toBe('');
    expect(h.sawToolCall).toBe(false);
    expect(onToolCall).not.toHaveBeenCalled();
    expect(getLiveAudioStreamDiagnostics().staleDropped).toBeGreaterThanOrEqual(1);
  });

  it('production startListening lifecycle önceki Live upstream turunu cancel eder', async () => {
    const cancelUpstream = vi.fn();
    const turn = beginMaviTurn();
    beginLiveAudioStream({ turn, cancelUpstream });
    const speech = {
      lang: '', interimResults: false, continuous: false, maxAlternatives: 1,
      start: vi.fn(), stop: vi.fn(), abort: vi.fn(),
    };
    const w = window as unknown as { webkitSpeechRecognition?: new () => typeof speech };
    w.webkitSpeechRecognition = class { constructor() { return speech; } } as unknown as new () => typeof speech;

    const voice = await import('../platform/voiceService');
    voice._resetVoiceServiceForTest();
    voice.startListening();
    expect(cancelUpstream).toHaveBeenCalledTimes(1);
    voice.stopListening();
    delete w.webkitSpeechRecognition;
  });
});

describe('Web Audio yok', () => {
  it('handle ses çalmaz ama akış kırılmaz; spokeAudio=false (REST+TTS yolu transkripti konuşabilir)', () => {
    _setPcmAudioContextFactoryForTest(() => null);
    const turn = beginMaviTurn();
    const h = beginLiveAudioStream({ turn });
    h.sinks.onAudioChunk!(PCM());
    h.sinks.onTranscript!('metin');
    expect(h.spokeAudio).toBe(false);
    expect(isTtsSpeaking()).toBe(false);
    expect(getMaviSpeechDiagnostics().answeredThisTurn).toBe(false);
    h.complete();
  });
});
