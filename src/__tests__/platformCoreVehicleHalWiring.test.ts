/**
 * platformCoreVehicleHalWiring.test.ts — PR-W2 Vehicle HAL Runtime Wiring invariant kilitleri.
 *
 * Test izolasyonu: gerçek `vehicleHal` singleton PAYLAŞILMAZ — fake HAL + fake store DI ile
 * her test kendi izole zincirini kurar. Invariant odaklı; kırılgan kaynak-regex YALNIZ
 * kapsam-dışı import yasağı ve SystemBoot sıra kilidi için kullanılır.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  startPlatformCoreVehicleHalWiring,
  getVehicleHalWiringStatus,
} from '../platform/system/platformCoreVehicleHalWiring';
import type { VehicleHalIngestTarget } from '../platform/vehicleHal';
import type { UnifiedVehicleStoreLike, UnifiedVehicleStateReadable } from '../platform/vehicleHal/providers';

/* ── Fake'ler (yapısal DI — gerçek singleton'a dokunulmaz) ─────────────────── */

interface FakeHal extends VehicleHalIngestTarget {
  readonly ingests: Array<{ id: string; value: unknown }>;
}
function createFakeHal(): FakeHal {
  const ingests: Array<{ id: string; value: unknown }> = [];
  return {
    ingestSignal(id, input) { ingests.push({ id: String(id), value: input.value }); return null; },
    ingests,
  };
}

interface FakeStore extends UnifiedVehicleStoreLike {
  set(next: Partial<UnifiedVehicleStateReadable>): void;
  readonly listenerCount: number;
}
function createFakeStore(initial: UnifiedVehicleStateReadable): FakeStore {
  let state: UnifiedVehicleStateReadable = { ...initial };
  const listeners = new Set<(s: UnifiedVehicleStateReadable) => void>();
  return {
    getState: () => state,
    subscribe: (l) => { listeners.add(l); return () => { listeners.delete(l); }; },
    set: (next) => { state = { ...state, ...next }; listeners.forEach((l) => l(state)); },
    get listenerCount() { return listeners.size; },
  };
}

const idsOf = (hal: FakeHal) => hal.ingests.map((x) => x.id);
const valuesOf = (hal: FakeHal, id: string) => hal.ingests.filter((x) => x.id === id).map((x) => x.value);

const SRC_DIR = join(process.cwd(), 'src');
const WIRING_SRC = readFileSync(join(SRC_DIR, 'platform', 'system', 'platformCoreVehicleHalWiring.ts'), 'utf8');
const SYSTEMBOOT_SRC = readFileSync(join(SRC_DIR, 'platform', 'system', 'SystemBoot.ts'), 'utf8');

/** Aktif wiring kaydı testler arası SIZMASIN (tek-instance guard modül düzeyinde). */
const _open: Array<() => void> = [];
function start(deps: { store: UnifiedVehicleStoreLike | null; hal?: VehicleHalIngestTarget }) {
  const c = startPlatformCoreVehicleHalWiring(deps);
  _open.push(c);
  return c;
}
afterEach(() => {
  while (_open.length) { try { _open.pop()!(); } catch { /* */ } }
});

/* ── Yaşam döngüsü + veri akışı ────────────────────────────────────────────── */

