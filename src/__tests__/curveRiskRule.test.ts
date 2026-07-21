/**
 * curveRiskRule.test.ts — GUARDIAN-AI-G2.
 *
 * `evaluateCurveRisk` — ilk gerçek Guardian analiz kuralı. Kapsam: advisory-
 * altı/tolerans-içi olay-yok · severity bantları (LOW/MEDIUM/HIGH/CRITICAL +
 * sınır değerleri) · yön mesajı (sol/sağ/unknown-uydurma-yok) · uyarı
 * penceresi (uzak→yok, pencere-içi→var, mesafe-tabanlı tetik) · currentSpeed=0
 * → yok · distance=0 geçerli · advisory yok → yok (radius varken de) ·
 * validation throw'ları · confidence eşiği · confidence sınırı (event<=curve)
 * · deterministik id/çıktı · immutable girdi · GuardianEngine entegrasyonu ·
 * G1 regresyonu.
 */
import { describe, it, expect } from 'vitest';
import { evaluateCurveRisk, CURVE_RISK_RULE_ID } from '../platform/navigation/guardian/rules/curveRiskRule';
import type {
  CurveRiskInput,
  CurveRiskCurveInput,
  CurveRiskVehicleInput,
  CurveRiskPolicyInput,
} from '../platform/navigation/guardian/rules/curveRiskRule';
import { runGuardian } from '../platform/navigation/guardian/guardianEngine';

function curve(overrides: Partial<CurveRiskCurveInput> = {}): CurveRiskCurveInput {
  return {
    id: 'curve-1',
    distanceMeters: 100,
    direction: 'left',
    advisorySpeedKph: 100,
    advisorySpeedSource: 'osm-maxspeed-advisory',
    confidence: 0.8,
    ...overrides,
  };
}

function vehicle(overrides: Partial<CurveRiskVehicleInput> = {}): CurveRiskVehicleInput {
  return { currentSpeedKph: 100, ...overrides };
}

function policy(overrides: Partial<CurveRiskPolicyInput> = {}): CurveRiskPolicyInput {
  return {
    warningLeadTimeSeconds: 8,
    minimumWarningDistanceMeters: 50,
    overspeedToleranceKph: 2,
    ...overrides,
  };
}

function input(
  curveOverrides: Partial<CurveRiskCurveInput> = {},
  vehicleOverrides: Partial<CurveRiskVehicleInput> = {},
  policyOverrides: Partial<CurveRiskPolicyInput> = {},
): CurveRiskInput {
  return {
    curve: curve(curveOverrides),
    vehicle: vehicle(vehicleOverrides),
    policy: policy(policyOverrides),
  };
}

describe('evaluateCurveRisk — A) hız advisory altında → event yok', () => {
  it('currentSpeedKph < advisorySpeedKph → event yok', () => {
    const result = evaluateCurveRisk(input({ advisorySpeedKph: 80 }, { currentSpeedKph: 70 }));
    expect(result).toEqual({ ruleId: CURVE_RISK_RULE_ID, riskEvents: [] });
  });
});

describe('evaluateCurveRisk — B) tolerans içinde → event yok', () => {
  it('overspeedKph === tolerans (sınırda) → event yok', () => {
    const result = evaluateCurveRisk(input({ advisorySpeedKph: 100 }, { currentSpeedKph: 105 }, { overspeedToleranceKph: 5 }));
    expect(result.riskEvents).toEqual([]);
  });

  it('overspeedKph < tolerans → event yok', () => {
    const result = evaluateCurveRisk(input({ advisorySpeedKph: 100 }, { currentSpeedKph: 103 }, { overspeedToleranceKph: 5 }));
    expect(result.riskEvents).toEqual([]);
  });

  it('spec örneği: advisory10/current13, tol5 → overspeed3<=5 → yok', () => {
    const result = evaluateCurveRisk(input({ advisorySpeedKph: 10 }, { currentSpeedKph: 13 }, { overspeedToleranceKph: 5 }));
    expect(result.riskEvents).toEqual([]);
  });
});

