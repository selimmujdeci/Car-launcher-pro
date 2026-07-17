/**
 * capabilityOutcome — Araç Yetenek Sonucu: TEK sınıflandırma sözlüğü (PR-CAP-1).
 *
 * KÖK PROBLEM: bugün bir PID/DID sorgusunun sonucu `supported: boolean`'a düşürülüyor
 * (native `readObdDid` → `data != null`). Bu, BİRBİRİNDEN TAMAMEN FARKLI beş durumu tek
 * kovaya atıyor:
 *   - araç bu DID'i HİÇ tanımıyor        (7F-31 requestOutOfRange)  → bir daha SORMA
 *   - DID var ama güvenlik istiyor       (7F-33 securityAccessDenied) → bizim kapsamımız DIŞI
 *   - DID var ama koşul sağlanmadı       (7F-22 motor çalışmıyor)    → SONRA tekrar sor
 *   - ECU yanıt vermedi                  (NO DATA)                   → sınırlı tekrar
 *   - hat/adaptör hatası                 (CAN ERROR / timeout)       → PID hakkında KANIT DEĞİL
 * Sonuç: `manufacturerPidService` `!supported` gelen her DID'i KALICI kara listeye alıyor →
 * "motor çalışınca okunacak" bir DID sonsuza dek yasaklanıyor (sessiz yetenek kaybı).
 *
 * Bu modül o beş durumu AYIRAN sözlüğü ve saf sınıflandırıcıyı verir.
 *
 * ZERO-TRUST (anayasa): bir sonuç ancak ARACIN KENDİSİ hakkında bilgi taşıyorsa öğrenilir.
 * Hat hatası/timeout aracın yeteneği hakkında KANIT DEĞİLDİR → {@link isCapabilityEvidence}
 * false döner ve çağıran bunu kalıcı profile YAZMAZ (yoksa kopan bir kablo, aracın tüm
 * yeteneklerini "yok" diye öğretirdi).
 *
 * SAF: modül-durumu yok, I/O yok, native/React importu yok — tam test edilebilir.
 */

/* ══════════════════════════════════════════════════════════════════════════
 * Sonuç sözlüğü
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Bir PID/DID adayının sorgu sonucu.
 *
 * `unsupported` ve `security_required` KALICIDIR (araç sınırı — tekrar sormak israftır).
 * `condition_required` GEÇİCİDİR (koşul değişince tekrar denenir — motor çalıştı, hız düştü…).
 * `timeout` araç hakkında KANIT DEĞİLDİR (hat/adaptör sorunu — öğrenilmez).
 */
export type CapabilityOutcome =
  /** Pozitif yanıt geldi ve çözüldü — bu yetenek KANITLI çalışıyor. */
  | 'working'
  /** ECU yanıt vermedi (ELM "NO DATA"). Bitmap destekli görünse bile veri akmıyor olabilir. */
  | 'no_data'
  /** Araç bu kimliği HİÇ tanımıyor (7F-11/12/31). KALICI — arıza değil, araç sınırı. */
  | 'unsupported'
  /** İletişim kesildi/yarım kaldı (hat hatası, adaptör hatası). Araç hakkında KANIT DEĞİL. */
  | 'timeout'
  /** Kimlik VAR ama şu anki koşulda okunamaz (7F-22 motor durgun, 7F-81 devir yüksek…). GEÇİCİ. */
  | 'condition_required'
  /** Kimlik VAR ama güvenlik erişimi istiyor (7F-33/34/35/36). Kapsam DIŞI — bypass YOK. */
  | 'security_required'
  /** Pozitif yanıt geldi ama çözülemedi (sınır dışı/bozuk/eksik bayt) — profil/decode hatamız. */
  | 'parse_error';

/** Tüm sonuç değerleri (UI listeleri / doğrulama için). */
export const CAPABILITY_OUTCOMES: readonly CapabilityOutcome[] = Object.freeze([
  'working', 'no_data', 'unsupported', 'timeout',
  'condition_required', 'security_required', 'parse_error',
]);

/** Bilinmeyen girdiyi güvenle daraltır (bozuk disk kaydı → null). */
export function isCapabilityOutcome(v: unknown): v is CapabilityOutcome {
  return typeof v === 'string' && (CAPABILITY_OUTCOMES as readonly string[]).includes(v);
}