describe('PR-W2 Vehicle HAL wiring — yaşam döngüsü & veri akışı', () => {
  it('1) import side-effect yok: wiring çağrılmadan store aboneliği kurulmaz', () => {
    const store = createFakeStore({ speed: 50 });
    expect(store.listenerCount).toBe(0);
  });

  it('2) wiring oluşturulur ve cleanup thunk döner', () => {
    const store = createFakeStore({ speed: 50 });
    const cleanup = start({ store, hal: createFakeHal() });
    expect(typeof cleanup).toBe('function');
  });

  it('3) provider gerçek store API\'sine (getState + subscribe) bağlanır', () => {
    const store = createFakeStore({ speed: 50 });
    const getState = vi.spyOn(store, 'getState');
    const subscribe = vi.spyOn(store, 'subscribe');
    start({ store, hal: createFakeHal() });
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(getState).toHaveBeenCalled();          // adapter.start() → ilk refresh
  });

  it('4) wiring sonrası TEK subscription', () => {
    const store = createFakeStore({ speed: 50 });
    start({ store, hal: createFakeHal() });
    expect(store.listenerCount).toBe(1);
  });

  it('5) speed HAL\'e akar', () => {
    const store = createFakeStore({ speed: 50 });
    const hal = createFakeHal();
    start({ store, hal });
    expect(valuesOf(hal, 'vehicle.speed')).toContain(50);
  });

  it('6) rpm HAL\'e akar', () => {
    const store = createFakeStore({ speed: 10, rpm: 2400 });
    const hal = createFakeHal();
    start({ store, hal });
    expect(valuesOf(hal, 'vehicle.rpm')).toContain(2400);
  });

  it('7) CAN extras (coolant/oil/throttle/voltaj/gear/ambient) HAL\'e akar', () => {
    const store = createFakeStore({
      speed: 40, canCoolantTemp: 90, canOilTemp: 105, canThrottle: 32,
      canBatteryVolt: 14.1, canGearPos: 3, canAmbientTemp: 21,
    });
    const hal = createFakeHal();
    start({ store, hal });
    const ids = idsOf(hal);
    for (const id of [
      'vehicle.coolant_temp', 'vehicle.oil_temp', 'vehicle.throttle',
      'vehicle.battery_voltage', 'vehicle.gear', 'vehicle.ambient_temp',
    ]) expect(ids).toContain(id);
  });

  it('8) store güncellemesi HAL\'e aktarılır', () => {
    const store = createFakeStore({ speed: 50 });
    const hal = createFakeHal();
    start({ store, hal });
    store.set({ speed: 60 });
    expect(valuesOf(hal, 'vehicle.speed')).toEqual([50, 60]);
  });

  it('9) aynı değer DUPLICATE ingest üretmez', () => {
    const store = createFakeStore({ speed: 50 });
    const hal = createFakeHal();
    start({ store, hal });
    store.set({ speed: 50 });
    store.set({ speed: 50 });
    expect(valuesOf(hal, 'vehicle.speed')).toEqual([50]);
  });

  it('10) değişen değer ingest EDİLİR (dedupe yalnız aynı değere)', () => {
    const store = createFakeStore({ speed: 50 });
    const hal = createFakeHal();
    start({ store, hal });
    store.set({ speed: 60 });
    store.set({ speed: 60 });
    store.set({ speed: 70 });
    expect(valuesOf(hal, 'vehicle.speed')).toEqual([50, 60, 70]);
  });
});

/* ── Duplicate / tek-instance / lifecycle ─────────────────────────────────── */

describe('PR-W2 wiring — duplicate & lifecycle', () => {
  it('11) start İDEMPOTENT: aktifken ikinci wiring İKİNCİ subscription açmaz', () => {
    const store = createFakeStore({ speed: 50 });
    start({ store, hal: createFakeHal() });
    start({ store, hal: createFakeHal() });     // duplicate çağrı
    expect(store.listenerCount).toBe(1);        // TEK abonelik
  });

  it('12) duplicate wiring İKİNCİ adapter\'ı beslemez (yalnız ilk zincir canlı)', () => {
    const store = createFakeStore({ speed: 50 });
    const hal1 = createFakeHal();
    const hal2 = createFakeHal();
    start({ store, hal: hal1 });
    start({ store, hal: hal2 });
    store.set({ speed: 60 });
    expect(valuesOf(hal1, 'vehicle.speed')).toEqual([50, 60]);
    expect(hal2.ingests.length).toBe(0);        // ikinci HAL hiç beslenmez
  });

  it('13) cleanup adapter+provider\'ı durdurur: sonraki veri HAL\'e gitmez', () => {
    const store = createFakeStore({ speed: 50 });
    const hal = createFakeHal();
    const cleanup = start({ store, hal });
    cleanup();
    store.set({ speed: 999 });
    expect(valuesOf(hal, 'vehicle.speed')).toEqual([50]);
    expect(store.listenerCount).toBe(0);        // abonelik bırakıldı (zero-leak)
  });

  it('14) cleanup İDEMPOTENT (ikinci çağrı no-op, çökmesiz)', () => {
    const store = createFakeStore({ speed: 50 });
    const cleanup = start({ store, hal: createFakeHal() });
    cleanup();
    expect(() => cleanup()).not.toThrow();
    expect(store.listenerCount).toBe(0);
  });

  it('15) boot → shutdown → boot güvenli, subscription ÇOĞALTMAZ', () => {
    const store = createFakeStore({ speed: 50 });
    const hal = createFakeHal();
    const c1 = start({ store, hal });
    c1();
    const c2 = start({ store, hal });
    expect(store.listenerCount).toBe(1);
    store.set({ speed: 80 });
    expect(valuesOf(hal, 'vehicle.speed')).toContain(80);   // ikinci boot canlı
    c2();
    expect(store.listenerCount).toBe(0);
  });

  it('16) dispose sonrası store callback\'i no-op (HAL beslenmez)', () => {
    const store = createFakeStore({ speed: 50 });
    const hal = createFakeHal();
    const cleanup = start({ store, hal });
    const before = hal.ingests.length;
    cleanup();
    store.set({ speed: 51 });
    store.set({ canCoolantTemp: 95 });
    expect(hal.ingests.length).toBe(before);
  });

  it('17) cleanup HAL\'i DISPOSE ETMEZ (paylaşılan singleton — sahiplik provider/adapter\'da)', () => {
    const dispose = vi.fn();
    const store = createFakeStore({ speed: 50 });
    const halWithDispose = { ...createFakeHal(), dispose } as unknown as VehicleHalIngestTarget;
    const cleanup = start({ store, hal: halWithDispose });
    cleanup();
    expect(dispose).not.toHaveBeenCalled();
  });

  it('18) eski wiring temizlenince yeni wiring bloke OLMAZ (HMR/restart)', () => {
    const s1 = createFakeStore({ speed: 10 });
    const c1 = start({ store: s1, hal: createFakeHal() });
    c1();
    const s2 = createFakeStore({ speed: 20 });
    const hal2 = createFakeHal();
    start({ store: s2, hal: hal2 });
    expect(s2.listenerCount).toBe(1);
    expect(valuesOf(hal2, 'vehicle.speed')).toContain(20);
  });
});

