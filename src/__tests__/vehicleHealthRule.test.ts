/**
 * vehicleHealthRule.test.ts — GUARDIAN-AI-G6.
 *
 * `evaluateVehicleHealthRisk` — beşinci Guardian analiz kuralı. ÖNCEKİLERDEN
 * FARKLI: çoklu-sinyal → ÇOKLU-EVENT (tek çağrıda 0..6 arası RiskEvent, SABİT
 * deterministik sırayla). Kapsam: her sinyal için severity (coolant YÜKSEK
 * kötü, oil/battery DÜŞÜK kötü, üç boolean) · sinyal-yok/güvenli-bölge →
 * event-yok · ÇOKLU EVENT tek çağrıda · validation throw'ları (numeric NaN/
 * Inf, threshold non-monoton, geçersiz boolean severity token, signalConfidence
 * aralık dışı) · deterministik id'ler · confidence sınırı · "motoru hemen
 * durdur" hiçbir event'te yok · immutable/deterministik · GuardianEngine
 * entegrasyonu (5 kural birlikte + dedup) · G1-G5 regresyonu.
 */
import { describe, it, expect } from 'vitest';
import { evaluateVehicleHealthRisk, VEHICLE_HEALTH_RULE_ID } from '../platform/navigation/guardian/rules/vehicleHealthRule';
import type {
  VehicleHealthRiskInput,
  VehicleHealthSignalsInput,
  VehicleHealthPolicyInput,
} from '../platform/navigation/guardian/rules/vehicleHealthRule';
import { evaluateCurveRisk } from '../platform/navigation/guardian/rules/curveRiskRule';
import { evaluateSpeedLimitRisk } from '../platform/navigation/guardian/rules/speedLimitRule';
import { evaluateRoadProfileRisk } from '../platform/navigation/guardian/rules/roadProfileRule';
import { evaluateWeatherRisk } from '../platform/navigation/guardian/rules/weatherRiskRule';
import { runGuardian } from '../platform/navigation/guardian/guardianEngine';

function policy(overrides: Partial<VehicleHealthPolicyInput> = {}): VehicleHealthPolicyInput {
  return {
    thresholds: {
      coolant: { high: 100, critical: 110 },
      oilPressure: { low: 150, critical: 100 },
      batteryVoltage: { low: 12.0, critical: 11.0 },
    },
    booleanSeverities: {
      brakeWarning: 'HIGH',
      engineWarningLamp: 'MEDIUM',
      transmissionWarning: 'HIGH',
    },
    ...overrides,
  };
}

function safeSignals(): VehicleHealthSignalsInput {
  return {
    coolantTemperatureC: 90,
    oilPressureKpa: 200,
    brakeWarning: false,
    batteryVoltage: 13.0,
    engineWarningLamp: false,
    transmissionWarning: false,
  };
}

function input(
  signals: VehicleHealthSignalsInput,
  policyOverrides: Partial<VehicleHealthPolicyInput> = {},
): VehicleHealthRiskInput {
  return { signals, policy: policy(policyOverrides) };
}

describe('evaluateVehicleHealthRisk — coolant (YÜKSEK kötü)', () => {
  it('HIGH: temp=105 (>=high, <critical)', () => {
    const result = evaluateVehicleHealthRisk(input({ coolantTemperatureC: 105 }));
    expect(result.riskEvents).toHaveLength(1);
    expect(result.riskEvents[0].severity).toBe('HIGH');
    expect(result.riskEvents[0].id).toBe('vehicle-health:coolant');
  });

  it('CRITICAL: temp=115 (>=critical)', () => {
    const result = evaluateVehicleHealthRisk(input({ coolantTemperatureC: 115 }));
    expect(result.riskEvents[0].severity).toBe('CRITICAL');
  });

  it('sınır DEĞERLERİ: temp=100 tam high → HIGH, temp=110 tam critical → CRITICAL', () => {
    expect(evaluateVehicleHealthRisk(input({ coolantTemperatureC: 100 })).riskEvents[0].severity).toBe('HIGH');
    expect(evaluateVehicleHealthRisk(input({ coolantTemperatureC: 110 })).riskEvents[0].severity).toBe('CRITICAL');
  });

  it('güvenli bölge (temp=90 < high) → event yok', () => {
    const result = evaluateVehicleHealthRisk(input({ coolantTemperatureC: 90 }));
    expect(result.riskEvents).toEqual([]);
  });
});

