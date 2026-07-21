/**
 * roadProfileRule.test.ts — GUARDIAN-AI-G4.
 *
 * `evaluateRoadProfileRisk` (Downhill Risk v1) — üçüncü Guardian analiz
 * kuralı. `curveRiskRule`/`speedLimitRule` deseni izlenir AMA severity
 * OVERSPEED ORANINDAN DEĞİL, mutlak eğim bandından gelir. Kapsam: eğim
 * bantları (LOW/MEDIUM/HIGH/CRITICAL + tam sınır değerleri) · eğim-yok/eşik-
 * altı → event yok · confidence eşiği · uyarı penceresi · distance=0 geçerli
 * · speed=0 → yok · validation throw'ları (NaN/Inf/negatif + gradeThresholds
 * non-monoton) · immutable/deterministik · confidence sınırı · "ani fren"
 * hiçbir severity'de yok · GuardianEngine entegrasyonu (curve+speed+downhill
 * birlikte) · curve/speed regresyonu.
 */
import { describe, it, expect } from 'vitest';
import { evaluateRoadProfileRisk, ROAD_PROFILE_RULE_ID } from '../platform/navigation/guardian/rules/roadProfileRule';
import type {
  RoadProfileRiskInput,
  RoadProfileSegmentInput,
  RoadProfileVehicleInput,
  RoadProfilePolicyInput,
  RoadProfileGradeThresholds,
} from '../platform/navigation/guardian/rules/roadProfileRule';
import { evaluateCurveRisk } from '../platform/navigation/guardian/rules/curveRiskRule';
import { evaluateSpeedLimitRisk } from '../platform/navigation/guardian/rules/speedLimitRule';
import { runGuardian } from '../platform/navigation/guardian/guardianEngine';

function segment(overrides: Partial<RoadProfileSegmentInput> = {}): RoadProfileSegmentInput {
  return {
    id: 'segment-1',
    distanceMeters: 100,
    downhillGradePercent: 10,
    source: 'osm-incline',
    confidence: 0.8,
    ...overrides,
  };
}

function vehicle(overrides: Partial<RoadProfileVehicleInput> = {}): RoadProfileVehicleInput {
  return { currentSpeedKph: 80, ...overrides };
}

function policy(overrides: Partial<RoadProfilePolicyInput> = {}): RoadProfilePolicyInput {
  return { warningLeadTimeSeconds: 8, minimumWarningDistanceMeters: 50, ...overrides };
}

function thresholds(overrides: Partial<RoadProfileGradeThresholds> = {}): RoadProfileGradeThresholds {
  return { low: 8, medium: 12, high: 16, critical: 20, ...overrides };
}

function input(
  segmentOverrides: Partial<RoadProfileSegmentInput> = {},
  vehicleOverrides: Partial<RoadProfileVehicleInput> = {},
  policyOverrides: Partial<RoadProfilePolicyInput> = {},
  thresholdOverrides: Partial<RoadProfileGradeThresholds> = {},
): RoadProfileRiskInput {
  return {
    segment: segment(segmentOverrides),
    vehicle: vehicle(vehicleOverrides),
    policy: policy(policyOverrides),
    gradeThresholds: thresholds(thresholdOverrides),
  };
}

