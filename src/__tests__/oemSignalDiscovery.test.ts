/**
 * oemSignalDiscovery.test — OEM DISCOVERY FAZ 1.
 *
 * Kapsam: OEM sinyal kataloğu sözleşmesi · 6 durumlu yetenek kanıt modeli ·
 *         salt-okuma keşif koordinatörü · kapsam/tazelik kapıları · poll kararı ·
 *         kalıcılık dikişi · LAB anlık görüntüsü.
 *
 * ARAÇ YOK: bu dosya YALNIZ kod davranışını kanıtlar (CODE PASS). Hiçbir testi
 * "araç DPF destekliyor" gibi bir saha iddiasına dayanak yapılamaz.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const _store = new Map<string, string>();
vi.mock('../utils/safeStorage', () => ({
  safeGetRaw: (k: string) => _store.get(k) ?? null,
  safeSetRaw: (k: string, v: string) => { _store.set(k, v); },
}));

import {
  validateOemSignalCatalog, oemSignalConfidence, isOemSignalProbeable, isOemSignalDecodable,
  oemSignalMatchesScope, compileOemSignal, oemSignalToDidCandidate,
  type OemSignalDef, type OemSignalEcuBinding,
} from '../platform/obd/oem/oemSignalCatalog';
import { OEM_SIGNAL_CATALOG, validateOemSignalRegistry } from '../platform/obd/oem/oemSignalRegistry';
import {
  mergeOemCapability, decideOemPoll, decodeOemResponse, shouldReprobeOemSignal,
  emptyOemEvidence, classifyOemCapability, OEM_SUPPORTED_TTL_MS,
  type OemCapabilityEvidence, type OemCapabilityScope,
} from '../platform/obd/oem/oemCapabilityEvidence';
import { readOemEvidence, persistOemEvidence, oemStateToDiscoveryStatus } from '../platform/obd/oem/oemCapabilityCache';
import {
  planOemProbes, runOemDiscovery, discoverOemSignals,
  type OemDiscoveryContext,
} from '../platform/obd/oem/oemDiscoveryCoordinator';
import { buildOemSignalLabSnapshot } from '../platform/devtools/oemSignalLabModel';
import { CANONICAL_OBD_SIGNALS } from '../platform/obd/canonicalObdSignals';
import type { ReadObdDidResult } from '../platform/obd/discovery/readOnlyDidScanner';
import type { DiscoveryHealthSnapshot } from '../platform/obd/discovery/discoverySafetyPolicy';

/* ══════════════════════════════════════════════════════════════════════════
 * Ortak fikstürler — gerçek kataloğun HİÇBİR kimliği kanıtlanmadığı için
 * (hepsi 'UNKNOWN') sorgulama yolunu sınamak üzere TEST-ÖZEL sinyal kullanılır.
 * Bu, ürün kataloğuna sahte kimlik yazmamak için bilinçli ayrımdır.
 * ════════════════════════════════════════════════════════════════════════ */

const ECU: OemSignalEcuBinding = { ecuId: 'engine', ecuName: 'Motor ECU', tx: '7E0', rx: '7E8' };

function testSignal(over: Partial<OemSignalDef> = {}): OemSignalDef {
  return {
    signalId: 'DPF_SOOT_LOAD',
    name: 'DPF kurum yükü (test)',
    group: 'dpf',
    scope: { manufacturer: 'TESTCO', modelFamily: 'UNKNOWN', wmi: ['VF1'], protocols: ['can'] },
    ecuRole: 'engine',
    service: '22',
    identifier: '2266',
    addressing: 'can11',
    session: 'default',
    decode: { fn: 'A' },
    bytes: 1,
    unit: '%',
    plausibility: { min: 0, max: 100 },
    provenance: { kind: 'iso_standard', source: 'test kaynağı', license: 'test' },
    identifierEvidence: { verifiedOn: null, evidence: null },
    access: 'read_only',
    standardEquivalent: null,
    note: 'test sinyali',
    ...over,
  } as OemSignalDef;
}

const SCOPE: OemCapabilityScope = { vehicleFingerprint: 'fpAAA', protocolClass: 'can', ecuAddress: '7E8' };

const HEALTHY: DiscoveryHealthSnapshot = {
  connectionState: 'connected', source: 'real', dataFresh: true, speedKmh: 0,
};

