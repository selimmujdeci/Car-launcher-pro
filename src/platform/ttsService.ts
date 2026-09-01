/**
 * TTS Service — metin-to-ses, Web Speech API tabanlı.
 *
 * Android WebView Chromium ≥ 80 üzerinde SpeechSynthesis çalışır;
 * herhangi bir native entegrasyon veya API anahtarı gerekmez.
 *
 * Kullanım:
 *   speakFeedback('Harita açılıyor')          — sesli komut geri bildirimi
 *   speakNavigation('500 metre sonra sağa dön') — navigasyon yönlendirmesi
 *   ttsCancel()                                — devam eden seslendirmeyi kes
 */

import { duckMedia, unduckMedia } from './audioService';
import { Capacitor } from '@capacitor/core';
import { CarLauncher } from './nativePlugin';
import { useHazardStore } from '../store/useHazardStore';
import { normalizeForSpeech } from './speechText';
import { segmentSpeech, type SpeechSegment } from './speechSegment';
import { isLowEndDevice } from './headUnitCompat';
import { tryPlayClip, cancelClip } from './voiceClips';
import { speakOnline, isOnlineTtsAvailable, cancelOnline } from './onlineTtsService';
import { speakEdge, isEdgeTtsAvailable, cancelEdge } from './edgeTtsService';
/* MAVI-F0: ilk duyulabilir ses ölçümü (YALNIZ ÖLÇÜM — hiçbir TTS kararını etkilemez). */
import { markMaviLatency } from './assistant/maviLatencyTrace';

/* ── Platform detection ──────────────────────────────────── */

const _isNative = Capacitor.isNativePlatform();

/* ── Availability check ──────────────────────────────────── */

function isTTSAvailable(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

/* ── Voice selection ─────────────────────────────────────── */

let _cachedVoice: SpeechSynthesisVoice | null = null;

function _getTurkishVoice(): SpeechSynthesisVoice | null {
  if (!isTTSAvailable()) return null;
  if (_cachedVoice) return _cachedVoice;

  const voices = window.speechSynthesis.getVoices();
  // 1. Exact tr-TR match
  _cachedVoice = voices.find((v) => v.lang === 'tr-TR') ?? null;
  // 2. Any Turkish voice
  if (!_cachedVoice) _cachedVoice = voices.find((v) => v.lang.startsWith('tr')) ?? null;
  return _cachedVoice;
}

// Voices may not be loaded immediately — refresh cache on voiceschanged
function _onVoicesChanged() {
  _cachedVoice = null;
  _getTurkishVoice(); // prime cache
}
if (isTTSAvailable()) {
  window.speechSynthesis.addEventListener('voiceschanged', _onVoicesChanged);
}

// HMR cleanup — prevents duplicate listeners across hot reloads
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    if (isTTSAvailable()) {
      window.speechSynthesis.removeEventListener('voiceschanged', _onVoicesChanged);
      window.speechSynthesis.cancel();
    }
    // Duck state'i sıfırla — yeni modül instance temiz başlasın
    _ttsDucking = false;
    _cachedVoice = null;
    _lastSpokenText = '';
  });
}

/* ── TTS bitiş olayı (takip dinlemesi için) ───────────────── */

/**
 * Her seslendirme tamamlandığında (bitti/kesildi/atlandı) çağrılan dinleyiciler.
 * voiceService takip modunda "cevap bitti → mikrofonu yeniden aç" anını buradan alır.
 * Dedupe ile ATLANAN konuşmalar da bildirir — aksi halde takip modu asılı kalır.
 */
type TtsEndListener = () => void;
const _ttsEndListeners = new Set<TtsEndListener>();

export function registerTtsEndListener(cb: TtsEndListener): () => void {
  _ttsEndListeners.add(cb);
  return () => { _ttsEndListeners.delete(cb); };
}

/* ── Aktif konuşma durumu ───────────────────────────────────
 * SAHA HATASI (2026-07-24): "uzun muhabbetlerde Mavi cümlenin ortasında kesilip
 * dinlemeye geçiyor (dut sesi)". KÖK: voiceService'in EMNİYET zamanlayıcıları
 * (takip dinlemesi 20sn, sohbet-idle 15sn) TTS bitiş eventi hiç gelmezse akış
 * asılı kalmasın diye konmuştu — ama "konuşma bitti mi?" diye SORMUYOR, sabit
 * süreyle VARSAYIYORLARDI. 20 saniyeden uzun bir cevap (TR ~12-15 karakter/sn →
 * ~250 karakterden sonrası) hâlâ konuşulurken zamanlayıcı ateşliyor,
 * startListening() → ttsCancel() cevabı ortadan kesiyordu.
 *
 * Bu bayrak zamanlayıcılara GERÇEK konuşma durumunu verir: konuşma sürerken
 * emniyet penceresi uzatılır, kesilmez. Emniyet rolü kaybolmaz — tavan (aşağıda)
 * takılı kalmış bir konuşmayı yine de "bitmiş" sayar (fail-soft, CLAUDE.md §2).
 *
 * Süre MONOTONİK saatten (performance.now) — clock-jump güvenli (§4).
 */

