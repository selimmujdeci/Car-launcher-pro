/**
 * Voice Service — central state and dispatch for voice commands.
 *
 * Google-free architecture: no cloud STT, no Google Assistant dependency.
 *   - Native: CarLauncher.startSpeechRecognition({ preferOffline: true })
 *     → Android on-device STT (no data sent to Google)
 *   - Web/demo: text-input only (no webkitSpeechRecognition)
 *
 * Pipeline: text input → parseCommandFull() → dispatch → TTS feedback
 * Session context: last MAX_HISTORY commands tracked for UI history panel.
 */
import { useState, useEffect } from 'react';
import { isNative } from './bridge';
import { CarLauncher } from './nativePlugin';
import { parseCommandFull, type ParsedCommand, type ParseSuggestion } from './commandParser';
import { getConfig } from './performanceMode';
import { speakFeedback } from './ttsService';
import { askAI, resolveApiKey, type AIProvider, type AIVoiceResult, type VehicleContext } from './aiVoiceService';

/* ── Types ───────────────────────────────────────────────── */

export type VoiceStatus =
  | 'idle'        // waiting for input
  | 'listening'   // mic active (native) or text-input mode
  | 'processing'  // AI call in progress (low offline confidence, online fallback)
  | 'success'     // command dispatched — feedback visible
  | 'error'       // input unrecognised — suggestions visible
  | 'throttled';  // lite mode: too soon after last command

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
  /** Last MAX_HISTORY dispatched commands — newest first */
  history:     HistoryEntry[];
  /** Whether mic is available on this platform without Google */
  micAvailable: boolean;
}

/** Receives every successfully dispatched command. */
export type CommandHandler = (cmd: ParsedCommand) => void;

/** Receives AI results before they're dispatched — commandExecutor bağlantı noktası. */
export type AIResultHandler = (result: AIVoiceResult, ctx?: VehicleContext) => void;

/* ── Module-level state ──────────────────────────────────── */

const MAX_HISTORY = 5;

/** True only on native Android where offline STT is available. */
const MIC_AVAILABLE = isNative;

const INITIAL: VoiceState = {
  status:       'idle',
  lastCommand:  null,
  transcript:   '',
  error:        null,
  suggestions:  [],
  history:      [],
  micAvailable: MIC_AVAILABLE,
};

let _current: VoiceState = { ...INITIAL };
const _stateListeners  = new Set<(s: VoiceState) => void>();
const _commandHandlers = new Set<CommandHandler>();
const _aiHandlers      = new Set<AIResultHandler>();
let _lastCommandTime = 0;

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

/**
 * Register a handler that receives every dispatched command.
 * Returns a cleanup fn — use as `useEffect(() => registerCommandHandler(fn), [])`.
 */
export function registerCommandHandler(handler: CommandHandler): () => void {
  _commandHandlers.add(handler);
  return () => { _commandHandlers.delete(handler); };
}

/**
 * AI sonuçlarını doğrudan alan handler'ı kaydet.
 * commandExecutor.executeAIResult() buradan tetiklenir.
 */
