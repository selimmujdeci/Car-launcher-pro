/**
 * guardianAlertRanker.test.ts — GUARDIAN-AI-G13.
 *
 * `rankGuardianAlerts` — GuardianEngine (G1) çıktısını alıp hangi event'in
 * kullanıcıya SUNULACAĞINA (speak/display) karar veren SAF motor. Event ÜRETMEZ,
 * severity HESAPLAMAZ, GuardianEngine sonucunu (highestSeverity/overallRiskScore)
 * BOZMAZ — yalnız DI önceliğine göre süzer/sıralar. Kapsam: boş/tek/çok event ·
 * severity önceliği · eventType priority map (DI, magic YOK) · skor/severity
 * korunuyor · highestPriority · duplicate id tek kez · immutable · deterministic ·
 * validation throw · GuardianEngine entegrasyonu.
 */
import { describe, it, expect } from 'vitest';
import { rankGuardianAlerts } from '../platform/navigation/guardian/guardianAlertRanker';
import type {
  GuardianAlertRankInput,
  GuardianAlertRankPolicyInput,
} from '../platform/navigation/guardian/guardianAlertRanker';
import type { GuardianRiskEvent, GuardianOutput, GuardianSeverity } from '../platform/navigation/guardian/models';
import { runGuardian } from '../platform/navigation/guardian/guardianEngine';
import { evaluateCurveRisk } from '../platform/navigation/guardian/rules/curveRiskRule';
import { evaluateWeatherRisk } from '../platform/navigation/guardian/rules/weatherRiskRule';

/* ── Fixture yardımcıları ─────────────────────────────────────────────────── */

function ev(overrides: Partial<GuardianRiskEvent> = {}): GuardianRiskEvent {
  return {
    id: 'e1', type: 'CURVE_RISK', severity: 'HIGH', distanceMeters: 100,
    title: 't', message: 'm', recommendedAction: 'a', confidence: 0.8, source: 's',
    ...overrides,
  };
}

function out(events: GuardianRiskEvent[], highestSeverity: GuardianSeverity | null, score: number): GuardianOutput {
  return { riskEvents: events, highestSeverity, overallRiskScore: score };
}

function basePolicy(overrides: Partial<GuardianAlertRankPolicyInput> = {}): GuardianAlertRankPolicyInput {
  return {
    severityRank: { INFO: 0, LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 },
    eventTypePriority: {
      DRIVER_FATIGUE_RISK: 95, VEHICLE_HEALTH_RISK: 90, ROAD_HAZARD: 85, CURVE_RISK: 80,
      SPEED_LIMIT_RISK: 70, DOWNHILL_RISK: 60, WEATHER_RISK: 50, SPEED_CAMERA_WARNING: 40,
    },
    speakMinSeverity: 'HIGH',
    displayMinSeverity: 'LOW',
    ...overrides,
  };
}

function input(guardianOutput: GuardianOutput, policyOverrides: Partial<GuardianAlertRankPolicyInput> = {}): GuardianAlertRankInput {
  return { guardianOutput, policy: basePolicy(policyOverrides) };
}

/* ── Boş / tek / çok ───────────────────────────────────────────────────────── */

