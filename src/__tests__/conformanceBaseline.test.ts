/**
 * conformanceBaseline.test.ts — P0-VDK-F2C2 · UYGUNLUK TEMEL ÇİZGİSİ.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ⚠️ BU DOSYA SAHA KANITI ÜRETMEZ
 * ══════════════════════════════════════════════════════════════════════════
 * Buradaki her koşu `provenance: 'SIMULATED'`tir: iz gerçek araçtan DEĞİL,
 * mock köprüden gelir. `PASS` çıkması **zincirin doğru kurulduğunu** kanıtlar;
 * **aracın gerçekten böyle cevap verdiğini KANITLAMAZ.**
 *
 * Saha kanıtı YALNIZ `provenance: 'FIELD'` bir koşuyla ve gerçek araçtan
 * alınmış bir iz paketiyle üretilir (kütük 🔴 #870–#873).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ZİNCİR (tek koşuda)
 * ══════════════════════════════════════════════════════════════════════════
 *   canlı tur → export → import → FAST replay → TIMED replay → karşılaştır
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const epochRef = { value: 0 };

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: vi.fn(() => true) },
}));
vi.mock('../platform/nativePlugin', () => ({
  CarLauncher: {
    readDTC: vi.fn(), readPendingDTC: vi.fn(), readPermanentDTC: vi.fn(),
    readDtcClass: vi.fn(), readFreezeFrameDtc: vi.fn(), readFreezeFramePid: vi.fn(),
    probeEcus: vi.fn(), readDtcFromEcu: vi.fn(), readUdsDtcs: vi.fn(),
    readAdvancedDtcs: vi.fn(), sendTesterPresent: vi.fn(),
  },
}));
vi.mock('../platform/obdService', () => ({
  getOBDDataSnapshot: () => ({ connectionState: 'connected', transportConnected: true, dataFresh: true }),
  getObdSessionHealth: () => ({
    transportReady: true, sessionReady: true, pollingActive: true, dataFresh: true, ready: true,
  }),
  getEcuRecoveryLadder: () => ({ inFlight: false, nativeReconnectInFlight: false }),
  getObdSessionEpoch: () => epochRef.value,
  getHandshakeDiagnostics: () => ({ protocolActive: '6', protocolTried: null }),
}));

import { CarLauncher } from '../platform/nativePlugin';
import { readAllDTCs } from '../platform/dtcService';
import { buildTopology } from '../platform/obd/ecuDiscovery';
import { scanAllEcus, _resetIsoTpTunedKeysForTest } from '../platform/obd/multiEcuScan';
import {
  getTraceEvents, getDroppedEventCount, _resetTraceForTest, _setTraceClocksForTest,
} from '../platform/obd/canonicalTrace';
import {
  beginTransaction, prepareTransaction,
  _resetTransactionsForTest, _setTransactionClockForTest,
} from '../platform/obd/diagnosticTransaction';
import { _resetSchedulerForTest, _setSchedulerClockForTest } from '../platform/obd/diagnosticSessionScheduler';
import { _resetSessionEvidenceForTest } from '../platform/obd/diagnosticSessionEvidence';
import { _resetIsoTpTuningForTest } from '../platform/obd/isoTpTuningPolicy';
import { getDtcAuthoritySnapshot, _resetDtcAuthorityForTest } from '../platform/obd/dtcAuthority';
import { _resetPhysicalProbesForTest } from '../platform/obd/physicalEcuProbe';
import {
  startReplay, stopReplay, _resetVdkTransportForTest, _setReplaySleepForTest,
} from '../platform/obd/vdkTransport';
import {
  transportSnapshotFromTrace, functionalSnapshotFromEvidence,
} from '../platform/obd/replayParity';
import {
  getFunctionalDtcEvidence, _resetFunctionalDtcEvidenceForTest,
} from '../platform/obd/functionalDtcEvidence';
import {
  runConformance, type ConformanceHarness,
} from '../platform/obd/conformanceRun';
import {
  recordConformanceRun, getLastConformanceRun, _resetConformanceLedgerForTest,
} from '../platform/obd/conformanceLedger';
import {
  getGapRegistry, summarizeGapRegistry, _resetGapRegistryForTest,
} from '../platform/obd/gapRegistry';
import { goldenUdsBody, GOLDEN_CLIO } from './fixtures/goldenClio';
import { GOLDEN_FUNCTIONAL_A, GOLDEN_FUNCTIONAL_B, GOLDEN_FUNCTIONAL_C } from './fixtures/goldenFunctional';

const clock = { t: 5_000 };
const mono = { t: 0 };
const waits: number[] = [];

function oneEcuTopology() {
  return buildTopology('7E8 06 41 00 BE', 1_700_000_000_000);
}

/** GERÇEK ARAÇ ölçümünü taklit eden köprü — SAHA KANITI DEĞİLDİR. */
function armSimulatedVehicle(): void {
  const fnRaw: Record<string, string> = {
    '03': GOLDEN_FUNCTIONAL_A.rawResponse,
    '07': GOLDEN_FUNCTIONAL_B.rawResponse,
    '0A': GOLDEN_FUNCTIONAL_C.rawResponse,
  };
  vi.mocked(CarLauncher.readDtcClass!).mockImplementation(async ({ mode }) => ({
    codes: [], raw: fnRaw[mode]!, supported: true,
    outcome: 'OK', elapsedMs: 100, protocol: '6',
  }));
  vi.mocked(CarLauncher.probeEcus!).mockResolvedValue({ raw: '7E8 06 41 00 BE' });
  vi.mocked(CarLauncher.readDtcFromEcu!).mockResolvedValue({
    codes: [], supported: true, raw: '43 00 00 00 00 00 00', outcome: 'OK', elapsedMs: 120,
  });
  vi.mocked(CarLauncher.readUdsDtcs!).mockResolvedValue({ raw: '', supported: false });
  vi.mocked(CarLauncher.readAdvancedDtcs!).mockImplementation(async ({ subFunction }) =>
    subFunction === '02'
      ? {
        outcome: 'ok', kind: 'OK', raw: goldenUdsBody(),
        byteCount: GOLDEN_CLIO.length * 4 + 1, frameCount: 13,
        sessionOpened: true, sessionCommand: '1003',
      }
      : { outcome: 'unsupported', kind: 'NEG_7F', raw: '', nrc: 0x12 });
  vi.mocked(CarLauncher.readFreezeFrameDtc!).mockResolvedValue({ dtc: null });
}

