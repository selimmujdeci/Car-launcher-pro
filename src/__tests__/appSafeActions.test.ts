/**
 * appSafeActions.test.ts — MAVİ 4.0 · DRIVE-2 · güvenli ekran-içi uygulama eylemleri sözleşmesi.
 *
 * KİLİTLENEN KURALLAR:
 *  - Güvenli eylemler AYNI Action Registry + engine + dispatch üzerinden çalışır (nav ile birlikte).
 *  - Touch ve Voice AYNI action'ı kullanır.
 *  - typed input/output · timeout · cancel (stale) · rollback sözleşmesi · ownership · diagnostic.
 *  - Fail-closed: bilinmeyen eylem yürütülmez; geçersiz payload 'invalid'.
 *  - AiSafetyGate korunur (UI eylemi araç kapısına dokunmaz — araç kapsamı yok).
 *  - Hiçbiri araç/ECU/veri-yazan işlem değildir; hepsi tek-yön (reversible=false).
 */

import { describe, it, expect } from 'vitest';
import {
  createAppNavigationActions, type NavPort,
} from '../platform/maviCore/navActions';
import {
  buildSafeAppActionDefinitions, createSafeAppHandlers, SETTINGS_SECTIONS,
  SAFE_ACTION_REFRESH_DEVICE, SAFE_ACTION_DISMISS_TOAST, SAFE_ACTION_DISMISS_BREAK,
  SAFE_ACTION_FOCUS_SETTINGS, SAFE_ACTION_COPY_VALUE,
  type SafeAppPort,
} from '../platform/maviCore/appSafeActions';
import { createActionRegistry } from '../platform/maviCore/actionRegistry';
import { createExecutionEngine, type MaviPlan, type ActionHandler } from '../platform/maviCore/executionEngine';
import type { AiSafetyGate } from '../platform/aiCore/safetyGate';

function spyGate(): { gate: AiSafetyGate; calls: () => number } {
  let n = 0;
  const gate = { evaluate: () => { n++; return { allowed: true, reason: 'ok' }; } } as unknown as AiSafetyGate;
  return { gate, calls: () => n };
}

const navPort: NavPort = { openScreenById: () => true, closeToHome: () => { /* noop */ } };

function fakeSafePort(): { port: SafeAppPort; log: string[] } {
  const log: string[] = [];
  const port: SafeAppPort = {
    refreshDeviceStatus: () => { log.push('refresh.device'); },
    dismissToast: (t) => { log.push(`toast:${t}`); },
    dismissBreakAlert: () => { log.push('break'); },
    dismissGeofenceAlert: () => { log.push('geofence'); },
    dismissNavPrompt: () => { log.push('navprompt'); },
    focusSettingsSection: (s) => { log.push(`focus:${s}`); },
    copyValue: async (v) => { log.push(`copy:${v}`); },
  };
  return { port, log };
}

function mkLayer(over: Partial<Parameters<typeof createAppNavigationActions>[0]> = {}) {
  const { port, log } = fakeSafePort();
  const nav = createAppNavigationActions({
    gate: spyGate().gate, port: navPort, screenIds: ['settings'], dedupeWindowMs: 0,
    extraDefinitions: buildSafeAppActionDefinitions(),
    extraHandlers: createSafeAppHandlers(port),
    ...over,
  });
  return { nav, log };
}

/* ── Registry testleri ────────────────────────────────────────── */

describe('registry (genişletilmiş)', () => {
  it('nav + güvenli eylemler AYNI registry\'de kayıtlı', () => {
    const { nav } = mkLayer();
    const ids = nav.ids();
    expect(ids).toContain('open.settings');            // nav (DRIVE-1)
    expect(ids).toContain(SAFE_ACTION_REFRESH_DEVICE);  // safe (DRIVE-2)
    expect(ids).toContain(SAFE_ACTION_COPY_VALUE);
    expect(ids).toContain(SAFE_ACTION_FOCUS_SETTINGS);
    expect(ids).toEqual([...ids].sort());
  });

  it('güvenli tanımlar typed + araç kapsamsız + tek-yön', () => {
    const defs = buildSafeAppActionDefinitions();
    for (const d of defs) {
      expect(d.risk).toBe('low');
      expect(d.reversible).toBe(false);     // tek-yön (uydurma rollback yok)
      expect(d.vehicleScope).toBeUndefined(); // araç/ECU YOK
    }
    expect(defs.find((d) => d.id === SAFE_ACTION_COPY_VALUE)?.resultContract).toBe('value');
  });
});

