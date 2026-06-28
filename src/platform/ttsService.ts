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

import { duckMedia, unduckMedia } from './audioService';
import { Capacitor } from '@capacitor/core';
import { CarLauncher } from './nativePlugin';
import { useHazardStore } from '../store/useHazardStore';
import { normalizeForSpeech } from './speechText';
import { segmentSpeech, type SpeechSegment } from './speechSegment';
import { isLowEndDevice } from './headUnitCompat';
import { tryPlayClip, cancelClip } from './voiceClips';
import { speakOnline, isOnlineTtsAvailable, cancelOnline } from './onlineTtsService';

/* ── Platform detection ──────────────────────────────────── */

const _isNative = Capacitor.isNativePlatform();

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
      window.speechSynthesis.cancel();
    }
    // Duck state'i sıfırla — yeni modül instance temiz başlasın
    _ttsDucking = false;
    _cachedVoice = null;
    _lastSpokenText = '';
  });
}

/* ── TTS bitiş olayı (takip dinlemesi için) ───────────────── */

/**
 * Her seslendirme tamamlandığında (bitti/kesildi/atlandı) çağrılan dinleyiciler.
 * voiceService takip modunda "cevap bitti → mikrofonu yeniden aç" anını buradan alır.
 * Dedupe ile ATLANAN konuşmalar da bildirir — aksi halde takip modu asılı kalır.
 */
type TtsEndListener = () => void;
const _ttsEndListeners = new Set<TtsEndListener>();

export function registerTtsEndListener(cb: TtsEndListener): () => void {
  _ttsEndListeners.add(cb);
  return () => { _ttsEndListeners.delete(cb); };
}

function _notifyTtsEnd(): void {
  _ttsEndListeners.forEach((fn) => { try { fn(); } catch { /* dinleyici hatası TTS'i kırmasın */ } });
}

/**
 * Seslendirme sırası: QUEUE_FLUSH eski utterance'ı keser ve onun bitişi de
 * (onStop) settle tetikler. Yalnız EN SON utterance'ın bitişi "konuşma bitti"
 * sayılır — aksi halde flush edilen "Düşünüyorum..." cümlesinin bitişi, asıl
 * cevap hâlâ konuşulurken takip dinlemesini/unduck'ı erken tetiklerdi.
 */
let _speakSeq = 0;

/* ── Rate limiting ───────────────────────────────────────── */

/** Aynı metni kısa aralıkla tekrar seslendirme */
let _lastSpokenText = '';
let _lastSpokenAt   = 0;
const MIN_REPEAT_MS = 3_000;

/** Aktif bir duckMedia çağrısı var mı — çakışan duck çağrısını önler */
let _ttsDucking = false;

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
  /** MIN_REPEAT_MS deduplikasyonunu atla — güvenlik uyarıları için */
  force?: boolean;
  /**
   * Segmentasyon + mikro-duraklama uygula (P0-2). Varsayılan true.
   * Güvenlik/acil uyarılarında false verilir → tek utterance, gecikmesiz.
   */
  segment?: boolean;
}

