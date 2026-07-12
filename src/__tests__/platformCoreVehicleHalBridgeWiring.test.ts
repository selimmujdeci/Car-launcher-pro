/**
 * platformCoreVehicleHalBridgeWiring.test.ts — W4C: Vehicle HAL → Event Bus bridge wiring.
 *
 * Zincir: UnifiedVehicleStore → adapter → vehicleHal → VehicleHalEventBridge → appEventBus.
 * Bu PR yalnız WIRING'dir: throttle/coalescing YOK (W4D), consumer/abone YOK, Capability/
 * Deep Scan/Kernel YOK, yeni catalog girdisi YOK, stale sweeper YOK.
 *
 * Kritik invaryantlar: tek bridge · doğru (TEK) bus · bridge HAL/Bus'ı DISPOSE ETMEZ ·
 * ignition event YOK · duplicate event YOK · cleanup sonrası publish YOK · payload bounded/PII'siz.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  startPlatformCoreVehicleHalBridgeWiring,
  getVehicleHalBridgeStatus,
} from '../platform/system/platformCoreVehicleHalBridgeWiring';
import {
  startPlatformCoreEventBusWiring,
  getAppEventBus,
} from '../platform/system/platformCoreEventBusWiring';
import { createVehicleHal, type VehicleSignalId, type VehicleSignalInput } from '../platform/vehicleHal';
import { createPlatformEventBus, type PlatformEvent } from '../platform/eventBus';
import { buildPlatformRuntimeSnapshot } from '../platform/diagnosticSections';

const SRC = join(process.cwd(), 'src', 'platform');
const WIRING_SRC = readFileSync(join(SRC, 'system', 'platformCoreVehicleHalBridgeWiring.ts'), 'utf8');
const SYSTEMBOOT_SRC = readFileSync(join(SRC, 'system', 'SystemBoot.ts'), 'utf8');

/**
 * Kapsam kilitleri YORUMLARA takılmamalı: docstring kapsam-dışı kavramları (throttle,
 * canStatus, stale sweeper…) AÇIKLAR. Bu yüzden kilitler yalnız KOD üzerinde çalışır.
 */
const WIRING_CODE = WIRING_SRC
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

const NOW = 9_000_000;

/** Gerçek HAL + gerçek Bus ile izole zincir (üretim singleton'larına DOKUNMAZ). */
function chain() {
  const hal = createVehicleHal({ now: () => NOW });
  const bus = createPlatformEventBus({ now: () => NOW });
  const events: PlatformEvent[] = [];
  bus.subscribeDomain('vehicle', (e) => events.push(e));   // yalnız TEST gözlemcisi
  return { hal, bus, events };
}

const ingest = (hal: ReturnType<typeof createVehicleHal>, id: VehicleSignalId, input: VehicleSignalInput) =>
  hal.ingestSignal(id, input);

const CAN = (value: number | boolean | number[]): VehicleSignalInput =>
  ({ value, source: 'can', quality: 'high', confidence: 0.9, timestamp: NOW });

const _open: Array<() => void> = [];
function start(deps: Parameters<typeof startPlatformCoreVehicleHalBridgeWiring>[0] = {}) {
  const c = startPlatformCoreVehicleHalBridgeWiring(deps);
  _open.push(c);
  return c;
}
afterEach(() => {
  while (_open.length) { try { _open.pop()!(); } catch { /* */ } }
});

/* ── Wiring / tek instance ────────────────────────────────────────────────── */

