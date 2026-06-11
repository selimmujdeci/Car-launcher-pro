/**
 * Wake Word Service — pasif dinleme.
 *
 * İKİ KAYNAK (useLayoutServices önceliği belirler):
 *  - COMPANION ("Yol Arkadaşım"): wake sözleri asistan ADINDAN türetilir
 *    (resolveWakeWords — "Mavi" / "Hey Mavi" / özel cümle). Tetiklenince
 *    kısa selamlama TTS'i ("Buradayım.") → TTS bitince aktif dinleme.
 *  - LEGACY ("hey car"): eski Voice Assistant toggle'ı — davranış aynen
 *    korunur (selamlama yok, doğrudan dinleme).
 *
 * Pasif dinleme UX: pasif beklerken voiceService durumuna DOKUNULMAZ —
 * ekranda "Dinliyorum" pill'i yalnız AKTİF dinlemede görünür.
 *
 * Güvenlik: PROTECTION/CRITICAL (isVoicePaused) modda wake tetiklense bile
 * sohbet/eğlence başlamaz — tetik sessizce yutulur.
 *
 * Native Android: CarLauncher.startSpeechRecognition() her bitiminde
 * otomatik yeniden başlatılır (ön plan modu). voiceService mikrofonu
 * kullanırken (aktif dinleme/işleme) döngü mikrofon AÇMAZ — çakışma yok.
 */

import { useState, useEffect } from 'react';
import { isNative } from './bridge';
import { startListening, isVoicePaused, getVoiceSnapshot } from './voiceService';
import { matchesWakeTranscript, normalizeWakeText } from './companion/companionIdentity';
import { VOICE_TUNING } from './voiceTuning';

/* ── Tipler ──────────────────────────────────────────────── */

export type WakeWordStatus = 'disabled' | 'idle' | 'listening' | 'detected' | 'error';

export interface WakeWordState {
  status:      WakeWordStatus;
  enabled:     boolean;
  /** Aktif wake sözleri (normalize). Companion modda asistan adından türer. */
  wakeWords:   string[];
  /** Companion kaynağı mı (selamlama + kelime-sınırlı eşleşme). */
  companion:   boolean;
  lastTrigger: number | null;
  errorMsg:    string | null;
  /**
   * Saha teşhisi: pasif döngünün duyduğu son transcript'ler (en yeni başta,
   * max 5). "Uyanmıyor" şikayetinde Vosk'un gerçekte NE duyduğu buradan
   * görülür (chrome inspect / dev inspector).
   */
  lastHeard:   string[];
}

/* ── Legacy uyandırma kelimeleri ("hey car" sistemi) ─────── */

const DEFAULT_WAKE_WORD = 'hey car';

const LEGACY_WAKE_PATTERNS = [
  'hey car',
  'hey kar',
  'hi car',
  'tamam araç',
  'tamam arac',
  'araç asistan',
  'arac asistan',
];

function matchesLegacy(transcript: string, words: readonly string[]): boolean {
  const norm = transcript.toLowerCase().trim();
  if (words.some((w) => w && norm.includes(w.toLowerCase()))) return true;
  return LEGACY_WAKE_PATTERNS.some((p) => norm.includes(p));
}

/* ── Wake selamlaması (companion) ────────────────────────── */

// Deterministik rotasyon (Math.random yok — testler kararlı, tekrar hissi az)
const WAKE_GREETINGS = ['Buradayım.', 'Dinliyorum.', 'Seni dinliyorum.'];
let _greetCounter = 0;

/* ── Modül durumu ────────────────────────────────────────── */

const INITIAL: WakeWordState = {
  status:      'disabled',
  enabled:     false,
  wakeWords:   [DEFAULT_WAKE_WORD],
  companion:   false,
  lastTrigger: null,
  errorMsg:    null,
  lastHeard:   [],
};

let _state: WakeWordState = { ...INITIAL };
const _listeners = new Set<(s: WakeWordState) => void>();

function push(partial: Partial<WakeWordState>): void {
  _state = { ..._state, ...partial };
  _listeners.forEach((fn) => fn(_state));
}

/* ── Web SpeechRecognition impl. ─────────────────────────── */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SpeechRecognitionAny = any;

let _recognition: SpeechRecognitionAny = null;
let _restartTimer: ReturnType<typeof setTimeout> | null = null;
let _detectedTimer: ReturnType<typeof setTimeout> | null = null; // onWakeWordDetected gecikmesi
let _nativeLoopActive = false;

function clearRestartTimer(): void {
  if (_restartTimer) { clearTimeout(_restartTimer); _restartTimer = null; }
}