describe('rankGuardianAlerts — boş / tek / çok event', () => {
  it('boş guardianOutput → boş plan (fail-closed)', () => {
    const d = rankGuardianAlerts(input(out([], null, 0)));
    expect(d.speakEvents).toEqual([]);
    expect(d.displayEvents).toEqual([]);
    expect(d.highestPriority).toBeNull();
    expect(d.highestSeverity).toBeNull();
    expect(d.overallRiskScore).toBe(0);
  });

  it('tek HIGH event → hem speak hem display (speakMin=HIGH, displayMin=LOW)', () => {
    const d = rankGuardianAlerts(input(out([ev({ severity: 'HIGH' })], 'HIGH', 0.75)));
    expect(d.speakEvents).toHaveLength(1);
    expect(d.displayEvents).toHaveLength(1);
  });

  it('tek MEDIUM event → yalnız display (speak eşiği HIGH altında)', () => {
    const d = rankGuardianAlerts(input(out([ev({ severity: 'MEDIUM' })], 'MEDIUM', 0.5)));
    expect(d.speakEvents).toEqual([]);
    expect(d.displayEvents).toHaveLength(1);
  });

  it('LOW event displayMin=LOW eşiğinde → display\'e girer', () => {
    const d = rankGuardianAlerts(input(out([ev({ severity: 'LOW' })], 'LOW', 0.25)));
    expect(d.displayEvents).toHaveLength(1);
    expect(d.speakEvents).toEqual([]);
  });

  it('INFO event displayMin=LOW altında → hiçbir listeye girmez', () => {
    const d = rankGuardianAlerts(input(out([ev({ severity: 'INFO' })], 'INFO', 0)));
    expect(d.displayEvents).toEqual([]);
    expect(d.speakEvents).toEqual([]);
  });
});

/* ── Severity önceliği ─────────────────────────────────────────────────────── */

describe('rankGuardianAlerts — severity önceliği (DI severityRank DESC)', () => {
  it('CRITICAL > MEDIUM > LOW sırasıyla dizilir', () => {
    const events = [
      ev({ id: 'low', type: 'WEATHER_RISK', severity: 'LOW' }),
      ev({ id: 'crit', type: 'CURVE_RISK', severity: 'CRITICAL' }),
      ev({ id: 'med', type: 'DOWNHILL_RISK', severity: 'MEDIUM' }),
    ];
    const d = rankGuardianAlerts(input(out(events, 'CRITICAL', 0.9)));
    expect(d.displayEvents.map((e) => e.id)).toEqual(['crit', 'med', 'low']);
  });
});

/* ── eventType priority map (aynı severity) ────────────────────────────────── */

describe('rankGuardianAlerts — eventTypePriority (DI, aynı severity içinde)', () => {
  it('aynı HIGH severity: yüksek eventTypePriority önce', () => {
    const events = [
      ev({ id: 'cam', type: 'SPEED_CAMERA_WARNING', severity: 'HIGH' }),   // 40
      ev({ id: 'fatigue', type: 'DRIVER_FATIGUE_RISK', severity: 'HIGH' }), // 95
      ev({ id: 'curve', type: 'CURVE_RISK', severity: 'HIGH' }),           // 80
    ];
    const d = rankGuardianAlerts(input(out(events, 'HIGH', 0.8)));
    expect(d.displayEvents.map((e) => e.id)).toEqual(['fatigue', 'curve', 'cam']);
  });

  it('FARKLI DI priority map → FARKLI sıra (kod içine gömülü priority YOK)', () => {
    const events = [
      ev({ id: 'a', type: 'CURVE_RISK', severity: 'HIGH' }),
      ev({ id: 'b', type: 'WEATHER_RISK', severity: 'HIGH' }),
    ];
    const dDefault = rankGuardianAlerts(input(out(events, 'HIGH', 0.8)));
    const dCustom = rankGuardianAlerts(input(out(events, 'HIGH', 0.8), {
      eventTypePriority: { CURVE_RISK: 1, WEATHER_RISK: 100 },
    }));
    expect(dDefault.displayEvents.map((e) => e.id)).toEqual(['a', 'b']); // curve 80 > weather 50
    expect(dCustom.displayEvents.map((e) => e.id)).toEqual(['b', 'a']);  // weather 100 > curve 1
  });

  it('priority map\'te olmayan tip nötr (0) sayılır, id ile stabil çözülür', () => {
    const events = [
      ev({ id: 'z', type: 'ROAD_HAZARD', severity: 'MEDIUM' }),
      ev({ id: 'a', type: 'DOWNHILL_RISK', severity: 'MEDIUM' }),
    ];
    const d = rankGuardianAlerts(input(out(events, 'MEDIUM', 0.5), { eventTypePriority: {} }));
    expect(d.displayEvents.map((e) => e.id)).toEqual(['a', 'z']); // eşit priority → id ASC
  });
});

