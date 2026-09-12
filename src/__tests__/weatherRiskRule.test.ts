/**
 * weatherRiskRule.test.ts — GUARDIAN-AI-G5.
 *
 * `evaluateWeatherRisk` — dördüncü Guardian analiz kuralı. Severity TAMAMEN
 * KATEGORİK (DI ile gelen `severityByCondition` haritasından) — oran/eşik/
 * fizik/pencere YOK. Kapsam: dry/wet/snow/ice/unknown davranışı · NONE→
 * event-yok · confidence eşiği · eksik-eşleme→throw · geçersiz severity
 * değeri→throw · deterministik id/çıktı · immutable girdi · confidence
 * sınırı · "ani fren" hiçbir event'te yok · distanceMeters=0 ·
 * GuardianEngine entegrasyonu (4 kural birlikte) · curve/speed/road
 * regresyonu.
 */
import { describe, it, expect } from 'vitest';
import { evaluateWeatherRisk, WEATHER_RULE_ID } from '../platform/navigation/guardian/rules/weatherRiskRule';
import type {
  WeatherRiskInput,
  WeatherConditionInput,
  WeatherRiskPolicyInput,
  WeatherSeverityByCondition,
} from '../platform/navigation/guardian/rules/weatherRiskRule';
import { evaluateCurveRisk } from '../platform/navigation/guardian/rules/curveRiskRule';
import { evaluateSpeedLimitRisk } from '../platform/navigation/guardian/rules/speedLimitRule';
import { evaluateRoadProfileRisk } from '../platform/navigation/guardian/rules/roadProfileRule';
import { runGuardian } from '../platform/navigation/guardian/guardianEngine';

function severityMap(overrides: Partial<WeatherSeverityByCondition> = {}): WeatherSeverityByCondition {
  return { dry: 'NONE', wet: 'LOW', snow: 'HIGH', ice: 'CRITICAL', ...overrides };
}

function condition(overrides: Partial<WeatherConditionInput> = {}): WeatherConditionInput {
  return { surfaceCondition: 'wet', source: 'osm-surface', confidence: 0.8, ...overrides };
}

function policy(overrides: Partial<WeatherSeverityByCondition> = {}): WeatherRiskPolicyInput {
  return { severityByCondition: severityMap(overrides) };
}

function input(
  conditionOverrides: Partial<WeatherConditionInput> = {},
  severityOverrides: Partial<WeatherSeverityByCondition> = {},
): WeatherRiskInput {
  return {
    condition: condition(conditionOverrides),
    policy: policy(severityOverrides),
  };
}

describe('evaluateWeatherRisk — kategorik severity (DI haritasından)', () => {
  it('dry → NONE eşlemesi → event yok', () => {
    const result = evaluateWeatherRisk(input({ surfaceCondition: 'dry' }));
    expect(result).toEqual({ ruleId: WEATHER_RULE_ID, riskEvents: [] });
  });

  it('wet → LOW event', () => {
    const result = evaluateWeatherRisk(input({ surfaceCondition: 'wet' }));
    expect(result.riskEvents).toHaveLength(1);
    expect(result.riskEvents[0].severity).toBe('LOW');
  });

  it('snow → HIGH event', () => {
    const result = evaluateWeatherRisk(input({ surfaceCondition: 'snow' }));
    expect(result.riskEvents[0].severity).toBe('HIGH');
  });

  it('ice → CRITICAL event', () => {
    const result = evaluateWeatherRisk(input({ surfaceCondition: 'ice' }));
    expect(result.riskEvents[0].severity).toBe('CRITICAL');
  });

  it('gömülü severity haritası YOK — aynı koşul, FARKLI DI haritası → FARKLI severity', () => {
    const withDefaultMap = evaluateWeatherRisk(input({ surfaceCondition: 'wet' }, {}));
    const withCustomMap = evaluateWeatherRisk(input({ surfaceCondition: 'wet' }, { wet: 'CRITICAL' }));
    expect(withDefaultMap.riskEvents[0].severity).toBe('LOW');
    expect(withCustomMap.riskEvents[0].severity).toBe('CRITICAL');
  });
});

describe('evaluateWeatherRisk — unknown/undefined → event yok (asla tahmin)', () => {
  it('surfaceCondition="unknown" → event yok', () => {
    const result = evaluateWeatherRisk(input({ surfaceCondition: 'unknown' }));
    expect(result.riskEvents).toEqual([]);
  });

  it('surfaceCondition undefined → event yok', () => {
    const result = evaluateWeatherRisk(input({ surfaceCondition: undefined }));
    expect(result.riskEvents).toEqual([]);
  });

  it('unknown için severityByCondition eşlemesi OLMASA bile throw ATMAZ (aranmaz)', () => {
    const i: WeatherRiskInput = {
      condition: condition({ surfaceCondition: 'unknown' }),
      policy: { severityByCondition: { dry: 'NONE', wet: 'LOW', snow: 'HIGH', ice: 'CRITICAL' } }, // unknown yok
    };
    expect(() => evaluateWeatherRisk(i)).not.toThrow();
    expect(evaluateWeatherRisk(i).riskEvents).toEqual([]);
  });
});

