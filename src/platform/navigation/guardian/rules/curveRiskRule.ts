/**
 * CurveRiskRule — ilk gerçek Guardian analiz kuralı — GUARDIAN-AI-G2.
 *
 * SAF, deterministik, fail-closed. `guardian/models.ts`teki `GuardianRuleResult`
 * sözleşmesine uyar (`ruleId:'curve-risk'`) — `guardianEngine.ts`e OTOMATİK
 * bağlanmaz (DI ile gelecek). GPS/OBD/harita/hava/Mavi/UI/store YOK; yalnız
 * `../models` (guardian tipleri) içe aktarılır.
 *
 * ── GÜVENLİK ANAYASASI (mutlak) ─────────────────────────────────────────────
 * Bu bir SÜRÜCÜ DESTEK sistemidir, araç kontrolü DEĞİL:
 *   - Direksiyon/fren/gaz kontrolü YOK.
 *   - "Bu hız KESİN güvenlidir" denmez — yalnız "önerilen hızın üzerinde" gibi
 *     ihtiyatlı, açıklanabilir ifadeler kullanılır.
 *   - "Ani fren yap" denmez (CRITICAL'de bile) — yalnız "kontrollü şekilde
 *     hızını azalt" gibi kontrollü öneriler.
 *   - `radiusMeters`ten sahte hassas bir "güvenli hız" TÜRETİLMEZ — G2'de
 *     YALNIZ dışarıdan verilen `advisorySpeedKph` kullanılır (bkz. aşağı).
 *   - Eksik fiziksel koşul (yüzey/eğim/görüş) UYDURULMAZ — `road` bu sürümde
 *     hiç OKUNMAZ (G2B'ye bırakıldı).
 *
 * ── ADVISORY SPEED KAYNAK ÖNCELİĞİ ──────────────────────────────────────────
 * G2'de YALNIZ `curve.advisorySpeedKph` kullanılır. Bu alan yoksa risk
 * ÜRETİLMEZ (boş `GuardianRuleResult`). `curve.radiusMeters` sözleşmede
 * TAŞINIR (gelecekteki G2B geometry-tabanlı modeli için) AMA bu dosyada HİÇ
 * OKUNMAZ — fizik-tabanlı bir "güvenli hız" modeli kurmak bu görevin KAPSAMI
 * DIŞINDADIR ve "radius'tan sahte hassas hız üretme" anayasa maddesini ihlal
 * eder.
 *
 * ── UYARI ZAMANLAMA (fail-closed) ───────────────────────────────────────────
 * `vehicle.currentSpeedKph === 0` → olay YOK (bölme-sıfır riski + duran araç
 * için "yaklaşan viraj" anlamsız). Aksi halde:
 *   estimatedTimeToCurveSeconds = distanceMeters / kphToMs(currentSpeedKph)
 * Değerlendirmeye yalnız şu durumda girilir:
 *   estimatedTimeToCurveSeconds <= policy.warningLeadTimeSeconds
 *   VEYA distanceMeters <= policy.minimumWarningDistanceMeters
 * İkisi de sağlanmıyorsa (viraj çok uzak) → olay YOK.
 *
 * ── OVERSPEED + SEVERITY ────────────────────────────────────────────────────
 *   overspeedKph   = currentSpeedKph − advisorySpeedKph
 *   overspeedRatio = currentSpeedKph / advisorySpeedKph
 * FIRE GATE (mutlak tolerans): `overspeedKph <= policy.overspeedToleranceKph`
 * ise olay YOK — küçük advisory hızlarda (ör. 10 km/s) küçük mutlak farkın
 * oransal olarak büyük görünmesi yanlış alarm üretmesin diye tolerans MUTLAK
 * km/s cinsindendir, oran cinsinden DEĞİL.
 * Olay ateşlenirse severity YALNIZ `overspeedRatio`ya göre (bant sınırları
 * aşağıda isimli sabitler).
 */
import type { GuardianRiskEvent, GuardianRuleResult, GuardianSeverity } from '../models';

/* ── Sözleşme ─────────────────────────────────────────────────────────────── */

export type CurveDirection = 'left' | 'right' | 'unknown';
export type RoadSurfaceCondition = 'dry' | 'wet' | 'snow' | 'ice' | 'unknown';

/** Tespit edilen TEK viraj. Routing/geometri PARSER'ı burada YOK — bu veri
 *  zaten normalize edilmiş halde DI ile gelir. */
export interface CurveRiskCurveInput {
  id:                    string;
  distanceMeters:        number;
  direction:             CurveDirection;
  /** G2'de risk üretmenin TEK kaynağı — yoksa risk ÜRETİLMEZ. */
  advisorySpeedKph?:      number;
  /** `advisorySpeedKph`in geldiği kaynak (ör. 'osm-maxspeed-advisory'). Varsa
   *  üretilen olayın `source` alanına taşınır. */
  advisorySpeedSource?:   string;
  /** Sözleşmede TAŞINIR (gelecekteki G2B geometry modeli için) — G2'de HİÇ
   *  OKUNMAZ (radius'tan hız türetme YASAK). */
  radiusMeters?:          number;
  confidence:             number;
}