describe('evaluateVehicleHealthRisk — oilPressure (DÜŞÜK kötü, yalnız HIGH+CRITICAL)', () => {
  it('HIGH: pressure=140 (<=low, >critical)', () => {
    const result = evaluateVehicleHealthRisk(input({ oilPressureKpa: 140 }));
    expect(result.riskEvents[0].severity).toBe('HIGH');
    expect(result.riskEvents[0].id).toBe('vehicle-health:oil-pressure');
  });

  it('CRITICAL: pressure=90 (<=critical)', () => {
    const result = evaluateVehicleHealthRisk(input({ oilPressureKpa: 90 }));
    expect(result.riskEvents[0].severity).toBe('CRITICAL');
  });

  it('güvenli bölge (pressure=200 > low) → event yok', () => {
    const result = evaluateVehicleHealthRisk(input({ oilPressureKpa: 200 }));
    expect(result.riskEvents).toEqual([]);
  });
});

describe('evaluateVehicleHealthRisk — batteryVoltage (DÜŞÜK kötü, LOW+MEDIUM)', () => {
  it('LOW: voltage=11.8 (<=low, >critical)', () => {
    const result = evaluateVehicleHealthRisk(input({ batteryVoltage: 11.8 }));
    expect(result.riskEvents[0].severity).toBe('LOW');
    expect(result.riskEvents[0].id).toBe('vehicle-health:battery');
  });

  it('MEDIUM: voltage=10.5 (<=critical)', () => {
    const result = evaluateVehicleHealthRisk(input({ batteryVoltage: 10.5 }));
    expect(result.riskEvents[0].severity).toBe('MEDIUM');
  });

  it('güvenli bölge (voltage=13.0 > low) → event yok', () => {
    const result = evaluateVehicleHealthRisk(input({ batteryVoltage: 13.0 }));
    expect(result.riskEvents).toEqual([]);
  });
});

describe('evaluateVehicleHealthRisk — boolean sinyaller', () => {
  it('brakeWarning=true → policy.booleanSeverities.brakeWarning (HIGH)', () => {
    const result = evaluateVehicleHealthRisk(input({ brakeWarning: true }));
    expect(result.riskEvents).toHaveLength(1);
    expect(result.riskEvents[0].severity).toBe('HIGH');
    expect(result.riskEvents[0].id).toBe('vehicle-health:brake');
  });

  it('engineWarningLamp=true (MIL) → policy.booleanSeverities.engineWarningLamp (MEDIUM)', () => {
    const result = evaluateVehicleHealthRisk(input({ engineWarningLamp: true }));
    expect(result.riskEvents[0].severity).toBe('MEDIUM');
    expect(result.riskEvents[0].id).toBe('vehicle-health:mil');
  });

  it('transmissionWarning=true → policy.booleanSeverities.transmissionWarning (HIGH)', () => {
    const result = evaluateVehicleHealthRisk(input({ transmissionWarning: true }));
    expect(result.riskEvents[0].severity).toBe('HIGH');
    expect(result.riskEvents[0].id).toBe('vehicle-health:transmission');
  });

  it('boolean false/undefined → event yok', () => {
    expect(evaluateVehicleHealthRisk(input({ brakeWarning: false })).riskEvents).toEqual([]);
    expect(evaluateVehicleHealthRisk(input({ brakeWarning: undefined })).riskEvents).toEqual([]);
  });
});

describe('evaluateVehicleHealthRisk — sinyal yok → boş RuleResult', () => {
  it('signals={} → riskEvents=[]', () => {
    const result = evaluateVehicleHealthRisk(input({}));
    expect(result).toEqual({ ruleId: VEHICLE_HEALTH_RULE_ID, riskEvents: [] });
  });

  it('tüm sinyaller GÜVENLİ değerlerde → riskEvents=[]', () => {
    const result = evaluateVehicleHealthRisk(input(safeSignals()));
    expect(result.riskEvents).toEqual([]);
  });
});

