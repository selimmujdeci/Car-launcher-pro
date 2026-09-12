/**
 * diagnosticTransactionIntegration.test.ts — P0-VDK-F1A · ÜRÜN YOLU KİLİTLERİ.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * NEDEN AYRI DOSYA: `diagnosticTransaction.test.ts` omurganın SÖZLEŞMESİNİ
 * kilitler (saf birim). Bu dosya ondan farklı ve daha sert bir soruyu sorar:
 *
 *   **GERÇEK DTC / ÇOKLU-ECU ÜRÜN YOLU KANONİK İŞLEMDEN GEÇİYOR MU?**
 *
 * Bir omurganın "tip olarak var olması" hiçbir şey kanıtlamaz. Ürün yolu ondan
 * geçmiyorsa bütçe · iptal · bayat oturum · geç yanıt korumaları KÂĞIT ÜSTÜNDE
 * kalır — ve bu, tam olarak ürünün geçmişte tekrar tekrar ödediği hatadır
 * (`kwpTargetVerified` kodda vardı ama hiçbir yerde `true` olmuyordu).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const epochRef = { value: 0 };

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: vi.fn(() => true) },
}));
vi.mock('../platform/nativePlugin', () => ({
  CarLauncher: {
    probeEcus:        vi.fn(),
    readDtcFromEcu:   vi.fn(),
    readUdsDtcs:      vi.fn(),
    readAdvancedDtcs: vi.fn(),
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
import { scanAllEcus, runFullVehicleScan, discoverEcus } from '../platform/obd/multiEcuScan';
import {
  getTransactions, beginTransaction, prepareTransaction, cancelTransaction,
  _resetTransactionsForTest, _setTransactionClockForTest,
} from '../platform/obd/diagnosticTransaction';
import { _resetDtcAuthorityForTest } from '../platform/obd/dtcAuthority';
import { _resetPhysicalProbesForTest } from '../platform/obd/physicalEcuProbe';

function twoEcuTopology() {
  return buildTopology('7E8 06 41 00 BE\r\n7E9 06 41 00 80', 1_700_000_000_000);
}

const clock = { t: 1_000 };

beforeEach(() => {
  _resetTransactionsForTest();
  _resetDtcAuthorityForTest();
  _resetPhysicalProbesForTest();
  clock.t = 1_000;
  _setTransactionClockForTest(() => clock.t);
  epochRef.value = 0;
  vi.mocked(CarLauncher.probeEcus).mockReset();
  vi.mocked(CarLauncher.readDtcFromEcu).mockReset();
  vi.mocked(CarLauncher.readUdsDtcs!).mockReset();
  vi.mocked(CarLauncher.readAdvancedDtcs!).mockReset();
  vi.mocked(CarLauncher.probeEcus).mockResolvedValue({ raw: '7E8 06 41 00 BE\r\n7E9 06 41 00 80' });
  vi.mocked(CarLauncher.readDtcFromEcu).mockResolvedValue({ codes: [], supported: true });
  vi.mocked(CarLauncher.readUdsDtcs!).mockResolvedValue({ raw: '', supported: false });
  vi.mocked(CarLauncher.readAdvancedDtcs!).mockResolvedValue({
    outcome: 'no_response', raw: '', kind: 'NO_DATA',
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   A) ÜRÜN YOLU GERÇEKTEN OMURGADAN GEÇİYOR
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-VDK-F1A · A) ürün yolu bağlantısı', () => {
  it('🔒 ANA KİLİT: `scanAllEcus` kanonik işlem açar ve KAPATIR', async () => {
    await scanAllEcus(twoEcuTopology());
    const txns = getTransactions().filter((t) => t.purpose === 'multi_ecu_scan');
    expect(txns.length, 'çoklu-ECU taraması işlem AÇMADI').toBeGreaterThan(0);
    expect(txns[0]!.requestsUsed, 'işlem üzerinden hiç istek geçmedi').toBeGreaterThan(0);
  });

  it('🔒 ANA KİLİT: `discoverEcus` kanonik işlem açar', async () => {
    await discoverEcus();
    const txns = getTransactions().filter((t) => t.purpose === 'ecu_discovery');
    expect(txns.length).toBeGreaterThan(0);
    expect(txns[0]!.state).toBe('COMPLETED');
  });

  it('🔒 ANA KİLİT: `runFullVehicleScan` keşif + taramayı AYNI işlemde birleştirir', async () => {
    await runFullVehicleScan();
    const scans = getTransactions().filter((t) => t.purpose === 'multi_ecu_scan');
    /* Tam tarama TEK bir `multi_ecu_scan` işlemi açar; `scanAllEcus` onu
       ebeveyn olarak alır ve İKİNCİ bir işlem AÇMAZ (uyumluluk adaptörü). */
    expect(scans).toHaveLength(1);
    expect(scans[0]!.state).toBe('COMPLETED');
  });

  it('işlem aktif protokolü taşır (kanıt bağlantısı)', async () => {
    await scanAllEcus(twoEcuTopology());
    const t = getTransactions().find((x) => x.purpose === 'multi_ecu_scan')!;
    expect(t.protocol).toBe('6');
    expect(t.sessionEpoch).toBe(0);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   B) BÜTÇE ÜRÜN YOLUNDA GERÇEKTEN ISIRIYOR
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-VDK-F1A · B) bütçe ürün yolunda', () => {
  it('🔒 ANA KİLİT: istek bütçesi dolunca KALAN ECU’lar SORULMAZ ve sessizce atlanmaz', async () => {
    const txn = beginTransaction({ purpose: 'multi_ecu_scan', budget: { maxRequests: 2 } });
    await prepareTransaction(txn);

    const report = await scanAllEcus(twoEcuTopology(), [], txn);

    /* Bütçe 2 istekte doldu → ikinci ECU'ya HİÇ gidilmedi. */
    expect(txn.requestsUsed).toBe(2);
    expect(report.results.length).toBeLessThan(2);
    /* Kırpma SESSİZ DEĞİL: atlanan ECU kapsam raporunda görünür. */
    expect(report.skippedEcus).toBeGreaterThan(0);
  });

  it('🔒 KİLİT: süre bütçesi dolunca tarama DURUR', async () => {
    const txn = beginTransaction({ purpose: 'multi_ecu_scan', budget: { timeBudgetMs: 10_000 } });
    await prepareTransaction(txn);
    vi.mocked(CarLauncher.readDtcFromEcu).mockImplementation(async () => {
      clock.t += 20_000;                     // ilk ECU süreyi tüketti
      return { codes: [], supported: true };
    });

    const report = await scanAllEcus(twoEcuTopology(), [], txn);
    expect(report.skippedEcus).toBeGreaterThan(0);
    expect(txn.lastDenial).toBe('TIME_BUDGET_EXHAUSTED');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   C) İPTAL ÜRÜN YOLUNDA
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-VDK-F1A · C) iptal ürün yolunda', () => {
  it('🔒 ANA KİLİT: tarama ortasında iptal → KALAN ECU’lara TEK BAYT GİTMEZ', async () => {
    const txn = beginTransaction({ purpose: 'multi_ecu_scan' });
    await prepareTransaction(txn);

    let calls = 0;
    vi.mocked(CarLauncher.readDtcFromEcu).mockImplementation(async () => {
      calls++;
      if (calls === 1) cancelTransaction(txn, 'kullanıcı ekrandan çıktı');
      return { codes: [], supported: true };
    });

    const report = await scanAllEcus(twoEcuTopology(), [], txn);

    expect(txn.state).toBe('CANCELLED');
    /* İlk ECU'nun kalan modları + ikinci ECU'nun tamamı gönderilmedi:
       2 ECU × 3 mod = 6 çağrı olurdu. */
    expect(calls).toBeLessThan(6);
    expect(report.skippedEcus).toBeGreaterThan(0);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   D) BAYAT OTURUM ÜRÜN YOLUNDA
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-VDK-F1A · D) bayat oturum ürün yolunda', () => {
  it('🔒 ANA KİLİT: tarama ortasında OBD oturumu değişirse kalan ECU "temiz" SAYILMAZ', async () => {
    /* ── MİMARİ SINIR (bilinçli) ───────────────────────────────────────────
       Bayat oturum, işlem canlılık kapısında `break` ÜRETMEZ. Ürünün ZATEN
       daha zengin bir mekanizması var: per-ECU `_admissionFor` yolu ECU'yu
       `deferred` işaretler, gerekçesini deftere yazar ve kapsamı `UNKNOWN`a
       düşürür. Omurga o otoriteyi EZMEZ — ona YER AÇAR.

       Kilidin iddiası değişmedi: bayat oturumda hiçbir ECU "0 kod / temiz"
       sayılamaz ve başka oturumun kodu bu rapora KARIŞAMAZ. */
    const txn = beginTransaction({ purpose: 'multi_ecu_scan' });
    await prepareTransaction(txn);

    let calls = 0;
    vi.mocked(CarLauncher.readDtcFromEcu).mockImplementation(async () => {
      calls++;
      if (calls === 1) epochRef.value = 42;   // reconnect / araç değişimi
      return { codes: [], supported: true };
    });

    const report = await scanAllEcus(twoEcuTopology(), [], txn);

    /* Tur, başladığı oturumda BİTMEDİ → kapsam BAYAT ilan edilir. */
    expect(report.completeness.staleSession).toBe(true);
    expect(report.completeness.completenessLabel).toBe('UNKNOWN');
    /* Hiçbir ECU "tarandı" sayılmaz — kısmi tur %100 görünemez. */
    expect(report.completeness.evidence.filter((e) => e.status === 'scanned')).toHaveLength(0);
    /* Bayat oturumdan gelen kodlar YENİ oturuma KARIŞAMAZ. */
    expect(report.allCodes).toEqual([]);
  });

  it('🔒 KİLİT: bayat oturumda gelen GEÇ YANIT kod ÜRETMEZ', async () => {
    const txn = beginTransaction({ purpose: 'multi_ecu_scan' });
    await prepareTransaction(txn);
    vi.mocked(CarLauncher.readDtcFromEcu).mockImplementation(async () => {
      epochRef.value = 99;                    // yanıt dönerken oturum değişti
      return { codes: ['P0301'], supported: true };
    });

    const report = await scanAllEcus(twoEcuTopology(), [], txn);
    /* Eskiden bu kod SESSİZCE listeye giriyordu — başka bir oturumun kodu
       yeni oturumun raporunda görünüyordu. */
    expect(report.allCodes.map((c) => c.code)).not.toContain('P0301');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   E) GERİYE UYUM — mevcut davranış BOZULMADI
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-VDK-F1A · E) geriye uyum', () => {
  it('🔒 KİLİT: işlem GEÇİRİLMEZSE `scanAllEcus` kendi işlemini açar (public imza korunur)', async () => {
    const report = await scanAllEcus(twoEcuTopology());
    expect(report.results).toHaveLength(2);      // eski davranış: 2 ECU tarandı
    expect(report.skippedEcus).toBe(0);
  });

  it('🔒 KİLİT: normal turda hiçbir işlem UNKNOWN’a düşmez (geçiş ihlali YOK)', async () => {
    await runFullVehicleScan();
    const bad = getTransactions().filter((t) => t.state === 'UNKNOWN');
    expect(bad, 'durum geçişi ihlali — fail-closed tetiklendi').toEqual([]);
  });

  it('🔒 KİLİT: varsayılan bütçe MEVCUT taramayı KISALTMAZ', async () => {
    /* Bu tur hiçbir taramayı daraltmaz; yalnız ölçülebilir bir tavan getirir.
       2 ECU × 3 mod + UDS/0A + keşif → varsayılan bütçenin ÇOK altında. */
    const report = await runFullVehicleScan();
    expect(report.skippedEcus).toBe(0);
    const t = getTransactions().find((x) => x.purpose === 'multi_ecu_scan')!;
    expect(t.requestsUsed).toBeLessThan(t.requestBudget);
    expect(t.lastDenial).toBeNull();
  });
});
