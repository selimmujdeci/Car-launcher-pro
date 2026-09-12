/**
 * SpeedLimitRule — ikinci Guardian analiz kuralı — GUARDIAN-AI-G3.
 *
 * `curveRiskRule.ts` deseni BİREBİR izlenir (`advisorySpeedKph` yerine
 * `postedSpeedLimitKph`): SAF, deterministik, fail-closed. `guardian/models.ts`
 * teki `GuardianRuleResult` sözleşmesine uyar (`ruleId:'speed-limit'`) —
 * `guardianEngine.ts`e OTOMATİK bağlanmaz (DI ile gelecek). GPS/OBD/harita/
 * hava/Mavi/UI/store YOK; yalnız `../models` (guardian tipleri) içe aktarılır.
 * `curveRiskRule.ts`ten de HİÇBİR ŞEY import edilmez — her kural bağımsız
 * (kod tekrarı BİLİNÇLİ: kurallar birbirinden kopuk, biri değişince/silinince
 * diğeri etkilenmez).
 *
 * ── GÜVENLİK ANAYASASI (mutlak — curveRiskRule ile AYNI) ────────────────────
 * Bu bir SÜRÜCÜ DESTEK sistemidir, araç kontrolü DEĞİL:
 *   - Direksiyon/fren/gaz kontrolü YOK.
 *   - "Bu hız KESİN güvenlidir" denmez.
 *   - "Ani fren yap" denmez (CRITICAL'de bile) — yalnız "kontrollü şekilde
 *     hızını azalt" gibi kontrollü öneriler.
 *   - Gerçek limit kaynağı UYDURULMAZ — `postedSpeedLimitKph` yoksa risk
 *     ÜRETİLMEZ.
 *
 * ── FAIL-CLOSED (event-yok, throw DEĞİL) ─────────────────────────────────────
 *   - `segment.postedSpeedLimitKph` yok → olay YOK (limit uydurma YASAK).
 *   - `segment.confidence` < `MINIMUM_SPEED_LIMIT_CONFIDENCE` → olay YOK.
 *   - `vehicle.currentSpeedKph === 0` → olay YOK (bölme-sıfır riski).
 *   - Uyarı penceresi dışı (segment çok uzak) → olay YOK.
 *
 * ── UYARI ZAMANLAMA (curveRiskRule ile AYNI desen) ──────────────────────────
 *   estimatedTimeToSegmentSeconds = distanceMeters / kphToMs(currentSpeedKph)
 * Değerlendirmeye yalnız şu durumda girilir:
 *   estimatedTimeToSegmentSeconds <= policy.warningLeadTimeSeconds
 *   VEYA distanceMeters <= policy.minimumWarningDistanceMeters
 *
 * ── OVERSPEED + SEVERITY (curveRiskRule ile AYNI) ───────────────────────────
 *   overspeedKph   = currentSpeedKph − postedSpeedLimitKph
 *   overspeedRatio = currentSpeedKph / postedSpeedLimitKph
 * FIRE GATE (mutlak tolerans): `overspeedKph <= policy.overspeedToleranceKph`
 * ise olay YOK. Ateşlenirse severity YALNIZ orana göre (bant sınırları
 * aşağıda isimli sabitler — curveRiskRule ile AYNI sayısal değerler, AMA
 * bağımsız kopya).
 */
import type { GuardianRiskEvent, GuardianRuleResult, GuardianSeverity } from '../models';

/* ── Sözleşme ─────────────────────────────────────────────────────────────── */

/** Tespit edilen TEK hız-limiti segmenti. Routing/harita PARSER'ı burada
 *  YOK — bu veri zaten normalize edilmiş halde DI ile gelir. */
export interface SpeedLimitSegmentInput {
  id:                   string;
  distanceMeters:       number;
  /** Risk üretmenin TEK kaynağı — yoksa risk ÜRETİLMEZ (limit UYDURULMAZ). */
  postedSpeedLimitKph?: number;
  /** `postedSpeedLimitKph`in geldiği kaynak (ör. 'osm-maxspeed'). Varsa
   *  üretilen olayın `source` alanına taşınır. */
  source?:              string;
  confidence:           number;
}

export interface SpeedLimitVehicleInput {
  currentSpeedKph: number;
}

export interface SpeedLimitPolicyInput {
  warningLeadTimeSeconds:        number;
  minimumWarningDistanceMeters:  number;
  overspeedToleranceKph:         number;
}

