/**
 * manufacturerProfileBuilder.test.ts — Üretici Profil Üreticisi TEMELİ (PR-30).
 *
 * Kilitlenen davranışlar: candidate üretimi · duplicate merge (seenCount/vehicleCount/
 * confidence) · conflict tespiti (multi-ECU/çelişkili confidence/zaten-katalogda) · manual
 * review işareti · çakışmasız adaylar etkilenmez · boş/bozuk liste fail-soft · mevcut
 * profiller/girdi DEĞİŞMEZ (salt-okunur).
 */
import { describe, it, expect } from 'vitest';
import {
  buildProfileCandidates,
  ManufacturerProfileBuilder,
} from '../platform/manufacturerProfileBuilder';
import {
  type ManufacturerKnowledge,
  type CandidatePidDid,
} from '../platform/manufacturerIntelligenceEngine';
import { renaultDaciaProfile } from '../platform/obd/profiles/renaultDaciaProfile';

function cand(over: Partial<CandidatePidDid> & { source?: 'PID' | 'DID' } = {}): CandidatePidDid {
  const source = over.discoverySource ?? over.source ?? 'PID';
  return {
    pidOrDid:        over.pidOrDid ?? 'A5',
    discoverySource: source,
    mode:            over.mode ?? (source === 'DID' ? '22' : '01'),
    ecuAddresses:    over.ecuAddresses ?? ['7E8'],
    seenCount:       over.seenCount ?? 5,
    vehicleCount:    over.vehicleCount ?? 2,
    firstSeen:       over.firstSeen ?? 1000,
    lastSeen:        over.lastSeen ?? 2000,
    confidence:      over.confidence ?? 0.8,
    status:          over.status ?? 'strong',
  };
}

function mk(over: Partial<ManufacturerKnowledge> & { pids?: CandidatePidDid[]; dids?: CandidatePidDid[] } = {}): ManufacturerKnowledge {
  return {
    manufacturer: over.manufacturer ?? 'Renault',
    profileHint:  over.profileHint ?? 'Renault',
    vehicleCount: over.vehicleCount ?? 2,
    ecuAddresses: over.ecuAddresses ?? ['7E8'],
    observedPids: over.pids ?? [],
    observedDids: over.dids ?? [],
    firstSeen:    over.firstSeen ?? 1000,
    lastSeen:     over.lastSeen ?? 2000,
    confidence:   over.confidence ?? 0.8,
  };
}

/* ── Candidate üretimi ────────────────────────────────────────────────────── */
describe('buildProfileCandidates — üretim', () => {
  it('strong candidate → ProfileCandidate oluşuyor', () => {
    const out = buildProfileCandidates([mk({ pids: [cand({ pidOrDid: 'A5', ecuAddresses: ['7E8'] })] })]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      manufacturer: 'Renault', profileHint: 'Renault', pidOrDid: 'A5', ecuAddress: '7E8',
      mode: '01', candidateStatus: 'strong', requiresManualReview: false,
    });
    expect(out[0].mergeGroup).toBe('Renault|PID|A5');
  });

  it('yalnız strong değerlendirilir (weak/candidate atlanır)', () => {
    const out = buildProfileCandidates([mk({ pids: [
      cand({ pidOrDid: 'A5', status: 'weak' }),
      cand({ pidOrDid: 'A6', status: 'candidate' }),
    ] })]);
    expect(out).toHaveLength(0);
  });

  it('DID adayı 22 modunda üretilir', () => {
    const out = buildProfileCandidates([mk({ dids: [cand({ pidOrDid: 'F190', source: 'DID', ecuAddresses: ['7E8'] })] })]);
    expect(out[0]).toMatchObject({ pidOrDid: 'F190', mode: '22', ecuAddress: '7E8' });
  });
});

/* ── Duplicate merge ──────────────────────────────────────────────────────── */
describe('buildProfileCandidates — merge', () => {
  it('aynı aday birleşiyor: seenCount/vehicleCount toplanır, confidence maks', () => {
    const out = buildProfileCandidates([
      mk({ pids: [cand({ pidOrDid: 'A5', ecuAddresses: ['7E8'], seenCount: 5, vehicleCount: 2, confidence: 0.7, firstSeen: 1000, lastSeen: 2000 })] }),
      mk({ pids: [cand({ pidOrDid: 'A5', ecuAddresses: ['7E8'], seenCount: 3, vehicleCount: 1, confidence: 0.9, firstSeen: 500, lastSeen: 4000 })] }),
    ]);
    expect(out).toHaveLength(1);                 // duplicate yok
    expect(out[0].seenCount).toBe(8);            // 5 + 3
    expect(out[0].vehicleCount).toBe(3);         // 2 + 1
    expect(out[0].confidence).toBeCloseTo(0.9);  // maks
    expect(out[0].firstSeen).toBe(500);          // min korunur
    expect(out[0].lastSeen).toBe(4000);          // maks güncellenir
    expect(out[0].requiresManualReview).toBe(false); // conf farkı 0.2 <= 0.3
  });
});