/* ── Fail-soft ────────────────────────────────────────────────────────────── */

describe('PR-W2 wiring — fail-soft', () => {
  it('19) store hazır değilse (null) wiring throw ETMEZ, cleanup thunk döner', () => {
    let cleanup: (() => void) | null = null;
    expect(() => { cleanup = start({ store: null, hal: createFakeHal() }); }).not.toThrow();
    expect(typeof cleanup).toBe('function');
    expect(() => cleanup!()).not.toThrow();
  });

  it('20) store null iken wiring KİLİTLENMEZ — sonraki gerçek wiring çalışır', () => {
    start({ store: null, hal: createFakeHal() });
    const store = createFakeStore({ speed: 33 });
    const hal = createFakeHal();
    start({ store, hal });
    expect(store.listenerCount).toBe(1);
    expect(valuesOf(hal, 'vehicle.speed')).toContain(33);
  });

  it('21) getState throw eden bozuk store\'da wiring throw ETMEZ (provider hatası izole)', () => {
    const badStore = {
      getState: () => { throw new Error('boom'); },
      subscribe: (_l: (s: UnifiedVehicleStateReadable) => void) => () => { /* */ },
    } as unknown as UnifiedVehicleStoreLike;
    const hal = createFakeHal();
    expect(() => { start({ store: badStore, hal }); }).not.toThrow();
    expect(hal.ingests.length).toBe(0);          // veri okunamadı ama çökmedi
  });

  it('22) subscribe throw eden store\'da wiring throw ETMEZ (adapter start hatası izole)', () => {
    const badStore = {
      getState: () => ({ speed: 42 }),
      subscribe: () => { throw new Error('subscribe fail'); },
    } as unknown as UnifiedVehicleStoreLike;
    const hal = createFakeHal();
    expect(() => { start({ store: badStore, hal }); }).not.toThrow();
    expect(valuesOf(hal, 'vehicle.speed')).toContain(42);   // ilk refresh yine de aktı
  });

  it('23) HAL ingest hatası diğer sinyalleri engellemez (tek sinyal bozuksa diğerleri sürer)', () => {
    let calls = 0;
    const flakyHal: VehicleHalIngestTarget = {
      ingestSignal(id) { calls++; if (String(id) === 'vehicle.speed') throw new Error('hal fail'); return null; },
    };
    const store = createFakeStore({ speed: 50, canCoolantTemp: 90 });
    expect(() => { start({ store, hal: flakyHal }); }).not.toThrow();
    expect(calls).toBeGreaterThan(1);
  });

  it('24) cleanup hatası shutdown\'ı ENGELLEMEZ (throw etmez)', () => {
    const store = createFakeStore({ speed: 50 });
    const unsubThrows = {
      getState: () => ({ speed: 50 }),
      subscribe: () => () => { throw new Error('unsub fail'); },
    } as unknown as UnifiedVehicleStoreLike;
    void store;
    const cleanup = start({ store: unsubThrows, hal: createFakeHal() });
    expect(() => cleanup()).not.toThrow();
  });

  it('25) public wiring API throw ETMEZ (deps bozuk olsa da)', () => {
    expect(() => {
      const c = startPlatformCoreVehicleHalWiring({ store: undefined });
      c();
    }).not.toThrow();
    expect(() => getVehicleHalWiringStatus()).not.toThrow();
  });
});

