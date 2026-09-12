/**
 * P0-OBD-FINAL-01 · ÖNCELİK 3 — OTURUM-GÜVENLİ TANI + ÖLÇÜLEN SONUÇ.
 *
 * ── KAPATILAN İKİ SESSİZ YALAN ────────────────────────────────────────────
 * ① Admisyon kapısı tarama BAŞINDA bir kez soruluyordu. Tam araç taraması
 *    ECU × 3-5 servis sürer; ortasında session/recovery/reconnect DEĞİŞİRSE
 *    okumalar boş döner ve rapor "0 kod" der. "0 kod" ekranda "temiz" olur.
 *    Artık her ECU'dan ÖNCE kapı sorulur; kapalıysa sonuç `deferred`'dır ve
 *    kapsamda "tarandı" SAYILMAZ.
 * ② `readDtcFromEcu` yalnız `codes`+`supported` döndürüyordu: "43 00" (POZİTİF,
 *    0 kod) ile "NO DATA" (ECU SUSTU) AYNI görünüyordu. Native artık ölçülen
 *    sonucu ve HAM yanıtı taşır; sessizlik ASLA `ok` sayılmaz.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: vi.fn(() => true) },
}));
vi.mock('../platform/nativePlugin', () => ({
  CarLauncher: {
    probeEcus:      vi.fn(),
    readDtcFromEcu: vi.fn(),
    readUdsDtcs:    vi.fn(),
  },
}));

/**
 * Oturum mührü test tarafından SÜRÜLÜR — tarama ortasında değişebilsin.
 *
 * ── P0-VDK-F1A: TETİK ÇAĞRI SAYISINDAN DAVRANIŞA TAŞINDI ──────────────────
 * Eskiden `getObdSessionEpoch()` çağrı SIRASINA göre değer döndürüyordu
 * (`[0, 0, 9, 9]`). Bu, testi ÜRÜN KODUNUN kaç kez epoch okuduğuna
 * bağımlı kılıyordu; kanonik tanı işlemi (oturum mühürleme + canlılık
 * kontrolü) devreye girince sıra kaydı ve test, kilitlediği DAVRANIŞ hiç
 * bozulmadığı hâlde kırıldı.
 *
 * Kilit KALDIRILMADI — tetiği ÜRÜN DAVRANIŞINA bağlandı: "ECU#1'in okumaları
 * bittikten sonra oturum değişir". Kilidin iddiası AYNEN korunur ve artık
 * refactor'a dayanıklıdır.
 */
const epochNow = { value: 0 };
/** Kaç DTC okumasından SONRA oturum değişsin (0 = hiç). */
const epochFlipAfterDtcReads = { value: 0 };
function nextEpoch(): number { return epochNow.value; }
/** Ürünün yaptığı gerçek DTC okuması sayısı — tetik bundan türer. */
const dtcReadCount = { value: 0 };

vi.mock('../platform/obdService', () => ({
  getOBDDataSnapshot: () => ({ connectionState: 'connected', transportConnected: true, dataFresh: true }),
  getObdSessionHealth: () => ({
    transportReady: true, sessionReady: true, pollingActive: true, dataFresh: true, ready: true,
  }),
  getEcuRecoveryLadder: () => ({ inFlight: false, nativeReconnectInFlight: false }),
  getObdSessionEpoch: () => nextEpoch(),
  getHandshakeDiagnostics: () => ({ protocolActive: null, protocolTried: null }),
}));

import { CarLauncher } from '../platform/nativePlugin';
import { buildTopology } from '../platform/obd/ecuDiscovery';
import { scanAllEcus } from '../platform/obd/multiEcuScan';
import { getDtcEvidence, _resetDtcEvidenceForTest } from '../platform/obd/dtcScanEvidence';
import { getEcuObservations, _resetEcuObservationsForTest } from '../platform/obd/ecuAddressability';

function twoEcuTopology() {
  return buildTopology('7E8 06 41 00 BE\r\n7E9 06 41 00 80', 1_700_000_000_000);
}

beforeEach(() => {
  epochNow.value = 0;
  epochFlipAfterDtcReads.value = 0;
  dtcReadCount.value = 0;
  _resetDtcEvidenceForTest();
  _resetEcuObservationsForTest();
  vi.mocked(CarLauncher.readDtcFromEcu).mockReset();
  vi.mocked(CarLauncher.readUdsDtcs!).mockReset();
  vi.mocked(CarLauncher.readUdsDtcs!).mockResolvedValue({ raw: '', supported: false });
});

