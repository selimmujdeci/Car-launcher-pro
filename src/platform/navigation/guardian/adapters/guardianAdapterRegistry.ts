/**
 * guardianAdapterRegistry — GUARDIAN-AI-G11 (Adapter Contracts, Phase 1).
 *
 * Adapter katmanının TEK giriş noktası. `buildGuardianRegistryInput(raw)` tüm
 * raw platform bölümlerini ilgili adapter'lardan geçirir ve saf orkestratörün
 * beklediği `GuardianRuleRegistryInput`i üretir. Böylece boru hattı:
 *   raw platform → buildGuardianRegistryInput → GuardianRuleRegistryInput
 *   → buildGuardianRuleResults → runGuardian.
 *
 * GERÇEK IO YOK (raw DI ile gelir). FAIL-SOFT: bir bölüm eksik/bozuksa ilgili
 * adapter `undefined` döndürür ve o alan çıktıya EKLENMEZ (registry o kuralı
 * atlar) — Guardian çalışmaya devam eder, THROW YOK. Tüm raw bozuksa (null/dizi/
 * primitive) boş `{}` döner. Girdi MUTASYONA UĞRATILMAZ; Date.now/Math.random/
 * global durum YOK.
 *
 * KARAR VERMEZ — yalnız şekil dönüşümü; severity/eşik/dedup hâlâ kurallar +
 * runGuardian'ın işidir.
 */
import type { GuardianRuleRegistryInput } from '../guardianRuleRegistry';
import { adaptCurveInput, type RawCurveData } from './curveAdapter';
import { adaptSpeedLimitInput, type RawSpeedLimitData } from './speedLimitAdapter';
import { adaptRoadProfileInput, type RawRoadProfileData } from './roadProfileAdapter';
import { adaptWeatherInput, type RawWeatherData } from './weatherAdapter';
import { adaptVehicleHealthInput, type RawVehicleHealthData } from './vehicleHealthAdapter';
import { adaptRoadHazardInput, type RawRoadHazardData } from './roadHazardAdapter';
import { adaptDriverFatigueInput, type RawDriverFatigueData } from './driverFatigueAdapter';
import { adaptSpeedCameraInput, type RawSpeedCameraData } from './speedCameraAdapter';

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Tüm domainlerin raw platform verisi — her bölüm opsiyonel; eksik/bozuk bölüm
 *  ilgili kuralı devre dışı bırakır (fail-soft). */
export interface GuardianRawPlatformData {
  curve?:          RawCurveData;
  speedLimit?:     RawSpeedLimitData;
  roadProfile?:    RawRoadProfileData;
  weather?:        RawWeatherData;
  vehicleHealth?:  RawVehicleHealthData;
  roadHazard?:     RawRoadHazardData;
  driverFatigue?:  RawDriverFatigueData;
  speedCamera?:    RawSpeedCameraData;
}

export function buildGuardianRegistryInput(raw: GuardianRawPlatformData | undefined): GuardianRuleRegistryInput {
  if (!isObject(raw)) return {};

  const out: GuardianRuleRegistryInput = {};

  const curve = adaptCurveInput(raw.curve);
  if (curve !== undefined) out.curve = curve;

  const speedLimit = adaptSpeedLimitInput(raw.speedLimit);
  if (speedLimit !== undefined) out.speedLimit = speedLimit;

  const roadProfile = adaptRoadProfileInput(raw.roadProfile);
  if (roadProfile !== undefined) out.roadProfile = roadProfile;

  const weather = adaptWeatherInput(raw.weather);
  if (weather !== undefined) out.weather = weather;

  const vehicleHealth = adaptVehicleHealthInput(raw.vehicleHealth);
  if (vehicleHealth !== undefined) out.vehicleHealth = vehicleHealth;

  const roadHazard = adaptRoadHazardInput(raw.roadHazard);
  if (roadHazard !== undefined) out.roadHazard = roadHazard;

  const driverFatigue = adaptDriverFatigueInput(raw.driverFatigue);
  if (driverFatigue !== undefined) out.driverFatigue = driverFatigue;

  const speedCamera = adaptSpeedCameraInput(raw.speedCamera);
  if (speedCamera !== undefined) out.speedCamera = speedCamera;

  return out;
}
