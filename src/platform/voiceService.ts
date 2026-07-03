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
import { speakFeedback, speakAssistant, registerTtsEndListener, ttsCancel } from './ttsService';
import { duckMedia, unduckMedia } from './audioService';
import { resolveApiKey, type AIProvider, type AIVoiceResult, type VehicleContext } from './aiVoiceService';
import { isAiNetHealthy } from './aiHealth';
import { fromSemanticResult } from './intentEngine';
import { isInformationalCommand, answerInformational } from './voiceInfoService';
import { weatherQueryNamesCity } from './weatherService';
import { VOICE_TUNING } from './voiceTuning';
import { reportVoiceDiag } from './voiceDiagService';

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
  /**
   * Takip dinlemesi bekleniyor: asistan cevabı bitince mikrofon OTOMATİK yeniden
   * açılacak (sohbet modu). UI bu bayrak true iken pencereyi kapatmaz.
   */
  followUp:     boolean;
}

export type CommandHandler = (cmd: ParsedCommand) => void;
export type AIResultHandler = (result: AIVoiceResult, ctx?: VehicleContext) => void;

/* ── Module-level state ──────────────────────────────────── */

const MAX_HISTORY = 5;
/** n-best: STT'den istenen alternatif sayısı (beyin/parser doğru olanı seçer). */
const STT_MAX_ALTERNATIVES = 4;
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
  followUp:     false,
};

let _current: VoiceState = { ...INITIAL };
const _stateListeners  = new Set<(s: VoiceState) => void>();

/** Bilişsel Pause: true iken TTS ve AI işleme atlanır; dinleme (VAD) devam eder. */
let _voiceCogPaused = false;

export function setVoicePaused(paused: boolean): void {
  _voiceCogPaused = paused;
}

/**
 * PROTECTION/CRITICAL kilidi dışarıdan okunabilir (wake word kapısı):
 * pasif dinleme wake tetiklese bile sohbet/eğlence BAŞLAMAZ.
 */
export function isVoicePaused(): boolean {
  return _voiceCogPaused;
}

/** Anlık ses durumu görüntüsü (hook'suz) — wake döngüsü mikrofon çakışmasını önler. */
export function getVoiceSnapshot(): VoiceState {
  return _current;
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
      void reportVoiceDiag('voice_timeout', { errorCode: 'ERR_PROCESSING_FAILSAFE' });
      _endConvSession();
      push({ status: 'idle', error: null });
    }
  }, PROCESSING_FAILSAFE_MS);
}

/* ── Takip dinlemesi (sohbet modu) ────────────────────────────
 * Kullanıcı şikayeti: "cevap veriyor, tekrar konuşmak için mikrofona basmam
 * gerekiyor." Çözüm: SESLE başlayan oturumlarda asistan cevabı (TTS) bitince
 * mikrofon otomatik yeniden açılır. Döngü şu durumlarda biter:
 *   - kullanıcı sessiz kalır (boş transcript / no-speech)
 *   - kullanıcı pencereyi/mikrofonu kapatır (stopListening)
 *   - terminal hata ("anlaşılamadı" dahil)
 * Metin girişiyle (hızlı komut butonları) tetiklenen akışlar etkilenmez —
 * yalnız _convSession=true (STT'den transcript geldi) iken devreye girer. */

/** Aktif sesli sohbet oturumu var mı (transcript STT'den geldi). */
let _convSession = false;
/** Cevap TTS'i bitince yeniden dinleme kurulu mu. */
let _followUpArmed = false;
/** TTS hiç başlamazsa (SAFETY_LOCK, sessiz yollar) takip modu asılı kalmasın. */
let _followUpFallbackTimer: ReturnType<typeof setTimeout> | null = null;
const FOLLOWUP_FALLBACK_MS = 20_000;
/** Hoparlör kuyruğu boşalması için TTS bitişi → mikrofon arası tampon. */
const FOLLOWUP_RELISTEN_DELAY_MS = 350;

/* ── Takipsiz sohbet cevabı → TTS bitince idle ─────────────────
 * Eski davranış: _dispatchConversation sabit 3.5s setTimeout ile idle'a dönerdi.
 * Sorun: cevap 3.5s'den uzunsa UI hâlâ konuşurken 'idle'a düşüyor, kısaysa
 * konuşma bittikten sonra boş yere 'success'te bekliyordu — UI durumu gerçek
 * konuşma süresiyle SENKRON DEĞİLDİ. Artık idle YALNIZ TTS bitince (TTS-end
 * dinleyicisi) basılır. Emniyet: TTS bitiş eventi hiç gelmezse (SAFETY_LOCK ile
 * speakFeedback sessiz döner / bazı OEM TTS onDone'u atlar) 'success'te asılı
 * kalmasın diye fail-soft fallback (CLAUDE.md §2). */
let _convIdleOnTtsEnd = false;
let _convIdleFallbackTimer: ReturnType<typeof setTimeout> | null = null;
const CONV_IDLE_FALLBACK_MS = 15_000;

function _clearConvIdle(): void {
  _convIdleOnTtsEnd = false;
  if (_convIdleFallbackTimer !== null) {
    clearTimeout(_convIdleFallbackTimer);
    _convIdleFallbackTimer = null;
  }
}

function _armConvIdleOnTtsEnd(): void {
  _convIdleOnTtsEnd = true;
  if (_convIdleFallbackTimer !== null) clearTimeout(_convIdleFallbackTimer);
  _convIdleFallbackTimer = setTimeout(() => {
    _convIdleFallbackTimer = null;
    if (!_convIdleOnTtsEnd) return;
    _convIdleOnTtsEnd = false;
    if (_current.status === 'success') push({ status: 'idle' });
  }, CONV_IDLE_FALLBACK_MS);
}

function _disarmFollowUp(): void {
  _followUpArmed = false;
  if (_followUpFallbackTimer !== null) {
    clearTimeout(_followUpFallbackTimer);
    _followUpFallbackTimer = null;
  }
  if (_current.followUp) push({ followUp: false });
}

/** Sesli oturumu tamamen bitir (takip modu + oturum bayrağı). */
function _endConvSession(): void {
  _convSession = false;
  _disarmFollowUp();
  _clearConvIdle();
}

/**
 * Cevap seslendirilmeden HEMEN ÖNCE çağrılır: TTS bitişinde mikrofonun yeniden
 * açılacağını işaretler. Yalnız sesli oturumda (_convSession) etkilidir.
 */
function _armFollowUp(): void {
  if (!_convSession || _voiceCogPaused) return;
  _followUpArmed = true;
  if (_followUpFallbackTimer !== null) clearTimeout(_followUpFallbackTimer);
  // SAHA FİX 2026-06-12: TTS bitiş eventi hiç gelmezse (bazı head unit TTS
  // motorlarında onDone güvenilmez) eskiden SESSİZCE vazgeçiliyordu — kullanıcı
  // "cevaptan sonra dinlemiyor" yaşıyordu. Bu süre dolduğunda konuşma kesin
  // bitmiştir: vazgeçmek yerine mikrofonu best-effort AÇ (sohbet döngüsü kopmaz).
  _followUpFallbackTimer = setTimeout(() => {
    _followUpFallbackTimer = null;
    if (!_followUpArmed) return;
    _followUpArmed = false;
    if (!_convSession || _voiceCogPaused) { _disarmFollowUp(); return; }
    if (_current.status === 'listening' || _current.status === 'processing') return;
    startListening({ followUpWindow: true });
  }, FOLLOWUP_FALLBACK_MS);
  if (!_current.followUp) push({ followUp: true });
}

