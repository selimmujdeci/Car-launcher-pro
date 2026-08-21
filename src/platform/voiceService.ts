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
/* MAVI-STT-CONTEXT-GRAMMAR: offline aktif dinleme sözlüğünün TEK çözüm noktası.
   Gramer yalnız TANIMA adaylarını daraltır — intent/eylem/onay kararı ÜRETMEZ;
   onay otoritesi bu dosyadaki M4 bloğu ve `pendingActionConfirmation`tır. */
import { resolveActiveGrammar } from './voice/contextGrammarApplier';
import { repairTranscript } from './asrRepair';
import { tryOfflineConversation } from './offlineConversationEngine';
import { getConfig } from './performanceMode';
// MAVI-M6: `speakFeedback`/`speakAssistant` ARTIK DOĞRUDAN ÇAĞRILMAZ — normal
// kullanıcı cevabı `speakMaviAnswer` otoritesinden geçer (o da bunlara delege eder).
import { registerTtsEndListener, ttsCancel, isTtsSpeaking } from './ttsService';
import { duckMedia, unduckMedia } from './audioService';
import { resolveApiKey, type AIProvider, type AIVoiceResult, type VehicleContext } from './aiVoiceService';
// MAVI-M2: komut başına gerçek araç bağlamı (tek resolver — yeni araç-state kaynağı DEĞİL).
import { currentMaviVehicleContext, unknownMaviVehicleContext } from './assistant/maviVehicleContext';
// MAVI-M5: kullanıcı turu kimliği — geç dönen sağlayıcı cevabının eylem/konuşma yetkisini keser.
import {
  beginMaviTurn, completeMaviTurn, continueIfTurnActive, isMaviTurnCurrent,
  getActiveMaviTurn, type MaviTurnToken,
} from './assistant/maviTurn';
// MAVI-M6: normal kullanıcı cevabının TEK seslendirme otoritesi (tur başına tek `answer`).
import { speakMaviAnswer } from './assistant/maviSpeech';
/* MAVI-M4: AÇIK ONAY bekleyen araç etkili eylemin çözümü. Bu modül SAF bir
 * depodur; `commandExecutor` BURAYA import EDİLMEZ (tek otorite sözleşmesi) —
 * onaylı yürütme, `useVoiceCommandHandler`ın kaydettiği yürütücü üzerinden
 * `commandExecutor.executeIntent`e gider. */
import {
  peekPendingAction, consumePendingAction, clearPendingAction,
  getConfirmedActionExecutor,
} from './action/pendingActionConfirmation';
// MAVI-M4-LAB-2: zincirin başlangıç aşaması (saf depo — akışı değiştirmez).
import { recordMaviActionStage } from './action/maviActionTrace';
import { isAiNetHealthy } from './aiHealth';
// P1: çoklu onay gerektiren sequence kapısı (saf karar; risk bilgisi M4 defterinden).
import {
  classifySequenceConfirmationPolicy, MULTI_CONFIRMATION_REFUSAL_TEXT,
} from './action/sequenceConfirmationPolicy';
import { fromSemanticResult } from './intentEngine';
import { isInformationalCommand, answerInformational } from './voiceInfoService';
import { weatherQueryNamesCity } from './weatherService';
import { showToast } from './errorBus';
import { VOICE_TUNING } from './voiceTuning';
import { reportVoiceDiag } from './voiceDiagService';
import { pushTrail } from './diagnosticTrailCore';  // çekirdek: ağır obd/store zinciri GİRMESİN
import { deriveSttLatencyMetrics, recordSttLatencyMetrics, type RawSttTelemetry } from './sttLatencyTelemetry';

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

/**
 * MAVI-M3: handler artık komutun ÇÖZÜLMÜŞ araç bağlamını da alır (M2'nin komut başına
 * tek, dondurulmuş snapshot'ı — İKİNCİ okuma YAPILMAZ). İkinci parametre OPSİYONELDİR;
 * eski handler'lar (`(cmd) => …`) hiç değişmeden çalışmaya devam eder.
 */
export type CommandHandler = (cmd: ParsedCommand, ctx?: VehicleContext) => void;
/**
 * Handler `Promise` döndürebilir ve `processTextCommand` onu BEKLER.
 *
 * NEDEN (saha 2026-07-31): eskiden dönüş `void` idi ve `forEach` beklemiyordu →
 * yürütme daha bitmeden beynin iyimser `feedback`'i konuşuluyor, turun tek-cevap
 * slotunu kapıyordu. Sonuç: `needs_confirmation` gibi GERÇEK cevaplar
 * `suppressed_duplicate` ile susturuluyordu ("annemi ara" hiç aramıyordu).
 * M6'nın "dispatchIntent konuştuysa burası sessiz kalır" sözleşmesi ancak
 * beklenerek uygulanabilir.
 */
export type AIResultHandler = (result: AIVoiceResult, ctx?: VehicleContext) => void | Promise<void>;

/* ── Module-level state ──────────────────────────────────── */

const MAX_HISTORY = 5;
/** n-best: STT'den istenen alternatif sayısı (beyin/parser doğru olanı seçer). */
const STT_MAX_ALTERNATIVES = 4;

/* ── Web Speech API sözleşmesi (tarayıcı yolu) ─────────────────────────────
   `SpeechRecognition` TypeScript'in standart DOM kütüphanesinde YOKTUR ve
   `@types/dom-speech-recognition` eklemek yeni bir bağımlılık + lisans denetimi
   demektir. Bu yüzden YALNIZ KULLANDIĞIMIZ yüzey burada dar biçimde modellenir.
   Yalnız web/demo yolunu ilgilendirir — cihazda (native) Vosk yolu çalışır. */
interface WebSpeechAlternative { readonly transcript?: string }
interface WebSpeechResult {
  readonly isFinal: boolean;
  readonly [index: number]: WebSpeechAlternative | undefined;
}
interface WebSpeechResultList {
  readonly length: number;
  readonly [index: number]: WebSpeechResult;
}
interface WebSpeechResultEvent {
  readonly resultIndex: number;
  readonly results: WebSpeechResultList;
}
interface WebSpeechErrorEvent { readonly error: string }

interface WebSpeechRecognition {
  lang:            string;
  interimResults:  boolean;
  continuous:      boolean;
  maxAlternatives: number;
  onstart:       (() => void) | null;
  onaudiostart:  (() => void) | null;
  onspeechstart: (() => void) | null;
  onspeechend:   (() => void) | null;
  onnomatch:     (() => void) | null;
  onend:         (() => void) | null;
  onresult:      ((e: WebSpeechResultEvent) => void) | null;
  onerror:       ((e: WebSpeechErrorEvent) => void) | null;
  start(): void;
  stop():  void;
}

type WebSpeechRecognitionCtor = new () => WebSpeechRecognition;

/** Tarayıcı iki adı da kullanır (webkit önekli ve öneksiz). */
interface SpeechCapableWindow {
  webkitSpeechRecognition?: WebSpeechRecognitionCtor;
  SpeechRecognition?:       WebSpeechRecognitionCtor;
}

/** `window`u Web Speech alanlarıyla gören dar görünüm (global kirletmeden). */
const _speechWindow = (): SpeechCapableWindow =>
  (typeof window !== 'undefined' ? window : {}) as unknown as SpeechCapableWindow;

const MIC_AVAILABLE = isNative
  || !!(_speechWindow().webkitSpeechRecognition || _speechWindow().SpeechRecognition);

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

/**
 * Tanı: son STT/komut SONUCUNUN (başarı/hata) zamanı — push() içinde terminal
 * durum geçişinde güncellenir (tek funnel). Ham transkript YOK — yalnız
 * zaman+bayrak (PII değil).
 */
let _lastSttOutcomeAt = -1;
let _lastSttOk: boolean | null = null;

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

/** Tanı: son STT/komut sonucunun zamanı + başarı/hata bayrağı (ham transkript YOK — PII değil). */
export function getLastSttOutcome(): { atMs: number; ok: boolean | null } {
  return { atMs: _lastSttOutcomeAt, ok: _lastSttOk };
}

/**
 * Tanı: YÜRÜRLÜKTEKİ oturum/kuşak kimlikleri (salt-okunur).
 *
 * Wake karar defteri, kabul ettiği tetiği mevcut `VoiceLifecycleEvent`
 * zinciriyle ilişkilendirmek için bunu okur — **yeni bir korelasyon kimliği
 * sistemi kurulmadı**. Yalnız okuma; hiçbir durumu değiştirmez.
 */
