/**
 * guardianProviderRegistry.test.ts — GUARDIAN-AI-G12 (Provider Source Contracts).
 *
 * Provider'lar raw platform verisini SAĞLAR (G11 adapter'larının ÜSTÜNDE).
 * GERÇEK IO YOK — kaynaklar DI interface'i (Android/GPS/OBD/HTTP YOK). Provider
 * registry kaynakları `GuardianRawPlatformData`ya BİRLEŞTİRİR (GPS hızını map
 * kaynaklı curve/speed/roadProfile dilimlerine enjekte eder). FAIL-SOFT: bir
 * kaynak throw eder / bozuk çıktı verirse yalnız kendi bölümü undefined; diğerleri
 * çalışır. Kapsam: her provider · registry · eksik/bozuk provider · immutable ·
 * deterministic · uçtan uca Provider→Adapter→RuleRegistry→Engine.
 */
import { describe, it, expect } from 'vitest';
import { buildGuardianRawPlatformData } from '../platform/navigation/guardian/providers/guardianProviderRegistry';
import type { GuardianProviderSources } from '../platform/navigation/guardian/providers/guardianProviderRegistry';
import type { GpsSource, RawGpsData } from '../platform/navigation/guardian/providers/gpsSource';
import type { MapSource, RawMapData } from '../platform/navigation/guardian/providers/mapSource';
import type { ObdSource } from '../platform/navigation/guardian/providers/obdSource';
import type { WeatherSource } from '../platform/navigation/guardian/providers/weatherSource';
import type { DriverSource } from '../platform/navigation/guardian/providers/driverSource';
import { buildGuardianRegistryInput } from '../platform/navigation/guardian/adapters/guardianAdapterRegistry';
import { buildGuardianRuleResults } from '../platform/navigation/guardian/guardianRuleRegistry';
import { runGuardian } from '../platform/navigation/guardian/guardianEngine';

/* ── Politika sabitleri ────────────────────────────────────────────────────── */

const CURVE_POLICY = { warningLeadTimeSeconds: 8, minimumWarningDistanceMeters: 50, overspeedToleranceKph: 2 };
const SPEED_POLICY = { warningLeadTimeSeconds: 8, minimumWarningDistanceMeters: 50, overspeedToleranceKph: 2 };
const ROAD_POLICY = { warningLeadTimeSeconds: 8, minimumWarningDistanceMeters: 50 };
const GRADE_THRESHOLDS = { low: 8, medium: 12, high: 16, critical: 20 };
const WEATHER_POLICY = { severityByCondition: { dry: 'NONE', wet: 'LOW', snow: 'HIGH', ice: 'CRITICAL' } } as const;
const VH_POLICY = {
  thresholds: { coolant: { high: 100, critical: 115 }, oilPressure: { low: 100, critical: 50 }, batteryVoltage: { low: 12, critical: 11 } },
  booleanSeverities: { brakeWarning: 'HIGH', engineWarningLamp: 'LOW', transmissionWarning: 'HIGH' },
} as const;
const HAZARD_POLICY = { severityByHazard: { accident: 'HIGH' } } as const;
const FATIGUE_POLICY = {
  thresholds: {
    continuousDriving: { elevatedMinutes: 90, highMinutes: 120, criticalMinutes: 180 },
    breakAge: { elevatedMinutes: 120, highMinutes: 180, criticalMinutes: 240 },
    tripDuration: { elevatedMinutes: 180, highMinutes: 300, criticalMinutes: 420 },
  },
  nightDriving: { startHour: 22, endHour: 6, severity: 'MEDIUM' },
  booleanSeverities: { lowAttentionSignal: 'MEDIUM', repeatedLaneCorrectionSignal: 'HIGH', microsleepSuspectedSignal: 'CRITICAL' },
  minimumConfidence: 0.3,
} as const;
const CAMERA_POLICY = { severityByCameraType: { average_speed: 'HIGH' }, minimumConfidence: 0.3 } as const;

/* ── Mock kaynak verileri (map dilimlerinde currentSpeedKph YOK — GPS'ten gelir) ─ */

function gpsData(): RawGpsData { return { currentSpeedKph: 90 }; }
function mapData(): RawMapData {
  return {
    curve: { id: 'curve-1', distanceMeters: 100, direction: 'left', advisorySpeedKph: 60, confidence: 0.8, policy: CURVE_POLICY },
    speedLimit: { id: 'seg-1', distanceMeters: 100, postedSpeedLimitKph: 80, confidence: 0.8, policy: SPEED_POLICY }, // GPS 90 → +10 aşım (LOW)
    roadProfile: { id: 'downhill-1', distanceMeters: 40, downhillGradePercent: 14, confidence: 0.8, policy: ROAD_POLICY, gradeThresholds: GRADE_THRESHOLDS },
    roadHazard: { id: 'hz-1', hazardType: 'accident', distanceMeters: 400, confidence: 0.8, policy: HAZARD_POLICY },
    speedCamera: { id: 'cam-1', cameraType: 'average_speed', distanceMeters: 500, confidence: 0.8, policy: CAMERA_POLICY },
  };
}
const obdData = { batteryVoltage: 11.5, policy: VH_POLICY };
const weatherData = { surfaceCondition: 'wet' as const, source: 'osm', confidence: 0.8, policy: WEATHER_POLICY };
const driverData = { microsleepSuspectedSignal: true, confidence: 0.8, policy: FATIGUE_POLICY };

