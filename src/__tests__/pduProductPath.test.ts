/**
 * pduProductPath.test.ts — P0-VDK-F3A · PDU SINIRI ÜRÜN YOLUNDA.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * PASS ÖLÇÜTÜ
 * ══════════════════════════════════════════════════════════════════════════
 * "PDU sınırı bir tip egzersizi DEĞİL: ürünün gerçek bir tanı yolu (F1-B
 *  TesterPresent) PDU üzerinden geçiyor, hem canlı hem replay altında AYNI
 *  davranıyor ve F1-B'nin fail-closed kapıları GEVŞEMİYOR."
 *
 * Sadece `pdu.ts` yazmak ya da birim testi geçmek PASS DEĞİLDİR.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const epochRef = { value: 0 };

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: vi.fn(() => true) },
}));
vi.mock('../platform/nativePlugin', () => ({
  CarLauncher: {
    readDtcClass: vi.fn(), readDtcFromEcu: vi.fn(), readAdvancedDtcs: vi.fn(),
    sendTesterPresent: vi.fn(), probeEcus: vi.fn(), readUdsDtcs: vi.fn(),
    readDTC: vi.fn(), readPendingDTC: vi.fn(), readPermanentDTC: vi.fn(),
    readFreezeFrameDtc: vi.fn(),
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
import {
  vdkPduTransport, vdkTesterPresentFn, vdkAdvancedDtcsFn,
  startReplay, stopReplay, _resetVdkTransportForTest, _setReplaySleepForTest,
} from '../platform/obd/vdkTransport';
import { makePdu, pduTarget, encodePduRequest } from '../platform/obd/pdu';
import {
  getTraceEvents, _resetTraceForTest, _setTraceClocksForTest,
  TRACE_SCHEMA_VERSION, type TraceEvent,
} from '../platform/obd/canonicalTrace';
import { buildTracePackage, importTracePackage } from '../platform/obd/traceExport';
import {
  beginTransaction, prepareTransaction,
  _resetTransactionsForTest, _setTransactionClockForTest,
} from '../platform/obd/diagnosticTransaction';
import { _resetSchedulerForTest, _setSchedulerClockForTest } from '../platform/obd/diagnosticSessionScheduler';
import { _resetSessionEvidenceForTest } from '../platform/obd/diagnosticSessionEvidence';
import { traceFromTransaction } from '../platform/obd/traceRecorder';

const clock = { t: 5_000 };
const mono = { t: 0 };

function resetAll(): void {
  _resetVdkTransportForTest();
  _resetTransactionsForTest();
  _resetSchedulerForTest();
  _resetSessionEvidenceForTest();
  clock.t = 5_000;
  mono.t = 0;
  _setTransactionClockForTest(() => clock.t);
  _setSchedulerClockForTest(() => clock.t);
  _setTraceClocksForTest(() => clock.t, () => { mono.t += 5; return mono.t; });
}

beforeEach(() => {
  resetAll();
  _resetTraceForTest('trace-PDU');
  epochRef.value = 0;
  for (const m of ['readDtcClass', 'readDtcFromEcu', 'readAdvancedDtcs',
    'sendTesterPresent', 'probeEcus'] as const) {
    vi.mocked(CarLauncher[m]!).mockReset();
  }
  _setReplaySleepForTest(async () => { /* gerçek bekleme YOK */ });
});

