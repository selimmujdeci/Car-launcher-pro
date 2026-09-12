/**
 * discoveryFoundation.test — P0 Deep PID/DID Explorer Faz-1 · SAF çekirdek modüller.
 * Kapsam: discoveryState, discoverySafetyPolicy, discoveryValidator, pollingAdmissionGate,
 * discoveredDataRepository, discoveryEvidence.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  classifyDiscoveryOutcome, mergeDiscoveryStatus, isAutoAddEligible, isTerminalStatus,
} from '../platform/obd/discovery/discoveryState';
import {
  isReadOnlyServiceAllowed, canStartDeepScan, KwpCommandBudget,
  READ_ONLY_ALLOWED_SERVICES, HARD_FORBIDDEN_SERVICES,
} from '../platform/obd/discovery/discoverySafetyPolicy';
import {
  evaluateAutoAddGate, classifyByteLength, isSampleSetStable, type AutoAddGateInput,
} from '../platform/obd/discovery/discoveryValidator';
import {
  recommendPollClass, canAdmitNewDidPoll,
} from '../platform/obd/discovery/pollingAdmissionGate';
import {
  emitDiscoveryEvidence, getDiscoveryEvidence, _internals as evidenceInternals,
} from '../platform/obd/discovery/discoveryEvidence';

/* ── discoveryState ───────────────────────────────────────────────────────── */

describe('discoveryState — capabilityOutcome → DiscoveryStatus', () => {
  it('working + bilinen decoder → DECODER_KNOWN', () => {
    expect(classifyDiscoveryOutcome('working', true)).toBe('DECODER_KNOWN');
  });

  it('working + bilinmeyen decoder → DISCOVERED_UNKNOWN (uydurma yok)', () => {
    expect(classifyDiscoveryOutcome('working', false)).toBe('DISCOVERED_UNKNOWN');
  });

  it('#9 negatif yanıt (unsupported) → UNSUPPORTED, KALICI', () => {
    expect(classifyDiscoveryOutcome('unsupported', true)).toBe('UNSUPPORTED');
    expect(isTerminalStatus('UNSUPPORTED')).toBe(true);
  });

  it('#8 parse_error (yanlış byte uzunluğu / çözülemedi) → SUSPICIOUS', () => {
    expect(classifyDiscoveryOutcome('parse_error', true)).toBe('SUSPICIOUS');
  });

  it('security_required → REJECTED (kapsam dışı, bypass yok)', () => {
    expect(classifyDiscoveryOutcome('security_required', true)).toBe('REJECTED');
    expect(isTerminalStatus('REJECTED')).toBe(true);
  });

  it('#10 timeout araç hakkında KANIT DEĞİL → önceki durum KORUNUR (mergeDiscoveryStatus)', () => {
    expect(mergeDiscoveryStatus('VERIFIED', 'timeout', true)).toBe('VERIFIED');
    expect(mergeDiscoveryStatus(null, 'timeout', true)).toBe('TIMEOUT');
  });

  it('canlı kanıt hafızayı ezer (zero-trust — araç/ECU değişmiş olabilir)', () => {
    expect(mergeDiscoveryStatus('VERIFIED', 'unsupported', true)).toBe('UNSUPPORTED');
  });

  it('yalnız VERIFIED auto-add uygun', () => {
    expect(isAutoAddEligible('VERIFIED')).toBe(true);
    expect(isAutoAddEligible('DECODER_KNOWN')).toBe(false);
    expect(isAutoAddEligible('DISCOVERED_UNKNOWN')).toBe(false);
  });
});

/* ── discoverySafetyPolicy ────────────────────────────────────────────────── */

