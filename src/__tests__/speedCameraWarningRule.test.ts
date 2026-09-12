/**
 * speedCameraWarningRule.test.ts — GUARDIAN-AI-G9.
 *
 * `evaluateSpeedCameraRisk` — sekizinci (son) Guardian analiz kuralı. RoadHazardRule
 * desenini izler: severity KATEGORİK (DI severityByCameraType), event GERÇEK
 * camera.distanceMeters taşır. GPS/harita/internet/kamera-verisi OKUMA YOK — DI.
 * Amaç ceza değil, güvenli sürüş/hız-limiti teşviki. Kapsam: 5 bilinen kamera tipi ·
 * unknown/undefined → event-yok · NONE → event-yok · confidence gate (policy
 * minimumConfidence, verilmezse varsayılan) · eksik-eşleme→throw · geçersiz severity/
 * confidence/distance→throw · deterministik id/çıktı · immutable · yasaklı ifade yok ·
 * distanceMeters DI'dan geçer · GuardianEngine (8 kural birlikte) · dedup · G1-G8 reg.
 */
import { describe, it, expect } from 'vitest';
import { evaluateSpeedCameraRisk, SPEED_CAMERA_RULE_ID } from '../platform/navigation/guardian/rules/speedCameraWarningRule';
import type {
  SpeedCameraRiskInput,
  SpeedCameraInput,
  SpeedCameraRiskPolicyInput,
  SpeedCameraSeverityByCameraType,
  SpeedCameraType,
} from '../platform/navigation/guardian/rules/speedCameraWarningRule';
import { evaluateCurveRisk } from '../platform/navigation/guardian/rules/curveRiskRule';
import { evaluateSpeedLimitRisk } from '../platform/navigation/guardian/rules/speedLimitRule';
import { evaluateRoadProfileRisk } from '../platform/navigation/guardian/rules/roadProfileRule';
import { evaluateWeatherRisk } from '../platform/navigation/guardian/rules/weatherRiskRule';
import { evaluateVehicleHealthRisk } from '../platform/navigation/guardian/rules/vehicleHealthRule';
import { evaluateRoadHazardRisk } from '../platform/navigation/guardian/rules/roadHazardRule';
import { evaluateDriverFatigueRisk } from '../platform/navigation/guardian/rules/driverFatigueRule';
import { runGuardian } from '../platform/navigation/guardian/guardianEngine';

/* ── Fixture yardımcıları ─────────────────────────────────────────────────── */

function severityMap(overrides: Partial<SpeedCameraSeverityByCameraType> = {}): SpeedCameraSeverityByCameraType {
  return {
    fixed_speed:   'MEDIUM',
    average_speed: 'HIGH',
    mobile_speed:  'MEDIUM',
    traffic_light: 'LOW',
    combined:      'HIGH',
    ...overrides,
  };
}

function camera(overrides: Partial<SpeedCameraInput> = {}): SpeedCameraInput {
  return { id: 'cam-1', cameraType: 'fixed_speed', distanceMeters: 500, confidence: 0.8, source: 'community', ...overrides };
}

function policy(
  severityOverrides: Partial<SpeedCameraSeverityByCameraType> = {},
  patch: Partial<SpeedCameraRiskPolicyInput> = {},
): SpeedCameraRiskPolicyInput {
  return { severityByCameraType: severityMap(severityOverrides), minimumConfidence: 0.3, ...patch };
}

function input(
  cameraOverrides: Partial<SpeedCameraInput> = {},
  severityOverrides: Partial<SpeedCameraSeverityByCameraType> = {},
  policyPatch: Partial<SpeedCameraRiskPolicyInput> = {},
): SpeedCameraRiskInput {
  return { camera: camera(cameraOverrides), policy: policy(severityOverrides, policyPatch) };
}

const KNOWN_TYPES: readonly SpeedCameraType[] = [
  'fixed_speed', 'average_speed', 'mobile_speed', 'traffic_light', 'combined',
];

/* ── Kategorik severity ────────────────────────────────────────────────────── */

