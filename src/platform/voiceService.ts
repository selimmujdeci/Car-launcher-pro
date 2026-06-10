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
import { askAI, resolveApiKey, type AIProvider, type AIVoiceResult, type VehicleContext } from './aiVoiceService';
import { classifySemantic, enrichBackground } from './ai/semanticAiService';
import { fromSemanticResult } from './intentEngine';
import { buildEnrichedCtx } from './voiceContextBuilder';
import { isInformationalCommand, answerInformational } from './voiceInfoService';

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
  push({ volumeLevel: 0 });
}

/**
 * Web dinleme animasyonu — SENTETİK dalga.
 *
 * KRİTİK: Web'de görselleştirme için ayrı bir getUserMedia mikrofon stream'i
 * AÇILMAZ. webkitSpeechRecognition kendi mikrofon erişimini ister; aynı anda
 * ikinci bir getUserMedia capture'ı tanımayı çekişmeye sokar ve Chrome tanımayı
 * anında 'aborted' ile sonlandırır (ses algılanmaz). Bu yüzden seviye göstergesi
 * yalnızca görsel amaçlı, mikrofonsuz sentetik bir dalga ile beslenir.
 */
function _startVolumeSimulation(): void {
  _stopVolumeSimulation();
  let t = 0;
  _volumeSimTimer = setInterval(() => {
    t += 1;
    const base   = 0.32 + 0.22 * Math.sin(t / 3);
    const jitter = 0.18 * Math.random();
    push({ volumeLevel: Math.max(0.06, Math.min(1, base + jitter)) });
  }, 120);
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

/* ── Processing failsafe ──────────────────────────────────────
 * 'processing' durumu için hiçbir yol terminal duruma geçmezse (beklenmedik
 * throw, yutulmuş rejection) durum makinesi asılı kalıyordu — sttFailsafe
 * yalnız 'listening'i kapsar. Bu bekçi: processing'e girişte kurulur,
 * processing'den çıkışta sökülür; süre dolarsa zorla idle. */
const PROCESSING_FAILSAFE_MS = 20_000;
let _processingFailsafeTimer: ReturnType<typeof setTimeout> | null = null;

function _clearProcessingFailsafe(): void {
  if (_processingFailsafeTimer !== null) {
    clearTimeout(_processingFailsafeTimer);
    _processingFailsafeTimer = null;
  }
}

function _armProcessingFailsafe(): void {
  _clearProcessingFailsafe();
  _processingFailsafeTimer = setTimeout(() => {
    _processingFailsafeTimer = null;
    if (_current.status === 'processing') {
      console.warn('[Voice] processing failsafe — forcing idle');
      push({ status: 'idle', error: null });
    }
  }, PROCESSING_FAILSAFE_MS);
}

// Asistan dinlerken müziği duraklatıp bittiğinde devam ettirmek için: yalnız BİZ
// duraklattıysak geri başlat (kullanıcının kendi duraklatmasını ezme).
let _assistantDuckedMusic = false;

/**
 * Asistan ducking: dinlemeye geçince müziği duraklat (çalıyorsa), asistan tamamen
 * bitince (idle'a dönünce) devam ettir. mediaService.play/pause uygulama-içi
 * oynatıcıyı (YouTube/stream/yerel) doğru yönlendirir. Lazy import → döngü yok.
 */
function _applyAssistantDuck(prev: VoiceStatus, next: VoiceStatus): void {
  if (next === 'listening' && prev === 'idle') {
    void import('./mediaService')
      .then(({ getMediaState, pause }) => {
        if (getMediaState().playing) { _assistantDuckedMusic = true; pause(); }
      })
      .catch(() => {});
    return;
  }
  if (next === 'idle' && prev !== 'idle' && _assistantDuckedMusic) {
    _assistantDuckedMusic = false;
    void import('./mediaService').then(({ play }) => play()).catch(() => {});
  }
}

/**
 * Ducking-resume'u iptal et. Kullanıcı asistana MEDYA komutu verdiğinde
 * (durdur/başlat/değiştir) çağrılır: komut oynatmayı zaten yönetir, asistan
 * idle'a dönünce müziği OTOMATİK geri başlatma (yoksa "durdur" eziliyordu).
 */
export function cancelAssistantDuck(): void {
  _assistantDuckedMusic = false;
}

function push(partial: Partial<VoiceState>): void {
  const prevStatus = _current.status;
  _current = { ..._current, ...partial };
  if (partial.status !== undefined && partial.status !== prevStatus) {
    _applyAssistantDuck(prevStatus, _current.status);
    if (_current.status === 'processing') _armProcessingFailsafe();
    else _clearProcessingFailsafe();
  }
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
  // Bilgi sorguları ("hava durumu nasıl", "hızım kaç") → statik feedback yerine
  // GERÇEK veriyle cevap ver. Aksi halde sadece "gösteriliyor" denir, cevap verilmez.
  if (isInformationalCommand(cmd.type)) {
    void answerInformational(cmd.type);
  } else {
    speakFeedback(cmd.feedback);
  }
  _commandHandlers.forEach((fn) => fn(cmd));
  const delays = getResetDelays();
  setTimeout(() => {
    try {
      if (_current.status === 'success') push({ status: 'idle' });
    } catch { /* ignore */ }
  }, delays[cmd.priority] ?? 2500);
}

function dispatchDriving(cmd: ParsedCommand): void {
  if (isInformationalCommand(cmd.type)) {
    void answerInformational(cmd.type);
  } else {
    speakFeedback(cmd.feedback);
  }
  pushHistory(cmd);
  _commandHandlers.forEach((fn) => fn(cmd));
}

/* ── Komut zincirleme ("müziği aç ve eve git") ─────────────────
 * Bağlaçla ayrılmış birden çok komutu tek söylemde çalıştırır. Yanlış pozitifi
 * önlemek için EN AZ 2 segment GÜVENLİ (≥0.7) komut olmalı; aksi halde zincir
 * sayılmaz ("Ahmet ve Mehmet'i ara", "ve" içeren yer adları normal işlenir). */
const CHAIN_SPLIT = /\s+(?:ve|sonra|ardindan|ardından|bir de|hem de|ayrica|ayrıca)\s+/i;

function dispatchChain(cmds: ParsedCommand[], ctx?: VehicleContext): void {
  // Tek birleşik TTS (üst üste konuşma olmasın), sonra her komutun aksiyonu.
  const combined = cmds.map((c) => c.feedback).filter(Boolean).join(', ');
  if (combined) speakFeedback(combined);
  for (const cmd of cmds) {
    pushHistory(cmd);
    _commandHandlers.forEach((fn) => fn(cmd));
  }
  if (!ctx?.isDriving) {
    push({
      status:      'success',
      lastCommand: cmds[cmds.length - 1],
      transcript:  cmds.map((c) => c.raw).join(' ve '),
      error:       null,
      suggestions: [],
    });
    setTimeout(() => { if (_current.status === 'success') push({ status: 'idle' }); }, 2500);
  }
}

/** Girişi zincir olarak işlemeyi dener; işlediyse true. */
function tryHandleChain(trimmed: string, ctx?: VehicleContext): boolean {
  if (!CHAIN_SPLIT.test(trimmed)) return false;
  const parts = trimmed.split(CHAIN_SPLIT).map((s) => s.trim()).filter((s) => s.length >= 2);
  if (parts.length < 2) return false;
  const cmds: ParsedCommand[] = [];
  for (const p of parts) {
    const c = parseCommandFull(p).command;
    if (c && c.confidence >= AUTO_DISPATCH_MIN) cmds.push(c);
  }
  if (cmds.length < 2) return false;   // ≥2 güvenli komut yoksa zincir değil
  _lastCommandTime = Date.now();
  dispatchChain(cmds, ctx);
  return true;
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

/* ── Düşük-güven onay durumu ──────────────────────────────────
 * Orta güvenli (BELİRSİZ) komutu körlemesine UYGULAMAK yerine "bunu mu istedin?"
 * diye sorar; bir sonraki giriş evet/hayır olarak yorumlanır. Böylece "bir şey
 * diyorum yanlış şey yapıyor" durumu azalır. Sürüş halinde (etkileşim minimumu,
 * ISO 15008) onay sorulmaz — doğrudan uygulanır. */
const AUTO_DISPATCH_MIN = 0.7;     // ≥ bu güven → onaysız uygula
const PENDING_TTL_MS    = 15_000;  // onay penceresi
const AFFIRM_RE = /^\s*(evet|tabii|tabi|olur|tamam|aynen|onayla|onayliyorum|onaylıyorum|he|hi hi|yap|elbette|kesinlikle|dogru|doğru)\b/i;
const NEGATE_RE = /^\s*(hayir|hayır|yok|iptal|vazgec|vazgeç|gerek yok|istemiyorum|olmaz|dur|bos ver|boş ver)\b/i;
let _pendingCmd: ParsedCommand | null = null;
let _pendingAt  = 0;

/* ── Processing ───────────────────────────────────────────── */

export async function processTextCommand(text: string, ctx?: VehicleContext): Promise<boolean> {
  const trimmed = text.trim();
  if (!trimmed) return false;

  // Bilişsel Pause: PROTECTION/CRITICAL modda AI işleme ve TTS atlanır.
  // SESSİZ return YOK: native akış bu çağrıdan önce 'processing' bastığı için
  // durum geçişsiz dönüş UI'yı "İşleniyor"da sonsuza dek asılı bırakıyordu.
  // Kullanıcıya görünür terminal durum + kısa açıklama verilir (TTS bilinçli
  // olarak yok — pause modunda TTS de atlanır).
  if (_voiceCogPaused) {
    push({
      status:      'error',
      error:       'Sürüş güvenliği nedeniyle sesli komut bekletildi',
      transcript:  trimmed,
      suggestions: [],
    });
    setTimeout(() => { if (_current.status === 'error') push({ status: 'idle', error: null }); }, 2500);
    return false;
  }

  const cfg = getConfig();
  const now = Date.now();

  // ── Bekleyen onay (belirsiz komut) varsa önce onu yorumla ──
  //   evet → uygula · hayır → iptal · başka bir şey → onayı bırak, normal işle.
  if (_pendingCmd) {
    if ((now - _pendingAt) < PENDING_TTL_MS) {
      if (AFFIRM_RE.test(trimmed)) {
        const cmd = _pendingCmd; _pendingCmd = null; _lastCommandTime = now;
        if (ctx?.isDriving) { dispatchDriving(cmd); } else { dispatch(cmd); }
        return true;
      }
      if (NEGATE_RE.test(trimmed)) {
        _pendingCmd = null;
        speakFeedback('Tamam, vazgeçtim.');
        push({ status: 'idle', error: null });
        return true;
      }
    }
    _pendingCmd = null; // süresi geçti ya da farklı bir şey söylendi → temizle, devam et
  }

  if (!cfg.enableRecommendations && (now - _lastCommandTime < 1500)) {
    const remaining = Math.ceil((1500 - (now - _lastCommandTime)) / 1000);
    push({ status: 'throttled', error: `Lütfen ${remaining}s bekleyin`, transcript: trimmed });
    setTimeout(() => push({ status: 'idle' }), 1200);
    return false;
  }

  // ── Komut zincirleme: "müziği aç ve eve git" → her ikisini de çalıştır ──
  if (tryHandleChain(trimmed, ctx)) return true;

  // ── API anahtarlarını al (AI fallback için gerekli) ─────────
  // Bozuk persist kaydı (JSON.parse throw) komut akışını öldürmesin: provider
  // 'none'a düşer, yerel parser çalışmaya devam eder (fail-soft, CLAUDE.md §2).
  let provider: AIProvider = 'none';
  try {
    const rawKey = localStorage.getItem('car-launcher-storage');
    const stored: unknown = rawKey ? JSON.parse(rawKey)?.state?.settings?.aiVoiceProvider : undefined;
    if (stored === 'gemini' || stored === 'haiku') provider = stored;
  } catch { /* bozuk JSON → AI katmanı yok sayılır */ }
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

  // Yüksek güven (≥0.7) → onaysız anında dispatch + arka plan proaktif log
  if (result.command && result.command.confidence >= AUTO_DISPATCH_MIN) {
    _lastCommandTime = now;
    if (ctx?.isDriving) { dispatchDriving(result.command); } else { dispatch(result.command); }
    // Proaktif bağlam — sonucu beklemiyoruz, UI etkilenmiyor
    if (result.needsSemantic && provider !== 'none' && apiKey && hasNet) {
      enrichBackground(trimmed, provider, apiKey, ctx);
    }
    return true;
  }

  // Orta güven (0.5–0.7) → BELİRSİZ. Eskiden bu band da körlemesine dispatch
  // ediliyordu (yanlış komutu sessizce uyguluyordu). Artık: sürüşte etkileşimi
  // en aza indirmek için doğrudan uygula; PARK halinde "bunu mu istedin?" diye sor.
  if (result.command && result.command.confidence >= 0.5) {
    if (ctx?.isDriving) {
      _lastCommandTime = now;
      dispatchDriving(result.command);
      return true;
    }
    _pendingCmd = result.command;
    _pendingAt  = now;
    const q = `Bunu mu demek istedin: ${result.command.feedback}? Evet ya da hayır de.`;
    speakFeedback(q);
    push({ status: 'error', transcript: trimmed, error: q, suggestions: result.suggestions });
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
  // HEAD UNIT GERÇEĞİ: internet sık sık yok/zayıf. AI YALNIZCA net varsa denenir; aksi halde
  // yanıltıcı "internet hatası" göstermek yerine aşağıdaki YEREL düşük-güven fallback'e düşülür
  // (offline komutlar çalışsın). Eskiden offline+provider → erken "İnternet bağlantısı yok"
  // dönüyor, yereldeki olası eşleşme hiç denenmiyordu → "mikrofon hep internet hatası veriyor".
  if (provider !== 'none' && apiKey && hasNet) {
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
  // İDEMPOTENT: zaten dinleniyorsa (veya native warmup uçuştaysa) hiçbir şey yapma.
  // KRİTİK: burada stopListening() ÇAĞIRMA. React mount efektleri (özellikle dev
  // StrictMode) startListening'i iki kez çağırır; toggle davranışı 2. çağrıda tanımayı
  // anında iptal ederdi ("mik açılır, hemen kapanır, algılama yok"). Durdurma işini
  // butonlar explicit stopListening() ile yapar.
  if (_current.status === 'listening' || _nativeSttWarmupTimer !== null) {
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
          const isPermission = /permission|denied|not.?allowed|izin/i.test(msg);
          // GERÇEK native sebebi HER ZAMAN göster (head unit teşhisi). Eskiden anahtar kelime
          // eşleşmezse yanıltıcı "internet/dil paketi gerekli" gösteriliyordu — üstelik native
          // reject argümanları ters olduğundan err.message hep "NO_RESULT" geliyor, gerçek sebep
          // gizleniyordu. Artık reject(mesaj,kod) düzeltildi + burada ham mesaj gösteriliyor.
          push({
            status: 'error',
            error: isPermission
              ? 'Mikrofon izni verilmemiş.'
              : (msg && msg.trim().length > 1 ? msg : 'Ses tanıma başlatılamadı'),
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
    _startVolumeSimulation();   // sentetik dalga — mikrofonu tanımaya bırak (çekişme yok)
    const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
    if (!SpeechRecognition) {
      _stopVolumeSimulation();
      push({ status: 'error', error: 'Tarayıcı ses tanımayı desteklemiyor.' });
      setTimeout(() => push({ status: 'idle' }), 3000);
      return;
    }

    _stopWebRecognition();
    _webRecognition = new SpeechRecognition();
    _webRecognition.lang = 'tr-TR';
    _webRecognition.interimResults = true;   // canlı (kısmi) sonuç — "dinliyor ama algılamıyor" teşhisi + hızlı geri bildirim
    _webRecognition.continuous = false;
    _webRecognition.maxAlternatives = 1;

    // ── Teşhis logları: hangi olayların tetiklendiğini görmek için ──
    _webRecognition.onstart       = () => console.warn('[Voice/web] onstart — tanıma başladı');
    _webRecognition.onaudiostart  = () => console.warn('[Voice/web] onaudiostart — mikrofon sesi alınıyor');
    _webRecognition.onspeechstart = () => console.warn('[Voice/web] onspeechstart — konuşma algılandı');
    _webRecognition.onspeechend   = () => console.warn('[Voice/web] onspeechend — konuşma bitti');
    _webRecognition.onnomatch     = () => console.warn('[Voice/web] onnomatch — eşleşme yok');

    _webRecognition.onresult = (event: any) => {
      // Tüm sonuçları tara: final varsa onu işle, yoksa kısmi metni canlı göster.
      let finalText = '';
      let interimText = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i];
        const txt = (res[0]?.transcript as string) ?? '';
        if (res.isFinal) finalText += txt; else interimText += txt;
      }
      const live = (finalText || interimText).trim();
      console.warn('[Voice/web] onresult — final:', JSON.stringify(finalText), 'interim:', JSON.stringify(interimText));

      if (finalText.trim()) {
        _stopVolumeSimulation();
        push({ status: 'processing', transcript: finalText.trim() });
        void processTextCommand(finalText.trim());
      } else if (live) {
        // Kısmi metin — kullanıcıya "seni duyuyorum" geri bildirimi (hâlâ dinlemede)
        push({ status: 'listening', transcript: live });
      }
    };

    _webRecognition.onerror = (event: any) => {
      console.error('Web Speech Error:', event.error);
      _stopVolumeSimulation();
      // 'aborted' → kullanıcı/uygulama durdurdu, sessizce idle (hata değil)
      if (event.error === 'aborted') {
        if (_current.status === 'listening') push({ status: 'idle' });
        return;
      }
      // Diğer her hata GÖRÜNÜR mesaj verir — "hiç tepki vermiyor" olmaz.
      const msg =
        event.error === 'not-allowed' || event.error === 'service-not-allowed'
          ? 'Mikrofon izni gerekli. Adres çubuğundaki kilit/mikrofon simgesinden izin ver.'
        : event.error === 'no-speech'
          ? 'Ses algılanamadı. Daha yüksek sesle konuşun.'
        : event.error === 'network'
          ? 'Ses tanıma için internet bağlantısı gerekli.'
          : 'Ses tanıma hatası.';
      push({ status: 'error', error: msg });
      setTimeout(() => { if (_current.status === 'error') push({ status: 'idle', error: null }); }, 3500);
    };

    _webRecognition.onend = () => {
      // Tanıma kendiliğinden bitti — sentetik dalgayı her zaman durdur.
      console.warn('[Voice/web] onend — tanıma bitti (status:', _current.status, ')');
      _stopVolumeSimulation();
      if (_current.status === 'listening') push({ status: 'idle' });
    };

    try {
      _webRecognition.start();
      console.warn('[Voice/web] start() çağrıldı — lang:', _webRecognition.lang);
    } catch (e) {
      console.error('[Voice/web] start() HATA:', e);
      _stopVolumeSimulation();
      push({ status: 'idle' });
    }
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

/* ── Test yardımcıları (yalnız vitest) ────────────────────── */

/** @internal — modül durumunu sıfırlar (testler arası izolasyon). */
export function _resetVoiceServiceForTest(): void {
  _clearProcessingFailsafe();
  _voiceCogPaused  = false;
  _pendingCmd      = null;
  _lastCommandTime = 0;
  _current = { ...INITIAL };
}

/** @internal — durum geçişini zorlar (processing failsafe testi). */
export function _setVoiceStatusForTest(status: VoiceStatus): void {
  push({ status });
}

/** @internal — anlık durum görüntüsü (hook'suz okuma, yalnız testler). */
export function _getVoiceStateForTest(): VoiceState {
  return _current;
}

export function useVoiceState(): VoiceState {
  const [state, setState] = useState<VoiceState>(_current);
  useEffect(() => {
    setState(_current);
    _stateListeners.add(setState);
    return () => { _stateListeners.delete(setState); };
  }, []);
  return state;
}