// TTS bitti → (A) kurulu takip varsa mikrofonu yeniden aç, yoksa
//             (B) takipsiz sohbet cevabıysa idle'a dön (sabit timer YOK).
registerTtsEndListener(() => {
  // (A) Takip dinlemesi (sürekli sohbet döngüsü) ────────────────
  if (_followUpArmed) {
    // AI hâlâ işliyor/dinleme zaten açık → bu bitiş ara feedback'ti, kurulu kal.
    if (_current.status === 'processing' || _current.status === 'listening') return;
    _followUpArmed = false;
    if (_followUpFallbackTimer !== null) {
      clearTimeout(_followUpFallbackTimer);
      _followUpFallbackTimer = null;
    }
    setTimeout(() => {
      if (!_convSession || _voiceCogPaused) { _disarmFollowUp(); return; }
      if (_current.status === 'listening' || _current.status === 'processing') return;
      startListening({ followUpWindow: true }); // kısa pencere — wake word gerekmez
    }, FOLLOWUP_RELISTEN_DELAY_MS);
    return;
  }
  // (B) Takipsiz sohbet cevabı → konuşma bitti, idle'a dön. UI 'success'
  //     barı GERÇEK konuşma süresince görünür kaldı (3.5s sabit timer kaldırıldı).
  if (_convIdleOnTtsEnd) {
    _clearConvIdle();
    if (_current.status === 'success') push({ status: 'idle' });
  }
});

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
    // Sohbet devam edecek (takip dinlemesi kurulu) → müziği turlar arasında
    // aç-kapa yapma; oturum tamamen bitince geri başlat.
    if (_followUpArmed || _current.followUp) return;
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
  void reportVoiceDiag('voice_intent', { intent: cmd.type });
  push({
    status:      'success',
    lastCommand: cmd,
    transcript:  cmd.raw,
    error:       null,
    suggestions: [],
  });
  pushHistory(cmd);
  // ARAÇ KOMUTU = sohbet döngüsü BİTER (takip dinlemesi yalnız companion
  // sohbet modunda — komut sonrası mikrofonun kendiliğinden açılması istenmez).
  _endConvSession();
  // Bilgi sorguları ("hava durumu nasıl", "hızım kaç") → statik feedback yerine
  // GERÇEK veriyle cevap ver. Aksi halde sadece "gösteriliyor" denir, cevap verilmez.
  if (isInformationalCommand(cmd.type)) {
    void answerInformational(cmd.type);
  } else {
    speakFeedback(cmd.feedback);
  }
  _commandHandlers.forEach((fn) => fn(cmd));
  void reportVoiceDiag('voice_success', { intent: cmd.type });
  const delays = getResetDelays();
  setTimeout(() => {
    try {
      if (_current.status === 'success') push({ status: 'idle' });
    } catch { /* ignore */ }
  }, delays[cmd.priority] ?? 2500);
}

function dispatchDriving(cmd: ParsedCommand): void {
  void reportVoiceDiag('voice_intent', { intent: cmd.type });
  _endConvSession(); // araç komutu → sohbet döngüsü biter (yalnız companion sohbeti sürer)
  if (isInformationalCommand(cmd.type)) {
    void answerInformational(cmd.type);
  } else {
    speakFeedback(cmd.feedback);
  }
  pushHistory(cmd);
  _commandHandlers.forEach((fn) => fn(cmd));
  void reportVoiceDiag('voice_success', { intent: cmd.type });
}

/* ── Komut zincirleme ("müziği aç ve eve git") ─────────────────
 * Bağlaçla ayrılmış birden çok komutu tek söylemde çalıştırır. Yanlış pozitifi
 * önlemek için EN AZ 2 segment GÜVENLİ (≥0.7) komut olmalı; aksi halde zincir
 * sayılmaz ("Ahmet ve Mehmet'i ara", "ve" içeren yer adları normal işlenir). */
const CHAIN_SPLIT = /\s+(?:ve|sonra|ardindan|ardından|bir de|hem de|ayrica|ayrıca)\s+/i;

function dispatchChain(cmds: ParsedCommand[], ctx?: VehicleContext): void {
  // Tek birleşik TTS (üst üste konuşma olmasın), sonra her komutun aksiyonu.
  _endConvSession(); // komut zinciri = araç komutu → takip dinlemesi yok
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

/**
 * Sohbet yanıtı — komut dispatch yok, sadece TTS + UI güncelleme.
 * `armFollowUp=true` YALNIZ companion (Yol Arkadaşım) sohbet modunda verilir:
 * cevap bitince mikrofon otomatik yeniden açılır (sürekli sohbet döngüsü).
 * Companion kapalıyken (offline_chat) eski davranış korunur — döngü yok.
 */
function _dispatchConversation(response: string, raw: string, armFollowUp: boolean): void {
  // armFollowUp=true  → cevap bitince mikrofon yeniden açılır (sürekli sohbet).
  // armFollowUp=false → cevap bitince idle (TTS-end dinleyicisi). Sabit 3.5s timer
  //                     KALDIRILDI: UI durumu gerçek konuşma süresiyle senkron.
  if (armFollowUp) _armFollowUp();
  else             _endConvSession();
  // followUp GERÇEKTEN kurulamadıysa (pause yarışı / oturum yok / takipsiz) idle'ı
  // TTS bitişine bağla — aksi halde re-listen yolu idle'ı devralır. Böylece durum
  // hiçbir koşulda 'success'te asılı kalmaz (eski 3.5s timer'ın emniyet rolü).
  if (!_followUpArmed) _armConvIdleOnTtsEnd();
  // Sohbet/serbest cevap: klip → online TTS → native (motorsuz ünitede de sesli)
  speakAssistant(response);
  push({ status: 'success', transcript: raw, error: null, suggestions: [], lastCommand: null });
}

/* ── Sohbet kapatma sözleri (sürekli sohbet döngüsünden çıkış) ──
 * Takip dinlemesi penceresinde kullanıcı "tamam / sus / kapat / sonra
 * konuşuruz" derse döngü SESSİZCE kapanır — tekrar tekrar konuşma yok.
 * Yalnız TAM söylem eşleşir ("müziği kapat" gibi nesneli komutlar parser'da
 * kalır; bu regex onları yakalamaz). Normalize: TR aksanları sadeleştirilir. */
const CONV_END_RE = new RegExp(
  '^(tamam(dir)?|sus|sustur|kapat|kapan|yeter|sonra konusuruz|gorusuruz|hosca kal|gule gule)$',
);

function _isConversationEnd(raw: string): boolean {
  const n = raw.toLowerCase()
    .replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ü/g, 'u')
    .replace(/ç/g, 'c').replace(/ş/g, 's').replace(/ğ/g, 'g')
    .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  return CONV_END_RE.test(n);
}