describe('evaluateSpeedCameraRisk — kategorik severity (DI haritasından)', () => {
  it.each([
    ['fixed_speed',   'MEDIUM'],
    ['average_speed', 'HIGH'],
    ['mobile_speed',  'MEDIUM'],
    ['traffic_light', 'LOW'],
    ['combined',      'HIGH'],
  ] as const)('%s → %s event', (cameraType, expected) => {
    const result = evaluateSpeedCameraRisk(input({ cameraType }));
    expect(result.riskEvents).toHaveLength(1);
    expect(result.riskEvents[0].severity).toBe(expected);
    expect(result.riskEvents[0].type).toBe('SPEED_CAMERA_WARNING');
  });

  it('gömülü severity haritası YOK — aynı kamera, FARKLI DI haritası → FARKLI severity', () => {
    const a = evaluateSpeedCameraRisk(input({ cameraType: 'fixed_speed' }, {}));
    const b = evaluateSpeedCameraRisk(input({ cameraType: 'fixed_speed' }, { fixed_speed: 'CRITICAL' }));
    expect(a.riskEvents[0].severity).toBe('MEDIUM');
    expect(b.riskEvents[0].severity).toBe('CRITICAL');
  });

  it('NONE eşlemesi → event yok', () => {
    const result = evaluateSpeedCameraRisk(input({ cameraType: 'fixed_speed' }, { fixed_speed: 'NONE' }));
    expect(result).toEqual({ ruleId: SPEED_CAMERA_RULE_ID, riskEvents: [] });
  });
});

/* ── unknown / undefined → event yok ───────────────────────────────────────── */

describe('evaluateSpeedCameraRisk — unknown/undefined → event yok', () => {
  it('cameraType="unknown" → event yok', () => {
    expect(evaluateSpeedCameraRisk(input({ cameraType: 'unknown' })).riskEvents).toEqual([]);
  });
  it('cameraType undefined → event yok', () => {
    expect(evaluateSpeedCameraRisk(input({ cameraType: undefined })).riskEvents).toEqual([]);
  });
  it('unknown için eşleme OLMASA bile throw ATMAZ (aranmaz)', () => {
    const i: SpeedCameraRiskInput = {
      camera: camera({ cameraType: 'unknown' }),
      policy: { severityByCameraType: { fixed_speed: 'MEDIUM' }, minimumConfidence: 0.3 },
    };
    expect(() => evaluateSpeedCameraRisk(i)).not.toThrow();
    expect(evaluateSpeedCameraRisk(i).riskEvents).toEqual([]);
  });
});

/* ── Confidence gate ───────────────────────────────────────────────────────── */

describe('evaluateSpeedCameraRisk — confidence gate', () => {
  it('confidence (0.29) < minimumConfidence (0.3) → event yok', () => {
    expect(evaluateSpeedCameraRisk(input({ confidence: 0.29 })).riskEvents).toEqual([]);
  });
  it('confidence == minimumConfidence (0.3) → event üretilir', () => {
    expect(evaluateSpeedCameraRisk(input({ confidence: 0.3 })).riskEvents).toHaveLength(1);
  });
  it('minimumConfidence verilmezse varsayılan eşik uygulanır (0.2 < varsayılan → yok)', () => {
    const result = evaluateSpeedCameraRisk(input({ confidence: 0.2 }, {}, { minimumConfidence: undefined }));
    expect(result.riskEvents).toEqual([]);
  });
  it('minimumConfidence verilmezse yeterli confidence geçer', () => {
    const result = evaluateSpeedCameraRisk(input({ confidence: 0.8 }, {}, { minimumConfidence: undefined }));
    expect(result.riskEvents).toHaveLength(1);
  });
});

/* ── Validation throw ──────────────────────────────────────────────────────── */

