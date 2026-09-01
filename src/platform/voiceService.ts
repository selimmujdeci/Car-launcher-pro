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
/* MAVI-F13/2 · SES KOMUT POLİTİKASI (SAF katman).
   `voiceService` bileşim kökü olarak KALIR; danıştığı saf kurallar (ACK sınıfı ·
   söylem sınıflandırması · n-best seçimi · AI-istek sezgisi · UI sıfırlama
   gecikmeleri) tek yerde toplandı. Bu modül OTORİTE DEĞİLDİR: hiçbir eylem
   yetkilendirmez, hiçbir durum tutmaz. */
import {
  isResultAckCommand, isProvisionalFeedback, isConversationEnd, looksLikeAiRequest,
  dedupeAlts, bestLocalParse, computeResetDelays,
  AFFIRM_RE, NEGATE_RE, CHAIN_SPLIT, STT_MAX_ALTERNATIVES,
} from './voice/voiceCommandPolicy';
import { tryOfflineConversation } from './offlineConversationEngine';
import { getConfig } from './performanceMode';
// MAVI-M6: `speakFeedback`/`speakAssistant` ARTIK DOĞRUDAN ÇAĞRILMAZ — normal
// kullanıcı cevabı `speakMaviAnswer` otoritesinden geçer (o da bunlara delege eder).
import {
  registerTtsEndListener, ttsCancel, isTtsSpeaking,
  /* MAVI-F12: uçuştaki sözün KANALI ve mikrofon yaşam döngüsü — barge-in hakemi
     kendi gerçeğini üretmez, bu kanonik gözlemleri OKUR. */
  isProtectedSpeechInFlight, isMicCaptureOpenDuringSpeech,
} from './ttsService';
import { duckMedia, unduckMedia } from './audioService';
import { resolveApiKey, type AIProvider, type AIVoiceResult, type VehicleContext } from './aiVoiceService';
// MAVI-M2: komut başına gerçek araç bağlamı (tek resolver — yeni araç-state kaynağı DEĞİL).
import { currentMaviVehicleContext, unknownMaviVehicleContext } from './assistant/maviVehicleContext';
// MAVI-M5: kullanıcı turu kimliği — geç dönen sağlayıcı cevabının eylem/konuşma yetkisini keser.
import {
  beginMaviTurn, completeMaviTurn, continueIfTurnActive, isMaviTurnCurrent,
  getActiveMaviTurn, supersedeActiveMaviTurn, type MaviTurnToken,
} from './assistant/maviTurn';
/* MAVI-F12: kesme ÖNERİSİ hakemi. Yeni bir ses otoritesi DEĞİLDİR — hüküm
   üretir, hükmü bu dosya uygular. Tur/eylem yetkisi `maviTurn`da KALIR. */
import {
  evaluateBargeIn, noteBargeInTtsStopRequested, noteBargeInListeningOpened,
} from './assistant/maviBargeIn';
// MAVI-M6: normal kullanıcı cevabının TEK seslendirme otoritesi (tur başına tek `answer`).
import {
  speakMaviAnswer, claimMaviAnswerStream, speakMaviAnswerChunk,
  releaseMaviAnswerStream, releaseMaviAnswerSlot,
} from './assistant/maviSpeech';
/* MAVI-F8: sürüş iş yükü bütçesi — konuşma YOĞUNLUĞUNU ayarlar, yetenek
   KAPATMAZ. Güvenlik/navigasyon/audio otoriteleri ETKİLENMEZ. */
import {
  currentMaviResponseBudget, currentMaviWorkload, responseBudgetFor,
  recordDeferredResponse, clearDeferredResponse, noteFollowUpSuppressed,
} from './assistant/maviWorkload';
/* MAVI-F9: kullanıcı uçuştaki PROAKTİF konuşmayı kestiyse bu GERÇEK bir
   sinyaldir. "Reddetti" DEĞİL "kesti" olarak kaydedilir; proaktif motorun
   öğrenme çarpanını besler ve `safety` sınıfını ASLA susturamaz. Bu çağrı
   yalnız SAYAÇtır — dinleme/TTS akışını hiçbir şekilde değiştirmez. */
import { noteProactiveInterrupted } from './assistant/proactivePolicyEngine';
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
import { fromSemanticResult, commandTypeToIntentType } from './intentEngine';
import { isInformationalCommand, answerInformational } from './voiceInfoService';
import { weatherQueryNamesCity } from './weatherService';
import { showToast } from './errorBus';
import { VOICE_TUNING } from './voiceTuning';
import { reportVoiceDiag } from './voiceDiagService';
import { pushTrail } from './diagnosticTrailCore';  // çekirdek: ağır obd/store zinciri GİRMESİN
import { deriveSttLatencyMetrics, recordSttLatencyMetrics, type RawSttTelemetry } from './sttLatencyTelemetry';
/* MAVI-F0: uçtan uca gecikme izi — YALNIZ ÖLÇÜM. Bayrak varsayılan KAPALI;
   kapalıyken her çağrı tek `if` ile döner ve üretim davranışı BİREBİR aynıdır.
   Bu modül hiçbir karar/akış/TTS/UI davranışını etkilemez. */
import {
  openMaviLatencyTrace, closeMaviLatencyTrace, markMaviLatency, markMaviLatencyDerived,
  bindMaviLatencyTurn, setMaviLatencyRoute, setMaviLatencyFailure, hasMaviLatencyMark,
  setMaviLatencyCapability,
  setMaviLatencyPlan,
  setMaviLatencyWorkload,
} from './assistant/maviLatencyTrace';
/* MAVI-F3 · KISMİ TRANSKRİPT AKIŞI. Bu modül HİÇBİR eylem yolu import etmez ve
   `processTextCommand`ı ÇAĞIRAMAZ: kısmi sonuç yalnız artımlı anlama ve endpoint
   kanıtı üretir. Eylem YALNIZ aşağıdaki nihai (final) transkript dalından doğar. */
import { getSttPartialDiagnostics } from './voice/sttPartialStream';
/* MAVI-F13/2 · SESLİ SOHBET OTURUMU RUNTIME'I — oturum bayrağı, takip dinlemesi
   ve iki emniyet penceresi TEK sahiptedir. OTORİTE DEĞİLDİR: mikrofonu ve UI'yı
   kökün portlarından sürer, hiçbir platform modülü import etmez. */
import {
  configureVoiceConversation, beginConversationSession, endConversationSession,
  isConversationSessionActive, armFollowUp as armVoiceFollowUp, isFollowUpArmed,
  disposeConversationRuntime,
  armConvIdleOnTtsEnd, clearConvIdle, onTtsEnd as onConversationTtsEnd,
} from './voice/voiceConversationRuntime';
/* MAVI-F13/2 · ALGI KATMANI RUNTIME'I — ses seviyesi · ducking · kısmi transkript
   oturumu. OTORİTE DEĞİLDİR: eylem çalıştırmaz, tur açmaz, konuşmaz. Kaynağı
   açan ile kapatan aynı sahiptedir; kök yalnız yaşam döngüsünü sürer. */
import {
  configureVoicePerception, stopVolumeMeter, startVolumeSimulation, stopVolumeSimulation,
  startNativeVolumeListener, stopNativeVolumeListener, applyAssistantDuck,
  openPartialTranscriptSession, closePartialTranscriptSession, notePartialTranscript,
  isSemanticEndpointCommandEnabled, disposeVoicePerception, resumeSuspendedAudioContext,
} from './voice/voicePerceptionRuntime';
/* MAVI-F4 · AKIŞ CEVABI. Bu modül token'ı KONUŞMAYA çevirir; eylem üretmez.
   Şalter kapalıyken (varsayılan) `beginResponseStream` null döner ve aşağıdaki
   akış hiç kurulmaz → `onToken` sağlayıcıya verilmez, istek akış kipine bile
   geçmez, davranış bugünküyle BİREBİR aynıdır. */
import {
  beginResponseStream, cancelActiveResponseStream, getResponseStreamDiagnostics,
  isMaviStreamingResponseEnabled, type ResponseStreamHandle,
} from './voice/maviResponseStream';
import { tickSpeechStream } from './voice/maviSpeechStream';
/* MAVI-F5 · CAPABILITY FABRIC — kontrollü giriş kapısı.
   Beynin eylem önerisi kanonik yürütücüye teslim edilmeden ÖNCE katalogdan
   çözülür ve TİPLİ doğrulamadan geçer. Kapı VARSAYILAN GÖLGE kiptedir: karar
   üretilir ve ÖLÇÜLÜR ama hiçbir eylem engellenmez → davranış bugünküyle
   BİREBİR aynıdır. Yetki bu kapıdan DOĞMAZ; güvenlik/onay kararı kanonik
   `maviActionAuthority` zincirinde kalır. */
import {
  evaluateLegacyIntent, takeLastCapabilityObservation, recordCapabilityPlan,
} from './capability/fabric/capabilityFabric';
/* MAVI-F6 · BİLEŞİK PLAN. Tek cümledeki birden fazla iş TEK tipli plan altında
   yönetilir. Plan katmanı hiçbir şey YÜRÜTMEZ: yürütme kanonik `_aiHandlers`
   hattından (→ `executeAIResult` → `dispatchIntent`) geçer ve yetki kanonik
   zincirde (`maviActionAuthority` → `AiSafetyGate` → onay) kalır. */
