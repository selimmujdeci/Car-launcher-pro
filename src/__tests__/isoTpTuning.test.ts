/**
 * isoTpTuning.test.ts — P0-VDK-F1C · ISO-TP TRANSPORT TUNING KİLİTLERİ.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ÖLÇÜLEN TRANSPORT BORCU
 * ══════════════════════════════════════════════════════════════════════════
 * Ürün parser'ı, dedup'ı, otoriteyi ve UI'yi düzeltti — ama **hattın kendisini
 * hiç ayarlamadı**. UDS 0x19-02 yanıtı 20 DTC'de ≈ 83 bayt ≈ **13 ISO-TP
 * çerçevesidir**; ELM327 varsayılan flow control modunda bu akışı kendi
 * seçtiği blok boyutu/STmin ile yönetir ve `BUFFER FULL` ya da kesilmiş yanıt
 * üretebilir. Ürün bunu bugüne kadar ayrımsız `malformed` sanıyordu.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * KAPSAM SINIRLARI (kod kanıtıyla — varsayım DEĞİL)
 * ══════════════════════════════════════════════════════════════════════════
 * · `ATCAF` DOKUNULMAZ — `splitResponseBodies` ELM'in ISO-TP birleştirmesine dayanır
 * · `ATCRA` DOKUNULMAZ — ZATEN `setEcuHeader` yönetiyor + `restoreDefaultHeader` geri alıyor
 * · KWP/ISO9141'de HİÇ çalışmaz — flow control bir CAN kavramıdır
 * · PID polling'e DOKUNULMAZ
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const epochRef = { value: 0 };
const adapterRef = { value: null as unknown };

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
const protocolRef = { value: '6' as string | null };
vi.mock('../platform/obdService', () => ({
  getOBDDataSnapshot: () => ({ connectionState: 'connected', transportConnected: true, dataFresh: true }),
  getObdSessionHealth: () => ({
    transportReady: true, sessionReady: true, pollingActive: true, dataFresh: true, ready: true,
  }),
  getEcuRecoveryLadder: () => ({ inFlight: false, nativeReconnectInFlight: false }),
  getObdSessionEpoch: () => epochRef.value,
  getHandshakeDiagnostics: () => ({ protocolActive: protocolRef.value, protocolTried: null }),
}));
vi.mock('../platform/obd/adapterIdentityService', () => ({
  getAdapterCapabilities: () => adapterRef.value,
}));

import { CarLauncher } from '../platform/nativePlugin';
import { buildTopology } from '../platform/obd/ecuDiscovery';
import { scanAllEcus, _resetIsoTpTunedKeysForTest } from '../platform/obd/multiEcuScan';
import { classifyAdapter } from '../platform/obd/adapterCapability';
import {
  decideIsoTpTuning, classifyTransportOutcome, isMultiFrameExpected,
  isTransportCoverageLoss, summarizeIsoTpTuning, getIsoTpTuningEvidence,
  _resetIsoTpTuningForTest,
  type TuningDecisionInput,
} from '../platform/obd/isoTpTuningPolicy';
import {
  beginTransaction, prepareTransaction, cancelTransaction,
  _resetTransactionsForTest, _setTransactionClockForTest,
} from '../platform/obd/diagnosticTransaction';
import { _resetSchedulerForTest, _setSchedulerClockForTest } from '../platform/obd/diagnosticSessionScheduler';
import { _resetSessionEvidenceForTest } from '../platform/obd/diagnosticSessionEvidence';
import { _resetDtcAuthorityForTest } from '../platform/obd/dtcAuthority';
import { _resetPhysicalProbesForTest } from '../platform/obd/physicalEcuProbe';

const clock = { t: 1_000 };

/** Kanıta dayalı adaptör sınıfları — `classifyAdapter` otoritesinden. */
const STN   = classifyAdapter('STN1170|ELM327 v1.4|STN1170 v4.1');
const REAL  = classifyAdapter('ELM327 v2.1|OBDII to RS232 Interpreter|?');
const CLONE = classifyAdapter('ELM327 v1.5|?|?');
const UNK   = classifyAdapter('|?|?');

function oneEcuTopology() {
  return buildTopology('7E8 06 41 00 BE', 1_700_000_000_000);
}

function decision(over: Partial<TuningDecisionInput> = {}) {
  return decideIsoTpTuning({
    service: '19', subFunction: '02', protocol: '6', adapter: STN,
    slowSerial: false, alreadyTuned: false, bridgeAvailable: true, ...over,
  });
}

