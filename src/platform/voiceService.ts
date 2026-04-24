/**
 * Voice Service — central state and dispatch for voice commands.
 *
 * Google-free architecture: no cloud STT, no Google Assistant dependency.
 *   - Native: CarLauncher.startSpeechRecognition({ preferOffline: true })
 *     → Android on-device STT (no data sent to Google)
 *   - Web: webkitSpeechRecognition fallback with AudioContext visualizer.
 *
 * Pipeline: text input → parseCommandFull() → dispatch → TTS feedback
 */
import { useState, useEffect } from 'react';
import { isNative } from './bridge';
import { CarLauncher } from './nativePlugin';
import { parseCommandFull, type ParsedCommand, type ParseSuggestion } from './commandParser';
import { getConfig } from './performanceMode';
import { speakFeedback } from './ttsService';
import { askAI, resolveApiKey, type AIProvider, type AIVoiceResult, type VehicleContext } from './aiVoiceService';
import { onDTCState } from './dtcService';
import { getMaintenanceAssessment } from './vehicleMaintenanceService';

/* ── Types ───────────────────────────────────────────────── */

export type VoiceStatus =
  | 'idle'
  | 'listening'
  | 'processing'
  | 'success'
  | 'error'
  | 'throttled';

export interface HistoryEntry {
  command:   ParsedCommand;
  timestamp: number;
}

export interface VoiceState {
  status:      VoiceStatus;
  lastCommand: ParsedCommand | null;
  transcript:  string;
  error:       string | null;
  suggestions: ParseSuggestion[];
  history:     HistoryEntry[];
  micAvailable: boolean;
  /** Real-time mic volume level (0.0 to 1.0) for visualization */
  volumeLevel:  number;
}

export type CommandHandler = (cmd: ParsedCommand) => void;
export type AIResultHandler = (result: AIVoiceResult, ctx?: VehicleContext) => void;

/* ── Module-level state ──────────────────────────────────── */

const MAX_HISTORY = 5;
const MIC_AVAILABLE = isNative || (typeof window !== 'undefined' && !!((window as any).webkitSpeechRecognition || (window as any).SpeechRecognition));

const INITIAL: VoiceState = {
  status:       'idle',
  lastCommand:  null,
  transcript:   '',
  error:        null,
  suggestions:  [],
  history:      [],
  micAvailable: MIC_AVAILABLE,
  volumeLevel:  0,
};

let _current: VoiceState = { ...INITIAL };
const _stateListeners  = new Set<(s: VoiceState) => void>();
const _commandHandlers = new Set<CommandHandler>();
const _aiHandlers      = new Set<AIResultHandler>();
let _lastCommandTime = 0;

/* ── Audio Visualizer Logic ──────────────────────────────── */

let _audioCtx: AudioContext | null = null;
let _stream: MediaStream | null = null;
let _analyser: AnalyserNode | null = null;
let _animationFrame: number | null = null;

function _stopVolumeMeter(): void {
  if (_animationFrame) cancelAnimationFrame(_animationFrame);
  if (_stream) _stream.getTracks().forEach(t => t.stop());
  if (_audioCtx && _audioCtx.state !== 'closed') _audioCtx.close();
  _animationFrame = null;
  _stream = null;
  _audioCtx = null;
  _analyser = null;
  push({ volumeLevel: 0 });
}

function _startVolumeMeter(): void {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return;
  
  navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
    _stream = stream;
    _audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const source = _audioCtx.createMediaStreamSource(stream);
    _analyser = _audioCtx.createAnalyser();
    _analyser.fftSize = 256;
    source.connect(_analyser);

    const dataArray = new Uint8Array(_analyser.frequencyBinCount);
    const tick = () => {
      if (!_analyser) return;
      _analyser.getByteFrequencyData(dataArray);
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
      const avg = sum / dataArray.length;
      // Normalize to 0-1 range with a slight boost
      push({ volumeLevel: Math.min(1, (avg / 128) * 1.5) });
      _animationFrame = requestAnimationFrame(tick);
    };
    tick();
  }).catch(e => {
    console.warn('Volume meter failed:', e);
    // Silent fail for meter, but still listening
  });
}

