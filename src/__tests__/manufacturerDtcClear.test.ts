/**
 * manufacturerDtcClear.test.ts — ÜRETİCİ DTC SİLME (UDS 0x14, tek ECU) zinciri.
 *
 * Ham yanıtlar gerçek araçtan (2026-09-22 · V-LINK/ELM327 v2.2 · ATDPN 6):
 *   şanzıman 7E1/7E9 19-02 → "FFD2258628D2268628" = U1225-86 / U1226-86 ONAYLI (0x28)
 *   motor    7E0/7E8 19-02 → yalnız "test tamamlanmadı" (0x40) kayıtları
 *
 * Kilitlenen sözleşme (Mode 04 ile aynı): kapılar geçilmeden TEK bayt gitmez;
 * "komut gönderildi" ≠ "silindi" — hüküm silme SONRASI yeniden okumadan çıkar;
 * "test tamamlanmadı" kaydı arıza değildir (silmeden sonra ECU tam bunu raporlar).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: vi.fn(() => true) },
}));

vi.mock('../platform/nativePlugin', () => ({
  CarLauncher: {
    readUdsDtcs:  vi.fn(async (_o: { tx: string; rx: string }) => ({ raw: 'FF', supported: true })),
    clearUdsDtcs: vi.fn(async (_o: { tx: string; rx: string }) => ({ tx: '14FFFFFF', outcome: 'POSITIVE', elapsedMs: 90 })),
  },
}));
vi.mock('../platform/obdService', () => ({
  getOBDDataSnapshot: vi.fn(() => ({ connectionState: 'connected', speed: 0, rpm: 850, lastSeenMs: Date.now() })),
  getObdSpeedFresh: vi.fn(() => 0),
  getObdSessionEpoch: vi.fn(() => 7),
  getHandshakeDiagnostics: vi.fn(() => ({ protocolActive: '6' })),
}));

import { CarLauncher } from '../platform/nativePlugin';
import { clearManufacturerDtcs, _setUdsClearFieldVerifiedForTest } from '../platform/dtcService';
import { getDtcClearEvidence, _resetDtcClearEvidenceForTest } from '../platform/obd/dtcClearEvidence';
import { _setSecurityContextForTest } from '../platform/security/enforcement';

const TCM = { txHeader: '7E1', rxHeader: '7E9' };
const TCM_CONFIRMED = 'FFD2258628D2268628';        // saha: onaylı U1225-86 / U1226-86
const TCM_AFTER_CLEAR = 'FFD2258650D2268650';      // silme sonrası: yalnız "test tamamlanmadı"
const ENGINE_INCOMPLETE = 'FF2031164004887740';    // saha: P2031-16 / P0488-77, status 0x40

/** 19-02 okumalarını sırayla programlar (ön okuma, sonra yeniden okuma). */
function programReads(...raws: string[]): void {
  const m = vi.mocked(CarLauncher.readUdsDtcs!);
  m.mockReset();
  for (const raw of raws) m.mockResolvedValueOnce({ raw, supported: true });
}

beforeEach(async () => {
  vi.clearAllMocks();
  _resetDtcClearEvidenceForTest();
  const obd = await import('../platform/obdService');
  vi.mocked(obd.getObdSessionEpoch).mockReturnValue(7);
  vi.mocked(obd.getObdSpeedFresh).mockReturnValue(0);
  vi.mocked(obd.getHandshakeDiagnostics).mockReturnValue({ protocolActive: '6' } as ReturnType<typeof obd.getHandshakeDiagnostics>);
  vi.mocked(obd.getOBDDataSnapshot).mockReturnValue(
    { connectionState: 'connected', speed: 0, rpm: 850, lastSeenMs: Date.now() } as ReturnType<typeof obd.getOBDDataSnapshot>);
  vi.mocked(CarLauncher.clearUdsDtcs!).mockResolvedValue({ tx: '14FFFFFF', outcome: 'POSITIVE', elapsedMs: 90 });
  _setSecurityContextForTest({ vehicleRef: 'a1b2c3d4e5f60718', motion: 'PARKED' });
  _setUdsClearFieldVerifiedForTest(true);   // zincirin kendisi sınanır; kapalı hâl ayrı kilitte
});
afterEach(() => { _setSecurityContextForTest(null); _setUdsClearFieldVerifiedForTest(false); });

