/**
 * platformCoreCapabilityBridgeWiring.test.ts — W4 Capability → Event Bus bridge wiring kilitleri.
 *
 * Test izolasyonu: gerçek `capabilityRegistry`/`appEventBus` singleton'ları PAYLAŞILMAZ — fake
 * registry + fake bus DI ile her test kendi izole zincirini kurar. Invariant odaklı; kırılgan
 * kaynak-regex YALNIZ kapsam-dışı import yasağı ve SystemBoot sıra kilidi için.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  startPlatformCoreCapabilityBridgeWiring,
  getCapabilityBridgeStatus,
  type CapabilityBridgeWiringDeps,
} from '../platform/system/platformCoreCapabilityBridgeWiring';

/* ── Fake'ler (yapısal DI — gerçek singleton'a dokunulmaz) ─────────────────── */

interface PubInput { name: string; payload?: unknown; domain?: string; source?: string; transient?: boolean; retained?: boolean }
interface FakeBus {
  readonly events: PubInput[];
  publish: (i: PubInput) => ({ name: string } | null);
  readonly disposeCalls: number;
  dispose: () => void;
}
function createFakeBus(opts?: { throwOnPublish?: boolean; dropAll?: boolean }): FakeBus {
  const events: PubInput[] = [];
  let disposeCalls = 0;
  return {
    events,
    publish(i) {
      if (opts?.throwOnPublish) throw new Error('bus boom');
      events.push(i);
      return opts?.dropAll ? null : { name: i.name };
    },
    get disposeCalls() { return disposeCalls; },
    dispose() { disposeCalls++; },
  };
}

interface RecLike {
  id: string; domain: string; status: string; available: boolean; quality: string;
  confidence: number; source: string; stale: boolean; reason: string | null; limitations?: string[];
}
function rec(id: string, status: string, over: Partial<RecLike> = {}): RecLike {
  return {
    id, domain: 'device', status,
    available: status === 'available',
    quality: 'medium', confidence: 0.7, source: 'runtime', stale: false, reason: null,
    ...over,
  };
}
interface FakeRegistry {
  subscribe: (l: (ev: { type: string; id: string | null; revision: number; at: number }) => void) => (() => void);
  getCapability: (id: string) => RecLike | null;
  createSnapshot: () => { revision: number; availableCount: number; unavailableCount: number; unknownCount: number; degradedCount: number; capabilities: RecLike[] };
  emit: (ev: { type: string; id: string | null; revision?: number }) => void;
  setRecord: (id: string, r: RecLike | null) => void;
  readonly subscribed: boolean;
  readonly subscribeThrows: boolean;
  readonly disposeCalls: number;
  dispose: () => void;
}
function createFakeRegistry(opts?: { subscribeThrows?: boolean; seed?: RecLike[] }): FakeRegistry {
  let listener: ((ev: { type: string; id: string | null; revision: number; at: number }) => void) | null = null;
  const state = new Map<string, RecLike>((opts?.seed ?? []).map((r) => [r.id, r]));
  let rev = 0;
  let disposeCalls = 0;
  return {
    subscribe(l) {
      if (opts?.subscribeThrows) throw new Error('subscribe boom');
      listener = l;
      return () => { listener = null; };
    },
    getCapability: (id) => state.get(id) ?? null,
    createSnapshot: () => ({
      revision: rev, availableCount: 0, unavailableCount: 0, unknownCount: 0, degradedCount: 0,
      capabilities: [...state.values()],
    }),
    emit: (ev) => { rev = ev.revision ?? rev + 1; listener?.({ type: ev.type, id: ev.id, revision: rev, at: Date.now() }); },
    setRecord: (id, r) => { if (r) state.set(id, r); else state.delete(id); },
    get subscribed() { return listener !== null; },
    get subscribeThrows() { return !!opts?.subscribeThrows; },
    get disposeCalls() { return disposeCalls; },
    dispose() { disposeCalls++; },
  };
}

const namesOf = (bus: FakeBus) => bus.events.map((e) => e.name);
const eventsNamed = (bus: FakeBus, name: string) => bus.events.filter((e) => e.name === name);

const SRC_DIR = join(process.cwd(), 'src');
const WIRING_SRC = readFileSync(join(SRC_DIR, 'platform', 'system', 'platformCoreCapabilityBridgeWiring.ts'), 'utf8');
const SYSTEMBOOT_SRC = readFileSync(join(SRC_DIR, 'platform', 'system', 'SystemBoot.ts'), 'utf8');

