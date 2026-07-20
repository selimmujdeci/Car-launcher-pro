/**
 * aiCoreRuntimeWiring.test.ts — AI Core Faz-2 · SystemBoot wiring (lifecycle/idempotency).
 *
 * KİLİTLENEN SÖZLEŞME (mevcut platformCore*Wiring deseniyle hizalı):
 *  1. DI bus+HAL ile start → present/started, 4 edge aboneliği.
 *  2. İDEMPOTENT: ikinci start yeni abonelik açmaz (tek instance).
 *  3. cleanup → runtime dispose, abonelikler bırakılır (present:false).
 *  4. Bus yok → fail-soft no-op (boot sürer), present:false.
 *  5. getLastAiMechanicResult çalışma öncesi null (uydurma yok).
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  startPlatformCoreAiRuntimeWiring, getAiRuntimeStatus, getLastAiMechanicResult,
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

describe('startPlatformCoreAiRuntimeWiring', () => {
  it('DI bus+HAL ile start → present/started, 4 abonelik', () => {
    const bus = new FakeBus();
    _cleanup = startPlatformCoreAiRuntimeWiring({ bus, hal: HAL });
    const st = getAiRuntimeStatus();
    expect(st.present).toBe(true);
    expect(st.started).toBe(true);
    expect(st.subscriptions).toBe(4);
    expect(bus.subs.size).toBe(4);
  });

  it('idempotent: ikinci start yeni abonelik açmaz', () => {
    const bus = new FakeBus();
    _cleanup = startPlatformCoreAiRuntimeWiring({ bus, hal: HAL });
    const second = startPlatformCoreAiRuntimeWiring({ bus, hal: HAL });   // no-op
    expect(bus.subs.size).toBe(4);                 // çift değil
    second();                                       // no-op cleanup: aktifi düşürmez
    expect(getAiRuntimeStatus().present).toBe(true);
  });

  it('cleanup → dispose, abonelikler bırakılır (present:false)', () => {
    const bus = new FakeBus();
    const cleanup = startPlatformCoreAiRuntimeWiring({ bus, hal: HAL });
    cleanup();
    _cleanup = null;
    expect(bus.subs.size).toBe(0);
    expect(getAiRuntimeStatus().present).toBe(false);
  });

  it('bus yok → fail-soft no-op (present:false)', () => {
    // deps.bus verilmez + getAppEventBus() test ortamında null → no-op.
    const cleanup = startPlatformCoreAiRuntimeWiring({ hal: HAL });
    _cleanup = cleanup;
    expect(getAiRuntimeStatus().present).toBe(false);
  });

  it('getLastAiMechanicResult çalışma öncesi null', () => {
    const bus = new FakeBus();
    _cleanup = startPlatformCoreAiRuntimeWiring({ bus, hal: HAL });
    expect(getLastAiMechanicResult()).toBeNull();
  });
});
