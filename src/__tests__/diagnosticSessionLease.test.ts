/**
 * diagnosticSessionLease.test.ts — P0-VDK-F1B · OTURUM YAŞAM DÖNGÜSÜ KİLİTLERİ.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ÖLÇÜLEN LEGACY BORÇ
 * ══════════════════════════════════════════════════════════════════════════
 * `ElmProtocol.openExtendedSession()` NRC SESSION_REQUIRED'da ZATEN çağrılıyordu
 * ama sonucu bir `boolean`'a düşüp ATILIYORDU. TS "bu ECU'da oturum açıldı mı"
 * sorusunu HİÇ yanıtlayamıyordu → oturum ömrü görünmez, keepalive imkânsızdı.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * BU DOSYANIN EN ÖNEMLİ KİLİDİ
 * ══════════════════════════════════════════════════════════════════════════
 * **Kanıtsız/varsayılan oturuma KÖR `3E` GÖNDERİLEMEZ.** Kör keepalive
 * anlamsız hat trafiğidir, canlı PID akışını geciktirir ve hiçbir şeyi canlı
 * tutmaz. Bu yasak İKİ BAĞIMSIZ kapıyla korunur (bayrak + kanıt alanı).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const epochRef = { value: 0 };

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: vi.fn(() => true) },
}));
vi.mock('../platform/nativePlugin', () => ({
  CarLauncher: { sendTesterPresent: vi.fn() },
}));
vi.mock('../platform/obdService', () => ({
  getObdSessionEpoch: () => epochRef.value,
}));
vi.mock('../platform/obd/diagnosticAdmission', () => ({
  getDiagnosticAdmission: async () => ({ admission: 'READY', reason: 'test' }),
  getDiagnosticAdmissionSync: () => ({ admission: 'READY', reason: 'test' }),
}));

import { CarLauncher } from '../platform/nativePlugin';
import {
  createSessionLease, applySessionEvidence, applyKeepAliveOutcome, isKeepAliveDue,
  markKeepAliveSent, closeSessionLease, failSession, transitionSession,
  isSessionTransitionAllowed, isSessionTerminal, isSessionExpired, isLeaseEpochValid,
  canReadUnderLease, sessionKindFromCommand, leaseDenialReason,
  SESSION_S3_TIMEOUT_MS, DEFAULT_KEEPALIVE_INTERVAL_MS, KEEPALIVE_FAILURES_BEFORE_DEGRADED,
  type SessionState,
} from '../platform/obd/diagnosticSessionLease';
import {
  beginTransaction, prepareTransaction, cancelTransaction, completeTransaction,
  _resetTransactionsForTest, _setTransactionClockForTest,
} from '../platform/obd/diagnosticTransaction';
import {
  openSessionLease, applyLeaseSessionEvidence, closeLeasesForTransaction,
  getSessionLeases, registerTransactionOwner,
  _resetSchedulerForTest, _setSchedulerClockForTest, _tickSchedulerForTest,
  _isSchedulerTimerRunning,
} from '../platform/obd/diagnosticSessionScheduler';
import {
  getSessionEvidence, summarizeSessionEvidence, _resetSessionEvidenceForTest,
} from '../platform/obd/diagnosticSessionEvidence';

const clock = { t: 10_000 };
const ECU = { txHeader: '7E0', rxHeader: '7E8', addressBits: 11, label: 'Motor (ECM)' };
const ECU2 = { txHeader: '7E1', rxHeader: '7E9', addressBits: 11, label: 'ECU 7E1' };

beforeEach(() => {
  _resetTransactionsForTest();
  _resetSchedulerForTest();
  _resetSessionEvidenceForTest();
  clock.t = 10_000;
  _setTransactionClockForTest(() => clock.t);
  _setSchedulerClockForTest(() => clock.t);
  epochRef.value = 0;
  vi.mocked(CarLauncher.sendTesterPresent!).mockReset();
  vi.mocked(CarLauncher.sendTesterPresent!).mockResolvedValue({
    raw: '7E00', kind: 'OK', outcome: 'ok',
  });
});

function lease(over: Partial<Parameters<typeof createSessionLease>[0]> = {}) {
  return createSessionLease({
    leaseId: 'L1', transactionId: 'T1', ecuEndpoint: ECU, protocol: '6',
    sessionEpoch: 0, nowMs: clock.t, ...over,
  });
}

/** Hazırlanmış işlem + kanıtlanmış UDS oturumu olan canlı kira. */
async function activeLeaseWithTxn() {
  const txn = beginTransaction({ purpose: 'manufacturer_dtc' });
  await prepareTransaction(txn);
  const l = openSessionLease(txn, ECU, '6');
  applyLeaseSessionEvidence(l, txn, { sessionOpened: true, sessionCommand: '1003' });
  return { txn, l };
}

