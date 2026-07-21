/**
 * speedLimitRule.test.ts — GUARDIAN-AI-G3.
 *
 * `evaluateSpeedLimitRisk` — ikinci Guardian analiz kuralı. `curveRiskRule`
 * deseni birebir izlenir. Kapsam: limit-altı/tolerans-içi olay-yok · severity
 * bantları · uyarı penceresi · currentSpeed=0 → yok · distance=0 geçerli ·
 * limit yok → yok · validation throw'ları · confidence eşiği + sınırı ·
 * deterministik id/çıktı · immutable girdi · GuardianEngine entegrasyonu
 * (curve+speedlimit birlikte) · CurveRisk regresyonu.
 */
import { describe, it, expect } from 'vitest';
import { evaluateSpeedLimitRisk, SPEED_LIMIT_RULE_ID } from '../platform/navigation/guardian/rules/speedLimitRule';
import type {
  SpeedLimitRiskInput,
  SpeedLimitSegmentInput,
  SpeedLimitVehicleInput,
  SpeedLimitPolicyInput,
} from '../platform/navigation/guardian/rules/speedLimitRule';
import { evaluateCurveRisk } from '../platform/navigation/guardian/rules/curveRiskRule';
import { runGuardian } from '../platform/navigation/guardian/guardianEngine';

function segment(overrides: Partial<SpeedLimitSegmentInput> = {}): SpeedLimitSegmentInput {
  return {
    id: 'segment-1',
    distanceMeters: 100,
    postedSpeedLimitKph: 100,
    source: 'osm-maxspeed',
    confidence: 0.8,
    ...overrides,
  };
}

function vehicle(overrides: Partial<SpeedLimitVehicleInput> = {}): SpeedLimitVehicleInput {
  return { currentSpeedKph: 100, ...overrides };
}

function policy(overrides: Partial<SpeedLimitPolicyInput> = {}): SpeedLimitPolicyInput {
  return {
    warningLeadTimeSeconds: 8,
    minimumWarningDistanceMeters: 50,
    overspeedToleranceKph: 2,
    ...overrides,
  };
}

function input(
  segmentOverrides: Partial<SpeedLimitSegmentInput> = {},
  vehicleOverrides: Partial<SpeedLimitVehicleInput> = {},
  policyOverrides: Partial<SpeedLimitPolicyInput> = {},
): SpeedLimitRiskInput {
  return {
    segment: segment(segmentOverrides),
    vehicle: vehicle(vehicleOverrides),
    policy: policy(policyOverrides),
  };
}

describe('evaluateSpeedLimitRisk — limit altında → event yok', () => {
  it('currentSpeedKph < postedSpeedLimitKph → event yok', () => {
    const result = evaluateSpeedLimitRisk(input({ postedSpeedLimitKph: 80 }, { currentSpeedKph: 70 }));
    expect(result).toEqual({ ruleId: SPEED_LIMIT_RULE_ID, riskEvents: [] });
  });
});

describe('evaluateSpeedLimitRisk — tolerans içinde → event yok', () => {
  it('overspeedKph === tolerans (sınırda) → event yok', () => {
    const result = evaluateSpeedLimitRisk(input({ postedSpeedLimitKph: 100 }, { currentSpeedKph: 105 }, { overspeedToleranceKph: 5 }));
    expect(result.riskEvents).toEqual([]);
  });

  it('overspeedKph < tolerans → event yok', () => {
    const result = evaluateSpeedLimitRisk(input({ postedSpeedLimitKph: 100 }, { currentSpeedKph: 103 }, { overspeedToleranceKph: 5 }));
    expect(result.riskEvents).toEqual([]);
  });
});

