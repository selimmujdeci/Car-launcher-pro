/**
 * voiceConversationRuntime.ts — **MAVI-F13/2 · SESLİ SOHBET OTURUMU RUNTIME'I.**
 *
 * ── NE İÇİN VAR ─────────────────────────────────────────────────────────────
 * Sesli sohbet döngüsünün durumu (`_convSession` · `_followUpArmed` ·
 * `_convIdleOnTtsEnd`) ve iki emniyet zamanlayıcısı `voiceService` içinde,
 * orkestrasyon kodunun arasına serpilmişti. Bu, projenin en çok saha hatası
 * üreten alanıydı — çünkü **zamanlayıcıyı kuran ile iptal eden** kod farklı
 * bölümlerdeydi ve "TTS bitti mi" sorusu üç ayrı yerden soruluyordu.
 *
 * Bu dosya o üç durumu ve iki (artık üç) zamanlayıcıyı **tek sahibe** verir.
 *
 * ── SÖZLEŞME (PAZARLIKSIZ) ──────────────────────────────────────────────────
 *  · **OTORİTE DEĞİL.** Tur `maviTurn`ın, konuşma `maviSpeech`in, eylem
 *    `maviActionAuthority` → `commandExecutor`ın. Bu modül yalnız *"mikrofonu
 *    yeniden açalım mı / UI ne zaman idle'a dönsün"* sorusunu yönetir ve
 *    bunların ikisi de kökün verdiği PORTLARDAN yapılır.
 *  · **HİÇBİR PLATFORM MODÜLÜ IMPORT ETMEZ.** `ttsService`, `maviWorkload`,
 *    `voiceService` — hepsi porttur. Böylece modül saf test edilebilir ve
 *    mevcut testlere YENİ mock yüzeyi getirmez.
 *  · **ZERO-LEAK.** Kurduğu her zamanlayıcının iptali bu dosyadadır;
 *    `disposeConversationRuntime()` üçünü de koşulsuz söker.
 *  · **DAVRANIŞ DEĞİŞMEDİ.** Süreler, uzatma tavanı, sıra ve fail-soft dalları
 *    `voiceService`ten **birebir** taşındı.
 *
 * ── TEK GERÇEK ZERO-LEAK DÜZELTMESİ (F13/2'de bulundu) ──────────────────────
 * TTS bitişindeki 350 ms'lik yeniden-dinleme gecikmesi **sahipsiz** bir
 * `setTimeout` idi: handle hiçbir yerde tutulmuyordu. Davranış güvendeydi
 * (geri çağrı `_convSession` kapısına takılıyordu) ama `dispose` sonrası bile
 * kuyrukta bir iş kalıyordu. Handle artık tutuluyor ve söküm onu da iptal
 * ediyor — **gözlenebilir davranış aynı**, sahiplik artık eksiksiz.
 */

/* ══════════════════════════════════════════════════════════════════════════
 * PORTLAR — kökün enjekte ettiği yetenekler (DI; yeni framework DEĞİL)
 * ════════════════════════════════════════════════════════════════════════ */

export interface VoiceConversationPorts {
  /** `voiceService.startListening` — mikrofonu açan TEK yol. */
  readonly startListening: (opts: { followUpWindow?: boolean }) => void;
  /** Kökün `VoiceState.status` alanı (durum KÖKÜNDÜR, burada kopyalanmaz). */
  readonly currentStatus: () => string;
  /** UI `followUp` rozetini yazar (yalnız değiştiyse push eden kök). */
  readonly setUiFollowUp: (on: boolean) => void;
  /** `status === 'success'` ise idle'a düşür (kökün UI sözleşmesi). */
  readonly goIdleFromSuccess: () => void;
  /** `ttsService.isTtsSpeaking` — "gerçekten hâlâ konuşuyor mu". */
  readonly isTtsSpeaking: () => boolean;
  /** `voiceService.isVoicePaused` — bilişsel duraklatma. */
  readonly isVoicePaused: () => boolean;
  /** MAVI-F8 iş yükü bütçesi: takip dinlemesi kurulabilir mi. */
  readonly responseBudgetAllowsFollowUp: () => boolean;
  /** MAVI-F8 defterine "bütçe yüzünden kurulmadı" yaz. */
  readonly noteFollowUpSuppressed: () => void;
}

let _ports: VoiceConversationPorts | null = null;

/** Bileşim kökü çağırır (modül yüklenirken kaynak AÇILMAZ). */
export function configureVoiceConversation(ports: VoiceConversationPorts): void {
  _ports = ports;
}