/** Bir konuşma bundan uzun sürüyorsa motoru takılmış say (sonsuz uzatma YASAK). */
const MAX_SPEAKING_MS = 120_000;
/** Aktif konuşmanın başlangıcı (monotonik); 0 = konuşmuyor. */
let _speakingSince = 0;

function _nowMono(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/* ══════════════════════════════════════════════════════════════════════════
 * MAVI-F12 · UÇUŞTAKİ SÖZÜN KANALI ve TAŞIMA YOLU
 *
 * Barge-in hakemi (`assistant/maviBargeIn`) iki soruyu SORMAK ZORUNDADIR ve
 * ikisinin de cevabı YALNIZ burada bilinir:
 *
 *  1. **Bu söz KORUNAN bir kanal mı?** Kullanıcının Mavi'yi kesebilmesi,
 *     güvenlik/tehlike/navigasyon sesini kesme yetkisi DEĞİLDİR (K1 korunur).
 *     `isTtsSpeaking()` tek başına bunu söyleyemez — "konuşuyor" der, "ne
 *     konuşuyor" demez.
 *  2. **Bu söz çalarken mikrofon FİİLEN açık mı?** Native motor yolunda
 *     `CarLauncherPlugin.wakeMicMustYield()` mikrofonu BIRAKIR (`nativeTtsSpeaking`).
 *     Ama premium klip · Edge · online · `speechSynthesis` sesi WebView'den
 *     çıkar ve o bayrağı KURMAZ → wake thread mikrofonu AÇIK TUTAR ve Mavi
 *     kendi sesini duyabilir. Bu, self-echo riskinin ÖLÇÜLEBİLİR kaynağıdır.
 *
 * Yeni bir otorite kurulmaz: bu alanlar yalnız GÖZLEMdir, hiçbir TTS kararını
 * değiştirmez ve dışarı METİN taşımaz.
 * ════════════════════════════════════════════════════════════════════════ */

/** Uçuştaki sözün kanalı — bounded, serbest metin YOK. */
export type MaviTtsChannel =
  | 'NONE' | 'ASSISTANT' | 'NAVIGATION' | 'SAFETY' | 'HAZARD' | 'HARDWARE' | 'STATUS';

/** Sesin fiilen hangi motordan çıktığı — mikrofon yaşam döngüsünü belirler. */
export type MaviTtsTransport = 'NONE' | 'NATIVE_ENGINE' | 'WEBVIEW_AUDIO';

/**
 * Kesilemeyen kanallar. **Pazarlıksız:** bu üçü kullanıcının barge-in'iyle
 * susturulamaz (spec §20.2 önceliği aynen korunur).
 */
const PROTECTED_SPEECH_CHANNELS: readonly MaviTtsChannel[] =
  Object.freeze(['SAFETY', 'HAZARD', 'NAVIGATION']);

let _speechChannel: MaviTtsChannel = 'NONE';
/** Bir sonraki söz için sarmalayıcının bildirdiği kanal (tek kullanımlık). */
let _nextSpeechChannel: MaviTtsChannel | null = null;
let _speechTransport: MaviTtsTransport = 'NONE';

/** Sarmalayıcı kendi kanalını bildirir; `_markSpeakingStart` bunu TÜKETİR. */
function _pinSpeechChannel(c: MaviTtsChannel): void { _nextSpeechChannel = c; }
/** Ses fiilen hangi motordan çıkıyor (hibrit zincirde tier seçildiği anda). */
function _markTransport(t: MaviTtsTransport): void { _speechTransport = t; }

function _markSpeakingStart(): void {
  _speakingSince = _nowMono();
  _speechChannel = _nextSpeechChannel ?? 'ASSISTANT';
  _nextSpeechChannel = null;
}
/** Yalnız emniyet tavanını tazeler — kanal/taşıma DOKUNULMAZ (akış ortası). */
function _refreshSpeakingClock(): void { _speakingSince = _nowMono(); }
function _markSpeakingEnd():   void {
  _speakingSince = 0;
  _speechChannel = 'NONE';
  _speechTransport = 'NONE';
}

/** Uçuştaki sözün kanalı. Konuşulmuyorsa `NONE` (sahte değer ÜRETİLMEZ). */
export function getMaviTtsChannel(): MaviTtsChannel {
  return isTtsSpeaking() ? _speechChannel : 'NONE';
}

/**
 * Uçuştaki söz KORUNAN bir kanal mı — barge-in bunu kesemez.
 * Telefon çağrısı ayrı bir ses odağı otoritesidir ve zaten Mavi'yi susturur;
 * burada yalnız TTS kanalları sınıflandırılır.
 */
export function isProtectedSpeechInFlight(): boolean {
  return isTtsSpeaking() && PROTECTED_SPEECH_CHANNELS.includes(_speechChannel);
}

/**
 * Bu söz çalarken mikrofon FİİLEN açık mı (self-echo riskinin ölçüsü).
 *
 * `true` YALNIZ native platformda ve WebView ses yolunda döner: orada
 * `nativeTtsSpeaking` KURULMAZ → wake grammar thread'i mikrofonu bırakmaz.
 * Web/tarayıcı modunda native wake thread'i YOKTUR → `false`.
 */
export function isMicCaptureOpenDuringSpeech(): boolean {
  return isTtsSpeaking() && _isNative && _speechTransport === 'WEBVIEW_AUDIO';
}

/**
 * Şu anda bir asistan/geri bildirim sözü seslendiriliyor mu?
 *
 * Tüm yolları (premium klip · Edge · online · native · web) kapsar: bayrak
 * konuşma giriş noktalarında kurulur, `_notifyTtsEnd`/`ttsCancel` tek çıkışında
 * sıfırlanır. Motor onDone'u hiç göndermezse `MAX_SPEAKING_MS` tavanı devreye
 * girer → asla kalıcı "konuşuyor" durumunda kilitlenmez.
 */
export function isTtsSpeaking(): boolean {
  if (_speakingSince === 0) return false;
  if (_nowMono() - _speakingSince > MAX_SPEAKING_MS) { _speakingSince = 0; return false; }
  return true;
}

/* ══════════════════════════════════════════════════════════════════════════
 * MAVI-F4 · TEK KONUŞMA OTURUMU (streaming cevap)
 *
 * Streaming cevapta Mavi tek metin yerine ardışık PARÇALAR konuşur. Her parça
 * kendi bitişini yayınlasaydı `voiceService` İLK PARÇADAN SONRA "cevap bitti"
 * sayıp takip dinlemesini açar, duck'ı kaldırır ve **Mavi kendi cevabının
 * kalanını keserdi** (mikrofon açılışı `ttsCancel` çağırır).
 *
 * Bu sayaç açıkken bitiş bildirimi YUTULUR ve "konuşuyor" bayrağı TAZELENİR →
 * emniyet zamanlayıcıları (MAX_SPEAKING_MS · takip penceresi) akışı ortadan
 * kesmez. Oturum kapanınca bitiş TEK KEZ yayınlanır.
 *
 * `ttsCancel` sayacı SIFIRLAR: barge-in sonrası oturum askıda kalamaz.
 * ════════════════════════════════════════════════════════════════════════ */
let _speechSessionDepth = 0;

/** Akış başlıyor — bitiş bildirimleri oturum kapanana kadar YUTULUR. */
export function beginTtsSpeechSession(): void {
  _speechSessionDepth += 1;
  _markSpeakingStart();
}

/**
 * Akış bitti — bitiş bildirimi TEK KEZ yayınlanır.
 * @param notify `false` ise bildirim yapılmaz (iptal yolu: `ttsCancel` zaten
 *        uçuştaki sözü bayatlattı, ikinci bir "bitti" takip dinlemesini açardı).
 */
export function endTtsSpeechSession(notify = true): void {
  if (_speechSessionDepth > 0) _speechSessionDepth -= 1;
  if (_speechSessionDepth > 0) return;
  if (notify) _notifyTtsEnd();
  else _markSpeakingEnd();
}

/** Akış oturumu şu an açık mı (tanı/kilit yüzeyi). */
export function isTtsSpeechSessionActive(): boolean { return _speechSessionDepth > 0; }

/**
 * MAVI-F4 · PARÇA bitişi dinleyicileri — oturum açık olsun olmasın HER utterance
 * bitişinde çalışır. Akış sıralayıcısı (`maviSpeechStream`) sıradaki parçaya
 * ancak bu sinyalle geçer → iki TTS parçası ÜST ÜSTE BİNEMEZ.
 *
 * `_ttsEndListeners`ten AYRIDIR ve olmak zorundadır: o dinleyiciler "CEVAP
 * bitti" anlamına gelir (takip dinlemesi · idle · duck kaldırma) ve akış
 * ortasında tetiklenirse Mavi kendi cevabını keser.
 */
const _chunkEndListeners = new Set<TtsEndListener>();

/** Parça bitişine abone olur; dönen fonksiyon aboneliği söker (zero-leak). */
export function registerTtsChunkEndListener(cb: TtsEndListener): () => void {
  _chunkEndListeners.add(cb);
  return () => { _chunkEndListeners.delete(cb); };
}

function _notifyTtsEnd(): void {
  // PARÇA bitişi HER durumda yayınlanır (akış sıralayıcısının tek sinyali).
  _chunkEndListeners.forEach((fn) => { try { fn(); } catch { /* dinleyici hatası TTS'i kırmasın */ } });
  /* MAVI-F4: oturum açıkken bu bir PARÇA bitişidir, CEVAP bitişi DEĞİL. */
  if (_speechSessionDepth > 0) {
    /* MAVI-F12: YALNIZ saat tazelenir. `_markSpeakingStart()` çağrılsaydı akışın
     * ortasında kanal `ASSISTANT`a sıfırlanır ve taşıma yolu bilgisi (self-echo
     * kanıtı) her parçada kaybolurdu. */
    _refreshSpeakingClock();   // konuşma SÜRÜYOR — emniyet tavanı tazelenir
    return;
  }
  _markSpeakingEnd();
  _ttsEndListeners.forEach((fn) => { try { fn(); } catch { /* dinleyici hatası TTS'i kırmasın */ } });
}

/**
 * Seslendirme sırası: QUEUE_FLUSH eski utterance'ı keser ve onun bitişi de
 * (onStop) settle tetikler. Yalnız EN SON utterance'ın bitişi "konuşma bitti"
 * sayılır — aksi halde flush edilen "Düşünüyorum..." cümlesinin bitişi, asıl
 * cevap hâlâ konuşulurken takip dinlemesini/unduck'ı erken tetiklerdi.
 */
let _speakSeq = 0;

/* ── Rate limiting ───────────────────────────────────────── */

/** Aynı metni kısa aralıkla tekrar seslendirme */
let _lastSpokenText = '';
let _lastSpokenAt   = 0;
const MIN_REPEAT_MS = 3_000;

/** speakFeedback dedupe (premium yola devredildi → ttsSpeak dedupe'undan bağımsız). */
let _lastFeedbackText = '';
let _lastFeedbackAt   = 0;

/**
 * Asistan/geri bildirim seslendirme "nesli" — premium hibrit zincirde (Edge→online→
 * tarayıcı) daha yeni bir çağrı başladığında ESKİ çağrının alt yedeğe (erkek tarayıcı
 * sesi) DÜŞMESİNİ engeller. speakEdge supersede'de false döner; guard olmadan eski
 * çağrı online/tarayıcı yedeğine kaçıp erkek sesle çakışırdı.
 */
let _assistantGen = 0;

/** Aktif bir duckMedia çağrısı var mı — çakışan duck çağrısını önler */
let _ttsDucking = false;

/* ── Core speak ──────────────────────────────────────────── */

interface SpeakOptions {
  /** Konuşma hızı: 0.1–10, varsayılan 1.0 */
  rate?: number;
  /** Ses yüksekliği: 0–2, varsayılan 1.0 */
  pitch?: number;
  /** Devam eden sesi kesmeden önce kuyruğa ekle */
  queue?: boolean;
  /** Seslendirme tamamlandığında çağrılır — Audio Ducking restore için kullanılır */
  onEnd?: () => void;
  /** MIN_REPEAT_MS deduplikasyonunu atla — güvenlik uyarıları için */
  force?: boolean;
  /**
   * Segmentasyon + mikro-duraklama uygula (P0-2). Varsayılan true.
   * Güvenlik/acil uyarılarında false verilir → tek utterance, gecikmesiz.
   */
  segment?: boolean;
}

export function ttsSpeak(text: string, opts: SpeakOptions = {}): void {
  if (!text.trim()) return;

  const now = Date.now();
  if (!opts.force && text === _lastSpokenText && now - _lastSpokenAt < MIN_REPEAT_MS) {
    // Dedupe atladı — başka seslendirme uçuşta değilse yine de "bitti" bildir:
    // takip dinlemesi bu sinyali bekliyor (uçuştaki utterance kendi bitişini bildirir).
    if (!_ttsDucking) setTimeout(_notifyTtsEnd, 0);
    return;
  }
  _lastSpokenText = text;
  _lastSpokenAt   = now;
  // Bu noktadan sonra gerçekten bir söz üretilecek → emniyet zamanlayıcıları
  // konuşma bitene kadar akışı kesmesin (isTtsSpeaking).
  _markSpeakingStart();

  // ── Üst üste binme önleme (kuyruğa alınmadıkça) ──────────────────────────────
  // Yeni bir söz, uçuştaki HER kanalı (premium klip + tarayıcı SpeechSynthesis)
  // susturur. KRİTİK: bu, aşağıdaki tryPlayClip'ten ÖNCE olur — eskiden klip yolu
  // web `speechSynthesis.cancel()`'dan ÖNCE return ediyordu, bu yüzden tarayıcı ara
  // sözü ("Bir saniye...") ile premium klip AYNI ANDA çalıyordu (kız+erkek sesi
  // üst üste). _speakSeq bumplanır → kesilen web sözünün bitişi (aşağıda seq-korumalı)
  // follow-up/idle'ı erken tetiklemez.
  if (!opts.queue) {
    cancelClip();
    if (!_isNative && isTTSAvailable()) window.speechSynthesis.cancel();
    _speakSeq++;
  }

  // ── Premium ses bankası (hibrit Phase 1) — sabit/kritik ifadeler stüdyo kalite
  // klipten çalınır; native/web TTS atlanır. Eşleşmezse normal TTS yoluna düşer.
  // Klip bitiş semantiği TTS ile aynı: takip dinlemesi (_notifyTtsEnd) + onEnd.
  if (tryPlayClip(text, () => { _notifyTtsEnd(); opts.onEnd?.(); })) {
    _markTransport('WEBVIEW_AUDIO');   // MAVI-F12: klip WebView'den çalar → mikrofon açık kalır
    return;
  }

  // ── Ön-işleme (P0-1) + segmentasyon/prozodi (P0-2 + P1-1) — platformdan ÖNCE ──
  // Taban değerler: native motor 1.0, web 1.05 (eski davranış korunur).
  const baseRate  = opts.rate  ?? (_isNative ? 1.0 : 1.05);
  const basePitch = opts.pitch ?? 1.0;
  const spoken    = normalizeForSpeech(text);
  // segment === false → güvenlik/acil uyarısı: tek utterance, gecikmesiz, prozodi yok.
  const segments: SpeechSegment[] = opts.segment === false
    ? [{ text: spoken, rate: baseRate, pitch: basePitch, pauseMs: 0 }]
    : segmentSpeech(spoken, { rate: baseRate, pitch: basePitch, lowEnd: isLowEndDevice() });
  if (segments.length === 0) { _markSpeakingEnd(); return; }

  // ── Native path: Android TextToSpeech (güvenilir, Türkçe destekli) ──
  if (_isNative) {
    const seq = ++_speakSeq;
    /* MAVI-F12: native motor yolu — `CarLauncherPlugin` `nativeTtsSpeaking`
     * bayrağını kurar ve wake thread mikrofonu BIRAKIR (yarım-duplex). */
    _markTransport('NATIVE_ENGINE');
    if (!_ttsDucking) { _ttsDucking = true; duckMedia(); }
    // speak()/speakSegments() Promise'i seslendirme BİTİNCE çözülür (UtteranceProgressListener;
    // segmentlerde yalnız SON segmentin onDone'u). Bazı OEM motorları onDone'u hiç çağırmayabilir
    // → süre tahminli emniyet zamanlayıcısı: hangisi önce gelirse bir kez işlenir.
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      // Yalnız en son seslendirme global durumu kapatır (flush edilen eskiler dokunmaz)
      if (seq === _speakSeq) {
        _ttsDucking = false;
        unduckMedia();
        _notifyTtsEnd();
      }
      opts.onEnd?.();
    };
    const estimatedMs = Math.min(30_000, 3_000 + spoken.length * 110);
    const safety = setTimeout(settle, estimatedMs);
    /* MAVI-F0 · DÜRÜSTLÜK SINIRI: Android `TextToSpeech` bu derlemede BAŞLANGIÇ
     * geri bildirimi VERMEZ — `CarLauncher.speak()` Promise'i seslendirme BİTİNCE
     * çözülür (UtteranceProgressListener.onDone). Bu yüzden native yolda yalnız
     * `first_audio_requested` (PROXY) damgalanır; `first_audio_confirmed` ASLA
     * basılmaz. Kuyruklama, sesin duyulduğunun kanıtı DEĞİLDİR. */
    markMaviLatency('first_audio_requested');
    // Çok segmentli → speakSegments (kuyruk native'de yönetilir, son segmentte çözülür).
    // Tek segment → klasik speak (pitch artık native'de uygulanır).
    // Eski APK'da speakSegments yoksa reject → tek-utterance'a düş (asla sessiz kalma).
    const nativeCall = segments.length > 1
      ? CarLauncher.speakSegments({ segments }).catch(() =>
          CarLauncher.speak({ text: spoken, rate: baseRate, pitch: basePitch }))
      : CarLauncher.speak({ text: segments[0].text, rate: segments[0].rate, pitch: segments[0].pitch });
    nativeCall
      .then(() => { clearTimeout(safety); settle(); })
      .catch(() => { clearTimeout(safety); settle(); });
    return;
  }

  // ── Web fallback: SpeechSynthesis API ──────────────────────────────
  if (!isTTSAvailable()) { _markSpeakingEnd(); return; }

  if (!opts.queue) window.speechSynthesis.cancel();

  /* MAVI-F12: tarayıcı sentezi WebView ses yoludur — native platformda
   * `nativeTtsSpeaking` KURULMAZ, wake thread mikrofonu açık tutar. */
  _markTransport('WEBVIEW_AUDIO');

  // duckMedia() TTS engine init'inden ÖNCE çağrılır — gain ramp başlangıç avantajı.
  // _ttsDucking guard: önceki TTS henüz bitmeden yeni çağrı gelirse çift duck önlenir.
  if (!_ttsDucking) { _ttsDucking = true; duckMedia(); }

  // Bu web sözünün sıra numarası — yalnız EN SON söz global durumu (follow-up/idle)
  // sürükler. Kesilen/eski söz (yeni bir söz başladı → _speakSeq arttı) bitişinde
  // _notifyTtsEnd YAPMAZ; aksi halde premium cevap sürerken mikrofon erken açılıyordu.
  const seq = ++_speakSeq;
  const voice = _getTurkishVoice();
  const userOnEnd = opts.onEnd;
  let webSettled = false;
  // Yalnız SON segmentin bitişi (veya herhangi bir segment hatası) durumu kapatır.
  const webSettle = () => {
    if (webSettled) return;
    webSettled = true;
    _ttsDucking = false;
    unduckMedia();
    userOnEnd?.();
    if (seq === _speakSeq) _notifyTtsEnd(); // yalnız güncel söz takip/idle tetikler
  };

  segments.forEach((seg, i) => {
    const utter  = new SpeechSynthesisUtterance(seg.text);
    utter.lang   = 'tr-TR';
    utter.rate   = seg.rate;
    utter.pitch  = seg.pitch;
    utter.volume = 1.0;
    if (voice) utter.voice = voice;
    // Segmentler art arda kuyruğa eklenir (cancel yalnız en başta yapıldı).
    if (i === segments.length - 1) utter.onend = webSettle;
    utter.onerror = webSettle; // fail-soft: herhangi bir segment hatası ducking'i geri açar
    /* MAVI-F0: web yolunda `onstart` GERÇEK seslendirme başlangıcıdır (kanıt);
     * `speak()` çağrısı yalnız kuyruklama isteğidir (proxy). Yalnız İLK segment
     * ölçülür — sonraki segmentler aynı cevabın devamıdır. */
    if (i === 0) {
      utter.onstart = () => { markMaviLatency('first_audio_confirmed'); };
      markMaviLatency('first_audio_requested');
    }
    window.speechSynthesis.speak(utter);
  });
}

