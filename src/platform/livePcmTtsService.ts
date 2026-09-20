/**
 * livePcmTtsService — Gemini Live'dan gelen ham PCM sesi WebView'de çalar.
 *
 * `edgeTtsService` / `onlineTtsService` ile AYNI sınıf: bir SES TAŞIMA katmanı.
 * Metin almaz, sentez yapmaz; `ttsService` (tek seslendirme otoritesi) bunu
 * bir transport olarak sürer (`speakAssistantPcm`) ve `ttsCancel` ile keser.
 *
 *  · Giriş: 16-bit little-endian PCM, mono, 24 kHz (Live çıkış biçimi).
 *  · Web Audio ile ardışık `AudioBufferSourceNode` zamanlaması; bağlam örnekleme
 *    hızı 24 kHz'i vermezse doğrusal yeniden örnekleme (WebView bazen 48 kHz'e
 *    kilitler).
 *  · Ducking: oynatma başlamadan önce istenir, bitiş/iptalde bırakılır
 *    (Edge ile aynı yön — parçalar arasında müzik zıplamaz).
 *  · Latency damgaları: `tts_audio_ready` (ilk parça geldi) ·
 *    `first_audio_requested` (ilk kaynak zamanlandı) · `first_audio_confirmed`
 *    (bağlam `running` iken zamanlanan an geçildi — Web Audio'nun verdiği en
 *    yakın oynatma-başı sinyali; hoparlör çıkışı DEĞİLDİR, öyle sunulmaz).
 *  · Emniyet: bağlam askıda kalırsa (autoplay politikası) ses hiç çalmaz ama
 *    `onended` de gelmez → toplam süre + pay dolunca oturum ZORLA kapanır,
 *    takip dinlemesi kilitlenmez.
 *
 * Tek aktif oynatma: yeni `beginPcmPlayback` eskisini iptal eder.
 */

import { requestDuck, type DuckHandle } from './media/authority/duckRequest';
import type { DuckReason } from './media/authority/duckPolicy';
import { markMaviLatency } from './assistant/maviLatencyTrace';

export const LIVE_PCM_SAMPLE_RATE = 24_000;
const SCHEDULE_LEAD_S   = 0.05;
const END_GRACE_MS      = 2_000;
const CONFIRM_POLL_MS   = 40;

export interface PcmPlaybackHandle {
  /** Ham PCM16 parçası ekle (kuyruğa alınır, sırayla çalar). */
  push(pcm: ArrayBuffer): void;
  /** Başka parça gelmeyecek; kuyruk bitince `onEnd` bir kez çağrılır. */
  end(): void;
  /** Hemen sustur; `onEnd` ÇAĞRILMAZ (iptal bitiş değildir). */
  cancel(): void;
  /** Bu oynatma hâlâ aktif mi (iptal/bitiş görmedi)? */
  readonly active: boolean;
}

/* ── AudioContext sahipliği (tembel, tek örnek, test enjeksiyonu) ────────── */

type AudioContextLike = AudioContext;
let _ctx: AudioContextLike | null = null;
let _ctxFactory: (() => AudioContextLike | null) | null = null;

