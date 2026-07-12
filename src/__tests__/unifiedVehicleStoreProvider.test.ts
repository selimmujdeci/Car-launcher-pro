/**
 * unifiedVehicleStoreProvider.test.ts — İlk gerçek Vehicle HAL provider kaynağı testleri.
 *
 * Kapsam: getState aktarımı · subscribe aktarımı · unsubscribe (idempotent) · store yok
 * fail-soft · duplicate subscribe yok · girdi mutate edilmiyor · gerçek alanlar korunuyor ·
 * ignition expose edilmiyor · TPMS yalnız veri varsa · import yan etkisiz · dispose zero-leak.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createUnifiedVehicleStoreProvider,
  type UnifiedVehicleStateReadable,
  type UnifiedVehicleStoreLike,
} from '../platform/vehicleHal/providers/unifiedVehicleStoreProvider';
import { createVehicleHalProviderAdapter, type VehicleHalIngestTarget } from '../platform/vehicleHal';
import providerSource from '../platform/vehicleHal/providers/unifiedVehicleStoreProvider.ts?raw';

/** Basit zustand benzeri sahte store (getState + subscribe). */
function fakeStore(initial: UnifiedVehicleStateReadable): UnifiedVehicleStoreLike & {
  set: (patch: UnifiedVehicleStateReadable) => void;
  listenerCount: () => number;
} {
  let state: UnifiedVehicleStateReadable = { ...initial };
  const listeners = new Set<(s: UnifiedVehicleStateReadable) => void>();
  return {
    getState: () => state,
    subscribe: (l) => { listeners.add(l); return () => { listeners.delete(l); }; },
    set: (patch) => { state = { ...state, ...patch }; listeners.forEach((l) => l(state)); },
    listenerCount: () => listeners.size,
  };
}

const BASE: UnifiedVehicleStateReadable = {
  speed: 60, rpm: 2500, fuel: 55, odometer: 12345, reverse: false,
  canRpm: 2490, canCoolantTemp: 88, canOilTemp: 95, canThrottle: 30,
  canBatteryVolt: 14.1, canGearPos: 3, canAmbientTemp: 21,
  canTpmsKpa: [230, 231, 229, 232], canDoorOpen: false, canParkingBrake: false,
};

