/**
 * dtcEcuReachabilityContradiction.test — DTC ekranında ÇELİŞKİLİ ECU hükmü (saha bulgusu).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── ÖLÇÜLEN ÇELİŞKİ ────────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Aynı ekranda AYNI ECU için iki farklı hüküm görülüyordu:
 *   satır   : "ECU 10 (29-bit) — ECU erişilebilir · tarama kısmi"
 *   özet    : "1 ECU ULAŞILAMADI" + "fiziksel tamlık UNKNOWN"
 *
 * Kök neden: `multiEcuScan.scanAllEcus` içindeki `notAddressableKeys`, YALNIZ
 * DAR bir fiziksel probun (standart Mode 03/07/0A + KWP oturum/adresleme)
 * sonucuna bakıyordu — satırın ZATEN kullandığı TEK otorite (`isEcuReachable`
 * — fonksiyonel `probeOutcome==='responded'` veya herhangi bir DTC alt-
 * servisinin 'ok'/'unsupported' dönmesi) üst özete HİÇ TAŞINMIYORDU. Bir ECU
 * ALL Mode 03/07/0A'da sessiz kalsa bile FONKSİYONEL keşifle zaten kanıtlıysa
 * (`ecu.probeOutcome==='responded'`), satır onu "erişilebilir" sayarken özet
 * onu "ULAŞILAMADI" sayıyordu — aynı kanıt zincirinden iki çelişkili hüküm.
 *
 * Bu dosya İKİ OTORİTEYİ tek bir gerçek uçtan uca akışla (scanAllEcus →
 * ecuCompleteness → scanReport) kilitler: `isEcuReachable`/
 * `classifyEcuCoverageStatus` (satır) ile `completeness.notAddressable`/
 * `evaluateEcuCoverage` (özet) artık AYNI karara varır — yeni bir reachability
 * hesabı YAZILMADI, mevcut otorite üst özet katmanına TAŞINDI.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const epochRef = { value: 0 };
const protocolRef = { value: '7' as string | null }; // CAN 29-bit/500k — bug raporundaki adresleme

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: vi.fn(() => true) },
}));
vi.mock('../platform/nativePlugin', () => ({
  CarLauncher: {
    probeEcus:         vi.fn(),
    readDtcFromEcu:    vi.fn(),
    readUdsDtcs:       vi.fn(),
    readAdvancedDtcs:  vi.fn(),
    readKwpDtcs:       vi.fn(),
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
  getHandshakeDiagnostics: () => ({ protocolActive: protocolRef.value, protocolTried: null }),
}));

import { CarLauncher } from '../platform/nativePlugin';
import type { DiscoveredEcu } from '../platform/obd/ecuDiscovery';
import {
  scanAllEcus, isEcuReachable, isEcuDtcScanPartial, classifyEcuCoverageStatus,
  _resetIsoTpTunedKeysForTest,
} from '../platform/obd/multiEcuScan';
import { evaluateEcuCoverage } from '../platform/obd/scanReport';
import {
  _resetTransactionsForTest, _setTransactionClockForTest,
} from '../platform/obd/diagnosticTransaction';
import { _resetDtcAuthorityForTest } from '../platform/obd/dtcAuthority';
import { _resetAdvancedDtcEvidenceForTest } from '../platform/obd/advancedDtcEvidence';
import { _resetPhysicalProbesForTest } from '../platform/obd/physicalEcuProbe';
import { _resetSchedulerForTest, _setSchedulerClockForTest } from '../platform/obd/diagnosticSessionScheduler';
import { _resetSessionEvidenceForTest } from '../platform/obd/diagnosticSessionEvidence';
import { _resetDtcPipelineForTest } from '../platform/obd/dtcPipelineAccounting';
import { _resetDtcCoverageEvidenceForTest } from '../platform/obd/dtcCoverageEvidence';

const clock = { t: 1_000 };

/** Bug raporundaki "ECU 10 (29-bit)" — fonksiyonel 0100 ile bulunmuş genişletilmiş adresli ECU. */
function ecu29bit(over: Partial<DiscoveredEcu> = {}): DiscoveredEcu {
  return {
    rxHeader: '18DAF10A', txHeader: '18DA0AF1', addressBits: 29,
    role: 'unknown', roleEvidence: 'none', label: 'ECU 10',
    discoverySource: 'functional_0100', probeOutcome: 'responded',
    txProvenance: 'can_29bit_standard',
    ...over,
  };
}