/** Devam eden seslendirmeyi anında durdur */
export function ttsCancel(): void {
  _speakSeq++;     // uçuştaki sözü bayatlat → kesilen bitiş follow-up/idle tetiklemesin
  /* MAVI-F4: akış oturumu KOŞULSUZ kapanır. Aksi halde barge-in sonrası sayaç
   * sıfırlanmaz ve sonraki NORMAL cevabın bitişi de yutulurdu (takip dinlemesi
   * bir daha hiç açılmazdı) — sessiz ölüm sınıfı bir hata. */
  _speechSessionDepth = 0;
  _markSpeakingEnd(); // konuşma kesildi: emniyet zamanlayıcıları artık uzatma yapmasın
  cancelClip();    // çalan premium klibi de durdur
  cancelEdge();    // uçuştaki/çalan Edge asistan sesini de durdur
  cancelOnline();  // uçuştaki/çalan online asistan sesini de durdur
  if (_isNative) {
    CarLauncher.ttsStop()
      .then(() => { if (_ttsDucking) { _ttsDucking = false; unduckMedia(); } })
      .catch(() => { if (_ttsDucking) { _ttsDucking = false; unduckMedia(); } });
    return;
  }
  if (isTTSAvailable()) {
    if (_ttsDucking) { _ttsDucking = false; unduckMedia(); }
    window.speechSynthesis.cancel();
  }
}

