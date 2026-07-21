/**
 * DriverFatigueRule — yedinci Guardian analiz kuralı — GUARDIAN-AI-G8.
 *
 * `vehicleHealthRule.ts` çoklu-event desenini izler: SAF, deterministik,
 * fail-closed, immutable, DI-only. `guardian/models.ts`teki `GuardianRuleResult`
 * sözleşmesine uyar (`ruleId:'driver-fatigue'`, `type:'DRIVER_FATIGUE_RISK'` —
 * model ZATEN mevcut, EKLEME YOK) — `guardianEngine.ts`e OTOMATİK bağlanmaz
 * (DI ile gelecek). Kamera/göz-takibi/yüz-tanıma/mikro-uyku-modeli/telefon-
 * sensörü/GPS/OBD/CAN/harita/internet/SİSTEM-SAATİ OKUMA YOK; yalnız `../models`
 * (guardian tipleri) içe aktarılır. Diğer kurallardan HİÇBİR ŞEY import edilmez.
 *
 * ÇOKLU-EVENT (vehicleHealthRule gibi): 0..7 bağımsız yorgunluk/dikkat göstergesi;
 * her AKTİF gösterge KENDİ AYRI `GuardianRiskEvent`ini üretir; hepsi AYNI
 * `GuardianRuleResult.riskEvents[]`te, SABİT deterministik sırayla:
 *   1) continuous-driving  2) break-overdue  3) long-trip  4) night-driving
 *   5) low-attention       6) lane-correction 7) microsleep-suspected
 *
 * ── GÜVENLİK ANAYASASI (mutlak) ─────────────────────────────────────────────
 *   - KESİN TEŞHİS YOK — "sürücü yorgun/uyuyor/kaza yapacak" gibi kesin hüküm
 *     VERİLMEZ; yalnız "…görünüyor / …sinyal alındı" türü ihtiyatlı gözlemler.
 *   - CRITICAL event'lerde bile EMİR DİLİ YOK ("hemen dur"/"kenara çek" yasak).
 *   - Sinyal UYDURULMAZ — bir gösterge yoksa (undefined / eşik-altı / boolean
 *     false) o gösterge için event ÜRETİLMEZ (eksik veri = "bilinmiyor").
 *   - Çıkarım YOK: "gözler kapandı"/"sürücü uyudu"/"kesin dikkat kaybı" gibi
 *     ham-sinyalden teşhis türetme YASAK.
 *
 * ── FAIL-CLOSED (event-yok, throw DEĞİL) ─────────────────────────────────────
 *   - Numeric gösterge undefined / eşik-altı → o gösterge için event YOK.
 *   - Boolean gösterge false / undefined → event YOK.
 *   - localHour gece penceresi dışında → night event YOK.
 *   - `confidence` VE `minimumConfidence` İKİSİ DE verilmiş VE
 *     `confidence < minimumConfidence` ise → TÜM kural boş sonuç döner.
 *   - Hiç aktif gösterge yoksa → boş `riskEvents:[]`.
 *
 * ── SEVERITY (hepsi DI `policy`den — gömülü sayı/severity YOK) ───────────────
 *   - continuousDrivingMinutes: >=critical CRITICAL / >=high HIGH / >=elevated
 *     MEDIUM / aksi event-yok.
 *   - minutesSinceLastMeaningfulBreak: aynı (CRITICAL/HIGH/MEDIUM).
 *   - tripDurationMinutes: >=critical HIGH / >=high MEDIUM / >=elevated LOW /
 *     aksi event-yok. (TEK BAŞINA CRITICAL ÜRETMEZ — üst bant HIGH'dır.)
 *   - night-driving: localHour, `policy.nightDriving` penceresindeyse (startHour
 *     DAHİL, endHour HARİÇ; pencere gece-yarısını aşabilir) → nightDriving.severity.
 *   - boolean göstergeler true → `policy.booleanSeverities.*`.
 */
import type { GuardianRiskEvent, GuardianRuleResult, GuardianSeverity } from '../models';

/* ── Sözleşme ─────────────────────────────────────────────────────────────── */

/** Anlık sürücü yorgunluğu/dikkat göstergeleri — hepsi OPSİYONEL (bilinmeyen
 *  gösterge = event üretmez, "dinç/dikkatli" ANLAMINA GELMEZ). Kamera/sensör/
 *  saat okuma burada YOK; bu veri zaten normalize edilmiş halde DI ile gelir. */
