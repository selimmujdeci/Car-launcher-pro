/**
 * aiCoreRuntimeWiringDiag.test.ts — AI Core Faz-2.5 · wiring diagnosticsProvider DI kabulü.
 *
 * KİLİTLENEN SÖZLEŞME:
 *  1. Wiring diagnosticsProvider DI'yı kabul eder; lifecycle (start/dispose) bozulmaz.
 *  2. Varsayılan provider (test'te tetiklenmez) import/lifecycle'ı kırmaz.
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  startPlatformCoreAiRuntimeWiring, getAiRuntimeStatus,
} from '../platform/system/platformCoreAiRuntimeWiring';
import type { RuntimeBusLike, RuntimeHalLike } from '../platform/aiCore/runtime/aiCoreRuntime';
import type { HalSnapshotLike, HalIdentityLike } from '../platform/aiCore/runtime/halAdapter';

class FakeBus implements RuntimeBusLike {
  subs = new Map<string, { name: string }>();
  private _n = 0;
  subscribe(name: string): string | null { const id = `s${++this._n}`; this.subs.set(id, { name }); return id; }
  unsubscribe(id: string): boolean { return this.subs.delete(id); }
  publish(): unknown { return { id: 'e' }; }
}
const HAL: RuntimeHalLike = {
  getSnapshot: (): HalSnapshotLike => ({ revision: 1, updatedAt: 0, signals: [] }),
  getVehicleIdentity: (): HalIdentityLike => ({ fingerprintHash: null, protocol: null, supported: false }),
};

let _cleanup: (() => void) | null = null;
afterEach(() => { if (_cleanup) { _cleanup(); _cleanup = null; } });

describe('AI Core wiring — diagnosticsProvider DI (Faz-2.5)', () => {
  it('custom diagnosticsProvider kabul edilir, lifecycle bozulmaz', () => {
    const bus = new FakeBus();
    _cleanup = startPlatformCoreAiRuntimeWiring({ bus, hal: HAL, diagnosticsProvider: () => null });
    expect(getAiRuntimeStatus().present).toBe(true);
    expect(getAiRuntimeStatus().subscriptions).toBe(4);
  });

  it('varsayılan provider ile (DI\'sız) lifecycle intact', () => {
    const bus = new FakeBus();
    const cleanup = startPlatformCoreAiRuntimeWiring({ bus, hal: HAL });
    expect(getAiRuntimeStatus().present).toBe(true);
    cleanup();
    expect(getAiRuntimeStatus().present).toBe(false);
  });
});
