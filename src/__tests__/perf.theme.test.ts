/**
 * perf.theme.test.ts — P4 (Test D): theme switch storm guard.
 *
 * Amaç: tema değişiminde "transition fırtınası" (binlerce elemanda eşzamanlı
 * color/background transition → jank) engellenmiş mi doğrulamak. useCarTheme
 * `theme-switching` render guard'ı swap frame'inde transition'ları bastırır,
 * 2× requestAnimationFrame sonra kaldırır (useCarTheme.ts:82-109).
 *
 * Erişim: `applyTheme` private ama GERÇEK `useCarTheme.getState().setTheme()`
 * üzerinden çağrılır → gerçek kod yolu sürülür (model değil). DOM mutasyonu
 * jsdom'da gözlemlenir; 2× RAF P1 fake RAF ile deterministik tiklenir.
 *
 * Kurallar (CLAUDE.md): production/native hot-path'e DOKUNULMAZ; yalnız src/__tests__.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { useCarTheme } from '../store/useCarTheme';
import { startVirtualClock, installRafSpy, advanceFrames } from './sim/perfHarness';

const root = document.documentElement;

afterEach(() => {
  vi.useRealTimers();
  root.classList.remove('theme-switching');
});

describe('P4 — theme switch storm guard (Test D)', () => {
  it('setTheme → theme-switching eklenir, data-theme atomik set, 2 RAF sonra kaldırılır', async () => {
    const clock = startVirtualClock();
    const raf   = installRafSpy();
    root.classList.remove('theme-switching');

    useCarTheme.getState().setTheme('horizon');
    const guardAfterSet = root.classList.contains('theme-switching');
    const dataTheme     = root.getAttribute('data-theme'); // atomik (RAF beklemez)

    await advanceFrames(clock, 1);                  // 1. RAF — henüz kalkmadı
    const guardAfter1 = root.classList.contains('theme-switching');
    await advanceFrames(clock, 1);                  // 2. RAF — kalkar
    const guardAfter2 = root.classList.contains('theme-switching');

    raf.restore();
    clock.restore();

    expect(guardAfterSet).toBe(true);   // swap frame'inde transition bastırıldı
    expect(dataTheme).toBe('horizon');  // data-theme anında set (atomik)
    expect(guardAfter1).toBe(true);     // tek RAF sonra hâlâ aktif (recalc/paint sürüyor)
    expect(guardAfter2).toBe(false);    // 2 RAF sonra geçişler geri açıldı
  });

  it('ardışık hızlı swap → guard tekil (birikmez), 2 RAF sonra temiz', async () => {
    const clock = startVirtualClock();
    const raf   = installRafSpy();
    root.classList.remove('theme-switching');

    useCarTheme.getState().setTheme('expedition');
    useCarTheme.getState().setTheme('horizon');
    useCarTheme.getState().setTheme('tesla'); // RAF'lar dolmadan ardışık

    // classList bir küme — guard tek kez eklenir (binlerce elemanda tek bastırma)
    const guardCount = root.classList.contains('theme-switching') ? 1 : 0;
    const dataTheme  = root.getAttribute('data-theme');

    await advanceFrames(clock, 2); // tüm zincirlerin 2. RAF'ı dolar
    const guardAfter = root.classList.contains('theme-switching');

    raf.restore();
    clock.restore();

    expect(guardCount).toBe(1);             // tekil guard
    expect(dataTheme).toBe('tesla');        // son tema kazanır
    expect(guardAfter).toBe(false);         // birikmedi — temiz kalktı
  });

  it('guard kaldırıldıktan sonra bekleyen RAF kalmaz (sızıntı yok)', async () => {
    const clock = startVirtualClock();
    const raf   = installRafSpy();
    root.classList.remove('theme-switching');

    const activeBefore = raf.active();
    useCarTheme.getState().setTheme('horizon-day');
    await advanceFrames(clock, 3); // guard kalkar + zincir biter
    const activeAfter = raf.active();

    raf.restore();
    clock.restore();

    expect(root.classList.contains('theme-switching')).toBe(false);
    expect(activeAfter).toBe(activeBefore); // RAF zinciri tamamen tüketildi
  });
});
