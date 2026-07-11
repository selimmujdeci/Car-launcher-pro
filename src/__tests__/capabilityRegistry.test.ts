/**
 * capabilityRegistry.test.ts — Capability Registry Foundation birim testleri.
 *
 * Kapsam: register/get/has/isAvailable · status modeli (unknown/unavailable/degraded/
 * restricted/unsupported) · confidence clamp · quality · duplicate merge · authoritative
 * öncelik · çelişki→unknown · stale · UI/config kanıt değil · native high · deep_scan
 * araç · DeviceTier min (Mali-400 GPU/local model kapalı) · domain filtre · requirement ·
 * explainUnavailable · subscribe/bounded/izolasyon · capability bounded · remove/reset/
 * dispose zero-leak · immutability (nested) · privacy · fail-soft · import yan etkisi ·
 * SystemBoot wiring yok.
 */

import { describe, it, expect } from 'vitest';
import {
  createCapabilityRegistry,
  DEFAULT_CAPABILITY_CATALOG,
  MAX_CAPABILITIES,
  MAX_CAPABILITY_LISTENERS,
  type CapabilityRegistryDeps,
  type CapabilityEvidence,
} from '../platform/capability';
import registrySource from '../platform/capability/capabilityRegistry.ts?raw';

const NOW = 3_000_000;

function reg(opts: Partial<CapabilityRegistryDeps> = {}) {
  return createCapabilityRegistry({ now: () => NOW, deviceTier: 'high', seedCatalog: false, ...opts });
}
const ev = (o: Partial<CapabilityEvidence> = {}): CapabilityEvidence =>
  ({ source: 'native', available: true, confidence: 0.95, ...o });

/* ══════════════════════════════════════════════════════════════════════════
 * 1–8 · Temel + status modeli
 * ════════════════════════════════════════════════════════════════════════ */

