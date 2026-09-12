/**
 * maviPlanner — DETERMİNİSTİK, saf plan üretici.
 *
 * ── KESİN SINIRLAR ──────────────────────────────────────────────────────────
 *  - ARAÇ ÇALIŞTIRMAZ. Çıktı yalnız bir plandır (Faz 1 = karar katmanı).
 *  - AI/LLM ÇAĞIRMAZ, ağ/IO YOK, `Date.now`/`Math.random` YOK → aynı girdi
 *    her zaman aynı planı üretir (yapısal testle kilitli).
 *  - Katalogda OLMAYAN araç plana GİREMEZ (allowlist).
 *  - Planner argüman UYDURMAZ: yalnız şemada tanımlı parametreleri ve
 *    `enum` allowlist'indeki değerleri kullanır.
 *  - Riskli araçlar (onay gerektiren / okuma-dışı yan etki) PLANLANABİLİR ama
 *    `needs_confirmation` / `not_permitted` ile İŞARETLENİR — yürütme katmanı
 *    (Faz 2) bunları çalıştırmadan önce onay aramak ZORUNDADIR.
 *  - Sonsuz plan imkânsız: azami adım sınırı + aynı araç+argüman TEK KEZ.
 */

import type {
  MaviPlan,
  MaviPlanStep,
  PlanStatus,
  PlanStepReason,
  PlanStepStatus,
  PlannerHints,
  PlannerToolInfo,
} from './plannerTypes';
import type { MaviTaskType } from '../orchestrator/orchestratorTypes';

/** Bir planın azami adım sayısı — sonsuz/şişkin plan yok. */
export const MAX_PLAN_STEPS = 4;

/** Faz 1'de yürütülebilir sayılan yan etkiler (Tool Router ile AYNI kural). */
const EXECUTABLE_EFFECTS = new Set(['read', 'navigate']);

/**
 * Görev → İSTENEN araç niyetleri (kanonik ad + gerekçe). Sıra ÖNEMLİDİR:
 * plan bu sırayla kurulur (önce bağlantı, sonra veri, sonra tanı).
 *
 * Katalogda bulunmayan ad SESSİZCE atlanır → yeni araç eklendiğinde planner
 * kodu DEĞİŞMEZ, yalnız katalog büyür.
 */
const TASK_PLAN_BLUEPRINT: Readonly<Record<MaviTaskType, readonly { tool: string; reason: PlanStepReason }[]>> = {
  general_chat:       [],
  short_answer:       [],
  code_analysis:      [],
  vehicle_question: [
    { tool: 'get_vehicle_connection',   reason: 'task_requires_connection' },
    { tool: 'get_vehicle_live_summary', reason: 'task_requires_live_data' },
    { tool: 'get_vehicle_dtc_summary',  reason: 'task_requires_diagnostics' },
  ],
  technical_analysis: [
    { tool: 'get_vehicle_connection',   reason: 'task_requires_connection' },
    { tool: 'get_vehicle_dtc_summary',  reason: 'task_requires_diagnostics' },
    { tool: 'get_vehicle_live_summary', reason: 'task_requires_live_data' },
  ],
  long_explanation: [
    { tool: 'get_vehicle_connection',   reason: 'task_requires_connection' },
    { tool: 'get_vehicle_live_summary', reason: 'task_requires_live_data' },
  ],
};

/** Navigasyon aracı — YALNIZ kullanıcı açıkça ekran istediğinde planlanır. */
const NAVIGATION_TOOL = 'open_app_screen';
const NAVIGATION_PARAM = 'screenId';

export interface BuildPlanInput {
  readonly taskType: MaviTaskType;
  /** Tool Router kataloğundan türetilmiş bilgi (izin kapılarından geçmiş). */
  readonly tools:    readonly PlannerToolInfo[];
  readonly hints?:   PlannerHints;
}

/** Bir aracın plan içindeki yürütülebilirlik durumu. */
function statusOf(tool: PlannerToolInfo): PlanStepStatus {
  if (!tool.available)                     return 'not_permitted';
  if (!EXECUTABLE_EFFECTS.has(tool.effect)) return 'not_permitted';   // yazma/ECU
  if (tool.requiresConfirmation === true)   return 'needs_confirmation';
  return 'ready';
}

