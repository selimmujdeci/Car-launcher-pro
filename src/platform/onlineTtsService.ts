/**
 * onlineTtsService.ts — Online premium TTS (akıllı asistan sesi, hibrit Layer 1).
 *
 * NEDEN: K24 gibi head unit'lerde sistem TTS motoru YOK ve 32-bit Android neural
 * TTS'i çökertiyor. Akıllı asistanın (Gemini/Claude/Grok) cevapları SERBEST metindir
 * → klip bankası kapsayamaz. Ama akıllı asistan **zaten internet ister** (beyni online);
 * o hâlde sesini de **online TTS** ile üretiriz. Motor yok, cihaza kurulum yok, premium,
 * sınırsız dinamik — internet tam lazım olduğu anda zaten vardır.
 *
 * Sağlayıcı: **Gemini TTS** (`gemini-2.5-flash-preview-tts`) — asistanla aynı BYOK
 * `geminiApiKey` anahtarı. Merkezi/gömülü anahtar YOK (CLAUDE.md BYOK kuralı).
 * Yanıt: base64 PCM (L16, mono) → çalışma anında WAV'a sarılır → HTMLAudioElement
 * ile çalınır (Chrome 64-78 uyumlu). Offline / anahtar yok / hata → `false` döner,
 * çağıran klip/native TTS yedeğine düşer.
 */

import { signalWithTimeout } from '../utils/abortCompat';
import { sensitiveKeyStore } from './sensitiveKeyStore';
import { duckMedia, unduckMedia } from './audioService';

const TTS_MODEL    = 'gemini-2.5-flash-preview-tts';
const TTS_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${TTS_MODEL}:generateContent`;
const TTS_TIMEOUT_MS = 12_000;
/** Gemini önceden tanımlı ses; çok dilli (Türkçe metni Türkçe okur). */
const TTS_VOICE = 'Kore';

/** Aynı metni tekrar sentezlemeyi önleyen küçük LRU (maliyet + gecikme). */
const _cache = new Map<string, string>();   // text → blob URL
const CACHE_MAX = 40;

/** Kota aşımı (429) sonrası soğuma — boşa istek + fatura yükü önler. */
let _rateLimitedUntil = 0;
const RATE_LIMIT_COOLDOWN_MS = 60_000;

let _active: HTMLAudioElement | null = null;
let _seq = 0;

function _now(): number { return Date.now(); }

/** base64 PCM (16-bit LE mono) → çalınabilir WAV blob URL. */
function _pcmToWavUrl(b64: string, sampleRate: number): string {
  const bin = atob(b64);
  const len = bin.length;
  const buffer = new ArrayBuffer(44 + len);
  const view = new DataView(buffer);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + len, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);             // PCM fmt chunk
  view.setUint16(20, 1, true);              // format = PCM
  view.setUint16(22, 1, true);              // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate (mono 16-bit)
  view.setUint16(32, 2, true);              // block align
  view.setUint16(34, 16, true);             // bits/sample
  writeStr(36, 'data');
  view.setUint32(40, len, true);
  const pcm = new Uint8Array(buffer, 44);
  for (let i = 0; i < len; i++) pcm[i] = bin.charCodeAt(i);
  return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
}

/** mimeType'tan örnekleme hızını çıkar (ör. "audio/L16;codec=pcm;rate=24000"). */
function _rateFromMime(mime: string | undefined): number {
  const m = mime?.match(/rate=(\d+)/);
  return m ? parseInt(m[1], 10) : 24_000;
}

/** Online TTS şu an kullanılabilir mi (online + anahtar var + kota açık). */
export async function isOnlineTtsAvailable(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
  if (_now() < _rateLimitedUntil) return false;
  const key = await sensitiveKeyStore.get('geminiApiKey').catch(() => '');
  return !!key;
}

/** Metni Gemini TTS ile sentezle → çalınabilir WAV blob URL (yoksa null). */
async function _synthesize(text: string): Promise<string | null> {
  const cached = _cache.get(text);
  if (cached) return cached;

  if (typeof navigator !== 'undefined' && navigator.onLine === false) return null;
  if (_now() < _rateLimitedUntil) return null;

  const apiKey = await sensitiveKeyStore.get('geminiApiKey').catch(() => '');
  if (!apiKey) return null;

  let resp: Response;
  try {
    resp = await fetch(`${TTS_ENDPOINT}?key=${apiKey}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: TTS_VOICE } } },
        },
      }),
      signal: signalWithTimeout(TTS_TIMEOUT_MS), // Chrome <103 WebView güvenli (abortCompat)
    });
  } catch {
    return null; // ağ/timeout → yedeğe düş
  }

  if (resp.status === 429) { _rateLimitedUntil = _now() + RATE_LIMIT_COOLDOWN_MS; return null; }
  if (!resp.ok) return null;

  let data: unknown;
  try { data = await resp.json(); } catch { return null; }

  const part = (data as {
    candidates?: { content?: { parts?: { inlineData?: { data?: string; mimeType?: string } }[] } }[];
  })?.candidates?.[0]?.content?.parts?.[0]?.inlineData;
  if (!part?.data) return null;

  let url: string;
  try { url = _pcmToWavUrl(part.data, _rateFromMime(part.mimeType)); } catch { return null; }

  // LRU yerleştir (en eskiyi düşür, blob URL'yi serbest bırak)
  _cache.set(text, url);
  if (_cache.size > CACHE_MAX) {
    const oldestKey = _cache.keys().next().value as string | undefined;
    if (oldestKey !== undefined) {
      const oldUrl = _cache.get(oldestKey);
      _cache.delete(oldestKey);
      if (oldUrl) { try { URL.revokeObjectURL(oldUrl); } catch { /* yok */ } }
    }
  }
  return url;
}

/**
 * Metni online TTS ile seslendir. Başarılıysa `true` döner (ses çalmaya başladı);
 * offline / anahtar yok / hata → `false` (çağıran native TTS yedeğine düşmeli).
 * `onEnd` yalnız ses gerçekten çaldıysa, bitiş/hata anında bir kez çağrılır.
 */
export async function speakOnline(text: string, onEnd?: () => void): Promise<boolean> {
  const t = text.trim();
  if (!t) return false;
  if (typeof Audio === 'undefined') return false;

  const seq = ++_seq;
  const url = await _synthesize(t);
  if (!url) return false;
  // Bu çağrı uçuştayken daha yeni bir konuşma istendi → bu sonucu çalma (QUEUE_FLUSH).
  if (seq !== _seq) return false;

  if (_active) { try { _active.pause(); } catch { /* zaten durmuş */ } }
  const audio = new Audio(url);
  _active = audio;

  let settled = false;
  let ducked  = false;
  const settle = () => {
    if (settled) return;
    settled = true;
    if (ducked) { unduckMedia(); ducked = false; }
    if (_active === audio) _active = null;
    audio.onended = null;
    audio.onerror = null;
    onEnd?.();
  };

  try {
    const p = audio.play();
    ducked = true;
    duckMedia();
    audio.onended = settle;
    audio.onerror = settle;
    if (p && typeof p.catch === 'function') p.catch(() => settle());
    return true;
  } catch {
    if (_active === audio) _active = null;
    return false;
  }
}

/** Çalan/uçuştaki online sesi durdur. */
export function cancelOnline(): void {
  _seq++; // uçuştaki sentezin sonucu çalmasın
  if (_active) {
    try { _active.pause(); } catch { /* zaten durmuş */ }
    _active = null;
  }
}
