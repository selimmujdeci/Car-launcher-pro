/**
 * guardianGpsServiceSource.test.ts — GUARDIAN-AI-G14.
 *
 * `createGpsServiceSource` — G12 `GpsSource` sözleşmesinin ilk GERÇEK (concrete)
 * implementasyonu: mevcut GPS servisinin konum snapshot'ını (m/s hız) okuyup
 * `RawGpsData{currentSpeedKph?}` üretir. SAF/DI/fail-soft; gerçek Android/GPS
 * servisini TOP-LEVEL import ETMEZ (küçük port + DI clock). read() PULL/snapshot;
 * timer/listener YOK. Birim `speedUnit` ile AÇIKÇA doğrulanır (heuristic YOK).
 */
import { describe, it, expect, vi } from 'vitest';
import {
  createGpsServiceSource,
  createUnifiedStoreGpsLocationPort,
} from '../platform/navigation/guardian/providers/concrete/gpsServiceSource';
import type {
  GpsLocationPort,
  GpsLocationSnapshot,
  GpsSourcePolicy,
  GpsClock,
} from '../platform/navigation/guardian/providers/concrete/gpsServiceSource';
import { buildGuardianRawPlatformData } from '../platform/navigation/guardian/providers/guardianProviderRegistry';
import type { MapSource } from '../platform/navigation/guardian/providers/mapSource';
import { buildGuardianRegistryInput } from '../platform/navigation/guardian/adapters/guardianAdapterRegistry';
import { buildGuardianRuleResults } from '../platform/navigation/guardian/guardianRuleRegistry';
import { runGuardian } from '../platform/navigation/guardian/guardianEngine';
import { useUnifiedVehicleStore } from '../platform/vehicleDataLayer/UnifiedVehicleStore';

/* ── Yardımcı: sabit snapshot döndüren port ───────────────────────────────── */

function portOf(snapshot: GpsLocationSnapshot | undefined): GpsLocationPort {
  return { getLatestLocation: () => snapshot };
}
function throwingPort(): GpsLocationPort {
  return { getLatestLocation: () => { throw new Error('gps servisi patladı'); } };
}
function source(snapshot: GpsLocationSnapshot | undefined, policy?: GpsSourcePolicy, clock?: GpsClock) {
  return createGpsServiceSource({ port: portOf(snapshot), policy, clock });
}

/* ── 1: Sözleşme ───────────────────────────────────────────────────────────── */

describe('createGpsServiceSource — GpsSource sözleşmesi', () => {
  it('read fonksiyonu olan bir GpsSource döndürür', () => {
    const s = source({ speed: 10, speedUnit: 'mps' });
    expect(typeof s.read).toBe('function');
  });
});

/* ── 2-9: Hız birimi + dönüşüm + geçersizlik ───────────────────────────────── */

describe('createGpsServiceSource — hız birimi / dönüşüm / geçersizlik', () => {
  it('km/h kaynağı AYNEN taşır (tekrar dönüştürmez)', () => {
    expect(source({ speed: 72, speedUnit: 'kph' }).read()).toEqual({ currentSpeedKph: 72 });
  });
  it('m/s kaynağı 3.6 ile km/h\'ye çevirir', () => {
    expect(source({ speed: 10, speedUnit: 'mps' }).read()).toEqual({ currentSpeedKph: 36 });
  });
  it('0 hız GEÇERLİDİR → currentSpeedKph 0', () => {
    expect(source({ speed: 0, speedUnit: 'mps' }).read()).toEqual({ currentSpeedKph: 0 });
  });
  it('negatif hız → undefined', () => {
    expect(source({ speed: -1, speedUnit: 'mps' }).read()).toBeUndefined();
  });
  it('NaN hız → undefined', () => {
    expect(source({ speed: NaN, speedUnit: 'mps' }).read()).toBeUndefined();
  });
  it('Infinity hız → undefined', () => {
    expect(source({ speed: Infinity, speedUnit: 'mps' }).read()).toBeUndefined();
  });
  it('hız eksik → undefined', () => {
    expect(source({ speedUnit: 'mps' }).read()).toBeUndefined();
  });
  it('bilinmeyen/eksik birim → undefined (tahmin YOK)', () => {
    expect(source({ speed: 30, speedUnit: 'mph' as never }).read()).toBeUndefined();
    expect(source({ speed: 30 }).read()).toBeUndefined();
  });
});

