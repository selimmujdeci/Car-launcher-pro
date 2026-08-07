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
 *  · **Tur başına EN FAZLA BİR `progress`** ("Bakıyorum…", "taranıyor").
 *    `answer` verildikten SONRA `progress` konuşamaz. Böylece çok fazlı akışlar
 *    (tarama → sonuç) dürüstlüğünü korur ama gevezelik etmez.
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
/* MAVI-M4-LAB-2: konuşma sonucu, kapı kararı ve yürütme sonucuyla AYNI turId
 * altında gözlemlenebilsin diye ortak aşama halkasına yazılır. Saf depo —
 * bu import yeni bir TTS kanalı/otoritesi KURMAZ ve akışı değiştirmez. */
import { recordMaviActionStage } from '../action/maviActionTrace';

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

function _bump(v: number): number { return v >= MAX_COUNTER ? MAX_COUNTER : v + 1; }

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
  const trace = (status: string, turnId: number | null): void => {
    recordMaviActionStage({ stage: 'speech', status, reason: tier, turnId });
  };

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

  const spoken = trimForDriving(t, opts.isDriving === true);
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
} {
  return {
    turnId: _turnId,
    answeredThisTurn: _answered,
    progressedThisTurn: _progressed,
    spoken: _spoken,
    suppressedDuplicate: _suppressedDuplicate,
    staleLateSpeechSuppressed: _staleLateSpeechSuppressed,
  };
}

/** @internal — testler arası izolasyon. */
export function _resetMaviSpeechForTest(): void {
  _turnId = 0;
  _answered = false;
  _progressed = false;
  _spoken = 0;
  _suppressedDuplicate = 0;
  _staleLateSpeechSuppressed = 0;
}
