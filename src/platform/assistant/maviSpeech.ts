/**
 * maviSpeech — Mavi'nin NORMAL KULLANICI CEVABI için TEK seslendirme otoritesi.
 * (MAVI-M6-TTS-AUTHORITY · M1 #146 bulgu #3/#4'ü kapatır)
 *
 * ── NEDEN VAR ───────────────────────────────────────────────────────────────
 * M1 kanıtladı: tek bir AI eylem komutunda 2-3 ayrı seslendirme oluyordu —
 *   1) `executeAIResult` → `_speak(result.feedback)`        (jenerik ön-yankı)
 *   2) `dispatchIntent` → case metni ("Ankara adresine gidiyoruz")
 *   3) `voiceService` → `speakFeedback(brain.semantic.feedback)`
 * Park halinde 1 ve 3 aynı metin olduğu için `ttsService`in 3 sn'lik dedupe'u
 * ikincisini yutuyordu; **sürüşte** ise ISO 15008 kısaltması metni değiştirdiği
 * için dedupe YAKALAMIYOR ve sesler üst üste biniyordu. Ayrıca
 * `useVoiceCommandHandler._speakAndToast` doğrudan `CarLauncher.speak` çağırarak
 * `ttsService`i (dedupe · ducking · cancel · `__SAFETY_LOCK__`) TAMAMEN atlıyordu.
 *
 * ── SÖZLEŞME ────────────────────────────────────────────────────────────────
 *  · **Tur başına EN FAZLA BİR `answer`.** İlk gerçek cevap kazanır; sonrakiler
 *    sessizce düşer (sayaçla görünür).
 *  · **Tur başına EN FAZLA BİR `progress`** — ve `progress` YALNIZ **semantik
 *    ACK** olabilir ("Araç sistemleri taranıyor", "Hava durumunu alıyorum").
 *    `answer` verildikten SONRA `progress` konuşamaz. Böylece çok fazlı akışlar
 *    (tarama → sonuç) dürüstlüğünü korur ama gevezelik etmez.
 *  · **MAVI-F2 · YAPAY ARA SÖZ KAPISI (I11).** İçeriksiz bekletme cümlesi
 *    ("Bakıyorum…", "Düşünüyorum…", "Bir saniye…") `progress` katmanında
 *    KONUŞULMAZ: `maviAckPolicy.isGenericFiller` ile düşürülür, sayılır ve F0
 *    izine `filler_trigger` olarak yazılır (üretimde beklenen değer 0 — sayaç
 *    artıyorsa bir çağrı yeri filler'ı geri getirmiş demektir). Kapı YALNIZ
 *    `progress`tedir: nihai cevap, gerçek hata mesajı, belirsizlik sorusu ve
 *    yetenek reddi (`answer`) bu kapıdan GEÇMEZ.
 *  · **ISO 15008 kısaltması TEK YERDE** yapılır → sürüşte "kısaltılmış metin
 *    dedupe'a yakalanmıyor" sınıfı yapısal olarak ORTADAN KALKAR.
 *  · **M5 turn guard'a saygılıdır:** devralınmış (superseded) tur KONUŞAMAZ.
 *    Tamamlanmış tur kendi GEÇ sonucunu (M3 `IntentExecutionResult`) söyleyebilir —
 *    susturulması gereken devralınmadır, tamamlanma değil.
 *  · Gerçek seslendirme MEVCUT `ttsService` otoritesine delege edilir; bu modül
 *    yeni bir TTS motoru/kanalı KURMAZ.
 *
 * ── KAPSAM DIŞI (bilinçli) ─────────────────────────────────────────────────
 *  · **Proaktif kritik güvenlik hattı** (`speakSafetyAlert`) buradan GEÇMEZ ve
 *    geçmemelidir: kullanıcı arka arkaya komut verdi diye kritik uyarı
 *    susturulamaz. Ayrı, öncelikli kanal olarak korunur (guard testi).
 *  · Navigasyon talimatları (`speakNavigation`) ve `speakAlert` hata kanalı.
 */