describe('temel ve status modeli', () => {
  it('1) boş registry (seedCatalog:false) → size 0', () => {
    expect(reg().size).toBe(0);
  });

  it('2) capability register', () => {
    const r = reg();
    const rec = r.registerCapability({ id: 'device.gps', domain: 'device' });
    expect(rec?.id).toBe('device.gps');
    expect(r.size).toBe(1);
  });

  it('3) get/has/isAvailable', () => {
    const r = reg();
    r.registerCapability({ id: 'device.gps', domain: 'device', status: 'available', confidence: 0.9 });
    expect(r.hasCapability('device.gps')).toBe(true);
    expect(r.getCapability('device.gps')?.domain).toBe('device');
    expect(r.isAvailable('device.gps')).toBe(true);
    expect(r.hasCapability('yok')).toBe(false);
  });

  it('4) unknown available sayılmıyor', () => {
    const r = reg();
    r.registerCapability({ id: 'device.gps', domain: 'device' }); // kanıt yok → unknown
    expect(r.getStatus('device.gps')).toBe('unknown');
    expect(r.isAvailable('device.gps')).toBe(false);
  });

  it('5) unavailable — native available:false', () => {
    const r = reg();
    r.registerCapability({ id: 'device.gps', domain: 'device' });
    const rec = r.resolveCapability('device.gps', ev({ available: false }));
    expect(rec?.status).toBe('unavailable');
    expect(rec?.available).toBe(false);
  });

  it('6) degraded — available ama düşük confidence/kalite', () => {
    const r = reg();
    r.registerCapability({ id: 'device.gps', domain: 'device' });
    const rec = r.resolveCapability('device.gps', ev({ available: true, confidence: 0.9, quality: 'low' }));
    expect(rec?.status).toBe('degraded');
  });

  it('7) restricted — safety-critical writable + non-authoritative kanıt', () => {
    const r = reg();
    r.registerCapability({ id: 'vehicle.coding', domain: 'vehicle', safetyCritical: true, writable: true });
    const rec = r.resolveCapability('vehicle.coding', ev({ source: 'user', available: true, confidence: 0.9 }));
    expect(rec?.status).toBe('restricted');
  });

  it('8) unsupported — explicit register → available değil', () => {
    const r = reg();
    r.registerCapability({ id: 'device.npu', domain: 'device', status: 'unsupported' });
    expect(r.getStatus('device.npu')).toBe('unsupported');
    expect(r.isAvailable('device.npu')).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 9–18 · Confidence/quality/kaynak/karar
 * ════════════════════════════════════════════════════════════════════════ */

describe('confidence, quality, kaynak kararları', () => {
  it('9) confidence clamp [0,1]', () => {
    const r = reg();
    r.registerCapability({ id: 'a.b', domain: 'platform', status: 'available', confidence: 5 });
    expect(r.getConfidence('a.b')).toBe(1);
    r.registerCapability({ id: 'a.c', domain: 'platform', status: 'available', confidence: -3 });
    expect(r.getConfidence('a.c')).toBe(0);
  });

  it('10) quality modeli — geçersiz → unknown', () => {
    const r = reg();
    const rec = r.registerCapability({ id: 'a.b', domain: 'platform', quality: 'süper' as never });
    expect(rec?.quality).toBe('unknown');
  });

  it('11) duplicate deterministic merge — firstSeen korunur, tek kayıt', () => {
    const r = reg({ now: () => NOW });
    r.registerCapability({ id: 'device.gps', domain: 'device', status: 'available' });
    const first = r.getCapability('device.gps')!.firstSeen;
    r.registerCapability({ id: 'device.gps', domain: 'device', status: 'degraded' });
    expect(r.size).toBe(1);
    expect(r.getCapability('device.gps')!.firstSeen).toBe(first);
    expect(r.getStatus('device.gps')).toBe('degraded');
  });

  it('12) authoritative kaynak yardımcıyı ezer (native true + inferred false → available)', () => {
    const r = reg();
    r.registerCapability({ id: 'device.bluetooth', domain: 'device' });
    const rec = r.resolveCapability('device.bluetooth', [
      ev({ source: 'native', available: true, confidence: 0.95 }),
      ev({ source: 'inferred', available: false, confidence: 0.4 }),
    ]);
    expect(rec?.status).toBe('available');
    expect(rec?.source).toBe('native');
  });

  it('13) çelişkili authoritative kaynak → unknown', () => {
    const r = reg();
    r.registerCapability({ id: 'vehicle.can', domain: 'vehicle' });
    const rec = r.resolveCapability('vehicle.can', [
      ev({ source: 'native', available: true }),
      ev({ source: 'can', available: false }),
    ]);
    expect(rec?.status).toBe('unknown');
    expect(rec?.reason).toBe('conflict');
  });

  it('14) stale kanıt available değil → unknown + stale', () => {
    const r = reg({ staleMs: 60_000 });
    r.registerCapability({ id: 'device.gps', domain: 'device' });
    const rec = r.resolveCapability('device.gps', ev({ available: true, observedAt: NOW - 70_000 }));
    expect(rec?.status).toBe('unknown');
    expect(rec?.stale).toBe(true);
  });

  it('15) UI varlığı kanıt değil — geçersiz kaynak yok sayılır → unknown', () => {
    const r = reg();
    r.registerCapability({ id: 'device.gps', domain: 'device' });
    const rec = r.resolveCapability('device.gps', { source: 'ui' as never, available: true });
    expect(rec?.status).toBe('unknown');
  });

  it('16) config tek başına fiziksel donanımı açmıyor → unknown', () => {
    const r = reg();
    r.registerCapability({ id: 'device.camera.rear', domain: 'device' });
    const rec = r.resolveCapability('device.camera.rear', ev({ source: 'config', available: true, confidence: 0.9 }));
    expect(rec?.status).toBe('unknown');
    expect(rec?.reason).toBe('config_only_hardware');
  });

  it('17) native kaynak high confidence → available', () => {
    const r = reg();
    r.registerCapability({ id: 'device.wifi', domain: 'device' });
    const rec = r.resolveCapability('device.wifi', ev({ source: 'native', available: true }));
    expect(rec?.status).toBe('available');
    expect(rec!.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('18) deep_scan araç capability kaynağı → available', () => {
    const r = reg();
    r.registerCapability({ id: 'vehicle.live_pid', domain: 'vehicle' });
    const rec = r.resolveCapability('vehicle.live_pid', ev({ source: 'deep_scan', available: true, confidence: 0.9 }));
    expect(rec?.status).toBe('available');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 19–25 · DeviceTier + katalog + sorgular
 * ════════════════════════════════════════════════════════════════════════ */

describe('DeviceTier ve katalog', () => {
  it('19) DeviceTier minimumu karşılanmazsa → restricted', () => {
    const r = reg({ deviceTier: 'low' });
    r.registerCapability({ id: 'ai.local_model', domain: 'ai', deviceTierMinimum: 'high' });
    const rec = r.resolveCapability('ai.local_model', ev({ source: 'native', available: true }));
    expect(rec?.status).toBe('restricted');
    expect(rec?.reason).toBe('device_tier_minimum');
  });

  it('20) Mali-400 (low) — advanced GPU kanıtı olsa bile restricted', () => {
    const r = reg({ deviceTier: 'low' });
    r.registerCapability({ id: 'device.gpu.advanced', domain: 'device', deviceTierMinimum: 'mid' });
    expect(r.resolveCapability('device.gpu.advanced', ev({ available: true }))?.status).toBe('restricted');
  });

  it('21) Mali-400 (low) — local model kapalı', () => {
    const r = reg({ deviceTier: 'low', seedCatalog: DEFAULT_CAPABILITY_CATALOG });
    const rec = r.resolveCapability('ai.local_model', ev({ source: 'native', available: true }));
    expect(rec?.status).toBe('restricted');
  });

  it('22) high tier — donanım kanıtı olmadan capability AÇILMAZ (unknown)', () => {
    const r = reg({ deviceTier: 'high', seedCatalog: DEFAULT_CAPABILITY_CATALOG });
    expect(r.getStatus('device.npu')).toBe('unknown'); // güçlü cihaz varlık uydurmaz
    expect(r.isAvailable('device.npu')).toBe(false);
  });

  it('23) domain filtresi (listByDomain)', () => {
    const r = reg({ seedCatalog: DEFAULT_CAPABILITY_CATALOG });
    const vehicle = r.listByDomain('vehicle');
    expect(vehicle.length).toBeGreaterThan(0);
    expect(vehicle.every((c) => c.domain === 'vehicle')).toBe(true);
  });

  it('24) requirement evaluation', () => {
    const r = reg();
    r.registerCapability({ id: 'device.gps', domain: 'device', status: 'available', confidence: 0.9 });
    r.registerCapability({ id: 'device.wifi', domain: 'device' }); // unknown
    const res = r.evaluateRequirements([
      { id: 'device.gps', mustBeAvailable: true },
      { id: 'device.wifi', mustBeAvailable: true },
    ]);
    expect(res.satisfied).toBe(false);
    expect(res.missing).toContain('device.wifi');
  });

  it('25) explainUnavailable', () => {
    const r = reg({ seedCatalog: DEFAULT_CAPABILITY_CATALOG });
    expect(r.explainUnavailable('device.gps')).toBe('no_evidence'); // seed reason
    expect(r.explainUnavailable('yok')).toBe('not_registered');
    r.resolveCapability('device.gps', ev({ available: false }));
    expect(r.explainUnavailable('device.gps')).toBe('reported_unavailable');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 26–33 · Abonelik / bounded / yaşam döngüsü
 * ════════════════════════════════════════════════════════════════════════ */

describe('abonelik, bounded, yaşam döngüsü', () => {
  it('26) subscribe/unsubscribe + değişimde tek event (duplicate yok)', () => {
    const r = reg();
    let count = 0;
    const unsub = r.subscribe(() => { count++; });
    r.registerCapability({ id: 'device.gps', domain: 'device', status: 'available' });
    expect(count).toBe(1);
    r.registerCapability({ id: 'device.gps', domain: 'device', status: 'available' }); // değişmedi
    expect(count).toBe(1);                          // duplicate event YOK
    unsub();
    r.registerCapability({ id: 'device.wifi', domain: 'device', status: 'available' });
    expect(count).toBe(1);                          // unsubscribe sonrası çağrılmaz
  });

  it('27) duplicate listener yok', () => {
    const r = reg();
    let count = 0;
    const fn = () => { count++; };
    r.subscribe(fn); r.subscribe(fn);
    r.registerCapability({ id: 'device.gps', domain: 'device', status: 'available' });
    expect(count).toBe(1);
  });

  it('28) listener hatası izole', () => {
    const r = reg();
    let good = 0;
    r.subscribe(() => { throw new Error('kötü'); });
    r.subscribe(() => { good++; });
    expect(() => r.registerCapability({ id: 'device.gps', domain: 'device', status: 'available' })).not.toThrow();
    expect(good).toBe(1);
  });

  it('29) listener bounded (MAX aşılınca no-op cleanup)', () => {
    const r = reg();
    for (let i = 0; i < MAX_CAPABILITY_LISTENERS; i++) r.subscribe(() => { /* */ });
    const extra = r.subscribe(() => { /* */ });
    expect(r.listenerCount).toBe(MAX_CAPABILITY_LISTENERS);
    expect(typeof extra).toBe('function');
  });

  it('30) capability bounded (MAX_CAPABILITIES)', () => {
    const r = reg();
    for (let i = 0; i < MAX_CAPABILITIES + 20; i++) r.registerCapability({ id: `c.${i}`, domain: 'platform' });
    expect(r.size).toBe(MAX_CAPABILITIES);
  });

  it('31) remove', () => {
    const r = reg();
    r.registerCapability({ id: 'device.gps', domain: 'device' });
    expect(r.removeCapability('device.gps')).toBe(true);
    expect(r.removeCapability('device.gps')).toBe(false);
    expect(r.hasCapability('device.gps')).toBe(false);
  });

  it('32) reset', () => {
    const r = reg({ seedCatalog: DEFAULT_CAPABILITY_CATALOG });
    expect(r.size).toBeGreaterThan(0);
    r.reset();
    expect(r.size).toBe(0);
  });

  it('33) dispose zero-leak — listener temizlenir, sonrası no-op', () => {
    const r = reg();
    r.subscribe(() => { /* */ });
    r.registerCapability({ id: 'device.gps', domain: 'device' });
    r.dispose();
    expect(r.listenerCount).toBe(0);
    expect(r.isDisposed).toBe(true);
    expect(r.registerCapability({ id: 'x.y', domain: 'platform' })).toBeNull(); // no-op
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 34–40 · Immutability / privacy / fail-soft / yalıtım
 * ════════════════════════════════════════════════════════════════════════ */

describe('immutability, privacy, fail-soft, yalıtım', () => {
  it('34) snapshot immutable (frozen)', () => {
    const r = reg({ seedCatalog: DEFAULT_CAPABILITY_CATALOG });
    const snap = r.createSnapshot();
    expect(Object.isFrozen(snap)).toBe(true);
    expect(Object.isFrozen(snap.capabilities)).toBe(true);
    expect(snap.capabilities.length).toBe(DEFAULT_CAPABILITY_CATALOG.length);
  });

  it('35) nested immutability (record.details / limitations frozen)', () => {
    const r = reg();
    const rec = r.registerCapability({ id: 'device.gps', domain: 'device', details: { a: '1' }, limitations: ['x'] })!;
    expect(Object.isFrozen(rec)).toBe(true);
    expect(Object.isFrozen(rec.details)).toBe(true);
    expect(Object.isFrozen(rec.limitations)).toBe(true);
    expect(() => { (rec.limitations as string[]).push('y'); }).toThrow();
  });

  it('36) girdi objesi mutate edilmiyor', () => {
    const r = reg();
    const details = { a: '1' };
    const input = { id: 'device.gps', domain: 'device' as const, details };
    r.registerCapability(input);
    expect(details).toEqual({ a: '1' });
  });

  it('37) privacy — provider/details VIN/koordinat temizlenir', () => {
    const r = reg();
    const rec = r.registerCapability({
      id: 'vehicle.obd', domain: 'vehicle',
      provider: 'ecu 1HGCM82633A004352', details: { loc: '41.0082,28.9784' },
    })!;
    const serialized = JSON.stringify(rec);
    expect(serialized).not.toContain('1HGCM82633A004352');
    expect(serialized).not.toContain('41.0082,28.9784');
  });

  it('38) public API fail-soft — bozuk girdi throw etmez', () => {
    const r = reg();
    expect(() => r.registerCapability({ id: '', domain: 'device' })).not.toThrow();
    expect(r.registerCapability({ id: '', domain: 'device' })).toBeNull();
    expect(() => r.resolveCapability('yok', ev(), 'not-a-domain' as never)).not.toThrow();
    expect(r.getStatus('yok')).toBe('unknown');
    expect(() => r.evaluateRequirements(null as never)).not.toThrow();
  });

  it('39) import yan etkisiz — timer/native/donanım probu YOK', () => {
    expect(/setInterval|setTimeout/.test(registrySource)).toBe(false);
    expect(/\bnavigator\./.test(registrySource)).toBe(false);
    // DeviceTier yalnız TYPE olarak import edilir (runtime coupling yok)
    expect(/import\s+type\s+\{\s*DeviceTier\s*\}/.test(registrySource)).toBe(true);
  });

  it('40) SystemBoot wiring yok', () => {
    expect(/from\s+['"][^'"]*SystemBoot['"]/.test(registrySource)).toBe(false);
  });
});