/* ══════════════════════════════════════════════════════════════════════════
 * Karar kuralları — "bu sonuçtan sonra ne yapmalı?"
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Bu sonuç ARACIN yeteneği hakkında kanıt mı? (zero-trust kapısı)
 *
 * `timeout` HARİÇ hepsi kanıttır: timeout hat/adaptör kaynaklıdır ve araç hakkında
 * hiçbir şey söylemez. Kalıcı profile YALNIZ kanıt yazılır — aksi halde tek bir kopuk
 * kablo aracın tüm yeteneklerini "yok" diye öğretirdi (kalıcı sessiz veri kaybı).
 */
export function isCapabilityEvidence(outcome: CapabilityOutcome): boolean {
  return outcome !== 'timeout';
}

/**
 * Bu sonuç KALICI mı — aday bir daha sorulmamalı mı?
 *
 * `unsupported`: araç kimliği tanımıyor → sormak her turda ~200ms NO-DATA israfı.
 * `security_required`: erişim kilitli → bypass KAPSAM DIŞI (ECU write/coding/security
 * bypass yasak) → tekrar sormak da anlamsız.
 *
 * `condition_required` KALICI DEĞİLDİR (koşul değişince okunabilir) — bugünkü kodun
 * en önemli hatası bunu kalıcı saymasıydı.
 */
export function isPermanentOutcome(outcome: CapabilityOutcome): boolean {
  return outcome === 'unsupported' || outcome === 'security_required';
}

/**
 * Bu aday tekrar sorulmalı mı?
 *
 * `working`   → evet (normal poll).
 * `timeout`   → evet (hat düzelince).
 * `condition_required` → evet, ama SONRA (koşul değişince — çağıran soğuk-yolda dener).
 * `no_data`   → evet ama SINIRLI (çağıran demote sayacı uygular — bounded).
 * `parse_error` → HAYIR: ECU yanıt veriyor, çözücümüz bozuk. Tekrar sormak aynı bozuk
 *   değeri getirir; düzeltilecek yer profildir → adayı sor(ma)mak yerine profil onarılır.
 * `unsupported` / `security_required` → hayır (kalıcı).
 */
export function shouldRetryOutcome(outcome: CapabilityOutcome): boolean {
  if (isPermanentOutcome(outcome)) return false;
  return outcome !== 'parse_error';
}

/* ══════════════════════════════════════════════════════════════════════════
 * UDS negatif yanıt kodu (NRC) → sonuç — ISO 14229-1 Tablo A.1
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * "İstek doğru alındı, yanıt beklemede" — NİHAİ sonuç DEĞİLDİR. ECU işi bitince gerçek
 * yanıtı gönderir; bu NRC'yi sonuç saymak "çalışan" bir DID'i yanlışlıkla elemek olurdu.
 */
export const NRC_RESPONSE_PENDING = 0x78;

/**
 * NRC → sonuç haritası (ISO 14229-1 Tablo A.1). Yalnız KARARI değiştiren kodlar listelenir;
 * listelenmeyenler {@link classifyNrc} içinde muhafazakâr varsayılana düşer.
 */
const NRC_MAP: ReadonlyMap<number, CapabilityOutcome> = new Map<number, CapabilityOutcome>([
  // ── Araç bu kimliği tanımıyor → KALICI ───────────────────────────────────
  [0x11, 'unsupported'],        // serviceNotSupported — servis (22/21) yok
  [0x12, 'unsupported'],        // subFunctionNotSupported
  [0x31, 'unsupported'],        // requestOutOfRange — DID/LID mevcut değil (en yaygın)
  [0x7F, 'unsupported'],        // serviceNotSupportedInActiveSession

  // ── Güvenlik → KALICI (bypass KAPSAM DIŞI) ───────────────────────────────
  [0x33, 'security_required'],  // securityAccessDenied
  [0x34, 'security_required'],  // authenticationRequired
  [0x35, 'security_required'],  // invalidKey
  [0x36, 'security_required'],  // exceedNumberOfAttempts

  // ── İsteğimiz bozuk → bizim profil/decode hatamız ────────────────────────
  [0x13, 'parse_error'],        // incorrectMessageLengthOrInvalidFormat
  [0x14, 'parse_error'],        // responseTooLong

  // ── Geçici: hat/ECU meşgul → tekrar dene ─────────────────────────────────
  [0x21, 'timeout'],            // busyRepeatRequest — ECU meşgul, araç hakkında kanıt DEĞİL
  [0x25, 'no_data'],            // noResponseFromSubnetComponent — alt ECU sessiz

  // ── Koşul sağlanmadı → GEÇİCİ, sonra tekrar dene ─────────────────────────
  [0x10, 'condition_required'], // generalReject — sebep belirsiz; muhafazakâr: kalıcı SAYMA
  [0x22, 'condition_required'], // conditionsNotCorrect (motor durgun/kontak kapalı…)
  [0x24, 'condition_required'], // requestSequenceError — oturum sırası
  [0x26, 'condition_required'], // failurePreventsExecutionOfRequestedAction
  [0x37, 'condition_required'], // requiredTimeDelayNotExpired
  [0x7E, 'condition_required'], // subFunctionNotSupportedInActiveSession — oturum değişince olur
]);