import { speakFeedback, speakAssistant } from '../ttsService';
/* `isMaviTurnCurrent` YALNIZ **çağıranın verdiği** yakalanmış token için kullanılır
 * (`MaviSpeechOpts.turn`). Bu modül global aktif turu okuyup KENDİ stale kararını
 * ÜRETMEZ — öyle bir kontrol tanım gereği daima `true` döner (ölü dal dersi). */
import { getActiveMaviTurn, isMaviTurnCurrent, type MaviTurnToken } from './maviTurn';
/* MAVI-F2: filler ↔ semantik ACK ayrımının TEK kaynağı. Saf, yaprak modül —
 * hiçbir şey import etmez, bu yüzden Mavi'nin bağımlılık grafiğini büyütmez. */
import { isGenericFiller } from './maviAckPolicy';
/* MAVI-M4-LAB-2: konuşma sonucu, kapı kararı ve yürütme sonucuyla AYNI turId
 * altında gözlemlenebilsin diye ortak aşama halkasına yazılır. Saf depo —
 * bu import yeni bir TTS kanalı/otoritesi KURMAZ ve akışı değiştirmez. */
import { recordMaviActionStage } from '../action/maviActionTrace';
/* MAVI-F0: nihai cevabın seslendirme otoritesine VERİLDİĞİ an — TTS sentez ve
   ses başlangıcı segmentlerinin tabanı. YALNIZ ÖLÇÜM; bu import yeni bir TTS
   kanalı/otoritesi KURMAZ ve `maviLatencyTrace` hiçbir modülü import etmez. */
import { markMaviLatency, setMaviLatencyWorkload } from './maviLatencyTrace';
/* MAVI-F8: sürüş iş yükü bütçesi. Bu import SAF çözümleyiciyi getirir (canlı
   okuma DI ile ayrı adaptördedir) → Mavi'nin bağımlılık grafiği BÜYÜMEZ.
   Bütçe bir GÜVENLİK kararı DEĞİLDİR ve mevcut ISO 15008 kısıtını GEVŞETMEZ:
   iki tavandan daima KÜÇÜK olan uygulanır. */
import {
  applyResponseBudget, currentMaviResponseBudget, noteResponseShortened,
} from './maviWorkload';

/** Cevap katmanı — `progress` ara bilgi, `answer` nihai cevaptır. */
export type MaviSpeechTier = 'progress' | 'answer';

/** Hangi TTS kanalına gideceği: kısa geri bildirim mi, serbest asistan cevabı mı. */
export type MaviSpeechChannel = 'feedback' | 'assistant';

export interface MaviSpeechOpts {
  /** Varsayılan `'answer'`. */
  readonly tier?: MaviSpeechTier;
  /** Varsayılan `'feedback'`. */
  readonly channel?: MaviSpeechChannel;
  /** ISO 15008: hareket halinde ≤8 kelime. */
  readonly isDriving?: boolean;
  /**
   * MAVI-M6-LATE-SPEECH-GATE — **KOMUT GİRİŞİNDE YAKALANMIŞ** tur token'ı.
   *
   * Verilirse: konuşmadan HEMEN ÖNCE `isMaviTurnCurrent(turn)` sorulur; token
   * eskimişse (kullanıcı yeni komut verdi) konuşma DÜŞER ve **tur defteri
   * (`_answered`/`_progressed`) DEĞİŞTİRİLMEZ** → eski turun geç cevabı yeni
   * turun `answer`/`progress` slotunu TÜKETEMEZ.
   *
   * Verilmezse: davranış BİREBİR eskisi gibidir (turn dışı kanallar ·
   * uzak komut · senkron çağrılar geriye uyumlu kalır).
   *
   * ⚠️ Buraya `getActiveMaviTurn()` sonucu GEÇİLMEZ — o, kendini doğrulayan
   * (daima `true`) ölü bir kontrol üretir. Token, komut BAŞINDA yakalanmalıdır.
   */
  readonly turn?: MaviTurnToken | null;
}

/** ISO 15008 / NHTSA §3.4 — sürüşte azami kelime. */
export const MAVI_DRIVING_MAX_WORDS = 8;

