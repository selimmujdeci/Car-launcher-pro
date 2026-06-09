/**
 * perf.media-worker.test.ts — P6 (Test F+G): media blur gating + worker/main-thread budget.
 *
 * F (media blur): GERÇEK computeMediaBlurOff (MediaScreen.tsx:608 birebir mantığı,
 *   runtimeSimulator'da) — `!getRuntimeConfig(mode).enableBlur || isLowEndDevice()`.
 *   Mali-400'de en pahalı ekran; blur low-end'de kapanmalı, iframe yalnız
 *   `playing && !blurOff` mount olmalı.
 * G (worker budget): GERÇEK getRuntimeConfig + forceMode — mod düştükçe main-thread
 *   yükü azalır (uiFpsTarget, animations); SAFE_MODE'da suspendWorkers.
 *
 * Kurallar (CLAUDE.md): production'a DOKUNULMAZ; gerçek config/mantık sürülür,
 * yalnız bağımlılıklar (headUnitCompat/deviceCapabilities/detectWeakGpu/safeStorage)
 * mock'lanır; yalnız src/__tests__.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

/* ── Bağımlılık mock'ları ── */
const lowEnd = vi.hoisted(() => ({ value: false }));
vi.mock('../platform/headUnitCompat', () => ({ isLowEndDevice: () => lowEnd.value }));
const env = vi.hoisted(() => ({ tier: 'high' as 'low' | 'mid' | 'high', weakGpu: false }));
vi.mock('../platform/deviceCapabilities', () => ({ getDeviceTier: () => env.tier }));
vi.mock('../utils/detectWeakGpu', () => ({ hasWeakGpu: () => env.weakGpu, getGpuRenderer: () => '' }));
vi.mock('../utils/safeStorage', () => ({
  safeStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  safeFlushKey: () => {}, safeGetRaw: () => null, safeSetRaw: () => {},
}));

import { RuntimeMode } from '../core/runtime/runtimeTypes';
import { getRuntimeConfig } from '../core/runtime/runtimeConfig';
import { AdaptiveRuntimeManager } from '../core/runtime/AdaptiveRuntimeManager';
import { forceMode, computeMediaBlurOff } from './sim/perfHarness';

const ALL_MODES = [
  RuntimeMode.PERFORMANCE, RuntimeMode.BALANCED, RuntimeMode.BASIC_JS,
  RuntimeMode.POWER_SAVE, RuntimeMode.SAFE_MODE,
] as const;

afterEach(() => {
  vi.useRealTimers();
  AdaptiveRuntimeManager._resetForTest();
  lowEnd.value = false; env.tier = 'high'; env.weakGpu = false;
  vi.clearAllMocks();
});

describe('P6 — media blur gating (Test F)', () => {
  it('blurOff matrisi: high-end\'de enableBlur\'a bağlı, low-end\'de daima kapalı', () => {
    // High-end (isLowEndDevice=false): blurOff = !enableBlur
    lowEnd.value = false;
    expect(computeMediaBlurOff(RuntimeMode.PERFORMANCE)).toBe(false); // blur açık
    expect(computeMediaBlurOff(RuntimeMode.BALANCED)).toBe(false);    // blur açık
    expect(computeMediaBlurOff(RuntimeMode.BASIC_JS)).toBe(true);     // enableBlur=false → kapalı
    expect(computeMediaBlurOff(RuntimeMode.POWER_SAVE)).toBe(true);
    expect(computeMediaBlurOff(RuntimeMode.SAFE_MODE)).toBe(true);

    // Low-end (isLowEndDevice=true): blurOff TÜM modlarda kapalı (Mali-400 koruması)
    lowEnd.value = true;
    for (const m of ALL_MODES) expect(computeMediaBlurOff(m)).toBe(true);
  });

  it('ambient blur(64px) ve iframe yalnız playing && !blurOff iken mount olur', () => {
    // MediaScreen.tsx:678 — {playing && !blurOff && <iframe/>}
    const shouldMountHeavy = (playing: boolean, blurOff: boolean): boolean => playing && !blurOff;

    lowEnd.value = true; // low-end
    expect(shouldMountHeavy(true, computeMediaBlurOff(RuntimeMode.BALANCED))).toBe(false); // low-end → mount yok
    lowEnd.value = false;
    expect(shouldMountHeavy(true,  computeMediaBlurOff(RuntimeMode.BALANCED))).toBe(true);  // high-end + playing → mount
    expect(shouldMountHeavy(false, computeMediaBlurOff(RuntimeMode.BALANCED))).toBe(false); // çalmıyor → mount yok
    expect(shouldMountHeavy(true,  computeMediaBlurOff(RuntimeMode.BASIC_JS))).toBe(false); // blur kapalı → mount yok
  });
});