/** Aktif wiring kaydı testler arası SIZMASIN (tek-instance guard modül düzeyinde). */
const _open: Array<() => void> = [];
function start(deps: CapabilityBridgeWiringDeps) {
  const c = startPlatformCoreCapabilityBridgeWiring(deps);
  _open.push(c);
  return c;
}
afterEach(() => { while (_open.length) { try { _open.pop()!(); } catch { /* */ } } });

/* ── Yaşam döngüsü & event akışı ───────────────────────────────────────────── */

describe('W4 Capability bridge wiring — yaşam döngüsü & event akışı', () => {
  it('1) import side-effect yok: wiring çağrılmadan Registry\'ye abone olunmaz', () => {
    const registry = createFakeRegistry();
    expect(registry.subscribed).toBe(false);
  });

  it('2) wiring cleanup thunk döner', () => {
    const cleanup = start({ registry: createFakeRegistry() as unknown as CapabilityBridgeWiringDeps['registry'], bus: createFakeBus() });
    expect(typeof cleanup).toBe('function');
  });

  it('3) start → Registry.subscribe çağrılır (tek abonelik)', () => {
    const registry = createFakeRegistry();
    start({ registry: registry as unknown as CapabilityBridgeWiringDeps['registry'], bus: createFakeBus() });
    expect(registry.subscribed).toBe(true);
  });

  it('4) registered değişimi → capability.record.registered + snapshot.changed publish', () => {
    const registry = createFakeRegistry();
    const bus = createFakeBus();
    start({ registry: registry as unknown as CapabilityBridgeWiringDeps['registry'], bus });
    registry.setRecord('device.gps', rec('device.gps', 'available'));
    registry.emit({ type: 'registered', id: 'device.gps' });
    expect(namesOf(bus)).toContain('capability.record.registered');
    expect(namesOf(bus)).toContain('capability.snapshot.changed');
  });

  it('5) capability.snapshot.changed RETAINED', () => {
    const registry = createFakeRegistry();
    const bus = createFakeBus();
    start({ registry: registry as unknown as CapabilityBridgeWiringDeps['registry'], bus });
    registry.setRecord('device.gps', rec('device.gps', 'available'));
    registry.emit({ type: 'registered', id: 'device.gps' });
    expect(eventsNamed(bus, 'capability.snapshot.changed')[0].retained).toBe(true);
  });

  it('6) record ve snapshot event domain=capability, source=capability_registry', () => {
    const registry = createFakeRegistry();
    const bus = createFakeBus();
    start({ registry: registry as unknown as CapabilityBridgeWiringDeps['registry'], bus });
    registry.setRecord('device.gps', rec('device.gps', 'available'));
    registry.emit({ type: 'registered', id: 'device.gps' });
    for (const e of bus.events) {
      expect(e.domain).toBe('capability');
      expect(e.source).toBe('capability_registry');
    }
  });

  it('7) record DEĞİŞİNCE capability.record.changed', () => {
    const registry = createFakeRegistry();
    const bus = createFakeBus();
    start({ registry: registry as unknown as CapabilityBridgeWiringDeps['registry'], bus });
    registry.setRecord('device.gps', rec('device.gps', 'degraded'));
    registry.emit({ type: 'registered', id: 'device.gps' });
    registry.setRecord('device.gps', rec('device.gps', 'available'));   // sig değişti
    registry.emit({ type: 'updated', id: 'device.gps' });
    expect(namesOf(bus)).toContain('capability.record.changed');
  });

  it('8) AYNI record (imza aynı) → DUPLICATE record event YOK', () => {
    const registry = createFakeRegistry();
    const bus = createFakeBus();
    start({ registry: registry as unknown as CapabilityBridgeWiringDeps['registry'], bus });
    registry.setRecord('device.gps', rec('device.gps', 'available'));
    registry.emit({ type: 'registered', id: 'device.gps' });
    const before = bus.events.length;
    registry.emit({ type: 'updated', id: 'device.gps' });   // aynı record
    expect(bus.events.length).toBe(before);                 // hiç yeni event yok
  });

  it('9) removed → capability.record.removed + snapshot.changed', () => {
    const registry = createFakeRegistry();
    const bus = createFakeBus();
    start({ registry: registry as unknown as CapabilityBridgeWiringDeps['registry'], bus });
    registry.setRecord('device.gps', rec('device.gps', 'available'));
    registry.emit({ type: 'registered', id: 'device.gps' });
    registry.setRecord('device.gps', null);
    registry.emit({ type: 'removed', id: 'device.gps' });
    expect(namesOf(bus)).toContain('capability.record.removed');
  });

  it('10) snapshot payload FULL registry TAŞIMAZ (yalnız sayım + bounded changedIds)', () => {
    const registry = createFakeRegistry();
    const bus = createFakeBus();
    start({ registry: registry as unknown as CapabilityBridgeWiringDeps['registry'], bus });
    registry.setRecord('device.gps', rec('device.gps', 'available'));
    registry.emit({ type: 'registered', id: 'device.gps' });
    const snap = eventsNamed(bus, 'capability.snapshot.changed')[0].payload as Record<string, unknown>;
    expect(snap).not.toHaveProperty('capabilities');            // full liste yok
    expect(snap).toHaveProperty('availableCount');
    expect(Array.isArray(snap['changedCapabilityIds'])).toBe(true);
  });
});