beforeEach(() => {
  _resetTransactionsForTest();
  _resetSchedulerForTest();
  _resetSessionEvidenceForTest();
  _resetDtcAuthorityForTest();
  _resetPhysicalProbesForTest();
  _resetIsoTpTuningForTest();
  _resetIsoTpTunedKeysForTest();
  clock.t = 1_000;
  _setTransactionClockForTest(() => clock.t);
  _setSchedulerClockForTest(() => clock.t);
  epochRef.value = 0;
  protocolRef.value = '6';
  adapterRef.value = STN;
  for (const m of ['probeEcus', 'readDtcFromEcu', 'readUdsDtcs', 'readAdvancedDtcs', 'sendTesterPresent'] as const) {
    vi.mocked(CarLauncher[m]!).mockReset();
  }
  vi.mocked(CarLauncher.probeEcus).mockResolvedValue({ raw: '7E8 06 41 00 BE' });
  vi.mocked(CarLauncher.readDtcFromEcu).mockResolvedValue({ codes: [], supported: true });
  vi.mocked(CarLauncher.readUdsDtcs!).mockResolvedValue({ raw: '', supported: false });
  vi.mocked(CarLauncher.readAdvancedDtcs!).mockResolvedValue({
    outcome: 'ok', kind: 'OK', raw: 'FF' + '038011' + '09',
    tuningApplied: true, tuningCommands: 'ATFCSH7E0=OK|ATFCSD300000=OK|ATFCSM1=OK',
    tuningRestored: true, tuningRestoreDetail: 'ATFCSM0=OK',
    byteCount: 5, frameCount: 1,
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   A) KARAR POLİTİKASI (saf)
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-VDK-F1C · A) tuning kararı', () => {
  it('🔒 KİLİT: yetenekli adaptör + CAN + çok-frame → UYGULA', () => {
    expect(decision({ adapter: STN })).toBe('APPLY');
    expect(decision({ adapter: REAL })).toBe('APPLY');
  });

  it('🔒 ANA KİLİT: KLON adaptörde tuning DENENMEZ (komutlar "?" döner)', () => {
    expect(decision({ adapter: CLONE })).toBe('SKIP_ADAPTER_INCAPABLE');
    expect(CLONE.flowControl).toBe(false);   // otorite kanıtı
  });

  it('🔒 ANA KİLİT: adaptör kimliği BİLİNMİYORSA yetenek VARSAYILMAZ', () => {
    expect(decision({ adapter: UNK })).toBe('SKIP_ADAPTER_UNKNOWN');
    expect(decision({ adapter: null })).toBe('SKIP_ADAPTER_UNKNOWN');
  });

  it('🔒 ANA KİLİT: KWP/ISO9141’de CAN flow-control mantığı UYGULANMAZ', () => {
    expect(decision({ slowSerial: true, protocol: '5' })).toBe('SKIP_NOT_CAN');
    expect(decision({ slowSerial: true, protocol: '3' })).toBe('SKIP_NOT_CAN');
  });

  it('🔒 FAIL-CLOSED: protokol ÖLÇÜLEMEDİYSE CAN VARSAYILMAZ', () => {
    expect(decision({ protocol: null })).toBe('SKIP_NOT_CAN');
  });

  it('🔒 KİLİT: yalnız ÇOK-FRAME beklenen alt fonksiyonlarda (02 · 0A)', () => {
    expect(isMultiFrameExpected('19', '02')).toBe(true);
    expect(isMultiFrameExpected('19', '0A')).toBe(true);
    expect(isMultiFrameExpected('19', '01')).toBe(false);   // sayı — kısa
    expect(isMultiFrameExpected('19', '06')).toBe(false);   // tek DTC — kısa
    expect(isMultiFrameExpected('18', '18')).toBe(false);   // KWP
    expect(decision({ subFunction: '01' })).toBe('SKIP_NOT_MULTIFRAME');
  });

  it('🔒 KİLİT: aynı işlemde ÇİFT tuning YOK', () => {
    expect(decision({ alreadyTuned: true })).toBe('SKIP_ALREADY_TUNED');
  });

  it('🔒 KİLİT: köprü yoksa (eski APK) eski davranış korunur', () => {
    expect(decision({ bridgeAvailable: false })).toBe('SKIP_NO_BRIDGE');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   B) TRANSPORT SONUCU — BUFFER FULL ≠ TRUNCATED ≠ MALFORMED
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-VDK-F1C · B) transport sonucu sınıflaması', () => {
  it('🔒 ANA KİLİT: BUFFER FULL kendi sınıfıdır (malformed DEĞİL)', () => {
    expect(classifyTransportOutcome('transport_error', null, 'ELM327 hata yanıtı: BUFFER FULL'))
      .toBe('BUFFER_FULL');
  });

  it('🔒 ANA KİLİT: kayıt sınırına oturmayan gövde TRUNCATED (malformed DEĞİL)', () => {
    /* 1 bayt availability + 4 baytlık kayıtlar. 10 bayt gövde → (10-1)%4 = 1 → kesik. */
    expect(classifyTransportOutcome('ok', 'FF' + 'AABBCCDD' + 'AABBCCDD' + 'AA', null, 4))
      .toBe('TRUNCATED');
  });

  it('tam gövde COMPLETE', () => {
    expect(classifyTransportOutcome('ok', 'FF' + 'AABBCCDD' + '11223344', null, 4))
      .toBe('COMPLETE');
  });

  it('zaman aşımı ve malformed AYRI kalır', () => {
    expect(classifyTransportOutcome('timeout', null, null)).toBe('TIMEOUT');
    expect(classifyTransportOutcome('malformed', 'ZZ', null)).toBe('MALFORMED');
  });

  it('🔒 FAIL-CLOSED: ölçülemeyen sonuç UNKNOWN — asla COMPLETE', () => {
    expect(classifyTransportOutcome('ok', '', null)).toBe('UNKNOWN');
    expect(classifyTransportOutcome('weird', null, null)).toBe('UNKNOWN');
  });

  it('🔒 KİLİT: COMPLETE DIŞINDA her sonuç KAPSAM KAYBIDIR', () => {
    expect(isTransportCoverageLoss('COMPLETE')).toBe(false);
    for (const o of ['BUFFER_FULL', 'TRUNCATED', 'TIMEOUT', 'MALFORMED', 'UNKNOWN'] as const) {
      expect(isTransportCoverageLoss(o), o).toBe(true);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   C) ÜRÜN YOLU — tuning gerçekten uygulanıyor
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-VDK-F1C · C) ürün yolu', () => {
  async function scan() {
    const txn = beginTransaction({ purpose: 'multi_ecu_scan' });
    await prepareTransaction(txn);
    const report = await scanAllEcus(oneEcuTopology(), [], txn);
    return { txn, report };
  }

  it('🔒 PASS KİLİDİ: yetenekli adaptörde 0x19-02 TUNING İLE gider ve restore kanıtı gelir', async () => {
    const { txn } = await scan();

    const calls = vi.mocked(CarLauncher.readAdvancedDtcs!).mock.calls.map((c) => c[0]);
    const c02 = calls.find((c) => c.subFunction === '02')!;
    expect(c02.isoTpTuning, '0x19-02 tuning İSTEMEDİ').toBe(true);

    const ev = getIsoTpTuningEvidence().find((e) => e.subFunction === '02')!;
    expect(ev.decision).toBe('APPLY');
    expect(ev.applied).toBe(true);
    expect(ev.commands).toContain('ATFCSM1=OK');
    expect(ev.restored).toBe(true);
    expect(ev.transportOutcome).toBe('COMPLETE');
    /* F1-A restore YÜKÜMLÜLÜĞÜ kaydedildi (native atomik uygular). */
    expect(txn.restoreObligations.some((o) => o.kind === 'adapter_config')).toBe(true);
  });

  it('🔒 ANA KİLİT: KISA alt fonksiyonlara (0x19-01) tuning GÖNDERİLMEZ', async () => {
    await scan();
    const calls = vi.mocked(CarLauncher.readAdvancedDtcs!).mock.calls.map((c) => c[0]);
    const c01 = calls.find((c) => c.subFunction === '01');
    expect(c01?.isoTpTuning).toBeUndefined();
  });

  it('🔒 ANA KİLİT: KLON adaptörde HİÇBİR isteğe tuning eklenmez (eski davranış)', async () => {
    adapterRef.value = CLONE;
    await scan();
    const calls = vi.mocked(CarLauncher.readAdvancedDtcs!).mock.calls.map((c) => c[0]);
    expect(calls.every((c) => c.isoTpTuning === undefined)).toBe(true);
    const ev = getIsoTpTuningEvidence().find((e) => e.subFunction === '02')!;
    expect(ev.decision).toBe('SKIP_ADAPTER_INCAPABLE');
    expect(ev.applied).toBe(false);
  });

  /**
   * P0-VDK-F6B — BU KİLİT GÜÇLENDİRİLDİ (zayıflatılmadı).
   *
   * ── ESKİ KİLİT NEDEN ARTIK YANLIŞ ──────────────────────────────────────
   * Eski kilit "KWP'de 0x19-02 GÖNDERİLİR ama tuning EKLENMEZ" davranışını
   * doğruluyordu (`decision === 'SKIP_NOT_CAN'` bir kanıt satırı ister; kanıt
   * satırı ancak istek KURULDUYSA yazılır). Oysa reponun KENDİ CDDL sözleşmesi
   * UDS 0x19'u CAN'e bağlar:
   *   `cddl/legacyAdapter.READ_SERVICE_DEFS['19'].protocols = ['can']`
   * Yani K-line'a 0x19 göndermek tanımlı bir istek DEĞİLDİ — yavaş seri hatta
   * ECU başına 5 boş istek (19-01/02/0A/03/06 ≈ 5-20 sn) demekti ve o bütçe
   * tam olarak ISO 14230-3'ün DTC servislerinden (0x18/0x13) çalınıyordu.
   *
   * F6-B kapsam planı bunu VERİDEN türetir (`dtcCoveragePlan`): KWP ailesinde
   * UDS sınıfları `PROTOCOL_MISMATCH` ile SKIP edilir. Sonuç ESKİSİNDEN DAHA
   * GÜÇLÜDÜR: artık "tuning eklenmedi" değil, **0x19 hattan HİÇ ÇIKMIYOR**.
   */
  it('🔒 ANA KİLİT: KWP protokolünde UDS 0x19 HİÇ GÖNDERİLMEZ (dolayısıyla tuning de yok)', async () => {
    protocolRef.value = '5';
    await scan();
    const calls = vi.mocked(CarLauncher.readAdvancedDtcs!).mock.calls.map((c) => c[0]);
    /* Tuning eklenmedi (eski kilidin koruduğu şey — AYNEN korunur)… */
    expect(calls.every((c) => c.isoTpTuning === undefined)).toBe(true);
    /* …ve daha güçlüsü: yavaş seri hatta 0x19 alt fonksiyonlarından
       TEK BİR İSTEK bile kurulmadı. */
    expect(calls.filter((c) => c.service === '19')).toHaveLength(0);
    /* Gönderilmeyen bir istek için tuning KANITI da ÜRETİLMEZ — hiç kurulmamış
       bir isteğin "atlandı" kaydı, olmayan bir olayın kanıtı olurdu. */
    expect(getIsoTpTuningEvidence().filter((e) => e.service === '19')).toHaveLength(0);
  });

  it('🔒 KİLİT: aynı işlemde ikinci alt fonksiyon ÇİFT tuning ETMEZ', async () => {
    await scan();
    const ev0A = getIsoTpTuningEvidence().find((e) => e.subFunction === '0A');
    /* 0x19-02 tuning etti → 0x19-0A aynı ECU'da ZATEN tuned. */
    expect(ev0A?.decision).toBe('SKIP_ALREADY_TUNED');
  });

  it('🔒 ANA KİLİT: PID POLLING ETKİLENMEZ — standart mod isteklerinde tuning alanı YOK', async () => {
    await scan();
    const std = vi.mocked(CarLauncher.readDtcFromEcu).mock.calls.map((c) => c[0]);
    expect(std.length).toBeGreaterThan(0);
    expect(std.every((c) => !('isoTpTuning' in c))).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   D) FAIL-SOFT + RESTORE GÖRÜNÜRLÜĞÜ
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-VDK-F1C · D) fail-soft ve restore', () => {
  async function scan() {
    const txn = beginTransaction({ purpose: 'multi_ecu_scan' });
    await prepareTransaction(txn);
    return { txn, report: await scanAllEcus(oneEcuTopology(), [], txn) };
  }

  it('🔒 ANA KİLİT: adaptör komutu REDDEDERSE okuma yine ÇALIŞIR (fail-soft)', async () => {
    vi.mocked(CarLauncher.readAdvancedDtcs!).mockResolvedValue({
      outcome: 'ok', kind: 'OK', raw: 'FF' + '038011' + '09',
      tuningApplied: false,                       // klon "?" dedi
      tuningCommands: 'ATFCSH7E0=OK|ATFCSD300000=OK|ATFCSM1=?',
      tuningRestored: true, tuningRestoreDetail: 'ATFCSM0=OK',
      byteCount: 5, frameCount: 1,
    });
    const { report } = await scan();

    /* Kod OKUNDU — tuning başarısızlığı okumayı ENGELLEMEDİ. */
    expect(report.allCodes.map((c) => c.code)).toContain('P0380');
    const ev = getIsoTpTuningEvidence().find((e) => e.subFunction === '02')!;
    expect(ev.applied).toBe(false);
    expect(ev.commands).toContain('ATFCSM1=?');   // red kanıtı KAYBOLMADI
  });

  it('🔒 ANA KİLİT: RESTORE BAŞARISIZLIĞI GÖRÜNÜR (sessizce geçilmez)', async () => {
    vi.mocked(CarLauncher.readAdvancedDtcs!).mockResolvedValue({
      outcome: 'ok', kind: 'OK', raw: 'FF' + '038011' + '09',
      tuningApplied: true, tuningCommands: 'ATFCSM1=OK',
      tuningRestored: false, tuningRestoreDetail: 'ATFCSM0=?',
      byteCount: 5, frameCount: 1,
    });
    await scan();

    const ev = getIsoTpTuningEvidence().find((e) => e.subFunction === '02')!;
    expect(ev.restored).toBe(false);
    expect(ev.restoreDetail).toContain('ATFCSM0=?');
    /* Özet: restore düşüşü 0 DIŞINDA her değer bir KUSURDUR. */
    expect(summarizeIsoTpTuning(getIsoTpTuningEvidence()).restoreFailures).toBe(1);
  });

  it('🔒 ANA KİLİT: tuning BAŞARISIZLIĞI sahte "temiz" sonuç ÜRETMEZ', async () => {
    vi.mocked(CarLauncher.readAdvancedDtcs!).mockResolvedValue({
      outcome: 'transport_error', kind: 'ERROR', raw: '',
      error: 'ELM327 hata yanıtı (UDS DTC): BUFFER FULL',
      tuningApplied: true, tuningRestored: true,
    });
    const { report } = await scan();

    const engine = report.results[0]!;
    /* Okuma DÜŞTÜ → `uds` 'ok' OLAMAZ ve kod listesi "temiz" DEMEZ. */
    expect(engine.uds).not.toBe('ok');
    expect(report.allCodes).toEqual([]);
    const ev = getIsoTpTuningEvidence().find((e) => e.subFunction === '02')!;
    expect(ev.transportOutcome).toBe('BUFFER_FULL');
    expect(isTransportCoverageLoss(ev.transportOutcome)).toBe(true);
  });

  it('🔒 KİLİT: İPTAL sonrası istek GİTMEZ → tuning de gitmez (restore gereksiz)', async () => {
    const txn = beginTransaction({ purpose: 'multi_ecu_scan' });
    await prepareTransaction(txn);
    cancelTransaction(txn, 'kullanıcı çıktı');
    await scanAllEcus(oneEcuTopology(), [], txn);

    expect(CarLauncher.readAdvancedDtcs).not.toHaveBeenCalled();
    expect(getIsoTpTuningEvidence()).toHaveLength(0);
  });

  it('🔒 KİLİT: BAYAT OTURUM sonrası istek GİTMEZ → tuning de gitmez', async () => {
    const txn = beginTransaction({ purpose: 'multi_ecu_scan' });
    await prepareTransaction(txn);
    epochRef.value = 42;
    await scanAllEcus(oneEcuTopology(), [], txn);

    expect(CarLauncher.readAdvancedDtcs).not.toHaveBeenCalled();
  });

  it('özet: en sık atlama nedeni teşhis için raporlanır', async () => {
    adapterRef.value = CLONE;
    const txn = beginTransaction({ purpose: 'multi_ecu_scan' });
    await prepareTransaction(txn);
    await scanAllEcus(oneEcuTopology(), [], txn);
    const s = summarizeIsoTpTuning(getIsoTpTuningEvidence());
    expect(s.applied).toBe(0);
    expect(s.skipped).toBeGreaterThan(0);
    expect(s.topSkipReason).toBe('SKIP_ADAPTER_INCAPABLE');
  });
});
