/**
 * SpeedCameraWarningRule — sekizinci (son) Guardian analiz kuralı — GUARDIAN-AI-G9.
 *
 * `roadHazardRule.ts` desenini izler: SAF, deterministik, fail-closed, severity
 * TAMAMEN KATEGORİK (DI ile gelen `policy.severityByCameraType` haritasından);
 * event, DI ile verilen GERÇEK `camera.distanceMeters` değerini TAŞIR (kuralda
 * uydurulmaz). `guardian/models.ts`teki `GuardianRuleResult` sözleşmesine uyar
 * (`ruleId:'speed-camera'`, `type:'SPEED_CAMERA_WARNING'` — model ZATEN mevcut,
 * EKLEME YOK) — `guardianEngine.ts`e OTOMATİK bağlanmaz (DI ile gelecek). GPS/
 * harita API/internet/kamera-algılama/Android/Mavi/UI/store YOK; yalnız `../models`
 * içe aktarılır. Diğer kurallardan HİÇBİR ŞEY import edilmez — her kural bağımsız.
 *
 * AMAÇ: kullanıcıyı "cezadan kurtarmak" DEĞİL — hız limitine uyulmasını teşvik
 * eden GÜVENLİ SÜRÜŞ uyarısı. Bu yüzden dil güvenlik odaklıdır; "radar"/"ceza"/
 * "polis"/"atlattın" gibi ceza-kaçırma çağrışımlı ifadeler HİÇBİR yerde geçmez.
 *
 * ── FAIL-CLOSED (event-yok, throw DEĞİL) ─────────────────────────────────────
 *   - `camera.cameraType` yok → olay YOK.
 *   - `camera.cameraType === 'unknown'` → olay YOK (kamera tahmini YASAK).
 *   - `policy.severityByCameraType[cameraType] === 'NONE'` → olay YOK.
 *   - `camera.confidence` < etkin minimum güven → olay YOK.
 *
 * ── `'unknown'` İLE `'unspecified'` AYNI ŞEY DEĞİLDİR (bilinçli ayrım) ───────
 * İkisini karıştırmak bu kuralın en pahalı hatası olurdu:
 *   · `'unknown'`     → **noktanın VAR OLDUĞU bile bilinmiyor.** Uyarı vermek
 *                       kamera UYDURMAK olur → olay YOK (değişmedi, kilitli).
 *   · `'unspecified'` → **noktanın varlığı GÖZLENDİ** (yetkili kaynak yayınladı),
 *                       yalnız TÜRÜ kaynakta belirtilmemiş. Burada uyarı vermemek
 *                       gerçek bir denetim noktasını SESSİZCE yutmak olurdu.
 * Bu ayrım ürün gerçeğinden doğdu: EGM kamuya açık EDS paketinin **%93'ünde tip
 * alanı yok**. Tipi bilinmeyen kayıtları elemek özelliğin %93'ünü öldürürdü;
 * onlara tip İDDİA ETMEK ise yalan olurdu. Üçüncü yol: varlığı bildir, türü
 * bildirme. `'unspecified'` mesajı bu yüzden tür ve hız eşiği İDDİA ETMEZ.
 *
 * ── EKSİK-EŞLEME → THROW (roadHazard/weather ile AYNI) ──────────────────────
 * BİLİNEN bir `cameraType` (fixed_speed/average_speed/mobile_speed/traffic_light/
 * combined/unspecified) için `severityByCameraType`de giriş YOKSA → **THROW**
 * (kritik bir denetim noktası politika eksikliğinden SESSİZCE kaybolmasın).
 * `'unknown'`/`undefined` için eşleme ARANMAZ (zaten event-yok dalı).
 */
import type { GuardianRiskEvent, GuardianRuleResult, GuardianSeverity } from '../models';

/* ── Sözleşme ─────────────────────────────────────────────────────────────── */

export type SpeedCameraType =
  | 'fixed_speed'
  | 'average_speed'
  | 'mobile_speed'
  | 'traffic_light'
  | 'combined'
  /** Varlık GÖZLENDİ, tür kaynakta BELİRTİLMEMİŞ — uyarı verilir, tür iddia edilmez. */
  | 'unspecified'
  /** Noktanın var olduğu bile bilinmiyor — olay ÜRETİLMEZ. */
  | 'unknown';

/** `GuardianSeverity` veya `'NONE'` (risk yok — event üretilmez). */
export type SpeedCameraSeverityOrNone = GuardianSeverity | 'NONE';

/** İleride bildirilen tek bir hız denetim noktası. Harita/GPS/internet/kamera
 *  PARSER'ı burada YOK — bu veri zaten normalize edilmiş halde DI ile gelir. */
export interface SpeedCameraInput {
  /** Deterministik event id'sinde kullanılır — zorunlu, boş olamaz. */
  id:              string;
  /** Sürücüye olan mesafe (metre) — DI'dan gelir, kuralda UYDURULMAZ.
   *  finite ve negatif-olmayan olmalı (0 geçerli). */
  distanceMeters:  number;
  confidence:      number;
  source?:         string;
  cameraType?:     SpeedCameraType;
}

