/**
 * obdRuntimeFailureWiring.test.ts — #606 KİLİT: OBD ↔ runtime arıza merdiveni kablosu.
 *
 * `AdaptiveRuntimeManager` tarafındaki circir koruması (runtimeFailureRatchet.test.ts)
 * ancak KABLO doğruysa bir şey ifade eder. Burada obdService'in GERÇEK yollarında
 * iki yönün de bağlı olduğu doğrulanır:
 *
 *   ↓ kopma  → `reportFailure('OBD')`   (link öldü → yeniden bağlanma merdiveni)
 *   ↑ dönüş  → `reportRecovery('OBD')`  (RFCOMM/GATT + init başarılı)
 *
 * Yukarı yön #606'dan ÖNCE HİÇ YOKTU — merdiven tek yönlüydü. Bu kilit onun
 * sessizce geri sökülmesini engeller.
 *
 * Harness deseni obdReconnectIdempotency.repro.test.ts ile aynıdır (kopya mock
 * yerine aynı sözleşme): native plugin sahte, POWER_SAVE kadansı (15 s poll →
 * stale eşiği 47 s).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const M = vi.hoisted(() => ({
  listeners: {} as Record<string, Array<(d: unknown) => void>>,
  reportFailure:  vi.fn(),
  reportRecovery: vi.fn(),
}));

vi.mock('../platform/remoteLogService', () => ({ reportObdDiag: vi.fn(async () => {}) }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: vi.fn(() => true) } }));

vi.mock('../platform/nativePlugin', () => ({
  CarLauncher: {
    scanOBD: vi.fn().mockResolvedValue({ devices: [] }),
    connectOBD: vi.fn(async () => {}),
    disconnectOBD: vi.fn(async () => {}),
    addListener: vi.fn(async (event: string, cb: (d: unknown) => void) => {
      (M.listeners[event] ??= []).push(cb);
      return {
        remove: vi.fn(async () => {
          M.listeners[event] = (M.listeners[event] ?? []).filter((f) => f !== cb);
        }),
      };
    }),
  } as Record<string, unknown>,
}));

vi.mock('../platform/performanceMode', () => ({
  getConfig: vi.fn(() => ({ obdPollInterval: 15_000, obdListenerDebounce: 0 })),
  onPerformanceModeChange: vi.fn(() => () => {}),
}));

vi.mock('../core/runtime/AdaptiveRuntimeManager', () => ({
  runtimeManager: {
    getMode: vi.fn(() => 'POWER_SAVE'),
    getConfig: vi.fn(() => ({ obdPollingMs: 15_000 })),
    subscribe: vi.fn(() => () => {}),
    reportFailure:  M.reportFailure,
    reportRecovery: M.reportRecovery,
  },
}));

vi.mock('../platform/crashLogger', () => ({ logError: vi.fn() }));
vi.mock('../platform/rafSmoother', () => ({ useRafSmoothed: vi.fn((v: number) => v) }));
vi.mock('../platform/obdBinaryParser', () => ({
  parseBinaryOBDFrame: vi.fn(() => null),
  hasBinaryFrame: vi.fn(() => false),
  clearAccumulatedBuffer: vi.fn(),
}));
vi.mock('../platform/canSnapshotService', () => ({
  hydrateCanSnapshotSync: vi.fn(() => ({})),
  hydrateCanSnapshotAsync: vi.fn(() => Promise.resolve({})),
  scheduleCanSnapshot: vi.fn(), flushCanSnapshotNow: vi.fn(), stopCanSnapshot: vi.fn(),
}));
vi.mock('../platform/safety/SafetyBrain', () => ({
  isFeatureEnabled: vi.fn(() => true), recordFault: vi.fn(), recordFeatureRecovered: vi.fn(),
}));
vi.mock('../platform/obdStorage', () => ({
  loadObdAddress: vi.fn(() => null), saveObdAddress: vi.fn(), clearObdAddress: vi.fn(),
  loadObdTransport: vi.fn(() => 'classic'), saveObdTransport: vi.fn(),
  loadObdTransportVerified: vi.fn(() => true), saveObdTransportVerified: vi.fn(),
  clearObdTransport: vi.fn(),
  loadObdProfileId: vi.fn(() => null), saveObdProfileId: vi.fn(),
  loadObdProtocol: vi.fn(() => '6'), saveObdProtocol: vi.fn(), clearObdProtocol: vi.fn(),
  loadObdFuelCalib: vi.fn(() => 1), saveObdFuelCalib: vi.fn(),
  isValidTcpAddress: vi.fn(() => false), markObdAddressVerified: vi.fn(),
  loadVerifiedObdAddresses: vi.fn(() => new Set<string>()),
}));
vi.mock('../platform/vehicleProfileService', () => ({ persistHandshakeVin: vi.fn() }));
vi.mock('../platform/obdDiagnosticRecorder', () => ({ recordDiag: vi.fn() }));
vi.mock('../platform/obdSanitizer', () => ({
  sanitizeNativeOBDPacket: vi.fn((d: Record<string, unknown>) => ({ patch: d, nextRpm: null })),
}));

import { startOBD, stopOBD } from '../platform/obdService';
import { _resetObdDiagEmitterForTest } from '../platform/obdDiagEmitter';

const ADDR = '00:11:22:33:44:55';

function feedEcuData(patch: Record<string, number>): void {
  for (const cb of M.listeners['obdData'] ?? []) cb(patch);
}

/** Temiz bağlı oturum kurar (gate geçmiş, watchdog çalışıyor). */
async function establishConnection(): Promise<void> {
  startOBD(ADDR);
  await vi.advanceTimersByTimeAsync(50);
  feedEcuData({ speed: 40, rpm: 1500 });
  await vi.advanceTimersByTimeAsync(10);
}