export function ttsSpeak(text: string, opts: SpeakOptions = {}): void {
  if (!text.trim()) return;

  const now = Date.now();
  if (!opts.force && text === _lastSpokenText && now - _lastSpokenAt < MIN_REPEAT_MS) {
    // Dedupe atladı — başka seslendirme uçuşta değilse yine de "bitti" bildir:
    // takip dinlemesi bu sinyali bekliyor (uçuştaki utterance kendi bitişini bildirir).
    if (!_ttsDucking) setTimeout(_notifyTtsEnd, 0);
    return;
  }
  _lastSpokenText = text;
  _lastSpokenAt   = now;

  // ── Premium ses bankası (hibrit Phase 1) — sabit/kritik ifadeler stüdyo kalite
  // klipten çalınır; native/web TTS atlanır. Eşleşmezse normal TTS yoluna düşer.
  // Klip bitiş semantiği TTS ile aynı: takip dinlemesi (_notifyTtsEnd) + onEnd.
  if (tryPlayClip(text, () => { _notifyTtsEnd(); opts.onEnd?.(); })) return;

  // ── Ön-işleme (P0-1) + segmentasyon/prozodi (P0-2 + P1-1) — platformdan ÖNCE ──
  // Taban değerler: native motor 1.0, web 1.05 (eski davranış korunur).
  const baseRate  = opts.rate  ?? (_isNative ? 1.0 : 1.05);
  const basePitch = opts.pitch ?? 1.0;
  const spoken    = normalizeForSpeech(text);
  // segment === false → güvenlik/acil uyarısı: tek utterance, gecikmesiz, prozodi yok.
  const segments: SpeechSegment[] = opts.segment === false
    ? [{ text: spoken, rate: baseRate, pitch: basePitch, pauseMs: 0 }]
    : segmentSpeech(spoken, { rate: baseRate, pitch: basePitch, lowEnd: isLowEndDevice() });
  if (segments.length === 0) return;

  // ── Native path: Android TextToSpeech (güvenilir, Türkçe destekli) ──
  if (_isNative) {
    const seq = ++_speakSeq;
    if (!_ttsDucking) { _ttsDucking = true; duckMedia(); }
    // speak()/speakSegments() Promise'i seslendirme BİTİNCE çözülür (UtteranceProgressListener;
    // segmentlerde yalnız SON segmentin onDone'u). Bazı OEM motorları onDone'u hiç çağırmayabilir
    // → süre tahminli emniyet zamanlayıcısı: hangisi önce gelirse bir kez işlenir.
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      // Yalnız en son seslendirme global durumu kapatır (flush edilen eskiler dokunmaz)
      if (seq === _speakSeq) {
        _ttsDucking = false;
        unduckMedia();
        _notifyTtsEnd();
      }
      opts.onEnd?.();
    };
    const estimatedMs = Math.min(30_000, 3_000 + spoken.length * 110);
    const safety = setTimeout(settle, estimatedMs);
    // Çok segmentli → speakSegments (kuyruk native'de yönetilir, son segmentte çözülür).
    // Tek segment → klasik speak (pitch artık native'de uygulanır).
    // Eski APK'da speakSegments yoksa reject → tek-utterance'a düş (asla sessiz kalma).
    const nativeCall = segments.length > 1
      ? CarLauncher.speakSegments({ segments }).catch(() =>
          CarLauncher.speak({ text: spoken, rate: baseRate, pitch: basePitch }))
      : CarLauncher.speak({ text: segments[0].text, rate: segments[0].rate, pitch: segments[0].pitch });
    nativeCall
      .then(() => { clearTimeout(safety); settle(); })
      .catch(() => { clearTimeout(safety); settle(); });
    return;
  }

  // ── Web fallback: SpeechSynthesis API ──────────────────────────────
  if (!isTTSAvailable()) return;

  if (!opts.queue) window.speechSynthesis.cancel();

  // duckMedia() TTS engine init'inden ÖNCE çağrılır — gain ramp başlangıç avantajı.
  // _ttsDucking guard: önceki TTS henüz bitmeden yeni çağrı gelirse çift duck önlenir.
  if (!_ttsDucking) { _ttsDucking = true; duckMedia(); }

  const voice = _getTurkishVoice();
  const userOnEnd = opts.onEnd;
  let webSettled = false;
  // Yalnız SON segmentin bitişi (veya herhangi bir segment hatası) durumu kapatır.
  const webSettle = () => {
    if (webSettled) return;
    webSettled = true;
    _ttsDucking = false;
    unduckMedia();
    userOnEnd?.();
    _notifyTtsEnd();
  };

  segments.forEach((seg, i) => {
    const utter  = new SpeechSynthesisUtterance(seg.text);
    utter.lang   = 'tr-TR';
    utter.rate   = seg.rate;
    utter.pitch  = seg.pitch;
    utter.volume = 1.0;
    if (voice) utter.voice = voice;
    // Segmentler art arda kuyruğa eklenir (cancel yalnız en başta yapıldı).
    if (i === segments.length - 1) utter.onend = webSettle;
    utter.onerror = webSettle; // fail-soft: herhangi bir segment hatası ducking'i geri açar
    window.speechSynthesis.speak(utter);
  });
}

/** Devam eden seslendirmeyi anında durdur */
export function ttsCancel(): void {
  cancelClip();    // çalan premium klibi de durdur
  cancelOnline();  // uçuştaki/çalan online asistan sesini de durdur
  if (_isNative) {
    CarLauncher.ttsStop()
      .then(() => { if (_ttsDucking) { _ttsDucking = false; unduckMedia(); } })
      .catch(() => { if (_ttsDucking) { _ttsDucking = false; unduckMedia(); } });
    return;
  }
  if (isTTSAvailable()) {
    if (_ttsDucking) { _ttsDucking = false; unduckMedia(); }
    window.speechSynthesis.cancel();
  }
}

/* ── Attention-Aware Speech Engine (Phase H4) ───────────────────────────── */

/**
 * Uzaklık ön-eklerini ve kibarca ifadeler yerine emir kipini kullanan
 * kısaltılmış navigasyon talimatı döndürür.
 *
 * "400 metre sonra sağa dönün, Bağdat Caddesi'ne girin"
 *   → "Sağa dön, Bağdat Caddesi"
 */
const _DIST_PATTERNS = [
  /\d+[\s.,]*(?:km|kilometre|m|metre)\s+sonra\s*/gi,
  /yaklaşık\s+\d+\s+\w+\s+sonra\s*/gi,
];

const _POLITE_TO_CMD: [RegExp, string][] = [
  [/\bdönün\b/gi,       'dön'],
  [/\bdevam edin\b/gi,  'devam'],
  [/\bgidin\b/gi,       'git'],
  [/\bgirin\b/gi,       'gir'],
  [/\bçıkın\b/gi,       'çık'],
  [/\byapın\b/gi,       'yap'],
  [/\balın\b/gi,        'al'],
  [/\bkalın\b/gi,       'kal'],
];

