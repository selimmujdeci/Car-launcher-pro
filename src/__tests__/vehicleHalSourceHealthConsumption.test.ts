/**
 * vehicleHalSourceHealthConsumption.test.ts — PR-2: Source Health → HAL fail-closed tüketimi.
 *
 * AKIŞ: worker watchdog → SOURCE_HEALTH → halStatusStore → provider snapshot → adapter → HAL → bridge.
 *
 * ÇEKİRDEK KURALLAR:
 *  • `null` = BİLİNMİYOR → SAHTE disconnect YOK (davranış W4B ile aynı kalır).
 *  • `can=false` = CAN KESİN ölü → yalnız CAN-ÖZEL sinyaller `source:'none'` (fail-closed).
 *  • Füzyon sinyalleri (speed/rpm/fuel/odometer/reverse) başka kaynak canlıysa SUPPORTED kalır.
 *  • `can=true` TEK BAŞINA eski değeri DİRİLTMEZ — yalnız GERÇEKTEN YENİ veri supported yapar.
 *  • Tek batch / tek HAL emit (W4A korunur); aynı durum duplicate emit üretmez.
 *  • Yeni timer YOK.
 */

import { describe, it, expect } from 'vitest';
import {
  createVehicleHalProviderAdapter,
  createVehicleHal,
  createUnifiedVehicleStoreProvider,
  type VehicleHalSnapshot,
  type VehicleSignalId,
  type VehicleSignalInput,
  type UnifiedVehicleStateReadable,
  type UnifiedVehicleStoreLike,
  type HalStatusStoreLike,
} from '../platform/vehicleHal';
import { createPlatformEventBus, createVehicleHalEventBridge, type PlatformEvent } from '../platform/eventBus';
import adapterSrc from '../platform/vehicleHal/vehicleHalProviderAdapter.ts?raw';
import providerSrc from '../platform/vehicleHal/providers/unifiedVehicleStoreProvider.ts?raw';

const NOW = 11_000_000;

type Health = { canAlive: boolean | null; obdAlive: boolean | null; gpsAlive: boolean | null; updatedAt: number | null };
const UNKNOWN: Health = { canAlive: null, obdAlive: null, gpsAlive: null, updatedAt: null };

function fakeStores(initial: UnifiedVehicleStateReadable, health: Health = UNKNOWN) {
  let state = initial;
  let h = health;
  const sl = new Set<() => void>();
  const hl = new Set<() => void>();
  const store: UnifiedVehicleStoreLike = {
    getState: () => state,
    subscribe: (l) => { const w = () => l(state); sl.add(w); return () => { sl.delete(w); }; },
  };
  const healthStore: HalStatusStoreLike = {
    getState: () => ({ sourceHealth: h }),
    subscribe: (l) => { hl.add(l); return () => { hl.delete(l); }; },
  };
  return {
    store, healthStore,
    setState: (next: UnifiedVehicleStateReadable) => { state = next; sl.forEach((f) => f()); },
    setHealth: (next: Partial<Health>) => { h = { ...h, ...next }; hl.forEach((f) => f()); },
    subCount: () => sl.size + hl.size,
  };
}

/** Gerçek HAL + provider + adapter zinciri (emit sayacı ile). */
function chain(initial: UnifiedVehicleStateReadable, health: Health = UNKNOWN) {
  const s = fakeStores(initial, health);
  const hal = createVehicleHal({ now: () => NOW });
  const emits: VehicleHalSnapshot[] = [];
  hal.subscribe((snap) => emits.push(snap));
  const provider = createUnifiedVehicleStoreProvider({ store: s.store, healthStore: s.healthStore });
  const adapter = createVehicleHalProviderAdapter({ hal, source: provider, now: () => NOW });
  return { ...s, hal, emits, provider, adapter };
}