function _matches(transcript: string): boolean {
  return _state.companion
    ? matchesWakeTranscript(transcript, _state.wakeWords)  // TR-normalize + kelime sınırı
    : matchesLegacy(transcript, _state.wakeWords);
}

function onWakeWordDetected(): void {
  // PROTECTION/CRITICAL: wake tetiklense bile sohbet/eğlence BAŞLAMAZ.
  // Sessizce yut — pasif döngü sürer, sürücü dikkat yükü altında rahatsız edilmez.
  if (isVoicePaused()) return;

  push({ status: 'detected', lastTrigger: Date.now() });

  if (_state.companion) {
    // Kısa selamlama → TTS bitince aktif dinleme (TTS konuşurken STT açılmaz;
    // selamlama mikrofona karışmaz). Lazy import — modül yükünde TTS zinciri yok.
    const greeting = WAKE_GREETINGS[_greetCounter % WAKE_GREETINGS.length];
    _greetCounter++;
    void import('./ttsService')
      .then(({ ttsSpeak }) => {
        ttsSpeak(greeting, { rate: 1.05, onEnd: () => { startListening(); } });
      })
      .catch(() => { startListening(); }); // TTS yoksa selamlamasız dinle (fail-soft)
  } else {
    startListening();
  }

  // Önceki timer varsa iptal et (hızlı art arda tetiklenme koruması)
  if (_detectedTimer) { clearTimeout(_detectedTimer); }
  _detectedTimer = setTimeout(() => {
    _detectedTimer = null;
    if (_state.status === 'detected') push({ status: 'listening' });
  }, 1500);
}

function stopWebListening(): void {
  clearRestartTimer();
  if (_recognition) {
    try { _recognition.abort(); } catch { /* noop */ }
    _recognition = null;
  }
}

/* ── Native Android impl. ────────────────────────────────── */

/**
 * Döngü jenerasyonu: ayar değişiminde (disable→enable) ESKİ döngü
 * instance'ının in-flight promise'i çözülünce yeniden zincirlemesini keser —
 * aksi hâlde iki paralel döngü native STT'yi karşılıklı iptal edip wake'i
 * tamamen sağırlaştırıyordu.
 */
let _loopGen = 0;
/** Ardışık gerçek hata sayısı — N kez üst üste hata = görünür 'error' durumu. */
let _consecErrors = 0;
const MAX_CONSEC_ERRORS = 5;

function _pushHeard(transcript: string): void {
  const lastHeard = [transcript, ..._state.lastHeard].slice(0, 5);
  push({ lastHeard });
}

async function nativeLoop(gen: number): Promise<void> {
  if (gen !== _loopGen || !_nativeLoopActive || !_state.enabled) return;

  // Aktif dinleme/işleme sürerken pasif döngü mikrofon AÇMAZ — voiceService
  // ile startSpeechRecognition çakışması (wake'in cevabı yutması) önlenir.
  const vs = getVoiceSnapshot().status;
  if (vs === 'listening' || vs === 'processing') {
    setTimeout(() => { void nativeLoop(gen); }, 1500);
    return;
  }

  try {
    const { CarLauncher } = await import('./nativePlugin');
    // Offline-First (R-5): internet bağlantısı olsa bile yerel STT motoru her zaman
    // öncelikli — on-device tanıma <100ms, bulut STT ise ağ gecikme ekler.
    const result = await CarLauncher.startSpeechRecognition({
      preferOffline:  true,
      onlineFallback: false, // wake word sürekli döngü → online'a düşme (ağ/pil); offline-only kalsın
      language:       'tr-TR',
      maxResults:     3,
      // Pasif dinleme tuning'i: yüksek kazanç (uzaktan/yan konuşma) + uzun
      // pencere (daha az restart = daha az sağır boşluk) + DUCK YOK (pasif
      // bekleme müziği sürekli %12'ye kısıyordu — müzik dinlenemiyordu).
      gain:              VOICE_TUNING.wakeGainX,
      maxListenMs:       VOICE_TUNING.wakeListenMs,
      duckWhileListening: false,
    });

    if (gen !== _loopGen || !_nativeLoopActive || !_state.enabled) return;
    _consecErrors = 0;

    if (result.transcript) {
      _pushHeard(result.transcript);
      console.warn('[WakeWord] duyuldu:', JSON.stringify(result.transcript),
        '→ eşleşme:', _matches(result.transcript));
      if (_matches(result.transcript)) onWakeWordDetected();
    }
    // Yeniden döngü — kısa nefes (CPU'ya alan), sağır boşluk minimum
    setTimeout(() => { void nativeLoop(gen); }, 300);
  } catch (err) {
    if (gen !== _loopGen || !_nativeLoopActive || !_state.enabled) return;
    const msg = err instanceof Error ? err.message : String(err ?? '');
    // Sessizlik/zaman aşımı HATA DEĞİL — normal döngü olayı: HEMEN yeniden
    // dinle (eski 3 sn bekleme döngünün ~%25'ini sağır bırakıyordu).
    if (/no.?speech|timeout|zaman aşımı|cancel|abort/i.test(msg)) {
      _consecErrors = 0;
      setTimeout(() => { void nativeLoop(gen); }, 250);
      return;
    }
    // Gerçek hata (izin/model/donanım): logla, art arda 5'te görünür hata bas.
    _consecErrors++;
    console.warn(`[WakeWord] döngü hatası (${_consecErrors}/${MAX_CONSEC_ERRORS}):`, msg);
    if (_consecErrors >= MAX_CONSEC_ERRORS && _state.status !== 'error') {
      push({ status: 'error', errorMsg: msg || 'Wake word dinleme hatası' });
    }
    setTimeout(() => { void nativeLoop(gen); }, 3000);
  }
}

