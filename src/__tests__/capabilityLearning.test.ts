/**
 * capabilityLearning.test — P0-VDK-F4C · PARMAK İZİ + YETENEK ÇİZGESİ + ÖĞRENME.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * PASS ÖLÇÜTÜ (görev)
 * ══════════════════════════════════════════════════════════════════════════
 * "Aynı parmak izi için İKİNCİ keşif koşusu DAHA AZ PDU isteğiyle AYNI kanıtlı
 *  sonuca ulaşsın; UNKNOWN ölçüm geçmiş kanıtı BOZAMASIN; replay/synthetic veri
 *  ürün öğrenmesi SAYILMASIN."
 *
 * Bu dosyanın kilitlediği en pahalı üç hata:
 *  1. gürültüyle (ECU sustu) kanıtlanmış bir yeteneği silmek,
 *  2. masa başı iz oynatmayı "sahada öğrendik" saymak,
 *  3. bozuk/uyumsuz depoyu okuyup "öğrendik" demek.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: vi.fn(() => true) },
}));
vi.mock('../platform/nativePlugin', () => ({
  CarLauncher: {
    readDtcClass: vi.fn(), readDtcFromEcu: vi.fn(),
    readAdvancedDtcs: vi.fn(), sendTesterPresent: vi.fn(),
  },
}));

import { CarLauncher } from '../platform/nativePlugin';
import { resolveGapLedgerScope } from '../platform/obd/gapLedgerScope';
import {
  buildCapabilityFingerprint, buildEcuFingerprint, detectEcuCollision,
  isFingerprintReusable, fingerprintLeaksRawVin, MIN_REUSE_CONFIDENCE,
} from '../platform/obd/capability/capabilityFingerprint';
import {
  mergeCapabilityObservation, decideReuse, summarizeGraph, isProductTrusted,
  ABSENT_QUORUM, CAPABILITY_FRESH_MS,
  type CapabilityEdge, type CapabilityObservationInput, type TransportConstraint,
} from '../platform/obd/capability/capabilityGraph';
import {
  loadCapabilityStore, recordCapabilityObservation, getCapabilityEdge,
  getCapabilityEdges, getCapabilityHealth, getSavedRequestCount,
  getReusedProbeCount, isStoreTrustworthy, persistCapabilityStore,
  activateCapabilityVehicle,
  _resetCapabilityStoreForTest, _writeRawStoreForTest,
  CAPABILITY_SCHEMA_VERSION,
} from '../platform/obd/capability/capabilityStore';
import { runServiceDiscovery, _resetServiceDiscoveryForTest }
  from '../platform/obd/discovery/serviceDiscoveryRuntime';
import { builtinServiceDefs, extraReadOnlyServiceDefs }
  from '../platform/obd/cddl/legacyAdapter';
import type { EcuVariant, ServiceDef } from '../platform/obd/cddl/schema';
import {
  beginTransaction, transitionTransaction, cancelTransaction,
  _resetTransactionsForTest,
} from '../platform/obd/diagnosticTransaction';
import { _setPduRoutePolicyForTest, _resetPduRoutePolicyForTest }
  from '../platform/obd/pduRouting';
import { DESTRUCTIVE_SERVICES } from '../platform/obd/genericPduTransport';

/* ── Ortam ───────────────────────────────────────────────────────────────── */

let sent: Record<string, unknown>[] = [];
const T0 = 1_000_000;

function bridge(reply: (o: Record<string, unknown>) => Record<string, unknown>): void {
  (CarLauncher as unknown as Record<string, unknown>).sendDiagnosticPdu =
    vi.fn(async (o: Record<string, unknown>) => { sent.push(o); return reply(o); });
}

const TRANSPORT: TransportConstraint =
  { genericBridge: true, routePolicy: 'generic_only', adapterHash: 'ad1' };

const DEFS = (): ServiceDef[] => [...builtinServiceDefs(), ...extraReadOnlyServiceDefs()];

function ecu(refs: string[], over: Partial<EcuVariant> = {}): EcuVariant {
  return {
    id: 'ecm', name: 'Motor (ECM)', txHeader: '7E0', rxHeader: '7E8',
    addressing: 'physical', session: 'default', serviceRefs: refs,
    patternRefs: [], comParamRefs: [],
    provenance: { source: 'builtin', reference: 't', license: 't', verifiedOn: null },
    ...over,
  } as unknown as EcuVariant;
}

