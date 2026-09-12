/**
 * VehicleHealthRule — beşinci Guardian analiz kuralı — GUARDIAN-AI-G6.
 *
 * `curveRiskRule.ts`/`speedLimitRule.ts`/`roadProfileRule.ts`/`weatherRiskRule.ts`
 * deseni izlenir: SAF, deterministik, fail-closed. `guardian/models.ts`teki
 * `GuardianRuleResult` sözleşmesine uyar (`ruleId:'vehicle-health'`) —
 * `guardianEngine.ts`e OTOMATİK bağlanmaz (DI ile gelecek). Gerçek OBD/
 * Bluetooth/CAN/UDS/GPS OKUMA YOK; yalnız `../models` (guardian tipleri) içe
 * aktarılır. Diğer kurallardan HİÇBİR ŞEY import edilmez — her kural bağımsız.
 *
 * ÖNEMLİ FARK (öncekilerden): bu kural TEK bir riskten değil, BİRDEN FAZLA
 * BAĞIMSIZ ARAÇ SİNYALİNDEN beslenir — her AKTİF sinyal (eşik aşıldıysa veya
 * boolean uyarı true ise) KENDİ AYRI `GuardianRiskEvent`ini üretir; hepsi
 * AYNI `GuardianRuleResult.riskEvents[]`te, SABİT deterministik sırayla
 * (coolant → oilPressure → brake → battery → mil → transmission) döner.
 * Önceki kurallar (curve/speed-limit/road-profile/weather) her zaman 0 veya
 * 1 event üretiyordu — bu kural 0..6 arası event üretebilir.
 *
 * ── GÜVENLİK ANAYASASI (mutlak — diğer guardian kurallarıyla AYNI) ──────────
 *   - Direksiyon/fren/gaz kontrolü YOK.
 *   - KESİN TEŞHİS YOK — "motor arızalı" gibi kesin hükümler verilmez, yalnız
 *     "uyarı tespit edildi" türünden ihtiyatlı gözlemler.
 *   - "Motoru hemen durdur" / "Kesin arıza" / "Motor bozulacak" ifadeleri
 *     HİÇBİR event'te YASAK — motor kontrolü sürücüde kalır, panik yaratılmaz.
 *   - Sinyal değeri UYDURULMAZ — bir sinyal `undefined` ise o sinyal için
 *     event ÜRETİLMEZ (eksik veri = "bilinmiyor", "güvenli" DEĞİL).
 *
 * ── FAIL-CLOSED (event-yok, throw DEĞİL) ─────────────────────────────────────
 *   - Her sinyal OPSİYONELDİR — `undefined` olan sinyal için event YOK.
 *   - Numeric sinyal eşik-altı/güvenli bölgedeyse → event YOK.
 *   - Boolean sinyal `false`/`undefined` → event YOK.
 *   - Hiç aktif sinyal yoksa → boş `GuardianRuleResult` (`riskEvents:[]`).
 *
 * ── SEVERITY (eşik YÖNÜNE dikkat — hepsi DI `policy`den, gömülü sayı YOK) ───
 *   - `coolantTemperatureC` (YÜKSEK kötü): `>=thresholds.coolant.critical`
 *     → CRITICAL; `>=thresholds.coolant.high` → HIGH; aksi halde event YOK.
 *   - `oilPressureKpa` (DÜŞÜK kötü): `<=thresholds.oilPressure.critical`
 *     → CRITICAL; `<=thresholds.oilPressure.low` → HIGH; aksi halde event
 *     YOK. (Yalnız İKİ bant: HIGH+CRITICAL — düşük yağ basıncı zaten ciddi
 *     bir sinyaldir, LOW/MEDIUM bandı YOK.)
 *   - `batteryVoltage` (DÜŞÜK kötü): `<=thresholds.batteryVoltage.critical`
 *     → MEDIUM; `<=thresholds.batteryVoltage.low` → LOW; aksi halde event
 *     YOK. (Akü gerilimi düşüklüğü coolant/oil kadar acil DEĞİL — üst sınır
 *     severity MEDIUM'dur, DI politikası bunu belirler.)
 *   - `brakeWarning===true` → `policy.booleanSeverities.brakeWarning`.
 *   - `engineWarningLamp===true` (MIL) → `policy.booleanSeverities.engineWarningLamp`.
 *   - `transmissionWarning===true` → `policy.booleanSeverities.transmissionWarning`.
 */
import type { GuardianRiskEvent, GuardianRuleResult, GuardianSeverity } from '../models';

/* ── Sözleşme ─────────────────────────────────────────────────────────────── */

/** Anlık araç sağlığı sinyalleri — hepsi OPSİYONEL (bilinmeyen sinyal =
 *  event üretmez, "güvenli" ANLAMINA GELMEZ). OBD/CAN/UDS okuma burada YOK;
 *  bu veri zaten normalize edilmiş halde DI ile gelir. */
