/**
 * vehicleLearningDecay.test.ts — Decay / Prune / Duplicate Bastırma (P2-3).
 *
 * Kilitler: yeni kanıt decay yok · 90 gün sonra azalır · 180+ gün zayıf prune-candidate ·
 * strong prune edilmez · saat-geri negatif yok · [0,1] clamp · firstSeen/lastSeen sabit ·
 * duplicate suppression (araç/ECU/response/pencere) · bounded cache · reset/dispose · girdi
 * mutate edilmez · boş/bozuk fail-soft.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  calculateDecayedConfidence,
  applyDecay,
  isPruneCandidate,
  pruneCandidates,
  createObservationIdentity,
  shouldCountObservation,
  resetDuplicateCache,
  dispose,
  DuplicateObservationCache,
  type ObservationInput,
} from '../platform/vehicleLearningDecay';
import { type LearningEvidence } from '../platform/vehicleLearningEngine';

const DAY = 86_400_000;

function ev(over: Partial<LearningEvidence> = {}): LearningEvidence {
  return {
    evidenceId: over.evidenceId ?? 'Renault|6|PID|A5|01',
    manufacturer: 'Renault', profileHint: 'Renault', protocol: '6',
    discoverySource: 'PID', pidOrDid: 'A5', mode: '01',
    ecuAddresses: over.ecuAddresses ?? ['7E8'],
    supportingVehicleHashes: over.supportingVehicleHashes ?? ['v1'],
    vehicleCount: over.vehicleCount ?? 1,
    observationCount: over.observationCount ?? 5,
    firstSeen: over.firstSeen ?? 1000,
    lastSeen: over.lastSeen ?? 1000,
    confidence: over.confidence ?? 0.8,
    status: over.status ?? 'candidate',
    createdAt: over.createdAt ?? 1000,
    updatedAt: over.updatedAt ?? 1000,
  };
}
function obs(over: Partial<ObservationInput> = {}): ObservationInput {
  return {
    evidenceId: over.evidenceId ?? 'E1',
    fingerprintHash: over.fingerprintHash ?? 'v1',
    ecuAddress: over.ecuAddress ?? '7E8',
    rawResponse: over.rawResponse ?? 'AABBCC',
    timestamp: over.timestamp ?? 1_000_000,
  };
}

/* ── Decay ────────────────────────────────────────────────────────────────── */
describe('decay', () => {
  it('yeni kanıt (lastSeen=now) DECAY OLMAZ', () => {
    const now = 10 * DAY;
    const e = ev({ lastSeen: now, confidence: 0.8 });
    expect(calculateDecayedConfidence(e, now)).toBeCloseTo(0.8);
  });

  it('90 gün sonra candidate confidence AZALIR (yarı-ömür 90 → ~yarı)', () => {
    const e = ev({ lastSeen: 0, confidence: 0.8, status: 'candidate' });
    const d = calculateDecayedConfidence(e, 90 * DAY);
    expect(d).toBeLessThan(0.8);
    expect(d).toBeCloseTo(0.4, 1); // 0.8 * 0.5
  });

  it('strong yavaş, weak hızlı decay', () => {
    const at = 90 * DAY;
    const strong = calculateDecayedConfidence(ev({ lastSeen: 0, confidence: 0.9, status: 'strong' }), at);
    const weak = calculateDecayedConfidence(ev({ lastSeen: 0, confidence: 0.9, status: 'weak' }), at);
    expect(strong).toBeGreaterThan(weak); // strong daha az düştü
  });

  it('saat GERİYE giderse negatif decay YOK (elapsed=0)', () => {
    const e = ev({ lastSeen: 100 * DAY, confidence: 0.7 });
    const d = calculateDecayedConfidence(e, 50 * DAY); // now < lastSeen
    expect(d).toBeCloseTo(0.7); // decay uygulanmaz
    expect(d).toBeGreaterThanOrEqual(0);
  });

  it('confidence [0,1] clamp (bozuk giriş)', () => {
    expect(calculateDecayedConfidence(ev({ confidence: 1.5, lastSeen: 0 }), DAY)).toBeLessThanOrEqual(1);
    expect(calculateDecayedConfidence(ev({ confidence: -3, lastSeen: 0 }), DAY)).toBeGreaterThanOrEqual(0);
  });

  it('applyDecay: firstSeen/lastSeen/observationCount DEĞİŞMEZ; girdi mutate edilmez', () => {
    const e = ev({ lastSeen: 0, confidence: 0.8, firstSeen: 500, observationCount: 12 });
    const snap = JSON.parse(JSON.stringify(e));
    const out = applyDecay(e, 180 * DAY);
    expect(out.firstSeen).toBe(500);
    expect(out.lastSeen).toBe(0);
    expect(out.observationCount).toBe(12);
    expect(out.confidence).toBeLessThan(0.8);
    expect(e).toEqual(snap); // girdi korunur
  });
});