describe('discoverySafetyPolicy — read-only allowlist', () => {
  it('#3/#4 yalnız 01/22/21 izinli; yazma/aktüatör servisleri ASLA', () => {
    expect(isReadOnlyServiceAllowed('01')).toBe(true);
    expect(isReadOnlyServiceAllowed('22')).toBe(true);
    expect(isReadOnlyServiceAllowed('21')).toBe(true);
    for (const forbidden of ['04', '2E', '31', '27', '11', '14', '85', '2F']) {
      expect(isReadOnlyServiceAllowed(forbidden)).toBe(false);
    }
  });

  it('bilinmeyen/bozuk servis fail-closed reddedilir', () => {
    expect(isReadOnlyServiceAllowed('')).toBe(false);
    expect(isReadOnlyServiceAllowed(null)).toBe(false);
    expect(isReadOnlyServiceAllowed(undefined)).toBe(false);
    expect(isReadOnlyServiceAllowed('99')).toBe(false);
  });

  it('savunma derinliği: kara liste allowlist ile KESİŞMEZ', () => {
    for (const s of HARD_FORBIDDEN_SERVICES) expect(READ_ONLY_ALLOWED_SERVICES.has(s)).toBe(false);
  });
});

describe('discoverySafetyPolicy — hareket/sağlık kapısı', () => {
  it('#5 araç hareket ediyorsa (hız>0) taramaya İZİN YOK', () => {
    const d = canStartDeepScan({ connectionState: 'connected', source: 'real', dataFresh: true, speedKmh: 5 });
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('vehicle_moving');
  });

  it('fail-closed: hız BİLİNMİYORSA "duruyor" varsayılmaz', () => {
    const d = canStartDeepScan({ connectionState: 'connected', source: 'real', dataFresh: true, speedKmh: null });
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('speed_unknown');
  });

  it('sağlıksız oturumda (bayat/mock/bağlı değil) taramaya İZİN YOK', () => {
    expect(canStartDeepScan({ connectionState: 'reconnecting', source: 'none', dataFresh: false, speedKmh: 0 }).allowed).toBe(false);
    expect(canStartDeepScan({ connectionState: 'connected', source: 'mock', dataFresh: true, speedKmh: 0 }).allowed).toBe(false);
    expect(canStartDeepScan({ connectionState: 'connected', source: 'real', dataFresh: false, speedKmh: 0 }).allowed).toBe(false);
  });

  it('sağlıklı + park (hız=0) → İZİNLİ', () => {
    const d = canStartDeepScan({ connectionState: 'connected', source: 'real', dataFresh: true, speedKmh: 0 });
    expect(d).toEqual({ allowed: true, reason: 'ok' });
  });
});

describe('#13 KwpCommandBudget — komut bütçesi aşılmaz', () => {
  it('maxCommands aşılınca tryConsume false döner', () => {
    const t = 0;
    const budget = new KwpCommandBudget(3, 60_000, () => t);
    expect(budget.tryConsume()).toBe(true);
    expect(budget.tryConsume()).toBe(true);
    expect(budget.tryConsume()).toBe(true);
    expect(budget.tryConsume()).toBe(false); // 4. komut REDDEDİLİR
    expect(budget.remaining).toBe(0);
  });

  it('pencere dolunca sayaç sıfırlanır (yeni bütçe)', () => {
    let t = 0;
    const budget = new KwpCommandBudget(2, 1_000, () => t);
    expect(budget.tryConsume()).toBe(true);
    expect(budget.tryConsume()).toBe(true);
    expect(budget.tryConsume()).toBe(false);
    t = 1_001; // pencere doldu
    expect(budget.tryConsume()).toBe(true);
  });

  it('geçersiz parametrelerle kurulamaz (fail-fast — programlama hatası)', () => {
    expect(() => new KwpCommandBudget(0, 1000)).toThrow();
    expect(() => new KwpCommandBudget(1, 0)).toThrow();
  });
});

/* ── discoveryValidator ───────────────────────────────────────────────────── */

function fullyEligibleInput(): AutoAddGateInput {
  return {
    positiveEcuResponse: true, requestEchoValid: true, byteLengthMatches: true,
    decoderRegistered: true, unitScaleKnown: true, valueInPhysicalRange: true,
    stableAcrossSamples: true, noCrossTalk: true, notStaleOrCached: true, safetyGateAllowed: true,
  };
}