export interface DriverFatigueSignalsInput {
  continuousDrivingMinutes?:        number;
  minutesSinceLastMeaningfulBreak?: number;
  tripDurationMinutes?:             number;
  /** DI ile gelen yerel saat (0..23 tam sayı) — sistem saati/timezone OKUNMAZ. */
  localHour?:                       number;
  lowAttentionSignal?:              boolean;
  repeatedLaneCorrectionSignal?:    boolean;
  microsleepSuspectedSignal?:       boolean;
  /** DI güven değeri (0..1). Verilmezse gate uygulanmaz; event'e taşınırken
   *  `DEFAULT_FATIGUE_CONFIDENCE` yer tutucusu kullanılır (yeni bir confidence
   *  HESAPLANMAZ — yalnız event sözleşmesi `number` gerektirdiği için). */
  confidence?:                      number;
}

/** Üç kademeli süre eşiği (dakika) — sıra STRICT: elevated < high < critical. */
export interface DriverFatigueTierThresholds {
  elevatedMinutes:  number;
  highMinutes:      number;
  criticalMinutes:  number;
}

/** Gece sürüşü penceresi — startHour DAHİL, endHour HARİÇ; gece-yarısını
 *  aşabilir (startHour>endHour). startHour===endHour → programlama hatası. */
export interface DriverFatigueNightDrivingPolicy {
  startHour:  number;
  endHour:    number;
  severity:   GuardianSeverity;
}

/** Boolean göstergeler `true` olduğunda hangi severity'ye eşleneceği — DI ile
 *  gelir, bu dosyada GÖMÜLÜ severity YOKTUR. */
export interface DriverFatigueBooleanSeverities {
  lowAttentionSignal:           GuardianSeverity;
  repeatedLaneCorrectionSignal: GuardianSeverity;
  microsleepSuspectedSignal:    GuardianSeverity;
}

export interface DriverFatigueThresholds {
  continuousDriving: DriverFatigueTierThresholds;
  breakAge:          DriverFatigueTierThresholds;
  tripDuration:      DriverFatigueTierThresholds;
}

export interface DriverFatiguePolicyInput {
  thresholds:         DriverFatigueThresholds;
  nightDriving:       DriverFatigueNightDrivingPolicy;
  booleanSeverities:  DriverFatigueBooleanSeverities;
  /** Verilmişse VE signals.confidence de verilmişse fail-closed gate için
   *  kullanılır (confidence < minimumConfidence → tüm sonuç boş). */
  minimumConfidence?: number;
}

export interface DriverFatigueRiskInput {
  signals:  DriverFatigueSignalsInput;
  policy:   DriverFatiguePolicyInput;
}

/* ── Merkezi isimli sabitler (magic number/magic map YASAK) ──────────────── */

export const DRIVER_FATIGUE_RULE_ID = 'driver-fatigue';

/** signals.confidence verilmediğinde event'e taşınacak NÖTR yer tutucu —
 *  göstergelerden TÜRETİLMİŞ bir güven DEĞİLDİR; yalnız `GuardianRiskEvent.
 *  confidence` alanı `number` zorunlu olduğu için. Diğer kurallarla tutarlı. */
const DEFAULT_FATIGUE_CONFIDENCE = 0.9;

/** Tüm event'ler için ortak kaynak etiketi (gösterge ayrımı event id'de). */
const DEFAULT_FATIGUE_SOURCE = 'driver-fatigue-rule';

/** Anayasaya uygun, ihtiyatlı öneri metni — emir dili YOK. Tüm event'lerde ortak. */
const RECOMMENDED_ACTION_TEXT = 'Güvenli ve uygun bir yerde kısa bir mola vermen önerilir.';

/** En küçük geçerli saat / en büyük geçerli saat (0..23) — tekrarları önlemek
 *  için isimli sabit. */
const MIN_HOUR = 0;
const MAX_HOUR = 23;