describe('evaluateVehicleHealthRisk — ÇOKLU EVENT (tek çağrıda birden fazla)', () => {
  it('coolant CRITICAL + oil CRITICAL + brake true → 3 AYRI event, SABİT sırayla', () => {
    const result = evaluateVehicleHealthRisk(input({
      coolantTemperatureC: 115,
      oilPressureKpa: 90,
      brakeWarning: true,
    }));
    expect(result.riskEvents).toHaveLength(3);
    expect(result.riskEvents.map(e => e.id)).toEqual([
      'vehicle-health:coolant',
      'vehicle-health:oil-pressure',
      'vehicle-health:brake',
    ]);
    expect(result.riskEvents.every(e => e.type === 'VEHICLE_HEALTH_RISK')).toBe(true);
  });

  it('TÜM 6 sinyal aktif → 6 event, SABİT sıra: coolant→oil-pressure→brake→battery→mil→transmission', () => {
    const result = evaluateVehicleHealthRisk(input({
      coolantTemperatureC: 115,
      oilPressureKpa: 90,
      brakeWarning: true,
      batteryVoltage: 10.5,
      engineWarningLamp: true,
      transmissionWarning: true,
    }));
    expect(result.riskEvents).toHaveLength(6);
    expect(result.riskEvents.map(e => e.id)).toEqual([
      'vehicle-health:coolant',
      'vehicle-health:oil-pressure',
      'vehicle-health:brake',
      'vehicle-health:battery',
      'vehicle-health:mil',
      'vehicle-health:transmission',
    ]);
  });

  it('yalnız battery + transmission aktif → sıra hâlâ tanımlı sırayı izler (aradakiler atlanır)', () => {
    const result = evaluateVehicleHealthRisk(input({
      batteryVoltage: 11.8,
      transmissionWarning: true,
    }));
    expect(result.riskEvents.map(e => e.id)).toEqual(['vehicle-health:battery', 'vehicle-health:transmission']);
  });
});

describe('evaluateVehicleHealthRisk — validation throw', () => {
  it('coolantTemperatureC NaN/Infinity → THROW', () => {
    expect(() => evaluateVehicleHealthRisk(input({ coolantTemperatureC: NaN }))).toThrow();
    expect(() => evaluateVehicleHealthRisk(input({ coolantTemperatureC: Infinity }))).toThrow();
  });

  it('oilPressureKpa NaN/Infinity → THROW', () => {
    expect(() => evaluateVehicleHealthRisk(input({ oilPressureKpa: NaN }))).toThrow();
    expect(() => evaluateVehicleHealthRisk(input({ oilPressureKpa: Infinity }))).toThrow();
  });

  it('batteryVoltage NaN/Infinity → THROW', () => {
    expect(() => evaluateVehicleHealthRisk(input({ batteryVoltage: NaN }))).toThrow();
    expect(() => evaluateVehicleHealthRisk(input({ batteryVoltage: Infinity }))).toThrow();
  });

  it('signals eksik → THROW', () => {
    expect(() => evaluateVehicleHealthRisk({ policy: policy() } as unknown as VehicleHealthRiskInput)).toThrow();
  });

  it('policy eksik → THROW', () => {
    expect(() => evaluateVehicleHealthRisk({ signals: safeSignals() } as unknown as VehicleHealthRiskInput)).toThrow();
  });

  it('policy.thresholds eksik → THROW', () => {
    const i = { signals: safeSignals(), policy: { booleanSeverities: policy().booleanSeverities } } as unknown as VehicleHealthRiskInput;
    expect(() => evaluateVehicleHealthRisk(i)).toThrow();
  });

  it('policy.booleanSeverities eksik → THROW', () => {
    const i = { signals: safeSignals(), policy: { thresholds: policy().thresholds } } as unknown as VehicleHealthRiskInput;
    expect(() => evaluateVehicleHealthRisk(i)).toThrow();
  });

  it('threshold NON-MONOTON: coolant.high > coolant.critical → THROW', () => {
    expect(() => evaluateVehicleHealthRisk(input(safeSignals(), {
      thresholds: { coolant: { high: 120, critical: 100 }, oilPressure: { low: 150, critical: 100 }, batteryVoltage: { low: 12, critical: 11 } },
    }))).toThrow();
  });

  it('threshold NON-MONOTON: oilPressure.critical > oilPressure.low → THROW', () => {
    expect(() => evaluateVehicleHealthRisk(input(safeSignals(), {
      thresholds: { coolant: { high: 100, critical: 110 }, oilPressure: { low: 100, critical: 150 }, batteryVoltage: { low: 12, critical: 11 } },
    }))).toThrow();
  });

  it('threshold NON-MONOTON: batteryVoltage.critical > batteryVoltage.low → THROW', () => {
    expect(() => evaluateVehicleHealthRisk(input(safeSignals(), {
      thresholds: { coolant: { high: 100, critical: 110 }, oilPressure: { low: 150, critical: 100 }, batteryVoltage: { low: 11, critical: 12 } },
    }))).toThrow();
  });

  it('threshold NaN/Infinity içeriyorsa → THROW', () => {
    expect(() => evaluateVehicleHealthRisk(input(safeSignals(), {
      thresholds: { coolant: { high: NaN, critical: 110 }, oilPressure: { low: 150, critical: 100 }, batteryVoltage: { low: 12, critical: 11 } },
    }))).toThrow();
  });

  it('geçersiz boolean severity token → THROW', () => {
    expect(() => evaluateVehicleHealthRisk(input(safeSignals(), {
      booleanSeverities: { brakeWarning: 'GEÇERSİZ' as never, engineWarningLamp: 'MEDIUM', transmissionWarning: 'HIGH' },
    }))).toThrow();
  });

  it('signalConfidence 0..1 dışı → THROW', () => {
    expect(() => evaluateVehicleHealthRisk(input(safeSignals(), { signalConfidence: 1.5 }))).toThrow();
    expect(() => evaluateVehicleHealthRisk(input(safeSignals(), { signalConfidence: -0.1 }))).toThrow();
    expect(() => evaluateVehicleHealthRisk(input(safeSignals(), { signalConfidence: NaN }))).toThrow();
  });
});

