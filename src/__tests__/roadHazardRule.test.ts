/**
 * roadHazardRule.test.ts — GUARDIAN-AI-G7.
 *
 * `evaluateRoadHazardRisk` — altıncı Guardian analiz kuralı. Severity TAMAMEN
 * KATEGORİK (DI ile gelen `severityByHazard` haritasından) — oran/eşik/fizik
 * YOK. WeatherRiskRule desenine yakındır AMA event GERÇEK `hazard.distanceMeters`
 * taşır (weather'da 0'dı). Kapsam: 7 bilinen hazard tipi davranışı · unknown/
 * undefined → event-yok (asla tahmin) · NONE → event-yok · confidence eşiği ·
 * eksik-eşleme→throw · geçersiz severity değeri→throw · deterministik id/çıktı ·
 * immutable girdi · confidence sınırı · yasaklı ifade hiçbir event'te yok ·
 * distanceMeters DI'dan geçer · GuardianEngine entegrasyonu (6 kural birlikte) ·
 * curve/speed/road/weather/vehicle-health regresyonu.
 */
import { describe, it, expect } from 'vitest';
import { evaluateRoadHazardRisk, ROAD_HAZARD_RULE_ID } from '../platform/navigation/guardian/rules/roadHazardRule';
import type {
  RoadHazardRiskInput,
  RoadHazardInput,
  RoadHazardRiskPolicyInput,
  RoadHazardSeverityByHazard,
  RoadHazardType,
} from '../platform/navigation/guardian/rules/roadHazardRule';
import { evaluateCurveRisk } from '../platform/navigation/guardian/rules/curveRiskRule';
import { evaluateSpeedLimitRisk } from '../platform/navigation/guardian/rules/speedLimitRule';
import { evaluateRoadProfileRisk } from '../platform/navigation/guardian/rules/roadProfileRule';
import { evaluateWeatherRisk } from '../platform/navigation/guardian/rules/weatherRiskRule';
import { evaluateVehicleHealthRisk } from '../platform/navigation/guardian/rules/vehicleHealthRule';
import { runGuardian } from '../platform/navigation/guardian/guardianEngine';

/* ── Fixture yardımcıları ─────────────────────────────────────────────────── */

function severityMap(overrides: Partial<RoadHazardSeverityByHazard> = {}): RoadHazardSeverityByHazard {
  return {
    accident:    'HIGH',
    roadwork:    'MEDIUM',
    obstacle:    'HIGH',
    lane_closed: 'MEDIUM',
    animal:      'MEDIUM',
    flood:       'CRITICAL',
    rockfall:    'CRITICAL',
    ...overrides,
  };
}

function hazard(overrides: Partial<RoadHazardInput> = {}): RoadHazardInput {
  return { id: 'hz-1', hazardType: 'accident', distanceMeters: 400, confidence: 0.8, source: 'community', ...overrides };
}

function policy(overrides: Partial<RoadHazardSeverityByHazard> = {}): RoadHazardRiskPolicyInput {
  return { severityByHazard: severityMap(overrides) };
}

function input(
  hazardOverrides: Partial<RoadHazardInput> = {},
  severityOverrides: Partial<RoadHazardSeverityByHazard> = {},
): RoadHazardRiskInput {
  return {
    hazard: hazard(hazardOverrides),
    policy: policy(severityOverrides),
  };
}

const KNOWN_TYPES: readonly RoadHazardType[] = [
  'accident', 'roadwork', 'obstacle', 'lane_closed', 'animal', 'flood', 'rockfall',
];

/* ── Kategorik severity (DI haritasından) ─────────────────────────────────── */