/* ── Sinyal davranışı ──────────────────────────────────────────────────────── */

describe('PR-W2 wiring — sinyal davranışı', () => {
  it('26) ignition kaynağı YOK → HAL\'e HİÇ ingest edilmez (supported=false kalır)', () => {
    const store = createFakeStore({ speed: 50, rpm: 2000, canCoolantTemp: 90 });
    const hal = createFakeHal();
    start({ store, hal });
    expect(idsOf(hal)).not.toContain('vehicle.ignition');
  });

  it('27) TPMS yalnız gerçek 4-tuple veri varsa akar', () => {
    const s1 = createFakeStore({ speed: 50 });
    const h1 = createFakeHal();
    const c1 = start({ store: s1, hal: h1 });
    expect(idsOf(h1)).not.toContain('vehicle.tpms');
    c1();

    const s2 = createFakeStore({ speed: 50, canTpmsKpa: [220, 225, 230, 228] });
    const h2 = createFakeHal();
    start({ store: s2, hal: h2 });
    expect(idsOf(h2)).toContain('vehicle.tpms');
  });

  it('28) reverse yalnız aktif araç verisi varken akar (park default\'u kaynak sanmaz)', () => {
    const s1 = createFakeStore({ reverse: false });          // hiçbir numerik sinyal yok
    const h1 = createFakeHal();
    const c1 = start({ store: s1, hal: h1 });
    expect(idsOf(h1)).not.toContain('vehicle.reverse');
    c1();

    const s2 = createFakeStore({ speed: 0, rpm: 800, reverse: true });
    const h2 = createFakeHal();
    start({ store: s2, hal: h2 });
    expect(valuesOf(h2, 'vehicle.reverse')).toContain(true);
  });

  it('29) gizlilik: GPS konum/heading gibi alanlar HAL\'e SIZMAZ (yalnız katalog sinyalleri)', () => {
    const ALLOWED = new Set([
      'vehicle.speed', 'vehicle.rpm', 'vehicle.fuel_level', 'vehicle.odometer', 'vehicle.reverse',
      'vehicle.coolant_temp', 'vehicle.oil_temp', 'vehicle.throttle', 'vehicle.battery_voltage',
      'vehicle.gear', 'vehicle.ambient_temp', 'vehicle.tpms', 'vehicle.door_state', 'vehicle.parking_brake',
    ]);
    const store = createFakeStore({
      speed: 50, rpm: 2000,
      // Store'da GERÇEKTEN bulunan ama HAL kapsamı DIŞINDA olan alanlar:
      ...({ location: { lat: 41.0, lon: 29.0 }, heading: 180, gpsSource: 'native' } as object),
    } as UnifiedVehicleStateReadable);
    const hal = createFakeHal();
    start({ store, hal });
    for (const id of idsOf(hal)) expect(ALLOWED.has(id)).toBe(true);
    const payload = JSON.stringify(hal.ingests);
    expect(payload).not.toMatch(/41\.0|29\.0|native/);       // koordinat/kaynak sızmadı
  });

  it('30) store state MUTATE EDİLMEZ (dondurulmuş state ile de çalışır)', () => {
    const frozen = Object.freeze({ speed: 55, canCoolantTemp: 88 }) as UnifiedVehicleStateReadable;
    const store: UnifiedVehicleStoreLike = { getState: () => frozen, subscribe: () => () => { /* */ } };
    const hal = createFakeHal();
    expect(() => { start({ store, hal }); }).not.toThrow();
    expect(frozen).toEqual({ speed: 55, canCoolantTemp: 88 });
    expect(valuesOf(hal, 'vehicle.speed')).toContain(55);
  });
});

/* ── Gözlemlenebilirlik (bounded) ─────────────────────────────────────────── */

describe('PR-W2 wiring — bounded status', () => {
  it('31) wiring kapalıyken status started=false / subscription=0', () => {
    const s = getVehicleHalWiringStatus();
    expect(s.started).toBe(false);
    expect(s.activeSubscriptionCount).toBe(0);
  });

  it('32) aktif wiring status: started=true, TEK subscription, ingest sayacı artar', () => {
    const store = createFakeStore({ speed: 50, canCoolantTemp: 90 });
    start({ store, hal: createFakeHal() });
    const s = getVehicleHalWiringStatus();
    expect(s.started).toBe(true);
    expect(s.activeSubscriptionCount).toBe(1);
    expect(s.ingestedSignalCount).toBeGreaterThanOrEqual(2);
    expect(s.refreshCount).toBeGreaterThanOrEqual(1);
    expect(Object.isFrozen(s)).toBe(true);                   // immutable görünüm
  });

  it('33) cleanup sonrası status started=false\'a döner', () => {
    const store = createFakeStore({ speed: 50 });
    const cleanup = start({ store, hal: createFakeHal() });
    cleanup();
    expect(getVehicleHalWiringStatus().started).toBe(false);
  });
});

