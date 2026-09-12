/**
 * duplexCapability.ts — **MAVİ F12 · GERÇEK DUPLEX YETENEK MATRİSİ (SAF).**
 *
 * ── NEDEN VAR ───────────────────────────────────────────────────────────────
 * "Full-duplex barge-in" demek kolaydır; **ses yolunun gerçekte ne yapabildiğini**
 * söylemek zordur. `streamCapability.ts` LLM/TTS akışı için bunu yapıyor; bu dosya
 * AYNI deseni konuşma-üstüne-konuşma (barge-in) için yapar.
 *
 * **Sahte full-duplex ÜRETİLMEZ.** Kanıt yoksa sınıf yükselmez; bugünkü güvenli
 * davranış (yarım-duplex kesme) korunur — spec §9.7'nin fail-soft maddesi budur.
 *
 * ── SÖZLEŞME ────────────────────────────────────────────────────────────────
 *  · **SAF:** hiçbir modülü import ETMEZ · I/O · timer · `Date.now` · global
 *    mutasyon YOK. Yalnız girdi → sınıf.
 *  · Sınıf **ölçülmüş koda** dayanır, iyimser varsayıma değil. Aşağıdaki her
 *    kanıt satırının kaynak dosyası ve satır gerekçesi yazılıdır.
 *  · Bu dosya bir **OTORİTE DEĞİLDİR**: mikrofon açmaz, TTS kesmez, tur
 *    başlatmaz. Yalnız "bu yolda akustik barge-in KANITLANABİLİR Mİ" sorusunu
 *    yanıtlar; kararı `maviBargeIn` verir, yürütmeyi `voiceService` yapar.
 */

/* ══════════════════════════════════════════════════════════════════════════
 * Sınıf
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Ses yolunun barge-in yeteneği — **bounded**, dört sınıf.
 *
 * | Sınıf | Anlamı | Akustik kesme |
 * |-------|--------|----------------|
 * | `TRUE_FULL_DUPLEX` | Mavi konuşurken mikrofon açık **ve** AEC etkin **ve** TTS çıkışı referans sinyali olarak bağlı. | ✅ tam |
 * | `AEC_GATED_DUPLEX` | Mikrofon açık ve AEC etkin, ama **referans sinyali kanıtı yok** → yalnız güçlü konuşma kanıtıyla. | ⚠️ kapılı |
 * | `HALF_DUPLEX_INTERRUPT` | Mavi konuşurken yakalama yolu kapalı (veya korumasız) — kesme mekaniği ÇALIŞIR ama tetik akustik OLAMAZ. | ❌ (yalnız açık kullanıcı eylemi) |
 * | `UNSUPPORTED` | İptal zinciri bile yok — kesme güvenle yapılamaz. | ❌ |
 */
export type MaviDuplexClass =
  | 'TRUE_FULL_DUPLEX'
  | 'AEC_GATED_DUPLEX'
  | 'HALF_DUPLEX_INTERRUPT'
  | 'UNSUPPORTED';

/** AEC kanıtının HANGİ yakalama yolundan geldiği. */
export type DuplexAecEvidencePath =
  /** Hiç ölçüm yok. */
  | 'NONE'
  /** Aktif STT oturumu (`runVoskListening`) — bu yol TTS ile ASLA çakışmaz. */
  | 'ACTIVE_LISTEN'
  /** Wake grammar thread'i (`runVoskGrammar`). */
  | 'WAKE_WORD'
  /** TTS sürerken GERÇEKTEN açık kalan duplex yakalama yolu. */
  | 'DUPLEX_CAPTURE';

/* ══════════════════════════════════════════════════════════════════════════
 * Kanıt
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Duplex sınıfını belirleyen **ölçülebilir** kanıt kümesi.
 *
 * Her alan "biliyorum" değil "ÖLÇTÜM" demektir; ölçüm yoksa `false` yazılır ve
 * sınıf düşer (fail-closed). Sahte `true` bu dosyanın tek yasak fiilidir.
 */
