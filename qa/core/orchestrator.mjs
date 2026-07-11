/**
 * orchestrator.mjs — Fazları deterministik sırayla, İZOLE ve FAIL-SOFT koşar.
 *
 * GARANTİLER:
 *  1) Bir faz throw ederse Lab ÇÖKMEZ → o faz INCOMPLETE olur, hata artefakta
 *     yazılır, KALAN fazlar koşmaya devam eder. (Tek bozuk plugin tüm kanıtı
 *     yok edemez.)
 *  2) Faz `requires` yetenekleri eksikse ÇALIŞTIRILMAZ:
 *       - profilde manuel karşılığı varsa → MANUAL_PENDING
 *       - yoksa → SKIPPED_NA
 *     Her iki durumda da skora girmez, coverage'ı DÜŞÜRÜR.
 *  3) Faz zaman-sınırlıdır (phaseTimeoutMs) — asılı kalan faz koşuyu kilitlemez.
 *  4) Faz sonucu ŞEMAYA ZORLANIR (createPhaseResult) — eksik alan döndüren faz
 *     raporu bozamaz.
 *  5) Orchestrator context'i MUTASYONA UĞRATMAZ ve faz çıktısını değiştirmez
 *     (girdi immutable).
 */
import { PHASE_RESULT, createPhaseResult, createFinding, SEVERITY } from './result-types.mjs';
import { effectiveWeight } from './scoring.mjs';

const DEFAULT_PHASE_TIMEOUT_MS = 10 * 60_000;

/** Faz koşusunu zaman sınırına bağlar; timer daima temizlenir (zero-leak). */
function withTimeout(promise, ms, phaseId) {
  let timer = null;
  const guard = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Faz zaman aşımı: ${phaseId} (${ms}ms)`)), ms);
    if (typeof timer.unref === 'function') timer.unref();
  });
  return Promise.race([promise, guard]).finally(() => {
    if (timer) { clearTimeout(timer); timer = null; }
  });
}

/**
 * @param {ReturnType<import('./registry.mjs').createRegistry>} registry
 * @param {object} context  createContext çıktısı (immutable)
 * @returns {Promise<Array>} planlanan TÜM fazların sonucu (atlananlar dahil)
 */
export async function runPhases(registry, context) {
  const profile     = context.profile;
  const thresholds  = context.thresholds;
  const phaseTimeout = Number.isFinite(profile?.phaseTimeoutMs) ? profile.phaseTimeoutMs : DEFAULT_PHASE_TIMEOUT_MS;
  const phases      = registry.list(profile?.phases ?? null);
  const results     = [];

  for (const phase of phases) {
    const startedAt = Date.now();
    const base = {
      id:              phase.id,
      name:            phase.name,
      order:           phase.order,
      category:        phase.category,
      weight:          phase.weight,
      effectiveWeight: effectiveWeight(phase, thresholds),
      requires:        phase.requires,
      safetyCritical:  phase.safetyCritical,
    };

    // ── Yetenek kapısı ────────────────────────────────────────────────────
    const missing = context.missing(phase.requires);
    if (missing.length > 0) {
      const manual = profile?.manualFallbacks?.[phase.id] ?? null;
      const reason = `Gerekli yetenekler yok: ${missing.join(', ')}`;
      context.log(`⏭️  ${phase.id} — ${reason}${manual ? ' → MANUAL_PENDING' : ' → SKIPPED_NA'}`);
      results.push(createPhaseResult({
        ...base,
        result:         manual ? PHASE_RESULT.MANUAL_PENDING : PHASE_RESULT.SKIPPED_NA,
        score:          0,
        scored:         false,
        durationMs:     0,
        skippedReason:  reason,
        manualFallback: manual,
        findings: [createFinding({
          id:       `${phase.id}.capability-gap`,
          severity: SEVERITY.INFO,
          title:    `Kanıt boşluğu: ${phase.name}`,
          detail:   reason,
          remediation: manual ?? 'Gerekli yetenek sağlanınca faz otomatik koşar (coverage yükselir).',
        })],
      }));
      continue;
    }

    // ── İzole koşu ────────────────────────────────────────────────────────
    context.log(`▶️  ${phase.id} — ${phase.name}`);
    let outcome;
    try {
      outcome = await withTimeout(Promise.resolve(phase.run(context)), phaseTimeout, phase.id);
    } catch (err) {
      const message = err?.stack ? String(err.stack) : String(err?.message ?? err);
      const ref = context.artifacts.write(`artifacts/${phase.id}.error.txt`, message);
      context.log(`💥 ${phase.id} — faz hata verdi, izole edildi (Lab devam ediyor)`);
      results.push(createPhaseResult({
        ...base,
        result:     PHASE_RESULT.INCOMPLETE,
        score:      0,
        scored:     true,
        durationMs: Date.now() - startedAt,
        artifacts:  [ref],
        findings: [createFinding({
          id:       `${phase.id}.exception`,
          severity: phase.safetyCritical ? SEVERITY.BLOCKER : SEVERITY.MAJOR,
          title:    `Faz hata fırlattı: ${phase.name}`,
          detail:   String(err?.message ?? err).slice(0, 500),
          evidence: ref.path,
          remediation: 'Faz kodunu düzelt; hata artefaktına bak.',
        })],
      }));
      continue;
    }

    const result = outcome?.result ?? PHASE_RESULT.INCOMPLETE;
    const scored = result !== PHASE_RESULT.SKIPPED_NA && result !== PHASE_RESULT.MANUAL_PENDING;
    results.push(createPhaseResult({
      ...base,
      result,
      score:          0,   // nihai puan scoring katmanında hesaplanır (tek yer)
      scored,
      durationMs:     Date.now() - startedAt,
      findings:       outcome?.findings  ?? [],
      artifacts:      outcome?.artifacts ?? [],
      metrics:        outcome?.metrics   ?? {},
      skippedReason:  outcome?.skippedReason  ?? null,
      manualFallback: outcome?.manualFallback ?? null,
    }));
    context.log(`   └─ ${phase.id}: ${result}`);
  }

  return results;
}
