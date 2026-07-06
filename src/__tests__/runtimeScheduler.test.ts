/**
 * runtimeScheduler.test.ts — FAZ 13/16: §L.0 Hibrit Runtime Scheduler (tek tick-wheel).
 *
 * docs/CAROS_VEHICLE_INTELLIGENCE_ARCHITECTURE.md:1176-1241.
 * FAZ 16: API `freqClass` (4 sabit sınıf) yerine `periodMs` (görevin kendi
 * gerçek periyodu) tabanına çevrildi — eski sınıf modeli >15s'lik periyotları
 * (community sync 5dk vb.) temsil edemiyordu ve onları sessizce HIZLANDIRIYORDU.
 * Artık BALANCED/PERFORMANCE'ta (mod çarpanı=1) `periodMs` AYNEN uygulanır;
 * yalnız düşük-tier'da mod çarpanıyla yavaşlar. SAFETY bu çarpandan muaftır.
 *
 * Donanım mock'ları cleanup.runtime.test.ts / soak.runtime.test.ts ile AYNI
 * (tier='high' → BALANCED baseline; persist kapalı → crash-recovery devre dışı).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

/* ── Donanım/persist mock (diğer runtime testleriyle aynı) ── */
const env = vi.hoisted(() => ({ tier: 'high' as 'low' | 'mid' | 'high', weakGpu: false }));
vi.mock('../platform/deviceCapabilities', () => ({ getDeviceTier: () => env.tier }));
vi.mock('../utils/detectWeakGpu', () => ({ hasWeakGpu: () => env.weakGpu, getGpuRenderer: () => '' }));
vi.mock('../utils/safeStorage', () => ({
  safeStorage:  { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  safeFlushKey: () => {},
  safeGetRaw:   () => null,
  safeSetRaw:   () => {},
}));

import { AdaptiveRuntimeManager } from '../core/runtime/AdaptiveRuntimeManager';
import { RuntimeMode } from '../core/runtime/runtimeTypes';
import { forceMode } from './sim/runtimeSimulator';

afterEach(() => {
  vi.useRealTimers();
  AdaptiveRuntimeManager._resetForTest();
  env.tier = 'high'; env.weakGpu = false;
  vi.clearAllMocks();
});

describe('FAZ 16 — scheduleTask periodMs kadansı (BALANCED = mod çarpanı 1, periodMs AYNEN)', () => {
  it('periodMs=333 (wheel çözünürlüğüyle aynı) → her tikte tetiklenir', () => {
    vi.useFakeTimers();
    const m = forceMode(RuntimeMode.BALANCED);
    let calls = 0;
    m.scheduleTask({ id: 'p333', periodMs: 333, criticality: 'NORMAL', fn: () => { calls++; } });

    vi.advanceTimersByTime(333);
    expect(calls).toBe(1);
    vi.advanceTimersByTime(333);
    expect(calls).toBe(2);
    vi.advanceTimersByTime(333 * 3);
    expect(calls).toBe(5);
  });

  it('periodMs=666 (2 tik) → yarı sıklıkta tetiklenir', () => {
    vi.useFakeTimers();
    const m = forceMode(RuntimeMode.BALANCED);
    let calls = 0;
    m.scheduleTask({ id: 'p666', periodMs: 666, criticality: 'NORMAL', fn: () => { calls++; } });

    vi.advanceTimersByTime(333); // 1. tik — henüz due değil
    expect(calls).toBe(0);
    vi.advanceTimersByTime(333); // 2. tik — due
    expect(calls).toBe(1);
    vi.advanceTimersByTime(333 * 2); // 2 tik daha
    expect(calls).toBe(2);
  });
});

describe('FAZ 16 — mod ölçekleme (NORMAL periodMs×çarpan, SAFETY muaf)', () => {
  it('BASIC_JS: periodMs 2×\'e çıkar (çağrı sıklığı yarıya iner)', () => {
    vi.useFakeTimers();
    const m = forceMode(RuntimeMode.BALANCED);
    let calls = 0;
    m.scheduleTask({ id: 'p666-scale', periodMs: 666, criticality: 'NORMAL', fn: () => { calls++; } });

    // BALANCED: mod çarpanı=1 → efektif periyot=666ms=2 tik
    vi.advanceTimersByTime(333 * 4); // 4 tik → 2 çağrı beklenir
    expect(calls).toBe(2);

    // BASIC_JS'e downgrade (anlık) — çarpan=2 → efektif periyot=1332ms=4 tik
    m.setMode(RuntimeMode.BASIC_JS, 'test');
    calls = 0;
    vi.advanceTimersByTime(333 * 4); // 4 tik → BASIC_JS'te yalnızca 1 çağrı (4 tik periyot)
    expect(calls).toBe(1);
  });

  it('SAFETY görevi SAFE_MODE\'da bile periodMs\'i sabit korur (çarpandan muaf)', () => {
    vi.useFakeTimers();
    const m = forceMode(RuntimeMode.BALANCED);
    let calls = 0;
    m.scheduleTask({ id: 'safety-5s', periodMs: 5000, criticality: 'SAFETY', fn: () => { calls++; } });

    m.setMode(RuntimeMode.SAFE_MODE, 'test'); // en düşük mod — en yüksek çarpan (4)
    // 5000ms/333ms ≈ 15.02 → round → 15 tik (~4995ms) — mod çarpanı UYGULANMADI
    vi.advanceTimersByTime(333 * 15);
    expect(calls).toBe(1);
  });

  it('BASIC_JS\'e geçilse bile SAFETY görevin periyodu DEĞİŞMEZ (çarpan öncesi/sonrası aynı tik sayısı)', () => {
    vi.useFakeTimers();
    const m = forceMode(RuntimeMode.BALANCED);
    let calls = 0;
    m.scheduleTask({ id: 'safety-fixed', periodMs: 333, criticality: 'SAFETY', fn: () => { calls++; } });

    m.setMode(RuntimeMode.BASIC_JS, 'test');
    vi.advanceTimersByTime(333 * 4);
    expect(calls).toBe(4); // hâlâ her tik — SAFETY mod çarpanından muaf
  });
});

describe('FAZ 16 — deferIdle davranışı', () => {
  it('deferIdle=true + requestIdleCallback yok (jsdom) → senkron fallback ile çalışır', () => {
    vi.useFakeTimers();
    const m = forceMode(RuntimeMode.BALANCED);
    let calls = 0;
    m.scheduleTask({ id: 'idle-1', periodMs: 333, criticality: 'NORMAL', deferIdle: true, fn: () => { calls++; } });

    // jsdom'da requestIdleCallback tanımsız → _dispatchTask senkron çalıştırır,
    // ek bir mikro/makro görev bekletmeye GEREK yok.
    vi.advanceTimersByTime(333);
    expect(calls).toBe(1);
  });

  it('deferIdle=false (varsayılan) → her zaman senkron', () => {
    vi.useFakeTimers();
    const m = forceMode(RuntimeMode.BALANCED);
    let calls = 0;
    m.scheduleTask({ id: 'idle-2', periodMs: 333, criticality: 'NORMAL', fn: () => { calls++; } });

    vi.advanceTimersByTime(333);
    expect(calls).toBe(1);
  });
});

describe('FAZ 16 — cleanup thunk ve idempotent kayıt', () => {
  it('cleanup thunk çağrılınca görev durur', () => {
    vi.useFakeTimers();
    const m = forceMode(RuntimeMode.BALANCED);
    let calls = 0;
    const stop = m.scheduleTask({ id: 'p-stop', periodMs: 333, criticality: 'NORMAL', fn: () => { calls++; } });

    vi.advanceTimersByTime(333 * 2);
    expect(calls).toBe(2);

    stop();
    vi.advanceTimersByTime(333 * 5);
    expect(calls).toBe(2); // artık çağrılmıyor
  });

  it('aynı id ikinci kayıt öncekini değiştirir — çift çalışma yok', () => {
    vi.useFakeTimers();
    const m = forceMode(RuntimeMode.BALANCED);
    let callsA = 0;
    let callsB = 0;
    m.scheduleTask({ id: 'dup', periodMs: 333, criticality: 'NORMAL', fn: () => { callsA++; } });
    m.scheduleTask({ id: 'dup', periodMs: 333, criticality: 'NORMAL', fn: () => { callsB++; } }); // aynı id — üzerine yazar

    vi.advanceTimersByTime(333 * 3);
    expect(callsA).toBe(0);  // eski fn artık kayıtlı değil
    expect(callsB).toBe(3);  // yeni fn çalışıyor
  });
});

describe('FAZ 16 — wheel yaşam döngüsü (lazy start / destroy)', () => {
  it('destroy() sonrası wheel timer temizlenir, görev kaydı boşalır', () => {
    vi.useFakeTimers();
    const m = forceMode(RuntimeMode.BALANCED);
    let calls = 0;
    m.scheduleTask({ id: 'p-destroy', periodMs: 333, criticality: 'NORMAL', fn: () => { calls++; } });
    vi.advanceTimersByTime(333);
    expect(calls).toBe(1);

    m.destroy();

    // Private alanlara test-only introspeksiyon (production'a dokunmaz).
    const wheelTimer = (m as unknown as { _wheelTimer: unknown })._wheelTimer;
    const tasks      = (m as unknown as { _tasks: Map<string, unknown> })._tasks;
    expect(wheelTimer).toBeNull();
    expect(tasks.size).toBe(0);

    calls = 0;
    vi.advanceTimersByTime(333 * 5);
    expect(calls).toBe(0); // wheel durdu — artık tetiklenmiyor
  });

  it('0 görevde wheel timer kurulmaz (boşta uyanış yok)', () => {
    vi.useFakeTimers();
    const m = forceMode(RuntimeMode.BALANCED);
    const wheelTimer = (m as unknown as { _wheelTimer: unknown })._wheelTimer;
    expect(wheelTimer).toBeNull();
  });

  it('son görev cleanup ile silinince wheel durur', () => {
    vi.useFakeTimers();
    const m = forceMode(RuntimeMode.BALANCED);
    const stop = m.scheduleTask({ id: 'solo', periodMs: 333, criticality: 'NORMAL', fn: () => {} });
    expect((m as unknown as { _wheelTimer: unknown })._wheelTimer).not.toBeNull();

    stop();
    expect((m as unknown as { _wheelTimer: unknown })._wheelTimer).toBeNull();
  });
});
