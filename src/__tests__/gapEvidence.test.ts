/**
 * gapEvidence.test — P0-VDK-F5D · KANONİK BOŞLUK KANIT ZARFI.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * PASS ÖLÇÜTÜ (görev — birebir)
 * ══════════════════════════════════════════════════════════════════════════
 * Bir üretim keşif/oturum/parser/taşıma boşluğu oluştuğunda, sicil kaydı
 * KENDİ kanıt bağıyla hangi ECU · hangi servis/alt fonksiyon · hangi ölçüm
 * sonucu/NRC · hangi işlem/kanıt zinciri · hangi köken nedeniyle doğduğunu
 * KORUYACAK; ve F4-B'nin TAVANLI yoklama defterindeki kaynak kayıt artık
 * bulunmasa bile Self-Healing hedefini/karar bağlamını KAYBETMEYECEK.
 *
 * Bu dosyanın kilitlediği en pahalı beş hata:
 *  a. boşluğu doğuran kanıtı ephemeral bir deftere bağlamak (kırpılınca kayıp),
 *  b. iki farklı ECU/NRC ölçümünü tek satıra ezmek (P0380 dedup kusuru),
 *  c. kapanışta doğum kanıtını EZMEK ("neden açıldı" bilgisini yok etmek),
 *  d. kanıtsız eski kaydı kanıtlıymış gibi göstermek,
 *  e. ham gövde/VIN/MAC'i boşluk kaydına sızdırmak.
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
import type { EcuVariant, ServiceDef } from '../platform/obd/cddl/schema';
import { builtinServiceDefs, extraReadOnlyServiceDefs }
  from '../platform/obd/cddl/legacyAdapter';
import {
  beginTransaction, transitionTransaction, _resetTransactionsForTest,
} from '../platform/obd/diagnosticTransaction';
import { _setPduRoutePolicyForTest, _resetPduRoutePolicyForTest }
  from '../platform/obd/pduRouting';
import {
  runServiceDiscovery, getProbeRecords, _resetServiceDiscoveryForTest,
} from '../platform/obd/discovery/serviceDiscoveryRuntime';
import {
  recordGap, getGapRegistry, getGapEntry, markGapResolved,
  summarizeGapEvidence, _resetGapRegistryForTest,
} from '../platform/obd/gapRegistry';
import {
  buildGapEvidence, deriveGapEvidenceState, gapEvidenceDiscriminator,
  gapRegistryKey, isGapEvidenceSufficient, MAX_REQUEST_IDENTITY_CHARS,
  type GapObservation,
} from '../platform/obd/gapEvidence';
import {
  loadCapabilityStore, getCapabilityEdges, _resetCapabilityStoreForTest,
} from '../platform/obd/capability/capabilityStore';
import type { TransportConstraint } from '../platform/obd/capability/capabilityGraph';
import {
  collectResolvableGaps, getGapStates, runGapResolution,
  _resetGapResolverForTest,
} from '../platform/obd/healing/gapResolverRuntime';
import { classifyRootCause } from '../platform/obd/healing/resolutionPolicy';
import {
  deriveSessionRequirement, sessionEvidenceFromGapEvidence,
  _resetSessionHealingForTest,
} from '../platform/obd/healing/sessionHealing';
import { recordConformanceRun, _resetConformanceLedgerForTest }
  from '../platform/obd/conformanceLedger';
import { readGapResolverSnapshot }
  from '../platform/devtools/gapResolverSources';
import { buildResolverCards, buildResolverRows }
  from '../platform/devtools/gapResolverModel';

/* ══════════════════════════════════════════════════════════════════════════
   ORTAM
   ══════════════════════════════════════════════════════════════════════════ */

let sent: Record<string, unknown>[] = [];
const T0 = 1_000_000;

function bridge(reply: (o: Record<string, unknown>) => Record<string, unknown>): void {
  (CarLauncher as unknown as Record<string, unknown>).sendDiagnosticPdu =
    vi.fn(async (o: Record<string, unknown>) => { sent.push(o); return reply(o); });
}