/* ── Attention-Aware Speech Engine (Phase H4) ───────────────────────────── */

/**
 * Uzaklık ön-eklerini ve kibarca ifadeler yerine emir kipini kullanan
 * kısaltılmış navigasyon talimatı döndürür.
 *
 * "400 metre sonra sağa dönün, Bağdat Caddesi'ne girin"
 *   → "Sağa dön, Bağdat Caddesi"
 */
const _DIST_PATTERNS = [
  /\d+[\s.,]*(?:km|kilometre|m|metre)\s+sonra\s*/gi,
  /yaklaşık\s+\d+\s+\w+\s+sonra\s*/gi,
];

const _POLITE_TO_CMD: [RegExp, string][] = [
  [/\bdönün\b/gi,       'dön'],
  [/\bdevam edin\b/gi,  'devam'],
  [/\bgidin\b/gi,       'git'],
  [/\bgirin\b/gi,       'gir'],
  [/\bçıkın\b/gi,       'çık'],
  [/\byapın\b/gi,       'yap'],
  [/\balın\b/gi,        'al'],
  [/\bkalın\b/gi,       'kal'],
];

export function shortenInstruction(text: string): string {
  let s = text;
  for (const p of _DIST_PATTERNS)      s = s.replace(p, '');
  for (const [f, t] of _POLITE_TO_CMD) s = s.replace(f, t);
  // Yinelenen boşlukları temizle ve kademe karakterlerini kaldır
  return s.replace(/\s*[,;.]\s*$/, '').replace(/\s+/g, ' ').trim();
}

