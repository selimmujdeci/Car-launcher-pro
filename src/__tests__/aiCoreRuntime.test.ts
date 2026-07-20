/**
 * aiCoreRuntime.test.ts — AI Core Faz-2 · Runtime motoru (edge-triggered · bounded).
 *
 * KİLİTLENEN SÖZLEŞME:
 *  1. start → 4 edge olayına abone; edge olayı → HAL oku → çalış → ai.mechanic.report yayınla.
 *  2. BOUNDED: art arda olaylar tek çalışmaya coalesce; min-interval korunur (her frame YOK).
 *  3. dispose: abonelik+timer bırakılır; dispose sonrası çalışma/yayın YOK (idempotent, terminal).
 *  4. restart güvenli: yeni örnek temiz başlar.
 *  5. Kanıt yoksa dürüst susma yayına yansır (hasEvidence:false).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { AiCoreRuntime, AI_MECHANIC_REPORT_EVENT, type RuntimeBusLike, type RuntimeHalLike } from '../platform/aiCore/runtime/aiCoreRuntime';
import type { HalSnapshotLike, HalIdentityLike, HalSignalLike } from '../platform/aiCore/runtime/halAdapter';
import { AiOrchestrator } from '../platform/aiCore/aiOrchestrator';
import { aiMechanic } from '../platform/aiCore/agents/aiMechanic';

/* ── Fake bus (abone kaydı + emit + yayın yakalama) ── */
class FakeBus implements RuntimeBusLike {
  subs = new Map<string, { name: string; listener: (e: unknown) => void }>();
  published: Array<{ name: string; payload?: unknown; retained?: boolean }> = [];
  private _n = 0;
  subscribe(name: string, listener: (e: unknown) => void): string | null {
    const id = `s${++this._n}`; this.subs.set(id, { name, listener }); return id;
  }
  unsubscribe(id: string): boolean { return this.subs.delete(id); }
  publish(input: { name: string; payload?: unknown; retained?: boolean }): unknown {
    this.published.push(input); return { id: 'e' };
  }
  emit(name: string): void { for (const s of [...this.subs.values()]) if (s.name === name) s.listener({ name }); }
}

class FakeHal implements RuntimeHalLike {
  constructor(public snapshot: HalSnapshotLike, public identity: HalIdentityLike) {}
  getSnapshot(): HalSnapshotLike { return this.snapshot; }
  getVehicleIdentity(): HalIdentityLike { return this.identity; }
}

function halSig(p: Partial<HalSignalLike>): HalSignalLike {
  return { id: 'vehicle.coolant_temp', value: 90, confidence: 1, source: 'can', timestamp: 1000, stale: false, unit: '°C', supported: true, ...p };
}
const EMPTY_ID: HalIdentityLike = { fingerprintHash: null, protocol: null, supported: false };

/* ── Enjekte edilen timer + saat ── */
let scheduled: Array<{ fn: () => void; ms: number; id: number }> = [];
let tid = 0;
let clock = 10_000;
const setTimeoutFn = (fn: () => void, ms: number): unknown => { const id = ++tid; scheduled.push({ fn, ms, id }); return id; };
const clearTimeoutFn = (h: unknown): void => { scheduled = scheduled.filter((s) => s.id !== h); };
async function flush(): Promise<void> {
  const batch = scheduled.splice(0);
  for (const s of batch) s.fn();
  await new Promise((r) => setTimeout(r, 0));   // async _run + orchestrator settle
}

function mkRuntime(hal: FakeHal, bus: FakeBus): AiCoreRuntime {
  const orch = new AiOrchestrator({ now: () => clock });
  orch.register(aiMechanic);
  return new AiCoreRuntime({
    bus, hal, orchestrator: orch, now: () => clock, online: () => true,
    setTimeoutFn, clearTimeoutFn, minRunIntervalMs: 4000, debounceMs: 600,
  });
}

beforeEach(() => { scheduled = []; tid = 0; clock = 10_000; });

describe('AiCoreRuntime — abonelik + edge çalışma', () => {
  it('start → 4 edge olayına abone', () => {
    const rt = mkRuntime(new FakeHal({ revision: 1, updatedAt: 0, signals: [] }, EMPTY_ID), new FakeBus());
    rt.start();
    expect(rt.getStatus().subscriptions).toBe(4);
  });

  it('edge olayı → HAL oku → çalış → ai.mechanic.report yayınla (overheat critical)', async () => {
    const bus = new FakeBus();
    const hal = new FakeHal({ revision: 1, updatedAt: clock, signals: [halSig({ value: 110, timestamp: clock })] }, EMPTY_ID);
    const rt = mkRuntime(hal, bus);
    rt.start();
    bus.emit('vehicle.connection.changed');
    await flush();
    const report = bus.published.find((p) => p.name === AI_MECHANIC_REPORT_EVENT);
    expect(report).toBeDefined();
    expect(report!.retained).toBe(true);
    expect((report!.payload as { urgency: string }).urgency).toBe('critical');
    expect((report!.payload as { hasEvidence: boolean }).hasEvidence).toBe(true);
    expect(rt.getStatus().runCount).toBe(1);
    expect(rt.getLastResult()).not.toBeNull();
  });
});

