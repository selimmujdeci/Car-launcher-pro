/**
 * Integration Test Fixtures — CockpitOS
 * 
 * Entegrasyon testleri için end-to-end scenario'lar.
 * Birden fazla servisi birleştiren iş akışlarını test eder.
 */

import type { OBDData } from '../platform/obdService';
import type { GPSLocation } from '../platform/vehicleDataLayer/types';
import { OBD_FIXTURES, GPS_FIXTURES, VEHICLE_FIXTURES, STORE_FIXTURES } from '../helpers';

export { STORE_FIXTURES };

/* ═══════════════════════════════════════════════════════════════════════════
   SCENARIO: OBD → GPS → UI State Flow
   ═══════════════════════════════════════════════════════════════════════════ */

export interface OBDToUIScenario {
  name: string;
  obdData: Partial<OBDData>;
  gpsData: Partial<GPSLocation>;
  expectedDriveMode: 'idle' | 'normal' | 'driving';
  expectedSpeedKmh: number;
}

export const OBD_TO_UI_SCENARIOS: OBDToUIScenario[] = [
  {
    name: 'Araç park halinde (idle)',
    obdData: { speed: 0, rpm: 700, fuelLevel: 60 },
    gpsData: { speed: 0 },
    expectedDriveMode: 'idle',
    expectedSpeedKmh: 0,
  },
  {
    name: 'Şehir içi sürüş (driving)',
    obdData: { speed: 45, rpm: 2000, fuelLevel: 55 },
    gpsData: { speed: 12.5 },
    expectedDriveMode: 'driving',
    expectedSpeedKmh: 45,
  },
  {
    name: 'Otoyol sürüşü (driving)',
    obdData: { speed: 120, rpm: 3000, fuelLevel: 40 },
    gpsData: { speed: 33.33 },
    expectedDriveMode: 'driving',
    expectedSpeedKmh: 120,
  },
  {
    name: 'Sınır değeri (normal → driving)',
    obdData: { speed: 20, rpm: 2200, fuelLevel: 50 },
    gpsData: { speed: 5.56 },
    expectedDriveMode: 'driving',
    expectedSpeedKmh: 20,
  },
];

/* ═══════════════════════════════════════════════════════════════════════════
   SCENARIO: Vehicle Profile Detection
   ═══════════════════════════════════════════════════════════════════════════ */

export interface VehicleProfileScenario {
  name: string;
  vin: string | null;
  obdData: Partial<OBDData>;
  expectedProfile: string;
}

export const VEHICLE_PROFILE_SCENARIOS: VehicleProfileScenario[] = [
  {
    name: 'Standart ICE araç tespiti',
    vin: 'WVWZZZ3CZWE123456',
    obdData: { speed: 60, rpm: 2500, fuelLevel: 65 },
    expectedProfile: 'standard-ice',
  },
  {
    name: 'EV araç tespiti (RPM yok)',
    vin: '1N4AZ1CP0LC345678',
    obdData: { speed: 70, rpm: -1, batteryLevel: 75 },
    expectedProfile: 'standard-ev',
  },
  {
    name: 'VIN yok — PID heuristic',
    vin: null,
    obdData: { speed: 50, rpm: 1800, fuelLevel: 60 },
    expectedProfile: 'standard-ice',
  },
];

/* ═══════════════════════════════════════════════════════════════════════════
   SCENARIO: Smart Engine Decision Making
   ═══════════════════════════════════════════════════════════════════════════ */

export interface SmartEngineScenario {
  name: string;
  hour: number;
  obdSpeed: number;
  recentUsage: Record<string, number>;
  expectedDockFirst: string;
  expectedRecommendationType: string | null;
}

export const SMART_ENGINE_SCENARIOS: SmartEngineScenario[] = [
  {
    name: 'Sabah işe gidiş (navigasyon öncelikli)',
    hour: 8,
    obdSpeed: 60,
    recentUsage: { maps: 10, waze: 5, spotify: 2 },
    expectedDockFirst: 'maps',
    expectedRecommendationType: 'app',
  },
  {
    name: 'Akşam ev dönüşü (müzik öncelikli)',
    hour: 19,
    obdSpeed: 45,
    recentUsage: { maps: 3, spotify: 15, youtube: 8 },
    expectedDockFirst: 'spotify',
    expectedRecommendationType: 'app',
  },
  {
    name: 'Gece (düşük kullanım)',
    hour: 23,
    obdSpeed: 0,
    recentUsage: { maps: 0, spotify: 0 },
    expectedDockFirst: 'maps', // default
    expectedRecommendationType: 'sleep-mode',
  },
];