/* Portsuz çağrıda fail-soft varsayılanlar: sohbet döngüsü sessizce KURULMAZ —
 * "her şey yolunda" varsayılmaz. */
const P = {
  startListening: (o: { followUpWindow?: boolean }): void => { _ports?.startListening(o); },
  status:         (): string  => { try { return _ports?.currentStatus() ?? 'idle'; } catch { return 'idle'; } },
  setUiFollowUp:  (on: boolean): void => { try { _ports?.setUiFollowUp(on); } catch { /* fail-soft */ } },
  goIdle:         (): void => { try { _ports?.goIdleFromSuccess(); } catch { /* fail-soft */ } },
  speaking:       (): boolean => { try { return _ports?.isTtsSpeaking() === true; } catch { return false; } },
  paused:         (): boolean => { try { return _ports?.isVoicePaused() === true; } catch { return false; } },
};

/* ══════════════════════════════════════════════════════════════════════════
 * DURUM — TEK SAHİP (kökte İKİNCİ kopyası YOKTUR)
 *
 * ── Takip dinlemesi (sohbet modu) ────────────────────────────
 * Kullanıcı şikayeti: "cevap veriyor, tekrar konuşmak için mikrofona basmam
 * gerekiyor." Çözüm: SESLE başlayan oturumlarda asistan cevabı (TTS) bitince
 * mikrofon otomatik yeniden açılır. Döngü şu durumlarda biter:
 *   - kullanıcı sessiz kalır (boş transcript / no-speech)
 *   - kullanıcı pencereyi/mikrofonu kapatır (stopListening)
 *   - terminal hata ("anlaşılamadı" dahil)
 * Metin girişiyle (hızlı komut butonları) tetiklenen akışlar etkilenmez —
 * yalnız `_convSession=true` (STT'den transcript geldi) iken devreye girer.
 * ════════════════════════════════════════════════════════════════════════ */

/** Aktif sesli sohbet oturumu var mı (transcript STT'den geldi). */
let _convSession = false;
/** Cevap TTS'i bitince yeniden dinleme kurulu mu. */
let _followUpArmed = false;
/** TTS hiç başlamazsa (SAFETY_LOCK, sessiz yollar) takip modu asılı kalmasın. */
let _followUpFallbackTimer: ReturnType<typeof setTimeout> | null = null;
const FOLLOWUP_FALLBACK_MS = 20_000;
/** Hoparlör kuyruğu boşalması için TTS bitişi → mikrofon arası tampon. */
const FOLLOWUP_RELISTEN_DELAY_MS = 350;
/** F13/2: o tamponun handle'ı ARTIK TUTULUYOR (eskiden sahipsizdi). */
let _followUpRelistenTimer: ReturnType<typeof setTimeout> | null = null;

/* ── Takipsiz sohbet cevabı → TTS bitince idle ─────────────────
 * Eski davranış: `_dispatchConversation` sabit 3.5s setTimeout ile idle'a dönerdi.
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
 * KÖK: bu iki emniyet zamanlayıcısı (takip 20sn · sohbet-idle 15sn)
 * "TTS bitiş eventi hiç gelmezse akış asılı kalmasın" diye konmuştu, ama
 * konuşmanın GERÇEKTEN bitip bitmediğini sormuyor, sabit süreyle varsayıyorlardı.
 * Türkçe TTS ~12-15 karakter/sn → ~250 karakteri aşan her cevap hâlâ konuşulurken
 * pencere doluyor; takip zamanlayıcısı `startListening()` çağırıyor, o da
 * `ttsCancel()` ile cevabı ORTASINDAN kesip mikrofonu açıyordu (Android STT
 * başlangıç bipi = kullanıcının duyduğu "dut").
 *
 * ÇÖZÜM: pencere dolduğunda konuşma sürüyorsa (`isTtsSpeaking`) kesme — pencereyi
 * kısa adımlarla UZAT. Emniyet rolü KAYBOLMAZ: uzatma sayısı tavanlıdır, ayrıca
 * `ttsService`in kendi `MAX_SPEAKING_MS` tavanı takılı motoru "bitmiş" sayar.
 * Böylece gerçek asılma yine kurtarılır, gerçek konuşma asla kesilmez. */
const SPEAKING_EXTEND_MS = 5_000;
/** Azami uzatma — sonsuz uzatma YASAK (24 × 5sn = 120sn ek tavan). */
const MAX_SPEAKING_EXTENSIONS = 24;

let _convIdleExtensions = 0;
let _followUpExtensions = 0;

/* ══════════════════════════════════════════════════════════════════════════
 * SOHBET-IDLE PENCERESİ
 * ════════════════════════════════════════════════════════════════════════ */