describe('evaluateRoadProfileRisk — eğim bantları (mutlak, overspeed DEĞİL)', () => {
  it('LOW: grade=10 (low<=10<medium)', () => {
    const result = evaluateRoadProfileRisk(input({ downhillGradePercent: 10 }));
    expect(result.riskEvents).toHaveLength(1);
    expect(result.riskEvents[0].severity).toBe('LOW');
  });

  it('MEDIUM: grade=14 (medium<=14<high)', () => {
    const result = evaluateRoadProfileRisk(input({ downhillGradePercent: 14 }));
    expect(result.riskEvents[0].severity).toBe('MEDIUM');
  });

  it('HIGH: grade=18 (high<=18<critical)', () => {
    const result = evaluateRoadProfileRisk(input({ downhillGradePercent: 18 }));
    expect(result.riskEvents[0].severity).toBe('HIGH');
  });

  it('CRITICAL: grade=25 (>=critical)', () => {
    const result = evaluateRoadProfileRisk(input({ downhillGradePercent: 25 }));
    expect(result.riskEvents[0].severity).toBe('CRITICAL');
  });

  it('bant SINIRLARI (tam eşik değerleri): low=8→LOW, medium=12→MEDIUM, high=16→HIGH, critical=20→CRITICAL', () => {
    expect(evaluateRoadProfileRisk(input({ downhillGradePercent: 8 })).riskEvents[0].severity).toBe('LOW');
    expect(evaluateRoadProfileRisk(input({ downhillGradePercent: 12 })).riskEvents[0].severity).toBe('MEDIUM');
    expect(evaluateRoadProfileRisk(input({ downhillGradePercent: 16 })).riskEvents[0].severity).toBe('HIGH');
    expect(evaluateRoadProfileRisk(input({ downhillGradePercent: 20 })).riskEvents[0].severity).toBe('CRITICAL');
  });

  it('overspeed/tolerans KAVRAMI YOK — çok yüksek hızda bile severity yalnız eğimden gelir', () => {
    // distanceMeters mesafe-tabanlı pencere içinde tutuldu (<=minimumWarningDistanceMeters
    // varsayılanı 50) — böylece yavaş hızda zaman penceresi darlığı testin amacını (severity
    // yalnız eğimden gelir) etkilemez.
    const slow = evaluateRoadProfileRisk(input({ downhillGradePercent: 10, distanceMeters: 40 }, { currentSpeedKph: 40 }));
    const fast = evaluateRoadProfileRisk(input({ downhillGradePercent: 10, distanceMeters: 40 }, { currentSpeedKph: 150 }));
    expect(slow.riskEvents[0].severity).toBe('LOW');
    expect(fast.riskEvents[0].severity).toBe('LOW'); // aynı eğim → aynı severity, hız etkilemez
  });
});

describe('evaluateRoadProfileRisk — eğim yok / eşik altı → event yok', () => {
  it('downhillGradePercent undefined → event yok (eğim UYDURULMAZ)', () => {
    const result = evaluateRoadProfileRisk(input({ downhillGradePercent: undefined }));
    expect(result).toEqual({ ruleId: ROAD_PROFILE_RULE_ID, riskEvents: [] });
  });

  it('grade < low (7.9 < 8) → event yok', () => {
    const result = evaluateRoadProfileRisk(input({ downhillGradePercent: 7.9 }));
    expect(result.riskEvents).toEqual([]);
  });

  it('grade=0 (düz yol) → event yok', () => {
    const result = evaluateRoadProfileRisk(input({ downhillGradePercent: 0 }));
    expect(result.riskEvents).toEqual([]);
  });

  it('grade negatif (tırmanış) → event yok (throw DEĞİL)', () => {
    expect(() => evaluateRoadProfileRisk(input({ downhillGradePercent: -5 }))).not.toThrow();
    const result = evaluateRoadProfileRisk(input({ downhillGradePercent: -5 }));
    expect(result.riskEvents).toEqual([]);
  });
});

describe('evaluateRoadProfileRisk — confidence eşiği (fail-closed, throw DEĞİL)', () => {
  it('confidence eşik ALTINDA (0.29 < 0.3) → event yok', () => {
    const result = evaluateRoadProfileRisk(input({ downhillGradePercent: 10, confidence: 0.29 }));
    expect(result.riskEvents).toEqual([]);
  });

  it('confidence TAM eşikte (0.3) → event ÜRETİLİR', () => {
    const result = evaluateRoadProfileRisk(input({ downhillGradePercent: 10, confidence: 0.3 }));
    expect(result.riskEvents).toHaveLength(1);
  });
});

describe('evaluateRoadProfileRisk — uyarı penceresi', () => {
  it('segment çok uzak (ne zaman ne mesafe penceresinde) → event yok', () => {
    const result = evaluateRoadProfileRisk({
      segment: segment({ downhillGradePercent: 10, distanceMeters: 5000 }),
      vehicle: vehicle({ currentSpeedKph: 80 }),
      policy: policy({ warningLeadTimeSeconds: 8, minimumWarningDistanceMeters: 50 }),
      gradeThresholds: thresholds(),
    });
    expect(result.riskEvents).toEqual([]);
  });

  it('zaman-tabanlı pencere içinde → event var', () => {
    const result = evaluateRoadProfileRisk(input({ downhillGradePercent: 10, distanceMeters: 100 }, { currentSpeedKph: 80 }, { warningLeadTimeSeconds: 8, minimumWarningDistanceMeters: 50 }));
    expect(result.riskEvents).toHaveLength(1);
  });

  it('mesafe-tabanlı tetik: zaman penceresi yetersiz olsa bile distance<=minDistance ise fires', () => {
    const result = evaluateRoadProfileRisk({
      segment: segment({ downhillGradePercent: 10, distanceMeters: 40 }),
      vehicle: vehicle({ currentSpeedKph: 50 }),
      policy: policy({ warningLeadTimeSeconds: 1, minimumWarningDistanceMeters: 50 }),
      gradeThresholds: thresholds(),
    });
    expect(result.riskEvents).toHaveLength(1);
  });
});

