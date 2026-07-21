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
  evaluateGuardianDecision,
  GUARDIAN_DECISION_ID,
  type GuardianDecisionInput,
  type GuardianDecisionPolicyInput,
  type GuardianDecision,
} from './guardianDecisionEngine';

export {
  buildGuardianRuleResults,
  GUARDIAN_RULE_REGISTRY_ORDER,
  type GuardianRuleRegistryInput,
} from './guardianRuleRegistry';

export {
  buildGuardianRegistryInput,
  type GuardianRawPlatformData,
} from './adapters/guardianAdapterRegistry';

export {
  buildGuardianRawPlatformData,
  type GuardianProviderSources,
} from './providers/guardianProviderRegistry';
export type { GpsSource, RawGpsData } from './providers/gpsSource';
export type { MapSource, RawMapData } from './providers/mapSource';
export type { ObdSource } from './providers/obdSource';
export type { WeatherSource } from './providers/weatherSource';
export type { DriverSource } from './providers/driverSource';
export {
  createGpsServiceSource,
  createUnifiedStoreGpsLocationPort,
  type GpsLocationPort,
  type GpsLocationSnapshot,
  type GpsSpeedUnit,
  type GpsClock,
  type GpsSourcePolicy,
  type GpsServiceSourceDependencies,
} from './providers/concrete/gpsServiceSource';
// NOT: concrete OBD binding (`createObdServiceHealthPort`) obdService'i import
// eder (import-time yan etki) → BİLİNÇLİ olarak bu barrel'dan dışa VERİLMEZ;
// wiring onu doğrudan `providers/concrete/obdServiceHealthPort`ten alır.
export {
  createObdServiceSource,
  type ObdHealthPort,
  type ObdHealthSnapshot,
  type ObdServiceSourceDependencies,
} from './providers/concrete/obdServiceSource';

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
  evaluateSpeedLimitRisk,
  SPEED_LIMIT_RULE_ID,
  type SpeedLimitRiskInput,
  type SpeedLimitSegmentInput,
  type SpeedLimitVehicleInput,
  type SpeedLimitPolicyInput,
  evaluateRoadProfileRisk,
  ROAD_PROFILE_RULE_ID,
  type RoadProfileRiskInput,
  type RoadProfileSegmentInput,
  type RoadProfileVehicleInput,
  type RoadProfilePolicyInput,
  type RoadProfileGradeThresholds,
  evaluateWeatherRisk,
  WEATHER_RULE_ID,
  type WeatherRiskInput,
  type WeatherConditionInput,
  type WeatherRiskPolicyInput,
  type WeatherSurfaceCondition,
  type WeatherSeverityOrNone,
  type WeatherSeverityByCondition,
  evaluateVehicleHealthRisk,
  VEHICLE_HEALTH_RULE_ID,
  type VehicleHealthRiskInput,
  type VehicleHealthSignalsInput,
  type VehicleHealthPolicyInput,
  type VehicleHealthThresholds,
  type VehicleHealthCoolantThresholds,
  type VehicleHealthOilPressureThresholds,
  type VehicleHealthBatteryVoltageThresholds,
  type VehicleHealthBooleanSeverities,
  evaluateRoadHazardRisk,
  ROAD_HAZARD_RULE_ID,
  type RoadHazardRiskInput,
  type RoadHazardInput,
  type RoadHazardRiskPolicyInput,
  type RoadHazardSeverityByHazard,
  type RoadHazardSeverityOrNone,
  type RoadHazardType,
  evaluateDriverFatigueRisk,
  DRIVER_FATIGUE_RULE_ID,
  type DriverFatigueRiskInput,
  type DriverFatigueSignalsInput,
  type DriverFatiguePolicyInput,
  type DriverFatigueThresholds,
  type DriverFatigueTierThresholds,
  type DriverFatigueNightDrivingPolicy,
  type DriverFatigueBooleanSeverities,
  evaluateSpeedCameraRisk,
  SPEED_CAMERA_RULE_ID,
  type SpeedCameraRiskInput,
  type SpeedCameraInput,
  type SpeedCameraRiskPolicyInput,
  type SpeedCameraSeverityByCameraType,
  type SpeedCameraSeverityOrNone,
  type SpeedCameraType,
} from './rules';
