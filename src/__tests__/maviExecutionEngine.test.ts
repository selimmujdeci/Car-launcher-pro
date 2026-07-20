/**
 * maviExecutionEngine.test.ts — Mavi Çekirdeği Faz-1 · Çok-eylemli yürütme motoru sözleşmesi.
 *
 * KİLİTLENEN SÖZLEŞME:
 *  1. Sıralı/paralel mutlu yol → completed.
 *  2. Partial success: bir adım düşse de diğerleri çalışır (rollbackOnFailure yoksa).
 *  3. Bounded timeout: handler süreyi aşarsa 'timeout' (abort tetiklenir).
 *  4. Rollback yalnız reversible eylemlerde + rollbackOnFailure → başarısızlıkta geri alınır.
 *  5. Duplicate suppression: aynı imza dedupe penceresinde → 'duplicate'.
 *  6. Stale plan → 'rejected' (hiçbir adım çalışmaz).
 *  7. Bilinmeyen/geçersiz/denied/handler-yok fail-closed durumları.
 */
import { describe, it, expect, vi } from 'vitest';
import { createAiSafetyGate } from '../platform/aiCore/safetyGate';
import {
  createActionRegistry, validateEmpty, makeEnumValidator,
  type ActionDefinition,
} from '../platform/maviCore/actionRegistry';
import {
  createExecutionEngine, type ActionHandler, type MaviPlan,
} from '../platform/maviCore/executionEngine';

function baseDef(partial: Partial<ActionDefinition> & { id: string }): ActionDefinition {
  return {
    title: partial.id, risk: 'low', reversible: false, timeoutMs: 1000,
    resultContract: 'ack', validate: validateEmpty, ...partial,
  };
}

/** Tekil test tezgâhı: defter + gate + handler map + motor. */
function makeEngine(opts: {
  defs?: ActionDefinition[];
  handlers?: Record<string, ActionHandler>;
  now?: () => number;
  dedupeWindowMs?: number;
  currentGeneration?: () => number;
} = {}) {
  const registry = createActionRegistry();
  const defs = opts.defs ?? [
    baseDef({ id: 'ui.theme.set', reversible: true, validate: makeEnumValidator('theme', ['night', 'day']) }),
    baseDef({ id: 'media.play', reversible: true }),
    baseDef({ id: 'media.next', reversible: false }),
    baseDef({ id: 'vehicle.health.read', resultContract: 'value', vehicleScope: 'read' }),
  ];
  for (const d of defs) registry.register(d);
  const gate = createAiSafetyGate();
  const engine = createExecutionEngine({
    registry, gate,
    handlers: opts.handlers ?? {
      'ui.theme.set': () => ({ ok: true }),
      'media.play': () => ({ ok: true }),
      'media.next': () => ({ ok: true }),
      'vehicle.health.read': () => ({ ok: true, value: { dtcCount: 0 } }),
    },
    now: opts.now,
    dedupeWindowMs: opts.dedupeWindowMs,
    currentGeneration: opts.currentGeneration,
  });
  return { registry, gate, engine };
}

describe('MaviExecutionEngine — mutlu yol', () => {
  it('sıralı plan tüm adımlar başarılı → completed', async () => {
    const { engine } = makeEngine();
    const plan: MaviPlan = {
      mode: 'sequential',
      steps: [{ actionId: 'ui.theme.set', payload: { theme: 'night' } }, { actionId: 'media.play' }],
    };
    const r = await engine.executePlan(plan);
    expect(r.status).toBe('completed');
    expect(r.steps.map((s) => s.status)).toEqual(['ok', 'ok']);
  });

  it('paralel plan tüm adımlar başarılı → completed', async () => {
    const { engine } = makeEngine();
    const r = await engine.executePlan({
      mode: 'parallel',
      steps: [{ actionId: 'media.play' }, { actionId: 'media.next' }],
    });
    expect(r.status).toBe('completed');
  });

  it('value kontratı: handler değeri StepResult.value\'ya taşınır', async () => {
    const { engine } = makeEngine();
    const r = await engine.executePlan({ mode: 'sequential', steps: [{ actionId: 'vehicle.health.read' }] });
    expect(r.steps[0].value).toEqual({ dtcCount: 0 });
  });
});