describe('evaluateCurveRisk — C/D/E/F) severity bantları', () => {
  it('C) ratio=1.05 → LOW', () => {
    const result = evaluateCurveRisk(input({ advisorySpeedKph: 100 }, { currentSpeedKph: 105 }, { overspeedToleranceKph: 2 }));
    expect(result.riskEvents).toHaveLength(1);
    expect(result.riskEvents[0].severity).toBe('LOW');
  });

  it('D) ratio=1.15 → MEDIUM', () => {
    const result = evaluateCurveRisk(input({ advisorySpeedKph: 100 }, { currentSpeedKph: 115 }, { overspeedToleranceKph: 2 }));
    expect(result.riskEvents[0].severity).toBe('MEDIUM');
  });

  it('E) ratio=1.35 → HIGH', () => {
    const result = evaluateCurveRisk(input({ advisorySpeedKph: 100 }, { currentSpeedKph: 135 }, { overspeedToleranceKph: 2 }));
    expect(result.riskEvents[0].severity).toBe('HIGH');
  });

  it('F) ratio=1.6 → CRITICAL', () => {
    const result = evaluateCurveRisk(input({ advisorySpeedKph: 100 }, { currentSpeedKph: 160 }, { overspeedToleranceKph: 2 }));
    expect(result.riskEvents[0].severity).toBe('CRITICAL');
  });

  it('spec örneği: advisory20/current29, tol5 → overspeed9>5 → fires (ratio=1.45 → HIGH)', () => {
    // distanceMeters mesafe-tabanlı pencere içinde olacak şekilde küçültüldü
    // (varsayılan minimumWarningDistanceMeters=50) — spec örneği yalnız
    // overspeed GATE'i (mutlak tolerans) göstermek için verilmiş, pencere
    // koşulu ayrıca J/K testlerinde kapsanıyor.
    const result = evaluateCurveRisk(input(
      { advisorySpeedKph: 20, distanceMeters: 40 },
      { currentSpeedKph: 29 },
      { overspeedToleranceKph: 5 },
    ));
    expect(result.riskEvents).toHaveLength(1);
    expect(result.riskEvents[0].severity).toBe('HIGH'); // ratio 1.45 → HIGH bandı (1.25<=1.45<1.50)
  });

  it('bant SINIRLARI: ratio tam 1.10 → MEDIUM (LOW DEĞİL)', () => {
    const result = evaluateCurveRisk(input({ advisorySpeedKph: 100 }, { currentSpeedKph: 110 }, { overspeedToleranceKph: 2 }));
    expect(result.riskEvents[0].severity).toBe('MEDIUM');
  });

  it('bant SINIRLARI: ratio tam 1.25 → HIGH (MEDIUM DEĞİL)', () => {
    const result = evaluateCurveRisk(input({ advisorySpeedKph: 100 }, { currentSpeedKph: 125 }, { overspeedToleranceKph: 2 }));
    expect(result.riskEvents[0].severity).toBe('HIGH');
  });

  it('bant SINIRLARI: ratio tam 1.50 → CRITICAL (HIGH DEĞİL)', () => {
    const result = evaluateCurveRisk(input({ advisorySpeedKph: 100 }, { currentSpeedKph: 150 }, { overspeedToleranceKph: 2 }));
    expect(result.riskEvents[0].severity).toBe('CRITICAL');
  });
});

describe('evaluateCurveRisk — G/H/I) yön mesajı', () => {
  it('G) sol viraj → mesajda "sola"', () => {
    const result = evaluateCurveRisk(input({ direction: 'left', advisorySpeedKph: 100 }, { currentSpeedKph: 120 }, { overspeedToleranceKph: 2 }));
    expect(result.riskEvents[0].message).toContain('sola');
  });

  it('H) sağ viraj → mesajda "sağa"', () => {
    const result = evaluateCurveRisk(input({ direction: 'right', advisorySpeedKph: 100 }, { currentSpeedKph: 120 }, { overspeedToleranceKph: 2 }));
    expect(result.riskEvents[0].message).toContain('sağa');
  });

  it('I) unknown yön → mesajda yön UYDURULMAZ (ne "sola" ne "sağa")', () => {
    const result = evaluateCurveRisk(input({ direction: 'unknown', advisorySpeedKph: 100 }, { currentSpeedKph: 120 }, { overspeedToleranceKph: 2 }));
    expect(result.riskEvents[0].message).not.toContain('sola');
    expect(result.riskEvents[0].message).not.toContain('sağa');
  });

  it('direction severity\'yi DEĞİŞTİRMEZ — aynı hız/tolerans, farklı yön → aynı severity', () => {
    const left = evaluateCurveRisk(input({ direction: 'left', advisorySpeedKph: 100 }, { currentSpeedKph: 120 }, { overspeedToleranceKph: 2 }));
    const right = evaluateCurveRisk(input({ direction: 'right', advisorySpeedKph: 100 }, { currentSpeedKph: 120 }, { overspeedToleranceKph: 2 }));
    const unknown = evaluateCurveRisk(input({ direction: 'unknown', advisorySpeedKph: 100 }, { currentSpeedKph: 120 }, { overspeedToleranceKph: 2 }));
    expect(left.riskEvents[0].severity).toBe(right.riskEvents[0].severity);
    expect(right.riskEvents[0].severity).toBe(unknown.riskEvents[0].severity);
  });

  it('mesaj/başlık/aksiyon anayasa ihlali YOK: "kesin güvenli" veya "ani fren" içermez', () => {
    const result = evaluateCurveRisk(input({ advisorySpeedKph: 100 }, { currentSpeedKph: 160 }, { overspeedToleranceKph: 2 })); // CRITICAL
    const all = `${result.riskEvents[0].title} ${result.riskEvents[0].message} ${result.riskEvents[0].recommendedAction}`;
    expect(all).not.toContain('kesin güvenli');
    expect(all).not.toContain('ani fren');
    expect(all).not.toMatch(/güvenlidir/);
  });
});

