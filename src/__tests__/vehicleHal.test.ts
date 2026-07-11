/**
 * vehicleHal.test.ts — Vehicle HAL Foundation birim testleri.
 *
 * Kapsam: katalog tohumlama · ingest/snapshot · signal lookup · supported/unsupported ·
 * stale · confidence · source · tipli erişimciler · identity privacy (ham VIN reddi) ·
 * getCapability · subscribe/duplicate/izolasyon/bounded · dispose zero-leak · fail-soft ·
 * immutable (nested) · input mutate edilmiyor · provider pull · import yan etkisiz.
 */

import { describe, it, expect } from 'vitest';
import {
  createVehicleHal,
  VEHICLE_SIGNAL_IDS,
  VEHICLE_HAL_STALE_MS_DEFAULT,
  MAX_HAL_LISTENERS,
  type VehicleHalDeps,
} from '../platform/vehicleHal';
import halSource from '../platform/vehicleHal/vehicleHal.ts?raw';

const NOW = 4_000_000;
function hal(deps: Partial<VehicleHalDeps> = {}) {
  return createVehicleHal({ now: () => NOW, ...deps });
}

/* ══════════════════════════════════════════════════════════════════════════
 * Katalog / temel
 * ════════════════════════════════════════════════════════════════════════ */

describe('katalog ve temel', () => {
  it('1) katalog tohumlu — tüm sinyaller supported=false başlar', () => {
    const h = hal();
    const snap = h.getSnapshot();
    expect(snap.signals.length).toBe(VEHICLE_SIGNAL_IDS.length);
    expect(snap.signals.every((s) => s.supported === false && s.value === null)).toBe(true);
  });

  it('2) ingest sinyal — value/source/quality yansır', () => {
    const h = hal();
    const s = h.ingestSignal('vehicle.speed', { value: 54, source: 'can', quality: 'high', confidence: 0.9 });
    expect(s?.value).toBe(54);
    expect(s?.source).toBe('can');
    expect(s?.supported).toBe(true);
    expect(s?.unit).toBe('km/h');
  });

  it('3) getSignal / hasSignal lookup', () => {
    const h = hal();
    h.ingestSignal('vehicle.rpm', { value: 1800, source: 'obd' });
    expect(h.getSignal('vehicle.rpm')?.value).toBe(1800);
    expect(h.hasSignal('vehicle.rpm')).toBe(true);
    expect(h.hasSignal('vehicle.oil_temp')).toBe(false); // beslenmedi
  });

  it('4) supported — kaynaklı sinyal', () => {
    const h = hal();
    h.ingestSignal('vehicle.fuel_level', { value: 60, source: 'native' });
    expect(h.getSignal('vehicle.fuel_level')?.supported).toBe(true);
  });

  it('5) unsupported — source none → supported=false, value null', () => {
    const h = hal();
    const s = h.ingestSignal('vehicle.speed', { value: 54, source: 'none' });
    expect(s?.supported).toBe(false);
    expect(s?.value).toBeNull(); // kaynaksız değer taşınmaz
  });

  it('6) stale — eski timestamp → stale=true', () => {
    const h = hal({ staleMs: 5000 });
    h.ingestSignal('vehicle.speed', { value: 54, source: 'can', timestamp: NOW - 6000 });
    expect(h.getSignal('vehicle.speed')?.stale).toBe(true);
  });

  it('7) saat geri (age<0) → stale', () => {
    const h = hal({ staleMs: 5000 });
    h.ingestSignal('vehicle.speed', { value: 54, source: 'can', timestamp: NOW + 10000 });
    expect(h.getSignal('vehicle.speed')?.stale).toBe(true);
  });

  it('8) confidence clamp [0,1]', () => {
    const h = hal();
    expect(h.ingestSignal('vehicle.speed', { value: 1, source: 'can', confidence: 5 })?.confidence).toBe(1);
    expect(h.ingestSignal('vehicle.rpm', { value: 1, source: 'can', confidence: -3 })?.confidence).toBe(0);
  });

  it('9) source modeli — geçersiz kaynak → none (supported=false)', () => {
    const h = hal();
    const s = h.ingestSignal('vehicle.speed', { value: 54, source: 'hiworld' as never });
    expect(s?.source).toBe('none');
    expect(s?.supported).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * Tipli erişimciler + value tip doğrulama
 * ════════════════════════════════════════════════════════════════════════ */

describe('tipli erişimciler', () => {
  it('10) getSpeed/getRPM/getBatteryVoltage — beslenince değer, yoksa null', () => {
    const h = hal();
    expect(h.getSpeed()).toBeNull();
    h.ingestSignal('vehicle.speed', { value: 72, source: 'can' });
    h.ingestSignal('vehicle.battery_voltage', { value: 13.8, source: 'obd' });
    expect(h.getSpeed()).toBe(72);
    expect(h.getBatteryVoltage()).toBe(13.8);
    expect(h.getRPM()).toBeNull(); // beslenmedi
  });

  it('11) getIgnition — kaynak yok → null (fail-closed)', () => {
    const h = hal();
    expect(h.getIgnition()).toBeNull();
    h.ingestSignal('vehicle.ignition', { value: true, source: 'native' });
    expect(h.getIgnition()).toBe(true);
  });

  it('12) value tip doğrulama — number sinyale boolean → null; NaN → null', () => {
    const h = hal();
    expect(h.ingestSignal('vehicle.speed', { value: true, source: 'can' })?.value).toBeNull();
    expect(h.ingestSignal('vehicle.speed', { value: NaN, source: 'can' })?.value).toBeNull();
    expect(h.ingestSignal('vehicle.reverse', { value: 1, source: 'can' })?.value).toBeNull(); // bool bekler
  });

  it('13) tpms — number[] doğrulama + kopya döner', () => {
    const h = hal();
    h.ingestSignal('vehicle.tpms', { value: [220, 225, 218, 230], source: 'can' });
    const t = h.getTpms();
    expect(t).toEqual([220, 225, 218, 230]);
    t!.push(999); // dış mutasyon iç durumu bozmaz
    expect(h.getTpms()).toEqual([220, 225, 218, 230]);
  });

  it('14) getGear / getDoorState / getReverse', () => {
    const h = hal();
    h.ingestSignal('vehicle.gear', { value: 3, source: 'can' });
    h.ingestSignal('vehicle.door_state', { value: false, source: 'can' });
    h.ingestSignal('vehicle.reverse', { value: true, source: 'can' });
    expect(h.getGear()).toBe(3);
    expect(h.getDoorState()).toBe(false);
    expect(h.getReverse()).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * Identity / capability
 * ════════════════════════════════════════════════════════════════════════ */

describe('identity ve capability', () => {
  it('15) getVehicleIdentity — fingerprint hash kabul, HAM VIN reddedilir', () => {
    const h = hal();
    expect(h.getVehicleIdentity().supported).toBe(false);
    h.ingestIdentity({ fingerprintHash: '1HGCM82633A004352', protocol: 'ISO15765' }); // VIN → reddedilir
    expect(h.getVehicleIdentity().fingerprintHash).toBeNull();
    h.ingestIdentity({ fingerprintHash: 'a1b2c3d4e5f60718', protocol: 'ISO15765' });
    const id = h.getVehicleIdentity();
    expect(id.fingerprintHash).toBe('a1b2c3d4e5f60718');
    expect(id.supported).toBe(true);
  });

  it('16) identity privacy — ham VIN snapshot/identity\'ye sızmaz', () => {
    const h = hal();
    h.ingestIdentity({ fingerprintHash: '1HGCM82633A004352' });
    expect(JSON.stringify(h.getVehicleIdentity())).not.toContain('1HGCM82633A004352');
  });

  it('17) getCapability — HAL-yerel supported/status', () => {
    const h = hal({ staleMs: 5000 });
    expect(h.getCapability('vehicle.speed').status).toBe('unsupported');
    h.ingestSignal('vehicle.speed', { value: 54, source: 'can', timestamp: NOW });
    expect(h.getCapability('vehicle.speed').status).toBe('available');
    h.ingestSignal('vehicle.speed', { value: 54, source: 'can', timestamp: NOW - 6000 });
    expect(h.getCapability('vehicle.speed').status).toBe('degraded'); // stale
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * Abonelik / provider / yaşam döngüsü
 * ════════════════════════════════════════════════════════════════════════ */

describe('abonelik, provider, yaşam döngüsü', () => {
  it('18) subscribe — değişimde çağrılır; değişmezse duplicate event yok', () => {
    const h = hal();
    let count = 0;
    const unsub = h.subscribe(() => { count++; });
    h.ingestSignal('vehicle.speed', { value: 54, source: 'can' });
    expect(count).toBe(1);
    h.ingestSignal('vehicle.speed', { value: 54, source: 'can' }); // aynı → değişmedi
    expect(count).toBe(1);
    unsub();
    h.ingestSignal('vehicle.speed', { value: 60, source: 'can' });
    expect(count).toBe(1); // unsubscribe sonrası çağrılmaz
  });

  it('19) duplicate listener yok', () => {
    const h = hal();
    let count = 0;
    const fn = () => { count++; };
    h.subscribe(fn); h.subscribe(fn);
    h.ingestSignal('vehicle.speed', { value: 54, source: 'can' });
    expect(count).toBe(1);
  });

  it('20) listener hatası izole', () => {
    const h = hal();
    let good = 0;
    h.subscribe(() => { throw new Error('kötü'); });
    h.subscribe(() => { good++; });
    expect(() => h.ingestSignal('vehicle.speed', { value: 54, source: 'can' })).not.toThrow();
    expect(good).toBe(1);
  });

  it('21) listener bounded (MAX)', () => {
    const h = hal();
    for (let i = 0; i < MAX_HAL_LISTENERS; i++) h.subscribe(() => { /* */ });
    h.subscribe(() => { /* */ });
    expect(h.listenerCount).toBe(MAX_HAL_LISTENERS);
  });

  it('22) unsubscribe (açık metod)', () => {
    const h = hal();
    let count = 0;
    const fn = () => { count++; };
    h.subscribe(fn);
    h.unsubscribe(fn);
    h.ingestSignal('vehicle.speed', { value: 54, source: 'can' });
    expect(count).toBe(0);
  });

  it('23) provider pull (refresh) fail-soft — bir provider throw etse diğerleri okunur', () => {
    const h = hal({ providers: {
      'vehicle.speed': () => { throw new Error('kaynak patladı'); },
      'vehicle.rpm': () => ({ value: 900, source: 'obd' }),
    } });
    expect(() => h.refresh()).not.toThrow();
    expect(h.getRPM()).toBe(900);
    expect(h.getSpeed()).toBeNull();
  });

  it('24) refresh idempotent', () => {
    const h = hal({ providers: { 'vehicle.speed': () => ({ value: 50, source: 'can' }) } });
    const a = h.refresh();
    const b = h.refresh();
    expect(h.getSpeed()).toBe(50);
    expect(typeof a.revision).toBe('number');
    expect(typeof b.revision).toBe('number');
  });

  it('25) reset — sinyaller supported=false\'e döner, identity temizlenir', () => {
    const h = hal();
    h.ingestSignal('vehicle.speed', { value: 54, source: 'can' });
    h.ingestIdentity({ fingerprintHash: 'a1b2c3d4e5f60718' });
    h.reset();
    expect(h.getSpeed()).toBeNull();
    expect(h.hasSignal('vehicle.speed')).toBe(false);
    expect(h.getVehicleIdentity().supported).toBe(false);
  });

  it('26) dispose zero-leak — listener temizlenir, sonrası no-op', () => {
    const h = hal();
    h.subscribe(() => { /* */ });
    h.ingestSignal('vehicle.speed', { value: 54, source: 'can' });
    h.dispose();
    expect(h.listenerCount).toBe(0);
    expect(h.isDisposed).toBe(true);
    expect(h.ingestSignal('vehicle.speed', { value: 60, source: 'can' })).toBeNull(); // no-op
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * Immutability / fail-soft / yalıtım
 * ════════════════════════════════════════════════════════════════════════ */

describe('immutability, fail-soft, yalıtım', () => {
  it('27) snapshot immutable (frozen, nested dahil)', () => {
    const h = hal();
    h.ingestSignal('vehicle.tpms', { value: [220, 225], source: 'can' });
    const snap = h.getSnapshot();
    expect(Object.isFrozen(snap)).toBe(true);
    expect(Object.isFrozen(snap.signals)).toBe(true);
    expect(snap.signals.every((s) => Object.isFrozen(s))).toBe(true);
    expect(() => { (snap.signals as unknown[]).push({}); }).toThrow();
  });

  it('28) getSignal çıktısı frozen', () => {
    const h = hal();
    h.ingestSignal('vehicle.speed', { value: 54, source: 'can' });
    expect(Object.isFrozen(h.getSignal('vehicle.speed'))).toBe(true);
  });

  it('29) girdi objesi mutate edilmiyor', () => {
    const h = hal();
    const input = { value: 54, source: 'can' as const };
    const before = { ...input };
    h.ingestSignal('vehicle.speed', input);
    expect(input).toEqual(before);
  });

  it('30) bounded — bilinmeyen sinyal id reddedilir (katalog dışı eklenemez)', () => {
    const h = hal();
    expect(h.ingestSignal('vehicle.warp_drive' as never, { value: 1, source: 'can' })).toBeNull();
    expect(h.getSnapshot().signals.length).toBe(VEHICLE_SIGNAL_IDS.length); // katalog sabit
  });

  it('31) public API fail-soft — bozuk girdi throw etmez', () => {
    const h = hal();
    expect(() => h.ingestSignal('vehicle.speed', null as never)).not.toThrow();
    expect(() => h.ingest(null as never)).not.toThrow();
    expect(() => h.ingestIdentity(null as never)).not.toThrow();
    expect(h.getSpeed()).toBeNull();
  });

  it('32) ingest toplu besleme', () => {
    const h = hal();
    h.ingest({
      'vehicle.speed': { value: 30, source: 'can' },
      'vehicle.rpm': { value: 1200, source: 'obd' },
    });
    expect(h.getSpeed()).toBe(30);
    expect(h.getRPM()).toBe(1200);
  });

  it('33) import yan etkisiz — timer/native/donanım probu YOK', () => {
    expect(/setInterval|setTimeout/.test(halSource)).toBe(false);
    expect(/\bnavigator\.|Capacitor|nativePlugin/.test(halSource)).toBe(false);
  });

  it('34) SystemBoot / UnifiedVehicleStore wiring yok', () => {
    expect(/from\s+['"][^'"]*SystemBoot['"]/.test(halSource)).toBe(false);
    expect(/^\s*import[\s{]/m.test(halSource)).toBe(false); // hiç import ifadesi yok (bağımsız foundation)
  });

  it('35) stale default eşiği makul', () => {
    expect(VEHICLE_HAL_STALE_MS_DEFAULT).toBeGreaterThan(0);
  });
});