/* ═══════════════════════════════════════════════════════════════════════════
   A) TAŞIMA SEÇİMİ — Real/Virtual anahtarı TEK YERDE
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-VDK-F3A · A) taşıma seçimi', () => {
  it('🔒 replay YOKKEN gerçek ELM327 taşıması seçilir', () => {
    expect(vdkPduTransport().capabilities.kind).toBe('elm327');
  });

  it('🔒 replay AKTİFKEN sanal taşıma seçilir — üst katman farkı BİLMEZ', () => {
    const ev: TraceEvent = {
      schemaVersion: TRACE_SCHEMA_VERSION, traceId: 'T', eventId: 'T-e1', sequence: 1,
      wallTime: 1, monotonicTime: 10, transactionId: null, evidenceCorrelationId: null,
      sessionEpoch: 0, ecuTxHeader: '7E0', ecuRxHeader: '7E8', ecuLabel: null,
      protocol: '6', transport: 'elm327_classic', direction: 'request_response',
      operation: 'tester_present', subFunction: null, rawRequest: '3E00',
      rawResponse: '7E00', transportOutcome: 'POSITIVE', nrc: null, latencyMs: 5,
      byteCount: null, frameCount: null, sessionLeaseRef: null, adapterKind: null,
      isoTpTuningRef: null, provenance: 'imported', redactionState: 'CLEAN',
    };
    expect(startReplay([ev], 'FAST', 'r1').ok).toBe(true);
    expect(vdkPduTransport().capabilities.kind).toBe('virtual');
    stopReplay();
    expect(vdkPduTransport().capabilities.kind).toBe('elm327');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   B) F1-B TESTERPRESENT — İLK GERÇEK PDU ENTEGRASYONU
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-VDK-F3A · B) TesterPresent PDU üzerinden', () => {
  it('🔒 PASS KİLİDİ: canlı TesterPresent PDU’dan geçer, davranış AYNI', async () => {
    vi.mocked(CarLauncher.sendTesterPresent!).mockResolvedValue({
      raw: '7E00', kind: 'OK', outcome: 'ok',
    });
    const fn = vdkTesterPresentFn()!;
    expect(fn).not.toBeNull();
    const r = await fn({ tx: '7E0', rx: '7E8' });
    expect(r.outcome).toBe('ok');
    expect(r.raw).toBe('7E00');
    expect(CarLauncher.sendTesterPresent).toHaveBeenCalledWith({ tx: '7E0', rx: '7E8' });
  });

  it('🔒 NEGATİF yanıt ve NRC aynen taşınır', async () => {
    vi.mocked(CarLauncher.sendTesterPresent!).mockResolvedValue({
      raw: '7F3E11', kind: 'NEG', outcome: 'negative_nrc', nrc: 0x11,
    });
    const r = await vdkTesterPresentFn()!({ tx: '7E0', rx: '7E8' });
    expect(r.outcome).toBe('negative_nrc');
    expect(r.nrc).toBe(0x11);
  });

  it('🔒 YANITSIZLIK "oturum canlı" DEMEZ', async () => {
    vi.mocked(CarLauncher.sendTesterPresent!).mockResolvedValue({
      raw: '', kind: 'NO_DATA', outcome: 'no_response',
    });
    const r = await vdkTesterPresentFn()!({ tx: '7E0', rx: '7E8' });
    expect(r.outcome).toBe('no_response');
  });

  it('🔒 ANA KİLİT: köprüde metot YOKSA kapı yine NULL — F1-B kör 3E göndermez', () => {
    const saved = CarLauncher.sendTesterPresent;
    // @ts-expect-error — eski APK simülasyonu
    CarLauncher.sendTesterPresent = undefined;
    expect(vdkTesterPresentFn(),
      'PDU’ya taşımak fail-closed kapıyı GEVŞETTİ').toBeNull();
    CarLauncher.sendTesterPresent = saved;
  });

  it('🔒 replay altında TesterPresent izdeki ölçümü verir, native ÇAĞRILMAZ', async () => {
    const ev: TraceEvent = {
      schemaVersion: TRACE_SCHEMA_VERSION, traceId: 'T', eventId: 'T-e1', sequence: 1,
      wallTime: 1, monotonicTime: 10, transactionId: null, evidenceCorrelationId: null,
      sessionEpoch: 0, ecuTxHeader: '7E0', ecuRxHeader: '7E8', ecuLabel: null,
      protocol: '6', transport: 'elm327_classic', direction: 'request_response',
      operation: 'tester_present', subFunction: null, rawRequest: '3E00',
      rawResponse: '7E00', transportOutcome: 'POSITIVE', nrc: null, latencyMs: 5,
      byteCount: null, frameCount: null, sessionLeaseRef: null, adapterKind: null,
      isoTpTuningRef: null, provenance: 'imported', redactionState: 'CLEAN',
    };
    vi.mocked(CarLauncher.sendTesterPresent!).mockImplementation(() => {
      throw new Error('İZOLASYON İHLALİ');
    });
    startReplay([ev], 'FAST', 'r-tp');
    const r = await vdkTesterPresentFn()!({ tx: '7E0', rx: '7E8' });
    stopReplay();

    expect(r.outcome).toBe('ok');
    expect(r.raw).toBe('7E00');
    expect(CarLauncher.sendTesterPresent).not.toHaveBeenCalled();
  });

  it('🔒 replay izde OLMAYAN TesterPresent için yanıt UYDURMAZ', async () => {
    const ev: TraceEvent = {
      schemaVersion: TRACE_SCHEMA_VERSION, traceId: 'T', eventId: 'T-e1', sequence: 1,
      wallTime: 1, monotonicTime: 10, transactionId: null, evidenceCorrelationId: null,
      sessionEpoch: 0, ecuTxHeader: '7E1', ecuRxHeader: '7E9', ecuLabel: null,
      protocol: '6', transport: 'elm327_classic', direction: 'request_response',
      operation: 'tester_present', subFunction: null, rawRequest: '3E00',
      rawResponse: '7E00', transportOutcome: 'POSITIVE', nrc: null, latencyMs: 5,
      byteCount: null, frameCount: null, sessionLeaseRef: null, adapterKind: null,
      isoTpTuningRef: null, provenance: 'imported', redactionState: 'CLEAN',
    };
    startReplay([ev], 'FAST', 'r-mis');
    /* BAŞKA bir ECU soruluyor — izde karşılığı YOK. */
    const r = await vdkTesterPresentFn()!({ tx: '7E0', rx: '7E8' });
    stopReplay();
    expect(r.outcome).toBe('transport_error');
    expect(r.raw).toBe('');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   C) KÜNYE TEKELİ — üç kopya bire indi
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-VDK-F3A · C) künye tekeli', () => {
  it('🔒 ANA KİLİT: iz künyesi ile replay künyesi AYNI fonksiyondan gelir', async () => {
    /* Canlı tur: `_recordAdvanced` izin künyesini yazar. */
    vi.mocked(CarLauncher.readAdvancedDtcs!).mockResolvedValue({
      raw: 'FF08332909', kind: 'OK', outcome: 'ok',
    });
    const txn = beginTransaction({ purpose: 'manufacturer_dtc' });
    await prepareTransaction(txn);
    const fn = vdkAdvancedDtcsFn()!;
    const res = await fn({
      service: '19', subFunction: '02', payload: 'FF', tx: '7E0', rx: '7E8',
    });
    expect(res.outcome).toBe('ok');
    traceFromTransaction(txn, {
      operation: 'uds_19', subFunction: '02',
      rawRequest: encodePduRequest(makePdu({
        service: '19', subFunction: '02', payload: 'FF',
      })),
      rawResponse: res.raw, transportOutcome: 'ok',
      ecuTxHeader: '7E0', ecuRxHeader: '7E8',
    });

    const events = getTraceEvents().filter((e) => e.operation === 'uds_19');
    expect(events).toHaveLength(1);
    expect(events[0]!.rawRequest).toBe('1902FF');

    /* Replay: AYNI künye üretilmeli ve eşleşmeli. */
    const pkg = buildTracePackage(getTraceEvents(), 0, 'trace-PDU', 1);
    expect(pkg.ok).toBe(true);
    if (!pkg.ok) throw new Error('unreachable');
    const imported = importTracePackage(pkg.body);
    expect(imported.ok).toBe(true);
    if (!imported.ok) throw new Error('unreachable');

    resetAll();
    _resetTraceForTest('trace-PDU-replay');
    vi.mocked(CarLauncher.readAdvancedDtcs!).mockImplementation(() => {
      throw new Error('İZOLASYON İHLALİ');
    });
    startReplay(imported.events, 'FAST', 'r-key');
    const replayed = await vdkAdvancedDtcsFn()!({
      service: '19', subFunction: '02', payload: 'FF', tx: '7E0', rx: '7E8',
    });
    stopReplay();

    expect(replayed.outcome, 'künye eşleşmedi — iki taraf farklı biçim kuruyor').toBe('ok');
    expect(replayed.raw).toBe('FF08332909');
  });

  it('🔒 PDU künyesi ile elle kurulan eski biçim BİREBİR aynı', () => {
    const cases: ReadonlyArray<readonly [string, string, string]> = [
      ['19', '02', 'FF'], ['19', '01', 'FF'], ['19', '0A', ''],
      ['18', '18', '00FF00'], ['13', '13', ''], ['19', '06', '083311FF'],
    ];
    for (const [service, subFunction, payload] of cases) {
      const legacy = `${service}${subFunction === service ? '' : subFunction}${payload}`;
      expect(encodePduRequest(makePdu({ service, subFunction, payload })),
        `${service}-${subFunction}`).toBe(legacy);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   D) TAŞIMA SINIRI ÜRÜNE SIZMAZ
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-VDK-F3A · D) taşıma sınırı', () => {
  it('🔒 taşınamayan servis ürün yolunda "araç desteklemiyor" OLMAZ', async () => {
    const r = await vdkPduTransport().send(makePdu({
      service: '2E', payload: 'F190AA', target: pduTarget('7E0', '7E8'),
    }));
    expect(r.outcome).toBe('NOT_SUPPORTED_BY_TRANSPORT');
    /* Yazma servisi (0x2E) köprüde YOK — ve bu turda AÇILMADI. */
    expect(CarLauncher.readAdvancedDtcs).not.toHaveBeenCalled();
  });

  it('🔒 DESTRUCTIVE yol AÇILMADI: yazma/silme servisleri taşınmıyor', async () => {
    for (const svc of ['2E', '31', '27', '11', '14', '04']) {
      const r = await vdkPduTransport().send(makePdu({
        service: svc, target: pduTarget('7E0', '7E8'),
      }));
      expect(r.outcome, `servis ${svc} taşınabilir hâle geldi`).toBe('NOT_SUPPORTED_BY_TRANSPORT');
    }
  });
});
