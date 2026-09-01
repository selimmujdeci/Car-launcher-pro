/**
 * P0-OBD-FINAL-02 · KWP OTURUM PROBUNUN TARAMAYA BAĞLANMASI — KİLİTLER
 *
 * ── SAHA (2026-08-25 · gerçek araç · Protocol 5 / KWP) ─────────────────────
 * ECU 7A · rx `86F17A` · tx `817AF1` · 8-bit · rol UNKNOWN.
 * Mode 03/07: 3 OK (fonksiyonel) + 3 "ECU SUSTU" (fiziksel `817AF1`).
 * 0x18 GÖNDERİLMEDİ çünkü fiziksel adreslenebilirlik kanıtlanmamıştı.
 *
 * BU DOSYA O KAPIYI KİLİTLER. Oturum probu YALNIZ KANIT toplar:
 *  · POZİTİF kanıt YOKSA 0x18 zinciri AÇILMAZ (fail-closed) — kilit #1.
 *  · POZİTİF kanıt VARSA adres kanıtlanmış olur ve 0x18 açılabilir — kilit #2.
 *  · CAN hattında prob HİÇ koşmaz (anlamsız trafik) — kilit #3.
 *  · Adres zaten kanıtlıysa FAZLADAN KOMUT gönderilmez — kilit #4.
 *  · Prob sonucu ECU ROLÜNÜ değiştirmez (adresten anlam çıkarma YASAK) — #5.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: vi.fn(() => true) },
}));
vi.mock('../platform/nativePlugin', () => ({
  CarLauncher: {
    probeEcus:         vi.fn(),
    readDtcFromEcu:    vi.fn(),
    readUdsDtcs:       vi.fn(),
    readAdvancedDtcs:  vi.fn(),
    probeKwpSession:   vi.fn(),
  },
}));
/* Admisyon kapısı "hazır" sabitlenir; protokol AKTİF olarak KWP ('5') okunur —
   bu dosyanın tüm meselesi yavaş seri hattır (ikinci sahte otorite KURULMAZ). */
vi.mock('../platform/obdService', () => ({
  getOBDDataSnapshot: () => ({ connectionState: 'connected', transportConnected: true, dataFresh: true }),
  getObdSessionHealth: () => ({
    transportReady: true, sessionReady: true, pollingActive: true, dataFresh: true, ready: true,
  }),
  getEcuRecoveryLadder: () => ({ inFlight: false, nativeReconnectInFlight: false }),
  getObdSessionEpoch: () => 0,
  getHandshakeDiagnostics: () => ({ protocolActive: _protocol, protocolTried: _protocol }),
}));

/** Testlerin aktif protokolü — mock fabrikası bunu okur (hoisting güvenli). */
let _protocol: string | null = '5';

import { CarLauncher } from '../platform/nativePlugin';
import { buildTopology } from '../platform/obd/ecuDiscovery';
import { scanAllEcus } from '../platform/obd/multiEcuScan';
import {
  getKwpSessionProbes, summarizeKwpSession, _resetKwpSessionProbesForTest,
} from '../platform/obd/kwpSessionProbe';
import { getEcuObservations, _resetEcuObservationsForTest } from '../platform/obd/ecuAddressability';

/** SAHA KWP topolojisi: tek ECU, rx `86F17A` → tx `817AF1`. */
const KWP_RAW = ['86 F1 7A 41 00 BE 3E B8 11', '>'].join('\r');
const CAN_RAW = '7E8 06 41 00 BE 3F A8 13';

const TX = '817AF1';

/** Fiziksel istek SUSAN ECU — sahada ölçülen davranış. */
const SILENT = { codes: [], supported: true, raw: '', outcome: 'NO_RESPONSE' };

beforeEach(() => {
  _protocol = '5';
  _resetKwpSessionProbesForTest();
  _resetEcuObservationsForTest();
  vi.mocked(CarLauncher.readDtcFromEcu).mockReset();
  vi.mocked(CarLauncher.readUdsDtcs!).mockReset();
  vi.mocked(CarLauncher.readUdsDtcs!).mockResolvedValue({ raw: '', supported: false });
  vi.mocked(CarLauncher.readAdvancedDtcs!).mockReset();
  vi.mocked(CarLauncher.readAdvancedDtcs!).mockResolvedValue({
    raw: '', kind: 'NOT_SENT', outcome: 'not_addressable',
  });
  vi.mocked(CarLauncher.probeKwpSession!).mockReset();
});

