/**
 * diagnosticTransaction.test.ts — P0-VDK-F1A · KANONİK TANI İŞLEMİ KİLİTLERİ.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ÖLÇÜLEN LEGACY BORÇ
 * ══════════════════════════════════════════════════════════════════════════
 * Her tanı girişi (`readAllDTCs` · `discoverEcus` · `scanAllEcus` · üretici
 * DTC okumaları) AYNI ÜÇ ADIMI elle kopyalıyordu (epoch yakala · admisyon sor ·
 * stale filtrele). Kopyalanan her satır bir kusur adayıdır. Üstelik ÜÇ ŞEY
 * HİÇBİR YERDE YOKTU:
 *   · BÜTÇE   — sabitler birbirinden habersizdi, toplam maliyet ölçülmüyordu
 *   · İPTAL   — kullanıcı çıksa bile tarama hattı sürüyordu
 *   · GEÇ YANIT — tur bittikten SONRA gelen yanıt sonucu SESSİZCE değiştiriyordu
 *
 * Bu dosya omurganın sözleşmesini kilitler.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

/* Epoch ve admisyon DIŞ otoritelerdir — işlem onları yalnız OKUR.
   Testte ikisini de kontrol edip "işlem kendi otoritesini kurmuyor" kilidini
   doğrulayabiliyoruz. */
const epochRef = { value: 0 };
const admissionRef = { value: 'READY', reason: 'test' };

vi.mock('../platform/obdService', () => ({
  getObdSessionEpoch: () => epochRef.value,
}));
vi.mock('../platform/obd/diagnosticAdmission', () => ({
  getDiagnosticAdmission: async () => ({ admission: admissionRef.value, reason: admissionRef.reason }),
  getDiagnosticAdmissionSync: () => ({ admission: admissionRef.value, reason: admissionRef.reason }),
}));

import {
  beginTransaction, prepareTransaction, prepareTransactionSync, transitionTransaction,
  consumeRequest, acceptResponse, cancelTransaction, completeTransaction, failTransaction,
  isTransactionLive, transactionLiveness, addRestoreObligation, isTransitionAllowed,
  isTerminalState, summarizeTransactions, getTransactions,
  DEFAULT_BUDGETS, FUNCTIONAL_ENDPOINT,
  _resetTransactionsForTest, _setTransactionClockForTest,
  type TransactionState,
} from '../platform/obd/diagnosticTransaction';

const clock = { t: 1_000 };

beforeEach(() => {
  _resetTransactionsForTest();
  clock.t = 1_000;
  _setTransactionClockForTest(() => clock.t);
  epochRef.value = 0;
  admissionRef.value = 'READY';
});

/** READY admisyonla hazırlanmış, istek göndermeye hazır bir işlem. */
async function liveTxn(purpose: 'dtc_scan' | 'multi_ecu_scan' = 'dtc_scan') {
  const t = beginTransaction({ purpose });
  await prepareTransaction(t);
  return t;
}