describe('evaluateSpeedLimitRisk — severity bantları', () => {
  it('LOW: ratio=1.05', () => {
    const result = evaluateSpeedLimitRisk(input({ postedSpeedLimitKph: 100 }, { currentSpeedKph: 105 }, { overspeedToleranceKph: 2 }));
    expect(result.riskEvents).toHaveLength(1);
    expect(result.riskEvents[0].severity).toBe('LOW');
  });

  it('MEDIUM: ratio=1.15', () => {
    const result = evaluateSpeedLimitRisk(input({ postedSpeedLimitKph: 100 }, { currentSpeedKph: 115 }, { overspeedToleranceKph: 2 }));
    expect(result.riskEvents[0].severity).toBe('MEDIUM');
  });

  it('HIGH: ratio=1.35', () => {
    const result = evaluateSpeedLimitRisk(input({ postedSpeedLimitKph: 100 }, { currentSpeedKph: 135 }, { overspeedToleranceKph: 2 }));
    expect(result.riskEvents[0].severity).toBe('HIGH');
  });

  it('CRITICAL: ratio=1.6', () => {
    const result = evaluateSpeedLimitRisk(input({ postedSpeedLimitKph: 100 }, { currentSpeedKph: 160 }, { overspeedToleranceKph: 2 }));
    expect(result.riskEvents[0].severity).toBe('CRITICAL');
  });

  it('bant SINIRLARI: ratio tam 1.10 → MEDIUM, tam 1.25 → HIGH, tam 1.50 → CRITICAL', () => {
    expect(evaluateSpeedLimitRisk(input({ postedSpeedLimitKph: 100 }, { currentSpeedKph: 110 }, { overspeedToleranceKph: 2 })).riskEvents[0].severity).toBe('MEDIUM');
    expect(evaluateSpeedLimitRisk(input({ postedSpeedLimitKph: 100 }, { currentSpeedKph: 125 }, { overspeedToleranceKph: 2 })).riskEvents[0].severity).toBe('HIGH');
    expect(evaluateSpeedLimitRisk(input({ postedSpeedLimitKph: 100 }, { currentSpeedKph: 150 }, { overspeedToleranceKph: 2 })).riskEvents[0].severity).toBe('CRITICAL');
  });
});

describe('evaluateSpeedLimitRisk — limit yok → event yok', () => {
  it('postedSpeedLimitKph undefined → event yok (limit UYDURULMAZ)', () => {
    const result = evaluateSpeedLimitRisk(input({ postedSpeedLimitKph: undefined }));
    expect(result.riskEvents).toEqual([]);
  });
});

describe('evaluateSpeedLimitRisk — uyarı penceresi dışı → event yok', () => {
  it('segment çok uzak (ne zaman ne mesafe penceresinde) → event yok', () => {
    const result = evaluateSpeedLimitRisk({
      segment: segment({ postedSpeedLimitKph: 80, distanceMeters: 5000 }),
      vehicle: vehicle({ currentSpeedKph: 100 }),
      policy: policy({ warningLeadTimeSeconds: 8, minimumWarningDistanceMeters: 50, overspeedToleranceKph: 2 }),
    });
    expect(result.riskEvents).toEqual([]);
  });

  it('pencere İÇİNDE (zaman-tabanlı) → event var', () => {
    const result = evaluateSpeedLimitRisk(input({ postedSpeedLimitKph: 100, distanceMeters: 100 }, { currentSpeedKph: 105 }, { warningLeadTimeSeconds: 8, minimumWarningDistanceMeters: 50, overspeedToleranceKph: 2 }));
    expect(result.riskEvents).toHaveLength(1);
  });

  it('mesafe-tabanlı tetik: zaman penceresi yetersiz olsa bile distance<=minDistance ise fires', () => {
    const result = evaluateSpeedLimitRisk({
      segment: segment({ postedSpeedLimitKph: 40, distanceMeters: 40 }),
      vehicle: vehicle({ currentSpeedKph: 50 }),
      policy: policy({ warningLeadTimeSeconds: 1, minimumWarningDistanceMeters: 50, overspeedToleranceKph: 2 }),
    });
    expect(result.riskEvents).toHaveLength(1);
  });
});

describe('evaluateSpeedLimitRisk — distance=0 geçerli', () => {
  it('distanceMeters=0 → event üretilebilir, THROW YOK', () => {
    const result = evaluateSpeedLimitRisk(input({ postedSpeedLimitKph: 100, distanceMeters: 0 }, { currentSpeedKph: 120 }, { overspeedToleranceKph: 2 }));
    expect(result.riskEvents).toHaveLength(1);
    expect(result.riskEvents[0].distanceMeters).toBe(0);
  });
});

