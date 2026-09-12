/**
 * aiCoreOrchestrator.test.ts — AI Core Faz-1 · Orchestrator (read-only koordinasyon).
 *
 * KİLİTLENEN SÖZLEŞME:
 *  1. Verdict + kanıt + hafıza toplanır, ajanlar rapor döndürür.
 *  2. Safety Gate RUNTIME'da zorlar: read-dışı scope isteyen ajan ÇALIŞTIRILMAZ.
 *  3. Bir ajan patlarsa yalnız o düşer (izole); diğerleri + verdict etkilenmez.
 *  4. LLM açıklayıcı (opsiyonel) explanation'ı doldurur; yoksa rapor tam çalışır.
 */
import { describe, it, expect } from 'vitest';
import { AiOrchestrator } from '../platform/aiCore/aiOrchestrator';
import { assembleVehicleContext } from '../platform/aiCore/vehicleContext';
import type { AiAgent, AiAgentAnalysisInput } from '../platform/aiCore/agents/agentContract';
import type { AiAgentReport } from '../platform/aiCore/types';
import type { SignalEnvelope } from '../platform/obd/signalEnvelope';

function sig(v: number): SignalEnvelope {
  return { value: v, state: 'valid', confidence: 1, source: 'obd', updatedAt: 1000, ageMs: 0, unit: '°C' };
}

function mkReport(agentId: string, input: AiAgentAnalysisInput): AiAgentReport {
  return {
    agentId, generatedAt: input.now, headline: `${agentId} baktı`, urgency: 'watch',
    confidence: 50, hasEvidence: input.evidence.size > 0, evidence: input.evidence.snapshot(),
    possibleCauses: [], counterEvidence: [], nextSafeChecks: [], inconclusive: [], explanation: null,
  };
}

const readAgent: AiAgent = {
  id: 'reader', title: 'Okuyucu', requiredScope: 'read',
  analyze: (i) => mkReport('reader', i),
};

describe('AiOrchestrator', () => {
  it('verdict + kanıt toplar, read ajanı rapor döndürür', async () => {
    const orch = new AiOrchestrator({ now: () => 5000 });
    orch.register(readAgent);
    const ctx = assembleVehicleContext({ now: 5000, signals: { coolant_temp: sig(104) } });
    const res = await orch.run({ context: ctx });
    expect(res.reports).toHaveLength(1);
    expect(res.reports[0].agentId).toBe('reader');
    expect(res.evidenceCount).toBeGreaterThan(0);
    expect(res.gateBlockedCount).toBe(0);
    expect(res.agentErrors).toBe(0);
  });

  it('Safety Gate read-dışı scope\'lu ajanı RUNTIME\'da engeller', async () => {
    const orch = new AiOrchestrator();
    const codingAgent: AiAgent = { id: 'coder', title: 'Kodlayıcı', requiredScope: 'coding', analyze: (i) => mkReport('coder', i) };
    orch.register(codingAgent);
    orch.register(readAgent);
    const res = await orch.run({ context: assembleVehicleContext({}) });
    expect(res.gateBlockedCount).toBe(1);                       // coding engellendi
    expect(res.reports.map((r) => r.agentId)).toEqual(['reader']); // yalnız read çalıştı
  });

  it('patlayan ajan izole edilir; diğerleri çalışır', async () => {
    const orch = new AiOrchestrator();
    const boom: AiAgent = { id: 'boom', title: 'Patlak', requiredScope: 'read', analyze: () => { throw new Error('çök'); } };
    orch.register(boom);
    orch.register(readAgent);
    const res = await orch.run({ context: assembleVehicleContext({}) });
    expect(res.agentErrors).toBe(1);
    expect(res.reports.map((r) => r.agentId)).toEqual(['reader']);
  });

  it('LLM açıklayıcı explanation doldurur; hata → null (offline-first)', async () => {
    const orch = new AiOrchestrator();
    orch.register(readAgent);
    const ctx = assembleVehicleContext({});
    const ok = await orch.run({ context: ctx, explainer: (r) => `açıklama: ${r.headline}` });
    expect(ok.reports[0].explanation).toBe('açıklama: reader baktı');
    const boom = await orch.run({ context: ctx, explainer: () => { throw new Error('LLM down'); } });
    expect(boom.reports[0].explanation).toBeNull();
  });
});