export function clearConvIdle(): void {
  _convIdleOnTtsEnd = false;
  if (_convIdleFallbackTimer !== null) {
    clearTimeout(_convIdleFallbackTimer);
    _convIdleFallbackTimer = null;
  }
}

export function armConvIdleOnTtsEnd(): void {
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
    if (P.speaking() && _convIdleExtensions < MAX_SPEAKING_EXTENSIONS) {
      _convIdleExtensions++;
      _scheduleConvIdleFallback(SPEAKING_EXTEND_MS);
      return;
    }
    _convIdleOnTtsEnd = false;
    P.goIdle();
  }, delayMs);
}

/* ══════════════════════════════════════════════════════════════════════════
 * TAKİP DİNLEMESİ
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * **TAKİP DÖNGÜSÜ GERÇEKTEN SÜRÜYOR MU** — bu modülün SAHİP OLDUĞU tek gerçek.
 *
 * `_followUpArmed` tek başına yetmez: TTS bitişi ile mikrofonun yeniden açılması
 * arasında (`FOLLOWUP_RELISTEN_DELAY_MS`) bayrak KAPALI ama döngü CANLIDIR.
 * "Döngü sürüyor mu" sorusunun cevabı bu ikisinin BİRLEŞİMİDİR — ve kararı
 * soran her taraf (wake kapısı · algı katmanı · UI rozeti) BURAYA sorar.
 */
export function isFollowUpEngaged(): boolean {
  return _followUpArmed || _followUpRelistenTimer !== null;
}

/* ── SAHA #1258 · UI AYNASININ TEK YAZICISI ───────────────────────────────
 * ÖLÇÜLEN ARIZA (2026-09-04, telefon): "bir kere çalışıyor, sonra bir daha
 * uyanmıyor". `SUPPRESSED_FOLLOWUP 3` kaydı, `status==='idle'` iken UI
 * `followUp` bayrağının HÂLÂ `true` olduğunu kanıtladı.
 *
 * KÖK: `_followUpArmed = false` üç ayrı yerde yazılıyordu ama UI aynası
 * YALNIZ `disarmFollowUp()` içinde temizleniyordu. Döngü "devri teslim"
 * dallarında (`listening`/`processing` görülünce `return`) bayrak kapanıp
 * ayna AÇIK kalıyordu; o andan sonra döngüyü canlandıracak hiçbir zamanlayıcı
 * kalmadığı için ayna KALICI olarak yanlış kalıyor ve wake kapısı her tetiği
 * `SUPPRESSED_FOLLOWUP` ile düşürüyordu.
 *
 * ÇÖZÜM: ayna artık hiçbir yerde ELLE yazılmaz — her mutasyondan sonra
 * sahibin gerçeğine EŞİTLENİR. Aynı olgunun iki temsili yapısal olarak
 * ayrışamaz (CLAUDE.md §1 tek otorite · §14 UI bir projeksiyondur). */
function _syncEngagedMirror(): void {
  P.setUiFollowUp(isFollowUpEngaged());
}

export function disarmFollowUp(): void {
  _followUpArmed = false;
  if (_followUpFallbackTimer !== null) {
    clearTimeout(_followUpFallbackTimer);
    _followUpFallbackTimer = null;
  }
  if (_followUpRelistenTimer !== null) {
    clearTimeout(_followUpRelistenTimer);
    _followUpRelistenTimer = null;
  }
  _syncEngagedMirror();
}

/** Sesli oturum başladı (STT'den transcript geldi). */
export function beginConversationSession(): void {
  _convSession = true;
}

/** Sesli oturumu tamamen bitir (takip modu + oturum bayrağı). */
export function endConversationSession(): void {
  _convSession = false;
  disarmFollowUp();
  clearConvIdle();
}

/** Aktif sesli sohbet oturumu var mı (kök okur — kopya TUTMAZ). */
export function isConversationSessionActive(): boolean {
  return _convSession;
}

/** Takip dinlemesi kurulu mu (ducking bunu port üzerinden sorar). */
export function isFollowUpArmed(): boolean {
  return _followUpArmed;
}

/**
 * Cevap seslendirilmeden HEMEN ÖNCE çağrılır: TTS bitişinde mikrofonun yeniden
 * açılacağını işaretler. Yalnız sesli oturumda (`_convSession`) etkilidir.
 */