describe('evaluateSpeedLimitRisk — currentSpeed=0 → event yok', () => {
  it('currentSpeedKph=0 → event yok (bölme yok, çökme yok)', () => {
    expect(() => evaluateSpeedLimitRisk(input({ postedSpeedLimitKph: 80 }, { currentSpeedKph: 0 }))).not.toThrow();
    const result = evaluateSpeedLimitRisk(input({ postedSpeedLimitKph: 80 }, { currentSpeedKph: 0 }));
    expect(result.riskEvents).toEqual([]);
  });
});

describe('evaluateSpeedLimitRisk — validation throw', () => {
  it('NaN currentSpeedKph → THROW', () => {
    expect(() => evaluateSpeedLimitRisk(input({}, { currentSpeedKph: NaN }))).toThrow();
  });
  it('Infinity currentSpeedKph → THROW', () => {
    expect(() => evaluateSpeedLimitRisk(input({}, { currentSpeedKph: Infinity }))).toThrow();
  });
  it('negatif currentSpeedKph → THROW', () => {
    expect(() => evaluateSpeedLimitRisk(input({}, { currentSpeedKph: -5 }))).toThrow();
  });
  it('postedSpeedLimitKph <= 0 → THROW', () => {
    expect(() => evaluateSpeedLimitRisk(input({ postedSpeedLimitKph: 0 }))).toThrow();
    expect(() => evaluateSpeedLimitRisk(input({ postedSpeedLimitKph: -10 }))).toThrow();
  });
  it('postedSpeedLimitKph NaN/Infinity → THROW', () => {
    expect(() => evaluateSpeedLimitRisk(input({ postedSpeedLimitKph: NaN }))).toThrow();
    expect(() => evaluateSpeedLimitRisk(input({ postedSpeedLimitKph: Infinity }))).toThrow();
  });
  it('negatif distanceMeters → THROW', () => {
    expect(() => evaluateSpeedLimitRisk(input({ distanceMeters: -1 }))).toThrow();
  });
  it('segment.id boş → THROW', () => {
    expect(() => evaluateSpeedLimitRisk(input({ id: '' }))).toThrow();
  });
  it('segment.confidence NaN/Infinity → THROW', () => {
    expect(() => evaluateSpeedLimitRisk(input({ confidence: NaN }))).toThrow();
    expect(() => evaluateSpeedLimitRisk(input({ confidence: Infinity }))).toThrow();
  });
  it('policy.overspeedToleranceKph NaN/Infinity/negatif → THROW', () => {
    expect(() => evaluateSpeedLimitRisk(input({}, {}, { overspeedToleranceKph: NaN }))).toThrow();
    expect(() => evaluateSpeedLimitRisk(input({}, {}, { overspeedToleranceKph: Infinity }))).toThrow();
    expect(() => evaluateSpeedLimitRisk(input({}, {}, { overspeedToleranceKph: -1 }))).toThrow();
  });
  it('policy.warningLeadTimeSeconds NaN/Infinity/<=0 → THROW', () => {
    expect(() => evaluateSpeedLimitRisk(input({}, {}, { warningLeadTimeSeconds: NaN }))).toThrow();
    expect(() => evaluateSpeedLimitRisk(input({}, {}, { warningLeadTimeSeconds: 0 }))).toThrow();
    expect(() => evaluateSpeedLimitRisk(input({}, {}, { warningLeadTimeSeconds: -1 }))).toThrow();
  });
  it('policy.minimumWarningDistanceMeters NaN/Infinity/negatif → THROW', () => {
    expect(() => evaluateSpeedLimitRisk(input({}, {}, { minimumWarningDistanceMeters: NaN }))).toThrow();
    expect(() => evaluateSpeedLimitRisk(input({}, {}, { minimumWarningDistanceMeters: -1 }))).toThrow();
  });
});

