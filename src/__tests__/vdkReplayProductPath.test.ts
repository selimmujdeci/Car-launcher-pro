/**
 * vdkReplayProductPath.test.ts — P0-VDK-F2B · ÜRÜN YOLU REPLAY KİLİDİ.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * PASS ÖLÇÜTÜ (tek cümle)
 * ══════════════════════════════════════════════════════════════════════════
 * "Gerçek araçtan alınmış doğrulanmış iz, **normal tanı ürün yolu** üzerinden
 * yeniden çalıştırıldığında AYNI ham baytları AYNI çözücüye ve AYNI otoriteye
 * teslim eder."
 *
 * Bir `VirtualElm` sınıfı yazmak ya da izi ekranda göstermek PASS DEĞİLDİR.
 * Bu dosyadaki kilitler, replay'in parser'ı ve otoriteyi **bypass edemediğini**
 * kanıtlar: ikinci koşuda `CarLauncher` mock'ları PATLAYICIDIR — hatta tek bir
 * çağrı sızarsa test düşer.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ZİNCİR (her kilit bunu koşar)
 * ══════════════════════════════════════════════════════════════════════════
 *   scanAllEcus (ÜRÜN)  →  vdkTransport  →  Virtual Transport
 *      →  izdeki HAM `FF 08 33 29 09 …`  →  parseUdsDtcResponse (ÜRÜN)
 *      →  dtcAuthority (ÜRÜN)            →  rapor / kapsam
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const epochRef = { value: 0 };

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: vi.fn(() => true) },
}));
vi.mock('../platform/nativePlugin', () => ({
  CarLauncher: {
    probeEcus:         vi.fn(),
    readDtcFromEcu:    vi.fn(),
    readUdsDtcs:       vi.fn(),
    readAdvancedDtcs:  vi.fn(),
    sendTesterPresent: vi.fn(),
    readDtcClass:      vi.fn(),
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
import { buildTopology } from '../platform/obd/ecuDiscovery';
import { scanAllEcus, _resetIsoTpTunedKeysForTest } from '../platform/obd/multiEcuScan';
import {
  getTraceEvents, _resetTraceForTest, _setTraceClocksForTest, getTraceProvenanceMode,
} from '../platform/obd/canonicalTrace';
import { buildTracePackage, importTracePackage } from '../platform/obd/traceExport';
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
  startReplay, stopReplay, isReplayActive, getReplayDeliveries,
  _resetVdkTransportForTest, _setReplaySleepForTest,
} from '../platform/obd/vdkTransport';
import { transportSnapshotFromTrace, compareParity, rootMismatchLayer } from '../platform/obd/replayParity';
import { GOLDEN_CLIO, goldenUdsBody, goldenDisplayCodes } from './fixtures/goldenClio';

const clock = { t: 5_000 };
const mono = { t: 0 };

function oneEcuTopology() {
  return buildTopology('7E8 06 41 00 BE', 1_700_000_000_000);
}

/** Ürünün TÜM tur-içi defterlerini sıfırlar (iz HARİÇ — o taşınacak). */
function resetProductState(): void {
  _resetTransactionsForTest();
  _resetSchedulerForTest();
  _resetSessionEvidenceForTest();
  _resetDtcAuthorityForTest();
  _resetPhysicalProbesForTest();
  _resetIsoTpTuningForTest();
  _resetIsoTpTunedKeysForTest();
  clock.t = 5_000;
  _setTransactionClockForTest(() => clock.t);
  _setSchedulerClockForTest(() => clock.t);
}

