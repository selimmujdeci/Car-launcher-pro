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
let _nativeLoopActive = false;

function clearRestartTimer(): void {
  if (_restartTimer) { clearTimeout(_restartTimer); _restartTimer = null; }
}

function getSpeechAPI(): SpeechRecognitionAny {
  if (typeof window === 'undefined') return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const W = window as any;
  return W.SpeechRecognition ?? W.webkitSpeechRecognition ?? null;
}

function onWakeWordDetected(): void {
  push({ status: 'detected', lastTrigger: Date.now() });
  startListening();
  setTimeout(() => {
    if (_state.status === 'detected') push({ status: 'listening' });
  }, 1500);
}

function startWebListening(): void {
  const SR = getSpeechAPI();
  if (!SR) {
    push({ status: 'error', errorMsg: 'Tarayıcı ses tanımayı desteklemiyor' });
    return;
  }

  if (_recognition) {
    try { _recognition.abort(); } catch { /* noop */ }
    _recognition = null;
  }

  const rec: SpeechRecognitionAny = new SR();
  rec.continuous      = true;
  rec.interimResults  = true;
  rec.lang            = 'tr-TR';
  rec.maxAlternatives = 1;

  rec.onstart = () => {
    push({ status: 'listening', errorMsg: null });
  };

  rec.onresult = (evt: SpeechRecognitionAny) => {
    for (let i = evt.resultIndex; i < evt.results.length; i++) {
      const transcript = evt.results[i][0].transcript;
      if (matchesWakeWord(transcript, _state.wakeWord)) {
        onWakeWordDetected();
        return;
      }
    }
  };

  rec.onerror = (evt: SpeechRecognitionAny) => {
    if (evt.error === 'not-allowed') {
      push({ status: 'error', errorMsg: 'Mikrofon izni verilmedi' });
      return;
    }
    // Geçici hata — 2 saniye sonra yeniden başlat
    if (_state.enabled) {
      clearRestartTimer();
      _restartTimer = setTimeout(startWebListening, 2000);
    }
  };

  rec.onend = () => {
    if (_state.enabled && _state.status !== 'error') {
      // Sürekli çalışma: bitti → hemen yeniden başlat
      clearRestartTimer();
      _restartTimer = setTimeout(startWebListening, 300);
    }
  };

  _recognition = rec;
  try {
    rec.start();
  } catch {
    push({ status: 'error', errorMsg: 'Ses tanıma başlatılamadı' });
  }
}

function stopWebListening(): void {
  clearRestartTimer();
  if (_recognition) {
    try { _recognition.stop(); } catch { /* noop */ }
    _recognition = null;
  }
}

/* ── Native Android impl. ────────────────────────────────── */

async function nativeLoop(): Promise<void> {
  if (!_nativeLoopActive || !_state.enabled) return;

  try {
    const { CarLauncher } = await import('./nativePlugin');
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
      setTimeout(nativeLoop, 500);
    }
  } catch {
    if (_nativeLoopActive && _state.enabled) {
      setTimeout(nativeLoop, 3000);
    }
  }
}

/* ── Public API ──────────────────────────────────────────── */

export function enableWakeWord(word?: string): void {
  const wakeWord = word ?? _state.wakeWord;
  push({ enabled: true, wakeWord, errorMsg: null });

  if (isNative) {
    _nativeLoopActive = true;
    nativeLoop();
  } else {
    startWebListening();
  }
}

export function disableWakeWord(): void {
  _nativeLoopActive = false;
  push({ enabled: false, status: 'disabled' });
  stopWebListening();
}

export function setWakeWord(word: string): void {
  push({ wakeWord: word });
}

export function getWakeWordState(): WakeWordState { return _state; }

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