/* ═══════════════════════════════════════════════════════════════════════════
   SCENARIO: Theme Switching Based on Conditions
   ═══════════════════════════════════════════════════════════════════════════ */

export interface ThemeSwitchScenario {
  name: string;
  hour: number;
  brightness: number;
  isDriving: boolean;
  expectedThemeStyle: 'glass' | 'neon' | 'minimal';
}

export const THEME_SWITCH_SCENARIOS: ThemeSwitchScenario[] = [
  {
    name: 'Gündüz (glass tema)',
    hour: 12,
    brightness: 80,
    isDriving: false,
    expectedThemeStyle: 'glass',
  },
  {
    name: 'Gece sürüş (minimal tema — güvenlik)',
    hour: 22,
    brightness: 30,
    isDriving: true,
    expectedThemeStyle: 'minimal',
  },
  {
    name: 'Gece park (glass tema)',
    hour: 23,
    brightness: 20,
    isDriving: false,
    expectedThemeStyle: 'glass',
  },
];

/* ═══════════════════════════════════════════════════════════════════════════
   SCENARIO: Safety Brain Feature Disable
   ═══════════════════════════════════════════════════════════════════════════ */

export interface SafetyBrainScenario {
  name: string;
  faultCount: number;
  expectedFeatureDisabled: boolean;
}

export const SAFETY_BRAIN_SCENARIOS: SafetyBrainScenario[] = [
  {
    name: '2 hata (devre dışı değil)',
    faultCount: 2,
    expectedFeatureDisabled: false,
  },
  {
    name: '3 hata (devre dışı)',
    faultCount: 3,
    expectedFeatureDisabled: true,
  },
  {
    name: '5 hata (devre dışı)',
    faultCount: 5,
    expectedFeatureDisabled: true,
  },
];

/* ═══════════════════════════════════════════════════════════════════════════
   SCENARIO: Runtime Mode Transitions
   ═══════════════════════════════════════════════════════════════════════════ */

export interface RuntimeModeScenario {
  name: string;
  initialMode: string;
  trigger: 'thermal' | 'memory' | 'failure' | 'user';
  expectedMode: string;
}

export const RUNTIME_MODE_SCENARIOS: RuntimeModeScenario[] = [
  {
    name: 'Termal yükselme → downgrade',
    initialMode: 'PERFORMANCE',
    trigger: 'thermal',
    expectedMode: 'BALANCED',
  },
  {
    name: 'Bellek baskısı → power save',
    initialMode: 'BALANCED',
    trigger: 'memory',
    expectedMode: 'POWER_SAVE',
  },
  {
    name: 'OBD bağlantı hatası → safe mode',
    initialMode: 'BALANCED',
    trigger: 'failure',
    expectedMode: 'SAFE_MODE',
  },
  {
    name: 'Kullanıcı zorlaması → performance',
    initialMode: 'BALANCED',
    trigger: 'user',
    expectedMode: 'PERFORMANCE',
  },
];

/* ═══════════════════════════════════════════════════════════════════════════
   SCENARIO: Adaptive Runtime Manager Hysteresis
   ═══════════════════════════════════════════════════════════════════════════ */

export interface HysteresisScenario {
  name: string;
  currentMode: string;
  requestedMode: string;
  shouldTransition: boolean;
  reason: string;
}

export const HYSTERESIS_SCENARIOS: HysteresisScenario[] = [
  {
    name: 'Downgrade — anlık geçiş',
    currentMode: 'PERFORMANCE',
    requestedMode: 'BALANCED',
    shouldTransition: true,
    reason: 'Downgrade her zaman anlık',
  },
  {
    name: 'Upgrade — 30s bekleme',
    currentMode: 'BALANCED',
    requestedMode: 'PERFORMANCE',
    shouldTransition: false,
    reason: 'Upgrade 30s gecikme gerektirir',
  },
  {
    name: 'Aynı mod — no-op',
    currentMode: 'BALANCED',
    requestedMode: 'BALANCED',
    shouldTransition: false,
    reason: 'Aynı mod zaten aktif',
  },
];

