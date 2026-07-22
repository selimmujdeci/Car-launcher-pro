/**
 * maviOperator — Operatör'ün GERÇEK bağlaması (composition root).
 *
 * ⚠️ YENİ AI MOTORU / YENİ TOOL ROUTER / YENİ PLANNER YOK. Üç MEVCUT katman
 * BİRLİKTE, İSTEK-SCOPE bağlanır:
 *
 *   1) `planWithRouter(taskType, hints)` — MEVCUT Planner + Capability Catalog
 *      (Tool Router `listTools()`). Şalter/izin kapılarından geçmiş küme.
 *   2) `executePlan({ plan, router, signal, timeoutMs })` — MEVCUT yürütücü;
 *      YALNIZ salt-okunur `ready` adımları çalıştırır. Onay/yazma adımlarını
 *      OTOMATİK ÇALIŞTIRMAZ (operatör onları "onay bekliyor" olarak listeler).
 *   3) `buildMechanicBlock()` — MEVCUT AI Usta (teşhis + geçmiş + Bilgi Beyni).
 *
 * Fail-closed: şalter kapalı / hata → BOŞ rapor (asistan akışı ETKİLENMEZ).
 * Timeout + cancellation, alt katmanlara (router/executor) AYNEN geçirilir.
 * ASLA throw etmez.
 */

import { planWithRouter } from '../../planner/concrete/maviPlannerRuntime';
import { executePlan } from '../../planner/planExecutor';
import { buildMechanicBlock } from '../../mechanic/concrete/maviMechanic';
import { buildVehicleKnowledgeBlockForCodes } from '../../mechanic/concrete/maviMechanicKnowledge';
import { isMaviOperatorEnabled } from '../../gateway/aiGatewayFlag';
import {
  runOperatorTask,
  type OperatorCapabilities,
  type PlanSectionResult,
} from '../operatorEngine';
import { isOperatorTaskId } from '../operatorTasks';
import type { OperatorReport, OperatorTaskId } from '../operatorTypes';

export interface OperatorRunOptions {
  readonly signal?:    AbortSignal;
  readonly timeoutMs?: number;
  /** knowledge_explanation için kullanıcıdan çıkarılmış arıza kodu (ör. P0401). */
  readonly code?:      string;
}

function disabledReport(taskId: OperatorTaskId, enabled: boolean): OperatorReport {
  return {
    taskId,
    block: '',
    sections: [],
    pendingApprovals: [],
    truncated: false,
    telemetry: { enabled, taskId, sectionCount: 0, executedSteps: 0, pendingApprovals: 0, truncated: false },
  };
}

/**
 * Bir operatör görevini MEVCUT katmanlarla güvenli şekilde yürütür.
 * Bilinmeyen görev / şalter kapalı → boş rapor (fail-closed).
 */
export async function runMaviOperator(
  taskId: OperatorTaskId,
  opts: OperatorRunOptions = {},
): Promise<OperatorReport> {
  try {
    if (!isOperatorTaskId(taskId))  return disabledReport(taskId, false);
    if (!isMaviOperatorEnabled())   return disabledReport(taskId, false);

    const caps: OperatorCapabilities = {
      async planAndExecute(taskType, hints): Promise<PlanSectionResult> {
        // MEVCUT Planner + Capability Catalog — istek-scope router döner.
        const { plan, router } = planWithRouter(taskType, hints);
        if (!router) return { plan, block: '', executed: 0, skipped: 0, failed: 0 };

        // MEVCUT yürütücü: YALNIZ salt-okunur adımlar; timeout+iptal geçirilir.
        const exec = await executePlan({
          plan,
          router,
          ...(opts.signal    ? { signal: opts.signal }       : {}),
          ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}),
        });
        return { plan, block: exec.block, executed: exec.executed, skipped: exec.skipped, failed: exec.failed };
      },
      mechanicBlock(): string {
        return buildMechanicBlock().block;               // MEVCUT AI Usta bloğu
      },
      knowledgeForCode(code: string): string {
        return buildVehicleKnowledgeBlockForCodes([code]).block;  // MEVCUT Bilgi Beyni
      },
    };

    return await runOperatorTask(taskId, caps, {
      ...(opts.signal ? { signal: opts.signal } : {}),
      ...(opts.code   ? { code:   opts.code }   : {}),
    });
  } catch {
    return disabledReport(taskId, true);                 // fail-closed
  }
}
