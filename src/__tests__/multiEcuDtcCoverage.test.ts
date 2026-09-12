/**
 * multiEcuDtcCoverage.test.ts — P0-VDK-F6B · ÇOKLU-ECU ÜRETİCİ DTC KAPSAMI.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── BU DOSYANIN KİLİTLEDİĞİ SÖZLEŞME ──────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 *   ECU BULUNDU ≠ SERVİS DESTEKLENİYOR ≠ DTC YOK ≠ ARAÇ TEMİZ.
 *
 * Ölçülmüş HER uç nokta için ürün şu soruyu kanıt zinciriyle yanıtlayabilmeli:
 * "neyi sordum, ne cevap verdi, neyi okuyamadım ve NEDEN?"
 *
 * Kilitler dört eksende: (1) plan VERİDEN türer, rol tablosu YOK · (2) kapsam
 * DÜRÜSTTÜR (sorulmayan servis TAM değildir) · (3) BÜTÇE tektir ve kör süpürme
 * yoktur · (4) GÜVENLİK pazarlıksızdır (destructive PDU = 0).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const epochRef = { value: 0 };
const protocolRef = { value: '6' as string | null };

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: vi.fn(() => true) },
}));
vi.mock('../platform/nativePlugin', () => ({
  CarLauncher: {
    probeEcus:         vi.fn(),
    readDtcFromEcu:    vi.fn(),
    readUdsDtcs:       vi.fn(),
    readAdvancedDtcs:  vi.fn(),
    readKwpDtcs:       vi.fn(),
    sendTesterPresent: vi.fn(),
  },
}));
vi.mock('../platform/obdService', () => ({
  getOBDDataSnapshot: () => ({ connectionState: 'connected', transportConnected: true, dataFresh: true }),
  getObdSessionHealth: () => ({
    transportReady: true, sessionReady: true, pollingActive: true, dataFresh: true, ready: true,
  }),
  getEcuRecoveryLadder: () => ({ inFlight: false, nativeReconnectInFlight: false }),
  getObdSessionEpoch: () => epochRef.value,
  getHandshakeDiagnostics: () => ({ protocolActive: protocolRef.value, protocolTried: null }),
}));

import { CarLauncher } from '../platform/nativePlugin';
import { buildTopology } from '../platform/obd/ecuDiscovery';
import {
  scanAllEcus, MAX_EXTENDED_DATA_READS_PER_ECU, _resetIsoTpTunedKeysForTest,
} from '../platform/obd/multiEcuScan';
import {
  DTC_COVERAGE_CLASS_SPECS, compareDeclaredRecordCount, coverageOutcomeFromAdvanced,
  coverageOutcomeFromSkip, dtcCoverageSpec, isCoverageIncomplete, isCoverageTerminal,
  planEcuDtcCoverage, planStatusMask, rollupEcuDtcCoverage,
  type DtcCoveragePlanInput,
} from '../platform/obd/dtcCoveragePlan';
import {
  getDtcCoverageEvidence, summarizeDtcCoverage, _resetDtcCoverageEvidenceForTest,
} from '../platform/obd/dtcCoverageEvidence';
import { builtinServiceDefs, extraReadOnlyServiceDefs } from '../platform/obd/cddl/legacyAdapter';
import {
  GENERIC_UDS_19_SUBS, DESTRUCTIVE_SERVICES,
} from '../platform/obd/genericPduTransport';
import {
  _resetTransactionsForTest, _setTransactionClockForTest, beginTransaction,
  prepareTransactionSync, cancelTransaction,
} from '../platform/obd/diagnosticTransaction';
import { _resetDtcAuthorityForTest, getDtcAuthoritySnapshot } from '../platform/obd/dtcAuthority';
import { _resetAdvancedDtcEvidenceForTest } from '../platform/obd/advancedDtcEvidence';
import { _resetPhysicalProbesForTest } from '../platform/obd/physicalEcuProbe';
import { _resetSchedulerForTest, _setSchedulerClockForTest } from '../platform/obd/diagnosticSessionScheduler';
import { _resetSessionEvidenceForTest } from '../platform/obd/diagnosticSessionEvidence';
import { _resetDtcPipelineForTest } from '../platform/obd/dtcPipelineAccounting';
import { readMultiEcuDtcCoverageSnapshot } from '../platform/devtools/multiEcuDtcCoverageSources';
import {
  buildCoverageCards, deriveCoverageRunVerdict,
} from '../platform/devtools/multiEcuDtcCoverageModel';

const clock = { t: 1_000 };

/** Motor (7E0/7E8) + rolü BİLİNMEYEN ikinci uç nokta (7E1/7E9). */
function twoEcuTopology() {
  return buildTopology('7E8 06 41 00 BE\r\n7E9 06 41 00 80', 1_700_000_000_000);
}