function allSources(): GuardianProviderSources {
  return {
    gps: { read: () => gpsData() },
    map: { read: () => mapData() },
    obd: { read: () => obdData },
    weather: { read: () => weatherData },
    driver: { read: () => driverData },
  };
}

/* ── Tek kaynaklar + composition ───────────────────────────────────────────── */

describe('buildGuardianRawPlatformData — kaynaklar → GuardianRawPlatformData', () => {
  it('GPS hızı map curve/speed/roadProfile dilimlerine enjekte edilir', () => {
    const out = buildGuardianRawPlatformData(allSources());
    expect(out.curve!.currentSpeedKph).toBe(90);
    expect(out.speedLimit!.currentSpeedKph).toBe(90);
    expect(out.roadProfile!.currentSpeedKph).toBe(90);
  });

  it('OBD → vehicleHealth bölümü', () => {
    const out = buildGuardianRawPlatformData({ obd: { read: () => obdData } });
    expect(out.vehicleHealth).toBeDefined();
    expect(out.vehicleHealth!.batteryVoltage).toBe(11.5);
  });

  it('Weather → weather bölümü', () => {
    const out = buildGuardianRawPlatformData({ weather: { read: () => weatherData } });
    expect(out.weather!.surfaceCondition).toBe('wet');
  });

  it('Driver → driverFatigue bölümü', () => {
    const out = buildGuardianRawPlatformData({ driver: { read: () => driverData } });
    expect(out.driverFatigue!.microsleepSuspectedSignal).toBe(true);
  });

  it('Map → roadHazard/speedCamera doğrudan (hız enjeksiyonu gerekmez)', () => {
    const out = buildGuardianRawPlatformData({ map: { read: () => mapData() } });
    expect(out.roadHazard!.id).toBe('hz-1');
    expect(out.speedCamera!.id).toBe('cam-1');
  });

  it('tam kaynak → 8 bölüm', () => {
    const out = buildGuardianRawPlatformData(allSources());
    expect(Object.keys(out).sort()).toEqual([
      'curve', 'driverFatigue', 'roadHazard', 'roadProfile', 'speedCamera', 'speedLimit', 'vehicleHealth', 'weather',
    ]);
  });

  it('map dilimi kendi currentSpeedKph\'ini taşıyorsa GPS onu EZMEZ', () => {
    const mapWithSpeed: MapSource = {
      read: () => ({ curve: { id: 'c', distanceMeters: 100, direction: 'left', advisorySpeedKph: 60, confidence: 0.8, currentSpeedKph: 40, policy: CURVE_POLICY } }),
    };
    const out = buildGuardianRawPlatformData({ gps: { read: () => ({ currentSpeedKph: 90 }) }, map: mapWithSpeed });
    expect(out.curve!.currentSpeedKph).toBe(40); // map'inki korunur
  });
});

/* ── Eksik provider (fail-soft) ────────────────────────────────────────────── */

describe('buildGuardianRawPlatformData — eksik provider', () => {
  it('GPS yok → curve/speed/roadProfile hız enjekte edilemez (currentSpeedKph undefined)', () => {
    const out = buildGuardianRawPlatformData({ map: { read: () => mapData() } });
    expect(out.curve!.currentSpeedKph).toBeUndefined();
    // ama roadHazard/speedCamera hâlâ üretilir (hız gerektirmez)
    expect(out.roadHazard).toBeDefined();
  });

  it('boş sources {} → {}', () => {
    expect(buildGuardianRawPlatformData({})).toEqual({});
  });

  it('undefined sources → {} (throw yok)', () => {
    expect(buildGuardianRawPlatformData(undefined)).toEqual({});
  });

  it('eksik provider diğerlerini ETKİLEMEZ', () => {
    const out = buildGuardianRawPlatformData({ obd: { read: () => obdData }, weather: { read: () => weatherData } });
    expect(Object.keys(out).sort()).toEqual(['vehicleHealth', 'weather']);
  });
});

/* ── Bozuk provider (fail-soft — throw YOK) ────────────────────────────────── */