/* ── Tur başına durum (yalnız kimlik + bayrak — metin TUTULMAZ) ───────────── */
let _turnId = 0;
let _answered = false;
let _progressed = false;

/* ── Bounded sayaçlar (PII YOK) ──────────────────────────────────────────── */
/* `_suppressedStale` KALDIRILDI: onu artıran tek dal ulaşılamazdı, dolayısıyla
 * sayaç üretimde SABİT 0'dı. Tanı yüzeyinde durması "stale koruması burada
 * ölçülüyor" yanılsaması üretiyordu — sıfır gösteren bir sayaç, olmayan bir
 * korumayı "hiç tetiklenmedi" gibi okutur. Gerçek stale reddi
 * `maviTurn.getMaviTurnDiagnostics().staleFeedbackSuppressed` altında ZATEN
 * ölçülmektedir (çağrı-yeri kapıları oraya sayar) → ikinci sayaç gereksizdi. */
const MAX_COUNTER = 1_000_000;
let _spoken = 0;
let _suppressedDuplicate = 0;
/**
 * MAVI-M6-LATE-SPEECH-GATE — geç dönen (eskimiş turlu) konuşmaların kaç kez
 * düşürüldüğü. Kaldırılan `_suppressedStale`in aksine bu sayaç GERÇEKTEN
 * ÖLÇÜLEBİLİR: yalnız çağıranın verdiği YAKALANMIŞ token eskidiğinde artar.
 * Doyan (saturating) — uzun oturumda taşmaz. PII taşımaz (yalnız adet).
 */
let _staleLateSpeechSuppressed = 0;
/**
 * MAVI-F2 — `progress` katmanında yakalanıp KONUŞULMAYAN yapay ara söz adedi.
 * Üretimde beklenen değer **0**'dır: F2 filler'ı çağrı yerlerinden kaldırdı,
 * bu sayaç yalnız bir REGRESYON'da (yeni bir filler çağrısı ya da modelin
 * ürettiği içeriksiz `feedback`) artar. Doyan sayaç; PII taşımaz.
 */
let _rejectedFiller = 0;

function _bump(v: number): number { return v >= MAX_COUNTER ? MAX_COUNTER : v + 1; }

/**
 * Ortak aşama kaydı (MAVI-M4-LAB-2). YALNIZ makine-okur kodlar ve katman adı
 * geçer — SESLENDİRİLEN METİN ASLA KAYDEDİLMEZ (kullanıcı içeriği). Kayıt
 * fail-soft: gözlem katmanı düşerse konuşma akışı ETKİLENMEZ.
 */
function _trace(status: string, reason: string, turnId: number | null): void {
  recordMaviActionStage({ stage: 'speech', status, reason, turnId });
}

/** Sürüşte metni ISO 15008 sınırına indirir — TEK YER. */
export function trimForDriving(text: string, isDriving: boolean): string {
  if (!isDriving) return text;
  const words = text.trim().split(/\s+/);
  return words.length > MAVI_DRIVING_MAX_WORDS
    ? words.slice(0, MAVI_DRIVING_MAX_WORDS).join(' ')
    : text;
}

/** Aktif turun kimliğine göre yerel defteri tazeler. */
function _syncTurn(id: number): void {
  if (id === _turnId) return;
  _turnId = id;
  _answered = false;
  _progressed = false;
}

/**
 * Mavi'nin normal kullanıcı cevabını seslendirir. **Gerçekten konuştuysa `true`.**
 *
 * Düşürme sebepleri (hepsi SESSİZ — hata değildir):
 *  · boş metin · tur devralındı (M5) · bu turda o katman zaten konuştu ·
 *  · `answer` verildikten sonra gelen `progress`.
 */