export function armFollowUp(): void {
  if (!_convSession || P.paused()) return;
  /* MAVI-F8: takip dinlemesi (sohbeti kendiliğinden sürdürme) yüksek iş yükünde
   * KURULMAZ. Bu bir yetenek kapatma DEĞİLDİR — kullanıcı mikrofona basıp ya da
   * uyandırma kelimesiyle her zaman konuşabilir; kapanan yalnız Mavi'nin
   * KENDİLİĞİNDEN mikrofonu açmasıdır. */
  try {
    if (_ports && !_ports.responseBudgetAllowsFollowUp()) {
      _ports.noteFollowUpSuppressed();
      return;
    }
  } catch { /* fail-soft: bütçe okunamazsa ESKİ davranış */ }
  _followUpArmed = true;
  _followUpExtensions = 0;
  _scheduleFollowUpFallback(FOLLOWUP_FALLBACK_MS);
  _syncEngagedMirror();
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
    if (P.speaking() && _followUpExtensions < MAX_SPEAKING_EXTENSIONS) {
      _followUpExtensions++;
      _scheduleFollowUpFallback(SPEAKING_EXTEND_MS);
      return;
    }
    _followUpArmed = false;
    if (!_convSession || P.paused()) { disarmFollowUp(); return; }
    const st = P.status();
    /* Devri teslim: uçuşta bir tur zaten var → döngü BURADA biter (yeniden
       kurulmaz). Ayna sahibin gerçeğine eşitlenir; eskiden AÇIK kalıyordu. */
    if (st === 'listening' || st === 'processing') { _syncEngagedMirror(); return; }
    P.startListening({ followUpWindow: true });
    _syncEngagedMirror();   // mikrofon devraldı → döngü tüketildi
  }, delayMs);
}

/* ══════════════════════════════════════════════════════════════════════════
 * TTS BİTİŞİ — sohbet döngüsünün karar noktası
 *
 * Kök `registerTtsEndListener` aboneliğinin SAHİBİ olarak kalır (telemetri ve
 * `speech_end` olayı orada kapanır) ve bu fonksiyonu ÇAĞIRIR. Böylece tek bir
 * TTS-bitiş aboneliği vardır; ikinci bir dinleyici KURULMAZ.
 * ════════════════════════════════════════════════════════════════════════ */

export function onTtsEnd(): void {
  // (A) Takip dinlemesi (sürekli sohbet döngüsü) ────────────────
  if (_followUpArmed) {
    // AI hâlâ işliyor/dinleme zaten açık → bu bitiş ara feedback'ti, kurulu kal.
    const st = P.status();
    if (st === 'processing' || st === 'listening') return;
    _followUpArmed = false;
    if (_followUpFallbackTimer !== null) {
      clearTimeout(_followUpFallbackTimer);
      _followUpFallbackTimer = null;
    }
    if (_followUpRelistenTimer !== null) clearTimeout(_followUpRelistenTimer);
    _followUpRelistenTimer = setTimeout(() => {
      _followUpRelistenTimer = null;
      if (!_convSession || P.paused()) { disarmFollowUp(); return; }
      const s2 = P.status();
      if (s2 === 'listening' || s2 === 'processing') { _syncEngagedMirror(); return; }
      P.startListening({ followUpWindow: true }); // kısa pencere — wake word gerekmez
      _syncEngagedMirror();   // mikrofon devraldı → döngü tüketildi
    }, FOLLOWUP_RELISTEN_DELAY_MS);
    /* Bayrak kapandı ama tampon UÇUŞTA → döngü HÂLÂ canlı; ayna `true` kalır. */
    _syncEngagedMirror();
    return;
  }
  // (B) Takipsiz sohbet cevabı → konuşma bitti, idle'a dön. UI 'success'
  //     barı GERÇEK konuşma süresince görünür kaldı (3.5s sabit timer kaldırıldı).
  if (_convIdleOnTtsEnd) {
    clearConvIdle();
    P.goIdle();
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * TEARDOWN — kurduğu ÜÇ zamanlayıcının iptali BU DOSYADADIR
 * ════════════════════════════════════════════════════════════════════════ */

/** Koşulsuz söküm. İdempotent — ikinci çağrı zararsızdır. */
export function disposeConversationRuntime(): void {
  endConversationSession();
}

/** @internal — testler arası izolasyon (üretim yolunda çağrılmaz). */
export function _resetConversationRuntimeForTest(): void {
  disposeConversationRuntime();
  _convIdleExtensions = 0;
  _followUpExtensions = 0;
  _ports = null;
}

/** @internal — tanı/test: bekleyen zamanlayıcı var mı (sızıntı kilidi). */
export function _pendingConversationTimersForTest(): number {
  return (_followUpFallbackTimer !== null ? 1 : 0)
       + (_followUpRelistenTimer !== null ? 1 : 0)
       + (_convIdleFallbackTimer !== null ? 1 : 0);
}