/* ── highestPriority + skor/severity korunuyor ─────────────────────────────── */

describe('rankGuardianAlerts — highestPriority + korunan alanlar', () => {
  it('highestPriority en yüksek öncelikli event (severity sonra priority)', () => {
    const events = [
      ev({ id: 'med-fatigue', type: 'DRIVER_FATIGUE_RISK', severity: 'MEDIUM' }),
      ev({ id: 'crit-cam', type: 'SPEED_CAMERA_WARNING', severity: 'CRITICAL' }),
    ];
    const d = rankGuardianAlerts(input(out(events, 'CRITICAL', 0.9)));
    expect(d.highestPriority!.id).toBe('crit-cam'); // CRITICAL > MEDIUM (severity önce)
  });

  it('overallRiskScore GuardianEngine\'den AYNEN korunur', () => {
    const d = rankGuardianAlerts(input(out([ev()], 'HIGH', 0.6789)));
    expect(d.overallRiskScore).toBe(0.6789);
  });

  it('highestSeverity GuardianEngine\'den AYNEN korunur (yeniden hesaplanmaz)', () => {
    // guardianOutput.highestSeverity kasıtlı 'CRITICAL' ama event MEDIUM — sıralayıcı GÜVENİR, hesaplamaz.
    const d = rankGuardianAlerts(input(out([ev({ severity: 'MEDIUM' })], 'CRITICAL', 0.5)));
    expect(d.highestSeverity).toBe('CRITICAL');
  });
});

/* ── duplicate id ──────────────────────────────────────────────────────────── */

describe('rankGuardianAlerts — duplicate id tek kez', () => {
  it('aynı id iki kez gelirse planda bir kez bulunur', () => {
    const events = [
      ev({ id: 'dup', severity: 'HIGH' }),
      ev({ id: 'dup', severity: 'HIGH' }),
      ev({ id: 'other', severity: 'HIGH' }),
    ];
    const d = rankGuardianAlerts(input(out(events, 'HIGH', 0.8)));
    const dupCount = d.displayEvents.filter((e) => e.id === 'dup').length;
    expect(dupCount).toBe(1);
    expect(d.displayEvents).toHaveLength(2); // dup + other
  });
});

/* ── maxSpeakEvents / maxDisplayEvents (zaman-tabanlı olmayan spam koruması) ── */

describe('rankGuardianAlerts — opsiyonel sayı sınırı', () => {
  it('maxSpeakEvents en yüksek öncelikliyi tutar', () => {
    const events = [
      ev({ id: 'a', type: 'DRIVER_FATIGUE_RISK', severity: 'CRITICAL' }),
      ev({ id: 'b', type: 'CURVE_RISK', severity: 'CRITICAL' }),
      ev({ id: 'c', type: 'WEATHER_RISK', severity: 'CRITICAL' }),
    ];
    const d = rankGuardianAlerts(input(out(events, 'CRITICAL', 0.9), { maxSpeakEvents: 1 }));
    expect(d.speakEvents).toHaveLength(1);
    expect(d.speakEvents[0].id).toBe('a'); // en yüksek priority
  });
});

/* ── Validation throw ──────────────────────────────────────────────────────── */

describe('rankGuardianAlerts — validation throw', () => {
  it('input eksik → THROW', () => {
    expect(() => rankGuardianAlerts(undefined as unknown as GuardianAlertRankInput)).toThrow();
  });
  it('guardianOutput eksik → THROW', () => {
    expect(() => rankGuardianAlerts({ policy: basePolicy() } as unknown as GuardianAlertRankInput)).toThrow();
  });
  it('policy eksik → THROW', () => {
    expect(() => rankGuardianAlerts({ guardianOutput: out([], null, 0) } as unknown as GuardianAlertRankInput)).toThrow();
  });
  it('severityRank eksik severity → THROW', () => {
    const p = basePolicy();
    delete (p.severityRank as Record<string, number>).CRITICAL;
    expect(() => rankGuardianAlerts({ guardianOutput: out([ev()], 'HIGH', 0.5), policy: p })).toThrow();
  });
  it('geçersiz speakMinSeverity → THROW', () => {
    expect(() => rankGuardianAlerts(input(out([ev()], 'HIGH', 0.5), { speakMinSeverity: 'GEÇERSİZ' as never }))).toThrow();
  });
  it('overallRiskScore NaN → THROW', () => {
    expect(() => rankGuardianAlerts(input(out([ev()], 'HIGH', NaN)))).toThrow();
  });
  it('maxSpeakEvents negatif → THROW', () => {
    expect(() => rankGuardianAlerts(input(out([ev()], 'HIGH', 0.5), { maxSpeakEvents: -1 }))).toThrow();
  });
});