describe('evaluateRoadProfileRisk — distance=0 geçerli', () => {
  it('distanceMeters=0 → event üretilebilir, THROW YOK', () => {
    const result = evaluateRoadProfileRisk(input({ downhillGradePercent: 10, distanceMeters: 0 }));
    expect(result.riskEvents).toHaveLength(1);
    expect(result.riskEvents[0].distanceMeters).toBe(0);
  });
});

describe('evaluateRoadProfileRisk — currentSpeed=0 → event yok', () => {
  it('currentSpeedKph=0 → event yok (bölme yok, çökme yok)', () => {
    expect(() => evaluateRoadProfileRisk(input({ downhillGradePercent: 10 }, { currentSpeedKph: 0 }))).not.toThrow();
    const result = evaluateRoadProfileRisk(input({ downhillGradePercent: 10 }, { currentSpeedKph: 0 }));
    expect(result.riskEvents).toEqual([]);
  });
});

describe('evaluateRoadProfileRisk — validation throw', () => {
  it('downhillGradePercent NaN → THROW', () => {
    expect(() => evaluateRoadProfileRisk(input({ downhillGradePercent: NaN }))).toThrow();
  });
  it('downhillGradePercent Infinity → THROW', () => {
    expect(() => evaluateRoadProfileRisk(input({ downhillGradePercent: Infinity }))).toThrow();
  });
  it('negatif distanceMeters → THROW', () => {
    expect(() => evaluateRoadProfileRisk(input({ distanceMeters: -1 }))).toThrow();
  });
  it('negatif currentSpeedKph → THROW', () => {
    expect(() => evaluateRoadProfileRisk(input({}, { currentSpeedKph: -5 }))).toThrow();
  });
  it('NaN/Infinity currentSpeedKph → THROW', () => {
    expect(() => evaluateRoadProfileRisk(input({}, { currentSpeedKph: NaN }))).toThrow();
    expect(() => evaluateRoadProfileRisk(input({}, { currentSpeedKph: Infinity }))).toThrow();
  });
  it('segment.id boş → THROW', () => {
    expect(() => evaluateRoadProfileRisk(input({ id: '' }))).toThrow();
  });
  it('segment.confidence NaN/Infinity → THROW', () => {
    expect(() => evaluateRoadProfileRisk(input({ confidence: NaN }))).toThrow();
    expect(() => evaluateRoadProfileRisk(input({ confidence: Infinity }))).toThrow();
  });
  it('policy.warningLeadTimeSeconds NaN/Infinity/<=0 → THROW', () => {
    expect(() => evaluateRoadProfileRisk(input({}, {}, { warningLeadTimeSeconds: NaN }))).toThrow();
    expect(() => evaluateRoadProfileRisk(input({}, {}, { warningLeadTimeSeconds: 0 }))).toThrow();
    expect(() => evaluateRoadProfileRisk(input({}, {}, { warningLeadTimeSeconds: -1 }))).toThrow();
  });
  it('policy.minimumWarningDistanceMeters NaN/Infinity/negatif → THROW', () => {
    expect(() => evaluateRoadProfileRisk(input({}, {}, { minimumWarningDistanceMeters: NaN }))).toThrow();
    expect(() => evaluateRoadProfileRisk(input({}, {}, { minimumWarningDistanceMeters: -1 }))).toThrow();
  });

  it('gradeThresholds NON-MONOTON (low>medium) → THROW', () => {
    expect(() => evaluateRoadProfileRisk(input({}, {}, {}, { low: 10, medium: 8, high: 16, critical: 20 }))).toThrow();
  });
  it('gradeThresholds NON-MONOTON (medium>high) → THROW', () => {
    expect(() => evaluateRoadProfileRisk(input({}, {}, {}, { low: 8, medium: 18, high: 16, critical: 20 }))).toThrow();
  });
  it('gradeThresholds NON-MONOTON (high>critical) → THROW', () => {
    expect(() => evaluateRoadProfileRisk(input({}, {}, {}, { low: 8, medium: 12, high: 22, critical: 20 }))).toThrow();
  });
  it('gradeThresholds NaN/Infinity içeriyorsa → THROW', () => {
    expect(() => evaluateRoadProfileRisk(input({}, {}, {}, { low: NaN }))).toThrow();
    expect(() => evaluateRoadProfileRisk(input({}, {}, {}, { critical: Infinity }))).toThrow();
  });
  it('gradeThresholds eşit değerler (low=medium=high=critical) → GEÇERLİ (monoton, throw YOK)', () => {
    expect(() => evaluateRoadProfileRisk(input({ downhillGradePercent: 10 }, {}, {}, { low: 10, medium: 10, high: 10, critical: 10 }))).not.toThrow();
  });
});

