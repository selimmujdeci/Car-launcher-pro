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
 * Şu anki katalogla plan üretir. Şalter kapalıysa BOŞ plan döner (fail-closed);
 * hata durumunda da BOŞ plan — plan üretimi asistan akışını ETKİLEMEZ.
 */
export function planForTask(taskType: MaviTaskType, hints?: PlannerHints): MaviPlan {
  try {
    if (!isMaviPlannerEnabled()) return EMPTY_PLAN(taskType);
    const tools = getMaviToolRouter().listTools().map(toPlannerInfo);
    return buildMaviPlan({ taskType, tools, ...(hints ? { hints } : {}) });
  } catch {
    return EMPTY_PLAN(taskType);
  }
}
