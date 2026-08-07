/**
 * Adaptör bağlı ama ECU susuyor: ölçülmüş voltaj KAYBOLMAZ (kütük #459).
 *
 * SAHA 2026-08-06 (Adana-Şanlıurfa, 32 dk): V-LINK adaptörü fiziksel olarak
 * bağlandı ve `ATRV` ile 11,99 V bildirdi — konsolda
 * `[Battery] NORMAL → WARN @ 11.99 V` üretildi. Buna karşılık ekrandaki akü
 * alanı 32 dakika boyunca `—` kaldı; sürücü hiçbir uyarı görmedi.
 *
 * KÖK: ECU hiç konuşmadığı için veri kapısı (`_dataGatePassed`) hiç açılmadı ve
 * kapı öncesi erken `return` ATRV paketini BÜTÜNÜYLE atıyordu. Adaptörün KENDİ
 * ölçtüğü değer ECU'ya bağlı değildir; ECU'nun susması onu geçersiz kılmaz.
 *
 * Bu testler iki şeyi birden kilitler:
 *   1) voltaj artık gösterim otoritesine ULAŞIR (3. kapı: kullanıcı bilmeli mi?),
 *   2) kapının anlamı KORUNUR — sahte "bağlandı"/"veri taze" pozitifi ÜRETİLMEZ,
 *      böylece arayüz "adaptör bağlı · ECU yanıt vermiyor" ile "bağlanamadı"yı
 *      ayırt edebilir.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const M = vi.hoisted(() => ({
  listeners: {} as Record<string, Array<(d: unknown) => void>>,
  addCalls: 0, removeCalls: 0, connectCalls: 0,
  recoverCalls: [] as string[],
  recoverOk: true,
  protocol: '6', // CAN 11-bit/500k
}));

vi.mock('../platform/remoteLogService', () => ({ reportObdDiag: vi.fn(async () => {}) }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: vi.fn(() => true) } }));

vi.mock('../platform/nativePlugin', () => ({
  CarLauncher: {
    scanOBD: vi.fn().mockResolvedValue({ devices: [] }),
    connectOBD: vi.fn(async () => { M.connectCalls++; return { protocol: M.protocol }; }),
    disconnectOBD: vi.fn(async () => {}),
    recoverObdSession: vi.fn(async ({ level }: { level: string }) => {
      M.recoverCalls.push(level);
      return { ok: M.recoverOk };
    }),
    addListener: vi.fn(async (event: string, cb: (d: unknown) => void) => {
      M.addCalls++;
      (M.listeners[event] ??= []).push(cb);
      return { remove: vi.fn(async () => { M.removeCalls++; M.listeners[event] = (M.listeners[event] ?? []).filter((f) => f !== cb); }) };
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
    subscribe: vi.fn(() => () => {}), reportFailure: vi.fn(),
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
vi.mock('../platform/obdStorage', () => ({
  loadObdAddress: vi.fn(() => null), saveObdAddress: vi.fn(), clearObdAddress: vi.fn(),
  loadObdTransport: vi.fn(() => 'classic'), saveObdTransport: vi.fn(),
  loadObdTransportVerified: vi.fn(() => true), saveObdTransportVerified: vi.fn(), clearObdTransport: vi.fn(),
  loadObdProfileId: vi.fn(() => null), saveObdProfileId: vi.fn(),
  loadObdProtocol: vi.fn(() => M.protocol), saveObdProtocol: vi.fn(), clearObdProtocol: vi.fn(),
  loadObdFuelCalib: vi.fn(() => 1), saveObdFuelCalib: vi.fn(),
  isValidTcpAddress: vi.fn(() => false), markObdAddressVerified: vi.fn(),
}));
vi.mock('../platform/vehicleProfileService', () => ({ persistHandshakeVin: vi.fn() }));
vi.mock('../platform/obdDiagnosticRecorder', () => ({ recordDiag: vi.fn() }));
vi.mock('../platform/obdSanitizer', () => ({
  sanitizeNativeOBDPacket: vi.fn((d: Record<string, unknown>) => ({ patch: d, nextRpm: null })),
}));


import { startOBD, stopOBD, getOBDDataSnapshot } from '../platform/obdService';
import { _resetObdDiagEmitterForTest } from '../platform/obdDiagEmitter';

const ADDR = '00:11:22:33:44:55';

function feed(patch: Record<string, number>): void {
  for (const cb of M.listeners['obdData'] ?? []) cb(patch);
}

/** Adaptör bağlanır; ECU HİÇ konuşmaz, yalnız ATRV akar. */
async function adapterOnlySession(volts: number[]): Promise<void> {
  startOBD(ADDR);
  await vi.advanceTimersByTimeAsync(50);
  for (const v of volts) {
    feed({ batteryVoltage: v });
    await vi.advanceTimersByTimeAsync(2_000);
  }
}

