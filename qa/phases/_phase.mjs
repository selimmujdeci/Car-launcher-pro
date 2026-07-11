/**
 * _phase.mjs — Faz yazarları için tek giriş noktası (plugin sözleşmesi).
 *
 * Bir faz dosyası SADECE şunu yapar:
 *
 *   import { definePhase, phaseOutcome, check, finding, PHASE_RESULT } from './_phase.mjs';
 *   export default definePhase({
 *     id: 'my-phase', name: '…', order: 20, weight: 2,
 *     category: PHASE_CATEGORY.SECURITY, requires: [CAPABILITY.HOST_APK],
 *     safetyCritical: false,
 *     async run(context) { … return phaseOutcome({ result, findings, metrics, artifacts }); },
 *   });
 *
 * Faz ASLA: process.exit çağırmaz, global state yazmaz, context'i mutasyona
 * uğratmaz, kendi verdict'ini belirlemez (skor/verdict çekirdeğin işi).
 */
export {
  PHASE_RESULT,
  PHASE_CATEGORY,
  SEVERITY,
  CAPABILITY,
  createFinding as finding,
  createCheck as check,
  rollupChecks,
} from '../core/result-types.mjs';

export { definePhase } from '../core/registry.mjs';

/**
 * Faz çıktısı zarfı. Alan sırası SABİT (V8 hidden-class kararlılığı).
 */
export function phaseOutcome({
  result,
  findings = [],
  artifacts = [],
  metrics = {},
  skippedReason = null,
  manualFallback = null,
}) {
  return Object.freeze({
    result,
    findings:  Object.freeze([...findings]),
    artifacts: Object.freeze([...artifacts]),
    metrics:   Object.freeze({ ...metrics }),
    skippedReason,
    manualFallback,
  });
}
