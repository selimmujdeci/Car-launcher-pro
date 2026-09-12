/**
 * guardianObdServiceSource.test.ts — GUARDIAN-AI-G15.
 *
 * `createObdServiceSource` — G12 `ObdSource` sözleşmesinin ilk GERÇEK (concrete)
 * implementasyonu: OBD servisinin sağlık snapshot'ından `RawVehicleHealthData`
 * üretir. SAF/DI/fail-soft; obdService'i (import-time side-effect + WIP) TOP-LEVEL
 * import ETMEZ — küçük port + DI. YALNIZ `coolantTemperatureC` + `batteryVoltage`
 * güvenilir (OBDData'da diğer 4 sinyal YOK). SENTINEL `-1` gerçek veri gibi
 * taşınMAZ. read() PULL/snapshot; timer/listener YOK.
 *
 * Concrete binding (`createObdServiceHealthPort`) obdService'i import eder →
 * yalnız `vi.mock`lu izole testte dokunulur (pure factory testleri obdService'i
 * hiç import etmez → import-time side-effect yok).
 */
import { describe, it, expect, vi } from 'vitest';
import {
  createObdServiceSource,
} from '../platform/navigation/guardian/providers/concrete/obdServiceSource';
import type {
  ObdHealthPort,
  ObdHealthSnapshot,
} from '../platform/navigation/guardian/providers/concrete/obdServiceSource';
import type { VehicleHealthPolicyInput } from '../platform/navigation/guardian/rules';
import { buildGuardianRawPlatformData } from '../platform/navigation/guardian/providers/guardianProviderRegistry';
import { buildGuardianRegistryInput } from '../platform/navigation/guardian/adapters/guardianAdapterRegistry';
import { buildGuardianRuleResults } from '../platform/navigation/guardian/guardianRuleRegistry';
import { runGuardian } from '../platform/navigation/guardian/guardianEngine';

/* ── Fixture ──────────────────────────────────────────────────────────────── */

const VH_POLICY: VehicleHealthPolicyInput = {
  thresholds: {
    coolant:        { high: 100, critical: 115 },
    oilPressure:    { low: 100, critical: 50 },
    batteryVoltage: { low: 12, critical: 11 },
  },
  booleanSeverities: { brakeWarning: 'HIGH', engineWarningLamp: 'LOW', transmissionWarning: 'HIGH' },
};

function portOf(snap: ObdHealthSnapshot | undefined): ObdHealthPort {
  return { getLatestHealth: () => snap };
}
function throwingPort(): ObdHealthPort {
  return { getLatestHealth: () => { throw new Error('OBD servisi patladı'); } };
}
function source(snap: ObdHealthSnapshot | undefined, policy: VehicleHealthPolicyInput = VH_POLICY) {
  return createObdServiceSource({ port: portOf(snap), policy });
}

/* ── Sözleşme ─────────────────────────────────────────────────────────────── */

describe('createObdServiceSource — ObdSource sözleşmesi', () => {
  it('read fonksiyonu olan bir ObdSource döndürür', () => {
    expect(typeof source({ engineTempC: 90 }).read).toBe('function');
  });
});

/* ── Sağlık sinyali eşleme (yalnız coolant + battery) ──────────────────────── */

describe('createObdServiceSource — coolant + battery eşleme', () => {
  it('engineTempC → coolantTemperatureC', () => {
    expect(source({ engineTempC: 95 }).read()).toEqual({ coolantTemperatureC: 95, policy: VH_POLICY });
  });
  it('batteryVoltageV → batteryVoltage', () => {
    expect(source({ batteryVoltageV: 12.4 }).read()).toEqual({ batteryVoltage: 12.4, policy: VH_POLICY });
  });
  it('ikisi birden', () => {
    expect(source({ engineTempC: 118, batteryVoltageV: 11.5 }).read()).toEqual({
      coolantTemperatureC: 118, batteryVoltage: 11.5, policy: VH_POLICY,
    });
  });
  it('0°C coolant GEÇERLİ (sentinel değil)', () => {
    expect(source({ engineTempC: 0 }).read()).toEqual({ coolantTemperatureC: 0, policy: VH_POLICY });
  });
  it('policy her zaman çıktıya eklenir', () => {
    expect(source({ engineTempC: 90 }).read()!.policy).toBe(VH_POLICY);
  });
});