const CONTINUOUS_TITLE   = 'Uzun süreli sürüş uyarısı';
const CONTINUOUS_MESSAGE = 'Kesintisiz sürüş süresi uzamış görünüyor.';
const BREAK_TITLE        = 'Mola önerisi';
const BREAK_MESSAGE      = 'Son anlamlı molanın üzerinden uzun süre geçmiş görünüyor.';
const TRIP_TITLE         = 'Uzun yolculuk uyarısı';
const TRIP_MESSAGE       = 'Toplam yolculuk süresi uzamış görünüyor.';
const NIGHT_TITLE        = 'Gece sürüşü uyarısı';
const NIGHT_MESSAGE      = 'Gece saatlerinde sürüş dikkat ihtiyacını artırabilir.';
const LOW_ATTENTION_TITLE   = 'Dikkat seviyesi uyarısı';
const LOW_ATTENTION_MESSAGE = 'Dikkat seviyesinde azalma olabileceğine dair bir sinyal alındı.';
const LANE_TITLE         = 'Sürüş düzeni uyarısı';
const LANE_MESSAGE       = 'Tekrarlanan şerit düzeltmeleri bildirildi.';
const MICROSLEEP_TITLE   = 'Ciddi dikkat uyarısı';
const MICROSLEEP_MESSAGE = 'Kısa süreli dikkat kaybı olasılığına dair bir sinyal alındı.';

/** Geçerli `GuardianSeverity` token kümesi — `'NONE'` DAHİL DEĞİL (night/boolean
 *  severity'leri MUTLAKA gerçek bir severity taşımalı; aksi programlama hatası).
 *  models.ts'ten runtime DEĞER import ETMEDEN bağımsız yerel kopya. */
const VALID_SEVERITY_TOKENS: ReadonlySet<string> = new Set([
  'INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL',
]);

/* ── Yardımcılar ──────────────────────────────────────────────────────────── */

/** confidence savunmacı clamp — diğer guardian kurallarıyla AYNI davranış. */
function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function isValidHour(h: number): boolean {
  return Number.isInteger(h) && h >= MIN_HOUR && h <= MAX_HOUR;
}

/** continuous/break bandı (YÜKSEK kötü): CRITICAL/HIGH/MEDIUM/null. */
function tierSeverityCriticalCapped(minutes: number, t: DriverFatigueTierThresholds): GuardianSeverity | null {
  if (minutes >= t.criticalMinutes) return 'CRITICAL';
  if (minutes >= t.highMinutes)     return 'HIGH';
  if (minutes >= t.elevatedMinutes) return 'MEDIUM';
  return null;
}

/** trip-duration bandı: üst sınır HIGH (tek başına CRITICAL ÜRETMEZ). */
function tripTierSeverity(minutes: number, t: DriverFatigueTierThresholds): GuardianSeverity | null {
  if (minutes >= t.criticalMinutes) return 'HIGH';
  if (minutes >= t.highMinutes)     return 'MEDIUM';
  if (minutes >= t.elevatedMinutes) return 'LOW';
  return null;
}

/** Gece penceresi içinde mi? startHour DAHİL, endHour HARİÇ; gece-yarısını
 *  aşabilir. (startHour===endHour validateInput'ta throw edilir, buraya gelmez.) */
function isWithinNightWindow(hour: number, startHour: number, endHour: number): boolean {
  if (startHour < endHour) {
    // Normal pencere (ör. 1→5): [start, end)
    return hour >= startHour && hour < endHour;
  }
  // Gece-yarısını aşan pencere (ör. 22→6): [start,24) ∪ [0,end)
  return hour >= startHour || hour < endHour;
}

function makeEvent(
  signalKind: string,
  severity: GuardianSeverity,
  title: string,
  message: string,
  confidence: number,
): GuardianRiskEvent {
  return {
    id:                `${DRIVER_FATIGUE_RULE_ID}:${signalKind}`, // deterministik
    type:              'DRIVER_FATIGUE_RISK',
    severity,
    // Anlık sürücü durumu — rota üzerinde "ileride X metrede" mesafe kavramı YOK.
    distanceMeters:    0,
    title,
    message,
    recommendedAction: RECOMMENDED_ACTION_TEXT,
    confidence,
    source:            DEFAULT_FATIGUE_SOURCE,
  };
}

/* ── Doğrulama — SÖZLEŞME/programlama hatası → THROW ─────────────────────────
 * (gerçek-dünya eksik/eşik-altı/false sinyal buraya GİRMEZ — o durumlar
 * `evaluateDriverFatigueRisk` içinde sessizce event üretilmeden ele alınır.) */
