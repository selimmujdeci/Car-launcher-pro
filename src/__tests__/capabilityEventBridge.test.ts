/**
 * capabilityEventBridge.test.ts — Capability Registry → Platform Event Bus köprüsü testleri.
 *
 * Kapsam: registered/changed/removed · duplicate yok · snapshot.changed · snapshot full
 * registry taşımıyor · changedIds bounded · retained · record payload sanitize/whitelist ·
 * Registry/Bus fail-soft · dispose zero-leak · kaynak dispose edilmiyor · privacy · input
 * mutate yok · counters · createSnapshot tek-sefer (allocation yok) · katalog · import.
 */

import { describe, it, expect } from 'vitest';
import {
  createCapabilityEventBridge,
  type CapabilityRecordLike, type CapabilityChangeEventLike,
} from '../platform/eventBus/bridges/capabilityEventBridge';
import { DEFAULT_EVENT_CATALOG } from '../platform/eventBus';
import bridgeSource from '../platform/eventBus/bridges/capabilityEventBridge.ts?raw';

const CATALOG_NAMES = new Set(DEFAULT_EVENT_CATALOG.map((e) => e.name));

function rec(id: string, o: Partial<CapabilityRecordLike> = {}): CapabilityRecordLike {
  return {
    id, domain: o.domain ?? 'device', status: o.status ?? 'unknown', available: o.available ?? false,
    quality: o.quality ?? 'unknown', confidence: o.confidence ?? 0, source: o.source ?? 'none',
    stale: o.stale ?? false, reason: o.reason ?? null, limitations: o.limitations,
  };
}
function bucket(s: string): 'available' | 'unavailable' | 'unknown' | 'degraded' {
  if (s === 'available') return 'available';
  if (s === 'unavailable' || s === 'unsupported') return 'unavailable';
  if (s === 'degraded') return 'degraded';
  return 'unknown';
}

function fakeRegistry(initial: CapabilityRecordLike[] = []) {
  let listener: ((ev: CapabilityChangeEventLike) => void) | null = null;
  const records = new Map<string, CapabilityRecordLike>();
  for (const r of initial) records.set(r.id, r);
  let revision = initial.length;
  let subCount = 0;
  let snapCount = 0;
  const fire = (ev: CapabilityChangeEventLike) => { if (listener) listener(ev); };
  return {
    subscribe: (l: (ev: CapabilityChangeEventLike) => void) => { subCount++; listener = l; return () => { listener = null; }; },
    getCapability: (id: string) => records.get(id) ?? null,
    createSnapshot: () => {
      snapCount++;
      const caps = [...records.values()];
      let a = 0, u = 0, unk = 0, d = 0;
      for (const c of caps) { const b = bucket(c.status); if (b === 'available') a++; else if (b === 'unavailable') u++; else if (b === 'degraded') d++; else unk++; }
      return { revision, availableCount: a, unavailableCount: u, unknownCount: unk, degradedCount: d, capabilities: caps };
    },
    register: (r: CapabilityRecordLike) => { records.set(r.id, r); fire({ type: 'registered', id: r.id, revision: ++revision, at: 1 }); },
    update: (r: CapabilityRecordLike) => { records.set(r.id, r); fire({ type: 'updated', id: r.id, revision: ++revision, at: 1 }); },
    remove: (id: string) => { records.delete(id); fire({ type: 'removed', id, revision: ++revision, at: 1 }); },
    resetAll: () => { records.clear(); fire({ type: 'reset', id: null, revision: ++revision, at: 1 }); },
    hasListener: () => listener !== null,
    subCount: () => subCount,
    snapCount: () => snapCount,
  };
}

interface Captured { name: string; payload: unknown; retained?: boolean }
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