/* ── 10-12: Servis yok / throw / permission ────────────────────────────────── */

describe('createGpsServiceSource — servis fail-soft', () => {
  it('servis snapshot undefined → undefined', () => {
    expect(source(undefined).read()).toBeUndefined();
  });
  it('servis throw ederse → undefined (throw ETMEZ)', () => {
    const s = createGpsServiceSource({ port: throwingPort() });
    expect(() => s.read()).not.toThrow();
    expect(s.read()).toBeUndefined();
  });
  it('permission-denied benzeri (servis boş okuma) → undefined', () => {
    // İzin reddinde servis konum vermez → snapshot undefined döner.
    expect(source(undefined).read()).toBeUndefined();
  });
  it('snapshot nesne değil (bozuk) → undefined', () => {
    const s = createGpsServiceSource({ port: { getLatestLocation: () => 42 as unknown as GpsLocationSnapshot } });
    expect(s.read()).toBeUndefined();
  });
});

/* ── 13-14: Stale veri (DI clock + policy) ─────────────────────────────────── */

describe('createGpsServiceSource — stale veri (DI clock, policy.maxLocationAgeMs)', () => {
  const policy: GpsSourcePolicy = { maxLocationAgeMs: 1000 };
  const clock = (nowMs: number): GpsClock => ({ nowMs: () => nowMs });

  it('yaş > maxLocationAgeMs → undefined (eski veri "canlı" sunulmaz)', () => {
    const s = source({ speed: 10, speedUnit: 'mps', timestampMs: 8000 }, policy, clock(10000)); // yaş 2000
    expect(s.read()).toBeUndefined();
  });
  it('yaş == maxLocationAgeMs (sınır) → KABUL', () => {
    const s = source({ speed: 10, speedUnit: 'mps', timestampMs: 9000 }, policy, clock(10000)); // yaş 1000
    expect(s.read()).toEqual({ currentSpeedKph: 36 });
  });
  it('taze veri (yaş < max) → kabul', () => {
    const s = source({ speed: 10, speedUnit: 'mps', timestampMs: 9800 }, policy, clock(10000)); // yaş 200
    expect(s.read()).toEqual({ currentSpeedKph: 36 });
  });
  it('gelecek zaman damgası (negatif yaş) → undefined (saat kayması)', () => {
    const s = source({ speed: 10, speedUnit: 'mps', timestampMs: 11000 }, policy, clock(10000));
    expect(s.read()).toBeUndefined();
  });
  it('stale gate açık ama timestamp yok → undefined (tazelik doğrulanamaz)', () => {
    const s = source({ speed: 10, speedUnit: 'mps' }, policy, clock(10000));
    expect(s.read()).toBeUndefined();
  });
  it('stale gate açık ama clock yok → undefined (fail-soft)', () => {
    const s = source({ speed: 10, speedUnit: 'mps', timestampMs: 9800 }, policy);
    expect(s.read()).toBeUndefined();
  });
  it('policy.maxLocationAgeMs YOK → stale gate uygulanmaz (timestamp gerekmez)', () => {
    expect(source({ speed: 10, speedUnit: 'mps' }).read()).toEqual({ currentSpeedKph: 36 });
  });
});

/* ── 15-16: Accuracy gate ──────────────────────────────────────────────────── */

describe('createGpsServiceSource — accuracy gate (policy.maxAccuracyMeters)', () => {
  const policy: GpsSourcePolicy = { maxAccuracyMeters: 50 };
  it('accuracy <= max → geçer', () => {
    expect(source({ speed: 10, speedUnit: 'mps', accuracyMeters: 20 }, policy).read()).toEqual({ currentSpeedKph: 36 });
  });
  it('accuracy > max → undefined', () => {
    expect(source({ speed: 10, speedUnit: 'mps', accuracyMeters: 100 }, policy).read()).toBeUndefined();
  });
  it('accuracy gate açık ama accuracy alanı yok → undefined', () => {
    expect(source({ speed: 10, speedUnit: 'mps' }, policy).read()).toBeUndefined();
  });
});

/* ── 17-19: Immutable / yeni nesne / deterministic ─────────────────────────── */