export interface VehicleHealthSignalsInput {
  coolantTemperatureC?:  number;
  oilPressureKpa?:        number;
  brakeWarning?:          boolean;
  batteryVoltage?:        number;
  engineWarningLamp?:     boolean;
  transmissionWarning?:   boolean;
}

export interface VehicleHealthCoolantThresholds {
  high:      number;
  critical:  number;
}

export interface VehicleHealthOilPressureThresholds {
  low:       number;
  critical:  number;
}

export interface VehicleHealthBatteryVoltageThresholds {
  low:       number;
  critical:  number;
}

/** Sayısal sinyal eşikleri — DI ile gelir, bu dosyada GÖMÜLÜ sayı YOKTUR. */
export interface VehicleHealthThresholds {
  coolant:        VehicleHealthCoolantThresholds;
  oilPressure:    VehicleHealthOilPressureThresholds;
  batteryVoltage: VehicleHealthBatteryVoltageThresholds;
}

/** Boolean sinyaller `true` olduğunda hangi severity'ye eşleneceği — DI ile
 *  gelir, bu dosyada GÖMÜLÜ severity YOKTUR. */
export interface VehicleHealthBooleanSeverities {
  brakeWarning:          GuardianSeverity;
  engineWarningLamp:     GuardianSeverity;
  transmissionWarning:   GuardianSeverity;
}

export interface VehicleHealthPolicyInput {
  thresholds:         VehicleHealthThresholds;
  booleanSeverities:  VehicleHealthBooleanSeverities;
  /** Verilmezse `DEFAULT_HEALTH_CONFIDENCE` kullanılır. Tüm event'ler için
   *  ORTAKTIR (sinyal-bazlı ayrı confidence YOK — Faz A basitliği). */
  signalConfidence?:  number;
}

export interface VehicleHealthRiskInput {
  signals:  VehicleHealthSignalsInput;
  policy:   VehicleHealthPolicyInput;
}

/* ── Merkezi isimli sabitler (magic number/magic map YASAK) ──────────────── */

export const VEHICLE_HEALTH_RULE_ID = 'vehicle-health';

/** `policy.signalConfidence` verilmezse kullanılan varsayılan — araç
 *  sinyalleri (OBD/CAN) genelde yüksek güvenilirliklidir (curve/weather gibi
 *  tahmine dayalı DEĞİL, doğrudan ölçümdür). */
const DEFAULT_HEALTH_CONFIDENCE = 0.9;

/** Tüm event'ler için ortak kaynak etiketi (sinyal bazlı ayrım event id'de). */
const DEFAULT_HEALTH_SOURCE = 'vehicle-health-rule';

/** Anayasaya uygun, ihtiyatlı öneri metni — "hemen durdur"/"kesin arıza" YOK. */
const RECOMMENDED_ACTION_TEXT = 'Güvenli olduğunda aracı kontrol ettirmen önerilir.';

const COOLANT_TITLE       = 'Soğutma sistemi uyarısı';
const OIL_PRESSURE_TITLE  = 'Düşük yağ basıncı';
const BRAKE_TITLE         = 'Fren sistemi uyarısı';
const BATTERY_TITLE       = 'Düşük akü gerilimi';
const MIL_TITLE           = 'Motor arıza lambası';
const TRANSMISSION_TITLE  = 'Şanzıman uyarısı';

const COOLANT_MESSAGE      = 'Motor soğutma sıcaklığı normalin üzerinde görünüyor.';
const OIL_PRESSURE_MESSAGE = 'Yağ basıncı düşük görünüyor.';
const BRAKE_MESSAGE        = 'Fren sisteminde bir uyarı tespit edildi.';
const BATTERY_MESSAGE      = 'Akü gerilimi düşük görünüyor.';
const MIL_MESSAGE          = 'Motor arıza lambası yanıyor.';
const TRANSMISSION_MESSAGE = 'Şanzıman sisteminde bir uyarı tespit edildi.';

/** Geçerli `GuardianSeverity` token kümesi — `booleanSeverities` değerlerini
 *  doğrulamak için (models.ts'ten runtime DEĞER import ETMEDEN — bağımsız
 *  yerel kopya, diğer guardian kurallarındaki izolasyon deseniyle tutarlı).
 *  `weatherRiskRule`in aksine `'NONE'` burada YOK — boolean uyarı true ise
 *  MUTLAKA gerçek bir severity taşımalı (aksi programlama hatası). */
const VALID_SEVERITY_TOKENS: ReadonlySet<string> = new Set([
  'INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL',
]);

/* ── Yardımcılar ──────────────────────────────────────────────────────────── */

/** confidence savunmacı clamp — diğer guardian kurallarıyla AYNI davranış
 *  (bağımsız kopya — navigation/guardian dışına import YOK). */
