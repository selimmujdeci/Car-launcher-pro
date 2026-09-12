/**
 * obdFuelCalibration.test.ts — KİLİT: PID 0x2F şamandıra eğrisi kalibrasyonu.
 *
 * SAHA KÖKÜ (2026-08-04, Xiaomi zircon + adaptör 10:21:3E:4D:71:D2, CDP canlı ölçüm):
 * depo AĞZINA KADAR doluyken ECU ham yanıtı `41 2F 99` → 0x99 = 153 → SAE J1979
 * formülüyle (A×100/255) %60. Uygulamanın matematiği DOĞRU; aracın şamandıra eğrisi
 * 0–255 aralığının tamamını kullanmıyor → kullanıcı "full depo yarım görünüyor" diyor.
 *
 * obdService'te ölçek mekanizması (`_fuelCalibScale` + `loadObdFuelCalib`) 2026-07-16
 * Doblo vakasından beri VARDI — ama `saveObdFuelCalib`'in ÜRÜNDE TEK BİR ÇAĞIRANI YOKTU.
 * Yani ölçek sonsuza dek 1 kalıyor, hiçbir kullanıcı kalibre EDEMİYORDU (ölü özellik).
 *
 * Bu dosya yazma ucunu ve — daha önemlisi — TEK ÖLÇEKLEME NOKTASI invaryantını kilitler:
 * `_current.fuelLevel` GÖSTERİM değeridir; ham 2F ayrı tutulur ve ölçek ASLA iki kez
 * uygulanmaz.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const M = vi.hoisted(() => ({
  listeners: {} as Record<string, Array<(d: unknown) => void>>,
  savedCalib: [] as Array<{ address: string; scale: number; vin: string | null | undefined }>,
  vin: null as string | null,
}));

vi.mock('../platform/remoteLogService', () => ({ reportObdDiag: vi.fn(async () => {}) }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: vi.fn(() => true) } }));

vi.mock('../platform/nativePlugin', () => ({
  CarLauncher: {
    scanOBD: vi.fn().mockResolvedValue({ devices: [] }),
    connectOBD: vi.fn(async () => ({ protocol: '7' })),
    disconnectOBD: vi.fn(async () => {}),
    addListener: vi.fn(async (event: string, cb: (d: unknown) => void) => {
      (M.listeners[event] ??= []).push(cb);
      return { remove: vi.fn(async () => { M.listeners[event] = (M.listeners[event] ?? []).filter((f) => f !== cb); }) };
    }),
  } as Record<string, unknown>,
}));

vi.mock('../platform/performanceMode', () => ({
  getConfig: vi.fn(() => ({ obdPollInterval: 1_000, obdListenerDebounce: 0 })),
  onPerformanceModeChange: vi.fn(() => () => {}),
}));
vi.mock('../core/runtime/AdaptiveRuntimeManager', () => ({
  runtimeManager: {
    getMode: vi.fn(() => 'PERFORMANCE'),
    getConfig: vi.fn(() => ({ obdPollingMs: 1_000 })),
    subscribe: vi.fn(() => () => {}), reportFailure: vi.fn(), reportRecovery: vi.fn(),
  },
}));
vi.mock('../platform/crashLogger', () => ({ logError: vi.fn() }));
vi.mock('../platform/rafSmoother', () => ({ useRafSmoothed: vi.fn((v: number) => v) }));
vi.mock('../platform/obdBinaryParser', () => ({
  parseBinaryOBDFrame: vi.fn(() => null), hasBinaryFrame: vi.fn(() => false), clearAccumulatedBuffer: vi.fn(),
}));
vi.mock('../platform/canSnapshotService', () => ({
  hydrateCanSnapshotSync: vi.fn(() => ({})), hydrateCanSnapshotAsync: vi.fn(() => Promise.resolve({})),
  scheduleCanSnapshot: vi.fn(), flushCanSnapshotNow: vi.fn(), stopCanSnapshot: vi.fn(),
}));
vi.mock('../platform/safety/SafetyBrain', () => ({ isFeatureEnabled: vi.fn(() => true), recordFault: vi.fn(), recordFeatureRecovered: vi.fn() }));
vi.mock('../platform/safety/vinContext', () => ({ getHandshakeVin: vi.fn(() => M.vin) }));

vi.mock('../platform/obdStorage', () => ({
  loadObdAddress: vi.fn(() => ADDR),
  saveObdAddress: vi.fn(), clearObdAddress: vi.fn(),
  loadObdTransport: vi.fn(() => 'classic'), saveObdTransport: vi.fn(),
  loadObdTransportVerified: vi.fn(() => true), saveObdTransportVerified: vi.fn(),
  clearObdTransport: vi.fn(),
  loadObdProfileId: vi.fn(() => null), saveObdProfileId: vi.fn(),
  loadObdProtocol: vi.fn(() => '7'), saveObdProtocol: vi.fn(), clearObdProtocol: vi.fn(),
  loadObdFuelCalib: vi.fn(() => 1),
  saveObdFuelCalib: vi.fn((address: string, scale: number, vin?: string | null) => {
    M.savedCalib.push({ address, scale, vin });
  }),
  isValidTcpAddress: vi.fn(() => false),
  markObdAddressVerified: vi.fn(),
  loadVerifiedObdAddresses: vi.fn(() => new Set([ADDR])),
}));
vi.mock('../platform/vehicleProfileService', () => ({ persistHandshakeVin: vi.fn() }));
vi.mock('../platform/obdDiagnosticRecorder', () => ({ recordDiag: vi.fn() }));
vi.mock('../platform/obdSanitizer', () => ({
  sanitizeNativeOBDPacket: vi.fn((d: Record<string, unknown>) => ({ patch: d, nextRpm: null })),
}));

const ADDR = '10:21:3E:4D:71:D2';
/** Saha ölçümü: `41 2F 99` → 0x99 = 153 → round(153×100/255) = 60. */
const RAW_AT_FULL_TANK = 60;