/**
 * NRC 0x81–0x8F: ISO 14229-1'in "koşul" ailesi (rpmTooHigh 0x81, rpmTooLow 0x82,
 * engineIsRunning 0x83, engineIsNotRunning 0x84, engineRunTimeTooLow 0x85,
 * temperatureTooHigh 0x86, temperatureTooLow 0x87, vehicleSpeedTooHigh 0x88, …).
 * Hepsi AYNI kararı verir: şu an olmaz, koşul değişince tekrar dene.
 */
function isConditionFamilyNrc(nrc: number): boolean {
  return nrc >= 0x81 && nrc <= 0x8F;
}

/**
 * UDS negatif yanıt kodunu sonuca çevirir.
 *
 * @returns `null` YALNIZ NRC 0x78 (responsePending — nihai sonuç değil) için; çağıran
 *   gerçek yanıtı beklemeye devam eder. Bilinmeyen/geçersiz NRC muhafazakâr biçimde
 *   `condition_required` olur: ECU AKTİF OLARAK yanıt verdi (kimlik büyük ihtimalle VAR),
 *   sebebini bilmiyoruz → kalıcı elemek KANIT AŞIMI olurdu (zero-trust).
 */
export function classifyNrc(nrc: number): CapabilityOutcome | null {
  if (!Number.isInteger(nrc) || nrc < 0 || nrc > 0xFF) return 'condition_required';
  if (nrc === NRC_RESPONSE_PENDING) return null;
  const mapped = NRC_MAP.get(nrc);
  if (mapped) return mapped;
  if (isConditionFamilyNrc(nrc)) return 'condition_required';
  return 'condition_required';
}

/* ══════════════════════════════════════════════════════════════════════════
 * Ham ELM327 yanıtı → sonuç
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * ELM327 yanıt sınıfı — native `ElmResponseParser.Kind` ile AYNI ad uzayı (köprü bunu
 * string olarak taşır; native enum'ı TS'e sızdırmadan tek sözleşme).
 */
export type ElmResponseKind =
  | 'OK'              // beklenen mode+pid veri bloğu bulundu
  | 'NO_DATA'         // ELM "NO DATA"
  | 'BUSY'            // "SEARCHING..." / "BUS INIT..." — nihai değil
  | 'NEG_7F'          // "7F <mode> <NRC>" — ayrık negatif yanıt
  | 'ERROR'           // "?" / CAN ERROR / BUS ERROR / STOPPED / BUFFER FULL / UNABLE TO CONNECT
  | 'TIMEOUT_PARTIAL';// boş/yarım/tanınmayan yanıt

/** {@link classifyElmResponse} girdisi — TAM şekilli (hidden-class kararlılığı). */
export interface ElmResponseEvidence {
  kind: ElmResponseKind;
  /**
   * `kind === 'NEG_7F'` ise ECU'nun NRC baytı (ör. 0x31). Native bunu çıkaramadıysa
   * `null` → muhafazakâr `condition_required` (kalıcı eleme YOK — bkz. classifyNrc).
   */
  nrc: number | null;
  /**
   * `kind === 'OK'` ise çözücünün değeri üretip üretemediği. `false` → `parse_error`
   * (ECU yanıt verdi ama bizim decode'umuz düştü — bu AYRIMI kaybetmek, sağlam bir DID'i
   * "veri yok" sanmaya yol açardı).
   */
  decoded: boolean;
}

/**
 * Ham ELM327 yanıt kanıtını sonuca çevirir — TEK sınıflandırma noktası.
 *
 * @returns `null` YALNIZ nihai OLMAYAN durumlarda (`BUSY`, ya da NEG_7F + 0x78
 *   responsePending) — çağıran beklemeye devam eder, hiçbir şey ÖĞRENMEZ.
 */