describe('evaluateCurveRisk — J/K) uyarı penceresi', () => {
  it('J) viraj çok uzak (ne zaman ne mesafe penceresinde) → event yok', () => {
    const result = evaluateCurveRisk({
      curve: curve({ advisorySpeedKph: 80, distanceMeters: 5000 }),
      vehicle: vehicle({ currentSpeedKph: 100 }),
      policy: policy({ warningLeadTimeSeconds: 8, minimumWarningDistanceMeters: 50, overspeedToleranceKph: 2 }),
    });
    expect(result.riskEvents).toEqual([]);
  });

  it('K) zaman-tabanlı pencere içinde → event var', () => {
    // distance=100, current=105km/s → speedMs=29.16, time=3.42s <= leadTime(8) → fires
    const result = evaluateCurveRisk(input({ advisorySpeedKph: 100, distanceMeters: 100 }, { currentSpeedKph: 105 }, { warningLeadTimeSeconds: 8, minimumWarningDistanceMeters: 50, overspeedToleranceKph: 2 }));
    expect(result.riskEvents).toHaveLength(1);
  });

  it('K2) mesafe-tabanlı tetik: zaman penceresi YETERSİZ olsa bile distance<=minDistance ise fires', () => {
    // distance=40<=minDistance(50); leadTime=1 (çok kısa) → zaman testi geçmez ama mesafe testi geçer.
    const result = evaluateCurveRisk(input(
      { advisorySpeedKph: 40, distanceMeters: 40 },
      { currentSpeedKph: 50 },
      { warningLeadTimeSeconds: 1, minimumWarningDistanceMeters: 50, overspeedToleranceKph: 2 },
    ));
    expect(result.riskEvents).toHaveLength(1);
  });
});

describe('evaluateCurveRisk — L) currentSpeed=0 → event yok', () => {
  it('currentSpeedKph=0 → event yok (bölme yok, çökme yok)', () => {
    expect(() => evaluateCurveRisk(input({ advisorySpeedKph: 80 }, { currentSpeedKph: 0 }))).not.toThrow();
    const result = evaluateCurveRisk(input({ advisorySpeedKph: 80 }, { currentSpeedKph: 0 }));
    expect(result.riskEvents).toEqual([]);
  });
});

describe('evaluateCurveRisk — M) distance=0 geçerli', () => {
  it('distanceMeters=0 → event ÜRETİLEBİLİR (diğer koşullar sağlanırsa), THROW YOK', () => {
    const result = evaluateCurveRisk(input({ advisorySpeedKph: 100, distanceMeters: 0 }, { currentSpeedKph: 120 }, { overspeedToleranceKph: 2 }));
    expect(result.riskEvents).toHaveLength(1);
    expect(result.riskEvents[0].distanceMeters).toBe(0);
  });
});

describe('evaluateCurveRisk — N) advisory yok → event yok', () => {
  it('advisorySpeedKph undefined → event yok', () => {
    const result = evaluateCurveRisk(input({ advisorySpeedKph: undefined }));
    expect(result.riskEvents).toEqual([]);
  });
});

describe('evaluateCurveRisk — O) radius var advisory yok → sayısal hız uydurulmaz', () => {
  it('radiusMeters dolu, advisorySpeedKph yok → event YOK (radius\'tan hız türetilmedi)', () => {
    const result = evaluateCurveRisk(input({ advisorySpeedKph: undefined, radiusMeters: 150 }));
    expect(result.riskEvents).toEqual([]);
  });
});