export interface SpeedLimitRiskInput {
  segment:  SpeedLimitSegmentInput;
  vehicle:  SpeedLimitVehicleInput;
  policy:   SpeedLimitPolicyInput;
}

/* ── Merkezi isimli sabitler (magic number YASAK) ────────────────────────── */

export const SPEED_LIMIT_RULE_ID = 'speed-limit';

/** km/s → m/s bölen — yalnız bu dosyada kullanılan yerel sabit (navigation
 *  runtime importu YOK; curveRiskRule'daki AYNI sabitin BAĞIMSIZ kopyası). */
const KMH_TO_MS_DIVISOR = 3.6;

/** `segment.confidence` bu eşiğin ALTINDAYSA olay üretilmez (throw DEĞİL,
 *  sessizce olay yok). Sınırda (`=== eşik`) olay ÜRETİLİR (testle kilitli).
 *  `curveRiskRule.MINIMUM_CURVE_CONFIDENCE` ile AYNI değer, bağımsız sabit. */
const MINIMUM_SPEED_LIMIT_CONFIDENCE = 0.3;

/** Severity oran bantları — `overspeedRatio = currentSpeedKph / postedSpeedLimitKph`. */
const SEVERITY_LOW_MAX_RATIO    = 1.10; // ratio < 1.10  → LOW
const SEVERITY_MEDIUM_MAX_RATIO = 1.25; // ratio < 1.25  → MEDIUM
const SEVERITY_HIGH_MAX_RATIO   = 1.50; // ratio < 1.50  → HIGH; >= 1.50 → CRITICAL

/** `segment.source` verilmezse kullanılan varsayılan kaynak etiketi. */
const DEFAULT_SPEED_LIMIT_SOURCE = 'speed-limit-rule';

/** Anayasaya uygun, ihtiyatlı öneri metni — "ani fren" YOK. */
const RECOMMENDED_ACTION_TEXT = 'Hızını kontrollü şekilde azalt.';

const TITLE_TEXT = 'Hız limiti aşılıyor';

/* ── Yardımcılar (curveRiskRule'daki AYNI mantığın BAĞIMSIZ kopyası) ─────── */

function kphToMs(kph: number): number {
  return kph / KMH_TO_MS_DIVISOR;
}

/** confidence savunmacı clamp — `guardianEngine.clamp01`/`curveRiskRule.clamp01`
 *  ile AYNI davranış (bağımsız kopya — navigation/guardian dışına import YOK). */
function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function severityFromOverspeedRatio(ratio: number): GuardianSeverity {
  if (ratio < SEVERITY_LOW_MAX_RATIO)    return 'LOW';
  if (ratio < SEVERITY_MEDIUM_MAX_RATIO) return 'MEDIUM';
  if (ratio < SEVERITY_HIGH_MAX_RATIO)   return 'HIGH';
  return 'CRITICAL';
}

function emptyResult(): GuardianRuleResult {
  return { ruleId: SPEED_LIMIT_RULE_ID, riskEvents: [] };
}

/* ── Doğrulama — SÖZLEŞME/programlama hatası → THROW ─────────────────────────
 * (gerçek-dünya eksik OPSİYONEL veri buraya GİRMEZ — o durumlar aşağıda
 * `evaluateSpeedLimitRisk` içinde sessizce boş sonuçla ele alınır.) */