describe('evaluateRoadHazardRisk — kategorik severity (DI haritasından)', () => {
  it.each([
    ['accident',    'HIGH'],
    ['roadwork',    'MEDIUM'],
    ['obstacle',    'HIGH'],
    ['lane_closed', 'MEDIUM'],
    ['animal',      'MEDIUM'],
    ['flood',       'CRITICAL'],
    ['rockfall',    'CRITICAL'],
  ] as const)('%s → %s event', (hazardType, expected) => {
    const result = evaluateRoadHazardRisk(input({ hazardType }));
    expect(result.riskEvents).toHaveLength(1);
    expect(result.riskEvents[0].severity).toBe(expected);
    expect(result.riskEvents[0].type).toBe('ROAD_HAZARD');
  });

  it('gömülü severity haritası YOK — aynı hazard, FARKLI DI haritası → FARKLI severity', () => {
    const withDefault = evaluateRoadHazardRisk(input({ hazardType: 'roadwork' }, {}));
    const withCustom = evaluateRoadHazardRisk(input({ hazardType: 'roadwork' }, { roadwork: 'CRITICAL' }));
    expect(withDefault.riskEvents[0].severity).toBe('MEDIUM');
    expect(withCustom.riskEvents[0].severity).toBe('CRITICAL');
  });

  it('NONE eşlemesi → event yok', () => {
    const result = evaluateRoadHazardRisk(input({ hazardType: 'roadwork' }, { roadwork: 'NONE' }));
    expect(result).toEqual({ ruleId: ROAD_HAZARD_RULE_ID, riskEvents: [] });
  });
});

/* ── unknown / undefined → event yok (asla tahmin) ─────────────────────────── */

describe('evaluateRoadHazardRisk — unknown/undefined → event yok', () => {
  it('hazardType="unknown" → event yok', () => {
    const result = evaluateRoadHazardRisk(input({ hazardType: 'unknown' }));
    expect(result.riskEvents).toEqual([]);
  });

  it('hazardType undefined → event yok', () => {
    const result = evaluateRoadHazardRisk(input({ hazardType: undefined }));
    expect(result.riskEvents).toEqual([]);
  });

  it('unknown için severityByHazard eşlemesi OLMASA bile throw ATMAZ (aranmaz)', () => {
    const i: RoadHazardRiskInput = {
      hazard: hazard({ hazardType: 'unknown' }),
      policy: { severityByHazard: { accident: 'HIGH' } }, // unknown yok
    };
    expect(() => evaluateRoadHazardRisk(i)).not.toThrow();
    expect(evaluateRoadHazardRisk(i).riskEvents).toEqual([]);
  });
});

/* ── confidence eşiği (fail-closed, throw DEĞİL) ───────────────────────────── */

describe('evaluateRoadHazardRisk — confidence eşiği', () => {
  it('confidence eşik ALTINDA (0.29 < 0.3) → event yok', () => {
    const result = evaluateRoadHazardRisk(input({ confidence: 0.29 }));
    expect(result.riskEvents).toEqual([]);
  });

  it('confidence TAM eşikte (0.3) → event ÜRETİLİR', () => {
    const result = evaluateRoadHazardRisk(input({ confidence: 0.3 }));
    expect(result.riskEvents).toHaveLength(1);
  });
});

/* ── Validation → THROW (sözleşme/programlama hatası) ──────────────────────── */