describe('evaluateCurveRisk — P/Q/R/S) validation throw', () => {
  it('P) NaN currentSpeedKph → THROW', () => {
    expect(() => evaluateCurveRisk(input({}, { currentSpeedKph: NaN }))).toThrow();
  });
  it('P2) Infinity currentSpeedKph → THROW', () => {
    expect(() => evaluateCurveRisk(input({}, { currentSpeedKph: Infinity }))).toThrow();
  });
  it('Q) negatif currentSpeedKph → THROW', () => {
    expect(() => evaluateCurveRisk(input({}, { currentSpeedKph: -5 }))).toThrow();
  });
  it('R) advisorySpeedKph <= 0 → THROW', () => {
    expect(() => evaluateCurveRisk(input({ advisorySpeedKph: 0 }))).toThrow();
    expect(() => evaluateCurveRisk(input({ advisorySpeedKph: -10 }))).toThrow();
  });
  it('R2) advisorySpeedKph NaN/Infinity → THROW', () => {
    expect(() => evaluateCurveRisk(input({ advisorySpeedKph: NaN }))).toThrow();
    expect(() => evaluateCurveRisk(input({ advisorySpeedKph: Infinity }))).toThrow();
  });
  it('S) negatif distanceMeters → THROW', () => {
    expect(() => evaluateCurveRisk(input({ distanceMeters: -1 }))).toThrow();
  });
  it('curve.id boş → THROW', () => {
    expect(() => evaluateCurveRisk(input({ id: '' }))).toThrow();
  });
  it('curve.confidence NaN/Infinity → THROW', () => {
    expect(() => evaluateCurveRisk(input({ confidence: NaN }))).toThrow();
    expect(() => evaluateCurveRisk(input({ confidence: Infinity }))).toThrow();
  });
  it('policy.overspeedToleranceKph NaN/Infinity/negatif → THROW', () => {
    expect(() => evaluateCurveRisk(input({}, {}, { overspeedToleranceKph: NaN }))).toThrow();
    expect(() => evaluateCurveRisk(input({}, {}, { overspeedToleranceKph: Infinity }))).toThrow();
    expect(() => evaluateCurveRisk(input({}, {}, { overspeedToleranceKph: -1 }))).toThrow();
  });
  it('policy.warningLeadTimeSeconds NaN/Infinity/<=0 → THROW', () => {
    expect(() => evaluateCurveRisk(input({}, {}, { warningLeadTimeSeconds: NaN }))).toThrow();
    expect(() => evaluateCurveRisk(input({}, {}, { warningLeadTimeSeconds: 0 }))).toThrow();
    expect(() => evaluateCurveRisk(input({}, {}, { warningLeadTimeSeconds: -1 }))).toThrow();
  });
  it('policy.minimumWarningDistanceMeters NaN/Infinity/negatif → THROW', () => {
    expect(() => evaluateCurveRisk(input({}, {}, { minimumWarningDistanceMeters: NaN }))).toThrow();
    expect(() => evaluateCurveRisk(input({}, {}, { minimumWarningDistanceMeters: -1 }))).toThrow();
  });
});

describe('evaluateCurveRisk — confidence eşiği (fail-closed, throw DEĞİL)', () => {
  it('confidence eşik ALTINDA (0.29 < 0.3) → event yok', () => {
    const result = evaluateCurveRisk(input({ advisorySpeedKph: 100, confidence: 0.29 }, { currentSpeedKph: 120 }, { overspeedToleranceKph: 2 }));
    expect(result.riskEvents).toEqual([]);
  });

  it('confidence TAM eşikte (0.3) → event ÜRETİLİR', () => {
    const result = evaluateCurveRisk(input({ advisorySpeedKph: 100, confidence: 0.3 }, { currentSpeedKph: 120 }, { overspeedToleranceKph: 2 }));
    expect(result.riskEvents).toHaveLength(1);
  });
});

describe('evaluateCurveRisk — T) confidence sınırı (event conf <= curve conf)', () => {
  it('event.confidence <= curve.confidence', () => {
    const result = evaluateCurveRisk(input({ advisorySpeedKph: 100, confidence: 0.65 }, { currentSpeedKph: 120 }, { overspeedToleranceKph: 2 }));
    expect(result.riskEvents[0].confidence).toBeLessThanOrEqual(0.65);
    expect(result.riskEvents[0].confidence).toBe(0.65); // G2'de üst sınırla EŞİT taşınır
  });
});