/** Türkçe tehlike tipi → sesli uyarı metni */
const _HAZARD_LABELS_TTS: Record<string, string> = {
  CONSTRUCTION: 'yol çalışması',
  ACCIDENT:     'kaza',
  WEATHER:      'zor hava koşulları',
  SPEED_CAM:    'hız kamerası',
  ROAD_DAMAGE:  'yol hasarı',
  TUNNEL:       'tünel',
};

/**
 * Tehlike uyarısı — otoriter, düşük ses tonu.
 * CarLauncher.speak() pitch parametresini desteklemiyorsa web fallback kullanılır.
 */
export function speakHazardAlert(type: string, distanceM?: number): void {
  const label = _HAZARD_LABELS_TTS[type] ?? 'tehlike';
  let dist = '';
  if (distanceM !== undefined && distanceM > 0) {
    dist = distanceM < 1000
      ? `${Math.round(distanceM / 50) * 50} metre ileride`
      : `${(distanceM / 1000).toFixed(1)} kilometre ileride`;
  }
  const text = dist ? `Dikkat! ${label}, ${dist}.` : `Dikkat! ${label}.`;
  _pinSpeechChannel('HAZARD');   // MAVI-F12: barge-in KESEMEZ
  // Daha ağır ve yavaş ton — sürücüde aciliyet hissi yaratır.
  // segment: false → tek utterance, mikro-duraklama gecikmesi yok (aciliyet korunur).
  ttsSpeak(text, { rate: 0.86, pitch: 0.85, queue: false, segment: false });
}

