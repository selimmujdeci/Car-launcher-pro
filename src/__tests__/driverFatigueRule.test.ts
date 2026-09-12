/**
 * driverFatigueRule.test.ts — GUARDIAN-AI-G8.
 *
 * `evaluateDriverFatigueRisk` — yedinci Guardian analiz kuralı. VehicleHealthRule
 * gibi ÇOKLU-SİNYAL → ÇOKLU-EVENT (0..7 event, tek RuleResult, sabit sıra).
 * Kamera/göz-takibi/yüz-tanıma/GPS/OBD/sistem-saati OKUMA YOK — tüm sinyaller DI.
 * Kesin teşhis YOK. Kapsam: continuous-driving/break-overdue/long-trip severity
 * bantları · trip-duration CRITICAL üretmez · gece-yarısını-aşan + normal night
 * penceresi (startHour dahil, endHour hariç) · boolean sinyaller · confidence gate
 * (yalnız ikisi de varsa) · fail-closed event-yok · validation throw · immutable ·
 * deterministic · yasaklı kesin dil · distanceMeters=0 · GuardianEngine (7 kural
 * birlikte) · dedup · G1-G7 regresyonu.
 */
import { describe, it, expect } from 'vitest';
import { evaluateDriverFatigueRisk, DRIVER_FATIGUE_RULE_ID } from '../platform/navigation/guardian/rules/driverFatigueRule';
import type {
  DriverFatigueRiskInput,
  DriverFatigueSignalsInput,
  DriverFatiguePolicyInput,
} from '../platform/navigation/guardian/rules/driverFatigueRule';
import { evaluateCurveRisk } from '../platform/navigation/guardian/rules/curveRiskRule';
import { evaluateSpeedLimitRisk } from '../platform/navigation/guardian/rules/speedLimitRule';
import { evaluateRoadProfileRisk } from '../platform/navigation/guardian/rules/roadProfileRule';
import { evaluateWeatherRisk } from '../platform/navigation/guardian/rules/weatherRiskRule';
import { evaluateVehicleHealthRisk } from '../platform/navigation/guardian/rules/vehicleHealthRule';
import { evaluateRoadHazardRisk } from '../platform/navigation/guardian/rules/roadHazardRule';
import { runGuardian } from '../platform/navigation/guardian/guardianEngine';

/* ── Fixture yardımcıları ─────────────────────────────────────────────────── */

function basePolicy(): DriverFatiguePolicyInput {
  return {
    thresholds: {
      continuousDriving: { elevatedMinutes: 90, highMinutes: 120, criticalMinutes: 180 },
      breakAge:          { elevatedMinutes: 120, highMinutes: 180, criticalMinutes: 240 },
      tripDuration:      { elevatedMinutes: 180, highMinutes: 300, criticalMinutes: 420 },
    },
    nightDriving:      { startHour: 22, endHour: 6, severity: 'MEDIUM' },
    booleanSeverities: {
      lowAttentionSignal:           'MEDIUM',
      repeatedLaneCorrectionSignal: 'HIGH',
      microsleepSuspectedSignal:    'CRITICAL',
    },
    minimumConfidence: 0.3,
  };
}

function policyWith(patch: (p: DriverFatiguePolicyInput) => void): DriverFatiguePolicyInput {
  const p = basePolicy();
  patch(p);
  return p;
}

function input(
  signals: Partial<DriverFatigueSignalsInput> = {},
  policy: DriverFatiguePolicyInput = basePolicy(),
): DriverFatigueRiskInput {
  return { signals: { confidence: 0.8, ...signals }, policy };
}

function firstOf(i: DriverFatigueRiskInput) {
  const result = evaluateDriverFatigueRisk(i);
  expect(result.riskEvents).toHaveLength(1);
  return result.riskEvents[0];
}

/* ── continuous-driving severity bantları ─────────────────────────────────── */