describe('MaviExecutionEngine — partial success', () => {
  it('bir adım düşse de diğerleri çalışır (rollback yok) → partial', async () => {
    const { engine } = makeEngine({
      handlers: {
        'ui.theme.set': () => ({ ok: true }),
        'media.play': () => ({ ok: false, error: 'medya yok' }),
      },
    });
    const r = await engine.executePlan({
      mode: 'sequential',
      steps: [{ actionId: 'ui.theme.set', payload: { theme: 'day' } }, { actionId: 'media.play' }],
    });
    expect(r.status).toBe('partial');
    expect(r.steps.map((s) => s.status)).toEqual(['ok', 'failed']);
    expect(r.rolledBack).toBe(false);
  });

  it('tüm adımlar düşerse → failed', async () => {
    const { engine } = makeEngine({
      handlers: { 'media.play': () => ({ ok: false }), 'media.next': () => { throw new Error('x'); } },
    });
    const r = await engine.executePlan({
      mode: 'parallel', steps: [{ actionId: 'media.play' }, { actionId: 'media.next' }],
    });
    expect(r.status).toBe('failed');
  });
});

describe('MaviExecutionEngine — bounded timeout', () => {
  it('handler süreyi aşarsa timeout + abort sinyali tetiklenir', async () => {
    let aborted = false;
    const { engine } = makeEngine({
      defs: [baseDef({ id: 'slow.op', timeoutMs: 25 })],
      handlers: {
        'slow.op': (_p, signal) => new Promise((resolve) => {
          signal.addEventListener('abort', () => { aborted = true; resolve({ ok: true }); });
          // kasıtlı: kendiliğinden çözülmez, yalnız abort ile
        }),
      },
    });
    const r = await engine.executePlan({ mode: 'sequential', steps: [{ actionId: 'slow.op' }] });
    expect(r.steps[0].status).toBe('timeout');
    expect(aborted).toBe(true);
  });
});

describe('MaviExecutionEngine — rollback (yalnız reversible + rollbackOnFailure)', () => {
  it('sıralı atomic: sonraki adım düşünce önceki reversible geri alınır', async () => {
    const undo = vi.fn();
    const { engine } = makeEngine({
      handlers: {
        'ui.theme.set': () => ({ ok: true, rollback: undo }), // reversible → rollback kaydedilir
        'media.play': () => ({ ok: false, error: 'düştü' }),
      },
    });
    const r = await engine.executePlan({
      mode: 'sequential', rollbackOnFailure: true,
      steps: [{ actionId: 'ui.theme.set', payload: { theme: 'night' } }, { actionId: 'media.play' }],
    });
    expect(r.status).toBe('failed');
    expect(r.rolledBack).toBe(true);
    expect(undo).toHaveBeenCalledOnce();
    expect(r.steps[0].status).toBe('rolled_back');
  });

  it('reversible=false eylem geri ALINMAZ (media.next rollback döndürse bile yok sayılır)', async () => {
    const undo = vi.fn();
    const { engine } = makeEngine({
      handlers: {
        'media.next': () => ({ ok: true, rollback: undo }), // def.reversible=false → rollback taşınmaz
        'media.play': () => ({ ok: false }),
      },
    });
    const r = await engine.executePlan({
      mode: 'sequential', rollbackOnFailure: true,
      steps: [{ actionId: 'media.next' }, { actionId: 'media.play' }],
    });
    expect(r.rolledBack).toBe(false);
    expect(undo).not.toHaveBeenCalled();
  });
});