describe('AiCoreRuntime — BOUNDED (her frame yok)', () => {
  it('sağanak edge → tek çalışmaya coalesce', async () => {
    const bus = new FakeBus();
    const rt = mkRuntime(new FakeHal({ revision: 1, updatedAt: clock, signals: [halSig({ value: 95, timestamp: clock })] }, EMPTY_ID), bus);
    rt.start();
    for (let i = 0; i < 5; i++) bus.emit('vehicle.signal.changed');   // 5 hızlı olay
    expect(scheduled.length).toBe(1);                                  // tek timer (coalesce)
    await flush();
    expect(rt.getStatus().runCount).toBe(1);
  });

  it('çalışmadan hemen sonraki edge → min-interval korunur (4s bekler)', async () => {
    const bus = new FakeBus();
    const rt = mkRuntime(new FakeHal({ revision: 1, updatedAt: clock, signals: [halSig({ value: 95, timestamp: clock })] }, EMPTY_ID), bus);
    rt.start();
    bus.emit('vehicle.signal.changed');
    await flush();                                    // 1. çalışma (lastRunAt = clock)
    bus.emit('vehicle.signal.changed');               // aynı anda tekrar (since=0)
    expect(scheduled.length).toBe(1);
    expect(scheduled[0].ms).toBe(4000);               // bounded: 4s beklemeye zamanlandı
  });
});

describe('AiCoreRuntime — dispose / idempotency / restart', () => {
  it('dispose → abonelikler bırakılır, timer temizlenir, sonraki edge çalışmaz', async () => {
    const bus = new FakeBus();
    const rt = mkRuntime(new FakeHal({ revision: 1, updatedAt: clock, signals: [halSig({ value: 95, timestamp: clock })] }, EMPTY_ID), bus);
    rt.start();
    bus.emit('vehicle.signal.changed');               // timer zamanlandı
    rt.dispose();
    expect(bus.subs.size).toBe(0);                    // unsubscribe
    expect(scheduled.length).toBe(0);                 // timer temizlendi
    bus.emit('vehicle.connection.changed');           // dispose sonrası
    await flush();
    expect(rt.getStatus().runCount).toBe(0);          // çalışma YOK
    expect(rt.isDisposed).toBe(true);
  });

  it('start idempotent (çift abonelik yok); dispose idempotent', () => {
    const bus = new FakeBus();
    const rt = mkRuntime(new FakeHal({ revision: 1, updatedAt: 0, signals: [] }, EMPTY_ID), bus);
    rt.start(); rt.start();
    expect(rt.getStatus().subscriptions).toBe(4);     // çift değil
    rt.dispose(); rt.dispose();
    expect(rt.getStatus().disposed).toBe(true);
  });

  it('dispose sonrası start no-op (terminal); yeni örnek temiz başlar (restart)', () => {
    const bus1 = new FakeBus();
    const rt1 = mkRuntime(new FakeHal({ revision: 1, updatedAt: 0, signals: [] }, EMPTY_ID), bus1);
    rt1.start(); rt1.dispose();
    rt1.start();
    expect(rt1.getStatus().started).toBe(true);       // yeniden aktifleşmez (terminal)
    expect(bus1.subs.size).toBe(0);
    // Restart = yeni örnek
    const bus2 = new FakeBus();
    const rt2 = mkRuntime(new FakeHal({ revision: 1, updatedAt: 0, signals: [] }, EMPTY_ID), bus2);
    rt2.start();
    expect(rt2.getStatus().subscriptions).toBe(4);
  });
});

describe('AiCoreRuntime — dürüst susma yayına yansır', () => {
  it('sinyal yok → hasEvidence:false yayınlanır', async () => {
    const bus = new FakeBus();
    const rt = mkRuntime(new FakeHal({ revision: 1, updatedAt: 0, signals: [] }, EMPTY_ID), bus);
    rt.start();
    bus.emit('vehicle.connection.changed');
    await flush();
    const report = bus.published.find((p) => p.name === AI_MECHANIC_REPORT_EVENT)!;
    expect((report.payload as { hasEvidence: boolean }).hasEvidence).toBe(false);
    expect((report.payload as { urgency: string }).urgency).toBe('none');
  });
});