function liveTxn() {
  const t = beginTransaction({ purpose: 'ecu_probe' });
  transitionTransaction(t, 'PREPARING');
  transitionTransaction(t, 'SESSION_ACTIVE');
  return t;
}

/**
 * P0-VDK-F5G — öğrenme artık FİZİKSEL olarak araca göre bölümlendi: kalıcılık
 * yalnız kanıtlı bir araç kimliği bağlıyken açıktır. Kimlik MEVCUT
 * `fingerprintHash` biçimindedir (16 hex); uydurma kimlik bölüm AÇAMAZ.
 */
const VEH_A = 'a1b2c3d4e5f60718';

function activateVehA(): void {
  activateCapabilityVehicle(resolveGapLedgerScope({
    vehicleRef: VEH_A, fingerprintReusable: true,
    provenance: 'live', traceMode: 'live',
  }), T0);
}

const OBS = (over: Partial<CapabilityObservationInput> = {}): CapabilityObservationInput => ({
  vehicleId: VEH_A, ecuId: 'E1', service: '19', subFunction: '02',
  presence: 'PRESENT', provenance: 'live', protocol: '6',
  transport: TRANSPORT, evidenceRef: 'c1', nrc: null, atMs: T0, ...over,
});

beforeEach(() => {
  sent = [];
  _resetCapabilityStoreForTest();
  activateVehA();
  _resetServiceDiscoveryForTest();
  _resetTransactionsForTest();
  _resetPduRoutePolicyForTest();
  _setPduRoutePolicyForTest('generic_only');
  loadCapabilityStore();
});
afterEach(() => {
  delete (CarLauncher as unknown as Record<string, unknown>).sendDiagnosticPdu;
  _resetCapabilityStoreForTest();
  _resetPduRoutePolicyForTest();
  vi.restoreAllMocks();
});

/* ══════════════════════════════════════════════════════════════════════════
   1) PARMAK İZİ
   ══════════════════════════════════════════════════════════════════════════ */

