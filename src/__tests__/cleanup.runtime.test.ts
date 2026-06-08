/**
 * cleanup.runtime.test.ts — T3: AdaptiveRuntimeManager kaynak temizliği.
 *
 * destroy() sonrası worker/timer/listener kalmamalı; zombie worker terminate +
 * restart callback yolu doğrulanır. T7 runtimeSimulator yeniden kullanılır
 * (forceMode + makeMockWorker — kopya yok). Production'a dokunulmaz.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

/* ── Donanım mock (T7 ile aynı) ── */
const env = vi.hoisted(() => ({ tier: 'high' as 'low' | 'mid' | 'high', weakGpu: false }));
vi.mock('../platform/deviceCapabilities', () => ({ getDeviceTier: () => env.tier }));
vi.mock('../utils/detectWeakGpu', () => ({ hasWeakGpu: () => env.weakGpu, getGpuRenderer: () => '' }));
/* safeStorage: persist KAPALI — testler arası PERSIST_KEY taşınmasın
   (taşınırsa start() crash-recovery'ye girip zombie detection'ı atlar). */
vi.mock('../utils/safeStorage', () => ({
  safeStorage:  { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  safeFlushKey: () => {},
  safeGetRaw:   () => null,
  safeSetRaw:   () => {},
}));

import { AdaptiveRuntimeManager } from '../core/runtime/AdaptiveRuntimeManager';
import { RuntimeMode } from '../core/runtime/runtimeTypes';
import { forceMode, makeMockWorker } from './sim/runtimeSimulator';

afterEach(() => {
  vi.useRealTimers();
  AdaptiveRuntimeManager._resetForTest();
  env.tier = 'high'; env.weakGpu = false;
  vi.clearAllMocks();
});

describe('T3 — AdaptiveRuntimeManager cleanup', () => {
  it('destroy sonrası worker registry boşalır ve listener temizlenir', () => {
    const m = forceMode(RuntimeMode.BALANCED);
    const vehicle = makeMockWorker();
    const vision  = makeMockWorker();
    m.registerWorker('VehicleCompute', vehicle.worker, 'CRITICAL');
    m.registerWorker('VisionCompute',  vision.worker,  'OPTIONAL');

    let notify = 0;
    m.subscribe(() => { notify++; });
    m.setMode(RuntimeMode.SAFE_MODE, 'test'); // downgrade → anlık notify
    expect(notify).toBe(1);

    m.destroy();

    expect(m.getWorkers().size).toBe(0);
    // listener temizlendi: destroy sonrası mod değişimi bildirim yaymaz
    m.setMode(RuntimeMode.BASIC_JS, 'test');
    expect(notify).toBe(1);
  });

  it('destroy tüm worker\'lara terminate gönderir (CRITICAL dahil — kapanış)', () => {
    vi.useFakeTimers();
    const m = forceMode(RuntimeMode.BALANCED);
    const vehicle = makeMockWorker();
    const vision  = makeMockWorker();
    m.registerWorker('VehicleCompute', vehicle.worker, 'CRITICAL');
    m.registerWorker('VisionCompute',  vision.worker,  'OPTIONAL');

    m.destroy();
    vi.advanceTimersByTime(600); // 500ms gecikmeli terminate'leri çalıştır

    expect(vehicle.terminated()).toBe(true);
    expect(vision.terminated()).toBe(true);
  });

  it('zombie worker terminate edilir + restart callback tetiklenir', () => {
    vi.useFakeTimers();
    const m = forceMode(RuntimeMode.BALANCED);
    const restarts: string[] = [];
    m.setZombieRestartCallback((key) => restarts.push(key));
    m.start(); // zombie ping interval (10s)

    const zombie = makeMockWorker(); // PONG göndermez → ölü
    m.registerWorker('VisionCompute', zombie.worker, 'OPTIONAL');

    // 4 ping döngüsü: 3 PING (miss 1→3), 4. tikte zombie tespiti
    vi.advanceTimersByTime(10_000 * 4 + 100);

    expect(restarts).toContain('VisionCompute');
    expect(zombie.posted).toContainEqual({ type: 'PING' });
  });
});
