/**
 * vehicleLearningPatternEngine.test.ts — Pattern Clustering & Candidate Promotion (P2-4).
 *
 * Kilitler: aynı marka/protocol/ECU kümeleniyor · farklı marka/protocol karışmıyor ·
 * PID/DID co-occurrence · tek araç candidate olamıyor · 2 araç candidate · 3 araç strong ·
 * 2 araç+2 ECU strong · decayed düşükse promotion yok · ambiguity/conflict → manual-review ·
 * rejected doğru · firstSeen korunur · lastSeen güncellenir · supportingVehicleHashes unique ·
 * boş/bozuk fail-soft · girdi mutate edilmiyor · BASIC_JS ağır clustering yapmıyor · dispose.
 */
import { describe, it, expect } from 'vitest';
import {
  buildClusters,
  buildPatterns,
  promoteCandidate,
  detectConflicts,
  VehicleLearningPatternEngine,
  type LearningPattern,
} from '../platform/vehicleLearningPatternEngine';
import { type LearningEvidence } from '../platform/vehicleLearningEngine';

const DAY = 86_400_000;

/** Kanıt fabrikası — makul varsayılanlar; override ile senaryo kur. */
function ev(over: Partial<LearningEvidence> = {}): LearningEvidence {
  const manufacturer = over.manufacturer ?? 'Renault';
  const protocol = over.protocol ?? '6';
  const source = over.discoverySource ?? 'PID';
  const pidOrDid = over.pidOrDid ?? 'A5';
  const mode = over.mode ?? (source === 'DID' ? '22' : '01');
  return {
    evidenceId: over.evidenceId ?? `${manufacturer}|${protocol}|${source}|${pidOrDid}|${mode}`,
    manufacturer,
    profileHint: over.profileHint ?? manufacturer,
    protocol,
    discoverySource: source,
    pidOrDid,
    mode,
    ecuAddresses: over.ecuAddresses ?? ['7E8'],
    supportingVehicleHashes: over.supportingVehicleHashes ?? ['v1'],
    vehicleCount: over.vehicleCount ?? (over.supportingVehicleHashes?.length ?? 1),
    observationCount: over.observationCount ?? 5,
    firstSeen: over.firstSeen ?? 0,
    lastSeen: over.lastSeen ?? 0,
    confidence: over.confidence ?? 0.8,
    status: over.status ?? 'candidate',
    createdAt: over.createdAt ?? 0,
    updatedAt: over.updatedAt ?? 0,
  };
}

/* ── Kümeleme ───────────────────────────────────────────────────────────────── */
describe('buildClusters', () => {
  it('aynı marka/protocol/ECU evidence TEK küme oluyor', () => {
    const list = [
      ev({ evidenceId: 'a', pidOrDid: 'A5' }),
      ev({ evidenceId: 'b', pidOrDid: 'B2' }),
    ];
    const clusters = buildClusters(list);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].evidenceIds.sort()).toEqual(['a', 'b']);
    expect(clusters[0].manufacturer).toBe('RENAULT');
  });

  it('farklı MARKA karışmıyor (2 küme)', () => {
    const list = [
      ev({ evidenceId: 'a', manufacturer: 'Renault' }),
      ev({ evidenceId: 'b', manufacturer: 'Toyota' }),
    ];
    expect(buildClusters(list)).toHaveLength(2);
  });

  it('farklı PROTOKOL karışmıyor (2 küme)', () => {
    const list = [
      ev({ evidenceId: 'a', protocol: '6' }),
      ev({ evidenceId: 'b', protocol: '7' }),
    ];
    expect(buildClusters(list)).toHaveLength(2);
  });

  it('Unknown marka yalnız aynı protokol+ECU imzasında gruplanır', () => {
    const list = [
      ev({ evidenceId: 'a', manufacturer: '', protocol: '6', ecuAddresses: ['7E8'] }),
      ev({ evidenceId: 'b', manufacturer: '  ', protocol: '6', ecuAddresses: ['7E8'] }),
      ev({ evidenceId: 'c', manufacturer: '', protocol: '6', ecuAddresses: ['7E9'] }), // farklı ECU
    ];
    const clusters = buildClusters(list);
    expect(clusters).toHaveLength(2); // {UNKNOWN|6|7E8} ve {UNKNOWN|6|7E9}
    expect(clusters.every((c) => c.manufacturer === 'UNKNOWN')).toBe(true);
  });
});

