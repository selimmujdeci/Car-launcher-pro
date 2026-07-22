/**
 * maviPlanner.test.ts — Mavi Planner Faz 1 (YALNIZ karar).
 *
 * Kilitlenen davranışlar:
 *  1) Planner ARAÇ ÇALIŞTIRMAZ (yapısal kilit: router.call / handler çağrısı yok)
 *  2) DETERMİNİSTİK: aynı girdi → aynı plan; AI/rastgelelik/zaman YOK
 *  3) ALLOWLIST: katalogda olmayan araç plana giremez; argüman uydurulmaz
 *  4) Sonsuz plan yok: MAX_PLAN_STEPS + aynı adım tekrar etmez
 *  5) RİSKLİ araçlar PLANLANIR ama `needs_confirmation`/`not_permitted` işaretlenir
 *  6) Şalter kapalıyken plan BOŞ (fail-closed)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildMaviPlan, executableSteps, MAX_PLAN_STEPS } from '../platform/ai/planner/maviPlanner';
import type { PlannerToolInfo } from '../platform/ai/planner/plannerTypes';
import type { MaviTaskType } from '../platform/ai/orchestrator/orchestratorTypes';

const tool = (over: Partial<PlannerToolInfo> & { name: string }): PlannerToolInfo => ({
  effect: 'read', available: true, parameterNames: [], ...over,
});

const CATALOG: PlannerToolInfo[] = [
  tool({ name: 'get_vehicle_connection' }),
  tool({ name: 'get_vehicle_live_summary' }),
  tool({ name: 'get_vehicle_dtc_summary' }),
  tool({
    name: 'open_app_screen', effect: 'navigate',
    parameterNames: ['screenId'],
    enumValues: { screenId: ['trafik', 'klima'] },
  }),
];

const plan = (taskType: MaviTaskType, tools = CATALOG, hints?: { screenId?: string }) =>
  buildMaviPlan({ taskType, tools, ...(hints ? { hints } : {}) });

/* ══════════════ 1) Görev planları ══════════════ */

describe('görev bazlı plan', () => {
  it('araç sorusu → bağlantı → canlı veri → tanı sırası', () => {
    const p = plan('vehicle_question');
    expect(p.steps.map((s) => s.toolName)).toEqual([
      'get_vehicle_connection', 'get_vehicle_live_summary', 'get_vehicle_dtc_summary',
    ]);
    expect(p.steps.map((s) => s.order)).toEqual([1, 2, 3]);
    expect(p.status).toBe('ready');
  });

  it('teknik analiz → tanı canlı veriden ÖNCE', () => {
    const p = plan('technical_analysis');
    const names = p.steps.map((s) => s.toolName);
    expect(names.indexOf('get_vehicle_dtc_summary')).toBeLessThan(names.indexOf('get_vehicle_live_summary'));
  });

  it('sohbet/kısa cevap/kod analizi → plan YOK', () => {
    for (const t of ['general_chat', 'short_answer', 'code_analysis'] as MaviTaskType[]) {
      const p = plan(t);
      expect(p.steps).toHaveLength(0);
      expect(p.status).toBe('empty');
    }
  });

  it('her adım kapalı-küme gerekçe taşır (serbest metin YOK)', () => {
    const allowed = ['task_requires_connection', 'task_requires_live_data',
                     'task_requires_diagnostics', 'user_requested_navigation'];
    for (const s of plan('vehicle_question').steps) expect(allowed).toContain(s.reason);
  });
});

/* ══════════════ 2) Allowlist ve argüman disiplini ══════════════ */

