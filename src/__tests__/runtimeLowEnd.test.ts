/**
 * runtimeLowEnd.test.ts — T7: low-end mod (BASIC_JS / SAFE_MODE / POWER_SAVE)
 * doğrulama paketi.
 *
 * Araç ve Mali-400 donanımı OLMADAN, herhangi bir makinede deterministik olarak
 * GERÇEK runtime sistemini doğrular:
 *   AdaptiveRuntimeManager (singleton) + getRuntimeConfig + --rt-blur/--rt-anim CSS.
 *
 * Production / native / worker hot-path DEĞİŞMEZ — yalnız test altyapısı.
 *
 * Mock'lar (hoisted): donanım sinyalleri sahte → BALANCED baseline + low-end
 * cihaz simülasyonu her ortamda tekrarlanabilir.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

/* ── Donanım mock state (hoisted) ── */
const env = vi.hoisted(() => ({
  tier:    'high' as 'low' | 'mid' | 'high',
  weakGpu: false,
  lowEnd:  false, // isLowEndDevice() (headUnitCompat)
}));

vi.mock('../platform/deviceCapabilities', () => ({
  getDeviceTier: () => env.tier,
}));
vi.mock('../utils/detectWeakGpu', () => ({
  hasWeakGpu:    () => env.weakGpu,
  getGpuRenderer: () => '',
}));
vi.mock('../platform/headUnitCompat', () => ({
  isLowEndDevice: () => env.lowEnd,
}));
// UnifiedVehicleStore cameraService import eder (reverse → kamera). Item 7 store
// dirty-guard testinde yan etki olmasın diye no-op'la.
vi.mock('../platform/cameraService', () => ({
  openRearCamera:  vi.fn().mockResolvedValue(undefined),
  closeRearCamera: vi.fn().mockResolvedValue(undefined),
}));

/* ── Imports (mock'lardan sonra) ── */
import { AdaptiveRuntimeManager } from '../core/runtime/AdaptiveRuntimeManager';
import { RuntimeMode } from '../core/runtime/runtimeTypes';
import { getRuntimeConfig } from '../core/runtime/runtimeConfig';
import { useUnifiedVehicleStore } from '../platform/vehicleDataLayer/UnifiedVehicleStore';
import {
  LOW_END_MODES,
  RUNTIME_CHECKLIST,
  forceMode,
  readRtVar,
  captureRuntimeChecklist,
  computeMediaBlurOff,
  makeMockWorker,
} from './sim/runtimeSimulator';

afterEach(() => {
  AdaptiveRuntimeManager._resetForTest(); // CSS + singleton temizliği
  env.tier = 'high';
  env.weakGpu = false;
  env.lowEnd = false;
  vi.clearAllMocks();
});