describe('evaluateSpeedLimitRisk — confidence eşiği (fail-closed, throw DEĞİL)', () => {
  it('confidence eşik ALTINDA (0.29 < 0.3) → event yok', () => {
    const result = evaluateSpeedLimitRisk(input({ postedSpeedLimitKph: 100, confidence: 0.29 }, { currentSpeedKph: 120 }, { overspeedToleranceKph: 2 }));
    expect(result.riskEvents).toEqual([]);
  });

  it('confidence TAM eşikte (0.3) → event ÜRETİLİR', () => {
    const result = evaluateSpeedLimitRisk(input({ postedSpeedLimitKph: 100, confidence: 0.3 }, { currentSpeedKph: 120 }, { overspeedToleranceKph: 2 }));
    expect(result.riskEvents).toHaveLength(1);
  });
});

describe('evaluateSpeedLimitRisk — confidence sınırı (event conf <= segment conf)', () => {
  it('event.confidence <= segment.confidence', () => {
    const result = evaluateSpeedLimitRisk(input({ postedSpeedLimitKph: 100, confidence: 0.65 }, { currentSpeedKph: 120 }, { overspeedToleranceKph: 2 }));
    expect(result.riskEvents[0].confidence).toBeLessThanOrEqual(0.65);
    expect(result.riskEvents[0].confidence).toBe(0.65);
  });
});

describe('evaluateSpeedLimitRisk — deterministik event id / mesaj / kaynak', () => {
  it('id = `speed-limit:${segment.id}`', () => {
    const result = evaluateSpeedLimitRisk(input({ id: 'seg-42', postedSpeedLimitKph: 100 }, { currentSpeedKph: 120 }, { overspeedToleranceKph: 2 }));
    expect(result.riskEvents[0].id).toBe('speed-limit:seg-42');
  });

  it('type=SPEED_LIMIT_RISK, ruleId=speed-limit', () => {
    const result = evaluateSpeedLimitRisk(input({ postedSpeedLimitKph: 100 }, { currentSpeedKph: 120 }, { overspeedToleranceKph: 2 }));
    expect(result.ruleId).toBe('speed-limit');
    expect(result.riskEvents[0].type).toBe('SPEED_LIMIT_RISK');
  });

  it('message postedSpeedLimitKph sayısal değerini içerir', () => {
    const result = evaluateSpeedLimitRisk(input({ postedSpeedLimitKph: 90 }, { currentSpeedKph: 120 }, { overspeedToleranceKph: 2 }));
    expect(result.riskEvents[0].message).toContain('90');
    expect(result.riskEvents[0].message).toContain('km/s');
  });

  it('mesaj/başlık/aksiyon anayasa ihlali YOK: "kesin güvenli" veya "ani fren" içermez (CRITICAL dahil)', () => {
    const result = evaluateSpeedLimitRisk(input({ postedSpeedLimitKph: 100 }, { currentSpeedKph: 160 }, { overspeedToleranceKph: 2 }));
    const all = `${result.riskEvents[0].title} ${result.riskEvents[0].message} ${result.riskEvents[0].recommendedAction}`;
    expect(all).not.toContain('kesin güvenli');
    expect(all).not.toContain('ani fren');
    expect(all).not.toMatch(/güvenlidir/);
  });

  it('source: segment.source verilirse taşınır', () => {
    const result = evaluateSpeedLimitRisk(input({ postedSpeedLimitKph: 100, source: 'user-report' }, { currentSpeedKph: 120 }, { overspeedToleranceKph: 2 }));
    expect(result.riskEvents[0].source).toBe('user-report');
  });

  it('source: segment.source verilmezse varsayılan kaynak kullanılır', () => {
    const result = evaluateSpeedLimitRisk(input({ postedSpeedLimitKph: 100, source: undefined }, { currentSpeedKph: 120 }, { overspeedToleranceKph: 2 }));
    expect(typeof result.riskEvents[0].source).toBe('string');
    expect(result.riskEvents[0].source).toBeTruthy();
  });
});

describe('evaluateSpeedLimitRisk — immutable girdi', () => {
  it('segment/vehicle/policy mutasyona uğratılmaz (snapshot)', () => {
    const i = input({ postedSpeedLimitKph: 100 }, { currentSpeedKph: 120 }, { overspeedToleranceKph: 2 });
    const snapshot = JSON.parse(JSON.stringify(i));
    evaluateSpeedLimitRisk(i);
    expect(i).toEqual(snapshot);
  });

  it('donmuş (Object.freeze) girdiyle de çalışır', () => {
    const i = {
      segment: Object.freeze(segment({ postedSpeedLimitKph: 100 })),
      vehicle: Object.freeze(vehicle({ currentSpeedKph: 120 })),
      policy: Object.freeze(policy({ overspeedToleranceKph: 2 })),
    };
    Object.freeze(i);
    expect(() => evaluateSpeedLimitRisk(i)).not.toThrow();
  });
});