describe('evaluateVehicleHealthRisk — confidence sınırı', () => {
  it('event.confidence = clamp(policy.signalConfidence) — 0.7 verilirse 0.7 taşınır', () => {
    const result = evaluateVehicleHealthRisk(input({ brakeWarning: true }, { signalConfidence: 0.7 }));
    expect(result.riskEvents[0].confidence).toBe(0.7);
  });

  it('signalConfidence verilmezse DEFAULT_HEALTH_CONFIDENCE (0.9) kullanılır', () => {
    const result = evaluateVehicleHealthRisk(input({ brakeWarning: true }));
    expect(result.riskEvents[0].confidence).toBe(0.9);
  });

  it('birden fazla event AYNI confidence\'ı paylaşır (ortak signalConfidence)', () => {
    const result = evaluateVehicleHealthRisk(input({ coolantTemperatureC: 115, brakeWarning: true }, { signalConfidence: 0.75 }));
    expect(result.riskEvents.every(e => e.confidence === 0.75)).toBe(true);
  });
});

describe('evaluateVehicleHealthRisk — "motoru hemen durdur" HİÇBİR event\'te YOK', () => {
  it('coolant/oil/brake/battery/mil/transmission tümünde yasaklı ifade yok', () => {
    const result = evaluateVehicleHealthRisk(input({
      coolantTemperatureC: 115,
      oilPressureKpa: 90,
      brakeWarning: true,
      batteryVoltage: 10.5,
      engineWarningLamp: true,
      transmissionWarning: true,
    }));
    for (const event of result.riskEvents) {
      const all = `${event.title} ${event.message} ${event.recommendedAction}`;
      expect(all).not.toContain('hemen durdur');
      expect(all).not.toContain('Kesin arıza');
      expect(all).not.toContain('bozulacak');
    }
  });
});

describe('evaluateVehicleHealthRisk — immutable girdi', () => {
  it('signals/policy mutasyona uğratılmaz (snapshot)', () => {
    const i = input({ coolantTemperatureC: 115, brakeWarning: true });
    const snapshot = JSON.parse(JSON.stringify(i));
    evaluateVehicleHealthRisk(i);
    expect(i).toEqual(snapshot);
  });

  it('donmuş (Object.freeze) girdiyle de çalışır', () => {
    const i = {
      signals: Object.freeze({ coolantTemperatureC: 115 }),
      policy: Object.freeze({
        thresholds: Object.freeze({
          coolant: Object.freeze({ high: 100, critical: 110 }),
          oilPressure: Object.freeze({ low: 150, critical: 100 }),
          batteryVoltage: Object.freeze({ low: 12, critical: 11 }),
        }),
        booleanSeverities: Object.freeze({ brakeWarning: 'HIGH', engineWarningLamp: 'MEDIUM', transmissionWarning: 'HIGH' }),
      }),
    };
    Object.freeze(i);
    expect(() => evaluateVehicleHealthRisk(i)).not.toThrow();
  });
});

describe('evaluateVehicleHealthRisk — deterministik çıktı', () => {
  it('aynı girdi tekrar tekrar çağrılınca AYNI sonucu verir', () => {
    const i = input({ coolantTemperatureC: 115, oilPressureKpa: 90, brakeWarning: true });
    const a = evaluateVehicleHealthRisk(i);
    const b = evaluateVehicleHealthRisk(i);
    expect(a).toEqual(b);
  });
});