/* ════════════════════════════════════════════════════════════════════════════
   1 — Runtime mode forcing
════════════════════════════════════════════════════════════════════════════ */
describe('T7.1 — Runtime mode forcing', () => {
  it('baseline BALANCED kurulur', () => {
    const m = forceMode(RuntimeMode.BALANCED);
    expect(m.getMode()).toBe(RuntimeMode.BALANCED);
  });

  LOW_END_MODES.forEach((mode) => {
    it(`${mode} moduna anlık zorlanır (downgrade)`, () => {
      const m = forceMode(mode);
      expect(m.getMode()).toBe(mode);
    });
  });

  it('aynı moda zorlama no-op (zaten aktif)', () => {
    const m = forceMode(RuntimeMode.SAFE_MODE);
    m.setMode(RuntimeMode.SAFE_MODE, 'test');
    expect(m.getMode()).toBe(RuntimeMode.SAFE_MODE);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   2 — Blur / Animation CSS değişkeni doğrulaması
════════════════════════════════════════════════════════════════════════════ */
describe('T7.2 — Blur & Animation disable (CSS var + config)', () => {
  LOW_END_MODES.forEach((mode) => {
    it(`${mode}: enableBlur=false ve --rt-blur='0'`, () => {
      const m = forceMode(mode);
      expect(m.getConfig().enableBlur).toBe(false);
      expect(readRtVar('--rt-blur')).toBe('0');
    });

    it(`${mode}: enableAnimations=false ve --rt-anim='0'`, () => {
      const m = forceMode(mode);
      expect(m.getConfig().enableAnimations).toBe(false);
      expect(readRtVar('--rt-anim')).toBe('0');
    });
  });

  it('BALANCED: blur ve animasyon açık (--rt-blur/--rt-anim=1)', () => {
    const m = forceMode(RuntimeMode.BALANCED);
    expect(m.getConfig().enableBlur).toBe(true);
    expect(m.getConfig().enableAnimations).toBe(true);
    expect(readRtVar('--rt-blur')).toBe('1');
    expect(readRtVar('--rt-anim')).toBe('1');
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   3 — Worker shutdown davranışı
════════════════════════════════════════════════════════════════════════════ */
describe('T7.3 — Worker shutdown', () => {
  it('CRITICAL bellek baskısı: OPTIONAL terminate, CRITICAL korunur', () => {
    const m = forceMode(RuntimeMode.BALANCED);
    const vehicle = makeMockWorker();
    const vision  = makeMockWorker();
    const nav     = makeMockWorker();
    m.registerWorker('VehicleCompute',   vehicle.worker, 'CRITICAL');
    m.registerWorker('VisionCompute',    vision.worker,  'OPTIONAL');
    m.registerWorker('NavigationCompute', nav.worker,    'OPTIONAL');

    m.handleMemoryPressure('CRITICAL');

    const w = new Map(Array.from(m.getWorkers()));
    expect(w.get('VehicleCompute')?.worker).not.toBeNull();   // CRITICAL hayatta
    expect(w.get('VisionCompute')?.worker).toBeNull();         // OPTIONAL ref null
    expect(w.get('NavigationCompute')?.worker).toBeNull();
    // Temiz kapatma denemesi: STOP mesajı gönderildi
    expect(vision.posted).toContainEqual({ type: 'STOP' });
    expect(nav.posted).toContainEqual({ type: 'STOP' });
  });

  it('terminate() 500ms gecikmeli onaylanır', () => {
    vi.useFakeTimers();
    try {
      const m = forceMode(RuntimeMode.BALANCED);
      const vision = makeMockWorker();
      m.registerWorker('VisionCompute', vision.worker, 'OPTIONAL');
      m.handleMemoryPressure('CRITICAL');
      expect(vision.terminated()).toBe(false); // henüz değil
      vi.advanceTimersByTime(600);
      expect(vision.terminated()).toBe(true);  // 500ms sonra terminate
    } finally {
      vi.useRealTimers();
    }
  });

  it('MODERATE baskı da OPTIONAL worker sonlandırır', () => {
    const m = forceMode(RuntimeMode.BALANCED);
    const vision = makeMockWorker();
    m.registerWorker('VisionCompute', vision.worker, 'OPTIONAL');
    m.handleMemoryPressure('MODERATE');
    expect(new Map(Array.from(m.getWorkers())).get('VisionCompute')?.worker).toBeNull();
  });

  it('suspendWorkers yalnız SAFE_MODE config\'inde true', () => {
    expect(getRuntimeConfig(RuntimeMode.SAFE_MODE).suspendWorkers).toBe(true);
    expect(getRuntimeConfig(RuntimeMode.POWER_SAVE).suspendWorkers).toBe(false);
    expect(getRuntimeConfig(RuntimeMode.BASIC_JS).suspendWorkers).toBe(false);
    expect(getRuntimeConfig(RuntimeMode.BALANCED).suspendWorkers).toBe(false);
    expect(getRuntimeConfig(RuntimeMode.PERFORMANCE).suspendWorkers).toBe(false);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   4 — Media low-end blurOff mantığı (MediaScreen.tsx:608 birebir)
════════════════════════════════════════════════════════════════════════════ */
describe('T7.4 — Media low-end blurOff', () => {
  it('düşük modlarda blurOff=true (enableBlur false)', () => {
    env.lowEnd = false;
    LOW_END_MODES.forEach((mode) => {
      expect(computeMediaBlurOff(mode)).toBe(true);
    });
  });

  it('yüksek modlarda + normal cihazda blurOff=false', () => {
    env.lowEnd = false;
    expect(computeMediaBlurOff(RuntimeMode.BALANCED)).toBe(false);
    expect(computeMediaBlurOff(RuntimeMode.PERFORMANCE)).toBe(false);
  });

  it('low-end cihazda BALANCED\'da bile blurOff=true (isLowEndDevice gate)', () => {
    env.lowEnd = true;
    expect(computeMediaBlurOff(RuntimeMode.BALANCED)).toBe(true);
    expect(computeMediaBlurOff(RuntimeMode.PERFORMANCE)).toBe(true);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   5 — Map blur/animasyon sözleşmesi (overlay'ler var(--rt-blur) tüketir)
════════════════════════════════════════════════════════════════════════════ */
describe('T7.5 — Map overlay blur sözleşmesi', () => {
  LOW_END_MODES.forEach((mode) => {
    it(`${mode}: --rt-blur='0' → blur(calc(var(--rt-blur)*Npx)) çarpanı 0`, () => {
      forceMode(mode);
      expect(readRtVar('--rt-blur')).toBe('0');
    });
  });

  it('SAFE_MODE: harita overlay blur+animasyon kapalı (MainLayout will-change gate)', () => {
    const cfg = getRuntimeConfig(RuntimeMode.SAFE_MODE);
    expect(cfg.enableBlur).toBe(false);
    expect(cfg.enableAnimations).toBe(false);
  });

  it('BALANCED: harita overlay blur sözleşmesi açık (--rt-blur=1)', () => {
    forceMode(RuntimeMode.BALANCED);
    expect(readRtVar('--rt-blur')).toBe('1');
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   6 — Inspector checklist (overlay ile doğrulanabilir matris)
════════════════════════════════════════════════════════════════════════════ */
describe('T7.6 — Inspector checklist', () => {
  // Manager ile zorlanabilen modlar (BALANCED baseline + downgrade'ler)
  ([RuntimeMode.BALANCED, ...LOW_END_MODES] as const).forEach((mode) => {
    it(`${mode}: capture snapshot beklenen checklist ile eşleşir`, () => {
      const m = forceMode(mode);
      const snap = captureRuntimeChecklist(m);
      const exp  = RUNTIME_CHECKLIST[mode];
      expect(snap.mode).toBe(mode);
      expect(snap.enableBlur).toBe(exp.enableBlur);
      expect(snap.enableAnimations).toBe(exp.enableAnimations);
      expect(snap.suspendWorkers).toBe(exp.suspendWorkers);
      expect(snap.uiFpsTarget).toBe(exp.uiFpsTarget);
      // Inspector'ın gösterdiği Blur/Anim göstergeleri config ile tutarlı
      expect(snap.blurOn).toBe(exp.enableBlur);
      expect(snap.animOn).toBe(exp.enableAnimations);
    });
  });

  it('checklist matrisi gerçek runtimeConfig ile tutarlı (tüm modlar)', () => {
    (Object.keys(RUNTIME_CHECKLIST) as RuntimeMode[]).forEach((mode) => {
      const cfg = getRuntimeConfig(mode);
      const exp = RUNTIME_CHECKLIST[mode];
      expect(cfg.enableBlur).toBe(exp.enableBlur);
      expect(cfg.enableAnimations).toBe(exp.enableAnimations);
      expect(cfg.suspendWorkers).toBe(exp.suspendWorkers);
      expect(cfg.uiFpsTarget).toBe(exp.uiFpsTarget);
    });
  });

  it('checklist worker durumunu (alive/dead) yansıtır', () => {
    const m = forceMode(RuntimeMode.BALANCED);
    const vision = makeMockWorker();
    m.registerWorker('VisionCompute', vision.worker, 'OPTIONAL');
    expect(captureRuntimeChecklist(m).workers).toContainEqual({
      key: 'VisionCompute', criticality: 'OPTIONAL', alive: true,
    });
    m.handleMemoryPressure('CRITICAL');
    expect(captureRuntimeChecklist(m).workers).toContainEqual({
      key: 'VisionCompute', criticality: 'OPTIONAL', alive: false,
    });
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   7 — Gauge settled-frame optimizasyonu (Plan B: store dirty-guard, render'sız)
   Settled değer (değişmeyen sinyal) tekrar beslendiğinde store yeni state
   yaymaz → downstream gauge'lar re-render olmaz (idle frame yok). Gerçek
   UnifiedVehicleStore.updateVehicleState dirty-guard'ı doğrulanır.
════════════════════════════════════════════════════════════════════════════ */
describe('T7.7 — Gauge settled-frame (store dirty-guard)', () => {
  it('settled hız tekrar beslense store bildirim yaymaz; değişince devam eder', () => {
    const store = useUnifiedVehicleStore;
    store.getState().updateVehicleState({ speed: 60 }); // baseline (abone öncesi)

    let notifications = 0;
    const unsub = store.subscribe(() => { notifications++; });

    store.getState().updateVehicleState({ speed: 60 }); // settled → bildirim yok
    store.getState().updateVehicleState({ speed: 60 }); // settled → bildirim yok
    expect(notifications).toBe(0);

    store.getState().updateVehicleState({ speed: 61 }); // değişti → 1 bildirim
    expect(notifications).toBe(1);

    unsub();
  });

  it('settled rpm için de redundant set yok', () => {
    const store = useUnifiedVehicleStore;
    store.getState().updateVehicleState({ rpm: 2000 });

    let notifications = 0;
    const unsub = store.subscribe(() => { notifications++; });

    store.getState().updateVehicleState({ rpm: 2000 }); // settled
    store.getState().updateVehicleState({ rpm: 2000 }); // settled
    expect(notifications).toBe(0);

    store.getState().updateVehicleState({ rpm: 2100 }); // değişti
    expect(notifications).toBe(1);

    unsub();
  });
});
