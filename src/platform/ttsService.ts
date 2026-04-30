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
  /** Seslendirme tamamlandığında çağrılır — Audio Ducking restore için kullanılır */
  onEnd?: () => void;
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
  if (opts.onEnd)    utter.onend = opts.onEnd;

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
  if (typeof window !== 'undefined' && (window as unknown as Record<string, unknown>).__SAFETY_LOCK__) return;
  ttsSpeak(feedback, { rate: 1.05 });
}

/**
 * Manevra mesajının kritik olup olmadığını belirler.
 * SAFETY_LOCK aktifken yalnızca kritik talimatlar geçer.
 *
 * İzin verilenler: dönüş talimatları, mesafe uyarıları, rota kaybı/yeniden hesap.
 * Engellenenler: trafik bilgisi, alternatif rota, tahmini varış, genel bilgi.
 */
function isCriticalNavigationMessage(msg: string): boolean {
  const n = msg.toLowerCase();
  return (
    n.includes('sağa')    || n.includes('sola')    ||  // dönüş
    n.includes('dön')     || n.includes('çevir')   ||
    n.includes('right')   || n.includes('left')    ||
    n.includes('turn')    ||
    n.includes('100m')    || n.includes('200m')    ||  // mesafe
    n.includes('metre')   || n.includes('meter')   ||
    n.includes('yakında') || n.includes('soon')    ||
    n.includes('kaçırdın')|| n.includes('missed')  ||  // rota kaybı
    n.includes('rota yeniden') || n.includes('rerouting') ||
    n.includes('hesaplanıyor') || n.includes('recalcul')
  );
}

/** Navigasyon yönlendirme duyurusu — net, yavaş, sürücü odaklı */
export function speakNavigation(instruction: string): void {
  if (
    typeof window !== 'undefined' &&
    (window as unknown as Record<string, unknown>).__SAFETY_LOCK__ &&
    !isCriticalNavigationMessage(instruction)
  ) return;
  ttsSpeak(instruction, { rate: 0.92, queue: false });
}

/** Uyarı / hata mesajı — biraz yüksek pitch ile dikkat çeker */
export function speakAlert(message: string): void {
  if (typeof window !== 'undefined' && (window as unknown as Record<string, unknown>).__SAFETY_LOCK__) return;
  ttsSpeak(message, { rate: 0.98, pitch: 1.15 });
}

/* ── T-12: Donanım komut geri bildirimleri ──────────────── */

/**
 * Donanım komutu başarıyla gönderildiğinde.
 * ISO 15008: araç içi sesli geri bildirim kısa ve net olmalı.
 */
export function speakHardwareConfirm(action: string): void {
  ttsSpeak(action, { rate: 1.0, queue: false });
}

/**
 * Donanım komutu başarısız — MCU bağlı değil veya hata.
 */
export function speakHardwareError(): void {
  ttsSpeak('Bağlantı kurulamadı. Tekrar deneyin.', { rate: 0.95, pitch: 1.1, queue: false });
}

/**
 * Araç durum özeti — CAN verisini okunabilir cümleye çevirir.
 * Veri yoksa CLAUDE.md §2 gereği "Veri alınamıyor" der.
 */
export function speakVehicleStatus(opts: {
  speedKmh?: number;
  fuelPct?:  number;
  tempC?:    number;
}): void {
  const { speedKmh, fuelPct, tempC } = opts;

  if (speedKmh === undefined && fuelPct === undefined && tempC === undefined) {
    ttsSpeak('Araç verisi alınamıyor. OBD bağlantısını kontrol edin.', { rate: 0.95, queue: false });
    return;
  }

  const parts: string[] = [];
  if (speedKmh !== undefined) parts.push(`Hız ${Math.round(speedKmh)} kilometre`);
  if (fuelPct  !== undefined) {
    const fuelText = fuelPct < 15
      ? `Yakıt %${Math.round(fuelPct)}, az kaldı`
      : `Yakıt %${Math.round(fuelPct)}`;
    parts.push(fuelText);
  }
  if (tempC !== undefined) parts.push(`Motor sıcaklığı ${Math.round(tempC)} derece`);

  ttsSpeak(parts.join('. ') + '.', { rate: 0.95, queue: false });
}