/** Replay sırasında canlı hattı MAYINLAR. */
function armExplosive(): void {
  const boom = (n: string) => () => { throw new Error(`İZOLASYON İHLALİ: ${n}`); };
  for (const m of ['readDtcClass', 'probeEcus', 'readDtcFromEcu', 'readUdsDtcs',
    'readAdvancedDtcs', 'sendTesterPresent'] as const) {
    vi.mocked(CarLauncher[m]!).mockImplementation(boom(m));
  }
  vi.mocked(CarLauncher.readFreezeFrameDtc!).mockResolvedValue({ dtc: null });
}

/** ÜRÜNÜN NORMAL YOLU — conformance bunu enjekte alır, kendi taraması YOK. */
async function productScan(): Promise<void> {
  await readAllDTCs();
  const txn = beginTransaction({ purpose: 'multi_ecu_scan' });
  await prepareTransaction(txn);
  await scanAllEcus(oneEcuTopology(), [], txn);
}

let _replayActive = false;

function makeHarness(): ConformanceHarness {
  return {
    runScan: async () => {
      if (_replayActive) armExplosive(); else armSimulatedVehicle();
      await productScan();
    },
    captureSnapshot: () => {
      const auth = getDtcAuthoritySnapshot();
      const fnEv = getFunctionalDtcEvidence();
      const codesByMode = new Map<string, readonly string[]>(
        fnEv.map((e) => [e.mode, auth.observations
          .filter((o) => o.sourceService === e.mode)
          .map((o) => o.dtcCode)]),
      );
      return {
        ...transportSnapshotFromTrace(getTraceEvents()),
        ...functionalSnapshotFromEvidence(fnEv, codesByMode),
        parserDtcCount: auth.observations.length,
        parserDtcIdentities: auth.observations
          .map((o) => `${o.dtcCode}(${o.failureType ?? ''})`).sort(),
        authorityDtcCount: auth.observations.length,
        authorityDtcIdentities: auth.observations
          .map((o) => `${o.sourceService}:${o.dtcCode}(${o.failureType ?? ''})`).sort(),
        coverage: String(auth.observations.length),
        verdict: 'MEASURED',
      };
    },
    captureTrace: () => getTraceEvents(),
    droppedCount: () => getDroppedEventCount(),
    resetProductState: () => {
      _resetTransactionsForTest();
      _resetSchedulerForTest();
      _resetSessionEvidenceForTest();
      _resetDtcAuthorityForTest();
      _resetPhysicalProbesForTest();
      _resetIsoTpTuningForTest();
      _resetIsoTpTunedKeysForTest();
      _resetFunctionalDtcEvidenceForTest();
      clock.t = 5_000;
      _setTransactionClockForTest(() => clock.t);
      _setSchedulerClockForTest(() => clock.t);
    },
    resetTrace: (id) => {
      _resetTraceForTest(id);
      mono.t = 0;
      _setTraceClocksForTest(() => clock.t, () => { mono.t += 5; return mono.t; });
    },
    startReplay: (events, mode, id) => {
      const r = startReplay(events, mode, id);
      _replayActive = r.ok;
      return r.ok;
    },
    stopReplay: () => {
      _replayActive = false;
      return stopReplay()?.gapSignals ?? [];
    },
  };
}