export function getVoiceSessionIds(): { sessionId: number; generationId: number } {
  return { sessionId: _voiceSessionId, generationId: _voiceGenerationId };
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
  // 'rmsData' artık plugin arabiriminde TANIMLI (bkz. nativePlugin.ts) — cast yok.
  CarLauncher.addListener('rmsData', (data: { value: number }) => {
    push({ volumeLevel: data.value });
  }).then((handle) => {
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
      _emitVoiceEvent('timeout'); // MAVI3-1: typed timeout (push idle sonra emit eder)
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

/* ── Emniyet penceresi uzatması (SAHA 2026-07-24) ──────────────
 * ŞİKAYET: "uzun muhabbetlerde Mavi cümlenin ortasında kesiliyor, dut sesiyle
 * dinlemeye geçiyor."
 * KÖK: aşağıdaki iki emniyet zamanlayıcısı (takip 20sn · sohbet-idle 15sn)
 * "TTS bitiş eventi hiç gelmezse akış asılı kalmasın" diye konmuştu, ama
 * konuşmanın GERÇEKTEN bitip bitmediğini sormuyor, sabit süreyle varsayıyorlardı.
 * Türkçe TTS ~12-15 karakter/sn → ~250 karakteri aşan her cevap hâlâ konuşulurken
 * pencere doluyor; takip zamanlayıcısı `startListening()` çağırıyor, o da
 * `ttsCancel()` ile cevabı ORTASINDAN kesip mikrofonu açıyordu (Android STT
 * başlangıç bipi = kullanıcının duyduğu "dut").
 *
 * ÇÖZÜM: pencere dolduğunda konuşma sürüyorsa (isTtsSpeaking) kesme — pencereyi
 * kısa adımlarla UZAT. Emniyet rolü KAYBOLMAZ: uzatma sayısı tavanlıdır, ayrıca
 * ttsService'in kendi MAX_SPEAKING_MS tavanı takılı motoru "bitmiş" sayar.
 * Böylece gerçek asılma yine kurtarılır, gerçek konuşma asla kesilmez. */
const SPEAKING_EXTEND_MS = 5_000;
/** Azami uzatma — sonsuz uzatma YASAK (24 × 5sn = 120sn ek tavan). */
const MAX_SPEAKING_EXTENSIONS = 24;

function _clearConvIdle(): void {
  _convIdleOnTtsEnd = false;
  if (_convIdleFallbackTimer !== null) {
    clearTimeout(_convIdleFallbackTimer);
    _convIdleFallbackTimer = null;
  }
}

let _convIdleExtensions = 0;

function _armConvIdleOnTtsEnd(): void {
  _convIdleOnTtsEnd = true;
  _convIdleExtensions = 0;
  _scheduleConvIdleFallback(CONV_IDLE_FALLBACK_MS);
}

function _scheduleConvIdleFallback(delayMs: number): void {
  if (_convIdleFallbackTimer !== null) clearTimeout(_convIdleFallbackTimer);
  _convIdleFallbackTimer = setTimeout(() => {
    _convIdleFallbackTimer = null;
    if (!_convIdleOnTtsEnd) return;
    // Cevap HÂLÂ konuşuluyor → UI'yı idle'a düşürmek konuşmayı yarıda "bitmiş"
    // gösterirdi. Pencereyi uzat (tavanlı).
    if (isTtsSpeaking() && _convIdleExtensions < MAX_SPEAKING_EXTENSIONS) {
      _convIdleExtensions++;
      _scheduleConvIdleFallback(SPEAKING_EXTEND_MS);
      return;
    }
    _convIdleOnTtsEnd = false;
    if (_current.status === 'success') push({ status: 'idle' });
  }, delayMs);
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
let _followUpExtensions = 0;

function _armFollowUp(): void {
  if (!_convSession || _voiceCogPaused) return;
  _followUpArmed = true;
  _followUpExtensions = 0;
  _scheduleFollowUpFallback(FOLLOWUP_FALLBACK_MS);
  if (!_current.followUp) push({ followUp: true });
}

// SAHA FİX 2026-06-12: TTS bitiş eventi hiç gelmezse (bazı head unit TTS
// motorlarında onDone güvenilmez) eskiden SESSİZCE vazgeçiliyordu — kullanıcı
// "cevaptan sonra dinlemiyor" yaşıyordu. Bu süre dolduğunda konuşma bitmiş
// SAYILIR: vazgeçmek yerine mikrofonu best-effort AÇ (sohbet döngüsü kopmaz).
// SAHA FİX 2026-07-24: "bitmiş sayma" varsayımı uzun cevaplarda YANLIŞTI —
// konuşma sürerken startListening() → ttsCancel() cevabı kesiyordu. Artık
// konuşma sürüyorsa pencere uzatılır (tavanlı), kesilmez.
function _scheduleFollowUpFallback(delayMs: number): void {
  if (_followUpFallbackTimer !== null) clearTimeout(_followUpFallbackTimer);
  _followUpFallbackTimer = setTimeout(() => {
    _followUpFallbackTimer = null;
    if (!_followUpArmed) return;
    if (isTtsSpeaking() && _followUpExtensions < MAX_SPEAKING_EXTENSIONS) {
      _followUpExtensions++;
      _scheduleFollowUpFallback(SPEAKING_EXTEND_MS);
      return;
    }
    _followUpArmed = false;
    if (!_convSession || _voiceCogPaused) { _disarmFollowUp(); return; }
    if (_current.status === 'listening' || _current.status === 'processing') return;
    startListening({ followUpWindow: true });
  }, delayMs);
}

// TTS bitti → (A) kurulu takip varsa mikrofonu yeniden aç, yoksa
//             (B) takipsiz sohbet cevabıysa idle'a dön (sabit timer YOK).
registerTtsEndListener(() => {
  // MAVI-INSTRUMENTATION-1: ttsService'in TÜM yolları (native/web/klip · başarı/hata/iptal)
  // bu tek noktaya toplanır (_notifyTtsEnd) — speech_end HER durumda burada kapanır.
  _emitVoiceEvent('speech_end');
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

/* ── Voice Lifecycle Events (Faz-3 · MAVI3-1 — ADDITIVE gözlemlenebilirlik) ──
 * Mevcut davranışı DEĞİŞTİRMEZ: yeni typed olay kanalı, `push()` tek funnel'ının SONUNA
 * eklenen tek satırla beslenir + birkaç kritik noktadan (wake/timeout/cancel) emit. Polling
 * veya setInterval YOK; import yan etkisi YOK (kanal boş başlar). Mavi telemetri köprüsü
 * (MAVI3-2) bunu tüketir.
 *
 * MAVI-INSTRUMENTATION-1: `planning`/`executing`/`execution_result` artık BURADAN (voiceService)
 * gerçek komut işleme anlarında emit edilir (processTextCommand + dispatch/dispatchDriving/
 * dispatchChain/_answerSensorQuery/AI-ACTION dalı) — Mavi orchestrator'a bağımlı DEĞİLDİR, tüm
 * komut hattını (yerel + AI) kapsar. `speech_end` gerçek TTS bitişinde (registerTtsEndListener,
 * ttsService'in TÜM yollarını — native/web/klip, başarı/hata/iptal — toplayan tek nokta) emit
 * edilir. Davranış DEĞİŞMEZ: bu yalnız ADDITIVE gözlem olayları — hiçbir karar/komut/TTS çağrısı
 * taşınmaz, yalnız yanına bir emit satırı eklenir. */

export type VoiceLifecyclePhase =
  | 'idle' | 'wake_detected' | 'listening' | 'transcribing'
  | 'planning' | 'executing' | 'execution_result' | 'speaking' | 'speech_end'
  | 'cancelled' | 'timeout' | 'error';

/** `execution_result` fazının bounded sonuç kodu — serbest metin YOK, PII YOK. */
export type VoiceExecutionResult =
  | 'success' | 'failed' | 'rejected' | 'unsupported' | 'no_target' | 'cancelled';

export interface VoiceLifecycleEvent {
  readonly phase: VoiceLifecyclePhase;
  /** Barge-in/stale reddi için oturum kuşağı (wake veya idle→listening'de artar). */
  readonly generationId: number;
  /** Dinleme oturumu kimliği (kuşakla birlikte artar). */
  readonly sessionId: number;
  /** Monotonik zaman (performance.now) — süre telemetrisi clock-jump güvenli. */
  readonly at: number;
  /** Yalnız 'transcribing' — transcript UZUNLUĞU (ham metin/PII YOK). */
  readonly transcriptLength?: number;
  /** Yalnız 'execution_result' — bounded sonuç kodu (ham metin/komut içeriği YOK). */
  readonly result?: VoiceExecutionResult;
}

const _voiceEventListeners = new Set<(e: VoiceLifecycleEvent) => void>();
let _voiceSessionId = 0;
let _voiceGenerationId = 0;
let _lastEmittedPhase: VoiceLifecyclePhase | null = null;
/** wake_detected sonrası ilk 'listening' AYNI oturumdur (kuşak iki kez artmasın). */
let _wakePending = false;

function _voiceNow(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now() : Date.now();
}

/**
 * ADDITIVE typed voice-lifecycle aboneliği. Mevcut `useVoiceState`/`_stateListeners` akışını
 * ETKİLEMEZ. Unsubscribe İDEMPOTENT (ikinci çağrı zararsız). Listener hatası izole edilir.
 */
export function subscribeVoiceState(listener: (e: VoiceLifecycleEvent) => void): () => void {
  if (typeof listener !== 'function') return () => {};
  _voiceEventListeners.add(listener);
  let active = true;
  return () => {
    if (!active) return;      // idempotent
    active = false;
    _voiceEventListeners.delete(listener);
  };
}

/** İç emit: id'leri + zaman ekler, ardışık aynı-phase gürültüsünü bastırır, listener hatasını izole eder. */
function _emitVoiceEvent(
  phase: VoiceLifecyclePhase,
  extra?: { transcriptLength?: number; newSession?: boolean; result?: VoiceExecutionResult },
): void {
  if (extra?.newSession) { _voiceSessionId++; _voiceGenerationId++; }
  // Ardışık aynı phase → bastır ('transcribing' hariç: transcript uzunluğu değişebilir).
  // Çift-yürütme koruması: aynı transcript için 'executing'/'execution_result' iki kez ÜST ÜSTE
  // gelirse (fire-and-forget çağrı iki kez tetiklenirse) ikinci emit sessizce bastırılır — evidence
  // ring'i şişmez, tek kayıt kalır (MAVI-INSTRUMENTATION-1).
  if (phase === _lastEmittedPhase && phase !== 'transcribing') return;
  _lastEmittedPhase = phase;
  const evt: VoiceLifecycleEvent = Object.freeze({
    phase,
    generationId: _voiceGenerationId,
    sessionId: _voiceSessionId,
    at: _voiceNow(),
    transcriptLength: extra?.transcriptLength,
    result: extra?.result,
  });
  for (const fn of _voiceEventListeners) {
    try { fn(evt); } catch { /* listener hatası voiceService'i ASLA bozmaz (fail-soft) */ }
  }
}

/**
 * Wake word algılandığında (wakeWordService) çağrılır — 'wake_detected' + yeni oturum kuşağı.
 * Sonraki 'listening' aynı oturumdur (kuşak tekrar artmaz). ADDITIVE: wake motoru değişmez.
 */
export function notifyWakeDetected(): void {
  _wakePending = true;
  _emitVoiceEvent('wake_detected', { newSession: true });
}

/** push() SONUNDA çağrılır: VoiceStatus geçişini typed lifecycle event'e MAP eder (SAF map). */
function _maybeEmitVoiceLifecycle(prev: VoiceStatus, next: VoiceStatus, partial: Partial<VoiceState>): void {
  if (next === prev) {
    // Durum aynı ama transcript güncellendiyse (processing içinde) 'transcribing'i tazele.
    if (next === 'processing' && typeof partial.transcript === 'string' && partial.transcript.length > 0) {
      _emitVoiceEvent('transcribing', { transcriptLength: partial.transcript.length });
    }
    return;
  }
  switch (next) {
    case 'listening': {
      // idle/success/error/throttled'dan yeni dinleme → yeni oturum (wake zaten açtıysa hariç).
      const fromRest = prev === 'idle' || prev === 'throttled' || prev === 'success' || prev === 'error';
      const newSession = fromRest && !_wakePending;
      _wakePending = false;
      _emitVoiceEvent('listening', { newSession });
      break;
    }
    case 'processing':
      _emitVoiceEvent('transcribing', {
        transcriptLength: typeof partial.transcript === 'string' ? partial.transcript.length : undefined,
      });
      break;
    case 'success':
      _emitVoiceEvent('speaking');
      break;
    case 'error':
      _emitVoiceEvent('error');
      break;
    case 'idle':
      _wakePending = false;
      _emitVoiceEvent('idle');
      break;
    // 'throttled' → gerçek yaşam döngüsü değil (hız sınırı) → event yok.
  }
}

/* Tanı: son dinleme oturumundaki TEPE ses seviyesi (0..1). ~0 kalıyorsa mikrofon
 * sessizlik yakalıyor (ölü kaynak/donanım) — "dinliyor ama boş" kökünü ayırır.
 * listening'e her girişte sıfırlanır, rmsData geldikçe max'lanır. PII değil. */
let _sessionPeakVolume = 0;

/** Tanı: son/aktif dinleme oturumundaki tepe mikrofon seviyesi (0..1). */
export function getSessionPeakVolume(): number {
  return _sessionPeakVolume;
}

function push(partial: Partial<VoiceState>): void {
  const prevStatus = _current.status;
  _current = { ..._current, ...partial };
  if (partial.volumeLevel !== undefined && partial.volumeLevel > _sessionPeakVolume) {
    _sessionPeakVolume = partial.volumeLevel;
  }
  if (partial.status !== undefined && partial.status !== prevStatus) {
    if (_current.status === 'listening' && prevStatus !== 'listening') _sessionPeakVolume = 0;
    _applyAssistantDuck(prevStatus, _current.status);
    if (_current.status === 'processing') _armProcessingFailsafe();
    else _clearProcessingFailsafe();
    // Tanı: terminal STT sonucu — 'success' başarı, 'error' hata. 'throttled'
    // gerçek bir tanıma sonucu değil (hız sınırı) — bilinçli olarak sayılmaz.
    if (_current.status === 'success') { _lastSttOutcomeAt = Date.now(); _lastSttOk = true; }
    else if (_current.status === 'error') { _lastSttOutcomeAt = Date.now(); _lastSttOk = false; }
  }
  _stateListeners.forEach((fn) => fn(_current));
  // MAVI3-1 additive: VoiceStatus geçişini typed lifecycle event'e köprüle (mevcut akış etkilenmez).
  _maybeEmitVoiceLifecycle(prevStatus, _current.status, partial);
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

/* ── MAVI-M3 · SONUÇ-TEMELLİ ACK KOMUTLARI ────────────────────────────────
 * Bu komut tiplerinin parser metni ("Kapılar kilitleniyor", "Arıza kayıtları
 * siliniyor", "Araç sistemleri taranıyor"…) YÜRÜTMEDEN ÖNCE üretilmiş bir
 * İDDİADIR ve M1'de kanıtlandığı gibi çoğu zaman GERÇEK DEĞİLDİR (port yok /
 * routeIntent no-op). Bu tiplerde ses YALNIZ `routeIntent`in döndürdüğü
 * `IntentExecutionResult`ten üretilir (bkz. useVoiceCommandHandler).
 *
 * Liste yalnız DAVRANIŞSAL/YIKICI araç eylemlerini kapsar — salt-okunur ve
 * düşük riskli komutlar (navigasyon · medya · tema · ayar) DOKUNULMADAN
 * bugünkü davranışını sürdürür. */
const RESULT_ACK_COMMAND_TYPES: ReadonlySet<ParsedCommand['type']> = new Set<ParsedCommand['type']>([
  'hw_lock_doors', 'hw_unlock_doors', 'hw_honk_horn', 'hw_flash_lights',
  'hw_alarm_on', 'hw_alarm_off', 'hw_rear_camera', 'hw_lights_off', 'hw_screen_off',
  'vehicle_clear_dtc', 'vehicle_health_check',
  /* MAVI-M4 EKLENDİ: telefon araması artık AÇIK ONAY ister. Parser'ın
   * "Arama başlatılıyor" metni onay beklenirken söylenirse — ki M4 öncesi
   * TAM OLARAK BU OLUYORDU — kullanıcı arama başladı sanır ama başlamamıştır.
   * Ses yalnız otoritenin sonucundan üretilir. */
  'call_contact',
]);

/** @internal — guard testleri ve dispatch dalları için. */
export function isResultAckCommand(type: ParsedCommand['type']): boolean {
  return RESULT_ACK_COMMAND_TYPES.has(type);
}

/* ── MAVI-M6 · GEÇİCİ (PROVISIONAL) PARSER METNİ ──────────────────────────
 * Bu komutlarda parser'ın metni ("X aranıyor") NİHAİ CEVAP DEĞİLDİR: gerçek
 * cevap arama/oynatma bittikten sonra üretilir ("… çalınıyor" / "bulunamadı").
 * Bu yüzden 'progress' katmanına düşer ve tur başına tek olan `answer` slotunu
 * TÜKETMEZ → dürüst sonuç sesi korunur, üst üste konuşma olmaz. */
const PROVISIONAL_FEEDBACK_TYPES: ReadonlySet<ParsedCommand['type']> =
  new Set<ParsedCommand['type']>(['play_music_query', 'play_music_search']);

function _isProvisionalFeedback(type: ParsedCommand['type']): boolean {
  return PROVISIONAL_FEEDBACK_TYPES.has(type);
}

/* MAVI-M6-LATE-SPEECH-GATE: `turn` KOMUT GİRİŞİNDE (`processTextCommand`)
 * yakalanır ve buraya AÇIK PARAMETRE olarak iner. Global aktif tur OKUNMAZ —
 * öyle bir okuma kendini doğrular ve stale ÖLÇEMEZ (ölü dal dersi). */
function dispatch(cmd: ParsedCommand, ctx?: VehicleContext, turn?: MaviTurnToken | null): void {
  // MAVI-INSTRUMENTATION-1: seçilen action dispatch edilmeden HEMEN önce.
  _emitVoiceEvent('executing');
  void reportVoiceDiag('voice_intent', { intent: cmd.type });
  pushTrail('action', `sesli komut: ${cmd.type}`);  // olay izi (PII yok — yalnız intent tipi)
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
    void answerInformational(cmd.type, turn ?? null);
  } else if (!isResultAckCommand(cmd.type)) {
    // MAVI-M3: yıkıcı/davranışsal komutlarda parser'ın hazır metni SESLENDİRİLMEZ —
    // ACK yürütme sonucundan gelir (bkz. isResultAckCommand).
    // MAVI-M6: TEK otorite üzerinden. Müzik sorgusunun parser metni ("X aranıyor")
    // NİHAİ CEVAP DEĞİLDİR — gerçek cevap ("… çalınıyor" / "bulunamadı") aramadan
    // SONRA gelir → 'progress' katmanı; 'answer' slotu sonuca ayrılır.
    speakMaviAnswer(cmd.feedback, {
      isDriving: ctx?.isDriving === true,
      tier: _isProvisionalFeedback(cmd.type) ? 'progress' : 'answer',
      turn: turn ?? null,
    });
  }
  let _execOutcome: VoiceExecutionResult = 'success';
  try {
    _commandHandlers.forEach((fn) => fn(cmd, ctx));
  } catch (e) {
    _execOutcome = 'failed';
    throw e; // orijinal davranış korunur: hata YUTULMAZ, yalnız sonuç önce kaydedilir
  } finally {
    _emitVoiceEvent('execution_result', { result: _execOutcome });
  }
  void reportVoiceDiag('voice_success', { intent: cmd.type });
  const delays = getResetDelays();
  setTimeout(() => {
    try {
      if (_current.status === 'success') push({ status: 'idle' });
    } catch { /* ignore */ }
  }, delays[cmd.priority] ?? 2500);
}

function dispatchDriving(cmd: ParsedCommand, ctx?: VehicleContext, turn?: MaviTurnToken | null): void {
  // MAVI-INSTRUMENTATION-1: seçilen action dispatch edilmeden HEMEN önce.
  _emitVoiceEvent('executing');
  void reportVoiceDiag('voice_intent', { intent: cmd.type });
  pushTrail('action', `sesli komut (sürüşte): ${cmd.type}`);  // olay izi (PII yok)
  _endConvSession(); // araç komutu → sohbet döngüsü biter (yalnız companion sohbeti sürer)
  if (isInformationalCommand(cmd.type)) {
    void answerInformational(cmd.type, turn ?? null);
  } else if (!isResultAckCommand(cmd.type)) {
    // MAVI-M3 + M6: sonuç-ACK komutlarında parser metni KONUŞULMAZ; kalanlar TEK otoriteden.
    speakMaviAnswer(cmd.feedback, {
      isDriving: true,
      tier: _isProvisionalFeedback(cmd.type) ? 'progress' : 'answer',
      turn: turn ?? null,
    });
  }
  pushHistory(cmd);
  let _execOutcome: VoiceExecutionResult = 'success';
  try {
    _commandHandlers.forEach((fn) => fn(cmd, ctx));
  } catch (e) {
    _execOutcome = 'failed';
    throw e; // orijinal davranış korunur: hata YUTULMAZ, yalnız sonuç önce kaydedilir
  } finally {
    _emitVoiceEvent('execution_result', { result: _execOutcome });
  }
  void reportVoiceDiag('voice_success', { intent: cmd.type });
}

/**
 * QUERY_SENSOR yerel bypass'ının çalıştırıcısı (V1 — ASSISTANT_VEHICLE_INTEGRATION_PLAN.md).
 * Hava durumu bypass'ıyla (1b) AYNI ilke: beyne HİÇ gitmeden querySensor'dan
 * taze veriyle cevap verir. dispatch()'ten FARKI: EXTENDED/manufacturer hedefler
 * ilk okumayı 12s'e kadar bekleyebilir (sensorQueryService) — dispatch()'in anlık
 * "success → 2.2s sonra otokapat" akışı bu süreyi beklemeden pencereyi kapatırdı.
 * Bunun yerine durum 'processing'de tutulur (overlay açık kalır — processing
 * failsafe 20s, EXT_WAIT_TIMEOUT_MS 12s'in üstünde, güvenli), önce kısa bir
 * onay söylenir, sonra gerçek cevap. VIN gibi uzun metin cevaplar (>20 karakter
 * string değer) TTS'te OKUNMAZ (ISO 15008) — toast ile ekrana yönlendirilir.
 */
async function _answerSensorQuery(sensorQuery: string, turn?: MaviTurnToken): Promise<void> {
  // MAVI-INSTRUMENTATION-1: seçilen action (sensör okuma) dispatch edilmeden HEMEN önce.
  _emitVoiceEvent('executing');
  _endConvSession(); // araç sorgusu = araç komutu → sohbet döngüsü başlatmaz (dispatch ile aynı)
  push({ status: 'processing', transcript: sensorQuery, error: null, suggestions: [] });
  speakMaviAnswer('Bakıyorum...', { tier: 'progress' });   // MAVI-M6: ara bilgi
  try {
    const { querySensor } = await import('./obd/sensorQueryService');
    // MAVI-M5 · KAPI E: OBD okuması (EXTENDED hedeflerde 12 sn'ye kadar) sürerken
    // kullanıcı yeni komut vermiş olabilir → eski tur ne konuşur ne UI günceller.
    if (turn && !continueIfTurnActive(turn, 'action')) return;
    const answer = await querySensor(sensorQuery);
    // MAVI-M5 · KAPI F: sonuç geldi — hâlâ bu turun cevabı mı?
    if (turn && !continueIfTurnActive(turn, 'feedback')) return;
    if (!answer) {
      speakMaviAnswer('Bu sensörü tanımıyorum.');
      push({ status: 'error', error: 'Sensör bulunamadı', transcript: sensorQuery, suggestions: [] });
      setTimeout(() => { if (_current.status === 'error') push({ status: 'idle', error: null }); }, 3000);
      _emitVoiceEvent('execution_result', { result: 'no_target' }); // sensör tanınmadı — hedef yok
      return;
    }
    if (typeof answer.value === 'string' && answer.value.length > 20) {
      speakMaviAnswer(`${answer.name} ekranda gösteriliyor.`);
      showToast({ type: 'info', title: answer.name, message: answer.value, duration: 8000 });
    } else {
      speakMaviAnswer(answer.text);
    }
    push({ status: 'success', error: null, transcript: sensorQuery, suggestions: [] });
    const delays = getResetDelays();
    setTimeout(() => { if (_current.status === 'success') push({ status: 'idle' }); }, delays.normal ?? 2500);
    _emitVoiceEvent('execution_result', { result: 'success' });
  } catch {
    // fail-soft: sensör okuma hatası komut akışını kesmez (CLAUDE.md §2)
    speakMaviAnswer('Sensör verisi alınamadı.');
    push({ status: 'error', error: 'Sensör hatası', transcript: sensorQuery, suggestions: [] });
    setTimeout(() => { if (_current.status === 'error') push({ status: 'idle', error: null }); }, 3000);
    _emitVoiceEvent('execution_result', { result: 'failed' });
  }
  void reportVoiceDiag('voice_success', { intent: 'query_sensor' });
  // MAVI-M5: fire-and-forget yol turu KENDİSİ tamamlar (nihai zarf burada üretildi).
  if (turn) completeMaviTurn(turn);
}

/* ── Komut zincirleme ("müziği aç ve eve git") ─────────────────
 * Bağlaçla ayrılmış birden çok komutu tek söylemde çalıştırır. Yanlış pozitifi
 * önlemek için EN AZ 2 segment GÜVENLİ (≥0.7) komut olmalı; aksi halde zincir
 * sayılmaz ("Ahmet ve Mehmet'i ara", "ve" içeren yer adları normal işlenir). */
const CHAIN_SPLIT = /\s+(?:ve|sonra|ardindan|ardından|bir de|hem de|ayrica|ayrıca)\s+/i;

function dispatchChain(cmds: ParsedCommand[], ctx?: VehicleContext): void {
  // MAVI-INSTRUMENTATION-1: seçilen action(lar) dispatch edilmeden HEMEN önce.
  _emitVoiceEvent('executing');
  // Tek birleşik TTS (üst üste konuşma olmasın), sonra her komutun aksiyonu.
  _endConvSession(); // komut zinciri = araç komutu → takip dinlemesi yok
  // MAVI-M3: sonuç-ACK komutlarının parser metni birleşik TTS'e GİRMEZ — o komutların
  // sesi yürütme sonucundan gelir (zincirde de sahte "kilitleniyor" duyulmaz).
  const combined = cmds
    .filter((c) => !isResultAckCommand(c.type))
    .map((c) => c.feedback)
    .filter(Boolean)
    .join(', ');
  if (combined) speakMaviAnswer(combined, { isDriving: ctx?.isDriving === true });
  // MAVI-M5: zincirin HER adımı kendi güncellik kapısından geçer. Döngü senkron
  // olsa da bir handler yeni tur başlatabilir (barge-in / dahili yönlendirme) →
  // kalan ESKİ zincir adımları yan etki BAŞLATAMAZ.
  const _chainTurn = getActiveMaviTurn();
  let _chainOutcome: VoiceExecutionResult = 'success';
  try {
    for (const cmd of cmds) {
      if (!continueIfTurnActive(_chainTurn, 'action')) break;
      pushHistory(cmd);
      _commandHandlers.forEach((fn) => fn(cmd, ctx));
    }
  } catch (e) {
    _chainOutcome = 'failed';
    throw e; // orijinal davranış korunur: hata YUTULMAZ, yalnız sonuç önce kaydedilir
  } finally {
    _emitVoiceEvent('execution_result', { result: _chainOutcome });
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
function tryHandleChain(
  trimmed: string,
  ctx?: VehicleContext,
  turn?: MaviTurnToken | null,
): boolean {
  if (!CHAIN_SPLIT.test(trimmed)) return false;
  const parts = trimmed.split(CHAIN_SPLIT).map((s) => s.trim()).filter((s) => s.length >= 2);
  if (parts.length < 2) return false;
  const cmds: ParsedCommand[] = [];
  for (const p of parts) {
    const c = parseCommandFull(p).command;
    if (c && c.confidence >= AUTO_DISPATCH_MIN) cmds.push(c);
  }
  if (cmds.length < 2) return false;   // ≥2 güvenli komut yoksa zincir değil

  /* ── P1 · ÇOKLU ONAY KAPISI (DISPATCH'TEN HEMEN ÖNCE) ────────────────────
   * Kusur: tek turda iki onay gerektiren araç eylemi varsa İKİ handler da
   * başlıyor, her biri `setPendingAction` çağırabiliyor ve TEK global slot
   * last-writer-wins çalışıyordu; MaviSpeech ise yalnız İLK onay sorusunu
   * geçiriyordu → kullanıcı "kapıları kilitleyeyim mi?" duyup "evet" dediğinde
   * KORNA çalabiliyordu (duyulan onay ≠ onaylanan eylem).
   *
   * Kapı ZORUNLU OLARAK BURADA: `dispatchChain` çağrılmadan önce. Bir adım
   * sonrası bile geç olurdu — handler'lar senkron çalışıp bekleyen onayı
   * yazardı. Fail-closed: hiçbir handler, hiçbir `executeIntent`, hiçbir
   * bekleyen onay, hiçbir port çağrısı OLUŞMAZ ve girdi `true` ile terminal
   * biter → tekil parser'a da semantic sağlayıcıya da DÜŞÜLMEZ (reddedilen
   * sequence başka bir yoldan yeniden üretilemez). */
  const seqDecision = classifySequenceConfirmationPolicy(cmds);
  if (!seqDecision.allowed) {
    _lastCommandTime = Date.now();
    void reportVoiceDiag('voice_route', { route: 'sequence_confirmation_rejected' });
    void reportVoiceDiag('voice_error', {
      errorCode: 'ERR_MULTI_CONFIRMATION_SEQUENCE',
      transcriptLength: trimmed.length,
    });
    /* Gözlem: mevcut bounded aşama halkası kullanılır — yeni telemetri
     * çerçevesi KURULMAZ. Ham metin GEÇMEZ; yalnız gerekçe + sayılar. */
    recordMaviActionStage({
      stage: 'gate', status: 'denied',
      reason: `${seqDecision.reason}:${seqDecision.count}/${cmds.length}`,
      turnId: turn?.id,
    });
    _emitVoiceEvent('execution_result', { result: 'unsupported' });
    _endConvSession();
    // TEK ve dürüst mesaj — eyleme özgü onay sorusu ÜRETİLMEZ.
    speakMaviAnswer(MULTI_CONFIRMATION_REFUSAL_TEXT, {
      isDriving: ctx?.isDriving === true,
      turn: turn ?? null,
    });
    push({
      status:      'error',
      error:       MULTI_CONFIRMATION_REFUSAL_TEXT,
      transcript:  trimmed,
      suggestions: [],
    });
    if (turn) completeMaviTurn(turn);
    return true;
  }

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
  speakMaviAnswer(response, { channel: 'assistant' });   // MAVI-M6: tek otorite
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
  // MAVI-M6: ara söz — NİHAİ CEVAP DEĞİL; `answer` slotunu tüketmez ve cevap
  // verildikten sonra hiç konuşmaz (geç filler cevabı kesemez).
  speakMaviAnswer(phrase, { tier: 'progress' });
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
/* ⚠️ `(?:\b|$)` — sondaki `\b` ASCII tabanlıdır ve `ç` sözcük karakteri SAYILMAZ:
 * dizgi sonunda "vazgeç" için sınır OLUŞMUYOR ve tam olarak "vazgeç" demek ret
 * hattını TETİKLEMİYORDU ("vazgeçtim" tetikliyordu — ölçüldü). `$` alternatifi
 * bu tek boşluğu kapatır; diğer tüm davranış BİREBİR korunur ("durum" hâlâ
 * 'dur'a düşmez, "yokuş" hâlâ 'yok'a düşmez). `yapma` görev gereği eklendi. */
const NEGATE_RE = /^\s*(hayir|hayır|yok|iptal|vazgec|vazgeç|yapma|gerek yok|istemiyorum|olmaz|dur|bos ver|boş ver)(?:\b|$)/i;
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

/** n-best aday tavanı: her alternatif + onarılmış varyantı eklenince sınırsız
 * büyümesin diye (asrRepair.repairTranscript entegrasyonu). */
const MAX_LOCAL_PARSE_CANDIDATES = 8;

/**
 * @internal — n-best: en yüksek güvenli komutu üreten parse'ı seçer (eşitte top).
 *
 * Offline ASR onarımı (asrRepair.repairTranscript): her alternatifin hemen
 * ardından onarılmış varyantı da aday listesine eklenir. Onarılmış varyant
 * YALNIZ orijinalden DAHA YÜKSEK confidence üretirse kazanır (>, ≥ değil) —
 * eşitlikte orijinal (listede önce gelen) kazanır, fail-soft garantisi budur:
 * onarım asla mevcut davranışı bozamaz, yalnız iyileştirebilir.
 */
export function _bestLocalParse(alts: string[]): ReturnType<typeof parseCommandFull> {
  const candidates: string[] = [];
  for (const a of alts) {
    if (candidates.length >= MAX_LOCAL_PARSE_CANDIDATES) break;
    candidates.push(a);
    if (candidates.length >= MAX_LOCAL_PARSE_CANDIDATES) break;
    const repaired = repairTranscript(a);
    if (repaired && repaired !== a) candidates.push(repaired);
  }

  let best = parseCommandFull(candidates[0]);
  let bestConf = best.command?.confidence ?? 0;
  for (let i = 1; i < candidates.length; i++) {
    const r = parseCommandFull(candidates[i]);
    const c = r.command?.confidence ?? 0;
    if (c > bestConf) { best = r; bestConf = c; }
  }
  return best;
}

export async function processTextCommand(
  text: string,
  ctxIn?: VehicleContext,
  alternatives?: string[],
): Promise<boolean> {
  const trimmed = text.trim();
  if (!trimmed) return false;

  /* ── MAVI-M2 · GERÇEK ARAÇ BAĞLAMI (komut başına TEK çözüm) ─────────────
   * M1 bulgu #1: üretimdeki HİÇBİR çağıran bağlam taşımıyordu → `isDriving`
   * daima false, sürüş güvenliği kodu ÖLÜ. Çözüm çağrı yerlerine değil BURAYA
   * konur; tek komut otoritesi burasıdır (M1 §2) → yeni bir çağıran eklense bile
   * yapısal olarak "araç park halinde" varsayımına DÜŞÜLEMEZ.
   *
   * · Snapshot bir kez alınır → aynı komut boyunca DEĞİŞMEZ (immutable, frozen).
   *   Store komut sürerken değişse bile bu turun güvenlik kararı kaymaz.
   * · Çözüm başarısız olursa DÜRÜST bilinmeyen bağlam (`motionState:'unknown'`)
   *   kullanılır — "parked" fallback ÜRETİLMEZ.
   * · `ctxIn` yalnız test/fixture enjeksiyonu içindir; üretim yolları vermez. */
  /* ── MAVI-M5 · KULLANICI TURU ────────────────────────────────────────────
   * Boş metin bu satıra ULAŞMAZ (yukarıda return) → boş/partial girdi tur
   * BAŞLATMAZ. Wake word de burayı çağırmaz (yalnız `startListening`).
   * Bu çağrı önceki AKTİF turu derhal `superseded` yapar: A'nın uçuştaki
   * sağlayıcı cevabı artık eylem/konuşma yetkisine SAHİP DEĞİLDİR. */
  const turn = beginMaviTurn();
  /* MAVI-M4-LAB-2: zincirin BAŞLANGIÇ aşaması ("komut alındı"). Korelasyon
   * anahtarı burada doğar; sonraki kapı/sonuç/konuşma aşamaları aynı `turnId`
   * altında gruplanır. GİZLİLİK: transcript METNİ değil yalnız UZUNLUĞU geçer
   * (ham komut gözlem katmanına ASLA girmez). Kayıt fail-soft. */
  recordMaviActionStage({
    stage: 'turn_started', status: 'accepted',
    reason: `len:${trimmed.length}`, turnId: turn.id,
  });

  let ctx: VehicleContext;
  try {
    ctx = ctxIn ?? currentMaviVehicleContext();
  } catch {
    ctx = unknownMaviVehicleContext();   // fail-closed: bilinmeyen, park DEĞİL
  }

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

  // MAVI-INSTRUMENTATION-1: transcript kabul edildi + karar üretimi burada BAŞLAR — tüm
  // yönlendirme dallarını (bekleyen onay/zincir/bypass/AI/yerel fallback) tek noktadan kapsar.
  _emitVoiceEvent('planning');

  const cfg = getConfig();
  const now = Date.now();

  /* ── MAVI-M4 · BEKLEYEN AÇIK ONAY (araç etkili eylem) ────────────────────
   * `_pendingCmd`ten AYRI ve ONDAN ÖNCE değerlendirilir: `_pendingCmd`
   * "seni doğru mu anladım?" (belirsiz PARSE) sorusudur; bu ise
   * "bu geri alınamaz eylemi gerçekten yapayım mı?" (açık RIZA) sorusudur.
   *
   * Bu blok OLMADAN onay akışı ölü uçtu: `needs_confirmation` sonucu
   * `setPendingAction` ile saklanıyor ama "evet" HİÇ tüketilmiyordu →
   * onay gerektiren eylem (telefon araması · DTC silme) ASLA yürüyemezdi.
   *
   * · "evet" → istek TÜKETİLİR (tek kullanım) ve tek otoriteye `confirmed:true`
   *   ile gider. `consumePendingAction` M5 stale-turn kapısını uygular:
   *   isteği üreten turdan sonraki İLK tur değilse onay DÜŞER (araya giren
   *   başka bir komut eski niyeti canlandıramaz) → eylem BAŞLAMAZ.
   * · "hayır"/iptal → slot temizlenir, HİÇBİR yan etki oluşmaz.
   * · Başka bir şey → onay düşer, girdi normal komut olarak işlenir. */
  if (peekPendingAction(now)) {
    if (AFFIRM_RE.test(trimmed)) {
      const approved = consumePendingAction(turn.id, now);
      _lastCommandTime = now;
      const runConfirmed = getConfirmedActionExecutor();
      if (approved && runConfirmed) {
        _emitVoiceEvent('executing');       // yürütme ŞİMDİ başlıyor (onay alındı)
        runConfirmed(approved.intent);      // cevabı M6 tek zarfı üretir
      } else {
        // Stale tur / süresi geçmiş istek / yürütücü kayıtlı değil → FAIL-CLOSED:
        // eylem BAŞLAMAZ ve "yaptım" DENMEZ (sahte ACK yasağı).
        _emitVoiceEvent('execution_result', { result: 'cancelled' });
        speakMaviAnswer('Onayı doğrulayamadım, işlemi başlatmadım.');
        push({ status: 'idle', error: null });
      }
      completeMaviTurn(turn);
      return true;
    }
    if (NEGATE_RE.test(trimmed)) {
      clearPendingAction();
      _lastCommandTime = now;
      _endConvSession();
      _emitVoiceEvent('execution_result', { result: 'cancelled' });
      speakMaviAnswer('Tamam, vazgeçtim.');
      push({ status: 'idle', error: null });
      completeMaviTurn(turn);
      return true;
    }
    clearPendingAction();   // farklı bir şey söylendi → onay düşer (yan etki YOK)
  }

  // ── Bekleyen onay (belirsiz komut) varsa önce onu yorumla ──
  //   evet → uygula · hayır → iptal · başka bir şey → onayı bırak, normal işle.
  if (_pendingCmd) {
    if ((now - _pendingAt) < PENDING_TTL_MS) {
      if (AFFIRM_RE.test(trimmed)) {
        const cmd = _pendingCmd; _pendingCmd = null; _lastCommandTime = now;
        if (ctx?.isDriving) { dispatchDriving(cmd, ctx, turn); } else { dispatch(cmd, ctx, turn); }
        completeMaviTurn(turn);
        return true;
      }
      if (NEGATE_RE.test(trimmed)) {
        _pendingCmd = null;
        _endConvSession(); // onay diyaloğu bitti — komut akışı sohbet döngüsü başlatmaz
        _emitVoiceEvent('execution_result', { result: 'cancelled' }); // kullanıcı bekleyen komutu reddetti
        speakMaviAnswer('Tamam, vazgeçtim.');
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
  if (tryHandleChain(trimmed, ctx, turn)) return true;

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

  /* ── 0. KORUNAN EYLEM BLOKU · SEMANTIC RESURRECTION BLOCK (P0) ────────────
   * Bağımsız denetim bulgusu #2: parser `needsSemantic:false` üretiyordu ama
   * BU DOSYA o alanı hiç OKUMUYORDU → yerelde bloklanan metin ("yarın arıza
   * kodlarını sil") online beyne gidiyor ve sağlayıcı `CLEAR_DTC_CODES`
   * üretebiliyordu. Yerel kapı böylece etkisizdi.
   *
   * Artık parser AÇIK bir typed karar taşıyor (`safetyDecision`). Blokluysa tur
   * BURADA biter: sağlayıcı çağrısı YOK · bekleyen onay YOK · dispatch YOK ·
   * "yaptım/onaylıyor musun" TTS'i YOK. Yalnız dürüst bir ekran mesajı bırakılır.
   *
   * KAPSAM DAR: alan yalnız korunan eylem ZİKREDİLEN girdilerde üretilir →
   * "bana motor sıcaklığını açıkla" gibi sıradan bilinmeyen konuşmalarda
   * semantic fallback BİREBİR korunur (kilit testleri bunu doğrular). */
  const _safety = result.safetyDecision;
  if (_safety?.blocked) {
    _lastCommandTime = now;
    void reportVoiceDiag('voice_route', { route: 'protected_action_blocked' });
    void reportVoiceDiag('voice_error', {
      errorCode: `ERR_PROTECTED_${_safety.reason ?? 'blocked'}`.toUpperCase(),
      transcriptLength: trimmed.length,
    });
    _emitVoiceEvent('execution_result', { result: 'unsupported' });
    _endConvSession();
    push({
      status:      'error',
      error:       'Bunu doğrudan bir komut olarak anlamadım; komutu tek başına söyle.',
      transcript:  trimmed,
      suggestions: [],
    });
    setTimeout(() => {
      if (!isMaviTurnCurrent(turn)) return;
      if (_current.status === 'error') push({ status: 'idle', error: null });
    }, 3500);
    completeMaviTurn(turn);
    return false;
  }

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
    if (ctx?.isDriving) { dispatchDriving(result.command, ctx, turn); } else { dispatch(result.command, ctx, turn); }
    completeMaviTurn(turn);
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
    if (ctx?.isDriving) { dispatchDriving(result.command, ctx, turn); } else { dispatch(result.command, ctx, turn); }
    completeMaviTurn(turn);
    return true;
  }

  // ── 1b2. SENSÖR SORGUSU BYPASS — yerel sensorQueryService kotasız/anında cevaplar ──
  // "yağ sıcaklığı kaç", "turbo basıncı ne kadar" gibi net (≥0.7) yerel eşleşmeler
  // (vehicleIntents.ts) beyne HİÇ GİTMEZ: querySensor taze OBD/EXTENDED/manufacturer
  // veriyle doğrudan cevaplar — hava bypass'ıyla (1b) AYNI desen/ilke (plan §V1 madde
  // 4). Beyin sensör DEĞERİ UYDURMAZ ilkesi (plan §1); yerel parser'ın kaçırdığı
  // sensör isimlerinde QUERY_SENSOR komutu beyinden gelir (plan §5, companionChatProvider).
  if (
    result.command &&
    result.command.type === 'query_sensor' &&
    result.command.confidence >= 0.7
  ) {
    _lastCommandTime = now;
    void reportVoiceDiag('voice_route', { route: 'sensor_local_bypass' });
    pushHistory(result.command);
    // MAVI-M5: fire-and-forget async yol — tur token'ı TAŞINIR; sensör cevabı
    // ancak tur hâlâ güncelse konuşur ve turu KENDİSİ tamamlar.
    void _answerSensorQuery(result.command.extra?.sensorQuery ?? trimmed, turn);
    return true;
  }

  // ── API anahtarları + ağ sağlığı (devre kesici dahil) ────────
  const { provider, apiKey, hasNet, tavilyKey, searchKey, chain } = await _resolveAiKeys();

  // MAVI-M5 · KAPI A: anahtar okuması (2 şifreli native okuma) sürerken kullanıcı
  // yeni komut vermiş olabilir → bu tur artık sağlayıcıya gitmez, konuşmaz.
  if (!continueIfTurnActive(turn, 'provider_result')) return false;

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
    speakMaviAnswer(hint, { isDriving: ctx?.isDriving === true });
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
  /* #697 — beyin "karar veremedim" dediyse (REASK) metni burada bekletilir;
   * yerel zincirin HİÇBİR dalı tutmazsa (e) dalında SÖYLENİR. Tur-yereldir:
   * bir sonraki tura sızmaz. */
  let _pendingReask: string | null = null;
  if (aiUsable) try {
    const { tryCompanionBrain } = await import('./companion/companionChatProvider');
    // MAVI-M5 · KAPI B: dinamik import sürerken yeni tur başlamış olabilir.
    if (!continueIfTurnActive(turn, 'provider_result')) return false;
    // TEK spinner: cevap THINKING_FEEDBACK_DELAY_MS'yi aşarsa kısa NÖTR ara söz
    // ("Bir saniye..."). Hızlı cevapta timer iptal; geç ara sözü cevap TTS'i keser.
    // MAVI-M5 · KAPI H: ara söz TUR TOKEN'I TAŞIR — tur devralındıysa ya da zaten
    // tamamlandıysa KONUŞMAZ (yeni komuttan sonra "Bir saniye…" duyulmaz).
    _thinkingTimer = setTimeout(() => {
      _thinkingTimer = null;
      if (!continueIfTurnActive(turn, 'feedback')) return;
      _speakThinking();
    }, THINKING_FEEDBACK_DELAY_MS);
    const brain = await tryCompanionBrain(trimmed, {
      isDriving: ctx?.isDriving,
      // MAVI-M2: hız BİLİNMİYORSA (`null`) beyne SIFIR gönderilmez — alan hiç
      // taşınmaz (sahte "0 km/h" bağlamı = sahte "araç duruyor" iddiası).
      speedKmh:  ctx?.speedKmh ?? undefined,
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
    // KESİLME FIX (saha 2026-07-23, CDP: 429/400 → yavaş sağlayıcı zinciri): beyin/fallback
    // cevabı geldi → BEKLEYEN "Bir saniye..." ara sözünü KONUŞMADAN ÖNCE iptal et. Eskiden
    // timer yalnız `finally`'de (dispatch'ten SONRA) temizleniyordu; 1.5s eşiğine denk gelen
    // geç filler, cevap TTS'i başladıktan sonra ateşleyip cevabı KESİYORDU
    // ("Mavi konuşurken araya ses girip kesiliyor"). Burada erken temizlik yarışı kapatır.
    if (_thinkingTimer !== null) { clearTimeout(_thinkingTimer); _thinkingTimer = null; }

    /* ── MAVI-M5 · KAPI C (ASIL KAPI): SAĞLAYICI SONUCU TÜKETİLMEDEN ÖNCE ────
     * Buraya gelen cevap, kullanıcı yeni bir komut verdiyse ARTIK GEÇERSİZDİR.
     * Stale bir HATA DEĞİLDİR: sessizce düşürülür — parse/dispatch YOK, TTS YOK,
     * `_dispatchConversation` YOK ve **fallback zincirine de DÜŞÜLMEZ** (aksi halde
     * eski tur offline cevapla konuşurdu). `return false` → tur sessizce biter. */
    if (!continueIfTurnActive(turn, 'provider_result')) return false;

    if (brain) {
      /* SAHA (#697): REASK ("tam anlayamadım, bir daha söyle") bir CEVAP DEĞİL,
       * beynin "karar veremedim" itirafıdır. Eskiden normal sohbet cevabı gibi
       * tüketiliyordu → tur burada KAPANIYOR, aşağıdaki YEREL KOMUT ZİNCİRİ
       * (yüksek güvenli parser + offline sohbet) hiç çalışmıyordu. Online
       * zincir bir süre null döndüğünde kullanıcı "müzik aç" gibi TAMAMEN
       * YEREL komutlarda bile tekrar-rica duyuyordu ("Mavi her şeye 'of orayı
       * kaçırdım' diyor"). Artık metin saklanır, yerel zincir denenir; hiçbiri
       * tutmazsa (e) dalında bu cümle söylenir — çıkmaz yok, ama önce iş yapılır. */
      if (brain.kind === 'chat' && brain.route === 'companion_reask') {
        void reportVoiceDiag('voice_route', { route: brain.route, provider });
        _pendingReask = brain.response;
      } else if (brain.kind === 'chat') {
        _lastCommandTime = now;
        void reportVoiceDiag('voice_route', { route: brain.route, provider });
        // Sürekli sohbet döngüsü YALNIZ companion sohbet cevabında kurulur.
        _dispatchConversation(brain.response, trimmed, true);
        completeMaviTurn(turn);
        return true;
      }
      // ACTION — beyin komuta karar verdi (Siri mantığı): intent köprüsü.
      // REASK dalı buraya CHAT olarak düşer (yukarıda return etmez) → köprü
      // kurulmaz, aşağıdaki yerel zincire devam edilir.
      /* Daraltılmış tek referans: aşağıdaki blok `brain` üzerinden değil BUNUN
       * üzerinden okur — REASK düşüşünde (chat) `semantic` yoktur ve `tsc -b`
       * bunu haklı olarak reddeder. */
      const brainAction = brain.kind === 'action' ? brain : null;
      if (brainAction) _lastCommandTime = now;
      const intent = brainAction ? fromSemanticResult(brainAction.semantic, trimmed) : null;
      if (brainAction && intent) {
        void reportVoiceDiag('voice_route', { route: 'companion_action', provider });
        void reportVoiceDiag('voice_intent', { intent: intent.type, provider });
        const aiCompat: AIVoiceResult = {
          intent:     intent.type as AIVoiceResult['intent'],
          payload:    intent.payload as Record<string, unknown>,
          confidence: brainAction.semantic.confidence,
          feedback:   brainAction.semantic.feedback,
        };
        /* MAVI-M5 · KAPI D+E: YAN ETKİ BAŞLAMA SINIRI. `_aiHandlers` navigasyon,
         * telefon araması, medya, ekran açma ve OBD okumasını BAŞLATIR — stale tur
         * bu sınırı GEÇEMEZ. Kontrol handler döngüsüyle AYNI TİK'te olduğundan
         * araya yeni tur giremez (JS tek iş parçacığı). */
        if (!continueIfTurnActive(turn, 'action')) return false;
        _emitVoiceEvent('executing');
        let _aiExecOutcome: VoiceExecutionResult = 'success';
        try {
          /* ÇAĞRI SENKRON, BEKLEME SONRA (saha 2026-07-31).
           *
           * `fn(...)` kapının hemen ARDINDAN, `await` görmeden çağrılır — M5
           * KAPI D+E garantisi korunur (kapı ile yan etki başlangıcı arasına
           * yeni tur giremez; JS tek iş parçacığı). Handler'ı mikrotask'a
           * ertelemek (`Promise.resolve().then(...)`) bu garantiyi BOZARDI.
           *
           * Sonuç ise BEKLENİR: yürütme bitmeden aşağıdaki iyimser `feedback`
           * konuşulursa turun tek-cevap slotunu kapar ve gerçek sonuç
           * (`needs_confirmation` · hata · dürüst ACK) SUSTURULUR. */
          const _aiPending: Array<Promise<void>> = [];
          _aiHandlers.forEach((fn) => { _aiPending.push(Promise.resolve(fn(aiCompat, ctx))); });
          await Promise.all(_aiPending);
        } catch (e) {
          _aiExecOutcome = 'failed';
          throw e;
        } finally {
          _emitVoiceEvent('execution_result', { result: _aiExecOutcome });
        }
        void reportVoiceDiag('voice_success', { intent: intent.type, provider });
        _endConvSession(); // araç komutu → sohbet döngüsü başlatmaz
        /* MAVI-M6: TEK otorite. `dispatchIntent` bu turda zaten sonuç-temelli bir
         * cevap söylediyse burası SESSİZ kalır (tur başına tek `answer`); hiçbir
         * case konuşmadıysa beynin feedback'i söylenir → kapsama boşluğu yok. */
        speakMaviAnswer(brainAction.semantic.feedback, { isDriving: ctx?.isDriving === true });
        if (!ctx?.isDriving) {
          push({ status: 'success', transcript: trimmed, error: null, suggestions: [] });
          // MAVI-M5: gecikmeli durum sıfırlaması YENİ turun UI'sını ezemez.
          setTimeout(() => {
            if (!isMaviTurnCurrent(turn)) return;
            if (_current.status === 'success') push({ status: 'idle' });
          }, 2000);
        }
        completeMaviTurn(turn);
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

  /* ── MAVI-M5 · KAPI G: FALLBACK ÖNCESİ ──────────────────────────────────
   * Sağlayıcı hata verdiğinde/timeout olduğunda AYNI tur fallback'e düşebilir
   * (bu meşru davranış KORUNUR). Ama tur DEVRALINDIYSA fallback ÇALIŞMAZ:
   * `AbortError` tek başına stale kanıtı değildir — kimlik otoritedir. */
  if (!continueIfTurnActive(turn, 'provider_result')) return false;

  // (a) Yüksek güven yerel komut (≥0.7) → anında uygula. Müzik sorgusu online
  //     ise isim onarımından geçer (içinde hasNet kapısı var; fail-soft).
  if (result.command && result.command.confidence >= AUTO_DISPATCH_MIN) {
    _lastCommandTime = now;
    if (result.command.type === 'play_music_query') {
      await _maybeRepairMusicQuery(result.command);
      // MAVI-M5 · KAPI E: ASR isim onarımı (ağ gidiş-dönüşü) sürerken yeni tur
      // başlamış olabilir → eski tur müzik çalmayı BAŞLATAMAZ.
      if (!continueIfTurnActive(turn, 'action')) return false;
    }
    if (ctx?.isDriving) { dispatchDriving(result.command, ctx, turn); } else { dispatch(result.command, ctx, turn); }
    completeMaviTurn(turn);
    return true;
  }

  // (b) Orta güven (0.5–0.7) → BELİRSİZ. Sürüşte etkileşimi en aza indirmek
  //     için doğrudan uygula; PARK halinde "bunu mu istedin?" diye sor.
  if (result.command && result.command.confidence >= 0.5) {
    if (ctx?.isDriving) {
      _lastCommandTime = now;
      dispatchDriving(result.command, ctx, turn);
      completeMaviTurn(turn);
      return true;
    }
    _pendingCmd = result.command;
    _pendingAt  = now;
    const q = `Bunu mu demek istedin: ${result.command.feedback}? Evet ya da hayır de.`;
    _armFollowUp(); // soru bitince mikrofon açılır — kullanıcı evet/hayır'ı SÖYLEYEBİLİR
    speakMaviAnswer(q);
    push({ status: 'error', transcript: trimmed, error: q, suggestions: result.suggestions });
    completeMaviTurn(turn);
    return true;
  }

  // (c) Komut değil → offline sohbet motoru (smalltalk vb.). Tek seferlik cevap
  //     (offline sürekli sohbet döngüsü açılmaz; online döngü beyin yolunda kurulur).
  const convResult = tryOfflineConversation(trimmed, ctx?.isDriving, ctx?.speedKmh ?? undefined);
  if (convResult.handled) {
    _lastCommandTime = now;
    void reportVoiceDiag('voice_route', { route: 'offline_chat' });
    _dispatchConversation(convResult.response, trimmed, false);
    completeMaviTurn(turn);
    return true;
  }

  // (d) Düşük güven yerel eşleşme → son çare uygula.
  if (result.command) {
    _lastCommandTime = now;
    if (ctx?.isDriving) { dispatchDriving(result.command, ctx, turn); } else { dispatch(result.command, ctx, turn); }
    completeMaviTurn(turn);
    return true;
  }

  // (e) Hiçbir şey eşleşmedi → "anlaşılamadı" (çıkmaz yok; ikinci AI/“internet yavaş” yok).
  // NOT dispatch edildi → 'executing' YOK; doğrudan terminal sonuç (desteklenmeyen komut).
  void reportVoiceDiag('voice_error', {
    errorCode: 'ERR_NO_MATCH',
    transcriptLength: trimmed.length,
    provider,
  });
  _emitVoiceEvent('execution_result', { result: 'unsupported' });
  _endConvSession(); // terminal hata — sohbet döngüsü biter, pencere kapanabilir
  /* #697 — ÇIKMAZ YOK, AMA EN SONDA: online beyin karar veremedi VE yerel
   * zincirin hiçbir dalı tutmadı → tekrar-rica burada seslendirilir. Ekran
   * notu yerine SES şart: sürüşte ekrana bakılmaz (eski davranışta bu cümle
   * beyin dalında söyleniyordu ve yerel komutları ezip geçiyordu). */
  if (_pendingReask !== null) {
    speakMaviAnswer(_pendingReask, { isDriving: ctx?.isDriving === true });
    _armFollowUp(); // kullanıcı tekrar söyleyebilsin — mikrofon kendiliğinden açılır
  }
  push({
    status:      'error',
    error:       _pendingReask ?? `"${trimmed}" anlaşılamadı`,
    transcript:  trimmed,
    suggestions: result.suggestions,
  });
  setTimeout(() => {
    if (!isMaviTurnCurrent(turn)) return;   // MAVI-M5: yeni turun UI'sını ezme
    if (_current.status === 'error') push({ status: 'idle', error: null });
  }, 3500);
  completeMaviTurn(turn);   // dürüst "anlamadım" da bir TERMİNAL sonuçtur
  return false;
}

/* ── Public API (Listening) ───────────────────────────────── */

let _webRecognition: WebSpeechRecognition | null = null;

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
  /**
   * HIZLI warmup: wake selamı sonrası dinleme devrinde ses donanımı zaten aktif →
   * mikrofon açılış pipeline'ı kısalır (warmupFastMs). "Buradayım der demez dinleme".
   */
  fastWarmup?: boolean;
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
    // Wake selamı devri: TTS az önce çaldı → donanım aktif → hızlı warmup (pipeline kısa).
    const warmupMs = opts?.fastWarmup
      ? VOICE_TUNING.warmupFastMs
      : (isLowEndDevice() ? VOICE_TUNING.warmupLowEndMs : VOICE_TUNING.warmupMs);

    // Failsafe > warmup + maxListenMs (voiceTuning hiyerarşisi): aktif dinleme
    // ASLA buradan kesilmez; yalnız native'in hiç dönmediği anormal durumu toparlar.
    const sttFailsafe = setTimeout(() => {
      if (_current.status === 'listening') {
        console.warn(`[Voice] STT failsafe (${VOICE_TUNING.listenFailsafeMs}ms) — forcing idle`);
        void reportVoiceDiag('voice_timeout', { errorCode: 'ERR_LISTEN_FAILSAFE' });
        _emitVoiceEvent('timeout'); // MAVI3-1: typed timeout
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
        // HİBRİT STT: online + sağlıklıyken native Vosk yolu yakaladığı sesi WAV olarak
        // döndürür → JS bulut STT'ye (Groq Whisper / Gemini) gönderir (OEM doğruluk),
        // başarısızsa Vosk metni kalır (tek yakalama, çakışma yok). Telefon (Google STT)
        // yolu WAV üretmez → doğrudan Google metni kullanılır. Offline → returnAudio false.
        // Bulut STT kapısı: yalnız navigator.onLine. isAiNetHealthy() (Gemini devre
        // kesici) BİLİNÇLİ olarak çıkarıldı — Groq Whisper STT ayrı endpoint, Gemini
        // beyninin 429/hatası bulut TANIMAYI bloke etmemeli (saha: companion_groq
        // çalışıyor ama cloud STT hiç girmiyordu). Kötü ağı 6sn timeout + fail-soft toparlar.
        returnAudio: typeof navigator !== 'undefined' && navigator.onLine,
        // OFFLINE KOMUT GRAMMAR'ı (Yol A): internetsizken Vosk'u komut sözlüğüne kısıtla
        // → offline komut doğruluğu OEM-hissine çıkar. ONLINE'da verilmez (bulut tam
        // dikteyi çözer; grammar serbest cümleyi [unk]'a düşürürdü). Native full-vocab fallback'li.
        //
        // MAVI-STT-CONTEXT-GRAMMAR: sözlük artık BAĞLAMA göre daraltılır (bekleyen
        // onay → yalnız evet/hayır…, navigasyon/medya/araç → o sınıf + çapraz-bağlam
        // kaçış seti, kanıt yoksa TAM sözlük). Çevrimiçi davranış DEĞİŞMEDİ: aynı
        // kapı `resolveActiveGrammar` içinde `undefined` döndürür. Fail-soft:
        // bağlam/sözlük kurulamazsa genele düşer, o da olmazsa gramer verilmez.
        grammar: resolveActiveGrammar(
          typeof navigator !== 'undefined' && navigator.onLine, Date.now(),
        ),
        // Araç içi hassasiyet (voiceTuning.ts): kazanç + dinleme penceresi.
        // Native tarafta clamp'lenir; wake word bu opsiyonları geçmediği için etkilenmez.
        // Takip dinlemesi (sohbet modu) KISA pencere kullanır — sessizlikte hızlı idle.
        gain: VOICE_TUNING.nativeGainX,
        maxListenMs: opts?.followUpWindow ? VOICE_TUNING.followUpListenMs : VOICE_TUNING.maxListenMs,
      })
        .then(async (result) => {
          clearTimeout(sttFailsafe);
          _stopNativeVolumeListener();
          unduckMedia();
          const voskTranscript = result.transcript?.trim() ?? '';
          // STT-LATENCY-2: native Vosk yolunda geldiyse (Google yolu üretmez) türet +
          // yerel halkaya kaydet — YALNIZ ÖLÇÜM, hiçbir kararı etkilemez.
          if (result.sttTelemetry) {
            recordSttLatencyMetrics(deriveSttLatencyMetrics(result.sttTelemetry));
          }
          // HİBRİT STT: native WAV döndürdüyse (Vosk yolu + online) bulut STT dene.
          // Vosk BOŞ dönse bile WAV varsa denenir (Vosk kaçırdığını bulut yakalayabilir).
          const wav = (result as { audioWav?: string }).audioWav;
          let transcript = voskTranscript;
          let alts = result.alternatives;
          if (wav) {
            // Round-trip boyunca geri bildirim (mikrofon kapandı, işliyoruz).
            void reportVoiceDiag('voice_route', { route: 'cloud_try' });
            push({ status: 'processing', transcript: voskTranscript });
            try {
              const { cloudTranscribe } = await import('./cloudSttService');
              const cloud = await cloudTranscribe(wav);
              if (cloud && cloud.trim()) {
                transcript = cloud.trim();
                alts = [transcript]; // bulut güvenilir → Vosk alt adaylarını karıştırma
                void reportVoiceDiag('voice_route', { route: 'cloud_stt' });
              } else {
                // Bulut boş/anahtar yok → Vosk metni (varsa) kalır. Tanı: neden başarısız?
                void reportVoiceDiag('voice_route', { route: 'cloud_miss' });
              }
            } catch { void reportVoiceDiag('voice_route', { route: 'cloud_error' }); }
          }
          if (transcript) {
            _consecutiveEmptyCount = 0;
            _convSession = true; // sesli oturum aktif — cevap sonrası mikrofon yeniden açılır
            void reportVoiceDiag('voice_transcript', { transcriptLength: transcript.length });
            // CarLauncher bitti → anında "işleniyor" hissi ver, ardından processTextCommand çalışır
            push({ status: 'processing', transcript });
            void processTextCommand(transcript, undefined, alts);
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
          // STT-LATENCY-2: native reject(msg,code,data) → Capacitor err.data'ya kopyalar
          // (native-bridge.js: result.error alanları err üstüne taşınır). YALNIZ ÖLÇÜM.
          const sttTelemetry = (err as { data?: RawSttTelemetry } | null | undefined)?.data;
          if (sttTelemetry) {
            recordSttLatencyMetrics(deriveSttLatencyMetrics(sttTelemetry));
          }
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
    const w = _speechWindow();
    const SpeechRecognition = w.webkitSpeechRecognition || w.SpeechRecognition;
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

    _webRecognition.onresult = (event: WebSpeechResultEvent) => {
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

    _webRecognition.onerror = (event: WebSpeechErrorEvent) => {
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

/**
 * BARGE-IN: asistan cevabını KONUŞURKEN kullanıcı araya girer — çalan TTS anında
 * kesilir ve YENİ tur için mikrofon açılır (kullanıcı cevabın bitmesini beklemez).
 * startListening zaten ilk iş ttsCancel yapar; bu sarmalayıcı niyeti netleştirir,
 * eski cevabın takip/idle zamanlayıcısını temizler ve tek giriş noktası olur (UI +
 * testler). Zaten dinliyor/işliyorsa no-op (işleme turu yarıda kesilmez — yalnız
 * seslendirme aşamasında barge-in; brain çağrısı yarış oluşturmaz). */
export function interruptAndListen(): void {
  if (_current.status === 'listening' || _current.status === 'processing') return;
  void reportVoiceDiag('voice_route', { route: 'barge_in' });
  _clearConvIdle();
  startListening(); // içinde ttsCancel (çalan cevabı keser) + taze dinleme penceresi
}

export function stopListening(): void {
  // Kullanıcı isteğiyle durdurma — sohbet döngüsü her durumda biter
  // (TTS çalarken X'e basılması dahil; durum 'listening' olmayabilir).
  _endConvSession();
  _emitVoiceEvent('cancelled'); // MAVI3-1: açık kullanıcı iptali (push idle sonra emit eder)
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
  // MAVI3-1: lifecycle event durumunu da sıfırla (testler arası izolasyon).
  _voiceEventListeners.clear();
  _voiceSessionId = 0;
  _voiceGenerationId = 0;
  _lastEmittedPhase = null;
  _wakePending = false;
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