function topologyOf(ecu: DiscoveredEcu) {
  return { ecus: [ecu], probedAt: 1_700_000_000_000, probeEmpty: false };
}

/** UDS/KWP-advanced yollarını SESSİZ tutar — bu testler yalnız standart modları (03/07/0A) sürer. */
function quietAdvancedAndUds(): void {
  vi.mocked(CarLauncher.readAdvancedDtcs!).mockResolvedValue(
    { raw: '', outcome: 'no_response', nrc: null } as never);
  vi.mocked(CarLauncher.readUdsDtcs!).mockResolvedValue({ raw: '', supported: false } as never);
}

beforeEach(() => {
  clock.t = 1_000;
  epochRef.value = 0;
  protocolRef.value = '7';
  vi.clearAllMocks();
  _setTransactionClockForTest(() => clock.t);
  _setSchedulerClockForTest(() => clock.t);
  _resetTransactionsForTest();
  _resetSchedulerForTest();
  _resetSessionEvidenceForTest();
  _resetDtcAuthorityForTest();
  _resetAdvancedDtcEvidenceForTest();
  _resetDtcCoverageEvidenceForTest();
  _resetPhysicalProbesForTest();
  _resetDtcPipelineForTest();
  _resetIsoTpTunedKeysForTest();
  quietAdvancedAndUds();
});

/* ══════════════════════════════════════════════════════════════════════════
 * 1) ÇELİŞKİNİN TAM TEKRARI — fonksiyonel kanıt VAR, standart modlar SESSİZ
 * ════════════════════════════════════════════════════════════════════════ */

