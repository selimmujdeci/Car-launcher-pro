/**
 * aiCore/index.ts — AI Core Faz-1 genel API (barrel).
 *
 * Bu modülü import etmek YAN ETKİSİZDİR: hiçbir global singleton oluşmaz, timer/abonelik/
 * native çağrı yoktur. AI Core yalnız açıkça `createAiOrchestrator()` + ajan `register()`
 * ile kurulunca çalışır. SystemBoot wiring · UI · LLM sağlayıcı bağlama AYRI PR'lardır.
 *
 * MİMARİ (VİZYON): mevcut olgun altyapıyı (Vehicle HAL · Event Bus · SignalEnvelope ·
 * Diagnostics V2 · Capability · Fingerprint) ORKESTRE eden read-only, explainable, offline
 * akıl-yürütme katmanı. İkinci veri/karar otoritesi kurmaz.
 */

// Ortak kontratlar
export type {
  AiUrgency, AiEvidenceKind, AiEvidenceItem, AiPossibleCause, AiCounterEvidence,
  AiSafeCheck, AiInconclusive, AiAgentReport,
} from './types';
export { maxUrgency, urgencyRank } from './types';

// Safety Gate
export {
  AiSafetyGate, createAiSafetyGate, HARD_FORBIDDEN_SCOPES, DEFAULT_ALLOWED_SCOPES,
  type AiCapabilityScope, type AiActionRequest, type SafetyGateDecision, type SafetyGateDeps,
} from './safetyGate';

// Evidence Store
export {
  EvidenceStore, createEvidenceStore, makeEvidence, signalToEvidence, dtcToEvidence,
  DEFAULT_MAX_EVIDENCE, type EvidenceQuery, type EvidenceStoreDeps,
} from './evidenceStore';

// Vehicle Context
export {
  assembleVehicleContext, deriveContextEvidence,
  type VehicleContext, type VehicleContextInput, type CapabilitySummary,
  type CapabilityRecordLike, type DtcLike,
} from './vehicleContext';

// Vehicle Memory
export {
  VehicleMemoryStore, createVehicleMemoryStore, reinforceConfidence,
  VEHICLE_MEMORY_STORAGE_KEY, MAX_MEMORY_VEHICLES, MAX_FACTS_PER_VEHICLE,
  type VehicleMemoryFact, type RememberInput, type VehicleMemoryDeps,
} from './vehicleMemory';

// Verdict Engine
export { buildAiCoreVerdict, type AiCoreVerdict } from './verdictEngine';

// Orchestrator + ajan sözleşmesi
export {
  AiOrchestrator, createAiOrchestrator,
  type AiOrchestratorDeps, type AiOrchestratorRunInput, type AiOrchestratorRunResult,
} from './aiOrchestrator';
export type { AiAgent, AiAgentAnalysisInput, AiExplainer } from './agents/agentContract';

// Ajanlar
export { aiMechanic, AI_MECHANIC_ID } from './agents/aiMechanic';