describe('evaluateDriverFatigueRisk — continuousDrivingMinutes', () => {
  it('>= elevated (90) → MEDIUM', () => {
    expect(firstOf(input({ continuousDrivingMinutes: 90 })).severity).toBe('MEDIUM');
  });
  it('>= high (120) → HIGH', () => {
    expect(firstOf(input({ continuousDrivingMinutes: 120 })).severity).toBe('HIGH');
  });
  it('>= critical (180) → CRITICAL', () => {
    expect(firstOf(input({ continuousDrivingMinutes: 180 })).severity).toBe('CRITICAL');
  });
  it('eşik altı (89) → event yok', () => {
    expect(evaluateDriverFatigueRisk(input({ continuousDrivingMinutes: 89 })).riskEvents).toEqual([]);
  });
  it('event id = driver-fatigue:continuous-driving', () => {
    expect(firstOf(input({ continuousDrivingMinutes: 120 })).id).toBe('driver-fatigue:continuous-driving');
  });
});

/* ── break-overdue severity bantları ──────────────────────────────────────── */

describe('evaluateDriverFatigueRisk — minutesSinceLastMeaningfulBreak', () => {
  it('>= elevated (120) → MEDIUM', () => {
    expect(firstOf(input({ minutesSinceLastMeaningfulBreak: 120 })).severity).toBe('MEDIUM');
  });
  it('>= high (180) → HIGH', () => {
    expect(firstOf(input({ minutesSinceLastMeaningfulBreak: 180 })).severity).toBe('HIGH');
  });
  it('>= critical (240) → CRITICAL', () => {
    expect(firstOf(input({ minutesSinceLastMeaningfulBreak: 240 })).severity).toBe('CRITICAL');
  });
  it('eşik altı → event yok', () => {
    expect(evaluateDriverFatigueRisk(input({ minutesSinceLastMeaningfulBreak: 119 })).riskEvents).toEqual([]);
  });
  it('event id = driver-fatigue:break-overdue', () => {
    expect(firstOf(input({ minutesSinceLastMeaningfulBreak: 180 })).id).toBe('driver-fatigue:break-overdue');
  });
});

/* ── long-trip severity bantları (CRITICAL ÜRETMEZ) ───────────────────────── */

describe('evaluateDriverFatigueRisk — tripDurationMinutes', () => {
  it('>= elevated (180) → LOW', () => {
    expect(firstOf(input({ tripDurationMinutes: 180 })).severity).toBe('LOW');
  });
  it('>= high (300) → MEDIUM', () => {
    expect(firstOf(input({ tripDurationMinutes: 300 })).severity).toBe('MEDIUM');
  });
  it('>= critical (420) → HIGH (CRITICAL DEĞİL)', () => {
    expect(firstOf(input({ tripDurationMinutes: 420 })).severity).toBe('HIGH');
  });
  it('çok yüksek trip süresi bile CRITICAL üretmez', () => {
    expect(firstOf(input({ tripDurationMinutes: 100000 })).severity).toBe('HIGH');
  });
  it('eşik altı → event yok', () => {
    expect(evaluateDriverFatigueRisk(input({ tripDurationMinutes: 179 })).riskEvents).toEqual([]);
  });
  it('event id = driver-fatigue:long-trip', () => {
    expect(firstOf(input({ tripDurationMinutes: 300 })).id).toBe('driver-fatigue:long-trip');
  });
});

/* ── Gece sürüşü penceresi ─────────────────────────────────────────────────── */