function validateTierOrder(name: string, t: DriverFatigueTierThresholds): void {
  const values: ReadonlyArray<[string, number]> = [
    ['elevatedMinutes', t?.elevatedMinutes],
    ['highMinutes', t?.highMinutes],
    ['criticalMinutes', t?.criticalMinutes],
  ];
  for (const [key, value] of values) {
    if (!Number.isFinite(value) || value < 0) {
      throw new RangeError(`evaluateDriverFatigueRisk: geçersiz thresholds.${name}.${key} (${value}) — finite ve negatif-olmayan olmalı.`);
    }
  }
  if (!(t.elevatedMinutes < t.highMinutes && t.highMinutes < t.criticalMinutes)) {
    throw new RangeError(`evaluateDriverFatigueRisk: thresholds.${name} sırası bozuk — elevated<high<critical OLMALI (elevated=${t.elevatedMinutes}, high=${t.highMinutes}, critical=${t.criticalMinutes}).`);
  }
}

function validateNonNegativeMinutes(name: string, value: number | undefined): void {
  if (value === undefined) return;
  if (!Number.isFinite(value)) {
    throw new RangeError(`evaluateDriverFatigueRisk: geçersiz signals.${name} (${value}) — verildiyse NaN/Infinity olamaz.`);
  }
  if (value < 0) {
    throw new RangeError(`evaluateDriverFatigueRisk: geçersiz signals.${name} (${value}) — süre negatif olamaz.`);
  }
}

function validateInput(input: DriverFatigueRiskInput): void {
  const signals = input?.signals;
  const policy  = input?.policy;

  if (!signals) {
    throw new RangeError('evaluateDriverFatigueRisk: signals zorunludur.');
  }
  if (!policy) {
    throw new RangeError('evaluateDriverFatigueRisk: policy zorunludur.');
  }
  if (!policy.thresholds) {
    throw new RangeError('evaluateDriverFatigueRisk: policy.thresholds zorunludur.');
  }
  if (!policy.nightDriving) {
    throw new RangeError('evaluateDriverFatigueRisk: policy.nightDriving zorunludur.');
  }
  if (!policy.booleanSeverities) {
    throw new RangeError('evaluateDriverFatigueRisk: policy.booleanSeverities zorunludur.');
  }

  // Süre sinyalleri — VARSA finite ve negatif-olmayan.
  validateNonNegativeMinutes('continuousDrivingMinutes', signals.continuousDrivingMinutes);
  validateNonNegativeMinutes('minutesSinceLastMeaningfulBreak', signals.minutesSinceLastMeaningfulBreak);
  validateNonNegativeMinutes('tripDurationMinutes', signals.tripDurationMinutes);

  // localHour — VARSA integer 0..23.
  if (signals.localHour !== undefined && !isValidHour(signals.localHour)) {
    throw new RangeError(`evaluateDriverFatigueRisk: geçersiz signals.localHour (${signals.localHour}) — 0..23 tam sayı olmalı.`);
  }

  // Eşik üçlüleri — finite, negatif-olmayan, STRICT artan.
  validateTierOrder('continuousDriving', policy.thresholds.continuousDriving);
  validateTierOrder('breakAge', policy.thresholds.breakAge);
  validateTierOrder('tripDuration', policy.thresholds.tripDuration);

  // Gece penceresi — startHour/endHour integer 0..23 ve farklı.
  const { startHour, endHour, severity: nightSeverity } = policy.nightDriving;
  if (!isValidHour(startHour)) {
    throw new RangeError(`evaluateDriverFatigueRisk: geçersiz nightDriving.startHour (${startHour}) — 0..23 tam sayı olmalı.`);
  }
  if (!isValidHour(endHour)) {
    throw new RangeError(`evaluateDriverFatigueRisk: geçersiz nightDriving.endHour (${endHour}) — 0..23 tam sayı olmalı.`);
  }
  if (startHour === endHour) {
    throw new RangeError(`evaluateDriverFatigueRisk: nightDriving.startHour === endHour (${startHour}) — pencere sıfır/tam-gün belirsiz, geçersiz.`);
  }

  // Severity token'ları — night + üç boolean.
  const severityEntries: ReadonlyArray<[string, unknown]> = [
    ['nightDriving.severity', nightSeverity],
    ['booleanSeverities.lowAttentionSignal', policy.booleanSeverities.lowAttentionSignal],
    ['booleanSeverities.repeatedLaneCorrectionSignal', policy.booleanSeverities.repeatedLaneCorrectionSignal],
    ['booleanSeverities.microsleepSuspectedSignal', policy.booleanSeverities.microsleepSuspectedSignal],
  ];
  for (const [key, value] of severityEntries) {
    if (typeof value !== 'string' || !VALID_SEVERITY_TOKENS.has(value)) {
      throw new RangeError(`evaluateDriverFatigueRisk: policy.${key} geçersiz değer ('${String(value)}') — GuardianSeverity olmalı.`);
    }
  }

  // Confidence'lar — VARSA finite 0..1.
  if (policy.minimumConfidence !== undefined
      && (!Number.isFinite(policy.minimumConfidence) || policy.minimumConfidence < 0 || policy.minimumConfidence > 1)) {
    throw new RangeError(`evaluateDriverFatigueRisk: geçersiz policy.minimumConfidence (${policy.minimumConfidence}) — verildiyse 0..1 aralığında olmalı.`);
  }
  if (signals.confidence !== undefined
      && (!Number.isFinite(signals.confidence) || signals.confidence < 0 || signals.confidence > 1)) {
    throw new RangeError(`evaluateDriverFatigueRisk: geçersiz signals.confidence (${signals.confidence}) — verildiyse 0..1 aralığında olmalı.`);
  }
}