/* ── Ara TTS geri bildirimleri ────────────────────────────────── */

/** Gemini cevabı bu süreyi aşarsa kısa ara geri bildirim seslendirilir.
 *  SAHA FİX 2026-06-12: 800 → 1500 ms. Erken ara mesaj "önce bir şey söylüyor
 *  sonra cevap veriyor" şikayeti yaratıyordu — hızlı cevaplar artık doğrudan gelir. */
const THINKING_FEEDBACK_DELAY_MS = 1_500;

// SAHA FİX 2026-06-12: "Anlıyorum..." / "Tabii, bakayım..." LİSTEDEN ÇIKTI —
// anlama İMA eden ara mesajdan sonra zincir başarısız olunca kullanıcı
// "anladım diyor sonra anlayamadım diyor" yaşıyordu. Yalnız NÖTR ifadeler kaldı.
const THINKING_PHRASES = [
  'Bakıyorum hemen...',
  'Bir saniye...',
  'Kontrol ediyorum...',
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

/* ── Single Brain: kritik refleks komutları ──────────────────
 * YALNIZ bu komut tipleri (ses aç/kıs, duraklat/dur) ve YALNIZ tam güvende
 * (1.0) Gemini'yi beklemeden yerelde anında çalışır. Diğer her girdi — 1.0
 * olsa bile — önce TEK birleşik beyne (Gemini) gider. Refleks komutlarının
 * 2.5sn ağ beklemesi UX'i bozardı; bu yüzden istisna. */
const CRITICAL_VOICE_TYPES = new Set<ParsedCommand['type']>([
  'volume_up', 'volume_down', 'stop_music',
  // WiFi/Bluetooth DOĞRUDAN donanım toggle'ı — refleks komut. Gemini'nin
  // semantik sözlüğünde bu intent YOK; online'ken beyne giderse en yakın
  // "OPEN_SETTINGS"e düşüp UYGULAMA AYARLARINI açıyordu (bug). Tam-güven
  // (1.0) yerel eşleşmede beyni atla → setWifi/setBluetooth anında çalışsın.
  'toggle_wifi', 'toggle_bluetooth',
]);

/* ── API ANAHTARI YOK yönlendirmesi ──────────────────────────────
 * Anahtar YOKKEN yalnız AI/internet gerektiren bir istek gelirse (haber, döviz,
 * hava, fıkra, bilmece, "X kimdir/nedir"...) kullanıcı sessiz "anlaşılamadı"
 * yerine ayarlardan anahtar eklemesi için yönlendirilir. Yerel komutlar (harita
 * aç, ses kıs...) anahtarsız çalıştığından bu tetiklenmez. ASR çöpünde yanlış
 * pozitif olmasın diye hedefli anahtar-kelime sezgisi kullanılır. */
const _AI_HINT_TOKENS: readonly string[] = [
  'haber', 'gundem', 'son dakika', 'manset',
  'dolar', 'euro', 'sterlin', 'altin', 'borsa', 'doviz', 'kur', 'bitcoin',
  'kac para', 'kac lira', 'kac tl',
  'mac', 'skor', 'puan durumu', 'fikstur', 'kim kazandi',
  'fikra', 'saka', 'bilmece', 'siir', 'hikaye anlat',
  'kimdir', 'nedir', 'ne demek', 'anlami ne', 'ozetle', 'acikla', 'arastir',
];

function _normForHint(s: string): string {
  return s.toLowerCase()
    .replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ü/g, 'u')
    .replace(/ç/g, 'c').replace(/ş/g, 's').replace(/ğ/g, 'g')
    .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** AI/internet gerektiren bir istek mi? (anahtarsız yönlendirme için sezgi) */
function _looksLikeAiRequest(raw: string): boolean {
  const n = _normForHint(raw);
  if (n.split(' ').filter((w) => w.length > 1).length < 2) return false; // tek kelime/çöp değil
  return _AI_HINT_TOKENS.some((t) => n.includes(t));
}

/** Yönlendirme tekrarını engelleyen soğuma (kullanıcıyı her cümlede dürtme). */
const _AI_KEY_HINT_COOLDOWN_MS = 120_000;
let _aiKeyHintAt = 0;

/* Gemini-first karar penceresi: beyin bu süre içinde ACTION/CHAT kararı
 * veremezse (yavaş ağ/timeout) yerel graceful-fallback zincirine düşülür.
 * (companionChatProvider askCompanionBrain'e timeoutMs olarak iletilir.)
 * Bağlama duyarlı bütçe: sürüşte gecikme/dikkat dağıtma riski yüksek → kısa
 * tutulur; PARK halinde acele yok, yavaş head-unit ağında (2.5sn) erken kesip
 * sahte fallback'e düşmek yerine 4sn'ye kadar beyni bekleriz (daha derin/doğru
 * yanıt > hız kazancı). */
// SAHA 2026-07-04: gemini-flash-latest (→gemini-3.5-flash) DERİN SOĞUK BAŞLANGIÇTA
// ~7sn dönüyor (sıcakta ~1sn). Eski 2.5/4sn bütçe soğuk başlangıcı kesip null→REASK
// ("of orayı kaçırdım") üretiyordu — kullanıcı aralıklı konuşunca HER SEFERİNDE.
// Bütçeler soğuk başlangıcı da yakalayacak şekilde yükseltildi; asıl çözüm
// _warmupBrain (mikrofon açılınca ısıtma) → gerçek komut sıcak gelir.
const BRAIN_TIMEOUT_DRIVING_MS = 4_500;
const BRAIN_TIMEOUT_PARKED_MS  = 8_000;
const AFFIRM_RE = /^\s*(evet|tabii|tabi|olur|tamam|aynen|onayla|onayliyorum|onaylıyorum|he|hi hi|yap|elbette|kesinlikle|dogru|doğru)\b/i;
const NEGATE_RE = /^\s*(hayir|hayır|yok|iptal|vazgec|vazgeç|gerek yok|istemiyorum|olmaz|dur|bos ver|boş ver)\b/i;
let _pendingCmd: ParsedCommand | null = null;
let _pendingAt  = 0;

/* ── AI anahtar çözümü (tembel — yalnız AI yolları çağırır) ──
 * Bozuk persist kaydı (JSON.parse throw) komut akışını öldürmesin: provider
 * 'none'a düşer, yerel parser çalışmaya devam eder (fail-soft, CLAUDE.md §2). */
async function _resolveAiKeys(): Promise<{
  provider: AIProvider; apiKey: string; hasNet: boolean; tavilyKey: string;
  /**
   * Gemini = ARAMA MOTORU anahtarı. Sohbet zincirinde olsun olmasın, web/güncel
   * bilgi sorgularının grounding'i (google_search) HER ZAMAN bu anahtarla yapılır.
   * Groq/Haiku tek başına internete bakamaz → web kararlarını Gemini'ye devreder.
   * Boşsa (Gemini anahtarı yok) canlı arama yapılamaz (hava yine yerelden gelir).
   */
  searchKey: string;
  /**
   * SOHBET BEYNİ ZİNCİRİ — SIRA SABİT: Gemini → Groq → Haiku (yalnız anahtarı
   * GİRİLMİŞ sağlayıcılar). Gemini birincil çünkü hem güvenilir sohbet/komut
   * kararı hem YERLEŞİK google_search araması onda; Groq/Haiku, Gemini 429/hata
   * olunca otomatik yedek. ("Groq birincil, Gemini yalnız arama" denemesi saha
   * geri bildirimiyle geri alındı — Groq web/komut kararında yeterince güvenilir
   * değildi.)
   */
  chain: ReadonlyArray<{ provider: 'gemini' | 'groq' | 'haiku'; apiKey: string }>;
}> {
  // GÜVENLİK: localStorage'dan SADECE hassas-olmayan provider SEÇİMİ okunur
  // (gemini|haiku enum'u). API ANAHTARLARI burada DEĞİL — aşağıda
  // sensitiveKeyStore (Android Keystore / AES-256-GCM) üzerinden çözülür; anahtar
  // hiçbir zaman düz metin localStorage'da tutulmaz.
  let provider: AIProvider = 'none';
  try {
    const rawKey = localStorage.getItem('car-launcher-storage');
    const stored: unknown = rawKey ? JSON.parse(rawKey)?.state?.settings?.aiVoiceProvider : undefined;
    if (stored === 'gemini' || stored === 'haiku' || stored === 'groq') provider = stored;
  } catch { /* bozuk JSON → AI katmanı yok sayılır */ }
  let apiKey = '';
  let tavilyKey = '';
  let searchKey = '';
  const chain: { provider: 'gemini' | 'groq' | 'haiku'; apiKey: string }[] = [];
  try {
    const { sensitiveKeyStore: sks } = await import('./sensitiveKeyStore');
    const [geminiKey, haikuKey, groqKey, tavily] = await Promise.all([
      sks.get('geminiApiKey'),
      sks.get('claudeHaikuApiKey'),
      sks.get('groqApiKey'),
      sks.get('tavilyApiKey'),
    ]);
    apiKey = resolveApiKey(
      provider,
      provider === 'gemini' ? geminiKey : provider === 'haiku' ? haikuKey : groqKey,
    );
    tavilyKey = (tavily ?? '').trim();
    const resolvedGemini = resolveApiKey('gemini', geminiKey);
    const resolvedGroq   = resolveApiKey('groq', groqKey);
    const resolvedHaiku  = resolveApiKey('haiku', haikuKey);
    // Gemini = arama motoru anahtarı (Groq/Haiku yedekteyken web kararını buna devreder).
    searchKey = resolvedGemini;
    // ZİNCİR SIRA SABİT: Gemini → Groq → Haiku (yalnız girilmiş anahtarlar).
    // SAHA 2026-07-03: "Groq birincil, Gemini yalnız arama" denemesi GERİ ALINDI —
    // Groq (Llama) type:"web" kararını Gemini kadar güvenilir üretmiyordu → haber/
    // altın/döviz araması tetiklenmiyor + JSON komut kararı zayıf ("anladım ama iş
    // yapmadı"). Gemini birincil: hem güvenilir sohbet/komut hem YERLEŞİK google_search.
    // Groq/Haiku Gemini 429/hata olunca otomatik yedek (asistan aptallaşmaz).
    if (resolvedGemini) chain.push({ provider: 'gemini', apiKey: resolvedGemini });
    if (resolvedGroq)   chain.push({ provider: 'groq',   apiKey: resolvedGroq });
    if (resolvedHaiku)  chain.push({ provider: 'haiku',  apiKey: resolvedHaiku });
  } catch { /* anahtar deposu hatası → AI'sız devam (fail-soft) */ }
  // Devre kesici (aiHealth): art arda Gemini ağ hatası/timeout sonrası soğuma
  // penceresinde hasNet=false döner → TÜM AI yolları atlanır, yerel zincir anında
  // cevap verir. Yavaş hotspot'ta her cümlenin 3 ardışık timeout (6+5+3 sn)
  // beklemesi ve sürekli "İnternet yavaş..." duyulması böyle kesilir.
  const hasNet = typeof navigator !== 'undefined' && navigator.onLine && isAiNetHealthy();
  return { provider, apiKey, hasNet, tavilyKey, searchKey, chain };
}

/* ── Beyin ısıtma (soğuk-başlangıç cezasını gizler) ───────────
 * Mikrofon açılınca Gemini modelini fire-and-forget ısıtır → kullanıcı komutunu
 * bitirene kadar model sıcak olur, gerçek beyin çağrısı ~7sn soğuk yerine ~1sn'de
 * döner (timeout aşmaz → REASK olmaz). Throttle: art arda açılışlarda kotayı ve
 * ağı yormamak için 45sn'de bir. hasNet/anahtar yoksa sessizce atlar. */
let _lastWarmupAt = 0;
const WARMUP_COOLDOWN_MS = 45_000;

async function _warmupBrain(): Promise<void> {
  const now = Date.now();
  if (now - _lastWarmupAt < WARMUP_COOLDOWN_MS) return;
  _lastWarmupAt = now;
  try {
    const { chain, hasNet } = await _resolveAiKeys();
    if (!hasNet || chain.length === 0) return;
    const gem = chain.find((c) => c.provider === 'gemini');
    if (!gem) return; // yalnız Gemini soğuk-başlangıç yaşıyor; Groq/Haiku ısıtma gerekmez
    const { warmupGemini } = await import('./companion/companionChatProvider');
    await warmupGemini(gem.apiKey);
  } catch { /* ısıtma best-effort — komut akışını asla etkilemez */ }
}

/* ── ASR müzik sorgu onarımı ─────────────────────────────────
 * Yerel parser müzik komutunu yakalar ama İSİM Vosk'ta bozulmuş olabilir
 * ("leyla türk" ← "Leyla Göktürk"). Online + Gemini varsa sorgu hızlı bir
 * onarım çağrısından geçer (≤1.8s); başarısız/zaman aşımında ham sorgu
 * AYNEN kullanılır — komut asla bloklanmaz (fail-soft). */
async function _maybeRepairMusicQuery(cmd: ParsedCommand): Promise<void> {
  try {
    const extra = cmd.extra as Record<string, string> | undefined;
    const q = extra?.query;
    if (!q || q.trim().length < 3) return;
    const { provider, apiKey, hasNet } = await _resolveAiKeys();
    if (provider !== 'gemini' || !apiKey || !hasNet) return;
    const { repairMusicQuery } = await import('./companion/companionChatProvider');
    const fixed = await repairMusicQuery(q, apiKey);
    if (!fixed) return;
    extra.query = fixed;
    if (extra.searchUri) {
      extra.searchUri = extra.searchUri.replace(encodeURIComponent(q), encodeURIComponent(fixed));
    }
    cmd.feedback = cmd.feedback.includes(q) ? cmd.feedback.replace(q, fixed) : `"${fixed}" aranıyor`;
    void reportVoiceDiag('voice_route', { route: 'music_query_repaired' });
  } catch { /* onarım hatası komutu etkilemez */ }
}

/* ── Processing ───────────────────────────────────────────── */

/* ── n-best yardımcıları ───────────────────────────────────────
 * STT tek "en iyi tahmin"de sık yanılıyor (Vosk küçük TR modeli). Alternatifleri
 * (a) yerel parser'da dener, en yüksek güvenli komutu seçer; (b) beyne verir,
 * beyin bağlamla doğru yorumu seçer. Tek alternatif/eski native → eski davranış. */

/** @internal — n-best: alternatif listesini temizler: top ilk, tekrarsız, max N. */
export function _dedupeAlts(alternatives: string[] | undefined, top: string): string[] {
  const out: string[] = [];
  const add = (s: string): void => {
    const t = s.trim();
    if (t && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
  };
  add(top);
  if (alternatives) for (const a of alternatives) add(a);
  return out.slice(0, STT_MAX_ALTERNATIVES);
}

/** @internal — n-best: en yüksek güvenli komutu üreten parse'ı seçer (eşitte top). */
export function _bestLocalParse(alts: string[]): ReturnType<typeof parseCommandFull> {
  let best = parseCommandFull(alts[0]);
  let bestConf = best.command?.confidence ?? 0;
  for (let i = 1; i < alts.length; i++) {
    const r = parseCommandFull(alts[i]);
    const c = r.command?.confidence ?? 0;
    if (c > bestConf) { best = r; bestConf = c; }
  }
  return best;
}

export async function processTextCommand(
  text: string,
  ctx?: VehicleContext,
  alternatives?: string[],
): Promise<boolean> {
  const trimmed = text.trim();
  if (!trimmed) return false;
  // n-best alternatifleri (top ilk). Metin girişinde (buton) tek eleman kalır.
  const alts = _dedupeAlts(alternatives, trimmed);

  void reportVoiceDiag('voice_processing', { transcriptLength: trimmed.length });

  // Bilişsel Pause: PROTECTION/CRITICAL modda AI işleme ve TTS atlanır.
  // SESSİZ return YOK: native akış bu çağrıdan önce 'processing' bastığı için
  // durum geçişsiz dönüş UI'yı "İşleniyor"da sonsuza dek asılı bırakıyordu.
  // Kullanıcıya görünür terminal durum + kısa açıklama verilir (TTS bilinçli
  // olarak yok — pause modunda TTS de atlanır).
  if (_voiceCogPaused) {
    void reportVoiceDiag('voice_cognitive_pause', { transcriptLength: trimmed.length });
    _endConvSession();
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
        _endConvSession(); // onay diyaloğu bitti — komut akışı sohbet döngüsü başlatmaz
        speakFeedback('Tamam, vazgeçtim.');
        push({ status: 'idle', error: null });
        return true;
      }
    }
    _pendingCmd = null; // süresi geçti ya da farklı bir şey söylendi → temizle, devam et
  }

  // ── Sohbet kapatma sözleri ("tamam", "sus", "kapat", "sonra konuşuruz") ──
  // Yalnız sesli oturumda (takip dinleme döngüsü) geçerli: döngü SESSİZCE
  // kapanır, TTS yok (timeout/kapatmada tekrar tekrar konuşma istenmiyor).
  if (_convSession && _isConversationEnd(trimmed)) {
    _lastCommandTime = now;
    void reportVoiceDiag('voice_route', { route: 'conversation_end' });
    _endConvSession();
    push({ status: 'idle', error: null, transcript: trimmed, suggestions: [] });
    return true;
  }

  if (!cfg.enableRecommendations && (now - _lastCommandTime < 1500)) {
    const remaining = Math.ceil((1500 - (now - _lastCommandTime)) / 1000);
    push({ status: 'throttled', error: `Lütfen ${remaining}s bekleyin`, transcript: trimmed });
    setTimeout(() => push({ status: 'idle' }), 1200);
    return false;
  }

  // ── Komut zincirleme: "müziği aç ve eve git" → her ikisini de çalıştır ──
  if (tryHandleChain(trimmed, ctx)) return true;

  /* Siri mantığı (2026-06-11): yerel parser yalnız NET komutlar için hız
   * katmanıdır; tanıyamadığı HER cümlede tek yetkili birleşik beyindir
   * (tryCompanionBrain — komut/sohbet kararını Gemini verir, bozuk ASR
   * isimlerini düzeltir). Yerel müzik sorguları bile online'ken isim
   * onarımından geçer (aşağıda _maybeRepairMusicQuery). */

  // ── Yerel parser ────────────────────────────────────────────
  // GECİKME KRİTİĞİ: API anahtarları (2 şifreli native okuma) ARTIK burada
  // BEKLENMEZ. Eskiden her komut — "müziği aç" dahil — anahtar deposu
  // gidiş-dönüşünü bekliyordu; düşük donanımda yüzlerce ms gecikme demekti.
  // Anahtarlar yalnız AI gerektiren yollarda (_resolveAiKeys) tembel çözülür.
  // n-best: alternatifler içinde en yüksek güvenli komutu seç (STT top'u yanlışsa
  // alt sıradaki doğru komut yakalanır; tek alternatifte davranış birebir aynı).
  const result = _bestLocalParse(alts);

  // ── 1. ANINDA BYPASS (Single Brain istisnası) ────────────────
  // YALNIZ kritik refleks komutları (ses aç/kıs, duraklat/dur, wifi/bluetooth
  // toggle) ve YALNIZ tam güvende (1.0) Gemini'yi beklemeden yerelde çalışır.
  // Diğer HER girdi — 1.0 olsa bile — aşağıda önce birleşik beyne (Gemini) gider.
  // WiFi/Bluetooth ayrıca set_setting tipiyle de gelebilir (matchVoiceSetting
  // ön-kontrolü); o yol da donanım refleksi → bypass'a dahil (yoksa ONLINE'ken
  // Gemini OPEN_SETTINGS'e düşürüp uygulama ayarlarını açıyordu).
  const _cmdKey = result.command?.extra?.settingKey;
  const _isHwToggleSetting =
    result.command?.type === 'set_setting' && (_cmdKey === 'wifi' || _cmdKey === 'bluetooth');
  if (
    result.command &&
    result.command.confidence >= 1.0 &&
    (CRITICAL_VOICE_TYPES.has(result.command.type) || _isHwToggleSetting)
  ) {
    _lastCommandTime = now;
    void reportVoiceDiag('voice_route', { route: 'critical_bypass' });
    if (ctx?.isDriving) { dispatchDriving(result.command); } else { dispatch(result.command); }
    return true;
  }

  // ── 1b. HAVA DURUMU BYPASS — yerel hava servisi kotasız/anında cevaplar ──
  // "hava durumu nasıl" gibi net (≥0.7) yerel eşleşmeler beyne (Gemini/Groq/
  // Haiku) HİÇ GİTMEZ: hava zaten yerelde gerçek veriyle cevaplanıyor
  // (dispatch/dispatchDriving → answerInformational → weatherService). Groq gibi
  // grounding'i olmayan sağlayıcılar "canlı bilgilere bakamıyorum" diyip
  // kullanıcıyı yanıltıyordu (saha 2026-07-03) — bu bypass hem o sorunu çözer
  // hem de Gemini kotasını gereksiz yere harcamaz.
  if (
    result.command &&
    result.command.type === 'show_weather' &&
    result.command.confidence >= 0.7 &&
    // BELİRLİ BİR ŞEHİR adı geçiyorsa yerel kestirmeyi ATLA — beyne git → web araması
    // o şehrin havasını getirsin. Aksi halde "İstanbul hava durumu" bulunduğun yerin
    // (Tarsus) havasını veriyordu (SAHA 2026-07-04).
    !weatherQueryNamesCity(trimmed)
  ) {
    _lastCommandTime = now;
    void reportVoiceDiag('voice_route', { route: 'weather_local_bypass' });
    if (ctx?.isDriving) { dispatchDriving(result.command); } else { dispatch(result.command); }
    return true;
  }

  // ── API anahtarları + ağ sağlığı (devre kesici dahil) ────────
  const { provider, apiKey, hasNet, tavilyKey, searchKey, chain } = await _resolveAiKeys();

  // Online beyin (companionChatProvider) hibrit zinciri destekler: Gemini →
  // Groq → Haiku (yalnız anahtarı girilmiş sağlayıcılar zincire girer).
  // Eskiden bu gate sadece 'gemini' idi → Groq/Haiku seçildiğinde komutlar
  // online beyne hiç ulaşmayıp OFFLINE asistana düşüyordu (#saha fix
  // 2026-06-21). Zincir boşsa tryCompanionBrain zaten null döner → güvenle
  // offline zincire iner.
  const aiUsable = chain.length > 0 && hasNet;

  // ── 1c. ANAHTAR YOK + AÇIK AI/İNTERNET İSTEĞİ → ayarlardan anahtar ekle ──
  // Anahtar yokken haber/döviz/fıkra/bilmece/"X kimdir" gibi YALNIZ yapay zekayla
  // yanıtlanabilen istekler gelir. Yerel parser bunlara sahte düşük-güven komut
  // üretebildiğinden (ör. "haberleri özetle"→vehicle_status@0.82) auto-dispatch'ten
  // ÖNCE yakalanır; aksi halde kullanıcı yanlış komut görür. Exact (1.0) gerçek
  // komutlar korunur (AI-token içermezler zaten); zincirde EN AZ bir anahtar
  // VARSA bu blok atlanır (o yol beyne/offline'a gider). Soğuma: TTS ile her
  // cümlede dürtmeyiz.
  if (chain.length === 0 && _looksLikeAiRequest(trimmed) && (result.command?.confidence ?? 0) < 1.0) {
    _lastCommandTime = now;
    _endConvSession();
    const within = now - _aiKeyHintAt <= _AI_KEY_HINT_COOLDOWN_MS;
    void reportVoiceDiag('voice_route', { route: 'ai_key_missing_hint' });
    if (within) {
      // Yakında zaten söylendi → sessizce yalnız ekran notu (yanlış komut da çalışmaz).
      push({ status: 'error', transcript: trimmed, error: 'Yapay zeka anahtarı gerekli — ayarlardan ekle.', suggestions: [] });
      setTimeout(() => { if (_current.status === 'error') push({ status: 'idle', error: null }); }, 3000);
      return true;
    }
    _aiKeyHintAt = now;
    const hint = ctx?.isDriving
      ? 'Bunun için yapay zeka anahtarı gerekiyor. Varınca ayarlardan ekleyebilirsin.'
      : 'Bunun için bir yapay zeka anahtarı gerekiyor. Ayarlardan Gemini ya da Claude Haiku için bir API anahtarı ekleyebilirsin, sonra haber ve güncel bilgileri sorabilirsin.';
    speakFeedback(hint);
    push({ status: 'error', transcript: trimmed, error: hint, suggestions: [] });
    setTimeout(() => { if (_current.status === 'error') push({ status: 'idle', error: null }); }, 4000);
    return true;
  }

  // ── 2. GEMINI FIRST (Single Brain) ───────────────────────────
  // Online + Gemini varsa kritik-bypass DIŞINDAKİ HER girdi önce TEK birleşik
  // beyne gider. Beyin tek kararı verir: ACTION (araç komutu) ya da CHAT
  // (sohbet). Karar ≤2.5sn'de gelmezse/başarısızsa aşağıdaki yerel graceful
  // fallback zincirine düşülür. "No Dual Response": beyin cevap verdiyse
  // yerel parser/semantic bir daha KONUŞMAZ. Offline'da bu blok atlanır,
  // doğrudan yerel zincir çalışır.
  let _thinkingTimer: ReturnType<typeof setTimeout> | null = null;
  if (aiUsable) try {
    const { tryCompanionBrain } = await import('./companion/companionChatProvider');
    // TEK spinner: cevap THINKING_FEEDBACK_DELAY_MS'yi aşarsa kısa NÖTR ara söz
    // ("Bir saniye..."). Hızlı cevapta timer iptal; geç ara sözü cevap TTS'i keser.
    _thinkingTimer = setTimeout(() => { _thinkingTimer = null; _speakThinking(); }, THINKING_FEEDBACK_DELAY_MS);
    const brain = await tryCompanionBrain(trimmed, {
      isDriving: ctx?.isDriving,
      speedKmh:  ctx?.speedKmh,
      provider,
      apiKey,
      hasNet,
      tavilyKey,
      searchKey,
      chain,
      // n-best: STT belirsizse beyin doğru yorumu bu alternatiflerden seçer.
      alternatives: alts.length > 1 ? alts : undefined,
      timeoutMs: ctx?.isDriving ? BRAIN_TIMEOUT_DRIVING_MS : BRAIN_TIMEOUT_PARKED_MS,
    });
    if (brain) {
      _lastCommandTime = now;
      if (brain.kind === 'chat') {
        void reportVoiceDiag('voice_route', { route: brain.route, provider });
        // Sürekli sohbet döngüsü YALNIZ companion sohbet cevabında kurulur.
        _dispatchConversation(brain.response, trimmed, true);
        return true;
      }
      // ACTION — beyin komuta karar verdi (Siri mantığı): intent köprüsü.
      const intent = fromSemanticResult(brain.semantic, trimmed);
      if (intent) {
        void reportVoiceDiag('voice_route', { route: 'companion_action', provider });
        void reportVoiceDiag('voice_intent', { intent: intent.type, provider });
        const aiCompat: AIVoiceResult = {
          intent:     intent.type as AIVoiceResult['intent'],
          payload:    intent.payload as Record<string, unknown>,
          confidence: brain.semantic.confidence,
          feedback:   brain.semantic.feedback,
        };
        _aiHandlers.forEach((fn) => fn(aiCompat, ctx));
        void reportVoiceDiag('voice_success', { intent: intent.type, provider });
        _endConvSession(); // araç komutu → sohbet döngüsü başlatmaz
        speakFeedback(brain.semantic.feedback);
        if (!ctx?.isDriving) {
          push({ status: 'success', transcript: trimmed, error: null, suggestions: [] });
          setTimeout(() => { if (_current.status === 'success') push({ status: 'idle' }); }, 2000);
        }
        return true;
      }
      // intent köprülenemedi (geçersiz/loş güven) → zincire devam
    }
  } catch { /* companion hattı asla komut akışını kıramaz — zincire devam */ }
  finally {
    if (_thinkingTimer !== null) { clearTimeout(_thinkingTimer); _thinkingTimer = null; }
  }

  // ── 3 & 4. GRACEFUL FALLBACK (offline VEYA beyin başarısız/null) ──
  // Buraya yalnız (a) offline/Gemini yok, ya da (b) online beyin ≤2.5sn'de
  // karar veremedi/null döndü durumunda inilir. İKİNCİ bir AI çağrısı YOK
  // (No Dual Response) ve "İnternet yavaş..." mesajı YOK — yerel parser +
  // offline sohbet sırayla denenir (CLAUDE.md §2 fail-soft).

  // (a) Yüksek güven yerel komut (≥0.7) → anında uygula. Müzik sorgusu online
  //     ise isim onarımından geçer (içinde hasNet kapısı var; fail-soft).
  if (result.command && result.command.confidence >= AUTO_DISPATCH_MIN) {
    _lastCommandTime = now;
    if (result.command.type === 'play_music_query') {
      await _maybeRepairMusicQuery(result.command);
    }
    if (ctx?.isDriving) { dispatchDriving(result.command); } else { dispatch(result.command); }
    return true;
  }

  // (b) Orta güven (0.5–0.7) → BELİRSİZ. Sürüşte etkileşimi en aza indirmek
  //     için doğrudan uygula; PARK halinde "bunu mu istedin?" diye sor.
  if (result.command && result.command.confidence >= 0.5) {
    if (ctx?.isDriving) {
      _lastCommandTime = now;
      dispatchDriving(result.command);
      return true;
    }
    _pendingCmd = result.command;
    _pendingAt  = now;
    const q = `Bunu mu demek istedin: ${result.command.feedback}? Evet ya da hayır de.`;
    _armFollowUp(); // soru bitince mikrofon açılır — kullanıcı evet/hayır'ı SÖYLEYEBİLİR
    speakFeedback(q);
    push({ status: 'error', transcript: trimmed, error: q, suggestions: result.suggestions });
    return true;
  }

  // (c) Komut değil → offline sohbet motoru (smalltalk vb.). Tek seferlik cevap
  //     (offline sürekli sohbet döngüsü açılmaz; online döngü beyin yolunda kurulur).
  const convResult = tryOfflineConversation(trimmed, ctx?.isDriving, ctx?.speedKmh);
  if (convResult.handled) {
    _lastCommandTime = now;
    void reportVoiceDiag('voice_route', { route: 'offline_chat' });
    _dispatchConversation(convResult.response, trimmed, false);
    return true;
  }

  // (d) Düşük güven yerel eşleşme → son çare uygula.
  if (result.command) {
    _lastCommandTime = now;
    if (ctx?.isDriving) { dispatchDriving(result.command); } else { dispatch(result.command); }
    return true;
  }

  // (e) Hiçbir şey eşleşmedi → "anlaşılamadı" (çıkmaz yok; ikinci AI/“internet yavaş” yok).
  void reportVoiceDiag('voice_error', {
    errorCode: 'ERR_NO_MATCH',
    transcriptLength: trimmed.length,
    provider,
  });
  _endConvSession(); // terminal hata — sohbet döngüsü biter, pencere kapanabilir
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

export interface StartListeningOpts {
  /**
   * Takip dinlemesi (sohbet modu): TTS bitince otomatik açılan pencere.
   * KISA pencere kullanılır (followUpListenMs, 6-10s bandı) — kullanıcı
   * konuşmazsa sistem hızla idle'a döner, tekrar wake word İSTENMEZ.
   */
  followUpWindow?: boolean;
}

export function startListening(opts?: StartListeningOpts): void {
  // İDEMPOTENT: zaten dinleniyorsa (veya native warmup uçuştaysa) hiçbir şey yapma.
  // KRİTİK: burada stopListening() ÇAĞIRMA. React mount efektleri (özellikle dev
  // StrictMode) startListening'i iki kez çağırır; toggle davranışı 2. çağrıda tanımayı
  // anında iptal ederdi ("mik açılır, hemen kapanır, algılama yok"). Durdurma işini
  // butonlar explicit stopListening() ile yapar.
  if (_current.status === 'listening' || _nativeSttWarmupTimer !== null) {
    return;
  }

  // İLK İŞ: asistan konuşuyorsa kendi sesini kes — mikrofonla çakışmasın
  // (kullanıcı asistanın sözünü kesip konuşmaya geçebilsin). ttsCancel idempotent:
  // konuşan bir şey yoksa zararsız no-op. TTS-end bildirimi tetiklemez (takip/idle
  // mantığını yanlışlıkla ilerletmez).
  ttsCancel();
  // Yeni etkileşim bekleyen takipsiz-idle'ı geçersiz kılar (eski cevabın TTS
  // bitişi bu turu idle'a düşürmesin).
  _clearConvIdle();

  // Beyni ÖNDEN ısıt: kullanıcı konuşurken model uyanır → gerçek komut sıcak gelir
  // (~1sn), soğuk-başlangıç (~7sn) timeout'u aşıp REASK üretmez. Fire-and-forget.
  void _warmupBrain();

  void reportVoiceDiag('voice_start');

  // AudioContext donma koruması — her tetiklemede suspended ise resume et
  if (_audioCtx && _audioCtx.state === 'suspended') {
    _audioCtx.resume().catch(() => {});
  }

  if (isNative) {
    // Mikrofon donanım ısınması — süreler voiceTuning.ts tek kaynağından.
    const warmupMs = isLowEndDevice() ? VOICE_TUNING.warmupLowEndMs : VOICE_TUNING.warmupMs;

    // Failsafe > warmup + maxListenMs (voiceTuning hiyerarşisi): aktif dinleme
    // ASLA buradan kesilmez; yalnız native'in hiç dönmediği anormal durumu toparlar.
    const sttFailsafe = setTimeout(() => {
      if (_current.status === 'listening') {
        console.warn(`[Voice] STT failsafe (${VOICE_TUNING.listenFailsafeMs}ms) — forcing idle`);
        void reportVoiceDiag('voice_timeout', { errorCode: 'ERR_LISTEN_FAILSAFE' });
        _stopNativeVolumeListener();
        unduckMedia();
        _endConvSession();
        push({ status: 'idle' });
      }
    }, VOICE_TUNING.listenFailsafeMs);

    const doSTT = () => {
      // Mikrofon donanımı gerçekten açılıyor. Durum warmup başında zaten 'listening'
      // basıldıysa bu no-op'tur (idle→listening tek sefer duck tetikler); warmup=0
      // yolunda görsel geri bildirimi burada basar.
      push({ status: 'listening', error: null, suggestions: [], volumeLevel: 0 });
      void reportVoiceDiag('voice_listening');
      _startNativeVolumeListener();
      duckMedia();

      CarLauncher.startSpeechRecognition({
        // SAHA FİX 2026-06-12 ("telefonda %40 anlıyor"): STT doğruluğu Vosk küçük TR
        // modeliyle sınırlı. GERÇEK İNTERNET VARSA yüksek doğruluklu online tanıma kullan;
        // aksi halde cihaz-içi Vosk. Native tarafta da yönlendirilir: preferOffline=false +
        // Google mevcut → online; aksi halde Vosk (onlineFallback çift yönlü: online koparsa Vosk).
        //
        // GERÇEK BAĞLANTI KAPISI (sahte onLine koruması): online STT yalnız
        // navigator.onLine VE isAiNetHealthy() iken açılır. navigator.onLine tek başına
        // güvenilmez — head unit internetsizken bile 'true' raporlayabilir. Gemini devre
        // kesicisi (isAiNetHealthy) art arda gerçek AI ağ hatasında düşer → ağ sahte/ölü
        // ise STT de Vosk'a iner (en çok ilk 1-2 komut online dener, sonra breaker
        // kapatır; 90s soğuma). Böylece: internetli head unit ≈ Siri (online STT + Gemini),
        // internetsiz/sahte-online head unit → Vosk. Cihaz tier'ından BAĞIMSIZ.
        preferOffline: !(typeof navigator !== 'undefined' && navigator.onLine && isAiNetHealthy()),
        // n-best: STT'nin ilk birkaç alternatifini iste — beyin doğru olanı seçer
        // (Vosk küçük TR modeli tek "en iyi"de sık yanılıyor). Wake yolu kendi path'i.
        onlineFallback: true, language: 'tr-TR', maxResults: STT_MAX_ALTERNATIVES,
        // Araç içi hassasiyet (voiceTuning.ts): kazanç + dinleme penceresi.
        // Native tarafta clamp'lenir; wake word bu opsiyonları geçmediği için etkilenmez.
        // Takip dinlemesi (sohbet modu) KISA pencere kullanır — sessizlikte hızlı idle.
        gain: VOICE_TUNING.nativeGainX,
        maxListenMs: opts?.followUpWindow ? VOICE_TUNING.followUpListenMs : VOICE_TUNING.maxListenMs,
      })
        .then((result) => {
          clearTimeout(sttFailsafe);
          _stopNativeVolumeListener();
          unduckMedia();
          const transcript = result.transcript?.trim() ?? '';
          if (transcript) {
            _consecutiveEmptyCount = 0;
            _convSession = true; // sesli oturum aktif — cevap sonrası mikrofon yeniden açılır
            void reportVoiceDiag('voice_transcript', { transcriptLength: transcript.length });
            // CarLauncher bitti → anında "işleniyor" hissi ver, ardından processTextCommand çalışır
            push({ status: 'processing', transcript });
            void processTextCommand(transcript, undefined, result.alternatives);
          } else {
            // Boş transcript: kullanıcı sessiz kaldı → sohbet döngüsü biter.
            _endConvSession();
            // İlk boşta sessizce idle, 2. ardışık boşta bilgilendirme göster
            _consecutiveEmptyCount++;
            if (_consecutiveEmptyCount >= 2) {
              _consecutiveEmptyCount = 0;
              push({ status: 'error', error: 'Ses algılanamadı. Daha yüksek sesle konuşun.', suggestions: [] });
              setTimeout(() => { if (_current.status === 'error') push({ status: 'idle', error: null }); }, 2500);
              void reportVoiceDiag('voice_error', { errorCode: 'ERR_NO_SPEECH' });
              // Uzak tanı (opsiyonel): ardışık 2 boş transcript — mikrofon/kazanç sorunu
              // sinyali. remoteLogService dedup'u (oturumda 1 kez) + token bucket spam'i keser.
              void import('./remoteLogService')
                .then((m) => m.reportCritical('VOICE_STT', 'no_speech_x2', { errorCode: 'ERR_NO_SPEECH' }))
                .catch(() => {});
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
            _endConvSession(); // sessizlik → sohbet döngüsü biter
            push({ status: 'idle' });
            return;
          }
          console.error('Native Speech Error:', err);
          _endConvSession();
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
          void reportVoiceDiag('voice_error', {
            errorCode: isPermission ? 'ERR_PERMISSION' : 'ERR_STT_START',
          });
          // Uzak tanı (opsiyonel): gerçek STT başlatma hatası (izin/Vosk model/donanım) —
          // saha teşhisi için bir kez raporlanır (ctx+msg dedup, oturum başına 1; spam yok).
          void import('./remoteLogService')
            .then((m) => m.reportCritical('VOICE_STT', msg || 'stt_start_failed', { errorCode: 'ERR_STT_START' }))
            .catch(() => {});
        });
    };

    if (warmupMs > 0) {
      // Warmup BAŞLARKEN 'listening' bas — donanım ısınırken (T507 ~ yüzlerce ms)
      // kullanıcı görsel geri bildirim görür; eskiden yalnız warmup SONRASI
      // basıldığı için arada "tepkisiz" bir boşluk hissediliyordu. Gerçek mikrofon
      // + RMS/duck doSTT'de bağlanır; failsafe zaten t=0'dan beri kurulu.
      push({ status: 'listening', error: null, suggestions: [], volumeLevel: 0 });
      _nativeSttWarmupTimer = setTimeout(() => {
        _nativeSttWarmupTimer = null;
        doSTT();
      }, warmupMs);
    } else {
      doSTT();
    }
  } else {
    push({ status: 'listening', error: null, suggestions: [], volumeLevel: 0 });
    void reportVoiceDiag('voice_listening');
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
        _convSession = true; // sesli oturum aktif — cevap sonrası mikrofon yeniden açılır
        void reportVoiceDiag('voice_transcript', { transcriptLength: finalText.trim().length });
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
      _endConvSession(); // web STT hatası/sessizlik → sohbet döngüsü biter
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
  // Kullanıcı isteğiyle durdurma — sohbet döngüsü her durumda biter
  // (TTS çalarken X'e basılması dahil; durum 'listening' olmayabilir).
  _endConvSession();
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
  _endConvSession();
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
  _convSession     = false;
  _followUpArmed   = false;
  if (_followUpFallbackTimer !== null) {
    clearTimeout(_followUpFallbackTimer);
    _followUpFallbackTimer = null;
  }
  _clearConvIdle();
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
