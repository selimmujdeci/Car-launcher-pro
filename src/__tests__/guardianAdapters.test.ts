/**
 * guardianAdapters.test.ts — GUARDIAN-AI-G11 (Adapter Contracts, Phase 1).
 *
 * Adapter'lar raw platform verisini kural Input'larına dönüştürür. GERÇEK IO YOK
 * (bu fazda raw veri DI ile gelir). FAIL-SOFT: eksik/bozuk okuma → undefined
 * (throw DEĞİL) → registry o kuralı atlar, Guardian çalışmaya devam eder.
 * Kapsam: her adapter valid→map / eksik→undefined / bozuk→undefined · immutable ·
 * deterministic · guardianAdapterRegistry (boş/kısmi/tam) · uçtan uca
 * raw → registry input → buildGuardianRuleResults → runGuardian.
 */
import { describe, it, expect } from 'vitest';
import { adaptCurveInput } from '../platform/navigation/guardian/adapters/curveAdapter';
import { adaptSpeedLimitInput } from '../platform/navigation/guardian/adapters/speedLimitAdapter';
import { adaptRoadProfileInput } from '../platform/navigation/guardian/adapters/roadProfileAdapter';
import { adaptWeatherInput } from '../platform/navigation/guardian/adapters/weatherAdapter';
import { adaptVehicleHealthInput } from '../platform/navigation/guardian/adapters/vehicleHealthAdapter';
import { adaptRoadHazardInput } from '../platform/navigation/guardian/adapters/roadHazardAdapter';
import { adaptDriverFatigueInput } from '../platform/navigation/guardian/adapters/driverFatigueAdapter';
import { adaptSpeedCameraInput } from '../platform/navigation/guardian/adapters/speedCameraAdapter';
import { buildGuardianRegistryInput } from '../platform/navigation/guardian/adapters/guardianAdapterRegistry';
import type { GuardianRawPlatformData } from '../platform/navigation/guardian/adapters/guardianAdapterRegistry';
import { buildGuardianRuleResults } from '../platform/navigation/guardian/guardianRuleRegistry';
import { runGuardian } from '../platform/navigation/guardian/guardianEngine';

/* ── Bilinen-iyi raw fixtureları ──────────────────────────────────────────── */

const CURVE_POLICY = { warningLeadTimeSeconds: 8, minimumWarningDistanceMeters: 50, overspeedToleranceKph: 2 };
const SPEED_POLICY = { warningLeadTimeSeconds: 8, minimumWarningDistanceMeters: 50, overspeedToleranceKph: 2 };
const ROAD_POLICY = { warningLeadTimeSeconds: 8, minimumWarningDistanceMeters: 50 };
const GRADE_THRESHOLDS = { low: 8, medium: 12, high: 16, critical: 20 };
const WEATHER_POLICY = { severityByCondition: { dry: 'NONE', wet: 'LOW', snow: 'HIGH', ice: 'CRITICAL' } } as const;
const VH_POLICY = {
  thresholds: { coolant: { high: 100, critical: 115 }, oilPressure: { low: 100, critical: 50 }, batteryVoltage: { low: 12, critical: 11 } },
  booleanSeverities: { brakeWarning: 'HIGH', engineWarningLamp: 'LOW', transmissionWarning: 'HIGH' },
} as const;
const HAZARD_POLICY = { severityByHazard: { accident: 'HIGH' } } as const;
const FATIGUE_POLICY = {
  thresholds: {
    continuousDriving: { elevatedMinutes: 90, highMinutes: 120, criticalMinutes: 180 },
    breakAge: { elevatedMinutes: 120, highMinutes: 180, criticalMinutes: 240 },
    tripDuration: { elevatedMinutes: 180, highMinutes: 300, criticalMinutes: 420 },
  },
  nightDriving: { startHour: 22, endHour: 6, severity: 'MEDIUM' },
  booleanSeverities: { lowAttentionSignal: 'MEDIUM', repeatedLaneCorrectionSignal: 'HIGH', microsleepSuspectedSignal: 'CRITICAL' },
  minimumConfidence: 0.3,
} as const;
const CAMERA_POLICY = { severityByCameraType: { average_speed: 'HIGH' }, minimumConfidence: 0.3 } as const;