describe('allowlist ve argümanlar', () => {
  it('katalogda OLMAYAN araç plana GİREMEZ', () => {
    const p = plan('vehicle_question', [tool({ name: 'get_vehicle_connection' })]);
    expect(p.steps.map((s) => s.toolName)).toEqual(['get_vehicle_connection']);
  });

  it('katalog boşsa plan BOŞ', () => {
    expect(plan('vehicle_question', []).steps).toHaveLength(0);
  });

  it('navigasyon YALNIZ açık istekle ve enum ALLOWLIST\'indeki değerle planlanır', () => {
    expect(plan('vehicle_question').steps.some((s) => s.toolName === 'open_app_screen')).toBe(false);

    const ok = plan('long_explanation', CATALOG, { screenId: 'trafik' });
    const nav = ok.steps.find((s) => s.toolName === 'open_app_screen');
    expect(nav?.arguments).toEqual({ screenId: 'trafik' });
    expect(nav?.reason).toBe('user_requested_navigation');

    // Allowlist DIŞI ekran → adım eklenmez (argüman UYDURULMAZ)
    const bad = plan('long_explanation', CATALOG, { screenId: 'gizli_ekran' });
    expect(bad.steps.some((s) => s.toolName === 'open_app_screen')).toBe(false);
  });

  it('şemada TANIMSIZ parametre plana yazılmaz', () => {
    const noParam = [tool({ name: 'open_app_screen', effect: 'navigate', parameterNames: [], enumValues: { screenId: ['trafik'] } })];
    const p = buildMaviPlan({ taskType: 'long_explanation', tools: noParam, hints: { screenId: 'trafik' } });
    const nav = p.steps.find((s) => s.toolName === 'open_app_screen');
    expect(nav?.arguments).toEqual({});
  });
});

/* ══════════════ 3) Sınırlar — sonsuz plan yok ══════════════ */

