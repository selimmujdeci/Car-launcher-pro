/**
 * Voice Service — central state and dispatch for voice commands.
 *
 * Architecture: module-level push pattern (same as deviceApi / mediaService).
 * Components subscribe via `useVoiceState()`; commands route via
 * `registerCommandHandler()`.
 *
 * Current mode: text-input demo — no microphone required.
 *
 * Native migration path:
 *   startListening() → CarLauncher.startSpeechRecognition()
 *     .then(transcript => processTextCommand(transcript))
 *   The rest of the pipeline (ParsedCommand, CommandHandler, feedback) is
 *   identical in both modes — only the input source changes.
 */
import { useState, useEffect } from 'react';
import { isNative } from './bridge';
import { CarLauncher } from './nativePlugin';
import { parseCommandFull, type ParsedCommand, type ParseSuggestion } from './commandParser';
import { getConfig } from './performanceMode';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SpeechRecognitionAny = any;

function getWebSpeechAPI(): SpeechRecognitionAny {
  if (typeof window === 'undefined') return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const W = window as any;
  return W.SpeechRecognition ?? W.webkitSpeechRecognition ?? null;
}

/* ── Types ───────────────────────────────────────────────── */

export type VoiceStatus =
  | 'idle'        // waiting for input
  | 'listening'   // mic active (native) or demo listening
  | 'success'     // command dispatched — feedback visible
  | 'error'       // input unrecognised — suggestions visible
  | 'throttled';  // lite mode: too soon after last command

export interface VoiceState {
  status:      VoiceStatus;
  lastCommand: ParsedCommand | null;   // last successfully parsed command
  transcript:  string;                 // last raw input
  error:       string | null;          // user-facing error label
  suggestions: ParseSuggestion[];      // "Did you mean?" entries on error
}

/** Receives every successfully dispatched command. */
export type CommandHandler = (cmd: ParsedCommand) => void;

/* ── Module-level state ──────────────────────────────────── */

const INITIAL: VoiceState = {
  status:      'idle',
  lastCommand: null,
  transcript:  '',
  error:       null,
  suggestions: [],
};

let _current: VoiceState = { ...INITIAL };
const _stateListeners  = new Set<(s: VoiceState) => void>();
const _commandHandlers = new Set<CommandHandler>();
let _lastCommandTime = 0;

/* ── Web push-to-talk state ──────────────────────────────── */
let _webRec: SpeechRecognitionAny = null;
let _webTimeout: ReturnType<typeof setTimeout> | null = null;

function clearWebRec(): void {
  if (_webTimeout) { clearTimeout(_webTimeout); _webTimeout = null; }
  if (_webRec) {
    try { _webRec.abort(); } catch { /* noop */ }
    _webRec = null;
  }
}

/** Push-to-talk: opens mic once, closes on first result or timeout. */
function startWebRec(): void {
  const SR = getWebSpeechAPI();
  if (!SR) return; // Tarayıcı desteği yok — text-input fallback çalışmaya devam eder

  clearWebRec();

  const rec: SpeechRecognitionAny = new SR();
  rec.continuous      = false; // Tek seferlik — sürekli dinleme yok
  rec.interimResults  = false; // Sadece nihai sonuç — mikrofon süresi minimum
  rec.lang            = 'tr-TR';
  rec.maxAlternatives = 1;

  rec.onresult = (evt: SpeechRecognitionAny) => {
    const transcript: string = evt.results?.[0]?.[0]?.transcript ?? '';
    clearWebRec();
    if (transcript.trim()) {
      processTextCommand(transcript.trim());
    } else {
      push({ status: 'idle' });
    }
  };

  rec.onerror = (evt: SpeechRecognitionAny) => {
    clearWebRec();
    if (evt.error === 'aborted') return; // stopListening() tarafından kapatıldı
    if (evt.error === 'no-speech') {
      push({ status: 'idle' });
    } else {
      push({ status: 'error', error: 'Ses algılanamadı', suggestions: [] });
      setTimeout(() => {
        try { if (_current.status === 'error') push({ status: 'idle', error: null, suggestions: [] }); } catch { /* noop */ }
      }, 2500);
    }
  };

  rec.onend = () => {
    clearWebRec();
    if (_current.status === 'listening') push({ status: 'idle' });
  };

  _webRec = rec;

  // 8 saniye hard timeout — mikrofon asla açık kalmaz
  _webTimeout = setTimeout(() => {
    clearWebRec();
    if (_current.status === 'listening') push({ status: 'idle' });
  }, 8000);

  try {
    rec.start();
  } catch {
    clearWebRec();
    push({ status: 'idle' });
  }
}

function push(partial: Partial<VoiceState>): void {
  _current = { ..._current, ...partial };
  _stateListeners.forEach((fn) => fn(_current));
}

/* ── Command handler registry ────────────────────────────── */