describe('CapabilityEventBridge', () => {
  it('16) registered event', () => {
    const reg = fakeRegistry(); const bus = fakeBus();
    createCapabilityEventBridge({ registry: reg, bus }).start();
    reg.register(rec('device.gps', { status: 'degraded' }));
    const r = bus.named('capability.record.registered');
    expect(r.length).toBe(1);
    expect((r[0].payload as { id: string }).id).toBe('device.gps');
  });

  it('17) changed event', () => {
    const reg = fakeRegistry([rec('device.gps', { status: 'unknown' })]); const bus = fakeBus();
    createCapabilityEventBridge({ registry: reg, bus }).start();
    reg.update(rec('device.gps', { status: 'available', available: true }));
    expect(bus.named('capability.record.changed').length).toBe(1);
  });

  it('18) removed event', () => {
    const reg = fakeRegistry([rec('device.gps')]); const bus = fakeBus();
    createCapabilityEventBridge({ registry: reg, bus }).start();
    reg.remove('device.gps');
    const r = bus.named('capability.record.removed');
    expect(r.length).toBe(1);
    expect((r[0].payload as { id: string }).id).toBe('device.gps');
  });

  it('19) duplicate record change → event YOK', () => {
    const reg = fakeRegistry([rec('device.gps', { status: 'unknown' })]); const bus = fakeBus();
    createCapabilityEventBridge({ registry: reg, bus }).start();
    reg.update(rec('device.gps', { status: 'unknown' }));   // aynı → dedup
    expect(bus.named('capability.record.changed').length).toBe(0);
    expect(bus.named('capability.snapshot.changed').length).toBe(0);
    reg.update(rec('device.gps', { status: 'available', available: true })); // farklı → event
    expect(bus.named('capability.record.changed').length).toBe(1);
  });

  it('20) snapshot.changed event', () => {
    const reg = fakeRegistry(); const bus = fakeBus();
    createCapabilityEventBridge({ registry: reg, bus }).start();
    reg.register(rec('device.wifi', { status: 'available', available: true }));
    expect(bus.named('capability.snapshot.changed').length).toBe(1);
  });

  it('21) snapshot payload full registry TAŞIMIYOR', () => {
    const reg = fakeRegistry(); const bus = fakeBus();
    createCapabilityEventBridge({ registry: reg, bus }).start();
    reg.register(rec('device.wifi', { status: 'available', available: true }));
    const p = bus.named('capability.snapshot.changed')[0].payload as Record<string, unknown>;
    expect('capabilities' in p).toBe(false);
    expect(Object.keys(p).sort()).toEqual(
      ['availableCount', 'changedCapabilityIds', 'degradedCount', 'revision', 'unavailableCount', 'unknownCount'].sort(),
    );
    expect((p.availableCount as number)).toBe(1);
  });

  it('22) changedCapabilityIds bounded', () => {
    const reg = fakeRegistry(); const bus = fakeBus();
    createCapabilityEventBridge({ registry: reg, bus }).start();
    reg.register(rec('device.gps', { status: 'degraded' }));
    const p = bus.named('capability.snapshot.changed')[0].payload as { changedCapabilityIds: string[] };
    expect(Array.isArray(p.changedCapabilityIds)).toBe(true);
    expect(p.changedCapabilityIds.length).toBeLessThanOrEqual(8);
    expect(p.changedCapabilityIds).toEqual(['device.gps']);
  });

  it('23) snapshot.changed retained', () => {
    const reg = fakeRegistry(); const bus = fakeBus();
    createCapabilityEventBridge({ registry: reg, bus }).start();
    reg.register(rec('device.gps', { status: 'degraded' }));
    expect(bus.named('capability.snapshot.changed')[0].retained).toBe(true);
  });

  it('24) record payload whitelist/şekil', () => {
    const reg = fakeRegistry(); const bus = fakeBus();
    createCapabilityEventBridge({ registry: reg, bus }).start();
    reg.register(rec('ai.gemini', { domain: 'ai', status: 'available', available: true, quality: 'medium', confidence: 0.75, source: 'config', reason: 'configured_usable', limitations: ['byok'] }));
    const p = bus.named('capability.record.registered')[0].payload as Record<string, unknown>;
    expect(Object.keys(p).sort()).toEqual(
      ['available', 'confidence', 'domain', 'id', 'limitations', 'quality', 'reason', 'source', 'stale', 'status'].sort(),
    );
    expect(p.reason).toBe('configured_usable');
  });

  it('25) Registry subscribe hatası fail-soft', () => {
    const badReg = {
      subscribe: () => { throw new Error('sub boom'); },
      getCapability: () => null,
      createSnapshot: () => ({ revision: 0, availableCount: 0, unavailableCount: 0, unknownCount: 0, degradedCount: 0, capabilities: [] }),
    };
    const b = createCapabilityEventBridge({ registry: badReg, bus: fakeBus() });
    expect(() => b.start()).not.toThrow();
    expect(b.getStatus().started).toBe(true);
  });

  it('26) Bus publish hatası fail-soft → droppedCount', () => {
    const reg = fakeRegistry(); const bus = fakeBus({ throwOnPublish: true });
    const b = createCapabilityEventBridge({ registry: reg, bus });
    b.start();
    expect(() => reg.register(rec('device.gps', { status: 'degraded' }))).not.toThrow();
    expect(b.getDroppedCount()).toBeGreaterThan(0);
  });

  it('27) dispose zero-leak', () => {
    const reg = fakeRegistry(); const bus = fakeBus();
    const b = createCapabilityEventBridge({ registry: reg, bus });
    b.start(); b.dispose();
    expect(reg.hasListener()).toBe(false);
    expect(b.isDisposed).toBe(true);
  });

  it('28) kaynaklar dispose EDİLMİYOR', () => {
    const reg = fakeRegistry(); const bus = fakeBus();
    const b = createCapabilityEventBridge({ registry: reg, bus });
    b.start(); b.dispose();
    expect(() => reg.createSnapshot()).not.toThrow();
    expect(() => bus.publish({ name: 'capability.record.changed' } as never)).not.toThrow();
  });

  it('29) privacy — record payload rogue alanları whitelist dışı bırakır', () => {
    const reg = fakeRegistry(); const bus = fakeBus();
    createCapabilityEventBridge({ registry: reg, bus }).start();
    const rogue = { ...rec('device.gps', { status: 'degraded' }), vin: '1HGCM82633A004352', apiKey: 'sk-secret-token-123456' } as unknown as CapabilityRecordLike;
    reg.register(rogue);
    const json = JSON.stringify(bus.named('capability.record.registered')[0].payload);
    expect(json).not.toContain('1HGCM82633A004352');
    expect(json).not.toContain('sk-secret-token');
  });

  it('30) input mutate edilmiyor', () => {
    const reg = fakeRegistry(); const bus = fakeBus();
    createCapabilityEventBridge({ registry: reg, bus }).start();
    const r = rec('device.gps', { status: 'degraded', limitations: ['x'] });
    const clone = JSON.parse(JSON.stringify(r));
    reg.register(r);
    expect(JSON.parse(JSON.stringify(r))).toEqual(clone);
  });

  /* ── Ortak (31–40) ── */

  it('31) start idempotent — tek abonelik (duplicate subscription yok)', () => {
    const reg = fakeRegistry(); const bus = fakeBus();
    const b = createCapabilityEventBridge({ registry: reg, bus });
    b.start(); b.start();
    expect(reg.subCount()).toBe(1);
  });

  it('32) dispose sonrası callback no-op', () => {
    const reg = fakeRegistry(); const bus = fakeBus();
    const b = createCapabilityEventBridge({ registry: reg, bus });
    b.start(); b.dispose();
    const before = bus.events.length;
    reg.register(rec('device.gps', { status: 'degraded' })); // listener bırakıldı → ulaşmaz
    expect(bus.events.length).toBe(before);
  });

  it('33) counters doğru', () => {
    const reg = fakeRegistry(); const bus = fakeBus();
    const b = createCapabilityEventBridge({ registry: reg, bus });
    b.start();
    reg.register(rec('device.gps', { status: 'degraded' }));
    expect(b.getPublishedCount()).toBe(bus.events.length);
    expect(b.getDroppedCount()).toBe(0);
  });

  it('34) import yan etkisiz — fabrika abone olmaz', () => {
    const reg = fakeRegistry(); const bus = fakeBus();
    createCapabilityEventBridge({ registry: reg, bus });
    expect(reg.subCount()).toBe(0);
    expect(reg.snapCount()).toBe(0);
    expect(bus.events.length).toBe(0);
  });

  it('38) büyük snapshot allocation yok — createSnapshot yalnız start\'ta BİR KEZ', () => {
    const reg = fakeRegistry([rec('a'), rec('b')]); const bus = fakeBus();
    const b = createCapabilityEventBridge({ registry: reg, bus });
    b.start();
    reg.register(rec('device.gps', { status: 'degraded' }));
    reg.update(rec('device.gps', { status: 'available', available: true }));
    reg.remove('device.gps');
    expect(reg.snapCount()).toBe(1); // değişiklik başına createSnapshot YOK
  });

  it('35/36/37) SystemBoot/provider-auto-start/timer wiring YOK', () => {
    expect(bridgeSource).not.toMatch(/from ['"].*SystemBoot/);
    expect(bridgeSource).not.toMatch(/createRuntimeCapabilityProviders|createUnifiedVehicleStoreProvider/);
    expect(bridgeSource).not.toMatch(/setInterval|setTimeout|requestAnimationFrame/);
  });

  it('39) yayınlanan tüm event isimleri katalogda', () => {
    const reg = fakeRegistry(); const bus = fakeBus();
    createCapabilityEventBridge({ registry: reg, bus }).start();
    reg.register(rec('device.gps', { status: 'degraded' }));
    reg.update(rec('device.gps', { status: 'available', available: true }));
    reg.remove('device.gps');
    reg.resetAll();
    for (const e of bus.events) expect(CATALOG_NAMES.has(e.name)).toBe(true);
  });

  it('40) mevcut modülleri VALUE import etmiyor (yalnız type)', () => {
    expect(bridgeSource).not.toMatch(/import\s+\{[^}]*\}\s+from\s+['"].*platformEventBus/);
    expect(bridgeSource).not.toMatch(/from ['"].*\/capabilityRegistry/);
    expect(bridgeSource).toMatch(/import type/);
  });
});