/* ── SENTINEL güvenliği (-1 gerçek veri değildir) ──────────────────────────── */

describe('createObdServiceSource — sentinel (-1) güvenliği', () => {
  it('engineTempC === -1 (desteklenmiyor) → coolant DROP', () => {
    expect(source({ engineTempC: -1, batteryVoltageV: 12.4 }).read()).toEqual({ batteryVoltage: 12.4, policy: VH_POLICY });
  });
  it('batteryVoltageV === -1 → battery DROP', () => {
    expect(source({ engineTempC: 90, batteryVoltageV: -1 }).read()).toEqual({ coolantTemperatureC: 90, policy: VH_POLICY });
  });
  it('her iki sinyal de -1 → undefined (kullanılabilir veri yok)', () => {
    expect(source({ engineTempC: -1, batteryVoltageV: -1 }).read()).toBeUndefined();
  });
});

/* ── Geçersiz / eksik değerler ─────────────────────────────────────────────── */

describe('createObdServiceSource — geçersiz/eksik', () => {
  it('NaN coolant → DROP', () => {
    expect(source({ engineTempC: NaN, batteryVoltageV: 12.4 }).read()).toEqual({ batteryVoltage: 12.4, policy: VH_POLICY });
  });
  it('Infinity battery → DROP', () => {
    expect(source({ engineTempC: 90, batteryVoltageV: Infinity }).read()).toEqual({ coolantTemperatureC: 90, policy: VH_POLICY });
  });
  it('hiç sinyal yok (boş snapshot) → undefined', () => {
    expect(source({}).read()).toBeUndefined();
  });
  it('snapshot undefined (OBD bağlı değil) → undefined', () => {
    expect(source(undefined).read()).toBeUndefined();
  });
  it('snapshot nesne değil → undefined', () => {
    const s = createObdServiceSource({ port: { getLatestHealth: () => 42 as unknown as ObdHealthSnapshot }, policy: VH_POLICY });
    expect(s.read()).toBeUndefined();
  });
  it('port throw ederse → undefined (throw ETMEZ)', () => {
    const s = createObdServiceSource({ port: throwingPort(), policy: VH_POLICY });
    expect(() => s.read()).not.toThrow();
    expect(s.read()).toBeUndefined();
  });
});

/* ── Bilinçli undefined bırakılan 4 sinyal ─────────────────────────────────── */

describe('createObdServiceSource — desteklenmeyen sinyaller HER ZAMAN undefined', () => {
  it('oilPressureKpa / brakeWarning / engineWarningLamp / transmissionWarning çıktıda YOK', () => {
    const out = source({ engineTempC: 118, batteryVoltageV: 11.5 }).read()!;
    expect(out.oilPressureKpa).toBeUndefined();
    expect(out.brakeWarning).toBeUndefined();
    expect(out.engineWarningLamp).toBeUndefined();
    expect(out.transmissionWarning).toBeUndefined();
    expect(Object.keys(out).sort()).toEqual(['batteryVoltage', 'coolantTemperatureC', 'policy']);
  });
});

/* ── Factory validation (wiring hatası → throw) ────────────────────────────── */

describe('createObdServiceSource — wiring validation', () => {
  it('port eksik → THROW', () => {
    expect(() => createObdServiceSource({ port: undefined as unknown as ObdHealthPort, policy: VH_POLICY })).toThrow();
  });
  it('policy eksik → THROW', () => {
    expect(() => createObdServiceSource({ port: portOf({ engineTempC: 90 }), policy: undefined as unknown as VehicleHealthPolicyInput })).toThrow();
  });
});

/* ── Immutable / deterministic / zero-leak ─────────────────────────────────── */