function rawFull(): GuardianRawPlatformData {
  return {
    curve: { id: 'curve-1', distanceMeters: 100, direction: 'left', advisorySpeedKph: 60, confidence: 0.8, currentSpeedKph: 90, policy: CURVE_POLICY },
    speedLimit: { id: 'seg-1', distanceMeters: 100, postedSpeedLimitKph: 100, confidence: 0.8, currentSpeedKph: 105, policy: SPEED_POLICY },
    roadProfile: { id: 'downhill-1', distanceMeters: 40, downhillGradePercent: 14, confidence: 0.8, currentSpeedKph: 80, policy: ROAD_POLICY, gradeThresholds: GRADE_THRESHOLDS },
    weather: { surfaceCondition: 'wet', source: 'osm', confidence: 0.8, policy: WEATHER_POLICY },
    vehicleHealth: { batteryVoltage: 11.5, policy: VH_POLICY },
    roadHazard: { id: 'hz-1', hazardType: 'accident', distanceMeters: 400, confidence: 0.8, policy: HAZARD_POLICY },
    driverFatigue: { microsleepSuspectedSignal: true, confidence: 0.8, policy: FATIGUE_POLICY },
    speedCamera: { id: 'cam-1', cameraType: 'average_speed', distanceMeters: 500, confidence: 0.8, policy: CAMERA_POLICY },
  };
}

/* ── curveAdapter ──────────────────────────────────────────────────────────── */

describe('adaptCurveInput', () => {
  it('valid raw → CurveRiskInput', () => {
    const r = adaptCurveInput(rawFull().curve);
    expect(r).toBeDefined();
    expect(r!.curve.id).toBe('curve-1');
    expect(r!.curve.advisorySpeedKph).toBe(60);
    expect(r!.vehicle.currentSpeedKph).toBe(90);
    expect(r!.policy).toBe(CURVE_POLICY);
  });
  it('undefined raw → undefined', () => {
    expect(adaptCurveInput(undefined)).toBeUndefined();
  });
  it('eksik id → undefined', () => {
    expect(adaptCurveInput({ distanceMeters: 100, currentSpeedKph: 90, confidence: 0.8, policy: CURVE_POLICY })).toBeUndefined();
  });
  it('bozuk distanceMeters (NaN) → undefined', () => {
    expect(adaptCurveInput({ id: 'c', distanceMeters: NaN, currentSpeedKph: 90, confidence: 0.8, policy: CURVE_POLICY })).toBeUndefined();
  });
  it('policy yok → undefined', () => {
    expect(adaptCurveInput({ id: 'c', distanceMeters: 100, currentSpeedKph: 90, confidence: 0.8 })).toBeUndefined();
  });
  it('geçersiz direction → "unknown"e düşer (drop DEĞİL, fiziksel yön belirsiz)', () => {
    const r = adaptCurveInput({ id: 'c', distanceMeters: 100, direction: 'diagonal' as never, currentSpeedKph: 90, confidence: 0.8, policy: CURVE_POLICY });
    expect(r!.curve.direction).toBe('unknown');
  });
});

/* ── speedLimitAdapter ─────────────────────────────────────────────────────── */

describe('adaptSpeedLimitInput', () => {
  it('valid → SpeedLimitRiskInput', () => {
    const r = adaptSpeedLimitInput(rawFull().speedLimit);
    expect(r!.segment.id).toBe('seg-1');
    expect(r!.segment.postedSpeedLimitKph).toBe(100);
    expect(r!.vehicle.currentSpeedKph).toBe(105);
  });
  it('eksik currentSpeedKph → undefined', () => {
    expect(adaptSpeedLimitInput({ id: 's', distanceMeters: 100, confidence: 0.8, policy: SPEED_POLICY })).toBeUndefined();
  });
});

/* ── roadProfileAdapter ────────────────────────────────────────────────────── */