export function speakMaviAnswer(text: string, opts: MaviSpeechOpts = {}): boolean {
  const t = typeof text === 'string' ? text.trim() : '';
  if (!t) return false;

  const tier: MaviSpeechTier = opts.tier === 'progress' ? 'progress' : 'answer';

  /* MAVI-M4-LAB-2: sonucu ortak aşama halkasına yazar. YALNIZ makine-okur kodlar
   * ve katman adı geçer — SESLENDİRİLEN METİN ASLA KAYDEDİLMEZ (kullanıcı içeriği). */
  const trace = (status: string, turnId: number | null): void => _trace(status, tier, turnId);

  /* ── M5 STALE OTORİTESİ BURADA DEĞİLDİR (MAVI-M6-DEAD-STALE-BRANCH) ───────
   * Burada bir `isMaviTurnCurrent(getActiveMaviTurn())` kontrolü VARDI ve
   * **ULAŞILAMAZ KODDU**: `getActiveMaviTurn()` her zaman `_activeId`yi döndürür,
   * `isMaviTurnCurrent` de `token.id === _activeId` karşılaştırır → koşul
   * aktif · tamamlanmış · devralınmış · sayaç sarılmış HER durumda `true`.
   * Ölçüldü: dört senaryoda da `current=true`, `_suppressedStale` sabit 0.
   *
   * Sebep yapısaldır: staleness ancak KOMUT ANINDA YAKALANMIŞ bir token ile
   * anlaşılır; global "şu anki tur"u okuyan bir kontrol tanım gereği kendi
   * kendini doğrular. Bu yüzden dal ve onu besleyen sayaç KALDIRILDI (yorumla
   * gizlenmedi) — davranış DEĞİŞMEDİ, çünkü dal zaten hiç çalışmıyordu.
   *
   * GERÇEK stale otoritesi ÇAĞRI YERLERİNDEDİR (token orada yakalanır):
   *   · `useVoiceCommandHandler` → `continueIfTurnCurrent(_turn, 'feedback')`
   *   · `voiceService`           → `continueIfTurnActive(turn, …)` · `isMaviTurnCurrent(turn)`
   * Bu satırlar KİLİTLİDİR (bkz. maviTtsAuthority + maviChainEvidence guard'ları):
   * "maviSpeech zaten koruyor" sanılıp o kapılar kaldırılamaz.
   *
   * Aşağıdaki `getActiveMaviTurn()` YALNIZ tur başına tek-cevap defterini (M6)
   * tazelemek için okunur — bir güvenlik kararı DEĞİLDİR. */

  /* ── MAVI-M6-LATE-SPEECH-GATE · GEÇ KONUŞMA KAPISI ───────────────────────
   * Çağıran KOMUT GİRİŞİNDE yakaladığı token'ı verdiyse, konuşmadan önce
   * güncelliği sorulur. Kapı DEFTER MUTASYONUNDAN ÖNCEDİR ve bu KRİTİKTİR:
   * aşağıdaki `_syncTurn(turn.id)` YENİ turun kimliğiyle çalışıp
   * `_answered/_progressed` bayraklarını SIFIRLAR. Kapı sonraya konsaydı,
   * eski turun geç cevabı düşse bile YENİ turun cevap slotunu açıp
   * "iki cevap" yolunu geri getirirdi — yani M6 sözleşmesini bozardı.
   *
   * Stale reddi bir HATA DEĞİLDİR: sessizce düşer, `errorBus`a gitmez, UI/toast
   * açmaz, defteri değiştirmez. `speakMaviAnswer` içinde `await` YOKTUR →
   * bu kontrol ile TTS çağrısı arasında tur DEĞİŞEMEZ (erken kapı = geç kapı). */
  if (opts.turn && !isMaviTurnCurrent(opts.turn)) {
    _staleLateSpeechSuppressed = _bump(_staleLateSpeechSuppressed);
    trace('suppressed_stale_late', opts.turn.id);
    return false;
  }

  /* ── MAVI-F2 · YAPAY ARA SÖZ KAPISI (I11) ────────────────────────────────
   * İçeriksiz bekletme cümlesi KONUŞULMAZ. Kapı DEFTER MUTASYONUNDAN ÖNCEDİR:
   * düşürülen filler turun `progress` slotunu TÜKETMEZ → aynı turda gerçek bir
   * semantik ACK ("Araç sistemleri taranıyor") hâlâ konuşabilir.
   *
   * YALNIZ `progress`: `answer` katmanı (nihai cevap · gerçek hata · belirsizlik
   * sorusu · yetenek reddi) bu kapıya HİÇ girmez — F2 bir susturma değil, bir
   * DÜRÜSTLÜK kapısıdır. Ölçüm F0 izine yazılır (yeni telemetri sistemi YOK). */
  if (tier === 'progress' && isGenericFiller(t)) {
    _rejectedFiller = _bump(_rejectedFiller);
    markMaviLatency('filler_trigger');
    trace('rejected_filler', getActiveMaviTurn()?.id ?? null);
    return false;
  }

  const turn = getActiveMaviTurn();
  if (turn) {
    _syncTurn(turn.id);
    if (tier === 'answer' && _answered) {
      _suppressedDuplicate = _bump(_suppressedDuplicate);
      trace('suppressed_duplicate', turn.id);
      return false;
    }
    if (tier === 'progress' && _progressed) {
      _suppressedDuplicate = _bump(_suppressedDuplicate);
      trace('suppressed_duplicate', turn.id);
      return false;
    }
    // Nihai cevap verildikten sonra ara bilgi KONUŞMAZ (geç filler yasağı).
    if (tier === 'progress' && _answered) {
      _suppressedDuplicate = _bump(_suppressedDuplicate);
      trace('suppressed_late_progress', turn.id);
      return false;
    }
  }

  /* ── MAVI-F8 · İLETİŞİM BÜTÇESİ (TEK KISALTMA NOKTASI) ───────────────────
   * ISO 15008 kısaltması bu satırda ZATEN tek yerdeydi; workload tavanı da
   * BURAYA eklenir → ikinci bir kısaltma yolu doğmaz. Sıra önemlidir:
   * önce sürüş kısıtı, sonra workload tavanı → **hangisi daha kısıtlıysa o
   * kazanır** ve workload hiçbir kısıtı GEVŞETEMEZ.
   * Akış parçaları (`speakMaviAnswerChunk`) bu yoldan GEÇMEZ — parça başına
   * kelime tavanı cümleyi paramparça ederdi; akışın kendi kapısı F4'tedir. */
  const _driveTrimmed = trimForDriving(t, opts.isDriving === true);
  let spoken = _driveTrimmed;
  try {
    const budget = currentMaviResponseBudget();
    spoken = applyResponseBudget(_driveTrimmed, budget.maxWords);
    if (spoken !== _driveTrimmed) { noteResponseShortened(); setMaviLatencyWorkload({ shortened: true }); }
  } catch { spoken = _driveTrimmed; }   // fail-soft: bütçe düşerse ESKİ davranış
  /* MAVI-F0: YALNIZ nihai cevap (`answer`) ana metriğin tabanıdır. Ara söz
   * (`progress`/filler) bu damgayı ALMAZ — alsaydı filler'ın hızı "cevap
   * gecikmesi" gibi ölçülür ve zincir yanlış İYİ görünürdü. */
  if (tier === 'answer') markMaviLatency('tts_request');
  try {
    if (opts.channel === 'assistant') speakAssistant(spoken);
    else speakFeedback(spoken);
  } catch {
    trace('tts_error', turn?.id ?? null);
    return false;   // TTS hatası komut akışını ASLA kırmaz (fail-soft)
  }

  if (turn) {
    if (tier === 'answer') _answered = true;
    else _progressed = true;
  }
  /* MAVI-F2: GERÇEKTEN seslendirilen semantik ACK. `filler_trigger`den AYRI
   * damgadır — ACK filler SAYILMAZ ve `fillerEmissionCount` hedefini bozmaz. */
  if (tier === 'progress') markMaviLatency('ack_emitted');
  _spoken = _bump(_spoken);
  trace('spoken', turn?.id ?? null);
  return true;
}

