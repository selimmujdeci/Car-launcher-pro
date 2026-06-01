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
import { isLowEndDevice } from './headUnitCompat';
import { CarLauncher } from './nativePlugin';
import { parseCommandFull, type ParsedCommand, type ParseSuggestion } from './commandParser';
import { tryOfflineConversation } from './offlineConversationEngine';
import { getConfig } from './performanceMode';
import { speakFeedback } from './ttsService';
import { duckMedia, unduckMedia } from './audioService';
import { askAI, resolveApiKey, type AIVoiceResult, type VehicleContext } from './aiVoiceService';
import { classifySemantic, enrichBackground } from './ai/semanticAiService';
import { fromSemanticResult } from './intentEngine';
import { buildEnrichedCtx } from './voiceContextBuilder';

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

/** Bilişsel Pause: true iken TTS ve AI işleme atlanır; dinleme (VAD) devam eder. */
let _voiceCogPaused = false;

export function setVoicePaused(paused: boolean): void {
  _voiceCogPaused = paused;
}
const _commandHandlers = new Set<CommandHandler>();
const _aiHandlers      = new Set<AIResultHandler>();
let _lastCommandTime = 0;

/* ── Audio Visualizer Logic ──────────────────────────────── */

let _audioCtx: AudioContext | null = null;
let _stream: MediaStream | null = null;
let _analyser: AnalyserNode | null = null;
let _animationFrame: number | null = null;

// Native STT: gerçek AudioContext yok — sentetik dalga ile görsel geri bildirim
let _volumeSimTimer: ReturnType<typeof setInterval> | null = null;
// Native RMS event listener handle (gerçek mikrofon seviyesi)
let _rmsListenerHandle: { remove: () => Promise<void> } | null = null;
// T507 ısınma: STT başlamadan önce bekletme zamanlayıcısı
let _nativeSttWarmupTimer: ReturnType<typeof setTimeout> | null = null;
// Ardışık boş transcript sayacı — 1. boşta hata basma, 2.'de bas
let _consecutiveEmptyCount = 0;

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
    // Android WebView bazen AudioContext'i suspended başlatır — resume et
    if (_audioCtx.state === 'suspended') { _audioCtx.resume().catch(() => {}); }
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

function _stopVolumeSimulation(): void {
  if (_volumeSimTimer !== null) {
    clearInterval(_volumeSimTimer);
    _volumeSimTimer = null;
  }
  push({ volumeLevel: 0 });
}

function _startNativeVolumeListener(): void {
  if (_rmsListenerHandle) return;
  (CarLauncher as any).addListener('rmsData', (data: { value: number }) => {
    push({ volumeLevel: data.value });
  }).then((handle: { remove: () => Promise<void> }) => {
    _rmsListenerHandle = handle;
  }).catch(() => {});
}