export interface CurveRiskVehicleInput {
  currentSpeedKph: number;
}

/** G2'de KULLANILMAZ (yüzey ayarlaması G2B'ye bırakıldı) — sözleşmede
 *  opsiyonel olarak durur, ileride genişletilebilsin diye. */
export interface CurveRiskRoadInput {
  surfaceCondition?: RoadSurfaceCondition;
}

export interface CurveRiskPolicyInput {
  warningLeadTimeSeconds:        number;
  minimumWarningDistanceMeters:  number;
  overspeedToleranceKph:         number;
}

export interface CurveRiskInput {
  curve:    CurveRiskCurveInput;
  vehicle:  CurveRiskVehicleInput;
  road?:    CurveRiskRoadInput;
  policy:   CurveRiskPolicyInput;
}

/* ── Merkezi isimli sabitler (magic number YASAK) ────────────────────────── */

export const CURVE_RISK_RULE_ID = 'curve-risk';

/** km/s → m/s bölen — yalnız bu dosyada kullanılan yerel sabit (navigation
 *  runtime importu YOK). */
const KMH_TO_MS_DIVISOR = 3.6;

/** `curve.confidence` bu eşiğin ALTINDAYSA olay üretilmez — "eksik/güvenilmez
 *  tespit" fail-closed'a düşer (throw DEĞİL, sessizce olay yok). Sınırda
 *  (`=== eşik`) olay ÜRETİLİR (testle kilitli). */
const MINIMUM_CURVE_CONFIDENCE = 0.3;

/** Severity oran bantları — `overspeedRatio = currentSpeedKph / advisorySpeedKph`. */
const SEVERITY_LOW_MAX_RATIO    = 1.10; // ratio < 1.10  → LOW
const SEVERITY_MEDIUM_MAX_RATIO = 1.25; // ratio < 1.25  → MEDIUM
const SEVERITY_HIGH_MAX_RATIO   = 1.50; // ratio < 1.50  → HIGH; >= 1.50 → CRITICAL

/** `curve.advisorySpeedSource` verilmezse kullanılan varsayılan kaynak etiketi. */
const DEFAULT_ADVISORY_SOURCE = 'curve-risk-rule';

/** Anayasaya uygun, ihtiyatlı öneri metni — "ani fren" YOK, kontrol devri
 *  sürücüde kalır. */
const RECOMMENDED_ACTION_TEXT = 'Viraja yaklaşırken kontrollü şekilde hızını azalt.';

const TITLE_TEXT = 'Keskin viraj yaklaşıyor';

const DIRECTION_PHRASE_TR: Readonly<Record<'left' | 'right', string>> = {
  left:  'sola',
  right: 'sağa',
};

/* ── Yardımcılar ──────────────────────────────────────────────────────────── */

function kphToMs(kph: number): number {
  return kph / KMH_TO_MS_DIVISOR;
}

/** confidence savunmacı clamp — `guardianEngine.clamp01` ile AYNI davranış
 *  (bağımsız kopya — navigation/guardian dışına import YOK). */
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
  return { ruleId: CURVE_RISK_RULE_ID, riskEvents: [] };
}

function buildMessage(curve: CurveRiskCurveInput, advisorySpeedKph: number): string {
  const directionPart = curve.direction === 'unknown'
    ? ''
    : ` (${DIRECTION_PHRASE_TR[curve.direction]} dönüş)`;
  return (
    `Mevcut hızın, bu viraj için önerilen hızın üzerinde${directionPart}. ` +
    `Önerilen yaklaşım hızı yaklaşık ${advisorySpeedKph} km/s.`
  );
}

/* ── Doğrulama — SÖZLEŞME/programlama hatası → THROW ─────────────────────────
 * (gerçek-dünya eksik OPSİYONEL veri buraya GİRMEZ — o durumlar aşağıda
 * `evaluateCurveRisk` içinde sessizce boş sonuçla ele alınır.) */
