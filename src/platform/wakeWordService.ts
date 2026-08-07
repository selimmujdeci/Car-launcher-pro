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
import { startListening, isVoicePaused, getVoiceSnapshot, notifyWakeDetected } from './voiceService';
import { isTtsSpeaking } from './ttsService';
import {
  matchesWakeTranscript,
  fuzzyMatchesWake,
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
  /**
   * ÖZEL/sözlük-dışı wake modu: grammar YOK (sözlük-dışı kelimeyi düşürür),
   * serbest tanıma + fonetik fuzzy eşleşme kullanılır. Öğretilen örneklerle güçlenir.
   */
  custom:      boolean;
  /** Söyleyerek öğretilen wake örnekleri (Vosk çıktısı, normalize). */
  enrollment:  string[];
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

/* ── Wake selamı → aktif dinleme köprüsü (deterministik açılış) ─────────────────
 * SAHA 2026-07-23 ("hey mavi → 'burdayım' der, GEÇ dinlemeye geçer"): eskiden
 * mikrofon YALNIZ greeting TTS'inin onEnd'inde açılıyordu. onEnd, OEM
 * TextToSpeech onDone'una bağlı ve bu callback audio bitiminden çok sonra (bazı
 * motorlar HİÇ) gelir → ttsSpeak'in süre-tahminli ~4s'lik safety'sine düşülüp
 * mikrofon çok geç açılıyordu; kullanıcının selamı duyar duymaz söylediği ilk söz
 * kapalı mikrofona gidiyordu ("tut sesini bekliyorum").
 *
 * DÜZELTME: greeting süre tahminine göre DETERMİNİSTİK zamanlayıcı — onEnd
 * gecikse/hiç gelmese bile mikrofon açılır. Zamanlayıcı warmup kadar ERKEN kurulur
 * → mikrofonun capture-ready anı greeting sesinin doğal sonuyla örtüşür ("burdayım
 * dediği gibi dinlemede olmalı"). startListening'in ilk işi ttsCancel: greeting
 * kuyruğu timer anında susturulur, gerçek yakalama warmup sonrası başlar → aktif
 * komut penceresinde selam sesi ÇALMAZ (self-echo yok). onEnd erken gelirse
 * mikrofonu O açar; startListening idempotent olduğundan çift açılış no-op'tur. */
let _wakeListenTimer: ReturnType<typeof setTimeout> | null = null;

// Süre tahmini SAHA ÖLÇÜMÜNE kalibre (CDP, 2026-07-23: "Buradayım." rate 1.05 →
// ölçülen ~1091ms). Zamanlayıcı, mikrofon warmup'ını greeting kuyruğuyla örtüştürmek
// için LEAD kadar erken kurulur → capture-ready ≈ greeting doğal sonu (küçük kuyruk
// kırpması pahasına ölü boşluk ~0). Değerler cihazda ince ayarlanabilir.
// Greeting rate 1.15'e göre (aşağıda) kalibre: "Buradayım." ≈ 1000ms.
const WAKE_GREET_BASE_MS     = 340;
const WAKE_GREET_PER_CHAR_MS = 66;
const WAKE_LISTEN_LEAD_MS    = 180;   // timer'ı greeting sonundan önce → mikrofon açılış pipeline'ı örtüşür
const WAKE_LISTEN_FLOOR_MS   = 500;   // en kısa selam bile duyulacak kadar çalsın

function _clearWakeListenTimer(): void {
  if (_wakeListenTimer) { clearTimeout(_wakeListenTimer); _wakeListenTimer = null; }
}

/** onEnd yolu: deterministik zamanlayıcıyı iptal edip mikrofonu hemen aç (çift açılış yok).
 * fastWarmup: TTS az önce çaldı → ses donanımı aktif → mikrofon açılış pipeline'ı kısa. */
function _openWakeListen(): void {
  _clearWakeListenTimer();
  startListening({ fastWarmup: true });
}

/** Greeting seslendirme süresi tahmini − warmup örtüşme payı (capture-ready ≈ greeting sonu). */
function _wakeListenDelayMs(greeting: string): number {
  const estSpeechMs = Math.min(2000, WAKE_GREET_BASE_MS + greeting.length * WAKE_GREET_PER_CHAR_MS);
  return Math.max(WAKE_LISTEN_FLOOR_MS, estSpeechMs - WAKE_LISTEN_LEAD_MS);
}

/* ── Modül durumu ────────────────────────────────────────── */

const INITIAL: WakeWordState = {
  status:      'disabled',
  enabled:     false,
  wakeWords:   [DEFAULT_WAKE_WORD],
  companion:   false,
  custom:      false,
  enrollment:  [],
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

/* ── Canlılık denetimi (watchdog) — "bir süre sonra uyanmıyor" self-heal ──────
 * SAHA (2026-07-23): "hey mavi" bir süre çalışıyor, sonra uyanmıyor; uygulama
 * yeniden açılınca düzeliyor. KÖK: native grammar wake thread'i (vosk-wake-gramm)
 * SESSİZCE ölebilir (ses odağı kaybı, mikrofonu başka uygulama kapması, native
 * çökme) ve onu yeniden başlatan HİÇBİR ŞEY yoktu → uygulama yeniden açılana
 * kadar sağır. Grammar modu olay-güdümlü olduğundan JS tarafına "canlıyım"
 * sinyali GELMEZ (sessizlikte olay yok) → thread ölümü ile sessizlik ayırt
 * edilemez. Çözüm: periyodik YENİDEN KUR — thread öldüyse geri gelir, canlıysa
 * jenerasyon-artışlı temiz takas olur (çift dinleme yok). Yalnız voiceService
 * idle + etkileşim-duraklama yokken çalışır (aktif oturumu/wake selamını kesmez).
 * Aralık uzun (churn/CPU düşük) ama "yeniden başlatana kadar sağır"dan çok iyi. */
let _watchdogTimer: ReturnType<typeof setInterval> | null = null;
/* ⚠️ SAHA 2026-07-24 ("bir süre sonra 'dut' sesi geliyor, sohbet kesiliyor"):
 * her yeniden-kurma mikrofonu BIRAKIP yeniden alır → cihaz kayıt bip'i ("dut")
 * çalar. 90 sn'de bir yapıldığında sürekli sohbetin ortasına düşüyordu.
 * Aralık uzatıldı; ayrıca aşağıda "sessizlik" ve "konuşma sürmüyor" koşulları
 * eklendi. Self-heal amacı korunur (ölü thread yine dirilir), yalnız kullanıcı
 * etkileşiminin ortasına düşmez. */
const WAKE_WATCHDOG_INTERVAL_MS = 300_000;   // 90sn → 5 dk
/** Son wake/etkileşimden bu yana bu kadar SESSİZLİK geçmeden yeniden kurma yapılmaz. */
const WAKE_WATCHDOG_QUIET_MS = 60_000;

function _stopWatchdog(): void {
  if (_watchdogTimer) { clearInterval(_watchdogTimer); _watchdogTimer = null; }
}

function _startWatchdog(): void {
  if (!isNative) return;
  _stopWatchdog();
  _watchdogTimer = setInterval(() => {
    // Yalnız hâlâ açık + model hazır + etkileşim duraklaması yokken.
    if (!_state.enabled || !_voskReady || _interactionPaused) return;
    // Aktif oturum/wake selamı sürerken DOKUNMA (idle değilse re-arm dinlemeyi keser).
    const snap = getVoiceSnapshot();
    if (snap.status !== 'idle' || snap.followUp) return;
    // Asistan HÂLÂ KONUŞUYOR olabilir (durum 'idle'a dönse de TTS sürüyor olur) →
    // mikrofon takası cevabın üstüne "dut" sesi bindirir. Konuşma bitene kadar bekle.
    if (isTtsSpeaking()) return;
    // SESSİZLİK ŞARTI: son wake tetiğinden bu yana yeterince zaman geçmediyse
    // kullanıcı hâlâ sohbetin içindedir — bip sesiyle bölme.
    if (Date.now() - _lastWakeAcceptedAt < WAKE_WATCHDOG_QUIET_MS) return;
    /* Native wake akışını taze jenerasyonla yeniden kur. ÖNCE eski grammar
       thread'i/listener'ı kapat (yoksa her tick'te listener yığılır — çift
       dinleme/leak), SONRA taze başlat.

       DÜRÜSTLÜK DÜZELTMESİ (2026-08-07 · kütük #460): burası bir ARIZA
       TESPİTİ DEĞİLDİR. Eski mesaj "self-heal" diyordu ve saha incelemesi
       bunu "wake thread 32 dakikada 4 kez ÖLDÜ" diye kaydetti — oysa hiçbir
       canlılık ölçümü yapılmıyor: koşullar sağlandığında thread sağlıklı olsa
       bile 5 dakikada bir KOŞULSUZ yeniden kuruluyor. 32 dk'da 4 kez, tam
       olarak tasarlanan davranıştır.

       Canlılık GERÇEKTEN ölçülemiyor: native taraf yalnız 'wakeWord' olayını
       (tetik anı) yayınlar; "thread ayakta ama henüz duymadı" ile "thread
       öldü" JS'ten AYIRT EDİLEMEZ. Bu yüzden davranış KANITSIZ değiştirilmedi
       — bunun yerine ÖLÇÜLEBİLİR yapıldı (bkz. getWakeWatchdogStats): sahada
       yeniden kurulumlar arasında hiç wake kabul edilmiyorsa periyodik re-arm
       gereksiz maliyet, ediliyorsa gerekli. Karar o veriyle verilecek. */
    _rearmCount++;
    _lastRearmAt        = Date.now();
    _wakesInPrevWindow  = _wakesSinceRearm;
    _wakesSinceRearm    = 0;
    console.warn(
      `[WakeWord] periyodik re-arm #${_rearmCount} (canlılık ÖLÇÜLMEDİ —` +
      ` önceki turda kabul edilen wake: ${_wakesInPrevWindow})`,
    );
    void (async () => {
      await stopGrammarMode();
      if (!_state.enabled || _interactionPaused || !_voskReady) return;
      _startNativeWake(++_loopGen);
    })();
  }, WAKE_WATCHDOG_INTERVAL_MS);
}

function _matches(transcript: string): boolean {
  // ÖZEL/sözlük-dışı mod: serbest tanıma çıktısını yazılan hedefe + öğretilen
  // örneklere FONETİK yakınlıkla eşle (grammar sözlük-dışı kelimeyi düşürdüğü için
  // tam eşleşme yetersiz). Diğer modlar birebir/kelime-sınırlı kalır.
  if (_state.custom) return fuzzyMatchesWake(transcript, _state.wakeWords, _state.enrollment);
  return _state.companion
    ? matchesWakeTranscript(transcript, _state.wakeWords)  // TR-normalize + kelime sınırı
    : matchesLegacy(transcript, _state.wakeWords);
}

/* ── Wake yalnız SOĞUK BAŞLATIR (asistan meşgulken yeniden tetiklenmez) ──
 * SAHA (2026-07-03): "cevap verirken 'seni dinliyorum' + 'merhaba ben Mavi'
 * diyor." Kök neden: asistan cevabını HOPARLÖRDEN konuşurken grammar wake thread
 * kendi sesini (echo) duyup yeniden tetikleniyordu → wake selamı ("Seni
 * dinliyorum") + boş/echo dinleme → beyin jenerik selam ("Merhaba ben Mavi").
 * Kural: wake YALNIZ voiceService idle iken oturum başlatır. Aktif oturumda
 * (listening/processing/success/error VEYA takip döngüsü) VEYA az önce kabul
 * edilmiş bir tetik varsa (debounce — selamlama/echo penceresi) tetik YUTULUR. */
let _lastWakeAcceptedAt = 0;
const WAKE_REACCEPT_DEBOUNCE_MS = 4_000;

/* ── Watchdog ölçümü (kütük #460) ─────────────────────────────────────────
 * Saha kaydı "wake thread 32 dk'da 4 kez ÖLDÜ" diyordu; gerçekte hiçbir
 * canlılık ölçümü yok — 5 dakikada bir KOŞULSUZ yeniden kurulum var.
 * Bu sayaçlar kararı değiştirmez, yalnız görünür kılar: iki re-arm arasında
 * hiç wake kabul edilmiyorsa periyodik kurulum gereksiz maliyettir. */
let _rearmCount        = 0;
let _lastRearmAt       = 0;
let _wakesSinceRearm   = 0;
let _wakesInPrevWindow = 0;

function onWakeWordDetected(): void {
  // PROTECTION/CRITICAL: wake tetiklense bile sohbet/eğlence BAŞLAMAZ.
  // Sessizce yut — pasif döngü sürer, sürücü dikkat yükü altında rahatsız edilmez.
  if (isVoicePaused()) return;

  // Asistan zaten aktif mi? (dinliyor/işliyor/cevap veriyor VEYA takip döngüsü açık)
  // → wake yeni oturum AÇMAZ. Aksi halde cevap TTS'i mikrofona echo yapıp wake'i
  // yeniden tetikliyor, sohbetin ortasında "Seni dinliyorum" + jenerik selam basıyordu.
  const vs = getVoiceSnapshot();
  if (vs.status !== 'idle' || vs.followUp) return;

  // Selamlama/echo debounce: kabul edilen tetikten sonra kısa süre (selam TTS'i
  // + mikrofon açılma rampası) yeni tetik yutulur — çift selam olmaz.
  const now = Date.now();
  if (now - _lastWakeAcceptedAt < WAKE_REACCEPT_DEBOUNCE_MS) return;
  _lastWakeAcceptedAt = now;
  _wakesSinceRearm++;   // re-arm penceresinde kabul edilen tetik sayısı (#460)

  push({ status: 'detected', lastTrigger: now });
  // MAVI3-1 additive: Mavi telemetri köprüsüne wake sinyali (wake motoru mantığı DEĞİŞMEZ).
  notifyWakeDetected();

  if (_state.companion) {
    // Kısa selamlama + DETERMİNİSTİK dinleme açılışı. Mikrofon greeting sonunda
    // her hâlükârda açılır (OEM onDone gecikmesini beklemez) → kullanıcı selamı
    // duyar duymaz konuşabilir. Lazy import — modül yükünde TTS zinciri yok.
    const greeting = WAKE_GREETINGS[_greetCounter % WAKE_GREETINGS.length];
    _greetCounter++;
    void import('./ttsService')
      .then(({ ttsSpeak }) => {
        // rate 1.15: selam daha kısa/snappy → devir hızlanır (saha: "geç dinlemeye geçiyor").
        ttsSpeak(greeting, { rate: 1.15, onEnd: () => { _openWakeListen(); } });
      })
      .catch(() => { _openWakeListen(); }); // TTS yoksa selamlamasız dinle (fail-soft)
    // onEnd (OEM onDone) gecikirse/gelmezse bile açılış garantisi — capture-ready
    // greeting sonuyla örtüşecek şekilde erken + hızlı warmup.
    _clearWakeListenTimer();
    _wakeListenTimer = setTimeout(() => {
      _wakeListenTimer = null;
      startListening({ fastWarmup: true });
    }, _wakeListenDelayMs(greeting));
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
  // ÖZEL/sözlük-dışı mod: grammar KULLANMA — sözlük-dışı kelimeyi native düşürür
  // ("Ignoring word missing in vocabulary") ve wake sağır kalır. Serbest tanıma
  // döngüsü + fonetik fuzzy eşleşme (nativeLoop → _matches) ile her kelime çalışır.
  if (_state.custom) {
    _nativeLoopActive = true;
    void nativeLoop(gen);
    return;
  }
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

/** Tanı: Vosk modeli hazır mı (native'de unpack+load bitti mi; web'de her zaman true). */
export function isVoskModelReady(): boolean {
  return _voskReady;
}

function _pushHeard(transcript: string): void {
  const lastHeard = [transcript, ..._state.lastHeard].slice(0, 5);
  push({ lastHeard });
}

async function nativeLoop(gen: number): Promise<void> {
  if (gen !== _loopGen || !_nativeLoopActive || !_state.enabled) return;

  // Asistan aktifken (dinliyor/işliyor/CEVAP VERİYOR/hata VEYA takip döngüsü)
  // pasif döngü mikrofon AÇMAZ — hem startSpeechRecognition çakışması hem de
  // cevap TTS'inin mikrofona echo yapıp wake'i yeniden tetiklemesi önlenir
  // (SAHA 2026-07-03: eskiden yalnız listening/processing bekletiliyordu →
  // 'success' penceresinde cevap konuşulurken döngü açılıp echo tetikliyordu).
  const snap = getVoiceSnapshot();
  if (snap.status !== 'idle' || snap.followUp) {
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
      maxResults:     5,   // n-best: OOV özel kelime en-iyi'de kayabilir, alternatiflerde çıkar
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
      // SAHA 2026-07-23: OOV özel kelime ("asiste") tanıyıcının EN-İYİ tahmininde
      // kaybolup ("nash üste git") alternatifte çıkabiliyor ("asistan evet"). Bu
      // yüzden en-iyi + TÜM n-best adaylarına karşı eşleştir — yalnız top'a bakmak
      // özel wake'i güvenilmez yapıyordu. (Companion/legacy kelime-sınırlı/substring
      // eşleşme kullandığından alternatif taraması yanlış tetiklemeyi patlatmaz.)
      const candidates = [result.transcript, ...(result.alternatives ?? [])];
      const hit = candidates.some((c) => typeof c === 'string' && _matches(c));
      console.warn('[WakeWord] duyuldu:', JSON.stringify(result.transcript),
        'alts:', JSON.stringify(result.alternatives ?? []), '→ eşleşme:', hit);
      if (hit) onWakeWordDetected();
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
  /** ÖZEL/sözlük-dışı mod: grammar yok, serbest tanıma + fonetik fuzzy eşleşme. */
  custom?: boolean;
  /** Söyleyerek öğretilen wake örnekleri (Vosk çıktısı) — fuzzy eşleşmeyi güçlendirir. */
  enrollment?: string[];
}

export function enableWakeWord(words?: string | string[], opts?: EnableWakeWordOpts): void {
  const list = (Array.isArray(words) ? words : [words ?? DEFAULT_WAKE_WORD])
    .filter((w): w is string => typeof w === 'string' && w.trim().length > 0);
  const companion = opts?.companion === true;
  const custom = opts?.custom === true;
  const enrollment = (opts?.enrollment ?? []).map(normalizeWakeText).filter(Boolean);
  const wakeWords = list.length > 0
    ? (companion ? list.map(normalizeWakeText).filter(Boolean) : list)
    : [DEFAULT_WAKE_WORD];

  if (isNative) {
    // Native Android: arka plan wake word dinlemesi.
    // NOT: pasif beklerken status 'idle' kalır — UI "Dinliyorum" GÖSTERMEZ;
    // görünür durum yalnız tetiklenme sonrası aktif dinlemede (voiceService).
    push({ enabled: true, wakeWords, companion, custom, enrollment, status: 'idle', errorMsg: null });
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
    // Canlılık denetimi: native wake thread'i sessizce ölürse periyodik yeniden kur.
    _startWatchdog();
  } else {
    // Web: sürekli dinleme yok — push-to-talk yeterli
    // Wake word toggle ayarları kayıt altında kalır ama web'de mikrofon açılmaz
    push({ enabled: false, status: 'disabled', wakeWords, companion, custom, enrollment, errorMsg: null });
  }
}

export function disableWakeWord(): void {
  _nativeLoopActive = false;
  _loopGen++; // in-flight döngü adımı uyanınca kendini sonlandırır
  _pendingNativeGen = null;   // bekleyen (ertelenmiş) native start iptal
  _clearVoskBackstop();
  _stopWatchdog();
  // Etkileşim-duraklatma durumunu sıfırla: geç gelen resume timer'ı yeniden başlatmasın
  _interactionPaused = false;
  if (_interactionResumeTimer) { clearTimeout(_interactionResumeTimer); _interactionResumeTimer = null; }
  void stopGrammarMode(); // Faz 5: native grammar thread + event listener kapanır
  if (_detectedTimer) { clearTimeout(_detectedTimer); _detectedTimer = null; }
  _clearWakeListenTimer();   // bekleyen wake-selamı dinleme açılışı iptal
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
  _clearWakeListenTimer();       // duraklamada bekleyen wake dinleme açılışı iptal
  void stopGrammarMode();        // grammar thread (vosk-wake-gramm) durur → CPU geri gelir
  _stopWatchdog();               // duraklamada watchdog re-arm etmesin
}

export function resumeWakeWordAfterInteraction(): void {
  if (!isNative || !_interactionPaused) return;
  if (_interactionResumeTimer) clearTimeout(_interactionResumeTimer);
  _interactionResumeTimer = setTimeout(() => {
    _interactionResumeTimer = null;
    _interactionPaused = false;
    // Hâlâ açık ve model hazırsa yeniden kur (jenerasyon artır → eski instance ölür)
    if (_state.enabled && _voskReady) { _startNativeWake(++_loopGen); _startWatchdog(); }
  }, INTERACTION_RESUME_MS);
}

export function getWakeWordState(): WakeWordState { return _state; }

/** Wake watchdog ölçümü — salt-okunur, hüküm içermez (kütük #460). */
export interface WakeWatchdogStats {
  /** Bu oturumda kaç kez periyodik yeniden kurulum yapıldı. */
  readonly rearmCount: number;
  /** Son yeniden kurulum anı (Unix ms); 0 = hiç olmadı. */
  readonly lastRearmAt: number;
  /** Son yeniden kurulumdan bu yana kabul edilen wake tetiği sayısı. */
  readonly wakesSinceRearm: number;
  /** Bir ÖNCEKİ pencerede kabul edilen wake sayısı — re-arm gerekli miydi? */
  readonly wakesInPrevWindow: number;
  /** Yeniden kurulum periyodu (ms) — ölçümü yorumlayabilmek için. */
  readonly rearmIntervalMs: number;
  /**
   * Canlılık GERÇEKTEN ölçülüyor mu. Şu an `false`: native yalnız tetik anını
   * ('wakeWord' olayı) yayınlar; "ayakta ama duymadı" ile "öldü" JS'ten
   * ayırt edilemez. Kanıtsız iyimserlik üretmemek için açıkça bildirilir.
   */
  readonly livenessMeasured: false;
}

/**
 * Watchdog'un ÖLÇÜLEBİLİR durumu.
 *
 * Neden var: saha "thread öldü" diye kaydetti, oysa kod hiç ölüm tespiti
 * yapmıyor. Periyodik re-arm'ın gerekli mi gereksiz mi olduğu ancak
 * "iki kurulum arasında wake kabul edildi mi" verisiyle söylenebilir.
 */
export function getWakeWatchdogStats(): WakeWatchdogStats {
  return {
    rearmCount:        _rearmCount,
    lastRearmAt:       _lastRearmAt,
    wakesSinceRearm:   _wakesSinceRearm,
    wakesInPrevWindow: _wakesInPrevWindow,
    rearmIntervalMs:   WAKE_WATCHDOG_INTERVAL_MS,
    livenessMeasured:  false,
  };
}

/* ── Söyleyerek ÖĞRET (enrollment) ─────────────────────────────
 * Kullanıcı wake kelimesini bir kez söyler; cihazın DUYDUĞU örnekler (normalize)
 * döner. Çağıran (ayar UI'ı) bunları companionWakeEnrollment'a ekler → fuzzy
 * eşleşme bu örneklere de bakar, böylece SÖZLÜK-DIŞI/uydurma kelime de çalışır.
 *
 * SAHA 2026-07-23 ("ben 'asiste' diyorum uyanmıyor"): CDP ile ölçüldü — kullanıcı
 * "asiste" deyince RUNTIME tanıyıcı (bu cihazda online Google) "asistan"/"sistem"/
 * "nash üste git" duyuyor (OOV kelime → en yakın GERÇEK kelimelere zorlanır, her
 * seferinde farklı). Enrollment bu RUNTIME çıktısını yakalamalı ki eşleşsin.
 *
 * KRİTİK: enrollment, RUNTIME wake döngüsüyle (nativeLoop custom yolu) TAM AYNI STT
 * seçeneklerini kullanır — aksi halde farklı motor/farklı çıktı → örnek runtime'a
 * UYMAZ. (Önceki deneme returnAudio+bulut Whisper ile "asiste"yi doğru yakalıyordu
 * ama runtime Google "asistan" duyunca eşleşmiyordu — o yüzden bulut/returnAudio
 * KALDIRILDI.) Tek fark: n-best (5 aday) — tek söyleyişin tüm varyantlarını topla;
 * kullanıcı 2-3 kez söyleyince farklı söyleyişlerin varyantları da birikir.
 * Pasif döngü durur (mikrofon çakışması yok). Boş/sessizse [].
 */
const ENROLL_LISTEN_MS = 5_000;

export async function enrollWakeWord(): Promise<string[]> {
  if (!isNative) return [];
  // Pasif dinlemeyi durdur — aynı anda iki STT karşılıklı iptal eder.
  const wasEnabled = _state.enabled;
  _nativeLoopActive = false;
  _loopGen++;
  await stopGrammarMode();
  try {
    const { CarLauncher } = await import('./nativePlugin');
    // nativeLoop custom yoluyla AYNI seçenekler (preferOffline + onlineFallback:false,
    // returnAudio YOK) + n-best. Böylece yakalanan örnekler runtime çıktısına birebir uyar.
    const res = await CarLauncher.startSpeechRecognition({
      preferOffline:      true,
      onlineFallback:     false,
      language:           'tr-TR',
      maxResults:         5,      // n-best: "asistan/sistem/basit de..." — varyansı topla
      gain:               VOICE_TUNING.wakeGainX,
      maxListenMs:        ENROLL_LISTEN_MS,
      duckWhileListening: true,
    });
    // res.transcript + tüm alternatifler → normalize + dedupe.
    const seen = new Set<string>();
    const samples: string[] = [];
    for (const raw of [res.transcript, ...(res.alternatives ?? [])]) {
      const n = normalizeWakeText(raw ?? '');
      if (n && !seen.has(n)) { seen.add(n); samples.push(n); }
    }
    return samples;
  } catch {
    return [];
  } finally {
    // Wake hâlâ açıksa döngüyü geri kur (ayar değişimi de kuracak — gen++ ile
    // eski instance ölür, çift oturum olmaz).
    if (wasEnabled && _state.enabled && _voskReady) _startNativeWake(++_loopGen);
  }
}

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
    (s.companionWakeEnrollment ?? []).join(','),  // öğretilen örnek değişince yeniden kur
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
      companionWakeEnrollment: s.companionWakeEnrollment,
    });
    // ÖZEL mod (kullanıcının yazdığı serbest cümle) sözlük-dışı olabilir →
    // grammar yerine serbest tanıma + fonetik fuzzy + öğretilen örnekler.
    const isCustom = identity.wakeMode === 'custom';
    enableWakeWord(resolveWakeWords(identity), {
      companion: true,
      custom: isCustom,
      enrollment: isCustom ? identity.wakeEnrollment : [],
    });
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
  _lastWakeAcceptedAt = 0;   // wake re-accept debounce sıfırla (testler arası izolasyon)
  _rearmCount = _lastRearmAt = _wakesSinceRearm = _wakesInPrevWindow = 0;
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
  _clearWakeListenTimer();
  _stopWatchdog();
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
    _stopWatchdog();                                                // watchdog interval sızmasın
    _clearWakeListenTimer();                                        // bekleyen wake dinleme açılışı iptal
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