describe('evaluateSpeedCameraRisk — validation throw', () => {
  it('input eksik → THROW', () => {
    expect(() => evaluateSpeedCameraRisk(undefined as unknown as SpeedCameraRiskInput)).toThrow();
  });
  it('camera eksik → THROW', () => {
    expect(() => evaluateSpeedCameraRisk({ camera: undefined as unknown as SpeedCameraInput, policy: policy() })).toThrow();
  });
  it('camera.id boş → THROW', () => {
    expect(() => evaluateSpeedCameraRisk(input({ id: '' }))).toThrow();
  });
  it('distanceMeters NaN → THROW', () => {
    expect(() => evaluateSpeedCameraRisk(input({ distanceMeters: NaN }))).toThrow();
  });
  it('distanceMeters Infinity → THROW', () => {
    expect(() => evaluateSpeedCameraRisk(input({ distanceMeters: Infinity }))).toThrow();
  });
  it('distanceMeters negatif → THROW', () => {
    expect(() => evaluateSpeedCameraRisk(input({ distanceMeters: -1 }))).toThrow();
  });
  it('distanceMeters=0 GEÇERLİ (throw ETMEZ)', () => {
    expect(() => evaluateSpeedCameraRisk(input({ distanceMeters: 0 }))).not.toThrow();
    expect(evaluateSpeedCameraRisk(input({ distanceMeters: 0 })).riskEvents[0].distanceMeters).toBe(0);
  });
  it('confidence NaN → THROW', () => {
    expect(() => evaluateSpeedCameraRisk(input({ confidence: NaN }))).toThrow();
  });
  it('confidence aralık dışı (1.5) → THROW', () => {
    expect(() => evaluateSpeedCameraRisk(input({ confidence: 1.5 }))).toThrow();
  });
  it('confidence aralık dışı (-0.1) → THROW', () => {
    expect(() => evaluateSpeedCameraRisk(input({ confidence: -0.1 }))).toThrow();
  });
  it('policy eksik → THROW', () => {
    expect(() => evaluateSpeedCameraRisk({ camera: camera() } as unknown as SpeedCameraRiskInput)).toThrow();
  });
  it('severityByCameraType eksik → THROW', () => {
    expect(() => evaluateSpeedCameraRisk({ camera: camera(), policy: { severityByCameraType: undefined as unknown as SpeedCameraSeverityByCameraType } })).toThrow();
  });
  it('minimumConfidence aralık dışı (1.5) → THROW', () => {
    expect(() => evaluateSpeedCameraRisk(input({}, {}, { minimumConfidence: 1.5 }))).toThrow();
  });
  it('KNOWN cameraType (combined) için eşleme YOKSA → THROW', () => {
    const i: SpeedCameraRiskInput = {
      camera: camera({ cameraType: 'combined' }),
      policy: { severityByCameraType: { fixed_speed: 'MEDIUM', average_speed: 'HIGH' }, minimumConfidence: 0.3 },
    };
    expect(() => evaluateSpeedCameraRisk(i)).toThrow();
  });
  it('geçersiz severity token → THROW', () => {
    const i: SpeedCameraRiskInput = {
      camera: camera({ cameraType: 'fixed_speed' }),
      policy: { severityByCameraType: { fixed_speed: 'GEÇERSİZ' as never }, minimumConfidence: 0.3 },
    };
    expect(() => evaluateSpeedCameraRisk(i)).toThrow();
  });
});

/* ── Event id / tip / metin / mesafe ───────────────────────────────────────── */

describe('evaluateSpeedCameraRisk — event id / tip / metin / mesafe', () => {
  it('id = `speed-camera:${camera.id}`', () => {
    expect(evaluateSpeedCameraRisk(input({ id: 'cam-42' })).riskEvents[0].id).toBe('speed-camera:cam-42');
  });
  it('type=SPEED_CAMERA_WARNING, ruleId=speed-camera', () => {
    const r = evaluateSpeedCameraRisk(input());
    expect(r.ruleId).toBe('speed-camera');
    expect(r.riskEvents[0].type).toBe('SPEED_CAMERA_WARNING');
  });
  it('title sabit "Hız denetim noktası"', () => {
    expect(evaluateSpeedCameraRisk(input()).riskEvents[0].title).toBe('Hız denetim noktası');
  });
  it('recommendedAction sabit "Hız limitlerine uygun şekilde ilerlemen önerilir."', () => {
    expect(evaluateSpeedCameraRisk(input()).riskEvents[0].recommendedAction).toBe('Hız limitlerine uygun şekilde ilerlemen önerilir.');
  });
  it('distanceMeters DI değerinden geçer (uydurulmaz)', () => {
    expect(evaluateSpeedCameraRisk(input({ distanceMeters: 1234 })).riskEvents[0].distanceMeters).toBe(1234);
  });
  it('source: verilirse taşınır, verilmezse varsayılan', () => {
    expect(evaluateSpeedCameraRisk(input({ source: 'my-sensor' })).riskEvents[0].source).toBe('my-sensor');
    const def = evaluateSpeedCameraRisk(input({ source: undefined })).riskEvents[0].source;
    expect(typeof def).toBe('string');
    expect(def).toBeTruthy();
  });
  it('event.confidence == camera.confidence (üst sınır)', () => {
    expect(evaluateSpeedCameraRisk(input({ confidence: 0.65 })).riskEvents[0].confidence).toBe(0.65);
  });
});