describe('createGpsServiceSource — immutable / deterministic', () => {
  it('snapshot mutasyona uğratılmaz (donmuş girdiyle çalışır)', () => {
    const snap = Object.freeze({ speed: 10, speedUnit: 'mps' as const });
    const s = createGpsServiceSource({ port: portOf(snap) });
    expect(() => s.read()).not.toThrow();
    expect(s.read()).toEqual({ currentSpeedKph: 36 });
    expect(snap).toEqual({ speed: 10, speedUnit: 'mps' });
  });
  it('output HER read\'de yeni nesnedir', () => {
    const s = source({ speed: 10, speedUnit: 'mps' });
    const a = s.read();
    const b = s.read();
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });
  it('aynı snapshot + aynı clock → aynı çıktı', () => {
    const s1 = source({ speed: 10, speedUnit: 'mps', timestampMs: 9800 }, { maxLocationAgeMs: 1000 }, { nowMs: () => 10000 });
    const s2 = source({ speed: 10, speedUnit: 'mps', timestampMs: 9800 }, { maxLocationAgeMs: 1000 }, { nowMs: () => 10000 });
    expect(s1.read()).toEqual(s2.read());
  });
});

/* ── 20-21: Import-time yan etki / timer-listener yok ──────────────────────── */

describe('createGpsServiceSource — yan etki yok', () => {
  it('factory çağrısı port\'u OKUMAZ (lazy — yalnız read() okur)', () => {
    const spy = vi.fn(() => ({ speed: 10, speedUnit: 'mps' as const }));
    const s = createGpsServiceSource({ port: { getLatestLocation: spy } });
    expect(spy).not.toHaveBeenCalled(); // oluşturma sırasında okuma YOK
    s.read();
    expect(spy).toHaveBeenCalledTimes(1);
  });
  it('factory + read timer/interval OLUŞTURMAZ', () => {
    vi.useFakeTimers();
    try {
      const s = source({ speed: 10, speedUnit: 'mps' });
      s.read();
      s.read();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

/* ── Factory validation (wiring/programlama hatası → throw) ─────────────────── */

describe('createGpsServiceSource — wiring validation', () => {
  it('port eksik → THROW (wiring hatası)', () => {
    expect(() => createGpsServiceSource({ port: undefined as unknown as GpsLocationPort })).toThrow();
  });
  it('geçersiz policy.maxLocationAgeMs (negatif) → THROW', () => {
    expect(() => createGpsServiceSource({ port: portOf({ speed: 10, speedUnit: 'mps' }), policy: { maxLocationAgeMs: -1 } })).toThrow();
  });
});

/* ── Concrete store binding (createUnifiedStoreGpsLocationPort) ─────────────── */

describe('createUnifiedStoreGpsLocationPort — gerçek store bağlaması', () => {
  it('store location.speed (m/s) → snapshot{speed, speedUnit:mps, ...}', () => {
    useUnifiedVehicleStore.setState({
      location: { latitude: 41, longitude: 29, accuracy: 12, speed: 20, timestamp: 12345 },
    } as never);
    const port = createUnifiedStoreGpsLocationPort();
    const snap = port.getLatestLocation();
    expect(snap).toBeDefined();
    expect(snap!.speed).toBe(20);
    expect(snap!.speedUnit).toBe('mps');
    expect(snap!.accuracyMeters).toBe(12);
    expect(snap!.timestampMs).toBe(12345);
    // uçtan uca: bu port ile source → 20 m/s = 72 km/h
    expect(createGpsServiceSource({ port }).read()).toEqual({ currentSpeedKph: 72 });
  });
  it('store location null → snapshot undefined → source undefined', () => {
    useUnifiedVehicleStore.setState({ location: null } as never);
    const port = createUnifiedStoreGpsLocationPort();
    expect(port.getLatestLocation()).toBeUndefined();
    expect(createGpsServiceSource({ port }).read()).toBeUndefined();
  });
});

/* ── 22-29: Provider/Adapter/Pipeline entegrasyonu ─────────────────────────── */

const CURVE_POLICY = { warningLeadTimeSeconds: 8, minimumWarningDistanceMeters: 50, overspeedToleranceKph: 2 };
const SPEED_POLICY = { warningLeadTimeSeconds: 8, minimumWarningDistanceMeters: 50, overspeedToleranceKph: 2 };
const ROAD_POLICY = { warningLeadTimeSeconds: 8, minimumWarningDistanceMeters: 50 };
const GRADE_THRESHOLDS = { low: 8, medium: 12, high: 16, critical: 20 };
const HAZARD_POLICY = { severityByHazard: { accident: 'HIGH' } } as const;

function mapNoSpeed(): ReturnType<MapSource['read']> {
  return {
    curve: { id: 'curve-1', distanceMeters: 100, direction: 'left', advisorySpeedKph: 60, confidence: 0.8, policy: CURVE_POLICY },
    speedLimit: { id: 'seg-1', distanceMeters: 100, postedSpeedLimitKph: 80, confidence: 0.8, policy: SPEED_POLICY },
    roadProfile: { id: 'downhill-1', distanceMeters: 40, downhillGradePercent: 14, confidence: 0.8, policy: ROAD_POLICY, gradeThresholds: GRADE_THRESHOLDS },
    roadHazard: { id: 'hz-1', hazardType: 'accident', distanceMeters: 400, confidence: 0.8, policy: HAZARD_POLICY },
  };
}

describe('createGpsServiceSource — provider/adapter/pipeline entegrasyonu', () => {
  it('buildGuardianRawPlatformData\'ya GpsSource olarak takılır', () => {
    const gps = source({ speed: 25, speedUnit: 'mps' }); // 90 km/h
    const raw = buildGuardianRawPlatformData({ gps, map: { read: () => mapNoSpeed() } });
    expect(raw.curve!.currentSpeedKph).toBe(90);    // curve enjeksiyonu
    expect(raw.speedLimit!.currentSpeedKph).toBe(90); // speed-limit enjeksiyonu
    expect(raw.roadProfile!.currentSpeedKph).toBe(90); // road-profile enjeksiyonu
  });

  it('map dilimi kendi hızını taşıyorsa GPS EZMEZ', () => {
    const gps = source({ speed: 25, speedUnit: 'mps' }); // 90
    const mapWithSpeed: MapSource = {
      read: () => ({ curve: { id: 'c', distanceMeters: 100, direction: 'left', advisorySpeedKph: 60, confidence: 0.8, currentSpeedKph: 40, policy: CURVE_POLICY } }),
    };
    const raw = buildGuardianRawPlatformData({ gps, map: mapWithSpeed });
    expect(raw.curve!.currentSpeedKph).toBe(40);
  });

  it('adapter registry: raw → GuardianRuleRegistryInput (curve/speed/roadProfile geçerli)', () => {
    const gps = source({ speed: 25, speedUnit: 'mps' });
    const registryInput = buildGuardianRegistryInput(buildGuardianRawPlatformData({ gps, map: { read: () => mapNoSpeed() } }));
    expect(registryInput.curve).toBeDefined();
    expect(registryInput.curve!.vehicle.currentSpeedKph).toBe(90);
  });

  it('uçtan uca: GPS source → runGuardian curve CRITICAL üretir (90 vs advisory 60)', () => {
    const gps = source({ speed: 25, speedUnit: 'mps' }); // 90 km/h
    const output = runGuardian({
      ruleResults: buildGuardianRuleResults(buildGuardianRegistryInput(buildGuardianRawPlatformData({ gps, map: { read: () => mapNoSpeed() } }))),
    });
    const curveEv = output.riskEvents.find((e) => e.type === 'CURVE_RISK');
    expect(curveEv).toBeDefined();
    expect(curveEv!.severity).toBe('CRITICAL');
  });

  it('GPS source düşerse (undefined) curve/speed/roadProfile düşer ama roadHazard kalır', () => {
    const gps = source(undefined); // GPS yok
    const output = runGuardian({
      ruleResults: buildGuardianRuleResults(buildGuardianRegistryInput(buildGuardianRawPlatformData({ gps, map: { read: () => mapNoSpeed() } }))),
    });
    const types = output.riskEvents.map((e) => e.type);
    expect(types).not.toContain('CURVE_RISK');
    expect(types).not.toContain('SPEED_LIMIT_RISK');
    expect(types).toContain('ROAD_HAZARD'); // hız gerektirmez → kalır
  });

  it('GPS source throw etse bile pipeline throw ETMEZ', () => {
    const gps = createGpsServiceSource({ port: throwingPort() });
    expect(() => runGuardian({
      ruleResults: buildGuardianRuleResults(buildGuardianRegistryInput(buildGuardianRawPlatformData({ gps, map: { read: () => mapNoSpeed() } }))),
    })).not.toThrow();
  });
});