function validateInput(input: CurveRiskInput): void {
  const curve = input?.curve;
  const vehicle = input?.vehicle;
  const policy = input?.policy;

  if (!curve || typeof curve.id !== 'string' || curve.id.trim() === '') {
    throw new RangeError('evaluateCurveRisk: curve.id boş olamaz.');
  }
  if (!Number.isFinite(curve.distanceMeters) || curve.distanceMeters < 0) {
    throw new RangeError(`evaluateCurveRisk: geçersiz curve.distanceMeters (${curve.distanceMeters}) — finite VE >=0 olmalı.`);
  }
  if (curve.advisorySpeedKph !== undefined
      && (!Number.isFinite(curve.advisorySpeedKph) || curve.advisorySpeedKph <= 0)) {
    throw new RangeError(`evaluateCurveRisk: geçersiz curve.advisorySpeedKph (${curve.advisorySpeedKph}) — verildiyse finite VE >0 olmalı.`);
  }
  if (!Number.isFinite(curve.confidence)) {
    throw new RangeError(`evaluateCurveRisk: geçersiz curve.confidence (${curve.confidence}) — NaN/Infinity olamaz.`);
  }

  if (!vehicle || !Number.isFinite(vehicle.currentSpeedKph) || vehicle.currentSpeedKph < 0) {
    throw new RangeError(`evaluateCurveRisk: geçersiz vehicle.currentSpeedKph (${vehicle?.currentSpeedKph}) — finite VE >=0 olmalı.`);
  }

  if (!policy) {
    throw new RangeError('evaluateCurveRisk: policy zorunludur.');
  }
  if (!Number.isFinite(policy.overspeedToleranceKph) || policy.overspeedToleranceKph < 0) {
    throw new RangeError(`evaluateCurveRisk: geçersiz policy.overspeedToleranceKph (${policy.overspeedToleranceKph}) — finite VE >=0 olmalı.`);
  }
  if (!Number.isFinite(policy.warningLeadTimeSeconds) || policy.warningLeadTimeSeconds <= 0) {
    throw new RangeError(`evaluateCurveRisk: geçersiz policy.warningLeadTimeSeconds (${policy.warningLeadTimeSeconds}) — finite VE >0 olmalı.`);
  }
  if (!Number.isFinite(policy.minimumWarningDistanceMeters) || policy.minimumWarningDistanceMeters < 0) {
    throw new RangeError(`evaluateCurveRisk: geçersiz policy.minimumWarningDistanceMeters (${policy.minimumWarningDistanceMeters}) — finite VE >=0 olmalı.`);
  }
}

/* ── Ana kural ────────────────────────────────────────────────────────────── */

/**
 * TEK giriş noktası. Girdi (`curve`/`vehicle`/`road`/`policy` ve iç alanları)
 * MUTASYONA UĞRATILMAZ. Aynı girdi her zaman AYNI çıktıyı üretir — `Date.now`/
 * `Math.random`/global durum YOK.
 *
 * `road` bu sürümde parametre olarak kabul edilir AMA HİÇ OKUNMAZ (G2B'ye
 * bırakıldı — sözleşme ileride genişleyebilsin diye şimdiden yer tutuyor).
 */
export function evaluateCurveRisk(input: CurveRiskInput): GuardianRuleResult {
  validateInput(input);

  const { curve, vehicle, policy } = input;
  const curveConfidence = clamp01(curve.confidence);

  // 1) Advisory hız yoksa risk ÜRETİLMEZ (radius'tan hız türetme YASAK).
  if (curve.advisorySpeedKph === undefined) {
    return emptyResult();
  }
  const advisorySpeedKph = curve.advisorySpeedKph;

  // 2) Confidence eşik altındaysa (eksik/güvenilmez tespit) olay YOK.
  if (curveConfidence < MINIMUM_CURVE_CONFIDENCE) {
    return emptyResult();
  }

  // 3) Duran araç → bölme-sıfır riski + "yaklaşan viraj" anlamsız → olay YOK.
  if (vehicle.currentSpeedKph === 0) {
    return emptyResult();
  }

  // 4) Uyarı penceresi dışı → olay YOK (viraj çok uzak).
  const currentSpeedMs = kphToMs(vehicle.currentSpeedKph);
  const estimatedTimeToCurveSeconds = curve.distanceMeters / currentSpeedMs;
  const withinLeadTime    = estimatedTimeToCurveSeconds <= policy.warningLeadTimeSeconds;
  const withinMinDistance = curve.distanceMeters <= policy.minimumWarningDistanceMeters;
  if (!withinLeadTime && !withinMinDistance) {
    return emptyResult();
  }

  // 5) Mutlak tolerans GATE'i — küçük mutlak fark oransal büyütülmez.
  const overspeedKph = vehicle.currentSpeedKph - advisorySpeedKph;
  if (overspeedKph <= policy.overspeedToleranceKph) {
    return emptyResult();
  }

  // 6) Severity YALNIZ orana göre.
  const overspeedRatio = vehicle.currentSpeedKph / advisorySpeedKph;
  const severity = severityFromOverspeedRatio(overspeedRatio);

  const event: GuardianRiskEvent = {
    id:                `${CURVE_RISK_RULE_ID}:${curve.id}`, // deterministik
    type:              'CURVE_RISK',
    severity,
    distanceMeters:    curve.distanceMeters,
    title:             TITLE_TEXT,
    message:           buildMessage(curve, advisorySpeedKph),
    recommendedAction: RECOMMENDED_ACTION_TEXT,
    confidence:        curveConfidence, // event conf <= curve conf (burada eşit — üst sınır)
    source:            curve.advisorySpeedSource ?? DEFAULT_ADVISORY_SOURCE,
  };

  return { ruleId: CURVE_RISK_RULE_ID, riskEvents: [event] };
}