beforeEach(() => {
  _resetObdDiagEmitterForTest();
  M.listeners = {};
  M.reportFailure.mockClear();
  M.reportRecovery.mockClear();
  vi.useFakeTimers();
});

afterEach(() => {
  stopOBD();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('#606 — OBD ↔ runtime merdiven kablosu', () => {
  it('↑ başarılı bağlantı reportRecovery(\'OBD\') bildirir', async () => {
    await establishConnection();

    expect(M.reportRecovery).toHaveBeenCalledWith('OBD');
    // Bağlanma anında arıza bildirilmez.
    expect(M.reportFailure).not.toHaveBeenCalled();
  });

  it('↓ link ölümü reportFailure(\'OBD\') bildirir (kanıtlanmış adaptör)', async () => {
    await establishConnection();
    M.reportFailure.mockClear();

    // Veri akışını kes: stale eşiği (max(12s, 15s×3+2s) = 47s) aşılınca link ölür.
    await vi.advanceTimersByTimeAsync(60_000);

    expect(M.reportFailure).toHaveBeenCalledWith('OBD');
  });

  it('tekrar eden yeniden bağlanma turu ÇOK sayıda çağrı üretir — circir koruması runtime tarafında ŞART', async () => {
    await establishConnection();
    M.reportFailure.mockClear();

    // Üstel tur (2/4/8/16/32 s) + derin döngü: kopuk dongle'da bu yol tekrar tekrar döner.
    await vi.advanceTimersByTimeAsync(180_000);

    /* Bu sayı BİLEREK sabitlenmiyor: mesele "kaç kere" değil, "birden çok kere".
       Yani obdService tek başına circiri engelleyemez → koruma AdaptiveRuntimeManager
       latch'inde olmak ZORUNDA (runtimeFailureRatchet.test.ts). */
    expect(M.reportFailure.mock.calls.length).toBeGreaterThan(1);
    expect(M.reportFailure.mock.calls.every(([c]) => c === 'OBD')).toBe(true);
  });
});
