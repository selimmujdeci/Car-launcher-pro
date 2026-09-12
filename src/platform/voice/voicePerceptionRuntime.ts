/**
 * voicePerceptionRuntime.ts — **MAVI-F13/2 · ALGI KATMANI RUNTIME'I.**
 *
 * ── NE İÇİN VAR ─────────────────────────────────────────────────────────────
 * `voiceService` bileşim kökünde üç ayrı **algı/cihaz** sorumluluğu iç içe
 * duruyordu ve her birinin kendi kaynağı (AudioContext · native listener ·
 * kısmi transkript oturumu) vardı. Sızıntı hatalarının yaşadığı yer tam olarak
 * burasıdır: kaynak açan ile kapatan kod farklı yerlerdeyse er ya da geç biri
 * unutulur. Bu dosya **kaynağı açan ile kapatanı aynı sahibe** verir.
 *
 * Sahiplendiği üç şey:
 *   1. **Ses seviyesi göstergesi** — web sentetik dalga · native RMS · AudioContext
 *   2. **Asistan ducking'i** — dinlerken müziği duraklat, oturum bitince sürdür
 *   3. **MAVI-F3 kısmi transkript oturumu** — streaming ASR kanıtı + endpoint kararı
 *
 * ── SÖZLEŞME (PAZARLIKSIZ) ──────────────────────────────────────────────────
 *  · **OTORİTE DEĞİL.** Bu modül eylem çalıştırmaz, tur açmaz/kapatmaz, konuşmaz.
 *    `processTextCommand`, `commandExecutor`, `maviSpeech`, `maviTurn`,
 *    `capabilityFabric` BURADAN çağrılmaz ve import EDİLMEZ. Tek "komutu"
 *    `finalizeSpeechRecognition()`tir — o da yalnız **mikrofonu kapatır**.
 *  · **İKİNCİ GLOBAL OTORİTE DEĞİL.** UI durumunu kendi yazmaz; kökün verdiği
 *    `setVolumeLevel` portundan geçirir. Takip dinlemesinin kurulu olup
 *    olmadığını kendi bilmez; `isFollowUpEngaged` portundan SORAR.
 *  · **ZERO-LEAK.** Açtığı her kaynağın kapatıcısı bu dosyadadır ve
 *    `disposeVoicePerception()` hepsini koşulsuz söker.
 *  · **DAVRANIŞ DEĞİŞMEDİ.** F13/2 taşıma turudur: eşikler, sentetik dalga
 *    formülü, yetenek çözümlemesi ve endpoint sözleşmesi `voiceService`ten
 *    **birebir** taşındı.
 */

import { isNative } from '../bridge';
import { CarLauncher } from '../nativePlugin';
import {
  openListenSession, closeListenSession, notePartial, noteProviderFinal,
  configureSttPartialPorts, activeListenSessionId,
  type SttStreamCapability,
} from './sttPartialStream';
import { DEFAULT_ENDPOINT_THRESHOLDS } from './semanticEndpointer';
import {
  markMaviLatency, hasMaviLatencyMark,
  setMaviLatencyEndpoint, setMaviLatencySttCapability,
} from '../assistant/maviLatencyTrace';

/* ══════════════════════════════════════════════════════════════════════════
 * PORTLAR — kökün enjekte ettiği yetenekler (DI; yeni framework DEĞİL)
 * ════════════════════════════════════════════════════════════════════════ */

export interface VoicePerceptionPorts {
  /** UI ses seviyesi (0..1). Kök `push({ volumeLevel })` yapar — durum KÖKÜNDÜR. */
  readonly setVolumeLevel: (level: number) => void;
  /**
   * Sohbet turları arasında mıyız (takip dinlemesi kurulu)? Ducking bunu
   * SORAR, kendi cevabını üretmez: sohbet sürerken müziği aç-kapa etmek
   * kullanıcıya "bozuk" hissettirir.
   */
  readonly isFollowUpEngaged: () => boolean;
  /** Tarayıcı yolunda Web Speech gerçekten var mı (yetenek BEYANI için). */
  readonly webSpeechAvailable: () => boolean;
}

