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

import { requestDuck, type DuckHandle } from './media/authority/duckRequest';
import type { DuckReason } from './media/authority/duckPolicy';
/* MAVI-F0: TTS sentez + ilk duyulabilir ses ölçümü (YALNIZ ÖLÇÜM). */
import { markMaviLatency } from './assistant/maviLatencyTrace';

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
/**
 * Uçuştaki seslendirmenin ducking'ini SERBEST BIRAKAN kanca.
 *
 * `cancelEdge()` sesi `pause()` ile durdurur, ama `pause` **`ended` olayı
 * ÜRETMEZ** → aşağıdaki `settle` hiç çalışmaz ve duck handle'ı sızardı
 * (müzik kısık kalırdı). Parçalı seslendirmede iptal çok daha olası olduğu
 * için bu kanca artık iptalde de duck'ı bırakır. `onEnd` ÇAĞRILMAZ: iptalin
 * anlamsal sahibi `ttsService.ttsCancel`dir (o zaten akışı kapatır).
 */
let _releaseDuck: (() => void) | null = null;

/* ── PARÇALI SENTEZ (SAHA 2026-09-10 · gerçek cihaz, CDP ile ölçüldü) ──────
 * ÖLÇÜM 1 — proxy SABİT 800 karakter sınırlı:
 *   992 karakter → `400 {"error":"text çok uzun (max 800)"}` (686 ms).
 *   Sonuç: 800'ü aşan HER cevapta premium KADIN ses düşüyordu; üstelik
 *   `_coolUntil` 60 sn devreye girdiği için ARDINDAN gelen KISA cevaplar da
 *   robotik native sese düşüyordu (tek uzun cevap tüm katmanı bir dakika
 *   devre dışı bırakıyordu).
 * ÖLÇÜM 2 — Gemini yedeği ÇALIŞIYOR ama YAVAŞ (aynı gün, aynı anahtar, 200):
 *   124 kar → 7,2 sn · 496 → 15,4 sn · 992 → 29,4 sn · 2976 → 84 sn.
 *   `onlineTtsService.TTS_TIMEOUT_MS` 12 sn olduğundan o katman uzun cevapta
 *   YAPISAL OLARAK erişilemez — yani kota değil, süre sorunu.
 *
 * ÇÖZÜM: metin cümle sınırından parçalanır, İLK parça gelir gelmez çalmaya
 * başlar, kalanlar o çalarken ÖNDEN sentezlenir. Böylece 800 sınırı aşılır
 * VE ilk kelime gecikmesi düşer. Yeni otorite kurulmaz: sıra, iptal ve
 * `onEnd` sözleşmesi aynen korunur (`onEnd` yalnız SON parça bitince). */
const CHUNK_HARD_MAX  = 800;   // sunucunun sabit sınırı — ASLA aşılmaz
const CHUNK_FIRST_MAX = 320;   // ilk parça KÜÇÜK: ilk kelime hızlı duyulsun
const CHUNK_NEXT_MAX  = 700;   // sonrakiler büyük: istek sayısı düşsün (<800)

