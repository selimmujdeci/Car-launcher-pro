/**
 * maviCore/index.ts — MAVİ ÇEKİRDEĞİ Faz-1 genel API (barrel).
 *
 * Bu modülü import etmek YAN ETKİSİZDİR: hiçbir global singleton oluşmaz, timer/abonelik/native
 * çağrı yoktur. Mavi Çekirdeği yalnız açıkça `createMaviOrchestrator({ handlers })` ile kurulunca
 * çalışır. SystemBoot wiring · LLM/STT/TTS/wake-word bağlama · gerçek servis portları AYRI PR'lardır.
 *
 * MİMARİ (VİZYON): mevcut olgun altyapıyı (voiceService · ttsService · mediaService ·
 * navigationService · AiSafetyGate) ORKESTRE edecek, düşük-gecikmeli, tiplenmiş, güvenli sesli
 * asistan omurgası. İkinci güvenlik/karar otoritesi kurmaz — araç kararları AiSafetyGate'e delege.
 */

// Yaşam döngüsü (state machine)
export {
  MaviLifecycle, createMaviLifecycle, nextState, canTransition, isRecoverable,
  type MaviState, type MaviEvent, type MaviTransitionResult,
  type MaviLifecycleDeps, type MaviLifecycleSnapshot,
} from './maviLifecycle';

// Typed AppAction defteri
export {
  MaviActionRegistry, createActionRegistry, createPilotActionRegistry, registerPilotActions,
  PILOT_ACTIONS, PILOT_THEMES,
  validateEmpty, makeEnumValidator, makeNumberRangeValidator,
  makeOptionalStringValidator, makeRequiredStringValidator,
  type ActionDefinition, type ActionRiskLevel, type ActionResultContract,
  type ActionValidationResult, type ActionValidator,
} from './actionRegistry';

// Eylem güvenlik köprüsü (AiSafetyGate delegasyonu)
export {
  evaluateActionSafety, evaluateActionIdSafety,
  type ActionSafetyOutcome, type ActionSafetyDecision, type ActionSafetyOpts,
} from './actionSafety';

// Kısa-süreli bağlam deposu
export {
  MaviContextStore, createMaviContextStore, MAX_CONTEXT_TURNS,
  type MediaContextSnapshot, type NavContextSnapshot, type ConversationTurn,
  type ContextReferenceKind, type MaviContextSnapshot, type MaviContextStoreDeps,
} from './contextStore';

// Çok-eylemli yürütme motoru
export {
  MaviExecutionEngine, createExecutionEngine,
  type ActionExecResult, type ActionHandler, type PlanStep, type PlanMode,
  type MaviPlan, type StepStatus, type StepResult, type PlanStatus, type PlanResult,
  type ExecutionEngineDeps,
} from './executionEngine';

// Gecikme telemetrisi
export {
  MaviLatencyTracker, createLatencyTracker, deriveSegments,
  DEFAULT_MAX_LATENCY_SESSIONS, DEFAULT_STAGE_THRESHOLD_MS,
  type LatencyMarker, type LatencySegments, type SessionLatency,
  type SlowStageEvent, type LatencyTrackerDeps,
} from './latencyTelemetry';

// Orkestratör
export {
  MaviOrchestrator, createMaviOrchestrator,
  type MaviOrchestratorDeps, type MaviOrchestratorSnapshot, type MaviTurnToken,
} from './maviOrchestrator';