/** GERÇEK ARAÇ ölçümünü taklit eden native mock'lar (yalnız 1. koşuda aktif). */
function armLiveMocks(): void {
  vi.mocked(CarLauncher.probeEcus!).mockResolvedValue({ raw: '7E8 06 41 00 BE' });
  vi.mocked(CarLauncher.readDtcFromEcu!).mockResolvedValue({
    codes: [], supported: true, raw: '43 00', outcome: 'OK', elapsedMs: 120,
  });
  vi.mocked(CarLauncher.readUdsDtcs!).mockResolvedValue({ raw: '', supported: false });
  vi.mocked(CarLauncher.readAdvancedDtcs!).mockImplementation(async ({ subFunction }) => {
    if (subFunction === '02') {
      return {
        outcome: 'ok', kind: 'OK', raw: goldenUdsBody(),
        byteCount: GOLDEN_CLIO.length * 4 + 1, frameCount: 13,
        sessionOpened: true, sessionCommand: '1003',
      };
    }
    return { outcome: 'unsupported', kind: 'NEG_7F', raw: '', nrc: 0x12 };
  });
}

/**
 * 2. koşuda hattı MAYINLAR: replay sırasında `CarLauncher`a giden TEK bir
 * çağrı bile testi düşürür. İzolasyonun "yorumla" değil, ÖLÇÜMLE kanıtı.
 */
function armExplosiveMocks(): void {
  const boom = (name: string) => () => {
    throw new Error(`İZOLASYON İHLALİ: replay sırasında CANLI HAT çağrıldı → ${name}`);
  };
  vi.mocked(CarLauncher.probeEcus!).mockImplementation(boom('probeEcus'));
  vi.mocked(CarLauncher.readDtcFromEcu!).mockImplementation(boom('readDtcFromEcu'));
  vi.mocked(CarLauncher.readUdsDtcs!).mockImplementation(boom('readUdsDtcs'));
  vi.mocked(CarLauncher.readAdvancedDtcs!).mockImplementation(boom('readAdvancedDtcs'));
  vi.mocked(CarLauncher.sendTesterPresent!).mockImplementation(boom('sendTesterPresent'));
  vi.mocked(CarLauncher.readDtcClass!).mockImplementation(boom('readDtcClass'));
}

async function runScan() {
  const txn = beginTransaction({ purpose: 'multi_ecu_scan' });
  await prepareTransaction(txn);
  const report = await scanAllEcus(oneEcuTopology(), [], txn);
  return { txn, report };
}

/** 1) canlı tarama → 2) export → 3) import. Doğrulanmış iz döner. */
async function captureVerifiedTrace() {
  armLiveMocks();
  const live = await runScan();
  const events = getTraceEvents();
  const pkg = buildTracePackage(events, 0, 'trace-REAL', 1_700_000_000_000);
  expect(pkg.ok, `export reddedildi: ${pkg.ok ? '' : pkg.rejection}`).toBe(true);
  if (!pkg.ok) throw new Error('unreachable');
  const imported = importTracePackage(pkg.body);
  expect(imported.ok, `import reddedildi: ${imported.ok ? '' : imported.rejection}`).toBe(true);
  if (!imported.ok) throw new Error('unreachable');
  return { liveReport: live.report, liveEvents: events, imported };
}

beforeEach(() => {
  _resetVdkTransportForTest();
  resetProductState();
  _resetTraceForTest('trace-REAL');
  mono.t = 0;
  _setTraceClocksForTest(() => clock.t, () => { mono.t += 5; return mono.t; });
  epochRef.value = 0;
  for (const m of ['probeEcus', 'readDtcFromEcu', 'readUdsDtcs', 'readAdvancedDtcs',
    'sendTesterPresent', 'readDtcClass'] as const) {
    vi.mocked(CarLauncher[m]!).mockReset();
  }
  _setReplaySleepForTest(async () => { /* testte gerçek bekleme YOK */ });
});