/* ── Duplicate registration ───────────────────────────────────── */

describe('duplicate registration', () => {
  it('aynı güvenli tanımı iki kez kaydetmek Error verir (fail-closed)', () => {
    const reg = createActionRegistry();
    const defs = buildSafeAppActionDefinitions();
    for (const d of defs) reg.register(d);
    expect(() => reg.register(defs[0])).toThrow(/çift kayıt/);
  });
});

/* ── Unknown action (fail-closed) ─────────────────────────────── */

describe('unknown action', () => {
  it('kayıtlı olmayan güvenli eylem yürütülmez → unknown_action', async () => {
    const { nav } = mkLayer();
    const { diagnostic } = await nav.dispatch('refresh.nope', 'voice');
    expect(diagnostic.errorCategory).toBe('unknown_action');
  });
});

/* ── Typed input validation ───────────────────────────────────── */

describe('typed input validation', () => {
  it('focus.settings_section geçerli enum → ok; geçersiz → invalid', async () => {
    const { nav, log } = mkLayer();
    const good = await nav.dispatch(SAFE_ACTION_FOCUS_SETTINGS, 'touch', { payload: { section: SETTINGS_SECTIONS[0] } });
    expect(good.result.steps[0].status).toBe('ok');
    expect(log).toContain(`focus:${SETTINGS_SECTIONS[0]}`);

    const bad = await nav.dispatch(SAFE_ACTION_FOCUS_SETTINGS, 'voice', { payload: { section: 'ecu-tuning' } });
    expect(bad.result.steps[0].status).toBe('invalid');
    expect(bad.diagnostic.errorCategory).toBe('invalid_payload');
  });

  it('dismiss.toast title zorunlu; eksikse invalid', async () => {
    const { nav, log } = mkLayer();
    const miss = await nav.dispatch(SAFE_ACTION_DISMISS_TOAST, 'voice', { payload: {} });
    expect(miss.result.steps[0].status).toBe('invalid');
    const okr = await nav.dispatch(SAFE_ACTION_DISMISS_TOAST, 'touch', { payload: { title: 'OBD Bağlantısı' } });
    expect(okr.result.steps[0].status).toBe('ok');
    expect(log).toContain('toast:OBD Bağlantısı');
  });

  it('copy.value değer zorunlu; eksikse invalid (navigator dokunulmaz)', async () => {
    const { nav, log } = mkLayer();
    const miss = await nav.dispatch(SAFE_ACTION_COPY_VALUE, 'voice', { payload: { value: '' } });
    expect(miss.result.steps[0].status).toBe('invalid');
    expect(log).toHaveLength(0);
  });
});

/* ── Typed output validation ──────────────────────────────────── */

describe('typed output validation', () => {
  it('copy.value typed OUTPUT taşır (yalnız uzunluk — ham değer/PII yok)', async () => {
    const { nav, log } = mkLayer();
    const { result } = await nav.dispatch(SAFE_ACTION_COPY_VALUE, 'touch', { payload: { value: 'ABC123' } });
    expect(result.steps[0].status).toBe('ok');
    expect(result.steps[0].value).toEqual({ length: 6 });
    expect(log).toContain('copy:ABC123');
  });
});

/* ── Touch == Voice parity ────────────────────────────────────── */

describe('touch == voice parity', () => {
  it('touch ve voice AYNI güvenli eylemi AYNI servisle çalıştırır', async () => {
    const { nav, log } = mkLayer();
    const t = await nav.dispatch(SAFE_ACTION_REFRESH_DEVICE, 'touch');
    const v = await nav.dispatch(SAFE_ACTION_REFRESH_DEVICE, 'voice');
    expect(log).toEqual(['refresh.device', 'refresh.device']);
    expect(t.result.status).toBe('completed');
    expect(v.result.status).toBe('completed');
    expect(t.diagnostic.ownership).toBe('touch');
    expect(v.diagnostic.ownership).toBe('voice');
    expect(t.diagnostic.actionId).toBe(v.diagnostic.actionId);
  });
});

/* ── Cancel (stale-generation) ────────────────────────────────── */

describe('cancel', () => {
  it('stale generation → reddedilir, servis dokunulmaz, cancelReason=stale_generation', async () => {
    const { nav, log } = mkLayer({ currentGeneration: () => 9 });
    const { result, diagnostic } = await nav.dispatch(SAFE_ACTION_DISMISS_BREAK, 'voice', { generation: 4 });
    expect(result.status).toBe('rejected');
    expect(diagnostic.cancelReason).toBe('stale_generation');
    expect(log).toHaveLength(0);
  });
});