describe('adaptRoadProfileInput', () => {
  it('valid → RoadProfileRiskInput (policy + gradeThresholds)', () => {
    const r = adaptRoadProfileInput(rawFull().roadProfile);
    expect(r!.segment.downhillGradePercent).toBe(14);
    expect(r!.gradeThresholds).toBe(GRADE_THRESHOLDS);
  });
  it('gradeThresholds yok → undefined', () => {
    expect(adaptRoadProfileInput({ id: 'd', distanceMeters: 40, confidence: 0.8, currentSpeedKph: 80, policy: ROAD_POLICY })).toBeUndefined();
  });
});

/* ── weatherAdapter ────────────────────────────────────────────────────────── */

describe('adaptWeatherInput', () => {
  it('valid → WeatherRiskInput', () => {
    const r = adaptWeatherInput(rawFull().weather);
    expect(r!.condition.surfaceCondition).toBe('wet');
    expect(r!.condition.confidence).toBe(0.8);
  });
  it('confidence yok → undefined', () => {
    expect(adaptWeatherInput({ surfaceCondition: 'wet', policy: WEATHER_POLICY })).toBeUndefined();
  });
  it('geçersiz surfaceCondition → alan drop (rule fail-closed), input yine defined', () => {
    const r = adaptWeatherInput({ surfaceCondition: 'foggy' as never, confidence: 0.8, policy: WEATHER_POLICY });
    expect(r).toBeDefined();
    expect(r!.condition.surfaceCondition).toBeUndefined();
  });
});

/* ── vehicleHealthAdapter ──────────────────────────────────────────────────── */

describe('adaptVehicleHealthInput', () => {
  it('valid → VehicleHealthRiskInput', () => {
    const r = adaptVehicleHealthInput(rawFull().vehicleHealth);
    expect(r!.signals.batteryVoltage).toBe(11.5);
    expect(r!.policy).toBe(VH_POLICY);
  });
  it('policy yok → undefined', () => {
    expect(adaptVehicleHealthInput({ batteryVoltage: 11.5 })).toBeUndefined();
  });
  it('bozuk numeric signal (coolant NaN) → o alan drop', () => {
    const r = adaptVehicleHealthInput({ coolantTemperatureC: NaN, batteryVoltage: 11.5, policy: VH_POLICY });
    expect(r!.signals.coolantTemperatureC).toBeUndefined();
    expect(r!.signals.batteryVoltage).toBe(11.5);
  });
  it('boolean signal taşınır', () => {
    const r = adaptVehicleHealthInput({ brakeWarning: true, policy: VH_POLICY });
    expect(r!.signals.brakeWarning).toBe(true);
  });
});

/* ── roadHazardAdapter ─────────────────────────────────────────────────────── */

describe('adaptRoadHazardInput', () => {
  it('valid → RoadHazardRiskInput', () => {
    const r = adaptRoadHazardInput(rawFull().roadHazard);
    expect(r!.hazard.id).toBe('hz-1');
    expect(r!.hazard.hazardType).toBe('accident');
    expect(r!.hazard.distanceMeters).toBe(400);
  });
  it('negatif distanceMeters → undefined', () => {
    expect(adaptRoadHazardInput({ id: 'h', hazardType: 'accident', distanceMeters: -1, confidence: 0.8, policy: HAZARD_POLICY })).toBeUndefined();
  });
});

/* ── driverFatigueAdapter ──────────────────────────────────────────────────── */

describe('adaptDriverFatigueInput', () => {
  it('valid → DriverFatigueRiskInput', () => {
    const r = adaptDriverFatigueInput(rawFull().driverFatigue);
    expect(r!.signals.microsleepSuspectedSignal).toBe(true);
    expect(r!.policy).toBe(FATIGUE_POLICY);
  });
  it('policy yok → undefined', () => {
    expect(adaptDriverFatigueInput({ microsleepSuspectedSignal: true })).toBeUndefined();
  });
  it('fractional localHour → alan drop (rule throw etmez)', () => {
    const r = adaptDriverFatigueInput({ localHour: 12.5, microsleepSuspectedSignal: true, confidence: 0.8, policy: FATIGUE_POLICY });
    expect(r!.signals.localHour).toBeUndefined();
    expect(r!.signals.microsleepSuspectedSignal).toBe(true);
  });
  it('negatif süre → alan drop', () => {
    const r = adaptDriverFatigueInput({ continuousDrivingMinutes: -5, policy: FATIGUE_POLICY });
    expect(r!.signals.continuousDrivingMinutes).toBeUndefined();
  });
});

