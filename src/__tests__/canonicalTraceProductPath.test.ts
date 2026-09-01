/**
 * canonicalTraceProductPath.test.ts — P0-VDK-F2A · ÜRÜN YOLU İZ KİLİDİ.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * PASS ÖLÇÜTÜ: "gerçek tanı ürün yolları canonical trace üretiyor".
 *
 * Bir iz omurgasının "tip olarak var olması" hiçbir şey kanıtlamaz. Ürün
 * yolu ondan geçmiyorsa korelasyon · sıra · ham bayt · export KÂĞIT ÜSTÜNDE
 * kalır — ürünün geçmişte defalarca ödediği kusur sınıfı tam olarak budur.
 *
 * Bu dosya GERÇEK `scanAllEcus` turunun ürettiği izi denetler ve PII
 * sızıntısına karşı fail-closed muhafızı kilitler.
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
  getTraceEvents, getTransactionTrace, getDroppedEventCount, summarizeTrace,
  _resetTraceForTest, _setTraceClocksForTest,
} from '../platform/obd/canonicalTrace';
import { buildTracePackage, importTracePackage } from '../platform/obd/traceExport';
import { traceFromTransaction } from '../platform/obd/traceRecorder';
import {
  beginTransaction, prepareTransaction,
  _resetTransactionsForTest, _setTransactionClockForTest,
} from '../platform/obd/diagnosticTransaction';
import { _resetSchedulerForTest, _setSchedulerClockForTest } from '../platform/obd/diagnosticSessionScheduler';
import { _resetSessionEvidenceForTest } from '../platform/obd/diagnosticSessionEvidence';
import { _resetIsoTpTuningForTest } from '../platform/obd/isoTpTuningPolicy';
import { _resetDtcAuthorityForTest } from '../platform/obd/dtcAuthority';
import { _resetPhysicalProbesForTest } from '../platform/obd/physicalEcuProbe';

const clock = { t: 5_000 };
const mono = { t: 0 };

function oneEcuTopology() {
  return buildTopology('7E8 06 41 00 BE', 1_700_000_000_000);
}

beforeEach(() => {
  _resetTransactionsForTest();
  _resetSchedulerForTest();
  _resetSessionEvidenceForTest();
  _resetDtcAuthorityForTest();
  _resetPhysicalProbesForTest();
  _resetIsoTpTuningForTest();
  _resetIsoTpTunedKeysForTest();
  _resetTraceForTest('trace-P');
  clock.t = 5_000; mono.t = 0;
  _setTransactionClockForTest(() => clock.t);
  _setSchedulerClockForTest(() => clock.t);
  _setTraceClocksForTest(() => clock.t, () => { mono.t += 5; return mono.t; });
  epochRef.value = 0;
  for (const m of ['probeEcus', 'readDtcFromEcu', 'readUdsDtcs', 'readAdvancedDtcs', 'sendTesterPresent'] as const) {
    vi.mocked(CarLauncher[m]!).mockReset();
  }
  vi.mocked(CarLauncher.probeEcus).mockResolvedValue({ raw: '7E8 06 41 00 BE' });
  vi.mocked(CarLauncher.readDtcFromEcu).mockResolvedValue({
    codes: [], supported: true, raw: '43 00', outcome: 'OK', elapsedMs: 120,
  });
  vi.mocked(CarLauncher.readUdsDtcs!).mockResolvedValue({ raw: '', supported: false });
  vi.mocked(CarLauncher.readAdvancedDtcs!).mockImplementation(async ({ subFunction }) =>
    subFunction === '02'
      ? { outcome: 'ok', kind: 'OK', raw: 'FF' + '038011' + '09', byteCount: 5, frameCount: 1 }
      : { outcome: 'unsupported', kind: 'NEG_7F', raw: '', nrc: 0x12 });
});

async function scan() {
  const txn = beginTransaction({ purpose: 'multi_ecu_scan' });
  await prepareTransaction(txn);
  const report = await scanAllEcus(oneEcuTopology(), [], txn);
  return { txn, report };
}

/* ═══════════════════════════════════════════════════════════════════════════
   A) ÜRÜN YOLU GERÇEKTEN İZ ÜRETİYOR
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-VDK-F2A · A) ürün yolu izi', () => {
  it('🔒 PASS KİLİDİ: tarama izinde işlem sınırları + standart modlar + UDS var', async () => {
    const { txn } = await scan();
    const ops = getTransactionTrace(txn.transactionId).map((e) => e.operation);

    expect(ops.length, 'ürün yolu HİÇ iz üretmedi').toBeGreaterThan(0);
    expect(ops[0]).toBe('transaction_boundary');                 // begin
    expect(ops[ops.length - 1]).toBe('transaction_boundary');    // end
    expect(ops).toContain('mode03');
    expect(ops).toContain('mode07');
    expect(ops).toContain('mode0A');
    expect(ops).toContain('uds_19');
  });

  it('🔒 ANA KİLİT: izdeki her olay AYNI işleme korele', async () => {
    const { txn } = await scan();
    const all = getTraceEvents();
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((e) => e.transactionId === txn.transactionId)).toBe(true);
    expect(all.every((e) => e.evidenceCorrelationId === txn.evidenceCorrelationId)).toBe(true);
  });

  it('🔒 KİLİT: HAM istek ve yanıt BİREBİR izde', async () => {
    await scan();
    const uds = getTraceEvents().find((e) => e.operation === 'uds_19' && e.subFunction === '02')!;
    /* P0-VDK-F2B — KİLİT GÜNCELLENDİ (kaldırılmadı): ham istek artık GÖVDEYİ
       de taşır. Eski künye (`1902`) `19-06` gibi DTC başına değişen istekleri
       AYIRT EDEMİYORDU: sekiz ayrı istek izde tek satıra düşüyordu ve replay
       hangi yanıtın hangi isteğe ait olduğunu bilemezdi. */
    expect(uds.rawRequest).toBe('1902FF');
    expect(uds.rawResponse).toBe('FF03801109');
    expect(uds.transportOutcome).toBe('ok');

    const m03 = getTraceEvents().find((e) => e.operation === 'mode03')!;
    expect(m03.rawResponse).toBe('43 00');
    expect(m03.latencyMs).toBe(120);
  });

  it('🔒 KİLİT: NRC provenance izde KORUNUR', async () => {
    await scan();
    const neg = getTraceEvents().find((e) => e.operation === 'uds_19' && e.nrc === 0x12);
    expect(neg, '0x19-0A negatif yanıtı ize girmedi').toBeDefined();
  });

  it('🔒 KİLİT: ECU rotası ve protokol izde taşınır', async () => {
    await scan();
    const e = getTraceEvents().find((x) => x.operation === 'uds_19')!;
    expect(e.ecuTxHeader).toBe('7E0');
    expect(e.ecuRxHeader).toBe('7E8');
    expect(e.protocol).toBe('6');
    expect(e.sessionEpoch).toBe(0);
  });

  it('🔒 KİLİT: sıra MONOTONİK ve boşluksuz', async () => {
    await scan();
    const s = summarizeTrace(getTraceEvents(), getDroppedEventCount());
    expect(s.integrity.gaps).toEqual([]);
    expect(s.integrity.duplicates).toEqual([]);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   B) PII SIZINTI MUHAFIZI
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-VDK-F2A · B) gizlilik', () => {
  it('🔒 ANA KİLİT: VIN yanıtı ize MASKELİ girer (PII sızmaz)', async () => {
    const txn = beginTransaction({ purpose: 'dtc_scan' });
    await prepareTransaction(txn);
    /* Mode 09 PID 02 — VIN yanıtı. Mevcut maskeleme otoritesi devrede olmalı. */
    traceFromTransaction(txn, {
      operation: 'at_command',
      rawRequest: '0902',
      rawResponse: '49 02 01 57 46 30 5A 5A 5A 39 39 5A 5A 5A 30 30 30 30 30 30',
    });
    const e = getTraceEvents().find((x) => x.rawRequest === '0902')!;
    expect(e.redactionState).toBe('REDACTED');
    expect(e.rawResponse).not.toContain('57 46 30 5A');
  });

  it('🔒 ANA KİLİT: ASCII VIN · MAC · e-posta · API anahtarı izde MASKELENİR', async () => {
    const txn = beginTransaction({ purpose: 'dtc_scan' });
    await prepareTransaction(txn);
    for (const payload of [
      'WF0ZZZ99ZZZ000001',                 // ASCII VIN
      'AA:BB:CC:DD:EE:FF',                 // MAC
      'servis@example.com',                // e-posta
      'sk-abcdefghijklmnopqrst',           // sağlayıcı anahtarı
    ]) {
      traceFromTransaction(txn, { operation: 'at_command', rawRequest: 'ATI', rawResponse: payload });
    }
    const evs = getTraceEvents().filter((e) => e.rawRequest === 'ATI');
    expect(evs).toHaveLength(4);
    for (const e of evs) {
      expect(e.redactionState, String(e.rawResponse)).toBe('REDACTED');
    }
    const joined = evs.map((e) => e.rawResponse).join(' ');
    expect(joined).not.toContain('WF0ZZZ99ZZZ000001');
    expect(joined).not.toContain('AA:BB:CC:DD:EE:FF');
    expect(joined).not.toContain('servis@example.com');
    expect(joined).not.toContain('sk-abcdefghijklmnopqrst');
  });

  it('🔒 KİLİT: PROTOKOL PAYLOAD’I körlemesine maskelenmez (kanıt korunur)', async () => {
    await scan();
    /* Ham DTC hex'i geliştiricinin ASIL verisidir — dokunulmaz. */
    const uds = getTraceEvents().find((e) => e.operation === 'uds_19' && e.subFunction === '02')!;
    expect(uds.rawResponse).toBe('FF03801109');
    expect(uds.redactionState).toBe('CLEAN');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   C) UÇTAN UCA EXPORT / IMPORT
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-VDK-F2A · C) uçtan uca export/import', () => {
  it('🔒 PASS KİLİDİ: gerçek tarama izi paketlenir ve geri yüklenir', async () => {
    const { txn } = await scan();

    const exp = buildTracePackage(getTraceEvents(), getDroppedEventCount(), 'trace-P', clock.t);
    expect(exp.ok, 'gerçek tarama izi export EDİLEMEDİ').toBe(true);
    if (!exp.ok) return;
    expect(exp.pkg.manifest.transactionIds).toContain(txn.transactionId);

    const imp = importTracePackage(exp.body);
    expect(imp.ok).toBe(true);
    if (!imp.ok) return;
    expect(imp.events).toHaveLength(exp.pkg.manifest.eventCount);
    /* İçe aktarılan veri CANLI ARAÇ VERİSİ SAYILMAZ. */
    expect(imp.events.every((e) => e.provenance === 'imported')).toBe(true);
    /* Ürünün canlı defteri DEĞİŞMEDİ. */
    expect(getTraceEvents().every((e) => e.provenance === 'live')).toBe(true);
  });

  it('🔒 KİLİT: gerçek izin ham baytları gidiş-dönüşte BOZULMAZ', async () => {
    await scan();
    const before = getTraceEvents().map((e) => `${e.sequence}:${e.rawResponse ?? ''}`);
    const exp = buildTracePackage(getTraceEvents(), 0, 'trace-P', clock.t);
    expect(exp.ok).toBe(true);
    if (!exp.ok) return;
    const imp = importTracePackage(exp.body);
    expect(imp.ok).toBe(true);
    if (!imp.ok) return;
    expect(imp.events.map((e) => `${e.sequence}:${e.rawResponse ?? ''}`)).toEqual(before);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   D) REGRESYON — izleme ürünü DEĞİŞTİRMEZ
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-VDK-F2A · D) regresyon', () => {
  it('🔒 KİLİT: iz kaydı native çağrı sayısını DEĞİŞTİRMEZ', async () => {
    await scan();
    /* 1 ECU × 3 standart mod. İz hattan tek bayt İSTEMEZ. */
    expect(vi.mocked(CarLauncher.readDtcFromEcu).mock.calls).toHaveLength(3);
  });

  it('🔒 KİLİT: iz kaydı tarama SONUCUNU değiştirmez', async () => {
    const { report } = await scan();
    expect(report.results).toHaveLength(1);
    expect(report.allCodes.map((c) => c.code)).toContain('P0380');
  });

  it('🔒 KİLİT: iz defteri ÇÖKSE bile tarama SÜRER (fail-soft)', async () => {
    /* `recordTraceEvent` asla throw etmez; bunu doğrulamak için ölçülemeyen
       saat enjekte edilir (fonksiyon patlar). */
    _setTraceClocksForTest(() => { throw new Error('saat yok'); }, () => { throw new Error('saat yok'); });
    const { report } = await scan();
    expect(report.results).toHaveLength(1);   // tarama DÜŞMEDİ
  });
});