type AdvOpts = { service: string; subFunction: string; payload: string; tx: string; rx: string };

/** Varsayılan: standart modlar POZİTİF ve boş; UDS zinciri sessiz. */
function defaultMocks(): void {
  vi.mocked(CarLauncher.readDtcFromEcu).mockResolvedValue(
    { codes: [], supported: true, raw: '4300', outcome: 'OK' } as never);
  vi.mocked(CarLauncher.readAdvancedDtcs!).mockResolvedValue(
    { raw: '', outcome: 'no_response', nrc: null } as never);
  vi.mocked(CarLauncher.readUdsDtcs!).mockResolvedValue({ raw: '', supported: false } as never);
}

beforeEach(() => {
  clock.t = 1_000;
  epochRef.value = 0;
  protocolRef.value = '6';
  vi.clearAllMocks();
  _setTransactionClockForTest(() => clock.t);
  _setSchedulerClockForTest(() => clock.t);
  _resetTransactionsForTest();
  _resetSchedulerForTest();
  _resetSessionEvidenceForTest();
  _resetDtcAuthorityForTest();
  _resetAdvancedDtcEvidenceForTest();
  _resetDtcCoverageEvidenceForTest();
  _resetPhysicalProbesForTest();
  _resetDtcPipelineForTest();
  _resetIsoTpTunedKeysForTest();
  defaultMocks();
});

/** Test kolaylığı: tam plan girdisi; her test yalnız ilgilendiği alanı ezer. */
function planInput(over: Partial<DtcCoveragePlanInput> = {}): DtcCoveragePlanInput {
  return {
    protocolFamily: 'can',
    addressable: true,
    advancedBridge: true,
    legacyUdsBridge: true,
    standardBridge: true,
    readOnlyUdsSubFunctions: GENERIC_UDS_19_SUBS,
    serviceDefIds: new Set([...builtinServiceDefs(), ...extraReadOnlyServiceDefs()].map((d) => d.id)),
    measuredPresence: new Map(),
    ...over,
  };
}

const decisionOf = (i: DtcCoveragePlanInput, cls: string) =>
  planEcuDtcCoverage(i).find((s) => s.cls === cls)!;