describe('evaluateCurveRisk — U) deterministik event id', () => {
  it('id = `curve-risk:${curve.id}`', () => {
    const result = evaluateCurveRisk(input({ id: 'tarsus-bogazi-1', advisorySpeedKph: 100 }, { currentSpeedKph: 120 }, { overspeedToleranceKph: 2 }));
    expect(result.riskEvents[0].id).toBe('curve-risk:tarsus-bogazi-1');
  });

  it('event.type = CURVE_RISK, ruleId = curve-risk', () => {
    const result = evaluateCurveRisk(input({ advisorySpeedKph: 100 }, { currentSpeedKph: 120 }, { overspeedToleranceKph: 2 }));
    expect(result.ruleId).toBe('curve-risk');
    expect(result.riskEvents[0].type).toBe('CURVE_RISK');
  });

  it('source: advisorySpeedSource verilirse taşınır', () => {
    const result = evaluateCurveRisk(input({ advisorySpeedKph: 100, advisorySpeedSource: 'user-table' }, { currentSpeedKph: 120 }, { overspeedToleranceKph: 2 }));
    expect(result.riskEvents[0].source).toBe('user-table');
  });

  it('source: advisorySpeedSource verilmezse varsayılan kaynak kullanılır', () => {
    const result = evaluateCurveRisk(input({ advisorySpeedKph: 100, advisorySpeedSource: undefined }, { currentSpeedKph: 120 }, { overspeedToleranceKph: 2 }));
    expect(result.riskEvents[0].source).toBeTruthy();
    expect(typeof result.riskEvents[0].source).toBe('string');
  });
});

describe('evaluateCurveRisk — V) input immutability', () => {
  it('curve/vehicle/policy mutasyona uğratılmaz (snapshot)', () => {
    const i = input({ advisorySpeedKph: 100 }, { currentSpeedKph: 120 }, { overspeedToleranceKph: 2 });
    const snapshot = JSON.parse(JSON.stringify(i));
    evaluateCurveRisk(i);
    expect(i).toEqual(snapshot);
  });

  it('donmuş (Object.freeze) girdiyle de çalışır', () => {
    const i = {
      curve: Object.freeze(curve({ advisorySpeedKph: 100 })),
      vehicle: Object.freeze(vehicle({ currentSpeedKph: 120 })),
      policy: Object.freeze(policy({ overspeedToleranceKph: 2 })),
    };
    Object.freeze(i);
    expect(() => evaluateCurveRisk(i)).not.toThrow();
  });
});

describe('evaluateCurveRisk — W) aynı input aynı output (deterministik)', () => {
  it('aynı girdi tekrar tekrar çağrılınca AYNI sonucu verir', () => {
    const i = input({ advisorySpeedKph: 100 }, { currentSpeedKph: 130 }, { overspeedToleranceKph: 2 });
    const a = evaluateCurveRisk(i);
    const b = evaluateCurveRisk(i);
    expect(a).toEqual(b);
  });
});

describe('X) GuardianEngine entegrasyonu', () => {
  it('CurveRiskRule sonucu runGuardian\'a verilince CURVE_RISK event görünür + highestSeverity doğru', () => {
    const ruleResult = evaluateCurveRisk(input({ advisorySpeedKph: 100 }, { currentSpeedKph: 160 }, { overspeedToleranceKph: 2 })); // CRITICAL
    const output = runGuardian({ ruleResults: [ruleResult] });
    expect(output.riskEvents).toHaveLength(1);
    expect(output.riskEvents[0].type).toBe('CURVE_RISK');
    expect(output.highestSeverity).toBe('CRITICAL');
  });

  it('overallRiskScore doğru yönde ARTAR (risk eklenince skor 0\'dan büyür)', () => {
    const empty = runGuardian({ ruleResults: [] });
    const ruleResult = evaluateCurveRisk(input({ advisorySpeedKph: 100 }, { currentSpeedKph: 160 }, { overspeedToleranceKph: 2 }));
    const withCurve = runGuardian({ ruleResults: [ruleResult] });
    expect(withCurve.overallRiskScore).toBeGreaterThan(empty.overallRiskScore);
  });

  it('event-yok RuleResult runGuardian\'a verilince hiçbir olay eklemez (boş kalır)', () => {
    const ruleResult = evaluateCurveRisk(input({ advisorySpeedKph: undefined })); // event yok
    const output = runGuardian({ ruleResults: [ruleResult] });
    expect(output.riskEvents).toEqual([]);
    expect(output.overallRiskScore).toBe(0);
  });
});

describe('Y) G1 guardianEngine regresyonu', () => {
  it('runGuardian boş girişte hâlâ eski davranışı korur', () => {
    const out = runGuardian({ ruleResults: [] });
    expect(out.riskEvents).toEqual([]);
    expect(out.highestSeverity).toBeNull();
    expect(out.overallRiskScore).toBe(0);
  });
});