describe('createObdServiceSource — immutable / deterministic / zero-leak', () => {
  it('snapshot mutasyona uğratılmaz (donmuş girdi)', () => {
    const snap = Object.freeze({ engineTempC: 90, batteryVoltageV: 12.4 });
    const s = createObdServiceSource({ port: portOf(snap), policy: VH_POLICY });
    expect(() => s.read()).not.toThrow();
    expect(snap).toEqual({ engineTempC: 90, batteryVoltageV: 12.4 });
  });
  it('output HER read\'de yeni nesnedir', () => {
    const s = source({ engineTempC: 90 });
    const a = s.read(); const b = s.read();
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });
  it('aynı snapshot + policy → aynı çıktı', () => {
    expect(source({ engineTempC: 90, batteryVoltageV: 12.4 }).read())
      .toEqual(source({ engineTempC: 90, batteryVoltageV: 12.4 }).read());
  });
  it('factory port\'u OKUMAZ (lazy) + timer/interval OLUŞTURMAZ (import-time side-effect yok)', () => {
    const spy = vi.fn(() => ({ engineTempC: 90 }));
    vi.useFakeTimers();
    try {
      const s = createObdServiceSource({ port: { getLatestHealth: spy }, policy: VH_POLICY });
      expect(spy).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
      s.read();
      expect(spy).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

/* ── Provider / adapter / pipeline entegrasyonu ────────────────────────────── */

describe('createObdServiceSource — pipeline entegrasyonu', () => {
  it('buildGuardianRawPlatformData\'ya ObdSource olarak takılır', () => {
    const obd = source({ engineTempC: 120, batteryVoltageV: 11.5 });
    const raw = buildGuardianRawPlatformData({ obd });
    expect(raw.vehicleHealth).toBeDefined();
    expect(raw.vehicleHealth!.coolantTemperatureC).toBe(120);
    expect(raw.vehicleHealth!.batteryVoltage).toBe(11.5);
  });

  it('uçtan uca: coolant 120 → runGuardian VEHICLE_HEALTH_RISK CRITICAL', () => {
    const obd = source({ engineTempC: 120 }); // >= critical 115 → CRITICAL
    const output = runGuardian({
      ruleResults: buildGuardianRuleResults(buildGuardianRegistryInput(buildGuardianRawPlatformData({ obd }))),
    });
    const ev = output.riskEvents.find((e) => e.type === 'VEHICLE_HEALTH_RISK');
    expect(ev).toBeDefined();
    expect(ev!.severity).toBe('CRITICAL');
    expect(ev!.id).toBe('vehicle-health:coolant');
  });

  it('OBD bağlı değil (undefined) → vehicleHealth bölümü düşer, diğer kaynaklar sürer', () => {
    const obd = source(undefined);
    const raw = buildGuardianRawPlatformData({ obd });
    expect(raw.vehicleHealth).toBeUndefined();
  });

  it('OBD throw etse bile pipeline throw ETMEZ', () => {
    const obd = createObdServiceSource({ port: throwingPort(), policy: VH_POLICY });
    expect(() => runGuardian({
      ruleResults: buildGuardianRuleResults(buildGuardianRegistryInput(buildGuardianRawPlatformData({ obd }))),
    })).not.toThrow();
  });
});

/* ── Concrete binding (createObdServiceHealthPort) — obdService vi.mock ile ─── */

vi.mock('../platform/obdService', () => ({
  getOBDDataSnapshot: vi.fn(() => ({ engineTemp: 88, batteryVoltage: 12.6 })),
}));

describe('createObdServiceHealthPort — gerçek obdService snapshot eşlemesi (mock)', () => {
  it('OBDData.engineTemp/batteryVoltage → snapshot; source → RawVehicleHealthData', async () => {
    const { createObdServiceHealthPort } = await import('../platform/navigation/guardian/providers/concrete/obdServiceHealthPort');
    const port = createObdServiceHealthPort();
    const snap = port.getLatestHealth();
    expect(snap).toEqual({ engineTempC: 88, batteryVoltageV: 12.6 });
    expect(createObdServiceSource({ port, policy: VH_POLICY }).read()).toEqual({
      coolantTemperatureC: 88, batteryVoltage: 12.6, policy: VH_POLICY,
    });
  });
});
