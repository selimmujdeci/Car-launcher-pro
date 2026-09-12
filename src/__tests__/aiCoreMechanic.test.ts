/**
 * aiCoreMechanic.test.ts — AI Core Faz-1 · AI Usta (ilk ajan) + uçtan-uca entegrasyon.
 *
 * KİLİTLENEN SÖZLEŞME:
 *  1. KANIT YOKSA TAHMİN YOK: kanıt/aktif neden yoksa hasEvidence=false, neden boş, dürüst headline.
 *  2. Güvenlik-kritik sinyal: soğutucu >105°C → ENGINE_OVERHEAT, aciliyet critical (evidence-grounded).
 *  3. KARŞI KANIT: bağlantı-arızası nedeni + taze OBD sinyali → "bağlantı tamamen ölü değil".
 *  4. Vehicle Memory sınırı karşı kanıt üretir ("bilinen araç sınırı, arıza değil").
 *  5. Güvenli kontroller DAİMA read-only.
 *  6. Entegrasyon: Orchestrator + aiMechanic gerçek verdict üzerinden rapor üretir.
 */
import { describe, it, expect } from 'vitest';
import { aiMechanic, AI_MECHANIC_ID } from '../platform/aiCore/agents/aiMechanic';
import { AiOrchestrator } from '../platform/aiCore/aiOrchestrator';
import { assembleVehicleContext, deriveContextEvidence } from '../platform/aiCore/vehicleContext';
import { EvidenceStore } from '../platform/aiCore/evidenceStore';
import { buildAiCoreVerdict } from '../platform/aiCore/verdictEngine';
import { VehicleMemoryStore } from '../platform/aiCore/vehicleMemory';
import type { AiAgentAnalysisInput } from '../platform/aiCore/agents/agentContract';
import type { VehicleContext } from '../platform/aiCore/vehicleContext';
import type { SignalEnvelope } from '../platform/obd/signalEnvelope';
import type { VehicleMemoryFact } from '../platform/aiCore/vehicleMemory';

function sig(v: number, unit = '°C'): SignalEnvelope {
  return { value: v, state: 'valid', confidence: 1, source: 'obd', updatedAt: 1000, ageMs: 0, unit };
}

/** analyze() için girdi kur (ctx'ten kanıt türetip depoya koyar). */
function mkInput(ctx: VehicleContext, memory: VehicleMemoryFact[] = [], errorLedger = null): AiAgentAnalysisInput {
  const evidence = new EvidenceStore();
  evidence.ingestMany(deriveContextEvidence(ctx, 5000));
  return { context: ctx, evidence, verdict: buildAiCoreVerdict(ctx.diagnosticSections, errorLedger), memory, now: 5000 };
}

describe('aiMechanic — "kanıt yoksa tahmin yok"', () => {
  it('boş bağlam → hasEvidence false, neden yok, dürüst headline', () => {
    const r = aiMechanic.analyze(mkInput(assembleVehicleContext({ connected: false })));
    expect(r.hasEvidence).toBe(false);
    expect(r.possibleCauses).toEqual([]);
    expect(r.urgency).toBe('none');
    expect(r.confidence).toBe(0);
    expect(r.headline).toMatch(/bağlı değil|kanıt yok/i);
  });
});

describe('aiMechanic — güvenlik-kritik sinyal (overheat)', () => {
  it('soğutucu 110°C → ENGINE_OVERHEAT, aciliyet critical', () => {
    const ctx = assembleVehicleContext({ connected: true, signals: { coolant_temp: sig(110) } });
    const r = aiMechanic.analyze(mkInput(ctx));
    expect(r.hasEvidence).toBe(true);
    expect(r.possibleCauses[0].code).toBe('ENGINE_OVERHEAT');
    expect(r.urgency).toBe('critical');
    expect(r.nextSafeChecks[0].readOnly).toBe(true);
    expect(r.nextSafeChecks[0].detail).toMatch(/çek|durdur/i);
  });

  it('normal sıcaklık (85°C) → overheat üretilmez', () => {
    const ctx = assembleVehicleContext({ connected: true, signals: { coolant_temp: sig(85) } });
    const r = aiMechanic.analyze(mkInput(ctx));
    expect(r.possibleCauses.find((c) => c.code === 'ENGINE_OVERHEAT')).toBeUndefined();
  });
});