describe('discoveryValidator — 10-koşul VERIFIED/auto-add kapısı (§D)', () => {
  it('#7 tüm 10 koşul sağlanırsa eligible:true', () => {
    const r = evaluateAutoAddGate(fullyEligibleInput());
    expect(r.eligible).toBe(true);
    expect(r.failedConditions).toEqual([]);
  });

  it('tek bir koşul bile eksikse eligible:false + dürüst gerekçe', () => {
    const r = evaluateAutoAddGate({ ...fullyEligibleInput(), byteLengthMatches: false });
    expect(r.eligible).toBe(false);
    expect(r.failedConditions).toEqual(['byteLengthMatches']);
  });

  it('#15 stale/replay yanıt (notStaleOrCached:false) ASLA VERIFIED olamaz', () => {
    const r = evaluateAutoAddGate({ ...fullyEligibleInput(), notStaleOrCached: false });
    expect(r.eligible).toBe(false);
    expect(r.failedConditions).toContain('notStaleOrCached');
  });

  it('safety gate reddederse (koşul 10) eligible:false', () => {
    const r = evaluateAutoAddGate({ ...fullyEligibleInput(), safetyGateAllowed: false });
    expect(r.eligible).toBe(false);
  });

  it('#8 kısa byte uzunluğu SUSPICIOUS sınıflandırmasına işaret eder (too_short)', () => {
    expect(classifyByteLength(4, 2)).toBe('too_short');
    expect(classifyByteLength(4, 4)).toBe('ok');
    expect(classifyByteLength(4, 6)).toBe('ok'); // fazla bayt tolere edilir
  });

  it('bağımsız örnek kararlılığı: yakın değerler kararlı, uzak değerler DEĞİL', () => {
    expect(isSampleSetStable([90, 91])).toBe(true);
    expect(isSampleSetStable([90, 200])).toBe(false);
    expect(isSampleSetStable([90])).toBe(false); // tek örnek yetmez
  });
});

/* ── pollingAdmissionGate ─────────────────────────────────────────────────── */

describe('pollingAdmissionGate — §E', () => {
  it('yalnız VERIFIED SLOW/ON_DEMAND alır; gerisi DISCOVERY_ONLY, FAST ASLA', () => {
    expect(recommendPollClass({ status: 'VERIFIED', protocolClass: 'can' })).toBe('SLOW');
    expect(recommendPollClass({ status: 'VERIFIED', protocolClass: 'kwp' })).toBe('ON_DEMAND');
    expect(recommendPollClass({ status: 'DECODER_KNOWN', protocolClass: 'can' })).toBe('DISCOVERY_ONLY');
    expect(recommendPollClass({ status: 'DISCOVERED_UNKNOWN', protocolClass: 'can' })).toBe('DISCOVERY_ONLY');
  });

  it('çekirdek poll bütçesi bozulduysa yeni DID kabul edilmez', () => {
    expect(canAdmitNewDidPoll({ activeDiscoveryDidCount: 0, maxConcurrentNewDids: 3, corePollingBudgetOk: false })).toBe(false);
  });

  it('tavan aşılınca yeni DID kabul edilmez (bounded)', () => {
    expect(canAdmitNewDidPoll({ activeDiscoveryDidCount: 3, maxConcurrentNewDids: 3, corePollingBudgetOk: true })).toBe(false);
    expect(canAdmitNewDidPoll({ activeDiscoveryDidCount: 2, maxConcurrentNewDids: 3, corePollingBudgetOk: true })).toBe(true);
  });
});

/* ── discoveryEvidence ────────────────────────────────────────────────────── */

describe('discoveryEvidence — bounded tek-satır kanıt', () => {
  beforeEach(() => {
    evidenceInternals.reset();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('emit sonrası halkada görünür + kimlik maskelenir', () => {
    emitDiscoveryEvidence({ type: 'PID_DID_DISCOVERY_START', vehicleFingerprint: 'abcdef1234567890' });
    const all = getDiscoveryEvidence();
    expect(all).toHaveLength(1);
    expect(all[0]!.vehicleFingerprint).toBe('abcdef…');
    expect(all[0]!.vehicleFingerprint).not.toContain('1234567890'); // ham hash sızmaz
  });

  it('halka bounded — tavanı aşan girişler en eskiyi düşürür', () => {
    for (let i = 0; i < 200; i++) emitDiscoveryEvidence({ type: 'PID_DID_DISCOVERY_RESPONSE' });
    expect(getDiscoveryEvidence().length).toBeLessThanOrEqual(128);
  });
});
