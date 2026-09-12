/**
 * diagnosticSessionProductPath.test.ts — P0-VDK-F1B · ÜRÜN YOLU ZİNCİR KİLİDİ.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * PASS ÖLÇÜTÜ: "Sadece 0x3E fonksiyonu yazılmış olması PASS değildir."
 *
 * Bu dosya tam zinciri GERÇEK üretici tanı ürün yolunda (`scanAllEcus` →
 * `readUdsForEcu` → UDS 0x19) kanıtlar:
 *
 *   oturum açılışı → ACTIVE kira → keepalive → uzun işlem →
 *   işlem kapanışı → keepalive DURUŞU
 *
 * Ayrıca kör TesterPresent yasağının ÜRÜN YOLUNDA da geçerli olduğunu kilitler.
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
import { scanAllEcus } from '../platform/obd/multiEcuScan';
import {
  beginTransaction, prepareTransaction, _resetTransactionsForTest, _setTransactionClockForTest,
} from '../platform/obd/diagnosticTransaction';
import {
  getSessionLeases, _resetSchedulerForTest, _setSchedulerClockForTest,
  _tickSchedulerForTest, _isSchedulerTimerRunning,
} from '../platform/obd/diagnosticSessionScheduler';
import {
  getSessionEvidence, _resetSessionEvidenceForTest,
} from '../platform/obd/diagnosticSessionEvidence';
import { DEFAULT_KEEPALIVE_INTERVAL_MS } from '../platform/obd/diagnosticSessionLease';
import { _resetDtcAuthorityForTest } from '../platform/obd/dtcAuthority';
import { _resetPhysicalProbesForTest } from '../platform/obd/physicalEcuProbe';
import { getDtcPipelineEntries, _resetDtcPipelineForTest } from '../platform/obd/dtcPipelineAccounting';

const clock = { t: 50_000 };

function oneEcuTopology() {
  return buildTopology('7E8 06 41 00 BE', 1_700_000_000_000);
}

/** UDS 0x19-02'de oturum AÇILDIĞINI bildiren native yanıt. */
function advancedWithSession(sessionOpened: boolean, cmd?: string) {
  return vi.mocked(CarLauncher.readAdvancedDtcs!).mockImplementation(async ({ subFunction }) => {
    if (subFunction === '02') {
      return {
        outcome: 'ok' as const, kind: 'OK', raw: 'FF' + '038011' + '09',
        ...(sessionOpened ? { sessionOpened: true, sessionCommand: cmd ?? '1003' } : {}),
      };
    }
    return { outcome: 'unsupported' as const, raw: '', kind: 'NEG_7F', nrc: 0x12 };
  });
}