type ObdSvc = typeof import('../platform/obdService');
let svc: ObdSvc | null = null;

/** Taze modül + bağlı oturum + ilk yakıt okuması akmış hâle getirir. */
async function bootConnected(): Promise<ObdSvc> {
  vi.resetModules();
  const mod = await import('../platform/obdService');
  const diag = await import('../platform/obdDiagEmitter');
  diag._resetObdDiagEmitterForTest();
  svc = mod;
  mod.startOBD();
  await vi.advanceTimersByTimeAsync(5_000);
  return mod;
}

function feed(patch: Record<string, number>): void {
  for (const cb of M.listeners['obdData'] ?? []) cb({ ...patch });
}

/** Isınma kapısı ilk paketi yutar → veri kapısı açılana kadar besle. */
async function feedUntilLive(patch: Record<string, number>): Promise<void> {
  for (let i = 0; i < 3; i++) { feed(patch); await vi.advanceTimersByTimeAsync(500); }
}

beforeEach(() => {
  M.listeners = {};
  M.savedCalib = [];
  M.vin = null;
  vi.useFakeTimers();
});
afterEach(() => { svc?.stopOBD(); svc = null; vi.clearAllMocks(); vi.useRealTimers(); });

describe('yakıt kalibrasyonu — ham 2F ile gösterim ayrımı', () => {
  it('kalibrasyonsuzken ham 2F aynen gösterilir (regresyon yok)', async () => {
    const s = await bootConnected();
    await feedUntilLive({ fuelLevel: RAW_AT_FULL_TANK, rpm: 1500, speed: 80 });

    const st = s.getFuelCalibrationState();
    expect(st.scale).toBe(1);
    expect(st.rawPct).toBe(RAW_AT_FULL_TANK);
    expect(st.displayPct).toBe(RAW_AT_FULL_TANK);
    expect(s.getOBDDataSnapshot().fuelLevel).toBe(RAW_AT_FULL_TANK);
  });

  it('KRİTİK: "depo full" beyanı ham %60 → gösterim %100 yapar ve kalıcılaştırır', async () => {
    const s = await bootConnected();
    await feedUntilLive({ fuelLevel: RAW_AT_FULL_TANK, rpm: 1500, speed: 80 });

    const r = s.calibrateFuelLevel(100);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.scale).toBeCloseTo(100 / RAW_AT_FULL_TANK, 6);

    // Gösterge bir sonraki 2F turunu (~8 sn) BEKLEMEDEN düzelmeli.
    expect(s.getOBDDataSnapshot().fuelLevel).toBe(100);
    // Ham değer korunur — kalibrasyonun kendisi ham üzerinden yeniden türetilebilir.
    expect(s.getFuelCalibrationState().rawPct).toBe(RAW_AT_FULL_TANK);
    // Kalıcılaştırma: VIN yokken adaptör MAC anahtarına yazılır.
    expect(M.savedCalib).toHaveLength(1);
    expect(M.savedCalib[0].address).toBe(ADDR);
    expect(M.savedCalib[0].scale).toBeCloseTo(100 / RAW_AT_FULL_TANK, 6);
  });

  it('KİLİT: ölçek İKİ KEZ uygulanmaz — sonraki ham okumalar tek kez ölçeklenir', async () => {
    const s = await bootConnected();
    await feedUntilLive({ fuelLevel: RAW_AT_FULL_TANK, rpm: 1500, speed: 80 });
    s.calibrateFuelLevel(100);

    // Depo yarılandı: ham 30 → gösterim 50 (30 × 1.667). 83 (= 50 × 1.667) OLMAMALI.
    feed({ fuelLevel: 30 });
    await vi.advanceTimersByTimeAsync(500);
    expect(s.getOBDDataSnapshot().fuelLevel).toBe(50);
    expect(s.getFuelCalibrationState().rawPct).toBe(30);

    // Aynı ham değer tekrar geldiğinde sonuç DEĞİŞMEZ (birikmeli ölçekleme yok).
    feed({ fuelLevel: 30 });
    await vi.advanceTimersByTimeAsync(500);
    expect(s.getOBDDataSnapshot().fuelLevel).toBe(50);
  });

  it('%100 üstüne taşan ölçekli değer 100"e kırpılır (imkânsız yüzde gösterilmez)', async () => {
    const s = await bootConnected();
    await feedUntilLive({ fuelLevel: RAW_AT_FULL_TANK, rpm: 1500, speed: 80 });
    s.calibrateFuelLevel(100);

    feed({ fuelLevel: 90 }); // 90 × 1.667 = 150
    await vi.advanceTimersByTimeAsync(500);
    expect(s.getOBDDataSnapshot().fuelLevel).toBe(100);
  });

  it('VIN biliniyorsa kalibrasyon VIN"e yazılır (dongle değişimine dayanıklı)', async () => {
    M.vin = 'VF1AAAAA123456789';
    const s = await bootConnected();
    await feedUntilLive({ fuelLevel: RAW_AT_FULL_TANK, rpm: 1500, speed: 80 });

    expect(s.getFuelCalibrationState().keyKind).toBe('vin');
    s.calibrateFuelLevel(100);
    expect(M.savedCalib[0].vin).toBe('VF1AAAAA123456789');
  });

  it('temizleme ham 2F"ye döndürür ve kaydı siler', async () => {
    const s = await bootConnected();
    await feedUntilLive({ fuelLevel: RAW_AT_FULL_TANK, rpm: 1500, speed: 80 });
    s.calibrateFuelLevel(100);
    expect(s.getOBDDataSnapshot().fuelLevel).toBe(100);

    s.clearFuelCalibration();
    expect(s.getFuelCalibrationState().scale).toBe(1);
    expect(s.getOBDDataSnapshot().fuelLevel).toBe(RAW_AT_FULL_TANK);
    expect(M.savedCalib.at(-1)!.scale).toBe(1);
  });
});