/* ── Timeout ──────────────────────────────────────────────────── */

describe('timeout', () => {
  it('def.timeoutMs aşılırsa adım timeout (motor AbortSignal ile keser)', async () => {
    const reg = createActionRegistry();
    reg.register({
      id: SAFE_ACTION_REFRESH_DEVICE, title: 'yavaş', risk: 'low', reversible: false,
      timeoutMs: 1, resultContract: 'ack', validate: (): { ok: true; errors: []; value: Record<string, never> } => ({ ok: true, errors: [], value: {} }),
    });
    const slow: ActionHandler = () => new Promise((r) => setTimeout(() => r({ ok: true }), 60));
    const engine = createExecutionEngine({
      registry: reg, gate: spyGate().gate, dedupeWindowMs: 0, handlers: { [SAFE_ACTION_REFRESH_DEVICE]: slow },
    });
    const res = await engine.executePlan({ mode: 'sequential', steps: [{ actionId: SAFE_ACTION_REFRESH_DEVICE }] });
    expect(res.steps[0].status).toBe('timeout');
  });
});

/* ── Rollback sözleşmesi ──────────────────────────────────────── */

describe('rollback', () => {
  it('tek-yön güvenli eylem geri alınmaz (reversible=false → rolled_back OLMAZ)', async () => {
    const { port, log } = fakeSafePort();
    const reg = createActionRegistry();
    for (const d of buildSafeAppActionDefinitions()) reg.register(d);
    const engine = createExecutionEngine({
      registry: reg, gate: spyGate().gate, dedupeWindowMs: 0, handlers: createSafeAppHandlers(port),
    });
    const plan: MaviPlan = {
      mode: 'sequential', rollbackOnFailure: true,
      steps: [{ actionId: SAFE_ACTION_DISMISS_BREAK }, { actionId: 'unknown.x' }],
    };
    const res = await engine.executePlan(plan);
    expect(res.rolledBack).toBe(false);            // tek-yön → geri-alma YOK
    expect(res.steps[0].status).toBe('ok');        // 'rolled_back' DEĞİL
    expect(log).toEqual(['break']);                // yalnız bir kez, geri alınmadı
  });

  it('genişletilmiş registry rollback mekanizmasını KORUR (reversible eylem geri alınır)', async () => {
    let rolledBack = false;
    const { port } = fakeSafePort();
    const reg = createActionRegistry();
    for (const d of buildSafeAppActionDefinitions()) reg.register(d);
    reg.register({
      id: 'test.reversible', title: 'test', risk: 'low', reversible: true,
      timeoutMs: 1_000, resultContract: 'ack',
      validate: (): { ok: true; errors: []; value: Record<string, never> } => ({ ok: true, errors: [], value: {} }),
    });
    const handlers: Record<string, ActionHandler> = {
      ...createSafeAppHandlers(port),
      'test.reversible': () => ({ ok: true, rollback: () => { rolledBack = true; } }),
    };
    const engine = createExecutionEngine({ registry: reg, gate: spyGate().gate, dedupeWindowMs: 0, handlers });
    const res = await engine.executePlan({
      mode: 'sequential', rollbackOnFailure: true,
      steps: [{ actionId: 'test.reversible' }, { actionId: 'unknown.x' }],
    });
    expect(res.rolledBack).toBe(true);
    expect(res.steps[0].status).toBe('rolled_back');
    expect(rolledBack).toBe(true);
  });
});

/* ── Güvenlik (AiSafetyGate korunur) ─────────────────────────── */

describe('güvenlik', () => {
  it('güvenli UI eylemi araç kapısına dokunmaz (gate.evaluate çağrılmaz) ama allow', async () => {
    const { gate, calls } = spyGate();
    const { port, log } = fakeSafePort();
    const nav = createAppNavigationActions({
      gate, port: navPort, screenIds: ['settings'], dedupeWindowMs: 0,
      extraDefinitions: buildSafeAppActionDefinitions(),
      extraHandlers: createSafeAppHandlers(port),
    });
    const { result } = await nav.dispatch(SAFE_ACTION_DISMISS_BREAK, 'touch');
    expect(result.status).toBe('completed');
    expect(calls()).toBe(0);
    expect(log).toContain('break');
  });
});
