/**
 * navActions.test.ts — MAVİ 4.0 · DRIVE-1 · uygulama navigasyonu eylem katmanı sözleşmesi.
 *
 * KİLİTLENEN KURALLAR:
 *  - Touch ve Voice AYNI Action Registry + AYNI engine + AYNI navigator üzerinden gider.
 *  - typed input/output · rollback (reversible) · timeout · cancel (stale) · ownership · diagnostic.
 *  - Fail-closed: bilinmeyen eylem yürütülmez; ekran bulunamazsa mevcut ekran bozulmaz.
 *  - AiSafetyGate korunur (UI eylemi araç kapısına dokunmaz; bilinmeyen fail-closed reddedilir).
 *  - Diagnostic PASS/FAIL üretmez — olgusal kategori.
 */

import { describe, it, expect } from 'vitest';
import {
  createAppNavigationActions,
  buildNavActionDefinitions, createNavHandlers, navActionIdForScreen,
  navErrorCategory, NAV_HOME_ID, NAV_BACK_ID,
  type NavPort,
} from '../platform/maviCore/navActions';
import { createActionRegistry } from '../platform/maviCore/actionRegistry';
import { createExecutionEngine, type MaviPlan } from '../platform/maviCore/executionEngine';
import type { AiSafetyGate } from '../platform/aiCore/safetyGate';

const SCREENS = ['settings', 'dtc', 'music'] as const;

/** Araç kapsamsız eylemlerde çağrılmaması gereken gate (spy). */
function spyGate(): { gate: AiSafetyGate; calls: () => number } {
  let n = 0;
  const gate = { evaluate: () => { n++; return { allowed: true, reason: 'ok' }; } } as unknown as AiSafetyGate;
  return { gate, calls: () => n };
}

function fakePort(known: readonly string[] = SCREENS): { port: NavPort; log: string[] } {
  const set = new Set(known);
  const log: string[] = [];
  const port: NavPort = {
    openScreenById: (id) => { log.push(`open:${id}`); return set.has(id); },
    closeToHome: () => { log.push('home'); },
  };
  return { port, log };
}

function mkNav(over: Partial<Parameters<typeof createAppNavigationActions>[0]> = {}) {
  const { gate } = spyGate();
  const { port, log } = fakePort();
  const nav = createAppNavigationActions({
    gate, port, screenIds: [...SCREENS], dedupeWindowMs: 0, ...over,
  });
  return { nav, log };
}

/* ── Registry testleri ────────────────────────────────────────── */

describe('registry', () => {
  it('her ekran için open.<id> + open.home + go.back kaydedilir (sıralı)', () => {
    const { nav } = mkNav();
    const ids = nav.ids();
    for (const s of SCREENS) expect(ids).toContain(`open.${s}`);
    expect(ids).toContain(NAV_HOME_ID);
    expect(ids).toContain(NAV_BACK_ID);
    expect(nav.has('open.settings')).toBe(true);
    expect(ids).toEqual([...ids].sort()); // deterministik
  });

  it('tanımlar typed: open.<screen> reversible, home/back tek-yön, hiçbiri araç kapsamı taşımaz', () => {
    const defs = buildNavActionDefinitions(['settings']);
    const open = defs.find((d) => d.id === 'open.settings');
    expect(open).toMatchObject({ risk: 'low', reversible: true, resultContract: 'ack' });
    expect(open?.vehicleScope).toBeUndefined();
    expect(defs.find((d) => d.id === NAV_HOME_ID)?.reversible).toBe(false);
    expect(defs.find((d) => d.id === NAV_BACK_ID)?.reversible).toBe(false);
  });

  it('yinelenen screenId tanımları tekilleştirir (çift kayıt Error atmaz)', () => {
    expect(() => createAppNavigationActions({
      gate: spyGate().gate, port: fakePort().port, screenIds: ['settings', 'settings'], dedupeWindowMs: 0,
    })).not.toThrow();
  });
});

/* ── Duplicate registration testleri ──────────────────────────── */