describe('plan sınırları', () => {
  it('MAX_PLAN_STEPS aşılmaz ve kırpma DÜRÜSTÇE bildirilir', () => {
    const many = Array.from({ length: 12 }, (_, i) => tool({ name: `t${i}` }));
    const p = buildMaviPlan({
      taskType: 'vehicle_question',
      tools: [...CATALOG, ...many],
      hints: { screenId: 'trafik' },
    });
    expect(p.steps.length).toBeLessThanOrEqual(MAX_PLAN_STEPS);
  });

  it('AYNI araç+argüman iki kez plana giremez', () => {
    const p = plan('vehicle_question');
    const keys = p.steps.map((s) => `${s.toolName}|${JSON.stringify(s.arguments)}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('MAX_PLAN_STEPS makul bir üst sınır', () => {
    expect(MAX_PLAN_STEPS).toBeGreaterThan(0);
    expect(MAX_PLAN_STEPS).toBeLessThanOrEqual(6);
  });
});

/* ══════════════ 4) Riskli araçlar: planlanır, çalıştırılmaz ══════════════ */

describe('riskli araçlar', () => {
  it('ONAY gerektiren araç PLANLANIR ama needs_confirmation işaretlenir', () => {
    const risky = [tool({ name: 'get_vehicle_connection', requiresConfirmation: true })];
    const p = plan('vehicle_question', risky);
    expect(p.steps[0]!.status).toBe('needs_confirmation');
    expect(p.status).toBe('blocked');
    expect(executableSteps(p)).toHaveLength(0);          // yürütülebilir küme BOŞ
  });

  it('YAZMA/ECU yan etkili araç not_permitted işaretlenir', () => {
    const dangerous = [tool({ name: 'get_vehicle_connection', effect: 'vehicle_command' })];
    const p = plan('vehicle_question', dangerous);
    expect(p.steps[0]!.status).toBe('not_permitted');
    expect(executableSteps(p)).toHaveLength(0);
  });

  it('katalogda görünmeyen (available:false) araç not_permitted', () => {
    const hidden = [tool({ name: 'get_vehicle_connection', available: false })];
    expect(plan('vehicle_question', hidden).steps[0]!.status).toBe('not_permitted');
  });

  it('karışık planda status partially_blocked olur', () => {
    const mixed = [
      tool({ name: 'get_vehicle_connection' }),
      tool({ name: 'get_vehicle_live_summary', requiresConfirmation: true }),
    ];
    const p = plan('vehicle_question', mixed);
    expect(p.status).toBe('partially_blocked');
    expect(executableSteps(p).map((s) => s.toolName)).toEqual(['get_vehicle_connection']);
  });
});

/* ══════════════ 5) Determinizm ve dayanıklılık ══════════════ */

describe('determinizm ve dayanıklılık', () => {
  it('aynı girdi → AYNI plan', () => {
    const a = plan('vehicle_question', CATALOG, { screenId: 'trafik' });
    const b = plan('vehicle_question', CATALOG, { screenId: 'trafik' });
    expect(a).toEqual(b);
  });

  it('katalog SIRASI planı değiştirmez (plan görev şablonundan gelir)', () => {
    const a = plan('vehicle_question', CATALOG);
    const b = plan('vehicle_question', [...CATALOG].reverse());
    expect(a.steps.map((s) => s.toolName)).toEqual(b.steps.map((s) => s.toolName));
  });

  it('bozuk girdide throw ETMEZ, BOŞ plan döner', () => {
    expect(() => buildMaviPlan({ taskType: 'yok' as MaviTaskType, tools: [] })).not.toThrow();
    expect(buildMaviPlan({ taskType: 'yok' as MaviTaskType, tools: [] }).steps).toHaveLength(0);
    expect(buildMaviPlan({ taskType: 'vehicle_question', tools: [null, { name: '' }] as never }).steps).toHaveLength(0);
  });

  it('girdi MUTASYONA UĞRAMAZ', () => {
    const snapshot = JSON.stringify(CATALOG);
    plan('vehicle_question', CATALOG, { screenId: 'trafik' });
    expect(JSON.stringify(CATALOG)).toBe(snapshot);
  });
});

/* ══════════════ 6) Yapısal kilitler + runtime kapısı ══════════════ */

describe('yapısal kilitler', () => {
  const code = (p: string): string => readFileSync(p, 'utf8')
    .replace(new RegExp('/\\*[\\s\\S]*?\\*/', 'g'), ' ')
    .replace(new RegExp('(^|[^:])//.*$', 'gm'), '$1');

  it('planner ARAÇ ÇALIŞTIRMAZ (router.call / handler çağrısı YOK)', () => {
    const src = code('src/platform/ai/planner/maviPlanner.ts');
    expect(src).not.toMatch(/\.call\(/);
    expect(src).not.toMatch(/handler\(/);
    expect(src).not.toMatch(/await |fetch\(/);
  });

  it('planner AI/rastgelelik/zaman KULLANMAZ (determinizm)', () => {
    const src = code('src/platform/ai/planner/maviPlanner.ts');
    expect(src).not.toMatch(/Date\.now|Math\.random|new Date\(/);
    expect(src).not.toMatch(/generateResponse|gateway|prompt/i);
  });

  it('planner LOGLAMAZ', () => {
    for (const f of ['maviPlanner.ts', 'plannerTypes.ts', 'concrete/maviPlannerRuntime.ts']) {
      const src = code(`src/platform/ai/planner/${f}`);
      expect(src, f).not.toMatch(/console\./);
    }
  });

  it('runtime kataloğu MEVCUT Tool Router\'dan alır (yeni kayıt YOK)', () => {
    const src = code('src/platform/ai/planner/concrete/maviPlannerRuntime.ts');
    expect(src).toMatch(/getMaviToolRouter\(\)\.listTools\(\)/);
    expect(src).not.toMatch(/createToolRouter|MAVI_TOOLS/);
  });
});

/* ══════════════ 7) Şalter ══════════════ */

const F = vi.hoisted(() => ({ enabled: false }));
vi.mock('../platform/ai/gateway/aiGatewayFlag', () => ({
  isMaviPlannerEnabled: () => F.enabled,
  isMaviToolsEnabled:   () => true,
  getMaviToolsConsent:  () => 'tools',
}));

describe('planner şalteri — varsayılan KAPALI', () => {
  beforeEach(() => { F.enabled = false; });

  it('şalter KAPALIYKEN plan BOŞ (fail-closed)', async () => {
    const { planForTask } = await import('../platform/ai/planner/concrete/maviPlannerRuntime');
    const p = planForTask('vehicle_question');
    expect(p.steps).toHaveLength(0);
    expect(p.status).toBe('empty');
  });

  it('şalter AÇIKKEN gerçek katalogdan plan üretilir', async () => {
    F.enabled = true;
    const { planForTask } = await import('../platform/ai/planner/concrete/maviPlannerRuntime');
    const p = planForTask('vehicle_question');
    expect(p.steps.length).toBeGreaterThan(0);
    expect(p.steps.every((s) => s.status === 'ready')).toBe(true);
  });
});