describe('aiMechanic — KARŞI KANIT', () => {
  it('bağlantı-arızası nedeni + taze OBD sinyali → "bağlantı tamamen ölü değil"', () => {
    const ctx = assembleVehicleContext({
      connected: true,
      signals: { rpm: sig(2000, 'rpm') },   // taze OBD sinyali (kanıt)
      diagnosticSections: { transport: { reconnectAttempts: 4 } }, // TRANSPORT_RECONNECT
    });
    const r = aiMechanic.analyze(mkInput(ctx));
    expect(r.possibleCauses.some((c) => c.code === 'TRANSPORT_RECONNECT')).toBe(true);
    expect(r.counterEvidence.some((ce) => /tamamen ölü değil/.test(ce.note))).toBe(true);
  });

  it('Vehicle Memory sınırı → "bilinen araç sınırı" karşı kanıtı', () => {
    const ctx = assembleVehicleContext({
      connected: true,
      signals: { rpm: sig(2000, 'rpm') },
      diagnosticSections: { transport: { reconnectAttempts: 4 } },
    });
    const memory: VehicleMemoryFact[] = [
      { key: 'transport_reconnect_normal', statement: 'Bu araçta transport reconnect normaldir, arıza değil', confidence: 0.8, observations: 5, firstSeen: 1, lastSeen: 2, source: 'learned' },
    ];
    const r = aiMechanic.analyze(mkInput(ctx, memory));
    expect(r.counterEvidence.some((ce) => /bilinen araç sınırı/i.test(ce.note))).toBe(true);
    expect(r.evidence.some((e) => e.kind === 'memory')).toBe(true);
  });
});

describe('aiMechanic — güvenli kontrol read-only invaryantı', () => {
  it('tüm güvenli kontroller readOnly:true', () => {
    const ctx = assembleVehicleContext({
      connected: true,
      diagnosticSections: {
        obdDeep: { dtc: { count: 1, codes: [{ code: 'P0300', severity: 'critical' }] } },
        power: { severity: 'critical', voltageV: 11.2 },
      },
    });
    const r = aiMechanic.analyze(mkInput(ctx));
    expect(r.nextSafeChecks.length).toBeGreaterThan(0);
    expect(r.nextSafeChecks.every((c) => c.readOnly === true)).toBe(true);
  });
});

describe('AI Core — uçtan-uca entegrasyon', () => {
  it('Orchestrator + aiMechanic + memory tam döngü', async () => {
    const memStore = new VehicleMemoryStore({ storageKey: 'test-e2e-mem', now: () => 5000 });
    memStore.clear();
    memStore.remember('a1b2c3d4e5f6a7b8', { key: 'mode09_unsupported', statement: 'Bu araç Mode09 VIN desteklemiyor', confidence: 0.85 });

    const orch = new AiOrchestrator({ now: () => 5000, memory: memStore });
    orch.register(aiMechanic);

    const ctx = assembleVehicleContext({
      now: 5000, connected: true, fingerprintHash: 'a1b2c3d4e5f6a7b8',
      signals: { coolant_temp: sig(108) },
      diagnosticSections: { obdDeep: { dtc: { count: 1, codes: [{ code: 'P0128', severity: 'warning' }] } } },
    });
    const res = await orch.run({ context: ctx });

    expect(res.reports).toHaveLength(1);
    const rep = res.reports[0];
    expect(rep.agentId).toBe(AI_MECHANIC_ID);
    expect(rep.hasEvidence).toBe(true);
    expect(rep.urgency).toBe('critical');                       // overheat
    expect(rep.possibleCauses.some((c) => c.code === 'ENGINE_OVERHEAT')).toBe(true);
    expect(rep.evidence.some((e) => e.kind === 'memory')).toBe(true);   // hafıza hatırlandı
    expect(res.gateBlockedCount).toBe(0);
    expect(res.verdict.hasActiveRootCause).toBe(true);          // DTC → verdict
  });
});
