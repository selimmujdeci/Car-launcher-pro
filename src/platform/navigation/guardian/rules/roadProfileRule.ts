/**
 * RoadProfileRule (Downhill Risk v1) — üçüncü Guardian analiz kuralı —
 * GUARDIAN-AI-G4.
 *
 * `curveRiskRule.ts`/`speedLimitRule.ts` deseni izlenir: SAF, deterministik,
 * fail-closed. `guardian/models.ts`teki `GuardianRuleResult` sözleşmesine
 * uyar (`ruleId:'road-profile'`) — `guardianEngine.ts`e OTOMATİK bağlanmaz
 * (DI ile gelecek). GPS/OBD/harita/hava/eğim-tahmini/Mavi/UI/store YOK;
 * yalnız `../models` (guardian tipleri) içe aktarılır. `curveRiskRule.ts`/
 * `speedLimitRule.ts`ten HİÇBİR ŞEY import edilmez — her kural bağımsız.
 *
 * ÖNEMLİ FARK (curve/speed-limit'e göre): bu kuralda severity **OVERSPEED
 * ORANINDAN GELMEZ** — tamamen `downhillGradePercent`in **mutlak eğim
 * bandına** göre belirlenir (`gradeThresholds` DI ile gelir). Tolerans/
 * overspeed kavramı bu kuralda YOKTUR — dik bir iniş, aracın hızından
 * bağımsız olarak kendi başına bir risktir.
 *
 * BU SÜRÜM YALNIZ `DOWNHILL_RISK` ÜRETİR — uphill/hairpin/tunnel/bridge/
 * narrow gibi diğer yol-profili alt-tipleri G4'ün KAPSAMI DIŞINDA (altyapı
 * ileride genişleyecek; `id` öneki (`downhill:`) bu genişlemeye hazırlık).
 *
 * ── GÜVENLİK ANAYASASI (mutlak — curveRiskRule/speedLimitRule ile AYNI) ────
 *   - Direksiyon/fren/gaz kontrolü YOK.
 *   - "Bu KESİN güvenlidir" denmez.
 *   - "Ani fren yap" denmez (CRITICAL'de bile) — yalnız "kontrollü hızla
 *     ilerle, gerekirse motor frenini kullan" gibi kontrollü öneriler.
 *   - Fren mesafesi/eğim fiziği HESAPLANMAZ — yalnız eğim uyarısı verilir.
 *   - Gerçek eğim kaynağı UYDURULMAZ — `downhillGradePercent` yoksa risk
 *     ÜRETİLMEZ.
 *
 * ── FAIL-CLOSED (event-yok, throw DEĞİL) ─────────────────────────────────────
 *   - `segment.downhillGradePercent` yok → olay YOK (eğim uydurma YASAK).
 *   - `downhillGradePercent < gradeThresholds.low` (0/negatif dahil — düz/
 *     tırmanış/hafif iniş) → olay YOK (throw DEĞİL — eşik-altı bir hata
 *     değil, basitçe uyarı gerektirmeyen bir durum).
 *   - `segment.confidence` < `MINIMUM_ROAD_PROFILE_CONFIDENCE` → olay YOK.
 *   - `vehicle.currentSpeedKph === 0` → olay YOK (bölme-sıfır riski).
 *   - Uyarı penceresi dışı (segment çok uzak) → olay YOK.
 *
 * ── SEVERITY (mutlak eğim bandı — OVERSPEED/TOLERANS YOK) ───────────────────
 *   g = downhillGradePercent
 *   g >= gradeThresholds.critical → CRITICAL
 *   g >= gradeThresholds.high     → HIGH
 *   g >= gradeThresholds.medium   → MEDIUM
 *   g >= gradeThresholds.low      → LOW
 *   g <  gradeThresholds.low      → (olay YOK — yukarıda ele alındı)
 * `gradeThresholds` DI ile gelir ve `low<=medium<=high<=critical` monoton
 * olmalı — bozuksa SÖZLEŞME HATASI (throw), aksi halde severity belirsiz
 * hale gelirdi.
 *
 * ── UYARI ZAMANLAMA (curve/speed-limit ile birebir) ─────────────────────────
 *   estimatedTimeToSegmentSeconds = distanceMeters / kphToMs(currentSpeedKph)
 * Değerlendirmeye yalnız şu durumda girilir:
 *   estimatedTimeToSegmentSeconds <= policy.warningLeadTimeSeconds
 *   VEYA distanceMeters <= policy.minimumWarningDistanceMeters
 */
import type { GuardianRiskEvent, GuardianRuleResult, GuardianSeverity } from '../models';

/* ── Sözleşme ─────────────────────────────────────────────────────────────── */

/** Tespit edilen TEK yol-profili segmenti. Routing/harita/eğim-tahmini
 *  PARSER'ı burada YOK — bu veri zaten normalize edilmiş halde DI ile gelir. */