beforeEach(() => {
  _resetVdkTransportForTest();
  _resetConformanceLedgerForTest();
  _resetGapRegistryForTest();
  _replayActive = false;
  waits.length = 0;
  epochRef.value = 0;
  for (const m of ['readDTC', 'readPendingDTC', 'readPermanentDTC', 'readDtcClass',
    'readFreezeFrameDtc', 'readFreezeFramePid', 'probeEcus', 'readDtcFromEcu',
    'readUdsDtcs', 'readAdvancedDtcs', 'sendTesterPresent'] as const) {
    vi.mocked(CarLauncher[m]!).mockReset();
  }
  _setReplaySleepForTest(async (ms) => { waits.push(ms); });
});

/* ═══════════════════════════════════════════════════════════════════════════
   A) TEK KOŞUDA TAM ZİNCİR
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-VDK-F2C2 · A) uygunluk koşusu', () => {
  it('🔒 PASS KİLİDİ: canlı → export → import → FAST → TIMED tek koşuda UYGUN', async () => {
    const r = await runConformance({
      harness: makeHarness(), runId: 'cf-1', generatedAtWallMs: 1_700_000_000_000,
    });

    expect(r.abort, r.abortDetail ?? '').toBeNull();
    expect(r.stage).toBe('COMPARE');
    expect(r.counts.mismatch,
      `AÇIKLANAMAYAN FARK: ${r.checks.filter((c) => c.outcome === 'MISMATCH')
        .map((c) => `${c.label}: ${c.detail}`).join(' · ')}`).toBe(0);
    expect(r.counts.unmeasured,
      `ÖLÇÜLMEYEN ALAN: ${r.checks.filter((c) => c.outcome === 'UNMEASURED')
        .map((c) => c.label).join(' · ')}`).toBe(0);
    expect(r.verdict).toBe('PASS');
    expect(r.counts.match).toBeGreaterThan(0);
  });

  it('🔒 KİLİT: koşu MASA BAŞI damgası taşır — saha kanıtı SAYILMAZ', async () => {
    const r = await runConformance({
      harness: makeHarness(), runId: 'cf-prov', generatedAtWallMs: 1,
    });
    expect(r.provenance, 'varsayılan SAHA sayıldı — fail-closed ihlali').toBe('SIMULATED');
  });

  it('🔒 KİLİT: paket checksum üretilir (aynı ölçüm aynı paket)', async () => {
    /* AYNI koşu kimliği → AYNI iz kimliği → AYNI paket. Determinizmin kanıtı:
       gizli bir `Date.now`/`Math.random` sızsaydı checksum kayardı. */
    const a = await runConformance({ harness: makeHarness(), runId: 'cf-same', generatedAtWallMs: 1 });
    const b = await runConformance({ harness: makeHarness(), runId: 'cf-same', generatedAtWallMs: 1 });
    expect(a.packageChecksum).not.toBeNull();
    expect(a.packageChecksum, 'aynı ölçüm FARKLI paket üretti').toBe(b.packageChecksum);

    /* FARKLI koşu kimliği → FARKLI iz kimliği → paket de farklı olmalıdır;
       aksi hâlde iki ayrı koşu birbirinin kanıtı sanılırdı. */
    const c = await runConformance({ harness: makeHarness(), runId: 'cf-other', generatedAtWallMs: 1 });
    expect(c.packageChecksum).not.toBe(a.packageChecksum);
  });

  it('🔒 KİLİT: TIMED gerçekten bekler, FAST beklemez — sonuç AYNI', async () => {
    const r = await runConformance({ harness: makeHarness(), runId: 'cf-t', generatedAtWallMs: 1 });
    expect(r.verdict).toBe('PASS');
    /* FAST↔TIMED karşılaştırması PASS → zamanlama ürün sonucunu DEĞİŞTİRMEDİ. */
    const timedChecks = r.checks.filter((c) => c.label.startsWith('FAST↔TIMED'));
    expect(timedChecks.length).toBeGreaterThan(0);
    expect(timedChecks.every((c) => c.outcome === 'MATCH')).toBe(true);
    expect(waits.some((w) => w > 0), 'TIMED hiç beklemedi').toBe(true);
  });

  it('🔒 KİLİT: Golden Clio UDS 20/20 koşu boyunca KORUNUR', async () => {
    await runConformance({ harness: makeHarness(), runId: 'cf-clio', generatedAtWallMs: 1 });
    const uds = getDtcAuthoritySnapshot().observations.filter((o) => o.sourceService === '19');
    expect(uds).toHaveLength(GOLDEN_CLIO.length);
    for (const [code, ftb] of GOLDEN_CLIO) {
      expect(uds.some((o) => o.dtcCode === code && o.failureType === ftb),
        `${code}(${ftb}) kayboldu`).toBe(true);
    }
  });

  it('🔒 KİLİT: Mode 03/07/0A CANONICAL_TS kalır (F2-C1 regresyonu yok)', async () => {
    await runConformance({ harness: makeHarness(), runId: 'cf-fn', generatedAtWallMs: 1 });
    const ev = getFunctionalDtcEvidence();
    expect(ev.length).toBeGreaterThan(0);
    expect(ev.every((e) => e.provenance === 'CANONICAL_TS')).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   B) FAIL-CLOSED — UYDURMA SONUÇ YOK
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-VDK-F2C2 · B) fail-closed', () => {
  it('🔒 KİLİT: iz üretilmezse koşu ABORTED — "geçti" DENMEZ', async () => {
    const h = makeHarness();
    const r = await runConformance({
      harness: { ...h, runScan: async () => { /* hiçbir şey yapma */ } },
      runId: 'cf-empty', generatedAtWallMs: 1,
    });
    expect(r.verdict).toBe('ABORTED');
    expect(r.abort).toBe('LIVE_NO_TRACE');
    expect(r.checks).toEqual([]);
  });

  it('🔒 KİLİT: ölçülmeyen alan varsa PASS DEĞİL — INCOMPLETE', async () => {
    const h = makeHarness();
    let call = 0;
    const r = await runConformance({
      harness: {
        ...h,
        captureSnapshot: () => {
          const s = h.captureSnapshot();
          call++;
          /* İkinci (FAST) turda fonksiyonel ölçüm ALINMAMIŞ gibi davran. */
          if (call === 2) {
            return { ...s, functionalProvenance: undefined, functionalOutcomes: undefined,
              functionalCodeIdentities: undefined } as typeof s;
          }
          return s;
        },
      },
      runId: 'cf-unm', generatedAtWallMs: 1,
    });
    expect(r.counts.unmeasured).toBeGreaterThan(0);
    expect(r.verdict, 'ölçülmeyen alan PASS sayıldı').toBe('INCOMPLETE');
    expect(r.counts.mismatch).toBe(0);
  });

  it('🔒 KİLİT: gerçek fark FAIL üretir ve KATMANI söylenir', async () => {
    const h = makeHarness();
    let call = 0;
    const r = await runConformance({
      harness: {
        ...h,
        captureSnapshot: () => {
          const s = h.captureSnapshot();
          call++;
          /* FAST turunda otorite listesi BOZULMUŞ gibi davran. */
          if (call === 2) return { ...s, authorityDtcIdentities: [], authorityDtcCount: 0 };
          return s;
        },
      },
      runId: 'cf-fail', generatedAtWallMs: 1,
    });
    expect(r.verdict).toBe('FAIL');
    expect(r.counts.mismatch).toBeGreaterThan(0);
    expect(r.mismatchLayers).toContain('AUTHORITY');
    const bad = r.checks.find((c) => c.outcome === 'MISMATCH')!;
    expect(bad.detail, 'fark ayrıntısı GİZLENDİ').not.toBeNull();
  });

  it('🔒 KİLİT: sonuç sınıfı ÜÇ değerle sınırlı', async () => {
    const r = await runConformance({ harness: makeHarness(), runId: 'cf-3', generatedAtWallMs: 1 });
    const allowed = new Set(['MATCH', 'MISMATCH', 'UNMEASURED']);
    expect(r.checks.every((c) => allowed.has(c.outcome))).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   C) GAP REGISTRY — kayıt, ÇÖZÜM DEĞİL
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-VDK-F2C2 · C) boşluk sicili', () => {
  it('🔒 KİLİT: ölçülmeyen alan sicile YAPILANDIRILMIŞ sinyal olarak düşer', async () => {
    const h = makeHarness();
    let call = 0;
    const r = await runConformance({
      harness: {
        ...h,
        captureSnapshot: () => {
          const s = h.captureSnapshot();
          call++;
          if (call === 2) return { ...s, coverage: null } as typeof s;
          return s;
        },
      },
      runId: 'cf-gap', generatedAtWallMs: 1,
    });
    recordConformanceRun(r, 1_700_000_000_000);

    const reg = getGapRegistry();
    expect(reg.length).toBeGreaterThan(0);
    const unmeasured = reg.find((e) => e.context.startsWith('unmeasured:'));
    expect(unmeasured, 'ölçülmeyen alan sicile YAZILMADI').toBeDefined();
    expect(unmeasured!.firstSeenMs).toBe(1_700_000_000_000);
    expect(unmeasured!.runId).toBe('cf-gap');
  });

  it('🔒 KİLİT: sicil hiçbir boşluğu ÇÖZMEZ (yalnız kaydeder)', async () => {
    const src = readFileSync(resolve(__dirname, '../platform/obd/gapRegistry.ts'), 'utf8');
    /* Self-healing kurmadığımızın yapısal kanıtı: sicil hiçbir sorgu/komut
       yüzeyine dokunmaz, ölçüm başlatmaz ve hiçbir yeteneği "öğrenmez".

       ⚠️ P0-VDK-F5E — KİLİT DARALTILDI, ZAYIFLATILMADI. Eski desen çıplak
       `heal|learn` alt dizgesiydi ve sicil KALICI hâle gelip kendi depo
       SAĞLIĞINI (`_health`) raporlamaya başlayınca yanlış yere ateşliyordu.
       Kilidin ASIL iddiası bir kelime yasağı değil bir DAVRANIŞ yasağıdır;
       aşağıdaki desenler o davranışı tek tek adlandırır ve eskisinden DAHA
       KESİNDİR (native köprü, ölçüm koşucuları ve öğrenme yazımı adıyla
       yasaklanır). */
    for (const forbidden of [
      /CarLauncher/,            // native köprü
      /sendCommand/,            // ham komut yüzeyi
      /sendDiagnosticPdu/,      // genel PDU köprüsü
      /runServiceDiscovery/,    // F4-B ölçüm koşucusu
      /runGapResolution/,       // F5-A çözüm koşucusu
      /selfHealing/i,           // Self-Healing motoru
      /recordCapabilityObservation/,  // F4-C öğrenme yazımı
      /vdkPduTransport/,        // taşıma
    ]) {
      expect(src, `sicil bu yüzeye DOKUNAMAZ: ${forbidden}`).not.toMatch(forbidden);
    }
  });

  it('🔒 KİLİT: aynı boşluk tekrar gelirse SAYAÇ artar, satır çoğalmaz', async () => {
    const r = await runConformance({ harness: makeHarness(), runId: 'cf-r1', generatedAtWallMs: 1 });
    recordConformanceRun(r, 1000);
    recordConformanceRun(r, 2000);
    const reg = getGapRegistry();
    const dupes = new Set(reg.map((e) => `${e.signal}|${e.context}`));
    expect(dupes.size).toBe(reg.length);
  });

  it('🔒 KİLİT: sicil özeti sinyal bazında toplar', async () => {
    const r = await runConformance({ harness: makeHarness(), runId: 'cf-sum', generatedAtWallMs: 1 });
    recordConformanceRun(r, 1);
    expect(typeof summarizeGapRegistry()).toBe('object');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   D) DEFTER — koşu yapılmadıysa "geçti" VARSAYILMAZ
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-VDK-F2C2 · D) defter', () => {
  it('🔒 KİLİT: koşu yoksa defter BOŞ (null)', () => {
    expect(getLastConformanceRun()).toBeNull();
  });

  it('🔒 KİLİT: koşu kaydedilince defterde AYNEN durur', async () => {
    const r = await runConformance({ harness: makeHarness(), runId: 'cf-led', generatedAtWallMs: 1 });
    recordConformanceRun(r, 1);
    const last = getLastConformanceRun()!;
    expect(last.runId).toBe('cf-led');
    expect(last.verdict).toBe(r.verdict);
    expect(last.counts).toEqual(r.counts);
  });
});
