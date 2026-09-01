/**
 * ecuEndpointDiscovery.test — P0-VDK-F6A · UNKNOWN-ROLE ECU KEŞFİ + KANIT TABANLI KİMLİK.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * PASS ÖLÇÜTÜ (görev §29 — birebir)
 * ══════════════════════════════════════════════════════════════════════════
 *  1. Motor dışındaki BİRDEN ÇOK uç nokta kanıtla keşfediliyor.
 *  2. Uç nokta ≠ rol ayrımı korunuyor.
 *  3. Rolü bilinmeyen uç nokta ÇÖPE ATILMIYOR.
 *  4. Rol YALNIZ ölçülmüş kimlik/varyant kanıtıyla yükseliyor.
 *  5. Yetenek benzerliği tek başına PROVEN rol ÜRETMİYOR.
 *  6. Araçlar arasında adres/rol öğrenmesi SIZMIYOR.
 *  7. Keşif bounded ve fail-closed.
 *  8. Destructive hiçbir yol açılmıyor.
 *  9. Replay aynı envanteri DETERMİNİSTİK üretiyor.
 * 10. Mevcut kullanıcı tanısı BOZULMUYOR.
 *
 * ⚠️ "7E1/7E2 de tara" PASS DEĞİLDİR: bu dosya zincirin tamamını ölçer —
 * RESPONDER → ENDPOINT → SAFE IDENTITY PROBE → EVIDENCE → ROLE/UNKNOWN →
 * CAPABILITY → LEARNING.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const epochRef = { value: 3 };

/* `safeStorage` native dalda Filesystem API'sine yazar; tezgâhta kalıcılığın
   GERÇEKTEN ölçülebilmesi için web dalı (localStorage) seçilir. */
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: vi.fn(() => false) },
}));
vi.mock('../platform/nativePlugin', () => ({
  CarLauncher: {
    probeEcus:         vi.fn(),
    readDtcFromEcu:    vi.fn(),
    readUdsDtcs:       vi.fn(),
    readAdvancedDtcs:  vi.fn(),
    sendTesterPresent: vi.fn(),
    sendDiagnosticPdu: vi.fn(),
  },
}));
vi.mock('../platform/obdService', () => ({
  getOBDDataSnapshot: () => ({
    connectionState: 'connected', transportConnected: true,
    dataFresh: true, source: 'real',
  }),
  getObdSessionHealth: () => ({
    transportReady: true, sessionReady: true, pollingActive: true,
    dataFresh: true, ready: true,
  }),
  getEcuRecoveryLadder: () => ({ inFlight: false, nativeReconnectInFlight: false }),
  getObdSessionEpoch: () => epochRef.value,
  getHandshakeDiagnostics: () => ({ protocolActive: '6', protocolTried: null }),
  onOBDData: () => () => { /* abonelik testte kullanılmaz */ },
}));

import { CarLauncher } from '../platform/nativePlugin';
import { buildTopology, type DiscoveredEcu } from '../platform/obd/ecuDiscovery';
import { setActiveObdProtocol } from '../platform/obd/activeProtocol';
import { builtinServiceDefs } from '../platform/obd/cddl/legacyAdapter';
import {
  beginTransaction, prepareTransaction, cancelTransaction,
  _resetTransactionsForTest, _setTransactionClockForTest,
} from '../platform/obd/diagnosticTransaction';
import { _resetSchedulerForTest, _setSchedulerClockForTest }
  from '../platform/obd/diagnosticSessionScheduler';
import {
  getTraceEvents, _resetTraceForTest, _setTraceClocksForTest,
} from '../platform/obd/canonicalTrace';
import {
  startReplay, stopReplay, _resetVdkTransportForTest,
} from '../platform/obd/vdkTransport';
import {
  buildEcuEndpoint, buildEndpointInventory, deriveReachability,
  endpointCandidateSpace, isStandardCandidate,
} from '../platform/obd/ecu/ecuEndpointModel';
import {
  resolveEcuRole, mergeWithLearnedRole, isRoleActionable,
  type EcuRoleEvidenceItem,
} from '../platform/obd/ecu/ecuRoleEvidenceModel';
import {
  matchVariantPatterns, variantForEndpoint, checkVariantEvidence,
} from '../platform/obd/ecu/ecuVariantMatch';
import {
  resolveEcuIdentities, evaluateIdentityAdmission, endpointTargetFromEcu,
  ecuIdentityEverEvaluated, getCanonicalEcuInventory, getLastEcuIdentityRun,
  IDENTITY_MAX_ENDPOINTS, ENDPOINT_IDENTITY_DIDS,
  _resetEcuIdentityResolverForTest,
} from '../platform/obd/ecu/ecuIdentityResolver';
import {
  getStoredEcuRoles, learnedRoleEvidence, getEcuRoleStorageKey,
  _resetEcuRoleStoreForTest, _simulateEcuRoleRestartForTest,
} from '../platform/obd/ecu/ecuRoleStore';
import { activateVehicleDiagnosticContext }
  from '../platform/obd/vehicleDiagnosticContext';
import { _resetCapabilityStoreForTest } from '../platform/obd/capability/capabilityStore';
import { _resetGapRegistryForTest } from '../platform/obd/gapRegistry';
import { _resetPartitionCatalogForTest } from '../platform/obd/vehiclePartitionCatalog';
import { _resetGapResolverForTest } from '../platform/obd/healing/gapResolverRuntime';
import { _resetServiceDiscoveryForTest }
  from '../platform/obd/discovery/serviceDiscoveryRuntime';
