/**
 * cleanup.services.test.ts — T3: telemetryService + memoryWatchdog + Zustand
 * store subscription kaynak temizliği.
 *
 * - telemetry.stop() → heartbeat/health interval kalmasın.
 * - memoryWatchdog.stop() → native listener + callback/cachePurge kalmasın.
 * - store.subscribe()/unsub → unsub sonrası notify gelmesin.
 * Production'a dokunulmaz; native CarLauncher mock no-op.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MockCarLauncher } from './sim/leakHarness';

const cap = vi.hoisted(() => ({ native: false }));
vi.mock('@capacitor/core', () => ({
  Capacitor:      { isNativePlatform: () => cap.native, getPlatform: () => 'web' },
  registerPlugin: () => ({}),
}));
vi.mock('../platform/nativePlugin', async () => {
  const { makeMockCarLauncher } = await import('./sim/leakHarness');
  const c = makeMockCarLauncher();
  (globalThis as unknown as { __SVC_CL__: MockCarLauncher }).__SVC_CL__ = c;
  return { CarLauncher: c.CarLauncher };
});
const cl = (): MockCarLauncher => (globalThis as unknown as { __SVC_CL__: MockCarLauncher }).__SVC_CL__;

vi.mock('../platform/cameraService', () => ({
  openRearCamera:  vi.fn().mockResolvedValue(undefined),
  closeRearCamera: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../utils/safeStorage', () => ({
  safeStorage:  { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  safeFlushKey: () => {},
  safeGetRaw:   () => null,
  safeSetRaw:   () => {},
}));

/* ── Imports (mock'lardan sonra) ── */
import { telemetryService } from '../platform/telemetryService';
import {
  startMemoryWatchdog, stopMemoryWatchdog, onMemoryPressure,
  registerCachePurge, _simulateMemoryPressureForTest,
} from '../platform/memoryWatchdog';
import { useUnifiedVehicleStore } from '../platform/vehicleDataLayer/UnifiedVehicleStore';
import { installTimerSpy, subscribeProbe } from './sim/leakHarness';
import type { VehicleSignalResolver } from '../platform/vehicleDataLayer/VehicleSignalResolver';

/* ── 1. telemetryService ── */
describe('T3 — telemetryService cleanup', () => {
  beforeEach(() => { telemetryService.stop(); });
  afterEach(() => { telemetryService.stop(); vi.clearAllMocks(); });

  it('start → heartbeat+health interval kurulur; stop sonrası kalmaz', () => {
    const timers = installTimerSpy();
    try {
      const fakeResolver = { onResolved: () => () => {} } as unknown as VehicleSignalResolver;
      telemetryService.start(fakeResolver);
      expect(timers.activeIntervals()).toBeGreaterThanOrEqual(2); // heartbeat + health

      telemetryService.stop();
      expect(timers.activeIntervals()).toBe(0);
    } finally {
      timers.restore();
    }
  });

  it('stop idempotent', () => {
    const fakeResolver = { onResolved: () => () => {} } as unknown as VehicleSignalResolver;
    telemetryService.start(fakeResolver);
    telemetryService.stop();
    expect(() => telemetryService.stop()).not.toThrow();
  });
});

/* ── 2. memoryWatchdog ── */
describe('T3 — memoryWatchdog cleanup', () => {
  beforeEach(() => { cap.native = true; cl().reset(); stopMemoryWatchdog(); });
  afterEach(() => { stopMemoryWatchdog(); cap.native = false; vi.clearAllMocks(); });

  it('onMemoryPressure unsub sonrası callback çağrılmaz', () => {
    let hits = 0;
    const unsub = onMemoryPressure(() => { hits++; });
    _simulateMemoryPressureForTest('MODERATE');
    expect(hits).toBe(1);
    unsub();
    _simulateMemoryPressureForTest('MODERATE');
    expect(hits).toBe(1);
  });

  it('registerCachePurge unsub sonrası purge çağrılmaz', () => {
    let purges = 0;
    const unsub = registerCachePurge(() => { purges++; });
    _simulateMemoryPressureForTest('CRITICAL');
    expect(purges).toBe(1);
    unsub();
    _simulateMemoryPressureForTest('CRITICAL');
    expect(purges).toBe(1);
  });

  it('start (native) → memoryPressure listener eklenir; stop sonrası kaldırılır', async () => {
    startMemoryWatchdog();
    await new Promise<void>((r) => setTimeout(r, 0)); // addListener.then microtask
    expect(cl().activeListeners('memoryPressure')).toBe(1);

    stopMemoryWatchdog();
    expect(cl().activeListeners('memoryPressure')).toBe(0);
  });

  it('stop sonrası kayıtlı callback temizlenir (simulate → no-op)', async () => {
    let hits = 0;
    onMemoryPressure(() => { hits++; });
    startMemoryWatchdog();
    await new Promise<void>((r) => setTimeout(r, 0));
    stopMemoryWatchdog(); // _callbacks.clear()
    _simulateMemoryPressureForTest('MODERATE');
    expect(hits).toBe(0);
  });
});

/* ── 3. Zustand store subscription ── */
describe('T3 — Zustand store subscription cleanup', () => {
  it('unsub sonrası notify gelmez; tekrar değişimde gelmez', () => {
    const store = useUnifiedVehicleStore;
    store.getState().updateVehicleState({ rpm: 1000 }); // baseline

    const probe = subscribeProbe(store);
    store.getState().updateVehicleState({ rpm: 1500 }); // değişti → 1
    expect(probe.count()).toBe(1);

    probe.unsub();
    store.getState().updateVehicleState({ rpm: 2000 }); // unsub sonrası → artmaz
    expect(probe.count()).toBe(1);
  });

  it('settled (aynı değer) → notify yaymaz (idle re-render yok)', () => {
    const store = useUnifiedVehicleStore;
    store.getState().updateVehicleState({ rpm: 3000 });
    const probe = subscribeProbe(store);
    store.getState().updateVehicleState({ rpm: 3000 }); // aynı → notify yok
    store.getState().updateVehicleState({ rpm: 3000 });
    expect(probe.count()).toBe(0);
    probe.unsub();
  });
});
