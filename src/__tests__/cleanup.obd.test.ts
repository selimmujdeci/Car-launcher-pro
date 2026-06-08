/**
 * cleanup.obd.test.ts — T3: obdService kaynak temizliği.
 *
 * stopOBD() sonrası mock timer ve JS dinleyici kalıntısı olmamalı.
 * Native handle remove'u (yalnız native modda anlamlı) manuel/e2e checklist'e
 * bırakıldı — bu testte web/mock yolu doğrulanır. Production'a dokunulmaz.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/* ── Mock'lar (obdScenarios.test.ts ile aynı izole set) ── */
vi.hoisted(() => { process.env['VITE_ENABLE_OBD_MOCK'] = 'true'; });

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: vi.fn(() => false) },
}));
vi.mock('../platform/nativePlugin', () => ({
  CarLauncher: {
    scanOBD:                vi.fn().mockResolvedValue({ devices: [] }),
    connectOBD:             vi.fn().mockResolvedValue(undefined),
    disconnectOBD:          vi.fn().mockResolvedValue(undefined),
    addListener:            vi.fn().mockResolvedValue({ remove: vi.fn() }),
    startBackgroundService: vi.fn().mockResolvedValue(undefined),
    stopBackgroundService:  vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock('../platform/performanceMode', () => ({
  getConfig: vi.fn(() => ({ obdPollInterval: 50, obdListenerDebounce: 0, enableRecommendations: false, recCooldownMs: 999_999 })),
  onPerformanceModeChange: vi.fn(() => () => {}),
}));
vi.mock('../platform/canSnapshotService', () => ({
  hydrateCanSnapshotSync:  vi.fn(() => ({})),
  hydrateCanSnapshotAsync: vi.fn(() => Promise.resolve({})),
  scheduleCanSnapshot:     vi.fn(),
  flushCanSnapshotNow:     vi.fn(),
  stopCanSnapshot:         vi.fn(),
}));
vi.mock('../platform/obdBinaryParser', () => ({
  parseBinaryOBDFrame:    vi.fn(() => null),
  hasBinaryFrame:         vi.fn(() => false),
  clearAccumulatedBuffer: vi.fn(),
}));
vi.mock('../platform/rafSmoother', () => ({
  useRafSmoothed: vi.fn((val: number) => val),
}));
vi.mock('../core/runtime/AdaptiveRuntimeManager', () => ({
  runtimeManager: {
    getMode:   vi.fn(() => 'BALANCED'),
    getConfig: vi.fn(() => ({ obdPollingMs: 50, gpsUpdateMs: 200, uiFpsTarget: 60, enableBlur: false, enableAnimations: false, loggingLevel: 'silent' })),
    subscribe:     vi.fn(() => () => {}),
    reportFailure: vi.fn(),
  },
  AdaptiveRuntimeManager: { getInstance: vi.fn() },
}));
vi.mock('../platform/crashLogger', () => ({ logError: vi.fn() }));

/* ── Imports (mock'lardan sonra) ── */
import { startOBD, stopOBD, onOBDData, updateOBDData, type OBDData } from '../platform/obdService';
import { installTimerSpy } from './sim/leakHarness';

describe('T3 — obdService cleanup', () => {
  beforeEach(() => { stopOBD(); });
  afterEach(() => { stopOBD(); vi.clearAllMocks(); });

  it('onOBDData unsub sonrası bildirim gelmez (listener cleanup)', () => {
    const got: OBDData[] = [];
    const unsub = onOBDData((d) => got.push(d));

    updateOBDData({ speed: 50 });
    const afterFirst = got.length;
    expect(afterFirst).toBeGreaterThan(0);

    unsub();
    updateOBDData({ speed: 60 });
    expect(got.length).toBe(afterFirst); // unsub sonrası artış yok
  });

  it('startOBD → mock interval kurulur; stopOBD sonrası timer kalmaz', () => {
    const timers = installTimerSpy();
    try {
      onOBDData(() => {});
      startOBD(); // web/mock yolu senkron _startMock çağırır
      expect(timers.activeIntervals()).toBeGreaterThanOrEqual(1);

      stopOBD();
      expect(timers.activeIntervals()).toBe(0);
    } finally {
      timers.restore();
    }
  });

  it('stopOBD reconnect/stale/dataGate timer\'larını da temizler (çift stop güvenli)', () => {
    const timers = installTimerSpy();
    try {
      onOBDData(() => {});
      startOBD();
      stopOBD();
      stopOBD(); // idempotent
      expect(timers.activeIntervals()).toBe(0);
    } finally {
      timers.restore();
    }
  });
});