/* ── Conflict detection ───────────────────────────────────────────────────── */
describe('buildProfileCandidates — conflict', () => {
  it('multi-ECU: aynı sinyal birden çok ECU → manual review', () => {
    const out = buildProfileCandidates([mk({ pids: [cand({ pidOrDid: 'A5', ecuAddresses: ['7E8', '7E9'] })] })]);
    expect(out).toHaveLength(2); // ECU başına aday
    expect(out.every((c) => c.requiresManualReview)).toBe(true);
    expect(out[0].conflictReasons).toContain('multi-ecu');
    expect(out[0].mergeGroup).toBe(out[1].mergeGroup); // aynı merge grubu
  });

  it('çelişkili confidence: birleşen kaynak confidence farkı büyükse → manual review', () => {
    const out = buildProfileCandidates([
      mk({ pids: [cand({ pidOrDid: 'A5', ecuAddresses: ['7E8'], confidence: 0.5 })] }),
      mk({ pids: [cand({ pidOrDid: 'A5', ecuAddresses: ['7E8'], confidence: 0.95 })] }),
    ]);
    expect(out[0].conflictReasons).toContain('confidence-divergence'); // 0.45 > 0.3
    expect(out[0].requiresManualReview).toBe(true);
  });

  it('zaten katalogda (isKnownSignal) → manual review (aynı DID/PID farklı decode riski)', () => {
    const out = buildProfileCandidates(
      [mk({ dids: [cand({ pidOrDid: 'F190', source: 'DID', ecuAddresses: ['7E8'] })] })],
      { isKnownSignal: (_m, _s, id) => id === 'F190' },
    );
    expect(out[0].conflictReasons).toContain('already-cataloged');
    expect(out[0].requiresManualReview).toBe(true);
  });

  it('çakışmasız adaylar ETKİLENMİYOR (requiresManualReview=false, sebep yok)', () => {
    const out = buildProfileCandidates([mk({ pids: [cand({ pidOrDid: 'A5', ecuAddresses: ['7E8'] })] })]);
    expect(out[0].requiresManualReview).toBe(false);
    expect(out[0].conflictReasons).toEqual([]);
  });
});

/* ── Fail-soft + salt-okunur ──────────────────────────────────────────────── */
describe('buildProfileCandidates — fail-soft & salt-okunur', () => {
  it('boş / undefined / null liste → [] (fail-soft)', () => {
    expect(buildProfileCandidates([])).toEqual([]);
    expect(buildProfileCandidates(undefined)).toEqual([]);
    expect(buildProfileCandidates(null)).toEqual([]);
  });

  it('bozuk kayıt atlanır, geçerli işlenir', () => {
    const records = [null, { foo: 'bar' }, mk({ pids: [cand({ pidOrDid: 'A5' })] })] as unknown as ManufacturerKnowledge[];
    const out = buildProfileCandidates(records);
    expect(out).toHaveLength(1);
    expect(out[0].pidOrDid).toBe('A5');
  });

  it('girdi (ManufacturerKnowledge) DEĞİŞMİYOR', () => {
    const input = [mk({ pids: [cand({ pidOrDid: 'A5', ecuAddresses: ['7E8', '7E9'] })] })];
    const snap = JSON.parse(JSON.stringify(input));
    buildProfileCandidates(input);
    expect(input).toEqual(snap);
  });

  it('mevcut üretici profili (renaultDaciaProfile) DEĞİŞMİYOR', () => {
    const snap = JSON.parse(JSON.stringify(renaultDaciaProfile));
    buildProfileCandidates([mk({ pids: [cand({ pidOrDid: 'A5' })], dids: [cand({ pidOrDid: 'F190', source: 'DID' })] })]);
    expect(JSON.parse(JSON.stringify(renaultDaciaProfile))).toEqual(snap);
  });
});

/* ── Motor ────────────────────────────────────────────────────────────────── */
describe('ManufacturerProfileBuilder', () => {
  it('build + getManualReview + getClean ayrımı', () => {
    const source = () => [
      mk({ pids: [cand({ pidOrDid: 'A5', ecuAddresses: ['7E8'] })] }),          // temiz
      mk({ manufacturer: 'Ford', profileHint: 'Ford', pids: [cand({ pidOrDid: 'B0', ecuAddresses: ['7E8', '7E9'] })] }), // multi-ECU → review
    ];
    const b = new ManufacturerProfileBuilder(source);
    const all = b.build();
    expect(all.length).toBe(3); // Renault A5 + Ford B0 x2 ECU
    expect(b.getClean()).toHaveLength(1);
    expect(b.getManualReview()).toHaveLength(2);
  });

  it('reader hata fırlatırsa build() fail-soft [] döner', () => {
    const b = new ManufacturerProfileBuilder(() => { throw new Error('boom'); });
    expect(() => b.build()).not.toThrow();
    expect(b.getCandidates()).toEqual([]);
  });
});
