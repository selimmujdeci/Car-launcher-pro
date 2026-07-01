/**
 * Wake Word Service — pasif dinleme.
 *
 * İKİ KAYNAK (useLayoutServices önceliği belirler):
 *  - COMPANION ("Yol Arkadaşım"): wake sözleri asistan ADINDAN türetilir
 *    (resolveWakeWords — "Mavi" / "Hey Mavi" / özel cümle). Tetiklenince
 *    kısa selamlama TTS'i ("Buradayım.") → TTS bitince aktif dinleme.
 *  - LEGACY ("hey car"): eski Voice Assistant toggle'ı — davranış aynen
 *    korunur (selamlama yok, doğrudan dinleme).
 *
 * Pasif dinleme UX: pasif beklerken voiceService durumuna DOKUNULMAZ —
 * ekranda "Dinliyorum" pill'i yalnız AKTİF dinlemede görünür.
 *
 * Güvenlik: PROTECTION/CRITICAL (isVoicePaused) modda wake tetiklense bile
 * sohbet/eğlence başlamaz — tetik sessizce yutulur.
 *
 * Native Android — İKİ KATMAN (Faz 5):
 *  1. GRAMMAR MODU (tercih): CarLauncher.startWakeWordListening — native,
 *     kalıcı, grammar-kısıtlı Vosk thread'i (yalnız wake sözleri + [unk]).
 *     Tetik 'wakeWord' EVENT'iyle düşer (partial sonuç — endpoint beklenmez,
 *     <200ms refleks). Pasif modda DUCK YOK, half-duplex native tarafta
 *     (TTS/aktif STT sürerken thread mikrofonu bırakır — kendini duymaz).
 *  2. ESKİ DÖNGÜ (fallback): startSpeechRecognition promise döngüsü — eski
 *     APK'larda / grammar başlatılamazsa davranış aynen korunur. voiceService
 *     mikrofonu kullanırken döngü mikrofon AÇMAZ — çakışma yok.
 */

import { useState, useEffect } from 'react';
import { isNative } from './bridge';
import { startListening, isVoicePaused, getVoiceSnapshot } from './voiceService';
import {
  matchesWakeTranscript,
  normalizeWakeText,
  resolveCompanionIdentity,
  resolveWakeWords,
} from './companion/companionIdentity';
import { VOICE_TUNING } from './voiceTuning';
import { useStore } from '../store/useStore';

/* ── Tipler ──────────────────────────────────────────────── */

export type WakeWordStatus = 'disabled' | 'idle' | 'listening' | 'detected' | 'error';

export interface WakeWordState {
  status:      WakeWordStatus;
  enabled:     boolean;
  /** Aktif wake sözleri (normalize). Companion modda asistan adından türer. */
  wakeWords:   string[];
  /** Companion kaynağı mı (selamlama + kelime-sınırlı eşleşme). */
  companion:   boolean;
  lastTrigger: number | null;
  errorMsg:    string | null;
  /**
   * Saha teşhisi: pasif döngünün duyduğu son transcript'ler (en yeni başta,
   * max 5). "Uyanmıyor" şikayetinde Vosk'un gerçekte NE duyduğu buradan
   * görülür (chrome inspect / dev inspector).
   */
  lastHeard:   string[];
}

/* ── Legacy uyandırma kelimeleri ("hey car" sistemi) ─────── */

const DEFAULT_WAKE_WORD = 'hey car';

const LEGACY_WAKE_PATTERNS = [
  'hey car',
  'hey kar',
  'hi car',
  'tamam araç',
  'tamam arac',
  'araç asistan',
  'arac asistan',
];

function matchesLegacy(transcript: string, words: readonly string[]): boolean {
  const norm = transcript.toLowerCase().trim();
  if (words.some((w) => w && norm.includes(w.toLowerCase()))) return true;
  return LEGACY_WAKE_PATTERNS.some((p) => norm.includes(p));
}

/* ── Wake selamlaması (companion) ────────────────────────── */

// Deterministik rotasyon (Math.random yok — testler kararlı, tekrar hissi az)
const WAKE_GREETINGS = ['Buradayım.', 'Dinliyorum.', 'Seni dinliyorum.'];
let _greetCounter = 0;

/* ── Modül durumu ────────────────────────────────────────── */

