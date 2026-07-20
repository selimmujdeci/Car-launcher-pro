/**
 * maviOrchestrator.test.ts — Mavi Çekirdeği Faz-1 · Orkestratör uçtan-uca sözleşmesi (mock portlar).
 *
 * KİLİTLENEN SÖZLEŞME:
 *  1. Tam tur: wake→listen→capture→execute→speak→finish doğru lifecycle geçişleri üretir.
 *  2. Yürütme başarılı adımları bağlamı günceller (lastAction/lastScreen/turn).
 *  3. Telemetri oturumu finish'te kaydedilir (segmentler türetilir).
 *  4. BARGE-IN/STALE: araya yeni tur girince eski turun planı motorda stale reddedilir.
 *  5. cancel/fail/recover lifecycle'ı doğru sürer; onSpeak yalnız gözlem (TTS yok).
 *  6. start/dispose/restart idempotent; barrel import yan etkisiz.
 */
import { describe, it, expect, vi } from 'vitest';
import { createMaviOrchestrator, type ActionHandler, type MaviPlan } from '../platform/maviCore';

function mockHandlers(): Record<string, ActionHandler> {
  return {
    'ui.theme.set': () => ({ ok: true }),
    'ui.page.open': () => ({ ok: true }),
    'media.play': () => ({ ok: true }),
    'media.next': () => ({ ok: true }),
    'vehicle.health.read': () => ({ ok: true, value: { dtcCount: 0 } }),
  };
}

describe('MaviOrchestrator — tam tur', () => {
  it('wake→listen→capture→execute→speak→finish akışı ve durumlar', async () => {
    let t = 0;
    const orch = createMaviOrchestrator({ handlers: mockHandlers(), now: () => t, stageThresholdMs: 1e9 });
    orch.start();

    t = 100; expect(orch.wake()).toBe(true);
    expect(orch.state).toBe('waking');
    t = 300; expect(orch.beginListening()).toBe(true);
    expect(orch.state).toBe('listening');
    t = 1000; const token = orch.capture()!;
    expect(token.generation).toBe(1);
    expect(orch.state).toBe('understanding');

    t = 1100;
    const plan: MaviPlan = { mode: 'sequential', steps: [{ actionId: 'media.play' }] };
    const result = await orch.execute(plan, token);
    expect(result.status).toBe('completed');
    expect(orch.state).toBe('executing');

    expect(orch.speak('Müzik açılıyor')).toBe(true);
    expect(orch.state).toBe('speaking');
    t = 1500; const segments = orch.finish();
    expect(orch.state).toBe('idle');
    expect(segments.wakeToListening).toBe(200); // 300 - 100
    expect(segments.total).toBeGreaterThan(0);
  });

  it('başarılı adımlar bağlamı günceller (lastAction + lastScreen)', async () => {
    const orch = createMaviOrchestrator({ handlers: mockHandlers() });
    orch.start();
    orch.beginListening();
    const token = orch.capture()!;
    await orch.execute({
      mode: 'sequential',
      steps: [{ actionId: 'ui.page.open', payload: { page: 'trafik' } }],
    }, token);
    const ctx = orch.snapshot().context;
    expect(ctx.lastActionId).toBe('ui.page.open');
    expect(ctx.lastScreen).toBe('trafik');
    expect(orch.context.resolveReference('screen')).toBe('trafik');
  });

  it('vehicle.health.read read kapsamıyla çalışır (varsayılan gate)', async () => {
    const orch = createMaviOrchestrator({ handlers: mockHandlers() });
    orch.start();
    orch.beginListening();
    const token = orch.capture()!;
    const r = await orch.execute({ mode: 'sequential', steps: [{ actionId: 'vehicle.health.read' }] }, token);
    expect(r.steps[0].status).toBe('ok');
    expect(r.steps[0].value).toEqual({ dtcCount: 0 });
  });
});

describe('MaviOrchestrator — barge-in / stale koruması', () => {
  it('araya yeni tur girince eski turun planı stale reddedilir', async () => {
    const orch = createMaviOrchestrator({ handlers: mockHandlers() });
    orch.start();

    // Tur A: gen 1
    orch.beginListening();
    const tokenA = orch.capture()!;
    expect(tokenA.generation).toBe(1);

    // Kullanıcı böler: iptal → kurtar → yeni tur B (gen 2)
    orch.cancel();
    expect(orch.state).toBe('cancelled');
    orch.recover();
    orch.beginListening();
    const tokenB = orch.capture()!;
    expect(tokenB.generation).toBe(2);

    // Tur A'nın (gecikmiş) planı eski jetonla gelir → motor stale reddeder
    const stale = await orch.execute({ mode: 'sequential', steps: [{ actionId: 'media.play' }] }, tokenA);
    expect(stale.status).toBe('rejected');
    expect(stale.reason).toBe('stale_generation');

    // Tur B'nin planı güncel jetonla çalışır
    const fresh = await orch.execute({ mode: 'sequential', steps: [{ actionId: 'media.play' }] }, tokenB);
    expect(fresh.status).toBe('completed');
  });
});

describe('MaviOrchestrator — iptal / hata / gözlem', () => {
  it('onSpeak yalnız gözlem (gerçek TTS yok)', async () => {
    const spoke = vi.fn();
    const orch = createMaviOrchestrator({ handlers: mockHandlers(), onSpeak: spoke });
    orch.start();
    orch.beginListening();
    const token = orch.capture()!;
    await orch.execute({ mode: 'sequential', steps: [{ actionId: 'media.play' }] }, token);
    orch.speak('Tamam');
    expect(spoke).toHaveBeenCalledWith('Tamam');
  });

  it('onStateChange geçişlerde bildirilir', () => {
    const states: string[] = [];
    const orch = createMaviOrchestrator({ handlers: mockHandlers(), onStateChange: (s) => states.push(s) });
    orch.start();
    orch.wake();
    orch.beginListening();
    expect(states).toEqual(['waking', 'listening']);
  });

  it('fail→error, recover→idle', () => {
    const orch = createMaviOrchestrator({ handlers: mockHandlers() });
    orch.start();
    orch.beginListening();
    expect(orch.fail()).toBe(true);
    expect(orch.state).toBe('error');
    expect(orch.recover()).toBe(true);
    expect(orch.state).toBe('idle');
  });
});

describe('MaviOrchestrator — idempotent lifecycle', () => {
  it('start/dispose/restart güvenli tekrarlanır', () => {
    const orch = createMaviOrchestrator({ handlers: mockHandlers() });
    orch.start();
    orch.start(); // idempotent
    orch.wake();
    orch.dispose();
    expect(orch.state).toBe('idle');
    expect(orch.snapshot().recentLatency.length).toBe(0);
    orch.dispose(); // idempotent
    orch.restart();
    expect(orch.state).toBe('idle');
  });
});