/* ── Duplicate / tek-instance / lifecycle ─────────────────────────────────── */

describe('W4 Capability bridge wiring — duplicate & lifecycle', () => {
  it('11) start İDEMPOTENT: aktifken ikinci wiring İKİNCİ bridge\'i beslemez', () => {
    const reg1 = createFakeRegistry();
    const bus1 = createFakeBus();
    const bus2 = createFakeBus();
    start({ registry: reg1 as unknown as CapabilityBridgeWiringDeps['registry'], bus: bus1 });
    start({ registry: createFakeRegistry() as unknown as CapabilityBridgeWiringDeps['registry'], bus: bus2 });   // duplicate
    reg1.setRecord('device.gps', rec('device.gps', 'available'));
    reg1.emit({ type: 'registered', id: 'device.gps' });
    expect(bus1.events.length).toBeGreaterThan(0);
    expect(bus2.events.length).toBe(0);                         // ikinci bus hiç beslenmez
  });

  it('12) cleanup bridge\'i durdurur: sonraki değişim publish edilmez', () => {
    const registry = createFakeRegistry();
    const bus = createFakeBus();
    const cleanup = start({ registry: registry as unknown as CapabilityBridgeWiringDeps['registry'], bus });
    cleanup();
    registry.setRecord('device.gps', rec('device.gps', 'available'));
    registry.emit({ type: 'registered', id: 'device.gps' });
    expect(bus.events.length).toBe(0);
    expect(registry.subscribed).toBe(false);                   // abonelik bırakıldı (zero-leak)
  });

  it('13) cleanup İDEMPOTENT (ikinci çağrı no-op)', () => {
    const cleanup = start({ registry: createFakeRegistry() as unknown as CapabilityBridgeWiringDeps['registry'], bus: createFakeBus() });
    cleanup();
    expect(() => cleanup()).not.toThrow();
  });

  it('14) cleanup Registry/Bus\'ı DISPOSE ETMEZ (paylaşılan singleton\'lar)', () => {
    const registry = createFakeRegistry();
    const bus = createFakeBus();
    const cleanup = start({ registry: registry as unknown as CapabilityBridgeWiringDeps['registry'], bus });
    cleanup();
    expect(registry.disposeCalls).toBe(0);
    expect(bus.disposeCalls).toBe(0);
  });

  it('15) boot → shutdown → boot güvenli, ikinci boot canlı', () => {
    const reg1 = createFakeRegistry();
    const c1 = start({ registry: reg1 as unknown as CapabilityBridgeWiringDeps['registry'], bus: createFakeBus() });
    c1();
    const reg2 = createFakeRegistry();
    const bus2 = createFakeBus();
    start({ registry: reg2 as unknown as CapabilityBridgeWiringDeps['registry'], bus: bus2 });
    reg2.setRecord('device.gps', rec('device.gps', 'available'));
    reg2.emit({ type: 'registered', id: 'device.gps' });
    expect(bus2.events.length).toBeGreaterThan(0);
  });

  it('16) dispose sonrası callback no-op (Registry emit ederse event yok)', () => {
    const registry = createFakeRegistry();
    const bus = createFakeBus();
    const cleanup = start({ registry: registry as unknown as CapabilityBridgeWiringDeps['registry'], bus });
    cleanup();
    registry.emit({ type: 'updated', id: 'device.gps' });
    expect(bus.events.length).toBe(0);
  });
});