describe('W4C — wiring & tek instance', () => {
  it('import yan etkisiz: wiring çağrılmadan bridge YOK', () => {
    expect(getVehicleHalBridgeStatus().present).toBe(false);
  });

  it('bus YOKSA fail-soft no-op cleanup (boot çökmez, bridge kurulmaz)', () => {
    expect(getAppEventBus()).toBeNull();                     // W3 wiring çalışmadı
    const { hal } = chain();
    let cleanup: (() => void) | null = null;
    expect(() => { cleanup = start({ hal }); }).not.toThrow();
    expect(typeof cleanup).toBe('function');
    expect(getVehicleHalBridgeStatus().present).toBe(false);
  });

  it('start sonrası TEK bridge (present/started)', () => {
    const { hal, bus } = chain();
    start({ hal, bus });
    const s = getVehicleHalBridgeStatus();
    expect(s.present).toBe(true);
    expect(s.started).toBe(true);
    expect(s.disposed).toBe(false);
  });

  it('İKİNCİ start yeni HAL aboneliği AÇMAZ (aynı olay iki kez yayınlanmaz)', () => {
    const { hal, bus, events } = chain();
    start({ hal, bus });
    start({ hal, bus });                                    // duplicate wiring
    ingest(hal, 'vehicle.coolant_temp', CAN(90));
    const changed = events.filter((e) => e.name === 'vehicle.signal.changed');
    expect(changed.length).toBe(1);                         // TEK event (çift abonelik yok)
  });

  it('cleanup İDEMPOTENT ve sonrasında accessor present=false', () => {
    const { hal, bus } = chain();
    const cleanup = start({ hal, bus });
    cleanup();
    expect(() => cleanup()).not.toThrow();
    expect(getVehicleHalBridgeStatus().present).toBe(false);
  });

  it('ESKİ cleanup YENİ aktif bridge kaydını silemez', () => {
    const c1 = chain();
    const cleanup1 = start({ hal: c1.hal, bus: c1.bus });
    cleanup1();
    const c2 = chain();
    start({ hal: c2.hal, bus: c2.bus });
    cleanup1();                                             // bayat cleanup
    expect(getVehicleHalBridgeStatus().present).toBe(true);
    ingest(c2.hal, 'vehicle.coolant_temp', CAN(80));
    expect(c2.events.some((e) => e.name === 'vehicle.signal.changed')).toBe(true);
  });

  it('boot → shutdown → boot: yeni bridge kurulur ve çalışır', () => {
    const c1 = chain();
    const cl = start({ hal: c1.hal, bus: c1.bus });
    cl();
    const c2 = chain();
    start({ hal: c2.hal, bus: c2.bus });
    ingest(c2.hal, 'vehicle.speed', CAN(50));
    expect(c2.events.some((e) => e.name === 'vehicle.signal.changed')).toBe(true);
  });

  it('cleanup bridge\'i dispose eder; HAL ve BUS\'ı DISPOSE ETMEZ', () => {
    const { hal, bus } = chain();
    const cleanup = start({ hal, bus });
    cleanup();
    expect(hal.isDisposed).toBe(false);
    expect(bus.isDisposed).toBe(false);
    expect(bus.publishName('platform.runtime.started')).not.toBeNull();   // bus hâlâ çalışıyor
  });

  it('gerçek W3 bus\'ı ile bağlanır (getAppEventBus) — DOĞRU bus instance', () => {
    _open.push(startPlatformCoreEventBusWiring());
    const appBus = getAppEventBus()!;
    const seen: string[] = [];
    appBus.subscribeDomain('vehicle', (e) => seen.push(e.name));
    const { hal } = chain();
    start({ hal });                                          // bus DI YOK → getAppEventBus()
    ingest(hal, 'vehicle.speed', CAN(60));
    expect(seen).toContain('vehicle.signal.changed');        // app bus'a aktı
  });
});

/* ── Event mapping ────────────────────────────────────────────────────────── */