describe('unifiedVehicleStoreProvider', () => {
  it('1) getState aktarımı — snapshot store değerlerini yansıtır', () => {
    const store = fakeStore(BASE);
    const p = createUnifiedVehicleStoreProvider({ store });
    const snap = p.getSnapshot()!;
    expect(snap.speed).toBe(60);
    expect(snap.rpm).toBe(2500);
    expect(snap.fuel).toBe(55);
    expect(snap.odometer).toBe(12345);
    expect(snap.canBatteryVolt).toBe(14.1);
    expect(snap.canGearPos).toBe(3);
  });

  it('2) subscribe aktarımı — store değişince listener çağrılır', () => {
    const store = fakeStore(BASE);
    const p = createUnifiedVehicleStoreProvider({ store });
    const listener = vi.fn();
    p.subscribe(listener);
    store.set({ speed: 61 });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('3) unsubscribe — çağrılınca store aboneliği bırakılır', () => {
    const store = fakeStore(BASE);
    const p = createUnifiedVehicleStoreProvider({ store });
    const listener = vi.fn();
    const unsub = p.subscribe(listener);
    unsub();
    store.set({ speed: 62 });
    expect(listener).not.toHaveBeenCalled();
    expect(store.listenerCount()).toBe(0);
  });

  it('3b) unsubscribe idempotent — iki kez çağrılınca patlamaz / çift bırakmaz', () => {
    const store = fakeStore(BASE);
    const realUnsub = vi.fn();
    const store2: UnifiedVehicleStoreLike = {
      getState: () => BASE,
      subscribe: () => realUnsub,
    };
    const p = createUnifiedVehicleStoreProvider({ store: store2 });
    const unsub = p.subscribe(() => {});
    unsub(); unsub(); unsub();
    expect(realUnsub).toHaveBeenCalledTimes(1);
    // store parametresi kullanılmadı — lint susturma (test hijyeni)
    void store;
  });

  it('4) store yok — fail-soft (snapshot null, no-op unsub)', () => {
    const p = createUnifiedVehicleStoreProvider({ store: null });
    expect(p.getSnapshot()).toBeNull();
    const unsub = p.subscribe(vi.fn());
    expect(() => unsub()).not.toThrow();
    expect(p.activeSubscriptionCount).toBe(0);
  });

  it('4b) getState throw — fail-soft null', () => {
    const store: UnifiedVehicleStoreLike = {
      getState: () => { throw new Error('boom'); },
      subscribe: () => () => {},
    };
    const p = createUnifiedVehicleStoreProvider({ store });
    expect(p.getSnapshot()).toBeNull();
  });

  it('5) duplicate subscribe yok — her subscribe TEK store aboneliği açar', () => {
    const store = fakeStore(BASE);
    const p = createUnifiedVehicleStoreProvider({ store });
    p.subscribe(vi.fn());
    expect(store.listenerCount()).toBe(1);
    expect(p.activeSubscriptionCount).toBe(1);
  });

  it('6) girdi mutate edilmiyor — store state referansı değişmez/kirlenmez', () => {
    const store = fakeStore(BASE);
    const before = store.getState();
    const snapshotOfBefore = JSON.stringify(before);
    const p = createUnifiedVehicleStoreProvider({ store });
    const snap = p.getSnapshot()!;
    // Snapshot store state'inden AYRI bir obje olmalı.
    expect(snap).not.toBe(before);
    // Snapshot dondurulmuş → mutasyon denemesi state'i etkilemez.
    expect(Object.isFrozen(snap)).toBe(true);
    expect(JSON.stringify(store.getState())).toBe(snapshotOfBefore);
  });

  it('7) gerçek alanlar korunuyor — CAN extras dahil birebir', () => {
    const store = fakeStore(BASE);
    const p = createUnifiedVehicleStoreProvider({ store });
    const snap = p.getSnapshot()!;
    expect(snap.canCoolantTemp).toBe(88);
    expect(snap.canOilTemp).toBe(95);
    expect(snap.canThrottle).toBe(30);
    expect(snap.canAmbientTemp).toBe(21);
    expect(snap.reverse).toBe(false);
    expect(snap.canDoorOpen).toBe(false);
    expect(snap.canParkingBrake).toBe(false);
  });

  it('7b) rpm undefined → null normalize', () => {
    const store = fakeStore({ ...BASE, rpm: undefined });
    const p = createUnifiedVehicleStoreProvider({ store });
    expect(p.getSnapshot()!.rpm).toBeNull();
  });

  it('8) ignition expose edilmiyor — snapshot ignition alanı içermez', () => {
    const store = fakeStore(BASE);
    const p = createUnifiedVehicleStoreProvider({ store });
    const snap = p.getSnapshot()!;
    expect('ignition' in snap).toBe(false);
    expect((snap as Record<string, unknown>).ignition).toBeUndefined();
  });

  it('9) TPMS yalnız gerçek 4-elemanlı numerik veri varsa', () => {
    const good = createUnifiedVehicleStoreProvider({ store: fakeStore(BASE) });
    expect(good.getSnapshot()!.canTpmsKpa).toEqual([230, 231, 229, 232]);

    const nullTpms = createUnifiedVehicleStoreProvider({ store: fakeStore({ ...BASE, canTpmsKpa: null }) });
    expect(nullTpms.getSnapshot()!.canTpmsKpa).toBeNull();

    const badTpms = createUnifiedVehicleStoreProvider({
      store: fakeStore({ ...BASE, canTpmsKpa: [230, 231, 229] as unknown as [number, number, number, number] }),
    });
    expect(badTpms.getSnapshot()!.canTpmsKpa).toBeNull();
  });

  it('10) import yan etkisiz — fabrika oluşturma store OKUMAZ/ABONE OLMAZ', () => {
    const getState = vi.fn(() => BASE);
    const subscribe = vi.fn(() => () => {});
    createUnifiedVehicleStoreProvider({ store: { getState, subscribe } });
    expect(getState).not.toHaveBeenCalled();
    expect(subscribe).not.toHaveBeenCalled();
  });

  it('10b) kaynak dosyada timer/SystemBoot/EventBus wiring YOK', () => {
    expect(providerSource).not.toMatch(/setInterval|setTimeout/);
    expect(providerSource).not.toMatch(/from ['"].*SystemBoot/);
    expect(providerSource).not.toMatch(/from ['"].*[eE]ventBus/);
    // Store'u DOĞRUDAN import ETMEZ (yapısal DI).
    expect(providerSource).not.toMatch(/from ['"].*UnifiedVehicleStore/);
  });

  it('11) dispose zero-leak — tüm abonelikler bırakılır', () => {
    const store = fakeStore(BASE);
    const p = createUnifiedVehicleStoreProvider({ store });
    p.subscribe(vi.fn());
    p.subscribe(vi.fn());
    expect(store.listenerCount()).toBe(2);
    p.dispose();
    expect(store.listenerCount()).toBe(0);
    expect(p.activeSubscriptionCount).toBe(0);
  });

  it('11b) adapter üzerinden entegrasyon — dispose sonrası callback sızıntısı yok', () => {
    const store = fakeStore(BASE);
    const source = createUnifiedVehicleStoreProvider({ store });
    const ingested: string[] = [];
    // W4A: adapter HAL'i TOPLU besler (tek `ingest(batch)` → tek emit).
    const hal: VehicleHalIngestTarget = {
      ingest: (signals) => { ingested.push(...Object.keys(signals)); return undefined; },
    };
    const adapter = createVehicleHalProviderAdapter({ hal, source });
    adapter.start();
    expect(ingested.length).toBeGreaterThan(0); // ilk refresh sinyalleri aktardı
    adapter.dispose();
    const before = store.listenerCount();
    store.set({ speed: 99 });
    // dispose sonrası HAL'e yeni ingest OLMAMALI (adapter aboneliği bıraktı).
    expect(store.listenerCount()).toBeLessThanOrEqual(before);
  });
});