describe('evaluateWeatherRisk — confidence eşiği (fail-closed, throw DEĞİL)', () => {
  it('confidence eşik ALTINDA (0.29 < 0.3) → event yok', () => {
    const result = evaluateWeatherRisk(input({ surfaceCondition: 'wet', confidence: 0.29 }));
    expect(result.riskEvents).toEqual([]);
  });

  it('confidence TAM eşikte (0.3) → event ÜRETİLİR', () => {
    const result = evaluateWeatherRisk(input({ surfaceCondition: 'wet', confidence: 0.3 }));
    expect(result.riskEvents).toHaveLength(1);
  });
});

describe('evaluateWeatherRisk — validation throw', () => {
  it('condition eksik (undefined) → THROW', () => {
    expect(() => evaluateWeatherRisk({ condition: undefined as unknown as WeatherConditionInput, policy: policy() })).toThrow();
  });

  it('confidence NaN → THROW', () => {
    expect(() => evaluateWeatherRisk(input({ confidence: NaN }))).toThrow();
  });

  it('confidence Infinity → THROW', () => {
    expect(() => evaluateWeatherRisk(input({ confidence: Infinity }))).toThrow();
  });

  it('policy.severityByCondition eksik → THROW', () => {
    expect(() => evaluateWeatherRisk({ condition: condition(), policy: { severityByCondition: undefined as unknown as WeatherSeverityByCondition } })).toThrow();
  });

  it('policy tamamen eksik → THROW', () => {
    expect(() => evaluateWeatherRisk({ condition: condition() } as unknown as WeatherRiskInput)).toThrow();
  });

  it('KNOWN condition (ice) için severityByCondition eşlemesi YOKSA → THROW (kritik uyarı sessizce düşmesin)', () => {
    const i: WeatherRiskInput = {
      condition: condition({ surfaceCondition: 'ice' }),
      policy: { severityByCondition: { dry: 'NONE', wet: 'LOW', snow: 'HIGH' } }, // ice UNUTULDU
    };
    expect(() => evaluateWeatherRisk(i)).toThrow();
  });

  it('KNOWN condition (wet) için eşleme yoksa → THROW', () => {
    const i: WeatherRiskInput = {
      condition: condition({ surfaceCondition: 'wet' }),
      policy: { severityByCondition: { dry: 'NONE', snow: 'HIGH', ice: 'CRITICAL' } }, // wet YOK
    };
    expect(() => evaluateWeatherRisk(i)).toThrow();
  });

  it('severityByCondition içinde GEÇERSİZ bir değer varsa → THROW', () => {
    const i: WeatherRiskInput = {
      condition: condition({ surfaceCondition: 'wet' }),
      policy: { severityByCondition: { dry: 'NONE', wet: 'GEÇERSİZ' as never, snow: 'HIGH', ice: 'CRITICAL' } },
    };
    expect(() => evaluateWeatherRisk(i)).toThrow();
  });
});

describe('evaluateWeatherRisk — confidence sınırı (event conf <= condition conf)', () => {
  it('event.confidence <= condition.confidence', () => {
    const result = evaluateWeatherRisk(input({ surfaceCondition: 'wet', confidence: 0.65 }));
    expect(result.riskEvents[0].confidence).toBeLessThanOrEqual(0.65);
    expect(result.riskEvents[0].confidence).toBe(0.65);
  });
});

describe('evaluateWeatherRisk — deterministik event id / tip / kaynak', () => {
  it('id = `weather:${source}:${surfaceCondition}`', () => {
    const result = evaluateWeatherRisk(input({ surfaceCondition: 'wet', source: 'user-report' }));
    expect(result.riskEvents[0].id).toBe('weather:user-report:wet');
  });

  it('source verilmezse id\'de varsayılan kaynak kullanılır', () => {
    const result = evaluateWeatherRisk(input({ surfaceCondition: 'snow', source: undefined }));
    expect(result.riskEvents[0].id).toMatch(/^weather:.+:snow$/);
    expect(typeof result.riskEvents[0].source).toBe('string');
    expect(result.riskEvents[0].source).toBeTruthy();
  });

  it('type=WEATHER_RISK, ruleId=weather', () => {
    const result = evaluateWeatherRisk(input({ surfaceCondition: 'wet' }));
    expect(result.ruleId).toBe('weather');
    expect(result.riskEvents[0].type).toBe('WEATHER_RISK');
  });

  it('source: condition.source verilirse taşınır', () => {
    const result = evaluateWeatherRisk(input({ surfaceCondition: 'ice', source: 'my-sensor' }));
    expect(result.riskEvents[0].source).toBe('my-sensor');
  });
});