const TRANSPORT: TransportConstraint =
  { genericBridge: true, routePolicy: 'generic_only', adapterHash: 'ad1' };

const DEFS = (): ServiceDef[] => [...builtinServiceDefs(), ...extraReadOnlyServiceDefs()];

const ECU = (): EcuVariant => ({
  id: 'ecm', name: 'Motor (ECM)', txHeader: '7E0', rxHeader: '7E8',
  addressing: 'physical', kwpTarget: null, session: 'default',
  serviceRefs: ['uds_read_dtc_information', 'uds_report_supported_dtc'],
  patternRefs: [], comParamRefs: [],
  provenance: { source: 'builtin', reference: 't', license: 't', verifiedOn: null },
} as unknown as EcuVariant);

function liveTxn() {
  const t = beginTransaction({ purpose: 'multi_ecu_scan' });
  transitionTransaction(t, 'PREPARING');
  transitionTransaction(t, 'SESSION_ACTIVE');
  t.protocol = '6';
  return t;
}

/** Gerçek üretim keşfi — F4-B yolundan, taklit YOK. */
async function discover(over: Record<string, unknown> = {}): Promise<void> {
  await runServiceDiscovery({
    defs: DEFS(), ecu: ECU(), protocolClass: 'can', protocol: '6',
    txn: liveTxn(), ecuKey: 'ECM@7E0', nowMs: T0, probeSubFunctions: false,
    vehicleId: 'V1', ecuId: 'E1', fingerprintReusable: false,
    provenance: 'live', transport: TRANSPORT,
    ...over,
  } as Parameters<typeof runServiceDiscovery>[0]);
}

function rctx(over: Record<string, unknown> = {}) {
  return {
    ecu: ECU(), defs: DEFS(), txn: liveTxn(),
    protocolClass: 'can' as const, protocol: '6',
    provenance: 'live' as const, transport: TRANSPORT,
    targetVerified: true, vehicleId: 'V1', ecuId: 'E1',
    fingerprintReusable: false, nowMs: T0 + 100,
    ...over,
  } as Parameters<typeof runGapResolution>[0];
}

/** Ölçüm taklidi — saf sözleşme testleri için (üretici yolundan BAĞIMSIZ). */
const obs = (over: Partial<GapObservation> = {}): GapObservation => ({
  ecuKey: 'ECM@7E0', txHeader: '7E0', rxHeader: '7E8',
  service: '19', subFunction: '02', requestIdentity: '1902FF',
  outcome: 'NEGATIVE', nrc: 0x12, classification: 'PRESENT_BUT_CONDITIONED',
  sessionOpened: null, sessionCommand: null,
  transportKind: 'elm327_classic', protocol: '6',
  traceCorrelationId: 'corr-1', atMs: T0, ...over,
});

const ev = (over: Partial<GapObservation> = {}) =>
  buildGapEvidence({ observation: obs(over), transactionId: 'txn-1' });

beforeEach(() => {
  sent = [];
  _resetGapRegistryForTest();
  _resetGapResolverForTest();
  _resetSessionHealingForTest();
  _resetCapabilityStoreForTest();
  _resetServiceDiscoveryForTest();
  _resetTransactionsForTest();
  _resetConformanceLedgerForTest();
  _resetPduRoutePolicyForTest();
  _setPduRoutePolicyForTest('generic_only');
  loadCapabilityStore();
});
afterEach(() => {
  delete (CarLauncher as unknown as Record<string, unknown>).sendDiagnosticPdu;
  _resetGapRegistryForTest();
  _resetGapResolverForTest();
  _resetSessionHealingForTest();
  _resetCapabilityStoreForTest();
  _resetServiceDiscoveryForTest();
  _resetConformanceLedgerForTest();
  _resetPduRoutePolicyForTest();
  vi.restoreAllMocks();
});