import { _resetPhysicalProbesForTest } from '../platform/obd/physicalEcuProbe';
import { DESTRUCTIVE_SERVICES } from '../platform/obd/genericPduTransport';
import { validateCddlDocument } from '../platform/obd/cddl/validate';
import { CDDL_SCHEMA_VERSION } from '../platform/obd/cddl/schema';
import { readEcuEndpointSnapshot } from '../platform/devtools/ecuEndpointSources';
import {
  buildEcuEndpointCards, deriveEcuEndpointVerdict, identifiedRecords,
  unknownRoleRecords,
} from '../platform/devtools/ecuEndpointLabModel';
import { CAROS_LAB_TOOLS } from '../platform/devtools/carosLabCatalog';
import {
  EXPECTED_ECUS, MULTI_ECU_PROBE_RAW, SERVICE_STATUSES,
  corpusResponder, multiEcuTraceEvents, type CorpusPduCall,
} from './fixtures/multiEcuCorpus';

/* ══════════════════════════════════════════════════════════════════════════
   TEZGÂH
   ══════════════════════════════════════════════════════════════════════════ */

const VEHICLE_A = 'a1b2c3d4e5f60718';
const VEHICLE_B = '0f1e2d3c4b5a6978';

let calls: CorpusPduCall[] = [];
let responder: (c: CorpusPduCall) => Record<string, unknown>;

const clock = { t: 20_000 };
const mono = { t: 0 };

function corpusEcus(): readonly DiscoveredEcu[] {
  return buildTopology(MULTI_ECU_PROBE_RAW, 1_700_000_000_000, '6').ecus;
}

async function liveTxn() {
  const txn = beginTransaction({ purpose: 'multi_ecu_scan', protocol: '6' });
  await prepareTransaction(txn);
  return txn;
}

function ctxFor(vehicleRef: string | null, over: Record<string, unknown> = {}) {
  return {
    admission: 'READY' as const,
    ecus: corpusEcus(),
    defs: builtinServiceDefs(),
    patterns: [],
    variants: [],
    protocol: '6',
    protocolClass: 'can' as const,
    vin: null,
    serviceStatuses: SERVICE_STATUSES,
    vehicleRef,
    provenance: 'live' as const,
    nowMs: clock.t,
    ...over,
  };
}

/** Aracı bağlar — ürün yolunun (`productionDiscovery`) yaptığının aynısı. */
function connect(ref: string | null): void {
  activateVehicleDiagnosticContext({
    vehicleRef: ref, fingerprintReusable: ref !== null,
    provenance: 'live', nowMs: clock.t,
  });
}