function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function coolantSeverity(temp: number, t: VehicleHealthCoolantThresholds): GuardianSeverity | null {
  if (temp >= t.critical) return 'CRITICAL';
  if (temp >= t.high)     return 'HIGH';
  return null;
}

function oilPressureSeverity(pressure: number, t: VehicleHealthOilPressureThresholds): GuardianSeverity | null {
  if (pressure <= t.critical) return 'CRITICAL';
  if (pressure <= t.low)      return 'HIGH';
  return null;
}

function batteryVoltageSeverity(voltage: number, t: VehicleHealthBatteryVoltageThresholds): GuardianSeverity | null {
  if (voltage <= t.critical) return 'MEDIUM';
  if (voltage <= t.low)      return 'LOW';
  return null;
}

function makeEvent(
  signalKind: string,
  severity: GuardianSeverity,
  title: string,
  message: string,
  confidence: number,
): GuardianRiskEvent {
  return {
    id:                `${VEHICLE_HEALTH_RULE_ID}:${signalKind}`, // deterministik
    type:              'VEHICLE_HEALTH_RISK',
    severity,
    // Anlık araç durumu — weather gibi "ileride X metrede" mesafe kavramı YOK.
    distanceMeters:    0,
    title,
    message,
    recommendedAction: RECOMMENDED_ACTION_TEXT,
    confidence,
    source:            DEFAULT_HEALTH_SOURCE,
  };
}

/* ── Doğrulama — SÖZLEŞME/programlama hatası → THROW ─────────────────────────
 * (gerçek-dünya eksik/güvenli-bölge sinyal buraya GİRMEZ — o durumlar
 * `evaluateVehicleHealthRisk` içinde sessizce event üretilmeden ele alınır.) */
function validateInput(input: VehicleHealthRiskInput): void {
  const signals = input?.signals;
  const policy  = input?.policy;

  if (!signals) {
    throw new RangeError('evaluateVehicleHealthRisk: signals zorunludur.');
  }
  if (!policy) {
    throw new RangeError('evaluateVehicleHealthRisk: policy zorunludur.');
  }
  if (!policy.thresholds) {
    throw new RangeError('evaluateVehicleHealthRisk: policy.thresholds zorunludur.');
  }
  if (!policy.booleanSeverities) {
    throw new RangeError('evaluateVehicleHealthRisk: policy.booleanSeverities zorunludur.');
  }

  // Sayısal sinyaller — VARSA finite olmalı.
  if (signals.coolantTemperatureC !== undefined && !Number.isFinite(signals.coolantTemperatureC)) {
    throw new RangeError(`evaluateVehicleHealthRisk: geçersiz signals.coolantTemperatureC (${signals.coolantTemperatureC}) — verildiyse NaN/Infinity olamaz.`);
  }
  if (signals.oilPressureKpa !== undefined && !Number.isFinite(signals.oilPressureKpa)) {
    throw new RangeError(`evaluateVehicleHealthRisk: geçersiz signals.oilPressureKpa (${signals.oilPressureKpa}) — verildiyse NaN/Infinity olamaz.`);
  }
  if (signals.batteryVoltage !== undefined && !Number.isFinite(signals.batteryVoltage)) {
    throw new RangeError(`evaluateVehicleHealthRisk: geçersiz signals.batteryVoltage (${signals.batteryVoltage}) — verildiyse NaN/Infinity olamaz.`);
  }

  // Eşikler — finite VE doğru yönde sıralı olmalı.
  const { coolant, oilPressure, batteryVoltage } = policy.thresholds;
  if (!coolant || !Number.isFinite(coolant.high) || !Number.isFinite(coolant.critical)) {
    throw new RangeError(`evaluateVehicleHealthRisk: geçersiz policy.thresholds.coolant (high=${coolant?.high}, critical=${coolant?.critical}) — finite olmalı.`);
  }
  if (!(coolant.high <= coolant.critical)) {
    throw new RangeError(`evaluateVehicleHealthRisk: policy.thresholds.coolant sırası bozuk — high<=critical OLMALI (YÜKSEK kötü) (high=${coolant.high}, critical=${coolant.critical}).`);
  }
  if (!oilPressure || !Number.isFinite(oilPressure.low) || !Number.isFinite(oilPressure.critical)) {
    throw new RangeError(`evaluateVehicleHealthRisk: geçersiz policy.thresholds.oilPressure (low=${oilPressure?.low}, critical=${oilPressure?.critical}) — finite olmalı.`);
  }
  if (!(oilPressure.critical <= oilPressure.low)) {
    throw new RangeError(`evaluateVehicleHealthRisk: policy.thresholds.oilPressure sırası bozuk — critical<=low OLMALI (DÜŞÜK kötü) (low=${oilPressure.low}, critical=${oilPressure.critical}).`);
  }
  if (!batteryVoltage || !Number.isFinite(batteryVoltage.low) || !Number.isFinite(batteryVoltage.critical)) {
    throw new RangeError(`evaluateVehicleHealthRisk: geçersiz policy.thresholds.batteryVoltage (low=${batteryVoltage?.low}, critical=${batteryVoltage?.critical}) — finite olmalı.`);
  }
  if (!(batteryVoltage.critical <= batteryVoltage.low)) {
    throw new RangeError(`evaluateVehicleHealthRisk: policy.thresholds.batteryVoltage sırası bozuk — critical<=low OLMALI (DÜŞÜK kötü) (low=${batteryVoltage.low}, critical=${batteryVoltage.critical}).`);
  }

  // booleanSeverities — üç değer de geçerli GuardianSeverity token'ı olmalı.
  const { brakeWarning, engineWarningLamp, transmissionWarning } = policy.booleanSeverities;
  const booleanSeverityEntries: ReadonlyArray<[string, unknown]> = [
    ['brakeWarning', brakeWarning],
    ['engineWarningLamp', engineWarningLamp],
    ['transmissionWarning', transmissionWarning],
  ];
  for (const [key, value] of booleanSeverityEntries) {
    if (typeof value !== 'string' || !VALID_SEVERITY_TOKENS.has(value)) {
      throw new RangeError(`evaluateVehicleHealthRisk: policy.booleanSeverities.${key} geçersiz değer ('${String(value)}') — GuardianSeverity olmalı.`);
    }
  }

  // signalConfidence — VARSA 0..1 aralığında ve finite olmalı.
  if (policy.signalConfidence !== undefined
      && (!Number.isFinite(policy.signalConfidence) || policy.signalConfidence < 0 || policy.signalConfidence > 1)) {
    throw new RangeError(`evaluateVehicleHealthRisk: geçersiz policy.signalConfidence (${policy.signalConfidence}) — verildiyse 0..1 aralığında olmalı.`);
  }
}