import type { PlanItemProposal } from './capability/fabric/capabilityPlan';
/* MAVI-F13/3 · BİLEŞİK PLAN MEKANİĞİ — beyin ve ayrıştırıcı yolları AYNI kodu
   kullanır (ikiz mekanik kaldırıldı). Modül OTORİTE DEĞİLDİR: konuşmaz, tur
   açmaz, yürütmez, kapı kurmaz; yalnız planı kurar/sıralar/çalıştırır ve
   sonucu bounded döner. Yürütme + gözlem + cevap slotu KÖKTE kalır. */
import {
  runMaviCompoundPlan, toLatencyPlanPayload,
} from './voice/maviCompoundPlanRuntime';
import { findByLegacyIntent } from './capability/fabric/carosCapabilityCatalog';
import { getVehicleActionDef, isVehicleEffectiveIntent } from './action/maviActionAuthority';

/* ── MAVI-F4 · AKIŞ BEKÇİSİ (açlık + asılmış seslendirme) ───────────────────
 * `maviSpeechStream` ve `maviResponseStream` kendi timer'larını KURMAZ (saflık
 * kilidi). Asılma kapılarının çalışması için zamanı DIŞARIDAN ilerleten bir
 * çağıran gerekir — o çağıran BURASIDIR (bileşim kökü).
 *
 * Bekçi olmasaydı: sağlayıcı ilk parçadan sonra ölürse ya da native TTS bitiş
 * bildirimini hiç göndermezse akış SONSUZA KADAR açık kalırdı → konuşma oturumu
 * kapanmaz, tek-`answer` slotu bırakılmaz ve **Mavi o oturumun kalanında tümüyle
 * susardı**. Kapılar (`tickSpeechStream`) yazılmıştı ama üretimde ÇAĞIRANI yoktu.
 *
 * SIFIR SIZINTI: tek bir interval, YALNIZ akış açıkken yaşar ve akışın HER
 * terminal yolundan (`onClosed`) sökülür. */
const STREAM_WATCHDOG_INTERVAL_MS = 1000;
let _streamWatchdog: ReturnType<typeof setInterval> | null = null;

function _armStreamWatchdog(): void {
  if (_streamWatchdog !== null) return;
  try {
    _streamWatchdog = setInterval(() => {
      try { tickSpeechStream(); } catch { /* fail-soft */ }
    }, STREAM_WATCHDOG_INTERVAL_MS);
  } catch { _streamWatchdog = null; }
}

function _disarmStreamWatchdog(): void {
  if (_streamWatchdog === null) return;
  try { clearInterval(_streamWatchdog); } catch { /* fail-soft */ }
  _streamWatchdog = null;
}

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
/*
 * MAVI-F13: dönüş tipi `void | Promise<void>` olarak GENİŞLETİLDİ (daraltılmadı).
 * Mevcut senkron handler'lar (`(cmd) => …`) hiç değişmeden çalışır ve
 * `dispatch`/`dispatchDriving` dönüşü BUGÜNKÜ GİBİ yok sayar. Genişletme YALNIZ
 * kanonik bileşik plan içindir: plan adımı yürütücünün gerçekten bitmesini
 * bekleyebilsin ve GÖZLEMİ (`takeLastCapabilityObservation`) okuyabilsin diye —
 * aksi hâlde zincir yolu gözlemi ASLA göremez ve "yaptım" iddiası kanıtsız kalır.
 */
export type CommandHandler = (cmd: ParsedCommand, ctx?: VehicleContext) => void | Promise<void>;
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

/* ── Dinleme oturumu durumu (KÖKÜN sahipliğinde) ───────────
 * MAVI-F13/2: ses seviyesi göstergesi, ducking ve MAVI-F3 kısmi transkript
 * oturumu `voice/voicePerceptionRuntime`e TAŞINDI — kaynağı açan ile kapatan
 * artık aynı sahiptedir (zero-leak). Burada KALAN iki alan dinleme OTURUMUNA
 * aittir ve `startListening`in dışında anlamı yoktur: */

// T507 ısınma: STT başlamadan önce bekletme zamanlayıcısı
let _nativeSttWarmupTimer: ReturnType<typeof setTimeout> | null = null;
// Ardışık boş transcript sayacı — 1. boşta hata basma, 2.'de bas
let _consecutiveEmptyCount = 0;


/* ── MAVI-F3 · KISMİ TRANSKRİPT AKIŞI ─────────────────────────
 * MAVI-F13/2: streaming ASR oturumu, yetenek çözümlemesi ve endpoint kanıtı
 * `voice/voicePerceptionRuntime`e TAŞINDI. Sözleşme DEĞİŞMEDİ: kısmi transkript
 * hiçbir eylemi tetiklemez, tek "komutu" mikrofonu erken kapatmaktır ve erken
 * bitirme VARSAYILAN KAPALIDIR. Bayrak adları ve şalter davranışı birebir aynı;
 * genel API korunsun diye buradan yeniden dışa verilir (tüketici:
 * `platformCoreMaviVoiceWiring` uzak bayrak enjeksiyonu). */
export {
  MAVI_F3_COMMAND_FLAG, MAVI_F3_REMOTE_FLAG, setMaviSemanticEndpointRemoteFlag,
} from './voice/voicePerceptionRuntime';

/**
 * CAROS LAB gözlem yüzeyi — MAVI-F4 akış cevabı. **METİN/TOKEN TAŞIMAZ.**
 * `enabled=false` (varsayılan) iken akış hiç kurulmaz; sayaçlar 0 kalır ve bu
 * bir kusur DEĞİLDİR — o hâlde davranış bugünküyle birebir aynıdır.
 */
export function getMaviResponseStreamDiagnostics(): ReturnType<typeof getResponseStreamDiagnostics> {
  return getResponseStreamDiagnostics();
}

/** MAVI-F4 akış şalteri açık mı (LAB/tanı). */
export function isMaviResponseStreamingEnabled(): boolean {
  return isMaviStreamingResponseEnabled();
}

/** CAROS LAB gözlem yüzeyi — **METİN TAŞIMAZ** (yalnız sayaç · enum · uzunluk). */
export function getMaviStreamingAsrDiagnostics(): ReturnType<typeof getSttPartialDiagnostics> & {
  readonly commandFlagEnabled: boolean;
} {
  return { ...getSttPartialDiagnostics(), commandFlagEnabled: isSemanticEndpointCommandEnabled() };
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
      endConversationSession();
      push({ status: 'idle', error: null });
    }
  }, PROCESSING_FAILSAFE_MS);
}

/* ── Sesli sohbet oturumu ─────────────────────────────────────
 * MAVI-F13/2: sohbet oturumu durumu (`_convSession` · `_followUpArmed` ·
 * `_convIdleOnTtsEnd`) ve emniyet zamanlayıcılarının TAMAMI
 * `voice/voiceConversationRuntime`e TAŞINDI. Kökte İKİNCİ kopya YOKTUR —
 * kök oturumun durumunu ancak runtime'a SORARAK öğrenir.
 *
 * KÖKTE KALAN: `registerTtsEndListener` aboneliği. TTS bitişi yalnız sohbet
 * döngüsünü değil, F0 gecikme izini ve `speech_end` olayını da kapatır; abonelik
 * bileşim kökünün işidir ve TEK olmalıdır. Kök telemetriyi kapatır, sohbet
 * kararını runtime'a devreder. */

/* Portlar: runtime hiçbir platform modülü import ETMEZ — hepsi buradan iner.
   Bu çağrı kaynak AÇMAZ (timer/abonelik/native YOK). */
configureVoiceConversation({
  startListening:   (o) => startListening(o),
  currentStatus:    () => _current.status,
  setUiFollowUp:    (on) => { if (_current.followUp !== on) push({ followUp: on }); },
  goIdleFromSuccess: () => { if (_current.status === 'success') push({ status: 'idle' }); },
  /* ⚠️ Bağlamalar TEMBEL sarılır (`() => fn()`), doğrudan referansla DEĞİL.
     Doğrudan referans, modül YÜKLENİRKEN dış bağlamayı okur ve o an mevcut
     olmayan bir dışa-aktarım varsa (ör. kısmi mock'lanmış `ttsService`) modül
     yükleme aşamasında PATLAR — oysa bu fonksiyonlar yalnız zamanlayıcı geri
     çağrılarında çağrılır. Sarma, taşımadan önceki çağrı-zamanı davranışını
     BİREBİR korur ve testlere yeni mock yüzeyi getirmez. */
  isTtsSpeaking:    () => isTtsSpeaking(),
  isVoicePaused:    () => _voiceCogPaused,
  responseBudgetAllowsFollowUp: () => currentMaviResponseBudget().allowFollowUp,
  noteFollowUpSuppressed: () => noteFollowUpSuppressed(),
});

// TTS bitti → (A) kurulu takip varsa mikrofonu yeniden aç, yoksa
//             (B) takipsiz sohbet cevabıysa idle'a dön (sabit timer YOK).
registerTtsEndListener(() => {
  // MAVI-INSTRUMENTATION-1: ttsService'in TÜM yolları (native/web/klip · başarı/hata/iptal)
  // bu tek noktaya toplanır (_notifyTtsEnd) — speech_end HER durumda burada kapanır.
  _emitVoiceEvent('speech_end');
  /* MAVI-F0: iz YALNIZ nihai cevap seslendirmeye verildiyse kapanır. Bu bildirim
   * SEMANTİK ACK ("Araçtan okuyorum") bitişinde de gelir; `tts_request` kontrolü
   * olmadan ACK'in bitişi turu erken kapatır ve ana metrik hiç ölçülemezdi. */
  if (hasMaviLatencyMark('tts_request')) {
    markMaviLatency('response_complete');
    closeMaviLatencyTrace('completed');
  }
  // Sohbet döngüsü kararı SAHİBİNE devredilir (tek TTS-bitiş aboneliği korunur).
  onConversationTtsEnd();
});