/* ═══════════════════════════════════════════════════════════════════════════
   A) GOLDEN CLIO — 20/20 UÇTAN UCA
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-VDK-F2B · A) Golden Clio uçtan uca replay', () => {
  it('🔒 PASS KİLİDİ: canlı 20 kayıt → export → import → replay → YİNE 20 kayıt', async () => {
    const { liveReport, imported } = await captureVerifiedTrace();

    /* Canlı tur gerçekten 20 kaydı gördü mü (aksi hâlde replay boşluğu ölçer). */
    expect(liveReport.allCodes.filter((c) => c.fromUds === true)).toHaveLength(GOLDEN_CLIO.length);

    /* ── ÜRÜN DURUMU SIFIRLANIR ────────────────────────────────────────────
       Otorite defteri ve kanıtlar SIFIRDAN kurulur. Replay'in 20 kaydı
       "önceki turdan kalmış" olamaz — bu kilit tam olarak onu dışlar. */
    resetProductState();
    _resetTraceForTest('trace-REPLAY');
    mono.t = 0;
    _setTraceClocksForTest(() => clock.t, () => { mono.t += 5; return mono.t; });
    armExplosiveMocks();

    const started = startReplay(imported.events, 'FAST', 'run-1');
    expect(started.ok, started.ok ? '' : started.detail).toBe(true);
    expect(isReplayActive()).toBe(true);

    /* ── AYNI ÜRÜN YOLU ────────────────────────────────────────────────── */
    const { report } = await runScan();
    const stats = stopReplay()!;

    const udsCodes = report.allCodes.filter((c) => c.fromUds === true);
    expect(udsCodes, 'REPLAY üründen 20 kayıt ÇIKARMADI').toHaveLength(GOLDEN_CLIO.length);
    expect(udsCodes.map((c) => `${c.code}${c.subCode ? `(${c.subCode})` : ''}`))
      .toEqual(goldenDisplayCodes());
    expect(stats.matched).toBeGreaterThan(0);
    expect(stats.mismatched).toBe(0);
  });

  it('🔒 KİLİT: P0380’in DÖRT alt kodu replay’den de AYRI çıkar', async () => {
    const { imported } = await captureVerifiedTrace();
    resetProductState();
    _resetTraceForTest('trace-REPLAY');
    armExplosiveMocks();
    startReplay(imported.events, 'FAST', 'run-2');
    const { report } = await runScan();
    stopReplay();

    const p0380 = report.allCodes.filter((c) => c.code === 'P0380');
    expect(p0380).toHaveLength(4);
    expect(p0380.map((c) => c.subCode).sort()).toEqual(['11', '12', '13', '96']);
  });

  it('🔒 KİLİT: replay OTORİTE defterini de doldurur (parser’da kalmaz)', async () => {
    const { imported } = await captureVerifiedTrace();
    resetProductState();
    _resetTraceForTest('trace-REPLAY');
    armExplosiveMocks();
    startReplay(imported.events, 'FAST', 'run-3');
    await runScan();
    stopReplay();

    const auth = getDtcAuthoritySnapshot();
    const ids = auth.observations
      .filter((o) => o.sourceService === '19')
      .map((o) => `${o.dtcCode}(${o.failureType ?? ''})`);
    for (const [code, ftb] of GOLDEN_CLIO) {
      expect(ids, `otoritede eksik: ${code}(${ftb})`).toContain(`${code}(${ftb})`);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   B) İZOLASYON
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-VDK-F2B · B) izolasyon', () => {
  it('🔒 KİLİT: replay sırasında HİÇBİR native tanı çağrısı yapılmaz', async () => {
    const { imported } = await captureVerifiedTrace();
    resetProductState();
    _resetTraceForTest('trace-REPLAY');
    for (const m of ['probeEcus', 'readDtcFromEcu', 'readUdsDtcs', 'readAdvancedDtcs',
      'sendTesterPresent', 'readDtcClass'] as const) {
      vi.mocked(CarLauncher[m]!).mockClear();
    }
    armExplosiveMocks();

    startReplay(imported.events, 'FAST', 'run-iso');
    await runScan();
    stopReplay();

    for (const m of ['probeEcus', 'readDtcFromEcu', 'readUdsDtcs', 'readAdvancedDtcs',
      'sendTesterPresent', 'readDtcClass'] as const) {
      expect(vi.mocked(CarLauncher[m]!), `${m} CANLI HATTA gitti`).not.toHaveBeenCalled();
    }
  });

  it('🔒 KİLİT: replay olayları CANLI damga taşımaz (provenance ayrımı)', async () => {
    const { imported } = await captureVerifiedTrace();
    resetProductState();
    _resetTraceForTest('trace-REPLAY');
    armExplosiveMocks();

    expect(getTraceProvenanceMode()).toBe('live');
    startReplay(imported.events, 'FAST', 'run-prov');
    expect(getTraceProvenanceMode()).toBe('replay');
    await runScan();
    const written = getTraceEvents();
    stopReplay();
    expect(getTraceProvenanceMode()).toBe('live');

    expect(written.length).toBeGreaterThan(0);
    expect(written.every((e) => e.provenance === 'replay'),
      'replay turu CANLI damgalı olay yazdı').toBe(true);
  });

  it('🔒 KİLİT: KAYNAK iz replay sonrası DEĞİŞMEZ (immutable)', async () => {
    const { imported } = await captureVerifiedTrace();
    const before = JSON.stringify(imported.events);
    resetProductState();
    _resetTraceForTest('trace-REPLAY');
    armExplosiveMocks();
    startReplay(imported.events, 'FAST', 'run-imm');
    await runScan();
    stopReplay();
    expect(JSON.stringify(imported.events)).toBe(before);
  });

  it('🔒 KİLİT: içe aktarılan olay CANLI defteri değiştirmez', async () => {
    const { imported } = await captureVerifiedTrace();
    /* Import yalnız DEĞER döner; hiçbir küresel deftere yazmaz. */
    _resetTraceForTest('trace-EMPTY');
    expect(getTraceEvents()).toHaveLength(0);
    expect(imported.events.every((e) => e.provenance === 'imported')).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   C) GERÇEK ↔ REPLAY PARİTESİ
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-VDK-F2B · C) parite muhasebesi', () => {
  it('🔒 PASS KİLİDİ: taşıma · oturum · tuning · parser · otorite PARİTE', async () => {
    const { liveReport, liveEvents, imported } = await captureVerifiedTrace();
    const realAuth = getDtcAuthoritySnapshot();

    resetProductState();
    _resetTraceForTest('trace-REPLAY');
    mono.t = 0;
    _setTraceClocksForTest(() => clock.t, () => { mono.t += 5; return mono.t; });
    armExplosiveMocks();
    startReplay(imported.events, 'FAST', 'run-parity');
    const { report: replayReport } = await runScan();
    const replayEvents = getTraceEvents();
    stopReplay();
    const replayAuth = getDtcAuthoritySnapshot();

    const identities = (r: typeof liveReport) => r.allCodes
      .filter((c) => c.fromUds === true)
      .map((c) => `${c.code}(${c.subCode ?? ''})|${c.rawStatus ?? ''}`);
    const authIds = (a: typeof realAuth) => a.observations
      .map((o) => `${o.dtcCode}(${o.failureType ?? ''})`).sort();

    const real = {
      ...transportSnapshotFromTrace(liveEvents),
      parserDtcCount: identities(liveReport).length,
      parserDtcIdentities: identities(liveReport),
      authorityDtcCount: realAuth.observations.length,
      authorityDtcIdentities: authIds(realAuth),
      coverage: String(liveReport.coverage ?? null),
      verdict: String(liveReport.verdict ?? null),
    };
    const replay = {
      ...transportSnapshotFromTrace(replayEvents),
      parserDtcCount: identities(replayReport).length,
      parserDtcIdentities: identities(replayReport),
      authorityDtcCount: replayAuth.observations.length,
      authorityDtcIdentities: authIds(replayAuth),
      coverage: String(replayReport.coverage ?? null),
      verdict: String(replayReport.verdict ?? null),
    };

    const result = compareParity(real, replay);

    /* ══════════════════════════════════════════════════════════════════════
       ÖLÇÜLEN VE KABUL EDİLEN TEK FARK: FONKSİYONEL Mode 03/07/0A
       ══════════════════════════════════════════════════════════════════════
       O yolda kodları `ElmProtocol.parseDtcResponse` (Java) çözer; TS'te
       karşılığı YOKTUR. Replay ham gövdeyi teslim eder ama üründe onu
       çözecek katman olmadığı için sonuç fail-closed KAPSAM KAYBIdır
       (`PARSER_UNAVAILABLE`) — "0 kod / araç temiz" DEĞİL.

       Bu fark SESSİZCE TOLERE EDİLMEZ: burada tek tek sayılır, katmanı
       söylenir ve saha kütüğüne borç olarak yazılır. Farkın BAŞKA bir alana
       taşması testi düşürür. */
    const gapOnly = result.mismatches.filter((x) =>
      x.field.startsWith('transportOutcomes') && x.replay === 'PARSER_UNAVAILABLE');
    const other = result.mismatches.filter((x) => !gapOnly.includes(x));

    expect(other,
      `BEKLENMEYEN PARİTE FARKI (kök katman: ${rootMismatchLayer(result)}) — `
      + other.slice(0, 6).map((x) => x.detail).join(' · '),
    ).toEqual([]);

    /* Üretici zinciri (UDS 0x19 → udsDtc → dtcAuthority) TAM PARİTE. */
    expect(replay.parserDtcIdentities).toEqual(real.parserDtcIdentities);
    expect(replay.authorityDtcIdentities).toEqual(real.authorityDtcIdentities);
    expect(replay.sessionOutcomes).toEqual(real.sessionOutcomes);
    expect(replay.tuningOutcomes).toEqual(real.tuningOutcomes);
    expect(replay.nrcs).toEqual(real.nrcs);
  });

  it('🔒 KİLİT: parite farkı SESSİZ DEĞİL — katmanı adlandırılır', () => {
    const base = {
      requests: ['a'], responses: ['R'], transportOutcomes: ['ok'], nrcs: [null],
      sessionOutcomes: [], testerPresentOutcomes: [],
      tuningOutcomes: [], tuningRestoreOutcomes: [],
      parserDtcCount: 1, parserDtcIdentities: ['P0380(11)|09'],
      authorityDtcCount: 1, authorityDtcIdentities: ['P0380(11)'],
      coverage: 'FULL', verdict: 'FAULTY',
    };
    /* Taşıma AYNI, çözücü FARKLI → kök katman PARSER olmalı. */
    const drifted = { ...base, parserDtcCount: 0, parserDtcIdentities: [] };
    const r = compareParity(base, drifted);
    expect(r.verdict).toBe('PARITY_MISMATCH');
    expect(rootMismatchLayer(r)).toBe('PARSER');

    /* Taşıma da ayrıldıysa kök neden EN AŞAĞI katmandır. */
    const both = { ...drifted, responses: ['X'] };
    expect(rootMismatchLayer(compareParity(base, both))).toBe('TRANSPORT');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   D) DETERMİNİZM
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-VDK-F2B · D) determinizm', () => {
  it('🔒 KİLİT: aynı iz + aynı mod → BİREBİR aynı gözlemlenebilir sonuç', async () => {
    const { imported } = await captureVerifiedTrace();

    const runOnce = async (id: string) => {
      resetProductState();
      _resetTraceForTest(`trace-${id}`);
      mono.t = 0;
      _setTraceClocksForTest(() => clock.t, () => { mono.t += 5; return mono.t; });
      armExplosiveMocks();
      startReplay(imported.events, 'FAST', id);
      const { report } = await runScan();
      const stats = stopReplay()!;
      return {
        codes: report.allCodes.map((c) => `${c.code}|${c.subCode ?? ''}|${c.rawStatus ?? ''}`),
        matched: stats.matched, mismatched: stats.mismatched,
        exhausted: stats.exhausted, unconsumed: stats.unconsumed,
      };
    };

    expect(await runOnce('d1')).toEqual(await runOnce('d2'));
  });

  it('🔒 KİLİT: TIMED mod ENJEKTE saatle koşar — sonuç FAST ile AYNI', async () => {
    const { imported } = await captureVerifiedTrace();

    const runMode = async (mode: 'FAST' | 'TIMED', id: string) => {
      const waits: number[] = [];
      _setReplaySleepForTest(async (ms) => { waits.push(ms); });
      resetProductState();
      _resetTraceForTest(`trace-${id}`);
      mono.t = 0;
      _setTraceClocksForTest(() => clock.t, () => { mono.t += 5; return mono.t; });
      armExplosiveMocks();
      startReplay(imported.events, mode, id);
      const { report } = await runScan();
      stopReplay();
      return { codes: report.allCodes.map((c) => `${c.code}|${c.subCode ?? ''}`), waits };
    };

    const fast = await runMode('FAST', 't-fast');
    const timed = await runMode('TIMED', 't-timed');

    /* Gözlemlenebilir ÜRÜN sonucu AYNI… */
    expect(timed.codes).toEqual(fast.codes);
    /* …ama zamanlama semantiği YALNIZ TIMED'da yeniden üretilir. */
    expect(fast.waits.every((w) => w === 0)).toBe(true);
    expect(timed.waits.some((w) => w > 0), 'TIMED hiç beklemedi').toBe(true);
  });

  it('🔒 KİLİT: paralel koşular BİRBİRİNİ ETKİLEMEZ (izole ReplayRun)', async () => {
    const { imported } = await captureVerifiedTrace();
    const { openReplayRun, replayRequest } = await import('../platform/obd/virtualTransport');

    const a = openReplayRun({ events: imported.events, mode: 'FAST', replayRunId: 'A' });
    const b = openReplayRun({ events: imported.events, mode: 'FAST', replayRunId: 'B' });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) throw new Error('unreachable');

    const req = {
      operation: 'uds_19' as const, subFunction: '02',
      rawRequest: '1902FF', ecuTxHeader: '7E0', ecuRxHeader: '7E8',
    };
    const d1 = replayRequest(a.run, req);
    const d2 = replayRequest(b.run, req);

    expect(d1.outcome).toBe('MATCHED');
    expect(d2.outcome).toBe('MATCHED');           // A'nın tüketimi B'yi TÜKETMEDİ
    expect(d1.replayRunId).toBe('A');
    expect(d2.replayRunId).toBe('B');
    expect(d1.sourceEventId).toBe(d2.sourceEventId);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   E) PROVENANCE — replay kendi kimliğini taşır
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-VDK-F2B · E) provenance', () => {
  it('🔒 KİLİT: her teslim sourceTraceId · replayRunId · sourceEventId taşır', async () => {
    const { imported } = await captureVerifiedTrace();
    resetProductState();
    _resetTraceForTest('trace-REPLAY');
    armExplosiveMocks();
    startReplay(imported.events, 'FAST', 'run-prov2');
    await runScan();
    const deliveries = getReplayDeliveries();
    stopReplay();

    expect(deliveries.length).toBeGreaterThan(0);
    expect(deliveries.every((d) => d.replayRunId === 'run-prov2')).toBe(true);
    expect(deliveries.every((d) => d.sourceTraceId === 'trace-REAL')).toBe(true);
    const matched = deliveries.filter((d) => d.outcome === 'MATCHED');
    expect(matched.length).toBeGreaterThan(0);
    expect(matched.every((d) => typeof d.sourceEventId === 'string' && d.sourceEventId.length > 0)).toBe(true);
  });
});
