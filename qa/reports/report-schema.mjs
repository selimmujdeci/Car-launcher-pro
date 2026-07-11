/**
 * report-schema.mjs — report.json TEK GERÇEK KAYNAK.
 *
 * Markdown raporlar bu nesneden RENDER edilir; kendi başlarına veri toplamazlar
 * (bir sayı iki yerde hesaplanırsa er geç ikisi ayrışır). Şema versiyonlanır —
 * ileride cihaz fazları eklendiğinde tüketiciler kırılmadan uyum sağlar.
 */
import { redactDeep } from '../core/redact.mjs';
import { VERDICT } from '../core/result-types.mjs';

export const REPORT_SCHEMA_VERSION = 1;

/**
 * @returns {object} dondurulmuş, redakte edilmiş rapor
 */
export function buildReport({
  runId,
  startedAt,
  finishedAt,
  repoRoot,
  profile,
  thresholds,
  capabilities,
  results,
  scoring,
  verdict,
  environment,
  logs = [],
}) {
  const report = {
    schemaVersion: REPORT_SCHEMA_VERSION,
    runId,
    startedAt,
    finishedAt,
    durationMs: Math.max(0, new Date(finishedAt).getTime() - new Date(startedAt).getTime()),

    profile: {
      id:         profile?.id ?? null,
      name:       profile?.name ?? null,
      lane:       profile?.lane ?? null,
      maxVerdict: profile?.maxVerdict ?? null,
      phases:     profile?.phases ?? [],
    },

    environment: {
      platform:    environment?.platform ?? null,
      nodeVersion: environment?.nodeVersion ?? null,
      ci:          environment?.ci ?? false,
    },

    capabilities: {
      detected: [...(capabilities ?? [])],
      // Cihaz katmanı bu PR'da YOK — tüketiciler bunu açıkça görsün.
      deviceLayerImplemented: false,
    },

    verdict: {
      value:   verdict?.verdict ?? VERDICT.REJECTED,
      reasons: verdict?.reasons ?? [],
      caps:    verdict?.caps ?? null,
    },

    score: {
      value:    scoring?.score ?? 0,
      weighted: scoring?.weighted ?? { earned: 0, possible: 0 },
      counts:   scoring?.counts ?? {},
    },

    coverage: scoring?.coverage ?? {},

    phases: (results ?? []).map((r) => ({
      id:              r.id,
      name:            r.name,
      order:           r.order,
      category:        r.category,
      weight:          r.weight,
      effectiveWeight: r.effectiveWeight,
      requires:        [...(r.requires ?? [])],
      safetyCritical:  r.safetyCritical,
      result:          r.result,
      scored:          r.scored,
      durationMs:      r.durationMs,
      findings:        (r.findings ?? []).map((f) => ({ ...f })),
      artifacts:       (r.artifacts ?? []).map((a) => ({ ...a })),
      metrics:         { ...(r.metrics ?? {}) },
      skippedReason:   r.skippedReason ?? null,
      manualFallback:  r.manualFallback ?? null,
    })),

    thresholds: thresholds ?? {},
    logs:       [...logs],
  };

  // SON KAPI: sır + kişisel yol redaksiyonu (rapor paylaşılabilir artefakttır).
  return Object.freeze(redactDeep(report, repoRoot));
}

/** Rapor bütünlük kontrolü (yazmadan önce). */
export function validateReport(report) {
  const errors = [];
  if (!report || typeof report !== 'object') return { valid: false, errors: ['rapor nesne olmalı'] };
  if (report.schemaVersion !== REPORT_SCHEMA_VERSION) errors.push(`schemaVersion ${REPORT_SCHEMA_VERSION} olmalı`);
  if (!report.runId) errors.push('runId zorunlu');
  if (!report.verdict?.value) errors.push('verdict.value zorunlu');
  if (!Array.isArray(report.phases)) errors.push('phases dizi olmalı');
  if (typeof report.score?.value !== 'number') errors.push('score.value sayı olmalı');
  return { valid: errors.length === 0, errors };
}