describe('F4C · parmak izi', () => {
  const ECU_OBS = [{
    txHeader: '7E0', rxHeader: '7E8', protocol: '6',
    responseSignature: '59:62', calibrationDid: 'F189', calibrationValueHash: 'abc123',
  }];

  it('aynı araç → aynı kimlik (deterministik)', () => {
    const a = buildCapabilityFingerprint(
      { protocol: '6', supportedPidBitmap: 'BE1FA813', vin: 'VF1AAAA0000000001' }, ECU_OBS);
    const b = buildCapabilityFingerprint(
      { protocol: '6', supportedPidBitmap: 'BE1FA813', vin: 'VF1AAAA0000000001' }, ECU_OBS);
    expect(a.id).toBe(b.id);
    expect(a.confidence).toBe(b.confidence);
  });

  it('VIN YOKKEN de kararlı kimlik üretilir', () => {
    const a = buildCapabilityFingerprint(
      { protocol: '6', supportedPidBitmap: 'BE1FA813', vin: null }, ECU_OBS);
    const b = buildCapabilityFingerprint(
      { protocol: '6', supportedPidBitmap: 'BE1FA813', vin: null }, ECU_OBS);
    expect(a.id).toBe(b.id);
    expect(a.id.length).toBeGreaterThan(0);
    expect(a.vinPresent).toBe(false);
    expect(a.vinHash).toBeNull();
    /* VIN yoksa güven DÜŞER ama uydurulmaz — eksen listesi bunu söyler. */
    expect(a.measuredAxes).not.toContain('VIN');
    expect(a.confidence).toBeLessThan(1);
  });

  it('HAM VIN kimliğe SIZMAZ', () => {
    const vin = 'VF1AAAA0000000001';
    const fp = buildCapabilityFingerprint(
      { protocol: '6', supportedPidBitmap: 'BE1FA813', vin }, ECU_OBS);
    expect(fingerprintLeaksRawVin(fp, vin)).toBe(false);
    expect(fp.vinHash).not.toBe(vin);
    expect(fp.vinPresent).toBe(true);
  });

  it('FARKLI ECU imzası → FARKLI parmak izi', () => {
    const a = buildCapabilityFingerprint({ protocol: '6', supportedPidBitmap: 'B', vin: null }, ECU_OBS);
    const b = buildCapabilityFingerprint({ protocol: '6', supportedPidBitmap: 'B', vin: null },
      [{ ...ECU_OBS[0], responseSignature: '59' }]);
    expect(a.id).not.toBe(b.id);
  });

  it('ECU sırası kimliği DEĞİŞTİRMEZ', () => {
    const o2 = { txHeader: '7E1', rxHeader: '7E9', protocol: '6',
      responseSignature: '43', calibrationDid: null, calibrationValueHash: null };
    const a = buildCapabilityFingerprint({ protocol: '6', supportedPidBitmap: 'B', vin: null },
      [ECU_OBS[0], o2]);
    const b = buildCapabilityFingerprint({ protocol: '6', supportedPidBitmap: 'B', vin: null },
      [o2, ECU_OBS[0]]);
    expect(a.id).toBe(b.id);
  });

  it('ölçülmeyen alan null; güven ölçülen eksen sayısından TÜRETİLİR', () => {
    const bare = buildCapabilityFingerprint(
      { protocol: null, supportedPidBitmap: null, vin: null }, []);
    expect(bare.protocol).toBeNull();
    expect(bare.supportedPidBitmap).toBeNull();
    expect(bare.ecus).toHaveLength(0);
    expect(bare.measuredAxes).toHaveLength(0);
    expect(bare.confidence).toBe(0);
    expect(isFingerprintReusable(bare)).toBe(false);
  });

  it('zayıf kimlik (yalnız adres+protokol) yeniden kullanıma YETMEZ', () => {
    const weak = buildCapabilityFingerprint(
      { protocol: '6', supportedPidBitmap: 'B', vin: null },
      [{ txHeader: '7E0', rxHeader: '7E8', protocol: '6',
        responseSignature: null, calibrationDid: null, calibrationValueHash: null }]);
    expect(weak.confidence).toBeGreaterThanOrEqual(0);
    expect(isFingerprintReusable(weak)).toBe(false);
    const strong = buildCapabilityFingerprint(
      { protocol: '6', supportedPidBitmap: 'B', vin: 'VF1X' }, ECU_OBS);
    expect(strong.confidence).toBeGreaterThanOrEqual(MIN_REUSE_CONFIDENCE);
    expect(isFingerprintReusable(strong)).toBe(true);
  });

  it('ECU rolü ADRESTEN üretilmez; aynı adres farklı ECU ÇAKIŞMA olarak görünür', () => {
    const a = buildEcuFingerprint(ECU_OBS[0]);
    const b = buildEcuFingerprint({ ...ECU_OBS[0], calibrationValueHash: 'zzz999' });
    expect(a).not.toHaveProperty('role');
    expect(detectEcuCollision(a, a)).toBe('SAME_ECU');
    expect(detectEcuCollision(a, b)).toBe('ADDRESS_COLLISION');
    const other = buildEcuFingerprint({ ...ECU_OBS[0], txHeader: '7E1', rxHeader: '7E9' });
    expect(detectEcuCollision(a, other)).toBe('DIFFERENT');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   2) ÖĞRENME POLİTİKASI
   ══════════════════════════════════════════════════════════════════════════ */

describe('F4C · öğrenme: kanıt gürültüyle silinmez', () => {
  it('UNKNOWN, kanıtlı PRESENT\'i EZMEZ', () => {
    const first = mergeCapabilityObservation(null, OBS());
    expect(first.presence).toBe('PRESENT');
    for (const noise of ['UNKNOWN', 'UNKNOWN_TRANSPORT_LIMIT', 'DEFERRED',
      'UNKNOWN_ADDRESSING', 'UNKNOWN_RESPONSE_SHAPE'] as const) {
      const after = mergeCapabilityObservation(first, OBS({ presence: noise, atMs: T0 + 10 }));
      expect(after.presence, noise).toBe('PRESENT');
      expect(after.observationCount).toBe(2);
    }
  });

  it('UNKNOWN, kanıtlı ABSENT\'i de EZMEZ', () => {
    const abs = mergeCapabilityObservation(null, OBS({ presence: 'ABSENT', nrc: 0x11 }));
    const after = mergeCapabilityObservation(abs, OBS({ presence: 'UNKNOWN', atMs: T0 + 10 }));
    expect(after.presence).toBe('ABSENT');
  });

  it('PRESENT → ABSENT TEK ölçümle dönmez; ÇELİŞKİ üretir', () => {
    const p = mergeCapabilityObservation(null, OBS());
    const once = mergeCapabilityObservation(p, OBS({ presence: 'ABSENT', nrc: 0x11, atMs: T0 + 10 }));
    expect(once.presence).toBe('PRESENT');                    // dönmedi
    expect(once.conflict?.kind).toBe('PRESENT_TO_ABSENT');
    expect(once.conflict?.quorumRemaining).toBe(ABSENT_QUORUM - 1);

    const twice = mergeCapabilityObservation(once, OBS({ presence: 'ABSENT', nrc: 0x11, atMs: T0 + 20 }));
    expect(twice.presence).toBe('ABSENT');                    // kota doldu
    expect(twice.conflict).toBeNull();
  });

  it('ABSENT → PRESENT kabul edilir ama ÇELİŞKİ GÖRÜNÜR (sessiz çözüm yok)', () => {
    const a = mergeCapabilityObservation(null, OBS({ presence: 'ABSENT', nrc: 0x11 }));
    const b = mergeCapabilityObservation(a, OBS({ presence: 'PRESENT', atMs: T0 + 10 }));
    expect(b.presence).toBe('PRESENT');
    expect(b.conflict?.kind).toBe('ABSENT_TO_PRESENT');
  });

  it('aynı yönde tekrar → sayaç ve ardışıklık artar', () => {
    let e = mergeCapabilityObservation(null, OBS());
    e = mergeCapabilityObservation(e, OBS({ atMs: T0 + 5, evidenceRef: 'c2' }));
    e = mergeCapabilityObservation(e, OBS({ atMs: T0 + 9, evidenceRef: 'c3' }));
    expect(e.observationCount).toBe(3);
    expect(e.consecutiveSame).toBe(3);
    expect(e.evidenceRefs).toEqual(['c1', 'c2', 'c3']);
    expect(e.firstSeenMs).toBe(T0);
    expect(e.lastSeenMs).toBe(T0 + 9);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   3) PROVENANCE — masa başı kanıt ürün öğrenmesi DEĞİLDİR
   ══════════════════════════════════════════════════════════════════════════ */

describe('F4C · yalnız canlı kanıt ürün öğrenmesi üretir', () => {
  it('replay/synthetic/imported productTrusted YAPMAZ', () => {
    for (const p of ['replay', 'synthetic', 'imported'] as const) {
      expect(isProductTrusted(p)).toBe(false);
      const e = mergeCapabilityObservation(null, OBS({ provenance: p }));
      expect(e.productTrusted, p).toBe(false);
    }
    expect(isProductTrusted('live')).toBe(true);
    expect(mergeCapabilityObservation(null, OBS()).productTrusted).toBe(true);
  });

  it('replay kanıtı, canlı kanıtla açılmış güveni DÜŞÜRMEZ', () => {
    const live = mergeCapabilityObservation(null, OBS());
    const then = mergeCapabilityObservation(live, OBS({ provenance: 'replay', atMs: T0 + 5 }));
    expect(then.productTrusted).toBe(true);
  });

  it('ürün-güvenilir OLMAYAN kayıt yeniden kullanıma İZİN VERMEZ', () => {
    const e = mergeCapabilityObservation(null, OBS({ provenance: 'replay' }));
    expect(decideReuse(e, {
      nowMs: T0 + 100, fingerprintReusable: true, transport: TRANSPORT,
    })).toBe('NOT_PRODUCT_TRUSTED');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   4) YENİDEN KULLANIM POLİTİKASI
   ══════════════════════════════════════════════════════════════════════════ */

describe('F4C · yeniden kullanım fail-closed', () => {
  const live = () => mergeCapabilityObservation(null, OBS());
  const ctx = (over: Partial<Parameters<typeof decideReuse>[1]> = {}) => ({
    nowMs: T0 + 1000, fingerprintReusable: true, transport: TRANSPORT, ...over,
  });

  it('taze + kanıtlı + canlı → REUSE', () => {
    expect(decideReuse(live(), ctx())).toBe('REUSE');
  });

  it('kayıt yok · zayıf kimlik · çelişki · bayat → ÖLÇ', () => {
    expect(decideReuse(null, ctx())).toBe('NO_RECORD');
    expect(decideReuse(live(), ctx({ fingerprintReusable: false }))).toBe('WEAK_FINGERPRINT');
    const conflicted = mergeCapabilityObservation(live(),
      OBS({ presence: 'ABSENT', nrc: 0x11, atMs: T0 + 5 }));
    expect(decideReuse(conflicted, ctx())).toBe('CONFLICT');
    expect(decideReuse(live(), ctx({ nowMs: T0 + CAPABILITY_FRESH_MS + 1 }))).toBe('STALE');
  });

  it('ADAPTÖR/TAŞIMA koşulu değiştiyse araç yeteneği yeniden ÖLÇÜLÜR', () => {
    const e = live();
    expect(decideReuse(e, ctx({
      transport: { genericBridge: false, routePolicy: 'legacy_only', adapterHash: 'ad2' },
    }))).toBe('TRANSPORT_CHANGED');
  });

  it('ölçülmemiş kayıt yeniden kullanılamaz', () => {
    const u = mergeCapabilityObservation(null, OBS({ presence: 'UNKNOWN' }));
    expect(decideReuse(u, ctx())).toBe('NOT_MEASURED');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   5) KALICILIK — fail-closed
   ══════════════════════════════════════════════════════════════════════════ */

describe('F4C · yerel kalıcılık', () => {
  it('yaz → oku turu kaydı korur', () => {
    recordCapabilityObservation(OBS(), true);
    expect(getCapabilityEdges()).toHaveLength(1);
    loadCapabilityStore();
    expect(getCapabilityHealth()).toBe('OK');
    const e = getCapabilityEdge(VEH_A, 'E1', '19', '02');
    expect(e?.presence).toBe('PRESENT');
    expect(e?.productTrusted).toBe(true);
  });

  it('BOZUK depo → yok sayılır, "öğrendik" DENMEZ', () => {
    _writeRawStoreForTest('{bu json değil');
    expect(loadCapabilityStore()).toBe('CORRUPT');
    expect(getCapabilityEdges()).toHaveLength(0);
    expect(isStoreTrustworthy('CORRUPT')).toBe(false);
    /* Güvenilmeyen depoya YAZILMAZ — arıza kalıcılaşmaz. */
    expect(persistCapabilityStore()).toBe(false);
  });

  it('şekilsiz kayıt TÜM depoyu reddettirir (kısmi güven YOK)', () => {
    _writeRawStoreForTest(JSON.stringify({
      schemaVersion: CAPABILITY_SCHEMA_VERSION,
      edges: [{ vehicleId: VEH_A }],
    }));
    expect(loadCapabilityStore()).toBe('CORRUPT');
    expect(getCapabilityEdges()).toHaveLength(0);
  });

  it('ŞEMA UYUŞMAZLIĞI fail-closed reddedilir (geriye dönük tahmin YOK)', () => {
    _writeRawStoreForTest(JSON.stringify({ schemaVersion: 999, edges: [] }));
    expect(loadCapabilityStore()).toBe('SCHEMA_MISMATCH');
    expect(getCapabilityEdges()).toHaveLength(0);
    expect(isStoreTrustworthy('SCHEMA_MISMATCH')).toBe(false);
  });

  it('boş depo bir ARIZA değildir', () => {
    expect(loadCapabilityStore()).toBe('EMPTY');
    expect(isStoreTrustworthy('EMPTY')).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   6) PROBE AZALTMA — ANA PASS ÖLÇÜTÜ
   ══════════════════════════════════════════════════════════════════════════ */

describe('F4C · ikinci koşu daha AZ istekle AYNI sonuca ulaşır', () => {
  const UDS_ECU = () => ecu(['uds_read_dtc_information', 'uds_report_supported_dtc']);

  async function run(over: Record<string, unknown> = {}) {
    return runServiceDiscovery({
      defs: DEFS(), ecu: UDS_ECU(), protocolClass: 'can', protocol: '6',
      txn: liveTxn(), ecuKey: 'ECM@7E0', sessionEpoch: 7, nowMs: T0,
      probeSubFunctions: false,
      vehicleId: VEH_A, ecuId: 'E1', fingerprintReusable: true,
      provenance: 'live', transport: TRANSPORT,
      ...over,
    } as Parameters<typeof runServiceDiscovery>[0]);
  }

  it('birinci koşu ölçer, ikinci koşu ÖĞRENİLMİŞTEN okur', async () => {
    bridge(() => ({ outcome: 'ok', kind: 'OK', raw: 'FFAA' }));

    const first = await run();
    expect(first.probesSent).toBe(2);
    expect(first.reused).toBe(0);
    const firstMap = first.records
      .map((r) => `${r.service}${r.subFunction}:${r.classification}`).sort();
    const firstRequests = sent.length;

    sent = [];
    _resetServiceDiscoveryForTest();
    _resetTransactionsForTest();

    const second = await run({ txn: liveTxn(), nowMs: T0 + 1000 });
    /* ── PASS ÖLÇÜTÜ: daha az istek, AYNI sonuç ───────────────────────── */
    expect(second.probesSent).toBe(0);
    expect(second.reused).toBe(2);
    expect(sent.length).toBeLessThan(firstRequests);
    expect(sent).toHaveLength(0);

    const secondMap = second.records
      .map((r) => `${r.service}${r.subFunction}:${r.classification}`).sort();
    expect(secondMap).toEqual(firstMap);

    /* Tasarruf ÖLÇÜLDÜ ve atlama SESSİZ DEĞİL. */
    expect(getSavedRequestCount()).toBe(2);
    expect(getReusedProbeCount()).toBe(2);
    expect(second.records.every((r) => r.reusedFromLearning)).toBe(true);
    expect(second.records.every((r) => r.reuseDecision === 'REUSE')).toBe(true);
    expect(second.records[0].reason).toContain('önceki canlı ölçüm');
  });

  it('BAYAT kayıt yeniden ÖLÇÜLÜR', async () => {
    bridge(() => ({ outcome: 'ok', kind: 'OK', raw: 'FFAA' }));
    await run();
    sent = [];
    _resetServiceDiscoveryForTest();
    _resetTransactionsForTest();

    const second = await run({
      txn: liveTxn(), nowMs: T0 + CAPABILITY_FRESH_MS + 1,
    });
    expect(second.reused).toBe(0);
    expect(second.probesSent).toBe(2);
  });

  it('REPLAY kanıtıyla öğrenilen kayıt ikinci turda yoklamayı ATLATMAZ', async () => {
    bridge(() => ({ outcome: 'ok', kind: 'OK', raw: 'FFAA' }));
    await run({ provenance: 'replay' });
    sent = [];
    _resetServiceDiscoveryForTest();
    _resetTransactionsForTest();

    const second = await run({ txn: liveTxn(), nowMs: T0 + 1000, provenance: 'replay' });
    expect(second.reused).toBe(0);
    expect(second.probesSent).toBe(2);
  });

  it('ZAYIF parmak izinde öğrenme KULLANILMAZ', async () => {
    bridge(() => ({ outcome: 'ok', kind: 'OK', raw: 'FFAA' }));
    await run();
    sent = [];
    _resetServiceDiscoveryForTest();
    _resetTransactionsForTest();

    const second = await run({
      txn: liveTxn(), nowMs: T0 + 1000, fingerprintReusable: false,
    });
    expect(second.reused).toBe(0);
    expect(second.probesSent).toBe(2);
  });

  it('kimlik YOKSA (vehicleId/ecuId null) öğrenme ne YAZILIR ne OKUNUR', async () => {
    bridge(() => ({ outcome: 'ok', kind: 'OK', raw: 'FFAA' }));
    await run({ vehicleId: null, ecuId: null });
    expect(getCapabilityEdges()).toHaveLength(0);
  });

  it('UNKNOWN ölçüm ikinci turda öğrenilmiş PRESENT\'i BOZMAZ', async () => {
    bridge(() => ({ outcome: 'ok', kind: 'OK', raw: 'FFAA' }));
    await run();
    _resetServiceDiscoveryForTest();
    _resetTransactionsForTest();

    /* İkinci tur: yeniden kullanım KAPALI ve ECU susuyor. */
    bridge(() => ({ outcome: 'no_response', kind: 'NO_DATA', raw: '' }));
    await run({ txn: liveTxn(), nowMs: T0 + 1000, reuseLearning: false });

    const e = getCapabilityEdge(VEH_A, 'E1', '19', '02');
    expect(e?.presence).toBe('PRESENT');       // kanıt korundu
    expect(e?.observationCount).toBe(2);
  });

  it('İPTAL/bayat oturum yoklamayı durdurur ve öğrenme kanıtı BOZULMAZ', async () => {
    bridge(() => ({ outcome: 'ok', kind: 'OK', raw: 'FFAA' }));
    await run();
    const before = getCapabilityEdge(VEH_A, 'E1', '19', '02');

    _resetServiceDiscoveryForTest();
    _resetTransactionsForTest();
    sent = [];
    const t = liveTxn();
    cancelTransaction(t, 'kullanıcı durdurdu');
    const second = await run({ txn: t, nowMs: T0 + 1000, reuseLearning: false });

    expect(sent).toHaveLength(0);
    expect(second.stopReason).toBe('TRANSACTION_NOT_LIVE');
    const after = getCapabilityEdge(VEH_A, 'E1', '19', '02');
    expect(after?.presence).toBe(before?.presence);
  });

  it('DESTRUCTIVE servis öğrenmeyle ASLA açılmaz', async () => {
    bridge(() => ({ outcome: 'ok', kind: 'OK', raw: 'FF' }));
    /* Çizgeye elle "öğrenilmiş" destructive kayıt enjekte edilse bile… */
    for (const sid of DESTRUCTIVE_SERVICES) {
      recordCapabilityObservation(OBS({ service: sid, subFunction: null }), false);
    }
    const evilDefs: ServiceDef[] = DESTRUCTIVE_SERVICES.map((sid) => ({
      ...DEFS()[0], id: `evil_${sid}`, service: sid, subFunction: null,
      effect: 'destructive', argKind: 'literal', literalPayload: '',
    }));
    const r = await runServiceDiscovery({
      defs: evilDefs, ecu: ecu(evilDefs.map((d) => d.id)), protocolClass: 'can',
      txn: liveTxn(), nowMs: T0, probeSubFunctions: false,
      vehicleId: VEH_A, ecuId: 'E1', fingerprintReusable: true,
      provenance: 'live', transport: TRANSPORT,
    });
    /* …korpus yine BOŞ ve hatta TEK BAYT çıkmaz. */
    expect(r.stopReason).toBe('EMPTY_CORPUS');
    expect(sent).toHaveLength(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   7) ÖZET
   ══════════════════════════════════════════════════════════════════════════ */

describe('F4C · çizge özeti', () => {
  it('hiç öğrenme yoksa neverLearned true', () => {
    expect(summarizeGraph([], T0).neverLearned).toBe(true);
  });

  it('güvenilir/güvenilmez/çelişki/bayat ayrı sayılır', () => {
    const live = mergeCapabilityObservation(null, OBS());
    const rep: CapabilityEdge = mergeCapabilityObservation(null,
      OBS({ vehicleId: 'V2', provenance: 'replay' }));
    const conflicted = mergeCapabilityObservation(live,
      OBS({ presence: 'ABSENT', nrc: 0x11, atMs: T0 + 5 }));
    const s = summarizeGraph([live, rep, conflicted], T0 + CAPABILITY_FRESH_MS + 10);
    expect(s.trusted).toBe(2);
    expect(s.untrusted).toBe(1);
    expect(s.conflicts).toBe(1);
    expect(s.stale).toBe(3);
    expect(s.vehicles).toBe(2);
    expect(s.neverLearned).toBe(false);
  });
});
