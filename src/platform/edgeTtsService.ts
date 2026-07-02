/**
 * edgeTtsService.ts — Edge (Microsoft) Neural TTS: premium Türkçe ses, kotasız.
 *
 * NEDEN: Gemini TTS ücretsiz kotası günlük çok düşük (saha 2026-07-03: kota
 * bitince asistan sesi robotik erkek eSpeak'e düşüyordu). Edge Neural
 * (tr-TR-EmelNeural) premium kadın sesi, pratikte kotasız. Tarayıcıdan
 * doğrudan çağrılamaz (CORS + Sec-MS-GEC token) → carospro.com/api/tts proxy'si.
 *
 * Hibrit sırada 1. katman: speakAssistant → Edge → (yoksa) Gemini TTS → eSpeak.
 * Offline / proxy hatası → false döner, çağıran yedeğe düşer.
 */

import { duckMedia, unduckMedia } from './audioService';

const TTS_URL =
  (import.meta.env.VITE_EDGE_TTS_URL as string | undefined) || 'https://carospro.com/api/tts';
const TIMEOUT_MS = 12_000;

/** Aynı metni tekrar sentezlemeyi önleyen küçük LRU (gecikme + ağ tasarrufu). */
const _cache = new Map<string, string>();  // text → blob URL
const CACHE_MAX = 40;

/** Ardışık hata sonrası soğuma — proxy düştüyse her cümlede 12sn beklememek için. */
let _coolUntil = 0;
const COOL_MS = 60_000;

let _active: HTMLAudioElement | null = null;
let _seq = 0;

/** Edge TTS şu an denenebilir mi (online + soğumada değil). */
export function isEdgeTtsAvailable(): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
  return Date.now() >= _coolUntil;
}

async function _synthesize(text: string): Promise<string | null> {
  const cached = _cache.get(text);
  if (cached) return cached;
  if (!isEdgeTtsAvailable()) return null;

  let blob: Blob;
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const resp = await fetch(TTS_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ text }),
      signal:  ctrl.signal,
    }).finally(() => clearTimeout(to));
    if (!resp.ok) { _coolUntil = Date.now() + COOL_MS; return null; }
    blob = await resp.blob();
    if (!blob.size) return null;
  } catch {
    _coolUntil = Date.now() + COOL_MS;
    return null;
  }

  const url = URL.createObjectURL(blob);
  _cache.set(text, url);
  if (_cache.size > CACHE_MAX) {
    const oldest = _cache.keys().next().value as string | undefined;
    if (oldest) {
      const old = _cache.get(oldest);
      _cache.delete(oldest);
      if (old) { try { URL.revokeObjectURL(old); } catch { /* yok */ } }
    }
  }
  return url;
}

/**
 * Metni Edge TTS ile seslendir. Başarılıysa true (ses çalmaya başladı);
 * offline / hata → false (çağıran Gemini/eSpeak yedeğine düşmeli).
 * onEnd yalnız ses gerçekten çaldıysa bir kez çağrılır (ducking + takip dinleme).
 */
export async function speakEdge(text: string, onEnd?: () => void): Promise<boolean> {
  const t = text.trim();
  if (!t || typeof Audio === 'undefined') return false;

  const seq = ++_seq;
  const url = await _synthesize(t);
  if (!url) return false;
  if (seq !== _seq) return false;  // daha yeni konuşma istendi → bunu çalma

  if (_active) { try { _active.pause(); } catch { /* durmuş */ } }
  const audio = new Audio(url);
  _active = audio;

  let settled = false;
  let ducked  = false;
  const settle = () => {
    if (settled) return;
    settled = true;
    if (ducked) { unduckMedia(); ducked = false; }
    if (_active === audio) _active = null;
    audio.onended = null; audio.onerror = null;
    onEnd?.();
  };

  try {
    const p = audio.play();
    ducked = true; duckMedia();
    audio.onended = settle;
    audio.onerror = settle;
    if (p && typeof p.catch === 'function') p.catch(() => settle());
    return true;
  } catch {
    if (_active === audio) _active = null;
    return false;
  }
}

/** Devam eden Edge seslendirmesini anında durdur. */
export function cancelEdge(): void {
  _seq++;
  if (_active) { try { _active.pause(); } catch { /* yok */ } _active = null; }
}