export function shortenInstruction(text: string): string {
  let s = text;
  for (const p of _DIST_PATTERNS)      s = s.replace(p, '');
  for (const [f, t] of _POLITE_TO_CMD) s = s.replace(f, t);
  // Yinelenen boşlukları temizle ve kademe karakterlerini kaldır
  return s.replace(/\s*[,;.]\s*$/, '').replace(/\s+/g, ' ').trim();
}

/** Türkçe tehlike tipi → sesli uyarı metni */
const _HAZARD_LABELS_TTS: Record<string, string> = {
  CONSTRUCTION: 'yol çalışması',
  ACCIDENT:     'kaza',
  WEATHER:      'zor hava koşulları',
  SPEED_CAM:    'hız kamerası',
  ROAD_DAMAGE:  'yol hasarı',
  TUNNEL:       'tünel',
};

/**
 * Tehlike uyarısı — otoriter, düşük ses tonu.
 * CarLauncher.speak() pitch parametresini desteklemiyorsa web fallback kullanılır.
 */
export function speakHazardAlert(type: string, distanceM?: number): void {
  const label = _HAZARD_LABELS_TTS[type] ?? 'tehlike';
  let dist = '';
  if (distanceM !== undefined && distanceM > 0) {
    dist = distanceM < 1000
      ? `${Math.round(distanceM / 50) * 50} metre ileride`
      : `${(distanceM / 1000).toFixed(1)} kilometre ileride`;
  }
  const text = dist ? `Dikkat! ${label}, ${dist}.` : `Dikkat! ${label}.`;
  // Daha ağır ve yavaş ton — sürücüde aciliyet hissi yaratır.
  // segment: false → tek utterance, mikro-duraklama gecikmesi yok (aciliyet korunur).
  ttsSpeak(text, { rate: 0.86, pitch: 0.85, queue: false, segment: false });
}

/**
 * Güvenlik acil uyarısı — en yüksek öncelik kanalı.
 *
 * Farklar:
 *  - __SAFETY_LOCK__ kontrolünü atlar — her zaman çalışır.
 *  - Devam eden TTS'i keser (queue: false).
 *  - MIN_REPEAT_MS deduplikasyonunu geçer (force: true).
 *  - Soğuma (cooldown) safetyService tarafından yönetilir (15s).
 *  - Arbitraj: yakın dönüş (<50m) varsa safetyService zaten atlar.
 */
export function speakSafetyAlert(message: string): void {
  // segment: false → en yüksek öncelik kanalı gecikmesiz tek utterance olarak gider.
  ttsSpeak(message, { rate: 0.82, pitch: 0.82, queue: false, force: true, segment: false });
}

/* ── Semantic helpers ────────────────────────────────────── */

/** Sesli komut tanındığında geri bildirim sesi */
export function speakFeedback(feedback: string): void {
  if (typeof window !== 'undefined' && (window as unknown as Record<string, unknown>).__SAFETY_LOCK__) return;
  ttsSpeak(feedback, { rate: 1.05 });
}

/**
 * Akıllı asistan (Gemini/Claude/Grok) cevabını seslendirir — hibrit öncelik zinciri:
 *   1) Sabit ifade klibi (offline premium, anında, maliyetsiz)
 *   2) Online TTS (serbest/akıllı cevap — asistan zaten online; motor/kurulum gerekmez)
 *   3) Native/web TTS yedeği (varsa)
 * Böylece TTS motoru OLMAYAN head unit'lerde bile asistan tam sesli çalışır.
 */
export function speakAssistant(text: string, onEnd?: () => void): void {
  const t = text?.trim();
  if (!t) return;
  if (typeof window !== 'undefined' && (window as unknown as Record<string, unknown>).__SAFETY_LOCK__) return;

  // 1) Sabit ifade → premium klip (online olsa bile: hızlı + maliyetsiz + offline)
  if (tryPlayClip(t, () => { _notifyTtsEnd(); onEnd?.(); })) return;

  // 2) Online TTS → 3) native yedek
  void (async () => {
    try {
      if (await isOnlineTtsAvailable()) {
        const ok = await speakOnline(t, () => { _notifyTtsEnd(); onEnd?.(); });
        if (ok) return;
      }
    } catch { /* online yolu kırılırsa sessizce yedeğe düş */ }
    ttsSpeak(t, { onEnd });
  })();
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

/** Navigasyon yönlendirme duyurusu — net, yavaş, sürücü odaklı.
 *  Phase H4: Dikkat bütçesi düşükse (DAB < 0.4) veya ATTENTION durumundaysa
 *  talimat kısaltılır — mesafe ön-ekleri silinir, emir kipi kullanılır.
 */
export function speakNavigation(instruction: string): void {
  if (
    typeof window !== 'undefined' &&
    (window as unknown as Record<string, unknown>).__SAFETY_LOCK__ &&
    !isCriticalNavigationMessage(instruction)
  ) return;

  const { driverAttentionBudget, hazardStatus } = useHazardStore.getState();
  const needsShorten = driverAttentionBudget < 0.4 || hazardStatus === 'ATTENTION';
  const text = needsShorten ? shortenInstruction(instruction) : instruction;

  ttsSpeak(text, { rate: 0.92, queue: false });
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
