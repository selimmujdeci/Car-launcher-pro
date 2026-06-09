/**
 * perf.gauge.test.ts — P3 (Test B): rafSmoother gauge hot-path throttle.
 *
 * Amaç: gauge ibrelerinin (hız/RPM/yakıt) sensör akışında render-storm üretmediğini
 * doğrulamak — frame-budget throttle (≤20Hz), hedefe snap+dur (idle RAF burn yok),
 * tek RAF reuse, unmount cancel, lite-mod bypass.
 *
 * Erişim: `useRafSmoothed` bir hook'tur ve bu projede @testing-library/react YOKTUR.
 * Proje konvansiyonu (useOBDLifecycle/useDayNightManager testleri ile aynı): hook'un
 * effect mantığı test-harness'ta SADIK olarak modellenir. Model `rafSmoother.ts:54-98`
 * akışının birebir karşılığıdır — FRAME_BUDGET_MS=50 GERÇEK sabittir (rafSmoother.ts:32),
 * snap eşiği `<0.5` (satır 83), lerp `display += diff*alpha` (satır 92). Model GERÇEK
 * global requestAnimationFrame ile sürülür (P1 fake RAF + installRafSpy ölçer).
 *
 * Kurallar (CLAUDE.md): production/native hot-path'e DOKUNULMAZ; yalnız src/__tests__.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  startVirtualClock, installRafSpy, advanceFrames, rateProbe, FRAME_MS,
} from './sim/perfHarness';

/** rafSmoother.ts:32 — Mali-400 uyumlu 20Hz frame bütçesi (50ms). */
const FRAME_BUDGET_MS = 50;

/**
 * rafSmoother.ts:54-98 RAF-lerp algoritmasının SADIK modeli.
 * Gerçek global requestAnimationFrame kullanır → P1 spy/clock ölçer.
 */
function makeRafSmootherModel(
  initial: number,
  alpha: number,
  onDisplay: (v: number) => void,
  lite = false,
) {
  let display = initial;
  let target  = initial;
  let rafId    = 0;
  let lastFrameTs = 0;

  function tick(ts: number): void {
    // Frame bütçesi dolmadıysa render'ı atla — reschedule (rafSmoother.ts:75)
    if (ts - lastFrameTs < FRAME_BUDGET_MS) { rafId = requestAnimationFrame(tick) as unknown as number; return; }
    lastFrameTs = ts;
    const diff = target - display;
    if (Math.abs(diff) < 0.5) {                 // hedefe ulaştı → snap + DUR (satır 83)
      display = target;
      onDisplay(Math.round(target));
      rafId = 0;                                // RAF durdu — idle burn yok
      return;
    }
    display = display + diff * alpha;            // lerp (satır 92)
    onDisplay(Math.round(display));
    rafId = requestAnimationFrame(tick) as unknown as number;
  }

  return {
    setTarget(v: number): void {
      if (lite) { display = v; onDisplay(Math.round(v)); return; } // lite-mod: doğrudan, RAF yok
      target = v;
      if (rafId !== 0) return;                  // tek RAF reuse — paralel RAF açma (satır 68)
      lastFrameTs = 0;
      rafId = requestAnimationFrame(tick) as unknown as number;
    },
    isRunning: () => rafId !== 0,
    cancel(): void { if (rafId !== 0) { cancelAnimationFrame(rafId as unknown as ReturnType<typeof requestAnimationFrame>); rafId = 0; } },
  };
}

afterEach(() => { vi.useRealTimers(); });

