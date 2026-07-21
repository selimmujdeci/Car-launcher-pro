/**
 * guardianEngine.test.ts — GUARDIAN-AI-G1.
 *
 * `runGuardian` — Guardian AI Core saf motoru (navigasyondan bağımsız,
 * fail-closed, deterministik). İlk sürümde analiz YOK — yalnız DI ile
 * verilen risk olaylarını toplar/tekilleştirir/sıralar/skorlar.
 *
 * Kapsam: boş giriş · tek/çoklu risk · severity+mesafe+id sıralaması ·
 * overallRiskScore kesin değer + monotonluk · immutable girdi · duplicate id
 * dedup (yüksek severity kazanır, eşitlikte ilk görülen) · deterministik
 * çıktı · highestSeverity null/dolu · çoklu ruleResult birleşimi.
 */
import { describe, it, expect } from 'vitest';
import { runGuardian } from '../platform/navigation/guardian/guardianEngine';
import { SEVERITY_WEIGHT } from '../platform/navigation/guardian/models';
import type {
  GuardianInput,
  GuardianRiskEvent,
  GuardianRuleResult,
  GuardianSeverity,
} from '../platform/navigation/guardian/models';

function risk(overrides: Partial<GuardianRiskEvent> = {}): GuardianRiskEvent {
  return {
    id: 'r1',
    type: 'CURVE_RISK',
    severity: 'MEDIUM',
    distanceMeters: 500,
    title: 'Test riski',
    message: 'Test mesajı',
    recommendedAction: 'Yavaşla',
    confidence: 0.8,
    source: 'test-rule',
    ...overrides,
  };
}

function rule(ruleId: string, riskEvents: GuardianRiskEvent[]): GuardianRuleResult {
  return { ruleId, riskEvents };
}

function inputOf(...ruleResults: GuardianRuleResult[]): GuardianInput {
  return { ruleResults };
}

describe('runGuardian — boş giriş', () => {
  it('ruleResults=[] → riskEvents=[], highestSeverity=null, overallRiskScore=0', () => {
    const out = runGuardian({ ruleResults: [] });
    expect(out.riskEvents).toEqual([]);
    expect(out.highestSeverity).toBeNull();
    expect(out.overallRiskScore).toBe(0);
  });

  it('ruleResults dolu AMA hepsi boş riskEvents → aynı sonuç', () => {
    const out = runGuardian(inputOf(rule('rule-a', []), rule('rule-b', [])));
    expect(out.riskEvents).toEqual([]);
    expect(out.highestSeverity).toBeNull();
    expect(out.overallRiskScore).toBe(0);
  });
});

describe('runGuardian — tek risk', () => {
  it('tek CRITICAL, confidence=1 → tek olay, highestSeverity=CRITICAL, score=1.0', () => {
    const out = runGuardian(inputOf(rule('rule-a', [risk({ id: 'r1', severity: 'CRITICAL', confidence: 1 })])));
    expect(out.riskEvents).toHaveLength(1);
    expect(out.highestSeverity).toBe('CRITICAL');
    expect(out.overallRiskScore).toBe(1);
  });

  it('tek LOW, confidence=0.5 → score = (1/4)×0.5 = 0.125', () => {
    const out = runGuardian(inputOf(rule('rule-a', [risk({ id: 'r1', severity: 'LOW', confidence: 0.5 })])));
    expect(out.overallRiskScore).toBeCloseTo(0.125, 10);
  });
});