/* ── speedCameraAdapter ────────────────────────────────────────────────────── */

describe('adaptSpeedCameraInput', () => {
  it('valid → SpeedCameraRiskInput', () => {
    const r = adaptSpeedCameraInput(rawFull().speedCamera);
    expect(r!.camera.id).toBe('cam-1');
    expect(r!.camera.cameraType).toBe('average_speed');
    expect(r!.camera.distanceMeters).toBe(500);
  });
  it('eksik id → undefined', () => {
    expect(adaptSpeedCameraInput({ cameraType: 'average_speed', distanceMeters: 500, confidence: 0.8, policy: CAMERA_POLICY })).toBeUndefined();
  });
});

/* ── Immutable + deterministic ─────────────────────────────────────────────── */

describe('adapters — immutable / deterministic', () => {
  it('raw girdi mutasyona uğratılmaz', () => {
    const raw = rawFull();
    const snapshot = JSON.parse(JSON.stringify(raw));
    buildGuardianRegistryInput(raw);
    expect(raw).toEqual(snapshot);
  });
  it('donmuş raw ile çalışır', () => {
    const raw = Object.freeze(rawFull());
    expect(() => buildGuardianRegistryInput(raw)).not.toThrow();
  });
  it('aynı raw → aynı registry input', () => {
    const raw = rawFull();
    expect(buildGuardianRegistryInput(raw)).toEqual(buildGuardianRegistryInput(raw));
  });
});

/* ── guardianAdapterRegistry ───────────────────────────────────────────────── */

describe('buildGuardianRegistryInput', () => {
  it('tam raw → 8 alanlı GuardianRuleRegistryInput', () => {
    const out = buildGuardianRegistryInput(rawFull());
    expect(Object.keys(out).sort()).toEqual([
      'curve', 'driverFatigue', 'roadHazard', 'roadProfile', 'speedCamera', 'speedLimit', 'vehicleHealth', 'weather',
    ]);
  });
  it('boş platform verisi {} → {}', () => {
    expect(buildGuardianRegistryInput({})).toEqual({});
  });
  it('undefined platform verisi → {} (fail-soft, throw yok)', () => {
    expect(buildGuardianRegistryInput(undefined)).toEqual({});
  });
  it('bozuk platform verisi (dizi) → {} (fail-soft)', () => {
    expect(buildGuardianRegistryInput([] as unknown as GuardianRawPlatformData)).toEqual({});
  });
  it('kısmi raw → yalnız geçerli olan bölümler (bozuk bölüm atlanır)', () => {
    const out = buildGuardianRegistryInput({
      curve: rawFull().curve,
      speedLimit: { id: 's' } as never, // bozuk (eksik alanlar) → adapter undefined → atlanır
      weather: rawFull().weather,
    });
    expect(Object.keys(out).sort()).toEqual(['curve', 'weather']);
  });
});

/* ── Uçtan uca: raw → registry input → rule results → runGuardian ───────────── */

describe('adapters — uçtan uca pipeline', () => {
  it('rawFull → buildGuardianRegistryInput → buildGuardianRuleResults → 8 RuleResult', () => {
    const registryInput = buildGuardianRegistryInput(rawFull());
    const results = buildGuardianRuleResults(registryInput);
    expect(results.map((r) => r.ruleId)).toEqual([
      'curve-risk', 'speed-limit', 'road-profile', 'weather', 'vehicle-health', 'road-hazard', 'driver-fatigue', 'speed-camera',
    ]);
  });
  it('rawFull → runGuardian → 8 event birleşir', () => {
    const output = runGuardian({ ruleResults: buildGuardianRuleResults(buildGuardianRegistryInput(rawFull())) });
    expect(output.riskEvents).toHaveLength(8);
    expect(output.highestSeverity).toBe('CRITICAL');
  });
  it('bozuk platform → boş pipeline (Guardian çalışmaya devam eder, throw yok)', () => {
    const output = runGuardian({ ruleResults: buildGuardianRuleResults(buildGuardianRegistryInput(undefined)) });
    expect(output.riskEvents).toEqual([]);
    expect(output.overallRiskScore).toBe(0);
  });
});
