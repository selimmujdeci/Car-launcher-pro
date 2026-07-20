/**
 * aiCore/aiOrchestrator.ts — AI ORKESTRATÖRÜ (read-only koordinasyon · Safety Gate zorlar).
 *
 * AMAÇ: AI Core'un çalışma döngüsünü koordine eder. Verilen araç bağlamından (VehicleContext)
 * deterministik verdikti üretir, kanıtı toplar, hafızayı hatırlar, kayıtlı ajanları SAFETY
 * GATE'ten geçirerek çalıştırır ve raporları toplar. VERİ ÜRETMEZ — mevcut motorları bağlar.
 *
 * SAFETY GATE RUNTIME'DA: her ajan çalışmadan ÖNCE `requiredScope` kapıdan geçer. Kapı
 * reddederse ajan ÇALIŞTIRILMAZ (Faz-1'de yalnız 'read' geçer). Böylece güvenlik kapısı
 * dekoratif değil, yürütme yolunun parçasıdır.
 *
 * LLM OPSİYONEL: `explainer` verilirse her rapora doğal-dil açıklama EKLENİR (async).
 * Verilmezse/başarısızsa rapor tam çalışır (explanation:null) — offline-first. FAIL-SOFT:
 * bir ajan patlarsa yalnız o düşer (izole), diğerleri ve verdict etkilenmez.
 */

import type { VehicleContext } from './vehicleContext';
import { deriveContextEvidence } from './vehicleContext';
import { EvidenceStore } from './evidenceStore';
import { buildAiCoreVerdict, type AiCoreVerdict } from './verdictEngine';
import type { TriageSections, ErrorLedgerLike } from '../diagnosticTriage';
import type { AiAgent, AiExplainer } from './agents/agentContract';
import type { AiAgentReport } from './types';
import type { VehicleMemoryStore, VehicleMemoryFact } from './vehicleMemory';
import { AiSafetyGate } from './safetyGate';

export interface AiOrchestratorDeps {
  readonly now?: () => number;
  /** Güvenlik kapısı (verilmezse Faz-1 varsayılan: yalnız read). */
  readonly safetyGate?: AiSafetyGate;
  /** Araç hafızası deposu (fingerprint gerçekleri hatırlamak için). Opsiyonel. */
  readonly memory?: VehicleMemoryStore | null;
}

export interface AiOrchestratorRunInput {
  readonly context: VehicleContext;
  /** Diagnostics V2 error ledger bağlamı (eski/yeni hata tazeliği). Opsiyonel. */
  readonly errorLedger?: ErrorLedgerLike | null;
  /** Opsiyonel LLM açıklama kancası (karar otoritesi değil). */
  readonly explainer?: AiExplainer | null;
}

export interface AiOrchestratorRunResult {
  readonly generatedAt: number;
  readonly verdict: AiCoreVerdict;
  readonly reports: readonly AiAgentReport[];
  readonly evidenceCount: number;
  /** Safety Gate tarafından engellenen ajan sayısı (Faz-1'de 0 beklenir). */
  readonly gateBlockedCount: number;
  /** Çalışırken patlayan ajan sayısı (izole; fail-soft). */
  readonly agentErrors: number;
}

/** AI Core orkestratörü — ajanları kaydeder ve read-only bir çalışma döngüsü yürütür. */
export class AiOrchestrator {
  private readonly _now: () => number;
  private readonly _gate: AiSafetyGate;
  private readonly _memory: VehicleMemoryStore | null;
  private readonly _agents = new Map<string, AiAgent>();

  constructor(deps: AiOrchestratorDeps = {}) {
    this._now = typeof deps.now === 'function' ? deps.now : () => Date.now();
    this._gate = deps.safetyGate ?? new AiSafetyGate();
    this._memory = deps.memory ?? null;
  }

  /** Ajan kaydeder (aynı id → değiştirir). @returns kayıt edildi mi. */
  register(agent: AiAgent): boolean {
    if (!agent || typeof agent.id !== 'string' || !agent.id || typeof agent.analyze !== 'function') return false;
    this._agents.set(agent.id, agent);
    return true;
  }

  unregister(id: string): boolean {
    return this._agents.delete(id);
  }

  get agentCount(): number {
    return this._agents.size;
  }

  get safetyGate(): AiSafetyGate {
    return this._gate;
  }

  /**
   * Bir çalışma döngüsü yürütür: verdict + kanıt + hafıza → ajanları Safety Gate'ten geçirip
   * çalıştır → raporları (+ opsiyonel LLM açıklaması) topla. Async yalnız explainer içindir;
   * karar üretimi tamamen senkron/offline'dır.
   */
  async run(input: AiOrchestratorRunInput): Promise<AiOrchestratorRunResult> {
    const now = this._now();
    const ctx = input.context;
    const sections: TriageSections = ctx.diagnosticSections ?? {};

    // 1) Deterministik verdict (offline).
    const verdict = buildAiCoreVerdict(sections, input.errorLedger ?? null);

    // 2) Kanıt topla (bağlamdan türet → depo).
    const evidence = new EvidenceStore({ now: this._now });
    evidence.ingestMany(deriveContextEvidence(ctx, now));

    // 3) Bu aracın hafızasını hatırla (varsa).
    let memory: readonly VehicleMemoryFact[] = [];
    if (this._memory && ctx.fingerprintHash) {
      try { memory = this._memory.recall(ctx.fingerprintHash); } catch { memory = []; }
    }

    // 4) Ajanları Safety Gate'ten geçirerek çalıştır (fail-soft/izole).
    const reports: AiAgentReport[] = [];
    let gateBlockedCount = 0;
    let agentErrors = 0;
    for (const agent of this._agents.values()) {
      const decision = this._gate.evaluate({ agentId: agent.id, scope: agent.requiredScope });
      if (!decision.allowed) { gateBlockedCount++; continue; }
      try {
        const report = agent.analyze({ context: ctx, evidence, verdict, memory, now });
        if (report) reports.push(report);
      } catch (err) {
        agentErrors++;
        console.error(`[AiOrchestrator] ajan '${agent.id}' patladı — izole, diğerleri etkilenmedi`, err);
      }
    }

    // 5) Opsiyonel LLM açıklaması (karar otoritesi değil — yalnız explanation doldurur).
    let finalReports: AiAgentReport[] = reports;
    if (typeof input.explainer === 'function') {
      finalReports = await this._enrich(reports, input.explainer);
    }

    return Object.freeze({
      generatedAt: now,
      verdict,
      reports: Object.freeze(finalReports),
      evidenceCount: evidence.size,
      gateBlockedCount,
      agentErrors,
    });
  }

  /** Raporlara LLM açıklaması ekler (fail-soft: hata/null → explanation null kalır). */
  private async _enrich(reports: readonly AiAgentReport[], explainer: AiExplainer): Promise<AiAgentReport[]> {
    const out: AiAgentReport[] = [];
    for (const r of reports) {
      let explanation: string | null = null;
      try {
        const res = await explainer(r);
        explanation = typeof res === 'string' && res.trim() ? res.trim() : null;
      } catch {
        explanation = null;   // LLM başarısız → deterministik rapor yeter (offline-first)
      }
      out.push(explanation ? Object.freeze({ ...r, explanation }) : r);
    }
    return out;
  }
}

export function createAiOrchestrator(deps: AiOrchestratorDeps = {}): AiOrchestrator {
  return new AiOrchestrator(deps);
}