describe('P6 — worker / main-thread budget (Test G)', () => {
  it('uiFpsTarget mod düştükçe artmaz (main-thread render bütçesi azalır)', () => {
    const fps = ALL_MODES.map((m) => getRuntimeConfig(m).uiFpsTarget);
    // PERFORMANCE 60 ≥ BALANCED 30 ≥ BASIC_JS 20 ≥ POWER_SAVE 15 ; SAFE_MODE 15
    expect(fps).toEqual([60, 30, 20, 15, 15]);
    for (let i = 1; i < fps.length; i++) expect(fps[i]).toBeLessThanOrEqual(fps[i - 1]);
  });

  it('düşük modlarda animasyon kapalı (JS animation loop CPU yükü kalkar)', () => {
    expect(getRuntimeConfig(RuntimeMode.PERFORMANCE).enableAnimations).toBe(true);
    expect(getRuntimeConfig(RuntimeMode.BALANCED).enableAnimations).toBe(true);
    expect(getRuntimeConfig(RuntimeMode.BASIC_JS).enableAnimations).toBe(false);
    expect(getRuntimeConfig(RuntimeMode.POWER_SAVE).enableAnimations).toBe(false);
    expect(getRuntimeConfig(RuntimeMode.SAFE_MODE).enableAnimations).toBe(false);
  });

  it('suspendWorkers yalnız SAFE_MODE\'da (RAM krizinde worker durdurulur)', () => {
    for (const m of ALL_MODES) {
      const expected = m === RuntimeMode.SAFE_MODE;
      expect(getRuntimeConfig(m).suspendWorkers).toBe(expected);
    }
  });

  it('forceMode(SAFE_MODE): gerçek manager config\'inde suspendWorkers aktif', () => {
    const m = forceMode(RuntimeMode.SAFE_MODE);
    expect(m.getMode()).toBe(RuntimeMode.SAFE_MODE);
    expect(m.getConfig().suspendWorkers).toBe(true);
    expect(m.getConfig().uiFpsTarget).toBe(15);
    expect(m.getConfig().enableAnimations).toBe(false);
  });

  it('OBD polling mod düştükçe seyrelir (worker/main-thread tik yükü azalır)', () => {
    // BALANCED 3s ≤ BASIC_JS 5s ≤ POWER_SAVE 15s ; PERFORMANCE en sık (1s)
    expect(getRuntimeConfig(RuntimeMode.PERFORMANCE).obdPollingMs).toBe(1_000);
    expect(getRuntimeConfig(RuntimeMode.BALANCED).obdPollingMs).toBe(3_000);
    expect(getRuntimeConfig(RuntimeMode.BASIC_JS).obdPollingMs).toBe(5_000);
    // düşük modlar yüksek modlardan seyrek poll eder
    expect(getRuntimeConfig(RuntimeMode.BASIC_JS).obdPollingMs)
      .toBeGreaterThanOrEqual(getRuntimeConfig(RuntimeMode.BALANCED).obdPollingMs);
  });
});