describe('evaluateDriverFatigueRisk — night driving window', () => {
  it('normal gündüz (12) → night event yok', () => {
    expect(evaluateDriverFatigueRisk(input({ localHour: 12 })).riskEvents).toEqual([]);
  });

  it('gece-yarısını aşan pencere (22→6): 22,23,0,1,2,3,4,5 aktif', () => {
    [22, 23, 0, 1, 2, 3, 4, 5].forEach((h) => {
      const ev = firstOf(input({ localHour: h }));
      expect(ev.id).toBe('driver-fatigue:night-driving');
      expect(ev.severity).toBe('MEDIUM');
    });
  });

  it('gece-yarısını aşan pencere: endHour (6) HARİÇ → event yok', () => {
    expect(evaluateDriverFatigueRisk(input({ localHour: 6 })).riskEvents).toEqual([]);
  });

  it('gece-yarısını aşan pencere: startHour (22) DAHİL → event var', () => {
    expect(firstOf(input({ localHour: 22 })).id).toBe('driver-fatigue:night-driving');
  });

  it('gece-yarısını aşan pencere: 21 (start öncesi) → event yok', () => {
    expect(evaluateDriverFatigueRisk(input({ localHour: 21 })).riskEvents).toEqual([]);
  });

  it('normal pencere (1→5): 1,2,3,4 aktif, 5 hariç, 0 pasif', () => {
    const p = policyWith((x) => { x.nightDriving = { startHour: 1, endHour: 5, severity: 'HIGH' }; });
    [1, 2, 3, 4].forEach((h) => {
      expect(firstOf(input({ localHour: h }, p)).severity).toBe('HIGH');
    });
    expect(evaluateDriverFatigueRisk(input({ localHour: 5 }, p)).riskEvents).toEqual([]); // endHour hariç
    expect(evaluateDriverFatigueRisk(input({ localHour: 0 }, p)).riskEvents).toEqual([]);
  });

  it('night severity DI policy\'den gelir', () => {
    const p = policyWith((x) => { x.nightDriving.severity = 'LOW'; });
    expect(firstOf(input({ localHour: 23 }, p)).severity).toBe('LOW');
  });
});

/* ── Boolean sinyaller ─────────────────────────────────────────────────────── */

describe('evaluateDriverFatigueRisk — boolean sinyaller', () => {
  it('lowAttentionSignal true → policy severity (MEDIUM), id low-attention', () => {
    const ev = firstOf(input({ lowAttentionSignal: true }));
    expect(ev.id).toBe('driver-fatigue:low-attention');
    expect(ev.severity).toBe('MEDIUM');
  });
  it('repeatedLaneCorrectionSignal true → HIGH, id lane-correction', () => {
    const ev = firstOf(input({ repeatedLaneCorrectionSignal: true }));
    expect(ev.id).toBe('driver-fatigue:lane-correction');
    expect(ev.severity).toBe('HIGH');
  });
  it('microsleepSuspectedSignal true → CRITICAL, id microsleep-suspected', () => {
    const ev = firstOf(input({ microsleepSuspectedSignal: true }));
    expect(ev.id).toBe('driver-fatigue:microsleep-suspected');
    expect(ev.severity).toBe('CRITICAL');
  });
  it('boolean false → event yok', () => {
    expect(evaluateDriverFatigueRisk(input({
      lowAttentionSignal: false, repeatedLaneCorrectionSignal: false, microsleepSuspectedSignal: false,
    })).riskEvents).toEqual([]);
  });
});

/* ── Fail-closed ───────────────────────────────────────────────────────────── */

describe('evaluateDriverFatigueRisk — fail-closed (event-yok)', () => {
  it('hiç sinyal yok (hepsi undefined) → boş sonuç', () => {
    const result = evaluateDriverFatigueRisk(input({}));
    expect(result).toEqual({ ruleId: DRIVER_FATIGUE_RULE_ID, riskEvents: [] });
  });
});

/* ── Confidence gate ───────────────────────────────────────────────────────── */