function ctx(over: Partial<OemDiscoveryContext> = {}): OemDiscoveryContext {
  return {
    vehicleFingerprint: 'fpAAA',
    protocolClass: 'can',
    wmi: 'VF1',
    vinHash: 'fpAAA',
    ecuByRole: new Map([['engine', ECU]]),
    ...over,
  };
}

/** Deterministik saat — testlerde `Date.now` sürüklenmesi olmasın. */
function fixedNow(t = 1_000_000): () => number {
  return () => t;
}

const noSleep = async (): Promise<void> => { /* test: gecikme yok */ };

beforeEach(() => {
  _store.clear();
});

/* ══════════════════════════════════════════════════════════════════════════
 * 0) KATALOG SÖZLEŞMESİ + DÜRÜSTLÜK KİLİTLERİ
 * ════════════════════════════════════════════════════════════════════════ */

describe('OEM sinyal kataloğu — sözleşme kilitleri', () => {
  it('ürün defteri yapısal olarak geçerlidir', () => {
    const r = validateOemSignalRegistry();
    expect(r.valid, r.valid ? '' : (r as { errors: string[] }).errors.join(' | ')).toBe(true);
  });

  it('defterdeki HİÇBİR kimlik uydurulmamıştır — hepsi UNKNOWN (araç kanıtı yok)', () => {
    for (const def of OEM_SIGNAL_CATALOG) {
      expect(def.identifier).toBe('UNKNOWN');
      expect(def.identifierEvidence.verifiedOn).toBeNull();
      expect(oemSignalConfidence(def)).toBe('UNKNOWN');
      expect(isOemSignalProbeable(def)).toBe(false);
    }
  });

  it('katalog yalnız salt-okuma servisi kabul eder — yazma/aktüatör servisi REDDEDİLİR', () => {
    for (const service of ['2E', '31', '27', '11', '04']) {
      const r = validateOemSignalCatalog([
        testSignal({ service: service as never, identifier: '2266' }),
      ]);
      expect(r.valid).toBe(false);
    }
  });

  it('kimlik UNKNOWN iken doğrulama damgası yazılamaz (kanıtsız "doğrulandı" yasak)', () => {
    const r = validateOemSignalCatalog([
      testSignal({
        identifier: 'UNKNOWN', service: 'UNKNOWN', addressing: 'UNKNOWN',
        identifierEvidence: { verifiedOn: '2026-09-13', evidence: 'gerçekten okundu diyorum' },
      }),
    ]);
    expect(r.valid).toBe(false);
  });

  it('güven seviyesi YAZILMAZ, türetilir: kanıt gelince FIELD_CONFIRMED olur', () => {
    expect(oemSignalConfidence(testSignal())).toBe('DECLARED');
    expect(oemSignalConfidence(testSignal({
      identifierEvidence: { verifiedOn: '2026-09-13', evidence: '2266 → %42, gösterge %42 (iki nokta)' },
    }))).toBe('FIELD_CONFIRMED');
    expect(oemSignalConfidence(testSignal({ decode: null, bytes: null }))).toBe('UNKNOWN');
  });

  it('kapsam kapısı fail-closed: protokol/WMI bilinmiyorsa sinyal UYGULANMAZ', () => {
    const def = testSignal();
    expect(oemSignalMatchesScope(def, { wmi: 'VF1', protocolClass: 'can' })).toBe(true);
    expect(oemSignalMatchesScope(def, { wmi: 'VF1', protocolClass: 'kwp' })).toBe(false);
    expect(oemSignalMatchesScope(def, { wmi: null, protocolClass: 'can' })).toBe(false);
    expect(oemSignalMatchesScope(def, { wmi: 'VF1', protocolClass: null })).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * TEST 10 — çift sinyal otoritesi oluşmaz
 * ════════════════════════════════════════════════════════════════════════ */

describe('10) çift otorite yasağı', () => {
  it('aynı signalId iki kez tanımlanamaz', () => {
    const r = validateOemSignalCatalog([testSignal(), testSignal()]);
    expect(r.valid).toBe(false);
    expect((r as { errors: string[] }).errors.join(' ')).toMatch(/YİNELENEN/);
  });

  it('aynı (marka·rol·servis·kimlik) ikinci bir sinyal kimliğine bağlanamaz', () => {
    const r = validateOemSignalCatalog([
      testSignal({ signalId: 'DPF_SOOT_LOAD' }),
      testSignal({ signalId: 'DPF_DIFFERENTIAL_PRESSURE' }), // aynı 2266 · aynı marka · aynı rol
    ]);
    expect(r.valid).toBe(false);
    expect((r as { errors: string[] }).errors.join(' ')).toMatch(/çift otorite/);
  });

  it('OEM sinyal kimlikleri kanonik standart OBD anahtarlarıyla ÇAKIŞMAZ', () => {
    const canonicalKeys = new Set(CANONICAL_OBD_SIGNALS.map((s) => String(s.key)));
    for (const def of OEM_SIGNAL_CATALOG) {
      expect(canonicalKeys.has(def.signalId)).toBe(false);
    }
  });

  it('standart eşdeğeri OKUNABİLİYORSA OEM sinyali poll EDİLMEZ (kanonik sahip standarttır)', () => {
    const def = testSignal({ standardEquivalent: 'dpfTempBank1' });
    const supported: OemCapabilityEvidence = {
      ...emptyOemEvidence('DPF_SOOT_LOAD', SCOPE, 1_000_000),
      state: 'SUPPORTED', decoderStatus: 'OK', lastPositiveAt: 1_000_000,
    };
    const base = {
      def, evidence: supported, scope: SCOPE, nowMs: 1_000_000,
      sessionHealthy: true, corePollingBudgetOk: true,
      activeOemPollCount: 0, maxConcurrentOemPolls: 3,
    };
    expect(decideOemPoll({ ...base, standardEquivalentAvailable: true }).reason).toBe('standard_owner');
    expect(decideOemPoll({ ...base, standardEquivalentAvailable: false }).eligible).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * TEST 1-3, 7-8 — ham sonuç → yetenek durumu
 * ════════════════════════════════════════════════════════════════════════ */

describe('yetenek durumu sınıflandırması', () => {
  const obs = (over: Partial<Parameters<typeof mergeOemCapability>[1]>) => ({
    signalId: 'DPF_SOOT_LOAD' as const, scope: SCOPE, outcome: 'working' as const,
    nrc: null, decoderStatus: 'OK' as const, nowMs: 1_000_000, ...over,
  });

  it('1) pozitif yanıt → SUPPORTED (+ son pozitif an kaydedilir)', () => {
    const ev = mergeOemCapability(null, obs({}));
    expect(ev.state).toBe('SUPPORTED');
    expect(ev.lastPositiveAt).toBe(1_000_000);
    expect(ev.timeoutCount).toBe(0);
  });

  it('2) açık NRC 7F-31 (requestOutOfRange) → UNSUPPORTED', () => {
    expect(classifyOemCapability('unsupported')).toBe('UNSUPPORTED');
    const ev = mergeOemCapability(null, obs({ outcome: 'unsupported', nrc: 0x31, decoderStatus: 'NOT_ATTEMPTED' }));
    expect(ev.state).toBe('UNSUPPORTED');
    expect(ev.lastNrc).toBe(0x31);
  });

  it('2b) SecurityAccess reddi de KALICI okunamazdır ama gerçek sebep KAYBOLMAZ', () => {
    const ev = mergeOemCapability(null, obs({ outcome: 'security_required', nrc: 0x33, decoderStatus: 'NOT_ATTEMPTED' }));
    expect(ev.state).toBe('UNSUPPORTED');
    expect(ev.lastOutcome).toBe('security_required');
  });

  it('3) timeout UNSUPPORTED DEĞİLDİR — kanıt sayılmaz, önceki durum korunur', () => {
    expect(classifyOemCapability('timeout')).toBeNull();

    const fresh = mergeOemCapability(null, obs({ outcome: 'timeout', decoderStatus: 'NOT_ATTEMPTED' }));
    expect(fresh.state).toBe('UNKNOWN');
    expect(fresh.state).not.toBe('UNSUPPORTED');
    expect(fresh.timeoutCount).toBe(1);

    const supported = mergeOemCapability(null, obs({}));
    const afterTimeout = mergeOemCapability(supported, obs({ outcome: 'timeout', nowMs: 1_000_500, decoderStatus: 'NOT_ATTEMPTED' }));
    expect(afterTimeout.state).toBe('SUPPORTED');      // hat hatası yeteneği SİLMEZ
    expect(afterTimeout.timeoutCount).toBe(1);
  });

  it('3b) NO DATA / koşul sağlanmadı → TEMPORARILY_UNAVAILABLE (kalıcı eleme YOK)', () => {
    expect(classifyOemCapability('no_data')).toBe('TEMPORARILY_UNAVAILABLE');
    expect(classifyOemCapability('condition_required')).toBe('TEMPORARILY_UNAVAILABLE');
  });

  it('7) bozuk/eksik yanıt fail-closed: ERROR + değer ÜRETİLMEZ', () => {
    const compiled = compileOemSignal(testSignal(), ECU)!;
    expect(decodeOemResponse(compiled, null)).toEqual({ value: null, status: 'PARSE_ERROR' });
    expect(decodeOemResponse(compiled, 'ZZ')).toEqual({ value: null, status: 'PARSE_ERROR' });
    expect(decodeOemResponse(compiled, '')).toEqual({ value: null, status: 'PARSE_ERROR' });

    const ev = mergeOemCapability(null, obs({ decoderStatus: 'PARSE_ERROR' }));
    expect(ev.state).toBe('ERROR');
  });

  it('8) makullük bandı dışı çözüm REDDEDİLİR ve kanıt ERROR seviyesine DÜŞER', () => {
    const compiled = compileOemSignal(testSignal(), ECU)!; // bant 0..100, decode A
    expect(decodeOemResponse(compiled, '2A')).toEqual({ value: 42, status: 'OK' });

    const out = decodeOemResponse(compiled, 'FF'); // 255 → bant dışı
    expect(out.value).toBeNull();
    expect(out.status).toBe('IMPLAUSIBLE');

    const ev = mergeOemCapability(null, obs({ decoderStatus: 'IMPLAUSIBLE' }));
    expect(ev.state).toBe('ERROR');                 // pozitif yanıt geldi ama "çalışıyor" DENMEZ
    expect(ev.lastPositiveAt).toBe(1_000_000);      // yetenek kanıtı da kaybolmaz
  });

  it('çözücüsü olmayan sinyalde pozitif yanıt YETENEK kanıtıdır ama DEĞER üretmez', () => {
    const def = testSignal({ decode: null, bytes: null });
    expect(isOemSignalDecodable(def)).toBe(false);
    expect(compileOemSignal(def, ECU)).toBeNull();
    expect(decodeOemResponse(null, '2A')).toEqual({ value: null, status: 'NO_DECODER' });

    const ev = mergeOemCapability(null, obs({ decoderStatus: 'NO_DECODER' }));
    expect(ev.state).toBe('SUPPORTED');
    expect(ev.decoderStatus).toBe('NO_DECODER');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * TEST 4 — kapsam değişimi: eski kanıt otorite DEĞİLDİR
 * ════════════════════════════════════════════════════════════════════════ */

describe('4) kapsam (parmak izi / protokol / ECU) değişirse eski kanıt otorite olmaz', () => {
  const supported: OemCapabilityEvidence = {
    ...emptyOemEvidence('DPF_SOOT_LOAD', SCOPE, 1_000_000),
    state: 'SUPPORTED', decoderStatus: 'OK', lastPositiveAt: 1_000_000,
  };

  it('protokol değişince birleştirme önceki kanıtı ATAR', () => {
    const kwpScope: OemCapabilityScope = { ...SCOPE, protocolClass: 'kwp' };
    const ev = mergeOemCapability(supported, {
      signalId: 'DPF_SOOT_LOAD', scope: kwpScope, outcome: 'timeout',
      nrc: null, decoderStatus: 'NOT_ATTEMPTED', nowMs: 1_000_100,
    });
    expect(ev.scope.protocolClass).toBe('kwp');
    expect(ev.state).toBe('UNKNOWN');   // CAN'deki "SUPPORTED" KWP hattına TAŞINMAZ
  });

  it('araç parmak izi ya da ECU adresi değişince yeniden yoklanır', () => {
    expect(shouldReprobeOemSignal(supported, SCOPE, 1_000_100)).toBe(false);
    expect(shouldReprobeOemSignal(supported, { ...SCOPE, vehicleFingerprint: 'fpBBB' }, 1_000_100)).toBe(true);
    expect(shouldReprobeOemSignal(supported, { ...SCOPE, ecuAddress: '7E9' }, 1_000_100)).toBe(true);
  });

  it('poll kararı kapsam uyuşmazlığında REDDEDER', () => {
    const d = decideOemPoll({
      def: testSignal(), evidence: supported, scope: { ...SCOPE, protocolClass: 'kwp' },
      nowMs: 1_000_100, standardEquivalentAvailable: false, sessionHealthy: true,
      corePollingBudgetOk: true, activeOemPollCount: 0, maxConcurrentOemPolls: 3,
    });
    expect(d.eligible).toBe(false);
    expect(d.reason).toBe('scope_mismatch');
  });

  it('bayat kanıt otorite değildir — TTL sonrası poll reddedilir ve yeniden yoklanır', () => {
    const later = 1_000_000 + OEM_SUPPORTED_TTL_MS + 1;
    expect(shouldReprobeOemSignal(supported, SCOPE, later)).toBe(true);
    const d = decideOemPoll({
      def: testSignal(), evidence: supported, scope: SCOPE, nowMs: later,
      standardEquivalentAvailable: false, sessionHealthy: true,
      corePollingBudgetOk: true, activeOemPollCount: 0, maxConcurrentOemPolls: 3,
    });
    expect(d.reason).toBe('stale_evidence');
  });

  it('kalıcı kayıt da kapsam dışında OKUNMAZ (protokol değişti → null)', () => {
    const def = testSignal();
    persistOemEvidence({
      def, evidence: { ...supported, decoderStatus: 'OK' },
      rawRequestSample: '222266', rawResponseSample: '2A', latencyMs: 90,
      recommendedPollClass: 'DISCOVERY_ONLY', decoderId: 'DPF_SOOT_LOAD', vinHash: 'fpAAA',
    });
    expect(readOemEvidence(def, SCOPE)?.state).toBe('SUPPORTED');
    expect(readOemEvidence(def, { ...SCOPE, protocolClass: 'kwp' })).toBeNull();
    expect(readOemEvidence(def, { ...SCOPE, ecuAddress: '7E9' })).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * TEST 5-6, 9 — poll uygunluğu ve çekirdek telemetri koruması
 * ════════════════════════════════════════════════════════════════════════ */

describe('poll uygunluk kapısı', () => {
  const base = {
    def: testSignal(), scope: SCOPE, nowMs: 1_000_000,
    standardEquivalentAvailable: false, sessionHealthy: true,
    corePollingBudgetOk: true, activeOemPollCount: 0, maxConcurrentOemPolls: 3,
  };
  const supported: OemCapabilityEvidence = {
    ...emptyOemEvidence('DPF_SOOT_LOAD', SCOPE, 1_000_000),
    state: 'SUPPORTED', decoderStatus: 'OK', lastPositiveAt: 1_000_000,
  };

  it('5) DESTEKLENMEYEN sinyal poll EDİLMEZ', () => {
    const unsupported: OemCapabilityEvidence = { ...supported, state: 'UNSUPPORTED', decoderStatus: 'NOT_ATTEMPTED' };
    expect(decideOemPoll({ ...base, evidence: unsupported })).toMatchObject({ eligible: false, reason: 'not_supported' });
    expect(decideOemPoll({ ...base, evidence: null })).toMatchObject({ eligible: false, reason: 'not_supported' });
    expect(decideOemPoll({ ...base, evidence: { ...supported, state: 'TEMPORARILY_UNAVAILABLE' } }).eligible).toBe(false);
    expect(decideOemPoll({ ...base, evidence: { ...supported, state: 'ERROR' } }).eligible).toBe(false);
  });

  it('5b) kimliği bilinmeyen katalog kaydı hiçbir koşulda poll edilemez', () => {
    for (const def of OEM_SIGNAL_CATALOG) {
      const d = decideOemPoll({ ...base, def, evidence: supported });
      expect(d.eligible).toBe(false);
      expect(d.reason).toBe('not_probeable');
    }
  });

  it('6) DESTEKLENEN sinyal bütçe kapısından geçerek poll edilir', () => {
    const d = decideOemPoll({ ...base, evidence: supported });
    expect(d.eligible).toBe(true);
    expect(d.reason).toBe('ok');
  });

  it('6b) eşzamanlılık tavanı dolunca REDDEDİLİR (bounded)', () => {
    const d = decideOemPoll({ ...base, evidence: supported, activeOemPollCount: 3, maxConcurrentOemPolls: 3 });
    expect(d).toMatchObject({ eligible: false, reason: 'budget_exhausted' });
  });

  it('9) çekirdek (RPM/hız) poll bütçesi bozulmuşsa OEM sinyali ASLA poll edilmez', () => {
    const d = decideOemPoll({ ...base, evidence: supported, corePollingBudgetOk: false });
    expect(d).toMatchObject({ eligible: false, reason: 'budget_exhausted' });
  });

  it('9b) 10-koşul kapısı geçilmeden OEM sinyali SÜREKLİ poll hattına giremez', () => {
    // Kapı geçilmedi → yalnız keşif/talep turu (sürekli poll listesine EKLENMEZ).
    expect(decideOemPoll({ ...base, evidence: supported }).pollClass).toBe('DISCOVERY_ONLY');
  });

  it('9c) kapı geçilse bile OEM sinyali FAST/NORMAL sınıfı ALAMAZ — çekirdek kadansa dokunamaz', () => {
    const can = decideOemPoll({ ...base, evidence: supported, autoAddGatePassed: true });
    expect(can.pollClass).toBe('SLOW');
    const kwp = decideOemPoll({
      ...base, autoAddGatePassed: true,
      evidence: { ...supported, scope: { ...SCOPE, protocolClass: 'kwp' } },
      scope: { ...SCOPE, protocolClass: 'kwp' },
    });
    expect(kwp.pollClass).toBe('ON_DEMAND');
    for (const d of [can, kwp]) {
      expect(d.pollClass).not.toBe('FAST');
      expect(d.pollClass).not.toBe('NORMAL');
    }
  });

  it('oturum sağlıksızsa poll edilmez', () => {
    expect(decideOemPoll({ ...base, evidence: supported, sessionHealthy: false }))
      .toMatchObject({ eligible: false, reason: 'session_unhealthy' });
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * KOORDİNATÖR — kör tarama yok, güvenlik kapısı, uçtan uca kanıt
 * ════════════════════════════════════════════════════════════════════════ */

describe('OEM keşif koordinatörü', () => {
  it('ürün kataloğu ile HİÇBİR sorgu üretilmez (kimlik kanıtı yok → araca gidilmez)', async () => {
    const readObdDid = vi.fn<[], Promise<ReadObdDidResult>>();
    const plan = planOemProbes({ context: ctx(), nowMs: 1_000_000 });
    expect(plan.probes).toHaveLength(0);
    expect(plan.skipped.every((s) => s.reason === 'identifier_unknown' || s.reason === 'scope_mismatch')).toBe(true);

    const run = await runOemDiscovery(plan, ctx(), {
      readObdDid: readObdDid as never, getHealthSnapshot: () => HEALTHY, now: fixedNow(), sleep: noSleep,
    });
    expect(run.stopReason).toBe('no_probes');
    expect(readObdDid).not.toHaveBeenCalled();
  });

  it('rol için doğrulanmış ECU adresi yoksa sinyal sorgulanmaz (adres uydurulmaz)', () => {
    const plan = planOemProbes({
      context: ctx({ ecuByRole: new Map() }), nowMs: 1_000_000,
      catalog: [testSignal()], readEvidence: () => null,
    });
    expect(plan.probes).toHaveLength(0);
    expect(plan.skipped[0]?.reason).toBe('no_ecu_binding');
  });

  it('1) uçtan uca: pozitif yanıt → SUPPORTED + değer çözülür + kalıcı kayıt yazılır', async () => {
    const readObdDid = vi.fn(async () => ({ data: '2A', supported: true, kind: 'OK' as const, nrc: null }));
    const out = await discoverOemSignals(ctx(), {
      readObdDid, getHealthSnapshot: () => HEALTHY, now: fixedNow(), sleep: noSleep,
    }, { catalog: [testSignal()] });

    expect(out.stopReason).toBe('completed');
    expect(readObdDid).toHaveBeenCalledWith({ tx: '7E0', rx: '7E8', did: '2266', service: '22' });
    expect(out.results[0]!.evidence.state).toBe('SUPPORTED');
    expect(out.results[0]!.decode).toEqual({ value: 42, status: 'OK' });
    expect(readOemEvidence(testSignal(), SCOPE)?.state).toBe('SUPPORTED');
  });

  it('2) 7F-31 → UNSUPPORTED ve bir daha PLANA ALINMAZ (kalıcı)', async () => {
    const readObdDid = vi.fn(async () => ({ data: null, supported: false, kind: 'NEG_7F' as const, nrc: 0x31 }));
    const first = await discoverOemSignals(ctx(), {
      readObdDid, getHealthSnapshot: () => HEALTHY, now: fixedNow(), sleep: noSleep,
    }, { catalog: [testSignal()] });
    expect(first.results[0]!.evidence.state).toBe('UNSUPPORTED');

    const second = planOemProbes({ context: ctx(), nowMs: 1_000_000, catalog: [testSignal()] });
    expect(second.probes).toHaveLength(0);
    expect(second.skipped[0]?.reason).toBe('evidence_sufficient');
  });

  it('3) native reject (hat hatası) UNSUPPORTED ÜRETMEZ ve kalıcı elemeye yol açmaz', async () => {
    const readObdDid = vi.fn(async () => { throw new Error('bağlantı yok'); });
    const out = await discoverOemSignals(ctx(), {
      readObdDid: readObdDid as never, getHealthSnapshot: () => HEALTHY, now: fixedNow(), sleep: noSleep,
    }, { catalog: [testSignal()] });

    expect(out.results[0]!.outcome).toBe('timeout');
    expect(out.results[0]!.evidence.state).toBe('UNKNOWN');
    expect(out.results[0]!.evidence.state).not.toBe('UNSUPPORTED');

    // Sonraki tur YİNE sorar — geçici hata kalıcı sessizliğe dönüşmez.
    const again = planOemProbes({ context: ctx(), nowMs: 1_000_100, catalog: [testSignal()] });
    expect(again.probes).toHaveLength(1);
  });

  it('araç HAREKET ediyorsa / hız bilinmiyorsa tur BAŞLAMAZ (fail-closed)', async () => {
    const readObdDid = vi.fn(async () => ({ data: '2A', supported: true, kind: 'OK' as const, nrc: null }));
    for (const snap of [
      { ...HEALTHY, speedKmh: 30 },
      { ...HEALTHY, speedKmh: null },
      { ...HEALTHY, connectionState: 'disconnected' },
    ] as DiscoveryHealthSnapshot[]) {
      const out = await discoverOemSignals(ctx(), {
        readObdDid, getHealthSnapshot: () => snap, now: fixedNow(), sleep: noSleep,
      }, { catalog: [testSignal()] });
      expect(out.stopReason).toBe('unsafe');
    }
    expect(readObdDid).not.toHaveBeenCalled();
  });

  it('bütçe bitince tur DURUR — hat sınırsız yüklenmez', async () => {
    const readObdDid = vi.fn(async () => ({ data: '2A', supported: true, kind: 'OK' as const, nrc: null }));
    const many = Array.from({ length: 6 }, (_, i) => testSignal({
      signalId: (['DPF_SOOT_LOAD', 'DPF_INLET_TEMP', 'DPF_OUTLET_TEMP',
        'DPF_REGEN_STATUS', 'TURBO_BOOST_PRESSURE', 'FUEL_TEMPERATURE_OEM'] as const)[i],
      identifier: `22${String(i).padStart(2, '0')}`,
    }));
    const { KwpCommandBudget } = await import('../platform/obd/discovery/discoverySafetyPolicy');

    const out = await discoverOemSignals(ctx(), {
      readObdDid, getHealthSnapshot: () => HEALTHY, now: fixedNow(), sleep: noSleep,
      budget: new KwpCommandBudget(2, 60_000, fixedNow()),
    }, { catalog: many });

    expect(out.stopReason).toBe('budget_exhausted');
    expect(readObdDid).toHaveBeenCalledTimes(2);
  });

  it('AbortSignal turu keser', async () => {
    const controller = new AbortController();
    controller.abort();
    const readObdDid = vi.fn(async () => ({ data: '2A', supported: true, kind: 'OK' as const, nrc: null }));
    const out = await discoverOemSignals(ctx(), {
      readObdDid, getHealthSnapshot: () => HEALTHY, now: fixedNow(), sleep: noSleep,
    }, { catalog: [testSignal()], signal: controller.signal });
    expect(out.stopReason).toBe('cancelled');
    expect(readObdDid).not.toHaveBeenCalled();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * KALICILIK DİKİŞİ — ikinci depo yok, ortak sözlüğe çevrilir
 * ════════════════════════════════════════════════════════════════════════ */

describe('kalıcılık dikişi', () => {
  it('OEM durumu ORTAK keşif sözlüğüne çevrilir ve VERIFIED asla üretmez', () => {
    expect(oemStateToDiscoveryStatus('SUPPORTED', 'OK')).toBe('DECODER_KNOWN');
    expect(oemStateToDiscoveryStatus('SUPPORTED', 'NO_DECODER')).toBe('DISCOVERED_UNKNOWN');
    expect(oemStateToDiscoveryStatus('UNSUPPORTED', 'NOT_ATTEMPTED')).toBe('UNSUPPORTED');
    expect(oemStateToDiscoveryStatus('ERROR', 'IMPLAUSIBLE')).toBe('SUSPICIOUS');
    for (const s of ['SUPPORTED', 'UNSUPPORTED', 'ERROR', 'TEMPORARILY_UNAVAILABLE', 'PROBING', 'UNKNOWN'] as const) {
      expect(oemStateToDiscoveryStatus(s, 'OK')).not.toBe('VERIFIED');
    }
  });

  it('kimliği UNKNOWN olan sinyal kalıcılaştırılmaz', () => {
    const written = persistOemEvidence({
      def: OEM_SIGNAL_CATALOG[0]!,
      evidence: emptyOemEvidence(OEM_SIGNAL_CATALOG[0]!.signalId, SCOPE, 1_000_000),
      rawRequestSample: '', rawResponseSample: '', latencyMs: 0,
      recommendedPollClass: 'DISCOVERY_ONLY', decoderId: null, vinHash: null,
    });
    expect(written).toBeNull();
    expect(_store.size).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * LAB — gözlemlenebilirlik (0 ile "hiç sorulmadı" ayrımı)
 * ════════════════════════════════════════════════════════════════════════ */

describe('LAB anlık görüntüsü', () => {
  const labBase = {
    scope: SCOPE, nowMs: 1_000_000, sessionHealthy: true, corePollingBudgetOk: true,
    activeOemPollCount: 0, maxConcurrentOemPolls: 3,
  };

  it('hiç yoklanmamış sinyalde sayaçlar 0 DEĞİL null gösterilir', () => {
    const snap = buildOemSignalLabSnapshot({
      ...labBase, catalog: OEM_SIGNAL_CATALOG, evidenceById: new Map(),
    });
    expect(snap.verdict).toBe('NO_PROBEABLE_SIGNAL');
    expect(snap.probeableCount).toBe(0);
    expect(snap.catalogCount).toBe(OEM_SIGNAL_CATALOG.length);
    for (const row of snap.rows) {
      expect(row.timeoutCount).toBeNull();
      expect(row.evidenceAgeMs).toBeNull();
      expect(row.lastPositiveAt).toBeNull();
      expect(row.identifier).toBe('UNKNOWN');
      expect(row.pollEligible).toBe(false);
      expect(row.pollReason).toBe('not_probeable');
    }
  });

  it('kanıt varsa ECU/servis/kimlik/NRC/yaş/çözücü durumu ve poll uygunluğu görünür', () => {
    const def = testSignal();
    const evidence: OemCapabilityEvidence = {
      ...emptyOemEvidence('DPF_SOOT_LOAD', SCOPE, 990_000),
      state: 'SUPPORTED', decoderStatus: 'OK', lastPositiveAt: 990_000, lastNrc: null, timeoutCount: 0,
    };
    const snap = buildOemSignalLabSnapshot({
      ...labBase, catalog: [def],
      evidenceById: new Map([['DPF_SOOT_LOAD', { evidence, ecuAddress: '7E8', rawResponseSample: '2A' }]]),
    });
    const row = snap.rows[0]!;
    expect(snap.verdict).toBe('HAS_SUPPORTED');
    expect(row.ecuAddress).toBe('7E8');
    expect(row.service).toBe('22');
    expect(row.identifier).toBe('2266');
    expect(row.state).toBe('SUPPORTED');
    expect(row.evidenceAgeMs).toBe(10_000);
    expect(row.rawResponseSample).toBe('2A');
    expect(row.pollEligible).toBe(true);
    // 10-koşul kapısı LAB'da çalıştırılmaz → sınıf DISCOVERY_ONLY kalır (dürüst).
    expect(row.pollClass).toBe('DISCOVERY_ONLY');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * Aday köprüsü — mevcut tarayıcı sözleşmesi korunur
 * ════════════════════════════════════════════════════════════════════════ */

describe('mevcut keşif sözleşmesine köprü', () => {
  it('katalog kaydı MEVCUT DidCandidate sözleşmesine çevrilir (yeni transport yok)', () => {
    const c = oemSignalToDidCandidate(testSignal(), ECU)!;
    expect(c).toMatchObject({
      did: '2266', service: '22', ecuId: 'engine', tx: '7E0', rx: '7E8',
      hasKnownDecoder: true, source: 'oem_catalog',
    });
    expect(c.compiledDef?.min).toBe(0);
    expect(c.compiledDef?.max).toBe(100);
  });

  it('kimliği bilinmeyen sinyal aday ÜRETMEZ', () => {
    expect(oemSignalToDidCandidate(OEM_SIGNAL_CATALOG[0]!, ECU)).toBeNull();
  });
});