function push(partial: Partial<VoiceState>): void {
  _current = { ..._current, ...partial };
  _stateListeners.forEach((fn) => fn(_current));
}

function pushHistory(cmd: ParsedCommand): void {
  const entry: HistoryEntry = { command: cmd, timestamp: Date.now() };
  const history = [entry, ..._current.history].slice(0, MAX_HISTORY);
  push({ history });
}

/* ── Command handler registry ────────────────────────────── */

export function registerCommandHandler(handler: CommandHandler): () => void {
  _commandHandlers.add(handler);
  return () => { _commandHandlers.delete(handler); };
}

export function registerAIResultHandler(handler: AIResultHandler): () => void {
  _aiHandlers.add(handler);
  return () => { _aiHandlers.delete(handler); };
}

/* ── Core dispatch ───────────────────────────────────────── */

function getResetDelays(): Record<string, number> {
  const cfg = getConfig();
  const baseMultiplier = cfg.enableRecommendations ? 1 : 1.5;
  return {
    critical: Math.round(2000 * baseMultiplier),
    high:     Math.round(2500 * baseMultiplier),
    normal:   Math.round(2500 * baseMultiplier),
  };
}

function dispatch(cmd: ParsedCommand): void {
  push({
    status:      'success',
    lastCommand: cmd,
    transcript:  cmd.raw,
    error:       null,
    suggestions: [],
  });
  pushHistory(cmd);
  speakFeedback(cmd.feedback);
  _commandHandlers.forEach((fn) => fn(cmd));
  const delays = getResetDelays();
  setTimeout(() => {
    try {
      if (_current.status === 'success') push({ status: 'idle' });
    } catch { /* ignore */ }
  }, delays[cmd.priority] ?? 2500);
}

function dispatchDriving(cmd: ParsedCommand): void {
  speakFeedback(cmd.feedback);
  pushHistory(cmd);
  _commandHandlers.forEach((fn) => fn(cmd));
}

/* ── AI Context Building ──────────────────────────────────── */

async function _buildEnrichedCtx(ctx?: VehicleContext): Promise<VehicleContext> {
  const base: VehicleContext = ctx ?? { speedKmh: 0, drivingMode: 'idle', isDriving: false };
  let dtcCodes: VehicleContext['activeDTCCodes'] = base.activeDTCCodes;
  try {
    let snap: { codes: VehicleContext['activeDTCCodes'] } | undefined;
    const unsub = onDTCState((s) => { snap = s; });
    unsub();
    if (snap) dtcCodes = snap.codes;
  } catch { /* ignore */ }

  let maintenanceAssessments: VehicleContext['maintenanceAssessments'] = base.maintenanceAssessments;
  try {
    maintenanceAssessments = await getMaintenanceAssessment();
  } catch { /* ignore */ }

  return { ...base, activeDTCCodes: dtcCodes, maintenanceAssessments };
}

/* ── Processing ───────────────────────────────────────────── */

export async function processTextCommand(text: string, ctx?: VehicleContext): Promise<boolean> {
  const trimmed = text.trim();
  if (!trimmed) return false;

  const cfg = getConfig();
  const now = Date.now();
  if (!cfg.enableRecommendations && (now - _lastCommandTime < 1500)) {
    const remaining = Math.ceil((1500 - (now - _lastCommandTime)) / 1000);
    push({ status: 'throttled', error: `Lütfen ${remaining}s bekleyin`, transcript: trimmed });
    setTimeout(() => push({ status: 'idle' }), 1200);
    return false;
  }

  const result = parseCommandFull(trimmed);
  if (result.command && result.command.confidence >= 0.5) {
    _lastCommandTime = now;
    if (ctx?.isDriving) { dispatchDriving(result.command); } else { dispatch(result.command); }
    return true;
  }

  const rawKey = localStorage.getItem('car-launcher-storage'); // simplification for logic
  const provider = rawKey ? JSON.parse(rawKey)?.state?.settings?.aiVoiceProvider : 'none';
  
  const { sensitiveKeyStore: sks } = await import('./sensitiveKeyStore');
  const [geminiKey, haikuKey] = await Promise.all([
    sks.get('geminiApiKey'),
    sks.get('claudeHaikuApiKey'),
  ]);
  const apiKey = resolveApiKey(provider, provider === 'gemini' ? geminiKey : haikuKey);
  const hasNet = typeof navigator !== 'undefined' && navigator.onLine;

  if (provider !== 'none' && apiKey && hasNet) {
    push({ status: 'processing', transcript: trimmed, error: null, suggestions: [] });
    const enrichedCtx = await _buildEnrichedCtx(ctx);
    const aiResult = await askAI(trimmed, provider, apiKey, enrichedCtx);
    if (aiResult && aiResult.intent !== 'UNKNOWN' && aiResult.confidence >= 0.45) {
      _lastCommandTime = Date.now();
      _aiHandlers.forEach((fn) => fn(aiResult, ctx));
      if (!ctx?.isDriving) {
        push({ status: 'success', transcript: trimmed, error: null, suggestions: [] });
        setTimeout(() => { if (_current.status === 'success') push({ status: 'idle' }); }, 2000);
      }
      return true;
    }
  }

  if (result.command) {
    _lastCommandTime = now;
    if (ctx?.isDriving) { dispatchDriving(result.command); } else { dispatch(result.command); }
    return true;
  }

  push({
    status:      'error',
    error:       `"${trimmed}" anlaşılamadı`,
    transcript:  trimmed,
    suggestions: result.suggestions,
  });
  setTimeout(() => { if (_current.status === 'error') push({ status: 'idle', error: null }); }, 3500);
  return false;
}