describe('W4C — event mapping', () => {
  it('supported sinyal değişimi → vehicle.signal.changed (transient)', () => {
    const { hal, bus, events } = chain();
    start({ hal, bus });
    ingest(hal, 'vehicle.speed', CAN(50));
    const e = events.find((x) => x.name === 'vehicle.signal.changed')!;
    expect(e).toBeTruthy();
    expect(e.domain).toBe('vehicle');
    expect(e.source).toBe('vehicle_hal');
    expect(bus.getRecentEvents({ name: 'vehicle.signal.changed' }).length).toBe(0);  // transient → history yok
  });

  it('aynı değer DUPLICATE event üretmez', () => {
    const { hal, bus, events } = chain();
    start({ hal, bus });
    ingest(hal, 'vehicle.speed', CAN(50));
    ingest(hal, 'vehicle.speed', CAN(50));                   // aynı değer → HAL emit yok
    expect(events.filter((e) => e.name === 'vehicle.signal.changed').length).toBe(1);
  });

  it('TEK HAL snapshot (batch) → değişen sinyal BAŞINA bir event', () => {
    const { hal, bus, events } = chain();
    start({ hal, bus });
    hal.ingest({                                             // W4A: tek emit
      'vehicle.speed': CAN(50),
      'vehicle.rpm': CAN(2000),
      'vehicle.coolant_temp': CAN(90),
    });
    const changed = events.filter((e) => e.name === 'vehicle.signal.changed');
    expect(changed.length).toBe(3);                          // 3 sinyal → 3 event, 1 snapshot işlendi
  });

  it('ignition kaynağı yok → ignition event ÜRETİLMEZ', () => {
    const { hal, bus, events } = chain();
    start({ hal, bus });
    hal.ingest({ 'vehicle.speed': CAN(50), 'vehicle.rpm': CAN(1500) });
    expect(events.some((e) => e.name === 'vehicle.ignition.changed')).toBe(false);
    expect(hal.hasSignal('vehicle.ignition')).toBe(false);
  });

  it('connection.changed=true ilk supported sinyalde (retained)', () => {
    const { hal, bus, events } = chain();
    start({ hal, bus });
    ingest(hal, 'vehicle.speed', CAN(50));
    const conn = events.filter((e) => e.name === 'vehicle.connection.changed');
    expect(conn.length).toBe(1);
    expect((conn[0]!.payload as { connected: boolean }).connected).toBe(true);
    expect(conn[0]!.retained).toBe(true);
  });

  it('W4B unsupported geçişi TÜM destek kalkınca connection.changed=false üretir', () => {
    const { hal, bus, events } = chain();
    start({ hal, bus });
    ingest(hal, 'vehicle.speed', CAN(50));
    // W4B: kaynak kaybı → source:'none' → supported=false
    ingest(hal, 'vehicle.speed', { value: null, source: 'none', quality: 'unknown', confidence: 0, timestamp: NOW });
    const conn = events.filter((e) => e.name === 'vehicle.connection.changed');
    expect(conn.length).toBe(2);
    expect((conn[1]!.payload as { connected: boolean }).connected).toBe(false);
  });

  it('kısmi kayıpta connection=false ÜRETİLMEZ (bir sinyal hâlâ supported)', () => {
    const { hal, bus, events } = chain();
    start({ hal, bus });
    hal.ingest({ 'vehicle.speed': CAN(50), 'vehicle.coolant_temp': CAN(90) });
    ingest(hal, 'vehicle.coolant_temp', { value: null, source: 'none', quality: 'unknown', confidence: 0, timestamp: NOW });
    const conn = events.filter((e) => e.name === 'vehicle.connection.changed');
    expect(conn.length).toBe(1);                            // yalnız ilk true
  });

  it('reconnect: destek geri gelince connection.changed=true tekrar üretilir', () => {
    const { hal, bus, events } = chain();
    start({ hal, bus });
    ingest(hal, 'vehicle.speed', CAN(50));
    ingest(hal, 'vehicle.speed', { value: null, source: 'none', quality: 'unknown', confidence: 0, timestamp: NOW });
    ingest(hal, 'vehicle.speed', CAN(55));                  // reconnect
    const conn = events.filter((e) => e.name === 'vehicle.connection.changed')
      .map((e) => (e.payload as { connected: boolean }).connected);
    expect(conn).toEqual([true, false, true]);
  });

  it('identity: fingerprint değişimi retained event; HAM VIN payload\'a GİRMEZ', () => {
    const { hal, bus, events } = chain();
    start({ hal, bus });
    hal.ingestIdentity({ fingerprintHash: 'a1b2c3d4e5f6', protocol: 'can' });
    ingest(hal, 'vehicle.speed', CAN(50));                  // emit tetikle
    const idev = events.find((e) => e.name === 'vehicle.identity.changed');
    expect(idev).toBeTruthy();
    expect(idev!.retained).toBe(true);
    expect(JSON.stringify(idev!.payload)).not.toMatch(/[A-HJ-NPR-Z0-9]{17}/);   // ham VIN yok
  });

  it('TPMS payload bounded (dizi kırpılır, ham veri taşınmaz)', () => {
    const { hal, bus, events } = chain();
    start({ hal, bus });
    ingest(hal, 'vehicle.tpms', CAN([220, 225, 230, 228]));
    const e = events.find((x) => x.name === 'vehicle.signal.changed'
      && (x.payload as { signalId: string }).signalId === 'vehicle.tpms')!;
    const v = (e.payload as { value: number[] }).value;
    expect(Array.isArray(v)).toBe(true);
    expect(v.length).toBeLessThanOrEqual(8);
  });
});