describe('evaluateDriverFatigueRisk — confidence gate (yalnız ikisi de varsa)', () => {
  it('confidence (0.29) < minimumConfidence (0.3) → tüm sonuç boş', () => {
    const result = evaluateDriverFatigueRisk(input({ continuousDrivingMinutes: 180, confidence: 0.29 }));
    expect(result.riskEvents).toEqual([]);
  });
  it('confidence == minimumConfidence (0.3) → değerlendirilir', () => {
    expect(evaluateDriverFatigueRisk(input({ continuousDrivingMinutes: 180, confidence: 0.3 })).riskEvents).toHaveLength(1);
  });
  it('minimumConfidence yoksa gate uygulanmaz (düşük confidence bile geçer)', () => {
    const p = policyWith((x) => { delete x.minimumConfidence; });
    expect(evaluateDriverFatigueRisk(input({ continuousDrivingMinutes: 180, confidence: 0.01 }, p)).riskEvents).toHaveLength(1);
  });
  it('confidence yoksa gate uygulanmaz', () => {
    const result = evaluateDriverFatigueRisk(input({ continuousDrivingMinutes: 180, confidence: undefined }));
    expect(result.riskEvents).toHaveLength(1);
  });
  it('event.confidence DI signals.confidence değerini taşır', () => {
    expect(firstOf(input({ continuousDrivingMinutes: 180, confidence: 0.66 })).confidence).toBe(0.66);
  });
});

/* ── Çoklu event + sabit sıra ──────────────────────────────────────────────── */

describe('evaluateDriverFatigueRisk — çoklu event + sabit deterministik sıra', () => {
  it('7 gösterge aktif → 7 event, SABİT sırada', () => {
    const result = evaluateDriverFatigueRisk(input({
      continuousDrivingMinutes: 180,           // CRITICAL
      minutesSinceLastMeaningfulBreak: 240,    // CRITICAL
      tripDurationMinutes: 420,                // HIGH
      localHour: 23,                           // night MEDIUM
      lowAttentionSignal: true,                // MEDIUM
      repeatedLaneCorrectionSignal: true,      // HIGH
      microsleepSuspectedSignal: true,         // CRITICAL
    }));
    expect(result.riskEvents.map((e) => e.id)).toEqual([
      'driver-fatigue:continuous-driving',
      'driver-fatigue:break-overdue',
      'driver-fatigue:long-trip',
      'driver-fatigue:night-driving',
      'driver-fatigue:low-attention',
      'driver-fatigue:lane-correction',
      'driver-fatigue:microsleep-suspected',
    ]);
  });

  it('alt küme aktif → yalnız aktif olanlar, yine sabit sırada', () => {
    const result = evaluateDriverFatigueRisk(input({
      microsleepSuspectedSignal: true,
      continuousDrivingMinutes: 120,
      tripDurationMinutes: 300,
    }));
    expect(result.riskEvents.map((e) => e.id)).toEqual([
      'driver-fatigue:continuous-driving',
      'driver-fatigue:long-trip',
      'driver-fatigue:microsleep-suspected',
    ]);
  });
});

/* ── Validation → THROW ────────────────────────────────────────────────────── */