export function registerAIResultHandler(handler: AIResultHandler): () => void {
  _aiHandlers.add(handler);
  return () => { _aiHandlers.delete(handler); };
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

/**
 * Sürüş modu dispatch — Safety-First, TTS-only.
 *
 * NHTSA Distracted Driving Guidelines + ISO 15008:
 *   Araç hareket halindeyken ekranda komut metni / başarı durumu
 *   göstermek sürücünün dikkatini ekrana çeker. Bu versiyon:
 *     1. Yalnızca TTS seslendirir (ekran değişmez)
 *     2. Status 'idle' kalır (kart animasyonu tetiklenmez)
 *     3. Komut handlers'lara iletilir (navigasyon/müzik çalışır)
 */
function dispatchDriving(cmd: ParsedCommand): void {
  speakFeedback(cmd.feedback);      // Sadece ses
  pushHistory(cmd);                 // Geçmişe ekle (sessizce)
  _commandHandlers.forEach((fn) => fn(cmd)); // Routing çalışır
  // Status değişmez → ekranda hiçbir şey titremez
}

/* ── Public API ──────────────────────────────────────────── */

/* ── AI settings reader (lazy import avoids circular dep) ──── */

interface AISettings { provider: AIProvider; geminiKey: string; haikuKey: string }

function getAISettings(): AISettings {
  try {
    // Provider ayarını Zustand store'dan oku
    const raw = localStorage.getItem('car-launcher-storage');
    const provider = raw
      ? ((JSON.parse(raw) as { state?: { settings?: { aiVoiceProvider?: AIProvider } } })
          ?.state?.settings?.aiVoiceProvider ?? 'none')
      : 'none';
    // API anahtarları sensitiveKeyStore'dan okunur (async) —
    // senkron erişim için şifrelenmiş blobu decode etmeden önce
    // VITE_ env fallback'i yeterli; gerçek değer processTextCommand içindeki
    // async akışta resolveApiKey tarafından beklenerek elde edilir.
    return { provider, geminiKey: '', haikuKey: '' };
  } catch {
    return { provider: 'none', geminiKey: '', haikuKey: '' };
  }
}

/** AI confidence threshold — below this, AI is tried if available. */
const AI_FALLBACK_THRESHOLD = 0.50;

/**
 * Process text as a voice command.
 *
 * Pipeline:
 *   1. Offline parser (always, instant)
 *   2. If confidence < threshold AND internet + API key → AI fallback (async)
 *   3. If AI unavailable / fails → show offline error
 *
 * @param text  Kullanıcı komutu (serbest metin)
 * @param ctx   Araç bağlamı — sürüş modunda TTS-only dispatch ve kısa AI yanıtı için
 *
 * Returns a Promise so callers can await, but fire-and-forget is also safe.
 */
export async function processTextCommand(text: string, ctx?: VehicleContext): Promise<boolean> {
  const trimmed = text.trim();
  if (!trimmed) return false;

  // Throttle in lite mode
  const cfg = getConfig();
  const now = Date.now();
  if (!cfg.enableRecommendations && (now - _lastCommandTime < 1500)) {
    const remaining = Math.ceil((1500 - (now - _lastCommandTime)) / 1000);
    push({ status: 'throttled', error: `Lütfen ${remaining}s bekleyin`, transcript: trimmed });
    setTimeout(() => push({ status: 'idle' }), 1200);
    return false;
  }

  // ── 1. Offline parser ────────────────────────────────────
  const result = parseCommandFull(trimmed);

  if (result.command && result.command.confidence >= AI_FALLBACK_THRESHOLD) {
    _lastCommandTime = now;
    // Sürüş modunda TTS-only — ekranda feedback titremesi yok
    if (ctx?.isDriving) { dispatchDriving(result.command); } else { dispatch(result.command); }
    return true;
  }

  // ── 2. AI fallback (if internet + provider configured) ───
  const ai = getAISettings();
  // API anahtarlarını şifreli depodan oku (async — processTextCommand zaten async)
  const { sensitiveKeyStore: sks } = await import('./sensitiveKeyStore');
  const [geminiKey, haikuKey] = await Promise.all([
    sks.get('geminiApiKey'),
    sks.get('claudeHaikuApiKey'),
  ]);
  const rawKey = ai.provider === 'gemini' ? geminiKey : haikuKey;
  // resolveApiKey checks settings key first, then VITE_ env var as fallback
  const apiKey = resolveApiKey(ai.provider, rawKey);
  const hasNet = typeof navigator !== 'undefined' && navigator.onLine;

  if (ai.provider !== 'none' && apiKey && hasNet) {
    push({ status: 'processing', transcript: trimmed, error: null, suggestions: [] });

    const aiResult = await askAI(trimmed, ai.provider, apiKey, ctx);
    if (aiResult && aiResult.intent !== 'UNKNOWN' && aiResult.confidence >= 0.45) {
      _lastCommandTime = Date.now();
      // commandExecutor handler'larına ilet — TTS + dispatch orada yapılır
      _aiHandlers.forEach((fn) => fn(aiResult, ctx));
      if (!ctx?.isDriving) {
        // Visual feedback: success card göster (TTS commandExecutor'da)
        push({ status: 'success', transcript: trimmed, error: null, suggestions: [] });
        const delay = aiResult.confidence >= 0.8 ? 2000 : 2500;
        setTimeout(() => {
          try { if (_current.status === 'success') push({ status: 'idle' }); } catch { /* noop */ }
        }, delay);
      }
      return true;
    }
    // AI returned null, UNKNOWN, or low confidence — fall through to error
  }

  // ── 3. Low-confidence offline match — dispatch anyway ────
  if (result.command) {
    _lastCommandTime = now;
    if (ctx?.isDriving) { dispatchDriving(result.command); } else { dispatch(result.command); }
    return true;
  }

  // ── 4. No match ──────────────────────────────────────────
  const offlineOnly = ai.provider === 'none' || !apiKey || !hasNet;
  push({
    status:      'error',
    error:       offlineOnly
      ? `"${trimmed}" anlaşılamadı`
      : `"${trimmed}" anlaşılamadı — AI de yanıt vermedi`,
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
 *
 * Native only — uses Android on-device STT (Google-free, preferOffline: true).
 * Web/demo mode: text-input is the primary interface; calling startListening()
 * in web mode simply activates the text input overlay (no mic, no Google API).
 */
export function startListening(): void {
  if (_current.status === 'listening') {
    stopListening();
    return;
  }

  push({ status: 'listening', error: null, suggestions: [] });

  if (isNative) {
    // Native: Android on-device STT — preferOffline ensures no Google cloud calls
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
          push({ status: 'error', error: 'Ses alınamadı — cihaz mikrofonu kontrol edin', suggestions: [] });
          setTimeout(() => {
            try {
              if (_current.status === 'error') push({ status: 'idle', error: null, suggestions: [] });
            } catch { /* ignore */ }
          }, 3_000);
        } catch { /* ignore */ }
      });
  }
  // Web mode: overlay shows text input — no action needed here
  // (UI component handles input and calls processTextCommand directly)
}

/** Cancel an active listening session and immediately close the mic. */
export function stopListening(): void {
  if (_current.status === 'listening') push({ status: 'idle' });
}

/** Reset all voice state. */
export function clearVoiceState(): void {
  push({ ...INITIAL, history: _current.history });
}

/** Clear command history. */
export function clearVoiceHistory(): void {
  push({ history: [] });
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