/**
 * Güvenlik acil uyarısı — en yüksek öncelik kanalı.
 *
 * Farklar:
 *  - __SAFETY_LOCK__ kontrolünü atlar — her zaman çalışır.
 *  - Devam eden TTS'i keser (queue: false).
 *  - MIN_REPEAT_MS deduplikasyonunu geçer (force: true).
 *  - Soğuma (cooldown) safetyService tarafından yönetilir (15s).
 *  - Arbitraj: yakın dönüş (<50m) varsa safetyService zaten atlar.
 */
export function speakSafetyAlert(message: string): void {
  _pinSpeechChannel('SAFETY');   // MAVI-F12: barge-in KESEMEZ (en yüksek öncelik)
  // segment: false → en yüksek öncelik kanalı gecikmesiz tek utterance olarak gider.
  ttsSpeak(message, { rate: 0.82, pitch: 0.82, queue: false, force: true, segment: false });
}

/* ── Semantic helpers ────────────────────────────────────── */

/** Sesli komut tanındığında geri bildirim sesi.
 *  ÖNEMLİ: premium KADIN hibrit zincirine (klip→Edge→online→son çare tarayıcı)
 *  yönlendirilir — doğrudan tarayıcı `speechSynthesis` KULLANILMAZ; çünkü tarayıcı
 *  Türkçe sesi (Windows'ta "Tolga") ERKEK ve asistan sesiyle (Edge kadın) tutarsız
 *  olur. Online'da hep kadın; yalnız tam offline'da tarayıcı/eSpeak yedeği. */