export interface RoadProfileSegmentInput {
  id:                      string;
  distanceMeters:          number;
  /** Risk üretmenin TEK kaynağı — yoksa risk ÜRETİLMEZ (eğim UYDURULMAZ). */
  downhillGradePercent?:   number;
  /** `downhillGradePercent`in geldiği kaynak. Varsa üretilen olayın `source`
   *  alanına taşınır. */
  source?:                 string;
  confidence:              number;
}

export interface RoadProfileVehicleInput {
  currentSpeedKph: number;
}

export interface RoadProfilePolicyInput {
  warningLeadTimeSeconds:        number;
  minimumWarningDistanceMeters:  number;
}

/** Downhill eğim% eşikleri (mutlak) — DI ile gelir. `low<=medium<=high<=critical`
 *  monoton OLMALI (aksi sözleşme hatası — throw). */
export interface RoadProfileGradeThresholds {
  low:       number;
  medium:    number;
  high:      number;
  critical:  number;
}

export interface RoadProfileRiskInput {
  segment:          RoadProfileSegmentInput;
  vehicle:          RoadProfileVehicleInput;
  policy:           RoadProfilePolicyInput;
  gradeThresholds:  RoadProfileGradeThresholds;
}

/* ── Merkezi isimli sabitler (magic number YASAK) ────────────────────────── */

export const ROAD_PROFILE_RULE_ID = 'road-profile';

/** km/s → m/s bölen — yalnız bu dosyada kullanılan yerel sabit (navigation
 *  runtime importu YOK; curveRiskRule/speedLimitRule'daki AYNI sabitin
 *  BAĞIMSIZ kopyası). */
const KMH_TO_MS_DIVISOR = 3.6;

/** `segment.confidence` bu eşiğin ALTINDAYSA olay üretilmez (throw DEĞİL,
 *  sessizce olay yok). Sınırda (`=== eşik`) olay ÜRETİLİR (testle kilitli).
 *  `curveRiskRule`/`speedLimitRule`deki AYNI değer, bağımsız sabit. */
const MINIMUM_ROAD_PROFILE_CONFIDENCE = 0.3;

/** `segment.source` verilmezse kullanılan varsayılan kaynak etiketi. */
const DEFAULT_ROAD_PROFILE_SOURCE = 'road-profile-rule';

/** Anayasaya uygun, ihtiyatlı öneri metni — "ani fren" YOK. */
const RECOMMENDED_ACTION_TEXT = 'Kontrollü hızla ilerle. Gerekirse motor frenini kullan.';

const TITLE_TEXT   = 'Dik iniş yaklaşıyor';
const MESSAGE_TEXT = 'Önünde dik bir iniş bulunuyor.';

/* ── Yardımcılar (curveRiskRule/speedLimitRule'daki AYNI mantığın BAĞIMSIZ
      kopyası) ───────────────────────────────────────────────────────────── */

function kphToMs(kph: number): number {
  return kph / KMH_TO_MS_DIVISOR;
}

/** confidence savunmacı clamp — diğer guardian kurallarıyla AYNI davranış
 *  (bağımsız kopya — navigation/guardian dışına import YOK). */
function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/**
 * Mutlak eğim bandından severity — OVERSPEED/TOLERANS kullanılmaz.
 * Eşik altı (`g < thresholds.low`) → `null` (çağıran bunu "olay yok" olarak ele alır).
 */
function severityFromGrade(grade: number, thresholds: RoadProfileGradeThresholds): GuardianSeverity | null {
  if (grade >= thresholds.critical) return 'CRITICAL';
  if (grade >= thresholds.high)     return 'HIGH';
  if (grade >= thresholds.medium)   return 'MEDIUM';
  if (grade >= thresholds.low)      return 'LOW';
  return null;
}

function emptyResult(): GuardianRuleResult {
  return { ruleId: ROAD_PROFILE_RULE_ID, riskEvents: [] };
}

/* ── Doğrulama — SÖZLEŞME/programlama hatası → THROW ─────────────────────────
 * (gerçek-dünya eksik OPSİYONEL veri VEYA eşik-altı eğim buraya GİRMEZ — o
 * durumlar aşağıda `evaluateRoadProfileRisk` içinde sessizce boş sonuçla ele
 * alınır. `downhillGradePercent` negatif/0 → THROW DEĞİL, eşik-altı olarak
 * ele alınır — düz yol/tırmanış anlamına gelir, bozuk girdi değildir.) */
