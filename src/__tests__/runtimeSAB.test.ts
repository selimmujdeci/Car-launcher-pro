import { describe, it, expect, vi, beforeEach } from 'vitest';

// AdaptiveRuntimeManager artık _detectCapabilities() içinde getDeviceTier()'i de okur.
// jsdom'da getDeviceTier() her zaman 'low' döner (WebGL/backdrop-filter/dvh/@layer yok)
// → SAB/Worker tespit yolunu İZOLE test edebilmek için tier'ı mock'larız (varsayılan
// 'high' = tier gate kapalı). Tier-low senaryosu en alttaki testte ayrıca doğrulanır.
const caps = vi.hoisted(() => ({ tier: 'high' as 'low' | 'mid' | 'high' }));
vi.mock('../platform/deviceCapabilities', () => ({
  getDeviceTier: () => caps.tier,
}));

import { AdaptiveRuntimeManager } from '../core/runtime/AdaptiveRuntimeManager';
import { RuntimeMode } from '../core/runtime/runtimeTypes';

describe('SAB Graceful Fallback Detection', () => {
  beforeEach(() => {
    vi.resetModules();
    caps.tier = 'high';                        // varsayılan: tier gate kapalı, SAB yolu test edilir
    // Clean up singleton for fresh detection
    (AdaptiveRuntimeManager as any)._instance = null;
  });

  it('SAB + Worker varsa BALANCED modda başlamalı', () => {
    // Mock global SharedArrayBuffer and crossOriginIsolated
    globalThis.SharedArrayBuffer = class {} as any;
    Object.defineProperty(globalThis, 'crossOriginIsolated', {
      value: true,
      configurable: true
    });
    globalThis.Worker = class {} as any;

    const manager = AdaptiveRuntimeManager.getInstance();
    expect(manager.getMode()).toBe(RuntimeMode.BALANCED);
  });

  it('SAB var ama crossOriginIsolated=false ise BASIC_JS moduna düşmeli', () => {
    globalThis.SharedArrayBuffer = class {} as any;
    Object.defineProperty(globalThis, 'crossOriginIsolated', {
      value: false,
      configurable: true
    });
    globalThis.Worker = class {} as any;

    const manager = AdaptiveRuntimeManager.getInstance();
    expect(manager.getMode()).toBe(RuntimeMode.BASIC_JS);
  });

  it('SAB yoksa BASIC_JS moduna düşmeli', () => {
    delete (globalThis as any).SharedArrayBuffer;
    Object.defineProperty(globalThis, 'crossOriginIsolated', {
      value: true,
      configurable: true
    });
    globalThis.Worker = class {} as any;

    const manager = AdaptiveRuntimeManager.getInstance();
    expect(manager.getMode()).toBe(RuntimeMode.BASIC_JS);
  });

  it('Worker yoksa BASIC_JS moduna düşmeli', () => {
    globalThis.SharedArrayBuffer = class {} as any;
    Object.defineProperty(globalThis, 'crossOriginIsolated', {
      value: true,
      configurable: true
    });
    delete (globalThis as any).Worker;

    const manager = AdaptiveRuntimeManager.getInstance();
    expect(manager.getMode()).toBe(RuntimeMode.BASIC_JS);
  });

  it('getDeviceTier() low ise (SAB+Worker mevcut olsa BİLE) BASIC_JS zorlanmalı', () => {
    // K24 regresyon senaryosu: Android 15 / 6GB RAM ama Mali-400 + düşük ekran → tier 'low'.
    // SAB+Worker mevcut ve hasWeakGpu jsdom'da false olsa bile, kanonik tier gate
    // BASIC_JS'i zorlamalı (blur/animation açık kalmasın).
    caps.tier = 'low';
    globalThis.SharedArrayBuffer = class {} as any;
    Object.defineProperty(globalThis, 'crossOriginIsolated', {
      value: true,
      configurable: true
    });
    globalThis.Worker = class {} as any;

    const manager = AdaptiveRuntimeManager.getInstance();
    expect(manager.getMode()).toBe(RuntimeMode.BASIC_JS);
  });
});
