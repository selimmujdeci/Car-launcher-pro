/**
 * scoring.mjs — Coverage-aware skor.
 *
 * ANAYASA (bu dosyanın var oluş sebebi):
 * "Atlanan test skoru ŞİŞİRMEZ." Klasik QA runner'ları atlanan testi 'yeşil' sayar
 * ya da paydadan düşürür → cihaz testleri hiç koşmadan %100 çıkar. Burada:
 *
 *   1) SKIPPED_NA / MANUAL_PENDING → SKORA GİRMEZ (ne pay ne payda) AMA
 *      COVERAGE'ı DÜŞÜRÜR. Skor "yaptıklarının kalitesi", coverage "ne kadarını
 *      yaptığın"dır. İkisi AYRI sayıdır ve verdict İKİSİNİ birden ister.
 *   2) INCOMPLETE → skora 0 olarak GİRER (koşması beklenen faz kanıt üretemedi;
 *      bu bir bedava geçiş değil, bir başarısızlıktır).
 *   3) Coverage payda = PLANLANAN faz sayısı (profilin koşmayı taahhüt ettiği),
 *      pay = GERÇEKTEN kanıt üreten (PASS / PASS_WITH_WARNINGS / FAIL) faz sayısı.
 *      Hiç device fazı planlanmadıysa deviceCoverage = 0 — "vacuously 100%" DEĞİL.
 *      Host-only koşunun OEM_READY üretememesi bu satırdan gelir.
 *
 * Ağırlık: effectiveWeight = weight × categoryMultiplier (security/performance/
 * vehicle → ×2). Safety-critical fazlar ayrıca verdict'te sert kapıdır.
 */
import { PHASE_RESULT, COVERAGE_DOMAINS, capabilityDomain } from './result-types.mjs';

/** Skora GİREN sonuçlar (payda). */
const SCORED = Object.freeze([PHASE_RESULT.PASS, PHASE_RESULT.PASS_WITH_WARNINGS, PHASE_RESULT.FAIL, PHASE_RESULT.INCOMPLETE]);
/** KANIT ÜRETEN sonuçlar (coverage payı). */
const EXECUTED = Object.freeze([PHASE_RESULT.PASS, PHASE_RESULT.PASS_WITH_WARNINGS, PHASE_RESULT.FAIL]);

export function isScored(result)   { return SCORED.includes(result); }
export function isExecuted(result) { return EXECUTED.includes(result); }

/** Faz kategorisine göre ağırlık çarpanı (security/performance/vehicle → ×2). */
export function effectiveWeight(phase, thresholds) {
  const multipliers = thresholds?.categoryMultipliers ?? {};
  const mult = Number.isFinite(multipliers[phase.category]) ? multipliers[phase.category] : 1;
  return phase.weight * mult;
}

/** Sonucun 0..1 puan karşılığı (thresholds.resultScores ile ayarlanabilir). */
export function resultScore(result, thresholds) {
  const table = thresholds?.resultScores ?? {};
  const value = table[result];
  if (Number.isFinite(value)) return Math.max(0, Math.min(1, value));
  switch (result) {
    case PHASE_RESULT.PASS:               return 1;
    case PHASE_RESULT.PASS_WITH_WARNINGS: return 0.75;
    default:                              return 0;   // FAIL, INCOMPLETE
  }
}

/**
 * Bir fazın hangi coverage kovasına ait olduğunu belirler:
 * `requires` içindeki EN YÜKSEK kova (vehicle > device > host). requires boşsa host.
 * Gerekçe: cihaz gerektiren bir faz cihaz kanıtıdır; host'ta atlanması host
 * coverage'ını değil DEVICE coverage'ını düşürmelidir.
 */
export function phaseDomain(phase) {
  const domains = (phase.requires ?? []).map(capabilityDomain);
  if (domains.includes('vehicle')) return 'vehicle';
  if (domains.includes('device'))  return 'device';
  return 'host';
}

/**
 * @param {Array} results  createPhaseResult çıktıları (planlanan TÜM fazlar — atlananlar dahil)
 * @param {object} thresholds
 * @returns {{score:number, weighted:{earned:number,possible:number}, coverage:object, counts:object}}
 */
export function computeScore(results, thresholds) {
  let earned   = 0;
  let possible = 0;

  const coverage = {};
  for (const d of COVERAGE_DOMAINS) coverage[d] = { planned: 0, executed: 0, skipped: 0, manual: 0, ratio: 0 };

  const counts = { PASS: 0, PASS_WITH_WARNINGS: 0, FAIL: 0, SKIPPED_NA: 0, MANUAL_PENDING: 0, INCOMPLETE: 0 };

  for (const r of results) {
    counts[r.result] = (counts[r.result] ?? 0) + 1;

    const domain = phaseDomain(r);
    const bucket = coverage[domain];
    bucket.planned += 1;
    if (isExecuted(r.result))                        bucket.executed += 1;
    if (r.result === PHASE_RESULT.SKIPPED_NA)        bucket.skipped  += 1;
    if (r.result === PHASE_RESULT.MANUAL_PENDING)    bucket.manual   += 1;

    if (!isScored(r.result)) continue;              // SKIPPED_NA / MANUAL_PENDING → skor DIŞI

    const w = Number.isFinite(r.effectiveWeight) ? r.effectiveWeight : effectiveWeight(r, thresholds);
    possible += w;
    earned   += w * resultScore(r.result, thresholds);
  }

  for (const d of COVERAGE_DOMAINS) {
    const b = coverage[d];
    // planned === 0 → ratio 0 (boş küme "tam kapsandı" SAYILMAZ).
    b.ratio = b.planned > 0 ? b.executed / b.planned : 0;
  }

  const score = possible > 0 ? (earned / possible) * 100 : 0;

  return Object.freeze({
    score:    Math.round(score * 10) / 10,
    weighted: Object.freeze({ earned: Math.round(earned * 1000) / 1000, possible: Math.round(possible * 1000) / 1000 }),
    coverage: Object.freeze({
      host:    Object.freeze(coverage.host),
      device:  Object.freeze(coverage.device),
      vehicle: Object.freeze(coverage.vehicle),
    }),
    counts:   Object.freeze(counts),
  });
}