describe('evaluateRoadHazardRisk — validation throw', () => {
  it('hazard eksik (undefined) → THROW', () => {
    expect(() => evaluateRoadHazardRisk({ hazard: undefined as unknown as RoadHazardInput, policy: policy() })).toThrow();
  });

  it('hazard.id boş → THROW', () => {
    expect(() => evaluateRoadHazardRisk(input({ id: '' }))).toThrow();
  });

  it('distanceMeters NaN → THROW', () => {
    expect(() => evaluateRoadHazardRisk(input({ distanceMeters: NaN }))).toThrow();
  });

  it('distanceMeters Infinity → THROW', () => {
    expect(() => evaluateRoadHazardRisk(input({ distanceMeters: Infinity }))).toThrow();
  });

  it('distanceMeters negatif → THROW', () => {
    expect(() => evaluateRoadHazardRisk(input({ distanceMeters: -1 }))).toThrow();
  });

  it('distanceMeters=0 GEÇERLİ (throw ETMEZ)', () => {
    expect(() => evaluateRoadHazardRisk(input({ distanceMeters: 0 }))).not.toThrow();
    expect(evaluateRoadHazardRisk(input({ distanceMeters: 0 })).riskEvents[0].distanceMeters).toBe(0);
  });

  it('confidence NaN → THROW', () => {
    expect(() => evaluateRoadHazardRisk(input({ confidence: NaN }))).toThrow();
  });

  it('confidence Infinity → THROW', () => {
    expect(() => evaluateRoadHazardRisk(input({ confidence: Infinity }))).toThrow();
  });

  it('policy tamamen eksik → THROW', () => {
    expect(() => evaluateRoadHazardRisk({ hazard: hazard() } as unknown as RoadHazardRiskInput)).toThrow();
  });

  it('policy.severityByHazard eksik → THROW', () => {
    expect(() => evaluateRoadHazardRisk({ hazard: hazard(), policy: { severityByHazard: undefined as unknown as RoadHazardSeverityByHazard } })).toThrow();
  });

  it('KNOWN hazard (flood) için severityByHazard eşlemesi YOKSA → THROW (kritik uyarı sessizce düşmesin)', () => {
    const i: RoadHazardRiskInput = {
      hazard: hazard({ hazardType: 'flood' }),
      policy: { severityByHazard: { accident: 'HIGH', roadwork: 'MEDIUM' } }, // flood UNUTULDU
    };
    expect(() => evaluateRoadHazardRisk(i)).toThrow();
  });

  it('severityByHazard içinde GEÇERSİZ bir değer varsa → THROW', () => {
    const i: RoadHazardRiskInput = {
      hazard: hazard({ hazardType: 'accident' }),
      policy: { severityByHazard: { accident: 'GEÇERSİZ' as never } },
    };
    expect(() => evaluateRoadHazardRisk(i)).toThrow();
  });
});

/* ── Event id / tip / kaynak / mesafe ──────────────────────────────────────── */

describe('evaluateRoadHazardRisk — deterministik event id / tip / kaynak / mesafe', () => {
  it('id = `road-hazard:${hazard.id}`', () => {
    const result = evaluateRoadHazardRisk(input({ id: 'acc-42' }));
    expect(result.riskEvents[0].id).toBe('road-hazard:acc-42');
  });

  it('type=ROAD_HAZARD, ruleId=road-hazard', () => {
    const result = evaluateRoadHazardRisk(input());
    expect(result.ruleId).toBe('road-hazard');
    expect(result.riskEvents[0].type).toBe('ROAD_HAZARD');
  });

  it('title sabit "Yol tehlikesi bildirildi"', () => {
    const result = evaluateRoadHazardRisk(input());
    expect(result.riskEvents[0].title).toBe('Yol tehlikesi bildirildi');
  });

  it('recommendedAction sabit "Dikkatli ilerle ve yol koşullarını takip et."', () => {
    const result = evaluateRoadHazardRisk(input());
    expect(result.riskEvents[0].recommendedAction).toBe('Dikkatli ilerle ve yol koşullarını takip et.');
  });

  it('distanceMeters DI değerinden geçer (uydurulmaz)', () => {
    const result = evaluateRoadHazardRisk(input({ distanceMeters: 1234 }));
    expect(result.riskEvents[0].distanceMeters).toBe(1234);
  });

  it('source: hazard.source verilirse taşınır', () => {
    const result = evaluateRoadHazardRisk(input({ source: 'my-sensor' }));
    expect(result.riskEvents[0].source).toBe('my-sensor');
  });

  it('source verilmezse varsayılan kaynak kullanılır', () => {
    const result = evaluateRoadHazardRisk(input({ source: undefined }));
    expect(typeof result.riskEvents[0].source).toBe('string');
    expect(result.riskEvents[0].source).toBeTruthy();
  });
});

/* ── Güvenlik dili — yasaklı ifadeler ──────────────────────────────────────── */

