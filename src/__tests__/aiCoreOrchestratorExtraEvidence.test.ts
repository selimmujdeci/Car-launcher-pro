/**
 * aiCoreOrchestratorExtraEvidence.test.ts — AI Core Faz-2.5 · orchestrator extraEvidence seam.
 *
 * KİLİTLENEN SÖZLEŞME:
 *  1. extraEvidence bağlam kanıtının YANINA ingest edilir (additive).
 *  2. Verilmezse davranış BİREBİR aynı (geriye-uyumlu).
 *  3. Ajan raporu ek kanıtı görür (hasEvidence + evidence içerir).
 */
import { describe, it, expect } from 'vitest';
import { AiOrchestrator } from '../platform/aiCore/aiOrchestrator';
import { aiMechanic } from '../platform/aiCore/agents/aiMechanic';
import { assembleVehicleContext } from '../platform/aiCore/vehicleContext';
import { makeEvidence } from '../platform/aiCore/evidenceStore';

describe('AiOrchestrator — extraEvidence (Faz-2.5)', () => {
  it('extraEvidence additive olarak ingest edilir ve rapora yansır', async () => {
    const orch = new AiOrchestrator({ now: () => 5000 });
    orch.register(aiMechanic);
    const extra = [
      makeEvidence({ key: 'handshake.protocol_mismatch', kind: 'diagnostic', summary: 'protokol uyuşmuyor', confidence: 0.7, observedAt: 5000, source: 'obd' }),
      makeEvidence({ key: 'transport.freshness', kind: 'diagnostic', summary: 'veri donuk', confidence: 0.8, observedAt: 5000, source: 'obd' }),
    ];
    const res = await orch.run({ context: assembleVehicleContext({ connected: true }), extraEvidence: extra });
    expect(res.evidenceCount).toBeGreaterThanOrEqual(2);
    const rep = res.reports[0];
    expect(rep.hasEvidence).toBe(true);
    const keys = rep.evidence.map((e) => e.key);
    expect(keys).toContain('handshake.protocol_mismatch');
    expect(keys).toContain('transport.freshness');
  });

  it('extraEvidence verilmezse boş bağlamda dürüst susma korunur (geriye-uyum)', async () => {
    const orch = new AiOrchestrator({ now: () => 5000 });
    orch.register(aiMechanic);
    const res = await orch.run({ context: assembleVehicleContext({ connected: false }) });
    expect(res.evidenceCount).toBe(0);
    expect(res.reports[0].hasEvidence).toBe(false);
  });

  it('boş extraEvidence dizisi güvenli (no-op)', async () => {
    const orch = new AiOrchestrator({ now: () => 5000 });
    orch.register(aiMechanic);
    const res = await orch.run({ context: assembleVehicleContext({ connected: true }), extraEvidence: [] });
    expect(res.evidenceCount).toBe(0);
  });
});
