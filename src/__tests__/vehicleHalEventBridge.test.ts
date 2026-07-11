/**
 * vehicleHalEventBridge.test.ts — Vehicle HAL → Platform Event Bus köprüsü testleri.
 *
 * Kapsam: start/stop idempotent · signal change · duplicate yok · değişen değer event ·
 * transient/history-dışı · küçük payload · unsupported/ignition kaynak yok → event yok ·
 * connection geçişi · identity · HAL/Bus fail-soft · dispose zero-leak · kaynak dispose
 * edilmiyor · privacy · input mutate yok · counters · katalog isimleri · import yan etkisiz.
 */

import { describe, it, expect } from 'vitest';
import {
  createVehicleHalEventBridge,
  type HalSignalLike, type HalSnapshotLike, type HalIdentityLike,
} from '../platform/eventBus/bridges/vehicleHalEventBridge';
import { DEFAULT_EVENT_CATALOG } from '../platform/eventBus';
import bridgeSource from '../platform/eventBus/bridges/vehicleHalEventBridge.ts?raw';

const CATALOG_NAMES = new Set(DEFAULT_EVENT_CATALOG.map((e) => e.name));
const NO_IDENTITY: HalIdentityLike = { fingerprintHash: null, protocol: null, supported: false };

function signal(id: string, value: unknown, o: Partial<HalSignalLike> = {}): HalSignalLike {
  return {
    id, value,
    quality: o.quality ?? 'high', confidence: o.confidence ?? 0.9, source: o.source ?? 'can',
    timestamp: o.timestamp ?? 1000, stale: o.stale ?? false, supported: o.supported ?? true,
  };
}
function snap(signals: HalSignalLike[], rev = 1): HalSnapshotLike {
  return { revision: rev, updatedAt: 1000, signals };
}

function fakeHal(initial: HalSnapshotLike, identity: HalIdentityLike = NO_IDENTITY) {
  let listener: ((s: HalSnapshotLike) => void) | null = null;
  let current = initial;
  let id = identity;
  let subCount = 0;
  return {
    subscribe: (l: (s: HalSnapshotLike) => void) => { subCount++; listener = l; return () => { listener = null; }; },
    getSnapshot: () => current,
    getVehicleIdentity: () => id,
    emit: (next: HalSnapshotLike) => { current = next; if (listener) listener(next); },
    setIdentity: (i: HalIdentityLike) => { id = i; },
    hasListener: () => listener !== null,
    subCount: () => subCount,
  };
}

interface Captured { name: string; payload: unknown; domain?: string; source?: string; transient?: boolean; retained?: boolean; vehicleFingerprintHash?: string }
function fakeBus(opts: { throwOnPublish?: boolean; rejectAll?: boolean } = {}) {
  const events: Captured[] = [];
  return {
    events,
    publish: (input: Captured) => {
      if (opts.throwOnPublish) throw new Error('publish boom');
      if (opts.rejectAll) return null;
      events.push(input);
      return { id: `evt-${events.length}`, name: input.name, sequence: events.length } as never;
    },
    named: (name: string) => events.filter((e) => e.name === name),
  };
}

const EMPTY = snap([]);