describe('evaluateRoadProfileRisk — confidence sınırı (event conf <= segment conf)', () => {
  it('event.confidence <= segment.confidence', () => {
    const result = evaluateRoadProfileRisk(input({ downhillGradePercent: 10, confidence: 0.65 }));
    expect(result.riskEvents[0].confidence).toBeLessThanOrEqual(0.65);
    expect(result.riskEvents[0].confidence).toBe(0.65);
  });
});

describe('evaluateRoadProfileRisk — deterministik event id / tip / kaynak', () => {
  it('id = `downhill:${segment.id}`', () => {
    const result = evaluateRoadProfileRisk(input({ id: 'inis-1', downhillGradePercent: 10 }));
    expect(result.riskEvents[0].id).toBe('downhill:inis-1');
  });

  it('type=DOWNHILL_RISK, ruleId=road-profile', () => {
    const result = evaluateRoadProfileRisk(input({ downhillGradePercent: 10 }));
    expect(result.ruleId).toBe('road-profile');
    expect(result.riskEvents[0].type).toBe('DOWNHILL_RISK');
  });

  it('source: segment.source verilirse taşınır, verilmezse varsayılan kullanılır', () => {
    const withSource = evaluateRoadProfileRisk(input({ downhillGradePercent: 10, source: 'user-report' }));
    expect(withSource.riskEvents[0].source).toBe('user-report');

    const withoutSource = evaluateRoadProfileRisk(input({ downhillGradePercent: 10, source: undefined }));
    expect(typeof withoutSource.riskEvents[0].source).toBe('string');
    expect(withoutSource.riskEvents[0].source).toBeTruthy();
  });
});

describe('evaluateRoadProfileRisk — "ani fren"/"kesin güvenli" HİÇBİR severity\'de YOK', () => {
  it.each([
    ['LOW', 8], ['MEDIUM', 12], ['HIGH', 16], ['CRITICAL', 25],
  ])('%s severity mesajında yasaklı ifade yok', (_label, grade) => {
    const result = evaluateRoadProfileRisk(input({ downhillGradePercent: grade }));
    const all = `${result.riskEvents[0].title} ${result.riskEvents[0].message} ${result.riskEvents[0].recommendedAction}`;
    expect(all).not.toContain('ani fren');
    expect(all).not.toContain('kesin güvenli');
    expect(all).not.toMatch(/güvenlidir/);
  });

  it('FREN MESAFESİ/FİZİK HESABI mesajda YOK — yalnız eğim uyarısı', () => {
    const result = evaluateRoadProfileRisk(input({ downhillGradePercent: 25 })); // CRITICAL
    expect(result.riskEvents[0].message).not.toMatch(/\d+\s*m(etre)?\s*(fren|dur)/i);
  });
});

describe('evaluateRoadProfileRisk — immutable girdi', () => {
  it('segment/vehicle/policy/gradeThresholds mutasyona uğratılmaz (snapshot)', () => {
    const i = input({ downhillGradePercent: 10 });
    const snapshot = JSON.parse(JSON.stringify(i));
    evaluateRoadProfileRisk(i);
    expect(i).toEqual(snapshot);
  });

  it('donmuş (Object.freeze) girdiyle de çalışır', () => {
    const i = {
      segment: Object.freeze(segment({ downhillGradePercent: 10 })),
      vehicle: Object.freeze(vehicle()),
      policy: Object.freeze(policy()),
      gradeThresholds: Object.freeze(thresholds()),
    };
    Object.freeze(i);
    expect(() => evaluateRoadProfileRisk(i)).not.toThrow();
  });
});

describe('evaluateRoadProfileRisk — deterministik çıktı', () => {
  it('aynı girdi tekrar tekrar çağrılınca AYNI sonucu verir', () => {
    const i = input({ downhillGradePercent: 14 });
    const a = evaluateRoadProfileRisk(i);
    const b = evaluateRoadProfileRisk(i);
    expect(a).toEqual(b);
  });
});