/** DI ile gelen kategorik severity haritası — GÖMÜLÜ severity YOK (magic map YASAK). */
export interface SpeedCameraSeverityByCameraType {
  fixed_speed?:    SpeedCameraSeverityOrNone;
  average_speed?:  SpeedCameraSeverityOrNone;
  mobile_speed?:   SpeedCameraSeverityOrNone;
  traffic_light?:  SpeedCameraSeverityOrNone;
  combined?:       SpeedCameraSeverityOrNone;
  unspecified?:    SpeedCameraSeverityOrNone; // BİLİNEN token — eşleme ZORUNLU
  unknown?:        SpeedCameraSeverityOrNone; // ARANMAZ — yalnız tip tamlığı için
}

export interface SpeedCameraRiskPolicyInput {
  severityByCameraType: SpeedCameraSeverityByCameraType;
  /** Verilmezse `DEFAULT_CAMERA_MIN_CONFIDENCE` kullanılır. */
  minimumConfidence?:   number;
}

export interface SpeedCameraRiskInput {
  camera:  SpeedCameraInput;
  policy:  SpeedCameraRiskPolicyInput;
}

/* ── Merkezi isimli sabitler (magic number/magic map YASAK) ──────────────── */

export const SPEED_CAMERA_RULE_ID = 'speed-camera';

/** `policy.minimumConfidence` verilmediğinde uygulanan varsayılan güven eşiği —
 *  diğer guardian kurallarındaki AYNI değer, bağımsız isimli sabit (magic
 *  DEĞİL — belgelenmiş, testle kilitli). Sınırda (`=== eşik`) olay ÜRETİLİR. */
const DEFAULT_CAMERA_MIN_CONFIDENCE = 0.3;

/** `camera.source` verilmezse kullanılan varsayılan kaynak etiketi. */
const DEFAULT_CAMERA_SOURCE = 'speed-camera-rule';

/** Güvenlik odaklı, ihtiyatlı öneri metni — ceza-kaçırma dili YOK. */
const RECOMMENDED_ACTION_TEXT = 'Hız limitlerine uygun şekilde ilerlemen önerilir.';

/** Tip-bazlı başlıklar. `'unspecified'` başlığı "hız" DEMEZ — türü bilinmeyen bir
 *  noktaya "hız denetimi" demek tür iddiasıdır (karar K3). */
const CAMERA_TITLES: Readonly<Record<Exclude<SpeedCameraType, 'unknown'>, string>> = {
  fixed_speed:   'Hız denetim noktası',
  average_speed: 'Hız denetim noktası',
  mobile_speed:  'Hız denetim noktası',
  traffic_light: 'Hız denetim noktası',
  combined:      'Hız denetim noktası',
  unspecified:   'Denetim noktası',
};

/** Tip-bazlı İHTİYATLI mesaj metinleri — severity DEĞİL, yalnız açıklama. Hepsi
 *  "bildiriliyor/bulunuyor" dilinde (radar/ceza/polis çağrışımı YOK). `'unknown'`
 *  burada YOK (o dal zaten event-yok). */
const CAMERA_MESSAGES: Readonly<Record<Exclude<SpeedCameraType, 'unknown'>, string>> = {
  fixed_speed:   'İleride sabit hız denetim noktası bildiriliyor.',
  average_speed: 'İleride ortalama hız denetim koridoru bulunuyor.',
  mobile_speed:  'İleride mobil hız denetimi bildiriliyor.',
  traffic_light: 'İleride trafik ışığı denetim noktası bulunuyor.',
  combined:      'İleride hız ve trafik denetim noktası bulunuyor.',
  // Tür İDDİA EDİLMEZ, hız eşiği İDDİA EDİLMEZ (K3/K4).
  unspecified:   'İleride bir denetim noktası bildiriliyor. Türü belirtilmemiş.',
};

/** Geçerli severity token kümesi — `severityByCameraType` değerlerini doğrulamak
 *  için (models.ts'ten runtime DEĞER import ETMEDEN — bağımsız yerel kopya). */
const VALID_SEVERITY_TOKENS: ReadonlySet<string> = new Set([
  'INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL', 'NONE',
]);

/* ── Yardımcılar ──────────────────────────────────────────────────────────── */

/** confidence savunmacı clamp — diğer guardian kurallarıyla AYNI davranış. */
function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function emptyResult(): GuardianRuleResult {
  return { ruleId: SPEED_CAMERA_RULE_ID, riskEvents: [] };
}

/* ── Doğrulama — SÖZLEŞME/programlama hatası → THROW ─────────────────────────
 * (gerçek-dünya eksik/belirsiz veri — undefined/'unknown'/'NONE'/düşük
 * confidence — buraya GİRMEZ; o durumlar `evaluateSpeedCameraRisk` içinde
 * sessizce boş sonuçla ele alınır.) */