describe('evaluateRoadHazardRisk — yasaklı ifade HİÇBİR event\'te YOK', () => {
  it.each(KNOWN_TYPES)('%s hazard tipinde yasaklı ifade yok', (hazardType) => {
    const result = evaluateRoadHazardRisk(input({ hazardType }));
    const all = `${result.riskEvents[0].title} ${result.riskEvents[0].message} ${result.riskEvents[0].recommendedAction}`;
    expect(all).not.toContain('Ani fren yap');
    expect(all).not.toContain('Kesin kaza var');
    expect(all).not.toContain('Yol tamamen kapalı');
  });

  it('mesajlar hazard tipine uygun İHTİYATLI içerik taşır (birbirinden farklı)', () => {
    const messages = KNOWN_TYPES.map((t) => evaluateRoadHazardRisk(input({ hazardType: t })).riskEvents[0].message);
    expect(new Set(messages).size).toBe(messages.length); // hepsi farklı
    messages.forEach((m) => expect(m).toBeTruthy());
  });
});

/* ── confidence sınırı ─────────────────────────────────────────────────────── */

describe('evaluateRoadHazardRisk — confidence sınırı (event conf <= hazard conf)', () => {
  it('event.confidence == hazard.confidence (üst sınır)', () => {
    const result = evaluateRoadHazardRisk(input({ confidence: 0.65 }));
    expect(result.riskEvents[0].confidence).toBeLessThanOrEqual(0.65);
    expect(result.riskEvents[0].confidence).toBe(0.65);
  });
});

/* ── Immutable girdi ───────────────────────────────────────────────────────── */

describe('evaluateRoadHazardRisk — immutable girdi', () => {
  it('hazard/policy mutasyona uğratılmaz (snapshot)', () => {
    const i = input();
    const snapshot = JSON.parse(JSON.stringify(i));
    evaluateRoadHazardRisk(i);
    expect(i).toEqual(snapshot);
  });

  it('donmuş (Object.freeze) girdiyle de çalışır', () => {
    const i = {
      hazard: Object.freeze(hazard()),
      policy: Object.freeze({ severityByHazard: Object.freeze(severityMap()) }),
    };
    Object.freeze(i);
    expect(() => evaluateRoadHazardRisk(i)).not.toThrow();
  });
});

/* ── Deterministik çıktı ───────────────────────────────────────────────────── */

describe('evaluateRoadHazardRisk — deterministik çıktı', () => {
  it('aynı girdi tekrar tekrar çağrılınca AYNI sonucu verir', () => {
    const i = input({ hazardType: 'rockfall' });
    const a = evaluateRoadHazardRisk(i);
    const b = evaluateRoadHazardRisk(i);
    expect(a).toEqual(b);
  });
});

/* ── GuardianEngine entegrasyonu ───────────────────────────────────────────── */

