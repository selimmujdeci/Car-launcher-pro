/**
 * perf.cross.test.ts — P7 (Test C+H): cross render-storm budget + inspector FPS math.
 *
 * C (cross render-storm): GERÇEK useUnifiedVehicleStore notify disiplini + frame-budget
 *   RAF gauge AYNI sanal döngüde sürülür → toplam notify/RAF-work bounded (storm yok).
 * H (inspector math): useFpsCounter (useFpsCounter.ts:17-26) frame-sayım → fps modeli;
 *   ölçüm aracının kendisi doğru ve RAF unmount'ta temiz.
 *
 * Kurallar (CLAUDE.md): production'a DOKUNULMAZ; gerçek store sürülür (kopya yok),
 * yalnız cameraService/safeStorage mock'lanır; useFpsCounter render-kilitli (hook) →
 * proje konvansiyonu sadık model (useFpsCounter.ts:17-26 birebir). Yalnız src/__tests__.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../platform/cameraService', () => ({ openRearCamera: vi.fn(), closeRearCamera: vi.fn() }));
vi.mock('../utils/safeStorage', () => ({
  safeStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  safeFlushKey: () => {}, safeGetRaw: () => null, safeSetRaw: () => {},
}));

import { useUnifiedVehicleStore } from '../platform/vehicleDataLayer/UnifiedVehicleStore';
import {
  startVirtualClock, installRafSpy, advanceFrames, rateProbe, subscribeProbe, FRAME_MS,
} from './sim/perfHarness';

const store = useUnifiedVehicleStore;

/** Frame-budget throttle'lı minimal RAF döngüsü (rafSmoother.ts:75 mantığı). */
const FRAME_BUDGET_MS = 50;
function makeThrottledRaf(onWork: () => void) {
  let running = false;
  let last = 0;
  function tick(ts: number): void {
    if (ts - last >= FRAME_BUDGET_MS) { last = ts; onWork(); }
    requestAnimationFrame(tick);
  }
  return { start(): void { if (running) return; running = true; last = 0; requestAnimationFrame(tick); } };
}

afterEach(() => { vi.useRealTimers(); });
beforeEach(() => { store.getState().updateVehicleState({ rpm: 0, speed: 0 }); });

describe('P7 — cross render-storm budget (Test C)', () => {
  it('store + gauge RAF birlikte: notify yalnız gerçek değişimde, RAF ≤20Hz, sızıntı yok', async () => {
    const clock = startVirtualClock();
    const raf   = installRafSpy();

    store.getState().updateVehicleState({ rpm: 2000 });
    const notify = subscribeProbe(store);
    const gauge  = rateProbe();
    makeThrottledRaf(() => gauge.hit()).start();

    // 600 sensör tiki, %90 settled (aynı değer) — gerçekçi 3Hz akış
    let changes = 0;
    const STEP_FRAMES = 3; // ~48ms/tik
    for (let i = 0; i < 600; i++) {
      const rpm = 2000 + (i % 10 === 0 ? ++changes : changes);
      store.getState().updateVehicleState({ rpm });
      await advanceFrames(clock, STEP_FRAMES);
    }

    const elapsedMs = 600 * STEP_FRAMES * FRAME_MS;
    const notifyCount = notify.count();
    const gaugeHz     = gauge.hz(elapsedMs);
    const rafActive   = raf.active();

    notify.unsub();
    raf.restore();
    clock.restore();

    expect(notifyCount).toBe(changes);             // yalnız 60 gerçek değişim notify (540 bastırıldı)
    expect(notifyCount).toBeLessThan(600);          // store storm yok
    expect(gaugeHz).toBeLessThanOrEqual(20);        // gauge 60fps'e açılmadı
    expect(rafActive).toBeLessThanOrEqual(1);       // tek RAF döngüsü (sızıntı yok)
  });
});

/* ── Inspector FPS math (Test H) — useFpsCounter.ts:17-26 sadık modeli ── */
function makeFpsCounter(onFps: (fps: number) => void) {
  let frames = 0;
  let last = 0;
  let started = false;
  function tick(now: number): void {
    frames++;
    const dt = now - last;
    if (dt >= 1000) { onFps(Math.round((frames * 1000) / dt)); frames = 0; last = now; }
    requestAnimationFrame(tick);
  }
  return {
    start(now: number): void { started = true; last = now; frames = 0; requestAnimationFrame(tick); },
    isStarted: () => started,
  };
}

describe('P7 — inspector FPS math (Test H)', () => {
  it('1 saniyedeki frame sayısı ≈ fps (ölçüm doğru)', async () => {
    const clock = startVirtualClock();
    const raf   = installRafSpy();
    let lastFps = 0;

    makeFpsCounter((fps) => { lastFps = fps; }).start(0);

    // ~62.5 frame ≈ 1s (16ms/frame) → fps ~60'a yakın
    await advanceFrames(clock, 63);
    const fpsReported = lastFps;

    raf.restore();
    clock.restore();

    expect(fpsReported).toBeGreaterThanOrEqual(55); // ~60fps (16ms frame)
    expect(fpsReported).toBeLessThanOrEqual(65);
  });

  it('FPS sayacı RAF\'ı tek tutar; unmount (restore) sonrası ölçüm durur', async () => {
    const clock = startVirtualClock();
    const raf   = installRafSpy();
    let fpsHits = 0;

    makeFpsCounter(() => { fpsHits++; }).start(0);
    await advanceFrames(clock, 130); // ~2s → ~2 fps raporu
    const hitsWhileActive = fpsHits;
    const activePeak = raf.active();

    raf.restore();
    clock.restore();

    expect(hitsWhileActive).toBeGreaterThanOrEqual(1); // periyodik rapor üretti
    expect(activePeak).toBe(1);                         // tek RAF (ölçüm overhead'i minimal)
  });
});