describe('buildGuardianRawPlatformData — bozuk provider', () => {
  it('bir provider throw ederse yalnız kendi bölümü düşer, kalan çalışır', () => {
    const boomGps: GpsSource = { read: () => { throw new Error('gps patladı'); } };
    const out = buildGuardianRawPlatformData({ gps: boomGps, map: { read: () => mapData() }, obd: { read: () => obdData } });
    expect(out.vehicleHealth).toBeDefined();       // OBD etkilenmedi
    expect(out.roadHazard).toBeDefined();          // map (hızsız bölümler) etkilenmedi
    expect(out.curve!.currentSpeedKph).toBeUndefined(); // GPS düştü → hız yok
  });

  it('provider bozuk çıktı (nesne değil) verirse → o bölüm undefined', () => {
    const badMap: MapSource = { read: () => 42 as unknown as RawMapData };
    const out = buildGuardianRawPlatformData({ map: badMap, obd: { read: () => obdData } });
    expect(out.curve).toBeUndefined();
    expect(out.roadHazard).toBeUndefined();
    expect(out.vehicleHealth).toBeDefined();
  });

  it('read fonksiyonu olmayan source → o bölüm undefined (throw yok)', () => {
    const out = buildGuardianRawPlatformData({ obd: {} as unknown as ObdSource, weather: { read: () => weatherData } });
    expect(out.vehicleHealth).toBeUndefined();
    expect(out.weather).toBeDefined();
  });

  it('tüm provider throw etse bile registry throw ETMEZ → {}', () => {
    const boom = <T>(): { read: () => T } => ({ read: () => { throw new Error('x'); } });
    const out = buildGuardianRawPlatformData({ gps: boom(), map: boom(), obd: boom(), weather: boom(), driver: boom() });
    expect(out).toEqual({});
  });
});

/* ── Immutable + deterministic ─────────────────────────────────────────────── */

describe('buildGuardianRawPlatformData — immutable / deterministic', () => {
  it('kaynak çıktıları mutasyona uğratılmaz', () => {
    const md = mapData();
    const snapshot = JSON.parse(JSON.stringify(md));
    buildGuardianRawPlatformData({ gps: { read: () => gpsData() }, map: { read: () => md } });
    expect(md).toEqual(snapshot);
  });

  it('donmuş kaynak çıktısı ile çalışır (curve dilimi kopyalanır, dondurulmuşu ezmez)', () => {
    const frozenMap = Object.freeze(mapData());
    Object.freeze(frozenMap.curve);
    const out = buildGuardianRawPlatformData({ gps: { read: () => ({ currentSpeedKph: 90 }) }, map: { read: () => frozenMap } });
    expect(out.curve!.currentSpeedKph).toBe(90);
    expect(frozenMap.curve!.currentSpeedKph).toBeUndefined(); // orijinal donmuş dilim değişmedi
  });

  it('aynı kaynaklar → aynı çıktı', () => {
    const s = allSources();
    expect(buildGuardianRawPlatformData(s)).toEqual(buildGuardianRawPlatformData(s));
  });
});

/* ── Uçtan uca: Provider → Adapter → Rule Registry → Engine ────────────────── */

describe('uçtan uca pipeline', () => {
  it('providers → raw → adapter registry → rule registry → 8 RuleResult', () => {
    const raw = buildGuardianRawPlatformData(allSources());
    const registryInput = buildGuardianRegistryInput(raw);
    const results = buildGuardianRuleResults(registryInput);
    expect(results.map((r) => r.ruleId)).toEqual([
      'curve-risk', 'speed-limit', 'road-profile', 'weather', 'vehicle-health', 'road-hazard', 'driver-fatigue', 'speed-camera',
    ]);
  });

  it('providers → runGuardian → 8 event, highestSeverity CRITICAL', () => {
    const output = runGuardian({
      ruleResults: buildGuardianRuleResults(buildGuardianRegistryInput(buildGuardianRawPlatformData(allSources()))),
    });
    expect(output.riskEvents).toHaveLength(8);
    expect(output.highestSeverity).toBe('CRITICAL');
  });

  it('GPS düşerse curve/speed/roadProfile pipeline\'dan düşer ama kalan 5 kural üretir', () => {
    const output = runGuardian({
      ruleResults: buildGuardianRuleResults(buildGuardianRegistryInput(buildGuardianRawPlatformData({
        map: { read: () => mapData() }, obd: { read: () => obdData }, weather: { read: () => weatherData }, driver: { read: () => driverData },
      }))),
    });
    // GPS yok → curve/speed/roadProfile adapter undefined; weather+vehicleHealth+roadHazard+driverFatigue+speedCamera kalır
    const types = output.riskEvents.map((e) => e.type).sort();
    expect(types).toEqual(['DRIVER_FATIGUE_RISK', 'ROAD_HAZARD', 'SPEED_CAMERA_WARNING', 'VEHICLE_HEALTH_RISK', 'WEATHER_RISK']);
  });

  it('tüm provider bozuk → boş, throw yok', () => {
    const output = runGuardian({
      ruleResults: buildGuardianRuleResults(buildGuardianRegistryInput(buildGuardianRawPlatformData(undefined))),
    });
    expect(output.riskEvents).toEqual([]);
    expect(output.overallRiskScore).toBe(0);
  });
});