/* ── Prune ────────────────────────────────────────────────────────────────── */
describe('prune', () => {
  it('180+ gün ZAYIF kayıt prune-candidate olur', () => {
    const now = 300 * DAY;
    const e = ev({ status: 'weak', confidence: 0.35, lastSeen: now - 200 * DAY });
    expect(isPruneCandidate(e, now)).toBe(true);
  });

  it('STRONG kayıt prune EDİLMEZ (çok eski olsa da)', () => {
    const now = 500 * DAY;
    const e = ev({ status: 'strong', confidence: 0.9, lastSeen: now - 400 * DAY });
    expect(isPruneCandidate(e, now)).toBe(false);
  });

  it('taze/güvenli kayıt prune-candidate olmaz', () => {
    const now = 10 * DAY;
    expect(isPruneCandidate(ev({ status: 'weak', confidence: 0.4, lastSeen: now }), now)).toBe(false); // yeni
  });

  it('pruneCandidates listeden adayları işaretler (fiziksel silmez); girdi mutate edilmez', () => {
    const now = 300 * DAY;
    const list = [
      ev({ evidenceId: 'a', status: 'weak', confidence: 0.35, lastSeen: now - 200 * DAY }),   // aday
      ev({ evidenceId: 'b', status: 'strong', confidence: 0.9, lastSeen: now - 200 * DAY }),  // strong → değil
      ev({ evidenceId: 'c', status: 'candidate', confidence: 0.6, lastSeen: now }),           // taze → değil
    ];
    const snap = JSON.parse(JSON.stringify(list));
    const cands = pruneCandidates(list, now);
    expect(cands.map((c) => c.evidenceId)).toEqual(['a']);
    expect(cands[0].pruneCandidate).toBe(true);
    expect(list).toEqual(snap); // orijinal liste değişmedi
  });
});

/* ── Duplicate suppression ────────────────────────────────────────────────── */
describe('duplicate suppression', () => {
  it('aynı gözlem kısa pencerede DUPLICATE sayılmaz', () => {
    const c = new DuplicateObservationCache();
    expect(c.shouldCount(obs({ timestamp: 1_000_000 }))).toBe(true);
    expect(c.shouldCount(obs({ timestamp: 1_000_500 }))).toBe(false); // aynı 60s kovası
  });

  it('farklı araç / farklı ECU / farklı rawResponse AYRI sayılır', () => {
    const c = new DuplicateObservationCache();
    expect(c.shouldCount(obs({ fingerprintHash: 'v1' }))).toBe(true);
    expect(c.shouldCount(obs({ fingerprintHash: 'v2' }))).toBe(true); // farklı araç
    expect(c.shouldCount(obs({ ecuAddress: '7E9' }))).toBe(true);     // farklı ECU
    expect(c.shouldCount(obs({ rawResponse: 'DDEEFF' }))).toBe(true); // farklı response
  });

  it('farklı zaman penceresi ayrı sayılır', () => {
    const c = new DuplicateObservationCache();
    expect(c.shouldCount(obs({ timestamp: 1_000_000 }))).toBe(true);
    expect(c.shouldCount(obs({ timestamp: 1_000_000 + 120_000 }))).toBe(true); // farklı kova
  });

  it('createObservationIdentity: aynı girdi aynı kimlik, farklı araç farklı kimlik', () => {
    expect(createObservationIdentity(obs())).toBe(createObservationIdentity(obs()));
    expect(createObservationIdentity(obs({ fingerprintHash: 'v1' }))).not.toBe(createObservationIdentity(obs({ fingerprintHash: 'v2' })));
  });

  it('bounded: max aşılınca en eski FIFO düşer', () => {
    const c = new DuplicateObservationCache(3, 60_000);
    for (let i = 0; i < 4; i++) c.shouldCount(obs({ fingerprintHash: `v${i}`, timestamp: 1_000_000 }));
    expect(c.size).toBe(3);
    // v0 düştü → tekrar gelince sayılır (true)
    expect(c.shouldCount(obs({ fingerprintHash: 'v0', timestamp: 1_000_000 }))).toBe(true);
  });

  it('reset / dispose cache temizler', () => {
    const c = new DuplicateObservationCache();
    c.shouldCount(obs());
    expect(c.size).toBe(1);
    c.reset();
    expect(c.size).toBe(0);
    c.shouldCount(obs());
    c.dispose();
    expect(c.size).toBe(0);
  });
});

/* ── Flat API (tekil cache) ───────────────────────────────────────────────── */
describe('flat API + fail-soft', () => {
  beforeEach(() => resetDuplicateCache());

  it('shouldCountObservation + resetDuplicateCache + dispose', () => {
    expect(shouldCountObservation(obs())).toBe(true);
    expect(shouldCountObservation(obs())).toBe(false);
    resetDuplicateCache();
    expect(shouldCountObservation(obs())).toBe(true);
    dispose(); // çökmez
  });

  it('boş / bozuk veri FAIL-SOFT', () => {
    expect(calculateDecayedConfidence(null as unknown as LearningEvidence, 100)).toBe(0);
    expect(isPruneCandidate(null as unknown as LearningEvidence, 100)).toBe(false);
    expect(pruneCandidates(null, 100)).toEqual([]);
    expect(pruneCandidates(undefined, 100)).toEqual([]);
    expect(() => createObservationIdentity({} as ObservationInput)).not.toThrow();
    expect(shouldCountObservation({} as ObservationInput)).toBe(true); // hata → say (kaybetme)
  });
});