/**
 * Register a handler that receives every dispatched command.
 * Returns a cleanup fn — use as `useEffect(() => registerCommandHandler(fn), [])`.
 */
export function registerCommandHandler(handler: CommandHandler): () => void {
  _commandHandlers.add(handler);
  return () => { _commandHandlers.delete(handler); };
}

/* ── Core dispatch ───────────────────────────────────────── */

// Reset delays per priority tier — affected by performance mode
function getResetDelays(): Record<string, number> {
  const cfg = getConfig();
  // Lite mode: longer delays to avoid UI thrashing
  // Premium mode: shorter delays for snappier feel
  const baseMultiplier = cfg.enableRecommendations ? 1 : 1.5; // lite mode is slower
  return {
    critical: Math.round(2000 * baseMultiplier),
    high:     Math.round(2500 * baseMultiplier),
    normal:   Math.round(2500 * baseMultiplier),
  };
}

function dispatch(cmd: ParsedCommand): void {
  // Set success state FIRST — then call handlers synchronously so the UI
  // shows "Anlaşıldı" before any navigation/launch side-effects render.
  push({
    status:      'success',
    lastCommand: cmd,
    transcript:  cmd.raw,
    error:       null,
    suggestions: [],
  });
  _commandHandlers.forEach((fn) => fn(cmd));
  const delays = getResetDelays();
  setTimeout(() => {
    try {
      if (_current.status === 'success') push({ status: 'idle' });
    } catch { /* ignore */ }
  }, delays[cmd.priority] ?? 2500);
}

/* ── Public API ──────────────────────────────────────────── */

/**
 * Process text as a voice command (demo input or native speech transcript).
 * Parsing is synchronous — critical commands feel instantaneous.
 * Lite mode: throttles command processing to prevent excessive updates.
 * Returns `true` if a command was recognised and dispatched.
 */
export function processTextCommand(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;

  // Throttle in lite mode (no recommendations = lite mode)
  const cfg = getConfig();
  const now = Date.now();
  if (!cfg.enableRecommendations && (now - _lastCommandTime < 1500)) {
    const remaining = Math.ceil((1500 - (now - _lastCommandTime)) / 1000);
    push({ status: 'throttled', error: `Lütfen ${remaining}s bekleyin`, transcript: trimmed });
    setTimeout(() => push({ status: 'idle' }), 1200);
    return false;
  }

  const result = parseCommandFull(trimmed);

  if (result.command) {
    _lastCommandTime = now;
    dispatch(result.command);
    return true;
  }

  push({
    status:      'error',
    error:       `"${trimmed}" anlaşılamadı`,
    transcript:  trimmed,
    suggestions: result.suggestions,
  });
  setTimeout(() => {
    try {
      if (_current.status === 'error') push({ status: 'idle', error: null, suggestions: [] });
    } catch { /* ignore */ }
  }, 3500);
  return false;
}

/**
 * Push-to-talk: opens mic for a single utterance then closes it.
 * Native: CarLauncher.startSpeechRecognition() — one-shot Android STT.
 * Web: SpeechRecognition API, continuous=false — mic closes after first result.
 *      Falls back to text-input if SpeechRecognition unavailable.
 */
export function startListening(): void {
  if (_current.status === 'listening') {
    stopListening();
    return;
  }

  push({ status: 'listening', error: null, suggestions: [] });

  if (isNative) {
    // Native: tek seferlik Android STT — doğal olarak biter
    CarLauncher.startSpeechRecognition({ preferOffline: true, language: 'tr-TR', maxResults: 1 })
      .then((result) => {
        try {
          if (result.transcript) {
            processTextCommand(result.transcript);
          } else {
            push({ status: 'idle' });
          }
        } catch {
          push({ status: 'idle' });
        }
      })
      .catch(() => {
        try {
          push({ status: 'error', error: 'Ses alınamadı', suggestions: [] });
          setTimeout(() => {
            try {
              if (_current.status === 'error') push({ status: 'idle', error: null, suggestions: [] });
            } catch { /* ignore */ }
          }, 3_000);
        } catch { /* ignore */ }
      });
  } else {
    // Web: push-to-talk — mikrofon yalnızca bu istek süresi kadar açık
    startWebRec();
  }
}

/** Cancel an active listening session and immediately close the mic. */
export function stopListening(): void {
  clearWebRec(); // Web mic'i hemen kapat
  if (_current.status === 'listening') push({ status: 'idle' });
}

/** Reset all voice state and close any open mic stream. */
export function clearVoiceState(): void {
  clearWebRec();
  push({ ...INITIAL });
}

/* ── React hook ──────────────────────────────────────────── */

export function useVoiceState(): VoiceState {
  const [state, setState] = useState<VoiceState>(_current);
  useEffect(() => {
    setState(_current);
    _stateListeners.add(setState);
    return () => { _stateListeners.delete(setState); };
  }, [setState]);
  return state;
}