describe('üretici DTC silme — UDS 0x14 zinciri', () => {
  it('🔒 KİLİT: yol SAHADA doğrulanmadıysa (ürün varsayılanı) komut GİTMEZ', async () => {
    _setUdsClearFieldVerifiedForTest(false);
    programReads(TCM_CONFIRMED);
    const r = await clearManufacturerDtcs({ ...TCM, confirmed: true });
    expect(r.allowed).toBe(false);
    expect(r.userMessage).toMatch(/doğrulanmadı/);
    expect(CarLauncher.clearUdsDtcs).not.toHaveBeenCalled();
  });

  it('🔒 SAHA: şanzımanın onaylı kodları silinir ve yeniden okumayla DOĞRULANIR', async () => {
    programReads(TCM_CONFIRMED, TCM_AFTER_CLEAR);
    const r = await clearManufacturerDtcs({ ...TCM, confirmed: true });

    expect(CarLauncher.clearUdsDtcs).toHaveBeenCalledWith({ tx: '7E1', rx: '7E9' });
    expect(r.allowed).toBe(true);
    expect(r.clear?.verdict).toBe('CLEARED');
    expect(r.clear?.success).toBe(true);
    expect(r.clear?.removed).toEqual(['U1225(86)', 'U1226(86)']);

    const ev = getDtcClearEvidence().at(-1);
    expect(ev?.scope).toBe('physical_ecu');
    expect(ev?.target).toBe('7E1');
    expect(ev?.tx).toBe('14FFFFFF');
  });

  it('🔒 "test tamamlanmadı" arıza DEĞİLDİR → silinecek kod yok, komut GİTMEZ', async () => {
    programReads(ENGINE_INCOMPLETE);
    const r = await clearManufacturerDtcs({ txHeader: '7E0', rxHeader: '7E8', confirmed: true });
    expect(r.allowed).toBe(false);
    expect(r.userMessage).toMatch(/silinecek arıza kaydı yok/);
    expect(CarLauncher.clearUdsDtcs).not.toHaveBeenCalled();
  });

  it('🔒 onay yoksa ECU\'ya TEK bayt gitmez (ön okuma dahil)', async () => {
    programReads(TCM_CONFIRMED);
    const r = await clearManufacturerDtcs({ ...TCM, confirmed: false });
    expect(r.allowed).toBe(false);
    expect(CarLauncher.readUdsDtcs).not.toHaveBeenCalled();
    expect(CarLauncher.clearUdsDtcs).not.toHaveBeenCalled();
  });

  it('🔒 araç hareket halindeyse komut GİTMEZ', async () => {
    const obd = await import('../platform/obdService');
    vi.mocked(obd.getObdSpeedFresh).mockReturnValue(40);
    programReads(TCM_CONFIRMED);
    const r = await clearManufacturerDtcs({ ...TCM, confirmed: true });
    expect(r.allowed).toBe(false);
    expect(CarLauncher.clearUdsDtcs).not.toHaveBeenCalled();
  });

  it('🔒 K-line (KWP) yolu sahada DOĞRULANMADI → komut GİTMEZ', async () => {
    const obd = await import('../platform/obdService');
    vi.mocked(obd.getHandshakeDiagnostics).mockReturnValue({ protocolActive: '5' } as ReturnType<typeof obd.getHandshakeDiagnostics>);
    programReads(TCM_CONFIRMED);
    const r = await clearManufacturerDtcs({ ...TCM, confirmed: true });
    expect(r.allowed).toBe(false);
    expect(r.userMessage).toMatch(/doğrulanmadı/);
    expect(CarLauncher.clearUdsDtcs).not.toHaveBeenCalled();
  });

  it('🔒 fonksiyonel yayın (7DF) hedef DEĞİLDİR → komut GİTMEZ', async () => {
    programReads(TCM_CONFIRMED);
    const r = await clearManufacturerDtcs({ txHeader: '7DF', rxHeader: '7E9', confirmed: true });
    expect(r.allowed).toBe(false);
    expect(CarLauncher.clearUdsDtcs).not.toHaveBeenCalled();
  });

  it('ECU reddederse (NRC 0x22) "silindi" DENMEZ ve yeniden okuma yapılmaz', async () => {
    programReads(TCM_CONFIRMED);
    vi.mocked(CarLauncher.clearUdsDtcs!).mockResolvedValue({ tx: '14FFFFFF', outcome: 'NEGATIVE', nrc: '22', elapsedMs: 40 });
    const r = await clearManufacturerDtcs({ ...TCM, confirmed: true });
    expect(r.clear?.verdict).toBe('COMMAND_FAILED');
    expect(r.clear?.success).toBe(false);
    expect(r.userMessage).toMatch(/koşullar uygun değil/);
    expect(CarLauncher.readUdsDtcs).toHaveBeenCalledTimes(1);   // yalnız ön okuma
  });

  it('kod silmeden sonra hâlâ onaylı görünüyorsa başarı İLAN EDİLMEZ', async () => {
    programReads(TCM_CONFIRMED, TCM_CONFIRMED);
    const r = await clearManufacturerDtcs({ ...TCM, confirmed: true });
    expect(r.clear?.verdict).toBe('INDETERMINATE_CODES_REMAIN');
    expect(r.clear?.success).toBe(false);
  });

  it('yeniden okuma düşerse hüküm DOĞRULANAMADI olur', async () => {
    const m = vi.mocked(CarLauncher.readUdsDtcs!);
    m.mockReset();
    m.mockResolvedValueOnce({ raw: TCM_CONFIRMED, supported: true });
    m.mockRejectedValueOnce(new Error('ELM327 yanıt vermedi'));
    const r = await clearManufacturerDtcs({ ...TCM, confirmed: true });
    expect(r.clear?.verdict).toBe('UNVERIFIED');
    expect(r.clear?.success).toBe(false);
  });
});