function _stopNativeVolumeListener(): void {
  if (_rmsListenerHandle) {
    _rmsListenerHandle.remove().catch(() => {});
    _rmsListenerHandle = null;
  }
  push({ volumeLevel: 0 });
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

/** Sohbet yanıtı — komut dispatch yok, sadece TTS + UI güncelleme. */
function _dispatchConversation(response: string, raw: string): void {
  speakFeedback(response);
  push({ status: 'success', transcript: raw, error: null, suggestions: [], lastCommand: null });
  setTimeout(() => { if (_current.status === 'success') push({ status: 'idle' }); }, 3500);
}

/* ── Ara TTS geri bildirimleri ────────────────────────────────── */

const THINKING_PHRASES = [
  'Bakıyorum hemen...',
  'Anlıyorum...',
  'Düşünüyorum...',
  'Bir saniye...',
  'Kontrol ediyorum...',
  'Tabii, bakayım...',
];

function _speakThinking(): void {
  const phrase = THINKING_PHRASES[Math.floor(Math.random() * THINKING_PHRASES.length)];
  speakFeedback(phrase);
}

/* ── Processing ───────────────────────────────────────────── */

export async function processTextCommand(text: string, ctx?: VehicleContext): Promise<boolean> {
  const trimmed = text.trim();
  if (!trimmed) return false;

  // Bilişsel Pause: PROTECTION/CRITICAL modda AI işleme ve TTS atlanır
  if (_voiceCogPaused) return false;

  const cfg = getConfig();
  const now = Date.now();
  if (!cfg.enableRecommendations && (now - _lastCommandTime < 1500)) {
    const remaining = Math.ceil((1500 - (now - _lastCommandTime)) / 1000);
    push({ status: 'throttled', error: `Lütfen ${remaining}s bekleyin`, transcript: trimmed });
    setTimeout(() => push({ status: 'idle' }), 1200);
    return false;
  }

  // ── API anahtarlarını al (AI fallback için gerekli) ─────────
  const rawKey  = localStorage.getItem('car-launcher-storage');
  const provider = rawKey ? (JSON.parse(rawKey)?.state?.settings?.aiVoiceProvider ?? 'none') : 'none';
  const { sensitiveKeyStore: sks } = await import('./sensitiveKeyStore');
  const [geminiKey, haikuKey] = await Promise.all([
    sks.get('geminiApiKey'),
    sks.get('claudeHaikuApiKey'),
  ]);
  const apiKey = resolveApiKey(provider, provider === 'gemini' ? geminiKey : haikuKey);
  const hasNet = typeof navigator !== 'undefined' && navigator.onLine;

  // ── Yerel parser ────────────────────────────────────────────
  const result = parseCommandFull(trimmed);

  // Exact match (confidence 1.0) → anında dispatch, AI çağrısı yok
  if (result.command && result.command.confidence >= 1.0) {
    _lastCommandTime = now;
    if (ctx?.isDriving) { dispatchDriving(result.command); } else { dispatch(result.command); }
    return true;
  }

  // Fuzzy match (0.5–0.99) → yerel dispatch + arka plan proaktif log
  if (result.command && result.command.confidence >= 0.5) {
    _lastCommandTime = now;
    if (ctx?.isDriving) { dispatchDriving(result.command); } else { dispatch(result.command); }
    // Proaktif bağlam — sonucu beklemiyoruz, UI etkilenmiyor
    if (result.needsSemantic && provider !== 'none' && apiKey && hasNet) {
      enrichBackground(trimmed, provider, apiKey, ctx);
    }
    return true;
  }

  // ── Hiç komut eşleşmesi yok → önce offline sohbet motoru ─────
  const convResult = tryOfflineConversation(trimmed, ctx?.isDriving, ctx?.speedKmh);
  if (convResult.handled) {
    _lastCommandTime = now;
    _dispatchConversation(convResult.response, trimmed);
    return true;
  }

  // ── Sohbet da eşleşmedi → Semantic NLP devreye giriyor ───────
  if (provider !== 'none' && apiKey) {
    if (!hasNet) {
      // Çevrimdışı — ne yapabileceğini söyle
      speakFeedback('Bunu anlayamadım. Komut veya soru söyle.');
      push({
        status:      'error',
        error:       'İnternet bağlantısı yok',
        transcript:  trimmed,
        suggestions: result.suggestions,
      });
      setTimeout(() => { if (_current.status === 'error') push({ status: 'idle', error: null }); }, 3500);
      return false;
    }

    // Ara sesli geri bildirim — AI yanıtını beklerken yerel öneriler hazırda tut (R-5 Hybrid)
    push({ status: 'processing', transcript: trimmed, error: null, suggestions: result.suggestions });
    _speakThinking();

    const enrichedCtx = await buildEnrichedCtx(ctx);

    // ── Semantik NLP (POI + bağlamsal anlama) ───────────────
    const semanticResult = await classifySemantic(trimmed, provider, apiKey, enrichedCtx);

    if (semanticResult.source !== 'offline' && semanticResult.confidence >= 0.45) {
      const intent = fromSemanticResult(semanticResult, trimmed);
      if (intent) {
        _lastCommandTime = Date.now();
        // semanticResult'ı mevcut AI handler zincirine ilet (VoiceAssistant, commandExecutor vb.)
        const aiCompat: AIVoiceResult = {
          intent:     intent.type as AIVoiceResult['intent'],
          payload:    intent.payload as Record<string, unknown>,
          confidence: semanticResult.confidence,
          feedback:   semanticResult.feedback,
        };
        _aiHandlers.forEach((fn) => fn(aiCompat, ctx));
        speakFeedback(semanticResult.feedback);
        if (!ctx?.isDriving) {
          push({ status: 'success', transcript: trimmed, error: null, suggestions: [] });
          setTimeout(() => { if (_current.status === 'success') push({ status: 'idle' }); }, 2000);
        }
        return true;
      }
    }

    // Semantik anlamlandıramadıysa — genel AI'ı dene (mevcut aiVoiceService)
    const aiResult = await askAI(trimmed, provider, apiKey, enrichedCtx);
    if (aiResult && aiResult.intent !== 'UNKNOWN' && aiResult.confidence >= 0.45) {
      _lastCommandTime = Date.now();
      _aiHandlers.forEach((fn) => fn(aiResult, ctx));
      speakFeedback(aiResult.feedback);
      if (!ctx?.isDriving) {
        push({ status: 'success', transcript: trimmed, error: null, suggestions: [] });
        setTimeout(() => { if (_current.status === 'success') push({ status: 'idle' }); }, 2000);
      }
      return true;
    }

    // AI null döndü (timeout / abort / invalid) — yerel parser açık fallback (CLAUDE.md §2).
    // Local parser result of truth; AI sadece zenginleştirici, asla tek yetkili değil.
    if (result.command) {
      _lastCommandTime = now;
      if (result.suggestions.length > 0) speakFeedback('İnternet yavaş, şunu mu demek istediniz?');
      if (ctx?.isDriving) { dispatchDriving(result.command); } else { dispatch(result.command); }
      return true;
    }
    if (result.suggestions.length > 0) {
      speakFeedback('İnternet yavaş, şunu mu demek istediniz?');
      push({
        status:      'error',
        error:       'İnternet yavaş, şunu mu demek istediniz?',
        transcript:  trimmed,
        suggestions: result.suggestions,
      });
      setTimeout(() => { if (_current.status === 'error') push({ status: 'idle', error: null }); }, 4000);
      return false;
    }
  }

  // Düşük güvenlikli yerel eşleşme varsa son çare olarak kullan
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
  // Warmup timer in-flight da re-entry'yi engeller
  if (_current.status === 'listening' || _nativeSttWarmupTimer !== null) {
    stopListening();
    return;
  }

  // AudioContext donma koruması — her tetiklemede suspended ise resume et
  if (_audioCtx && _audioCtx.state === 'suspended') {
    _audioCtx.resume().catch(() => {});
  }

  if (isNative) {
    // T507 ısınma süresi: tüm native cihazlarda 500ms — mikrofon donanım açılışı beklenir.
    const warmupMs = isLowEndDevice() ? 500 : 300;

    const sttFailsafe = setTimeout(() => {
      if (_current.status === 'listening') {
        console.warn('[Voice] STT timeout (10s) — forcing idle');
        _stopNativeVolumeListener();
        unduckMedia();
        push({ status: 'idle' });
      }
    }, 10_000);

    const doSTT = () => {
      // Warmup bitti — mikrofon donanımı gerçekten açılıyor. "Dinliyorum" ancak burada basılır.
      push({ status: 'listening', error: null, suggestions: [], volumeLevel: 0 });
      _startNativeVolumeListener();
      duckMedia();

      CarLauncher.startSpeechRecognition({ preferOffline: true, onlineFallback: true, language: 'tr-TR', maxResults: 1 })
        .then((result) => {
          clearTimeout(sttFailsafe);
          _stopNativeVolumeListener();
          unduckMedia();
          const transcript = result.transcript?.trim() ?? '';
          if (transcript) {
            _consecutiveEmptyCount = 0;
            // CarLauncher bitti → anında "işleniyor" hissi ver, ardından processTextCommand çalışır
            push({ status: 'processing', transcript });
            void processTextCommand(transcript);
          } else {
            // Boş transcript: ilk boşta sessizce idle, 2. ardışık boşta bilgilendirme göster
            _consecutiveEmptyCount++;
            if (_consecutiveEmptyCount >= 2) {
              _consecutiveEmptyCount = 0;
              push({ status: 'error', error: 'Ses algılanamadı. Daha yüksek sesle konuşun.', suggestions: [] });
              setTimeout(() => { if (_current.status === 'error') push({ status: 'idle', error: null }); }, 2500);
            } else {
              push({ status: 'idle' });
            }
          }
        })
        .catch((err: unknown) => {
          clearTimeout(sttFailsafe);
          _stopNativeVolumeListener();
          unduckMedia();
          const msg = err instanceof Error ? err.message : String(err ?? '');
          // cancel/abort/timeout/no-speech → kullanıcı vazgeçti veya sessiz kaldı → sessizce idle
          // "Ses algılanamadı" hatasından ayrı tutulur: bu yol kullanıcıyı suçlamaz
          if (/cancel|abort|timeout|no.?speech|no.?match/i.test(msg)) {
            _consecutiveEmptyCount = 0;
            push({ status: 'idle' });
            return;
          }
          console.error('Native Speech Error:', err);
          const isPermission = /permission|denied|not.?allowed/i.test(msg);
          // Native, Vosk başlatma hatasını gerçek sebebiyle gönderir (head unit
          // teşhisi için) → genel mesaj yerine bu gerçek hatayı göster.
          const isVoskDiag = /vosk|model|stt|unpack|abi|storage/i.test(msg);
          push({
            status: 'error',
            error: isPermission
              ? 'Mikrofon izni verilmemiş.'
              : isVoskDiag
              ? msg
              : 'Ses tanıma başarısız. İnternet bağlantısı veya çevrimdışı dil paketi (TR) gerekli.',
            suggestions: [],
          });
          setTimeout(() => { if (_current.status === 'error') push({ status: 'idle', error: null }); }, 3000);
        });
    };

    if (warmupMs > 0) {
      _nativeSttWarmupTimer = setTimeout(() => {
        _nativeSttWarmupTimer = null;
        doSTT();
      }, warmupMs);
    } else {
      doSTT();
    }
  } else {
    push({ status: 'listening', error: null, suggestions: [], volumeLevel: 0 });
    _startVolumeMeter();
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
      const transcript = (event.results[0][0].transcript as string)?.trim();
      if (transcript) void processTextCommand(transcript);
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

    try { _webRecognition.start(); } catch { push({ status: 'idle' }); }
  }
}

export function stopListening(): void {
  // Warmup timer status 'listening'e ulaşmadan önce de iptale açık olmalı
  if (_nativeSttWarmupTimer !== null) {
    clearTimeout(_nativeSttWarmupTimer);
    _nativeSttWarmupTimer = null;
  }
  if (_current.status === 'listening') {
    if (!isNative) _stopWebRecognition();
    _stopVolumeMeter();
    if (isNative) {
      _stopNativeVolumeListener();
    } else {
      _stopVolumeSimulation();
    }
    unduckMedia();
    push({ status: 'idle' });
  }
}

/**
 * Hard kill — stopListening'den farklı olarak durum kontrolü yapmaz.
 * Tüm runtime döngüleri koşulsuz temizlenir; global state korunur.
 * SystemBoot LIMP_HOME girişinde ve L3 termal olaylarında çağrılır.
 */
export function stopVoiceService(): void {
  if (_nativeSttWarmupTimer !== null) {
    clearTimeout(_nativeSttWarmupTimer);
    _nativeSttWarmupTimer = null;
  }
  _stopVolumeSimulation();       // _volumeSimTimer → null
  _stopNativeVolumeListener();   // _rmsListenerHandle → remove + null
  _stopVolumeMeter();            // _audioCtx → closed + null, stream → durduruldu, animFrame → iptal
  _stopWebRecognition();
  unduckMedia();                 // ses sistemi normalize — duck aktif olmasa da güvenli
  push({ status: 'idle', error: null, volumeLevel: 0 });
  console.info('[Voice] Hard kill complete — all timers and AudioContext cleared');
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