/* ── Lifecycle / fail-soft / privacy ──────────────────────────────────────── */

describe('W4C — lifecycle, fail-soft, privacy', () => {
  it('cleanup sonrası HAL değişimi publish ÜRETMEZ', () => {
    const { hal, bus, events } = chain();
    const cleanup = start({ hal, bus });
    ingest(hal, 'vehicle.speed', CAN(50));
    const before = events.length;
    cleanup();
    ingest(hal, 'vehicle.speed', CAN(99));
    expect(events.length).toBe(before);
  });

  it('bridge YALNIZ verilen bus\'a publish eder — ikinci bus\'a event SIZMAZ', () => {
    const { hal, bus, events } = chain();
    const other = createPlatformEventBus({ now: () => NOW });
    const otherEvents: PlatformEvent[] = [];
    other.subscribeDomain('vehicle', (e) => otherEvents.push(e));
    start({ hal, bus });
    ingest(hal, 'vehicle.speed', CAN(50));
    expect(events.length).toBeGreaterThan(0);
    expect(otherEvents.length).toBe(0);
  });

  it('bus publish null dönerse droppedCount artar (kaynak servis etkilenmez)', () => {
    const { hal } = chain();
    const nullBus = { publish: () => null };
    start({ hal, bus: nullBus });
    ingest(hal, 'vehicle.speed', CAN(50));
    const s = getVehicleHalBridgeStatus();
    expect(s.droppedCount).toBeGreaterThan(0);
    expect(s.publishedCount).toBe(0);
  });

  it('bus publish throw ederse fail-soft (HAL etkilenmez)', () => {
    const { hal } = chain();
    const badBus = { publish: () => { throw new Error('bus boom'); } };
    start({ hal, bus: badBus });
    expect(() => ingest(hal, 'vehicle.speed', CAN(50))).not.toThrow();
    expect(hal.getSpeed()).toBe(50);
    expect(getVehicleHalBridgeStatus().droppedCount).toBeGreaterThan(0);
  });

  it('HAL subscribe throw ederse wiring throw ETMEZ (boot sürer)', () => {
    const badHal = {
      subscribe: () => { throw new Error('hal boom'); },
      getSnapshot: () => ({ revision: 0, updatedAt: NOW, signals: [] }),
      getVehicleIdentity: () => ({ fingerprintHash: null, protocol: null, supported: false }),
    };
    const bus = createPlatformEventBus({ now: () => NOW });
    expect(() => start({ hal: badHal, bus })).not.toThrow();
  });

  it('listener hatası bridge\'i ÇÖKERTMEZ (bus izole eder)', () => {
    const { hal, bus } = chain();
    bus.subscribe('vehicle.signal.changed', () => { throw new Error('listener boom'); });
    start({ hal, bus });
    expect(() => ingest(hal, 'vehicle.speed', CAN(50))).not.toThrow();
    expect(getVehicleHalBridgeStatus().publishedCount).toBeGreaterThan(0);
    expect(bus.getStats().listenerErrorCount).toBe(1);
  });

  it('event payload\'ında koordinat/MAC/secret YOK (yalnız sinyal özeti)', () => {
    const { hal, bus, events } = chain();
    start({ hal, bus });
    hal.ingest({ 'vehicle.speed': CAN(50), 'vehicle.coolant_temp': CAN(90) });
    const json = JSON.stringify(events.map((e) => e.payload));
    expect(json).not.toMatch(/lat|lon|[0-9A-F]{2}(:[0-9A-F]{2}){5}|token|api_key/i);
  });
});

/* ── Diagnostic ───────────────────────────────────────────────────────────── */