function _getCtx(): AudioContextLike | null {
  if (_ctx) return _ctx;
  try {
    if (_ctxFactory) { _ctx = _ctxFactory(); return _ctx; }
    const Ctor = (globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
      .AudioContext ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    try { _ctx = new Ctor({ sampleRate: LIVE_PCM_SAMPLE_RATE }); }
    catch { _ctx = new Ctor(); }
    return _ctx;
  } catch { return null; }
}

/** @internal — testler: sahte AudioContext. `null` fabrika = "yetenek yok". */
export function _setPcmAudioContextFactoryForTest(factory: (() => AudioContextLike | null) | null): void {
  _ctxFactory = factory;
  _ctx = null;
}

/* ── PCM → Float32 (+ yeniden örnekleme) ────────────────────────────────── */

export function pcm16ToFloat32(pcm: ArrayBuffer, fromRate: number, toRate: number): Float32Array {
  const view = new DataView(pcm);
  const n = Math.floor(pcm.byteLength / 2);
  const src = new Float32Array(n);
  for (let i = 0; i < n; i++) src[i] = view.getInt16(i * 2, true) / 32768;
  if (fromRate === toRate || n === 0) return src;
  const ratio = fromRate / toRate;
  const outLen = Math.max(1, Math.round(n / ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(n - 1, i0 + 1);
    const t = pos - i0;
    out[i] = src[i0] * (1 - t) + src[i1] * t;
  }
  return out;
}

/* ── Aktif oynatma ──────────────────────────────────────────────────────── */

let _seq = 0;
let _activeHandle: PcmPlaybackHandle | null = null;

export function isPcmPlaybackActive(): boolean {
  return _activeHandle !== null && _activeHandle.active;
}

export function cancelPcmPlayback(): void {
  const h = _activeHandle;
  _activeHandle = null;
  if (h) h.cancel();
}

/**
 * Yeni PCM oynatması başlatır. `null` → bu ortamda Web Audio yok (çağıran
 * Live'ı bu turda kullanmaz; REST+TTS yolu çalışır).
 */
export function beginPcmPlayback(
  onEnd: () => void,
  duckReason: DuckReason = 'MAVI',
): PcmPlaybackHandle | null {
  const ctx = _getCtx();
  if (!ctx) return null;
  cancelPcmPlayback();

  const seq = ++_seq;
  const ctxRate = ctx.sampleRate || LIVE_PCM_SAMPLE_RATE;
  let nextTime = 0;
  let outstanding = 0;
  let ended = false;        // end() çağrıldı
  let done = false;         // onEnd verildi ya da iptal
  let firstScheduled = false;
  let firstConfirmed = false;
  let totalSeconds = 0;
  let duck: DuckHandle | null = null;
  let graceTimer: ReturnType<typeof setTimeout> | null = null;
  let confirmTimer: ReturnType<typeof setTimeout> | null = null;
  const sources = new Set<AudioBufferSourceNode>();

  try { duck = requestDuck(duckReason); } catch { duck = null; }
  try { void ctx.resume?.(); } catch { /* yok */ }

  const release = (): void => {
    if (duck) { try { duck.release(); } catch { /* yok */ } duck = null; }
    if (graceTimer) { clearTimeout(graceTimer); graceTimer = null; }
    if (confirmTimer) { clearTimeout(confirmTimer); confirmTimer = null; }
  };

  const finish = (): void => {
    if (done) return;
    done = true;
    release();
    if (_activeHandle === handle) _activeHandle = null;
    try { onEnd(); } catch { /* dinleyici hatası oynatmayı kırmaz */ }
  };

  const maybeFinish = (): void => {
    if (ended && outstanding === 0) finish();
  };

  const armGrace = (): void => {
    if (graceTimer) clearTimeout(graceTimer);
    // Toplam ses süresi + pay: bağlam askıda kalırsa bile oturum kapanır.
    graceTimer = setTimeout(finish, Math.round(totalSeconds * 1000) + END_GRACE_MS);
  };

  const confirmWhenRunning = (startAt: number): void => {
    if (firstConfirmed) return;
    const poll = (): void => {
      if (done || seq !== _seq) return;
      if (ctx.state === 'running' && ctx.currentTime >= startAt) {
        firstConfirmed = true;
        markMaviLatency('first_audio_confirmed');
        return;
      }
      confirmTimer = setTimeout(poll, CONFIRM_POLL_MS);
    };
    poll();
  };

  const handle: PcmPlaybackHandle = {
    get active(): boolean { return !done; },
    push(pcm: ArrayBuffer): void {
      if (done || ended || seq !== _seq) return;
      let data: Float32Array;
      try { data = pcm16ToFloat32(pcm, LIVE_PCM_SAMPLE_RATE, ctxRate); } catch { return; }
      if (data.length === 0) return;
      if (!firstScheduled) markMaviLatency('tts_audio_ready');
      let buffer: AudioBuffer;
      try {
        buffer = ctx.createBuffer(1, data.length, ctxRate);
        buffer.getChannelData(0).set(data);
      } catch { return; }
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(ctx.destination);
      const startAt = Math.max(ctx.currentTime + SCHEDULE_LEAD_S, nextTime);
      outstanding++;
      sources.add(src);
      src.onended = () => {
        sources.delete(src);
        outstanding = Math.max(0, outstanding - 1);
        maybeFinish();
      };
      try { src.start(startAt); } catch { sources.delete(src); outstanding--; return; }
      nextTime = startAt + buffer.duration;
      totalSeconds += buffer.duration;
      if (!firstScheduled) {
        firstScheduled = true;
        markMaviLatency('first_audio_requested');
        confirmWhenRunning(startAt);
      }
      if (ended) armGrace();
    },
    end(): void {
      if (done || ended) return;
      ended = true;
      armGrace();
      maybeFinish();
    },
    cancel(): void {
      if (done) return;
      done = true;
      release();
      for (const s of sources) { try { s.onended = null; s.stop(); } catch { /* zaten durdu */ } }
      sources.clear();
      outstanding = 0;
      if (_activeHandle === handle) _activeHandle = null;
    },
  };
  _activeHandle = handle;
  return handle;
}