function kwpTopology() { return buildTopology(KWP_RAW, 1_700_000_000_000, '5'); }

/** Bu turda 0x18 GERÇEKTEN köprüye verildi mi. */
function sent18(): boolean {
  return vi.mocked(CarLauncher.readAdvancedDtcs!).mock.calls
    .some((c) => c[0].service === '18' && c[0].targetVerified === true);
}

describe('P0-OBD-FINAL-02 › fail-closed: pozitif oturum kanıtı YOKSA 0x18 AÇILMAZ', () => {
  it('🔒 KİLİT: SAHA SENARYOSU — fiziksel Mode 03 sustu, oturum probu da sustu → 0x18 YOK', async () => {
    vi.mocked(CarLauncher.readDtcFromEcu).mockResolvedValue(SILENT);
    vi.mocked(CarLauncher.probeKwpSession!).mockResolvedValue({
      request: '10C0', raw: '', outcome: 'no_response',
    });

    const report = await scanAllEcus(kwpTopology());

    // Prob KOŞTU (kanıt toplandı) …
    expect(vi.mocked(CarLauncher.probeKwpSession!)).toHaveBeenCalledWith({ tx: TX, rx: '86F17A' });
    expect(summarizeKwpSession(getKwpSessionProbes(), TX, 0).proven).toBe(false);
    // … ama HİÇBİR ŞEY AÇILMADI.
    expect(sent18()).toBe(false);
    expect(report.results[0]!.kwpDiagnosticOutcome).toBe('not_addressable');
    expect(report.completeness.notAddressable).toBe(1);
  });

  it('🔒 KİLİT: ECU oturumu REDDETTİ (7F 10 11) → adres canlı ama 0x18 YİNE AÇILMAZ', async () => {
    vi.mocked(CarLauncher.readDtcFromEcu).mockResolvedValue(SILENT);
    vi.mocked(CarLauncher.probeKwpSession!).mockResolvedValue({
      request: '1081', raw: '7F 10 11', outcome: 'negative_nrc', nrc: 0x11,
    });

    await scanAllEcus(kwpTopology());

    const v = summarizeKwpSession(getKwpSessionProbes(), TX, 0);
    expect(v.result).toBe('NEGATIVE');
    expect(v.proven).toBe(false);
    expect(sent18()).toBe(false);
  });

  it('🔒 KİLİT: native "ok" dedi ama ham yanıt BOŞ → kanıt SAYILMAZ, 0x18 AÇILMAZ', async () => {
    vi.mocked(CarLauncher.readDtcFromEcu).mockResolvedValue(SILENT);
    vi.mocked(CarLauncher.probeKwpSession!).mockResolvedValue({
      request: '1081', raw: '', outcome: 'ok',
    });

    await scanAllEcus(kwpTopology());

    expect(summarizeKwpSession(getKwpSessionProbes(), TX, 0).result).toBe('MALFORMED');
    expect(sent18()).toBe(false);
  });

  it('🔒 KİLİT: prob köprüsü PATLASA BİLE tarama düşmez ve 0x18 AÇILMAZ (fail-soft + fail-closed)', async () => {
    vi.mocked(CarLauncher.readDtcFromEcu).mockResolvedValue(SILENT);
    vi.mocked(CarLauncher.probeKwpSession!).mockRejectedValue(new Error('soket düştü'));

    const report = await scanAllEcus(kwpTopology());

    expect(report.results).toHaveLength(1);
    expect(summarizeKwpSession(getKwpSessionProbes(), TX, 0).result).toBe('TRANSPORT_ERROR');
    expect(sent18()).toBe(false);
  });

  it('köprü YOKSA (eski APK) prob hiç denenmez ve davranış AYNEN korunur', async () => {
    const saved = CarLauncher.probeKwpSession;
    try {
      (CarLauncher as { probeKwpSession?: unknown }).probeKwpSession = undefined;
      vi.mocked(CarLauncher.readDtcFromEcu).mockResolvedValue(SILENT);

      await scanAllEcus(kwpTopology());

      expect(summarizeKwpSession(getKwpSessionProbes(), TX, 0).result).toBe('NOT_ATTEMPTED');
      expect(sent18()).toBe(false);
    } finally {
      (CarLauncher as { probeKwpSession?: unknown }).probeKwpSession = saved;
    }
  });
});

