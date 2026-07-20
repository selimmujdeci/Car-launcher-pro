/**
 * aiCoreHalAdapter.test.ts — AI Core Faz-2 · HAL → Context saf eşleme.
 *
 * KİLİTLENEN SÖZLEŞME:
 *  1. "0 ≠ no-data": desteklenmeyen/sayı-olmayan → value null; gerçek 0 → valid.
 *  2. 'vehicle.' öneki soyulur (AI Usta anahtar eşleşmesi).
 *  3. deriveMinimalSections bağlantı olgusunu adapter'a yansıtır (sahte veri yok).
 *  4. fingerprint yalnız supported iken taşınır.
 */
import { describe, it, expect } from 'vitest';
import {
  halSignalToEnvelope, halSnapshotToContextInput, deriveMinimalSections, halIsConnected,
  stripSignalPrefix, type HalSignalLike, type HalSnapshotLike,
} from '../platform/aiCore/runtime/halAdapter';

function halSig(p: Partial<HalSignalLike>): HalSignalLike {
  return { id: 'vehicle.coolant_temp', value: 90, confidence: 1, source: 'can', timestamp: 1000, stale: false, unit: '°C', supported: true, ...p };
}
function snap(signals: HalSignalLike[]): HalSnapshotLike {
  return { revision: 1, updatedAt: 2000, signals };
}

describe('halSignalToEnvelope — "0 ≠ no-data"', () => {
  it('desteklenmeyen → unsupported, value null', () => {
    const e = halSignalToEnvelope(halSig({ supported: false, value: 90 }), 2000);
    expect(e.state).toBe('unsupported');
    expect(e.value).toBeNull();
    expect(e.confidence).toBe(0);
  });
  it('sayı değil → no_data', () => {
    const e = halSignalToEnvelope(halSig({ value: null }), 2000);
    expect(e.state).toBe('no_data');
    expect(e.value).toBeNull();
  });
  it('gerçek 0 → valid (kanıt)', () => {
    const e = halSignalToEnvelope(halSig({ id: 'vehicle.speed', value: 0, unit: 'km/h' }), 2000);
    expect(e.state).toBe('valid');
    expect(e.value).toBe(0);
  });
  it('stale bayrağı → stale + yaş hesaplanır', () => {
    const e = halSignalToEnvelope(halSig({ stale: true, timestamp: 1000 }), 6000);
    expect(e.state).toBe('stale');
    expect(e.ageMs).toBe(5000);
  });
  it('kaynak indirgeme: native → derived, obd → obd', () => {
    expect(halSignalToEnvelope(halSig({ source: 'native' }), 2000).source).toBe('derived');
    expect(halSignalToEnvelope(halSig({ source: 'obd' }), 2000).source).toBe('obd');
  });
});

describe('stripSignalPrefix', () => {
  it('vehicle. öneki soyulur', () => {
    expect(stripSignalPrefix('vehicle.coolant_temp')).toBe('coolant_temp');
    expect(stripSignalPrefix('vehicle.rpm')).toBe('rpm');
  });
});

describe('halIsConnected + deriveMinimalSections', () => {
  it('taze sayısal sinyal → connected/real', () => {
    const s = snap([halSig({ value: 95 })]);
    expect(halIsConnected(s)).toBe(true);
    expect(deriveMinimalSections(s).obdDeep!.adapter!.source).toBe('real');
  });
  it('hepsi stale/desteksiz → disconnected/none (verdict INCONCLUSIVE tetikler)', () => {
    const s = snap([halSig({ stale: true }), halSig({ id: 'vehicle.rpm', supported: false })]);
    expect(halIsConnected(s)).toBe(false);
    expect(deriveMinimalSections(s).obdDeep!.adapter!.source).toBe('none');
  });
});

describe('halSnapshotToContextInput', () => {
  it('sayısal sinyaller soyulmuş anahtarla; boolean/kontak ayrı; fingerprint supported iken', () => {
    const s = snap([
      halSig({ id: 'vehicle.coolant_temp', value: 108 }),
      halSig({ id: 'vehicle.ignition', value: true, unit: null }),
    ]);
    const ci = halSnapshotToContextInput(s, { fingerprintHash: 'a1b2c3d4e5f6a7b8', protocol: 'CAN', supported: true }, 2000, true);
    expect(Object.keys(ci.signals!)).toEqual(['coolant_temp']);   // boolean ignition sinyal değil
    expect(ci.ignitionOn).toBe(true);
    expect(ci.fingerprintHash).toBe('a1b2c3d4e5f6a7b8');
    expect(ci.connected).toBe(true);
    expect(ci.online).toBe(true);
  });

  it('identity supported değilse fingerprint null', () => {
    const ci = halSnapshotToContextInput(snap([halSig({})]), { fingerprintHash: 'a1b2c3d4e5f6a7b8', protocol: null, supported: false }, 2000, false);
    expect(ci.fingerprintHash).toBeNull();
  });
});