/* ── Public API ──────────────────────────────────────────── */

export interface EnableWakeWordOpts {
  /** Companion kaynağı: selamlama + TR kelime-sınırlı eşleşme. */
  companion?: boolean;
}

export function enableWakeWord(words?: string | string[], opts?: EnableWakeWordOpts): void {
  const list = (Array.isArray(words) ? words : [words ?? DEFAULT_WAKE_WORD])
    .filter((w): w is string => typeof w === 'string' && w.trim().length > 0);
  const companion = opts?.companion === true;
  const wakeWords = list.length > 0
    ? (companion ? list.map(normalizeWakeText).filter(Boolean) : list)
    : [DEFAULT_WAKE_WORD];

  if (isNative) {
    // Native Android: arka plan wake word döngüsü.
    // NOT: pasif beklerken status 'idle' kalır — UI "Dinliyorum" GÖSTERMEZ;
    // görünür durum yalnız tetiklenme sonrası aktif dinlemede (voiceService).
    push({ enabled: true, wakeWords, companion, status: 'idle', errorMsg: null });
    _nativeLoopActive = true;
    _consecErrors = 0;
    // Jenerasyon artır: olası eski döngü instance'ı bir sonraki adımında ölür;
    // yeni döngü tek başına çalışır (paralel döngü = karşılıklı STT iptali).
    void nativeLoop(++_loopGen);
  } else {
    // Web: sürekli dinleme yok — push-to-talk yeterli
    // Wake word toggle ayarları kayıt altında kalır ama web'de mikrofon açılmaz
    push({ enabled: false, status: 'disabled', wakeWords, companion, errorMsg: null });
  }
}

export function disableWakeWord(): void {
  _nativeLoopActive = false;
  _loopGen++; // in-flight döngü adımı uyanınca kendini sonlandırır
  if (_detectedTimer) { clearTimeout(_detectedTimer); _detectedTimer = null; }
  push({ enabled: false, status: 'disabled' });
  stopWebListening();
}

export function setWakeWord(word: string): void {
  push({ wakeWords: [word] });
}

export function getWakeWordState(): WakeWordState { return _state; }

/** @internal — testler arası izolasyon. */
export function _resetWakeWordForTest(): void {
  _nativeLoopActive = false;
  _loopGen++;
  _consecErrors = 0;
  if (_detectedTimer) { clearTimeout(_detectedTimer); _detectedTimer = null; }
  clearRestartTimer();
  _greetCounter = 0;
  _state = { ...INITIAL };
}

/* ── HMR cleanup — dev modda Recognition/timer sızıntısını önle ─── */
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    _nativeLoopActive = false;                                      // nativeLoop döngüsünü kes
    _loopGen++;
    if (_detectedTimer) { clearTimeout(_detectedTimer); _detectedTimer = null; }
    stopWebListening();                                             // SpeechRecognition.abort() + _restartTimer iptal
    _listeners.clear();                                            // stale React setState callback'leri temizle
  });
}

/* ── React hook ──────────────────────────────────────────── */

export function useWakeWordState(): WakeWordState {
  const [state, setState] = useState<WakeWordState>(_state);
  useEffect(() => {
    setState(_state);
    _listeners.add(setState);
    return () => { _listeners.delete(setState); };
  }, []);
  return state;
}