/* ── Ana kural ────────────────────────────────────────────────────────────── */

/**
 * TEK giriş noktası. Girdi (`signals`/`policy` ve iç alanları) MUTASYONA
 * UĞRATILMAZ. Aynı girdi her zaman AYNI çıktıyı üretir — `Date.now`/
 * `Math.random`/global durum YOK. 0'dan 6'ya kadar event üretebilir (her
 * aktif sinyal için en fazla 1), SABİT deterministik sırayla: coolant →
 * oilPressure → brake → battery → mil → transmission.
 */
export function evaluateVehicleHealthRisk(input: VehicleHealthRiskInput): GuardianRuleResult {
  validateInput(input);

  const { signals, policy } = input;
  const confidence = clamp01(policy.signalConfidence ?? DEFAULT_HEALTH_CONFIDENCE);

  const events: GuardianRiskEvent[] = [];

  // 1) coolant (YÜKSEK kötü)
  if (signals.coolantTemperatureC !== undefined) {
    const severity = coolantSeverity(signals.coolantTemperatureC, policy.thresholds.coolant);
    if (severity !== null) {
      events.push(makeEvent('coolant', severity, COOLANT_TITLE, COOLANT_MESSAGE, confidence));
    }
  }

  // 2) oilPressure (DÜŞÜK kötü)
  if (signals.oilPressureKpa !== undefined) {
    const severity = oilPressureSeverity(signals.oilPressureKpa, policy.thresholds.oilPressure);
    if (severity !== null) {
      events.push(makeEvent('oil-pressure', severity, OIL_PRESSURE_TITLE, OIL_PRESSURE_MESSAGE, confidence));
    }
  }

  // 3) brake
  if (signals.brakeWarning === true) {
    events.push(makeEvent('brake', policy.booleanSeverities.brakeWarning, BRAKE_TITLE, BRAKE_MESSAGE, confidence));
  }

  // 4) battery (DÜŞÜK kötü)
  if (signals.batteryVoltage !== undefined) {
    const severity = batteryVoltageSeverity(signals.batteryVoltage, policy.thresholds.batteryVoltage);
    if (severity !== null) {
      events.push(makeEvent('battery', severity, BATTERY_TITLE, BATTERY_MESSAGE, confidence));
    }
  }

  // 5) mil (motor arıza lambası)
  if (signals.engineWarningLamp === true) {
    events.push(makeEvent('mil', policy.booleanSeverities.engineWarningLamp, MIL_TITLE, MIL_MESSAGE, confidence));
  }

  // 6) transmission
  if (signals.transmissionWarning === true) {
    events.push(makeEvent('transmission', policy.booleanSeverities.transmissionWarning, TRANSMISSION_TITLE, TRANSMISSION_MESSAGE, confidence));
  }

  return { ruleId: VEHICLE_HEALTH_RULE_ID, riskEvents: events };
}