export function classifyElmResponse(ev: ElmResponseEvidence): CapabilityOutcome | null {
  switch (ev.kind) {
    case 'OK':
      // ECU pozitif yanıt verdi → kimlik KESİN var. Tek soru: çözebildik mi?
      return ev.decoded ? 'working' : 'parse_error';

    case 'NEG_7F':
      // ECU ayrık negatif yanıt verdi → NRC kararı belirler. NRC yoksa (native eski
      // sürüm / çıkaramadı) muhafazakâr: kalıcı ELEME YOK.
      return ev.nrc === null ? 'condition_required' : classifyNrc(ev.nrc);

    case 'NO_DATA':
      return 'no_data';

    case 'ERROR':
    case 'TIMEOUT_PARTIAL':
      // Hat/adaptör/protokol hatası — araç yeteneği hakkında KANIT DEĞİL (isCapabilityEvidence
      // false) → kalıcı profile yazılmaz.
      return 'timeout';

    case 'BUSY':
      return null; // "SEARCHING..." — nihai değil, öğrenme YOK

    default:
      // Bilinmeyen kind (ileri köprü sürümü) → muhafazakâr: kanıt sayma.
      return 'timeout';
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * Sonuç birleştirme — "yeni kanıt eskisini ezmeli mi?"
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Önceki ve yeni sonucu birleştirir — kalıcı profile YAZILACAK sonucu döner.
 *
 * KURAL (fleetKb ile aynı ilke — "araca inanırız, hafızaya değil"): CANLI KANIT her zaman
 * hafızayı ezer. Araç değişmiş (dongle Doblo→Trafic — sahada YAŞANDI), ECU sökülmüş veya
 * yazılım güncellenmiş olabilir; eski `working` iddiasını yeni `unsupported` gözleminin
 * üstünde tutmak, kullanıcıya olmayan bir yeteneği vaat etmek olurdu.
 *
 * TEK istisna: `timeout` KANIT DEĞİLDİR (hat/adaptör hatası — araç hakkında hiçbir şey
 * söylemez) → önceki bilgi KORUNUR. Bu istisna olmasaydı kopan tek bir kablo, aracın
 * öğrenilmiş tüm yeteneklerini silerdi.
 *
 * NOT (histerezis burada DEĞİL): "bir kez `no_data` gördüm diye kanıtlı `working`'i hemen
 * düşüreyim mi?" sorusu aralıklı ECU'larda (Trafic/KWP) önemlidir — ama bu bir SAYAÇ
 * kararıdır (ardışık N başarısızlık) ve kalıcı depo katmanının sorumluluğudur. Bu saf
 * fonksiyon yalnız "tek gözlem → tek sonuç" eşlemesi yapar.
 *
 * @returns birleşmiş sonuç; `previous` null VE `next` kanıt değilse `null` (öğrenme yok).
 */
export function mergeOutcome(
  previous: CapabilityOutcome | null,
  next: CapabilityOutcome,
): CapabilityOutcome | null {
  // Hat hatası hiçbir şey öğretmez — önceki bilgi aynen kalır (previous null ise null).
  if (!isCapabilityEvidence(next)) return previous;
  // Canlı kanıt hafızayı ezer.
  return next;
}

/* ══════════════════════════════════════════════════════════════════════════
 * İnsan-okur açıklama (UI / tanı raporu)
 * ════════════════════════════════════════════════════════════════════════ */

/** Kullanıcıya gösterilecek Türkçe açıklama — "neden okunamıyor" sorusunun dürüst cevabı. */
export function describeOutcome(outcome: CapabilityOutcome): string {
  switch (outcome) {
    case 'working':            return 'Çalışıyor — canlı veri akıyor';
    case 'no_data':            return 'ECU yanıt vermiyor (veri yok)';
    case 'unsupported':        return 'Araç bu veriyi hiç vermiyor (arıza değil, araç sınırı)';
    case 'timeout':            return 'İletişim hatası — araç hakkında kanıt yok';
    case 'condition_required': return 'Koşul sağlanmadı (ör. motor çalışmıyor) — sonra denenecek';
    case 'security_required':  return 'Güvenlik erişimi gerekiyor — desteklenmiyor';
    case 'parse_error':        return 'Yanıt geldi ama çözülemedi (profil düzeltmesi gerekli)';
  }
}