describe('evaluateDriverFatigueRisk — validation throw', () => {
  it('input eksik → THROW', () => {
    expect(() => evaluateDriverFatigueRisk(undefined as unknown as DriverFatigueRiskInput)).toThrow();
  });
  it('signals eksik → THROW', () => {
    expect(() => evaluateDriverFatigueRisk({ policy: basePolicy() } as unknown as DriverFatigueRiskInput)).toThrow();
  });
  it('policy eksik → THROW', () => {
    expect(() => evaluateDriverFatigueRisk({ signals: {} } as unknown as DriverFatigueRiskInput)).toThrow();
  });
  it('thresholds eksik → THROW', () => {
    const p = { ...basePolicy(), thresholds: undefined as unknown as DriverFatiguePolicyInput['thresholds'] };
    expect(() => evaluateDriverFatigueRisk({ signals: {}, policy: p })).toThrow();
  });
  it('booleanSeverities eksik → THROW', () => {
    const p = { ...basePolicy(), booleanSeverities: undefined as unknown as DriverFatiguePolicyInput['booleanSeverities'] };
    expect(() => evaluateDriverFatigueRisk({ signals: {}, policy: p })).toThrow();
  });
  it('nightDriving eksik → THROW', () => {
    const p = { ...basePolicy(), nightDriving: undefined as unknown as DriverFatiguePolicyInput['nightDriving'] };
    expect(() => evaluateDriverFatigueRisk({ signals: {}, policy: p })).toThrow();
  });

  it('continuousDriving threshold sırası bozuk (elevated==high) → THROW', () => {
    const p = policyWith((x) => { x.thresholds.continuousDriving = { elevatedMinutes: 100, highMinutes: 100, criticalMinutes: 180 }; });
    expect(() => evaluateDriverFatigueRisk(input({}, p))).toThrow();
  });
  it('breakAge threshold sırası bozuk (high>critical) → THROW', () => {
    const p = policyWith((x) => { x.thresholds.breakAge = { elevatedMinutes: 120, highMinutes: 250, criticalMinutes: 240 }; });
    expect(() => evaluateDriverFatigueRisk(input({}, p))).toThrow();
  });
  it('tripDuration threshold sırası bozuk → THROW', () => {
    const p = policyWith((x) => { x.thresholds.tripDuration = { elevatedMinutes: 400, highMinutes: 300, criticalMinutes: 420 }; });
    expect(() => evaluateDriverFatigueRisk(input({}, p))).toThrow();
  });
  it('negatif threshold → THROW', () => {
    const p = policyWith((x) => { x.thresholds.continuousDriving.elevatedMinutes = -1; });
    expect(() => evaluateDriverFatigueRisk(input({}, p))).toThrow();
  });

  it('negatif süre sinyali → THROW', () => {
    expect(() => evaluateDriverFatigueRisk(input({ continuousDrivingMinutes: -5 }))).toThrow();
  });
  it('NaN süre → THROW', () => {
    expect(() => evaluateDriverFatigueRisk(input({ tripDurationMinutes: NaN }))).toThrow();
  });
  it('Infinity süre → THROW', () => {
    expect(() => evaluateDriverFatigueRisk(input({ minutesSinceLastMeaningfulBreak: Infinity }))).toThrow();
  });

  it('localHour aralık dışı (24) → THROW', () => {
    expect(() => evaluateDriverFatigueRisk(input({ localHour: 24 }))).toThrow();
  });
  it('localHour negatif (-1) → THROW', () => {
    expect(() => evaluateDriverFatigueRisk(input({ localHour: -1 }))).toThrow();
  });
  it('localHour fractional (12.5) → THROW', () => {
    expect(() => evaluateDriverFatigueRisk(input({ localHour: 12.5 }))).toThrow();
  });

  it('night startHour aralık dışı → THROW', () => {
    const p = policyWith((x) => { x.nightDriving.startHour = 25; });
    expect(() => evaluateDriverFatigueRisk(input({}, p))).toThrow();
  });
  it('night endHour fractional → THROW', () => {
    const p = policyWith((x) => { x.nightDriving.endHour = 6.5; });
    expect(() => evaluateDriverFatigueRisk(input({}, p))).toThrow();
  });
  it('night startHour === endHour → THROW', () => {
    const p = policyWith((x) => { x.nightDriving = { startHour: 3, endHour: 3, severity: 'MEDIUM' }; });
    expect(() => evaluateDriverFatigueRisk(input({}, p))).toThrow();
  });

  it('geçersiz severity token (night) → THROW', () => {
    const p = policyWith((x) => { x.nightDriving.severity = 'GEÇERSİZ' as never; });
    expect(() => evaluateDriverFatigueRisk(input({}, p))).toThrow();
  });
  it('geçersiz severity token (boolean) → THROW', () => {
    const p = policyWith((x) => { x.booleanSeverities.microsleepSuspectedSignal = 'NONE' as never; });
    expect(() => evaluateDriverFatigueRisk(input({}, p))).toThrow();
  });

  it('minimumConfidence aralık dışı (1.5) → THROW', () => {
    const p = policyWith((x) => { x.minimumConfidence = 1.5; });
    expect(() => evaluateDriverFatigueRisk(input({}, p))).toThrow();
  });
  it('signals.confidence aralık dışı (-0.1) → THROW', () => {
    expect(() => evaluateDriverFatigueRisk(input({ confidence: -0.1 }))).toThrow();
  });
  it('signals.confidence NaN → THROW', () => {
    expect(() => evaluateDriverFatigueRisk(input({ confidence: NaN }))).toThrow();
  });
});