/* ── Kapsam sınırı (kaynak-kilidi — kırılgan regex yalnız burada) ──────────── */

describe('PR-W2 wiring — kapsam sınırı', () => {
  it('34) Event Bus / Capability / Deep Scan import EDİLMEZ', () => {
    expect(WIRING_SRC).not.toMatch(/from\s+['"][^'"]*eventBus/);
    expect(WIRING_SRC).not.toMatch(/from\s+['"][^'"]*capability/i);
    expect(WIRING_SRC).not.toMatch(/from\s+['"][^'"]*deepScan/i);
  });

  it('35) Platform Kernel import EDİLMEZ (legacy servisler Kernel\'e TAŞINMAZ)', () => {
    expect(WIRING_SRC).not.toMatch(/from\s+['"][^'"]*kernel/i);
    expect(SYSTEMBOOT_SRC).not.toMatch(/from\s+['"][^'"]*kernel/i);
  });

  it('36) native / OBD / CAN katmanı import EDİLMEZ (poll frekansı değişmez)', () => {
    expect(WIRING_SRC).not.toMatch(/from\s+['"][^'"]*(obdService|canbus|nativePlugin|bridge)['"]/i);
  });

  it('37) yeni timer/polling/rAF AÇILMAZ (BASIC_JS/Mali-400 sürekli yük yok)', () => {
    expect(WIRING_SRC).not.toMatch(/setInterval|setTimeout|requestAnimationFrame/);
  });

  it('38) hot-path\'te ağır serileştirme YOK (JSON.stringify / structuredClone / deep clone)', () => {
    expect(WIRING_SRC).not.toMatch(/JSON\.stringify|structuredClone/);
  });

  it('39) İKİNCİ HAL instance ÜRETİLMEZ (paylaşılan `vehicleHal` singleton kullanılır)', () => {
    expect(WIRING_SRC).not.toMatch(/createVehicleHal\s*\(/);
    expect(WIRING_SRC).toMatch(/vehicleHal/);
  });
});

/* ── SystemBoot entegrasyon sıra kilidi ────────────────────────────────────── */

describe('PR-W2 — SystemBoot startup sırası korunur', () => {
  it('40) wiring VehicleDataLayer\'dan SONRA, SystemOrchestrator\'dan ÖNCE kaydedilir', () => {
    const iVDL = SYSTEMBOOT_SRC.indexOf('startVehicleDataLayer(');
    const iWiring = SYSTEMBOOT_SRC.indexOf('startPlatformCoreVehicleHalWiring(');
    const iOrch = SYSTEMBOOT_SRC.indexOf('startSystemOrchestrator(');
    expect(iVDL).toBeGreaterThan(0);
    expect(iWiring).toBeGreaterThan(iVDL);
    expect(iOrch).toBeGreaterThan(iWiring);
  });

  it('41) wiring çağrısı savunmacı try/catch ile sarılır (boot fail-soft)', () => {
    const iWiring = SYSTEMBOOT_SRC.indexOf('startPlatformCoreVehicleHalWiring(');
    const iOrch = SYSTEMBOOT_SRC.indexOf('startSystemOrchestrator(');
    const between = SYSTEMBOOT_SRC.slice(iWiring, iOrch);
    expect(between).toMatch(/logError\(['"]SystemBoot:vehicleHalWiring/);
  });

  it('42) wiring `_reg` cleanup modeliyle kaydedilir (LIFO shutdown)', () => {
    expect(SYSTEMBOOT_SRC).toMatch(/this\._reg\(startPlatformCoreVehicleHalWiring\(/);
  });

  it('43) mevcut Wave sırası (1→2→3→4) DEĞİŞMEDİ', () => {
    const i1 = SYSTEMBOOT_SRC.indexOf('await this._wave1()');
    const i2 = SYSTEMBOOT_SRC.indexOf('await this._wave2()');
    const i3 = SYSTEMBOOT_SRC.indexOf('await this._wave3()');
    const i4 = SYSTEMBOOT_SRC.indexOf('await this._wave4()');
    expect(i1).toBeGreaterThan(0);
    expect(i2).toBeGreaterThan(i1);
    expect(i3).toBeGreaterThan(i2);
    expect(i4).toBeGreaterThan(i3);
  });
});