/* ── Yasaklı ifadeler ──────────────────────────────────────────────────────── */

describe('evaluateSpeedCameraRisk — yasaklı ifade HİÇBİR event\'te YOK', () => {
  const FORBIDDEN = [
    'Radar var', 'Ceza yiyeceksin', 'Polisi geç', 'Hızını hemen düşür',
    'Radarı atlattın', 'Radar kaçırıldı', 'Radar yaklaşıyor',
  ];
  it.each(KNOWN_TYPES)('%s tipinde yasaklı ifade yok', (cameraType) => {
    const r = evaluateSpeedCameraRisk(input({ cameraType }));
    const all = `${r.riskEvents[0].title} ${r.riskEvents[0].message} ${r.riskEvents[0].recommendedAction}`;
    FORBIDDEN.forEach((p) => expect(all).not.toContain(p));
    expect(all).not.toContain('Radar');
    expect(all).not.toContain('radar');
  });
  it('mesajlar tipe uygun İHTİYATLI + birbirinden farklı', () => {
    const messages = KNOWN_TYPES.map((t) => evaluateSpeedCameraRisk(input({ cameraType: t })).riskEvents[0].message);
    expect(new Set(messages).size).toBe(messages.length);
    messages.forEach((m) => expect(m).toBeTruthy());
  });
});

/* ── Immutable + deterministic ─────────────────────────────────────────────── */

describe('evaluateSpeedCameraRisk — immutable / deterministic', () => {
  it('girdi mutasyona uğratılmaz (snapshot)', () => {
    const i = input();
    const snapshot = JSON.parse(JSON.stringify(i));
    evaluateSpeedCameraRisk(i);
    expect(i).toEqual(snapshot);
  });
  it('donmuş (Object.freeze) girdiyle de çalışır', () => {
    const i = {
      camera: Object.freeze(camera()),
      policy: Object.freeze({ severityByCameraType: Object.freeze(severityMap()), minimumConfidence: 0.3 }),
    };
    Object.freeze(i);
    expect(() => evaluateSpeedCameraRisk(i)).not.toThrow();
  });
  it('aynı girdi → aynı çıktı', () => {
    const i = input({ cameraType: 'average_speed' });
    expect(evaluateSpeedCameraRisk(i)).toEqual(evaluateSpeedCameraRisk(i));
  });
});

/* ── GuardianEngine entegrasyonu ───────────────────────────────────────────── */

