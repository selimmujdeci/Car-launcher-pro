/**
 * Guardian Rules — barrel — GUARDIAN-AI-G2.
 *
 * Her kural SAF bir fonksiyondur, `GuardianRuleResult` üretir.
 * `guardianEngine.ts`e OTOMATİK bağlanmaz — DI ile wiring katmanı bağlar
 * (bu görevin kapsamı dışında).
 */
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
} from './curveRiskRule';