export interface MaviDuplexEvidence {
  /**
   * Native mikrofon tanısı GERÇEKTEN okundu mu (`getVoiceMicDiagnostics().present`).
   * `false` → hiçbir donanım iddiası kanıtlanmış değildir.
   */
  readonly micDiagnosticsPresent: boolean;
  /**
   * **Mavi'nin kendi TTS'i çalarken** yakalama yolu açık kalıyor mu.
   * Bu bir NATIVE SÖZLEŞMEsidir, tercih değil.
   */
  readonly captureOpenDuringTts: boolean;
  /** AEC oluşturuldu VE etkin (`aecCreated && aecEnabled`). */
  readonly aecEnabled: boolean;
  /**
   * AEC kanıtı hangi yoldan geldi. **Yalnız `DUPLEX_CAPTURE` sayılır**:
   * TTS ile hiç çakışmayan bir yolda ölçülen AEC, duplex hakkında HİÇBİR ŞEY
   * kanıtlamaz (kanıt transferi = uydurma).
   */
  readonly aecEvidencePath: DuplexAecEvidencePath;
  /**
   * TTS çıkışı iptal ediciye **referans sinyali** olarak besleniyor mu.
   * Android `AcousticEchoCanceler` referansı telefon downlink'idir; medya
   * akışıyla çalan TTS için bu bağ KENDİLİĞİNDEN kurulmaz.
   */
  readonly echoReferenceWired: boolean;
  /**
   * İptal zinciri hazır mı: `ttsCancel` + akış iptali + `maviTurn` supersede.
   * `false` → kesme güvenli değildir, sınıf `UNSUPPORTED`.
   */
  readonly cancelChainReady: boolean;
}

/**
 * **REPO'DA ÖLÇÜLEN GERÇEK (2026-08-29 kod denetimi).**
 *
 * | Kanıt | Değer | Kaynak / gerekçe |
 * |-------|-------|------------------|
 * | `captureOpenDuringTts` | `false` | `CarLauncherPlugin.wakeMicMustYield()` → `nativeTtsSpeaking` iken wake thread mikrofonu HİÇ AÇMAZ (`noteWakeYield()` + 250 ms uyku). Aktif STT (`runVoskListening`) ise yalnız `startListening()` ile başlar ve o fonksiyon İLK İŞ `ttsCancel()` çağırır → TTS ile örtüşme YAPISAL olarak imkânsızdır. |
 * | `aecEnabled` | `false` | `AcousticEchoCanceler` YALNIZ `runVoskListening` içinde kurulur (`CarLauncherPlugin` ~4005). `runVoskGrammar` (wake yolu) HİÇBİR efekt kurmaz. Yani TTS ile örtüşebilecek tek yolda AEC YOKTUR. |
 * | `aecEvidencePath` | `ACTIVE_LISTEN` | Ölçüm var ama YANLIŞ YOLDA — duplex için sayılmaz. |
 * | `echoReferenceWired` | `false` | Repoda TTS çıkışını iptal ediciye referans olarak veren HİÇBİR kod yok (arama: `AudioTrack` referansı / `setReferenceStream` benzeri yapı bulunmadı). |
 * | `cancelChainReady` | `true` | `ttsCancel()` + `cancelActiveResponseStream()` + `supersedeActiveMaviTurn()` + `_f3CloseSession('CANCELLED')` zinciri MEVCUT ve testlidir. |
 * | `micDiagnosticsPresent` | `false` | Modül seviyesinde ölçüm yok; probe çalışmadan `present:false`tur. Çalışsa bile yukarıdaki iki `false` sınıfı yükseltmez. |
 *
 * **Sonuç: `HALF_DUPLEX_INTERRUPT`.** Kesme mekaniği tamdır; tetik akustik
 * OLAMAZ. Sınıfın yükselmesi için `CarLauncherPlugin`'de duplex yakalama yolu +
 * AEC + referans sinyali gerekir — bu bir NATIVE işidir ve masa başında
 * doğrulanamaz (bkz. `docs/DEVICE_VALIDATION_LEDGER.md`).
 */
export const MAVI_MEASURED_DUPLEX_EVIDENCE: MaviDuplexEvidence = Object.freeze({
  micDiagnosticsPresent: false,
  captureOpenDuringTts:  false,
  aecEnabled:            false,
  aecEvidencePath:       'ACTIVE_LISTEN' as DuplexAecEvidencePath,
  echoReferenceWired:    false,
  cancelChainReady:      true,
});