function validateInput(input: RoadProfileRiskInput): void {
  const segment = input?.segment;
  const vehicle = input?.vehicle;
  const policy  = input?.policy;
  const gradeThresholds = input?.gradeThresholds;

  if (!segment || typeof segment.id !== 'string' || segment.id.trim() === '') {
    throw new RangeError('evaluateRoadProfileRisk: segment.id boş olamaz.');
  }
  if (!Number.isFinite(segment.distanceMeters) || segment.distanceMeters < 0) {
    throw new RangeError(`evaluateRoadProfileRisk: geçersiz segment.distanceMeters (${segment.distanceMeters}) — finite VE >=0 olmalı.`);
  }
  if (segment.downhillGradePercent !== undefined && !Number.isFinite(segment.downhillGradePercent)) {
    throw new RangeError(`evaluateRoadProfileRisk: geçersiz segment.downhillGradePercent (${segment.downhillGradePercent}) — verildiyse NaN/Infinity olamaz.`);
  }
  if (!Number.isFinite(segment.confidence)) {
    throw new RangeError(`evaluateRoadProfileRisk: geçersiz segment.confidence (${segment.confidence}) — NaN/Infinity olamaz.`);
  }

  if (!vehicle || !Number.isFinite(vehicle.currentSpeedKph) || vehicle.currentSpeedKph < 0) {
    throw new RangeError(`evaluateRoadProfileRisk: geçersiz vehicle.currentSpeedKph (${vehicle?.currentSpeedKph}) — finite VE >=0 olmalı.`);
  }

  if (!policy) {
    throw new RangeError('evaluateRoadProfileRisk: policy zorunludur.');
  }
  if (!Number.isFinite(policy.warningLeadTimeSeconds) || policy.warningLeadTimeSeconds <= 0) {
    throw new RangeError(`evaluateRoadProfileRisk: geçersiz policy.warningLeadTimeSeconds (${policy.warningLeadTimeSeconds}) — finite VE >0 olmalı.`);
  }
  if (!Number.isFinite(policy.minimumWarningDistanceMeters) || policy.minimumWarningDistanceMeters < 0) {
    throw new RangeError(`evaluateRoadProfileRisk: geçersiz policy.minimumWarningDistanceMeters (${policy.minimumWarningDistanceMeters}) — finite VE >=0 olmalı.`);
  }

  if (!gradeThresholds) {
    throw new RangeError('evaluateRoadProfileRisk: gradeThresholds zorunludur.');
  }
  const { low, medium, high, critical } = gradeThresholds;
  if (!Number.isFinite(low) || !Number.isFinite(medium) || !Number.isFinite(high) || !Number.isFinite(critical)) {
    throw new RangeError(
      `evaluateRoadProfileRisk: gradeThresholds içinde geçersiz (NaN/Infinity) değer var (low=${low}, medium=${medium}, high=${high}, critical=${critical}).`,
    );
  }
  if (!(low <= medium && medium <= high && high <= critical)) {
    throw new RangeError(
      `evaluateRoadProfileRisk: gradeThresholds sırası bozuk — low<=medium<=high<=critical OLMALI (gelen: low=${low}, medium=${medium}, high=${high}, critical=${critical}).`,
    );
  }
}

/* ── Ana kural ────────────────────────────────────────────────────────────── */

/**
 * TEK giriş noktası. Girdi (`segment`/`vehicle`/`policy`/`gradeThresholds` ve
 * iç alanları) MUTASYONA UĞRATILMAZ. Aynı girdi her zaman AYNI çıktıyı üretir
 * — `Date.now`/`Math.random`/global durum YOK.
 */
export function evaluateRoadProfileRisk(input: RoadProfileRiskInput): GuardianRuleResult {
  validateInput(input);

  const { segment, vehicle, policy, gradeThresholds } = input;
  const segmentConfidence = clamp01(segment.confidence);

  // 1) Eğim yoksa risk ÜRETİLMEZ (eğim uydurma YASAK).
  if (segment.downhillGradePercent === undefined) {
    return emptyResult();
  }
  const grade = segment.downhillGradePercent;

  // 2) Severity mutlak eğim bandından — eşik altı (0/negatif dahil) → olay YOK.
  const severity = severityFromGrade(grade, gradeThresholds);
  if (severity === null) {
    return emptyResult();
  }

  // 3) Confidence eşik altındaysa (eksik/güvenilmez tespit) olay YOK.
  if (segmentConfidence < MINIMUM_ROAD_PROFILE_CONFIDENCE) {
    return emptyResult();
  }

  // 4) Duran araç → bölme-sıfır riski → olay YOK.
  if (vehicle.currentSpeedKph === 0) {
    return emptyResult();
  }

  // 5) Uyarı penceresi dışı → olay YOK (segment çok uzak).
  const currentSpeedMs = kphToMs(vehicle.currentSpeedKph);
  const estimatedTimeToSegmentSeconds = segment.distanceMeters / currentSpeedMs;
  const withinLeadTime    = estimatedTimeToSegmentSeconds <= policy.warningLeadTimeSeconds;
  const withinMinDistance = segment.distanceMeters <= policy.minimumWarningDistanceMeters;
  if (!withinLeadTime && !withinMinDistance) {
    return emptyResult();
  }

  const event: GuardianRiskEvent = {
    id:                `downhill:${segment.id}`, // deterministik; road-profile alt-tipleri için genişletilebilir önek
    type:              'DOWNHILL_RISK',
    severity,
    distanceMeters:    segment.distanceMeters,
    title:             TITLE_TEXT,
    message:           MESSAGE_TEXT,
    recommendedAction: RECOMMENDED_ACTION_TEXT,
    confidence:        segmentConfidence, // event conf <= segment conf (burada eşit — üst sınır)
    source:            segment.source ?? DEFAULT_ROAD_PROFILE_SOURCE,
  };

  return { ruleId: ROAD_PROFILE_RULE_ID, riskEvents: [event] };
}