beforeEach(() => {
  calls = [];
  responder = corpusResponder;
  epochRef.value = 3;
  clock.t = 20_000; mono.t = 0;

  _resetTransactionsForTest();
  _resetSchedulerForTest();
  _resetTraceForTest('trace-F6A');
  _resetVdkTransportForTest();
  _resetEcuIdentityResolverForTest();
  _resetEcuRoleStoreForTest();
  _resetCapabilityStoreForTest();
  _resetGapRegistryForTest();
  _resetPartitionCatalogForTest();
  _resetGapResolverForTest();
  _resetServiceDiscoveryForTest();
  _resetPhysicalProbesForTest();
  try { localStorage.clear(); } catch { /* jsdom */ }

  _setTransactionClockForTest(() => clock.t);
  _setSchedulerClockForTest(() => clock.t);
  _setTraceClocksForTest(() => clock.t, () => { mono.t += 5; return mono.t; });
  setActiveObdProtocol('6');

  const fn = CarLauncher.sendDiagnosticPdu as unknown as ReturnType<typeof vi.fn>;
  fn.mockReset();
  fn.mockImplementation(async (o: CorpusPduCall) => {
    calls.push(o);
    return responder(o);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   1) UÇ NOKTA KEŞFİ
   ══════════════════════════════════════════════════════════════════════════ */

describe('F6A · uç nokta keşfi', () => {
  it('ÖLÇÜLMÜŞ CAN11 responder\'ları uç nokta olur (motor DIŞINDA da)', () => {
    const eps = buildEndpointInventory(corpusEcus(), '6');
    expect(eps.length).toBe(6);
    expect(eps.map((e) => e.rxHeader))
      .toEqual(['7E8', '7E9', '7EA', '7EB', '7EC', '7ED']);
    for (const e of eps) {
      expect(e.reachability).toBe('DIRECT_ENDPOINT');
      expect(e.source).toBe('FUNCTIONAL_RESPONDER');
      expect(e.addressable).toBe(true);
    }
  });

  it('uç nokta kaydında ROL ALANI YOKTUR (adres ≠ rol)', () => {
    const ep = buildEndpointInventory(corpusEcus(), '6')[0]!;
    expect(Object.keys(ep)).not.toContain('role');
    expect(Object.keys(ep)).not.toContain('roleEvidence');
  });

  it('cevap VERMEMİŞ / profil kaynaklı aday uç nokta SAYILMAZ', () => {
    expect(buildEcuEndpoint({
      rxHeader: '7EE', txHeader: '7E6', addressBits: 11,
      discoverySource: 'profile', probeOutcome: 'not_attempted',
    }, '6')).toBeNull();
    expect(buildEcuEndpoint({
      rxHeader: '7EE', txHeader: '7E6', addressBits: 11,
      discoverySource: 'functional_0100', probeOutcome: 'no_response',
    }, '6')).toBeNull();
  });

  it('adresi TÜRETİLEMEYEN uç noktaya istek gönderilemez', () => {
    const ep = buildEcuEndpoint({
      rxHeader: '486B7A', txHeader: '', addressBits: 8,
      discoverySource: 'functional_0100', probeOutcome: 'responded',
      txProvenance: 'unknown',
    }, '5');
    expect(ep).not.toBeNull();
    expect(ep!.addressable).toBe(false);
    expect(endpointTargetFromEcu(ep!, ['uds_read_data_by_identifier'])).toBeNull();
  });

  it('KÖR TARAMA YOK: aday uzayı adresleme ailesine göre KAPALI', () => {
    const can11 = endpointCandidateSpace('can11');
    expect(can11.standardSpaceDefined).toBe(true);
    expect(can11.txCandidates).toEqual(['7E1', '7E2', '7E3', '7E4', '7E5', '7E6', '7E7']);

    /* CAN29 ve KWP için STANDART aday uzayı YOKTUR — üretmek kör tarama olurdu. */
    for (const fam of ['can29', 'kwp', 'functional'] as const) {
      const sp = endpointCandidateSpace(fam);
      expect(sp.txCandidates).toEqual([]);
      expect(sp.standardSpaceDefined).toBe(false);
      expect(sp.reason.length).toBeGreaterThan(10);   // sessiz boşluk YASAK
    }
    expect(isStandardCandidate('can11', '7E3')).toBe(true);
    expect(isStandardCandidate('can11', '123')).toBe(false);
    expect(isStandardCandidate('can29', '18DA10F1')).toBe(false);
  });

  it('CAN29 ve KWP uç noktaları YALNIZ ölçülmüş kaynaktan doğar', () => {
    const can29 = buildEcuEndpoint({
      rxHeader: '18DAF110', txHeader: '18DA10F1', addressBits: 29,
      discoverySource: 'functional_0100', probeOutcome: 'responded',
      txProvenance: 'can_29bit_standard',
    }, '7');
    expect(can29?.addressing).toBe('can29');
    expect(can29?.addressable).toBe(true);

    const kwp = buildEcuEndpoint({
      rxHeader: '486B10', txHeader: '8110F1', addressBits: 8,
      discoverySource: 'functional_0100', probeOutcome: 'responded',
      txProvenance: 'kwp_iso14230', kwpTargetVerified: false,
    }, '5');
    expect(kwp?.addressing).toBe('kwp');
    expect(kwp?.source).toBe('KWP_MEASURED_SOURCE');
    expect(kwp?.kwpTargetVerified).toBe(false);
  });

  it('ULAŞILABİLİRLİK: gateway durumları ÜRETİLMEZ ("bulunamadı" ≠ "yok")', () => {
    expect(deriveReachability(true)).toBe('DIRECT_ENDPOINT');
    expect(deriveReachability(false)).toBe('UNKNOWN_REACHABILITY');
    for (const e of buildEndpointInventory(corpusEcus(), '6')) {
      expect(e.reachability).not.toBe('GATEWAY_EXPOSED');
      expect(e.reachability).not.toBe('GATEWAY_REQUIRED');
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   2) ROL KANIT MODELİ — SAF
   ══════════════════════════════════════════════════════════════════════════ */

describe('F6A · rol kanıt modeli', () => {
  const ev = (
    kind: EcuRoleEvidenceItem['kind'], role: EcuRoleEvidenceItem['role'],
  ): EcuRoleEvidenceItem => ({
    kind, role, detail: 'test', source: `s:${kind}`,
    observedAt: 1, provenance: 'live',
  });

  it('standart garanti TEK BAŞINA PROVEN üretir', () => {
    const r = resolveEcuRole([ev('STANDARD_ADDRESS_ROLE', 'engine')]);
    expect(r.role).toBe('engine');
    expect(r.confidence).toBe('PROVEN');
  });

  it('ECU\'nun kendi beyanı (kimlik DID) STRONG üretir', () => {
    const r = resolveEcuRole([ev('IDENTITY_DID', 'abs_esp')]);
    expect(r.confidence).toBe('STRONG');
  });

  it('kimlik DID + varyant deseni → STRONG (görev §10 örneği)', () => {
    const r = resolveEcuRole([
      ev('IDENTITY_DID', 'abs_esp'), ev('VARIANT_PATTERN', 'abs_esp'),
    ]);
    expect(r.role).toBe('abs_esp');
    expect(r.confidence).toBe('STRONG');
  });

  it('ECU\'nun İKİ bağımsız kimlik beyanı → PROVEN', () => {
    const r = resolveEcuRole([
      ev('IDENTITY_DID', 'hvac'), ev('CALIBRATION_MATCH', 'hvac'),
    ]);
    expect(r.confidence).toBe('PROVEN');
  });

  it('YETENEK İMZASI tek başına ASLA PROVEN olmaz — ADAY tavanı', () => {
    const r = resolveEcuRole([ev('CAPABILITY_SIGNATURE', 'abs_esp')]);
    expect(r.role).toBe('abs_esp');
    expect(r.confidence).toBe('CANDIDATE');
    expect(isRoleActionable(r.confidence)).toBe(false);
  });

  it('kanıt YOKSA rol UYDURULMAZ', () => {
    const r = resolveEcuRole([]);
    expect(r.role).toBe('unknown');
    expect(r.confidence).toBe('UNKNOWN');
  });

  it('iki GÜÇLÜ kanıt farklı rol derse ÇELİŞKİ — ilki SEÇİLMEZ', () => {
    const r = resolveEcuRole([
      ev('IDENTITY_DID', 'abs_esp'), ev('CALIBRATION_MATCH', 'airbag_srs'),
    ]);
    expect(r.confidence).toBe('CONFLICT');
    expect(r.role).toBe('unknown');
    expect(r.conflictingRoles).toEqual(['abs_esp', 'airbag_srs']);
  });

  it('kanıt SIRASI kararı DEĞİŞTİRMEZ (deterministik)', () => {
    const a = resolveEcuRole([ev('CAPABILITY_SIGNATURE', 'hvac'), ev('IDENTITY_DID', 'hvac')]);
    const b = resolveEcuRole([ev('IDENTITY_DID', 'hvac'), ev('CAPABILITY_SIGNATURE', 'hvac')]);
    expect(a.confidence).toBe(b.confidence);
    expect(a.role).toBe(b.role);
  });

  it('ürün-güvenilir OLMAYAN kanıt ürün rolü DOĞRULAMAZ', () => {
    const replayEv: EcuRoleEvidenceItem = {
      kind: 'IDENTITY_DID', role: 'abs_esp', detail: 'replay',
      source: 's', observedAt: 1, provenance: 'replay',
    };
    expect(resolveEcuRole([replayEv], { productTrustedOnly: true }).confidence)
      .toBe('UNKNOWN');
    /* Aynı motor, aynı deterministik sonuç — yalnız GÜVEN ekseni ayrı. */
    expect(resolveEcuRole([replayEv], { productTrustedOnly: false }).confidence)
      .toBe('STRONG');
  });

  it('ÖLÇÜM KAYBI kanıtlanmış rolü DÜŞÜRMEZ; UNKNOWN sonra PROVEN olabilir', () => {
    const learned = resolveEcuRole([ev('STANDARD_ADDRESS_ROLE', 'engine')]);
    const timedOut = resolveEcuRole([]);
    const merged = mergeWithLearnedRole(timedOut, learned);
    expect(merged.role).toBe('engine');
    expect(merged.confidence).toBe('PROVEN');

    /* Ters yön serbesttir. */
    const fresh = resolveEcuRole([ev('IDENTITY_DID', 'tpms')]);
    expect(mergeWithLearnedRole(fresh, learned).role).toBe('tpms');
  });

  it('ÇELİŞKİ öğrenilmiş rolü KORUMAZ (öğrenilen artık güvenilmez)', () => {
    const learned = resolveEcuRole([ev('IDENTITY_DID', 'engine')]);
    const conflict = resolveEcuRole([
      ev('IDENTITY_DID', 'abs_esp'), ev('CALIBRATION_MATCH', 'airbag_srs'),
    ]);
    expect(mergeWithLearnedRole(conflict, learned).confidence).toBe('CONFLICT');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   3) VARYANT DESENİ
   ══════════════════════════════════════════════════════════════════════════ */

describe('F6A · CDDL varyant deseni', () => {
  const P = (id: string, evs: { kind: string; selector: string; expect: string | null }[]) => ({
    id, manufacturer: 'X', modelFamily: 'Y',
    protocols: ['can'] as const, evidence: evs,
    variantRefs: [`${id}.ecm`],
    provenance: { source: 'builtin' as const, reference: 'r', license: 'l', verifiedOn: null },
  });
  const facts = {
    vin: 'VF1AAAA00A0000001', protocolClass: 'can' as const,
    didResponses: { F197: '454E47494E45' }, respondedTx: ['7E0', '7E1'],
  };

  it('kanıtların TAMAMI sağlanmadan desen TUTMAZ', () => {
    const r = matchVariantPatterns([
      P('p1', [
        { kind: 'vin_wmi', selector: 'VF1', expect: null },
        { kind: 'ecu_responded', selector: '7E9', expect: null },   // cevap VERMEDİ
      ]) as never,
    ], facts);
    expect(r.outcome).toBe('NO_MATCH');
  });

  it('tek desen tutarsa SINGLE', () => {
    const r = matchVariantPatterns([
      P('p1', [{ kind: 'vin_wmi', selector: 'VF1', expect: null }]) as never,
    ], facts);
    expect(r.outcome).toBe('SINGLE');
    expect(r.matched[0]!.patternId).toBe('p1');
  });

  it('birden çok desen tutarsa BELİRSİZ — İLKİ SEÇİLMEZ', () => {
    const r = matchVariantPatterns([
      P('p1', [{ kind: 'vin_wmi', selector: 'VF1', expect: null }]) as never,
      P('p2', [{ kind: 'ecu_responded', selector: '7E0', expect: null }]) as never,
    ], facts);
    expect(r.outcome).toBe('AMBIGUOUS');
    expect(r.matched.length).toBe(2);
  });

  it('ÖLÇÜLEMEDİ ile YANLIŞ ayrı tutulur', () => {
    const noVin = { ...facts, vin: null };
    expect(checkVariantEvidence(
      { kind: 'vin_wmi', selector: 'VF1', expect: null }, noVin).outcome)
      .toBe('UNMEASURED');
    expect(checkVariantEvidence(
      { kind: 'vin_wmi', selector: 'ZZZ', expect: null }, facts).outcome)
      .toBe('REFUTED');
  });

  it('aynı adrese iki varyant düşerse BELİRSİZ — rol yükselmez', () => {
    const hit = {
      patternId: 'p1', manufacturer: 'X', modelFamily: 'Y',
      checks: [], variantRefs: ['v1', 'v2'],
    };
    const variants = ['v1', 'v2'].map((id) => ({
      id, name: id, role: 'engine' as const, addressing: 'can11' as const,
      txHeader: '7E0', rxHeader: '7E8', kwpTarget: null, session: 'default' as const,
      serviceRefs: [], provenance: { source: 'builtin' as const, reference: 'r', license: 'l', verifiedOn: null },
    }));
    const ep = buildEndpointInventory(corpusEcus(), '6')[0]!;
    expect(variantForEndpoint(hit, variants, ep).outcome).toBe('AMBIGUOUS_VARIANT');
    expect(variantForEndpoint(hit, variants, ep).variant).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   4) ÜRÜN YOLU — ÇOK-ECU KİMLİK ÇÖZÜMÜ
   ══════════════════════════════════════════════════════════════════════════ */

describe('F6A · ürün yolu (golden çok-ECU korpusu)', () => {
  it('motor DIŞINDA beş uç nokta daha kanıtla kimliklenir', async () => {
    connect(VEHICLE_A);
    const run = await resolveEcuIdentities(await liveTxn(), ctxFor(VEHICLE_A));

    expect(run.admission).toBe('RUN');
    expect(run.endpointsSeen).toBe(6);

    for (const want of EXPECTED_ECUS) {
      const rec = run.records.find((r) => r.rxHeader === want.rx);
      expect(rec, `kayıt yok: ${want.rx}`).toBeDefined();
      expect(rec!.txHeader).toBe(want.tx);
      expect(rec!.role, `rol ${want.rx}`).toBe(want.role);
      expect(rec!.roleConfidence, `güven ${want.rx}`).toBe(want.confidence);
      const kinds = [...new Set(rec!.roleEvidence.map((e) => e.kind))].sort();
      expect(kinds).toEqual([...want.evidenceKinds].sort());
    }
    /* Motor DIŞINDA en az dört kimliklenmiş ECU (PASS §29/1). */
    expect(identifiedRecords(run.records).filter((r) => r.role !== 'engine').length)
      .toBeGreaterThanOrEqual(4);
  });

  it('7E1 rolü ADRESTEN DEĞİL ECU\'nun BEYANINDAN çıkar', async () => {
    connect(VEHICLE_A);
    /* Aynı adres, BAŞKA beyan → BAŞKA rol. Adres genellemesi olsaydı bu test
       düşerdi ve `7E1 = şanzıman` sabiti kodda yaşıyor olurdu. */
    responder = (c) => (c.service === '22' && c.payload === 'F197' && c.rx === '7E9')
      /* "ABS ESP" */
      ? { outcome: 'ok', raw: '41425320455350', kind: 'OK', gate: 'OK', latencyMs: 8 }
      : corpusResponder(c);

    const run = await resolveEcuIdentities(await liveTxn(), ctxFor(VEHICLE_A));
    const rec = run.records.find((r) => r.rxHeader === '7E9')!;
    expect(rec.role).toBe('abs_esp');
    expect(rec.roleEvidence.map((e) => e.kind)).toContain('IDENTITY_DID');
  });

  it('ROLSÜZ uç nokta ÇÖPE ATILMAZ ve NEDENİ yazılır', async () => {
    connect(VEHICLE_A);
    const run = await resolveEcuIdentities(await liveTxn(), ctxFor(VEHICLE_A));

    const unknown = run.records.find((r) => r.rxHeader === '7ED')!;
    expect(unknown.role).toBe('unknown');
    expect(unknown.roleConfidence).toBe('UNKNOWN');
    expect(unknown.unresolvedReason).not.toBeNull();
    /* Uç nokta ölçüldü: adres, ulaşılabilirlik ve kimlik yoklaması KAYITTA. */
    expect(unknown.reachability).toBe('DIRECT_ENDPOINT');
    expect(unknown.identityProbes.length).toBeGreaterThan(0);
    expect(unknown.ecuFingerprint).not.toBeNull();
    expect(unknownRoleRecords(run.records).length).toBe(1);
  });

  it('rolsüz uç nokta CDDL hedefi kurabilir ama rol TAŞIMAZ', () => {
    const ep = buildEndpointInventory(corpusEcus(), '6')
      .find((e) => e.rxHeader === '7ED')!;
    const target = endpointTargetFromEcu(ep, ['uds_read_data_by_identifier']);
    expect(target).not.toBeNull();
    expect(target!.role).toBe('unknown');
    expect(target!.provenance.source).toBe('learned');   // ÖLÇÜLEREK türetildi
  });

  it('BELGE düzeyinde rolsüz varyant HÂLÂ YASAK (kapı gevşemedi)', () => {
    const res = validateCddlDocument({
      schemaVersion: CDDL_SCHEMA_VERSION, id: 'doc',
      services: [], variants: [{
        id: 'v', name: 'v', role: 'unknown', addressing: 'can11',
        txHeader: '7E0', rxHeader: '7E8', kwpTarget: null, session: 'default',
        serviceRefs: [], provenance: { source: 'builtin', reference: 'r', license: 'l', verifiedOn: null },
      }], patterns: [], dataObjects: [], comParams: [], procedures: [], dtcCatalog: [],
    } as never);
    expect(res.issues.some((i) => i.rejection === 'ROLE_UNKNOWN_FORBIDDEN')).toBe(true);
  });

  it('ECU parmak izi ADRESTEN İBARET DEĞİLDİR (F4-C otoritesi)', async () => {
    connect(VEHICLE_A);
    const run = await resolveEcuIdentities(await liveTxn(), ctxFor(VEHICLE_A));
    const rec = run.records.find((r) => r.rxHeader === '7EA')!;
    expect(rec.ecuFingerprint!.measuredAxes).toContain('ADDRESS');
    expect(rec.ecuFingerprint!.measuredAxes).toContain('PROTOCOL');
    expect(rec.ecuFingerprint!.measuredAxes).toContain('CALIBRATION');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   5) BÜTÇE VE FAIL-CLOSED
   ══════════════════════════════════════════════════════════════════════════ */

describe('F6A · bütçe ve fail-closed', () => {
  const base = {
    admission: 'READY' as const, transactionLive: true, cancelled: false,
    staleEpoch: false, remainingRequests: 160, protocolKnown: true,
    genericBridgeAvailable: true, endpointCount: 3, didServiceDefAvailable: true,
  };

  it('admisyon READY değilse ENGELLENİR', () => {
    expect(evaluateIdentityAdmission({ ...base, admission: 'RECONNECTING' }).admission)
      .toBe('BLOCKED');
  });
  it('bayat oturum mührü ENGELLER', () => {
    expect(evaluateIdentityAdmission({ ...base, staleEpoch: true }).admission).toBe('BLOCKED');
  });
  it('uç nokta yoksa ENGELLENİR (adres uydurulmaz)', () => {
    expect(evaluateIdentityAdmission({ ...base, endpointCount: 0 }).admission).toBe('BLOCKED');
  });
  it('köprü yoksa ENGELLENİR — araç kararı DEĞİL', () => {
    expect(evaluateIdentityAdmission({ ...base, genericBridgeAvailable: false }).admission)
      .toBe('BLOCKED');
  });
  it('bütçe rezervin altındaysa ERTELENİR (kullanıcı tanısı önce)', () => {
    const d = evaluateIdentityAdmission({ ...base, remainingRequests: 4 });
    expect(d.admission).toBe('DEFERRED');
    expect(d.allocatedRequests).toBe(0);
  });

  it('İPTAL → hatta tek bayt çıkmaz, uç noktalar yine ENVANTERDE', async () => {
    connect(VEHICLE_A);
    const txn = await liveTxn();
    cancelTransaction(txn, 'test');
    const run = await resolveEcuIdentities(txn, ctxFor(VEHICLE_A));
    expect(run.admission).toBe('BLOCKED');
    expect(calls.length).toBe(0);
    expect(run.records.length).toBe(6);
    expect(run.records.every((r) => r.roleConfidence === 'UNKNOWN')).toBe(true);
  });

  it('uç nokta tavanı aşılırsa kalanlar YARIM KALDI olur, KAYBOLMAZ', async () => {
    connect(VEHICLE_A);
    const many: DiscoveredEcu[] = [];
    for (let i = 0; i < IDENTITY_MAX_ENDPOINTS + 3; i++) {
      const rx = (0x7e0 + i).toString(16).toUpperCase();
      many.push({
        rxHeader: rx, txHeader: (0x7e0 + i - 8).toString(16).toUpperCase(),
        addressBits: 11, role: 'unknown', roleEvidence: 'none', label: `E${i}`,
        discoverySource: 'functional_0100', probeOutcome: 'responded',
        txProvenance: 'can_11bit_standard',
      });
    }
    const run = await resolveEcuIdentities(await liveTxn(), ctxFor(VEHICLE_A, { ecus: many }));
    expect(run.records.length).toBe(many.length);
    const half = run.records.filter((r) => (r.unresolvedReason ?? '').includes('YARIM KALDI'));
    expect(half.length).toBeGreaterThan(0);
  });

  it('istek sayısı ayrılan paydan FAZLA olamaz', async () => {
    connect(VEHICLE_A);
    const run = await resolveEcuIdentities(await liveTxn(), ctxFor(VEHICLE_A));
    expect(run.usedRequests).not.toBeNull();
    expect(run.usedRequests!).toBeLessThanOrEqual(run.allocatedRequests);
    /* Bilgi kazancı olmayan istek gönderilmez: kimlik ekseni dolunca durulur. */
    expect(run.usedRequests!).toBeLessThan(
      6 * ENDPOINT_IDENTITY_DIDS.length);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   6) GÜVENLİK
   ══════════════════════════════════════════════════════════════════════════ */

describe('F6A · güvenlik', () => {
  it('YALNIZ salt-okunur 0x22 gönderilir — destructive matris 0 PDU', async () => {
    connect(VEHICLE_A);
    await resolveEcuIdentities(await liveTxn(), ctxFor(VEHICLE_A));

    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) expect(c.service).toBe('22');
    const sids = new Set(calls.map((c) => c.service));
    expect(sids.has('27')).toBe(false);             // SecurityAccess
    expect(sids.has('10')).toBe(false);             // oturum
    expect(sids.has('3E')).toBe(false);             // keepalive
    expect(sids.has('2E')).toBe(false);             // kodlama
    expect(sids.has('31')).toBe(false);             // rutin
    for (const d of DESTRUCTIVE_SERVICES) expect(sids.has(d)).toBe(false);
  });

  it('sorulan DID\'ler ISO 14229-1 kimlik kümesiyle SINIRLI', async () => {
    connect(VEHICLE_A);
    await resolveEcuIdentities(await liveTxn(), ctxFor(VEHICLE_A));
    const allowed = new Set(ENDPOINT_IDENTITY_DIDS.map((d) => d.did));
    for (const c of calls) expect(allowed.has(c.payload.toUpperCase())).toBe(true);
  });

  it('kanonik ize düşer ama HAM GÖVDE taşımaz', async () => {
    connect(VEHICLE_A);
    await resolveEcuIdentities(await liveTxn(), ctxFor(VEHICLE_A));

    const reads = getTraceEvents().filter((e) => e.operation === 'did_read');
    expect(reads.length).toBeGreaterThan(0);
    for (const r of reads) {
      expect(r.rawResponse).toBeNull();
      expect(r.redactionState).toBe('REDACTED');
      expect(r.rawRequest).toMatch(/^22F1/);
    }
    /* Seri numarasının ham gövdesi izde YOK. */
    expect(JSON.stringify(getTraceEvents())).not.toContain('534E30303031');
  });

  it('ham kimlik gövdesi KALICI depoya SIZMAZ', async () => {
    connect(VEHICLE_A);
    await resolveEcuIdentities(await liveTxn(), ctxFor(VEHICLE_A));
    let dump = '';
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)!;
        dump += `${k}=${localStorage.getItem(k) ?? ''}\n`;
      }
    } catch { /* jsdom */ }
    expect(dump).not.toContain('534E30303031');
    expect(dump).not.toContain('454E47494E45');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   7) ÖĞRENME VE ARAÇ İZOLASYONU
   ══════════════════════════════════════════════════════════════════════════ */

describe('F6A · öğrenme ve araç izolasyonu', () => {
  it('canlı kanıtla çözülen rol ARAÇ BÖLÜMÜNE yazılır', async () => {
    connect(VEHICLE_A);
    const run = await resolveEcuIdentities(await liveTxn(), ctxFor(VEHICLE_A));
    expect(getEcuRoleStorageKey()).toContain(VEHICLE_A);

    const stored = getStoredEcuRoles();
    expect(stored.length).toBeGreaterThanOrEqual(5);
    expect(stored.every((r) => r.vehicleRef === VEHICLE_A)).toBe(true);
    /* ADAY/BİLİNMİYOR yazılmaz. */
    expect(stored.every((r) => r.confidence === 'PROVEN' || r.confidence === 'STRONG'))
      .toBe(true);
    expect(run.records.filter((r) => r.roleWrite === 'STORED').length)
      .toBe(stored.length);
  });

  it('öğrenilmiş rol AYNI araçta yeniden kullanılır (restart sonrası)', async () => {
    connect(VEHICLE_A);
    const first = await resolveEcuIdentities(await liveTxn(), ctxFor(VEHICLE_A));
    const abs = first.records.find((r) => r.rxHeader === '7EA')!;
    expect(abs.role).toBe('abs_esp');

    /* Uygulama yeniden başlar (bellek gider, DİSK kalır). */
    _simulateEcuRoleRestartForTest();
    _resetEcuIdentityResolverForTest();
    _resetTransactionsForTest();
    _setTransactionClockForTest(() => clock.t);
    epochRef.value = 9;
    connect(VEHICLE_A);

    const learned = learnedRoleEvidence(abs.ecuFingerprint!.id);
    expect(learned).not.toBeNull();
    expect(learned!.kind).toBe('LEARNED_CONFIRMED');
    expect(learned!.role).toBe('abs_esp');
  });

  it('ARAÇ A\'da öğrenilen rol ARAÇ B\'ye SIZMAZ', async () => {
    connect(VEHICLE_A);
    const a = await resolveEcuIdentities(await liveTxn(), ctxFor(VEHICLE_A));
    const absA = a.records.find((r) => r.rxHeader === '7EA')!;
    expect(getStoredEcuRoles().length).toBeGreaterThan(0);

    /* Aynı CAN kimliği, BAŞKA araç. */
    _resetEcuIdentityResolverForTest();
    epochRef.value = 11;
    connect(VEHICLE_B);

    expect(getStoredEcuRoles().length).toBe(0);
    expect(learnedRoleEvidence(absA.ecuFingerprint!.id)).toBeNull();
    expect(getEcuRoleStorageKey()).toContain(VEHICLE_B);
  });

  it('araç kimliği YOKSA rol öğrenmesi YAZILMAZ (kalıcılık kapalı)', async () => {
    connect(null);
    const run = await resolveEcuIdentities(await liveTxn(), ctxFor(null));
    expect(getStoredEcuRoles().length).toBe(0);
    expect(run.records.some((r) => r.roleWrite === 'BLOCKED_SCOPE')).toBe(true);
    /* Ama rol yine ÇÖZÜLDÜ — öğrenme yokluğu ölçümü engellemez. */
    expect(run.records.find((r) => r.rxHeader === '7EA')!.role).toBe('abs_esp');
  });

  it('rol deposu araç bölüm listesine DÂHİL (yarım GC kalkanı)', () => {
    connect(VEHICLE_A);
    const key = getEcuRoleStorageKey();
    expect(key).toBe(`caros-ecu-roles-v1:${VEHICLE_A}`);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   8) REPLAY
   ══════════════════════════════════════════════════════════════════════════ */

describe('F6A · replay', () => {
  it('AYNI motor replay\'de AYNI envanteri üretir (determinizm)', async () => {
    connect(VEHICLE_A);
    const live = await resolveEcuIdentities(await liveTxn(), ctxFor(VEHICLE_A));
    const liveRoles = live.records.map((r) => `${r.rxHeader}:${r.role}:${r.roleConfidence}`);

    _resetEcuIdentityResolverForTest();
    _resetTransactionsForTest();
    _setTransactionClockForTest(() => clock.t);
    calls = [];

    const started = startReplayRun();
    expect(started).toBe(true);
    const replayed = await resolveEcuIdentities(
      await liveTxn(), ctxFor(VEHICLE_A, { provenance: 'replay' }));
    stopReplay();

    const replayRoles = replayed.records
      .map((r) => `${r.rxHeader}:${r.role}:${r.roleConfidence}`);
    expect(replayRoles).toEqual(liveRoles);
    /* Replay `CarLauncher`a TEK çağrı bile yapmaz (izolasyon invaryantı). */
    expect(calls.length).toBe(0);
  });

  it('replay rolü ÜRÜN GERÇEĞİ SAYILMAZ ve öğrenmeye YAZILMAZ', async () => {
    connect(VEHICLE_A);
    startReplayRun();
    const run = await resolveEcuIdentities(
      await liveTxn(), ctxFor(VEHICLE_A, { provenance: 'replay' }));
    stopReplay();

    expect(run.records.every((r) => r.productTrusted === false)).toBe(true);
    expect(run.records.some((r) => r.roleWrite === 'BLOCKED_UNTRUSTED')).toBe(true);
    expect(getStoredEcuRoles().length).toBe(0);
  });

  it('replay YANIT UYDURMAZ: izde olmayan istek MISMATCH olur', async () => {
    connect(VEHICLE_A);
    startReplayRun();
    const extra: DiscoveredEcu[] = [{
      rxHeader: '7EF', txHeader: '7E7', addressBits: 11,
      role: 'unknown', roleEvidence: 'none', label: 'E',
      discoverySource: 'functional_0100', probeOutcome: 'responded',
      txProvenance: 'can_11bit_standard',
    }];
    const run = await resolveEcuIdentities(
      await liveTxn(), ctxFor(VEHICLE_A, { ecus: extra, provenance: 'replay' }));
    stopReplay();

    const rec = run.records[0]!;
    expect(rec.role).toBe('unknown');
    expect(rec.identityProbes.every((p) => p.verdict !== 'MEASURED')).toBe(true);
  });
});

function startReplayRun(): boolean {
  const r = startReplay(multiEcuTraceEvents(), 'FAST', 'f6a-run');
  return r.ok === true;
}

/* ══════════════════════════════════════════════════════════════════════════
   9) CAROS LAB
   ══════════════════════════════════════════════════════════════════════════ */

describe('F6A · CAROS LAB yüzeyi', () => {
  it('LAB okuması hiçbir keşif/PDU/aktivasyon TETİKLEMEZ', async () => {
    connect(VEHICLE_A);
    await resolveEcuIdentities(await liveTxn(), ctxFor(VEHICLE_A));
    const before = calls.length;

    const snap = readEcuEndpointSnapshot();
    const cards = buildEcuEndpointCards(snap);
    const verdict = deriveEcuEndpointVerdict(snap);

    expect(calls.length).toBe(before);
    expect(cards.length).toBeGreaterThan(0);
    expect(verdict.status).toBe('IDENTIFIED');
  });

  it('hiç ölçüm yokken KAYNAK YOK der — `0` YAZMAZ', () => {
    expect(ecuIdentityEverEvaluated()).toBe(false);
    expect(getCanonicalEcuInventory()).toBeNull();
    const snap = readEcuEndpointSnapshot();
    expect(deriveEcuEndpointVerdict(snap).status).toBe('NEVER_EVALUATED');
    const fields = buildEcuEndpointCards(snap).flatMap((c) => c.fields);
    const counters = fields.filter((f) => f.id.startsWith('ep-') === false);
    expect(counters.some((f) => f.klass === 'UNAVAILABLE')).toBe(true);
  });

  it('LAB ham kimlik gövdesini GÖSTERMEZ', async () => {
    connect(VEHICLE_A);
    await resolveEcuIdentities(await liveTxn(), ctxFor(VEHICLE_A));
    const cards = buildEcuEndpointCards(readEcuEndpointSnapshot());
    expect(JSON.stringify(cards)).not.toContain('534E30303031');
  });

  it('katalogda AVAILABLE bir araç aracı olarak kayıtlıdır', () => {
    const tool = CAROS_LAB_TOOLS.find((t) => t.id === 'ecu-endpoint-inventory');
    expect(tool).toBeDefined();
    expect(tool!.status).toBe('AVAILABLE');
    expect(tool!.category).toBe('vehicle');
  });

  it('son tur LAB için okunabilir kalır', async () => {
    connect(VEHICLE_A);
    await resolveEcuIdentities(await liveTxn(), ctxFor(VEHICLE_A));
    const last = getLastEcuIdentityRun();
    expect(last).not.toBeNull();
    expect(last!.records.length).toBe(6);
    expect(getCanonicalEcuInventory()!.length).toBe(6);
  });
});