describe('GuardianEngine entegrasyonu', () => {
  it('evaluateVehicleHealthRisk sonucu runGuardian\'a verilince VEHICLE_HEALTH_RISK event(ler)i görünür + highestSeverity doğru + skor artar', () => {
    const empty = runGuardian({ ruleResults: [] });
    const ruleResult = evaluateVehicleHealthRisk(input({ coolantTemperatureC: 115, brakeWarning: true })); // CRITICAL + HIGH
    const output = runGuardian({ ruleResults: [ruleResult] });
    expect(output.riskEvents).toHaveLength(2);
    expect(output.riskEvents.every(e => e.type === 'VEHICLE_HEALTH_RISK')).toBe(true);
    expect(output.highestSeverity).toBe('CRITICAL');
    expect(output.overallRiskScore).toBeGreaterThan(empty.overallRiskScore);
  });

  it('CURVE + SPEED_LIMIT + DOWNHILL + WEATHER + VEHICLE_HEALTH beşi birlikte runGuardian\'da doğru birleşir (farklı id\'ler → dedup\'a takılmaz)', () => {
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
      condition: { surfaceCondition: 'wet', confidence: 0.8 },
      policy: { severityByCondition: { dry: 'NONE', wet: 'LOW', snow: 'HIGH', ice: 'CRITICAL' } },
    }); // LOW
    const healthResult = evaluateVehicleHealthRisk(input({ engineWarningLamp: true })); // MEDIUM

    const output = runGuardian({ ruleResults: [curveResult, speedLimitResult, downhillResult, weatherResult, healthResult] });
    expect(output.riskEvents).toHaveLength(5);
    expect(output.riskEvents.map(e => e.type).sort()).toEqual([
      'CURVE_RISK', 'DOWNHILL_RISK', 'SPEED_LIMIT_RISK', 'VEHICLE_HEALTH_RISK', 'WEATHER_RISK',
    ]);
    expect(output.highestSeverity).toBe('CRITICAL');
    expect(output.riskEvents[0].type).toBe('CURVE_RISK'); // severity DESC → CRITICAL önce
  });

  it('DEDUP: aynı vehicle-health event id\'si (coolant) iki ayrı RuleResult\'tan farklı severity ile gelirse → YÜKSEK severity tutulur (G1 davranışı)', () => {
    const lowerResult = evaluateVehicleHealthRisk(input({ coolantTemperatureC: 105 })); // HIGH
    const higherResult = evaluateVehicleHealthRisk(input({ coolantTemperatureC: 115 })); // CRITICAL
    // İkisi de AYNI id'yi (vehicle-health:coolant) üretir — farklı iki "kural sonucu" gibi davranıyoruz.
    expect(lowerResult.riskEvents[0].id).toBe(higherResult.riskEvents[0].id);

    const output = runGuardian({ ruleResults: [lowerResult, higherResult] });
    expect(output.riskEvents).toHaveLength(1); // dedup edildi
    expect(output.riskEvents[0].severity).toBe('CRITICAL'); // yüksek olan kazandı
  });

  it('event-yok RuleResult runGuardian\'a verilince hiçbir olay eklemez', () => {
    const ruleResult = evaluateVehicleHealthRisk(input(safeSignals()));
    const output = runGuardian({ ruleResults: [ruleResult] });
    expect(output.riskEvents).toEqual([]);
    expect(output.overallRiskScore).toBe(0);
  });
});

describe('G1-G5 regresyonu (guardianEngine/curve/speed/road/weather bozulmadı)', () => {
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

  it('evaluateRoadProfileRisk hâlâ aynı formülle çalışır', () => {
    const result = evaluateRoadProfileRisk({
      segment: { id: 'r1', distanceMeters: 40, downhillGradePercent: 25, confidence: 0.8 },
      vehicle: { currentSpeedKph: 80 },
      policy: { warningLeadTimeSeconds: 8, minimumWarningDistanceMeters: 50 },
      gradeThresholds: { low: 8, medium: 12, high: 16, critical: 20 },
    });
    expect(result.riskEvents[0].severity).toBe('CRITICAL');
  });

  it('evaluateWeatherRisk hâlâ aynı davranışla çalışır', () => {
    const result = evaluateWeatherRisk({
      condition: { surfaceCondition: 'ice', confidence: 0.8 },
      policy: { severityByCondition: { dry: 'NONE', wet: 'LOW', snow: 'HIGH', ice: 'CRITICAL' } },
    });
    expect(result.riskEvents[0].severity).toBe('CRITICAL');
  });

  it('runGuardian boş girişte hâlâ eski davranışı korur', () => {
    const out = runGuardian({ ruleResults: [] });
    expect(out.riskEvents).toEqual([]);
    expect(out.highestSeverity).toBeNull();
    expect(out.overallRiskScore).toBe(0);
  });
});