describe('bug tekrarı — functional kanıtlı ECU, standart DTC modları sessiz', () => {
  it('eski çelişki: satır "erişilebilir" derken özet "ULAŞILAMADI" DEMEZ', async () => {
    /* Mode 03/07/0A'nın ÜÇÜ de NO_RESPONSE → dar fiziksel prob NOT_ADDRESSABLE
       üretir. Tek reachability kanıtı `ecu.probeOutcome==='responded'`dır. */
    vi.mocked(CarLauncher.readDtcFromEcu).mockResolvedValue(
      { codes: [], supported: true, raw: '', outcome: 'NO_RESPONSE' } as never);

    const report = await scanAllEcus(topologyOf(ecu29bit()));
    const r = report.results[0]!;

    // Satır otoritesi: fonksiyonel kanıtla ECU erişilebilir SAYILIR.
    expect(isEcuReachable(r)).toBe(true);
    expect(classifyEcuCoverageStatus(r)).not.toBe('failed');
    // Standart modların hepsi sessiz kaldığı için tarama KISMİDİR.
    expect(isEcuDtcScanPartial(r)).toBe(true);

    // Özet otoritesi ARTIK AYNI hükme varır: 0 ULAŞILAMADI.
    expect(report.completeness.notAddressable).toBe(0);

    const { gaps } = evaluateEcuCoverage({
      discoveryRan: true, discovered: 1, scanned: report.completeness.scanned,
      failed: report.completeness.failed, skipped: report.completeness.skipped,
      notAddressable: report.completeness.notAddressable,
      staleSession: false, denominatorKnown: true,
    });
    expect(gaps.join(' | ')).not.toMatch(/ULAŞILAMADI/);
  });

  it('birden çok ECU: yalnız GERÇEKTEN erişilemeyen sayılır, erişilebilir olan DIŞARIDA kalır', async () => {
    const reachableButSilent = ecu29bit({ label: 'ECU 10', txHeader: '18DA0AF1', rxHeader: '18DAF10A' });
    const trulyUnreachable = ecu29bit({
      label: 'ECU 20', txHeader: '18DA14F1', rxHeader: '18DAF114',
      probeOutcome: 'no_response', discoverySource: 'physical_probe',
    });
    vi.mocked(CarLauncher.readDtcFromEcu).mockResolvedValue(
      { codes: [], supported: true, raw: '', outcome: 'NO_RESPONSE' } as never);

    const report = await scanAllEcus({
      ecus: [reachableButSilent, trulyUnreachable], probedAt: 1_700_000_000_000, probeEmpty: false,
    });

    expect(report.completeness.notAddressable).toBe(1);
    const unreachableRow = report.results.find((r) => r.ecu.txHeader === '18DA14F1')!;
    const reachableRow = report.results.find((r) => r.ecu.txHeader === '18DA0AF1')!;
    expect(isEcuReachable(unreachableRow)).toBe(false);
    expect(isEcuReachable(reachableRow)).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2) GERÇEKTEN ULAŞILAMAYAN ECU — davranış DEĞİŞMEZ (regresyon yok)
 * ════════════════════════════════════════════════════════════════════════ */

describe('gerçekten hiç fiziksel/fonksiyonel kanıt yoksa unreachableCount=1 KALIR', () => {
  it('functional kanıt YOK + standart modlar sessiz → notAddressable=1, ECU erişilemez', async () => {
    const noEvidence = ecu29bit({
      probeOutcome: 'no_response', discoverySource: 'physical_probe',
    });
    vi.mocked(CarLauncher.readDtcFromEcu).mockResolvedValue(
      { codes: [], supported: true, raw: '', outcome: 'NO_RESPONSE' } as never);

    const report = await scanAllEcus(topologyOf(noEvidence));
    const r = report.results[0]!;

    expect(isEcuReachable(r)).toBe(false);
    expect(classifyEcuCoverageStatus(r)).toBe('failed');
    expect(report.completeness.notAddressable).toBe(1);

    const { gaps } = evaluateEcuCoverage({
      discoveryRan: true, discovered: 1, scanned: report.completeness.scanned,
      failed: report.completeness.failed, skipped: report.completeness.skipped,
      notAddressable: report.completeness.notAddressable,
      staleSession: false, denominatorKnown: true,
    });
    expect(gaps.join(' | ')).toMatch(/ULAŞILAMADI/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3) DTC ALT-SERVİSİ 'OK' GETİRİRSE ADRESLENEBİLİRLİK ZATEN PROVEN OLUR
 *    (çelişki hiç oluşmaz — regresyon-güvenli sınır durumu)
 * ════════════════════════════════════════════════════════════════════════ */

describe('bir DTC alt-servisi gerçekten OK dönerse tarama kısmi kalsa da özet tutarlıdır', () => {
  it('stored=ok · permanent=no_response → erişilebilir + kısmi, ULAŞILAMADI yok', async () => {
    vi.mocked(CarLauncher.readDtcFromEcu).mockImplementation(async (o: unknown) => {
      const { mode } = o as { mode: string };
      if (mode === '03') return { codes: [], supported: true, raw: '4300', outcome: 'OK' } as never;
      return { codes: [], supported: true, raw: '', outcome: 'NO_RESPONSE' } as never;
    });

    const report = await scanAllEcus(topologyOf(ecu29bit()));
    const r = report.results[0]!;

    expect(r.stored).toBe('ok');
    expect(r.permanent).toBe('failed');
    expect(isEcuReachable(r)).toBe(true);
    expect(isEcuDtcScanPartial(r)).toBe(true);
    expect(classifyEcuCoverageStatus(r)).toBe('scanned');
    expect(report.completeness.notAddressable).toBe(0);
  });
});