/* ── Yasaklı kesin dil ─────────────────────────────────────────────────────── */

describe('evaluateDriverFatigueRisk — yasaklı kesin dil HİÇBİR event\'te YOK', () => {
  const FORBIDDEN = [
    'Uyuyorsun', 'Kesin yorgunsun', 'Hemen dur', 'Kaza yapacaksın',
    'Gözlerin kapanıyor', 'Aracı derhal kenara çek', 'Mikro uyku geçiriyorsun',
  ];
  it('7 event birlikte üretilse bile yasaklı ifade yok', () => {
    const result = evaluateDriverFatigueRisk(input({
      continuousDrivingMinutes: 180, minutesSinceLastMeaningfulBreak: 240, tripDurationMinutes: 420,
      localHour: 23, lowAttentionSignal: true, repeatedLaneCorrectionSignal: true, microsleepSuspectedSignal: true,
    }));
    const all = result.riskEvents.map((e) => `${e.title} ${e.message} ${e.recommendedAction}`).join(' ');
    FORBIDDEN.forEach((phrase) => expect(all).not.toContain(phrase));
  });
  it('mesajlar birbirinden farklı + ihtiyatlı', () => {
    const result = evaluateDriverFatigueRisk(input({
      continuousDrivingMinutes: 180, minutesSinceLastMeaningfulBreak: 240, tripDurationMinutes: 420,
      localHour: 23, lowAttentionSignal: true, repeatedLaneCorrectionSignal: true, microsleepSuspectedSignal: true,
    }));
    const messages = result.riskEvents.map((e) => e.message);
    expect(new Set(messages).size).toBe(messages.length);
  });
});

/* ── distanceMeters=0 ──────────────────────────────────────────────────────── */

describe('evaluateDriverFatigueRisk — distanceMeters=0 (anlık sürücü durumu)', () => {
  it('her event distanceMeters=0', () => {
    const result = evaluateDriverFatigueRisk(input({ continuousDrivingMinutes: 180, microsleepSuspectedSignal: true }));
    result.riskEvents.forEach((e) => expect(e.distanceMeters).toBe(0));
  });
});

/* ── Immutable + deterministic ─────────────────────────────────────────────── */

describe('evaluateDriverFatigueRisk — immutable / deterministic', () => {
  it('girdi mutasyona uğratılmaz (snapshot)', () => {
    const i = input({ continuousDrivingMinutes: 180, localHour: 23 });
    const snapshot = JSON.parse(JSON.stringify(i));
    evaluateDriverFatigueRisk(i);
    expect(i).toEqual(snapshot);
  });
  it('donmuş (Object.freeze) girdiyle de çalışır', () => {
    const p = basePolicy();
    Object.freeze(p); Object.freeze(p.thresholds); Object.freeze(p.thresholds.continuousDriving);
    Object.freeze(p.thresholds.breakAge); Object.freeze(p.thresholds.tripDuration);
    Object.freeze(p.nightDriving); Object.freeze(p.booleanSeverities);
    const i = { signals: Object.freeze({ continuousDrivingMinutes: 180, confidence: 0.8 }), policy: p };
    Object.freeze(i);
    expect(() => evaluateDriverFatigueRisk(i)).not.toThrow();
  });
  it('aynı girdi → aynı çıktı', () => {
    const i = input({ continuousDrivingMinutes: 180, localHour: 2, lowAttentionSignal: true });
    expect(evaluateDriverFatigueRisk(i)).toEqual(evaluateDriverFatigueRisk(i));
  });
});

/* ── GuardianEngine entegrasyonu ───────────────────────────────────────────── */

