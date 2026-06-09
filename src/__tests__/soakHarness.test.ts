/**
 * soakHarness.test.ts — T4 Commit 1: sanal-saat soak motorunun self-test'i.
 *
 * Motorun kendisini doğrular (henüz servis soak'u yok — Commit 2+):
 *   - 8 saat sanal sürede Date + performance birlikte ilerliyor (gerçek bekleme yok).
 *   - T3 leakHarness timer/listener dengesi fake timer altında doğru sayılıyor.
 *   - runSoak orkestratörü yük enjekte ediyor + zaman serisi topluyor.
 *   - Sızıntı (clear edilmemiş interval) zaman serisinde görünür hale geliyor.
 *   - T7 makeMockWorker sanal zaman boyunca sürülebiliyor (yeniden kullanım).
 *
 * Production'a / native'e dokunulmaz; yalnız src/__tests__ altındaki araçlar test edilir.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  startVirtualClock,
  installSoakProbes,
  runSoak,
  seriesOf,
  growth,
  peak,
  isBounded,
  makeMockWorker,
  SECONDS,
  MINUTES,
  HOURS,
} from './sim/soakHarness';

afterEach(() => {
  // Bir test restore etmeden çökerse bile sonraki testi koru.
  vi.useRealTimers();
});

describe('T4 — soakHarness sanal saat', () => {
  it('8 saati sanal olarak sıkıştırır: Date + performance birlikte ilerler', async () => {
    const clock = startVirtualClock();
    const d0 = Date.now();
    const p0 = performance.now();

    await clock.advance(HOURS(8));

    expect(Date.now() - d0).toBe(HOURS(8));        // fake Date ilerledi
    expect(performance.now() - p0).toBe(HOURS(8)); // fake performance senkron
    expect(clock.elapsed()).toBe(HOURS(8));        // monotonik Δ tutarlı
    clock.restore();
  });

  it('restore sonrası gerçek timer\'lara döner', () => {
    const clock = startVirtualClock();
    expect(vi.isFakeTimers()).toBe(true);
    clock.restore();
    expect(vi.isFakeTimers()).toBe(false);
  });
});

describe('T4 — soakHarness sızıntı probe\'ları (T3 reuse)', () => {
  it('setInterval 8 saat boyunca doğru sayıda fire eder ve tek aktif kalır', async () => {
    const clock  = startVirtualClock();
    const probes = installSoakProbes();

    let fires = 0;
    const id = setInterval(() => { fires++; }, SECONDS(5));
    expect(probes.timers.activeIntervals()).toBe(1);

    await clock.advance(HOURS(8));

    expect(fires).toBe(HOURS(8) / SECONDS(5)); // 5760 fire
    expect(probes.timers.activeIntervals()).toBe(1); // hâlâ tek interval (sızıntı yok)

    clearInterval(id);
    expect(probes.timers.activeIntervals()).toBe(0); // clear → sıfır kalıntı

    probes.restore();
    clock.restore();
  });

  it('setTimeout fire olunca aktif sayımdan düşer (kalıntı bırakmaz)', async () => {
    const clock  = startVirtualClock();
    const probes = installSoakProbes();

    setTimeout(() => {}, SECONDS(30));
    expect(probes.timers.activeTimeouts()).toBe(1);

    await clock.advance(SECONDS(31));
    expect(probes.timers.activeTimeouts()).toBe(0);

    probes.restore();
    clock.restore();
  });

  it('window listener dengesini sayar (add/remove)', () => {
    const clock  = startVirtualClock();
    const probes = installSoakProbes();

    const handler = (): void => {};
    window.addEventListener('resize', handler);
    expect(probes.windowListeners.active('resize')).toBe(1);

    window.removeEventListener('resize', handler);
    expect(probes.windowListeners.active('resize')).toBe(0);

    probes.restore();
    clock.restore();
  });
});

describe('T4 — soakHarness orkestratör (runSoak)', () => {
  it('her adımda yük enjekte eder ve zaman serisi toplar', async () => {
    let counter = 0;
    const result = await runSoak({
      durationMs: HOURS(2),
      stepMs:     MINUTES(30),
      onStep:     () => { counter++; },
      collect:    () => ({ counter }),
    });

    expect(result.steps).toBe(4);
    expect(result.samples.length).toBe(5);              // baseline + 4 adım
    expect(result.last.custom.counter).toBe(4);
    expect(seriesOf(result, 'counter')).toEqual([0, 1, 2, 3, 4]);

    result.teardown();
  });

  it('clear edilmeyen interval sızıntısını zaman serisinde ortaya çıkarır', async () => {
    const ids: Array<ReturnType<typeof setInterval>> = [];
    const result = await runSoak({
      durationMs: MINUTES(5),
      stepMs:     MINUTES(1),
      onStep:     () => { ids.push(setInterval(() => {}, SECONDS(10))); },
    });

    const intervals = seriesOf(result, 'intervals');
    expect(intervals).toEqual([0, 1, 2, 3, 4, 5]); // her adımda +1, hiç clear yok
    expect(growth(intervals)).toBe(5);
    expect(isBounded(intervals, 1)).toBe(false);   // sınırsız büyüme = sızıntı

    ids.forEach(clearInterval);
    result.teardown();
  });

  it('sabit (leak-free) seriyi büyüme olmadan raporlar', async () => {
    const result = await runSoak({
      durationMs: MINUTES(4),
      stepMs:     MINUTES(1),
      // onStep yok → hiç timer eklenmez
    });

    const intervals = seriesOf(result, 'intervals');
    const timeouts  = seriesOf(result, 'timeouts');
    expect(growth(intervals)).toBe(0);
    expect(growth(timeouts)).toBe(0);
    expect(isBounded(intervals, 0)).toBe(true);

    result.teardown();
  });
});

describe('T4 — soakHarness analiz yardımcıları', () => {
  it('growth / peak / isBounded doğru hesaplar', () => {
    expect(growth([3, 3, 3])).toBe(0);
    expect(growth([1, 5, 9])).toBe(8);
    expect(peak([1, 9, 4])).toBe(9);
    expect(isBounded([10, 11, 10, 12], 2)).toBe(true);
    expect(isBounded([10, 20, 30], 2)).toBe(false);
  });
});

describe('T4 — soakHarness T7 reuse (makeMockWorker)', () => {
  it('sanal zaman boyunca worker\'ı sürer; terminate sonrası durur', async () => {
    const clock = startVirtualClock();
    const { worker, posted, terminated } = makeMockWorker();

    const id = setInterval(() => worker.postMessage({ type: 'PING' }), SECONDS(10));
    await clock.advance(MINUTES(1));
    expect(posted.length).toBe(6); // 60s / 10s

    clearInterval(id);
    worker.terminate();
    expect(terminated()).toBe(true);

    await clock.advance(MINUTES(1));
    expect(posted.length).toBe(6); // interval durdu → yeni mesaj yok

    clock.restore();
  });
});