describe('duplicate registration', () => {
  it('aynı tanımı iki kez kaydetmek kurulum-zamanı Error verir (fail-closed)', () => {
    const reg = createActionRegistry();
    const defs = buildNavActionDefinitions(['settings']);
    for (const d of defs) reg.register(d);
    expect(() => reg.register(defs[0])).toThrow(/çift kayıt/);
  });
});

/* ── Navigation action testleri ───────────────────────────────── */

describe('navigation actions', () => {
  it('open.<screen> MEVCUT navigator ile ekranı açar → completed + diagnostic', async () => {
    const { nav, log } = mkNav();
    const { result, diagnostic } = await nav.open('settings', 'touch');
    expect(log).toContain('open:settings');
    expect(result.status).toBe('completed');
    expect(result.steps[0].status).toBe('ok');
    expect(diagnostic).toMatchObject({ actionId: 'open.settings', ownership: 'touch', errorCategory: 'none', cancelReason: null });
    expect(diagnostic.correlationId.startsWith('nav.touch.open.settings#')).toBe(true);
    expect(diagnostic.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('home ve back ana ekrana döndürür (drawer kapatma)', async () => {
    const { nav, log } = mkNav();
    await nav.home('voice');
    await nav.back('touch');
    expect(log.filter((l) => l === 'home')).toHaveLength(2);
  });

  it('ekran KAYITLI ama navigator bulamazsa mevcut ekran BOZULMAZ (ok:false, rollback yok)', async () => {
    // 'music' eylem olarak kayıtlı, ama port çalışma-zamanında bulamıyor (known set dışında).
    const { gate } = spyGate();
    const { port, log } = fakePort(['settings', 'dtc']); // music YOK
    const nav = createAppNavigationActions({ gate, port, screenIds: [...SCREENS], dedupeWindowMs: 0 });
    const { result, diagnostic } = await nav.open('music', 'voice');
    expect(result.steps[0].status).toBe('failed');
    expect(diagnostic.errorCategory).toBe('handler_error');
    expect(log).toEqual(['open:music']); // closeToHome ÇAĞRILMADI
  });
});

/* ── Unknown action testleri (fail-closed) ───────────────────── */

describe('unknown action', () => {
  it('kayıtlı olmayan eylem yürütülmez → unknown_action, navigator dokunulmaz', async () => {
    const { nav, log } = mkNav();
    const { result, diagnostic } = await nav.dispatch('open.nope', 'voice');
    expect(result.steps[0].status).toBe('unknown_action');
    expect(diagnostic.errorCategory).toBe('unknown_action');
    expect(log).toHaveLength(0);
  });

  it('tamamen bozuk actionId → unknown_action (uydurma çalışma yok)', async () => {
    const { nav, log } = mkNav();
    const { diagnostic } = await nav.dispatch('foo.bar', 'touch');
    expect(diagnostic.errorCategory).toBe('unknown_action');
    expect(log).toHaveLength(0);
  });
});

/* ── Touch == Voice (aynı registry/engine/navigator) ──────────── */

describe('touch == voice parity', () => {
  it('touch ve voice AYNI eylemi AYNI registry/navigator ile çalıştırır', async () => {
    const { nav, log } = mkNav();
    const t = await nav.open('dtc', 'touch');
    const v = await nav.open('dtc', 'voice');
    expect(log).toEqual(['open:dtc', 'open:dtc']);          // ikisi de aynı navigator'ı çağırdı
    expect(t.result.status).toBe('completed');
    expect(v.result.status).toBe('completed');
    expect(t.diagnostic.ownership).toBe('touch');
    expect(v.diagnostic.ownership).toBe('voice');
    expect(t.diagnostic.actionId).toBe(v.diagnostic.actionId); // AYNI action
  });

  it('paylaşılan engine dedupe eder: aynı eylem penceresinde ikinci tetik duplicate', async () => {
    const { nav, log } = mkNav({ dedupeWindowMs: 1_500, now: () => 1_000 });
    await nav.open('music', 'touch');
    const second = await nav.open('music', 'voice'); // aynı pencere → çift-tetik korunur
    expect(second.result.steps[0].status).toBe('duplicate');
    expect(second.diagnostic.errorCategory).toBe('duplicate');
    expect(log).toEqual(['open:music']); // navigator YALNIZ bir kez çağrıldı
  });
});

/* ── Cancel testleri (stale-generation / timeout kategorisi) ──── */

describe('cancel', () => {
  it('stale generation → plan reddedilir, navigator dokunulmaz, cancelReason=stale_generation', async () => {
    const { nav, log } = mkNav({ currentGeneration: () => 5 });
    const { result, diagnostic } = await nav.open('settings', 'voice', { generation: 3 });
    expect(result.status).toBe('rejected');
    expect(diagnostic.cancelReason).toBe('stale_generation');
    expect(diagnostic.errorCategory).toBe('stale_or_empty');
    expect(log).toHaveLength(0);
  });

  it('kuşak uyuşuyorsa normal çalışır', async () => {
    const { nav, log } = mkNav({ currentGeneration: () => 5 });
    const { result } = await nav.open('settings', 'voice', { generation: 5 });
    expect(result.status).toBe('completed');
    expect(log).toContain('open:settings');
  });

  it('timeout kategorisi olgusal eşlenir (motor def.timeoutMs ile keser)', async () => {
    // Nav handler'ları senkron/anlık — timeout yolu motor seviyesinde: yavaş handler + tiny timeout.
    const reg = createActionRegistry();
    reg.register({
      id: 'open.slow', title: 'yavaş', risk: 'low', reversible: true,
      timeoutMs: 1, resultContract: 'ack', validate: (): { ok: true; errors: []; value: Record<string, never> } => ({ ok: true, errors: [], value: {} }),
    });
    const engine = createExecutionEngine({
      registry: reg, gate: spyGate().gate, dedupeWindowMs: 0,
      handlers: { 'open.slow': () => new Promise((r) => setTimeout(() => r({ ok: true }), 50)) },
    });
    const res = await engine.executePlan({ mode: 'sequential', steps: [{ actionId: 'open.slow' }] });
    expect(res.steps[0].status).toBe('timeout');
    expect(navErrorCategory('timeout')).toBe('timeout');
  });
});

/* ── Rollback testleri (reversible → geri-alma = ana ekran) ───── */

describe('rollback', () => {
  it('rollbackOnFailure: başarılı open geri alınır (closeToHome çağrılır)', async () => {
    const { port, log } = fakePort(['settings']);
    const reg = createActionRegistry();
    for (const d of buildNavActionDefinitions(['settings'])) reg.register(d);
    const engine = createExecutionEngine({
      registry: reg, gate: spyGate().gate, dedupeWindowMs: 0,
      handlers: createNavHandlers(port, ['settings']),
    });
    // 1. adım open.settings (ok, reversible) · 2. adım bilinmeyen (hard failure) → rollback.
    const plan: MaviPlan = {
      mode: 'sequential', rollbackOnFailure: true,
      steps: [{ actionId: 'open.settings' }, { actionId: 'open.nonexistent' }],
    };
    const res = await engine.executePlan(plan);
    expect(res.rolledBack).toBe(true);
    expect(res.steps[0].status).toBe('rolled_back');
    expect(log).toContain('open:settings');
    expect(log).toContain('home'); // rollback = ana ekrana dön
  });

  it('tek-yön go.back rollback taşımaz', async () => {
    const { port } = fakePort();
    const handlers = createNavHandlers(port, ['settings']);
    const res = await handlers[NAV_BACK_ID]({}, new AbortController().signal);
    expect(res.ok).toBe(true);
    expect(res.rollback).toBeUndefined();
  });
});

/* ── Güvenlik (AiSafetyGate korunur) ─────────────────────────── */

describe('güvenlik', () => {
  it('UI nav eylemi araç kapısına dokunmaz (gate.evaluate çağrılmaz) ama yine de allow', async () => {
    const { gate, calls } = spyGate();
    const { port, log } = fakePort();
    const nav = createAppNavigationActions({ gate, port, screenIds: [...SCREENS], dedupeWindowMs: 0 });
    const { result } = await nav.open('settings', 'touch');
    expect(result.status).toBe('completed');
    expect(calls()).toBe(0); // araç kapsamı yok → gate araç kararına çağrılmadı
    expect(log).toContain('open:settings');
  });
});