describe('GuardianEngine entegrasyonu', () => {
  it('DRIVER_FATIGUE_RISK runGuardian\'da görünür + type/ruleId doğru', () => {
    const rr = evaluateDriverFatigueRisk(input({ microsleepSuspectedSignal: true })); // CRITICAL
    const output = runGuardian({ ruleResults: [rr] });
    expect(output.riskEvents).toHaveLength(1);
    expect(output.riskEvents[0].type).toBe('DRIVER_FATIGUE_RISK');
    expect(output.highestSeverity).toBe('CRITICAL');
    expect(rr.ruleId).toBe('driver-fatigue');
  });

  it('7 kural birlikte (curve+speed+downhill+weather+vehicle+hazard+fatigue) — 7 farklı id korunur', () => {
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
        thresholds: {
          coolant: { high: 100, critical: 115 }, oilPressure: { low: 100, critical: 50 }, batteryVoltage: { low: 12, critical: 11 },
        },
        booleanSeverities: { brakeWarning: 'HIGH', engineWarningLamp: 'LOW', transmissionWarning: 'HIGH' },
      },
    });
    const roadHazardResult = evaluateRoadHazardRisk({
      hazard: { id: 'hz-1', hazardType: 'accident', distanceMeters: 400, confidence: 0.8, source: 'community' },
      policy: { severityByHazard: { accident: 'HIGH' } },
    });
    const fatigueResult = evaluateDriverFatigueRisk(input({ microsleepSuspectedSignal: true })); // CRITICAL

    const output = runGuardian({
      ruleResults: [curveResult, speedLimitResult, downhillResult, weatherResult, vehicleHealthResult, roadHazardResult, fatigueResult],
    });
    expect(output.riskEvents).toHaveLength(7);
    expect(output.riskEvents.map((e) => e.type).sort()).toEqual([
      'CURVE_RISK', 'DOWNHILL_RISK', 'DRIVER_FATIGUE_RISK', 'ROAD_HAZARD', 'SPEED_LIMIT_RISK', 'VEHICLE_HEALTH_RISK', 'WEATHER_RISK',
    ]);
    expect(output.highestSeverity).toBe('CRITICAL');
  });

  it('aynı driver-fatigue event id iki sonuçtan gelirse dedup en yüksek severity\'yi tutar', () => {
    const lowP = policyWith((x) => { x.booleanSeverities.microsleepSuspectedSignal = 'LOW'; });
    const critP = policyWith((x) => { x.booleanSeverities.microsleepSuspectedSignal = 'CRITICAL'; });
    const low = evaluateDriverFatigueRisk(input({ microsleepSuspectedSignal: true }, lowP));
    const crit = evaluateDriverFatigueRisk(input({ microsleepSuspectedSignal: true }, critP));
    const output = runGuardian({ ruleResults: [low, crit] });
    expect(output.riskEvents).toHaveLength(1);
    expect(output.riskEvents[0].severity).toBe('CRITICAL');
  });
});

/* ── Regresyon: G2–G7 bozulmadı ────────────────────────────────────────────── */

describe('G2–G7 regresyonu', () => {
  it('evaluateRoadHazardRisk hâlâ çalışır', () => {
    const r = evaluateRoadHazardRisk({
      hazard: { id: 'r1', hazardType: 'flood', distanceMeters: 200, confidence: 0.8 },
      policy: { severityByHazard: { flood: 'CRITICAL' } },
    });
    expect(r.riskEvents[0].severity).toBe('CRITICAL');
  });
  it('evaluateVehicleHealthRisk hâlâ çalışır', () => {
    const r = evaluateVehicleHealthRisk({
      signals: { coolantTemperatureC: 120 },
      policy: {
        thresholds: { coolant: { high: 100, critical: 115 }, oilPressure: { low: 100, critical: 50 }, batteryVoltage: { low: 12, critical: 11 } },
        booleanSeverities: { brakeWarning: 'HIGH', engineWarningLamp: 'LOW', transmissionWarning: 'HIGH' },
      },
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
