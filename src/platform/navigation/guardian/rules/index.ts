/**
 * Guardian Rules — barrel — GUARDIAN-AI-G2/G3/G4/G5.
 *
 * Her kural SAF bir fonksiyondur, `GuardianRuleResult` üretir.
 * `guardianEngine.ts`e OTOMATİK bağlanmaz — DI ile wiring katmanı bağlar
 * (bu görevin kapsamı dışında). Kurallar birbirinden BAĞIMSIZDIR (biri
 * diğerini import etmez).
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

export {
  evaluateSpeedLimitRisk,
  SPEED_LIMIT_RULE_ID,
  type SpeedLimitRiskInput,
  type SpeedLimitSegmentInput,
  type SpeedLimitVehicleInput,
  type SpeedLimitPolicyInput,
} from './speedLimitRule';

export {
  evaluateRoadProfileRisk,
  ROAD_PROFILE_RULE_ID,
  type RoadProfileRiskInput,
  type RoadProfileSegmentInput,
  type RoadProfileVehicleInput,
  type RoadProfilePolicyInput,
  type RoadProfileGradeThresholds,
} from './roadProfileRule';

export {
  evaluateWeatherRisk,
  WEATHER_RULE_ID,
  type WeatherRiskInput,
  type WeatherConditionInput,
  type WeatherRiskPolicyInput,
  type WeatherSurfaceCondition,
  type WeatherSeverityOrNone,
  type WeatherSeverityByCondition,
} from './weatherRiskRule';
