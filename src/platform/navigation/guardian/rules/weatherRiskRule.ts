/**
 * WeatherRiskRule — dördüncü Guardian analiz kuralı — GUARDIAN-AI-G5.
 *
 * `curveRiskRule.ts`/`speedLimitRule.ts`/`roadProfileRule.ts` deseni izlenir:
 * SAF, deterministik, fail-closed. `guardian/models.ts`teki `GuardianRuleResult`
 * sözleşmesine uyar (`ruleId:'weather'`) — `guardianEngine.ts`e OTOMATİK
 * bağlanmaz (DI ile gelecek). GPS/internet/hava-servisi/harita/Mavi/UI/store
 * YOK; yalnız `../models` (guardian tipleri) içe aktarılır. Diğer kurallardan
 * HİÇBİR ŞEY import edilmez — her kural bağımsız.
 *
 * ÖNEMLİ FARK (curve/speed-limit/road-profile'a göre): bu kuralda severity
 * ne overspeed oranından ne mutlak eğim bandından gelir — TAMAMEN
 * **KATEGORİKTİR**: `condition.surfaceCondition` doğrudan DI ile verilen
 * `policy.severityByCondition` haritasına bakılarak severity'ye çevrilir.
 * Bu dosyada GÖMÜLÜ bir severity haritası YOKTUR (magic map YASAK) — hangi
 * yüzey koşulunun ne kadar riskli sayılacağına HER ZAMAN çağıran karar verir.
 * Oran/eşik/mesafe/ETA/hız hesabı da YOKTUR — hava/yüzey koşulu anlıktır,
 * segment-mesafeli bir "yaklaşan tehlike" değildir (bkz. `distanceMeters=0`
 * gerekçesi aşağıda).
 *
 * ── GÜVENLİK ANAYASASI (mutlak — diğer guardian kurallarıyla AYNI) ──────────
 *   - Direksiyon/fren/gaz kontrolü YOK.
 *   - "Kesin güvenli hız" denmez.
 *   - "Ani fren yap" denmez (CRITICAL'de bile).
 *   - Hava TAHMİNİ/UYDURMA YOK — `surfaceCondition` yoksa VEYA `'unknown'`
 *     ise (belirsiz/tespit edilememiş) risk ÜRETİLMEZ.
 *
 * ── FAIL-CLOSED (event-yok, throw DEĞİL) ─────────────────────────────────────
 *   - `condition.surfaceCondition` yok → olay YOK.
 *   - `condition.surfaceCondition === 'unknown'` → olay YOK (asla tahmin).
 *   - `policy.severityByCondition[surfaceCondition] === 'NONE'` → olay YOK.
 *   - `condition.confidence` < `MINIMUM_WEATHER_CONFIDENCE` → olay YOK.
 *
 * ── EKSİK-EŞLEME → THROW (bilinçli tasarım kararı) ──────────────────────────
 * `surfaceCondition` `'dry'|'wet'|'snow'|'ice'` (yani BİLİNEN bir koşul) ise
 * VE `policy.severityByCondition`de bu koşul için bir giriş YOKSA → **THROW**.
 * Bu throw DEĞİL event-yok olsaydı, çağıranın `severityByCondition`
 * haritasını eksik doldurması (ör. `ice` girişini UNUTMASI) SESSİZCE bir
 * kritik buzlanma uyarısının hiç üretilmemesine yol açardı — bu tam olarak
 * bu motorun önlemeye çalıştığı türden bir güvenlik açığıdır. `'unknown'`/
 * `undefined` için eşleme ARANMAZ (zaten event-yok dalına düşerler) — bu
 * yüzden onlar için harita GİRİŞİ ZORUNLU DEĞİLDİR.
 *
 * `visibilityMeters` sözleşmede TAŞINIR (gelecekteki görüş-mesafesi tabanlı
 * genişleme için) AMA G5'te severity hesabında HİÇ OKUNMAZ.
 */
import type { GuardianRiskEvent, GuardianRuleResult, GuardianSeverity } from '../models';

/* ── Sözleşme ─────────────────────────────────────────────────────────────── */

export type WeatherSurfaceCondition = 'dry' | 'wet' | 'snow' | 'ice' | 'unknown';

