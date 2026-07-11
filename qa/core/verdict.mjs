/**
 * verdict.mjs — Skor + coverage → tek OEM kararı.
 *
 * ANAYASA: "Cihaz kanıtı olmadan üretim iddiası olmaz."
 * Verdict merdiveni yalnız AŞAĞI inebilen üç bağımsız kapıdan geçer:
 *
 *   KAPI 1 — RED (sert): blocker bulgu · safety-critical faz FAIL/INCOMPLETE ·
 *            asgari skorun altı → REJECTED. Coverage ne olursa olsun.
 *   KAPI 2 — COVERAGE TAVANI: deviceCoverage 0 ise tavan HOST_VERIFIED;
 *            vehicleCoverage 0 ise tavan (en fazla) OEM_READY. Skor 100 olsa bile
 *            YÜKSELTMEZ — kanıt yoksa iddia yok.
 *   KAPI 3 — PROFİL TAVANI: profile.maxVerdict (host-only → HOST_VERIFIED).
 *
 * Sonuç = min(skor merdiveni, coverage tavanı, profil tavanı).
 * "Yalnız aşağı" olması yapısaldır: hiçbir kapı verdict'i YÜKSELTEMEZ.
 */
import { VERDICT, VERDICT_LADDER, verdictRank, PHASE_RESULT, SEVERITY } from './result-types.mjs';

/** Skorun tek başına izin verdiği en yüksek verdict. */
function verdictFromScore(score, thresholds) {
  const min = thresholds?.minScore ?? {};
  const ladder = [
    [VERDICT.FLAGSHIP_READY,   min[VERDICT.FLAGSHIP_READY]   ?? 97],
    [VERDICT.PRODUCTION_READY, min[VERDICT.PRODUCTION_READY] ?? 92],
    [VERDICT.OEM_READY,        min[VERDICT.OEM_READY]        ?? 85],
    [VERDICT.HOST_VERIFIED,    min[VERDICT.HOST_VERIFIED]    ?? 70],
  ];
  for (const [verdict, threshold] of ladder) {
    if (score >= threshold) return verdict;
  }
  return VERDICT.REJECTED;
}

/** Coverage'ın izin verdiği en yüksek verdict (kanıt tavanı). */
function verdictFromCoverage(coverage, thresholds) {
  const minDevice  = thresholds?.minDeviceCoverage  ?? {};
  const minVehicle = thresholds?.minVehicleCoverage ?? {};
  const device  = coverage?.device?.ratio  ?? 0;
  const vehicle = coverage?.vehicle?.ratio ?? 0;

  // Cihaz kanıtı YOK → host doğrulamasının ötesine geçilemez. (Yapısal kilit.)
  if (device <= 0) return VERDICT.HOST_VERIFIED;

  const meets = (verdict) =>
    device  >= (minDevice[verdict]  ?? 0) &&
    vehicle >= (minVehicle[verdict] ?? 0);

  if (meets(VERDICT.FLAGSHIP_READY))   return VERDICT.FLAGSHIP_READY;
  if (meets(VERDICT.PRODUCTION_READY)) return VERDICT.PRODUCTION_READY;
  if (meets(VERDICT.OEM_READY))        return VERDICT.OEM_READY;
  return VERDICT.HOST_VERIFIED;
}

/** İki verdict'in düşüğü. */
function lower(a, b) { return verdictRank(a) <= verdictRank(b) ? a : b; }

/**
 * @param {{results:Array, score:number, coverage:object, thresholds:object, profile:object}} input
 * @returns {{verdict:string, reasons:string[], caps:{score:string, coverage:string, profile:string}}}
 */
export function decideVerdict({ results = [], score = 0, coverage = {}, thresholds = {}, profile = {} }) {
  const reasons = [];

  // ── KAPI 1: sert redler ──────────────────────────────────────────────────
  const blockers = results.flatMap((r) =>
    (r.findings ?? []).filter((f) => f.severity === SEVERITY.BLOCKER).map((f) => ({ phase: r.id, finding: f })),
  );
  if (blockers.length > 0) {
    for (const b of blockers) reasons.push(`BLOCKER bulgu (${b.phase}): ${b.finding.title}`);
    return Object.freeze({
      verdict: VERDICT.REJECTED,
      reasons: Object.freeze(reasons),
      caps: Object.freeze({ score: VERDICT.REJECTED, coverage: VERDICT.REJECTED, profile: profile.maxVerdict ?? VERDICT.FLAGSHIP_READY }),
    });
  }

  const safetyFailures = results.filter(
    (r) => r.safetyCritical &&
           (r.result === PHASE_RESULT.FAIL || r.result === PHASE_RESULT.INCOMPLETE),
  );
  if (safetyFailures.length > 0) {
    for (const r of safetyFailures) {
      reasons.push(`Safety-critical faz kanıt üretemedi: ${r.id} → ${r.result}`);
    }
    return Object.freeze({
      verdict: VERDICT.REJECTED,
      reasons: Object.freeze(reasons),
      caps: Object.freeze({ score: VERDICT.REJECTED, coverage: VERDICT.REJECTED, profile: profile.maxVerdict ?? VERDICT.FLAGSHIP_READY }),
    });
  }

  // ── KAPI 2 + 3: tavanlar ─────────────────────────────────────────────────
  const scoreCap    = verdictFromScore(score, thresholds);
  const coverageCap = verdictFromCoverage(coverage, thresholds);
  const profileCap  = VERDICT_LADDER.includes(profile.maxVerdict) ? profile.maxVerdict : VERDICT.FLAGSHIP_READY;

  let verdict = lower(lower(scoreCap, coverageCap), profileCap);

  if (scoreCap === VERDICT.REJECTED) {
    reasons.push(`Skor asgari eşiğin altında: ${score} < ${thresholds?.minScore?.[VERDICT.HOST_VERIFIED] ?? 70}`);
    verdict = VERDICT.REJECTED;
  }
  if ((coverage?.device?.ratio ?? 0) <= 0) {
    reasons.push('Cihaz coverage = 0 → tavan HOST_VERIFIED (gerçek cihaz kanıtı yok).');
  }
  if (profileCap !== VERDICT.FLAGSHIP_READY) {
    reasons.push(`Profil tavanı: ${profileCap} (profil: ${profile.id ?? 'bilinmiyor'}).`);
  }
  if (reasons.length === 0) reasons.push(`Tüm kapılar geçildi (skor ${score}).`);

  return Object.freeze({
    verdict,
    reasons: Object.freeze(reasons),
    caps: Object.freeze({ score: scoreCap, coverage: coverageCap, profile: profileCap }),
  });
}
