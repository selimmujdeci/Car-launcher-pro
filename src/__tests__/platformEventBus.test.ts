/**
 * platformEventBus.test.ts — Platform Event Bus Foundation birim testleri.
 *
 * Kapsam: publish/subscribe/unsubscribe · duplicate · once · domain · priority sırası ·
 * listener izolasyonu · monotonic sequence (saat-geri) · immutability (nested) · history/
 * transient/priority-eviction · retained (opt-in replay/bounded) · bounded (total/per-event/
 * domain/recursion/event-name) · re-entrant güvenlik · safety-preemption · dispose/reset
 * zero-leak · stats · privacy · fail-soft · import yan etkisi · SystemBoot wiring yok.
 */

import { describe, it, expect } from 'vitest';
import {
  createPlatformEventBus,
  DEFAULT_EVENT_CATALOG,
  type PlatformEventBusDeps,
} from '../platform/eventBus';
import busSource from '../platform/eventBus/platformEventBus.ts?raw';

let _t = 5_000_000;
function bus(deps: Partial<PlatformEventBusDeps> = {}) {
  return createPlatformEventBus({ now: () => _t, ...deps });
}
const NAME = 'platform.service.started';

/* ══════════════════════════════════════════════════════════════════════════
 * 1–8 · Temel
 * ════════════════════════════════════════════════════════════════════════ */