describe('P0-OBD-FINAL-01 · oturum-güvenli tarama', () => {
  it('🔒 KİLİT: tarama ORTASINDA oturum değişirse kalan ECU "0 kod/temiz" OLMAZ', async () => {
    /* ECU#1 üç modunu (03/07/0A) okur; SONRA oturum değişir → ECU#2 ertelenir. */
    epochFlipAfterDtcReads.value = 3;
    vi.mocked(CarLauncher.readDtcFromEcu).mockImplementation(async () => {
      dtcReadCount.value++;
      if (dtcReadCount.value >= epochFlipAfterDtcReads.value) epochNow.value = 9;
      return { codes: [], supported: true, raw: '43 00 00 00 00 00 00', outcome: 'OK' };
    });

    const report = await scanAllEcus(twoEcuTopology());

    const first  = report.results[0];
    const second = report.results[1];
    expect(first.stored).toBe('ok');            // oturum aynıyken okundu
    expect(second.stored).toBe('deferred');     // oturum DEĞİŞTİ → ertelendi
    expect(second.uds).toBeNull();
    /* Ertelenen ECU'ya HİÇ istek gitmemeli (2. ECU için çağrı yok). */
    const calls = vi.mocked(CarLauncher.readDtcFromEcu).mock.calls.map((c) => c[0]);
    expect(calls.filter((c) => c.tx === '7E1')).toHaveLength(0);
  });

  it('ertelenen ECU KAPSAMDA "tarandı" sayılmaz — kısmi tur %100 görünmez', async () => {
    epochFlipAfterDtcReads.value = 3;
    vi.mocked(CarLauncher.readDtcFromEcu).mockImplementation(async () => {
      dtcReadCount.value++;
      if (dtcReadCount.value >= epochFlipAfterDtcReads.value) epochNow.value = 9;
      return { codes: [], supported: true, raw: '43 00', outcome: 'OK' };
    });

    const report = await scanAllEcus(twoEcuTopology());
    /* Tur, başladığı oturumda BİTMEDİ → kapsam kanıtı BAYAT ilan edilir ve
       HİÇBİR ECU "tarandı" sayılmaz. Bu, ilk ECU'nun okumasını da kapsayan
       BİLİNÇLİ fail-closed karardır: aynı raporun bir kısmı bir oturuma,
       kalanı başkasına ait olamaz. */
    expect(report.completeness.staleSession).toBe(true);
    expect(report.completeness.evidence.filter((e) => e.status === 'scanned')).toHaveLength(0);
    expect(report.completeness.discovered).toBe(2);
    expect(report.completeness.completenessLabel).toBe('UNKNOWN');
  });

  it('erteleme GEREKÇESİYLE deftere yazılır — sessizce kaybolmaz', async () => {
    epochFlipAfterDtcReads.value = 3;
    vi.mocked(CarLauncher.readDtcFromEcu).mockImplementation(async () => {
      dtcReadCount.value++;
      if (dtcReadCount.value >= epochFlipAfterDtcReads.value) epochNow.value = 9;
      return { codes: [], supported: true, raw: '43 00', outcome: 'OK' };
    });

    await scanAllEcus(twoEcuTopology());
    const deferred = getDtcEvidence().filter((e) => (e.error ?? '').includes('ERTELENDİ'));
    expect(deferred.length).toBeGreaterThan(0);
    const obs = getEcuObservations().find((o) => o.rxHeader === '7E9');
    expect(obs?.addressability).toBe('NOT_ATTEMPTED');
    expect(obs?.admission).toContain('oturum DEĞİŞTİ');
  });
});

describe('P0-OBD-FINAL-01 · ölçülen sonuç ve ham yanıt', () => {
  it('🔒 KİLİT: "NO DATA" (ECU SUSTU) ASLA `ok` sayılmaz', async () => {
    vi.mocked(CarLauncher.readDtcFromEcu).mockResolvedValue({
      codes: [], supported: true, raw: 'NO DATA', outcome: 'NO_RESPONSE',
    });

    const report = await scanAllEcus(twoEcuTopology());
    expect(report.results[0].stored).not.toBe('ok');
    expect(report.failedReads).toBeGreaterThan(0);
    const ev = getDtcEvidence().find((e) => e.service === '03' && e.ecuTxHeader === '7E0');
    expect(ev?.outcome).toBe('no_response');
  });

  it('HAM yanıt deftere taşınır (çözümleyici hatası artık görünür)', async () => {
    vi.mocked(CarLauncher.readDtcFromEcu).mockResolvedValue({
      codes: ['P0089'], supported: true, raw: '47 01 00 89', outcome: 'OK',
      elapsedMs: 412, protocol: '5', recoveryCount: 0,
    });

    await scanAllEcus(twoEcuTopology());
    const ev = getDtcEvidence().find((e) => e.service === '07' && e.ecuTxHeader === '7E0');
    expect(ev?.raw).toBe('47 01 00 89');
    expect(ev?.elapsedMs).toBe(412);
    expect(ev?.protocol).toBe('5');
  });

  it('ESKİ APK (outcome/raw taşımayan köprü) mevcut sözleşmede kalır — regresyon yok', async () => {
    vi.mocked(CarLauncher.readDtcFromEcu).mockResolvedValue({ codes: [], supported: true });

    const report = await scanAllEcus(twoEcuTopology());
    expect(report.results[0].stored).toBe('ok');
    const obs = getEcuObservations().find((o) => o.rxHeader === '7E8');
    /* Ölçemediğimiz şeyi "kanıtlandı" SAYMAYIZ. */
    expect(obs?.addressability).toBe('UNKNOWN');
  });

  it('cevap veren ECU adreslenebilir SAYILIR; susan ECU sayılmaz', async () => {
    vi.mocked(CarLauncher.readDtcFromEcu).mockImplementation(async ({ tx }) =>
      tx === '7E0'
        ? { codes: [], supported: true, raw: '43 00', outcome: 'OK' }
        : { codes: [], supported: true, raw: '', outcome: 'NO_RESPONSE' });

    const report = await scanAllEcus(twoEcuTopology());
    const obs = getEcuObservations();
    expect(obs.find((o) => o.rxHeader === '7E8')?.addressability).toBe('PROVEN');
    expect(obs.find((o) => o.rxHeader === '7E9')?.addressability).toBe('NOT_ADDRESSABLE');
    const na = report.completeness.evidence.filter((e) => e.status === 'not_addressable');
    expect(na).toHaveLength(1);
  });
});
