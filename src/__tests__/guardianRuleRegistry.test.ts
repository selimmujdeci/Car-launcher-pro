/**
 * guardianRuleRegistry.test.ts — GUARDIAN-AI-G10.
 *
 * `buildGuardianRuleResults` — Guardian'ın TEK giriş noktası (saf orkestratör).
 * 8 kuralı SABİT sırada çalıştırır; KARAR VERMEZ, FİLTRELEMEZ, DEDUP YAPMAZ,
 * event DEĞİŞTİRMEZ — yalnız var olan bölümlerin `GuardianRuleResult`larını
 * üretip sırayla döndürür. Kapsam: tek-kural senaryoları · 8 kural birlikte ·
 * eksik/boş input · sabit çağrı sırası (obje anahtar sırasından bağımsız) ·
 * present-ama-bozuk bölüm → kural throw · immutable · deterministic ·
 * GuardianEngine (registry → runGuardian) entegrasyonu · regresyon.
 */
import { describe, it, expect } from 'vitest';
import {
  buildGuardianRuleResults,
  GUARDIAN_RULE_REGISTRY_ORDER,
} from '../platform/navigation/guardian/guardianRuleRegistry';
import type { GuardianRuleRegistryInput } from '../platform/navigation/guardian/guardianRuleRegistry';
import { runGuardian } from '../platform/navigation/guardian/guardianEngine';

/* ── Bilinen-iyi kural girdileri (önceki testlerden) ──────────────────────── */

const curveInput: NonNullable<GuardianRuleRegistryInput['curve']> = {
  curve: { id: 'curve-1', distanceMeters: 100, direction: 'left', advisorySpeedKph: 60, confidence: 0.8 },
  vehicle: { currentSpeedKph: 90 }, // CRITICAL
  policy: { warningLeadTimeSeconds: 8, minimumWarningDistanceMeters: 50, overspeedToleranceKph: 2 },
};

const speedLimitInput: NonNullable<GuardianRuleRegistryInput['speedLimit']> = {
  segment: { id: 'seg-1', distanceMeters: 100, postedSpeedLimitKph: 100, confidence: 0.8 },
  vehicle: { currentSpeedKph: 105 }, // LOW
  policy: { warningLeadTimeSeconds: 8, minimumWarningDistanceMeters: 50, overspeedToleranceKph: 2 },
};

const roadProfileInput: NonNullable<GuardianRuleRegistryInput['roadProfile']> = {
  segment: { id: 'downhill-1', distanceMeters: 40, downhillGradePercent: 14, confidence: 0.8 }, // MEDIUM
  vehicle: { currentSpeedKph: 80 },
  policy: { warningLeadTimeSeconds: 8, minimumWarningDistanceMeters: 50 },
  gradeThresholds: { low: 8, medium: 12, high: 16, critical: 20 },
};

const weatherInput: NonNullable<GuardianRuleRegistryInput['weather']> = {
  condition: { surfaceCondition: 'wet', source: 'osm', confidence: 0.8 },
  policy: { severityByCondition: { dry: 'NONE', wet: 'LOW', snow: 'HIGH', ice: 'CRITICAL' } }, // LOW
};

const vehicleHealthInput: NonNullable<GuardianRuleRegistryInput['vehicleHealth']> = {
  signals: { batteryVoltage: 11.5 }, // LOW
  policy: {
    thresholds: { coolant: { high: 100, critical: 115 }, oilPressure: { low: 100, critical: 50 }, batteryVoltage: { low: 12, critical: 11 } },
    booleanSeverities: { brakeWarning: 'HIGH', engineWarningLamp: 'LOW', transmissionWarning: 'HIGH' },
  },
};

const roadHazardInput: NonNullable<GuardianRuleRegistryInput['roadHazard']> = {
  hazard: { id: 'hz-1', hazardType: 'accident', distanceMeters: 400, confidence: 0.8 }, // HIGH
  policy: { severityByHazard: { accident: 'HIGH' } },
};

const driverFatigueInput: NonNullable<GuardianRuleRegistryInput['driverFatigue']> = {
  signals: { microsleepSuspectedSignal: true, confidence: 0.8 }, // CRITICAL
  policy: {
    thresholds: {
      continuousDriving: { elevatedMinutes: 90, highMinutes: 120, criticalMinutes: 180 },
      breakAge: { elevatedMinutes: 120, highMinutes: 180, criticalMinutes: 240 },
      tripDuration: { elevatedMinutes: 180, highMinutes: 300, criticalMinutes: 420 },
    },
    nightDriving: { startHour: 22, endHour: 6, severity: 'MEDIUM' },
    booleanSeverities: { lowAttentionSignal: 'MEDIUM', repeatedLaneCorrectionSignal: 'HIGH', microsleepSuspectedSignal: 'CRITICAL' },
    minimumConfidence: 0.3,
  },
};