export function speakFeedback(feedback: string): void {
  if (typeof window !== 'undefined' && (window as unknown as Record<string, unknown>).__SAFETY_LOCK__) return;
  const now = Date.now();
  if (feedback === _lastFeedbackText && now - _lastFeedbackAt < MIN_REPEAT_MS) return; // dedupe
  _lastFeedbackText = feedback;
  _lastFeedbackAt   = now;
  speakAssistant(feedback);
}

/**
 * Akıllı asistan (Gemini/Claude/Grok) cevabını seslendirir — hibrit öncelik zinciri:
 *   1) Sabit ifade klibi (offline premium, anında, maliyetsiz)
 *   2) Online TTS (serbest/akıllı cevap — asistan zaten online; motor/kurulum gerekmez)
 *   3) Native/web TTS yedeği (varsa)
 * Böylece TTS motoru OLMAYAN head unit'lerde bile asistan tam sesli çalışır.
 */
export function speakAssistant(text: string, onEnd?: () => void): void {
  const t = text?.trim();
  if (!t) return;
  if (typeof window !== 'undefined' && (window as unknown as Record<string, unknown>).__SAFETY_LOCK__) return;

  // Premium/asistan cevabı BAŞLARKEN uçuştaki HER kanalı sustur: tarayıcı ara sözü
  // ("Bir saniye..." — speakFeedback/SpeechSynthesis), önceki klip ve önceki premium
  // (Edge/online) ses. Aksi halde tarayıcı sesi + premium ses AYNI ANDA (kız+erkek)
  // duyuluyordu. _speakSeq bumplanır → kesilen web ara sözünün bitişi follow-up'ı
  // erken tetiklemez (web settle seq-korumalı).
  if (!_isNative && isTTSAvailable()) window.speechSynthesis.cancel();
  cancelClip(); cancelEdge(); cancelOnline();
  _speakSeq++;
  // Asistan cevabı BAŞLIYOR — hangi tier'a düşerse düşsün (klip/Edge/online/native)
  // emniyet zamanlayıcıları bu cevabı ortasından kesmesin (isTtsSpeaking).
  _markSpeakingStart();
  const gen = ++_assistantGen; // bu cevabın nesli — supersede'de yedeğe düşmeyi engeller

  // 1) Sabit ifade → premium klip (online olsa bile: hızlı + maliyetsiz + offline)
  if (tryPlayClip(t, () => { _notifyTtsEnd(); onEnd?.(); })) {
    _markTransport('WEBVIEW_AUDIO');   // MAVI-F12
    return;
  }

  // Hibrit ses zinciri: 2) Edge (premium TR KADIN, kotasız) → 3) Gemini TTS (kotalı)
  //   → 4) native/tarayıcı eSpeak yedek. Gemini kotası bitince (saha 2026-07-03) Edge
  // premium sesi sürdürür; ikisi de düşerse asla sessiz kalmaz.
  // gen guard: daha yeni bir cevap başladıysa (supersede) alt tiere DÜŞME — aksi
  // halde eski çağrı erkek tarayıcı sesine kaçıp yeni cevapla çakışırdı.
  void (async () => {
    try {
      if (isEdgeTtsAvailable()) {
        const ok = await speakEdge(t, () => { _notifyTtsEnd(); onEnd?.(); });
        if (ok) { _markTransport('WEBVIEW_AUDIO'); return; }   // MAVI-F12
      }
    } catch { /* Edge yolu kırılırsa Gemini'ye düş */ }
    if (gen !== _assistantGen) return; // yeni cevap devraldı → yedeğe düşme
    try {
      if (await isOnlineTtsAvailable()) {
        const ok = await speakOnline(t, () => { _notifyTtsEnd(); onEnd?.(); });
        if (ok) { _markTransport('WEBVIEW_AUDIO'); return; }   // MAVI-F12
      }
    } catch { /* online yolu kırılırsa sessizce yedeğe düş */ }
    if (gen !== _assistantGen) return; // yeni cevap devraldı → tarayıcıya (erkek) düşme
    ttsSpeak(t, { onEnd });
  })();
}