function validateInput(input: SpeedCameraRiskInput): void {
  const camera = input?.camera;
  const policy = input?.policy;

  if (!camera) {
    throw new RangeError('evaluateSpeedCameraRisk: camera zorunludur.');
  }
  if (typeof camera.id !== 'string' || camera.id.length === 0) {
    throw new RangeError('evaluateSpeedCameraRisk: camera.id zorunludur (boş olamaz) — event id için gerekli.');
  }
  if (!Number.isFinite(camera.distanceMeters) || camera.distanceMeters < 0) {
    throw new RangeError(`evaluateSpeedCameraRisk: geçersiz camera.distanceMeters (${camera.distanceMeters}) — finite ve negatif-olmayan olmalı (0 geçerli).`);
  }
  if (!Number.isFinite(camera.confidence) || camera.confidence < 0 || camera.confidence > 1) {
    throw new RangeError(`evaluateSpeedCameraRisk: geçersiz camera.confidence (${camera.confidence}) — 0..1 aralığında finite olmalı.`);
  }

  if (!policy || !policy.severityByCameraType) {
    throw new RangeError('evaluateSpeedCameraRisk: policy.severityByCameraType zorunludur.');
  }
  if (policy.minimumConfidence !== undefined
      && (!Number.isFinite(policy.minimumConfidence) || policy.minimumConfidence < 0 || policy.minimumConfidence > 1)) {
    throw new RangeError(`evaluateSpeedCameraRisk: geçersiz policy.minimumConfidence (${policy.minimumConfidence}) — verildiyse 0..1 aralığında olmalı.`);
  }

  // Haritada TANIMLI olan her değer geçerli bir token OLMALI (bütünlük).
  for (const [key, value] of Object.entries(policy.severityByCameraType)) {
    if (value !== undefined && !VALID_SEVERITY_TOKENS.has(value)) {
      throw new RangeError(
        `evaluateSpeedCameraRisk: severityByCameraType.${key} geçersiz değer ('${value}') — GuardianSeverity veya 'NONE' olmalı.`,
      );
    }
  }

  // Verilen BİLİNEN cameraType için eşleme ZORUNLU — kritik bir denetim noktası
  // (ör. 'combined') haritada unutulursa SESSİZCE kaybolmasın. 'unknown'/
  // undefined için eşleme ARANMAZ (zaten event-yok dalına düşer).
  const cameraType = camera.cameraType;
  if (cameraType !== undefined && cameraType !== 'unknown') {
    if (policy.severityByCameraType[cameraType] === undefined) {
      throw new RangeError(
        `evaluateSpeedCameraRisk: severityByCameraType['${cameraType}'] için eşleme tanımlı değil — politika eksik (kritik bir denetim noktası sessizce düşmesin).`,
      );
    }
  }
}

/* ── Ana kural ────────────────────────────────────────────────────────────── */

/**
 * TEK giriş noktası. Girdi (`camera`/`policy` ve iç alanları) MUTASYONA
 * UĞRATILMAZ. Aynı girdi her zaman AYNI çıktıyı üretir — `Date.now`/`new Date`/
 * `Math.random`/global durum/timezone YOK.
 */
export function evaluateSpeedCameraRisk(input: SpeedCameraRiskInput): GuardianRuleResult {
  validateInput(input);

  const { camera, policy } = input;
  const cameraConfidence = clamp01(camera.confidence);

  // 1) Tip yok VEYA 'unknown' → olay YOK (kamera tahmini/uydurma YASAK).
  const cameraType = camera.cameraType;
  if (cameraType === undefined || cameraType === 'unknown') {
    return emptyResult();
  }

  // 2) Kategorik severity — DI haritasından (validateInput anahtarı garanti eder).
  //    'NONE' → olay YOK.
  const mappedSeverity = policy.severityByCameraType[cameraType] as SpeedCameraSeverityOrNone;
  if (mappedSeverity === 'NONE') {
    return emptyResult();
  }
  const severity: GuardianSeverity = mappedSeverity;

  // 3) Confidence etkin eşik altındaysa (eksik/güvenilmez bildirim) olay YOK.
  const minimumConfidence = policy.minimumConfidence ?? DEFAULT_CAMERA_MIN_CONFIDENCE;
  if (cameraConfidence < minimumConfidence) {
    return emptyResult();
  }

  const source = camera.source ?? DEFAULT_CAMERA_SOURCE;

  const event: GuardianRiskEvent = {
    id:                `${SPEED_CAMERA_RULE_ID}:${camera.id}`, // deterministik
    type:              'SPEED_CAMERA_WARNING',
    severity,
    // İleride bir denetim noktası — DI ile gelen GERÇEK mesafe (roadHazard deseni;
    // kuralda uydurulmaz, aynen geçirilir).
    distanceMeters:    camera.distanceMeters,
    title:             CAMERA_TITLES[cameraType],
    message:           CAMERA_MESSAGES[cameraType],
    recommendedAction: RECOMMENDED_ACTION_TEXT,
    confidence:        cameraConfidence, // event conf <= camera conf (burada eşit — üst sınır)
    source,
  };

  return { ruleId: SPEED_CAMERA_RULE_ID, riskEvents: [event] };
}