/* ── Public API (Listening) ───────────────────────────────── */

let _webRecognition: any = null;

function _stopWebRecognition(): void {
  if (_webRecognition) {
    try {
      _webRecognition.onresult = null;
      _webRecognition.onerror = null;
      _webRecognition.onend = null;
      _webRecognition.stop();
    } catch { /* ignore */ }
    _webRecognition = null;
  }
}

export function startListening(): void {
  if (_current.status === 'listening') {
    stopListening();
    return;
  }

  push({ status: 'listening', error: null, suggestions: [] });
  _startVolumeMeter();

  if (isNative) {
    CarLauncher.startSpeechRecognition({ preferOffline: true, language: 'tr-TR', maxResults: 1 })
      .then((result) => {
        if (result.transcript) processTextCommand(result.transcript);
        else push({ status: 'idle' });
      })
      .catch((err) => {
        console.error('Native Speech Error:', err);
        push({ status: 'error', error: 'Ses algılanamadı. Çevrimdışı dil paketi (TR) yüklü mü?', suggestions: [] });
        setTimeout(() => { if (_current.status === 'error') push({ status: 'idle', error: null }); }, 3000);
      });
  } else {
    const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
    if (!SpeechRecognition) {
      push({ status: 'error', error: 'Tarayıcı ses tanımayı desteklemiyor.' });
      setTimeout(() => push({ status: 'idle' }), 3000);
      return;
    }

    _stopWebRecognition();
    _webRecognition = new SpeechRecognition();
    _webRecognition.lang = 'tr-TR';
    _webRecognition.interimResults = false;
    _webRecognition.maxAlternatives = 1;

    _webRecognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      if (transcript) processTextCommand(transcript);
    };

    _webRecognition.onerror = (event: any) => {
      console.error('Web Speech Error:', event.error);
      const msg = event.error === 'not-allowed' ? 'Mikrofon izni reddedildi.' : 'Ses tanıma hatası.';
      push({ status: 'error', error: msg });
      setTimeout(() => push({ status: 'idle' }), 3000);
    };

    _webRecognition.onend = () => {
      if (_current.status === 'listening') push({ status: 'idle' });
    };

    try { _webRecognition.start(); } catch (e) { push({ status: 'idle' }); }
  }
}

export function stopListening(): void {
  if (_current.status === 'listening') {
    if (!isNative) _stopWebRecognition();
    _stopVolumeMeter();
    push({ status: 'idle' });
  }
}

export function clearVoiceState(): void { push({ ...INITIAL, history: _current.history }); }
export function clearVoiceHistory(): void { push({ history: [] }); }

export function useVoiceState(): VoiceState {
  const [state, setState] = useState<VoiceState>(_current);
  useEffect(() => {
    setState(_current);
    _stateListeners.add(setState);
    return () => { _stateListeners.delete(setState); };
  }, []);
  return state;
}