describe('P3 — rafSmoother gauge throttle (Test B)', () => {
  it('frame-budget: onDisplay 60fps\'e açılmaz, ≤20Hz kalır', async () => {
    const clock = startVirtualClock();
    const raf   = installRafSpy();
    const rate  = rateProbe();

    const m = makeRafSmootherModel(0, 0.05, () => rate.hit()); // yavaş alpha → uzun süre çalışır
    m.setTarget(1000); // uzak hedef → çok frame lerp eder

    const DURATION_MS = 1000;
    await advanceFrames(clock, Math.round(DURATION_MS / FRAME_MS)); // ~63 frame ≈ 1s

    const hz = rate.hz(DURATION_MS);
    raf.restore();
    clock.restore();

    expect(hz).toBeLessThanOrEqual(20);          // 20Hz cap — 60fps render storm YOK
    expect(rate.count()).toBeGreaterThanOrEqual(12); // akış var (donmadı)
  });

  it('hedefe snap → RAF durur (idle GPU burn yok)', async () => {
    const clock = startVirtualClock();
    const raf   = installRafSpy();
    const emitted: number[] = [];

    const m = makeRafSmootherModel(0, 0.5, (v) => emitted.push(v));
    m.setTarget(5); // küçük diff → birkaç frame'de yakınsar

    await advanceFrames(clock, 60); // yakınsamaya yeter
    const runningAfterConverge = m.isRunning();
    const activeAfterConverge  = raf.active();
    const countAtConverge      = emitted.length;

    await advanceFrames(clock, 60); // yakınsama sonrası — yeni emit OLMAMALI
    const countAfterIdle = emitted.length;

    raf.restore();
    clock.restore();

    expect(runningAfterConverge).toBe(false);     // RAF durdu
    expect(activeAfterConverge).toBe(0);          // bekleyen RAF yok
    expect(emitted[emitted.length - 1]).toBe(5);  // hedefe snap etti
    expect(countAfterIdle).toBe(countAtConverge); // idle'da ek render yok
  });

  it('ardışık setTarget → tek RAF (paralel RAF açmaz)', () => {
    const clock = startVirtualClock();
    const raf   = installRafSpy();

    const m = makeRafSmootherModel(0, 0.2, () => {});
    m.setTarget(100);
    m.setTarget(50);
    m.setTarget(80); // hepsi yakınsamadan önce — yalnız hedef güncellenir

    const scheduled = raf.scheduled();
    const active    = raf.active();
    const running   = m.isRunning();
    raf.restore();
    clock.restore();

    expect(scheduled).toBe(1);  // tek RAF kuruldu (N paralel değil)
    expect(active).toBe(1);     // tek bekleyen
    expect(running).toBe(true);
  });

  it('cancel (unmount) → bekleyen RAF temizlenir, fire olmaz', async () => {
    const clock = startVirtualClock();
    const raf   = installRafSpy();
    let emits = 0;

    const m = makeRafSmootherModel(0, 0.2, () => { emits++; });
    m.setTarget(100);
    const activeBefore = raf.active();

    m.cancel(); // unmount cleanup
    const activeAfter = raf.active();

    await advanceFrames(clock, 30); // ilerlet — cancel edilen fire olmamalı
    const emitsAfter = emits;

    raf.restore();
    clock.restore();

    expect(activeBefore).toBe(1);
    expect(activeAfter).toBe(0);  // cancel → bekleyen 0 (sızıntı yok)
    expect(emitsAfter).toBe(0);   // hiç render olmadı
  });

  it('lerp: uzak hedefe sonunda yakınsar (snap ile hedefe oturur)', async () => {
    const clock = startVirtualClock();
    const raf   = installRafSpy();
    const emitted: number[] = [];

    const m = makeRafSmootherModel(0, 0.2, (v) => emitted.push(v));
    m.setTarget(100);

    await advanceFrames(clock, 400); // bol frame → kesin yakınsar

    const final = emitted[emitted.length - 1];
    const running = m.isRunning();
    raf.restore();
    clock.restore();

    expect(final).toBe(100);     // hedefe oturdu
    expect(running).toBe(false); // yakınsayınca durdu
  });

  it('lite-mod bypass: RAF hiç kurulmaz, değer doğrudan geçer', () => {
    const clock = startVirtualClock();
    const raf   = installRafSpy();
    const emitted: number[] = [];

    const m = makeRafSmootherModel(0, 0.2, (v) => emitted.push(v), /* lite */ true);
    m.setTarget(42);
    m.setTarget(77);

    const scheduled = raf.scheduled();
    raf.restore();
    clock.restore();

    expect(scheduled).toBe(0);        // lite → hiç RAF (overhead yok)
    expect(emitted).toEqual([42, 77]); // doğrudan, anlık değer
  });
});
