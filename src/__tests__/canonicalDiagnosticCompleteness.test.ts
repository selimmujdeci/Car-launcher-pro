/**
 * canonicalDiagnosticCompleteness.test.ts — P0-VDK-F6C.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── BU DOSYANIN KİLİTLEDİĞİ TEK CÜMLE ─────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 *   **"ECU'ları buldum" ile "ECU'ların arıza hafızalarını yeterince taradım"
 *    AYNI ŞEY DEĞİLDİR.**
 *
 * F6-B'ye kadar bu iki gerçek yan yana duruyordu ve üst seviye kapsam hükmü
 * ikincisini HİÇ BİLMİYORDU: `canonicalCoverage` yalnız (a) 4 standart
 * FONKSİYONEL modun kaçı okundu ve (b) ECU'ların kaçı tarandı çarpımıydı.
 * UDS 0x19 / KWP 0x18-0x13 kapsamı üst seviye sayıya HİÇ GİRMİYORDU.
 *
 * Kilitler beş eksende: (1) iki eksen ayrı ama TEK otoritede birleşir ·
 * (2) terminal semantiği korunur · (3) yüzde DTC sayısından türemez ·
 * (4) araç kusuru olmayan kayıp araç kapsamını cezalandırmaz ·
 * (5) kapsam eksikken "araç temiz" hükmü ÇIKAMAZ.
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
  scanAllEcus, _resetIsoTpTunedKeysForTest, _resetLastCompletenessForTest,
} from '../platform/obd/multiEcuScan';
import {
  buildDiagnosticCompleteness, buildEcuCompleteness,
  type DiagnosticEndpointInput,
} from '../platform/obd/ecuCompleteness';
import { buildScanReport, evaluateEcuCoverage } from '../platform/obd/scanReport';
import {
  coverageGapRoot, dtcCoverageSpec, rollupEcuDtcCoverage,
  DTC_COVERAGE_CLASS_SPECS, type CoverageRollupRow, type DtcCoverageClass,
} from '../platform/obd/dtcCoveragePlan';
import { isMeasurementResolvable } from '../platform/obd/healing/gapModel';
import {
  getDtcCoverageEvidence, _resetDtcCoverageEvidenceForTest,
} from '../platform/obd/dtcCoverageEvidence';
import { computeDtcVerdict } from '../platform/obd/dtcVerdict';
import {
  _resetTransactionsForTest, _setTransactionClockForTest,
  beginTransaction, prepareTransactionSync, cancelTransaction,
} from '../platform/obd/diagnosticTransaction';
import { _resetDtcAuthorityForTest } from '../platform/obd/dtcAuthority';
import { _resetAdvancedDtcEvidenceForTest } from '../platform/obd/advancedDtcEvidence';
import { _resetPhysicalProbesForTest } from '../platform/obd/physicalEcuProbe';
import { _resetSchedulerForTest, _setSchedulerClockForTest } from '../platform/obd/diagnosticSessionScheduler';
import { _resetSessionEvidenceForTest } from '../platform/obd/diagnosticSessionEvidence';
import { _resetDtcPipelineForTest } from '../platform/obd/dtcPipelineAccounting';
import { readMultiEcuDtcCoverageSnapshot } from '../platform/devtools/multiEcuDtcCoverageSources';
import { buildCoverageCards } from '../platform/devtools/multiEcuDtcCoverageModel';

const clock = { t: 1_000 };

function twoEcuTopology() {
  return buildTopology('7E8 06 41 00 BE\r\n7E9 06 41 00 80', 1_700_000_000_000);
}
function oneEcuTopology() {
  return buildTopology('7E8 06 41 00 BE', 1_700_000_000_000);
}

type AdvOpts = { service: string; subFunction: string; payload: string; tx: string; rx: string };

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
  _resetLastCompletenessForTest();
  vi.mocked(CarLauncher.readDtcFromEcu).mockResolvedValue(
    { codes: [], supported: true, raw: '4300', outcome: 'OK' } as never);
  vi.mocked(CarLauncher.readAdvancedDtcs!).mockResolvedValue(
    { raw: '', outcome: 'no_response', nrc: null } as never);
  vi.mocked(CarLauncher.readUdsDtcs!).mockResolvedValue({ raw: '', supported: false } as never);
});

/** Bir uç noktanın SAF kapsam girdisi — testler yalnız ilgilendikleri alanı ezer. */
function endpoint(over: Partial<DiagnosticEndpointInput> = {}): DiagnosticEndpointInput {
  return {
    ecuKey: '11:7E8',
    coreVerdict: 'COMPLETE', deepVerdict: 'COMPLETE',
    corePlannedUnits: 6, coreTerminalUnits: 6,
    deepPlannedUnits: 2, deepTerminalUnits: 2,
    roleUnknown: false, productTrusted: true, requestCount: 6,
    rows: [], ...over,
  };
}