/* ── Co-occurrence ──────────────────────────────────────────────────────────── */
describe('co-occurrence patterns', () => {
  it('PID co-occurrence pattern oluşuyor (aynı araçlarda 2 PID)', () => {
    const list = [
      ev({ evidenceId: 'a', discoverySource: 'PID', pidOrDid: 'A5', supportingVehicleHashes: ['v1', 'v2'] }),
      ev({ evidenceId: 'b', discoverySource: 'PID', pidOrDid: 'B2', supportingVehicleHashes: ['v1', 'v2'] }),
    ];
    const patterns = buildPatterns(list, { now: 0 });
    expect(patterns).toHaveLength(1);
    expect(patterns[0].observedPids).toEqual(['A5', 'B2']);
    expect(patterns[0].observedDids).toEqual([]);
  });

  it('DID co-occurrence pattern oluşuyor', () => {
    const list = [
      ev({ evidenceId: 'a', discoverySource: 'DID', pidOrDid: 'F190', supportingVehicleHashes: ['v1', 'v2'] }),
      ev({ evidenceId: 'b', discoverySource: 'DID', pidOrDid: 'F1A0', supportingVehicleHashes: ['v1', 'v2'] }),
    ];
    const patterns = buildPatterns(list, { now: 0 });
    expect(patterns[0].observedDids).toEqual(['F190', 'F1A0']);
    expect(patterns[0].observedPids).toEqual([]);
  });

  it('supportingVehicleHashes UNIQUE (tekrar araç şişirmiyor)', () => {
    const list = [
      ev({ evidenceId: 'a', pidOrDid: 'A5', supportingVehicleHashes: ['v1', 'v1', 'v2'] }),
      ev({ evidenceId: 'b', pidOrDid: 'B2', supportingVehicleHashes: ['v2', 'v1'] }),
    ];
    const p = buildPatterns(list, { now: 0 })[0];
    expect(p.supportingVehicleHashes).toEqual(['v1', 'v2']);
    expect(p.vehicleCount).toBe(2);
  });
});

/* ── Promotion ──────────────────────────────────────────────────────────────── */
describe('candidate promotion', () => {
  it('TEK araç candidate OLAMIYOR (weak kalır)', () => {
    const list = [ev({ supportingVehicleHashes: ['v1'], firstSeen: 0, lastSeen: 5 * DAY })];
    const p = buildPatterns(list, { now: 5 * DAY })[0];
    expect(p.vehicleCount).toBe(1);
    expect(p.status).toBe('weak');
  });

  it('İKİ araç candidate OLUYOR', () => {
    const list = [
      ev({ evidenceId: 'a', pidOrDid: 'A5', supportingVehicleHashes: ['v1', 'v2'], observationCount: 4, firstSeen: 0, lastSeen: 2 * DAY }),
    ];
    const p = buildPatterns(list, { now: 2 * DAY })[0];
    expect(p.vehicleCount).toBe(2);
    expect(p.confidence).toBeGreaterThanOrEqual(0.5);
    expect(p.status).toBe('candidate');
  });

  it('ÜÇ araç strong OLUYOR (≥2 observation window)', () => {
    const list = [
      ev({ evidenceId: 'a', supportingVehicleHashes: ['v1', 'v2', 'v3'], observationCount: 6, firstSeen: 0, lastSeen: 5 * DAY }),
    ];
    const p = buildPatterns(list, { now: 5 * DAY })[0];
    expect(p.vehicleCount).toBe(3);
    expect(p.observationWindows).toBeGreaterThanOrEqual(2);
    expect(p.confidence).toBeGreaterThanOrEqual(0.7);
    expect(p.status).toBe('strong');
  });

  it('İKİ araç + İKİ ECU strong OLUYOR', () => {
    const list = [
      ev({ evidenceId: 'a', supportingVehicleHashes: ['v1', 'v2'], ecuAddresses: ['7E8', '7E9'], observationCount: 6, firstSeen: 0, lastSeen: 5 * DAY }),
    ];
    const p = buildPatterns(list, { now: 5 * DAY })[0];
    expect(p.vehicleCount).toBe(2);
    expect(p.ecuAddresses.length).toBe(2);
    expect(p.status).toBe('strong');
  });

  it('decayed confidence DÜŞÜKSE promotion YOK (eski kanıt)', () => {
    // 3 araç ama lastSeen çok eski → decay confidence'ı düşürür → strong yok
    const list = [
      ev({ evidenceId: 'a', supportingVehicleHashes: ['v1', 'v2', 'v3'], observationCount: 6, status: 'weak', firstSeen: 0, lastSeen: 0 }),
    ];
    const p = buildPatterns(list, { now: 400 * DAY })[0];
    expect(p.confidence).toBeLessThan(0.7);
    expect(p.status).not.toBe('strong');
  });

  it('rejected: decayed confidence < 0.20', () => {
    const list = [
      ev({ evidenceId: 'a', supportingVehicleHashes: ['v1', 'v2'], observationCount: 1, status: 'weak', firstSeen: 0, lastSeen: 0 }),
    ];
    const p = buildPatterns(list, { now: 3000 * DAY })[0]; // aşırı eski → decay ~0
    expect(p.confidence).toBeLessThan(0.2);
    expect(p.status).toBe('rejected');
  });
});