describe('GuardianEngine entegrasyonu', () => {
  it('evaluateRoadHazardRisk sonucu runGuardian\'a verilince ROAD_HAZARD event görünür + skor artar', () => {
    const empty = runGuardian({ ruleResults: [] });
    const ruleResult = evaluateRoadHazardRisk(input({ hazardType: 'flood' })); // CRITICAL
    const output = runGuardian({ ruleResults: [ruleResult] });
    expect(output.riskEvents).toHaveLength(1);
    expect(output.riskEvents[0].type).toBe('ROAD_HAZARD');
    expect(output.highestSeverity).toBe('CRITICAL');
    expect(output.overallRiskScore).toBeGreaterThan(empty.overallRiskScore);
  });

  it('event-yok RuleResult runGuardian\'a verilince hiçbir olay eklemez', () => {
    const ruleResult = evaluateRoadHazardRisk(input({ hazardType: 'unknown' }));
    const output = runGuardian({ ruleResults: [ruleResult] });
    expect(output.riskEvents).toEqual([]);
    expect(output.overallRiskScore).toBe(0);
  });

  it('CURVE + SPEED + DOWNHILL + WEATHER + VEHICLE_HEALTH + ROAD_HAZARD altısı birlikte birleşir (6 farklı id → altısı da kalır)', () => {
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
    const weatherResult = evaluateWeatherRisk({
      condition: { surfaceCondition: 'wet', source: 'osm', confidence: 0.8 },
      policy: { severityByCondition: { dry: 'NONE', wet: 'LOW', snow: 'HIGH', ice: 'CRITICAL' } }, // LOW
    });
    const vehicleHealthResult = evaluateVehicleHealthRisk({
      signals: { batteryVoltage: 11.5 }, // LOW
      policy: {
        thresholds: {
          coolant: { high: 100, critical: 115 },
          oilPressure: { low: 100, critical: 50 },
          batteryVoltage: { low: 12, critical: 11 },
        },
        booleanSeverities: { brakeWarning: 'HIGH', engineWarningLamp: 'LOW', transmissionWarning: 'HIGH' },
      },
    });
    const roadHazardResult = evaluateRoadHazardRisk(input({ hazardType: 'accident' })); // HIGH

    const output = runGuardian({
      ruleResults: [curveResult, speedLimitResult, downhillResult, weatherResult, vehicleHealthResult, roadHazardResult],
    });
    expect(output.riskEvents).toHaveLength(6);
    expect(output.riskEvents.map((e) => e.type).sort()).toEqual(
      ['CURVE_RISK', 'DOWNHILL_RISK', 'ROAD_HAZARD', 'SPEED_LIMIT_RISK', 'VEHICLE_HEALTH_RISK', 'WEATHER_RISK'],
    );
    expect(output.highestSeverity).toBe('CRITICAL');
    // severity DESC: CRITICAL (curve) en başta
    expect(output.riskEvents[0].type).toBe('CURVE_RISK');
    expect(output.riskEvents[0].severity).toBe('CRITICAL');
  });

  it('aynı id iki sonuçtan gelirse dedup en yüksek severity\'yi tutar', () => {
    const low = evaluateRoadHazardRisk(input({ id: 'dup', hazardType: 'roadwork' }, { roadwork: 'LOW' }));
    const critical = evaluateRoadHazardRisk(input({ id: 'dup', hazardType: 'roadwork' }, { roadwork: 'CRITICAL' }));
    const output = runGuardian({ ruleResults: [low, critical] });
    expect(output.riskEvents).toHaveLength(1); // aynı id → dedup
    expect(output.riskEvents[0].severity).toBe('CRITICAL');
  });
});

/* ── Regresyon: G2–G6 bozulmadı ────────────────────────────────────────────── */

describe('Curve/SpeedLimit/RoadProfile/Weather/VehicleHealth regresyonu (G2–G6 bozulmadı)', () => {
  it('evaluateCurveRisk hâlâ aynı formülle çalışır', () => {
    const result = evaluateCurveRisk({
      curve: { id: 'c1', distanceMeters: 100, direction: 'left', advisorySpeedKph: 100, confidence: 0.8 },
      vehicle: { currentSpeedKph: 105 },
      policy: { warningLeadTimeSeconds: 8, minimumWarningDistanceMeters: 50, overspeedToleranceKph: 2 },
    });
    expect(result.riskEvents[0].severity).toBe('LOW');
  });

  it('evaluateWeatherRisk hâlâ aynı formülle çalışır', () => {
    const result = evaluateWeatherRisk({
      condition: { surfaceCondition: 'ice', source: 'osm', confidence: 0.8 },
      policy: { severityByCondition: { dry: 'NONE', wet: 'LOW', snow: 'HIGH', ice: 'CRITICAL' } },
    });
    expect(result.riskEvents[0].severity).toBe('CRITICAL');
  });

  it('evaluateVehicleHealthRisk hâlâ aynı formülle çalışır', () => {
    const result = evaluateVehicleHealthRisk({
      signals: { coolantTemperatureC: 120 },
      policy: {
        thresholds: {
          coolant: { high: 100, critical: 115 },
          oilPressure: { low: 100, critical: 50 },
          batteryVoltage: { low: 12, critical: 11 },
        },
        booleanSeverities: { brakeWarning: 'HIGH', engineWarningLamp: 'LOW', transmissionWarning: 'HIGH' },
      },
    });
    expect(result.riskEvents[0].severity).toBe('CRITICAL'); // 120 >= critical 115
  });
});