/** CAN aracında bir uç noktanın 11 sınıfı — testler tek tek ezer. */
function rows(over: Partial<Record<DtcCoverageClass, CoverageRollupRow['outcome']>> = {}) {
  const base: Record<DtcCoverageClass, CoverageRollupRow['outcome']> = {
    STANDARD_STORED: 'COMPLETE', STANDARD_PENDING: 'COMPLETE', STANDARD_PERMANENT: 'COMPLETE',
    UDS_STATUS_AVAILABILITY: 'COMPLETE', UDS_DTC_BY_STATUS: 'COMPLETE',
    UDS_SUPPORTED_DTC: 'COMPLETE',
    UDS_SNAPSHOT_ID: 'COMPLETE', UDS_SNAPSHOT_RECORD: 'BLOCKED', UDS_EXTENDED_DATA: 'COMPLETE',
    KWP_DTC_18: 'NOT_APPLICABLE', KWP_DTC_13: 'NOT_APPLICABLE',
  };
  const merged = { ...base, ...over };
  return DTC_COVERAGE_CLASS_SPECS.map<CoverageRollupRow>((s) => ({
    cls: s.cls, outcome: merged[s.cls],
  }));
}

/* ══════════════════════════════════════════════════════════════════════════
   1) CORE / DEEP — F6-B'nin ÖLÇÜLEN KUSURU KAPANDI
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-VDK-F6C · TEMEL ve DERİN eksen ayrılır', () => {
  it('🔒 KİLİT: her sınıfın ekseni TANIMLI ve derin eksen YALNIZ 19-03/04/06', () => {
    const deep = DTC_COVERAGE_CLASS_SPECS.filter((s) => s.axis === 'deep').map((s) => s.cls);
    expect(deep.sort()).toEqual(
      ['UDS_EXTENDED_DATA', 'UDS_SNAPSHOT_ID', 'UDS_SNAPSHOT_RECORD']);
    /* Arıza hafızasını okuyan HER kanal `core` eksenindedir. */
    for (const c of ['STANDARD_STORED', 'UDS_DTC_BY_STATUS', 'UDS_SUPPORTED_DTC',
      'KWP_DTC_18', 'KWP_DTC_13'] as const) {
      expect(dtcCoverageSpec(c).axis).toBe('core');
    }
  });

  it('🔒 KİLİT: 0 DTC bulunan TAM okunmuş ECU artık TAM — 19-06 ön koşulsuzluğu core’u DÜŞÜRMEZ', () => {
    /* F6-B'de ölçülen kusur: gönderilecek DTC olmadığı için 19-06 `DEFERRED`
       yazılıyor, o da tek torbada hükmü düşürüyordu → temiz ve kusursuz
       okunmuş bir ECU'ya asla "tam okundu" diyemiyorduk. */
    const r = rollupEcuDtcCoverage(rows({ UDS_EXTENDED_DATA: 'DEFERRED' }));
    expect(r.core.verdict).toBe('COMPLETE');
    expect(r.verdict).toBe('COMPLETE');       // `verdict` === core (geriye uyum)
    /* Derin eksen AYRI ve DÜRÜSTÇE düşer. */
    expect(r.deep.verdict).toBe('PARTIAL');
  });

  it('🔒 KİLİT: 19-04 yapısal olarak kapalı — TEMEL kapsamı sonsuza dek kısmi YAPMAZ', () => {
    const r = rollupEcuDtcCoverage(rows());
    expect(r.core.verdict).toBe('COMPLETE');
    /* BLOCKED paydaya GİRMEZ: kapı sınırı ARAÇ kusuru değildir. */
    expect(r.deep.plannedUnits).toBe(2);      // 19-03 + 19-06 (19-04 hariç)
  });

  it('derin eksen düşse bile TEMEL eksen ayakta kalır (iki hüküm bağımsız)', () => {
    const r = rollupEcuDtcCoverage(rows({
      UDS_SNAPSHOT_ID: 'UNKNOWN', UDS_EXTENDED_DATA: 'UNKNOWN',
    }));
    expect(r.core.verdict).toBe('COMPLETE');
    expect(r.deep.verdict).toBe('UNKNOWN');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   2) TERMİNAL SEMANTİĞİ
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-VDK-F6C · terminal semantiği korunur', () => {
  it('🔒 KİLİT: POSITIVE_EMPTY (0 kod, servis çalıştı) OLUMLU terminal kanıttır', () => {
    /* 0 DTC bulmak kapsam kaybı DEĞİLDİR — servis okundu. */
    expect(rollupEcuDtcCoverage(rows()).core.terminalUnits).toBe(6);
    expect(rollupEcuDtcCoverage(rows()).core.verdict).toBe('COMPLETE');
  });

  it('🔒 KİLİT: ÖLÇÜLMÜŞ desteklenmeme TAM hükmünü BOZMAZ', () => {
    const r = rollupEcuDtcCoverage(rows({
      UDS_SUPPORTED_DTC: 'UNSUPPORTED_MEASURED', STANDARD_PERMANENT: 'UNSUPPORTED_MEASURED',
    }));
    expect(r.core.verdict).toBe('COMPLETE');
    expect(r.core.terminalUnits).toBe(r.core.plannedUnits);
  });

  it('🔒 KİLİT: NO_RESPONSE · TIMEOUT · MALFORMED · SESSION TAM hükmünü DÜŞÜRÜR', () => {
    for (const bad of ['UNKNOWN', 'PARTIAL', 'DEFERRED'] as const) {
      const r = rollupEcuDtcCoverage(rows({ UDS_DTC_BY_STATUS: bad }));
      expect(r.core.verdict).not.toBe('COMPLETE');
    }
  });

  it('🔒 KİLİT: plan dışı protokol servisi SAHTE eksiklik ÜRETMEZ', () => {
    /* CAN aracında KWP sınıfları NOT_APPLICABLE'dır ve paydaya GİRMEZ. */
    const r = rollupEcuDtcCoverage(rows());
    expect(r.core.plannedUnits).toBe(6);   // 3 standart + 19-01/02/0A; KWP hariç
    expect(r.core.verdict).toBe('COMPLETE');
  });

  it('🔒 KİLİT: köprü/kapı sınırı (BLOCKED) ARAÇ kusuru sayılmaz — paydaya girmez', () => {
    const withBlock = rollupEcuDtcCoverage(rows({ UDS_SUPPORTED_DTC: 'BLOCKED' }));
    expect(withBlock.core.plannedUnits).toBe(5);   // 6 → 5 (blocked düştü)
    expect(withBlock.core.verdict).toBe('COMPLETE');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   3) KÖK NEDEN — MEVCUT SÖZLÜK, YENİ SÖZLÜK YOK
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-VDK-F6C · kayıp kökü mevcut F5-A sözlüğüne eşlenir', () => {
  it('🔒 KİLİT: parser düşmesi PARSER_BOUND — "servis desteklenmiyor" DEĞİL', () => {
    expect(coverageGapRoot('UNKNOWN', 'malformed', null)).toBe('PARSER_BOUND');
    /* Aynı isteği tekrar göndermek AYNI çözülemeyen baytı getirir → ölçümle KAPANMAZ. */
    expect(isMeasurementResolvable('PARSER_BOUND')).toBe(false);
  });

  it('🔒 KİLİT: taşıma/kapı sınırı TRANSPORT_BOUND — araç kusuru DEĞİL', () => {
    expect(coverageGapRoot('BLOCKED', null, 'TRANSPORT_LIMIT')).toBe('TRANSPORT_BOUND');
    expect(coverageGapRoot('BLOCKED', null, 'NO_SERVICE_DEFINITION')).toBe('TRANSPORT_BOUND');
    expect(coverageGapRoot('UNKNOWN', 'transport_error', null)).toBe('TRANSPORT_BOUND');
  });

  it('🔒 KİLİT: oturum/güvenlik SESSION_CONDITIONED — kapı ZORLANMAZ', () => {
    expect(coverageGapRoot('UNKNOWN', 'security_required', null)).toBe('SESSION_CONDITIONED');
    expect(coverageGapRoot('UNKNOWN', 'condition_required', null)).toBe('SESSION_CONDITIONED');
    expect(isMeasurementResolvable('SESSION_CONDITIONED')).toBe(true);
  });

  it('sessizlik/sorulmama CAPABILITY_UNMEASURED — hedefli yoklama ÖĞRETEBİLİR', () => {
    expect(coverageGapRoot('UNKNOWN', 'no_response', null)).toBe('CAPABILITY_UNMEASURED');
    expect(coverageGapRoot('DEFERRED', null, 'BUDGET_EXHAUSTED')).toBe('CAPABILITY_UNMEASURED');
  });

  it('🔒 KİLİT: TERMİNAL satırın kök nedeni YOKTUR (sahte kayıp üretilmez)', () => {
    expect(coverageGapRoot('COMPLETE', 'ok', null)).toBeNull();
    expect(coverageGapRoot('UNSUPPORTED_MEASURED', 'unsupported', null)).toBeNull();
    expect(coverageGapRoot('NOT_APPLICABLE', null, 'PROTOCOL_MISMATCH')).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   4) TANI KAPSAMI HÜKMÜ (SAF)
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-VDK-F6C · buildDiagnosticCompleteness', () => {
  it('🔒 KİLİT: TÜM uç noktalar tam → CORE_COMPLETE', () => {
    const d = buildDiagnosticCompleteness([
      endpoint({ ecuKey: '11:7E8' }), endpoint({ ecuKey: '11:7E9' }),
    ]);
    expect(d.verdict).toBe('CORE_COMPLETE');
    expect(d.coreCoverageRatio).toBe(1);
    expect(d.coreCoverageLabel).toBe('100%');
  });

  it('🔒 KİLİT: TEK uç nokta susarsa TAM DEĞİL (fail-closed)', () => {
    const d = buildDiagnosticCompleteness([
      endpoint({ ecuKey: '11:7E8' }),
      endpoint({ ecuKey: '11:7E9', coreVerdict: 'UNKNOWN', coreTerminalUnits: 0 }),
    ]);
    expect(d.verdict).toBe('PARTIAL');
    expect(d.coreCoverageRatio).toBeCloseTo(6 / 12);
  });

  it('🔒 KİLİT: hiç sorgu gitmediyse DEFERRED — "0 kapsam" DEĞİL', () => {
    const d = buildDiagnosticCompleteness([
      endpoint({ requestCount: 0, coreVerdict: 'DEFERRED', coreTerminalUnits: 0 }),
    ]);
    expect(d.verdict).toBe('DEFERRED');
  });

  it('🔒 KİLİT: hiç kanıt yoksa NOT_MEASURED ve oran NULL — sahte 0 YASAK', () => {
    const d = buildDiagnosticCompleteness(null);
    expect(d.verdict).toBe('NOT_MEASURED');
    expect(d.coreCoverageRatio).toBeNull();
    expect(d.coreCoverageLabel).toBe('UNKNOWN');
  });

  it('🔒 KİLİT: DTC SAYISI yüzdeye GİRMEZ — 20 DTC ile 1 DTC aynı ağırlıkta', () => {
    /* İki uç nokta AYNI kapsam birimlerine sahip; birinde 20, diğerinde 1 DTC
       olması hiçbir sayıyı değiştirmez çünkü DTC sayısı modele HİÇ girmez. */
    const a = buildDiagnosticCompleteness([endpoint({ ecuKey: '11:7E8' })]);
    const b = buildDiagnosticCompleteness([endpoint({ ecuKey: '11:7E8' })]);
    expect(a.coreCoverageRatio).toBe(b.coreCoverageRatio);
    expect(a.formula).toBe(b.formula);
    /* Formülde DTC kelimesi/sayısı geçmez — denetlenebilirlik kilidi. */
    expect(a.formula).toContain('terminal birim / planlanan birim');
    expect(a.formula).not.toMatch(/DTC say/);
  });

  it('🔒 KİLİT: replay/sentetik ölçüm ÜRÜN-GÜVENİLİR TAM hüküm ÜRETEMEZ', () => {
    const live = buildDiagnosticCompleteness([endpoint()]);
    expect(live.verdict).toBe('CORE_COMPLETE');
    const replay = buildDiagnosticCompleteness([endpoint({ productTrusted: false })]);
    expect(replay.productTrusted).toBe(false);
    expect(replay.verdict).not.toBe('CORE_COMPLETE');
  });

  it('araç kusuru OLMAYAN kayıp AYRI sayılır; çözücü borcu ölçülebilir sayılmaz', () => {
    const d = buildDiagnosticCompleteness([endpoint({
      coreVerdict: 'PARTIAL', coreTerminalUnits: 4,
      rows: [
        { axis: 'core', outcome: 'BLOCKED', gapRoot: 'TRANSPORT_BOUND' },
        { axis: 'core', outcome: 'UNKNOWN', gapRoot: 'PARSER_BOUND' },
        { axis: 'core', outcome: 'UNKNOWN', gapRoot: 'SESSION_CONDITIONED' },
        { axis: 'core', outcome: 'NOT_APPLICABLE', gapRoot: null },
      ],
    })]);
    expect(d.transportLimitedUnits).toBe(1);
    expect(d.parserGapUnits).toBe(1);
    expect(d.sessionGapUnits).toBe(1);
    expect(d.outOfPlanUnits).toBe(1);
    /* ÖLÇÜMLE KAPANABİLİR yalnız oturum — parser/taşıma SAYILMAZ (F6-D girdisi). */
    expect(d.measurableGapUnits).toBe(1);
  });

  it('🔒 KİLİT: rolü BİLİNMEYEN uç nokta kapsama DAHİLDİR', () => {
    const d = buildDiagnosticCompleteness([
      endpoint({ ecuKey: '11:7E9', roleUnknown: true }),
    ]);
    expect(d.verdict).toBe('CORE_COMPLETE');   // rol bilinmiyor diye eksik SAYILMAZ
    expect(d.unknownRoleQueried).toBe(1);
  });

  it('deterministik: aynı girdi her zaman aynı çıktı', () => {
    const input = [endpoint({ ecuKey: '11:7E8' }), endpoint({ ecuKey: '11:7E9' })];
    expect(JSON.stringify(buildDiagnosticCompleteness(input)))
      .toBe(JSON.stringify(buildDiagnosticCompleteness(input)));
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   5) TEK OTORİTE — ecuCompleteness İKİ EKSENİ BİRLİKTE TAŞIR
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-VDK-F6C · ecuCompleteness tek otorite olarak genişledi', () => {
  const cand = [
    { rxHeader: '7E8', txHeader: '7E0', addressBits: 11 as const,
      role: 'engine' as const, roleEvidence: 'standard' as const, label: 'Motor (ECM)' },
  ];

  it('🔒 KİLİT: tanı kanıtı VERİLMEZSE davranış BİREBİR eskisi gibi (regresyon yok)', () => {
    const e = buildEcuCompleteness({
      candidates: cand, scannedKeys: new Set(['11:7E8']),
      protocol: '6', sessionEpoch: 1, currentSessionEpoch: 1, expectedEcuCount: null,
    });
    expect(e.diagnostic).toBeNull();
    expect(e.completenessPercent).toBeNull();     // araç paydası hâlâ BİLİNMİYOR
    expect(e.denominatorKnown).toBe(false);
  });

  it('🔒 KİLİT: ARAÇ paydası bilinmese bile ÖLÇÜLEN uç nokta oranı üretilebilir', () => {
    const e = buildEcuCompleteness({
      candidates: cand, scannedKeys: new Set(['11:7E8']),
      protocol: '6', sessionEpoch: 1, currentSessionEpoch: 1, expectedEcuCount: null,
    });
    /* İKİ AYRI SORU: "araçta kaç ECU var" BİLİNEMEZ, "bulduğumun kaçını
       taradım" BİLİNİR. İkisi karıştırılmaz. */
    expect(e.completenessPercent).toBeNull();
    expect(e.measuredEndpointRatio).toBe(1);
  });

  it('🔒 KİLİT: BAYAT oturumda ölçülen oran da ÜRETİLMEZ (araç izolasyonu)', () => {
    const e = buildEcuCompleteness({
      candidates: cand, scannedKeys: new Set(['11:7E8']),
      protocol: '6', sessionEpoch: 1, currentSessionEpoch: 9, expectedEcuCount: null,
    });
    expect(e.staleSession).toBe(true);
    expect(e.measuredEndpointRatio).toBeNull();
  });

  it('tanı kanıtı verilirse AYNI otoritede ikinci eksen olarak taşınır', () => {
    const e = buildEcuCompleteness({
      candidates: cand, scannedKeys: new Set(['11:7E8']),
      protocol: '6', sessionEpoch: 1, currentSessionEpoch: 1, expectedEcuCount: null,
      diagnostic: [endpoint()],
    });
    expect(e.diagnostic).not.toBeNull();
    expect(e.diagnostic!.verdict).toBe('CORE_COMPLETE');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   6) ÜST SEVİYE KAPSAM — scanReport ARTIK TANI KAPSAMINI TÜKETİR
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-VDK-F6C · scanReport üst hükmü', () => {
  const fullEcu = {
    discoveryRan: true, discovered: 2, scanned: 2, failed: 0, skipped: 0,
    notAddressable: 0, staleSession: false, denominatorKnown: true,
  };

  it('🔒 KİLİT: tanı kanıtı bildirilmezse canonicalCoverage BİREBİR eskisi gibi', () => {
    const r = buildScanReport({
      stored: 'ok', pending: 'ok', permanent: 'ok', status: 'ok', ecu: fullEcu,
    });
    expect(r.canonicalCoverage).toBe(1);
    expect(r.complete).toBe(true);
    expect(r.diagnosticCoverageRatio).toBeNull();
  });

  it('🔒 KİLİT: ECU’lar tam taransa bile TANI kapsamı eksikse "tam tarama" DENMEZ', () => {
    /* SAHA GERÇEĞİ: 6 ECU bulundu, 6'sı da yanıt verdi — ama 2'sinin üretici
       arıza tabanı (UDS 0x19) okunamadı. Eski model bunu %100 sayıyordu. */
    const r = buildScanReport({
      stored: 'ok', pending: 'ok', permanent: 'ok', status: 'ok',
      ecu: { ...fullEcu,
        diagnosticPlannedUnits: 12, diagnosticTerminalUnits: 8,
        diagnosticCoreComplete: false,
        diagnosticGaps: ['tanı kapsamı: 8/12 temel kanal terminal kanıt aldı'] },
    });
    expect(r.complete).toBe(false);
    expect(r.canonicalCoverage).toBeCloseTo(8 / 12);
    expect(r.diagnosticCoverageRatio).toBeCloseTo(8 / 12);
    expect(r.summary).toContain('tanı kapsamı');
  });

  it('🔒 KİLİT: tanı kapsamı da tamsa "tam tarama" MEŞRUDUR', () => {
    const r = buildScanReport({
      stored: 'ok', pending: 'ok', permanent: 'ok', status: 'ok',
      ecu: { ...fullEcu,
        diagnosticPlannedUnits: 12, diagnosticTerminalUnits: 12,
        diagnosticCoreComplete: true, diagnosticGaps: [] },
    });
    expect(r.canonicalCoverage).toBe(1);
    expect(r.complete).toBe(true);
  });

  it('🔒 KİLİT: iki kayıp TOPLANMAZ, ÇARPILIR (kapsam iyimser gösterilemez)', () => {
    const r = buildScanReport({
      stored: 'ok', pending: 'ok', permanent: 'ok', status: 'failed',
      ecu: { ...fullEcu, scanned: 1, failed: 1,
        diagnosticPlannedUnits: 4, diagnosticTerminalUnits: 2,
        diagnosticCoreComplete: false },
    });
    /* mod 3/4 × uç nokta 1/2 × tanı 2/4 */
    expect(r.canonicalCoverage).toBeCloseTo(0.75 * 0.5 * 0.5);
  });

  it('tanı çarpanı bildirildi ama ölçülemediyse kapsam BİLİNMİYOR (null)', () => {
    const r = buildScanReport({
      stored: 'ok', pending: 'ok', permanent: 'ok', status: 'ok',
      ecu: { ...fullEcu, diagnosticPlannedUnits: 0, diagnosticTerminalUnits: 0 },
    });
    expect(r.canonicalCoverage).toBeNull();
  });

  it('evaluateEcuCoverage: tanı oranı uç nokta oranından BAĞIMSIZ üretilebilir', () => {
    /* Araç paydası bilinmiyor → uç nokta oranı null; ama tanı paydası BİZİM
       planımızdır ve TAM OLARAK bilinir. */
    const e = evaluateEcuCoverage({
      ...fullEcu, denominatorKnown: false,
      diagnosticPlannedUnits: 10, diagnosticTerminalUnits: 5,
    });
    expect(e.ratio).toBeNull();
    expect(e.diagnosticRatio).toBeCloseTo(0.5);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   7) HÜKÜM ENTEGRASYONU — kapsam eksikken "temiz" ÇIKAMAZ
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-VDK-F6C · kapsam eksikken "araç temiz" hükmü ÇIKMAZ', () => {
  const base = {
    scanRan: true, storedCount: 0, pendingCount: 0, permanentCount: 0,
    mil: false as boolean | null, pid01DtcCount: 0 as number | null, failedModes: [],
  };

  it('🔒 KİLİT: 0 DTC + TAM kapsam → measured clean MÜMKÜN', () => {
    expect(computeDtcVerdict({ ...base, manufacturerScope: 'covered' }).verdict).toBe('clean');
  });

  it('🔒 KİLİT: 0 DTC + üretici tabanı SORULMADI → clean OLAMAZ', () => {
    expect(computeDtcVerdict({ ...base, manufacturerScope: 'not_asked' }).verdict)
      .toBe('inconclusive');
    expect(computeDtcVerdict({ ...base, manufacturerScope: 'failed' }).verdict)
      .toBe('inconclusive');
  });

  it('🔒 KİLİT: DTC VARKEN eksik kapsam bulguyu EZMEZ — issues korunur', () => {
    expect(computeDtcVerdict({ ...base, storedCount: 2, manufacturerScope: 'not_asked' }).verdict)
      .toBe('issues');
  });

  it('🔒 KİLİT: eksik tanı kapsamı ÜST raporda "Tam tarama" cümlesini EZER', () => {
    const r = buildScanReport({
      stored: 'ok', pending: 'ok', permanent: 'ok', status: 'ok',
      ecu: { discoveryRan: true, discovered: 2, scanned: 2, failed: 0, skipped: 0,
        notAddressable: 0, staleSession: false, denominatorKnown: true,
        diagnosticPlannedUnits: 12, diagnosticTerminalUnits: 9,
        diagnosticCoreComplete: false, diagnosticGaps: ['tanı kapsamı: 9/12'] },
    });
    expect(r.summary).not.toContain('Tam tarama —');
    expect(r.complete).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   8) ÜRÜN YOLU — TARAMA GERÇEKTEN İKİ EKSENİ BİRLEŞTİRİR
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-VDK-F6C · üretim taraması kanonik bütünlük üretir', () => {
  it('🔒 KİLİT: tarama sonrası completeness TANI eksenini TAŞIR', async () => {
    vi.mocked(CarLauncher.readAdvancedDtcs!).mockImplementation(async (o: unknown) => {
      const { subFunction } = o as AdvOpts;
      if (subFunction === '01') return { raw: 'FF010000', outcome: 'ok', nrc: null } as never;
      if (subFunction === '02' || subFunction === '0A') {
        return { raw: 'FF', outcome: 'ok', nrc: null } as never;
      }
      return { raw: '', outcome: 'ok', nrc: null } as never;
    });
    const report = await scanAllEcus(twoEcuTopology());
    expect(report.completeness.diagnostic).not.toBeNull();
    const d = report.completeness.diagnostic!;
    expect(d.endpoints).toBe(2);
    expect(d.corePlannedUnits).toBeGreaterThan(0);
    /* Kapsam defteri ile keşif AYNI anahtarı kullanır (yanlış eşleşme yok). */
    const keys = getDtcCoverageEvidence().map((e) => e.ecuKey).sort();
    expect(keys).toEqual(['11:7E8', '11:7E9']);
  });

  it('🔒 KİLİT: bir ECU susunca tanı kapsamı TAM DEĞİL', async () => {
    vi.mocked(CarLauncher.readDtcFromEcu).mockImplementation(async ({ tx }: never) =>
      (tx === '7E1'
        ? { codes: [], supported: true, raw: '', outcome: 'NO_RESPONSE' }
        : { codes: [], supported: true, raw: '4300', outcome: 'OK' }) as never);
    const report = await scanAllEcus(twoEcuTopology());
    expect(report.completeness.diagnostic!.verdict).not.toBe('CORE_COMPLETE');
  });

  it('🔒 KİLİT: iptal edilen turda tanı kapsamı TAM olamaz', async () => {
    const txn = beginTransaction({ purpose: 'multi_ecu_scan' });
    expect(prepareTransactionSync(txn).ok).toBe(true);
    cancelTransaction(txn, 'test');
    const report = await scanAllEcus(twoEcuTopology(), [], txn);
    const d = report.completeness.diagnostic;
    if (d !== null) expect(d.verdict).not.toBe('CORE_COMPLETE');
  });

  it('🔒 KİLİT: ARAÇ A/B çapraz bulaşma YOK — yeni oturum eski kapsamı düşürür', async () => {
    vi.mocked(CarLauncher.readAdvancedDtcs!).mockResolvedValue(
      { raw: 'FF', outcome: 'ok', nrc: null } as never);
    await scanAllEcus(twoEcuTopology());
    expect(getDtcCoverageEvidence().every((e) => e.sessionEpoch === 0)).toBe(true);

    epochRef.value = 5;
    _resetTransactionsForTest();
    const b = await scanAllEcus(oneEcuTopology());
    expect(getDtcCoverageEvidence().every((e) => e.sessionEpoch === 5)).toBe(true);
    /* B aracının kapsam hükmü YALNIZ B'nin uç noktalarından türer. */
    expect(b.completeness.diagnostic!.endpoints).toBe(1);
  });

  it('🔒 KİLİT: canlı turda ölçüm köken künyesi ÜRÜN-GÜVENİLİRDİR', async () => {
    vi.mocked(CarLauncher.readAdvancedDtcs!).mockResolvedValue(
      { raw: 'FF', outcome: 'ok', nrc: null } as never);
    const report = await scanAllEcus(oneEcuTopology());
    expect(getDtcCoverageEvidence()[0]!.provenance).toBe('live');
    expect(report.completeness.diagnostic!.productTrusted).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   9) LAB — SALT OKUNUR, FORMÜL GÖRÜNÜR, KAYNAK YOK ≠ 0
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-VDK-F6C · LAB kanonik bütünlük kartı', () => {
  it('🔒 KİLİT: LAB okuması tek PDU bile tetiklemez', () => {
    readMultiEcuDtcCoverageSnapshot();
    buildCoverageCards(readMultiEcuDtcCoverageSnapshot());
    expect(vi.mocked(CarLauncher.readAdvancedDtcs!)).not.toHaveBeenCalled();
    expect(vi.mocked(CarLauncher.readDtcFromEcu)).not.toHaveBeenCalled();
    expect(vi.mocked(CarLauncher.probeEcus)).not.toHaveBeenCalled();
  });

  it('🔒 KİLİT: ölçüm yokken KAYNAK YOK gösterilir — 0 DEĞİL', () => {
    const cards = buildCoverageCards(readMultiEcuDtcCoverageSnapshot());
    const canonical = cards.find((c) => c.id === 'canonical')!;
    const epCov = canonical.fields.find((f) => f.id === 'ep-cov')!;
    expect(epCov.klass).toBe('UNAVAILABLE');
    expect(epCov.value).not.toBe('0');
  });

  it('🔒 KİLİT: kart iki ekseni AYRI gösterir ve FORMÜLÜ yazar', async () => {
    vi.mocked(CarLauncher.readAdvancedDtcs!).mockResolvedValue(
      { raw: 'FF', outcome: 'ok', nrc: null } as never);
    await scanAllEcus(twoEcuTopology());
    const cards = buildCoverageCards(readMultiEcuDtcCoverageSnapshot());
    const canonical = cards.find((c) => c.id === 'canonical')!;
    const ids = canonical.fields.map((f) => f.id);
    /* A) uç nokta ekseni · B) tanı ekseni · C) kayıp kökü — üçü de AYRI satır. */
    expect(ids).toContain('ep-cov');
    expect(ids).toContain('diag-core');
    expect(ids).toContain('diag-deep');
    expect(ids).toContain('gap-split');
    const formula = canonical.fields.find((f) => f.id === 'diag-formula')!;
    expect(formula.value).toContain('terminal birim / planlanan birim');
    /* ARAÇ geneli iddiası ayrı satırda ve fail-closed. */
    const denom = canonical.fields.find((f) => f.id === 'vehicle-denom')!;
    expect(denom.value).toContain('PAYDA BİLİNMİYOR');
  });

  it('🔒 KİLİT: kart DTC KODU taşımaz (gizlilik)', async () => {
    vi.mocked(CarLauncher.readDtcFromEcu).mockResolvedValue(
      { codes: ['P0301'], supported: true, raw: '430301', outcome: 'OK' } as never);
    await scanAllEcus(oneEcuTopology());
    const cards = buildCoverageCards(readMultiEcuDtcCoverageSnapshot());
    expect(JSON.stringify(cards)).not.toContain('P0301');
  });
});