/* ── Asistan ducking'i ────────────────────────────────────────
 * MAVI-F13/2: `voice/voicePerceptionRuntime`e TAŞINDI. Karar kuralı DEĞİŞMEDİ
 * (yalnız BİZ duraklattıysak sürdür · sohbet turları arasında aç-kapa yapma) —
 * ama artık takip dinlemesinin kurulu olup olmadığını KENDİ bilmez, kökten
 * PORT ile sorar. Genel API korunur (tüketici: `commandExecutor` medya dalı). */
export { cancelAssistantDuck } from './voice/voicePerceptionRuntime';


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
    applyAssistantDuck(prevStatus, _current.status);
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

/* ── MAVI-F13/2 · ALGI RUNTIME'I PORT BAĞLAMASI ───────────────
 * Bileşim kökü, algı katmanına ihtiyaç duyduğu üç yeteneği verir. Bu çağrı
 * HİÇBİR kaynak açmaz (timer/abonelik/native çağrı YOK) — yalnız üç saf
 * closure'ı kaydeder; import yan etkisi kuralı korunur.
 *
 * DURUM SAHİPLİĞİ: `volumeLevel` ve `followUp` alanları KÖKÜN `VoiceState`i
 * içinde KALIR. Algı runtime'ı onları KOPYALAMAZ, portlardan okur/yazar →
 * aynı olgu iki yerde tutulmaz. */
configureVoicePerception({
  setVolumeLevel:     (level) => push({ volumeLevel: level }),
  isFollowUpEngaged:  () => isFollowUpArmed() || _current.followUp === true,
  webSpeechAvailable: () => {
    const w = _speechWindow();
    return !!(w.webkitSpeechRecognition || w.SpeechRecognition);
  },
});

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

/* MAVI-F13/2: hesap SAF katmanda (`voiceCommandPolicy`); kök yalnız yapılandırmayı
   okuyup geçirir → üretilen sayılar taşımadan önceki değerlerle BİREBİR aynı. */
function getResetDelays(): Record<string, number> {
  return computeResetDelays(getConfig().enableRecommendations);
}

/* ── MAVI-M3 / M6 · ACK SINIFLANDIRMASI ───────────────────────────────────
 * MAVI-F13/2: iki saf sınıflandırma (`isResultAckCommand` ·
 * `isProvisionalFeedback`) ve listeleri `voice/voiceCommandPolicy`e TAŞINDI —
 * durum tutmuyorlar, yan etki üretmiyorlar ve orkestrasyonun parçası değiller.
 * Kararın KENDİSİ değişmedi; yalnız sahibi netleşti. Genel API korunsun diye
 * `isResultAckCommand` buradan yeniden dışa verilir (mevcut tüketiciler:
 * `useVoiceCommandHandler` · guard testleri). */