const speedCameraInput: NonNullable<GuardianRuleRegistryInput['speedCamera']> = {
  camera: { id: 'cam-1', cameraType: 'average_speed', distanceMeters: 500, confidence: 0.8 }, // HIGH
  policy: { severityByCameraType: { average_speed: 'HIGH' }, minimumConfidence: 0.3 },
};

function fullInput(): GuardianRuleRegistryInput {
  return {
    curve: curveInput,
    speedLimit: speedLimitInput,
    roadProfile: roadProfileInput,
    weather: weatherInput,
    vehicleHealth: vehicleHealthInput,
    roadHazard: roadHazardInput,
    driverFatigue: driverFatigueInput,
    speedCamera: speedCameraInput,
  };
}

const ORDER = [
  'curve-risk', 'speed-limit', 'road-profile', 'weather',
  'vehicle-health', 'road-hazard', 'driver-fatigue', 'speed-camera',
] as const;

/* ── Tek kural senaryoları ─────────────────────────────────────────────────── */

describe('buildGuardianRuleResults — tek kural', () => {
  it('yalnız curve → tek RuleResult (curve-risk)', () => {
    const results = buildGuardianRuleResults({ curve: curveInput });
    expect(results.map((r) => r.ruleId)).toEqual(['curve-risk']);
    expect(results[0].riskEvents[0].type).toBe('CURVE_RISK');
  });
  it('yalnız speed → speed-limit', () => {
    expect(buildGuardianRuleResults({ speedLimit: speedLimitInput }).map((r) => r.ruleId)).toEqual(['speed-limit']);
  });
  it('yalnız roadProfile → road-profile', () => {
    expect(buildGuardianRuleResults({ roadProfile: roadProfileInput }).map((r) => r.ruleId)).toEqual(['road-profile']);
  });
  it('yalnız weather → weather', () => {
    expect(buildGuardianRuleResults({ weather: weatherInput }).map((r) => r.ruleId)).toEqual(['weather']);
  });
  it('yalnız vehicleHealth → vehicle-health', () => {
    expect(buildGuardianRuleResults({ vehicleHealth: vehicleHealthInput }).map((r) => r.ruleId)).toEqual(['vehicle-health']);
  });
  it('yalnız roadHazard → road-hazard', () => {
    expect(buildGuardianRuleResults({ roadHazard: roadHazardInput }).map((r) => r.ruleId)).toEqual(['road-hazard']);
  });
  it('yalnız driverFatigue → driver-fatigue', () => {
    expect(buildGuardianRuleResults({ driverFatigue: driverFatigueInput }).map((r) => r.ruleId)).toEqual(['driver-fatigue']);
  });
  it('yalnız speedCamera → speed-camera', () => {
    expect(buildGuardianRuleResults({ speedCamera: speedCameraInput }).map((r) => r.ruleId)).toEqual(['speed-camera']);
  });
});

/* ── Bütün kurallar + sabit sıra ───────────────────────────────────────────── */

describe('buildGuardianRuleResults — bütün kurallar + sabit sıra', () => {
  it('8 kural → 8 RuleResult, SABİT sırada', () => {
    const results = buildGuardianRuleResults(fullInput());
    expect(results.map((r) => r.ruleId)).toEqual([...ORDER]);
  });

  it('sabit çağrı sırası — obje ANAHTAR sırası TERS olsa bile çıktı sırası değişmez', () => {
    const reversed: GuardianRuleRegistryInput = {
      speedCamera: speedCameraInput,
      driverFatigue: driverFatigueInput,
      roadHazard: roadHazardInput,
      vehicleHealth: vehicleHealthInput,
      weather: weatherInput,
      roadProfile: roadProfileInput,
      speedLimit: speedLimitInput,
      curve: curveInput,
    };
    expect(buildGuardianRuleResults(reversed).map((r) => r.ruleId)).toEqual([...ORDER]);
  });

  it('GUARDIAN_RULE_REGISTRY_ORDER dışa verilen sıra ile tutarlı', () => {
    expect([...GUARDIAN_RULE_REGISTRY_ORDER]).toEqual([...ORDER]);
  });

  it('registry HİÇBİR event\'i değiştirmez — kuralın kendi çıktısı aynen döner', () => {
    const results = buildGuardianRuleResults({ curve: curveInput });
    expect(results[0].riskEvents[0].severity).toBe('CRITICAL'); // curve ratio 1.5
    expect(results[0].riskEvents[0].id).toBe('curve-risk:curve-1');
  });
});

/* ── Eksik / boş input (fail-closed) ───────────────────────────────────────── */

