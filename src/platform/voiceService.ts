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
import { parseCommandFull, type ParsedCommand, type ParseSuggestion } from './commandParser';
import { getConfig } from './performanceMode';

/* ── Types ───────────────────────────────────────────────── */

export type VoiceStatus =
  | 'idle'        // waiting for input
  | 'listening'   // mic active (native) or demo listening
  | 'success'     // command dispatched — feedback visible
  | 'error';      // input unrecognised — suggestions visible

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
    if (_current.status === 'success') push({ status: 'idle' });
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
    return false; // Command ignored due to throttle
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
    if (_current.status === 'error') push({ status: 'idle', error: null, suggestions: [] });
  }, 3500);
  return false;
}

/**
 * Toggle listening state.
 * Demo: activates text input. Native (future): triggers SpeechRecognizer.
 */
export function startListening(): void {
  if (_current.status === 'listening') {
    push({ status: 'idle' });
    return;
  }
  if (isNative) {
    // TODO: CarLauncher.startSpeechRecognition()
    //   .then((r) => processTextCommand(r.transcript))
    //   .catch(() => push({ status: 'error', error: 'Ses alınamadı', suggestions: [] }));
    push({ status: 'listening', error: null, suggestions: [] });
    return;
  }
  push({ status: 'listening', error: null, suggestions: [] });
}

/** Cancel an active listening session. */
export function stopListening(): void {
  if (_current.status === 'listening') push({ status: 'idle' });
}

/** Reset all voice state (e.g., on drawer open/close). */
export function clearVoiceState(): void {
  push({ ...INITIAL });
}

/* ── React hook ──────────────────────────────────────────── */

export function useVoiceState(): VoiceState {
  const [state, setState] = useState<VoiceState>(_current);
  useEffect(() => {
    setState(_current);
    _stateListeners.add(setState);
    return () => { _stateListeners.delete(setState); };
  }, []);
  return state;
}
