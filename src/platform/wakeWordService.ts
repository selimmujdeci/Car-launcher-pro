/**
 * Wake Word Service — "Hey Car" pasif dinleme.
 *
 * Web/Demo: Web SpeechRecognition API sürekli modunda çalışır.
 *   - interimResults:true → gecikme minimumdur
 *   - Her sonuçta wake word aranır
 *   - Tarayıcı izni gerektir; izin yoksa sessizce devre dışı
 *
 * Native Android: CarLauncher.startSpeechRecognition() her bitiminde
 *   otomatik yeniden başlatılır. Gerçek arka plan servisi için
 *   Android AccessibilityService veya HotwordDetector gerekir —
 *   bu versiyon ön plan modunda çalışır.
 *
 * Desteklenen uyandırma kelimeleri: "hey car", "tamam araç", "araç asistan"
 */

import { useState, useEffect } from 'react';
import { isNative } from './bridge';
import { startListening } from './voiceService';

/* ── Tipler ──────────────────────────────────────────────── */

export type WakeWordStatus = 'disabled' | 'idle' | 'listening' | 'detected' | 'error';

export interface WakeWordState {
  status:      WakeWordStatus;
  enabled:     boolean;
  wakeWord:    string;
  lastTrigger: number | null;
  errorMsg:    string | null;
}

/* ── Uyandırma kelimeleri ────────────────────────────────── */

const DEFAULT_WAKE_WORD = 'hey car';

const WAKE_PATTERNS = [
  'hey car',
  'hey kar',
  'hi car',
  'tamam araç',
  'tamam arac',
  'araç asistan',
  'arac asistan',
];

function matchesWakeWord(transcript: string, customWord: string): boolean {
  const norm = transcript.toLowerCase().trim();
  if (norm.includes(customWord.toLowerCase())) return true;
  return WAKE_PATTERNS.some((p) => norm.includes(p));
}

/* ── Modül durumu ────────────────────────────────────────── */

const INITIAL: WakeWordState = {
  status:      'disabled',
  enabled:     false,
  wakeWord:    DEFAULT_WAKE_WORD,
  lastTrigger: null,
  errorMsg:    null,
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

function onWakeWordDetected(): void {
  push({ status: 'detected', lastTrigger: Date.now() });
  startListening();
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

async function nativeLoop(): Promise<void> {
  if (!_nativeLoopActive || !_state.enabled) return;

  try {
    const { CarLauncher } = await import('./nativePlugin');
    // Offline-First (R-5): internet bağlantısı olsa bile yerel STT motoru her zaman
    // öncelikli — on-device tanıma <100ms, bulut STT ise ağ gecikme ekler.
    const result = await CarLauncher.startSpeechRecognition({
      preferOffline: true,
      language:      'tr-TR',
      maxResults:    3,
    });

    if (!_nativeLoopActive || !_state.enabled) return;

    if (result.transcript && matchesWakeWord(result.transcript, _state.wakeWord)) {
      onWakeWordDetected();
    }
    // Yeniden döngü
    if (_nativeLoopActive && _state.enabled) {
      setTimeout(() => { void nativeLoop(); }, 500);
    }
  } catch {
    if (_nativeLoopActive && _state.enabled) {
      setTimeout(() => { void nativeLoop(); }, 3000);
    }
  }
}

/* ── Public API ──────────────────────────────────────────── */

export function enableWakeWord(word?: string): void {
  const wakeWord = word ?? _state.wakeWord;

  if (isNative) {
    // Native Android: arka plan wake word döngüsü
    push({ enabled: true, wakeWord, errorMsg: null });
    _nativeLoopActive = true;
    nativeLoop();
  } else {
    // Web: sürekli dinleme yok — push-to-talk yeterli
    // Wake word toggle ayarları kayıt altında kalır ama web'de mikrofon açılmaz
    push({ enabled: false, status: 'disabled', wakeWord, errorMsg: null });
  }
}

export function disableWakeWord(): void {
  _nativeLoopActive = false;
  if (_detectedTimer) { clearTimeout(_detectedTimer); _detectedTimer = null; }
  push({ enabled: false, status: 'disabled' });
  stopWebListening();
}

export function setWakeWord(word: string): void {
  push({ wakeWord: word });
}

export function getWakeWordState(): WakeWordState { return _state; }

/* ── HMR cleanup — dev modda Recognition/timer sızıntısını önle ─── */
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    _nativeLoopActive = false;                                      // nativeLoop döngüsünü kes
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