describe('MaviExecutionEngine — duplicate suppression', () => {
  it('aynı imza dedupe penceresinde → ikinci duplicate', async () => {
    let clock = 1000;
    const { engine } = makeEngine({ now: () => clock, dedupeWindowMs: 1500 });
    const plan: MaviPlan = { mode: 'sequential', steps: [{ actionId: 'media.play' }] };
    const r1 = await engine.executePlan(plan);
    expect(r1.steps[0].status).toBe('ok');
    clock = 1500; // pencere içinde
    const r2 = await engine.executePlan(plan);
    expect(r2.steps[0].status).toBe('duplicate');
    clock = 3000; // pencere geçti
    const r3 = await engine.executePlan(plan);
    expect(r3.steps[0].status).toBe('ok');
  });

  it('farklı payload aynı eylem duplicate DEĞİL', async () => {
    let clock = 0;
    const { engine } = makeEngine({ now: () => clock });
    await engine.executePlan({ mode: 'sequential', steps: [{ actionId: 'ui.theme.set', payload: { theme: 'night' } }] });
    const r = await engine.executePlan({ mode: 'sequential', steps: [{ actionId: 'ui.theme.set', payload: { theme: 'day' } }] });
    expect(r.steps[0].status).toBe('ok');
  });
});

describe('MaviExecutionEngine — stale reddi', () => {
  it('plan kuşağı mevcut kuşakla uyuşmazsa rejected', async () => {
    const { engine } = makeEngine({ currentGeneration: () => 5 });
    const r = await engine.executePlan({ mode: 'sequential', generation: 3, steps: [{ actionId: 'media.play' }] });
    expect(r.status).toBe('rejected');
    expect(r.reason).toBe('stale_generation');
    expect(r.steps).toEqual([]);
  });

  it('kuşak eşleşirse çalışır', async () => {
    const { engine } = makeEngine({ currentGeneration: () => 5 });
    const r = await engine.executePlan({ mode: 'sequential', generation: 5, steps: [{ actionId: 'media.play' }] });
    expect(r.status).toBe('completed');
  });
});

describe('MaviExecutionEngine — fail-closed durumlar', () => {
  it('bilinmeyen eylem → unknown_action', async () => {
    const { engine } = makeEngine();
    const r = await engine.executePlan({ mode: 'sequential', steps: [{ actionId: 'yok.olan' }] });
    expect(r.steps[0].status).toBe('unknown_action');
  });

  it('geçersiz payload → invalid', async () => {
    const { engine } = makeEngine();
    const r = await engine.executePlan({ mode: 'sequential', steps: [{ actionId: 'ui.theme.set', payload: { theme: 'mor' } }] });
    expect(r.steps[0].status).toBe('invalid');
  });

  it('handler yoksa → no_handler', async () => {
    const { engine } = makeEngine({ handlers: {} });
    const r = await engine.executePlan({ mode: 'sequential', steps: [{ actionId: 'media.play' }] });
    expect(r.steps[0].status).toBe('no_handler');
  });

  it('araç kapısı reddederse → denied (clear_dtc varsayılan gate\'te kapalı)', async () => {
    const { engine } = makeEngine({
      defs: [baseDef({ id: 'dtc.clear', vehicleScope: 'clear_dtc' })],
      handlers: { 'dtc.clear': () => ({ ok: true }) },
    });
    const r = await engine.executePlan({ mode: 'sequential', steps: [{ actionId: 'dtc.clear' }] });
    expect(r.steps[0].status).toBe('denied');
  });

  it('orta risk onaysız → needs_confirmation', async () => {
    const { engine } = makeEngine({
      defs: [baseDef({ id: 'risky.op', risk: 'medium' })],
      handlers: { 'risky.op': () => ({ ok: true }) },
    });
    const r1 = await engine.executePlan({ mode: 'sequential', steps: [{ actionId: 'risky.op' }] });
    expect(r1.steps[0].status).toBe('needs_confirmation');
    const r2 = await engine.executePlan({ mode: 'sequential', steps: [{ actionId: 'risky.op', confirmed: true }] });
    expect(r2.steps[0].status).toBe('ok');
  });

  it('boş plan → rejected', async () => {
    const { engine } = makeEngine();
    const r = await engine.executePlan({ mode: 'sequential', steps: [] });
    expect(r.status).toBe('rejected');
    expect(r.reason).toBe('empty_plan');
  });
});
