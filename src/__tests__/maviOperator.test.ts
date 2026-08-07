/**
 * maviOperator.test.ts — Mavi Operatör (çok-adımlı görev yönetimi).
 *
 * Kilitlenen davranışlar:
 *  1) Reçete uygulanır — görev → doğru bölümler (plan yürütme + AI Usta)
 *  2) Salt-okunur görevler OTOMATİK yürütülür (mevcut planExecutor kapısı)
 *  3) Onay bekleyen adımlar OTOMATİK ÇALIŞMAZ — dürüstçe listelenir
 *  4) Onay bekleyen işlem rapor bloğunda "ONAY BEKLEYEN İŞLEM" olarak görünür
 *  5) diagnosis_summary yeni araç sorgusu YAPMAZ (planAndExecute çağrılmaz)
 *  6) VERİ UYDURMA YASAK — yetenek boş dönerse bölüm/blok boş
 *  7) Fail-soft — bir yetenek düşerse diğer bölüm korunur; ASLA throw etmez
 *  8) Cancellation — signal.aborted → sonraki bölümler çalıştırılmaz
 *  9) Bounded — bütçe aşımında içerik sondan düşer, onay satırı KORUNUR
 * 10) Şalter kapalıyken boş rapor (fail-closed); bilinmeyen görev boş
 * 11) Timeout + iptal alt katmanlara AYNEN geçirilir
 * 12) YENİ MOTOR/ROUTER/PLANNER YOK (yapısal kilit) — yalnız mevcut katmanlar
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  runOperatorTask, collectPendingApprovals, assembleOperatorBlock,
  MAX_OPERATOR_CHARS, type OperatorCapabilities, type PlanSectionResult,
} from '../platform/ai/operator/operatorEngine';
import type { MaviPlan, MaviPlanStep } from '../platform/ai/planner/plannerTypes';

/* ── Fikstürler ────────────────────────────────────────────────────────────*/

const step = (over: Partial<MaviPlanStep> = {}): MaviPlanStep => ({
  order: 1, toolName: 'get_vehicle_live_summary', effect: 'read',
  arguments: {}, status: 'ready', reason: 'task_requires_live_data', ...over,
});

const plan = (steps: MaviPlanStep[]): MaviPlan =>
  ({ taskType: 'vehicle_question', steps, status: 'ready', truncated: false });

const planRes = (over: Partial<PlanSectionResult> = {}): PlanSectionResult => ({
  plan: plan([step()]), block: 'PLAN BLOK', executed: 1, skipped: 0, failed: 0, ...over,
});

const caps = (over: Partial<OperatorCapabilities> = {}): OperatorCapabilities => ({
  planAndExecute: vi.fn(async () => planRes()),
  mechanicBlock:  vi.fn(() => 'AI USTA BLOK'),
  ...over,
});

/* ── 1/2) Reçete + otomatik salt-okunur yürütme ────────────────────────────*/

describe('runOperatorTask — reçete uygulaması', () => {
  it('health_check → plan yürütme + AI Usta bölümleri (tek birleşik blok)', async () => {
    const c = caps();
    const r = await runOperatorTask('health_check', c);
    expect(c.planAndExecute).toHaveBeenCalledWith('vehicle_question', undefined);
    expect(r.block).toMatch(/OPERATÖR RAPORU/);
    expect(r.block).toMatch(/PLAN BLOK/);
    expect(r.block).toMatch(/AI USTA BLOK/);
    expect(r.telemetry.enabled).toBe(true);
    expect(r.telemetry.executedSteps).toBe(1);
  });

  it('status_summary → AI Usta bölümü EKLENMEZ (hızlı özet)', async () => {
    const c = caps();
    const r = await runOperatorTask('status_summary', c);
    expect(c.mechanicBlock).not.toHaveBeenCalled();
    expect(r.sections.some((s) => s.kind === 'mechanic')).toBe(false);
    expect(r.block).toMatch(/PLAN BLOK/);
  });

  it('dtc_report → tanı niyeti geçirilir (canlı ölçüm dışarıda)', async () => {
    const c = caps();
    await runOperatorTask('dtc_report', c);
    expect(c.planAndExecute).toHaveBeenCalledWith('technical_analysis', { wantsDiagnostics: true, wantsLiveData: false });
  });

  it('diagnosis_summary → YENİ araç sorgusu YAPMAZ (plan çağrılmaz)', async () => {
    const c = caps();
    const r = await runOperatorTask('diagnosis_summary', c);
    expect(c.planAndExecute).not.toHaveBeenCalled();
    expect(c.mechanicBlock).toHaveBeenCalled();
    expect(r.block).toMatch(/AI USTA BLOK/);
  });
});

/* ── 3/4) Onay kapısı ──────────────────────────────────────────────────────*/