/* ── Conflict / manual review ───────────────────────────────────────────────── */
describe('conflict detection', () => {
  it('aynı PID iki markada → ambiguity + manual review + promotion yok', () => {
    const list = [
      ev({ evidenceId: 'r', manufacturer: 'Renault', pidOrDid: 'A5', supportingVehicleHashes: ['v1', 'v2', 'v3'], firstSeen: 0, lastSeen: 5 * DAY }),
      ev({ evidenceId: 't', manufacturer: 'Toyota', pidOrDid: 'A5', supportingVehicleHashes: ['w1', 'w2', 'w3'], firstSeen: 0, lastSeen: 5 * DAY }),
    ];
    const patterns = buildPatterns(list, { now: 5 * DAY });
    expect(patterns).toHaveLength(2);
    for (const p of patterns) {
      expect(p.ambiguity).toBe(true);
      expect(p.requiresManualReview).toBe(true);
      expect(p.conflictReasons).toContain('CROSS_MANUFACTURER_MEANING');
      expect(p.status).not.toBe('strong'); // conflict → yükseltme yok
    }
  });

  it('detectConflicts girdiyi mutate ETMEZ', () => {
    const base = buildPatterns([
      ev({ evidenceId: 'r', manufacturer: 'Renault', pidOrDid: 'A5', supportingVehicleHashes: ['v1', 'v2'] }),
      ev({ evidenceId: 't', manufacturer: 'Toyota', pidOrDid: 'A5', supportingVehicleHashes: ['w1', 'w2'] }),
    ], { now: 0, tier: 'low' }); // low → conflict işaretlenmemiş ham girdi
    const snap = JSON.parse(JSON.stringify(base));
    detectConflicts(base, 0);
    expect(base).toEqual(snap); // orijinal korunur
  });

  it('promoteCandidate hard conflict → rejected', () => {
    const p: LearningPattern = {
      patternId: 'x', clusterId: 'c', manufacturer: 'RENAULT', protocol: '6', ecuAddresses: ['7E8'],
      evidenceIds: ['a'], observedPids: ['A5'], observedDids: [], supportingVehicleHashes: ['v1', 'v2', 'v3'],
      vehicleCount: 3, observationCount: 6, observationWindows: 2, firstSeen: 0, lastSeen: 0,
      confidence: 0.9, status: 'weak', ambiguity: true,
      conflictReasons: ['MANUFACTURER_MISMATCH'], requiresManualReview: true,
    };
    expect(promoteCandidate(p).status).toBe('rejected');
  });
});

/* ── firstSeen / lastSeen ───────────────────────────────────────────────────── */
describe('temporal alanlar', () => {
  it('firstSeen KORUNUR (min), lastSeen GÜNCELLENİR (max)', () => {
    const list = [
      ev({ evidenceId: 'a', pidOrDid: 'A5', firstSeen: 100, lastSeen: 200 }),
      ev({ evidenceId: 'b', pidOrDid: 'B2', firstSeen: 50, lastSeen: 900 }),
    ];
    const p = buildPatterns(list, { now: 900 })[0];
    expect(p.firstSeen).toBe(50);
    expect(p.lastSeen).toBe(900);
  });
});