beforeEach(() => {
  _resetObdDiagEmitterForTest();
  M.listeners = {}; M.addCalls = 0; M.removeCalls = 0; M.connectCalls = 0;
  M.recoverCalls = []; M.recoverOk = true; M.protocol = '6';
  vi.useFakeTimers();
});
afterEach(() => { stopOBD(); vi.clearAllMocks(); vi.useRealTimers(); });

describe('#459 · ECU susarken adaptör voltajı', () => {
  it('KUSURUN KANITI ORTADAN KALKTI: ATRV voltajı anlık görüntüye ULAŞIR', () => {
    return adapterOnlySession([11.99]).then(() => {
      expect(getOBDDataSnapshot().batteryVoltage).toBe(11.99);
    });
  });

  it('🔒 en son ölçülen voltaj taşınır (uyarı eşiği bunun üstünde çalışır)', async () => {
    await adapterOnlySession([12.6, 12.1, 11.99]);
    expect(getOBDDataSnapshot().batteryVoltage).toBe(11.99);
  });

  it('🔒 link CANLI işaretlenir — "bağlanamadı" demek YANLIŞ olurdu', async () => {
    await adapterOnlySession([11.99]);
    expect(getOBDDataSnapshot().transportConnected).toBe(true);
  });

  it('🔒 ama ECU verisi TAZE SAYILMAZ (kapı anlamını korur)', async () => {
    await adapterOnlySession([11.99]);
    expect(getOBDDataSnapshot().dataFresh).toBe(false);
  });

  it('🔒 sahte "bağlandı" pozitifi ÜRETİLMEZ', async () => {
    await adapterOnlySession([11.99, 12.0, 11.9]);
    expect(getOBDDataSnapshot().connectionState).not.toBe('connected');
  });

  it('🔒 ayrım TÜRETİLEBİLİR: adaptör var + ECU susuyor', async () => {
    await adapterOnlySession([11.99]);
    const d = getOBDDataSnapshot();
    // Arayüzün "adaptör bağlı · ECU yanıt vermiyor" diyebilmesi için gereken üçlü
    expect(d.transportConnected && !d.dataFresh && d.connectionState !== 'connected').toBe(true);
  });

  it('🔒 ECU konuşmaya başlayınca normal akış KURULUR (regresyon yok)', async () => {
    await adapterOnlySession([12.4]);
    feed({ speed: 40, rpm: 1500 });
    await vi.advanceTimersByTimeAsync(10);
    const d = getOBDDataSnapshot();
    expect(d.connectionState).toBe('connected');
    expect(d.dataFresh).toBe(true);
    expect(d.batteryVoltage).toBe(12.4);   // adaptör kanıtı korunur
  });

  it('🔒 ECU PID\'leri ısınma boyunca YİNE görmezden gelinir', async () => {
    // Kapı açılmadan gelen ECU-DIŞI paket ECU alanlarını yazmamalı.
    startOBD(ADDR);
    await vi.advanceTimersByTimeAsync(50);
    const before = getOBDDataSnapshot().speed;
    feed({ batteryVoltage: 12.4 });
    await vi.advanceTimersByTimeAsync(10);
    expect(getOBDDataSnapshot().speed).toBe(before);
  });
});