describe('runGuardian — çoklu risk hepsi toplanır', () => {
  it('3 farklı id → 3 olay, hepsi çıktıda', () => {
    const out = runGuardian(inputOf(rule('rule-a', [
      risk({ id: 'r1', severity: 'HIGH' }),
      risk({ id: 'r2', severity: 'LOW' }),
      risk({ id: 'r3', severity: 'MEDIUM' }),
    ])));
    expect(out.riskEvents).toHaveLength(3);
    expect(out.riskEvents.map(e => e.id).sort()).toEqual(['r1', 'r2', 'r3']);
  });

  it('birden çok ruleResult olayları BİRLEŞİR', () => {
    const out = runGuardian(inputOf(
      rule('rule-a', [risk({ id: 'a1', severity: 'LOW' })]),
      rule('rule-b', [risk({ id: 'b1', severity: 'HIGH' })]),
      rule('rule-c', [risk({ id: 'c1', severity: 'MEDIUM' }), risk({ id: 'c2', severity: 'INFO' })]),
    ));
    expect(out.riskEvents).toHaveLength(4);
    expect(out.riskEvents.map(e => e.id).sort()).toEqual(['a1', 'b1', 'c1', 'c2']);
  });
});

describe('runGuardian — severity sıralaması (deterministik)', () => {
  it('CRITICAL → HIGH → MEDIUM → LOW → INFO sırasıyla döner', () => {
    const out = runGuardian(inputOf(rule('rule-a', [
      risk({ id: 'i1', severity: 'INFO' }),
      risk({ id: 'l1', severity: 'LOW' }),
      risk({ id: 'c1', severity: 'CRITICAL' }),
      risk({ id: 'h1', severity: 'HIGH' }),
      risk({ id: 'm1', severity: 'MEDIUM' }),
    ])));
    expect(out.riskEvents.map(e => e.severity)).toEqual(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']);
  });

  it('eşit severity → distanceMeters ASC (yakın önce)', () => {
    const out = runGuardian(inputOf(rule('rule-a', [
      risk({ id: 'far', severity: 'HIGH', distanceMeters: 900 }),
      risk({ id: 'near', severity: 'HIGH', distanceMeters: 100 }),
      risk({ id: 'mid', severity: 'HIGH', distanceMeters: 500 }),
    ])));
    expect(out.riskEvents.map(e => e.id)).toEqual(['near', 'mid', 'far']);
  });

  it('eşit severity + eşit distance → id ASC (stable tie-break)', () => {
    const out = runGuardian(inputOf(rule('rule-a', [
      risk({ id: 'z', severity: 'HIGH', distanceMeters: 200 }),
      risk({ id: 'a', severity: 'HIGH', distanceMeters: 200 }),
      risk({ id: 'm', severity: 'HIGH', distanceMeters: 200 }),
    ])));
    expect(out.riskEvents.map(e => e.id)).toEqual(['a', 'm', 'z']);
  });
});

describe('runGuardian — overallRiskScore kesin değer + monotonluk', () => {
  it('CRITICAL(conf 0.5) + MEDIUM(conf 0.8) → 1 − (1−0.5)×(1−0.4) = 0.7', () => {
    const out = runGuardian(inputOf(rule('rule-a', [
      risk({ id: 'r1', severity: 'CRITICAL', confidence: 0.5, distanceMeters: 100 }),
      risk({ id: 'r2', severity: 'MEDIUM', confidence: 0.8, distanceMeters: 200 }),
    ])));
    expect(out.overallRiskScore).toBeCloseTo(0.7, 10);
  });

  it('MONOTON: yeni risk eklemek skoru ASLA AZALTMAZ', () => {
    const base = runGuardian(inputOf(rule('rule-a', [risk({ id: 'r1', severity: 'LOW', confidence: 0.3 })])));
    const withMore = runGuardian(inputOf(rule('rule-a', [
      risk({ id: 'r1', severity: 'LOW', confidence: 0.3 }),
      risk({ id: 'r2', severity: 'MEDIUM', confidence: 0.5 }),
    ])));
    expect(withMore.overallRiskScore).toBeGreaterThanOrEqual(base.overallRiskScore);
  });

  it('MONOTON: severity/confidence artışı skoru ASLA AZALTMAZ', () => {
    const weaker = runGuardian(inputOf(rule('rule-a', [risk({ id: 'r1', severity: 'LOW', confidence: 0.3 })])));
    const stronger = runGuardian(inputOf(rule('rule-a', [risk({ id: 'r1', severity: 'HIGH', confidence: 0.9 })])));
    expect(stronger.overallRiskScore).toBeGreaterThanOrEqual(weaker.overallRiskScore);
  });

  it('score her zaman [0,1] aralığında (bounded)', () => {
    const out = runGuardian(inputOf(rule('rule-a', [
      risk({ id: 'r1', severity: 'CRITICAL', confidence: 1 }),
      risk({ id: 'r2', severity: 'CRITICAL', confidence: 1 }),
      risk({ id: 'r3', severity: 'CRITICAL', confidence: 1 }),
    ])));
    expect(out.overallRiskScore).toBeLessThanOrEqual(1);
    expect(out.overallRiskScore).toBeGreaterThanOrEqual(0);
  });

  it('confidence aralık dışı (>1, <0, NaN) SAVUNMACI clamp edilir — çökme YOK', () => {
    expect(() => runGuardian(inputOf(rule('rule-a', [risk({ confidence: 5 })])))).not.toThrow();
    expect(() => runGuardian(inputOf(rule('rule-a', [risk({ confidence: -3 })])))).not.toThrow();
    expect(() => runGuardian(inputOf(rule('rule-a', [risk({ confidence: NaN })])))).not.toThrow();
    const out = runGuardian(inputOf(rule('rule-a', [risk({ severity: 'CRITICAL', confidence: 5 })])));
    expect(out.overallRiskScore).toBeLessThanOrEqual(1); // 5 → clamp 1 → skor taşmaz
  });
});

describe('runGuardian — immutable girdi', () => {
  it('input.ruleResults / riskEvents mutasyona uğratılmaz (snapshot)', () => {
    const input = inputOf(rule('rule-a', [risk({ id: 'r1' }), risk({ id: 'r2', severity: 'HIGH' })]));
    const snapshot = JSON.parse(JSON.stringify(input));
    runGuardian(input);
    expect(input).toEqual(snapshot);
  });

  it('donmuş (Object.freeze) girdiyle de çalışır', () => {
    const events = Object.freeze([risk({ id: 'r1' })]) as readonly GuardianRiskEvent[];
    const ruleResults = Object.freeze([Object.freeze({ ruleId: 'rule-a', riskEvents: events })]);
    const frozenInput = Object.freeze({ ruleResults }) as GuardianInput;
    expect(() => runGuardian(frozenInput)).not.toThrow();
  });

  it('çıktı riskEvents YENİ bir dizi — girdi diziyle AYNI referans DEĞİL', () => {
    const events = [risk({ id: 'r1' })];
    const input = inputOf(rule('rule-a', events));
    const out = runGuardian(input);
    expect(out.riskEvents).not.toBe(events);
  });
});

describe('runGuardian — duplicate id (fail-closed dedup)', () => {
  it('aynı id, LOW sonra HIGH → HIGH tutulur (düşük kaybolmaz mantığı ters değil — yüksek KAZANIR)', () => {
    const out = runGuardian(inputOf(rule('rule-a', [
      risk({ id: 'r1', severity: 'LOW' }),
      risk({ id: 'r1', severity: 'HIGH' }),
    ])));
    expect(out.riskEvents).toHaveLength(1);
    expect(out.riskEvents[0].severity).toBe('HIGH');
  });

  it('aynı id, HIGH sonra LOW (sıra tersine) → yine HIGH tutulur (sıra bağımsız)', () => {
    const out = runGuardian(inputOf(rule('rule-a', [
      risk({ id: 'r1', severity: 'HIGH' }),
      risk({ id: 'r1', severity: 'LOW' }),
    ])));
    expect(out.riskEvents).toHaveLength(1);
    expect(out.riskEvents[0].severity).toBe('HIGH');
  });

  it('aynı id, AYNI severity → İLK GÖRÜLEN korunur (deterministik tie-break)', () => {
    const out = runGuardian(inputOf(rule('rule-a', [
      risk({ id: 'r1', severity: 'MEDIUM', message: 'ilk mesaj' }),
      risk({ id: 'r1', severity: 'MEDIUM', message: 'ikinci mesaj' }),
    ])));
    expect(out.riskEvents).toHaveLength(1);
    expect(out.riskEvents[0].message).toBe('ilk mesaj');
  });

  it('3 kez aynı id (LOW, CRITICAL, MEDIUM) → CRITICAL tutulur, tek olay kalır', () => {
    const out = runGuardian(inputOf(rule('rule-a', [
      risk({ id: 'r1', severity: 'LOW' }),
      risk({ id: 'r1', severity: 'CRITICAL' }),
      risk({ id: 'r1', severity: 'MEDIUM' }),
    ])));
    expect(out.riskEvents).toHaveLength(1);
    expect(out.riskEvents[0].severity).toBe('CRITICAL');
  });

  it('farklı ruleResult\'lardan gelen AYNI id de dedup edilir (kaynak fark etmez)', () => {
    const out = runGuardian(inputOf(
      rule('rule-a', [risk({ id: 'shared', severity: 'LOW' })]),
      rule('rule-b', [risk({ id: 'shared', severity: 'CRITICAL' })]),
    ));
    expect(out.riskEvents).toHaveLength(1);
    expect(out.riskEvents[0].severity).toBe('CRITICAL');
  });

  it('dedup skoru ŞİŞİRMEZ — aynı riskin iki kez sayılması ENGELLENİR', () => {
    const single = runGuardian(inputOf(rule('rule-a', [risk({ id: 'r1', severity: 'HIGH', confidence: 0.6 })])));
    const duplicated = runGuardian(inputOf(rule('rule-a', [
      risk({ id: 'r1', severity: 'HIGH', confidence: 0.6 }),
      risk({ id: 'r1', severity: 'HIGH', confidence: 0.6 }),
    ])));
    expect(duplicated.overallRiskScore).toBeCloseTo(single.overallRiskScore, 10);
  });
});

describe('runGuardian — deterministik çıktı', () => {
  it('aynı input tekrar tekrar çağrılınca AYNI sıra + skor verir', () => {
    const input = inputOf(rule('rule-a', [
      risk({ id: 'r1', severity: 'HIGH', distanceMeters: 300 }),
      risk({ id: 'r2', severity: 'CRITICAL', distanceMeters: 50 }),
      risk({ id: 'r3', severity: 'LOW', distanceMeters: 900 }),
    ]));
    const a = runGuardian(input);
    const b = runGuardian(input);
    const c = runGuardian(input);
    expect(a.riskEvents.map(e => e.id)).toEqual(b.riskEvents.map(e => e.id));
    expect(b.riskEvents.map(e => e.id)).toEqual(c.riskEvents.map(e => e.id));
    expect(a.overallRiskScore).toBe(b.overallRiskScore);
    expect(b.overallRiskScore).toBe(c.overallRiskScore);
    expect(a.highestSeverity).toBe(b.highestSeverity);
  });
});

describe('runGuardian — highestSeverity', () => {
  it('olay yoksa null', () => {
    expect(runGuardian(inputOf()).highestSeverity).toBeNull();
  });

  it('en yüksek severity çıktının ilk elemanınınkiyle eşleşir', () => {
    const out = runGuardian(inputOf(rule('rule-a', [
      risk({ id: 'r1', severity: 'MEDIUM' }),
      risk({ id: 'r2', severity: 'CRITICAL' }),
      risk({ id: 'r3', severity: 'LOW' }),
    ])));
    expect(out.highestSeverity).toBe('CRITICAL');
    expect(out.riskEvents[0].severity).toBe(out.highestSeverity);
  });
});

describe('SEVERITY_WEIGHT — merkezi sabit sözleşmesi', () => {
  it('INFO=0, LOW=1, MEDIUM=2, HIGH=3, CRITICAL=4', () => {
    const expected: Record<GuardianSeverity, number> = { INFO: 0, LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };
    expect(SEVERITY_WEIGHT).toEqual(expected);
  });
});