describe('onay bekleyen işlemler otomatik çalıştırılmaz', () => {
  it('needs_confirmation adım pendingApprovals’a girer ve blokta listelenir', async () => {
    const c = caps({
      planAndExecute: vi.fn(async () => planRes({
        plan: plan([
          step({ toolName: 'get_vehicle_live_summary', effect: 'read', status: 'ready' }),
          step({ order: 2, toolName: 'clear_dtc_codes', effect: 'write', status: 'needs_confirmation', reason: 'task_requires_diagnostics' }),
        ]),
      })),
    });
    const r = await runOperatorTask('health_check', c);
    expect(r.pendingApprovals).toHaveLength(1);
    expect(r.pendingApprovals[0].toolName).toBe('clear_dtc_codes');
    expect(r.block).toMatch(/ONAY BEKLEYEN İŞLEM: clear_dtc_codes/);
    expect(r.telemetry.pendingApprovals).toBe(1);
  });

  it('collectPendingApprovals — yalnız needs_confirmation, deduplike', () => {
    const p = plan([
      step({ status: 'ready' }),
      step({ order: 2, toolName: 'write_x', effect: 'write', status: 'needs_confirmation' }),
      step({ order: 3, toolName: 'write_x', effect: 'write', status: 'needs_confirmation' }),
      step({ order: 4, toolName: 'nope', status: 'not_permitted' }),
    ]);
    const pending = collectPendingApprovals(p);
    expect(pending).toHaveLength(1);
    expect(pending[0].toolName).toBe('write_x');
  });
});

/* ── 6/7) Veri uydurma yok + fail-soft ─────────────────────────────────────*/

describe('dürüstlük ve fail-soft', () => {
  it('yetenekler boş dönerse blok BOŞ (uydurma yok)', async () => {
    const c = caps({
      planAndExecute: vi.fn(async () => planRes({ block: '', executed: 0 })),
      mechanicBlock:  vi.fn(() => ''),
    });
    const r = await runOperatorTask('health_check', c);
    expect(r.block).toBe('');
  });

  it('bir yetenek throw etse diğer bölüm korunur; ASLA throw etmez', async () => {
    const c = caps({ planAndExecute: vi.fn(async () => { throw new Error('boom'); }) });
    const r = await runOperatorTask('health_check', c);
    expect(r.block).toMatch(/AI USTA BLOK/);       // mechanic yine çalıştı
    expect(r.sections.some((s) => s.kind === 'plan_execution')).toBe(false);
  });
});

/* ── 8) Cancellation ───────────────────────────────────────────────────────*/

describe('iptal (cancellation) korunur', () => {
  it('signal.aborted → hiçbir bölüm çalıştırılmaz, blok boş', async () => {
    const c = caps();
    const r = await runOperatorTask('health_check', c, { signal: { aborted: true } as AbortSignal });
    expect(c.planAndExecute).not.toHaveBeenCalled();
    expect(c.mechanicBlock).not.toHaveBeenCalled();
    expect(r.block).toBe('');
  });
});

/* ── 9) Bounded birleştirme ────────────────────────────────────────────────*/

describe('assembleOperatorBlock — bounded', () => {
  const recipe = { label: 'Test', includeMechanic: false } as const;

  it('bütçe aşımında içerik sondan düşer, truncated true, onay satırı KORUNUR', () => {
    const big = 'x'.repeat(2000);
    const sections = [
      { kind: 'plan_execution' as const, status: 'executed' as const, block: big },
      { kind: 'mechanic' as const,       status: 'executed' as const, block: big },
    ];
    const pending = [{ toolName: 'write_x', effect: 'write' as const, reason: 'task_requires_diagnostics' as const }];
    const out = assembleOperatorBlock(recipe, sections, pending);
    expect(out.block.length).toBeLessThanOrEqual(MAX_OPERATOR_CHARS);
    expect(out.truncated).toBe(true);
    expect(out.block).toMatch(/ONAY BEKLEYEN İŞLEM: write_x/);   // onay her zaman korunur
  });

  it('içerik ve onay yoksa boş metin', () => {
    expect(assembleOperatorBlock(recipe, [], []).block).toBe('');
  });
});

/* ── 10/11) Concrete: fail-closed + timeout/iptal geçişi (mock'lu) ──────────*/

/* Bu blok her testte AĞIR bir modül grafiğini `vi.doMock` + dinamik import ile
   YENİDEN yükler. Depo büyüdükçe (444 test dosyası) tam suite altında ilk
   import 5 sn'lik varsayılan sınırı aşabiliyor — ölçüldü: izole koşumda
   geçiyor, tam suitede "Test timed out in 5000ms" ile düşüyordu. Sınır
   YÜKSELTİLDİ; iddia AYNEN korundu (kilit zayıflatılmadı). */
