/**
 * TTS Service — metin-to-ses, Web Speech API tabanlı.
 *
 * Android WebView Chromium ≥ 80 üzerinde SpeechSynthesis çalışır;
 * herhangi bir native entegrasyon veya API anahtarı gerekmez.
 *
 * Kullanım:
 *   speakFeedback('Harita açılıyor')          — sesli komut geri bildirimi
 *   speakNavigation('500 metre sonra sağa dön') — navigasyon yönlendirmesi
 *   ttsCancel()                                — devam eden seslendirmeyi kes
 */

/* ── Availability check ──────────────────────────────────── */

function isTTSAvailable(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

/* ── Voice selection ─────────────────────────────────────── */

let _cachedVoice: SpeechSynthesisVoice | null = null;

function _getTurkishVoice(): SpeechSynthesisVoice | null {
  if (!isTTSAvailable()) return null;
  if (_cachedVoice) return _cachedVoice;

  const voices = window.speechSynthesis.getVoices();
  // 1. Exact tr-TR match
  _cachedVoice = voices.find((v) => v.lang === 'tr-TR') ?? null;
  // 2. Any Turkish voice
  if (!_cachedVoice) _cachedVoice = voices.find((v) => v.lang.startsWith('tr')) ?? null;
  return _cachedVoice;
}

// Voices may not be loaded immediately — refresh cache on voiceschanged
function _onVoicesChanged() {
  _cachedVoice = null;
  _getTurkishVoice(); // prime cache
}
if (isTTSAvailable()) {
  window.speechSynthesis.addEventListener('voiceschanged', _onVoicesChanged);
}

// HMR cleanup — prevents duplicate listeners across hot reloads
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    if (isTTSAvailable()) {
      window.speechSynthesis.removeEventListener('voiceschanged', _onVoicesChanged);
    }
  });
}

/* ── Rate limiting ───────────────────────────────────────── */

/** Aynı metni kısa aralıkla tekrar seslendirme */
let _lastSpokenText = '';
let _lastSpokenAt   = 0;
const MIN_REPEAT_MS = 3_000;

/* ── Core speak ──────────────────────────────────────────── */

interface SpeakOptions {
  /** Konuşma hızı: 0.1–10, varsayılan 1.0 */
  rate?: number;
  /** Ses yüksekliği: 0–2, varsayılan 1.0 */
  pitch?: number;
  /** Devam eden sesi kesmeden önce kuyruğa ekle */
  queue?: boolean;
}

export function ttsSpeak(text: string, opts: SpeakOptions = {}): void {
  if (!isTTSAvailable() || !text.trim()) return;

  const now = Date.now();
  if (text === _lastSpokenText && now - _lastSpokenAt < MIN_REPEAT_MS) return;
  _lastSpokenText = text;
  _lastSpokenAt   = now;

  if (!opts.queue) window.speechSynthesis.cancel();

  const utter        = new SpeechSynthesisUtterance(text);
  utter.lang         = 'tr-TR';
  utter.rate         = opts.rate  ?? 1.05;
  utter.pitch        = opts.pitch ?? 1.0;
  utter.volume       = 1.0;

  const voice = _getTurkishVoice();
  if (voice) utter.voice = voice;

  window.speechSynthesis.speak(utter);
}

/** Devam eden seslendirmeyi anında durdur */
export function ttsCancel(): void {
  if (isTTSAvailable()) window.speechSynthesis.cancel();
}

/* ── Semantic helpers ────────────────────────────────────── */

/** Sesli komut tanındığında geri bildirim sesi */
export function speakFeedback(feedback: string): void {
  ttsSpeak(feedback, { rate: 1.1 });
}

/** Navigasyon yönlendirme duyurusu (biraz daha yavaş, net anlaşılsın) */
export function speakNavigation(instruction: string): void {
  ttsSpeak(instruction, { rate: 0.95, queue: false });
}

/** Uyarı / hata mesajı */
export function speakAlert(message: string): void {
  ttsSpeak(message, { rate: 1.0, pitch: 1.1 });
}