/** Batch'leri kaydeden fake HAL (batch/emit sayımı için). */
function batchChain(initial: UnifiedVehicleStateReadable, health: Health = UNKNOWN) {
  const s = fakeStores(initial, health);
  const batches: Partial<Record<VehicleSignalId, VehicleSignalInput>>[] = [];
  const hal = { ingest: (b: Partial<Record<VehicleSignalId, VehicleSignalInput>>) => { batches.push(b); } };
  const provider = createUnifiedVehicleStoreProvider({ store: s.store, healthStore: s.healthStore });
  const adapter = createVehicleHalProviderAdapter({ hal, source: provider, now: () => NOW });
  return { ...s, batches, adapter, provider, lastKeys: () => Object.keys(batches[batches.length - 1] ?? {}) as VehicleSignalId[] };
}

const CAN_SIGNALS: VehicleSignalId[] = [
  'vehicle.coolant_temp', 'vehicle.oil_temp', 'vehicle.throttle', 'vehicle.battery_voltage',
  'vehicle.gear', 'vehicle.ambient_temp', 'vehicle.tpms', 'vehicle.door_state', 'vehicle.parking_brake',
];

/* ── UNKNOWN: sahte disconnect yok ────────────────────────────────────────── */

describe('PR-2 — sourceHealth UNKNOWN (null)', () => {
  it('health bilinmiyorken SAHTE disconnect üretilmez (W4B davranışı korunur)', () => {
    const c = chain({ speed: 50, canCoolantTemp: 90, canRpm: 1200 });
    c.adapter.start();
    expect(c.hal.hasSignal('vehicle.coolant_temp')).toBe(true);
    expect(c.hal.getCoolantTemp()).toBe(90);
    expect(c.hal.hasSignal('vehicle.speed')).toBe(true);
  });

  it('ilk boot\'ta unsupported batch ÜRETİLMEZ (health null + veri yok)', () => {
    const c = batchChain({});
    c.adapter.start();
    expect(c.batches.length).toBe(0);
  });

  it('health null iken hiç aktarılmamış sinyal source:none YAPILMAZ', () => {
    const c = batchChain({ speed: 40 });
    c.adapter.start();
    expect(c.lastKeys()).toEqual(['vehicle.speed']);   // coolant vb. için "none" yok
  });

  it('healthStore VERİLMEZSE snapshot sağlığı UNKNOWN → davranış değişmez', () => {
    const s = fakeStores({ speed: 30, canCoolantTemp: 88 });
    const provider = createUnifiedVehicleStoreProvider({ store: s.store });   // healthStore YOK
    const snap = provider.getSnapshot()!;
    expect(snap.sourceHealth?.can).toBeNull();
    expect(snap.canCoolantTemp).toBe(88);
  });
});

/* ── CAN DEAD: fail-closed, yalnız CAN-özel sinyaller ─────────────────────── */