/* ── Ana kural ────────────────────────────────────────────────────────────── */

/**
 * TEK giriş noktası. Girdi MUTASYONA UĞRATILMAZ. Aynı girdi her zaman AYNI
 * çıktıyı üretir — `Date.now`/`new Date`/`Math.random`/global durum/sistem
 * saati/timezone YOK. 0'dan 7'ye kadar event üretebilir (her aktif gösterge
 * için en fazla 1), SABİT deterministik sırayla.
 */
export function evaluateDriverFatigueRisk(input: DriverFatigueRiskInput): GuardianRuleResult {
  validateInput(input);

  const { signals, policy } = input;

  // Confidence gate — YALNIZCA ikisi de verilmişse uygulanır.
  if (signals.confidence !== undefined
      && policy.minimumConfidence !== undefined
      && signals.confidence < policy.minimumConfidence) {
    return { ruleId: DRIVER_FATIGUE_RULE_ID, riskEvents: [] };
  }

  const confidence = clamp01(signals.confidence ?? DEFAULT_FATIGUE_CONFIDENCE);
  const events: GuardianRiskEvent[] = [];

  // 1) continuous-driving
  if (signals.continuousDrivingMinutes !== undefined) {
    const severity = tierSeverityCriticalCapped(signals.continuousDrivingMinutes, policy.thresholds.continuousDriving);
    if (severity !== null) {
      events.push(makeEvent('continuous-driving', severity, CONTINUOUS_TITLE, CONTINUOUS_MESSAGE, confidence));
    }
  }

  // 2) break-overdue
  if (signals.minutesSinceLastMeaningfulBreak !== undefined) {
    const severity = tierSeverityCriticalCapped(signals.minutesSinceLastMeaningfulBreak, policy.thresholds.breakAge);
    if (severity !== null) {
      events.push(makeEvent('break-overdue', severity, BREAK_TITLE, BREAK_MESSAGE, confidence));
    }
  }

  // 3) long-trip (CRITICAL üretmez)
  if (signals.tripDurationMinutes !== undefined) {
    const severity = tripTierSeverity(signals.tripDurationMinutes, policy.thresholds.tripDuration);
    if (severity !== null) {
      events.push(makeEvent('long-trip', severity, TRIP_TITLE, TRIP_MESSAGE, confidence));
    }
  }

  // 4) night-driving
  if (signals.localHour !== undefined
      && isWithinNightWindow(signals.localHour, policy.nightDriving.startHour, policy.nightDriving.endHour)) {
    events.push(makeEvent('night-driving', policy.nightDriving.severity, NIGHT_TITLE, NIGHT_MESSAGE, confidence));
  }

  // 5) low-attention
  if (signals.lowAttentionSignal === true) {
    events.push(makeEvent('low-attention', policy.booleanSeverities.lowAttentionSignal, LOW_ATTENTION_TITLE, LOW_ATTENTION_MESSAGE, confidence));
  }

  // 6) lane-correction
  if (signals.repeatedLaneCorrectionSignal === true) {
    events.push(makeEvent('lane-correction', policy.booleanSeverities.repeatedLaneCorrectionSignal, LANE_TITLE, LANE_MESSAGE, confidence));
  }

  // 7) microsleep-suspected
  if (signals.microsleepSuspectedSignal === true) {
    events.push(makeEvent('microsleep-suspected', policy.booleanSeverities.microsleepSuspectedSignal, MICROSLEEP_TITLE, MICROSLEEP_MESSAGE, confidence));
  }

  return { ruleId: DRIVER_FATIGUE_RULE_ID, riskEvents: events };
}