describe('yakıt kalibrasyonu — kanıtsız kalibrasyon REDDEDİLİR', () => {
  it('hiç yakıt okuması yokken reddeder (sahte "kalibre edildi" YOK)', async () => {
    const s = await bootConnected();
    await feedUntilLive({ rpm: 1500, speed: 80 }); // 2F HİÇ gelmedi

    const r = s.calibrateFuelLevel(100);
    expect(r).toEqual({ ok: false, reason: 'no-reading' });
    expect(M.savedCalib).toHaveLength(0);
    expect(s.getFuelCalibrationState().rawUsable).toBe(false);
  });

  it('bayat okuma (>2 dk) reddedilir', async () => {
    const s = await bootConnected();
    await feedUntilLive({ fuelLevel: RAW_AT_FULL_TANK, rpm: 1500, speed: 80 });
    await vi.advanceTimersByTimeAsync(121_000);

    expect(s.calibrateFuelLevel(100)).toEqual({ ok: false, reason: 'stale-reading' });
    expect(M.savedCalib).toHaveLength(0);
  });

  it('ham 0 okumasından ölçek türetilmez (sıfıra bölme / sonsuz katsayı)', async () => {
    const s = await bootConnected();
    await feedUntilLive({ fuelLevel: 0, rpm: 1500, speed: 80 });

    expect(s.calibrateFuelLevel(100)).toEqual({ ok: false, reason: 'zero-reading' });
    expect(M.savedCalib).toHaveLength(0);
  });

  it('geçersiz beyan (0, negatif, >100, NaN) reddedilir', async () => {
    const s = await bootConnected();
    await feedUntilLive({ fuelLevel: RAW_AT_FULL_TANK, rpm: 1500, speed: 80 });

    for (const bad of [0, -5, 101, Number.NaN]) {
      expect(s.calibrateFuelLevel(bad)).toEqual({ ok: false, reason: 'bad-input' });
    }
    expect(M.savedCalib).toHaveLength(0);
  });

  it('makul aralık dışı katsayı reddedilir (ham %2 iken "full" demek gibi)', async () => {
    const s = await bootConnected();
    await feedUntilLive({ fuelLevel: 2, rpm: 1500, speed: 80 }); // 100/2 = 50 → aralık dışı

    expect(s.calibrateFuelLevel(100)).toEqual({ ok: false, reason: 'out-of-range' });
    expect(M.savedCalib).toHaveLength(0);
    expect(s.getOBDDataSnapshot().fuelLevel).toBe(2); // gösterge DEĞİŞMEDİ
  });
});