/* ── Fail-soft ────────────────────────────────────────────────────────────── */

describe('W4 Capability bridge wiring — fail-soft', () => {
  it('17) bus YOK (default getAppEventBus null) → no-op cleanup, throw YOK', () => {
    // bus/registry verilmez → getAppEventBus() üretimde null (event bus wiring başlatılmadı)
    let cleanup: (() => void) | null = null;
    expect(() => { cleanup = start({}); }).not.toThrow();
    expect(typeof cleanup).toBe('function');
    expect(() => cleanup!()).not.toThrow();
  });

  it('18) Registry.subscribe throw etse wiring çökmez (bridge içi fail-soft)', () => {
    const registry = createFakeRegistry({ subscribeThrows: true });
    expect(() => start({ registry: registry as unknown as CapabilityBridgeWiringDeps['registry'], bus: createFakeBus() })).not.toThrow();
  });

  it('19) bus.publish throw etse wiring çökmez (bridge droppedCount artar)', () => {
    const registry = createFakeRegistry();
    const bus = createFakeBus({ throwOnPublish: true });
    expect(() => {
      start({ registry: registry as unknown as CapabilityBridgeWiringDeps['registry'], bus });
      registry.setRecord('device.gps', rec('device.gps', 'available'));
      registry.emit({ type: 'registered', id: 'device.gps' });
    }).not.toThrow();
    const s = getCapabilityBridgeStatus();
    expect(s.droppedCount === null ? 0 : s.droppedCount).toBeGreaterThan(0);
  });

  it('20) public API throw ETMEZ (deps bozuk / status)', () => {
    expect(() => { const c = startPlatformCoreCapabilityBridgeWiring({ registry: undefined, bus: undefined }); c(); }).not.toThrow();
    expect(() => getCapabilityBridgeStatus()).not.toThrow();
  });
});

/* ── Bounded status ───────────────────────────────────────────────────────── */

describe('W4 Capability bridge wiring — bounded status', () => {
  it('21) wiring kapalıyken status present=false', () => {
    expect(getCapabilityBridgeStatus().present).toBe(false);
  });

  it('22) aktif wiring status: present=true, started=true, publishedCount artar, frozen', () => {
    const registry = createFakeRegistry();
    const bus = createFakeBus();
    start({ registry: registry as unknown as CapabilityBridgeWiringDeps['registry'], bus });
    registry.setRecord('device.gps', rec('device.gps', 'available'));
    registry.emit({ type: 'registered', id: 'device.gps' });
    const s = getCapabilityBridgeStatus();
    expect(s.present).toBe(true);
    expect(s.started).toBe(true);
    expect((s.publishedCount ?? 0)).toBeGreaterThanOrEqual(2);
    expect(Object.isFrozen(s)).toBe(true);
  });

  it('23) cleanup sonrası status present=false\'a döner', () => {
    const cleanup = start({ registry: createFakeRegistry() as unknown as CapabilityBridgeWiringDeps['registry'], bus: createFakeBus() });
    cleanup();
    expect(getCapabilityBridgeStatus().present).toBe(false);
  });
});

/* ── Privacy ──────────────────────────────────────────────────────────────── */

describe('W4 Capability bridge wiring — privacy', () => {
  it('24) payload\'da ham CAN/OBD/VIN/MAC/koordinat sızmaz (yalnız capability alanları)', () => {
    const registry = createFakeRegistry();
    const bus = createFakeBus();
    start({ registry: registry as unknown as CapabilityBridgeWiringDeps['registry'], bus });
    // reason'a kasıtlı hassas görünen string koy (Registry sanitize eder ama wiring de taşımamalı)
    registry.setRecord('device.gps', rec('device.gps', 'available', { reason: 'geolocation_api_present' }));
    registry.emit({ type: 'registered', id: 'device.gps' });
    const payload = JSON.stringify(bus.events);
    expect(payload).not.toMatch(/\b[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}\b/);   // MAC
    expect(payload).not.toMatch(/-?\d{1,3}\.\d{4,}\s*,\s*-?\d{1,3}\.\d{4,}/); // koordinat
    expect(payload).not.toMatch(/\brpm\b|\bcanRpm\b|coolantTemp/i);          // ham araç sinyali
  });
});