const INITIAL: WakeWordState = {
  status:      'disabled',
  enabled:     false,
  wakeWords:   [DEFAULT_WAKE_WORD],
  companion:   false,
  lastTrigger: null,
  errorMsg:    null,
  lastHeard:   [],
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
let _detectedTimer: ReturnType<typeof setTimeout> | null = null; // onWakeWordDetected gecikmesi
let _nativeLoopActive = false;
/** Faz 5: native grammar modu aktif mi + event listener handle'ı. */
let _grammarMode = false;
let _grammarHandle: { remove: () => Promise<void> } | null = null;

function clearRestartTimer(): void {
  if (_restartTimer) { clearTimeout(_restartTimer); _restartTimer = null; }
}

function _matches(transcript: string): boolean {
  return _state.companion
    ? matchesWakeTranscript(transcript, _state.wakeWords)  // TR-normalize + kelime sınırı
    : matchesLegacy(transcript, _state.wakeWords);
}

function onWakeWordDetected(): void {
  // PROTECTION/CRITICAL: wake tetiklense bile sohbet/eğlence BAŞLAMAZ.
  // Sessizce yut — pasif döngü sürer, sürücü dikkat yükü altında rahatsız edilmez.
  if (isVoicePaused()) return;

  push({ status: 'detected', lastTrigger: Date.now() });

  if (_state.companion) {
    // Kısa selamlama → TTS bitince aktif dinleme (TTS konuşurken STT açılmaz;
    // selamlama mikrofona karışmaz). Lazy import — modül yükünde TTS zinciri yok.
    const greeting = WAKE_GREETINGS[_greetCounter % WAKE_GREETINGS.length];
    _greetCounter++;
    void import('./ttsService')
      .then(({ ttsSpeak }) => {
        ttsSpeak(greeting, { rate: 1.05, onEnd: () => { startListening(); } });
      })
      .catch(() => { startListening(); }); // TTS yoksa selamlamasız dinle (fail-soft)
  } else {
    startListening();
  }

  // Önceki timer varsa iptal et (hızlı art arda tetiklenme koruması)
  if (_detectedTimer) { clearTimeout(_detectedTimer); }
  _detectedTimer = setTimeout(() => {
    _detectedTimer = null;
    if (_state.status === 'detected') push({ status: 'listening' });
  }, 1500);
}

function stopWebListening(): void {
  clearRestartTimer();
  if (_recognition) {
    try { _recognition.abort(); } catch { /* noop */ }
    _recognition = null;
  }
}

/* ── Native Android impl. ────────────────────────────────── */

/**
 * Döngü jenerasyonu: ayar değişiminde (disable→enable) ESKİ döngü
 * instance'ının in-flight promise'i çözülünce yeniden zincirlemesini keser —
 * aksi hâlde iki paralel döngü native STT'yi karşılıklı iptal edip wake'i
 * tamamen sağırlaştırıyordu.
 */
let _loopGen = 0;
/** Ardışık gerçek hata sayısı — N kez üst üste hata = görünür 'error' durumu. */
let _consecErrors = 0;
const MAX_CONSEC_ERRORS = 5;

/* ── Vosk model hazırlık kapısı (yalnız native) ──────────────────
 * "Asistan uyanmıyor" kökü: grammar thread / polling döngüsü Vosk modeli
 * unpack+load BİTMEDEN başlatılırsa `startWakeWordListening` hard-fail eder
 * ("model yok") ve ilk tetikler sağır geçer. SystemBoot preloadVoskModel
 * çözülünce `notifyVoskModelReady()` çağırır → kapı açılır, bekleyen native
 * start kurulur. Sinyal hiç gelmezse (eski APK / preload yok) backstop süresi
 * sonunda yine de başlatılır (native loop kendi ensureVoskModel kuyruğuyla
 * yükler — sonsuz beklemeye düşmez). */
let _voskReady = !isNative;          // web'de model yok → kapı zaten açık
let _pendingNativeGen: number | null = null;
let _voskReadyBackstop: ReturnType<typeof setTimeout> | null = null;
const VOSK_READY_BACKSTOP_MS = 75_000;

function _clearVoskBackstop(): void {
  if (_voskReadyBackstop) { clearTimeout(_voskReadyBackstop); _voskReadyBackstop = null; }
}

/** Native wake akışını kur: önce grammar (event-driven), olmazsa eski polling. */
function _startNativeWake(gen: number): void {
  void (async () => {
    const grammarOk = await startGrammarMode(gen);
    if (gen !== _loopGen) return;       // bu arada disable/yeniden enable oldu
    if (!grammarOk) {
      _nativeLoopActive = true;
      void nativeLoop(gen);
    }
  })();
}

/**
 * Vosk modeli hazır — wake kapısını aç. SystemBoot preloadVoskModel çözülünce
 * (veya başarısız/yok olduğunda hemen) çağrılır. Bekleyen ertelenmiş start
 * varsa ve hâlâ güncel jenerasyonsa şimdi gerçekten başlatılır. İdempotent.
 */
export function notifyVoskModelReady(): void {
  if (_voskReady) return;
  _voskReady = true;
  _clearVoskBackstop();
  if (_pendingNativeGen !== null && _pendingNativeGen === _loopGen && _state.enabled) {
    _startNativeWake(_pendingNativeGen);
  }
  _pendingNativeGen = null;
}

function _pushHeard(transcript: string): void {
  const lastHeard = [transcript, ..._state.lastHeard].slice(0, 5);
  push({ lastHeard });
}

async function nativeLoop(gen: number): Promise<void> {
  if (gen !== _loopGen || !_nativeLoopActive || !_state.enabled) return;

  // Aktif dinleme/işleme sürerken pasif döngü mikrofon AÇMAZ — voiceService
  // ile startSpeechRecognition çakışması (wake'in cevabı yutması) önlenir.
  const vs = getVoiceSnapshot().status;
  if (vs === 'listening' || vs === 'processing') {
    setTimeout(() => { void nativeLoop(gen); }, 1500);
    return;
  }

  try {
    const { CarLauncher } = await import('./nativePlugin');
    // Offline-First (R-5): internet bağlantısı olsa bile yerel STT motoru her zaman
    // öncelikli — on-device tanıma <100ms, bulut STT ise ağ gecikme ekler.
    const result = await CarLauncher.startSpeechRecognition({
      preferOffline:  true,
      onlineFallback: false, // wake word sürekli döngü → online'a düşme (ağ/pil); offline-only kalsın
      language:       'tr-TR',
      maxResults:     3,
      // Pasif dinleme tuning'i: yüksek kazanç (uzaktan/yan konuşma) + uzun
      // pencere (daha az restart = daha az sağır boşluk) + DUCK YOK (pasif
      // bekleme müziği sürekli %12'ye kısıyordu — müzik dinlenemiyordu).
      gain:              VOICE_TUNING.wakeGainX,
      maxListenMs:       VOICE_TUNING.wakeListenMs,
      duckWhileListening: false,
    });

    if (gen !== _loopGen || !_nativeLoopActive || !_state.enabled) return;
    _consecErrors = 0;

    if (result.transcript) {
      _pushHeard(result.transcript);
      console.warn('[WakeWord] duyuldu:', JSON.stringify(result.transcript),
        '→ eşleşme:', _matches(result.transcript));
      if (_matches(result.transcript)) onWakeWordDetected();
    }
    // Yeniden döngü — kısa nefes (CPU'ya alan), sağır boşluk minimum
    setTimeout(() => { void nativeLoop(gen); }, 300);
  } catch (err) {
    if (gen !== _loopGen || !_nativeLoopActive || !_state.enabled) return;
    const msg = err instanceof Error ? err.message : String(err ?? '');
    // Sessizlik/zaman aşımı HATA DEĞİL — normal döngü olayı: HEMEN yeniden
    // dinle (eski 3 sn bekleme döngünün ~%25'ini sağır bırakıyordu).
    if (/no.?speech|timeout|zaman aşımı|cancel|abort/i.test(msg)) {
      _consecErrors = 0;
      setTimeout(() => { void nativeLoop(gen); }, 250);
      return;
    }
    // Gerçek hata (izin/model/donanım): logla, art arda 5'te görünür hata bas.
    _consecErrors++;
    console.warn(`[WakeWord] döngü hatası (${_consecErrors}/${MAX_CONSEC_ERRORS}):`, msg);
    if (_consecErrors >= MAX_CONSEC_ERRORS && _state.status !== 'error') {
      push({ status: 'error', errorMsg: msg || 'Wake word dinleme hatası' });
    }
    setTimeout(() => { void nativeLoop(gen); }, 3000);
  }
}

/* ── Faz 5: Native grammar modu (event-driven wake) ──────── */

/**
 * Grammar-kısıtlı native wake thread'ini dener. Başarılıysa true — JS polling
 * döngüsü HİÇ açılmaz (CPU + sağır boşluk sıfır). Eski APK'da metot yoksa /
 * model yüklenemezse false → çağıran eski döngüye düşer (fail-soft).
 */
async function startGrammarMode(gen: number): Promise<boolean> {
  try {
    const { CarLauncher } = await import('./nativePlugin');
    if (typeof CarLauncher.startWakeWordListening !== 'function') return false;

    // REFLEKS ISITMASI: ttsService modülü ŞİMDİ yüklenir — tetik anındaki
    // dynamic import önbellekten (mikro-görev) çözülür; "Buradayım" <200ms
    // hedefini ilk tetikte de tutar (soğuk import head unit'te yüzlerce ms).
    void import('./ttsService').catch(() => { /* TTS yoksa selamlamasız akış */ });

    const handle = await CarLauncher.addListener('wakeWord', (data: { transcript?: string }) => {
      if (!_state.enabled || !_grammarMode) return;
      const transcript = typeof data?.transcript === 'string' ? data.transcript : '';
      if (transcript) _pushHeard(transcript);
      // Native grammar zaten süzdü; yine de kelime-sınırlı çift kontrol
      // (defense-in-depth): "[unk]" parçalı transcript'te yanlış pozitif kalmaz.
      if (transcript && !_matches(transcript)) return;
      onWakeWordDetected();
    });

    try {
      await CarLauncher.startWakeWordListening({
        phrases: _state.wakeWords,
        gain:    VOICE_TUNING.wakeGainX,
      });
    } catch (err) {
      try { await handle.remove(); } catch { /* listener temizliği fail-soft */ }
      throw err;
    }

    // Async başlatma sürerken disable/yeniden enable geldiyse: hemen geri al.
    if (gen !== _loopGen) {
      _grammarHandle = handle;
      void stopGrammarMode();
      return true; // jenerasyon değişti — çağıran zaten yeni akışı kurdu
    }
    _grammarHandle = handle;
    _grammarMode = true;
    return true;
  } catch {
    return false;
  }
}

async function stopGrammarMode(): Promise<void> {
  const handle = _grammarHandle;
  _grammarHandle = null;
  const wasActive = _grammarMode;
  _grammarMode = false;
  if (!handle && !wasActive) return;
  try {
    if (handle) await handle.remove();
    const { CarLauncher } = await import('./nativePlugin');
    await CarLauncher.stopWakeWordListening?.();
  } catch { /* native durdurmada hata pasif kalmayı etkilemez */ }
}

/* ── Public API ──────────────────────────────────────────── */

export interface EnableWakeWordOpts {
  /** Companion kaynağı: selamlama + TR kelime-sınırlı eşleşme. */
  companion?: boolean;
}

export function enableWakeWord(words?: string | string[], opts?: EnableWakeWordOpts): void {
  const list = (Array.isArray(words) ? words : [words ?? DEFAULT_WAKE_WORD])
    .filter((w): w is string => typeof w === 'string' && w.trim().length > 0);
  const companion = opts?.companion === true;
  const wakeWords = list.length > 0
    ? (companion ? list.map(normalizeWakeText).filter(Boolean) : list)
    : [DEFAULT_WAKE_WORD];

  if (isNative) {
    // Native Android: arka plan wake word dinlemesi.
    // NOT: pasif beklerken status 'idle' kalır — UI "Dinliyorum" GÖSTERMEZ;
    // görünür durum yalnız tetiklenme sonrası aktif dinlemede (voiceService).
    push({ enabled: true, wakeWords, companion, status: 'idle', errorMsg: null });
    _consecErrors = 0;
    // Jenerasyon artır: olası eski döngü/grammar instance'ı ölür; yeni akış
    // tek başına çalışır (paralel dinleme = karşılıklı STT iptali).
    const gen = ++_loopGen;
    if (_voskReady) {
      // Faz 5: önce native grammar modu (event-driven, refleks). Olmazsa
      // eski startSpeechRecognition döngüsü — davranış aynen korunur.
      _startNativeWake(gen);
    } else {
      // Model henüz hazır değil → başlatmayı readiness sinyaline ertele
      // (erken start "model yok" ile hard-fail ediyordu = uyanmama kökü).
      // Backstop: sinyal gelmezse VOSK_READY_BACKSTOP_MS sonra yine de başla.
      _pendingNativeGen = gen;
      if (!_voskReadyBackstop) {
        _voskReadyBackstop = setTimeout(() => {
          _voskReadyBackstop = null;
          notifyVoskModelReady();
        }, VOSK_READY_BACKSTOP_MS);
      }
    }
  } else {
    // Web: sürekli dinleme yok — push-to-talk yeterli
    // Wake word toggle ayarları kayıt altında kalır ama web'de mikrofon açılmaz
    push({ enabled: false, status: 'disabled', wakeWords, companion, errorMsg: null });
  }
}

export function disableWakeWord(): void {
  _nativeLoopActive = false;
  _loopGen++; // in-flight döngü adımı uyanınca kendini sonlandırır
  _pendingNativeGen = null;   // bekleyen (ertelenmiş) native start iptal
  _clearVoskBackstop();
  // Etkileşim-duraklatma durumunu sıfırla: geç gelen resume timer'ı yeniden başlatmasın
  _interactionPaused = false;
  if (_interactionResumeTimer) { clearTimeout(_interactionResumeTimer); _interactionResumeTimer = null; }
  void stopGrammarMode(); // Faz 5: native grammar thread + event listener kapanır
  if (_detectedTimer) { clearTimeout(_detectedTimer); _detectedTimer = null; }
  push({ enabled: false, status: 'disabled' });
  stopWebListening();
}

export function setWakeWord(word: string): void {
  push({ wakeWords: [word] });
}

/* ── Etkileşim-bağlı geçici duraklatma (ağır harita pan/zoom) ─────────────────
 * Native grammar thread'i (vosk-wake-gramm) sürekli ~%22 CPU yer. Ağır harita
 * etkileşimi sırasında geçici durdurulur, etkileşim bitince geri kurulur.
 * `enabled` durumu DEĞİŞMEZ — yalnız native dinleme askıya alınır; ayar/boot
 * orkestrasyonu (startWakeWordService) etkilenmez. Güvenli: etkileşim sırasında
 * kullanıcı genelde wake sözü söylemez (spec: "pause during heavy map interaction
 * if safe"). Geri kurma jenerasyon-artışlı → çift dinleme oturumu oluşmaz. */
let _interactionPaused = false;
let _interactionResumeTimer: ReturnType<typeof setTimeout> | null = null;
const INTERACTION_RESUME_MS = 450;

export function pauseWakeWordForInteraction(): void {
  if (!isNative) return;
  // Bekleyen geri-kurma varsa iptal (kesintisiz gesture dizisinde thread thrash yok)
  if (_interactionResumeTimer) { clearTimeout(_interactionResumeTimer); _interactionResumeTimer = null; }
  if (!_state.enabled || _interactionPaused) return;
  _interactionPaused = true;
  _nativeLoopActive = false;     // legacy polling döngüsü adımında kendini sonlandırır
  void stopGrammarMode();        // grammar thread (vosk-wake-gramm) durur → CPU geri gelir
}

export function resumeWakeWordAfterInteraction(): void {
  if (!isNative || !_interactionPaused) return;
  if (_interactionResumeTimer) clearTimeout(_interactionResumeTimer);
  _interactionResumeTimer = setTimeout(() => {
    _interactionResumeTimer = null;
    _interactionPaused = false;
    // Hâlâ açık ve model hazırsa yeniden kur (jenerasyon artır → eski instance ölür)
    if (_state.enabled && _voskReady) _startNativeWake(++_loopGen);
  }, INTERACTION_RESUME_MS);
}

export function getWakeWordState(): WakeWordState { return _state; }

/* ── Boot orkestratörü: ayar-tabanlı wake aç/kapa ────────────────
 * SystemBoot Wave 4'te çağrılır. React mount'una BAĞLI DEĞİL (modül-düzeyi
 * store aboneliği — her zaman canlı, layout takılsa bile çalışır). useStore'a
 * abone olur; companion/legacy wake ayarlarına göre enableWakeWord/
 * disableWakeWord çağırır; ad/mod değişiminde yeniden kurar. enableWakeWord
 * _loopGen'i artırdığı için ÇİFT dinleme oturumu olmaz. Yalnız wake'i etkileyen
 * alanlar değişince yeniden uygulanır (ilgisiz ayar değişiminde churn yok). */

type AppSettings = ReturnType<typeof useStore.getState>['settings'];

function _wakeKey(s: AppSettings): string {
  return [
    s.companionEnabled ? 1 : 0,
    s.companionWakeWordEnabled ? 1 : 0,
    s.wakeWordEnabled ? 1 : 0,
    s.wakeWord ?? '',
    s.companionAssistantName ?? '',
    s.companionWakeMode ?? '',
    s.companionWakePhrase ?? '',
  ].join('|');
}

function _applyWakeFromSettings(s: AppSettings): void {
  const companionWake =
    (s.companionEnabled ?? false) && (s.companionWakeWordEnabled ?? false);
  if (companionWake) {
    // Wake sözleri asistan ADINDAN türer ("Mavi"/"Hey Mavi"/özel cümle).
    const identity = resolveCompanionIdentity({
      companionAssistantName: s.companionAssistantName,
      companionWakeMode:      s.companionWakeMode,
      companionWakePhrase:    s.companionWakePhrase,
    });
    enableWakeWord(resolveWakeWords(identity), { companion: true });
  } else if (s.wakeWordEnabled) {
    enableWakeWord(s.wakeWord ?? DEFAULT_WAKE_WORD);   // eski "hey car" sistemi
  } else {
    disableWakeWord();
  }
}

let _wakeServiceUnsub: (() => void) | null = null;

/**
 * Wake word servisini başlat — ayarları izleyip wake'i aç/kapa yönetir.
 * İdempotent (ikinci çağrı önceki aboneliği temizler). Dönen cleanup
 * aboneliği söker + wake'i kapatır (zero-leak; SystemBoot _cleanups'a girer).
 */
export function startWakeWordService(): () => void {
  if (_wakeServiceUnsub) { _wakeServiceUnsub(); }   // çift abone yok

  const initial = useStore.getState().settings;
  let prevKey = _wakeKey(initial);
  _applyWakeFromSettings(initial);

  const unsub = useStore.subscribe((state) => {
    const key = _wakeKey(state.settings);
    if (key === prevKey) return;       // ilgisiz ayar değişimi → wake'e dokunma
    prevKey = key;
    _applyWakeFromSettings(state.settings);
  });

  _wakeServiceUnsub = () => {
    unsub();
    _wakeServiceUnsub = null;
    disableWakeWord();
  };
  return _wakeServiceUnsub;
}

/** @internal — testler arası izolasyon. */
export function _resetWakeWordForTest(): void {
  if (_wakeServiceUnsub) { _wakeServiceUnsub(); }   // store aboneliği sızmasın
  _nativeLoopActive = false;
  _loopGen++;
  _consecErrors = 0;
  _grammarMode = false;
  _grammarHandle = null;
  // Testler enableWakeWord'ün ANINDA native akışı kurmasını bekler → kapı açık
  // varsayılır. Hazırlık kapısı davranışı _setVoskReadyForTest ile ayrı test edilir.
  _voskReady = true;
  _pendingNativeGen = null;
  _clearVoskBackstop();
  _interactionPaused = false;
  if (_interactionResumeTimer) { clearTimeout(_interactionResumeTimer); _interactionResumeTimer = null; }
  if (_detectedTimer) { clearTimeout(_detectedTimer); _detectedTimer = null; }
  clearRestartTimer();
  _greetCounter = 0;
  _state = { ...INITIAL };
}

/** @internal — Vosk hazırlık kapısını test için zorla (false = model hazır değil). */
export function _setVoskReadyForTest(ready: boolean): void {
  _voskReady = ready;
  if (ready) { _pendingNativeGen = null; _clearVoskBackstop(); }
}

/* ── HMR cleanup — dev modda Recognition/timer sızıntısını önle ─── */
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    _nativeLoopActive = false;                                      // nativeLoop döngüsünü kes
    _loopGen++;
    _pendingNativeGen = null;                                       // ertelenmiş native start iptal
    _clearVoskBackstop();                                           // backstop timer sızmasın
    if (_wakeServiceUnsub) { _wakeServiceUnsub(); }                 // store aboneliği + disable
    void stopGrammarMode();                                         // native grammar thread + listener
    if (_detectedTimer) { clearTimeout(_detectedTimer); _detectedTimer = null; }
    stopWebListening();                                             // SpeechRecognition.abort() + _restartTimer iptal
    _listeners.clear();                                            // stale React setState callback'leri temizle
  });
}

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