/* ═══════════════════════════════════════════════════════════════════════════
   SCENARIO: Fuel Computation
   ═══════════════════════════════════════════════════════════════════════════ */

export interface FuelComputationScenario {
  name: string;
  fuelPercent: number;
  tankLiters: number;
  avgConsumptionL100: number;
  expectedFuelRemaining: number;
  expectedEstimatedRange: number;
}

export const FUEL_COMPUTATION_SCENARIOS: FuelComputationScenario[] = [
  {
    name: 'Yarım depo (%50)',
    fuelPercent: 50,
    tankLiters: 50,
    avgConsumptionL100: 8,
    expectedFuelRemaining: 25,
    expectedEstimatedRange: 312,
  },
  {
    name: 'Çeyrek depo (%25)',
    fuelPercent: 25,
    tankLiters: 50,
    avgConsumptionL100: 8,
    expectedFuelRemaining: 12.5,
    expectedEstimatedRange: 156,
  },
  {
    name: 'Tam depo (%100)',
    fuelPercent: 100,
    tankLiters: 60,
    avgConsumptionL100: 7,
    expectedFuelRemaining: 60,
    expectedEstimatedRange: 857,
  },
  {
    name: 'Düşük yakıt uyarısı (%10)',
    fuelPercent: 10,
    tankLiters: 50,
    avgConsumptionL100: 9,
    expectedFuelRemaining: 5,
    expectedEstimatedRange: 55,
  },
];

/* ═══════════════════════════════════════════════════════════════════════════
   SCENARIO: Geofence Detection
   ═══════════════════════════════════════════════════════════════════════════ */

export interface GeofenceScenario {
  name: string;
  currentLat: number;
  currentLng: number;
  zoneLat: number;
  zoneLng: number;
  zoneRadiusMeters: number;
  shouldAlert: boolean;
}

export const GEOFENCE_SCENARIOS: GeofenceScenario[] = [
  {
    name: 'Merkez içinde',
    currentLat: 41.0082,
    currentLng: 28.9784,
    zoneLat: 41.0082,
    zoneLng: 28.9784,
    zoneRadiusMeters: 1000,
    shouldAlert: true,
  },
  {
    name: 'Merkez dışında (yaklaşık)',
    currentLat: 41.0200,
    currentLng: 28.9900,
    zoneLat: 41.0082,
    zoneLng: 28.9784,
    zoneRadiusMeters: 1000,
    shouldAlert: false,
  },
  {
    name: 'Sınırda (histerezis)',
    currentLat: 41.0170,
    currentLng: 28.9850,
    zoneLat: 41.0082,
    zoneLng: 28.9784,
    zoneRadiusMeters: 1000,
    shouldAlert: false, // histerezis nedeniyle
  },
];

/* ═══════════════════════════════════════════════════════════════════════════
   SCENARIO: OBD Connection State Machine
   ═══════════════════════════════════════════════════════════════════════════ */

export interface OBDConnectionScenario {
  name: string;
  mockDevices: Array<{ name: string; address: string }>;
  shouldConnect: boolean;
  expectedState: string;
}

export const OBD_CONNECTION_SCENARIOS: OBDConnectionScenario[] = [
  {
    name: 'Cihaz bulundu → bağlan',
    mockDevices: [{ name: 'OBDII Scanner', address: '00:11:22:33:44:55' }],
    shouldConnect: true,
    expectedState: 'connecting',
  },
  {
    name: 'Cihaz yok → hata',
    mockDevices: [],
    shouldConnect: false,
    expectedState: 'error',
  },
];

/* ═══════════════════════════════════════════════════════════════════════════
   HELPER: Scenario Runner
   ═══════════════════════════════════════════════════════════════════════════ */

/** Integration test için scenario çalıştırıcı */
export function runScenario<T extends Record<string, unknown>>(
  scenario: T,
  callback: (key: keyof T, value: T[keyof T]) => void
): void {
  (Object.keys(scenario) as Array<keyof T>).forEach((key) => {
    callback(key, scenario[key]);
  });
}