describe('runMaviOperator — fail-closed + alt katman geçişi', { timeout: 30_000 }, () => {
  beforeEach(() => { vi.resetModules(); });

  const emptyPlan: MaviPlan = { taskType: 'vehicle_question', steps: [], status: 'empty', truncated: false };

  const load = async (enabled: boolean, over: {
    planWithRouter?: unknown; executePlan?: unknown; mechanic?: string;
  } = {}) => {
    vi.doMock('../platform/ai/gateway/aiGatewayFlag', () => ({ isMaviOperatorEnabled: () => enabled }));
    vi.doMock('../platform/ai/planner/concrete/maviPlannerRuntime', () => ({
      planWithRouter: over.planWithRouter ?? (() => ({ plan: emptyPlan, router: {} })),
    }));
    vi.doMock('../platform/ai/planner/planExecutor', () => ({
      executePlan: over.executePlan ?? (async () => ({ block: 'EXEC', executed: 1, skipped: 0, failed: 0, telemetry: [] })),
    }));
    vi.doMock('../platform/ai/mechanic/concrete/maviMechanic', () => ({
      buildMechanicBlock: () => ({ block: over.mechanic ?? 'MECH' }),
    }));
    return import('../platform/ai/operator/concrete/maviOperator');
  };

  it('şalter KAPALI → boş rapor, enabled:false', async () => {
    const m = await load(false);
    const r = await m.runMaviOperator('health_check');
    expect(r.block).toBe('');
    expect(r.telemetry.enabled).toBe(false);
  });

  it('bilinmeyen görev → boş rapor (fail-closed)', async () => {
    const m = await load(true);
    // @ts-expect-error — bilinmeyen görev testi
    const r = await m.runMaviOperator('nope');
    expect(r.block).toBe('');
    expect(r.telemetry.enabled).toBe(false);
  });

  it('şalter AÇIK → mevcut katmanlar birleşir (EXEC + MECH)', async () => {
    const m = await load(true);
    const r = await m.runMaviOperator('health_check');
    expect(r.block).toMatch(/EXEC/);
    expect(r.block).toMatch(/MECH/);
    expect(r.telemetry.enabled).toBe(true);
  });

  it('timeout + signal alt yürütücüye AYNEN geçirilir', async () => {
    let captured: Record<string, unknown> | null = null;
    const executePlan = async (input: Record<string, unknown>) => {
      captured = input;
      return { block: 'EXEC', executed: 1, skipped: 0, failed: 0, telemetry: [] };
    };
    const ctrl = new AbortController();
    const m = await load(true, { executePlan });
    await m.runMaviOperator('health_check', { timeoutMs: 1234, signal: ctrl.signal });
    expect(captured).not.toBeNull();
    expect((captured as Record<string, unknown>).timeoutMs).toBe(1234);
    expect((captured as Record<string, unknown>).signal).toBe(ctrl.signal);
  });

  it('router null (planner kapalı/katalog boş) → plan bölümü boş, throw yok', async () => {
    const m = await load(true, { planWithRouter: () => ({ plan: emptyPlan, router: null }) });
    const r = await m.runMaviOperator('unified_report');
    expect(r.block).toMatch(/MECH/);              // mechanic yine gelir
    expect(r.sections.find((s) => s.kind === 'plan_execution')?.block).toBe('');
  });
});

/* ── 12) Yapısal kilitler ──────────────────────────────────────────────────*/

describe('yapısal kilitler', () => {
  const code = (p: string): string => readFileSync(p, 'utf8')
    .replace(new RegExp('/\\*[\\s\\S]*?\\*/', 'g'), ' ')
    .replace(new RegExp('(^|[^:])//.*$', 'gm'), '$1');

  const PURE = [
    'src/platform/ai/operator/operatorTypes.ts',
    'src/platform/ai/operator/operatorTasks.ts',
    'src/platform/ai/operator/operatorEngine.ts',
  ];
  const CONCRETE = 'src/platform/ai/operator/concrete/maviOperator.ts';
  const ALL = [...PURE, CONCRETE];

  it('YENİ MOTOR/ROUTER/PLANNER KURULMAZ — yalnız MEVCUT katmanlar', () => {
    for (const f of ALL) {
      const src = code(f);
      expect(src, f).not.toMatch(/createToolRouter|buildMaviPlan\(|new DiagnosticKnowledgeEngine|createVehicleMemoryStore/);
      expect(src, f).not.toMatch(/sendCommand|startOBD|getOBDDataSnapshot|readDTCCodes/);
      expect(src, f).not.toMatch(/fetch\(|new WebSocket/);
    }
  });

  it('concrete YALNIZ mevcut composition root’ları çağırır', () => {
    const src = code(CONCRETE);
    expect(src).toMatch(/planWithRouter/);
    expect(src).toMatch(/executePlan/);
    expect(src).toMatch(/buildMechanicBlock/);
  });

  it('saf katman: zaman/rastgelelik/log YOK', () => {
    for (const f of PURE) {
      const src = code(f);
      expect(src, f).not.toMatch(/Date\.now|Math\.random|new Date\(/);
      expect(src, f).not.toMatch(/console\./);
    }
  });

  it('motor ham JSON KULLANMAZ', () => {
    expect(code('src/platform/ai/operator/operatorEngine.ts')).not.toMatch(/JSON\.stringify/);
  });
});