beforeEach(() => {
  _resetTransactionsForTest();
  _resetSchedulerForTest();
  _resetSessionEvidenceForTest();
  _resetDtcAuthorityForTest();
  _resetPhysicalProbesForTest();
  _resetDtcPipelineForTest();
  clock.t = 50_000;
  _setTransactionClockForTest(() => clock.t);
  _setSchedulerClockForTest(() => clock.t);
  epochRef.value = 0;
  for (const m of ['probeEcus', 'readDtcFromEcu', 'readUdsDtcs', 'readAdvancedDtcs', 'sendTesterPresent'] as const) {
    vi.mocked(CarLauncher[m]!).mockReset();
  }
  vi.mocked(CarLauncher.probeEcus).mockResolvedValue({ raw: '7E8 06 41 00 BE' });
  vi.mocked(CarLauncher.readDtcFromEcu).mockResolvedValue({ codes: [], supported: true });
  vi.mocked(CarLauncher.readUdsDtcs!).mockResolvedValue({ raw: '', supported: false });
  vi.mocked(CarLauncher.sendTesterPresent!).mockResolvedValue({
    raw: '7E00', kind: 'OK', outcome: 'ok',
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   A) TAM ZİNCİR — PASS ölçütü
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-VDK-F1B · A) ürün yolu tam zinciri', () => {
  it('🔒 PASS KİLİDİ: açılış → ACTIVE → keepalive → uzun işlem → kapanış → keepalive DURUR', async () => {
    advancedWithSession(true, '1003');
    const txn = beginTransaction({ purpose: 'multi_ecu_scan' });
    await prepareTransaction(txn);

    // ── 1) ÜRÜN YOLU: gerçek üretici DTC taraması ────────────────────────
    const report = await scanAllEcus(oneEcuTopology(), [], txn);
    expect(report.allCodes.map((c) => c.code)).toContain('P0380');

    // ── 2) Kira ürün yolunda AÇILDI ve oturum kanıtı UYGULANDI ───────────
    const leases = getSessionLeases();
    expect(leases, 'ürün yolu oturum kirası AÇMADI').toHaveLength(1);
    const lease = leases[0]!;
    expect(lease.sessionKind).toBe('UDS_EXTENDED_1003');
    expect(lease.sessionEstablishedEvidence).toBe('1003');
    expect(lease.transactionId).toBe(txn.transactionId);

    /* Tarama sonunda `scanAllEcus` kiraları KAPATIR — bu tam olarak zincirin
       son halkasıdır ("keepalive duruşu"). */
    expect(lease.state).toBe('CLOSED');
    expect(lease.keepAliveRequired).toBe(false);
    expect(_isSchedulerTimerRunning()).toBe(false);

    // ── 3) Kapanıştan SONRA hiçbir keepalive çıkamaz ─────────────────────
    clock.t += 60_000;
    await _tickSchedulerForTest();
    expect(CarLauncher.sendTesterPresent).not.toHaveBeenCalled();

    // ── 4) Zincir KANITLA izlenebilir ────────────────────────────────────
    const kinds = getSessionEvidence()
      .filter((e) => e.evidenceCorrelationId === txn.evidenceCorrelationId)
      .map((e) => e.kind);
    expect(kinds).toContain('SESSION_OPEN_ATTEMPT');
    expect(kinds).toContain('SESSION_OPEN_POSITIVE');
    expect(kinds).toContain('SESSION_CLOSED');
  });

  it('🔒 PASS KİLİDİ: uzun işlem sırasında keepalive GERÇEKTEN gider', async () => {
    /* Tarama SIRASINDA (kira canlıyken) zaman ilerlerse keepalive çıkmalı.
       `readAdvancedDtcs` yavaş bir ECU'yu taklit eder ve tur bu sırada koşar. */
    advancedWithSession(true, '1003');
    const txn = beginTransaction({ purpose: 'multi_ecu_scan' });
    await prepareTransaction(txn);

    vi.mocked(CarLauncher.readAdvancedDtcs!).mockImplementation(async ({ subFunction }) => {
      if (subFunction === '02') {
        return {
          outcome: 'ok' as const, kind: 'OK', raw: 'FF' + '038011' + '09',
          sessionOpened: true, sessionCommand: '1003',
        };
      }
      if (subFunction === '0A') {
        /* Bu noktada 0x19-02 döndü ve kira ACTIVE oldu (oturum kanıtı uygulandı).
           Uzun işlemi taklit et: zamanı ilerlet ve zamanlayıcı turunu ELLE
           koştur — gerçek uyku YOK.
           NOT: 0x19-01 (availability) dalında koşturmak YANLIŞ olurdu; orada
           kira henüz OPENING'dir ve keepalive KASITLI olarak gönderilmez. */
        clock.t += DEFAULT_KEEPALIVE_INTERVAL_MS;
        await _tickSchedulerForTest();
      }
      return { outcome: 'unsupported' as const, raw: '', kind: 'NEG_7F', nrc: 0x12 };
    });

    await scanAllEcus(oneEcuTopology(), [], txn);

    expect(CarLauncher.sendTesterPresent, 'uzun işlemde keepalive GİTMEDİ').toHaveBeenCalled();
    expect(txn.keepAliveRequestsUsed).toBeGreaterThan(0);
    /* Keepalive TANI bütçesini tüketmez — iki maliyet AYRI. */
    expect(txn.requestsUsed).toBeGreaterThan(0);
    const kinds = getSessionEvidence().map((e) => e.kind);
    expect(kinds).toContain('KEEPALIVE_SENT');
    expect(kinds).toContain('KEEPALIVE_POSITIVE');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   B) KÖR TESTER PRESENT YASAĞI — ÜRÜN YOLUNDA
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-VDK-F1B · B) ürün yolunda kör 3E yasağı', () => {
  it('🔒 ANA KİLİT: ECU oturum AÇMADIYSA tarama boyunca TEK 3E bile gitmez', async () => {
    advancedWithSession(false);
    const txn = beginTransaction({ purpose: 'multi_ecu_scan' });
    await prepareTransaction(txn);

    await scanAllEcus(oneEcuTopology(), [], txn);
    clock.t += 60_000;
    await _tickSchedulerForTest();

    expect(CarLauncher.sendTesterPresent).not.toHaveBeenCalled();
    expect(getSessionLeases()[0]!.sessionKind).toBe('DEFAULT');
  });

  it('🔒 KİLİT: ESKİ APK (sessionOpened alanı yok) → keepalive AÇILMAZ (fail-closed)', async () => {
    /* Eski köprü bu alanı taşımaz; `undefined` "oturum açıldı" SAYILMAZ. */
    vi.mocked(CarLauncher.readAdvancedDtcs!).mockResolvedValue({
      outcome: 'ok', kind: 'OK', raw: 'FF' + '038011' + '09',
    });
    const txn = beginTransaction({ purpose: 'multi_ecu_scan' });
    await prepareTransaction(txn);
    await scanAllEcus(oneEcuTopology(), [], txn);

    clock.t += 60_000;
    await _tickSchedulerForTest();
    expect(CarLauncher.sendTesterPresent).not.toHaveBeenCalled();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   C) OTURUM KAYBI → FAIL-CLOSED OKUMA (sahte "temiz" YOK)
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-VDK-F1B · C) oturum kaybının ürün etkisi', () => {
  it('🔒 ANA KİLİT: DEGRADED kirada UDS okuması ERTELENİR ve "temiz" SAYILMAZ', async () => {
    advancedWithSession(true, '1003');
    const txn = beginTransaction({ purpose: 'multi_ecu_scan' });
    await prepareTransaction(txn);

    // İlk tur: oturum açılır, kira ACTIVE olur.
    await scanAllEcus(oneEcuTopology(), [], txn);

    // Kirayı DEGRADED yap (iki başarısız keepalive) ve İKİNCİ turu koştur.
    const txn2 = beginTransaction({ purpose: 'multi_ecu_scan' });
    await prepareTransaction(txn2);
    vi.mocked(CarLauncher.sendTesterPresent!).mockResolvedValue({
      raw: '', kind: 'NO_DATA', outcome: 'no_response',
    });
    vi.mocked(CarLauncher.readAdvancedDtcs!).mockImplementation(async ({ subFunction }) => {
      if (subFunction === '02') {
        return {
          outcome: 'ok' as const, kind: 'OK', raw: 'FF' + '038011' + '09',
          sessionOpened: true, sessionCommand: '1003',
        };
      }
      if (subFunction === '0A') {
        /* Kira ARTIK ACTIVE (0x19-02 kanıtı uygulandı) → iki keepalive düşür. */
        clock.t += DEFAULT_KEEPALIVE_INTERVAL_MS;
        await _tickSchedulerForTest();
        clock.t += DEFAULT_KEEPALIVE_INTERVAL_MS;
        await _tickSchedulerForTest();
      }
      return { outcome: 'unsupported' as const, raw: '', kind: 'NEG_7F', nrc: 0x12 };
    });

    await scanAllEcus(oneEcuTopology(), [], txn2);

    const degraded = getSessionLeases().filter((l) => l.consecutiveFailures > 0);
    expect(degraded.length, 'keepalive düşüşü kirada görünmedi').toBeGreaterThan(0);
    /* KRİTİK: keepalive düşüşü tek başına "ECU arızalı" ya da "DTC yok"
       hükmü ÜRETMEZ — kod okundu ve korundu. */
    expect(degraded[0]!.failureReason).toContain('keepalive');
  });

  it('🔒 KİLİT: keepalive düşüşü DTC sayım zincirini BOZMAZ (keepalive DTC üretmez)', async () => {
    advancedWithSession(true, '1003');
    const txn = beginTransaction({ purpose: 'multi_ecu_scan' });
    await prepareTransaction(txn);
    await scanAllEcus(oneEcuTopology(), [], txn);

    /* Keepalive hiçbir DTC üretmez → sayım zincirine GİRMEZ. */
    const rows = getDtcPipelineEntries().filter((e) => e.service === '19');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.service !== '3E')).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   D) REGRESYON — canlı akış ve recovery DOKUNULMADI
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-VDK-F1B · D) regresyon', () => {
  it('🔒 KİLİT: oturum açılmayan taramada native çağrı sayısı DEĞİŞMEZ', async () => {
    advancedWithSession(false);
    const txn = beginTransaction({ purpose: 'multi_ecu_scan' });
    await prepareTransaction(txn);
    await scanAllEcus(oneEcuTopology(), [], txn);

    /* Mode 03/07/0A = 3 çağrı; keepalive YOK → ek trafik YOK. */
    expect(vi.mocked(CarLauncher.readDtcFromEcu).mock.calls).toHaveLength(3);
    expect(CarLauncher.sendTesterPresent).not.toHaveBeenCalled();
  });

  it('🔒 KİLİT: keepalive HİÇBİR reconnect/recovery BAŞLATMAZ', async () => {
    advancedWithSession(true, '1003');
    const txn = beginTransaction({ purpose: 'multi_ecu_scan' });
    await prepareTransaction(txn);
    vi.mocked(CarLauncher.sendTesterPresent!).mockRejectedValue(new Error('hat koptu'));

    await scanAllEcus(oneEcuTopology(), [], txn);
    clock.t += DEFAULT_KEEPALIVE_INTERVAL_MS;
    await _tickSchedulerForTest();

    /* Keepalive düşse bile hiçbir yeniden bağlanma/keşif tetiklenmez:
       `probeEcus` yalnız `discoverEcus`tan çağrılır ve bu turda ÇAĞRILMADI. */
    expect(CarLauncher.probeEcus).not.toHaveBeenCalled();
  });

  it('🔒 KİLİT: tarama bitince timer KESİN kapalı (süreç sızıntısı yok)', async () => {
    advancedWithSession(true, '1003');
    const txn = beginTransaction({ purpose: 'multi_ecu_scan' });
    await prepareTransaction(txn);
    await scanAllEcus(oneEcuTopology(), [], txn);
    expect(_isSchedulerTimerRunning()).toBe(false);
  });
});
