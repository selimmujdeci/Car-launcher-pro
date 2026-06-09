/**
 * soak.runtime.test.ts — T4 Commit 4: runtime zombie + thermal stability.
 *
 * Amaç: GERÇEK AdaptiveRuntimeManager'ı 8 saat SANAL zamanda sürerek worker yaşam
 * döngüsü, zombie tespiti, thermal recovery, pending-terminate map, mod histerezisi
 * ve bellek baskısı yollarını timer/worker/listener sızıntısı açısından doğrulamak.
 * Gerçek bekleme YOK; T4 soakHarness + T7 runtimeSimulator (forceMode/makeMockWorker)
 * yeniden kullanılır.
 *
 * Kurallar (CLAUDE.md): production/native worker hot-path'e DOKUNULMAZ. GERÇEK
 * runtime sistemi sürülür (kopya yok); yalnız bağımlılıkları (deviceCapabilities /
 * detectWeakGpu / safeStorage) mock'lanır — cleanup.runtime.test.ts ile aynı set.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

/* ── Donanım/persist mock (T7 cleanup.runtime.test.ts ile aynı) ── */
const env = vi.hoisted(() => ({ tier: 'high' as 'low' | 'mid' | 'high', weakGpu: false }));
vi.mock('../platform/deviceCapabilities', () => ({ getDeviceTier: () => env.tier }));
vi.mock('../utils/detectWeakGpu', () => ({ hasWeakGpu: () => env.weakGpu, getGpuRenderer: () => '' }));
// safeStorage persist KAPALI: start() crash-recovery'ye girip SAFE_MODE'a sapmasın
// (PERSIST_KEY null → zombie detection normal başlar).
vi.mock('../utils/safeStorage', () => ({
  safeStorage:  { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  safeFlushKey: () => {},
  safeGetRaw:   () => null,
  safeSetRaw:   () => {},
}));

import { AdaptiveRuntimeManager } from '../core/runtime/AdaptiveRuntimeManager';
import { RuntimeMode } from '../core/runtime/runtimeTypes';
import {
  forceMode,
  makeMockWorker,
  captureRuntimeChecklist,
  startVirtualClock,
  installSoakProbes,
  runSoak,
  seriesOf,
  growth,
  peak,
  isBounded,
  SECONDS,
  MINUTES,
  HOURS,
} from './sim/soakHarness';
import { RUNTIME_CHECKLIST } from './sim/runtimeSimulator';

afterEach(() => {
  vi.useRealTimers();
  AdaptiveRuntimeManager._resetForTest();
  env.tier = 'high'; env.weakGpu = false;
  vi.clearAllMocks();
});

/** _pendingTerminateTimers private — test-only introspeksiyon (production'a dokunmaz). */
function pendingTerminateMap(m: AdaptiveRuntimeManager): Map<string, unknown> {
  return (m as unknown as { _pendingTerminateTimers: Map<string, unknown> })._pendingTerminateTimers;
}

describe('T4 — runtime zombie detection', () => {
  it('3 miss sonrası terminate + registry temizliği + restart callback', async () => {
    const clock = startVirtualClock();
    const m = forceMode(RuntimeMode.BALANCED);
    const restarts: string[] = [];
    m.setZombieRestartCallback((k) => restarts.push(k));
    m.start(); // zombie ping interval (10s)

    const zombie = makeMockWorker(); // PONG göndermez → ölü
    m.registerWorker('VisionCompute', zombie.worker, 'OPTIONAL');

    // 4 tik: PING×3 (miss 1→3), 4. tik zombie tespiti + terminate dispatch
    await clock.advance(SECONDS(10) * 4 + 100);
    const pinged   = zombie.posted.some((p) => (p as { type?: string }).type === 'PING');
    const stopped  = zombie.posted.some((p) => (p as { type?: string }).type === 'STOP');
    await clock.advance(600); // 500ms terminate-confirm timer
    const terminated = zombie.terminated();
    const workerRef  = m.getWorkers().get('VisionCompute')?.worker;

    clock.restore();

    expect(pinged).toBe(true);          // PING gönderildi
    expect(stopped).toBe(true);         // terminate başlatıldı (STOP)
    expect(restarts).toContain('VisionCompute'); // restart callback tetiklendi
    expect(terminated).toBe(true);      // 500ms sonra worker.terminate()
    expect(workerRef).toBeNull();       // registry'de worker referansı null
  });

  it('PONG alan worker zombie sayılmaz (miss sıfırlanır)', async () => {
    const clock = startVirtualClock();
    const m = forceMode(RuntimeMode.BALANCED);
    const restarts: string[] = [];
    m.setZombieRestartCallback((k) => restarts.push(k));
    m.start();

    const healthy = makeMockWorker();
    m.registerWorker('VisionCompute', healthy.worker, 'OPTIONAL');
    // PONG: her tik öncesi miss sıfırlanır → asla zombie olmaz
    healthy.worker.postMessage = (() => {}); // gönderimleri yok say
    const handler = (m as unknown as { _workerMsgHandlers: Map<string, (e: MessageEvent) => void> })
      ._workerMsgHandlers.get('VisionCompute');

    // 10 tik boyunca her seferinde PONG enjekte et
    for (let i = 0; i < 10; i++) {
      handler?.({ data: { type: 'PONG' } } as MessageEvent);
      await clock.advance(SECONDS(10));
    }
    const stillAlive = m.getWorkers().get('VisionCompute')?.worker;

    clock.restore();

    expect(restarts).toHaveLength(0);   // hiç zombie tespit edilmedi
    expect(stillAlive).not.toBeNull();  // worker hayatta
  });
});

describe('T4 — runtime thermal recovery', () => {
  it('de-escalation 30s recovery penceresi + tekrarlı döngüde timer tekil', async () => {
    const clock  = startVirtualClock();
    const probes = installSoakProbes();
    const m = forceMode(RuntimeMode.BALANCED);

    m.setThermalConstraint(2);                 // eskalasyon → ceiling BASIC_JS (anlık)
    const hot = m.getPowerCeiling();
    m.setThermalConstraint(1);                 // kurtarma → 30s recovery timer
    await clock.advance(SECONDS(29));
    const before30 = m.getPowerCeiling();      // hâlâ BASIC_JS (recovery bitmedi)
    await clock.advance(SECONDS(2));           // 31s → recovery fired
    const after30 = m.getPowerCeiling();       // BALANCED (level1 ceiling)

    // Tekrarlı escalate/de-escalate → recovery timer her zaman tekil
    let peakTimers = 0;
    for (let i = 0; i < 100; i++) {
      m.setThermalConstraint(2);
      m.setThermalConstraint(0);
      peakTimers = Math.max(peakTimers, probes.timers.activeTimeouts());
      await clock.advance(SECONDS(1));
    }

    probes.restore();
    clock.restore();

    expect(hot).toBe(RuntimeMode.BASIC_JS);
    expect(before30).toBe(RuntimeMode.BASIC_JS);
    expect(after30).toBe(RuntimeMode.BALANCED);
    expect(peakTimers).toBeLessThanOrEqual(1); // thermal recovery timer birikmez
  });
});

describe('T4 — runtime pending terminate map', () => {
  it('çoklu terminate döngüsünde map büyümez, işlem sonrası boşalır', async () => {
    const clock = startVirtualClock();
    const m = forceMode(RuntimeMode.BALANCED);
    const map = pendingTerminateMap(m);

    const workers = ['W1', 'W2', 'W3', 'W4'].map((k) => {
      const w = makeMockWorker();
      m.registerWorker(k, w.worker, 'OPTIONAL');
      return w;
    });

    m.handleMemoryPressure('CRITICAL'); // tümü terminate → 4 pending timer
    const sizeAfterTerminate = map.size;

    await clock.advance(600);            // 500ms terminate timer'ları fire → map kendini temizler
    const sizeAfterDrain = map.size;
    const allTerminated = workers.every((w) => w.terminated());

    clock.restore();

    expect(sizeAfterTerminate).toBe(4);  // her worker bir pending timer
    expect(sizeAfterDrain).toBe(0);      // fire sonrası map boş (sızıntı yok)
    expect(allTerminated).toBe(true);
  });
});

describe('T4 — runtime worker restart cycle', () => {
  it('8h terminate→recreate döngüsünde worker registry bounded kalır', async () => {
    const m = forceMode(RuntimeMode.BALANCED);
    m.setZombieRestartCallback(() => {});
    m.start();

    const result = await runSoak({
      durationMs: HOURS(8),
      stepMs:     MINUTES(5),
      onStep: () => {
        // Her adımda OPTIONAL worker'ı yeni mock ile yeniden kur (aynı key → registry sabit).
        m.registerWorker('VisionCompute', makeMockWorker().worker, 'OPTIONAL');
      },
      collect: () => ({ workers: m.getWorkers().size }),
    });

    const workersSeries = seriesOf(result, 'workers');
    const intervals     = seriesOf(result, 'intervals');
    const timeouts      = seriesOf(result, 'timeouts');
    result.teardown();

    expect(peak(workersSeries)).toBeLessThanOrEqual(1);   // tek key: VisionCompute
    // index0 = kayıttan önceki baseline; kayıt platosundan (slice(1)) sonra büyüme yok
    expect(growth(workersSeries.slice(1))).toBe(0);       // registry büyümüyor
    expect(peak(intervals)).toBeLessThanOrEqual(1);       // zombie interval tekil
    expect(isBounded(timeouts, 3)).toBe(true);          // terminate timer'ları transient
  });
});

describe('T4 — runtime mode stability (histerezis)', () => {
  it('downgrade anlık, upgrade 30s hysteresis, flip-flop yok', async () => {
    const clock = startVirtualClock();
    const m = forceMode(RuntimeMode.BASIC_JS);

    m.setMode(RuntimeMode.POWER_SAVE, 'user'); // 2→1 downgrade (anlık)
    const afterPS = m.getMode();
    m.setMode(RuntimeMode.SAFE_MODE, 'user');  // 1→0 downgrade (anlık)
    const afterSafe = m.getMode();

    m.setMode(RuntimeMode.BASIC_JS, 'user');   // 0→2 upgrade → 30s timer
    const duringUpgrade = m.getMode();          // hâlâ SAFE_MODE
    await clock.advance(SECONDS(29));
    const before30 = m.getMode();
    await clock.advance(SECONDS(2));            // 31s
    const after30 = m.getMode();                // BASIC_JS

    // Flip-flop önleme: upgrade beklerken downgrade gelirse upgrade iptal edilir
    m.setMode(RuntimeMode.PERFORMANCE, 'auto'); // upgrade timer kur
    m.setMode(RuntimeMode.SAFE_MODE, 'auto');   // downgrade → upgrade iptal + anlık SAFE
    const afterFlip = m.getMode();
    await clock.advance(SECONDS(35));
    const afterFlipWait = m.getMode();           // PERFORMANCE'a SIÇRAMADI

    clock.restore();

    expect(afterPS).toBe(RuntimeMode.POWER_SAVE);
    expect(afterSafe).toBe(RuntimeMode.SAFE_MODE);
    expect(duringUpgrade).toBe(RuntimeMode.SAFE_MODE);
    expect(before30).toBe(RuntimeMode.SAFE_MODE);
    expect(after30).toBe(RuntimeMode.BASIC_JS);
    expect(afterFlip).toBe(RuntimeMode.SAFE_MODE);
    expect(afterFlipWait).toBe(RuntimeMode.SAFE_MODE); // flip-flop yok
  });
});

describe('T4 — runtime memory pressure path', () => {
  it('MODERATE + CRITICAL: OPTIONAL kapanır, CRITICAL korunur', async () => {
    const clock = startVirtualClock();
    const m = forceMode(RuntimeMode.BALANCED);

    const vehicle = makeMockWorker(); // CRITICAL
    const vision  = makeMockWorker(); // OPTIONAL
    const nav     = makeMockWorker(); // OPTIONAL
    m.registerWorker('VehicleCompute',    vehicle.worker, 'CRITICAL');
    m.registerWorker('VisionCompute',     vision.worker,  'OPTIONAL');
    m.registerWorker('NavigationCompute', nav.worker,     'OPTIONAL');

    m.handleMemoryPressure('MODERATE');
    const visionAfterMod  = m.getWorkers().get('VisionCompute')?.worker;
    const navAfterMod     = m.getWorkers().get('NavigationCompute')?.worker;
    const vehicleAfterMod = m.getWorkers().get('VehicleCompute')?.worker;

    await clock.advance(600); // terminate timer'ları
    m.handleMemoryPressure('CRITICAL'); // CRITICAL korunmaya devam eder
    const vehicleFinal = m.getWorkers().get('VehicleCompute')?.worker;

    clock.restore();

    expect(visionAfterMod).toBeNull();       // OPTIONAL sonlandırıldı
    expect(navAfterMod).toBeNull();          // OPTIONAL sonlandırıldı
    expect(vehicleAfterMod).not.toBeNull();  // CRITICAL korundu
    expect(vehicleFinal).not.toBeNull();     // CRITICAL baskı sonrası da hayatta
    expect(vision.terminated()).toBe(true);
    expect(vehicle.terminated()).toBe(false); // CRITICAL asla terminate edilmez
  });
});

describe('T4 — runtime inspector consistency', () => {
  it('captureRuntimeChecklist 8h sonra mod matrisiyle uyumlu (BASIC_JS)', async () => {
    const clock = startVirtualClock();
    const m = forceMode(RuntimeMode.BASIC_JS);
    m.start();

    await clock.advance(HOURS(8));
    const snap = captureRuntimeChecklist(m);

    clock.restore();

    const expected = RUNTIME_CHECKLIST[RuntimeMode.BASIC_JS];
    expect(snap.mode).toBe(RuntimeMode.BASIC_JS);
    expect(snap.enableBlur).toBe(expected.enableBlur);
    expect(snap.enableAnimations).toBe(expected.enableAnimations);
    expect(snap.suspendWorkers).toBe(expected.suspendWorkers);
    expect(snap.uiFpsTarget).toBe(expected.uiFpsTarget);
    expect(snap.blurOn).toBe(expected.enableBlur); // CSS --rt-blur ile config tutarlı
  });
});

describe('T4 — runtime 8h aggregate leak', () => {
  it('timer/worker/listener bounded; growth sınırsız artış göstermez', async () => {
    const m = forceMode(RuntimeMode.BALANCED);
    m.setZombieRestartCallback(() => {});
    m.start();
    m.registerWorker('VehicleCompute', makeMockWorker().worker, 'CRITICAL'); // hep yaşar

    const result = await runSoak({
      durationMs: HOURS(8),
      stepMs:     MINUTES(5),
      onStep: ({ index }) => {
        // Periyodik perturbasyon: optional recreate + bellek baskısı + termal döngü
        m.registerWorker('VisionCompute', makeMockWorker().worker, 'OPTIONAL');
        if (index % 3 === 0) m.handleMemoryPressure('MODERATE');
        if (index % 5 === 0) { m.setThermalConstraint(2); m.setThermalConstraint(0); }
      },
      collect: () => ({ workers: m.getWorkers().size }),
    });

    const intervals    = seriesOf(result, 'intervals');
    const timeouts     = seriesOf(result, 'timeouts');
    const workers      = seriesOf(result, 'workers');
    const winListeners = seriesOf(result, 'windowListeners');
    result.teardown();

    expect(peak(intervals)).toBeLessThanOrEqual(1);   // zombie interval tek
    expect(isBounded(timeouts, 3)).toBe(true);         // terminate/thermal transient bounded
    expect(peak(workers)).toBeLessThanOrEqual(2);      // VehicleCompute + VisionCompute
    // index0 = VisionCompute kaydından önceki baseline; plato sonrası (slice(1)) büyüme yok
    expect(growth(workers.slice(1))).toBe(0);          // registry büyümüyor
    expect(isBounded(winListeners, 0)).toBe(true);     // window listener eklenmiyor
  });
});