/** `GuardianSeverity` veya `'NONE'` (risk yok anlamına gelir — event üretilmez). */
export type WeatherSeverityOrNone = GuardianSeverity | 'NONE';

/** Anlık yüzey/hava koşulu. Hava servisi/GPS/harita PARSER'ı burada YOK — bu
 *  veri zaten normalize edilmiş halde DI ile gelir. */
export interface WeatherConditionInput {
  surfaceCondition?:  WeatherSurfaceCondition;
  /** G5'te severity hesabında KULLANILMAZ — yalnız sözleşmede taşınır
   *  (gelecekteki görüş-mesafesi tabanlı genişleme için yer tutucu). */
  visibilityMeters?:  number;
  source?:            string;
  confidence:         number;
}

/** DI ile gelen kategorik severity haritası — bu dosyada GÖMÜLÜ severity
 *  değeri YOKTUR, tamamen çağırana bağlıdır. */
export interface WeatherSeverityByCondition {
  dry?:      WeatherSeverityOrNone;
  wet?:      WeatherSeverityOrNone;
  snow?:     WeatherSeverityOrNone;
  ice?:      WeatherSeverityOrNone;
  unknown?:  WeatherSeverityOrNone; // ARANMAZ (unknown zaten event-yok) — yalnız tip tamlığı için
}

export interface WeatherRiskPolicyInput {
  severityByCondition: WeatherSeverityByCondition;
}

export interface WeatherRiskInput {
  condition:  WeatherConditionInput;
  policy:     WeatherRiskPolicyInput;
}

/* ── Merkezi isimli sabitler (magic number/magic map YASAK) ──────────────── */

export const WEATHER_RULE_ID = 'weather';

/** `condition.confidence` bu eşiğin ALTINDAYSA olay üretilmez (throw DEĞİL,
 *  sessizce olay yok). Sınırda (`=== eşik`) olay ÜRETİLİR (testle kilitli).
 *  Diğer guardian kurallarındaki AYNI değer, bağımsız sabit. */
const MINIMUM_WEATHER_CONFIDENCE = 0.3;

/** `condition.source` verilmezse kullanılan varsayılan kaynak etiketi. */
const DEFAULT_WEATHER_SOURCE = 'weather-risk-rule';

/** Anayasaya uygun, ihtiyatlı öneri metni — "ani fren" YOK. */
const RECOMMENDED_ACTION_TEXT = 'Kontrollü şekilde sürüşünü sürdür.';

const TITLE_TEXT = 'Yol koşulları dikkat gerektiriyor';

/** Koşul-bazlı İHTİYATLI mesaj metinleri — severity DEĞİL, yalnız açıklama.
 *  `'unknown'` burada YOK (o dal zaten event-yok — mesaj hiç kurulmaz). */
const WEATHER_CONDITION_MESSAGES: Readonly<Record<'dry' | 'wet' | 'snow' | 'ice', string>> = {
  dry:  'Yol kuru görünüyor, normal dikkatle sürüşüne devam et.',
  wet:  'Yol ıslak, tutuş azalabilir.',
  snow: 'Yolda kar var, hız ve mesafeni kontrol et.',
  ice:  'Buzlanma riski, çok dikkatli ol.',
};

/** Geçerli severity token kümesi — `severityByCondition` değerlerini
 *  doğrulamak için (models.ts'ten runtime DEĞER import ETMEDEN — bağımsız
 *  yerel kopya, diğer guardian kurallarındaki izolasyon deseniyle tutarlı). */
const VALID_SEVERITY_TOKENS: ReadonlySet<string> = new Set([
  'INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL', 'NONE',
]);

/* ── Yardımcılar ──────────────────────────────────────────────────────────── */

/** confidence savunmacı clamp — diğer guardian kurallarıyla AYNI davranış
 *  (bağımsız kopya — navigation/guardian dışına import YOK). */
function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function emptyResult(): GuardianRuleResult {
  return { ruleId: WEATHER_RULE_ID, riskEvents: [] };
}

/* ── Doğrulama — SÖZLEŞME/programlama hatası → THROW ─────────────────────────
 * (gerçek-dünya eksik/belirsiz veri — undefined/'unknown'/'NONE'/düşük
 * confidence — buraya GİRMEZ; o durumlar `evaluateWeatherRisk` içinde
 * sessizce boş sonuçla ele alınır.) */