describe('evaluateSpeedLimitRisk — deterministik çıktı', () => {
  it('aynı girdi tekrar tekrar çağrılınca AYNI sonucu verir', () => {
    const i = input({ postedSpeedLimitKph: 100 }, { currentSpeedKph: 130 }, { overspeedToleranceKph: 2 });
    const a = evaluateSpeedLimitRisk(i);
    const b = evaluateSpeedLimitRisk(i);
    expect(a).toEqual(b);
  });
});

describe('GuardianEngine entegrasyonu', () => {
  it('evaluateSpeedLimitRisk sonucu runGuardian\'a verilince SPEED_LIMIT_RISK event görünür + highestSeverity doğru + skor artar', () => {
    const empty = runGuardian({ ruleResults: [] });
    const ruleResult = evaluateSpeedLimitRisk(input({ postedSpeedLimitKph: 100 }, { currentSpeedKph: 160 }, { overspeedToleranceKph: 2 })); // CRITICAL
    const output = runGuardian({ ruleResults: [ruleResult] });
    expect(output.riskEvents).toHaveLength(1);
    expect(output.riskEvents[0].type).toBe('SPEED_LIMIT_RISK');
    expect(output.highestSeverity).toBe('CRITICAL');
    expect(output.overallRiskScore).toBeGreaterThan(empty.overallRiskScore);
  });

  it('curve + speed-limit BİRLİKTE runGuardian\'da doğru dedup/sıralanır (farklı id\'ler → ikisi de kalır)', () => {
    const curveResult = evaluateCurveRisk({
      curve: { id: 'curve-1', distanceMeters: 100, direction: 'left', advisorySpeedKph: 60, confidence: 0.8 },
      vehicle: { currentSpeedKph: 90 }, // ratio=1.5 → CRITICAL
      policy: { warningLeadTimeSeconds: 8, minimumWarningDistanceMeters: 50, overspeedToleranceKph: 2 },
    });
    const speedLimitResult = evaluateSpeedLimitRisk(input({ id: 'seg-1', postedSpeedLimitKph: 100, distanceMeters: 100 }, { currentSpeedKph: 105 }, { overspeedToleranceKph: 2 })); // LOW, ratio=1.05, pencere içinde

    const output = runGuardian({ ruleResults: [curveResult, speedLimitResult] });
    expect(output.riskEvents).toHaveLength(2);
    expect(output.riskEvents.map(e => e.type).sort()).toEqual(['CURVE_RISK', 'SPEED_LIMIT_RISK']);
    // severity DESC sıralama: CRITICAL (curve) önce gelmeli
    expect(output.riskEvents[0].type).toBe('CURVE_RISK');
    expect(output.highestSeverity).toBe('CRITICAL');
  });

  it('event-yok RuleResult runGuardian\'a verilince hiçbir olay eklemez', () => {
    const ruleResult = evaluateSpeedLimitRisk(input({ postedSpeedLimitKph: undefined }));
    const output = runGuardian({ ruleResults: [ruleResult] });
    expect(output.riskEvents).toEqual([]);
    expect(output.overallRiskScore).toBe(0);
  });
});

describe('CurveRisk regresyonu (G2 bozulmadı)', () => {
  it('evaluateCurveRisk hâlâ aynı formülle çalışır (LOW örneği)', () => {
    const result = evaluateCurveRisk({
      curve: { id: 'c1', distanceMeters: 100, direction: 'left', advisorySpeedKph: 100, confidence: 0.8 },
      vehicle: { currentSpeedKph: 105 },
      policy: { warningLeadTimeSeconds: 8, minimumWarningDistanceMeters: 50, overspeedToleranceKph: 2 },
    });
    expect(result.riskEvents[0].severity).toBe('LOW');
    expect(result.riskEvents[0].type).toBe('CURVE_RISK');
  });
});