/**
 * Manevra mesajının kritik olup olmadığını belirler.
 * SAFETY_LOCK aktifken yalnızca kritik talimatlar geçer.
 *
 * İzin verilenler: dönüş talimatları, mesafe uyarıları, rota kaybı/yeniden hesap.
 * Engellenenler: trafik bilgisi, alternatif rota, tahmini varış, genel bilgi.
 */
function isCriticalNavigationMessage(msg: string): boolean {
  const n = msg.toLowerCase();
  return (
    n.includes('sağa')    || n.includes('sola')    ||  // dönüş
    n.includes('dön')     || n.includes('çevir')   ||
    n.includes('right')   || n.includes('left')    ||
    n.includes('turn')    ||
    n.includes('100m')    || n.includes('200m')    ||  // mesafe
    n.includes('metre')   || n.includes('meter')   ||
    n.includes('yakında') || n.includes('soon')    ||
    n.includes('kaçırdın')|| n.includes('missed')  ||  // rota kaybı
    n.includes('rota yeniden') || n.includes('rerouting') ||
    n.includes('hesaplanıyor') || n.includes('recalcul')
  );
}

/** Navigasyon yönlendirme duyurusu — net, yavaş, sürücü odaklı.
 *  Phase H4: Dikkat bütçesi düşükse (DAB < 0.4) veya ATTENTION durumundaysa
 *  talimat kısaltılır — mesafe ön-ekleri silinir, emir kipi kullanılır.
 */
export function speakNavigation(instruction: string): void {
  if (
    typeof window !== 'undefined' &&
    (window as unknown as Record<string, unknown>).__SAFETY_LOCK__ &&
    !isCriticalNavigationMessage(instruction)
  ) return;

  const { driverAttentionBudget, hazardStatus } = useHazardStore.getState();
  const needsShorten = driverAttentionBudget < 0.4 || hazardStatus === 'ATTENTION';
  const text = needsShorten ? shortenInstruction(instruction) : instruction;

  _pinSpeechChannel('NAVIGATION');   // MAVI-F12: barge-in KESEMEZ (navigasyon önceliklidir)
  ttsSpeak(text, { rate: 0.92, queue: false });
}

/** Uyarı / hata mesajı ("Anlayamadım" vb.) — asistan sesiyle TUTARLI kadın ses
 *  (premium hibrit). Eskiden tarayıcı erkek sesiyle yüksek pitch'te çıkıyordu. */
export function speakAlert(message: string): void {
  if (typeof window !== 'undefined' && (window as unknown as Record<string, unknown>).__SAFETY_LOCK__) return;
  speakAssistant(message);
}

/* ── T-12: Donanım komut geri bildirimleri ──────────────── */

/**
 * Donanım komutu başarıyla gönderildiğinde.
 * ISO 15008: araç içi sesli geri bildirim kısa ve net olmalı.
 */
export function speakHardwareConfirm(action: string): void {
  _pinSpeechChannel('HARDWARE');   // MAVI-F12: korunan DEĞİL — barge-in kesebilir
  ttsSpeak(action, { rate: 1.0, queue: false });
}

/**
 * Donanım komutu başarısız — MCU bağlı değil veya hata.
 */
export function speakHardwareError(): void {
  _pinSpeechChannel('HARDWARE');   // MAVI-F12
  ttsSpeak('Bağlantı kurulamadı. Tekrar deneyin.', { rate: 0.95, pitch: 1.1, queue: false });
}

/**
 * Araç durum özeti — CAN verisini okunabilir cümleye çevirir.
 * Veri yoksa CLAUDE.md §2 gereği "Veri alınamıyor" der.
 */
export function speakVehicleStatus(opts: {
  speedKmh?: number;
  fuelPct?:  number;
  tempC?:    number;
}): void {
  const { speedKmh, fuelPct, tempC } = opts;

  if (speedKmh === undefined && fuelPct === undefined && tempC === undefined) {
    _pinSpeechChannel('STATUS');   // MAVI-F12
    ttsSpeak('Araç verisi alınamıyor. OBD bağlantısını kontrol edin.', { rate: 0.95, queue: false });
    return;
  }

  const parts: string[] = [];
  if (speedKmh !== undefined) parts.push(`Hız ${Math.round(speedKmh)} kilometre`);
  if (fuelPct  !== undefined) {
    const fuelText = fuelPct < 15
      ? `Yakıt %${Math.round(fuelPct)}, az kaldı`
      : `Yakıt %${Math.round(fuelPct)}`;
    parts.push(fuelText);
  }
  if (tempC !== undefined) parts.push(`Motor sıcaklığı ${Math.round(tempC)} derece`);

  _pinSpeechChannel('STATUS');   // MAVI-F12
  ttsSpeak(parts.join('. ') + '.', { rate: 0.95, queue: false });
}