function validateInput(input: WeatherRiskInput): void {
  const condition = input?.condition;
  const policy = input?.policy;

  if (!condition) {
    throw new RangeError('evaluateWeatherRisk: condition zorunludur.');
  }
  if (!Number.isFinite(condition.confidence)) {
    throw new RangeError(`evaluateWeatherRisk: geçersiz condition.confidence (${condition.confidence}) — NaN/Infinity olamaz.`);
  }

  if (!policy || !policy.severityByCondition) {
    throw new RangeError('evaluateWeatherRisk: policy.severityByCondition zorunludur.');
  }

  // Haritada TANIMLI olan her değer geçerli bir token OLMALI (bütünlük —
  // hatayı ilk kullanımda değil, ilk ÇAĞRIDA yakala).
  for (const [key, value] of Object.entries(policy.severityByCondition)) {
    if (value !== undefined && !VALID_SEVERITY_TOKENS.has(value)) {
      throw new RangeError(
        `evaluateWeatherRisk: severityByCondition.${key} geçersiz değer ('${value}') — GuardianSeverity veya 'NONE' olmalı.`,
      );
    }
  }

  // Verilen BİLİNEN koşul (dry/wet/snow/ice) için eşleme ZORUNLU — kritik
  // bir koşul (ör. 'ice') haritada unutulursa SESSİZCE kaybolmasın.
  // 'unknown'/undefined için eşleme ARANMAZ (zaten event-yok dalına düşer).
  const surface = condition.surfaceCondition;
  if (surface !== undefined && surface !== 'unknown') {
    if (policy.severityByCondition[surface] === undefined) {
      throw new RangeError(
        `evaluateWeatherRisk: severityByCondition['${surface}'] için eşleme tanımlı değil — politika eksik (kritik bir koşul sessizce düşmesin).`,
      );
    }
  }
}

/* ── Ana kural ────────────────────────────────────────────────────────────── */

/**
 * TEK giriş noktası. Girdi (`condition`/`policy` ve iç alanları) MUTASYONA
 * UĞRATILMAZ. Aynı girdi her zaman AYNI çıktıyı üretir — `Date.now`/
 * `Math.random`/global durum YOK.
 */
export function evaluateWeatherRisk(input: WeatherRiskInput): GuardianRuleResult {
  validateInput(input);

  const { condition, policy } = input;
  const conditionConfidence = clamp01(condition.confidence);

  // 1) Koşul yok VEYA 'unknown' → olay YOK (hava tahmini/uydurma YASAK).
  const surface = condition.surfaceCondition;
  if (surface === undefined || surface === 'unknown') {
    return emptyResult();
  }

  // 2) Kategorik severity — DI haritasından (validateInput bu anahtarın
  //    tanımlı olduğunu garanti eder). 'NONE' → olay YOK.
  const mappedSeverity = policy.severityByCondition[surface] as WeatherSeverityOrNone;
  if (mappedSeverity === 'NONE') {
    return emptyResult();
  }
  const severity: GuardianSeverity = mappedSeverity;

  // 3) Confidence eşik altındaysa (eksik/güvenilmez tespit) olay YOK.
  if (conditionConfidence < MINIMUM_WEATHER_CONFIDENCE) {
    return emptyResult();
  }

  const source = condition.source ?? DEFAULT_WEATHER_SOURCE;

  const event: GuardianRiskEvent = {
    id:                `${WEATHER_RULE_ID}:${source}:${surface}`, // deterministik
    type:              'WEATHER_RISK',
    severity,
    // Anlık ortam koşulu — "ileride X metrede" gibi bir mesafe kavramı YOK
    // (curve/speed-limit/road-profile'daki segment-mesafeli modelden farklı).
    distanceMeters:    0,
    title:             TITLE_TEXT,
    message:           WEATHER_CONDITION_MESSAGES[surface],
    recommendedAction: RECOMMENDED_ACTION_TEXT,
    confidence:        conditionConfidence, // event conf <= condition conf (burada eşit — üst sınır)
    source,
  };

  return { ruleId: WEATHER_RULE_ID, riskEvents: [event] };
}
