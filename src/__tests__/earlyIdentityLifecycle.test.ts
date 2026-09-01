/**
 * P0-VDK-B7 · LIFECYCLE kilidi — erken kimlik izleyicisi keşfi TEKRARLAMAZ.
 *
 * ── SAHADA ÖLÇÜLEN KUSUR (2026-08-30 · gerçek araç) ───────────────────────
 * `startEarlyIdentityWatcher` HER OBD veri olayında (~3 Hz) tetikleniyor ve
 * `tryEarlyVehicleIdentityOnce` çağırıyordu. İdempotens kapısı
 * (`runEarlyVehicleIdentity` içindeki `_evaluatedEpoch` kontrolü) çalışıyordu —
 * AMA `discoverEcus()` o kapıdan ÖNCE koşuyordu. Sonuç:
 *   · `probeEcus` 102 çağrı / 10 dk
 *   · fiziksel prob turu 712 × `1902FF` → hepsi NO DATA
 *   · bilgi üretmeyen süre 335 270 ms → hattın %83'ü
 *
 * "Ölçüm idempotenttir" iddiası doğruydu; KEŞFİN MALİYETİ o iddianın dışındaydı.
 * Bu kilit, kapının pahalı keşiften ÖNCE sorulduğunu sabitler.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const discoverEcus = vi.fn();
const runEarlyVehicleIdentity = vi.fn();
const isEarlyIdentityEvaluatedForEpoch = vi.fn();
const getObdSessionEpoch = vi.fn();
const onOBDData = vi.fn(() => () => {});
const getOBDDataSnapshot = vi.fn(() => ({}));

vi.mock('../platform/obd/multiEcuScan', () => ({ discoverEcus }));
vi.mock('../platform/obd/identity/earlyVehicleIdentity', () => ({
  runEarlyVehicleIdentity, isEarlyIdentityEvaluatedForEpoch,
}));
vi.mock('../platform/obdService', () => ({
  getObdSessionEpoch, onOBDData, getOBDDataSnapshot,
}));
vi.mock('../platform/obd/activeProtocol', () => ({
  getActiveProtocolClass: vi.fn(() => 'can'),
}));
/* This module is also transitively imported by the diagnostic/healing graph.
   Preserve its named class and safety exports; override only the one product
   seam this lifecycle test needs. A partial mock leaked an undefined
   DESTRUCTIVE_SERVICES and a non-constructible GenericPduTransport. */
vi.mock('../platform/obd/genericPduTransport', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../platform/obd/genericPduTransport')>();
  return { ...actual, genericBridgeAvailable: vi.fn(() => true) };
});
vi.mock('../platform/crashLogger', () => ({ logError: vi.fn() }));

const { tryEarlyVehicleIdentityOnce } = await import(
  '../platform/obd/identity/earlyIdentityRuntime'
);

beforeEach(() => {
  vi.clearAllMocks();
  getObdSessionEpoch.mockReturnValue(42);
  discoverEcus.mockResolvedValue({ ecus: [{ txHeader: '7E0', rxHeader: '7E8' }] });
  runEarlyVehicleIdentity.mockResolvedValue({});
});

describe('B7 · erken kimlik lifecycle', () => {
  it('🔒 aynı oturumda ikinci tur KEŞFE HİÇ GİRMEZ (asıl saha kusuru)', async () => {
    isEarlyIdentityEvaluatedForEpoch.mockReturnValue(false);
    await tryEarlyVehicleIdentityOnce(1_000);
    expect(discoverEcus).toHaveBeenCalledTimes(1);
    expect(runEarlyVehicleIdentity).toHaveBeenCalledTimes(1);

    /* Ölçüm tamamlandı → izleyici tekrar tetiklense bile keşif ÇALIŞMAMALI. */
    isEarlyIdentityEvaluatedForEpoch.mockReturnValue(true);
    for (let i = 0; i < 50; i++) await tryEarlyVehicleIdentityOnce(2_000 + i);

    expect(discoverEcus, 'keşif idempotens kapısından ÖNCE koşuyor — saha kusuru geri geldi')
      .toHaveBeenCalledTimes(1);
    expect(runEarlyVehicleIdentity).toHaveBeenCalledTimes(1);
  });

  it('🔒 yeni oturum mührü gelince ölçüm YENİDEN yapılır (donmaz)', async () => {
    isEarlyIdentityEvaluatedForEpoch.mockReturnValue(true);
    await tryEarlyVehicleIdentityOnce(1_000);
    expect(discoverEcus).not.toHaveBeenCalled();

    /* Yeni bağlantı = yeni mühür → kapı açılır. */
    getObdSessionEpoch.mockReturnValue(43);
    isEarlyIdentityEvaluatedForEpoch.mockReturnValue(false);
    await tryEarlyVehicleIdentityOnce(2_000);
    expect(discoverEcus).toHaveBeenCalledTimes(1);
  });

  it('🔒 oturum mührü ÖLÇÜLEMEZSE kapı ölçümü ENGELLEMEZ (fail-open)', async () => {
    /* Mühür bilinmiyorsa "zaten ölçüldü" varsayımı kimliği kalıcı olarak
       engellerdi — bilinmezlik bir GEREKÇE değildir. */
    getObdSessionEpoch.mockImplementation(() => { throw new Error('epoch yok'); });
    isEarlyIdentityEvaluatedForEpoch.mockReturnValue(true);
    await tryEarlyVehicleIdentityOnce(1_000);
    expect(discoverEcus).toHaveBeenCalledTimes(1);
  });

  it('🔒 eşzamanlı çağrılar tek tur üretir (in-flight guard korundu)', async () => {
    isEarlyIdentityEvaluatedForEpoch.mockReturnValue(false);
    let release: (v: unknown) => void = () => {};
    discoverEcus.mockReturnValue(new Promise((r) => { release = r; }));

    const a = tryEarlyVehicleIdentityOnce(1_000);
    const b = tryEarlyVehicleIdentityOnce(1_001);
    release({ ecus: [{ txHeader: '7E0', rxHeader: '7E8' }] });
    await Promise.all([a, b]);

    expect(discoverEcus).toHaveBeenCalledTimes(1);
  });
});