describe('W4C — diagnostic (support snapshot)', () => {
  it('bridge YOKKEN present=false ve sayaçlar NULL ("0 event" ile karışmaz)', () => {
    const d = buildPlatformRuntimeSnapshot();
    expect(d.halBridge.present).toBe(false);
    expect(d.halBridge.publishedCount).toBeNull();
    expect(d.halBridge.droppedCount).toBeNull();
  });

  it('bridge VARKEN present=true ve sayaçlar okunur; whitelist DIŞI alan yok', () => {
    const { hal, bus } = chain();
    start({ hal, bus });
    ingest(hal, 'vehicle.speed', CAN(50));
    const d = buildPlatformRuntimeSnapshot();
    expect(d.halBridge.present).toBe(true);
    expect(d.halBridge.started).toBe(true);
    expect(d.halBridge.publishedCount).toBeGreaterThan(0);
    expect(d.halBridge.droppedCount).toBe(0);
    expect(new Set(Object.keys(d.halBridge))).toEqual(new Set([
      'present', 'started', 'disposed', 'publishedCount', 'droppedCount', 'lastPublishAt',
    ]));
  });

  it('teşhis çıktısı yalnız sayaç/bayrak — event payload / sinyal değeri / topic YOK', () => {
    const { hal, bus } = chain();
    start({ hal, bus });
    hal.ingest({ 'vehicle.speed': CAN(137), 'vehicle.coolant_temp': CAN(91) });
    // lastPublishAt (epoch ms) rakamları sinyal değerlerini alt-dize olarak içerebilir → çıkarılır.
    const { lastPublishAt: _ts, ...rest } = buildPlatformRuntimeSnapshot().halBridge;
    void _ts;
    const json = JSON.stringify(rest);
    expect(json).not.toMatch(/137|91|signalId|vehicle\.signal|payload/);
    for (const v of Object.values(buildPlatformRuntimeSnapshot().halBridge)) {
      expect(['number', 'boolean', 'object']).toContain(typeof v);
    }
  });
});

/* ── Kapsam sınırı & SystemBoot sırası ────────────────────────────────────── */

describe('W4C — kapsam sınırı', () => {
  it('throttle/debounce/coalescing/async-queue EKLENMEDİ (W4D)', () => {
    expect(WIRING_CODE).not.toMatch(/THROTTLE_MS|debounce|coalesce|queueMicrotask/i);
    expect(WIRING_CODE).not.toMatch(/setInterval|setTimeout|requestAnimationFrame/);
  });

  it('consumer/abone EKLENMEDİ (bus.subscribe yok)', () => {
    expect(WIRING_CODE).not.toMatch(/\.subscribe\(|subscribeDomain/);
  });

  it('Capability / Deep Scan / Kernel / native canStatus / stale sweeper YOK', () => {
    expect(WIRING_CODE).not.toMatch(/from\s+['"][^'"]*capability/i);
    expect(WIRING_CODE).not.toMatch(/from\s+['"][^'"]*deepScan/i);
    expect(WIRING_CODE).not.toMatch(/from\s+['"][^'"]*kernel/i);
    expect(WIRING_CODE).not.toMatch(/canStatus|halStatusStore|\.refresh\s*\(/);
  });

  it('kalıcı global debug expose YOK', () => {
    expect(WIRING_CODE).not.toMatch(/window\.__|globalThis\./);
  });

  it('SystemBoot: bridge HAL wiring\'den SONRA, SystemOrchestrator\'dan ÖNCE (_reg ile)', () => {
    const iBus = SYSTEMBOOT_SRC.indexOf('this._reg(startPlatformCoreEventBusWiring())');
    const iHal = SYSTEMBOOT_SRC.indexOf('this._reg(startPlatformCoreVehicleHalWiring(');
    const iBridge = SYSTEMBOOT_SRC.indexOf('this._reg(startPlatformCoreVehicleHalBridgeWiring())');
    const iOrch = SYSTEMBOOT_SRC.indexOf('this._reg(startSystemOrchestrator())');
    expect(iBus).toBeGreaterThan(0);
    expect(iHal).toBeGreaterThan(iBus);       // Event Bus (Wave 1) EN ÖNCE
    expect(iBridge).toBeGreaterThan(iHal);    // bridge, HAL wiring'den SONRA
    expect(iOrch).toBeGreaterThan(iBridge);   // SystemOrchestrator'dan ÖNCE
    expect(SYSTEMBOOT_SRC).not.toMatch(/_regNamed\([^)]*BridgeWiring/);
  });

  it('mevcut Wave sırası (1→2→3→4) DEĞİŞMEDİ', () => {
    const i1 = SYSTEMBOOT_SRC.indexOf('await this._wave1()');
    const i2 = SYSTEMBOOT_SRC.indexOf('await this._wave2()');
    const i3 = SYSTEMBOOT_SRC.indexOf('await this._wave3()');
    const i4 = SYSTEMBOOT_SRC.indexOf('await this._wave4()');
    expect(i2).toBeGreaterThan(i1);
    expect(i3).toBeGreaterThan(i2);
    expect(i4).toBeGreaterThan(i3);
  });
});