/* ═══════════════════════════════════════════════════════════════════════════
   A) DURUM MAKİNESİ — beyaz liste, UNKNOWN fail-closed
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-VDK-F1A · A) durum makinesi', () => {
  it('yeni işlem CREATED ve henüz CANLI DEĞİL (hazırlanmadan istek YOK)', () => {
    const t = beginTransaction({ purpose: 'dtc_scan' });
    expect(t.state).toBe('CREATED');
    expect(isTransactionLive(t)).toBe(false);
    expect(consumeRequest(t)).toBe(false);
  });

  it('CREATED → PREPARING → SESSION_ACTIVE → EXECUTING → COMPLETED', async () => {
    const t = beginTransaction({ purpose: 'dtc_scan' });
    const prep = await prepareTransaction(t);
    expect(prep.ok).toBe(true);
    expect(t.state).toBe('SESSION_ACTIVE');
    expect(consumeRequest(t)).toBe(true);
    expect(t.state).toBe('EXECUTING');
    expect(completeTransaction(t)).toBe('COMPLETED');
  });

  it('🔒 ANA KİLİT: beyaz listede OLMAYAN geçiş → UNKNOWN (fail-closed)', () => {
    const t = beginTransaction({ purpose: 'dtc_scan' });
    // CREATED'ten doğrudan EXECUTING YASAK.
    expect(transitionTransaction(t, 'EXECUTING')).toBe('UNKNOWN');
    expect(t.state).toBe('UNKNOWN');
    expect(t.invalidTransitionFrom).toBe('CREATED');   // ihlalin izi KAYBOLMAZ
  });

  it('🔒 ANA KİLİT: UNKNOWN TERMİNALDİR — canlı değil, bütçe tüketilemez, yanıt kabul EDİLMEZ', () => {
    const t = beginTransaction({ purpose: 'dtc_scan' });
    transitionTransaction(t, 'EXECUTING');            // → UNKNOWN
    expect(isTerminalState('UNKNOWN')).toBe(true);
    expect(isTransactionLive(t)).toBe(false);
    expect(consumeRequest(t)).toBe(false);
    expect(acceptResponse(t)).toBe(false);
    /* UNKNOWN'dan çıkış YOK — "toparlanma" sessiz bir yalan olurdu. */
    expect(transitionTransaction(t, 'COMPLETED')).toBe('UNKNOWN');
  });

  it('🔒 KİLİT: terminal durumdan çıkış YOK', () => {
    for (const term of ['COMPLETED', 'CANCELLED', 'FAILED', 'UNKNOWN'] as TransactionState[]) {
      for (const to of ['PREPARING', 'EXECUTING', 'COMPLETED'] as TransactionState[]) {
        expect(isTransitionAllowed(term, to), `${term}→${to}`).toBe(false);
      }
    }
  });

  it('🔒 KİLİT: admisyon READY DEĞİLSE işlem FAILED ve hiç istek gönderilemez', async () => {
    admissionRef.value = 'RECOVERY_ACTIVE';
    const t = beginTransaction({ purpose: 'dtc_scan' });
    const prep = await prepareTransaction(t);
    expect(prep.ok).toBe(false);
    expect(prep.admission).toBe('RECOVERY_ACTIVE');
    expect(t.state).toBe('FAILED');
    expect(consumeRequest(t)).toBe(false);
  });

  it('senkron hazırlık aynı sözleşmeyi uygular', () => {
    admissionRef.value = 'TRANSPORT_DOWN';
    const t = beginTransaction({ purpose: 'multi_ecu_scan' });
    expect(prepareTransactionSync(t).ok).toBe(false);
    expect(t.state).toBe('FAILED');
  });

  it('COMPLETED, geri-alma yükümlülüğü varsa RESTORING üzerinden geçer', async () => {
    const t = await liveTxn();
    addRestoreObligation(t, 'ecu_header', 'ATSH 7E0 → restore');
    expect(completeTransaction(t)).toBe('COMPLETED');
    /* ⚠️ Bu turda yükümlülük ÇALIŞTIRILMAZ — yalnız kaydedilir (F1-B). */
    expect(t.restoreObligations).toHaveLength(1);
    expect(t.restoreObligations[0]!.applied).toBe(false);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   B) BÜTÇE — tek yerde, ölçülebilir
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-VDK-F1A · B) bütçe', () => {
  it('🔒 ANA KİLİT: istek bütçesi dolunca daha fazla istek REDDEDİLİR', async () => {
    const t = beginTransaction({ purpose: 'dtc_scan', budget: { maxRequests: 3 } });
    await prepareTransaction(t);
    expect(consumeRequest(t)).toBe(true);
    expect(consumeRequest(t)).toBe(true);
    expect(consumeRequest(t)).toBe(true);
    expect(consumeRequest(t)).toBe(false);
    expect(t.lastDenial).toBe('REQUEST_BUDGET_EXHAUSTED');
    expect(t.requestsUsed).toBe(3);   // bütçe AŞILMADI
  });

  it('🔒 ANA KİLİT: süre bütçesi dolunca istek REDDEDİLİR', async () => {
    const t = beginTransaction({ purpose: 'dtc_scan', budget: { timeBudgetMs: 5_000 } });
    await prepareTransaction(t);
    expect(consumeRequest(t)).toBe(true);
    clock.t += 5_000;
    expect(consumeRequest(t)).toBe(false);
    expect(t.lastDenial).toBe('TIME_BUDGET_EXHAUSTED');
  });

  it('🔒 KİLİT: bütçe dolsa bile UÇUŞTAKİ meşru yanıt KABUL EDİLİR', async () => {
    /* `consumeRequest` "göndereyim mi", `acceptResponse` "geleni yazayım mı".
       İkisini birleştirmek, gönderilmiş meşru bir yanıtı ATMAK olurdu. */
    const t = beginTransaction({ purpose: 'dtc_scan', budget: { maxRequests: 1 } });
    await prepareTransaction(t);
    expect(consumeRequest(t)).toBe(true);
    expect(consumeRequest(t)).toBe(false);          // bütçe doldu
    expect(acceptResponse(t)).toBe(true);           // ama uçuştaki yanıt geçerli
  });

  it('her amacın varsayılan bütçesi tanımlı (sessiz sınırsızlık YOK)', () => {
    for (const [purpose, b] of Object.entries(DEFAULT_BUDGETS)) {
      expect(b.maxRequests, purpose).toBeGreaterThan(0);
      expect(b.timeBudgetMs, purpose).toBeGreaterThan(0);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   C) İPTAL
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-VDK-F1A · C) iptal', () => {
  it('🔒 ANA KİLİT: iptal sonrası istek gönderilemez ve yanıt kabul edilmez', async () => {
    const t = await liveTxn();
    expect(consumeRequest(t)).toBe(true);
    cancelTransaction(t, 'kullanıcı ekrandan çıktı');
    expect(t.state).toBe('CANCELLED');
    expect(consumeRequest(t)).toBe(false);
    expect(acceptResponse(t)).toBe(false);
    expect(t.cancelReason).toBe('kullanıcı ekrandan çıktı');
  });

  it('iptal idempotenttir ve terminal işlemi GERİ ALMAZ', async () => {
    const t = await liveTxn();
    completeTransaction(t);
    cancelTransaction(t, 'geç iptal');
    expect(t.state).toBe('COMPLETED');   // tamamlanmış işlem iptale dönmez
  });

  it('🔒 KİLİT: iptal edilmiş işlem COMPLETED YAPILAMAZ', async () => {
    const t = await liveTxn();
    cancelTransaction(t, 'iptal');
    expect(completeTransaction(t)).toBe('CANCELLED');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   D) BAYAT OTURUM + GEÇ YANIT
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-VDK-F1A · D) bayat oturum ve geç yanıt', () => {
  it('🔒 ANA KİLİT: OBD oturumu değişince işlem CANLI DEĞİLDİR', async () => {
    const t = await liveTxn();
    expect(isTransactionLive(t)).toBe(true);
    epochRef.value = 7;                       // reconnect / araç değişimi
    const l = transactionLiveness(t);
    expect(l.live).toBe(false);
    expect(l.denial).toBe('STALE_EPOCH');
    expect(consumeRequest(t)).toBe(false);
  });

  it('🔒 ANA KİLİT: bayat oturumdan gelen GEÇ YANIT reddedilir', async () => {
    const t = await liveTxn();
    epochRef.value = 7;
    expect(acceptResponse(t)).toBe(false);
    expect(t.lastDenial).toBe('STALE_EPOCH');
  });

  it('🔒 ANA KİLİT: tur BİTTİKTEN sonra gelen yanıt sonucu DEĞİŞTİREMEZ', async () => {
    const t = await liveTxn();
    consumeRequest(t);
    completeTransaction(t);
    expect(acceptResponse(t)).toBe(false);    // uçuştaki native cevap ARTIK geçersiz
    expect(t.lastDenial).toBe('NOT_LIVE');
  });

  it('🔒 FAIL-CLOSED: epoch OKUNAMAMIŞSA (-1) sahte "bayat" hükmü ÜRETİLMEZ', async () => {
    epochRef.value = -1;
    const t = beginTransaction({ purpose: 'dtc_scan' });
    await prepareTransaction(t);
    expect(t.sessionEpoch).toBe(-1);
    epochRef.value = 3;
    /* Mühür hiç ölçülemediyse karşılaştırma YAPILMAZ — ölçülmemiş bir şeyi
       "değişti" saymak uydurma bir hükümdür. */
    expect(isTransactionLive(t)).toBe(true);
  });

  it('epoch admisyondan SONRA tazelenir (kapı beklerken değişmiş olabilir)', async () => {
    const t = beginTransaction({ purpose: 'dtc_scan' });
    epochRef.value = 5;                       // begin ile prepare arasında değişti
    await prepareTransaction(t);
    expect(t.sessionEpoch).toBe(5);
    expect(isTransactionLive(t)).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   E) İZOLASYON — A işlemi B'yi etkilemez
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-VDK-F1A · E) işlem izolasyonu', () => {
  it('🔒 ANA KİLİT: A iptal edilince B etkilenmez', async () => {
    const a = await liveTxn('dtc_scan');
    const b = await liveTxn('multi_ecu_scan');
    cancelTransaction(a, 'A iptal');
    expect(a.state).toBe('CANCELLED');
    expect(b.state).toBe('SESSION_ACTIVE');
    expect(consumeRequest(b)).toBe(true);
  });

  it('🔒 KİLİT: A bütçesini tüketince B’nin bütçesi etkilenmez', async () => {
    const a = beginTransaction({ purpose: 'dtc_scan', budget: { maxRequests: 1 } });
    const b = beginTransaction({ purpose: 'dtc_scan', budget: { maxRequests: 1 } });
    await prepareTransaction(a); await prepareTransaction(b);
    expect(consumeRequest(a)).toBe(true);
    expect(consumeRequest(a)).toBe(false);
    expect(consumeRequest(b)).toBe(true);      // B kendi bütçesine sahip
  });

  it('işlem kimlikleri benzersizdir ve amaç taşır', async () => {
    const a = await liveTxn('dtc_scan');
    const b = await liveTxn('multi_ecu_scan');
    expect(a.transactionId).not.toBe(b.transactionId);
    expect(a.evidenceCorrelationId).toBe(a.transactionId);
    expect(b.purpose).toBe('multi_ecu_scan');
  });

  it('varsayılan hedef FONKSİYONELDİR (tek ECU’ya ait değil) ve yetki SALT-OKUNUR', () => {
    const t = beginTransaction({ purpose: 'dtc_scan' });
    expect(t.ecuEndpoint).toEqual(FUNCTIONAL_ENDPOINT);
    /* ⚠️ `authorityClass` yalnız ETİKETTİR; bu tur hiçbir destructive yetki
       tanımlamaz ve varsayılan asla DESTRUCTIVE olamaz. */
    expect(t.authorityClass).toBe('READ_ONLY');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   F) ÖZET (LAB gözlemi)
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-VDK-F1A · F) özet', () => {
  it('durumları ve red nedenlerini sayar; UNKNOWN ayrı raporlanır', async () => {
    const ok = await liveTxn(); completeTransaction(ok);
    const cancelled = await liveTxn(); cancelTransaction(cancelled, 'x');
    const failed = await liveTxn(); failTransaction(failed, 'y');
    const bad = beginTransaction({ purpose: 'dtc_scan' });
    transitionTransaction(bad, 'EXECUTING');   // → UNKNOWN

    const s = summarizeTransactions(getTransactions());
    expect(s.total).toBe(4);
    expect(s.completed).toBe(1);
    expect(s.cancelled).toBe(1);
    expect(s.failed).toBe(1);
    expect(s.unknown).toBe(1);   // 0 DIŞINDAKİ her değer bir kusurdur
  });

  it('bayat epoch reddi özet üzerinden görünür', async () => {
    const t = await liveTxn();
    epochRef.value = 9;
    consumeRequest(t);
    expect(summarizeTransactions(getTransactions()).staleEpochRejections).toBe(1);
  });
});