/* ── Kapsam sınırı (kaynak-kilidi — kırılgan regex yalnız burada) ──────────── */

describe('W4 Capability bridge wiring — kapsam sınırı', () => {
  it('25) İKİNCİ bus ÜRETİLMEZ (getAppEventBus tüketilir, createPlatformEventBus YOK)', () => {
    expect(WIRING_SRC).not.toMatch(/createPlatformEventBus\s*\(/);
    expect(WIRING_SRC).toMatch(/getAppEventBus\s*\(/);
  });

  it('26) Deep Scan / Driver DNA / Prediction / Assistant Context IMPORT EDİLMEZ', () => {
    // Not: bu adlar "NE YAPMAZ" doc-comment'inde geçer → kelime değil IMPORT kontrol edilir.
    expect(WIRING_SRC).not.toMatch(/from\s+['"][^'"]*deepScan/i);
    expect(WIRING_SRC).not.toMatch(/from\s+['"][^'"]*driverD/i);
    expect(WIRING_SRC).not.toMatch(/from\s+['"][^'"]*prediction/i);
    expect(WIRING_SRC).not.toMatch(/from\s+['"][^'"]*assistant/i);
  });

  it('27) Platform Kernel import EDİLMEZ (legacy servisler Kernel\'e taşınmaz)', () => {
    expect(WIRING_SRC).not.toMatch(/from\s+['"][^'"]*kernel/i);
  });

  it('28) native / OBD / CAN import EDİLMEZ', () => {
    expect(WIRING_SRC).not.toMatch(/from\s+['"][^'"]*(obdService|canbus|nativePlugin)['"]/i);
  });

  it('29) yeni timer/polling/rAF AÇILMAZ', () => {
    expect(WIRING_SRC).not.toMatch(/setInterval|setTimeout|requestAnimationFrame/);
  });

  it('30) hot-path\'te ağır serileştirme YOK (JSON.stringify / structuredClone)', () => {
    expect(WIRING_SRC).not.toMatch(/JSON\.stringify|structuredClone/);
  });

  it('31) Vehicle HAL bridge/wiring\'e DOKUNMAZ (bu dosya HAL wiring import etmez)', () => {
    expect(WIRING_SRC).not.toMatch(/vehicleHalBridgeWiring|platformCoreVehicleHalWiring/i);
  });
});

/* ── SystemBoot entegrasyon sıra kilidi ────────────────────────────────────── */

describe('W4 — SystemBoot startup sırası korunur', () => {
  it('32) capability bridge, Capability Registry wiring\'den SONRA & SystemOrchestrator\'dan ÖNCE', () => {
    const iCapWiring = SYSTEMBOOT_SRC.indexOf('startPlatformCoreCapabilityWiring(');
    const iCapBridge = SYSTEMBOOT_SRC.indexOf('startPlatformCoreCapabilityBridgeWiring(');
    const iOrch = SYSTEMBOOT_SRC.indexOf('startSystemOrchestrator(');
    expect(iCapWiring).toBeGreaterThan(0);
    expect(iCapBridge).toBeGreaterThan(iCapWiring);
    expect(iOrch).toBeGreaterThan(iCapBridge);
  });

  it('33) savunmacı try/catch (logError SystemBoot:capabilityBridgeWiring)', () => {
    expect(SYSTEMBOOT_SRC).toMatch(/logError\(['"]SystemBoot:capabilityBridgeWiring/);
  });

  it('34) `_reg` cleanup modeliyle kaydedilir (LIFO shutdown)', () => {
    expect(SYSTEMBOOT_SRC).toMatch(/this\._reg\(startPlatformCoreCapabilityBridgeWiring\(/);
  });

  it('35) Vehicle HAL bridge wiring kaydı HÂLÂ mevcut (W4C değişmedi)', () => {
    expect(SYSTEMBOOT_SRC).toMatch(/this\._reg\(startPlatformCoreVehicleHalBridgeWiring\(/);
  });

  it('36) mevcut Wave sırası (1→2→3→4) DEĞİŞMEDİ', () => {
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
