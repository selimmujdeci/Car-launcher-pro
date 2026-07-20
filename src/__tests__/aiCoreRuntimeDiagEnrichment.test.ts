/**
 * aiCoreRuntimeDiagEnrichment.test.ts — AI Core Faz-2.5 · runtime tanı zenginleştirme.
 *
 * KİLİTLENEN SÖZLEŞME:
 *  1. diagnosticsProvider → edge run'da zengin sections (verdict) + extraEvidence (ajan).
 *  2. Provider hatası izole → minimal bağlama düşülür (fail-soft, çalışma sürer).
 *  3. Provider yok → Faz-2 davranışı (minimal, enrichment yok).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { AiCoreRuntime, type RuntimeBusLike, type RuntimeHalLike, type DiagnosticsProvider } from '../platform/aiCore/runtime/aiCoreRuntime';
import type { HalSnapshotLike, HalIdentityLike } from '../platform/aiCore/runtime/halAdapter';
import { AiOrchestrator } from '../platform/aiCore/aiOrchestrator';
import { aiMechanic } from '../platform/aiCore/agents/aiMechanic';

class FakeBus implements RuntimeBusLike {
  subs = new Map<string, { name: string; listener: (e: unknown) => void }>();
  published: Array<{ name: string; payload?: unknown }> = [];
  private _n = 0;
  subscribe(name: string, listener: (e: unknown) => void): string | null { const id = `s${++this._n}`; this.subs.set(id, { name, listener }); return id; }
  unsubscribe(id: string): boolean { return this.subs.delete(id); }
  publish(input: { name: string; payload?: unknown }): unknown { this.published.push(input); return { id: 'e' }; }
  emit(name: string): void { for (const s of [...this.subs.values()]) if (s.name === name) s.listener({ name }); }
}
const HAL: RuntimeHalLike = {
  getSnapshot: (): HalSnapshotLike => ({ revision: 1, updatedAt: 5000, signals: [
    { id: 'vehicle.rpm', value: 2000, confidence: 1, source: 'obd', timestamp: 5000, stale: false, unit: 'rpm', supported: true },
  ] }),
  getVehicleIdentity: (): HalIdentityLike => ({ fingerprintHash: null, protocol: null, supported: false }),
};

let scheduled: Array<{ fn: () => void; id: number }> = [];
let tid = 0; let clock = 10_000;
const setTimeoutFn = (fn: () => void): unknown => { const id = ++tid; scheduled.push({ fn, id }); return id; };
const clearTimeoutFn = (h: unknown): void => { scheduled = scheduled.filter((s) => s.id !== h); };
async function flush(): Promise<void> { const b = scheduled.splice(0); for (const s of b) s.fn(); await new Promise((r) => setTimeout(r, 0)); }

function mkRuntime(bus: FakeBus, provider?: DiagnosticsProvider): AiCoreRuntime {
  const orch = new AiOrchestrator({ now: () => clock });
  orch.register(aiMechanic);
  return new AiCoreRuntime({ bus, hal: HAL, orchestrator: orch, now: () => clock, diagnosticsProvider: provider, setTimeoutFn, clearTimeoutFn });
}

beforeEach(() => { scheduled = []; tid = 0; clock = 10_000; });

describe('AiCoreRuntime — tanı zenginleştirme (Faz-2.5)', () => {
  it('provider → zengin verdict (DTC kök-neden) + diagnostic extraEvidence', async () => {
    const bus = new FakeBus();
    const provider: DiagnosticsProvider = () => ({
      obdDeep: {
        adapter: { source: 'real', connectionState: 'connected', lastSeenMs: 9000 },
        health: { connectionQuality: 40, lastPacketAgeMs: 100, isStale: false },
        dtc: { count: 1, codes: [{ code: 'P0300', severity: 'critical', system: 'ignition' }] },
        handshake: { outcome: 'ok', protocolActive: 'ISO15765', reconnectHistory: [] },
        extended: { unavailable: ['0105'] },
      },
    });
    const rt = mkRuntime(bus, provider);
    rt.start();
    bus.emit('vehicle.connection.changed');
    await flush();

    const res = rt.getLastResult()!;
    expect(res).not.toBeNull();
    // Zengin sections → verdict aktif kök-neden (DTC).
    expect(res.verdict.hasActiveRootCause).toBe(true);
    const rep = res.reports[0];
    expect(rep.possibleCauses.some((c) => c.code === 'OBD_DTC_PRESENT')).toBe(true);
    // extraEvidence ajan raporuna girdi.
    const keys = rep.evidence.map((e) => e.key);
    expect(keys).toContain('dtc.P0300');
    expect(keys).toContain('capability.unavailable_pids');
    expect(keys).toContain('transport.quality');
  });

  it('provider hatası → fail-soft, minimal bağlamla çalışma sürer', async () => {
    const bus = new FakeBus();
    const rt = mkRuntime(bus, () => { throw new Error('diag down'); });
    rt.start();
    bus.emit('vehicle.connection.changed');
    await flush();
    expect(rt.getStatus().runCount).toBe(1);
    expect(rt.getStatus().errorCount).toBe(0);        // izole (run patlamadı)
    expect(rt.getLastResult()).not.toBeNull();
  });

  it('provider yok → Faz-2 davranışı (enrichment yok, çalışır)', async () => {
    const bus = new FakeBus();
    const rt = mkRuntime(bus);
    rt.start();
    bus.emit('vehicle.connection.changed');
    await flush();
    const rep = rt.getLastResult()!.reports[0];
    expect(rep.evidence.every((e) => e.kind !== 'diagnostic')).toBe(true);   // diagnostic kanıt yok
  });
});