function validateInput(input: SpeedLimitRiskInput): void {
  const segment = input?.segment;
  const vehicle = input?.vehicle;
  const policy  = input?.policy;

  if (!segment || typeof segment.id !== 'string' || segment.id.trim() === '') {
    throw new RangeError('evaluateSpeedLimitRisk: segment.id boş olamaz.');
  }
  if (!Number.isFinite(segment.distanceMeters) || segment.distanceMeters < 0) {
    throw new RangeError(`evaluateSpeedLimitRisk: geçersiz segment.distanceMeters (${segment.distanceMeters}) — finite VE >=0 olmalı.`);
  }
  if (segment.postedSpeedLimitKph !== undefined
      && (!Number.isFinite(segment.postedSpeedLimitKph) || segment.postedSpeedLimitKph <= 0)) {
    throw new RangeError(`evaluateSpeedLimitRisk: geçersiz segment.postedSpeedLimitKph (${segment.postedSpeedLimitKph}) — verildiyse finite VE >0 olmalı.`);
  }
  if (!Number.isFinite(segment.confidence)) {
    throw new RangeError(`evaluateSpeedLimitRisk: geçersiz segment.confidence (${segment.confidence}) — NaN/Infinity olamaz.`);
  }

  if (!vehicle || !Number.isFinite(vehicle.currentSpeedKph) || vehicle.currentSpeedKph < 0) {
    throw new RangeError(`evaluateSpeedLimitRisk: geçersiz vehicle.currentSpeedKph (${vehicle?.currentSpeedKph}) — finite VE >=0 olmalı.`);
  }

  if (!policy) {
    throw new RangeError('evaluateSpeedLimitRisk: policy zorunludur.');
  }
  if (!Number.isFinite(policy.overspeedToleranceKph) || policy.overspeedToleranceKph < 0) {
    throw new RangeError(`evaluateSpeedLimitRisk: geçersiz policy.overspeedToleranceKph (${policy.overspeedToleranceKph}) — finite VE >=0 olmalı.`);
  }
  if (!Number.isFinite(policy.warningLeadTimeSeconds) || policy.warningLeadTimeSeconds <= 0) {
    throw new RangeError(`evaluateSpeedLimitRisk: geçersiz policy.warningLeadTimeSeconds (${policy.warningLeadTimeSeconds}) — finite VE >0 olmalı.`);
  }
  if (!Number.isFinite(policy.minimumWarningDistanceMeters) || policy.minimumWarningDistanceMeters < 0) {
    throw new RangeError(`evaluateSpeedLimitRisk: geçersiz policy.minimumWarningDistanceMeters (${policy.minimumWarningDistanceMeters}) — finite VE >=0 olmalı.`);
  }
}

/* ── Ana kural ────────────────────────────────────────────────────────────── */

/**
 * TEK giriş noktası. Girdi (`segment`/`vehicle`/`policy` ve iç alanları)
 * MUTASYONA UĞRATILMAZ. Aynı girdi her zaman AYNI çıktıyı üretir — `Date.now`/
 * `Math.random`/global durum YOK.
 */
export function evaluateSpeedLimitRisk(input: SpeedLimitRiskInput): GuardianRuleResult {
  validateInput(input);

  const { segment, vehicle, policy } = input;
  const segmentConfidence = clamp01(segment.confidence);

  // 1) Posted limit yoksa risk ÜRETİLMEZ (limit uydurma YASAK).
  if (segment.postedSpeedLimitKph === undefined) {
    return emptyResult();
  }
  const postedSpeedLimitKph = segment.postedSpeedLimitKph;

  // 2) Confidence eşik altındaysa (eksik/güvenilmez tespit) olay YOK.
  if (segmentConfidence < MINIMUM_SPEED_LIMIT_CONFIDENCE) {
    return emptyResult();
  }

  // 3) Duran araç → bölme-sıfır riski → olay YOK.
  if (vehicle.currentSpeedKph === 0) {
    return emptyResult();
  }

  // 4) Uyarı penceresi dışı → olay YOK (segment çok uzak).
  const currentSpeedMs = kphToMs(vehicle.currentSpeedKph);
  const estimatedTimeToSegmentSeconds = segment.distanceMeters / currentSpeedMs;
  const withinLeadTime    = estimatedTimeToSegmentSeconds <= policy.warningLeadTimeSeconds;
  const withinMinDistance = segment.distanceMeters <= policy.minimumWarningDistanceMeters;
  if (!withinLeadTime && !withinMinDistance) {
    return emptyResult();
  }

  // 5) Mutlak tolerans GATE'i — küçük mutlak fark oransal büyütülmez.
  const overspeedKph = vehicle.currentSpeedKph - postedSpeedLimitKph;
  if (overspeedKph <= policy.overspeedToleranceKph) {
    return emptyResult();
  }

  // 6) Severity YALNIZ orana göre.
  const overspeedRatio = vehicle.currentSpeedKph / postedSpeedLimitKph;
  const severity = severityFromOverspeedRatio(overspeedRatio);

  const event: GuardianRiskEvent = {
    id:                `${SPEED_LIMIT_RULE_ID}:${segment.id}`, // deterministik
    type:              'SPEED_LIMIT_RISK',
    severity,
    distanceMeters:    segment.distanceMeters,
    title:             TITLE_TEXT,
    message:           `İlerideki hız limiti ${postedSpeedLimitKph} km/s.`,
    recommendedAction: RECOMMENDED_ACTION_TEXT,
    confidence:        segmentConfidence, // event conf <= segment conf (burada eşit — üst sınır)
    source:            segment.source ?? DEFAULT_SPEED_LIMIT_SOURCE,
  };

  return { ruleId: SPEED_LIMIT_RULE_ID, riskEvents: [event] };
}
