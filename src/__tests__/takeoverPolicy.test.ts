/**
 * takeoverPolicy.test.ts — Faz-3 · MAVI3-3 TAKEOVER politikası sözleşmesi.
 *
 * KİLİTLENEN SÖZLEŞME:
 *  1. Varsayılan SHADOW → hiçbir eylem takeover edilmez (mevcut davranış birebir).
 *  2. TAKEOVER + allowlist → yalnız media.next takeover.
 *  3. media.next DIŞINDAKİ eylemler eligible DEĞİL — config verse bile elenir.
 *  4. Araç/ECU eylemleri (vehicle. · ecu · coding · actuator · adaptation · dtc) ASLA eligible değil.
 *  5. isEligible mod'dan bağımsız savunma derinliği sorgusudur.
 */
import { describe, it, expect } from 'vitest';
import { createTakeoverPolicy, TAKEOVER_ELIGIBLE } from '../platform/maviCore/wiring/takeoverPolicy';

describe('createTakeoverPolicy — varsayılan SHADOW', () => {
  it('config yok → shadow, hiçbir şey takeover edilmez', () => {
    const p = createTakeoverPolicy();
    expect(p.mode).toBe('shadow');
    expect(p.shouldTakeover('media.next')).toBe(false);
  });

  it('mode geçersiz/eksik → shadow', () => {
    expect(createTakeoverPolicy({ mode: 'xyz' as never }).mode).toBe('shadow');
  });
});

describe('createTakeoverPolicy — TAKEOVER', () => {
  it('takeover + varsayılan allowlist → yalnız media.next', () => {
    const p = createTakeoverPolicy({ mode: 'takeover' });
    expect(p.mode).toBe('takeover');
    expect(p.shouldTakeover('media.next')).toBe(true);
    expect(p.shouldTakeover('media.play')).toBe(false);
    expect(p.shouldTakeover('ui.theme.set')).toBe(false);
  });

  it('media.next dışı allowlist verilse bile elenir (kesişim)', () => {
    const p = createTakeoverPolicy({ mode: 'takeover', allowlist: ['media.next', 'ui.theme.set', 'media.play'] });
    expect(p.allowlist.has('media.next')).toBe(true);
    expect(p.allowlist.has('ui.theme.set')).toBe(false);
    expect(p.allowlist.size).toBe(1);
  });

  it('araç/ECU eylemleri ASLA takeover edilemez (allowlist\'e verilse bile)', () => {
    const p = createTakeoverPolicy({
      mode: 'takeover',
      allowlist: ['vehicle.health.read', 'ecu.write', 'coding.set', 'actuator.trigger', 'dtc.clear', 'media.next'],
    });
    expect(p.shouldTakeover('vehicle.health.read')).toBe(false);
    expect(p.shouldTakeover('ecu.write')).toBe(false);
    expect(p.shouldTakeover('coding.set')).toBe(false);
    expect(p.shouldTakeover('actuator.trigger')).toBe(false);
    expect(p.shouldTakeover('dtc.clear')).toBe(false);
    expect(p.shouldTakeover('media.next')).toBe(true); // yalnız bu geçer
  });
});

describe('createTakeoverPolicy — isEligible (savunma derinliği)', () => {
  it('isEligible mod\'dan bağımsız yalnız media.next için true', () => {
    const shadow = createTakeoverPolicy();
    expect(shadow.isEligible('media.next')).toBe(true);   // eligible ama shouldTakeover false (shadow)
    expect(shadow.shouldTakeover('media.next')).toBe(false);
    expect(shadow.isEligible('vehicle.health.read')).toBe(false);
    expect(shadow.isEligible('ui.theme.set')).toBe(false);
  });

  it('TAKEOVER_ELIGIBLE yalnız media.next içerir (Faz-3 anayasal)', () => {
    expect([...TAKEOVER_ELIGIBLE]).toEqual(['media.next']);
  });
});