describe('P0-OBD-FINAL-02 › pozitif kanıt adresi AÇAR', () => {
  it('🔒 KİLİT: 10 81 → 50 81 ölçüldü → adres KANITLANDI ve 0x18 gönderilir', async () => {
    vi.mocked(CarLauncher.readDtcFromEcu).mockResolvedValue(SILENT);
    vi.mocked(CarLauncher.probeKwpSession!).mockResolvedValue({
      request: '1081', raw: '50 81 EF 8F', outcome: 'ok',
    });
    vi.mocked(CarLauncher.readAdvancedDtcs!).mockResolvedValue({
      raw: '00', kind: 'OK', outcome: 'ok',
    });

    const report = await scanAllEcus(kwpTopology());

    expect(summarizeKwpSession(getKwpSessionProbes(), TX, 0).proven).toBe(true);
    expect(sent18()).toBe(true);
    // Adres artık ULAŞILAMAZ sayılmaz — kapsam kanıtı da düzelir.
    expect(report.completeness.notAddressable).toBe(0);
    const obs = getEcuObservations().find((o) => o.txHeader === TX);
    expect(obs?.addressability).toBe('PROVEN');
  });

  it('🔒 KİLİT: pozitif kanıt ECU ROLÜNÜ değiştirmez (adresten anlam çıkarma YASAK)', async () => {
    vi.mocked(CarLauncher.readDtcFromEcu).mockResolvedValue(SILENT);
    vi.mocked(CarLauncher.probeKwpSession!).mockResolvedValue({
      request: '1081', raw: '5081', outcome: 'ok',
    });

    await scanAllEcus(kwpTopology());

    const obs = getEcuObservations().find((o) => o.txHeader === TX);
    expect(obs?.role).toBe('unknown');
    expect(obs?.roleEvidence).toBe('none');
  });

  it('oturum denemesi ECU kanıt defterine SERVİS 0x10 olarak yazılır (gözlemlenebilirlik)', async () => {
    vi.mocked(CarLauncher.readDtcFromEcu).mockResolvedValue(SILENT);
    vi.mocked(CarLauncher.probeKwpSession!).mockResolvedValue({
      request: '1081', raw: '5081', outcome: 'ok',
    });

    await scanAllEcus(kwpTopology());

    const obs = getEcuObservations().find((o) => o.txHeader === TX);
    const s10 = obs?.attempts.find((a) => a.service === '10');
    expect(s10).toBeDefined();
    expect(s10!.subFunction).toBe('81');
    expect(s10!.outcome).toBe('POSITIVE');
  });
});

describe('P0-OBD-FINAL-02 › prob KAPSAMI dar tutulur (gereksiz trafik yasak)', () => {
  it('🔒 KİLİT: CAN hattında (protokol 6) oturum probu HİÇ koşmaz', async () => {
    _protocol = '6';
    vi.mocked(CarLauncher.readDtcFromEcu).mockResolvedValue(SILENT);

    await scanAllEcus(buildTopology(CAN_RAW, 1_700_000_000_000, '6'));

    expect(vi.mocked(CarLauncher.probeKwpSession!)).not.toHaveBeenCalled();
  });

  it('🔒 KİLİT: fiziksel Mode 03 adresi ZATEN kanıtladıysa fazladan komut GÖNDERİLMEZ', async () => {
    vi.mocked(CarLauncher.readDtcFromEcu).mockResolvedValue({
      codes: [], supported: true, raw: '43 00', outcome: 'OK',
    });

    await scanAllEcus(kwpTopology());

    expect(vi.mocked(CarLauncher.probeKwpSession!)).not.toHaveBeenCalled();
  });
});