describe('GuardianEngine entegrasyonu', () => {
  it('evaluateRoadProfileRisk sonucu runGuardian\'a verilince DOWNHILL_RISK event görünür + highestSeverity doğru + skor artar', () => {
    const empty = runGuardian({ ruleResults: [] });
    const ruleResult = evaluateRoadProfileRisk(input({ downhillGradePercent: 25 })); // CRITICAL
    const output = runGuardian({ ruleResults: [ruleResult] });
    expect(output.riskEvents).toHaveLength(1);
    expect(output.riskEvents[0].type).toBe('DOWNHILL_RISK');
    expect(output.highestSeverity).toBe('CRITICAL');
    expect(output.overallRiskScore).toBeGreaterThan(empty.overallRiskScore);
  });

  it('CURVE + SPEED_LIMIT + DOWNHILL üçü birlikte runGuardian\'da doğru birleşir (üç farklı id → üçü de kalır, severity DESC)', () => {
    const curveResult = evaluateCurveRisk({
      curve: { id: 'curve-1', distanceMeters: 100, direction: 'left', advisorySpeedKph: 60, confidence: 0.8 },
      vehicle: { currentSpeedKph: 90 }, // ratio=1.5 → CRITICAL
      policy: { warningLeadTimeSeconds: 8, minimumWarningDistanceMeters: 50, overspeedToleranceKph: 2 },
    });
    const speedLimitResult = evaluateSpeedLimitRisk({
      segment: { id: 'seg-1', distanceMeters: 100, postedSpeedLimitKph: 100, confidence: 0.8 },
      vehicle: { currentSpeedKph: 105 }, // ratio=1.05 → LOW
      policy: { warningLeadTimeSeconds: 8, minimumWarningDistanceMeters: 50, overspeedToleranceKph: 2 },
    });
    const downhillResult = evaluateRoadProfileRisk(input({ id: 'downhill-1', downhillGradePercent: 14 })); // MEDIUM

    const output = runGuardian({ ruleResults: [curveResult, speedLimitResult, downhillResult] });
    expect(output.riskEvents).toHaveLength(3);
    expect(output.riskEvents.map(e => e.type).sort()).toEqual(['CURVE_RISK', 'DOWNHILL_RISK', 'SPEED_LIMIT_RISK']);
    // severity DESC: CRITICAL (curve) → MEDIUM (downhill) → LOW (speed-limit)
    expect(output.riskEvents[0].type).toBe('CURVE_RISK');
    expect(output.riskEvents[0].severity).toBe('CRITICAL');
    expect(output.riskEvents[2].type).toBe('SPEED_LIMIT_RISK');
    expect(output.riskEvents[2].severity).toBe('LOW');
    expect(output.highestSeverity).toBe('CRITICAL');
  });

  it('event-yok RuleResult runGuardian\'a verilince hiçbir olay eklemez', () => {
    const ruleResult = evaluateRoadProfileRisk(input({ downhillGradePercent: undefined }));
    const output = runGuardian({ ruleResults: [ruleResult] });
    expect(output.riskEvents).toEqual([]);
    expect(output.overallRiskScore).toBe(0);
  });
});

describe('CurveRisk + SpeedLimit regresyonu (G2/G3 bozulmadı)', () => {
  it('evaluateCurveRisk hâlâ aynı formülle çalışır', () => {
    const result = evaluateCurveRisk({
      curve: { id: 'c1', distanceMeters: 100, direction: 'left', advisorySpeedKph: 100, confidence: 0.8 },
      vehicle: { currentSpeedKph: 105 },
      policy: { warningLeadTimeSeconds: 8, minimumWarningDistanceMeters: 50, overspeedToleranceKph: 2 },
    });
    expect(result.riskEvents[0].severity).toBe('LOW');
  });

  it('evaluateSpeedLimitRisk hâlâ aynı formülle çalışır', () => {
    const result = evaluateSpeedLimitRisk({
      segment: { id: 's1', distanceMeters: 100, postedSpeedLimitKph: 100, confidence: 0.8 },
      vehicle: { currentSpeedKph: 160 },
      policy: { warningLeadTimeSeconds: 8, minimumWarningDistanceMeters: 50, overspeedToleranceKph: 2 },
    });
    expect(result.riskEvents[0].severity).toBe('CRITICAL');
  });
});
