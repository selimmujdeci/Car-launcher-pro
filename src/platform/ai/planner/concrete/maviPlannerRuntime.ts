/**
 * maviPlannerRuntime — Planner'ın GERÇEK bağlaması (composition root).
 *
 * Katalog MEVCUT Tool Router'dan gelir (`listTools()` — router'ın izin/şalter/
 * effect kapılarından geçmiş küme). Yeni araç kaydı, yeni depo veya yeni AI
 * altyapısı KURULMAZ.
 *
 * ⚠️ PLANNER ARAÇ ÇALIŞTIRMAZ. Bu dosya yalnız plan ÜRETİR; yürütme Faz 2'dir.
 */

import { buildMaviPlan } from '../maviPlanner';
import { getMaviToolRouter } from '../../tools/concrete/maviToolRouter';
import { isMaviPlannerEnabled } from '../../gateway/aiGatewayFlag';
import type { MaviPlan, PlannerHints, PlannerToolInfo } from '../plannerTypes';
import type { ToolDefinition } from '../../tools/toolTypes';
import type { MaviTaskType } from '../../orchestrator/orchestratorTypes';

/** Router tanımını planlayıcı bilgisine çevirir (şema adları + enum allowlist). */
function toPlannerInfo(tool: ToolDefinition): PlannerToolInfo {
  const parameterNames: string[] = [];
  const enumValues: Record<string, readonly string[]> = {};
  for (const [key, spec] of Object.entries(tool.parameters ?? {})) {
    parameterNames.push(key);
    if (spec.type === 'enum' && spec.values) enumValues[key] = spec.values;
  }
  return {
    name:       tool.name,
    effect:     tool.effect,
    available:  true,                      // listTools() zaten kapılardan geçirdi
    parameterNames,
    ...(tool.requiresConfirmation === true ? { requiresConfirmation: true } : {}),
    ...(Object.keys(enumValues).length > 0 ? { enumValues } : {}),
  };
}

const EMPTY_PLAN = (taskType: MaviTaskType): MaviPlan =>
  ({ taskType, steps: [], status: 'empty', truncated: false });

/**
 * Plan + o planı yürütecek router'ı BİRLİKTE döndürür (İSTEK-SCOPE — global
 * durum tutulmaz). Şalter kapalıysa veya katalog boşsa `router: null` →
 * yürütme YAPILAMAZ (fail-closed).
 */
export function planWithRouter(taskType: MaviTaskType, hints?: PlannerHints): {
  plan: MaviPlan; router: ReturnType<typeof getMaviToolRouter> | null;
} {
  try {
    if (!isMaviPlannerEnabled()) return { plan: EMPTY_PLAN(taskType), router: null };
    const router = getMaviToolRouter();
    const tools = router.listTools().map(toPlannerInfo);
    if (tools.length === 0) return { plan: EMPTY_PLAN(taskType), router: null };
    return { plan: buildMaviPlan({ taskType, tools, ...(hints ? { hints } : {}) }), router };
  } catch {
    return { plan: EMPTY_PLAN(taskType), router: null };
  }
}

export function planForTask(taskType: MaviTaskType, hints?: PlannerHints): MaviPlan {
  try {
    if (!isMaviPlannerEnabled()) return EMPTY_PLAN(taskType);
    const tools = getMaviToolRouter().listTools().map(toPlannerInfo);
    return buildMaviPlan({ taskType, tools, ...(hints ? { hints } : {}) });
  } catch {
    return EMPTY_PLAN(taskType);
  }
}