/** Portlar bağlanana kadar hiçbir şey yapılmaz — sessiz varsayım YOK. */
let _ports: VoicePerceptionPorts | null = null;

/** Bileşim kökü çağırır (modül yüklenirken DEĞİL — import yan etkisi yok). */
export function configureVoicePerception(ports: VoicePerceptionPorts): void {
  _ports = ports;
}

function _setVolume(level: number): void {
  try { _ports?.setVolumeLevel(level); } catch { /* fail-soft: gösterge UI'ı bozamaz */ }
}

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · SES SEVİYESİ GÖSTERGESİ
 * ════════════════════════════════════════════════════════════════════════ */

let _audioCtx: AudioContext | null = null;
let _stream: MediaStream | null = null;
let _animationFrame: number | null = null;
/** Native STT: gerçek AudioContext yok — sentetik dalga ile görsel geri bildirim. */
let _volumeSimTimer: ReturnType<typeof setInterval> | null = null;
/** Native RMS event listener handle (gerçek mikrofon seviyesi). */
let _rmsListenerHandle: { remove: () => Promise<void> } | null = null;

/**
 * AudioContext donma koruması — her dinleme tetiklemesinde `suspended` ise
 * devam ettir. Kaynağın SAHİBİ bu dosyadır; kök yalnız "dinleme başlıyor" der.
 */
export function resumeSuspendedAudioContext(): void {
  if (_audioCtx && _audioCtx.state === 'suspended') {
    _audioCtx.resume().catch(() => {});
  }
}

