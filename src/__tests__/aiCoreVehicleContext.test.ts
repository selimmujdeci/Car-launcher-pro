/**
 * aiCoreVehicleContext.test.ts — AI Core Faz-1 · Vehicle Context (birleştirilmiş read-model).
 *
 * KİLİTLENEN SÖZLEŞME:
 *  1. no-data/unsupported sinyal bağlama GİRMEZ (bağlam yalan söylemez).
 *  2. Ham VIN (17 karakter) fingerprintHash olarak REDDEDİLİR (gizlilik).
 *  3. capabilitySummary status'a göre doğru kovaya ayrışır.
 *  4. deriveContextEvidence sinyal+DTC+kimlik+degraded'i kanıta çevirir (sahte kanıt yok).
 */
import { describe, it, expect } from 'vitest';
import { assembleVehicleContext, deriveContextEvidence } from '../platform/aiCore/vehicleContext';
import type { SignalEnvelope } from '../platform/obd/signalEnvelope';

function sig(partial: Partial<SignalEnvelope>): SignalEnvelope {
  return { value: 90, state: 'valid', confidence: 1, source: 'obd', updatedAt: 1000, ageMs: 0, unit: '°C', ...partial };
}

describe('assembleVehicleContext', () => {
  it('no-data sinyal bağlama girmez, geçerli sinyal girer', () => {
    const ctx = assembleVehicleContext({
      now: 5000,
      signals: {
        coolant_temp: sig({ value: 104 }),
        oil_pressure: sig({ value: null, state: 'no_data' }),
        speed: sig({ value: 0, state: 'valid', unit: 'km/h' }), // gerçek sıfır girer
      },
    });
    expect(Object.keys(ctx.signals).sort()).toEqual(['coolant_temp', 'speed']);
    expect(ctx.hasSignals).toBe(true);
  });

  it('ham VIN fingerprintHash olarak reddedilir, anonim hash kabul edilir', () => {
    expect(assembleVehicleContext({ fingerprintHash: 'WVWZZZ1JZXW000001' }).fingerprintHash).toBeNull();
    expect(assembleVehicleContext({ fingerprintHash: 'a1b2c3d4e5f6a7b8' }).fingerprintHash).toBe('a1b2c3d4e5f6a7b8');
  });

  it('capabilitySummary status kovalarına ayrışır', () => {
    const ctx = assembleVehicleContext({
      capabilities: [
        { id: 'vehicle.obd', status: 'available' },
        { id: 'vehicle.vin_read', status: 'degraded' },
        { id: 'vehicle.coding', status: 'unsupported' },
        { id: 'ai.cloud', status: 'unknown' },
      ],
    });
    expect(ctx.capabilitySummary.available).toEqual(['vehicle.obd']);
    expect(ctx.capabilitySummary.degraded).toEqual(['vehicle.vin_read']);
    expect(ctx.capabilitySummary.unavailable).toEqual(['vehicle.coding']);
    expect(ctx.capabilitySummary.unknown).toEqual(['ai.cloud']);
  });

  it('ignitionOn tri-state (null=bilinmiyor) + boş bağlam hasSignals=false', () => {
    expect(assembleVehicleContext({}).ignitionOn).toBeNull();
    expect(assembleVehicleContext({ ignitionOn: false }).ignitionOn).toBe(false);
    expect(assembleVehicleContext({}).hasSignals).toBe(false);
  });

  it('immutable (frozen)', () => {
    const ctx = assembleVehicleContext({ signals: { x: sig({}) } });
    expect(Object.isFrozen(ctx)).toBe(true);
    expect(Object.isFrozen(ctx.signals)).toBe(true);
  });
});

describe('deriveContextEvidence', () => {
  it('sinyal + DTC + kimlik + degraded → kanıt', () => {
    const ctx = assembleVehicleContext({
      fingerprintHash: 'a1b2c3d4e5f6a7b8',
      signals: { coolant_temp: sig({ value: 108 }) },
      capabilities: [{ id: 'vehicle.vin_read', status: 'degraded' }],
      diagnosticSections: { obdDeep: { dtc: { count: 1, codes: [{ code: 'P0128', severity: 'warning' }] } } },
    });
    const ev = deriveContextEvidence(ctx, 7000);
    const keys = ev.map((e) => e.key).sort();
    expect(keys).toContain('signal.coolant_temp');
    expect(keys).toContain('dtc.P0128');
    expect(keys).toContain('fingerprint.identity');
    expect(keys).toContain('capability.vehicle.vin_read');
  });

  it('boş bağlam → kanıt yok (sahte kanıt üretilmez)', () => {
    expect(deriveContextEvidence(assembleVehicleContext({}), 1000)).toEqual([]);
  });
});