describe('evaluateWeatherRisk — "ani fren"/"kesin güvenli" HİÇBİR event\'te YOK', () => {
  it.each([
    ['wet', 'LOW'], ['snow', 'HIGH'], ['ice', 'CRITICAL'],
  ])('%s koşulunda (%s severity) yasaklı ifade yok', (surface) => {
    const result = evaluateWeatherRisk(input({ surfaceCondition: surface as 'wet' | 'snow' | 'ice' }));
    const all = `${result.riskEvents[0].title} ${result.riskEvents[0].message} ${result.riskEvents[0].recommendedAction}`;
    expect(all).not.toContain('ani fren');
    expect(all).not.toContain('kesin güvenli');
    expect(all).not.toMatch(/güvenlidir/);
  });

  it('mesajlar koşula uygun İHTİYATLI içerik taşır (birbirinden farklı)', () => {
    const wet = evaluateWeatherRisk(input({ surfaceCondition: 'wet' })).riskEvents[0].message;
    const snow = evaluateWeatherRisk(input({ surfaceCondition: 'snow' })).riskEvents[0].message;
    const ice = evaluateWeatherRisk(input({ surfaceCondition: 'ice' })).riskEvents[0].message;
    expect(wet).not.toBe(snow);
    expect(snow).not.toBe(ice);
    expect(wet).not.toBe(ice);
  });
});

describe('evaluateWeatherRisk — distanceMeters=0 (anlık ortam koşulu)', () => {
  it('her zaman distanceMeters=0 döner (segment-mesafeli değil)', () => {
    const result = evaluateWeatherRisk(input({ surfaceCondition: 'ice' }));
    expect(result.riskEvents[0].distanceMeters).toBe(0);
  });
});

describe('evaluateWeatherRisk — immutable girdi', () => {
  it('condition/policy mutasyona uğratılmaz (snapshot)', () => {
    const i = input({ surfaceCondition: 'wet' });
    const snapshot = JSON.parse(JSON.stringify(i));
    evaluateWeatherRisk(i);
    expect(i).toEqual(snapshot);
  });

  it('donmuş (Object.freeze) girdiyle de çalışır', () => {
    const i = {
      condition: Object.freeze(condition({ surfaceCondition: 'wet' })),
      policy: Object.freeze({ severityByCondition: Object.freeze(severityMap()) }),
    };
    Object.freeze(i);
    expect(() => evaluateWeatherRisk(i)).not.toThrow();
  });
});

describe('evaluateWeatherRisk — deterministik çıktı', () => {
  it('aynı girdi tekrar tekrar çağrılınca AYNI sonucu verir', () => {
    const i = input({ surfaceCondition: 'snow' });
    const a = evaluateWeatherRisk(i);
    const b = evaluateWeatherRisk(i);
    expect(a).toEqual(b);
  });
});

describe('GuardianEngine entegrasyonu', () => {
  it('evaluateWeatherRisk sonucu runGuardian\'a verilince WEATHER_RISK event görünür + highestSeverity doğru + skor artar', () => {
    const empty = runGuardian({ ruleResults: [] });
    const ruleResult = evaluateWeatherRisk(input({ surfaceCondition: 'ice' })); // CRITICAL
    const output = runGuardian({ ruleResults: [ruleResult] });
    expect(output.riskEvents).toHaveLength(1);
    expect(output.riskEvents[0].type).toBe('WEATHER_RISK');
    expect(output.highestSeverity).toBe('CRITICAL');
    expect(output.overallRiskScore).toBeGreaterThan(empty.overallRiskScore);
  });

  it('CURVE + SPEED_LIMIT + DOWNHILL + WEATHER dördü birlikte runGuardian\'da doğru birleşir (dört farklı id → dördü de kalır, severity DESC)', () => {
    const curveResult = evaluateCurveRisk({
      curve: { id: 'curve-1', distanceMeters: 100, direction: 'left', advisorySpeedKph: 60, confidence: 0.8 },
      vehicle: { currentSpeedKph: 90 }, // ratio=1.5 → CRITICAL
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
    const weatherResult = evaluateWeatherRisk(input({ surfaceCondition: 'wet' })); // LOW

    const output = runGuardian({ ruleResults: [curveResult, speedLimitResult, downhillResult, weatherResult] });
    expect(output.riskEvents).toHaveLength(4);
    expect(output.riskEvents.map(e => e.type).sort()).toEqual(['CURVE_RISK', 'DOWNHILL_RISK', 'SPEED_LIMIT_RISK', 'WEATHER_RISK']);
    // severity DESC: CRITICAL (curve) → MEDIUM (downhill) → LOW,LOW (speed-limit, weather; distanceMeters ASC tie-break)
    expect(output.riskEvents[0].type).toBe('CURVE_RISK');
    expect(output.riskEvents[0].severity).toBe('CRITICAL');
    expect(output.riskEvents[1].type).toBe('DOWNHILL_RISK');
    expect(output.riskEvents[1].severity).toBe('MEDIUM');
    expect(output.highestSeverity).toBe('CRITICAL');
  });

  it('event-yok RuleResult runGuardian\'a verilince hiçbir olay eklemez', () => {
    const ruleResult = evaluateWeatherRisk(input({ surfaceCondition: 'dry' })); // NONE
    const output = runGuardian({ ruleResults: [ruleResult] });
    expect(output.riskEvents).toEqual([]);
    expect(output.overallRiskScore).toBe(0);
  });
});

describe('Curve/SpeedLimit/RoadProfile regresyonu (G2/G3/G4 bozulmadı)', () => {
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
});