/**
 * Deterministik plan üretir. ASLA throw etmez; geçersiz girdide BOŞ plan.
 */
export function buildMaviPlan(input: BuildPlanInput): MaviPlan {
  const taskType = input?.taskType;
  const blueprint = TASK_PLAN_BLUEPRINT[taskType];
  const catalog = new Map<string, PlannerToolInfo>();
  for (const tool of input?.tools ?? []) {
    if (tool && typeof tool.name === 'string' && tool.name) catalog.set(tool.name, tool);
  }

  const empty: MaviPlan = { taskType, steps: [], status: 'empty', truncated: false };
  if (!blueprint) return empty;

  /* ── İstenen adımlar: görev planı + (varsa) açık navigasyon isteği ── */
  /* NİYET AYRIMI: kullanıcı yalnız arıza sorduysa canlı ölçüm okunmaz (ve
     tersi). İpucu verilmemişse (undefined) filtre UYGULANMAZ — geriye uyum. */
  const hints = input?.hints;
  const wantsDiag = hints?.wantsDiagnostics;
  const wantsLive = hints?.wantsLiveData;
  const intentAllows = (reason: PlanStepReason): boolean => {
    if (reason === 'task_requires_diagnostics' && wantsDiag === false) return false;
    if (reason === 'task_requires_live_data'   && wantsLive === false) return false;
    return true;
  };

  const wanted: Array<{ tool: string; reason: PlanStepReason; args: Record<string, string | number | boolean> }> =
    blueprint.filter((b) => intentAllows(b.reason))
             .map((b) => ({ tool: b.tool, reason: b.reason, args: {} }));

  const screenId = input?.hints?.screenId;
  if (typeof screenId === 'string' && screenId) {
    const navTool = catalog.get(NAVIGATION_TOOL);
    // Argüman UYDURULMAZ: ekran kimliği aracın enum ALLOWLIST'inde OLMALI.
    const allowed = navTool?.enumValues?.[NAVIGATION_PARAM];
    if (navTool && Array.isArray(allowed) && allowed.includes(screenId)) {
      wanted.push({
        tool:   NAVIGATION_TOOL,
        reason: 'user_requested_navigation',
        args:   { [NAVIGATION_PARAM]: screenId },
      });
    }
  }

  /* ── Adımları kur: allowlist + tekrarsızlık + sınır ── */
  const steps: MaviPlanStep[] = [];
  const seen = new Set<string>();
  let truncated = false;

  for (const item of wanted) {
    const tool = catalog.get(item.tool);
    if (!tool) continue;                                   // katalogda yok → ATLA

    // Planner yalnız ŞEMADA TANIMLI parametreleri doldurur.
    const args: Record<string, string | number | boolean> = {};
    for (const [key, value] of Object.entries(item.args)) {
      if (tool.parameterNames.includes(key)) args[key] = value;
    }

    const key = `${tool.name}|${Object.entries(args).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${String(v)}`).join('&')}`;
    if (seen.has(key)) continue;                           // AYNI adım İKİ KEZ girmez
    if (steps.length >= MAX_PLAN_STEPS) { truncated = true; break; }
    seen.add(key);

    steps.push({
      order:     steps.length + 1,
      toolName:  tool.name,
      effect:    tool.effect,
      arguments: args,
      status:    statusOf(tool),
      reason:    item.reason,
    });
  }

  if (steps.length === 0) return { ...empty, truncated };

  const ready   = steps.filter((s) => s.status === 'ready').length;
  const status: PlanStatus = ready === 0 ? 'blocked'
                           : ready === steps.length ? 'ready'
                           : 'partially_blocked';

  return { taskType, steps, status, truncated };
}

/** Yalnız YÜRÜTÜLEBİLİR adımlar (Faz 2 yürütücüsünün gireceği küme). */
export function executableSteps(plan: MaviPlan): readonly MaviPlanStep[] {
  return (plan?.steps ?? []).filter((s) => s.status === 'ready');
}
