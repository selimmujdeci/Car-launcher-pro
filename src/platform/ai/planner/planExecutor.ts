/**
 * planExecutor — planı TÜKETEN katman (Faz 2).
 *
 * ── NE ÇALIŞTIRIR ───────────────────────────────────────────────────────────
 * YALNIZ `status === 'ready'` VE `effect === 'read'` adımlar. Yani:
 *   - `needs_confirmation`  → ÇALIŞTIRILMAZ (onay akışı yok)
 *   - `not_permitted`       → ÇALIŞTIRILMAZ
 *   - `navigate` / `write` / `vehicle_command` → BU FAZDA ÇALIŞTIRILMAZ
 *     (plan onları taşıyabilir; yürütme salt-okunurla sınırlıdır)
 * Bu kapı Tool Router'ın kendi kapılarının ÜSTÜNDEDİR — router yine de her
 * çağrıyı allowlist/şema/izin/timeout/bounded süzgecinden geçirir.
 *
 * ── DİĞER GARANTİLER ────────────────────────────────────────────────────────
 *  - Aynı araç İKİ KEZ çalışmaz (adım listesi tekrar içerse bile).
 *  - Tur başına azami çağrı sınırı (bounded).
 *  - `signal.aborted` → hiç çağrı yapılmaz / kalanlar iptal edilir.
 *  - Sonuçlar ham JSON DEĞİL: `tools/toolLoop` ile AYNI etiketli, sanitize,
 *    bounded blok biçimlendiricisi kullanılır (kopya mantık yok).
 *  - ASLA throw etmez; kullanıcı metni/argüman LOGLANMAZ.
 */

import { formatToolData, sanitizeToolValue, TOOL_RESULT_FOOTER, TOOL_RESULT_HEADER } from '../tools/toolLoop';
import type { ToolRouter } from '../tools/toolRouter';
import type { ToolTelemetry } from '../tools/toolTypes';
import type { MaviPlan, MaviPlanStep } from './plannerTypes';

/** Bir planda çalıştırılacak azami adım (router'ın kendi sınırlarına ek). */
export const MAX_EXECUTED_STEPS = 3;

export interface PlanExecutionInput {
  readonly plan:      MaviPlan;
  readonly router:    ToolRouter;
  readonly signal?:   AbortSignal;
  readonly timeoutMs?: number;
}

export interface PlanExecutionOutcome {
  /** Modele eklenecek ETİKETLİ blok; hiç adım çalışmadıysa BOŞ. */
  readonly block:        string;
  readonly executed:     number;
  /** Yürütülmeyen adımlar (onay/izin/yan etki nedeniyle). */
  readonly skipped:      number;
  readonly failed:       number;
  /** YALNIZ güvenli metadata. */
  readonly telemetry:    readonly ToolTelemetry[];
}

const EMPTY: PlanExecutionOutcome = { block: '', executed: 0, skipped: 0, failed: 0, telemetry: [] };

/** Bu fazda GERÇEKTEN çalıştırılabilir mi? (salt-okunur + hazır) */
export function isExecutableNow(step: MaviPlanStep): boolean {
  return step.status === 'ready' && step.effect === 'read';
}

/**
 * Planın yürütülebilir adımlarını çalıştırır ve etiketli sonuç bloğu üretir.
 * ASLA throw etmez.
 */
export async function executePlan(input: PlanExecutionInput): Promise<PlanExecutionOutcome> {
  const steps = input?.plan?.steps ?? [];
  if (steps.length === 0 || !input?.router) return EMPTY;
  if (input.signal?.aborted) return EMPTY;

  const lines: string[] = [];
  const telemetry: ToolTelemetry[] = [];
  const ranTools = new Set<string>();          // AYNI ARAÇ iki kez çalışmaz
  let executed = 0;
  let skipped = 0;
  let failed = 0;

  for (const step of steps) {
    if (!isExecutableNow(step)) { skipped++; continue; }      // onay/izin/yan etki kapısı
    if (ranTools.has(step.toolName)) { skipped++; continue; }
    if (executed >= MAX_EXECUTED_STEPS) { skipped++; continue; }
    if (input.signal?.aborted) { skipped++; continue; }       // iptal → kalanlar atlanır

    ranTools.add(step.toolName);
    let outcome;
    try {
      outcome = await input.router.call(step.toolName, step.arguments, {
        ...(input.signal    ? { signal: input.signal } : {}),
        ...(input.timeoutMs ? { timeoutMs: input.timeoutMs } : {}),
      });
    } catch {
      failed++;                                               // router throw etmez; savunmacı
      continue;
    }

    telemetry.push(outcome.telemetry);
    if (outcome.result.ok) {
      executed++;
      lines.push(`- ${sanitizeToolValue(step.toolName)}: ${sanitizeToolValue(outcome.result.summary)}`
        + formatToolData(outcome.result.data));
    } else {
      failed++;
      lines.push(`- ${sanitizeToolValue(step.toolName)}: kullanılamadı (${sanitizeToolValue(outcome.result.error)})`);
    }
  }

  if (lines.length === 0) return { ...EMPTY, skipped, failed, telemetry };

  return {
    block: [TOOL_RESULT_HEADER, ...lines, TOOL_RESULT_FOOTER].join('\n'),
    executed, skipped, failed, telemetry,
  };
}