/* ══════════════════════════════════════════════════════════════════════════
   1) PLAN VERİDEN TÜRER — ROL TABLOSU YOK
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-VDK-F6B · plan VERİ ODAKLIDIR (rol tablosu YASAK)', () => {
  it('🔒 KİLİT: her kapsam sınıfının CDDL karşılığı GERÇEKTEN vardır (uydurma tanım yok)', () => {
    const ids = new Set([...builtinServiceDefs(), ...extraReadOnlyServiceDefs()].map((d) => d.id));
    for (const spec of DTC_COVERAGE_CLASS_SPECS) {
      if (spec.serviceDefId === null) continue;   // 19-04: tanım YOK, bilinçli
      expect(ids.has(spec.serviceDefId)).toBe(true);
    }
  });

  it('🔒 KİLİT: plan girdisi ROL alanı TAŞIMAZ — rol planı etkileyemez', () => {
    /* Tip düzeyinde kanıt: girdi anahtarlarında rol geçen bir alan YOK.
       Bir gün biri "role" ekleyip `if (role === 'abs')` yazarsa bu kilit düşer. */
    const keys = Object.keys(planInput());
    expect(keys.some((k) => k.toLowerCase().includes('role'))).toBe(false);
  });

  it('🔒 KİLİT: sınıf sırası DETERMİNİSTİKTİR (iki rapor karşılaştırılabilir)', () => {
    const a = planEcuDtcCoverage(planInput()).map((s) => s.cls);
    const b = planEcuDtcCoverage(planInput()).map((s) => s.cls);
    expect(a).toEqual(b);
    expect(a).toEqual(DTC_COVERAGE_CLASS_SPECS.map((s) => s.cls));
  });

  it('adreslenemeyen uç noktada HİÇBİR sınıf sorulmaz (uydurma adres YASAK)', () => {
    const steps = planEcuDtcCoverage(planInput({ addressable: false }));
    expect(steps.every((s) => s.decision === 'SKIP')).toBe(true);
    expect(steps.every((s) => s.skipReason === 'NOT_ADDRESSABLE')).toBe(true);
  });

  it('protokol ÖLÇÜLMEDİYSE KWP dalı fail-closed KAPALIDIR', () => {
    expect(decisionOf(planInput({ protocolFamily: 'unknown' }), 'KWP_DTC_18').skipReason)
      .toBe('PROTOCOL_MISMATCH');
  });

  it('CAN aracında KWP, KWP aracında UDS sınıfları PROTOKOL UYUŞMAZLIĞIDIR (kayıp DEĞİL)', () => {
    expect(decisionOf(planInput({ protocolFamily: 'can' }), 'KWP_DTC_18').skipReason)
      .toBe('PROTOCOL_MISMATCH');
    expect(decisionOf(planInput({ protocolFamily: 'kwp' }), 'UDS_DTC_BY_STATUS').skipReason)
      .toBe('PROTOCOL_MISMATCH');
    /* Uyuşmazlık ölçülmüş bir KAYIP DEĞİLDİR — hüküm düşürmez. */
    expect(coverageOutcomeFromSkip('PROTOCOL_MISMATCH')).toBe('NOT_APPLICABLE');
    expect(isCoverageIncomplete('NOT_APPLICABLE')).toBe(false);
  });

  it('🔒 KİLİT: 0x19-04 native salt-okunur kapı kümesinde YOK → hattan ÇIKAMAZ', () => {
    expect(GENERIC_UDS_19_SUBS.has('04')).toBe(false);
    const step = decisionOf(planInput(), 'UDS_SNAPSHOT_RECORD');
    expect(step.decision).toBe('SKIP');
    /* Tanım da yoktur → uydurma istek KURULAMAZ; sonuç ENGELLİ (ARAÇ kararı DEĞİL). */
    expect(step.skipReason).toBe('NO_SERVICE_DEFINITION');
    expect(coverageOutcomeFromSkip(step.skipReason!)).toBe('BLOCKED');
  });

  it('köprü YOKSA sonuç BİZİM sınırımızdır (BLOCKED), aracın "desteklemiyor"u DEĞİL', () => {
    const s = decisionOf(planInput({ advancedBridge: false, legacyUdsBridge: false }), 'UDS_DTC_BY_STATUS');
    expect(s.skipReason).toBe('TRANSPORT_LIMIT');
    expect(coverageOutcomeFromSkip('TRANSPORT_LIMIT')).toBe('BLOCKED');
    /* Eski dar köprü 0x19-02'yi TAŞIR ama 19-01/03/06/0A'yı taşıyamaz. */
    const legacy = planInput({ advancedBridge: false, legacyUdsBridge: true });
    expect(decisionOf(legacy, 'UDS_DTC_BY_STATUS').decision).toBe('QUERY');
    expect(decisionOf(legacy, 'UDS_SUPPORTED_DTC').skipReason).toBe('TRANSPORT_LIMIT');
    expect(decisionOf(legacy, 'UDS_STATUS_AVAILABILITY').skipReason).toBe('TRANSPORT_LIMIT');
  });

  it('YALNIZ NRC 0x11 bir servisi "yok" yapar — 0x31 yoklamayı KESMEZ', () => {
    const absent = planInput({ measuredPresence: new Map([['19|02', 'ABSENT' as const]]) });
    expect(decisionOf(absent, 'UDS_DTC_BY_STATUS').skipReason).toBe('SERVICE_ABSENT_MEASURED');
    const noisy = planInput({ measuredPresence: new Map([['19|02', 'UNKNOWN' as const]]) });
    expect(decisionOf(noisy, 'UDS_DTC_BY_STATUS').decision).toBe('QUERY');
  });

  it('0x19-06 ÖN KOŞULLUDUR — kör süpürme planda bile YOK', () => {
    expect(decisionOf(planInput(), 'UDS_EXTENDED_DATA').decision).toBe('CONDITIONAL');
    expect(decisionOf(planInput(), 'UDS_EXTENDED_DATA').precondition).toBe('measured_dtc_record');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   2) STATUS MASKESİ VE BEYAN/ÖLÇÜM DÜRÜSTLÜĞÜ
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-VDK-F6B · 19-01 ÖLÇÜMÜ 19-02 planını SINIRLAR', () => {
  it('ölçülen availability maskesi KULLANILIR ve künyesi ÖLÇÜLDÜ olur', () => {
    expect(planStatusMask('09')).toEqual({
      mask: '09', provenance: 'MEASURED',
      detail: '19-01 ölçtü: status availability 09',
    });
  });

  it('maske ölçülemezse FF VARSAYILIR ama varsayım SESSİZ DEĞİLDİR', () => {
    expect(planStatusMask(null).mask).toBe('FF');
    expect(planStatusMask(null).provenance).toBe('ASSUMED_FULL');
    /* `00` ile sorgu HİÇBİR kayıt döndürmezdi → varsayıma düşülür. */
    expect(planStatusMask('00').provenance).toBe('ASSUMED_FULL');
  });

  it('🔒 KİLİT: beyan > ölçüm → COMPLETE DEĞİL, KISMİ', () => {
    expect(compareDeclaredRecordCount(4, 2)).toBe('SHORT');
    expect(coverageOutcomeFromAdvanced('ok', 'SHORT')).toBe('PARTIAL');
    expect(coverageOutcomeFromAdvanced('ok', 'MATCH')).toBe('COMPLETE');
    /* Beyan YOKSA tek bağımsız tanık da yoktur; okuma yine terminaldir. */
    expect(compareDeclaredRecordCount(null, 3)).toBe('UNKNOWN');
    expect(coverageOutcomeFromAdvanced('ok', 'UNKNOWN')).toBe('COMPLETE');
  });

  it('🔒 KİLİT: 19-02 isteği ÖLÇÜLEN maskeyi taşır (sihirli FF YOK)', async () => {
    vi.mocked(CarLauncher.readAdvancedDtcs!).mockImplementation(async (o: unknown) => {
      const { subFunction } = o as AdvOpts;
      if (subFunction === '01') return { raw: '09010001', outcome: 'ok', nrc: null } as never;
      if (subFunction === '02') return { raw: '09' + '0130130 9'.replace(/\s/g, ''), outcome: 'ok', nrc: null } as never;
      return { raw: '', outcome: 'no_response', nrc: null } as never;
    });
    await scanAllEcus(twoEcuTopology());
    const calls = vi.mocked(CarLauncher.readAdvancedDtcs!).mock.calls
      .map((c) => c[0] as unknown as AdvOpts);
    const c02 = calls.filter((c) => c.subFunction === '02');
    expect(c02.length).toBeGreaterThan(0);
    expect(c02.every((c) => c.payload === '09')).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   3) KAPSAM DÜRÜSTLÜĞÜ — "sorulmayan servis COMPLETE değildir"
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-VDK-F6B · kapsam hükmü FAIL-CLOSED', () => {
  it('🔒 KİLİT: tek bir BİLİNMEYEN sınıf bile TAM hükmünü DÜŞÜRÜR', () => {
    const ok = rollupEcuDtcCoverage([
      { cls: 'STANDARD_STORED', outcome: 'COMPLETE' },
      { cls: 'STANDARD_PENDING', outcome: 'UNSUPPORTED_MEASURED' },
    ]);
    expect(ok.verdict).toBe('COMPLETE');
    const bad = rollupEcuDtcCoverage([
      { cls: 'STANDARD_STORED', outcome: 'COMPLETE' },
      { cls: 'UDS_DTC_BY_STATUS', outcome: 'UNKNOWN' },
    ]);
    expect(bad.verdict).toBe('PARTIAL');
  });

  it('🔒 KİLİT: NO_RESPONSE "DTC yok" DEĞİLDİR — BİLİNMİYOR kalır', () => {
    expect(coverageOutcomeFromAdvanced('no_response')).toBe('UNKNOWN');
    expect(coverageOutcomeFromAdvanced('timeout')).toBe('UNKNOWN');
    expect(isCoverageIncomplete('UNKNOWN')).toBe(true);
  });

  it('🔒 KİLİT: parser düşmesi (malformed) "ECU temiz" DEĞİLDİR', () => {
    expect(coverageOutcomeFromAdvanced('malformed')).toBe('UNKNOWN');
  });

  it('🔒 KİLİT: servis desteklenmemesi kapsam KAYBI DEĞİL ama TEMİZLİK KANITI da değil', () => {
    expect(coverageOutcomeFromAdvanced('unsupported')).toBe('UNSUPPORTED_MEASURED');
    expect(isCoverageIncomplete('UNSUPPORTED_MEASURED')).toBe(false);
    expect(isCoverageTerminal('UNSUPPORTED_MEASURED')).toBe(true);
    /* Her sınıf "desteklenmiyor" ise TAM denemez — hafıza HİÇ okunmadı. */
    expect(rollupEcuDtcCoverage([
      { cls: 'STANDARD_STORED', outcome: 'UNSUPPORTED_MEASURED' },
      { cls: 'UDS_DTC_BY_STATUS', outcome: 'UNSUPPORTED_MEASURED' },
    ]).verdict).toBe('UNKNOWN');
  });

  it('🔒 KİLİT: oturum/güvenlik gerektiren okuma KAPSAM KAYBIDIR (kapı ZORLANMAZ)', () => {
    expect(coverageOutcomeFromAdvanced('security_required')).toBe('UNKNOWN');
    expect(coverageOutcomeFromAdvanced('condition_required')).toBe('UNKNOWN');
  });

  it('hiç ölçüm alınmayan uç nokta ERTELENDİ; yalnız kapı/protokol varsa ENGELLİ', () => {
    expect(rollupEcuDtcCoverage([
      { cls: 'STANDARD_STORED', outcome: 'DEFERRED' },
    ]).verdict).toBe('DEFERRED');
    expect(rollupEcuDtcCoverage([
      { cls: 'UDS_DTC_BY_STATUS', outcome: 'BLOCKED' },
      { cls: 'KWP_DTC_18', outcome: 'NOT_APPLICABLE' },
    ]).verdict).toBe('BLOCKED');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   4) ÜRÜN YOLU — ÇOKLU-ECU KAPSAM KANITI
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-VDK-F6B · üretim taraması kapsam kanıtı üretir', () => {
  it('🔒 KİLİT: MOTOR DIŞI uç noktadan üretici DTC okunur ve kaynağı KARIŞMAZ', async () => {
    vi.mocked(CarLauncher.readAdvancedDtcs!).mockImplementation(async (o: unknown) => {
      const { subFunction, tx } = o as AdvOpts;
      if (subFunction === '01') return { raw: 'FF010001', outcome: 'ok', nrc: null } as never;
      /* YALNIZ ikinci uç nokta (7E1) üretici kodu döner. */
      if (subFunction === '02' && tx === '7E1') {
        return { raw: 'FFC12345' + '09', outcome: 'ok', nrc: null } as never;
      }
      if (subFunction === '02') return { raw: 'FF', outcome: 'ok', nrc: null } as never;
      return { raw: '', outcome: 'no_response', nrc: null } as never;
    });

    const report = await scanAllEcus(twoEcuTopology());
    const second = report.results.find((r) => r.ecu.txHeader === '7E1')!;
    const engine = report.results.find((r) => r.ecu.txHeader === '7E0')!;
    expect(second.codes.some((c) => c.fromUds === true)).toBe(true);
    expect(engine.codes.some((c) => c.fromUds === true)).toBe(false);
    expect(second.codes.every((c) => c.ecuTxHeader === '7E1')).toBe(true);
  });

  it('🔒 KİLİT: rolü BİLİNMEYEN uç nokta kapsamdan ATILMAZ — sorgulanır ve sayılır', async () => {
    vi.mocked(CarLauncher.readAdvancedDtcs!).mockResolvedValue(
      { raw: 'FF', outcome: 'ok', nrc: null } as never);
    await scanAllEcus(twoEcuTopology());

    const entries = getDtcCoverageEvidence();
    const unknownRole = entries.filter((e) => e.role === null || e.role === 'unknown');
    expect(unknownRole.length).toBeGreaterThan(0);
    /* Rolsüz uç noktaya GERÇEKTEN istek gitti. */
    expect(unknownRole.every((e) => e.requestCount > 0)).toBe(true);
    expect(summarizeDtcCoverage(entries).unknownRoleQueried).toBeGreaterThan(0);
  });

  it('🔒 KİLİT: uç nokta kapsamı DETERMİNİSTİK sırada ve OTURUM MÜHÜRLÜ döner', async () => {
    await scanAllEcus(twoEcuTopology());
    const first = getDtcCoverageEvidence().map((e) => e.rxHeader);
    expect(first).toEqual([...first].sort());

    /* Yeni oturum → eski aracın kapsamı DÜŞER (A/B çapraz yükleme YOK). */
    epochRef.value = 7;
    _resetTransactionsForTest();
    await scanAllEcus(twoEcuTopology());
    const after = getDtcCoverageEvidence();
    expect(after.every((e) => e.sessionEpoch === 7)).toBe(true);
  });

  it('🔒 KİLİT: adreslenemeyen uç noktaya SIFIR PDU gider', async () => {
    /* `txProvenance: 'unknown'` → fiziksel hedef türetilemedi. */
    const topo = buildTopology('7E8 06 41 00 BE', 1_700_000_000_000);
    const broken = {
      ...topo,
      ecus: topo.ecus.map((e) => ({ ...e, txHeader: '', txProvenance: 'unknown' as const })),
    };
    await scanAllEcus(broken);
    expect(vi.mocked(CarLauncher.readDtcFromEcu)).not.toHaveBeenCalled();
    expect(vi.mocked(CarLauncher.readAdvancedDtcs!)).not.toHaveBeenCalled();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   5) BÜTÇE — F1-A TEK OTORİTE, KÖR SÜPÜRME YOK
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-VDK-F6B · bütçe ve kör süpürme yasağı', () => {
  it('🔒 KİLİT: ÖLÇÜLMÜŞ DTC kaydı yoksa 0x19-06 HİÇ gönderilmez', async () => {
    vi.mocked(CarLauncher.readAdvancedDtcs!).mockImplementation(async (o: unknown) => {
      const { subFunction } = o as AdvOpts;
      if (subFunction === '01') return { raw: 'FF010000', outcome: 'ok', nrc: null } as never;
      /* Pozitif ama BOŞ liste: yalnız availability baytı. */
      if (subFunction === '02' || subFunction === '0A') {
        return { raw: 'FF', outcome: 'ok', nrc: null } as never;
      }
      if (subFunction === '03') return { raw: '', outcome: 'ok', nrc: null } as never;
      return { raw: '', outcome: 'no_response', nrc: null } as never;
    });
    await scanAllEcus(twoEcuTopology());
    const calls = vi.mocked(CarLauncher.readAdvancedDtcs!).mock.calls
      .map((c) => c[0] as unknown as AdvOpts);
    expect(calls.filter((c) => c.subFunction === '06')).toHaveLength(0);
    /* Ama 0x19-03 (tüm ECU için TEK istek) yine ölçülür. */
    expect(calls.filter((c) => c.subFunction === '03').length).toBeGreaterThan(0);
  });

  it('🔒 KİLİT: 0x19-06 YALNIZ ölçülmüş ham DTC için ve ECU başına TAVANLI gider', async () => {
    /* 12 farklı DTC → tavan 8; 9. istek KURULMAZ. */
    const many = 'FF' + Array.from({ length: 12 },
      (_, i) => `01${i.toString(16).padStart(2, '0')}0009`).join('');
    vi.mocked(CarLauncher.readAdvancedDtcs!).mockImplementation(async (o: unknown) => {
      const { subFunction, tx } = o as AdvOpts;
      if (tx !== '7E0') return { raw: '', outcome: 'no_response', nrc: null } as never;
      if (subFunction === '01') return { raw: 'FF01000C', outcome: 'ok', nrc: null } as never;
      if (subFunction === '02') return { raw: many, outcome: 'ok', nrc: null } as never;
      return { raw: '', outcome: 'ok', nrc: null } as never;
    });
    const topo = buildTopology('7E8 06 41 00 BE', 1_700_000_000_000);
    await scanAllEcus(topo);

    const ext = vi.mocked(CarLauncher.readAdvancedDtcs!).mock.calls
      .map((c) => c[0] as unknown as AdvOpts)
      .filter((c) => c.subFunction === '06');
    /* Vacuous geçmesin: istek GERÇEKTEN gitti ve tam TAVANDA kesildi. */
    expect(ext.length).toBe(MAX_EXTENDED_DATA_READS_PER_ECU);
    /* Gövde HER ZAMAN ölçülmüş ham DTC + seçicidir — uydurma hedef YOK. */
    expect(ext.every((c) => /^[0-9A-F]{6}FF$/.test(c.payload))).toBe(true);
    /* Tavan üstü kalanlar SESSİZCE atılmadı. */
    const entry = getDtcCoverageEvidence().find((e) => e.txHeader === '7E0')!;
    expect(entry.rows.find((r) => r.cls === 'UDS_EXTENDED_DATA')).toBeDefined();
  });

  it('🔒 KİLİT: iptal edilen işlemde derin okuma (19-03/19-06) hattı MEŞGUL ETMEZ', async () => {
    vi.mocked(CarLauncher.readAdvancedDtcs!).mockImplementation(async (o: unknown) => {
      const { subFunction } = o as AdvOpts;
      if (subFunction === '01') return { raw: 'FF010001', outcome: 'ok', nrc: null } as never;
      if (subFunction === '02') return { raw: 'FF0130130 9'.replace(/\s/g, ''), outcome: 'ok', nrc: null } as never;
      return { raw: '', outcome: 'ok', nrc: null } as never;
    });
    const txn = beginTransaction({ purpose: 'multi_ecu_scan' });
    expect(prepareTransactionSync(txn).ok).toBe(true);
    cancelTransaction(txn, 'test');
    await scanAllEcus(twoEcuTopology(), [], txn);

    const calls = vi.mocked(CarLauncher.readAdvancedDtcs!).mock.calls
      .map((c) => c[0] as unknown as AdvOpts);
    expect(calls.filter((c) => c.subFunction === '03')).toHaveLength(0);
    expect(calls.filter((c) => c.subFunction === '06')).toHaveLength(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   6) GÜVENLİK — PAZARLIKSIZ
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-VDK-F6B · SALT-OKUNUR (pazarlıksız)', () => {
  it('🔒 KİLİT: kapsam planı DESTRUCTIVE hiçbir servis ÜRETEMEZ', () => {
    const destructive = new Set(DESTRUCTIVE_SERVICES);
    for (const spec of DTC_COVERAGE_CLASS_SPECS) {
      expect(destructive.has(spec.service)).toBe(false);
    }
    /* 04 clear DTC · 27 SecurityAccess · 14 · 31 · 2E · 11 · 85 … */
    expect(destructive.has('04')).toBe(true);
    expect(destructive.has('27')).toBe(true);
  });

  it('🔒 KİLİT: tam tarama boyunca clear/SecurityAccess/oturum PDU’su ÇIKMAZ', async () => {
    vi.mocked(CarLauncher.readAdvancedDtcs!).mockImplementation(async (o: unknown) => {
      const { subFunction } = o as AdvOpts;
      if (subFunction === '01') return { raw: 'FF010001', outcome: 'ok', nrc: null } as never;
      if (subFunction === '02') return { raw: 'FF01301309', outcome: 'ok', nrc: null } as never;
      return { raw: '', outcome: 'ok', nrc: null } as never;
    });
    await scanAllEcus(twoEcuTopology());

    const services = vi.mocked(CarLauncher.readAdvancedDtcs!).mock.calls
      .map((c) => (c[0] as unknown as AdvOpts).service);
    for (const s of DESTRUCTIVE_SERVICES) expect(services).not.toContain(s);
    /* 0x19 alt fonksiyonlarının TAMAMI native salt-okunur kümenin İÇİNDE. */
    const subs = vi.mocked(CarLauncher.readAdvancedDtcs!).mock.calls
      .map((c) => c[0] as unknown as AdvOpts)
      .filter((c) => c.service === '19').map((c) => c.subFunction);
    expect(subs.every((x) => GENERIC_UDS_19_SUBS.has(x))).toBe(true);
    expect(subs).not.toContain('04');
  });

  it('🔒 KİLİT: kapsam defteri DTC KODU veya ham gövde TAŞIMAZ (gizlilik)', async () => {
    vi.mocked(CarLauncher.readAdvancedDtcs!).mockImplementation(async (o: unknown) => {
      const { subFunction } = o as AdvOpts;
      if (subFunction === '01') return { raw: 'FF010001', outcome: 'ok', nrc: null } as never;
      if (subFunction === '02') return { raw: 'FF01301309', outcome: 'ok', nrc: null } as never;
      return { raw: '', outcome: 'ok', nrc: null } as never;
    });
    await scanAllEcus(twoEcuTopology());
    const json = JSON.stringify(getDtcCoverageEvidence());
    expect(json).not.toContain('P0130');
    expect(json).not.toContain('013013');
    /* Ama SAYIM taşınır — kanıt kaybolmadı, yalnız içerik taşınmadı. */
    expect(json).toContain('recordCount');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   7) OTORİTE VE ALAN KORUNUMU (mevcut sözleşmeler BOZULMADI)
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-VDK-F6B · kanonik otorite tek kalır, alanlar korunur', () => {
  it('🔒 KİLİT: aynı kod farklı ECU’da AYRI gözlemdir (birleşmez)', async () => {
    vi.mocked(CarLauncher.readDtcFromEcu).mockResolvedValue(
      { codes: ['P0301'], supported: true, raw: '430301', outcome: 'OK' } as never);
    await scanAllEcus(twoEcuTopology());
    const obs = getDtcAuthoritySnapshot().observations.filter((o) => o.dtcCode === 'P0301');
    expect(obs.length).toBeGreaterThanOrEqual(2);
    expect(new Set(obs.map((o) => o.ecuKey)).size).toBeGreaterThanOrEqual(2);
  });

  it('🔒 KİLİT: aynı kodun FARKLI alt kodları tek satıra İNMEZ (P0380(11) ≠ P0380(96))', async () => {
    /* Aynı ham DTC, iki farklı FTB baytı → İKİ AYRI kayıt. */
    vi.mocked(CarLauncher.readAdvancedDtcs!).mockImplementation(async (o: unknown) => {
      const { subFunction, tx } = o as AdvOpts;
      if (tx !== '7E0') return { raw: '', outcome: 'no_response', nrc: null } as never;
      if (subFunction === '01') return { raw: 'FF010002', outcome: 'ok', nrc: null } as never;
      if (subFunction === '02') return { raw: 'FF' + '0380110 9'.replace(/\s/g, '') + '038096' + '09', outcome: 'ok', nrc: null } as never;
      return { raw: '', outcome: 'ok', nrc: null } as never;
    });
    const topo = buildTopology('7E8 06 41 00 BE', 1_700_000_000_000);
    const report = await scanAllEcus(topo);
    const rows = report.results[0]!.authorityCodes.filter((c) => c.fromUds === true);
    expect(rows.length).toBe(2);
    expect(new Set(rows.map((c) => c.subCode)).size).toBe(2);
    /* Kapsam defteri de alan korunumunu SAYAR. */
    const entry = getDtcCoverageEvidence().find((e) => e.txHeader === '7E0')!;
    expect(entry.failureTypeCount).toBeGreaterThanOrEqual(2);
    expect(entry.statusByteCount).toBeGreaterThanOrEqual(2);
  });

  it('🔒 KİLİT: kapsam defteri kod listesi TUTMAZ ve hüküm ÜRETMEZ', async () => {
    vi.mocked(CarLauncher.readDtcFromEcu).mockResolvedValue(
      { codes: ['P0301'], supported: true, raw: '430301', outcome: 'OK' } as never);
    await scanAllEcus(twoEcuTopology());

    /* Kapsam defterinde kod SAYISI vardır, kodun KENDİSİ yoktur. */
    const entries = getDtcCoverageEvidence();
    expect(entries.some((e) => e.dtcCount > 0)).toBe(true);
    expect(JSON.stringify(entries)).not.toContain('P0301');

    /* "Temiz mi" sorusunun cevabı YALNIZ dtcAuthority'den gelir ve kapsam
       defteri onu DEĞİŞTİREMEZ: kod varken hüküm 'issues' kalır. */
    const { evaluateVehicleDtcVerdict } = await import('../platform/obd/dtcAuthority');
    expect(evaluateVehicleDtcVerdict().verdict).toBe('issues');

    /* Sözleşme dili: hiçbir kapsam sınıfı etiketi "temiz" iddiası taşımaz. */
    for (const spec of DTC_COVERAGE_CLASS_SPECS) {
      expect(dtcCoverageSpec(spec.cls).label.toLowerCase()).not.toContain('temiz');
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   8) LAB — SALT OKUNUR, KAYNAK YOK ≠ 0
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-VDK-F6B · CAROS LAB kapsam ekranı', () => {
  it('🔒 KİLİT: LAB okuması HİÇBİR PDU tetiklemez', () => {
    readMultiEcuDtcCoverageSnapshot();
    readMultiEcuDtcCoverageSnapshot();
    expect(vi.mocked(CarLauncher.readAdvancedDtcs!)).not.toHaveBeenCalled();
    expect(vi.mocked(CarLauncher.readDtcFromEcu)).not.toHaveBeenCalled();
    expect(vi.mocked(CarLauncher.probeEcus)).not.toHaveBeenCalled();
  });

  it('🔒 KİLİT: ölçüm yokken KAYNAK YOK gösterilir — 0 DEĞİL', () => {
    const snap = readMultiEcuDtcCoverageSnapshot();
    expect(snap.summary).toBeNull();
    expect(deriveCoverageRunVerdict(snap).status).toBe('NEVER_MEASURED');
    const summaryCard = buildCoverageCards(snap).find((c) => c.id === 'summary')!;
    const endpoints = summaryCard.fields.find((f) => f.id === 'endpoints')!;
    expect(endpoints.klass).toBe('UNAVAILABLE');
    expect(endpoints.value).not.toBe('0');
  });

  it('ölçüm varsa uç nokta satırları ve KISMİ hüküm görünür', async () => {
    vi.mocked(CarLauncher.readAdvancedDtcs!).mockResolvedValue(
      { raw: '', outcome: 'no_response', nrc: null } as never);
    await scanAllEcus(twoEcuTopology());
    const snap = readMultiEcuDtcCoverageSnapshot();
    expect(snap.summary).not.toBeNull();
    expect(deriveCoverageRunVerdict(snap).status).toBe('PARTIAL');
    const cards = buildCoverageCards(snap);
    /* Kart listesi İKİ KEZ ADDITIVE büyüdü — kilit HER ikisinde de zayıflatılmadı,
       sıra hâlâ TAM olarak doğrulanıyor:
        · F6-C → "1 · Kanonik Bütünlük" (uç nokta keşfi + tanı kapsamı, AYRI eksen)
        · F6-D → "3 · Kapsam Boşluğu ve Hedefli Yeniden Ölçüm" (boşluk → çözücü) */
    expect(cards.map((c) => c.id))
      .toEqual(['canonical', 'summary', 'healing', 'safety', 'endpoints', 'accounting']);
    const ep = cards.find((c) => c.id === 'endpoints')!;
    expect(ep.fields.length).toBeGreaterThan(0);
    /* Güvenlik kartı ENGELLİ sınıfı (19-04) açıkça gösterir. */
    const safety = cards.find((c) => c.id === 'safety')!;
    const blocked = safety.fields.find((f) => f.id === 'blocked-subs')!;
    expect(blocked.value).toContain('19-04');
  });
});