describe('GuardianEngine entegrasyonu', () => {
  it('SPEED_CAMERA_WARNING runGuardian\'da görünür + skor artar', () => {
    const empty = runGuardian({ ruleResults: [] });
    const rr = evaluateSpeedCameraRisk(input({ cameraType: 'average_speed' })); // HIGH
    const output = runGuardian({ ruleResults: [rr] });
    expect(output.riskEvents).toHaveLength(1);
    expect(output.riskEvents[0].type).toBe('SPEED_CAMERA_WARNING');
    expect(output.highestSeverity).toBe('HIGH');
    expect(output.overallRiskScore).toBeGreaterThan(empty.overallRiskScore);
  });

  it('8 kural birlikte — 8 farklı id korunur', () => {
    const curveResult = evaluateCurveRisk({
      curve: { id: 'curve-1', distanceMeters: 100, direction: 'left', advisorySpeedKph: 60, confidence: 0.8 },
      vehicle: { currentSpeedKph: 90 }, // CRITICAL
      policy: { warningLeadTimeSeconds: 8, minimumWarningDistanceMeters: 50, overspeedToleranceKph: 2 },
    });
    const speedLimitResult = evaluateSpeedLimitRisk({
      segment: { id: 'seg-1', distanceMeters: 100, postedSpeedLimitKph: 100, confidence: 0.8 },
      vehicle: { currentSpeedKph: 105 }, // LOW
      policy: { warningLeadTimeSeconds: 8, minimumWarningDistanceMeters: 50, overspeedToleranceKph: 2 },
    });
    const downhillResult = evaluateRoadProfileRisk({
      segment: { id: 'downhill-1', distanceMeters: 40, downhillGradePercent: 14, confidence: 0.8 }, // MEDIUM
      vehicle: { currentSpeedKph: 80 },
      policy: { warningLeadTimeSeconds: 8, minimumWarningDistanceMeters: 50 },
      gradeThresholds: { low: 8, medium: 12, high: 16, critical: 20 },
    });
    const weatherResult = evaluateWeatherRisk({
      condition: { surfaceCondition: 'wet', source: 'osm', confidence: 0.8 },
      policy: { severityByCondition: { dry: 'NONE', wet: 'LOW', snow: 'HIGH', ice: 'CRITICAL' } }, // LOW
    });
    const vehicleHealthResult = evaluateVehicleHealthRisk({
      signals: { batteryVoltage: 11.5 }, // LOW
      policy: {
        thresholds: { coolant: { high: 100, critical: 115 }, oilPressure: { low: 100, critical: 50 }, batteryVoltage: { low: 12, critical: 11 } },
        booleanSeverities: { brakeWarning: 'HIGH', engineWarningLamp: 'LOW', transmissionWarning: 'HIGH' },
      },
    });
    const roadHazardResult = evaluateRoadHazardRisk({
      hazard: { id: 'hz-1', hazardType: 'accident', distanceMeters: 400, confidence: 0.8 },
      policy: { severityByHazard: { accident: 'HIGH' } },
    });
    const fatigueResult = evaluateDriverFatigueRisk({
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
    });
    const cameraResult = evaluateSpeedCameraRisk(input({ cameraType: 'average_speed' })); // HIGH

    const output = runGuardian({
      ruleResults: [curveResult, speedLimitResult, downhillResult, weatherResult, vehicleHealthResult, roadHazardResult, fatigueResult, cameraResult],
    });
    expect(output.riskEvents).toHaveLength(8);
    expect(output.riskEvents.map((e) => e.type).sort()).toEqual([
      'CURVE_RISK', 'DOWNHILL_RISK', 'DRIVER_FATIGUE_RISK', 'ROAD_HAZARD',
      'SPEED_CAMERA_WARNING', 'SPEED_LIMIT_RISK', 'VEHICLE_HEALTH_RISK', 'WEATHER_RISK',
    ]);
    expect(output.highestSeverity).toBe('CRITICAL');
  });

  it('aynı speed-camera id iki sonuçtan gelirse dedup en yüksek severity\'yi tutar', () => {
    const low = evaluateSpeedCameraRisk(input({ id: 'dup', cameraType: 'fixed_speed' }, { fixed_speed: 'LOW' }));
    const crit = evaluateSpeedCameraRisk(input({ id: 'dup', cameraType: 'fixed_speed' }, { fixed_speed: 'CRITICAL' }));
    const output = runGuardian({ ruleResults: [low, crit] });
    expect(output.riskEvents).toHaveLength(1);
    expect(output.riskEvents[0].severity).toBe('CRITICAL');
  });
});

/* ── Regresyon: G2–G8 bozulmadı ────────────────────────────────────────────── */

describe('G2–G8 regresyonu', () => {
  it('evaluateDriverFatigueRisk hâlâ çalışır', () => {
    const r = evaluateDriverFatigueRisk({
      signals: { microsleepSuspectedSignal: true, confidence: 0.8 },
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
    });
    expect(r.riskEvents[0].severity).toBe('CRITICAL');
  });
  it('evaluateRoadHazardRisk hâlâ çalışır', () => {
    const r = evaluateRoadHazardRisk({
      hazard: { id: 'r1', hazardType: 'flood', distanceMeters: 200, confidence: 0.8 },
      policy: { severityByHazard: { flood: 'CRITICAL' } },
    });
    expect(r.riskEvents[0].severity).toBe('CRITICAL');
  });
  it('evaluateCurveRisk hâlâ çalışır', () => {
    const r = evaluateCurveRisk({
      curve: { id: 'c1', distanceMeters: 100, direction: 'left', advisorySpeedKph: 100, confidence: 0.8 },
      vehicle: { currentSpeedKph: 105 },
      policy: { warningLeadTimeSeconds: 8, minimumWarningDistanceMeters: 50, overspeedToleranceKph: 2 },
    });
    expect(r.riskEvents[0].severity).toBe('LOW');
  });
});