describe('VehicleHalEventBridge', () => {
  it('1) start idempotent — tek abonelik', () => {
    const hal = fakeHal(EMPTY); const bus = fakeBus();
    const b = createVehicleHalEventBridge({ hal, bus });
    b.start(); b.start();
    expect(hal.subCount()).toBe(1);
    expect(b.getStatus().started).toBe(true);
  });

  it('2) stop idempotent', () => {
    const hal = fakeHal(EMPTY); const bus = fakeBus();
    const b = createVehicleHalEventBridge({ hal, bus });
    b.start();
    expect(() => { b.stop(); b.stop(); }).not.toThrow();
    expect(hal.hasListener()).toBe(false);
  });

  it('3) signal change → vehicle.signal.changed yayınlanır', () => {
    const hal = fakeHal(EMPTY); const bus = fakeBus();
    createVehicleHalEventBridge({ hal, bus }).start();
    hal.emit(snap([signal('vehicle.speed', 60)]));
    const sc = bus.named('vehicle.signal.changed');
    expect(sc.length).toBe(1);
    expect((sc[0].payload as { signalId: string }).signalId).toBe('vehicle.speed');
    expect((sc[0].payload as { value: number }).value).toBe(60);
  });

  it('4) aynı değer → duplicate event YOK', () => {
    const hal = fakeHal(EMPTY); const bus = fakeBus();
    createVehicleHalEventBridge({ hal, bus }).start();
    hal.emit(snap([signal('vehicle.speed', 60)]));
    hal.emit(snap([signal('vehicle.speed', 60)], 2));
    expect(bus.named('vehicle.signal.changed').length).toBe(1);
  });

  it('5) değişen değer → yeni event', () => {
    const hal = fakeHal(EMPTY); const bus = fakeBus();
    createVehicleHalEventBridge({ hal, bus }).start();
    hal.emit(snap([signal('vehicle.speed', 60)]));
    hal.emit(snap([signal('vehicle.speed', 61)], 2));
    expect(bus.named('vehicle.signal.changed').length).toBe(2);
  });

  it('6) signal.changed transient (history dışı) metadata', () => {
    const hal = fakeHal(EMPTY); const bus = fakeBus();
    createVehicleHalEventBridge({ hal, bus }).start();
    hal.emit(snap([signal('vehicle.rpm', 2500)]));
    expect(bus.named('vehicle.signal.changed')[0].transient).toBe(true);
  });

  it('7) küçük payload — full snapshot/raw taşımıyor', () => {
    const hal = fakeHal(EMPTY); const bus = fakeBus();
    createVehicleHalEventBridge({ hal, bus }).start();
    hal.emit(snap([signal('vehicle.speed', 60)]));
    const p = bus.named('vehicle.signal.changed')[0].payload as Record<string, unknown>;
    expect(Object.keys(p).sort()).toEqual(
      ['confidence', 'quality', 'signalId', 'source', 'stale', 'supported', 'timestamp', 'value'].sort(),
    );
    expect('signals' in p).toBe(false);   // full HAL snapshot taşınmıyor
  });

  it('8) unsupported signal → event yok', () => {
    const hal = fakeHal(EMPTY); const bus = fakeBus();
    createVehicleHalEventBridge({ hal, bus }).start();
    hal.emit(snap([signal('vehicle.speed', 0, { supported: false })]));
    expect(bus.named('vehicle.signal.changed').length).toBe(0);
  });

  it('9) ignition kaynağı yoksa (supported=false) → ignition event YOK; supported+değişince → var', () => {
    const hal = fakeHal(EMPTY); const bus = fakeBus();
    createVehicleHalEventBridge({ hal, bus }).start();
    hal.emit(snap([signal('vehicle.ignition', false, { supported: false })]));
    expect(bus.named('vehicle.ignition.changed').length).toBe(0);
    // ignition signal.changed olarak da yayınlanmamalı (ayrı ele alınır)
    expect(bus.named('vehicle.signal.changed').some((e) => (e.payload as { signalId?: string }).signalId === 'vehicle.ignition')).toBe(false);

    hal.emit(snap([signal('vehicle.ignition', true, { supported: true })], 2));
    const ign = bus.named('vehicle.ignition.changed');
    expect(ign.length).toBe(1);
    expect((ign[0].payload as { value: boolean }).value).toBe(true);
    expect(ign[0].retained).toBe(true);
  });

  it('9b) connection.changed — supported sinyal gelince false→true (retained), veri yoksa sessiz', () => {
    const hal = fakeHal(EMPTY); const bus = fakeBus();
    createVehicleHalEventBridge({ hal, bus }).start();
    expect(bus.named('vehicle.connection.changed').length).toBe(0); // boş → sessiz
    hal.emit(snap([signal('vehicle.speed', 30)]));
    const cc = bus.named('vehicle.connection.changed');
    expect(cc.length).toBe(1);
    expect((cc[0].payload as { connected: boolean }).connected).toBe(true);
    expect(cc[0].retained).toBe(true);
  });

  it('9c) identity.changed — yalnız supported + değişince (retained), fingerprint payloadta değil', () => {
    const hal = fakeHal(EMPTY); const bus = fakeBus();
    createVehicleHalEventBridge({ hal, bus }).start();
    expect(bus.named('vehicle.identity.changed').length).toBe(0); // unsupported → sessiz
    hal.setIdentity({ fingerprintHash: 'deadbeefcafe', protocol: 'ISO15765', supported: true });
    hal.emit(snap([signal('vehicle.speed', 10)], 2));
    const idn = bus.named('vehicle.identity.changed');
    expect(idn.length).toBe(1);
    expect(idn[0].vehicleFingerprintHash).toBe('deadbeefcafe'); // metadata alanı (Bus doğrular)
    expect('fingerprintHash' in (idn[0].payload as object)).toBe(false); // payloadta ham kimlik YOK
  });

  it('10) HAL subscribe hatası fail-soft', () => {
    const badHal = {
      subscribe: () => { throw new Error('sub boom'); },
      getSnapshot: () => EMPTY,
      getVehicleIdentity: () => NO_IDENTITY,
    };
    const b = createVehicleHalEventBridge({ hal: badHal, bus: fakeBus() });
    expect(() => b.start()).not.toThrow();
    expect(b.getStatus().started).toBe(true);
  });

  it('11) Bus publish hatası fail-soft → droppedCount artar', () => {
    const hal = fakeHal(EMPTY); const bus = fakeBus({ throwOnPublish: true });
    const b = createVehicleHalEventBridge({ hal, bus });
    b.start();
    expect(() => hal.emit(snap([signal('vehicle.speed', 60)]))).not.toThrow();
    expect(b.getDroppedCount()).toBeGreaterThan(0);
    expect(b.getPublishedCount()).toBe(0);
  });

  it('11b) Bus reddederse (null) droppedCount artar', () => {
    const hal = fakeHal(EMPTY); const bus = fakeBus({ rejectAll: true });
    const b = createVehicleHalEventBridge({ hal, bus });
    b.start();
    hal.emit(snap([signal('vehicle.speed', 60)]));
    expect(b.getDroppedCount()).toBeGreaterThan(0);
  });

  it('12) dispose zero-leak — abonelik bırakılır', () => {
    const hal = fakeHal(EMPTY); const bus = fakeBus();
    const b = createVehicleHalEventBridge({ hal, bus });
    b.start();
    b.dispose();
    expect(hal.hasListener()).toBe(false);
    expect(b.isDisposed).toBe(true);
  });

  it('13) kaynaklar dispose EDİLMİYOR — HAL/Bus kullanılabilir kalır', () => {
    const hal = fakeHal(EMPTY); const bus = fakeBus();
    const b = createVehicleHalEventBridge({ hal, bus });
    b.start(); b.dispose();
    // fakeHal/bus'ta dispose metodu YOK; köprü çağırsaydı patlardı → çağırmıyor.
    expect(() => hal.getSnapshot()).not.toThrow();
    expect(() => bus.publish({ name: 'vehicle.signal.changed' } as never)).not.toThrow();
  });

  it('14) privacy — yayınlanan payload ham kimlik/koordinat içermez', () => {
    const hal = fakeHal(EMPTY); const bus = fakeBus();
    createVehicleHalEventBridge({ hal, bus }).start();
    hal.setIdentity({ fingerprintHash: 'deadbeef', protocol: 'CAN', supported: true });
    hal.emit(snap([signal('vehicle.speed', 55), signal('vehicle.tpms', [230, 231, 229, 232])], 2));
    const all = JSON.stringify(bus.events.map((e) => e.payload));
    expect(all).not.toMatch(/[A-HJ-NPR-Z0-9]{17}/); // VIN kalıbı yok
    expect(all).not.toMatch(/\d{1,3}\.\d{4,},/);     // koordinat yok
  });

  it('15) input mutate edilmiyor — snapshot değişmez', () => {
    const hal = fakeHal(EMPTY); const bus = fakeBus();
    createVehicleHalEventBridge({ hal, bus }).start();
    const s = snap([signal('vehicle.speed', 60)]);
    const clone = JSON.parse(JSON.stringify(s));
    hal.emit(s);
    expect(JSON.parse(JSON.stringify(s))).toEqual(clone);
  });

  /* ── Ortak (31–40) ── */

  it('32) dispose sonrası callback no-op', () => {
    const hal = fakeHal(EMPTY); const bus = fakeBus();
    const b = createVehicleHalEventBridge({ hal, bus });
    b.start();
    // dispose HAL aboneliğini bıraktığı için emit listener'a ulaşmaz; yine de doğrudan çağrı no-op olmalı.
    b.dispose();
    const before = bus.events.length;
    hal.emit(snap([signal('vehicle.speed', 99)], 5));
    expect(bus.events.length).toBe(before);
  });

  it('33) counters doğru', () => {
    const hal = fakeHal(EMPTY); const bus = fakeBus();
    const b = createVehicleHalEventBridge({ hal, bus });
    b.start();
    hal.emit(snap([signal('vehicle.speed', 60)]));
    hal.emit(snap([signal('vehicle.speed', 61)], 2));
    expect(b.getPublishedCount()).toBe(bus.events.length);
    expect(b.getDroppedCount()).toBe(0);
  });

  it('34) import yan etkisiz — fabrika abone olmaz', () => {
    const hal = fakeHal(EMPTY); const bus = fakeBus();
    createVehicleHalEventBridge({ hal, bus });
    expect(hal.subCount()).toBe(0);
    expect(bus.events.length).toBe(0);
  });

  it('35/36) SystemBoot/provider auto-start wiring YOK', () => {
    expect(bridgeSource).not.toMatch(/from ['"].*SystemBoot/);
    expect(bridgeSource).not.toMatch(/createUnifiedVehicleStoreProvider|createRuntimeCapabilityProviders/);
  });

  it('37) timer/polling YOK (BASIC_JS düşük maliyet)', () => {
    expect(bridgeSource).not.toMatch(/setInterval|setTimeout|requestAnimationFrame/);
  });

  it('39) yayınlanan tüm event isimleri Event Bus kataloğunda', () => {
    const hal = fakeHal(EMPTY); const bus = fakeBus();
    createVehicleHalEventBridge({ hal, bus }).start();
    hal.setIdentity({ fingerprintHash: 'deadbeef', protocol: 'CAN', supported: true });
    hal.emit(snap([signal('vehicle.speed', 60), signal('vehicle.ignition', true, { supported: true })], 2));
    for (const e of bus.events) expect(CATALOG_NAMES.has(e.name)).toBe(true);
  });

  it('40) mevcut modülleri VALUE import etmiyor (yalnız type)', () => {
    expect(bridgeSource).not.toMatch(/import\s+\{[^}]*\}\s+from\s+['"].*platformEventBus/); // value import yok
    expect(bridgeSource).not.toMatch(/from ['"].*\/vehicleHal['"]/);
    expect(bridgeSource).toMatch(/import type/);
  });
});