/* ══════════════════════════════════════════════════════════════════════════
   1) ZARF SÖZLEŞMESİ — SAF
   ══════════════════════════════════════════════════════════════════════════ */

describe('F5D · kanıt zarfı sözleşmesi', () => {
  it('gözlem yoksa zarf ÜRETİLMEZ (boş zarf "kanıt var" izlenimi verirdi)', () => {
    expect(buildGapEvidence({ observation: null })).toBeNull();
    expect(deriveGapEvidenceState(null)).toBe('UNAVAILABLE');
    expect(isGapEvidenceSufficient(null)).toBe(false);
  });

  it('hedef + sonuç birlikte ölçüldüyse MEASURED', () => {
    const e = ev()!;
    expect(e.state).toBe('MEASURED');
    expect(isGapEvidenceSufficient(e)).toBe(true);
  });

  it('hedefi ya da sonucu ölçülmemiş zarf LEGACY_INCOMPLETE — SAĞLAM sayılmaz', () => {
    expect(deriveGapEvidenceState(obs({ service: null }))).toBe('LEGACY_INCOMPLETE');
    expect(deriveGapEvidenceState(obs({ classification: null }))).toBe('LEGACY_INCOMPLETE');
    expect(deriveGapEvidenceState(obs({ classification: 'NOT_PROBED' })))
      .toBe('LEGACY_INCOMPLETE');
    expect(isGapEvidenceSufficient(ev({ service: null }))).toBe(false);
  });

  it('ÖLÇÜLMEYEN alan null — sahte 0 / sahte tarih / uydurma adres YOK', () => {
    const e = buildGapEvidence({ observation: obs({
      ecuKey: null, txHeader: null, rxHeader: null, nrc: null,
      protocol: null, atMs: null, traceCorrelationId: null,
    }) })!;
    expect(e.ecuKey).toBeNull();
    expect(e.ecuTxHeader).toBeNull();
    expect(e.observedNrc).toBeNull();
    expect(e.protocol).toBeNull();
    expect(e.observedAt).toBeNull();
    expect(e.traceEventRef).toBeNull();
    /* Verilmeyen referanslar da uydurulmaz. */
    expect(e.transactionId).toBeNull();
    expect(e.vehicleFingerprintRef).toBeNull();
    expect(e.capabilityEdgeRef).toBeNull();
  });

  it('istek künyesi TAVANLIDIR — künye bir kimliktir, gövde değildir', () => {
    const long = 'AA'.repeat(200);
    const e = ev({ requestIdentity: long })!;
    expect(e.requestIdentity!.length).toBeLessThanOrEqual(MAX_REQUEST_IDENTITY_CHARS);
  });

  it('zarfta ham yanıt/gövde alanı YOKTUR (alan adı denetimi)', () => {
    const keys = Object.keys(ev()!).join(' ').toLowerCase();
    for (const forbidden of ['rawresponse', 'response', 'body', 'payload',
      'vin', 'mac', 'email', 'phone', 'token', 'secret']) {
      expect(keys).not.toContain(forbidden);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   2) KİMLİK / DEDUPE — farklı ölçüm farklı boşluktur
   ══════════════════════════════════════════════════════════════════════════ */

describe('F5D · kimlik ve dedupe', () => {
  it('zarfsız anahtar ESKİ biçimle birebir aynı (geriye uyumluluk)', () => {
    expect(gapRegistryKey('UNKNOWN_SERVICE', 'discovery:19', null))
      .toBe('UNKNOWN_SERVICE|discovery:19');
    expect(gapEvidenceDiscriminator(null)).toBe('');
  });

  it('AYNI ölçüm iki kez → TEK satır, sayaç 2 (gereksiz duplicate YOK)', () => {
    recordGap({ signal: 'CAPABILITY_GAP', scope: 'AUTHORITY',
      context: 'discovery:1902', atMs: T0, evidence: ev() });
    recordGap({ signal: 'CAPABILITY_GAP', scope: 'AUTHORITY',
      context: 'discovery:1902', atMs: T0 + 5, evidence: ev() });
    const rows = getGapRegistry();
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(2);
  });

  it('FARKLI NRC yanlışlıkla aynı boşluğa EZİLMEZ', () => {
    recordGap({ signal: 'CAPABILITY_GAP', scope: 'AUTHORITY',
      context: 'discovery:1902', atMs: T0, evidence: ev({ nrc: 0x12 }) });
    recordGap({ signal: 'CAPABILITY_GAP', scope: 'AUTHORITY',
      context: 'discovery:1902', atMs: T0, evidence: ev({ nrc: 0x22 }) });
    const rows = getGapRegistry();
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.evidence?.observedNrc).sort()).toEqual([0x12, 0x22]);
  });

  it('FARKLI ECU yanlışlıkla aynı boşluğa EZİLMEZ', () => {
    recordGap({ signal: 'UNKNOWN_SERVICE', scope: 'AUTHORITY',
      context: 'discovery:1902', atMs: T0, evidence: ev({ ecuKey: 'ECM@7E0' }) });
    recordGap({ signal: 'UNKNOWN_SERVICE', scope: 'AUTHORITY',
      context: 'discovery:1902', atMs: T0, evidence: ev({ ecuKey: 'TCM@7E1' }) });
    expect(getGapRegistry()).toHaveLength(2);
  });

  it('FARKLI alt fonksiyon yanlışlıkla aynı boşluğa EZİLMEZ', () => {
    recordGap({ signal: 'UNKNOWN_SUBFUNCTION', scope: 'AUTHORITY',
      context: 'discovery:19', atMs: T0, evidence: ev({ subFunction: '02' }) });
    recordGap({ signal: 'UNKNOWN_SUBFUNCTION', scope: 'AUTHORITY',
      context: 'discovery:19', atMs: T0, evidence: ev({ subFunction: '0A' }) });
    expect(getGapRegistry()).toHaveLength(2);
  });

  it('kimlik DETERMİNİSTİKTİR — aynı girdi her turda aynı anahtar', () => {
    const a = gapRegistryKey('CAPABILITY_GAP', 'discovery:1902', ev());
    const b = gapRegistryKey('CAPABILITY_GAP', 'discovery:1902', ev());
    expect(a).toBe(b);
    expect(a).toContain('ECM@7E0');
    expect(a).toContain('19');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   3) ÜRETİM KEŞFİ — F4-B → gapRegistry KANIT ZİNCİRİ
   ══════════════════════════════════════════════════════════════════════════ */

describe('F5D · üretim keşfi kanıt zinciri', () => {
  it('7F 19 12 → PRESENT_BUT_CONDITIONED → CAPABILITY_GAP künyesiyle kaydedilir', async () => {
    bridge(() => ({ outcome: 'negative_nrc', kind: 'NEGATIVE', raw: '7F1912', nrc: 0x12 }));
    await discover();

    const row = getGapRegistry().find((r) => r.signal === 'CAPABILITY_GAP');
    expect(row).toBeDefined();
    const e = row!.evidence!;
    expect(row!.evidenceState).toBe('MEASURED');
    expect(e.ecuKey).toBe('ECM@7E0');
    expect(e.service).toBe('19');
    expect(e.observedNrc).toBe(0x12);
    expect(e.observedClassification).toBe('PRESENT_BUT_CONDITIONED');
    expect(e.observedOutcome).toBe('NEGATIVE');
    /* İŞLEM ve KANIT KORELASYONU bağı — probe defterine gerek kalmadan izlenir. */
    expect(e.transactionId).not.toBeNull();
    expect(e.evidenceCorrelationId).not.toBeNull();
    expect(e.provenance).toBe('live');
    expect(e.vehicleFingerprintRef).toBe('V1');
    expect(e.ecuFingerprintRef).toBe('E1');
    expect(e.capabilityEdgeRef).toContain('19');
  });

  it('UNKNOWN_SERVICE boşluğunun bağlamı TAM (ECU · servis · sonuç)', async () => {
    bridge(() => ({ outcome: 'timeout', kind: 'TIMEOUT' }));
    await discover();

    const row = getGapRegistry().find((r) => r.signal === 'UNKNOWN_SERVICE');
    expect(row).toBeDefined();
    expect(row!.evidenceState).toBe('MEASURED');
    expect(row!.evidence!.ecuKey).toBe('ECM@7E0');
    expect(row!.evidence!.service).not.toBeNull();
    expect(row!.evidence!.observedClassification).toBe('UNKNOWN');
  });

  it('UNKNOWN_SUBFUNCTION boşluğunun bağlamı TAM (alt fonksiyon dâhil)', async () => {
    /* Servis VAR (pozitif), alt fonksiyon yoklamaları sussun. */
    let first = true;
    bridge(() => {
      if (first) { first = false; return { outcome: 'ok', kind: 'OK', raw: '5902FFAA' }; }
      return { outcome: 'timeout', kind: 'TIMEOUT' };
    });
    await discover({ probeSubFunctions: true });

    const row = getGapRegistry().find((r) => r.signal === 'UNKNOWN_SUBFUNCTION');
    expect(row).toBeDefined();
    expect(row!.evidenceState).toBe('MEASURED');
    expect(row!.evidence!.service).toBe('19');
    expect(row!.evidence!.subFunction).not.toBeNull();
    expect(row!.evidence!.ecuKey).toBe('ECM@7E0');
  });

  it('TAŞIMA sınırı araç "desteklemiyor" SAYILMAZ — kanıt bunu açıkça söyler', async () => {
    /* Köprü YOK (eski APK deseni): istek HİÇ gitmez → `NOT_SUPPORTED_BY_TRANSPORT`.
       Bu BİZİM sınırımızdır; araç hakkında tek bayt ölçülmemiştir. */
    delete (CarLauncher as unknown as Record<string, unknown>).sendDiagnosticPdu;
    await discover();

    const row = getGapRegistry().find((r) => r.signal === 'TRANSPORT_LIMITATION');
    expect(row).toBeDefined();
    expect(row!.scope).toBe('TRANSPORT');
    expect(row!.evidence!.observedClassification).toBe('UNKNOWN_TRANSPORT_LIMIT');
    /* Araç sınırı DEĞİL: hiçbir kenar ABSENT öğrenmez. */
    expect(getCapabilityEdges().some((x) => x.presence === 'ABSENT')).toBe(false);
    const g = collectResolvableGaps(T0 + 10)
      .find((x) => x.gapClass === 'TRANSPORT_LIMITATION')!;
    expect(classifyRootCause(g)).toBe('TRANSPORT_BOUND');
  });

  it('boşluk kaydına HAM YANIT sızmaz (gizlilik)', async () => {
    bridge(() => ({ outcome: 'negative_nrc', kind: 'NEGATIVE', raw: '7F1912', nrc: 0x12 }));
    await discover();
    const dump = JSON.stringify(getGapRegistry());
    expect(dump).not.toContain('7F1912');
    expect(dump.toLowerCase()).not.toContain('vin');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   4) RETENTION — asıl PASS ölçütü
   ══════════════════════════════════════════════════════════════════════════ */

describe('F5D · tavanlı defter kırpılsa BİLE bağlam korunur', () => {
  it('probe defteri SİLİNSE bile oturum-koşullu bağlam kanıttan türetilir', async () => {
    bridge(() => ({ outcome: 'negative_nrc', kind: 'NEGATIVE', raw: '7F1922', nrc: 0x22 }));
    await discover();

    /* ⚠️ F5-C'de bu satır kanıt zincirini KOPARIYORDU. F5-D'den sonra kanıt
       boşluğun KENDİ zarfındadır; ephemeral defter artık ZORUNLU DEĞİL. */
    _resetServiceDiscoveryForTest();
    expect(getProbeRecords()).toHaveLength(0);

    const g = collectResolvableGaps(T0 + 50).find((x) => x.target.service === '19');
    expect(g).toBeDefined();
    expect(g!.target.ecuKey).toBe('ECM@7E0');
    expect(g!.lastNrc).toBe(0x22);
    expect(g!.sessionConditioned).toBe(true);
    expect(classifyRootCause(g!)).toBe('SESSION_CONDITIONED');
  });

  it('oturum ihtiyacı KANONİK zarftan çözülür — oturum semantiği tek yerde', async () => {
    bridge(() => ({ outcome: 'negative_nrc', kind: 'NEGATIVE', raw: '7F1922', nrc: 0x22 }));
    await discover();
    _resetServiceDiscoveryForTest();

    const row = getGapRegistry().find((r) => r.evidence?.observedNrc === 0x22)!;
    const req = deriveSessionRequirement(
      sessionEvidenceFromGapEvidence(row.evidence));
    expect(req.required).toBe(true);
    expect(req.source).toBe('SESSION_FAMILY_NRC');
    expect(req.nrc).toBe(0x22);
    /* Uydurma oturum baytı YOK. */
    expect(req.command).toBeNull();
  });

  it('sınıflandırması ölçülmemiş zarf oturum ihtiyacı ÜRETMEZ (fail-closed)', () => {
    expect(sessionEvidenceFromGapEvidence(ev({ classification: null }))).toBeNull();
    expect(deriveSessionRequirement(null).required).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   5) KAPANIŞ KANITI — doğum kanıtı DEĞİŞMEZ
   ══════════════════════════════════════════════════════════════════════════ */

describe('F5D · kapanış kanıtı', () => {
  it('RESOLVED doğum kanıtını SİLMEZ; kapatan kanıt AYRI tutulur', async () => {
    bridge(() => ({ outcome: 'negative_nrc', kind: 'NEGATIVE', raw: '7F1922', nrc: 0x22 }));
    await discover();
    const born = getGapRegistry().find((r) => r.evidence?.observedNrc === 0x22)!;
    const bornEvidence = born.evidence;
    expect(born.resolutionState).toBe('OPEN');
    expect(born.resolution).toBeNull();

    sent = [];
    bridge(() => ({
      outcome: 'ok', kind: 'OK', raw: '5902FFAA',
      sessionOpened: true, sessionCommand: '1003',
    }));
    const res = await runGapResolution(rctx());
    expect(res.resolved).toBeGreaterThan(0);

    const after = getGapEntry(born.key)!;
    /* DOĞUM kanıtı bayt bayt AYNI referans — hiçbir dal üstüne yazmadı. */
    expect(after.evidence).toBe(bornEvidence);
    expect(after.evidence!.observedNrc).toBe(0x22);
    /* KAPANIŞ kanıtı AYRI alanda. */
    expect(after.resolutionState).toBe('RESOLVED');
    expect(after.resolution).not.toBeNull();
    expect(after.resolution!.classification).toBe('PRESENT');
    expect(after.resolution!.provenance).toBe('live');
    expect(after.resolution!.resolvedAtMs).toBe(T0 + 100);
  });

  it('bilinmeyen anahtar "kapandı" diye UYDURULMAZ', () => {
    expect(markGapResolved({
      key: 'yok', evidenceRef: null, classification: null,
      provenance: null, resolvedAtMs: null, detail: '',
    })).toBe(false);
    expect(getGapRegistry()).toHaveLength(0);
  });

  it('kapandıktan sonra tekrar ölçülen boşluk REOPENED — sahte "tamam" YOK', () => {
    recordGap({ signal: 'CAPABILITY_GAP', scope: 'AUTHORITY',
      context: 'discovery:1902', atMs: T0, evidence: ev() });
    const k = getGapRegistry()[0].key;
    markGapResolved({ key: k, evidenceRef: 'c9', classification: 'PRESENT',
      provenance: 'live', resolvedAtMs: T0 + 1, detail: 'kapandı' });
    recordGap({ signal: 'CAPABILITY_GAP', scope: 'AUTHORITY',
      context: 'discovery:1902', atMs: T0 + 2, evidence: ev() });

    const e = getGapEntry(k)!;
    expect(e.resolutionState).toBe('REOPENED');
    /* Kapanış kanıtı da SİLİNMEZ — tarih korunur. */
    expect(e.resolution!.evidenceRef).toBe('c9');
    expect(e.count).toBe(2);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   6) LEGACY / KANITSIZ ÜRETİCİ — dürüst fail-closed
   ══════════════════════════════════════════════════════════════════════════ */

describe('F5D · kanıtsız kayıt fail-closed', () => {
  it('zarfsız kayıt UNAVAILABLE — kanıt varmış gibi GÖSTERİLMEZ', () => {
    recordGap({ signal: 'UNKNOWN_SERVICE', scope: 'AUTHORITY',
      context: 'discovery:19', atMs: T0 });
    const row = getGapRegistry()[0];
    expect(row.evidence).toBeNull();
    expect(row.evidenceState).toBe('UNAVAILABLE');
    expect(isGapEvidenceSufficient(row.evidence)).toBe(false);
  });

  it('parser/uygunluk boşluğu HAM GÖVDE kopyalamaz ve kanıt UYDURMAZ', () => {
    recordConformanceRun({
      runId: 'r1', provenance: 'replay', verdict: 'FAIL',
      checks: [], stage: 'PARITY', abort: null, abortDetail: null,
      sourceTraceId: 't1', sourceEventCount: 3, packageChecksum: 'ck',
      mismatchLayers: ['PARSER'], gapSignals: ['PARSER_PARITY_MISMATCH'],
      counts: { match: 0, mismatch: 1, unmeasured: 0 },
    } as unknown as Parameters<typeof recordConformanceRun>[0], T0);

    const row = getGapRegistry().find((r) => r.signal === 'PARSER_PARITY_MISMATCH')!;
    expect(row.evidence).toBeNull();
    expect(row.evidenceState).toBe('UNAVAILABLE');
    const dump = JSON.stringify(getGapRegistry());
    expect(dump.toLowerCase()).not.toContain('rawresponse');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   7) KÖKEN — replay/sentetik ÜRÜN GÜVENİ ÜRETMEZ
   ══════════════════════════════════════════════════════════════════════════ */

describe('F5D · köken (provenance)', () => {
  it('replay kanıtı zarfta AÇIKÇA görünür ve ürün güveni ÜRETMEZ', async () => {
    bridge(() => ({ outcome: 'ok', kind: 'OK', raw: '5902FFAA' }));
    await discover({ provenance: 'replay' });
    bridge(() => ({ outcome: 'timeout', kind: 'TIMEOUT' }));
    await discover({ provenance: 'replay' });

    const rows = getGapRegistry();
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.evidence?.provenance).toBe('replay');
    expect(getCapabilityEdges().every((e) => e.productTrusted === false)).toBe(true);
  });

  it('replay boşluğu RESOLVED üretmez (saha başarısı SAYILMAZ)', async () => {
    bridge(() => ({ outcome: 'timeout', kind: 'TIMEOUT' }));
    await discover({ provenance: 'replay' });
    bridge(() => ({ outcome: 'ok', kind: 'OK', raw: '5902FFAA' }));

    const res = await runGapResolution(rctx({ provenance: 'replay' }));
    expect(res.resolved).toBe(0);
    const entry = getGapRegistry().find((r) => r.resolutionState === 'RESOLVED');
    expect(entry).toBeUndefined();
  });

  it('aynı ölçüm iki ayrı koşuda AYNI kimliği üretir (replay determinizmi)', async () => {
    bridge(() => ({ outcome: 'timeout', kind: 'TIMEOUT' }));
    await discover({ provenance: 'replay' });
    const first = getGapRegistry().map((r) => r.key).sort();

    _resetGapRegistryForTest();
    _resetServiceDiscoveryForTest();
    await discover({ provenance: 'replay' });
    const second = getGapRegistry().map((r) => r.key).sort();

    expect(second).toEqual(first);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   8) LAB — salt-okunur, fail-closed hüküm
   ══════════════════════════════════════════════════════════════════════════ */

describe('F5D · CAROS LAB kanıt bağı yüzeyi', () => {
  it('LAB okuması HİÇBİR ölçüm tetiklemez ve sicili DEĞİŞTİRMEZ', async () => {
    bridge(() => ({ outcome: 'negative_nrc', kind: 'NEGATIVE', raw: '7F1912', nrc: 0x12 }));
    await discover();
    const before = sent.length;
    const rowsBefore = getGapRegistry().length;

    readGapResolverSnapshot();
    buildResolverCards(readGapResolverSnapshot());
    buildResolverRows(readGapResolverSnapshot());

    expect(sent.length).toBe(before);
    expect(getGapRegistry()).toHaveLength(rowsBefore);
  });

  it('kanıt bağı SAĞLAMSA satır bunu gösterir; ham yanıt GÖSTERİLMEZ', async () => {
    bridge(() => ({ outcome: 'negative_nrc', kind: 'NEGATIVE', raw: '7F1912', nrc: 0x12 }));
    await discover();
    await runGapResolution(rctx());

    const rows = buildResolverRows(readGapResolverSnapshot());
    const r = rows.find((x) => x.evidenceState === 'MEASURED');
    expect(r).toBeDefined();
    expect(r!.evidenceEcu).toBe('ECM@7E0');
    expect(r!.evidenceNrc).toBe('0x12');
    expect(r!.evidenceProvenance).toBe('live');
    expect(JSON.stringify(rows)).not.toContain('7F1912');
  });

  it('kanıtsız satır LAB\'da FAIL-CLOSED "EKSİK" hükmü üretir', () => {
    recordGap({ signal: 'UNKNOWN_SERVICE', scope: 'AUTHORITY',
      context: 'discovery:19', atMs: T0 });
    const card = buildResolverCards(readGapResolverSnapshot())
      .find((c) => c.id === 'evidence')!;
    const verdict = card.fields.find((f) => f.id === 'evverdict')!;
    expect(verdict.value).toContain('EKSİK');
  });

  it('KAYNAK YOK ile gerçek 0 AYRI gösterilir', () => {
    const empty = buildResolverCards(readGapResolverSnapshot())
      .find((c) => c.id === 'evidence')!;
    expect(empty.fields[0].klass).toBe('UNAVAILABLE');
    expect(summarizeGapEvidence().total).toBe(0);

    recordGap({ signal: 'CAPABILITY_GAP', scope: 'AUTHORITY',
      context: 'discovery:1902', atMs: T0, evidence: ev() });
    const filled = buildResolverCards(readGapResolverSnapshot())
      .find((c) => c.id === 'evidence')!;
    expect(filled.fields[0].klass).toBe('OBSERVED');
    expect(filled.fields.find((f) => f.id === 'evverdict')!.value)
      .toContain('SAĞLAM');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   9) ÇÖZÜCÜ DURUMU — kanıt boşluğun durumuna TAŞINIR
   ══════════════════════════════════════════════════════════════════════════ */

describe('F5D · çözücü durumu kanıt taşır', () => {
  it('boşluk durumu kendi kanıt zarfını ve sicil anahtarını taşır', async () => {
    bridge(() => ({ outcome: 'negative_nrc', kind: 'NEGATIVE', raw: '7F1912', nrc: 0x12 }));
    await discover();
    await runGapResolution(rctx());

    const st = getGapStates().find((s) => s.gap.origin === 'REGISTRY')!;
    expect(st.gap.evidenceState).toBe('MEASURED');
    expect(st.gap.registryKey).not.toBeNull();
    expect(getGapEntry(st.gap.registryKey!)).not.toBeNull();
  });
});
