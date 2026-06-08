/**
 * cleanup.can.test.ts — T3: CanAdapter kaynak temizliği.
 *
 * start() yalnız native modda timer/listener kurar → isNative mock'lanır.
 * stop() sonrası first-frame timer ve canData native handle kalmamalı.
 * Gerçek CAN bağlantı davranışı DEĞİŞTİRİLMEZ (mock CarLauncher no-op).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { MockCarLauncher } from './sim/leakHarness';

/* ── bridge: native mod ── */
vi.mock('../platform/bridge', () => ({
  isNative: true,
  isDemo:   false,
  launcherMode: 'android',
  bridge:      { isNative: true },
  nativeBridge: {},
  demoBridge:   {},
  vehicleCommandQueue: { enqueue: vi.fn() },
}));

/* ── nativePlugin: leakHarness mock CarLauncher (kopya yok) ──
   Hoisted factory TDZ'den kaçınmak için handle globalThis'e yazılır. */
vi.mock('../platform/nativePlugin', async () => {
  const { makeMockCarLauncher } = await import('./sim/leakHarness');
  const cl = makeMockCarLauncher();
  (globalThis as unknown as { __CAN_CL__: MockCarLauncher }).__CAN_CL__ = cl;
  return { CarLauncher: cl.CarLauncher };
});
const cl = (): MockCarLauncher => (globalThis as unknown as { __CAN_CL__: MockCarLauncher }).__CAN_CL__;

/* ── debug + cameraService no-op ── */
vi.mock('../platform/debug', () => ({
  dbgPushCanRaw:     vi.fn(),
  dbgUpdateCanExtras: vi.fn(),
}));
vi.mock('../platform/cameraService', () => ({
  openRearCamera:  vi.fn().mockResolvedValue(undefined),
  closeRearCamera: vi.fn().mockResolvedValue(undefined),
}));
/* safeStorage: senkron mock — store persist debounce timer'ı sayıma karışmasın
   (o timer store'a ait, CanAdapter sızıntısı değil). */
vi.mock('../utils/safeStorage', () => {
  const mem = new Map<string, string>();
  return {
    safeStorage:  {
      getItem:    (k: string) => mem.get(k) ?? null,
      setItem:    (k: string, v: string) => { mem.set(k, v); },
      removeItem: (k: string) => { mem.delete(k); },
    },
    safeFlushKey: () => {},
    safeGetRaw:   (k: string) => mem.get(k) ?? null,
    safeSetRaw:   (k: string, v: string) => { mem.set(k, v); },
  };
});

/* ── Imports (mock'lardan sonra) ── */
import { CanAdapter } from '../platform/vehicleDataLayer/CanAdapter';
import { installTimerSpy } from './sim/leakHarness';

/** addListener('canData').then(...) microtask'ını boşalt. */
function flush(): Promise<void> {
  return new Promise<void>((r) => setTimeout(r, 0));
}

afterEach(() => { vi.clearAllMocks(); cl().reset(); });

describe('T3 — CanAdapter cleanup', () => {
  it('start → first-frame timer kurulur; stop sonrası timer kalmaz', async () => {
    const timers = installTimerSpy();
    try {
      const ca = new CanAdapter();
      ca.start();
      await flush(); // _unsub set olsun + flush timeout fire+remove

      expect(timers.activeTimeouts()).toBe(1); // 30s first-frame watchdog
      ca.stop();
      expect(timers.activeTimeouts()).toBe(0);
    } finally {
      timers.restore();
    }
  });

  it('stop sonrası canData native handle kaldırılır', async () => {
    const ca = new CanAdapter();
    ca.start();
    await flush();

    expect(cl().activeListeners('canData')).toBe(1);
    ca.stop();
    expect(cl().activeListeners('canData')).toBe(0);
    // canStatus bilinçli fire-and-forget (production davranışı) — handle saklanmaz.
    expect(cl().activeListeners('canStatus')).toBe(1);
  });

  it('onData unsub bir fonksiyon döner; çift stop güvenli', async () => {
    const ca = new CanAdapter();
    const unsub = ca.onData(() => {});
    expect(typeof unsub).toBe('function');
    ca.start();
    await flush();
    ca.stop();
    expect(() => { ca.stop(); unsub(); }).not.toThrow();
  });
});
