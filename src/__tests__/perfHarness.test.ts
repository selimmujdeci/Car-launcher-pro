/**
 * perfHarness.test.ts — P1: performans ölçüm motorunun self-test'i.
 *
 * Motorun kendisini doğrular (henüz gerçek perf testi yok — P2+):
 *   - Fake RAF köprüsü: advanceFrames RAF döngüsünü deterministik tikler.
 *   - RAF spy: scheduled/fired/active dengesi; cancel → active düşer; unmount sızıntısı.
 *   - rateProbe: efektif Hz ölçümü; frame-budget throttle'ı ≤ cap olarak görünür.
 *   - subscribeProbe re-export + makeMiniStore settled-guard.
 *
 * Production'a/native'e dokunulmaz; yalnız src/__tests__ araçları test edilir.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  startVirtualClock,
  installRafSpy,
  advanceFrames,
  framesMs,
  rateProbe,
  subscribeProbe,
  makeMiniStore,
  FRAME_MS,
} from './sim/perfHarness';

afterEach(() => { vi.useRealTimers(); });

describe('P1 — perfHarness fake RAF köprüsü', () => {
  it('advanceFrames self-rescheduling RAF\'ı tam N kez tetikler', async () => {
    const clock = startVirtualClock();
    const raf   = installRafSpy();

    let ticks = 0;
    const loop = (): void => { ticks++; requestAnimationFrame(loop); };
    requestAnimationFrame(loop); // ilk RAF (t=0 → ilk frame sınırında fire)

    await advanceFrames(clock, 10); // 10 frame ilerlet

    const fired  = raf.fired();
    const active = raf.active();
    raf.restore();
    clock.restore();

    expect(ticks).toBe(10);   // her frame'de bir tik
    expect(fired).toBe(10);   // spy de 10 fire saydı
    expect(active).toBe(1);   // 11. RAF beklemede (self-reschedule)
  });

  it('cancelAnimationFrame bekleyeni düşürür; fire olmaz (unmount sızıntısı yok)', async () => {
    const clock = startVirtualClock();
    const raf   = installRafSpy();

    let fired = 0;
    const id = requestAnimationFrame(() => { fired++; });
    const activeBefore = raf.active();
    cancelAnimationFrame(id);
    const activeAfter = raf.active();

    await advanceFrames(clock, 5); // ilerlet — cancel edilen fire olmamalı
    const firedAfter = fired;

    raf.restore();
    clock.restore();

    expect(activeBefore).toBe(1);
    expect(activeAfter).toBe(0);  // cancel → bekleyen 0
    expect(firedAfter).toBe(0);   // hiç fire olmadı
  });

  it('FRAME_MS / framesMs tutarlı (16ms ≈ 60fps)', () => {
    expect(FRAME_MS).toBe(16);
    expect(framesMs(10)).toBe(160);
  });
});

describe('P1 — perfHarness rateProbe (throttle cap ölçümü)', () => {
  it('frame-budget throttle\'lı RAF döngüsü cap altında Hz üretir', async () => {
    const clock = startVirtualClock();
    const raf   = installRafSpy();
    const rate  = rateProbe();

    // rafSmoother benzeri 50ms frame-budget throttle (FRAME_BUDGET_MS=50):
    // bütçe dolmadıysa render'ı ATLA, yine de RAF reschedule et.
    const BUDGET_MS = 50;
    let last = 0;
    const loop = (t: number): void => {
      if (t - last >= BUDGET_MS) { last = t; rate.hit(); } // "iş" dalı
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);

    const DURATION_MS = 1000;
    await advanceFrames(clock, Math.round(DURATION_MS / FRAME_MS)); // ~63 frame ≈ 1s

    const count = rate.count();
    const hz    = rate.hz(DURATION_MS);
    raf.restore();
    clock.restore();

    // 50ms bütçe + 16ms frame quantizasyonu → iş her ~64ms (4 frame) → ~15-16 Hz.
    // Kritik invariant: 20Hz cap AŞILMADI (60fps'e açılmadı).
    expect(hz).toBeLessThanOrEqual(20);     // cap altında
    expect(count).toBeGreaterThanOrEqual(12); // tamamen durmadı (akış var)
    expect(count).toBeLessThanOrEqual(20);
  });

  it('rateProbe.hz matematiği doğru', () => {
    const r = rateProbe();
    for (let i = 0; i < 30; i++) r.hit();
    expect(r.count()).toBe(30);
    expect(r.hz(1000)).toBe(30);  // 30 hit / 1s = 30Hz
    expect(r.hz(2000)).toBe(15);
    r.reset();
    expect(r.count()).toBe(0);
  });
});

describe('P1 — perfHarness notify probe (render-storm proxy)', () => {
  it('subscribeProbe + makeMiniStore: settled (aynı değer) → notify YOK', () => {
    const store = makeMiniStore(0);
    const probe = subscribeProbe(store);

    store.set(1);        // değişti → notify
    store.set(2);        // değişti → notify
    expect(probe.count()).toBe(2);

    store.set(2);        // aynı değer → settled guard → notify YOK
    store.set(2);
    expect(probe.count()).toBe(2);

    probe.unsub();
    store.set(3);        // unsub sonrası → notify gelmez
    expect(probe.count()).toBe(2);
  });

  it('N farklı update → ≤N notify (over-notify yok)', () => {
    const store = makeMiniStore(0);
    const probe = subscribeProbe(store);
    for (let i = 1; i <= 50; i++) store.set(i);
    expect(probe.count()).toBe(50); // her benzersiz değişim tam 1 notify
    probe.unsub();
  });
});
