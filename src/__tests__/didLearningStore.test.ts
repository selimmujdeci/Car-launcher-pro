/**
 * didLearningStore.test — öğrenilen DID terfi kuralları ve profil çıktısı.
 */
import { describe, it, expect } from 'vitest';
import {
  emptyRecord, makeEcuKey, mergeSessionMatch, provenProfileFragment,
} from '../platform/obd/didLearning/didLearningStore';
import type { MatchResult } from '../platform/obd/didLearning/semanticMatcher';

const proven = (over: Partial<MatchResult> = {}): MatchResult => ({
  ref: 'rpm', signed: false, k: 0.25, o: 0, snapped: true, r: 0.999, n: 60, rms: 5, refSpan: 700,
  exactEquality: false, status: 'SESSION_PROVEN', ...over,
});

const rec = () => emptyRecord(makeEcuKey('7E8', '237100942S', 'A600', null), '7E0', '7E8', '237100942S', 'A600');

describe('terfi kuralı', () => {
  it('ECU anahtarı parça no + yazılım; parça yoksa VIN-hash ile araç özelinde kalır', () => {
    expect(makeEcuKey('7E8', '237100942S', 'A600', 'abc')).toBe('7E8|237100942S|A600');
    expect(makeEcuKey('7E8', null, null, 'abc')).toBe('7E8|vin:abc');
  });

  it('tek oturum ölçekli kanıt → yalnız CANDIDATE', () => {
    const r = rec();
    expect(mergeSessionMatch(r, '2002', 2, 'ANALOG', proven(), 's1', '0D5B').status).toBe('CANDIDATE');
  });

  it('🔒 iki FARKLI oturum aynı (ref,k,o) → PROVEN', () => {
    const r = rec();
    mergeSessionMatch(r, '2002', 2, 'ANALOG', proven(), 's1', '0D5B');
    const d = mergeSessionMatch(r, '2002', 2, 'ANALOG', proven(), 's2', '0D60');
    expect(d.status).toBe('PROVEN');
    expect(d.proven).toMatchObject({ ref: 'rpm', k: 0.25, o: 0 });
  });

  it('aynı oturum iki kez sayılmaz', () => {
    const r = rec();
    mergeSessionMatch(r, '2002', 2, 'ANALOG', proven(), 's1', '0D5B');
    expect(mergeSessionMatch(r, '2002', 2, 'ANALOG', proven(), 's1', '0D5B').status).toBe('CANDIDATE');
  });

  it('🔒 birebir eşitlik (saha 20A5 = PID 31) tek oturumda PROVEN', () => {
    const r = rec();
    const d = mergeSessionMatch(r, '20A5', 2, 'COUNTER', proven({ ref: 'distSinceClear', k: 1, o: 0, exactEquality: true }), 's1', '12A6');
    expect(d.status).toBe('PROVEN');
  });

  it('🔒 çelişen oturum (başka referansa kanıt) → AMBIGUOUS, anlam geri çekilir', () => {
    const r = rec();
    mergeSessionMatch(r, '2001', 2, 'ANALOG', proven({ ref: 'coolant', k: 0.1, o: -273.15 }), 's1', '0E70');
    mergeSessionMatch(r, '2001', 2, 'ANALOG', proven({ ref: 'coolant', k: 0.1, o: -273.15 }), 's2', '0E72');
    const d = mergeSessionMatch(r, '2001', 2, 'ANALOG', proven({ ref: 'oil', k: 0.1, o: -273.15 }), 's3', '0E74');
    expect(d.status).toBe('AMBIGUOUS');
    expect(d.proven).toBeNull();
    expect(d.ambiguousWith).toBe('coolant');
  });

  it('farklı ölçekli iki oturum → PROVEN değil', () => {
    const r = rec();
    mergeSessionMatch(r, '2002', 2, 'ANALOG', proven({ k: 0.25 }), 's1', '0D5B');
    expect(mergeSessionMatch(r, '2002', 2, 'ANALOG', proven({ k: 0.125 }), 's2', '0D5B').status).toBe('CANDIDATE');
  });
});

describe('profil çıktısı', () => {
  it('yalnız PROVEN + işaretsiz DID profile girer; ad "öğrenildi" damgalı', () => {
    const r = rec();
    mergeSessionMatch(r, '20A5', 2, 'COUNTER', proven({ ref: 'distSinceClear', k: 1, o: 0, exactEquality: true }), 's1', '12A6');
    mergeSessionMatch(r, '2002', 2, 'ANALOG', proven(), 's1', '0D5B'); // tek oturum → dışarıda
    mergeSessionMatch(r, '2064', 2, 'ANALOG', proven({ signed: true, ref: 'map', k: 0.1, o: 0, exactEquality: true }), 's1', 'FF00');
    const f = provenProfileFragment(r);
    expect(f.dids.map((d) => d.did)).toEqual(['20A5']);
    expect(f.dids[0]!.name).toContain('öğrenildi');
    expect(f.dids[0]!.decode).toEqual({ fn: 'linear', a: 1, b: 0 });
    expect(f.ecus[0]).toMatchObject({ tx: '7E0', rx: '7E8' });
  });
});
