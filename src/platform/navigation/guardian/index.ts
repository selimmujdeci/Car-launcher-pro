/**
 * Guardian AI Core — Faz A saf çekirdek — genel barrel — GUARDIAN-AI-G1/G2.
 *
 * Yalnız SAF modülleri dışa verir (models/guardianEngine/rules). Analiz
 * kuralları (ör. `evaluateCurveRisk`) `guardianEngine.runGuardian`e OTOMATİK
 * BAĞLI DEĞİL — bağlama (rule registry) wiring katmanının işidir (bu
 * sürümde YOK). Wiring katmanının kendisi (GPS/OBD/harita/Mavi/UI) bu
 * sürümde YOK — bu dosyadan da dışa verilmez.
 */
export type {
  GuardianSeverity,
  GuardianRiskType,
  GuardianRiskEvent,
  GuardianRuleResult,
  GuardianInput,
  GuardianOutput,
} from './models';
export { SEVERITY_ORDER, SEVERITY_WEIGHT } from './models';

export { runGuardian } from './guardianEngine';

export {
  evaluateCurveRisk,
  CURVE_RISK_RULE_ID,
  type CurveRiskInput,
  type CurveRiskCurveInput,
  type CurveRiskVehicleInput,
  type CurveRiskRoadInput,
  type CurveRiskPolicyInput,
  type CurveDirection,
  type RoadSurfaceCondition,
} from './rules';