/* ══════════════════════════════════════════════════════════════════════════
 * Sınıflandırma
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Kanıt → sınıf. **SAF · throw ETMEZ · fail-closed.**
 *
 * Sıra bilinçlidir: bir üst sınıfa çıkmak için o sınıfın TÜM kanıtları gerekir;
 * eksik kanıt sessizce "muhtemelen vardır"a çevrilmez.
 */
export function classifyMaviDuplex(
  ev: MaviDuplexEvidence | null | undefined,
): MaviDuplexClass {
  if (!ev || ev.cancelChainReady !== true) return 'UNSUPPORTED';
  /* AEC yalnız DUPLEX yakalama yolunda ölçüldüyse sayılır. Aktif dinleme
     yolunda ölçülen AEC, TTS ile hiç çakışmadığı için duplex hakkında hiçbir
     şey kanıtlamaz. */
  const aecCounts = ev.aecEnabled === true && ev.aecEvidencePath === 'DUPLEX_CAPTURE';
  if (ev.captureOpenDuringTts !== true) return 'HALF_DUPLEX_INTERRUPT';
  if (!aecCounts) return 'HALF_DUPLEX_INTERRUPT';
  if (ev.echoReferenceWired === true && ev.micDiagnosticsPresent === true) {
    return 'TRUE_FULL_DUPLEX';
  }
  return 'AEC_GATED_DUPLEX';
}

/**
 * Bu sınıfta **akustik** barge-in kanıtı (wake tetiği · ASR kısmi) tek başına
 * Mavi'yi susturabilir mi?
 *
 * `HALF_DUPLEX_INTERRUPT`te `false`: kesme YİNE mümkündür, ama tetiği açık
 * kullanıcı eylemi (mikrofon/kes düğmesi) verir — akustik sinyal değil.
 */
export function duplexAllowsAcousticBargeIn(cls: MaviDuplexClass): boolean {
  return cls === 'TRUE_FULL_DUPLEX' || cls === 'AEC_GATED_DUPLEX';
}

/**
 * **SELF-ECHO RİSKİ:** Mavi konuşurken yakalama yolu AÇIK ama echo koruması
 * KANITLANMAMIŞ. Bu, akustik tetiğin "kullanıcı mı, Mavi'nin kendi sesi mi"
 * olduğunun AYIRT EDİLEMEDİĞİ durumdur → o tetik kanıt sayılmaz.
 *
 * ⚠️ Bugün üretimde GERÇEKLEŞEBİLİR: native TTS `nativeTtsSpeaking` bayrağını
 * kurar ve wake thread mikrofonu bırakır; ama **WebView ses yolları**
 * (premium klip · Edge · online · `speechSynthesis`) o bayrağı KURMAZ →
 * wake thread mikrofonu açık tutmaya devam eder ve Mavi kendi sesini duyabilir.
 */
export function duplexHasSelfEchoRisk(
  ev: MaviDuplexEvidence | null | undefined,
  captureOpenOnThisPath: boolean,
): boolean {
  if (captureOpenOnThisPath !== true) return false;
  if (!ev) return true;
  return !(ev.aecEnabled === true && ev.aecEvidencePath === 'DUPLEX_CAPTURE');
}

/** Kısa, kullanıcıya DEĞİL geliştiriciye yönelik sınıf açıklaması (CAROS LAB). */
export const MAVI_DUPLEX_CLASS_NOTE: Readonly<Record<MaviDuplexClass, string>> =
  Object.freeze({
    TRUE_FULL_DUPLEX:
      'Mikrofon TTS sırasında açık · AEC duplex yolunda etkin · TTS referans sinyali bağlı.',
    AEC_GATED_DUPLEX:
      'Mikrofon TTS sırasında açık · AEC etkin ama referans sinyali kanıtı YOK → '
      + 'akustik kesme yalnız güçlü konuşma kanıtıyla.',
    HALF_DUPLEX_INTERRUPT:
      'Kesme mekaniği TAM (ttsCancel + akış iptali + tur supersede) ama TTS sırasında '
      + 'korumalı yakalama yolu YOK → tetik akustik olamaz, açık kullanıcı eylemi gerekir.',
    UNSUPPORTED:
      'İptal zinciri kanıtlanamadı — kesme güvenle yapılamaz.',
  });