/* ── Immutable + deterministic ─────────────────────────────────────────────── */

describe('rankGuardianAlerts — immutable / deterministic', () => {
  it('input mutasyona uğratılmaz (snapshot)', () => {
    const i = input(out([ev({ id: 'a', severity: 'CRITICAL' }), ev({ id: 'b', severity: 'LOW' })], 'CRITICAL', 0.9));
    const snapshot = JSON.parse(JSON.stringify(i));
    rankGuardianAlerts(i);
    expect(i).toEqual(snapshot);
  });
  it('GuardianRiskEvent nesneleri değiştirilmez (referans korunur)', () => {
    const e = ev({ id: 'a', severity: 'HIGH' });
    const d = rankGuardianAlerts(input(out([e], 'HIGH', 0.8)));
    expect(d.displayEvents[0]).toBe(e); // aynı referans, kopyalanmadı/değiştirilmedi
  });
  it('output yeni nesnedir (guardianOutput.riskEvents ile aynı dizi değil)', () => {
    const go = out([ev()], 'HIGH', 0.8);
    const d = rankGuardianAlerts({ guardianOutput: go, policy: basePolicy() });
    expect(d.displayEvents).not.toBe(go.riskEvents);
  });
  it('aynı input → aynı output', () => {
    const i = input(out([ev({ id: 'a', severity: 'CRITICAL' }), ev({ id: 'b', severity: 'MEDIUM' })], 'CRITICAL', 0.9));
    expect(rankGuardianAlerts(i)).toEqual(rankGuardianAlerts(i));
  });
});

/* ── GuardianEngine entegrasyonu ───────────────────────────────────────────── */

describe('rankGuardianAlerts — GuardianEngine entegrasyonu', () => {
  it('runGuardian çıktısı doğrudan decision engine\'e verilir', () => {
    const curve = evaluateCurveRisk({
      curve: { id: 'curve-1', distanceMeters: 100, direction: 'left', advisorySpeedKph: 60, confidence: 0.8 },
      vehicle: { currentSpeedKph: 90 }, // CRITICAL
      policy: { warningLeadTimeSeconds: 8, minimumWarningDistanceMeters: 50, overspeedToleranceKph: 2 },
    });
    const weather = evaluateWeatherRisk({
      condition: { surfaceCondition: 'wet', source: 'osm', confidence: 0.8 },
      policy: { severityByCondition: { dry: 'NONE', wet: 'LOW', snow: 'HIGH', ice: 'CRITICAL' } }, // LOW
    });
    const guardianOutput = runGuardian({ ruleResults: [curve, weather] });
    const d = rankGuardianAlerts({ guardianOutput, policy: basePolicy() });

    expect(d.highestSeverity).toBe('CRITICAL');
    expect(d.overallRiskScore).toBe(guardianOutput.overallRiskScore);
    expect(d.highestPriority!.type).toBe('CURVE_RISK'); // CRITICAL curve en önce
    expect(d.speakEvents.map((e) => e.type)).toEqual(['CURVE_RISK']); // yalnız CRITICAL konuşulur (weather LOW)
    expect(d.displayEvents.map((e) => e.type)).toEqual(['CURVE_RISK', 'WEATHER_RISK']); // ikisi de gösterilir
  });
});