describe('PR-2 — can=false (KESİN ölü)', () => {
  it('yalnız CAN-ÖZEL sinyaller unsupported olur (füzyon speed SUPPORTED kalır)', () => {
    const c = chain(
      { speed: 55, canCoolantTemp: 90, canOilTemp: 100, canGearPos: 3, canDoorOpen: true },
      { ...UNKNOWN, canAlive: true },
    );
    c.adapter.start();
    expect(c.hal.hasSignal('vehicle.coolant_temp')).toBe(true);

    c.setHealth({ canAlive: false });                  // ECU sustu, store değerleri DONMUŞ
    expect(c.hal.hasSignal('vehicle.coolant_temp')).toBe(false);
    expect(c.hal.getSignal('vehicle.coolant_temp')!.source).toBe('none');
    expect(c.hal.getSignal('vehicle.coolant_temp')!.value).toBeNull();
    expect(c.hal.hasSignal('vehicle.oil_temp')).toBe(false);
    expect(c.hal.hasSignal('vehicle.gear')).toBe(false);
    expect(c.hal.hasSignal('vehicle.door_state')).toBe(false);
    // Füzyon korunur:
    expect(c.hal.hasSignal('vehicle.speed')).toBe(true);
    expect(c.hal.getSpeed()).toBe(55);
  });

  it('disconnect geçişi TEK batch / TEK HAL emit üretir', () => {
    const c = chain(
      { speed: 55, canCoolantTemp: 90, canOilTemp: 100, canBatteryVolt: 14, canGearPos: 3 },
      { ...UNKNOWN, canAlive: true },
    );
    c.adapter.start();
    const before = c.emits.length;
    c.setHealth({ canAlive: false });                  // 4 CAN sinyali birden düşer
    expect(c.emits.length - before).toBe(1);           // TEK emit
  });

  it('aynı false TEKRARINDA duplicate batch/emit YOK', () => {
    const c = chain({ speed: 55, canCoolantTemp: 90 }, { ...UNKNOWN, canAlive: true });
    c.adapter.start();
    c.setHealth({ canAlive: false });
    const after = c.emits.length;
    c.setHealth({ canAlive: false });                  // aynı durum
    c.adapter.refresh();
    c.adapter.refresh();
    expect(c.emits.length).toBe(after);
  });

  it('CAN boolean `false` GERÇEK veri (can canlıyken) — "kaynak yok" ile karışmaz', () => {
    const c = chain(
      { canRpm: 900, canDoorOpen: false, canParkingBrake: false },
      { ...UNKNOWN, canAlive: true },
    );
    c.adapter.start();
    expect(c.hal.hasSignal('vehicle.door_state')).toBe(true);
    expect(c.hal.getSignal('vehicle.door_state')!.value).toBe(false);
    expect(c.hal.hasSignal('vehicle.parking_brake')).toBe(true);
  });

  it('CAN-özel sinyallerin TAMAMI düşer, füzyon hiç etkilenmez (matris kilidi)', () => {
    const c = chain({
      speed: 20, rpm: 1500, fuel: 60, odometer: 1000, reverse: false,
      canCoolantTemp: 90, canOilTemp: 100, canThrottle: 20, canBatteryVolt: 14,
      canGearPos: 2, canAmbientTemp: 18, canTpmsKpa: [220, 221, 222, 223],
      canDoorOpen: false, canParkingBrake: false,
    }, { ...UNKNOWN, canAlive: true });
    c.adapter.start();
    c.setHealth({ canAlive: false });
    for (const id of CAN_SIGNALS) expect(c.hal.hasSignal(id), id).toBe(false);
    for (const id of ['vehicle.speed', 'vehicle.rpm', 'vehicle.fuel_level', 'vehicle.odometer', 'vehicle.reverse'] as VehicleSignalId[]) {
      expect(c.hal.hasSignal(id), id).toBe(true);
    }
  });

  it('ignition HİÇBİR durumda üretilmez (kaynak yok)', () => {
    const c = chain({ speed: 10, canCoolantTemp: 90 }, { ...UNKNOWN, canAlive: true });
    c.adapter.start();
    c.setHealth({ canAlive: false });
    expect(c.hal.hasSignal('vehicle.ignition')).toBe(false);
  });
});

/* ── Fallback ─────────────────────────────────────────────────────────────── */