describe('buildGuardianRuleResults — eksik/boş input', () => {
  it('boş input {} → boş dizi', () => {
    expect(buildGuardianRuleResults({})).toEqual([]);
  });

  it('alt küme (curve+weather+speedCamera) → yalnız o üçü, sırada', () => {
    const results = buildGuardianRuleResults({ curve: curveInput, weather: weatherInput, speedCamera: speedCameraInput });
    expect(results.map((r) => r.ruleId)).toEqual(['curve-risk', 'weather', 'speed-camera']);
  });

  it('eksik bölüm ilgili kuralı ÇALIŞTIRMAZ (diğerleri etkilenmez)', () => {
    const results = buildGuardianRuleResults({ curve: curveInput, driverFatigue: driverFatigueInput });
    expect(results.map((r) => r.ruleId)).toEqual(['curve-risk', 'driver-fatigue']);
  });

  it('bir kural fail-closed boş RuleResult üretse bile registry onu DAHİL EDER (filtrelemez)', () => {
    // weather 'dry'→NONE → boş riskEvents ama RuleResult yine döner.
    const dryWeather: NonNullable<GuardianRuleRegistryInput['weather']> = {
      condition: { surfaceCondition: 'dry', source: 'osm', confidence: 0.8 },
      policy: { severityByCondition: { dry: 'NONE', wet: 'LOW', snow: 'HIGH', ice: 'CRITICAL' } },
    };
    const results = buildGuardianRuleResults({ weather: dryWeather });
    expect(results).toHaveLength(1);
    expect(results[0].ruleId).toBe('weather');
    expect(results[0].riskEvents).toEqual([]);
  });
});

/* ── Validation → THROW (programlama hatası) ──────────────────────────────── */

describe('buildGuardianRuleResults — validation throw', () => {
  it('input undefined → THROW', () => {
    expect(() => buildGuardianRuleResults(undefined as unknown as GuardianRuleRegistryInput)).toThrow();
  });
  it('input null → THROW', () => {
    expect(() => buildGuardianRuleResults(null as unknown as GuardianRuleRegistryInput)).toThrow();
  });
  it('input dizi → THROW', () => {
    expect(() => buildGuardianRuleResults([] as unknown as GuardianRuleRegistryInput)).toThrow();
  });
  it('present ama BOZUK bölüm → ilgili kuralın throw\'u YAYILIR (gizlenmez)', () => {
    const bad = { curve: { curve: { id: '', distanceMeters: 100, direction: 'left', confidence: 0.8 }, vehicle: { currentSpeedKph: 90 }, policy: { warningLeadTimeSeconds: 8, minimumWarningDistanceMeters: 50, overspeedToleranceKph: 2 } } } as unknown as GuardianRuleRegistryInput;
    expect(() => buildGuardianRuleResults(bad)).toThrow();
  });
});

/* ── Immutable + deterministic ─────────────────────────────────────────────── */

describe('buildGuardianRuleResults — immutable / deterministic', () => {
  it('girdi mutasyona uğratılmaz (snapshot)', () => {
    const i = fullInput();
    const snapshot = JSON.parse(JSON.stringify(i));
    buildGuardianRuleResults(i);
    expect(i).toEqual(snapshot);
  });
  it('donmuş (Object.freeze) input ile çalışır', () => {
    const i = Object.freeze({ curve: curveInput, weather: weatherInput });
    expect(() => buildGuardianRuleResults(i)).not.toThrow();
  });
  it('aynı input → aynı output', () => {
    const i = fullInput();
    expect(buildGuardianRuleResults(i)).toEqual(buildGuardianRuleResults(i));
  });
});

/* ── GuardianEngine entegrasyonu ───────────────────────────────────────────── */

describe('buildGuardianRuleResults — GuardianEngine entegrasyonu', () => {
  it('registry çıktısı runGuardian\'a verilince 8 event birleşir (dedup/sıralama motorun işi)', () => {
    const ruleResults = buildGuardianRuleResults(fullInput());
    const output = runGuardian({ ruleResults });
    expect(output.riskEvents).toHaveLength(8);
    expect(output.riskEvents.map((e) => e.type).sort()).toEqual([
      'CURVE_RISK', 'DOWNHILL_RISK', 'DRIVER_FATIGUE_RISK', 'ROAD_HAZARD',
      'SPEED_CAMERA_WARNING', 'SPEED_LIMIT_RISK', 'VEHICLE_HEALTH_RISK', 'WEATHER_RISK',
    ]);
    expect(output.highestSeverity).toBe('CRITICAL');
  });

  it('boş registry → runGuardian boş çıktı', () => {
    const output = runGuardian({ ruleResults: buildGuardianRuleResults({}) });
    expect(output.riskEvents).toEqual([]);
    expect(output.overallRiskScore).toBe(0);
  });

  it('registry dedup YAPMAZ — aynı id iki kez üretilirse ikisini de döndürür (dedup motorda)', () => {
    // İki ayrı registry çağrısı aynı curve id ile → runGuardian dedup eder.
    const a = buildGuardianRuleResults({ curve: curveInput });
    const b = buildGuardianRuleResults({ curve: curveInput });
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    const output = runGuardian({ ruleResults: [...a, ...b] });
    expect(output.riskEvents).toHaveLength(1); // motor dedup'ladı
  });
});