/* ═══════════════════════════════════════════════════════════════════════════
   A) KÖR TESTER PRESENT YASAĞI — bu turun ANA kilidi
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-VDK-F1B · A) kör TesterPresent yasağı', () => {
  it('🔒 ANA KİLİT: oturum AÇILMADIYSA hiçbir koşulda 3E gönderilmez', async () => {
    const txn = beginTransaction({ purpose: 'manufacturer_dtc' });
    await prepareTransaction(txn);
    const l = openSessionLease(txn, ECU, '6');
    /* Native "oturum açmadım" dedi → varsayılan oturumdayız. */
    applyLeaseSessionEvidence(l, txn, { sessionOpened: false, sessionCommand: null });

    expect(l.state).toBe('NOT_REQUIRED');
    expect(l.keepAliveRequired).toBe(false);

    clock.t += 60_000;                       // uzun süre geçsin
    await _tickSchedulerForTest();
    expect(CarLauncher.sendTesterPresent).not.toHaveBeenCalled();
  });

  it('🔒 ANA KİLİT: oturum kanıtı GELMEDEN (OPENING) 3E gönderilmez', async () => {
    const txn = beginTransaction({ purpose: 'manufacturer_dtc' });
    await prepareTransaction(txn);
    const l = openSessionLease(txn, ECU, '6');
    registerTransactionOwner(txn);
    expect(l.state).toBe('OPENING');

    clock.t += 60_000;
    await _tickSchedulerForTest();
    expect(CarLauncher.sendTesterPresent).not.toHaveBeenCalled();
  });

  it('🔒 ANA KİLİT: KWP oturumu (10 81 / 10 C0) keepalive GEREKTİRMEZ — adaptör ATWM yapar', async () => {
    /* ELM327 yavaş seri hatta `ATWM C1 33 F1 3E` + `ATSW 92` ile keepalive'ı
       ZATEN kendisi gönderir (ElmInitSequencer). Üstüne TS'ten ikinci bir 3E
       çift TesterPresent üretir ve ikinci bir zamanlama otoritesi kurardı. */
    for (const cmd of ['1081', '10C0']) {
      const txn = beginTransaction({ purpose: 'manufacturer_dtc' });
      await prepareTransaction(txn);
      const l = openSessionLease(txn, { ...ECU, rxHeader: `RX${cmd}` }, '5');
      applyLeaseSessionEvidence(l, txn, { sessionOpened: true, sessionCommand: cmd });
      expect(l.state, cmd).toBe('NOT_REQUIRED');
      expect(l.keepAliveRequired, cmd).toBe(false);
    }
    clock.t += 60_000;
    await _tickSchedulerForTest();
    expect(CarLauncher.sendTesterPresent).not.toHaveBeenCalled();
  });

  it('🔒 KİLİT: TANINMAYAN oturum komutunda keepalive AÇILMAZ (uydurma yok)', () => {
    const l = lease();
    applySessionEvidence(l, { sessionOpened: true, sessionCommand: '10AB' }, clock.t);
    expect(l.sessionKind).toBe('UNKNOWN');
    expect(l.keepAliveRequired).toBe(false);
  });

  it('🔒 KİLİT: kanıt alanı BOŞSA `keepAliveRequired` true olsa bile due DEĞİL (çift kapı)', () => {
    const l = lease();
    applySessionEvidence(l, { sessionOpened: true, sessionCommand: '1003' }, clock.t);
    expect(isKeepAliveDue(l, clock.t + 60_000)).toBe(true);
    /* Bayrak yanlışlıkla true kalsa bile kanıt yoksa gönderilmez. */
    l.sessionEstablishedEvidence = null;
    expect(isKeepAliveDue(l, clock.t + 60_000)).toBe(false);
  });

  it('komut → oturum türü eşlemesi (tahmin YOK)', () => {
    expect(sessionKindFromCommand('1003')).toBe('UDS_EXTENDED_1003');
    expect(sessionKindFromCommand('1081')).toBe('KWP_STANDARD_1081');
    expect(sessionKindFromCommand('10C0')).toBe('KWP_EXTENDED_10C0');
    expect(sessionKindFromCommand('')).toBe('DEFAULT');
    expect(sessionKindFromCommand('9999')).toBe('UNKNOWN');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   B) AKTİF OTURUM → DOĞRU ZAMANDA KEEPALIVE
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-VDK-F1B · B) keepalive zamanlaması', () => {
  it('🔒 ANA KİLİT: UDS extended oturumu ACTIVE olur ve S3 penceresi kurulur', async () => {
    const { l } = await activeLeaseWithTxn();
    expect(l.state).toBe('ACTIVE');
    expect(l.sessionKind).toBe('UDS_EXTENDED_1003');
    expect(l.keepAliveRequired).toBe(true);
    expect(l.expiresAt).toBe(clock.t + SESSION_S3_TIMEOUT_MS);
    /* Keepalive aralığı S3'ün ALTINDA olmalı — yoksa oturum düşer. */
    expect(DEFAULT_KEEPALIVE_INTERVAL_MS).toBeLessThan(SESSION_S3_TIMEOUT_MS);
  });

  it('🔒 KİLİT: aralık DOLMADAN keepalive gönderilmez', async () => {
    await activeLeaseWithTxn();
    clock.t += DEFAULT_KEEPALIVE_INTERVAL_MS - 1;
    await _tickSchedulerForTest();
    expect(CarLauncher.sendTesterPresent).not.toHaveBeenCalled();
  });

  it('🔒 ANA KİLİT: aralık dolunca 3E gönderilir ve pozitif yanıt oturumu tazeler', async () => {
    const { l } = await activeLeaseWithTxn();
    clock.t += DEFAULT_KEEPALIVE_INTERVAL_MS;
    await _tickSchedulerForTest();

    expect(CarLauncher.sendTesterPresent).toHaveBeenCalledTimes(1);
    expect(vi.mocked(CarLauncher.sendTesterPresent!).mock.calls[0]![0])
      .toEqual({ tx: '7E0', rx: '7E8' });
    expect(l.state).toBe('ACTIVE');
    expect(l.keepAliveSuccesses).toBe(1);
    expect(l.expiresAt).toBe(clock.t + SESSION_S3_TIMEOUT_MS);   // pencere tazelendi
  });

  it('keepalive maliyeti TANI bütçesinden AYRI sayılır', async () => {
    const { txn } = await activeLeaseWithTxn();
    const diagBefore = txn.requestsUsed;
    clock.t += DEFAULT_KEEPALIVE_INTERVAL_MS;
    await _tickSchedulerForTest();
    expect(txn.keepAliveRequestsUsed).toBe(1);
    expect(txn.requestsUsed).toBe(diagBefore);   // tanı bütçesi DOKUNULMADI
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   C) İŞLEM ÖMRÜ — cancel / complete keepalive'ı KESİN durdurur
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-VDK-F1B · C) işlem ömrüne bağlılık', () => {
  it('🔒 ANA KİLİT: işlem CANCELLED → keepalive tamamen durur, timer kapanır', async () => {
    const { txn, l } = await activeLeaseWithTxn();
    cancelTransaction(txn, 'kullanıcı çıktı');

    clock.t += 60_000;
    await _tickSchedulerForTest();

    expect(CarLauncher.sendTesterPresent).not.toHaveBeenCalled();
    expect(isSessionTerminal(l.state)).toBe(true);
    expect(_isSchedulerTimerRunning()).toBe(false);   // timer SIZINTISI yok
  });

  it('🔒 ANA KİLİT: işlem COMPLETED → keepalive durur', async () => {
    const { txn, l } = await activeLeaseWithTxn();
    completeTransaction(txn);

    clock.t += 60_000;
    await _tickSchedulerForTest();

    expect(CarLauncher.sendTesterPresent).not.toHaveBeenCalled();
    expect(l.state).toBe('CLOSED');
  });

  it('🔒 KİLİT: `closeLeasesForTransaction` keepalive’ı ANINDA keser', async () => {
    const { txn, l } = await activeLeaseWithTxn();
    closeLeasesForTransaction(txn, 'tarama bitti');
    expect(l.state).toBe('CLOSED');
    expect(l.keepAliveRequired).toBe(false);
    clock.t += 60_000;
    await _tickSchedulerForTest();
    expect(CarLauncher.sendTesterPresent).not.toHaveBeenCalled();
  });

  it('🔒 KİLİT: GEÇ TIMER kapanmış işleme komut GÖNDEREMEZ', async () => {
    const { txn } = await activeLeaseWithTxn();
    clock.t += DEFAULT_KEEPALIVE_INTERVAL_MS;
    /* Tur başlamadan hemen önce işlem kapandı — geç timer senaryosu. */
    completeTransaction(txn);
    await _tickSchedulerForTest();
    expect(CarLauncher.sendTesterPresent).not.toHaveBeenCalled();
  });

  it('🔒 KİLİT: UÇUŞTAKİ keepalive yanıtı, kapanmış işlemin kirasını DEĞİŞTİRMEZ', async () => {
    const { txn, l } = await activeLeaseWithTxn();
    /* Native yanıt dönerken işlem kapanıyor (gerçek yarış). */
    vi.mocked(CarLauncher.sendTesterPresent!).mockImplementation(async () => {
      completeTransaction(txn);
      return { raw: '7E00', kind: 'OK', outcome: 'ok' as const };
    });
    clock.t += DEFAULT_KEEPALIVE_INTERVAL_MS;
    await _tickSchedulerForTest();

    expect(l.state).toBe('CLOSED');          // geç yanıt kirayı ACTIVE yapmadı
    expect(l.keepAliveSuccesses).toBe(0);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   D) BAYAT OTURUM (epoch)
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-VDK-F1B · D) bayat oturum', () => {
  it('🔒 ANA KİLİT: OBD oturumu değişirse kira ÖLÜR ve 3E gitmez', async () => {
    const { l } = await activeLeaseWithTxn();
    epochRef.value = 7;                       // reconnect
    clock.t += DEFAULT_KEEPALIVE_INTERVAL_MS;
    await _tickSchedulerForTest();

    expect(CarLauncher.sendTesterPresent).not.toHaveBeenCalled();
    expect(l.state).toBe('CLOSED');
    expect(getSessionEvidence().some((e) => e.kind === 'SESSION_EXPIRED')).toBe(true);
  });

  it('🔒 FAIL-CLOSED: epoch ÖLÇÜLEMEMİŞSE (-1) sahte "bayat" hükmü ÜRETİLMEZ', () => {
    const l = lease({ sessionEpoch: -1 });
    expect(isLeaseEpochValid(l, 5)).toBe(true);
    expect(isLeaseEpochValid(l, null)).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   E) İZOLASYON — iki ECU / iki işlem
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-VDK-F1B · E) izolasyon', () => {
  it('🔒 ANA KİLİT: A işlemi iptal edilince B’nin keepalive’ı SÜRER', async () => {
    const a = beginTransaction({ purpose: 'manufacturer_dtc' });
    const b = beginTransaction({ purpose: 'manufacturer_dtc' });
    await prepareTransaction(a); await prepareTransaction(b);
    const la = openSessionLease(a, ECU, '6');
    const lb = openSessionLease(b, ECU2, '6');
    applyLeaseSessionEvidence(la, a, { sessionOpened: true, sessionCommand: '1003' });
    applyLeaseSessionEvidence(lb, b, { sessionOpened: true, sessionCommand: '1003' });

    cancelTransaction(a, 'A iptal');
    clock.t += DEFAULT_KEEPALIVE_INTERVAL_MS;
    await _tickSchedulerForTest();

    const calls = vi.mocked(CarLauncher.sendTesterPresent!).mock.calls.map((c) => c[0]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.rx).toBe('7E9');          // yalnız B'nin ECU'su
    expect(isSessionTerminal(la.state)).toBe(true);
    expect(lb.state).toBe('ACTIVE');
  });

  it('🔒 KİLİT: aynı (işlem × ECU) için İKİNCİ kira açılmaz (paralel timer yok)', async () => {
    const txn = beginTransaction({ purpose: 'manufacturer_dtc' });
    await prepareTransaction(txn);
    const l1 = openSessionLease(txn, ECU, '6');
    const l2 = openSessionLease(txn, ECU, '6');
    expect(l2.leaseId).toBe(l1.leaseId);
    expect(getSessionLeases()).toHaveLength(1);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   F) BAŞARISIZLIK — sahte DTC sonucu ÜRETİLMEZ
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-VDK-F1B · F) keepalive başarısızlığı', () => {
  it('🔒 ANA KİLİT: tek sessizlik oturumu ÖLDÜRMEZ; üst üste iki → DEGRADED', async () => {
    const { l } = await activeLeaseWithTxn();
    vi.mocked(CarLauncher.sendTesterPresent!).mockResolvedValue({
      raw: '', kind: 'NO_DATA', outcome: 'no_response',
    });

    clock.t += DEFAULT_KEEPALIVE_INTERVAL_MS;
    await _tickSchedulerForTest();
    expect(l.state).not.toBe('DEGRADED');      // tek sessizlik hat gürültüsü olabilir

    clock.t += DEFAULT_KEEPALIVE_INTERVAL_MS;
    await _tickSchedulerForTest();
    expect(l.state).toBe('DEGRADED');
    expect(l.consecutiveFailures).toBe(KEEPALIVE_FAILURES_BEFORE_DEGRADED);
  });

  it('🔒 ANA KİLİT: DEGRADED → okuma ERTELENİR ama "ECU arızalı / DTC yok" DENMEZ', () => {
    const l = lease();
    applySessionEvidence(l, { sessionOpened: true, sessionCommand: '1003' }, clock.t);
    applyKeepAliveOutcome(l, 'NO_RESPONSE', clock.t);
    applyKeepAliveOutcome(l, 'NO_RESPONSE', clock.t);
    expect(l.state).toBe('DEGRADED');
    /* Ürün kuralı: okuma yapılamaz (fail-closed) — ama bu bir ARIZA HÜKMÜ değil. */
    expect(canReadUnderLease(l)).toBe(false);
    expect(leaseDenialReason(l)).toContain('keepalive');
  });

  it('🔒 KİLİT: NRC provenance KORUNUR', async () => {
    const { l } = await activeLeaseWithTxn();
    vi.mocked(CarLauncher.sendTesterPresent!).mockResolvedValue({
      raw: '', kind: 'NEG_7F', outcome: 'negative_nrc', nrc: 0x22,
    });
    clock.t += DEFAULT_KEEPALIVE_INTERVAL_MS;
    await _tickSchedulerForTest();

    const neg = getSessionEvidence().find((e) => e.kind === 'KEEPALIVE_NEGATIVE');
    expect(neg).toBeDefined();
    expect(neg!.nrc).toBe(0x22);
    expect(l.timeoutEvidence).toContain('negatif');
  });

  it('DEGRADED sonrası POZİTİF keepalive oturumu KURTARIR', () => {
    const l = lease();
    applySessionEvidence(l, { sessionOpened: true, sessionCommand: '1003' }, clock.t);
    applyKeepAliveOutcome(l, 'NO_RESPONSE', clock.t);
    applyKeepAliveOutcome(l, 'NO_RESPONSE', clock.t);
    expect(l.state).toBe('DEGRADED');
    applyKeepAliveOutcome(l, 'POSITIVE', clock.t + 100);
    expect(l.state).toBe('ACTIVE');
    expect(l.consecutiveFailures).toBe(0);
  });

  it('oturum açılışı düşerse keepalive ASLA açılmaz', () => {
    const l = lease();
    failSession(l, 'ECU oturumu reddetti');
    expect(l.state).toBe('FAILED');
    expect(l.keepAliveRequired).toBe(false);
    expect(canReadUnderLease(l)).toBe(false);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   G) DURUM MAKİNESİ — UNKNOWN fail-closed
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-VDK-F1B · G) durum makinesi', () => {
  it('🔒 ANA KİLİT: izinsiz geçiş → UNKNOWN ve keepalive KAPANIR', () => {
    const l = lease();
    /* OPENING'ten doğrudan KEEPALIVE_DUE YASAK. */
    expect(transitionSession(l, 'KEEPALIVE_DUE')).toBe('UNKNOWN');
    expect(l.invalidTransitionFrom).toBe('OPENING');
    expect(l.keepAliveRequired).toBe(false);
    expect(isKeepAliveDue(l, clock.t + 999_999)).toBe(false);
    expect(canReadUnderLease(l)).toBe(false);
  });

  it('🔒 KİLİT: terminal durumdan çıkış YOK', () => {
    for (const term of ['CLOSED', 'FAILED', 'UNKNOWN'] as SessionState[]) {
      for (const to of ['ACTIVE', 'OPENING', 'KEEPALIVE_DUE'] as SessionState[]) {
        expect(isSessionTransitionAllowed(term, to), `${term}→${to}`).toBe(false);
      }
    }
  });

  it('🔒 KİLİT: NOT_REQUIRED sonradan kendiliğinden ACTIVE OLAMAZ (kanıt şart)', () => {
    expect(isSessionTransitionAllowed('NOT_REQUIRED', 'ACTIVE')).toBe(false);
  });

  it('S3 penceresi ölçülmediyse "doldu" SAYILMAZ', () => {
    const l = lease();
    expect(l.expiresAt).toBeNull();
    expect(isSessionExpired(l, clock.t + 999_999)).toBe(false);
  });

  it('markKeepAliveSent ACTIVE → KEEPALIVE_DUE geçişini yapar', () => {
    const l = lease();
    applySessionEvidence(l, { sessionOpened: true, sessionCommand: '1003' }, clock.t);
    markKeepAliveSent(l, clock.t + 3_000);
    expect(l.state).toBe('KEEPALIVE_DUE');
    expect(l.keepAliveAttempts).toBe(1);
  });

  it('closeSessionLease terminal kirayı DEĞİŞTİRMEZ', () => {
    const l = lease();
    failSession(l, 'x');
    expect(closeSessionLease(l, 'y')).toBe('FAILED');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   H) KANIT DEFTERİ
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-VDK-F1B · H) kanıt', () => {
  it('🔒 KİLİT: açılış → keepalive → kapanış zinciri kanıtla izlenebilir', async () => {
    const { txn } = await activeLeaseWithTxn();
    clock.t += DEFAULT_KEEPALIVE_INTERVAL_MS;
    await _tickSchedulerForTest();
    completeTransaction(txn);
    closeLeasesForTransaction(txn, 'bitti');

    const kinds = getSessionEvidence()
      .filter((e) => e.evidenceCorrelationId === txn.evidenceCorrelationId)
      .map((e) => e.kind);
    expect(kinds).toContain('SESSION_OPEN_ATTEMPT');
    expect(kinds).toContain('SESSION_OPEN_POSITIVE');
    expect(kinds).toContain('KEEPALIVE_SENT');
    expect(kinds).toContain('KEEPALIVE_POSITIVE');
    expect(kinds).toContain('SESSION_CLOSED');
  });

  it('özet: hiç keepalive gönderilmediyse başarı oranı `null` (sahte %100 YASAK)', () => {
    expect(summarizeSessionEvidence([]).successRate).toBeNull();
  });

  it('özet işlem korelasyonuyla filtrelenir', async () => {
    const { txn } = await activeLeaseWithTxn();
    clock.t += DEFAULT_KEEPALIVE_INTERVAL_MS;
    await _tickSchedulerForTest();
    const s = summarizeSessionEvidence(getSessionEvidence(), txn.evidenceCorrelationId);
    expect(s.sessionsOpened).toBe(1);
    expect(s.keepAliveSent).toBe(1);
    expect(s.keepAlivePositive).toBe(1);
    expect(s.successRate).toBe(1);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   I) TIMER SAHİPLİĞİ
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-VDK-F1B · I) timer sahipliği', () => {
  it('🔒 ANA KİLİT: keepalive gerekmeyen kirada timer HİÇ başlamaz', async () => {
    const txn = beginTransaction({ purpose: 'manufacturer_dtc' });
    await prepareTransaction(txn);
    const l = openSessionLease(txn, ECU, '6');
    applyLeaseSessionEvidence(l, txn, { sessionOpened: false, sessionCommand: null });
    expect(_isSchedulerTimerRunning()).toBe(false);
  });

  it('🔒 ANA KİLİT: son canlı kira düşünce timer DURUR (sızıntı yok)', async () => {
    const { txn } = await activeLeaseWithTxn();
    expect(_isSchedulerTimerRunning()).toBe(true);
    closeLeasesForTransaction(txn, 'bitti');
    expect(_isSchedulerTimerRunning()).toBe(false);
  });

  it('🔒 KİLİT: TEK timer — ikinci kira ikinci interval AÇMAZ', async () => {
    const a = beginTransaction({ purpose: 'manufacturer_dtc' });
    const b = beginTransaction({ purpose: 'manufacturer_dtc' });
    await prepareTransaction(a); await prepareTransaction(b);
    const la = openSessionLease(a, ECU, '6');
    const lb = openSessionLease(b, ECU2, '6');
    applyLeaseSessionEvidence(la, a, { sessionOpened: true, sessionCommand: '1003' });
    applyLeaseSessionEvidence(lb, b, { sessionOpened: true, sessionCommand: '1003' });
    expect(_isSchedulerTimerRunning()).toBe(true);
    /* İki kira, TEK timer: A kapansa bile B için aynı timer sürer. */
    closeLeasesForTransaction(a, 'A bitti');
    expect(_isSchedulerTimerRunning()).toBe(true);
    closeLeasesForTransaction(b, 'B bitti');
    expect(_isSchedulerTimerRunning()).toBe(false);
  });
});