/* ── DeviceTier ─────────────────────────────────────────────────────────────── */
describe('DeviceTier davranışı', () => {
  it('BASIC_JS (low) AĞIR clustering yapmıyor: strong YOK + küme-arası conflict işaretlemiyor', () => {
    const list = [
      ev({ evidenceId: 'r', manufacturer: 'Renault', pidOrDid: 'A5', supportingVehicleHashes: ['v1', 'v2', 'v3'], observationCount: 6, firstSeen: 0, lastSeen: 5 * DAY }),
      ev({ evidenceId: 't', manufacturer: 'Toyota', pidOrDid: 'A5', supportingVehicleHashes: ['w1', 'w2', 'w3'], observationCount: 6, firstSeen: 0, lastSeen: 5 * DAY }),
    ];
    const low = buildPatterns(list, { now: 5 * DAY, tier: 'low' });
    const high = buildPatterns(list, { now: 5 * DAY, tier: 'high' });
    // low: ağır co-occurrence conflict taraması yok → conflictReasons boş, strong yok (candidate tavan)
    expect(low.every((p) => p.conflictReasons.length === 0)).toBe(true);
    expect(low.every((p) => p.status !== 'strong')).toBe(true);
    // high: aynı PID iki markada → conflict işaretlenir
    expect(high.some((p) => p.conflictReasons.includes('CROSS_MANUFACTURER_MEANING'))).toBe(true);
  });
});

/* ── Fail-soft / immutability / lifecycle ───────────────────────────────────── */
describe('fail-soft + immutability + dispose', () => {
  it('boş input FAIL-SOFT', () => {
    expect(buildClusters(null)).toEqual([]);
    expect(buildClusters(undefined)).toEqual([]);
    expect(buildClusters([])).toEqual([]);
    expect(buildPatterns(null)).toEqual([]);
    expect(buildPatterns([])).toEqual([]);
    expect(detectConflicts(null)).toEqual([]);
  });

  it('bozuk kayıt FAIL-SOFT (atlanır, çökmez)', () => {
    const list = [
      null as unknown as LearningEvidence,
      { evidenceId: '' } as LearningEvidence,        // boş id → atla
      ev({ evidenceId: 'ok', pidOrDid: 'A5' }),      // geçerli
    ];
    const clusters = buildClusters(list);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].evidenceIds).toEqual(['ok']);
    expect(() => buildPatterns(list, { now: 0 })).not.toThrow();
  });

  it('girdi evidence MUTATE EDİLMİYOR', () => {
    const list = [
      ev({ evidenceId: 'a', pidOrDid: 'A5', supportingVehicleHashes: ['v1', 'v2'], ecuAddresses: ['7E8'] }),
    ];
    const snap = JSON.parse(JSON.stringify(list));
    buildClusters(list);
    buildPatterns(list, { now: 0 });
    expect(list).toEqual(snap);
  });

  it('promoteCandidate girdiyi mutate etmiyor', () => {
    const p: LearningPattern = {
      patternId: 'x', clusterId: 'c', manufacturer: 'RENAULT', protocol: '6', ecuAddresses: ['7E8'],
      evidenceIds: ['a'], observedPids: ['A5'], observedDids: [], supportingVehicleHashes: ['v1', 'v2'],
      vehicleCount: 2, observationCount: 4, observationWindows: 1, firstSeen: 0, lastSeen: 0,
      confidence: 0.6, status: 'weak', ambiguity: false, conflictReasons: [], requiresManualReview: false,
    };
    const snap = JSON.parse(JSON.stringify(p));
    const out = promoteCandidate(p);
    expect(p).toEqual(snap);       // girdi korunur
    expect(out.status).toBe('candidate');
  });

  it('dispose / clear cache temizler', () => {
    let calls = 0;
    const reader = (): LearningEvidence[] => { calls++; return [ev({ evidenceId: 'a', supportingVehicleHashes: ['v1', 'v2'] })]; };
    const engine = new VehicleLearningPatternEngine(reader, () => 0, () => 'high');
    engine.computePatterns();
    engine.computePatterns();
    expect(calls).toBe(1);         // ikinci çağrı cache'ten
    engine.clear();
    engine.computePatterns();
    expect(calls).toBe(2);         // clear sonrası taze
    engine.dispose();
    engine.computePatterns();
    expect(calls).toBe(3);         // dispose sonrası taze
  });

  it('getStrongCandidates / getManualReviewCandidates filtreliyor', () => {
    const list = [
      ev({ evidenceId: 's', manufacturer: 'Renault', pidOrDid: 'C1', supportingVehicleHashes: ['v1', 'v2', 'v3'], observationCount: 6, firstSeen: 0, lastSeen: 5 * DAY }),
    ];
    const engine = new VehicleLearningPatternEngine(() => list, () => 5 * DAY, () => 'high');
    expect(engine.getStrongCandidates().every((p) => p.status === 'strong')).toBe(true);
    expect(engine.getStrongCandidates().length).toBeGreaterThanOrEqual(1);
    expect(engine.getManualReviewCandidates().every((p) => p.requiresManualReview || p.ambiguity)).toBe(true);
  });
});