/**
 * CAROS LAB gözlem yüzeyi — bounded, PII YOK (metin taşınmaz).
 *
 * `suppressedStale` alanı KALDIRILDI (MAVI-M6-DEAD-STALE-BRANCH): bu modül stale
 * kararı vermez, dolayısıyla ölçecek bir şeyi de yoktur. Stale reddi
 * `maviTurn.getMaviTurnDiagnostics().staleFeedbackSuppressed` altında gerçekten
 * ölçülür — gözlem, kararın verildiği katmanda durur.
 */
export function getMaviSpeechDiagnostics(): {
  turnId: number;
  answeredThisTurn: boolean;
  progressedThisTurn: boolean;
  spoken: number;
  suppressedDuplicate: number;
  /** Geç dönen eskimiş konuşma reddi — GERÇEKTEN ölçülür (bkz. sayaç notu). */
  staleLateSpeechSuppressed: number;
  /** MAVI-F2: konuşmadan düşürülen yapay ara söz adedi (üretimde beklenen: 0). */
  rejectedFiller: number;
  /** MAVI-F4: akış cevabı şu an açık mı (`answer` slotunu tutuyor). */
  streamActive: boolean;
  /** MAVI-F4: `answer` slotu akış için kaç kez talep edildi. */
  streamsClaimed: number;
  /** MAVI-F4: talep REDDEDİLDİ (tur eskimiş ya da cevap zaten verilmiş). */
  streamsRejected: number;
} {
  return {
    turnId: _turnId,
    answeredThisTurn: _answered,
    progressedThisTurn: _progressed,
    spoken: _spoken,
    suppressedDuplicate: _suppressedDuplicate,
    staleLateSpeechSuppressed: _staleLateSpeechSuppressed,
    rejectedFiller: _rejectedFiller,
    streamActive: _streamActive,
    streamsClaimed: _streamsClaimed,
    streamsRejected: _streamsRejected,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * MAVI-F4 · AKIŞ (STREAMING) CEVABI — **AKIŞ TEK `answer`DIR, ÇOK DEĞİL**
 *
 * Streaming cevapta Mavi tek bir cümle yerine ardışık parçalar konuşur. Bu,
 * tur başına tek-`answer` sözleşmesini BOZMAMALIDIR: parçaların her biri ayrı
 * `answer` sayılsaydı ikinci parça kendi sözleşmesi tarafından SUSTURULURDU.
 *
 * Çözüm: akış BAŞLARKEN `answer` slotu BİR KEZ talep edilir (`claim`), sonraki
 * parçalar o talebin içinde konuşulur. Bunun iki doğrudan sonucu vardır:
 *   1. Akış konuşurken gelen başka bir `answer` (ör. `_dispatchConversation`in
 *      nihai metni) **kendiliğinden düşer** → DUPLICATE KONUŞMA YAPISAL OLARAK
 *      İMKÂNSIZDIR (F4 kabul kapısı 9).
 *   2. Semantik ACK (F2 `progress`) akıştan ÖNCE konuşulmuşsa slot ayrıdır ve
 *      korunur; ACK'ten SONRA gelen akış yine tek `answer`dır.
 * ════════════════════════════════════════════════════════════════════════ */

/** Akış açıkken `true` — `answer` slotu bu akış tarafından tutulur. */
let _streamActive = false;
let _streamChunks = 0;
let _streamsClaimed = 0;
let _streamsRejected = 0;

/**
 * Akış cevabı için `answer` slotunu talep eder.
 *
 * `false` dönerse akış BAŞLATILMAMALIDIR: bu turda zaten bir cevap konuşulmuş
 * ya da tur devralınmıştır. Talep başarısızsa hiçbir parça konuşulmaz —
 * "önce dene, sonra bak" yapılmaz (yarım cevap yasağı).
 */
export function claimMaviAnswerStream(turn?: MaviTurnToken | null): boolean {
  if (turn && !isMaviTurnCurrent(turn)) {
    _staleLateSpeechSuppressed = _bump(_staleLateSpeechSuppressed);
    _streamsRejected = _bump(_streamsRejected);
    _trace('suppressed_stale_late', 'stream', turn.id);
    return false;
  }
  const active = getActiveMaviTurn();
  if (active) {
    _syncTurn(active.id);
    if (_answered) {
      _suppressedDuplicate = _bump(_suppressedDuplicate);
      _streamsRejected = _bump(_streamsRejected);
      _trace('suppressed_duplicate', 'stream', active.id);
      return false;
    }
    _answered = true;                       // slot BURADA tutulur (tek answer)
  }
  _streamActive = true;
  _streamChunks = 0;
  _streamsClaimed = _bump(_streamsClaimed);
  _trace('stream_claimed', 'stream', active?.id ?? null);
  return true;
}

/**
 * Akışın BİR parçasını seslendirir. Slot zaten `claimMaviAnswerStream` ile
 * tutulduğu için tek-`answer` defteri BURADA DEĞİŞTİRİLMEZ.
 *
 * ISO 15008 kısaltması parçaya UYGULANMAZ ve bu bilinçlidir: sürüşte akış
 * zaten AÇILMAZ (bkz. `voiceService` — sürüşte cevap 8 kelimeye indirildiği
 * için parçalamanın kazancı yok, riski var). Kısaltmayı parça başına yapmak
 * cümleleri ortasından kesip anlamı bozardı.
 */
export function speakMaviAnswerChunk(text: string, opts: { turn?: MaviTurnToken | null } = {}): boolean {
  if (!_streamActive) return false;              // talep edilmemiş akış konuşamaz
  const t = typeof text === 'string' ? text.trim() : '';
  if (!t) return false;
  if (opts.turn && !isMaviTurnCurrent(opts.turn)) {
    _staleLateSpeechSuppressed = _bump(_staleLateSpeechSuppressed);
    _trace('suppressed_stale_late', 'stream', opts.turn.id);
    return false;
  }
  /* İLK parça nihai cevabın seslendirmeye verildiği andır — F0 ana metriğinin
   * tabanı. Sonraki parçalar bu damgayı ALMAZ (ilk gerçekleşme kazanır). */
  if (_streamChunks === 0) markMaviLatency('tts_request');
  try {
    speakAssistant(t);
  } catch {
    _trace('tts_error', 'stream', getActiveMaviTurn()?.id ?? null);
    return false;                                // fail-soft: akış kırılmaz
  }
  _streamChunks = _bump(_streamChunks);
  _spoken = _bump(_spoken);
  _trace('stream_chunk', 'stream', getActiveMaviTurn()?.id ?? null);
  return true;
}

/** Akışı kapatır (tamamlandı ya da iptal). Slot bırakılmaz — cevap verilmiştir. */
export function releaseMaviAnswerStream(): void {
  _streamActive = false;
  _trace('stream_released', 'stream', getActiveMaviTurn()?.id ?? null);
}

/** Akış şu an açık mı (çağıranlar duplicate'ten kaçınmak için sorar). */
export function isMaviAnswerStreamActive(): boolean { return _streamActive; }

/**
 * Tutulan `answer` slotunu GERİ BIRAKIR — akış **hiç konuşmadıysa** kullanılır.
 *
 * NEDEN GEREKLİ (sessiz ölüm koruması): akış slotu talep eder ama model yapısal
 * çıktı (`action`/`web`) üretirse ya da hiç metin gelmezse tek kelime bile
 * konuşulmaz. Slot tutulu kalsaydı kanonik yolun cevabı (`_dispatchConversation`
 * ya da executor sonucu) tek-`answer` kuralına takılıp DÜŞER ve kullanıcı
 * **hiçbir şey duymazdı**. Slot yalnız GERÇEKTEN konuşulduğunda tüketilmiş sayılır.
 *
 * Akış konuşmuşsa bu fonksiyon ÇAĞRILMAMALIDIR (çağrılırsa duplicate kapısı açılır).
 */
export function releaseMaviAnswerSlot(): void {
  if (_streamChunks > 0) return;          // konuşuldu → slot GERÇEKTEN tüketildi
  _answered = false;
  _streamActive = false;
  _trace('stream_slot_released', 'stream', getActiveMaviTurn()?.id ?? null);
}

/** @internal — testler arası izolasyon. */
export function _resetMaviSpeechForTest(): void {
  _turnId = 0;
  _answered = false;
  _progressed = false;
  _spoken = 0;
  _suppressedDuplicate = 0;
  _staleLateSpeechSuppressed = 0;
  _rejectedFiller = 0;
  _streamActive = false;
  _streamChunks = 0;
  _streamsClaimed = 0;
  _streamsRejected = 0;
}