export function stopVolumeMeter(): void {
  if (_animationFrame) cancelAnimationFrame(_animationFrame);
  if (_stream) _stream.getTracks().forEach((t) => t.stop());
  if (_audioCtx && _audioCtx.state !== 'closed') _audioCtx.close();
  _animationFrame = null;
  _stream = null;
  _audioCtx = null;
  _setVolume(0);
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
export function startVolumeSimulation(): void {
  stopVolumeSimulation();
  let t = 0;
  _volumeSimTimer = setInterval(() => {
    t += 1;
    const base   = 0.32 + 0.22 * Math.sin(t / 3);
    const jitter = 0.18 * Math.random();
    _setVolume(Math.max(0.06, Math.min(1, base + jitter)));
  }, 120);
}

export function stopVolumeSimulation(): void {
  if (_volumeSimTimer !== null) {
    clearInterval(_volumeSimTimer);
    _volumeSimTimer = null;
  }
  _setVolume(0);
}

export function startNativeVolumeListener(): void {
  if (_rmsListenerHandle) return;
  // 'rmsData' plugin arabiriminde TANIMLI (bkz. nativePlugin.ts) — cast yok.
  CarLauncher.addListener('rmsData', (data: { value: number }) => {
    _setVolume(data.value);
  }).then((handle) => {
    _rmsListenerHandle = handle;
  }).catch(() => {});
}

export function stopNativeVolumeListener(): void {
  if (_rmsListenerHandle) {
    _rmsListenerHandle.remove().catch(() => {});
    _rmsListenerHandle = null;
  }
  _setVolume(0);
}

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · ASİSTAN DUCKING'İ
 *
 * Asistan dinlerken müziği duraklatıp bittiğinde devam ettirmek için: yalnız BİZ
 * duraklattıysak geri başlat (kullanıcının kendi duraklatmasını ezme).
 * ════════════════════════════════════════════════════════════════════════ */

let _assistantDuckedMusic = false;

/**
 * Dinlemeye geçince müziği duraklat (çalıyorsa), asistan tamamen bitince
 * (idle'a dönünce) devam ettir. `mediaService.play/pause` uygulama-içi
 * oynatıcıyı (YouTube/stream/yerel) doğru yönlendirir. Lazy import → döngü yok.
 */
export function applyAssistantDuck(prev: string, next: string): void {
  if (next === 'listening' && prev === 'idle') {
    void import('../mediaService')
      .then(({ getMediaState, pause }) => {
        if (getMediaState().playing) { _assistantDuckedMusic = true; pause(); }
      })
      .catch(() => {});
    return;
  }
  if (next === 'idle' && prev !== 'idle' && _assistantDuckedMusic) {
    // Sohbet devam edecek (takip dinlemesi kurulu) → müziği turlar arasında
    // aç-kapa yapma; oturum tamamen bitince geri başlat.
    let engaged = false;
    try { engaged = _ports?.isFollowUpEngaged() === true; } catch { engaged = false; }
    if (engaged) return;
    _assistantDuckedMusic = false;
    void import('../mediaService').then(({ play }) => play()).catch(() => {});
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

/* ══════════════════════════════════════════════════════════════════════════
 * 3 · MAVI-F3 · KISMİ TRANSKRİPT AKIŞI (streaming ASR)
 *
 * Mavi kullanıcının cümlesinin BİTMESİNİ beklemeden anlamaya başlar. Buradaki
 * kod YALNIZ kanıt toplar ve cümle-sonu (endpoint) kararını üretir:
 *
 *   · Kısmi transkript HİÇBİR eylemi tetiklemez — `processTextCommand` bu
 *     bloktan ÇAĞRILMAZ (bu dosya onu import bile ETMEZ). Eylem yolu tektir:
 *     `startSpeechRecognition` promise'i.
 *   · Karar "cümle bitti" derse yapılan tek şey `finalizeSpeechRecognition()`tir —
 *     yani mikrofonu erken kapatmak. Navigasyon/arama/ayar/medya/araç YOK.
 *   · Kısmi metin telemetriye/log'a/diske YAZILMAZ (yalnız oturum belleğinde).
 *   · Erken bitirme komutu VARSAYILAN KAPALIDIR: karar üretilir ve ÖLÇÜLÜR ama
 *     sağlayıcıya dokunulmaz → cihaz davranışı bugünküyle BİREBİR aynı kalır ve
 *     `prematureEndpointRate` gerçek kullanıcıyı KESMEDEN sahada ölçülebilir.
 *     Spec'in kademeli eşik indirimi (1100→900→700→500→350) ancak bu ölçüm
 *     alındıktan sonra ilerler (Risk: YÜKSEK — erken endpoint sözü keser).
 * ════════════════════════════════════════════════════════════════════════ */

/** Yerel/LAB kaldıracı — YALNIZ tam `"true"` açar (fail-closed). */
export const MAVI_F3_COMMAND_FLAG = 'mavi.semanticEndpoint.command';
/** Uzak yapılandırma bayrağı adı (değeri composition root enjekte eder). */
export const MAVI_F3_REMOTE_FLAG = 'mavi_semantic_endpoint';
let _f3RemoteFlag = false;

/** Composition root'tan uzak bayrağı bağlar (MAVI-F0 deseniyle AYNI). */
export function setMaviSemanticEndpointRemoteFlag(enabled: boolean): void {
  _f3RemoteFlag = enabled === true;
}

export function isSemanticEndpointCommandEnabled(): boolean {
  if (_f3RemoteFlag) return true;
  try {
    return typeof localStorage !== 'undefined'
      && localStorage.getItem(MAVI_F3_COMMAND_FLAG) === 'true';
  } catch { return false; }
}

let _partialListenerHandle: { remove: () => Promise<void> } | null = null;
let _f3SessionId = 0;

/**
 * Köprünün KAYITLI metot listesinde bu metot var mı?
 *
 * `Capacitor.PluginHeaders` yalnız native köprüde bulunur ve gerçekten
 * kaydedilmiş `@PluginMethod`ları listeler — `typeof` probu gibi her ada
 * `'function'` DÖNMEZ. Okunamıyorsa `null` döner (bilinmiyor) ve çağıran
 * eski davranışına düşer: **bilinmeyen, "var" sayılmaz.**
 */
function _pluginMethodRegistered(plugin: string, method: string): boolean | null {
  try {
    const headers = (globalThis as {
      Capacitor?: { PluginHeaders?: { name: string; methods: { name: string }[] }[] };
    }).Capacitor?.PluginHeaders;
    if (!Array.isArray(headers)) return null;
    const entry = headers.find((p) => p?.name === plugin);
    if (!entry || !Array.isArray(entry.methods)) return null;
    return entry.methods.some((m) => m?.name === method);
  } catch { return null; }
}

/** Bu derlemedeki GERÇEK akış yeteneği — VARSAYILMAZ, BİLDİRİLİR. */
function _resolveSttCapability(): SttStreamCapability {
  if (!isNative) {
    /* Web `webkitSpeechRecognition` interim sonuç verir ama akustik sessizliği
     * JS'e AÇMAZ → sahte VAD kurmak yerine yetenek dürüstçe bildirilir. */
    let available = false;
    try { available = _ports?.webSpeechAvailable() === true; } catch { available = false; }
    return available ? 'STREAMING_TEXT_ONLY' : 'UNAVAILABLE';
  }
  /* Eski plugin sürümünde `sttPartial` olayı hiç yayınlanmaz ve
   * `finalizeSpeechRecognition` YOKTUR → yol final-only'dir. Yetenek ikinci bir
   * sinyalle (komut metodunun KAYITLI OLMASI) doğrulanır; uydurulmaz.
   *
   * ── SAHA (2026-08-30 · gerçek cihaz, Xiaomi 23090RA98I / Android 13) ────────
   * Bu kontrol eskiden `typeof CarLauncher.finalizeSpeechRecognition === 'function'`
   * idi ve CİHAZDA ÖLÇÜLDÜ Kİ **HER ZAMAN `true` DÖNÜYOR**: Capacitor'ün köprü
   * nesnesi bir Proxy'dir ve **var olmayan bir ad için de** fonksiyon üretir
   * (`typeof CarLauncher.__olmayan_metot__` da `'function'`). Yani "yetenek
   * VARSAYILMAZ, BİLDİRİLİR" sözleşmesi pratikte çalışmıyordu: eski/eksik bir
   * plugin derlemesinde bile `STREAMING_WITH_VAD` bildirilir, semantik endpoint
   * platformun hiç üretmediği bir VAD'a güvenirdi.
   *
   * Doğru sinyal `Capacitor.PluginHeaders`tır: köprünün GERÇEKTEN kaydettiği
   * metot listesi. Cihazda doğrulandı — `finalizeSpeechRecognition` VAR,
   * uydurma bir ad YOK (ayırt ediyor). Başlıklar okunamazsa (eski köprü / web
   * derlemesi) eski davranış AYNEN korunur: yeni bir yetenek iddiası üretilmez. */
  const hasFinalize = _pluginMethodRegistered('CarLauncher', 'finalizeSpeechRecognition')
    ?? (typeof (CarLauncher as { finalizeSpeechRecognition?: unknown })
      .finalizeSpeechRecognition === 'function');
  return hasFinalize ? 'STREAMING_WITH_VAD' : 'FINAL_ONLY';
}

/** Sağlayıcıya "şimdi bitir" komutu — YALNIZ mikrofonu kapatır. */
function _f3Finalize(): void {
  try {
    const fn = (CarLauncher as { finalizeSpeechRecognition?: () => Promise<unknown> })
      .finalizeSpeechRecognition;
    if (typeof fn === 'function') void fn.call(CarLauncher).catch(() => {});
  } catch { /* fail-soft: komut düşerse akustik VAD zaten bitirir */ }
}

export function openPartialTranscriptSession(): void {
  const capability = _resolveSttCapability();
  setMaviLatencySttCapability(capability);          // MAVI-F0 izine bounded enum
  configureSttPartialPorts({
    now: () => (typeof performance !== 'undefined' ? performance.now() : 0),
    finalize: _f3Finalize,
    onDecision: (ev) => {
      /* GİZLİLİK: transcript GEÇMEZ — yalnız bounded enum + sayaç + süre. */
      markMaviLatency('endpoint_decision');
      setMaviLatencyEndpoint({
        reason:       ev.reason,
        completeness: ev.completeness,
        partialCount: ev.partialCount,
        commanded:    ev.commanded,
      });
    },
  });
  _f3SessionId = openListenSession({
    capability,
    commandFinalize: isSemanticEndpointCommandEnabled(),
    thresholds: DEFAULT_ENDPOINT_THRESHOLDS,
  });
  if (capability === 'FINAL_ONLY' || capability === 'UNAVAILABLE') return;

  if (isNative && !_partialListenerHandle) {
    CarLauncher.addListener('sttPartial', (data) => {
      /* TUR SAHİPLİĞİ: eskimiş oturumun geç gelen kısmi olayı SESSİZCE düşer ve
       * yeni oturumun durumunu DEĞİŞTİREMEZ — kimlik karşılaştırması
       * `sttPartialStream` içinde YAPISALDIR. */
      notePartialTranscript(data.text, data.silenceMs, data.speechMs);
    }).then((h) => { _partialListenerHandle = h; }).catch(() => {});
  }
}

/** Kısmi kanıt girişi — web ve native yollarının ORTAK kapısı. */
export function notePartialTranscript(text: string, silenceMs?: number, speechMs?: number): void {
  const sid = _f3SessionId;
  if (!sid || activeListenSessionId() !== sid) return;   // eskimiş/kapalı oturum
  const first = !hasMaviLatencyMark('first_partial');
  const decision = notePartial(sid, {
    // -1 = "ölçülmedi" → null. Sahte sessizlik ASLA uydurulmaz.
    text,
    silenceMs: typeof silenceMs === 'number' && silenceMs >= 0 ? silenceMs : null,
    speechMs:  typeof speechMs  === 'number' && speechMs  >= 0 ? speechMs  : null,
  });
  if (!decision) return;
  if (first) markMaviLatency('first_partial');
  if (decision.completeness === 'COMPLETE') markMaviLatency('semantic_complete_candidate');
  if (decision.agreeingTicks > 0) markMaviLatency('stable_partial');
}

export function closePartialTranscriptSession(reason: 'FINAL_PROVIDER' | 'CANCELLED'): void {
  if (_f3SessionId) {
    if (reason === 'FINAL_PROVIDER') noteProviderFinal(_f3SessionId);
    else closeListenSession(_f3SessionId, 'CANCELLED');
    _f3SessionId = 0;
  }
  if (_partialListenerHandle) {
    _partialListenerHandle.remove().catch(() => {});
    _partialListenerHandle = null;
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * TEARDOWN — açtığı HER kaynağın kapatıcısı BU DOSYADADIR
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Koşulsuz söküm (hard kill). `voiceService.stopVoiceService()` çağırır:
 * LIMP_HOME ve L3 termal olaylarında hiçbir algı kaynağı ayakta kalmaz.
 * İdempotent — ikinci çağrı zararsızdır.
 */
export function disposeVoicePerception(): void {
  closePartialTranscriptSession('CANCELLED');
  stopVolumeSimulation();
  stopNativeVolumeListener();
  stopVolumeMeter();
}

/** @internal — testler arası izolasyon (üretim yolunda çağrılmaz). */
export function _resetVoicePerceptionForTest(): void {
  disposeVoicePerception();
  _assistantDuckedMusic = false;
  _f3RemoteFlag = false;
  _ports = null;
}