export { isResultAckCommand } from './voice/voiceCommandPolicy';


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
  endConversationSession();
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
      tier: isProvisionalFeedback(cmd.type) ? 'progress' : 'answer',
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
  endConversationSession(); // araç komutu → sohbet döngüsü biter (yalnız companion sohbeti sürer)
  if (isInformationalCommand(cmd.type)) {
    void answerInformational(cmd.type, turn ?? null);
  } else if (!isResultAckCommand(cmd.type)) {
    // MAVI-M3 + M6: sonuç-ACK komutlarında parser metni KONUŞULMAZ; kalanlar TEK otoriteden.
    speakMaviAnswer(cmd.feedback, {
      isDriving: true,
      tier: isProvisionalFeedback(cmd.type) ? 'progress' : 'answer',
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
  endConversationSession(); // araç sorgusu = araç komutu → sohbet döngüsü başlatmaz (dispatch ile aynı)
  push({ status: 'processing', transcript: sensorQuery, error: null, suggestions: [] });
  /* MAVI-F2: SEMANTİK ACK — filler değil. EXTENDED/manufacturer hedeflerde okuma
   * 12 sn'ye kadar sürebilir; cümle kullanıcıya cevabın NEREDEN geleceğini söyler
   * (araçtan, hafızadan/buluttan değil) ve okumanın BİTTİĞİNİ İDDİA ETMEZ. */
  speakMaviAnswer('Araçtan okuyorum.', { tier: 'progress' });
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
/* ══════════════════════════════════════════════════════════════════════════
 * MAVI-F6 · BİLEŞİK PLAN YÜRÜTÜCÜSÜ (beyin yolu)
 *
 * ── NEDEN BURADA ────────────────────────────────────────────────────────────
 * Bileşik komut BUGÜNE KADAR yalnız YEREL ayrıştırıcı yolunda vardı
 * (`tryHandleChain` → bağlaç bölmesi → `dispatchChain`). Beyin yolu tek intent
 * üretiyordu: "Eve rota aç, müziği kıs, annemi ara" cümlesinde TEK iş yapılıp
 * diğerleri SESSİZCE düşüyordu. Bu fonksiyon o boşluğu kanonik planla kapatır.
 *
 * ── SINIRLAR ────────────────────────────────────────────────────────────────
 *  · YENİ YÜRÜTÜCÜ YOK: her adım mevcut `_aiHandlers` hattından geçer.
 *  · YETKİ YOK: onay/güvenlik/hareket kararı kanonik zincirdedir.
 *  · TEK CEVAP: plan başında `answer` slotu tutulur → adım başına gelen
 *    yürütücü geri bildirimleri tek-cevap sözleşmesiyle SUSTURULUR ve sonda
 *    GÖZLEME DAYALI tek birleşik cümle söylenir (duplicate speech yasağı).
 * ════════════════════════════════════════════════════════════════════════ */

/** Bileşik plan sonucu — çağıran turu buna göre kapatır. */
type PlanRunOutcome = 'handled' | 'not_applicable';

async function _runBrainPlan(
  semantics: readonly SemanticResultLike[],
  turn: MaviTurnToken | null,
  ctx: VehicleContext | undefined,
  provider: string,
): Promise<PlanRunOutcome> {
  /* Adım önerileri — her biri F5 kapısından GEÇER. Katalog dışı intentler
   * (REMEMBER · SHOW_WEATHER …) plana LEGACY adım olarak girer: kaybolmazlar,
   * ama gözlem tavanları olmadığı için başarı İDDİA EDİLMEZ. */
  const proposals: PlanItemProposal[] = [];
  const bySlot: SemanticResultLike[] = [];

  for (const sem of semantics) {
    const intentName = String(sem.intent ?? '');
    if (!intentName) continue;
    const decision = evaluateLegacyIntent(
      intentName,
      sem as unknown as Readonly<Record<string, unknown>>,
      typeof sem.confidence === 'number' ? sem.confidence : 0.85,
      'llm_proposal',
    );
    if (!decision.allow) continue;                 // kapı reddetti → adım plana GİRMEZ
    /* ONAY GERÇEĞİ KANONİK DEFTERDEN OKUNUR — katalog alanı yalnız bilgidir.
     * İkisi çelişirse KANONİK olan kazanır (ikinci politika kurulmaz). */
    const canonicalConfirm = isVehicleEffectiveIntent(intentName as never)
      && getVehicleActionDef(intentName as never)?.requiresConfirmation === true;
    const def = findByLegacyIntent(intentName);
    proposals.push({
      capabilityId: decision.def?.capabilityId ?? `legacy.${intentName.toLowerCase()}`,
      operation: decision.def?.operation ?? 'run',
      parameters: decision.args,
      legacyIntent: intentName,
      requiresConfirmation: canonicalConfirm || def?.requiresConfirmation === true,
    });
    bySlot.push(sem);
  }

  if (proposals.length < 2) return 'not_applicable';   // bileşik değil → eski yol

  /* TEK CEVAP SLOTU — adım geri bildirimleri burada susturulur. Slot
   * alınamazsa (tur eskimiş ya da cevap zaten verilmiş) plan HİÇ çalışmaz:
   * yarım iş yapıp susmaktansa hiç başlamamak dürüsttür.
   * ⚠️ SLOT SAHİPLİĞİ KÖKTE: plan mekaniği (`maviCompoundPlanRuntime`) cevap
   * slotunu ne tutar ne bırakır — konuşma otoritesi oraya SIZAMAZ. */
  if (!claimMaviAnswerStream(turn)) return 'not_applicable';

  try {
    /* MAVI-F13/3: plan MEKANİĞİ tek yerde (`runMaviCompoundPlan`). Yürütme,
     * gözlem kanalı ve tur kapısı KÖKTE kalır ve porttan geçirilir. */
    const run = await runMaviCompoundPlan<SemanticResultLike>({
      steps: proposals.map((proposal, i) => ({ proposal, payload: bySlot[i] })),
      planIdPrefix: 'p',
      turnId: turn?.id ?? null,
      isTurnCurrent: () => (turn ? isMaviTurnCurrent(turn) : true),
      execute: async (sem) => {
        const aiCompat: AIVoiceResult = {
          intent:     sem.intent as AIVoiceResult['intent'],
          payload:    {},
          confidence: typeof sem.confidence === 'number' ? sem.confidence : 0.85,
          feedback:   typeof sem.feedback === 'string' ? sem.feedback : '',
        };
        /* Alanlar `fromSemanticResult` köprüsüyle taşınsın diye HAM semantic
         * kullanılır — plan parametreleri yalnız doğrulama/telemetri içindir. */
        const bridged = _bridgeSemanticToAi(sem, aiCompat);
        takeLastCapabilityObservation();            // yuvayı temizle (bayat okuma yok)
        const pending: Array<Promise<void>> = [];
        _aiHandlers.forEach((fn) => { pending.push(Promise.resolve(fn(bridged, ctx))); });
        await Promise.all(pending);
        /* Gözlem `commandExecutor`ın F5 kanalından gelir (tavan UYGULANMIŞ).
         * Ardışık yürütme olduğu için yuva yarışa girmez — sıra KİLİTLİ. */
        return takeLastCapabilityObservation();
      },
    });

    setMaviLatencyPlan(toLatencyPlanPayload(run.summary));
    /* LAB gözlemi — **ADET ve bounded sınıf**; adım metni/parametresi GİRMEZ. */
    recordCapabilityPlan({
      itemCount:       run.summary.itemCount,
      dependencyCount: run.summary.dependencyCount,
      resultClass:     run.summary.resultClass,
    });
    void reportVoiceDiag('voice_route', { route: 'companion_plan', provider });

    /* GÖZLEME DAYALI TEK CÜMLE — sahte toplu başarı YOK. Metin boşsa hiçbir
     * şey söylenmez (uydurma cevap üretilmez). KONUŞMA KÖKTEN çıkar. */
    if (run.outcomeText) speakMaviAnswerChunk(run.outcomeText, { turn });
    return 'handled';
  } catch {
    return 'handled';                               // yarım plan eski yola DÜŞMEZ
  } finally {
    releaseMaviAnswerStream();
    releaseMaviAnswerSlot();
  }
}

/** Semantic alanlarını AI köprüsüne taşır (kanonik `fromSemanticResult` girdisi). */
function _bridgeSemanticToAi(
  sem: SemanticResultLike, base: AIVoiceResult,
): AIVoiceResult {
  const bridged = fromSemanticResult(sem as never, String(sem.query ?? ''));
  if (!bridged) return base;
  return {
    intent:     bridged.type as AIVoiceResult['intent'],
    payload:    bridged.payload as Record<string, unknown>,
    confidence: base.confidence,
    feedback:   base.feedback,
  };
}

/** Beyin adımının yapısal görünümü (modül kenarı açmadan). */
interface SemanticResultLike {
  readonly intent?: string;
  readonly confidence?: number;
  readonly feedback?: string;
  readonly query?: string;
}


/* ══════════════════════════════════════════════════════════════════════════
 * MAVI-F13 · YEREL ZİNCİR ARTIK KANONİK PLANDAN GEÇER
 *
 * ── ÖNCEKİ DURUM (ölçüldü) ──────────────────────────────────────────────────
 * Repoda İKİ bileşik yürütücü vardı:
 *   1) `dispatchChain` — yerel ayrıştırıcı yolu. Parser'ın İYİMSER metnini
 *      **yürütmeden ÖNCE** tek parça hâlinde seslendiriyor, sonra komutları
 *      sırayla dağıtıyordu. Gözlem YOK → "yaptım" iddiası kanıtsızdı ve
 *      F7 (`PROPOSED ≠ EXECUTED ≠ OBSERVED`) sözleşmesinin DIŞINDAYDI.
 *   2) `_runBrainPlan` — beyin yolu. Kanonik `CapabilityPlan` + gözleme dayalı
 *      tek cümle.
 * Aynı işi yapan iki yol = iki gerçeklik. F13 bunu TEK yola indirir.
 *
 * ── ŞİMDİ ───────────────────────────────────────────────────────────────────
 * Ayrıştırıcı **yalnız ÖNERİ üreticisidir** (silinmedi, yetkisi alındı):
 *   parse → PlanItemProposal[] → buildCapabilityPlan → runCapabilityPlan
 *         → adım başına MEVCUT `_commandHandlers` yürütücüsü → gözlem
 *         → renderPlanOutcome (tek cümle)
 *
 * ── DAVRANIŞ SINIRI (bilinçli) ──────────────────────────────────────────────
 *  · **YENİ YÜRÜTÜCÜ YOK.** Adımlar bugünkü `_commandHandlers` hattından geçer.
 *  · **YÜRÜTÜLEN KÜME DEĞİŞMEZ.** Öneri imzasına `slot` konur → planın
 *    tekrar/çakışma eleme kuralları bu yolda adım DÜŞÜREMEZ. Ayrıştırıcı
 *    doğrulanmış parametre üretmediği için eksik imzayla eleme yapmak,
 *    kullanıcının gerçekten istediği ikinci komutu SESSİZCE düşürürdü.
 *  · **SES SIRASI DÜZELDİ:** cümle artık yürütmeden ÖNCE değil SONRA kurulur.
 *    Gözlem yoksa sessizlik, başarı iddiasından doğrudur. Parser metni öneridir;
 *    `REQUESTED != EXECUTED != OBSERVED` sözleşmesini delerek kullanıcıya sonuç
 *    diye dönemez.
 * ════════════════════════════════════════════════════════════════════════ */

async function dispatchChain(
  cmds: ParsedCommand[], ctx?: VehicleContext, turn?: MaviTurnToken | null,
): Promise<void> {
  // MAVI-INSTRUMENTATION-1: seçilen action(lar) dispatch edilmeden HEMEN önce.
  _emitVoiceEvent('executing');
  endConversationSession(); // komut zinciri = araç komutu → takip dinlemesi yok

  // MAVI-M5: zincirin HER adımı kendi güncellik kapısından geçer — plan
  // yürütücüsünün `isTurnCurrent` portu bunu adım başına uygular.
  const _chainTurn = turn ?? getActiveMaviTurn();

  /* Öneriler — her biri F5 kapısından GEÇER. Katalog dışı komutlar plana
   * LEGACY adım olarak girer (`evaluateLegacyIntent` LEGACY_FALLBACK'e daima
   * izin verir): kaybolmazlar, ama gözlem tavanları olmadığı için başarı
   * İDDİA EDİLMEZ. */
  const proposals: PlanItemProposal[] = [];
  const bySlot: ParsedCommand[] = [];
  cmds.forEach((cmd) => {
    const slot = proposals.length;                 // öneri indeksi = plan itemId indeksi
    const intentName = commandTypeToIntentType(cmd.type);
    const decision = evaluateLegacyIntent(
      intentName,
      { sourceText: cmd.raw, ...(cmd.extra ?? {}) } as Readonly<Record<string, unknown>>,
      cmd.confidence,
      'local_parser',
    );
    if (!decision.allow) return;                   // kapı reddetti → adım plana GİRMEZ
    proposals.push({
      capabilityId: decision.def?.capabilityId ?? `legacy.${intentName.toLowerCase()}`,
      operation:    decision.def?.operation ?? 'run',
      /* `slot` İMZA AYIRICISIDIR (PII değil, kullanıcı metni TAŞIMAZ): yürütülen
       * kümeyi bugünkü davranışla birebir tutar — bkz. yukarıdaki DAVRANIŞ SINIRI. */
      parameters:   { slot },
      legacyIntent: intentName,
      /* ── ONAY YETKİSİ BU KATMANDA DEĞİLDİR (F13 · ikinci politika yasağı) ──
       * Bu yol için onay kararını ZATEN İKİ kanonik otorite veriyor:
       *   1) SIRA düzeyinde `classifySequenceConfirmationPolicy` (P1) — bu
       *      fonksiyon çağrılmadan HEMEN ÖNCE koşar ve çoklu-onay içeren
       *      zinciri fail-closed reddeder;
       *   2) EYLEM düzeyinde `maviActionAuthority` → `dispatchIntent` →
       *      `needs_confirmation` → bekleyen eylem (`setPendingAction`).
       * Adımı burada `requiresConfirmation` işaretlemek plan yürütücüsünü
       * ÜÇÜNCÜ bir onay politikası yapardı: adım hiç dağıtılmaz, kanonik
       * `needs_confirmation` yolu HİÇ çalışmaz ve kullanıcıya onay sorusu
       * SORULMAZDI ("müziği aç ve aracı kilitle" → müzik çalar, kilit sessizce
       * askıda kalırdı). Gözlem yine dürüsttür: kanonik yol
       * `needs_confirmation` döndürünce adım `REQUESTED` olarak sınıflanır. */
      requiresConfirmation: false,
    });
    bySlot.push(cmd);
  });

  /* TEK CEVAP SLOTU — adım geri bildirimleri burada susturulur (F6 deseni).
   * Slot alınamazsa (tur eskimiş / cevap zaten verilmiş) plan HİÇ çalışmaz.
   * ⚠️ SLOT SAHİPLİĞİ KÖKTE (bkz. `_runBrainPlan`). */
  const _claimed = claimMaviAnswerStream(_chainTurn);
  let _chainOutcome: VoiceExecutionResult = 'success';
  try {
    if (!_claimed) return;
    /* MAVI-F13/3: plan MEKANİĞİ tek yerde (`runMaviCompoundPlan`) — beyin
     * yoluyla AYNI kod. Yürütme, gözlem kanalı ve tur kapısı KÖKTE. */
    const run = await runMaviCompoundPlan<ParsedCommand>({
      steps: proposals.map((proposal, i) => ({ proposal, payload: bySlot[i] })),
      planIdPrefix: 'c',
      turnId: _chainTurn?.id ?? null,
      /* Eski döngüdeki kapı BİREBİR korunur: her adımdan önce
       * `continueIfTurnActive(..., 'action')`. Devralınan tur kalan adımları
       * yan etki BAŞLATMADAN iptal eder. */
      isTurnCurrent: () => (_chainTurn ? continueIfTurnActive(_chainTurn, 'action') : true),
      execute: async (cmd) => {
        pushHistory(cmd);
        takeLastCapabilityObservation();            // yuvayı temizle (bayat okuma yok)
        const pending: Array<Promise<void>> = [];
        _commandHandlers.forEach((fn) => { pending.push(Promise.resolve(fn(cmd, ctx))); });
        await Promise.all(pending);
        /* Gözlem `commandExecutor`ın F5 kanalından gelir (tavan UYGULANMIŞ).
         * Ardışık yürütme olduğu için yuva yarışa girmez — sıra KİLİTLİ. */
        return takeLastCapabilityObservation();
      },
    });

    setMaviLatencyPlan(toLatencyPlanPayload(run.summary));
    /* LAB gözlemi — **ADET ve bounded sınıf**; adım metni/parametresi GİRMEZ. */
    recordCapabilityPlan({
      itemCount:       run.summary.itemCount,
      dependencyCount: run.summary.dependencyCount,
      resultClass:     run.summary.resultClass,
    });
    void reportVoiceDiag('voice_route', { route: 'parser_plan' });

    /* GÖZLEME DAYALI TEK CÜMLE. `UNKNOWN` için parser fallback'i YOKTUR:
     * öneri metnini sonuç diye konuşmak #1047 sahte onay sınıfıdır. */
    if (run.outcomeText) speakMaviAnswerChunk(run.outcomeText, { turn: _chainTurn });
  } catch (e) {
    _chainOutcome = 'failed';
    throw e; // orijinal davranış korunur: hata YUTULMAZ, yalnız sonuç önce kaydedilir
  } finally {
    if (_claimed) { releaseMaviAnswerStream(); releaseMaviAnswerSlot(); }
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
async function tryHandleChain(
  trimmed: string,
  ctx?: VehicleContext,
  turn?: MaviTurnToken | null,
): Promise<boolean> {
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
    endConversationSession();
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
  await dispatchChain(cmds, ctx, turn ?? null);
  return true;
}

/**
 * Sohbet yanıtı — komut dispatch yok, sadece TTS + UI güncelleme.
 * `armFollowUp=true` YALNIZ companion (Yol Arkadaşım) sohbet modunda verilir:
 * cevap bitince mikrofon otomatik yeniden açılır (sürekli sohbet döngüsü).
 * Companion kapalıyken (offline_chat) eski davranış korunur — döngü yok.
 */
function _dispatchConversation(response: string, raw: string, armFollowUp: boolean): void {
  /* ── MAVI-F8 · KRİTİK İŞ YÜKÜNDE SERBEST SOHBET ERTELENİR ────────────────
   * `CRITICAL` (geri manevra · kritik güvenlik durumu · bilişsel CRITICAL) →
   * serbest sohbet cevabı SESLENDİRİLMEZ. Bu YALNIZ sohbet yolunu kapsar:
   * komut sonucu, güvenlik uyarısı ve navigasyon anonsu bu yoldan GEÇMEZ ve
   * etkilenmez (yetenek kapatma YOK).
   *
   * F2 KORUMASI: yerine "şimdi yola odaklan" gibi bir KALIP CÜMLE ÜRETİLMEZ —
   * o, kaldırdığımız filler'ın kılık değiştirmiş hâli olurdu. Erteleme bir
   * DURUMDUR: bounded kayda yazılır, süresi dolunca DÜŞER ve **kendiliğinden
   * tekrar oynatılmaz** (bayat cevap konuşulmaz → DEFERRED ≠ COMPLETED). */
  try {
    const _budget = currentMaviResponseBudget();
    if (!_budget.allowChat) {
      endConversationSession();
      recordDeferredResponse(getActiveMaviTurn()?.id ?? null, _budget.level, Date.now());
      setMaviLatencyWorkload({ deferred: true });
      push({ status: 'success', transcript: raw, error: null, suggestions: [], lastCommand: null });
      return;
    }
  } catch { /* fail-soft: bütçe okunamazsa ESKİ davranış (cevap konuşulur) */ }

  // armFollowUp=true  → cevap bitince mikrofon yeniden açılır (sürekli sohbet).
  // armFollowUp=false → cevap bitince idle (TTS-end dinleyicisi). Sabit 3.5s timer
  //                     KALDIRILDI: UI durumu gerçek konuşma süresiyle senkron.
  if (armFollowUp) armVoiceFollowUp();
  else             endConversationSession();
  // followUp GERÇEKTEN kurulamadıysa (pause yarışı / oturum yok / takipsiz) idle'ı
  // TTS bitişine bağla — aksi halde re-listen yolu idle'ı devralır. Böylece durum
  // hiçbir koşulda 'success'te asılı kalmaz (eski 3.5s timer'ın emniyet rolü).
  if (!isFollowUpArmed()) armConvIdleOnTtsEnd();
  // Sohbet/serbest cevap: klip → online TTS → native (motorsuz ünitede de sesli)
  speakMaviAnswer(response, { channel: 'assistant' });   // MAVI-M6: tek otorite
  push({ status: 'success', transcript: raw, error: null, suggestions: [], lastCommand: null });
}

/* MAVI-F13/2: sohbet kapatma sözü sınıflandırması `voiceCommandPolicy`e taşındı
   (saf regex + TR normalizasyonu; söylem kümesi DEĞİŞMEDİ). */

/* ── Ara TTS geri bildirimleri ────────────────────────────────── */

/* MAVI-F2 · YAPAY ARA SÖZ İMHA EDİLDİ (I11).
 *
 * Burada `THINKING_FEEDBACK_DELAY_MS` (1500 ms), `THINKING_PHRASES`
 * ("Bakıyorum hemen…" · "Bir saniye…" · "Kontrol ediyorum…") ve `_speakThinking`
 * VARDI: beyin 1500 ms'yi aşarsa rastgele bir bekletme cümlesi seslendiriliyordu.
 * ÜÇÜ DE KALDIRILDI — yorumla susturulmadı, kod olarak SİLİNDİ.
 *
 * NEDEN (ölçüldü, tercih değil):
 *  · Cümle hiçbir bilgi taşımıyordu; yalnız seri hattın gecikmesini örtüyordu.
 *  · Tipik tur zaten 1500 ms'yi aştığından filler neredeyse HER TURDA çalışıyordu →
 *    Mavi her cümleye bir bekletme sözüyle başlayan bir robot gibi duyuluyordu.
 *  · Mekanizma kendisi bir hata kaynağıydı: geç ateşleyen ara söz BAŞLAMIŞ cevabı
 *    KESİYORDU (aşağıdaki KESİLME FIX notu bu yüzden yazılmıştı).
 *
 * Gecikme artık ÖRTÜLMEZ; F0 izi (`maviLatencyTrace`) ile ÖLÇÜLÜR ve F3/F4'te
 * streaming ile YAPISAL olarak azaltılır. Gerçek ve süren bir iş başladığında
 * söylenen SEMANTİK ACK ("Hava durumunu alıyorum") bu yasağın DIŞINDADIR —
 * ayrım `assistant/maviAckPolicy.ts` içinde tanımlıdır ve `maviSpeech`
 * `progress` katmanında zorunlu kılar.
 */

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

/* ── API ANAHTARI YOK yönlendirmesi ──────────────────
 * MAVI-F13/2: anahtar-kelime sezgisi (`looksLikeAiRequest` + token listesi +
 * TR normalizasyonu) `voiceCommandPolicy`e taşındı. Sezginin KENDİSİ ve token
 * listesi DEĞİŞMEDİ; burada kalan yalnız soğuma penceresi DURUMUdur. */

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
/* MAVI-F13/2: onay/ret söylem regexleri `voiceCommandPolicy`de (AFFIRM_RE · NEGATE_RE). */
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

/* ── n-best (çok adaylı ASR) ─────────────────────────
 * MAVI-F13/2: aday temizleme (`dedupeAlts`) ve en-iyi-parse seçimi
 * (`bestLocalParse`) `voiceCommandPolicy`e taşındı — ikisi de SAF. Seçim
 * kuralı (onarılmış varyant YALNIZ kesin daha yüksek güvende kazanır) ve
 * aday tavanı DEĞİŞMEDİ. Genel API korunsun diye ikisi de buradan
 * eski adlarıyla yeniden dışa verilir (tüketici: `voiceNbest` testleri). */
export { dedupeAlts as _dedupeAlts, bestLocalParse as _bestLocalParse } from './voice/voiceCommandPolicy';

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
  /* MAVI-F8: YENİ tur → bekleyen erteleme DÜŞER. Erteleme bir kuyruk DEĞİLDİR;
   * eski bir cevabın sonradan konuşulması (bayat öneri) yasaktır. */
  try { clearDeferredResponse(); } catch { /* fail-soft */ }
  /* MAVI-M4-LAB-2: zincirin BAŞLANGIÇ aşaması ("komut alındı"). Korelasyon
   * anahtarı burada doğar; sonraki kapı/sonuç/konuşma aşamaları aynı `turnId`
   * altında gruplanır. GİZLİLİK: transcript METNİ değil yalnız UZUNLUĞU geçer
   * (ham komut gözlem katmanına ASLA girmez). Kayıt fail-soft. */
  recordMaviActionStage({
    stage: 'turn_started', status: 'accepted',
    reason: `len:${trimmed.length}`, turnId: turn.id,
  });
  /* MAVI-F0: gecikme izini bu turun kimliğine bağla (korelasyon anahtarı, M4-LAB-2
   * ile AYNI `turnId`). Metin girişinden (buton) gelen çağrıda açık iz yoktur →
   * damga "sahipsiz" sayılır ve ekranda GÖRÜNÜR (uydurulmuş iz üretilmez). */
  bindMaviLatencyTurn(turn.id);
  /* MAVI-F8: turun iş yükü ve bütçe sınıfı F0 izine BİR KEZ damgalanır.
   * Yeni telemetri sistemi YOK — mevcut bounded ize alan eklendi. Ham sürüş
   * verisi (hız · mesafe · konum) GEÇMEZ; yalnız enum ve ADET. */
  try {
    const _wl = currentMaviWorkload(Date.now());
    setMaviLatencyWorkload({
      level: _wl.level,
      evidenceCount: _wl.evidence.length,
      budgetClass: responseBudgetFor(_wl.level).klass,
    });
  } catch { /* fail-soft: telemetri komut akışını ETKİLEMEZ */ }

  let ctx: VehicleContext;
  try {
    ctx = ctxIn ?? currentMaviVehicleContext();
  } catch {
    ctx = unknownMaviVehicleContext();   // fail-closed: bilinmeyen, park DEĞİL
  }

  // n-best alternatifleri (top ilk). Metin girişinde (buton) tek eleman kalır.
  const alts = dedupeAlts(alternatives, trimmed);

  void reportVoiceDiag('voice_processing', { transcriptLength: trimmed.length });

  // Bilişsel Pause: PROTECTION/CRITICAL modda AI işleme ve TTS atlanır.
  // SESSİZ return YOK: native akış bu çağrıdan önce 'processing' bastığı için
  // durum geçişsiz dönüş UI'yı "İşleniyor"da sonsuza dek asılı bırakıyordu.
  // Kullanıcıya görünür terminal durum + kısa açıklama verilir (TTS bilinçli
  // olarak yok — pause modunda TTS de atlanır).
  if (_voiceCogPaused) {
    void reportVoiceDiag('voice_cognitive_pause', { transcriptLength: trimmed.length });
    endConversationSession();
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
  markMaviLatency('route_start');                   // MAVI-F0

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
      endConversationSession();
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
        endConversationSession(); // onay diyaloğu bitti — komut akışı sohbet döngüsü başlatmaz
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
  if (isConversationSessionActive() && isConversationEnd(trimmed)) {
    _lastCommandTime = now;
    void reportVoiceDiag('voice_route', { route: 'conversation_end' });
    endConversationSession();
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
  if (await tryHandleChain(trimmed, ctx, turn)) return true;

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
  const result = bestLocalParse(alts);

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
    endConversationSession();
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
    setMaviLatencyRoute('critical_bypass');                  // MAVI-F0
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
    setMaviLatencyRoute('sensor_local_bypass');              // MAVI-F0
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
  if (chain.length === 0 && looksLikeAiRequest(trimmed) && (result.command?.confidence ?? 0) < 1.0) {
    _lastCommandTime = now;
    endConversationSession();
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
  /* #697 — beyin "karar veremedim" dediyse (REASK) metni burada bekletilir;
   * yerel zincirin HİÇBİR dalı tutmazsa (e) dalında SÖYLENİR. Tur-yereldir:
   * bir sonraki tura sızmaz. */
  let _pendingReask: string | null = null;
  if (aiUsable) try {
    const _provider = await import('./companion/companionChatProvider');
    const { tryCompanionBrain } = _provider;
    // MAVI-M5 · KAPI B: dinamik import sürerken yeni tur başlamış olabilir.
    if (!continueIfTurnActive(turn, 'provider_result')) return false;
    /* MAVI-F1: presence AYNI dinamik import'tan okunur (yeni modül kenarı YOK).
     * Presence bir YETENEK kararı DEĞİLDİR — yalnız F0 izine hangi tonda
     * ölçtüğümüzü yazar; akışın hiçbir dalını değiştirmez.
     *
     * ERİŞİM DAHİL try/catch İÇİNDE (bilinçli): sağlayıcı modülünün yüzeyi
     * beklenenden farklı olabilir (eski chunk · kısmi mock · ileride kaldırılan
     * export). ÖLÇÜM ALANI OKUNAMADI diye Mavi'nin BEYNİ düşemez — bu yüzden
     * hem property erişimi hem çağrı korumalıdır ve başarısızlık sessizce
     * `undefined` presence'a iner (iz "presence yok" gösterir, uydurmaz). */
    let _presence: 'companion' | 'assistant' | undefined;
    try {
      const readPresence = (_provider as { currentPresenceMode?: () => 'companion' | 'assistant' })
        .currentPresenceMode;
      if (typeof readPresence === 'function') _presence = readPresence();
    } catch { _presence = undefined; }
    /* MAVI-F2: BURADA GECİKME TIMER'I YOKTUR.
     * Beyin ne kadar sürerse sürsün Mavi araya içeriksiz bir cümle SOKMAZ —
     * kullanıcı konuşur, Mavi doğrudan gerçek cevaba geçer. Gecikme örtülmez,
     * F0 izinde `brain_request_start → brain_complete` olarak ÖLÇÜLÜR. */
    markMaviLatency('brain_request_start');          // MAVI-F0

    /* ── MAVI-F4 · AKIŞ CEVABI ────────────────────────────────────────────
     * Uygun yolda (şalter açık · park hâli · sağlayıcı TOKEN_STREAM) Mavi
     * cevabın TAMAMINI beklemeden konuşmaya başlar. Uygun değilse `null` döner
     * ve aşağısı bugünkü yolu AYNEN kullanır — hiçbir dal değişmez.
     *
     * `turn` KOMUT GİRİŞİNDE yakalanmış token'dır: akış eskimiş turda konuşamaz
     * (F3 stale sözleşmesi akışa da uygulanır). */
    /* MAVI-F8: akış cevabı YÜKSEK iş yükünde HİÇ AÇILMAZ (HIGH/CRITICAL).
     * Açılmışken iş yükü yükselirse F4'ün kendi kapısı devreye girer: yeni
     * parça alınmaz, kuyruktaki parça bitirilir (kelime ortasından kesme YOK). */
    let _wlAllowsStream = true;
    try { _wlAllowsStream = currentMaviResponseBudget().allowStreaming; } catch { _wlAllowsStream = true; }
    const _stream: ResponseStreamHandle | null = !_wlAllowsStream ? null : beginResponseStream({
      turn,
      provider: 'gateway',
      isDriving: ctx?.isDriving === true,
      cancelUpstream: () => { /* sağlayıcı iptali gateway timeout'una bırakılır */ },
      onClosed: _disarmStreamWatchdog,
    });
    if (_stream) _armStreamWatchdog();
    const brain = await tryCompanionBrain(trimmed, {
      ...(_stream ? { onToken: _stream.onToken } : {}),
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
    /* KESİLME FIX (saha 2026-07-23) ARTIK GEREKSİZ — kökü kesildi. Burada bekleyen
     * ara söz timer'ı iptal ediliyordu, çünkü 1.5 sn eşiğinde geç ateşleyen filler
     * BAŞLAMIŞ cevap TTS'ini kesiyordu. MAVI-F2 ile timer'ın kendisi kaldırıldığı
     * için iptal edilecek bir yarış da kalmadı (yara bandı değil, kaynak çözüm).
     * MAVI-F0: sağlayıcı turu bitti (başarı · null · timeout — hepsi süre ödedi). */
    markMaviLatency('brain_complete');
    /* MAVI-F4: sağlayıcı bitti → tamponda kalan güvenli metin konuşulur ve
     * konuşma oturumu kapanır. Akış YAPISAL çıktı gördüyse (action/web) hiç
     * konuşmamıştır ve `answer` slotunu BIRAKMIŞTIR → aşağıdaki kanonik yol
     * (executor sonucu / `_dispatchConversation`) normal çalışır. */
    if (_stream) _stream.complete();

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
        setMaviLatencyRoute(brain.route, provider, _presence);  // MAVI-F0 + F1 presence
        _pendingReask = brain.response;
      } else if (brain.kind === 'chat') {
        _lastCommandTime = now;
        void reportVoiceDiag('voice_route', { route: brain.route, provider });
        setMaviLatencyRoute(brain.route, provider, _presence);  // MAVI-F0 + F1 presence
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
        /* ── MAVI-F5 · CAPABILITY KAPISI ──────────────────────────────────
         * Katalogdan çözülebilen öneriler TİPLİ doğrulamadan geçer; katalog
         * dışı olanlar `LEGACY_FALLBACK` sayılır ve eski yol AYNEN çalışır.
         * Gölge kipte `allow` DAİMA true'dur (ölçüm var, engelleme yok).
         *
         * PII: yalnız intent adı, rota ve bounded sebep kaydedilir — parametre
         * DEĞERLERİ (kişi adı · adres · sensör metni) bu katmana GİRMEZ. */
        const _fabric = evaluateLegacyIntent(
          intent.type,
          brainAction.semantic as unknown as Readonly<Record<string, unknown>>,
          brainAction.semantic.confidence,
          'llm_proposal',
        );
        setMaviLatencyCapability({
          route: _fabric.route,
          capabilityId: _fabric.def?.capabilityId ?? null,
          operation: _fabric.def?.operation ?? null,
          availability: _fabric.availability,
          validation: _fabric.failure ?? 'OK',
          enforced: _fabric.enforced,
        });
        if (!_fabric.allow) {
          /* ZORLAYICI kipte kapı reddetti. Tur SESSİZCE ÖLMEZ: beyin önerisi
           * tüketilmez ve akış aşağıdaki YEREL ZİNCİRE düşer (yerel parser +
           * offline sohbet) — kullanıcı cevapsız kalmaz. */
          void reportVoiceDiag('voice_route', { route: 'capability_blocked', provider });
        } else {
        /* ── MAVI-F6 · BİLEŞİK PLAN ────────────────────────────────────────
         * Beyin birden fazla iş döndürdüyse tek tipli plan altında yürütülür.
         * Plan kurulamazsa (tek adım · kapı redleri sonrası <2 adım · slot
         * alınamadı) akış AŞAĞIDAKİ tekil yola AYNEN düşer — regresyon yok. */
        /* SAVUNMACI OKUMA (zorunlu): `semantics` F6'da EKLENDİ. Sağlayıcı
         * yüzeyi beklenenden farklı olabilir — eski sürüm, kısmi mock, ileride
         * değişen alan. Alan yoksa tek adımlı listeye düşülür; okunamadığı
         * için Mavi'nin EYLEM YOLU DÜŞEMEZ (bu blok dıştaki `try` tarafından
         * yutulup sessiz fallback'e giderdi). */
        const _maybe = (brainAction as unknown as { semantics?: unknown }).semantics;
        const _semantics: readonly unknown[] = Array.isArray(_maybe)
          ? (_maybe as readonly unknown[])
          : [brainAction.semantic];
        const _planOutcome = _semantics.length > 1
          ? await _runBrainPlan(_semantics as never, turn, ctx, provider)
          : 'not_applicable';
        if (_planOutcome === 'handled') {
          endConversationSession();
          completeMaviTurn(turn);
          return true;
        }
        void reportVoiceDiag('voice_route', { route: 'companion_action', provider });
        setMaviLatencyRoute('companion_action', provider, _presence); // MAVI-F0 + F1 presence
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
        endConversationSession(); // araç komutu → sohbet döngüsü başlatmaz
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
        }   // ── MAVI-F5 kapı `else` bloğunun sonu
      }
      // intent köprülenemedi (geçersiz/loş güven) → zincire devam
    }
  } catch { /* companion hattı asla komut akışını kıramaz — zincire devam */ }

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
    armVoiceFollowUp(); // soru bitince mikrofon açılır — kullanıcı evet/hayır'ı SÖYLEYEBİLİR
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
    setMaviLatencyRoute('offline_chat');                     // MAVI-F0
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
  endConversationSession(); // terminal hata — sohbet döngüsü biter, pencere kapanabilir
  /* #697 — ÇIKMAZ YOK, AMA EN SONDA: online beyin karar veremedi VE yerel
   * zincirin hiçbir dalı tutmadı → tekrar-rica burada seslendirilir. Ekran
   * notu yerine SES şart: sürüşte ekrana bakılmaz (eski davranışta bu cümle
   * beyin dalında söyleniyordu ve yerel komutları ezip geçiyordu). */
  if (_pendingReask !== null) {
    speakMaviAnswer(_pendingReask, { isDriving: ctx?.isDriving === true });
    armVoiceFollowUp(); // kullanıcı tekrar söyleyebilsin — mikrofon kendiliğinden açılır
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

  /* MAVI-F0: yeni dinleme izi. Açık bir iz varsa TUR İZOLASYONU için `superseded`
   * ile kapanır → iki turun damgaları karışamaz. Bayrak kapalıysa no-op. */
  openMaviLatencyTrace();
  /* MAVI-F3: kısmi transkript oturumu — izle AYNI anda açılır ki "ilk kısmi"
   * damgası bu dinlemeye düşsün. Açık bir oturum varsa iptal edilmiş sayılır
   * (tur izolasyonu): eski oturumun uçuşta kalan kısmi olayları düşer. */
  openPartialTranscriptSession();

  // İLK İŞ: asistan konuşuyorsa kendi sesini kes — mikrofonla çakışmasın
  // (kullanıcı asistanın sözünü kesip konuşmaya geçebilsin). ttsCancel idempotent:
  // konuşan bir şey yoksa zararsız no-op. TTS-end bildirimi tetiklemez (takip/idle
  // mantığını yanlışlıkla ilerletmez).
  ttsCancel();
  // Yeni etkileşim bekleyen takipsiz-idle'ı geçersiz kılar (eski cevabın TTS
  // bitişi bu turu idle'a düşürmesin).
  clearConvIdle();

  // Beyni ÖNDEN ısıt: kullanıcı konuşurken model uyanır → gerçek komut sıcak gelir
  // (~1sn), soğuk-başlangıç (~7sn) timeout'u aşıp REASK üretmez. Fire-and-forget.
  void _warmupBrain();

  void reportVoiceDiag('voice_start');

  // AudioContext donma koruması — sahibi algı runtime'ıdır (MAVI-F13/2).
  resumeSuspendedAudioContext();

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
        setMaviLatencyFailure('listen_failsafe');    // MAVI-F0
        closeMaviLatencyTrace('timeout');
        closePartialTranscriptSession('CANCELLED');                // MAVI-F3
        stopNativeVolumeListener();
        unduckMedia();
        endConversationSession();
        push({ status: 'idle' });
      }
    }, VOICE_TUNING.listenFailsafeMs);

    const doSTT = () => {
      // Mikrofon donanımı gerçekten açılıyor. Durum warmup başında zaten 'listening'
      // basıldıysa bu no-op'tur (idle→listening tek sefer duck tetikler); warmup=0
      // yolunda görsel geri bildirimi burada basar.
      push({ status: 'listening', error: null, suggestions: [], volumeLevel: 0 });
      /* MAVI-F12: yeni dinleme penceresi GERÇEKTEN açıldı. Kesme kabul
       * edilmediyse defter bu damgayı yok sayar (sahte ölçüm ÜRETİLMEZ). */
      noteBargeInListeningOpened(performance.now());
      void reportVoiceDiag('voice_listening');
      startNativeVolumeListener();
      duckMedia();

      /* MAVI-F0: bu damga native `listenRequestedAt` ankoruyla HİZALIDIR — native
       * telemetrinin delta alanları (`speechEndDetectedAtMs` vb.) buradan türetilir. */
      markMaviLatency('stt_request_start');

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
          stopNativeVolumeListener();
          unduckMedia();
          markMaviLatency('stt_result');            // MAVI-F0
          /* MAVI-F3: sağlayıcı NİHAİ sonucu verdi → kısmi oturum burada kapanır ve
           * kısmi metin bellekten SİLİNİR. Bundan sonrası kanonik final yoludur;
           * eylem yetkisi YALNIZ buradan doğar. */
          closePartialTranscriptSession('FINAL_PROVIDER');
          const voskTranscript = result.transcript?.trim() ?? '';
          // STT-LATENCY-2: native Vosk yolunda geldiyse (Google yolu üretmez) türet +
          // yerel halkaya kaydet — YALNIZ ÖLÇÜM, hiçbir kararı etkilemez.
          if (result.sttTelemetry) {
            recordSttLatencyMetrics(deriveSttLatencyMetrics(result.sttTelemetry));
            /* MAVI-F0 · TÜRETİLMİŞ TABAN: konuşma başlangıcı/bitişi JS'te GÖZLENMEZ
             * (native VAD kararıdır). `sttLatencyTelemetry` ZATEN ölçtüğü deltaları
             * burada `stt_request_start` ankoruna ekleyerek türetiyoruz — yeni ölçüm
             * YAPILMAZ, mevcut ölçüm uçtan uca zincire BAĞLANIR. Damgalar `derived`
             * işaretlenir ve ekranda ölçülmüş gibi sunulmaz. Google STT yolunda
             * telemetri gelmez → `speech_end` HİÇ damgalanmaz (sahte taban üretilmez). */
            const rawStt = result.sttTelemetry as RawSttTelemetry;
            if (typeof rawStt.firstSpeechDetectedAtMs === 'number') {
              markMaviLatencyDerived('speech_start', 'stt_request_start', rawStt.firstSpeechDetectedAtMs);
            }
            if (typeof rawStt.speechEndDetectedAtMs === 'number') {
              markMaviLatencyDerived('speech_end', 'stt_request_start', rawStt.speechEndDetectedAtMs);
            }
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
            markMaviLatency('cloud_stt_start');     // MAVI-F0
            try {
              const { cloudTranscribe } = await import('./cloudSttService');
              const cloud = await cloudTranscribe(wav);
              markMaviLatency('cloud_stt_end');     // MAVI-F0 (boş dönse de süre ödendi)
              if (cloud && cloud.trim()) {
                transcript = cloud.trim();
                alts = [transcript]; // bulut güvenilir → Vosk alt adaylarını karıştırma
                void reportVoiceDiag('voice_route', { route: 'cloud_stt' });
              } else {
                // Bulut boş/anahtar yok → Vosk metni (varsa) kalır. Tanı: neden başarısız?
                void reportVoiceDiag('voice_route', { route: 'cloud_miss' });
              }
            } catch {
              markMaviLatency('cloud_stt_end');     // MAVI-F0: hata da süre ödedi
              setMaviLatencyFailure('cloud_stt_error');
              void reportVoiceDiag('voice_route', { route: 'cloud_error' });
            }
          }
          if (transcript) {
            _consecutiveEmptyCount = 0;
            beginConversationSession(); // sesli oturum aktif — cevap sonrası mikrofon yeniden açılır
            void reportVoiceDiag('voice_transcript', { transcriptLength: transcript.length });
            // CarLauncher bitti → anında "işleniyor" hissi ver, ardından processTextCommand çalışır
            push({ status: 'processing', transcript });
            void processTextCommand(transcript, undefined, alts);
          } else {
            // Boş transcript: kullanıcı sessiz kaldı → sohbet döngüsü biter.
            closeMaviLatencyTrace('no_speech');     // MAVI-F0
            endConversationSession();
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
          stopNativeVolumeListener();
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
            // MAVI-F0: iptal ile sessizlik AYRI sonuç sınıflarıdır (istatistik ikisini de dışlar).
            closeMaviLatencyTrace(/cancel|abort/i.test(msg) ? 'cancelled' : 'no_speech');
            closePartialTranscriptSession('CANCELLED');            // MAVI-F3
            endConversationSession(); // sessizlik → sohbet döngüsü biter
            push({ status: 'idle' });
            return;
          }
          console.error('Native Speech Error:', err);
          setMaviLatencyFailure('stt_start');       // MAVI-F0
          closeMaviLatencyTrace('error');
          closePartialTranscriptSession('CANCELLED');              // MAVI-F3
          endConversationSession();
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
    noteBargeInListeningOpened(performance.now());   // MAVI-F12
    void reportVoiceDiag('voice_listening');
    startVolumeSimulation();   // sentetik dalga — mikrofonu tanımaya bırak (çekişme yok)
    const w = _speechWindow();
    const SpeechRecognition = w.webkitSpeechRecognition || w.SpeechRecognition;
    if (!SpeechRecognition) {
      stopVolumeSimulation();
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
        stopVolumeSimulation();
        closePartialTranscriptSession('FINAL_PROVIDER');   // MAVI-F3: kanonik final → kısmi oturum kapanır
        beginConversationSession(); // sesli oturum aktif — cevap sonrası mikrofon yeniden açılır
        void reportVoiceDiag('voice_transcript', { transcriptLength: finalText.trim().length });
        push({ status: 'processing', transcript: finalText.trim() });
        void processTextCommand(finalText.trim());
      } else if (live) {
        // Kısmi metin — kullanıcıya "seni duyuyorum" geri bildirimi (hâlâ dinlemede)
        push({ status: 'listening', transcript: live });
        /* MAVI-F3: web interim sonucu da AYNI kanıt kapısından geçer (tek pipeline).
         * Akustik sessizlik web'de JS'e AÇILMADIĞI için ölçüm geçilmez → yetenek
         * `STREAMING_TEXT_ONLY`dir ve semantik endpoint YAPISAL OLARAK çalışmaz;
         * karar platformun kendi endpoint'ine (`isFinal`) bırakılır. */
        notePartialTranscript(live);
      }
    };

    _webRecognition.onerror = (event: WebSpeechErrorEvent) => {
      console.error('Web Speech Error:', event.error);
      stopVolumeSimulation();
      endConversationSession(); // web STT hatası/sessizlik → sohbet döngüsü biter
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
      stopVolumeSimulation();
      if (_current.status === 'listening') push({ status: 'idle' });
    };

    try {
      _webRecognition.start();
      console.warn('[Voice/web] start() çağrıldı — lang:', _webRecognition.lang);
    } catch (e) {
      console.error('[Voice/web] start() HATA:', e);
      stopVolumeSimulation();
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

  /* ── MAVI-F12 · KESME HAKEMİ ─────────────────────────────────────────────
   * Kesme artık koşulsuz DEĞİLDİR. Hakem yalnız bir HÜKÜM verir; yürütme
   * aşağıda, bugünkü zincirin TAMAMIYLA aynı sırada kalır.
   *
   * Tek yeni davranış: **korunan ses kesilmez.** Güvenlik/tehlike/navigasyon
   * sözü seslendirilirken kullanıcının Mavi'yi kesme isteği o kanalı
   * SUSTURAMAZ (spec §20.2 · K1). Söz kısa sürer; kullanıcı hemen ardından
   * yine kesebilir. Diğer her durumda **kullanıcı kazanır** (§9.8).
   *
   * Mavi konuşmuyorken hüküm `REJECTED_NOT_SPEAKING`tir — bu bir hata DEĞİL,
   * "ortada kesilecek bir şey yok" demektir; akış bugünkü gibi sürer. */
  const _bargeAtMs = performance.now();
  const _verdict = evaluateBargeIn(
    { evidence: 'EXPLICIT_USER', atMs: _bargeAtMs },
    {
      ttsSpeaking: isTtsSpeaking(),
      protectedSpeech: isProtectedSpeechInFlight(),
      captureOpenOnThisPath: isMicCaptureOpenDuringSpeech(),
    },
  );
  if (_verdict.reason === 'REJECTED_PROTECTED_AUDIO') {
    void reportVoiceDiag('voice_route', { route: 'barge_in_protected' });
    return;                       // korunan kanal susturulmaz — mikrofon da açılmaz
  }

  void reportVoiceDiag('voice_route', { route: 'barge_in' });
  /* MAVI-F0: kesme, kesilen turun İZİNE yazılır (yeni ize değil) — barge-in
   * gecikmesi ancak kesilen turun `first_audio_requested` damgasıyla ölçülür. */
  markMaviLatency('barge_in');
  closeMaviLatencyTrace('cancelled');
  /* MAVI-F3: barge-in eski oturumu iptal eder. Bu kritiktir — kesilen turun
   * kısmi transkripti YENİ turun kanıtına karışamaz. */
  closePartialTranscriptSession('CANCELLED');
  /* MAVI-F4 · İPTAL ZİNCİRİ: kullanıcı araya girdi → bekleyen konuşma parçaları
   * TEMİZLENİR, uçuştaki ses KESİLİR ve sağlayıcı akışı DURDURULUR. Eski turun
   * yarım kalan cevabı sonradan KONUŞMAYA BAŞLAYAMAZ. */
  cancelActiveResponseStream();
  /* MAVI-F8: barge-in bekleyen ertelemeyi de düşürür — kullanıcı araya girdiyse
   * eski turun ertelenmiş cevabı artık geçerli DEĞİLDİR. */
  try { clearDeferredResponse(); } catch { /* fail-soft */ }
  /* MAVI-F9: uçuşta bir PROAKTİF konuşma varsa kullanıcı onu KESTİ. */
  try { noteProactiveInterrupted(performance.now()); } catch { /* fail-soft */ }
  /* MAVI-F12 · ESKİ TUR STALE OLUR. Bu satır F12'nin kapattığı GERÇEK açıktır:
   * `supersedeActiveMaviTurn()` M5'te yazılmış ve testlenmişti ama ÜRETİMDE HİÇ
   * ÇAĞRILMIYORDU. Barge-in eski turun eylem/konuşma yetkisini ancak KULLANICI
   * YENİ KOMUTU SÖYLEYİNCE (`beginMaviTurn`) kaybettiriyordu; arada dönen geç
   * sağlayıcı sonucu hâlâ konuşabiliyor ve "cevap tamamlandı" gibi
   * davranabiliyordu. Artık yetki kesme ANINDA düşer → geç gelen token/chunk/
   * callback eski cevabı DİRİLTEMEZ (F4 stale sözleşmesiyle aynı hat).
   * Yalnız KABUL EDİLEN kesmede çağrılır; idempotenttir ve tamamlanmış turu
   * geri almaz. */
  if (_verdict.accepted) {
    try { supersedeActiveMaviTurn(); } catch { /* fail-soft */ }
  }
  clearConvIdle();
  startListening(); // içinde ttsCancel (çalan cevabı keser) + taze dinleme penceresi
  /* MAVI-F12 · DÜRÜST GECİKME: bu damga `ttsCancel()` İSTEĞİNİN gönderildiği
   * andır — hoparlörün fiilen sustuğu an DEĞİL (native `TextToSpeech.stop()`
   * bir isteği kuyruklar). Akustik susma yalnız cihazda ölçülebilir. */
  if (_verdict.accepted) noteBargeInTtsStopRequested(performance.now());
}

export function stopListening(): void {
  // Kullanıcı isteğiyle durdurma — sohbet döngüsü her durumda biter
  // (TTS çalarken X'e basılması dahil; durum 'listening' olmayabilir).
  endConversationSession();
  _emitVoiceEvent('cancelled'); // MAVI3-1: açık kullanıcı iptali (push idle sonra emit eder)
  /* MAVI-F9: açık kullanıcı iptali uçuştaki proaktif konuşmayı da keser. */
  try { noteProactiveInterrupted(performance.now()); } catch { /* fail-soft */ }
  closeMaviLatencyTrace('cancelled');               // MAVI-F0
  closePartialTranscriptSession('CANCELLED');                     // MAVI-F3: kısmi kanıt iptalle ÖLÜR
  cancelActiveResponseStream();                     // MAVI-F4: kuyruk + TTS + sağlayıcı akışı
  // Warmup timer status 'listening'e ulaşmadan önce de iptale açık olmalı
  if (_nativeSttWarmupTimer !== null) {
    clearTimeout(_nativeSttWarmupTimer);
    _nativeSttWarmupTimer = null;
  }
  if (_current.status === 'listening') {
    if (!isNative) _stopWebRecognition();
    stopVolumeMeter();
    if (isNative) {
      stopNativeVolumeListener();
    } else {
      stopVolumeSimulation();
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
  endConversationSession();
  cancelActiveResponseStream();   // MAVI-F4: akış cevabı da koşulsuz durur
  if (_nativeSttWarmupTimer !== null) {
    clearTimeout(_nativeSttWarmupTimer);
    _nativeSttWarmupTimer = null;
  }
  /* MAVI-F13/2: algı kaynaklarının TAMAMI sahibinden sökülür — kısmi transkript
     oturumu + abonelik · sentetik dalga timer'ı · native RMS listener'ı ·
     AudioContext + MediaStream + animationFrame. Kökte tek tek saymak yerine
     sahibin tek kapısı çağrılır (biri unutulamaz). */
  disposeVoicePerception();
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
  /* MAVI-F13/2: sohbet oturumu zamanlayıcılarının sıfırlaması SAHİBİNDEDİR —
     kökte tek tek saymak yerine tek kapı çağrılır (biri unutulamaz). */
  disposeConversationRuntime();
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
