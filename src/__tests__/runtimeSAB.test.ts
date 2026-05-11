import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AdaptiveRuntimeManager } from '../core/runtime/AdaptiveRuntimeManager';
import { RuntimeMode } from '../core/runtime/runtimeTypes';

describe('SAB Graceful Fallback Detection', () => {
  beforeEach(() => {
    vi.resetModules();
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
});