describe('PR-2 — fallback', () => {
  it('rpm: CAN ölünce BAYAT canRpm KULLANILMAZ; fused rpm varsa supported kalır', () => {
    const c = chain({ rpm: 1800, canRpm: 900 }, { ...UNKNOWN, canAlive: true });
    c.adapter.start();
    expect(c.hal.getRPM()).toBe(1800);
    c.setHealth({ canAlive: false });
    expect(c.hal.hasSignal('vehicle.rpm')).toBe(true);      // füzyon rpm canlı
    expect(c.hal.getRPM()).toBe(1800);
  });

  it('rpm: CAN ölü + fused rpm YOK → unsupported (bayat canRpm diriltmez)', () => {
    const c = chain({ canRpm: 900 }, { ...UNKNOWN, canAlive: true });
    c.adapter.start();
    expect(c.hal.getRPM()).toBe(900);
    c.setHealth({ canAlive: false });
    expect(c.hal.hasSignal('vehicle.rpm')).toBe(false);
  });

  it('speed/reverse GPS/worker füzyonuyla canlıysa CAN ölse de supported', () => {
    const c = chain({ speed: 42, reverse: true, canCoolantTemp: 90 }, { ...UNKNOWN, canAlive: true });
    c.adapter.start();
    c.setHealth({ canAlive: false });
    expect(c.hal.hasSignal('vehicle.speed')).toBe(true);
    expect(c.hal.getSignal('vehicle.reverse')!.value).toBe(true);
    expect(c.hal.getSignal('vehicle.speed')!.source).toBe('inferred');   // metadata bozulmadı
  });

  it('obd/gps health CAN sinyallerini ETKİLEMEZ (kaynaklar bağımsız)', () => {
    const c = chain({ canCoolantTemp: 90, speed: 10 }, { ...UNKNOWN, canAlive: true, obdAlive: true, gpsAlive: true });
    c.adapter.start();
    c.setHealth({ obdAlive: false, gpsAlive: false });      // CAN hâlâ canlı
    expect(c.hal.hasSignal('vehicle.coolant_temp')).toBe(true);
  });
});

/* ── Reconnect (sahte diriltme yasağı) ────────────────────────────────────── */

describe('PR-2 — reconnect', () => {
  it('can=true TEK BAŞINA eski (bayat) değeri DİRİLTMEZ', () => {
    const c = chain({ speed: 10, canCoolantTemp: 90 }, { ...UNKNOWN, canAlive: true });
    c.adapter.start();
    c.setHealth({ canAlive: false });
    expect(c.hal.hasSignal('vehicle.coolant_temp')).toBe(false);

    c.setHealth({ canAlive: true });                       // sağlık döndü, YENİ frame YOK
    expect(c.hal.hasSignal('vehicle.coolant_temp')).toBe(false);   // hâlâ unsupported
    expect(c.hal.getCoolantTemp()).toBeNull();
  });

  it('YENİ gerçek veri gelince supported=true + gerçek source/quality/confidence', () => {
    const c = chain({ speed: 10, canCoolantTemp: 90 }, { ...UNKNOWN, canAlive: true });
    c.adapter.start();
    c.setHealth({ canAlive: false });
    c.setHealth({ canAlive: true });
    c.setState({ speed: 10, canCoolantTemp: 95 });          // TAZE frame
    const sig = c.hal.getSignal('vehicle.coolant_temp')!;
    expect(sig.supported).toBe(true);
    expect(sig.value).toBe(95);
    expect(sig.source).toBe('can');
    expect(sig.quality).toBe('high');
    expect(sig.confidence).toBe(0.9);
  });

  it('reconnect TEK batch/TEK emit; tekrar eden aynı veri duplicate emit üretmez', () => {
    const c = chain({ canCoolantTemp: 90, canOilTemp: 100 }, { ...UNKNOWN, canAlive: true });
    c.adapter.start();
    c.setHealth({ canAlive: false });
    c.setHealth({ canAlive: true });
    const before = c.emits.length;
    c.setState({ canCoolantTemp: 91, canOilTemp: 101 });    // ikisi birden taze
    expect(c.emits.length - before).toBe(1);
    c.setState({ canCoolantTemp: 91, canOilTemp: 101 });    // aynı veri
    expect(c.emits.length - before).toBe(1);
  });
});

/* ── Bridge entegrasyonu (connection.changed) ─────────────────────────────── */