/** Tavanı aşan bir parçayı kelime sınırından böler (son çare — metin KAYBOLMAZ). */
function _hardSplit(s: string, max: number): string[] {
  const out: string[] = [];
  let rest = s;
  while (rest.length > max) {
    const head = rest.slice(0, max);
    const cut  = head.lastIndexOf(' ');
    const take = cut > max * 0.5 ? head.slice(0, cut) : head;
    out.push(take.trim());
    rest = rest.slice(take.length).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/**
 * Metni sentezlenebilir parçalara böler. **SAF** — ağ/durum YOK.
 *
 * Sözleşme: hiçbir parça {@link CHUNK_HARD_MAX} karakteri aşmaz ve parçaların
 * birleşimi metnin TAMAMIDIR (kırpma YOK — kesilmenin kaynağı bu modül olamaz).
 */
export function splitForSynthesis(text: string): string[] {
  const flat = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!flat) return [];
  if (flat.length <= CHUNK_FIRST_MAX) return [flat];

  const sentences = flat.match(/[^.!?…]+[.!?…]*/g) ?? [flat];
  const out: string[] = [];
  let cur = '';
  const limit = (): number => (out.length === 0 ? CHUNK_FIRST_MAX : CHUNK_NEXT_MAX);
  const flush = (): void => { const c = cur.trim(); if (c) out.push(c); cur = ''; };

  for (const raw of sentences) {
    const sentence = raw.trim();
    if (!sentence) continue;
    // Tek başına tavanı aşan cümle → kelime sınırından bölünür.
    const pieces = sentence.length > limit() ? _hardSplit(sentence, limit()) : [sentence];
    for (const piece of pieces) {
      if (cur && cur.length + 1 + piece.length > limit()) flush();
      cur = cur ? `${cur} ${piece}` : piece;
      if (cur.length >= limit()) flush();
    }
  }
  flush();
  // Savunma: yapıca oluşmaması gerekir, ama oluşursa metin ATILMAZ, bölünür.
  return out.flatMap((c) => (c.length <= CHUNK_HARD_MAX ? [c] : _hardSplit(c, CHUNK_HARD_MAX)));
}

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
export async function speakEdge(
  text: string,
  onEnd?: () => void,
  duckReason: DuckReason = 'MAVI',
): Promise<boolean> {
  const t = text.trim();
  if (!t || typeof Audio === 'undefined') return false;

  const seq = ++_seq;
  const parts = splitForSynthesis(t);
  if (parts.length === 0) return false;

  /* İLK parça sentezlenemezse hiç ses çıkmadı → çağıran YEDEĞE düşer
     (sözleşme değişmedi: `false` = "bu katman konuşmadı"). */
  const firstUrl = await _synthesize(parts[0]);
  if (!firstUrl) return false;
  if (seq !== _seq) return false;  // daha yeni konuşma istendi → bunu çalma
  markMaviLatency('tts_audio_ready');   // MAVI-F0: sentezlenmiş ses verisi hazır

  if (_active) { try { _active.pause(); } catch { /* durmuş */ } _active = null; }

  let settled = false;
  let duck: DuckHandle | null = null;
  /** Söz BİTTİ (son parça çaldı) ya da kurtarılamaz hata — TEK çıkış. */
  const settle = (): void => {
    if (settled) return;
    settled = true;
    if (duck !== null) { duck.release(); duck = null; }
    _releaseDuck = null;
    if (_active) {
      _active.onended = null; _active.onerror = null; _active.onplaying = null;
      _active = null;
    }
    onEnd?.();
  };

  /* Sıradaki parça, mevcut parça ÇALARKEN sentezlenir (ağ gecikmesi sesin
     altında saklanır). Tek adım ileri: bellek/istek sınırı bounded kalır. */
  let prefetch: Promise<string | null> | null =
    parts.length > 1 ? _synthesize(parts[1]) : null;

  const playChunk = (index: number, url: string): void => {
    if (seq !== _seq) return;   // iptal/supersede → sessizce dur
    const audio = new Audio(url);
    _active = audio;
    // MAVI-F0: `playing` platformun GERÇEK başlangıç bildirimidir; YALNIZ ilk parça ölçülür.
    if (index === 0) audio.onplaying = () => { markMaviLatency('first_audio_confirmed'); };
    audio.onerror = () => settle();   // hata gizlenmez: söz burada biter
    audio.onended = () => { audio.onended = null; void advance(index + 1); };
    const p = audio.play();
    if (p && typeof p.catch === 'function') p.catch(() => settle());
  };

  const advance = async (index: number): Promise<void> => {
    /* İPTAL: `settle` ÇAĞRILMAZ. İptalin sahibi `ttsService.ttsCancel`dir ve
       `onEnd` orada akışı yanlış yönlendirirdi (kesilen söz "bitti" sayılmaz). */
    if (seq !== _seq) return;
    if (index >= parts.length) { settle(); return; }
    const pending = prefetch;
    prefetch = null;
    const url = await (pending ?? _synthesize(parts[index]));
    if (seq !== _seq) return;
    /* Ara parça sentezlenemedi: sahte devam ÜRETİLMEZ, söz dürüstçe biter
       (CLAUDE.md §8 — hata `success` gibi sunulmaz). */
    if (!url) { settle(); return; }
    if (index + 1 < parts.length) prefetch = _synthesize(parts[index + 1]);
    playChunk(index, url);
  };

  try {
    markMaviLatency('first_audio_requested');
    /* Duck, ses başlamadan ÖNCE istenir (ttsSpeak ile AYNI yön) ve parçalar
       arasında BIRAKILMAZ — aksi halde her parça sınırında müzik zıplardı. */
    duck = requestDuck(duckReason);
    _releaseDuck = (): void => { if (duck !== null) { duck.release(); duck = null; } };
    playChunk(0, firstUrl);
    return true;
  } catch {
    if (_active === null) { /* zaten temiz */ }
    _active = null;
    if (duck !== null) { duck.release(); duck = null; }
    _releaseDuck = null;
    return false;
  }
}

/** Devam eden Edge seslendirmesini anında durdur. */
export function cancelEdge(): void {
  _seq++;   // uçuştaki sentez ve kuyruktaki parçalar bayatlar
  if (_active) { try { _active.pause(); } catch { /* yok */ } _active = null; }
  /* Ducking iptalde de BIRAKILIR: `pause` 'ended' üretmediği için `settle`
     çalışmaz ve handle eskiden sızıyordu (müzik kısık kalırdı). */
  const release = _releaseDuck;
  _releaseDuck = null;
  if (release) { try { release(); } catch { /* fail-soft */ } }
}