describe('temel', () => {
  it('1) boş bus — listener 0, history 0', () => {
    const b = bus();
    expect(b.listenerCount()).toBe(0);
    expect(b.getRecentEvents()).toEqual([]);
  });

  it('2) publish — event döner, sequence atanır', () => {
    const b = bus();
    const e = b.publish({ name: NAME, payload: { x: 1 } });
    expect(e?.name).toBe(NAME);
    expect(e?.sequence).toBe(1);
    expect(e?.domain).toBe('platform');
  });

  it('3) subscribe — event teslim edilir', () => {
    const b = bus();
    let got: unknown = null;
    b.subscribe(NAME, (e) => { got = e.payload; });
    b.publish({ name: NAME, payload: { x: 42 } });
    expect(got).toEqual({ x: 42 });
  });

  it('4) unsubscribe — sonrası teslim yok; idempotent', () => {
    const b = bus();
    let count = 0;
    const id = b.subscribe(NAME, () => { count++; })!;
    b.publish({ name: NAME });
    expect(b.unsubscribe(id)).toBe(true);
    expect(b.unsubscribe(id)).toBe(false); // idempotent
    b.publish({ name: NAME });
    expect(count).toBe(1);
  });

  it('5) duplicate listener engelleniyor', () => {
    const b = bus();
    const fn = () => { /* */ };
    const id1 = b.subscribe(NAME, fn);
    const id2 = b.subscribe(NAME, fn);
    expect(id1).toBe(id2);
    expect(b.listenerCount(NAME)).toBe(1);
    expect(b.getStats().duplicateSubscriptionCount).toBe(1);
  });

  it('6) once listener — ilk çağrıdan sonra temizlenir', () => {
    const b = bus();
    let count = 0;
    b.once(NAME, () => { count++; });
    b.publish({ name: NAME });
    b.publish({ name: NAME });
    expect(count).toBe(1);
    expect(b.listenerCount(NAME)).toBe(0);
  });

  it('7) event name listener yalnız o adı alır', () => {
    const b = bus();
    let a = 0, c = 0;
    b.subscribe('platform.service.started', () => { a++; });
    b.subscribe('platform.service.stopped', () => { c++; });
    b.publish({ name: 'platform.service.started' });
    expect(a).toBe(1); expect(c).toBe(0);
  });

  it('8) domain listener — domaindeki tüm event\'leri alır', () => {
    const b = bus();
    let count = 0;
    b.subscribeDomain('deep_scan', () => { count++; });
    b.publish({ name: 'deep_scan.scan.started' });
    b.publish({ name: 'deep_scan.phase.completed' });
    b.publish({ name: 'vehicle.signal.changed' }); // farklı domain
    expect(count).toBe(2);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 9–14 · Priority / sequence
 * ════════════════════════════════════════════════════════════════════════ */

describe('priority ve sequence', () => {
  it('9) priority sırası — yüksek subscription önceliği önce', () => {
    const b = bus();
    const order: string[] = [];
    b.subscribe(NAME, () => { order.push('low'); }, { priority: 'low' });
    b.subscribe(NAME, () => { order.push('safety'); }, { priority: 'safety' });
    b.subscribe(NAME, () => { order.push('normal'); }, { priority: 'normal' });
    b.publish({ name: NAME });
    expect(order).toEqual(['safety', 'normal', 'low']);
  });

  it('10) aynı priority — kayıt sırası korunur', () => {
    const b = bus();
    const order: string[] = [];
    b.subscribe(NAME, () => { order.push('a'); });
    b.subscribe(NAME, () => { order.push('b'); });
    b.subscribe(NAME, () => { order.push('c'); });
    b.publish({ name: NAME });
    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('13) monotonic sequence', () => {
    const b = bus();
    const s1 = b.publish({ name: NAME })!.sequence;
    const s2 = b.publish({ name: NAME })!.sequence;
    const s3 = b.publish({ name: NAME })!.sequence;
    expect(s2).toBeGreaterThan(s1);
    expect(s3).toBeGreaterThan(s2);
  });

  it('14) saat geri sıçrasa sequence korunur', () => {
    _t = 5_000_000;
    const b = bus();
    const s1 = b.publish({ name: NAME })!.sequence;
    _t = 4_000_000; // saat geri
    const s2 = b.publish({ name: NAME })!.sequence;
    expect(s2).toBeGreaterThan(s1);
    _t = 5_000_000;
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 11–12,15–17 · İzolasyon / immutability
 * ════════════════════════════════════════════════════════════════════════ */

describe('izolasyon ve immutability', () => {
  it('11-12) listener exception izole — diğerleri engellenmez', () => {
    const b = bus();
    let good = 0;
    b.subscribe(NAME, () => { throw new Error('kötü'); });
    b.subscribe(NAME, () => { good++; });
    expect(() => b.publish({ name: NAME })).not.toThrow();
    expect(good).toBe(1);
    expect(b.getStats().listenerErrorCount).toBe(1);
  });

  it('15) event immutable (frozen)', () => {
    const b = bus();
    const e = b.publish({ name: NAME, payload: { x: 1 } })!;
    expect(Object.isFrozen(e)).toBe(true);
  });

  it('16) nested payload immutable', () => {
    const b = bus();
    const e = b.publish({ name: NAME, payload: { a: { b: 1 } } })!;
    expect(Object.isFrozen(e.payload)).toBe(true);
    expect(Object.isFrozen((e.payload as { a: object }).a)).toBe(true);
  });

  it('17) girdi objesi mutate edilmiyor (payload dışı referans)', () => {
    const b = bus();
    const input = { name: NAME, payload: { x: 1 }, source: 'deep_scan' as const };
    b.publish(input);
    expect(input.name).toBe(NAME);
    expect(input.source).toBe('deep_scan');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 18–24 · History / transient / retained
 * ════════════════════════════════════════════════════════════════════════ */

describe('history, transient, retained', () => {
  it('18) recent history', () => {
    const b = bus();
    b.publish({ name: 'deep_scan.scan.started' });
    b.publish({ name: 'deep_scan.scan.completed' });
    const recent = b.getRecentEvents();
    expect(recent.length).toBe(2);
    expect(recent.map((e) => e.name)).toContain('deep_scan.scan.started');
  });

  it('19) transient event history\'ye girmiyor', () => {
    const b = bus();
    b.publish({ name: 'vehicle.signal.changed', payload: { speed: 50 } }); // katalog transient
    expect(b.getRecentEvents().length).toBe(0);
  });

  it('20) history bounded', () => {
    const b = bus({ limits: { maxHistory: 3 } });
    for (let i = 0; i < 6; i++) b.publish({ name: 'deep_scan.phase.completed' });
    expect(b.getRecentEvents().length).toBe(3);
  });

  it('21) priority-aware eviction — safety korunur, background önce silinir', () => {
    const b = bus({ limits: { maxHistory: 2 } });
    b.publish({ name: 'health.condition.critical' }); // safety
    b.publish({ name: 'platform.service.started' });  // normal
    b.publish({ name: 'capability.record.changed' });  // low → normal itilir? hayır: en düşük öncelik silinir
    const names = b.getRecentEvents().map((e) => e.name);
    expect(names).toContain('health.condition.critical'); // safety asla düşmez
  });

  it('22-23) retained + replayLast opt-in', () => {
    const b = bus();
    b.publish({ name: 'vehicle.ignition.changed', payload: { on: true } }); // retained
    // replayLast YOK → geç aboneye teslim edilmez
    let without = 0;
    b.subscribe('vehicle.ignition.changed', () => { without++; });
    expect(without).toBe(0);
    // replayLast VAR → son retained hemen teslim
    let withReplay: unknown = null;
    b.subscribe('vehicle.ignition.changed', (e) => { withReplay = e.payload; }, { replayLast: true });
    expect(withReplay).toEqual({ on: true });
  });

  it('24) retained bounded', () => {
    const b = bus({ limits: { maxRetained: 1 } });
    b.publish({ name: 'vehicle.ignition.changed' });
    b.publish({ name: 'vehicle.connection.changed' });
    expect(b.getStats().retainedEventCount).toBe(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 25–29 · Bounded / recursion
 * ════════════════════════════════════════════════════════════════════════ */

describe('bounded ve recursion', () => {
  it('25) total listener bounded', () => {
    const b = bus({ limits: { maxListeners: 2 } });
    expect(b.subscribe('deep_scan.scan.started', () => {})).not.toBeNull();
    expect(b.subscribe('deep_scan.scan.completed', () => {})).not.toBeNull();
    expect(b.subscribe('deep_scan.scan.failed', () => {})).toBeNull(); // tavan
  });

  it('26) event başına listener bounded', () => {
    const b = bus({ limits: { maxListenersPerEvent: 2 } });
    expect(b.subscribe(NAME, () => {})).not.toBeNull();
    expect(b.subscribe(NAME, () => {})).not.toBeNull();
    expect(b.subscribe(NAME, () => {})).toBeNull();
  });

  it('27) domain listener bounded', () => {
    const b = bus({ limits: { maxDomainListeners: 1 } });
    expect(b.subscribeDomain('deep_scan', () => {})).not.toBeNull();
    expect(b.subscribeDomain('deep_scan', () => {})).toBeNull();
  });

  it('28) recursive publish bounded — depth aşımı droplanır + sayılır', () => {
    const b = bus({ limits: { maxPublishDepth: 3 } });
    b.subscribe(NAME, () => { b.publish({ name: NAME }); }); // sonsuz zincir
    b.publish({ name: NAME });
    expect(b.getStats().recursionDropCount).toBeGreaterThan(0);
  });

  it('29) re-entrant publish güvenli (throw yok)', () => {
    const b = bus();
    b.subscribe('deep_scan.scan.started', () => { b.publish({ name: 'deep_scan.scan.completed' }); });
    let completed = 0;
    b.subscribe('deep_scan.scan.completed', () => { completed++; });
    expect(() => b.publish({ name: 'deep_scan.scan.started' })).not.toThrow();
    expect(completed).toBe(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 30–35 · Yaşam döngüsü / stats
 * ════════════════════════════════════════════════════════════════════════ */

describe('yaşam döngüsü ve stats', () => {
  it('30-31) dispose zero-leak + sonrası no-op', () => {
    const b = bus();
    b.subscribe(NAME, () => {});
    b.publish({ name: NAME });
    b.dispose();
    expect(b.isDisposed).toBe(true);
    expect(b.listenerCount()).toBe(0);
    expect(b.publish({ name: NAME })).toBeNull(); // no-op
    expect(b.subscribe(NAME, () => {})).toBeNull();
  });

  it('32) reset', () => {
    const b = bus();
    b.subscribe(NAME, () => {});
    b.publish({ name: NAME });
    b.reset();
    expect(b.listenerCount()).toBe(0);
    expect(b.getRecentEvents().length).toBe(0);
    expect(b.getStats().publishedCount).toBe(0);
  });

  it('33) stats doğru', () => {
    const b = bus();
    b.subscribe(NAME, () => {});
    b.publish({ name: NAME });
    const s = b.getStats();
    expect(s.publishedCount).toBe(1);
    expect(s.deliveredCount).toBe(1);
    expect(s.activeListenerCount).toBe(1);
    expect(Object.isFrozen(s)).toBe(true);
  });

  it('34) droppedCount — geçersiz event', () => {
    const b = bus();
    b.publish({ name: 'BOZUK ISIM' as never });
    expect(b.getStats().droppedCount).toBe(1);
  });

  it('35) listenerErrorCount', () => {
    const b = bus();
    b.subscribe(NAME, () => { throw new Error('x'); });
    b.publish({ name: NAME });
    expect(b.getStats().listenerErrorCount).toBe(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 36–40 · Privacy / fail-soft / yalıtım
 * ════════════════════════════════════════════════════════════════════════ */

describe('privacy, fail-soft, yalıtım', () => {
  it('36) privacy — VIN fingerprint reddedilir, history payload sanitize', () => {
    const b = bus();
    const e = b.publish({ name: 'deep_scan.scan.started', vehicleFingerprintHash: '1HGCM82633A004352', payload: { vin: '1HGCM82633A004352' } })!;
    expect(e.vehicleFingerprintHash).toBeNull(); // VIN reddedildi
    const recent = b.getRecentEvents()[0];
    expect(JSON.stringify(recent)).not.toContain('1HGCM82633A004352'); // history özeti temizlendi
    // Geçerli anonim hash kabul
    expect(b.publish({ name: 'deep_scan.scan.started', vehicleFingerprintHash: 'a1b2c3d4e5f60718' })!.vehicleFingerprintHash).toBe('a1b2c3d4e5f60718');
  });

  it('37) unknown event fail-soft — bilinmeyen ad işlenir (format geçerliyse)', () => {
    const b = bus();
    let got = false;
    b.subscribe('plugin.custom.happened', () => { got = true; });
    const e = b.publish({ name: 'plugin.custom.happened' });
    expect(e).not.toBeNull();
    expect(e?.domain).toBe('plugin'); // ad ön ekinden türetildi
    expect(got).toBe(true);
  });

  it('38) invalid event fail-soft — bozuk ad reddedilir (throw yok)', () => {
    const b = bus();
    expect(() => b.publish({ name: 'invalidname' as never })).not.toThrow();
    expect(b.publish({ name: 'invalidname' as never })).toBeNull();
    expect(() => b.publish(null as never)).not.toThrow();
  });

  it('39) import yan etkisiz — timer/native/global singleton YOK', () => {
    expect(/setInterval|setTimeout/.test(busSource)).toBe(false);
    expect(/\bnavigator\.|Capacitor/.test(busSource)).toBe(false);
    // Tekil singleton export edilmez (yalnız factory/class)
    expect(/export const \w+Bus\s*=\s*new /.test(busSource)).toBe(false);
  });

  it('40) SystemBoot wiring yok', () => {
    expect(/from\s+['"][^'"]*SystemBoot['"]/.test(busSource)).toBe(false);
    expect(/^\s*import[\s{]/m.test(busSource)).toBe(false); // hiç import yok (bağımsız foundation)
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 41–50 · Ek: modül izolasyonu / high-freq / safety / catalog / basic_js
 * ════════════════════════════════════════════════════════════════════════ */

describe('ek senaryolar', () => {
  it('42) high-frequency transient — history/RAM şişmez', () => {
    const b = bus();
    for (let i = 0; i < 100; i++) b.publish({ name: 'vehicle.signal.changed', payload: { speed: i } });
    expect(b.getRecentEvents().length).toBe(0); // transient → history yok
    expect(b.getStats().publishedCount).toBe(100);
  });

  it('43) snapshot/stats immutable', () => {
    const b = bus();
    b.publish({ name: 'deep_scan.scan.started' });
    expect(Object.isFrozen(b.getStats())).toBe(true);
    expect(b.getRecentEvents().every((e) => Object.isFrozen(e))).toBe(true);
  });

  it('44) listener içinde unsubscribe güvenli', () => {
    const b = bus();
    let a = 0, c = 0;
    let idA = '';
    idA = b.subscribe(NAME, () => { a++; b.unsubscribe(idA); })!;
    b.subscribe(NAME, () => { c++; });
    expect(() => { b.publish({ name: NAME }); b.publish({ name: NAME }); }).not.toThrow();
    expect(a).toBe(1); // ilk publish'te kendini çıkardı
    expect(c).toBe(2);
  });

  it('45) listener içinde dispose güvenli', () => {
    const b = bus();
    b.subscribe(NAME, () => { b.dispose(); });
    b.subscribe(NAME, () => { /* */ });
    expect(() => b.publish({ name: NAME })).not.toThrow();
    expect(b.isDisposed).toBe(true);
  });

  it('46) safety event önce dispatch (re-entrant kuyrukta)', () => {
    const b = bus();
    const order: string[] = [];
    b.subscribe('health.condition.warning', () => { order.push('warning'); });
    b.subscribe('health.condition.critical', () => { order.push('critical'); }); // safety
    b.subscribe(NAME, () => {
      b.publish({ name: 'health.condition.warning' });   // high
      b.publish({ name: 'health.condition.critical' });  // safety → önce dispatch edilmeli
    });
    b.publish({ name: NAME });
    expect(order).toEqual(['critical', 'warning']);
  });

  it('47) safety event history\'de korunur', () => {
    const b = bus({ limits: { maxHistory: 1 } });
    b.publish({ name: 'health.condition.critical' }); // safety
    b.publish({ name: 'capability.record.changed' });  // low → safety'yi itemez
    expect(b.getRecentEvents().map((e) => e.name)).toEqual(['health.condition.critical']);
  });

  it('48) catalog isim standardı — domain.entity.action', () => {
    expect(DEFAULT_EVENT_CATALOG.every((e) => /^[a-z_]+\.[a-z_]+\.[a-z_]+$/.test(e.name))).toBe(true);
  });

  it('49) max 256 event name — tavan aşımı droplanır', () => {
    const b = bus({ catalog: [], limits: { maxEventNames: 2 } });
    expect(b.publish({ name: 'plugin.a.x' })).not.toBeNull();
    expect(b.publish({ name: 'plugin.b.x' })).not.toBeNull();
    expect(b.publish({ name: 'plugin.c.x' })).toBeNull(); // 3. yeni ad → tavan
  });

  it('50) BASIC_JS düşük history config', () => {
    const b = bus({ limits: { maxHistory: 8 } });
    for (let i = 0; i < 40; i++) b.publish({ name: 'deep_scan.phase.completed' });
    expect(b.getRecentEvents().length).toBe(8);
  });
});