describe('PR-2 — bridge connection.changed', () => {
  function withBridge(initial: UnifiedVehicleStateReadable, health: Health) {
    const c = chain(initial, health);
    const bus = createPlatformEventBus({ now: () => NOW });
    const events: PlatformEvent[] = [];
    bus.subscribeDomain('vehicle', (e) => events.push(e));
    const bridge = createVehicleHalEventBridge({ hal: c.hal, bus });
    bridge.start();
    return { ...c, bus, events, bridge, conn: () => events.filter((e) => e.name === 'vehicle.connection.changed')
      .map((e) => (e.payload as { connected: boolean }).connected) };
  }

  it('TÜM destek kalkınca connection=false yayınlanır', () => {
    const b = withBridge({ canCoolantTemp: 90, canRpm: 1200 }, { ...UNKNOWN, canAlive: true });
    b.adapter.start();
    expect(b.conn()).toEqual([true]);
    b.setHealth({ canAlive: false });                      // CAN-özel + rpm(canRpm) düşer
    expect(b.conn()).toEqual([true, false]);
    expect(b.bridge.getStatus().droppedCount).toBe(0);
  });

  it('KISMİ kayıpta connection=false yayınlanmaz (speed hâlâ supported)', () => {
    const b = withBridge({ speed: 44, canCoolantTemp: 90 }, { ...UNKNOWN, canAlive: true });
    b.adapter.start();
    b.setHealth({ canAlive: false });
    expect(b.conn()).toEqual([true]);                       // false YOK
  });

  it('reconnect sonrası connection=true YALNIZ gerçek veri gelince', () => {
    const b = withBridge({ canCoolantTemp: 90 }, { ...UNKNOWN, canAlive: true });
    b.adapter.start();
    b.setHealth({ canAlive: false });
    b.setHealth({ canAlive: true });                        // henüz frame yok
    expect(b.conn()).toEqual([true, false]);
    b.setState({ canCoolantTemp: 95 });                     // taze frame
    expect(b.conn()).toEqual([true, false, true]);
  });
});

/* ── Lifecycle & kapsam ───────────────────────────────────────────────────── */

describe('PR-2 — lifecycle & kapsam', () => {
  it('provider TEK abonelik kaydeder (araç + sağlık store\'u tek unsub\'a sarılır)', () => {
    const c = chain({ speed: 10 }, UNKNOWN);
    c.adapter.start();
    expect(c.provider.activeSubscriptionCount).toBe(1);     // teşhis invaryantı korunur
    expect(c.subCount()).toBe(2);                            // altta 2 store aboneliği (araç+sağlık)
  });

  it('cleanup sonrası health değişimi HAL\'e AKMAZ; abonelikler bırakılır', () => {
    const c = chain({ speed: 10, canCoolantTemp: 90 }, { ...UNKNOWN, canAlive: true });
    c.adapter.start();
    c.adapter.dispose();
    c.setHealth({ canAlive: false });
    expect(c.hal.hasSignal('vehicle.coolant_temp')).toBe(true);   // akmadı
    expect(c.provider.activeSubscriptionCount).toBe(0);
    expect(c.subCount()).toBe(0);
  });

  it('boot → shutdown → boot abonelik ÇOĞALTMAZ', () => {
    const c = chain({ speed: 10 }, UNKNOWN);
    c.adapter.start();
    c.adapter.stop();
    c.adapter.start();
    expect(c.provider.activeSubscriptionCount).toBe(1);
  });

  it('yeni timer/polling YOK; import yan etkisiz', () => {
    for (const src of [adapterSrc, providerSrc]) {
      expect(src).not.toMatch(/setInterval|setTimeout|requestAnimationFrame/);
      expect(src).not.toMatch(/window\.__|globalThis\./);
    }
    // Provider/adapter store'ları DOĞRUDAN import etmez (yapısal DI).
    expect(providerSrc).not.toMatch(/from\s+['"][^'"]*halStatusStore/);
    expect(adapterSrc).not.toMatch(/from\s+['"][^'"]*(halStatusStore|UnifiedVehicleStore)/);
  });

  it('worker/resolver/SystemBoot/bridge foundation DEĞİŞMEDİ (kapsam)', () => {
    expect(adapterSrc).not.toMatch(/from\s+['"][^'"]*(eventBus|bridges?|kernel|capability|deepScan)/i);
    expect(providerSrc).not.toMatch(/from\s+['"][^'"]*(eventBus|bridges?|kernel)/i);
  });
});
