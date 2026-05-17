/**
 * Test Helpers — CockpitOS Unit Test Utilities
 * 
 * Paylaşılan mock'lar, fixture'lar ve helper fonksiyonlar.
 * Tüm test dosyaları bu modülü import ederek ortak altyapıyı kullanır.
 */

import { vi } from 'vitest';

/* ═══════════════════════════════════════════════════════════════════════════
   CAPACITOR MOCKS
   ═══════════════════════════════════════════════════════════════════════════ */

/** Web (browser) mod mock — native plugin çağrıları yapılmaz */
export function createCapacitorWebMock() {
  return {
    Capacitor: {
      isNativePlatform: vi.fn(() => false),
      getPlatform: vi.fn(() => 'web'),
      getPlugin: vi.fn(() => undefined),
    },
  };
}

/** Android mod mock — native plugin çağrıları yapılır */
export function createCapacitorAndroidMock() {
  return {
    Capacitor: {
      isNativePlatform: vi.fn(() => true),
      getPlatform: vi.fn(() => 'android'),
      getPlugin: vi.fn(() => ({})),
    },
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   CAR LAUNCHER MOCK
   ═══════════════════════════════════════════════════════════════════════════ */

export interface CarLauncherMockOptions {
  scanDevices?: Array<{ name: string; address: string }>;
  connectDelay?: number;
  shouldFail?: boolean;
}

export function createCarLauncherMock(opts: CarLauncherMockOptions = {}) {
  const {
    scanDevices = [],
    connectDelay = 100,
    shouldFail = false,
  } = opts;

  return {
    CarLauncher: {
      scanOBD: vi.fn().mockResolvedValue({ devices: scanDevices }),
      connectOBD: vi.fn().mockImplementation(() =>
        new Promise((resolve, reject) => {
          setTimeout(() => {
            if (shouldFail) reject(new Error('Connection failed'));
            else resolve({});
          }, connectDelay);
        })
      ),
      disconnectOBD: vi.fn().mockResolvedValue(undefined),
      addListener: vi.fn().mockResolvedValue({ remove: vi.fn() }),
      removeListener: vi.fn().mockResolvedValue(undefined),
      startBackgroundService: vi.fn().mockResolvedValue(undefined),
      stopBackgroundService: vi.fn().mockResolvedValue(undefined),
      // Optional methods
      performHandshake: vi.fn().mockResolvedValue({ raw09: '', raw0100: '' }),
      lockDoors: vi.fn().mockResolvedValue(undefined),
      unlockDoors: vi.fn().mockResolvedValue(undefined),
      honkHorn: vi.fn().mockResolvedValue(undefined),
      flashLights: vi.fn().mockResolvedValue(undefined),
      triggerAlarm: vi.fn().mockResolvedValue(undefined),
      stopAlarm: vi.fn().mockResolvedValue(undefined),
      callNumber: vi.fn().mockResolvedValue(undefined),
      launchApp: vi.fn().mockResolvedValue(undefined),
    },
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   OBD DATA FIXTURES
   ═══════════════════════════════════════════════════════════════════════════ */

export const OBD_FIXTURES = {
  /** ICE araç (benzin) — tipik değerler */
  ice: {
    speed: 60,
    rpm: 2500,
    engineTemp: 90,
    fuelLevel: 65,
    throttle: 25,
    intakeTemp: 25,
    boostPressure: -1,
    egt: -1,
    batteryLevel: -1,
    batteryTemp: -1,
    range: -1,
    chargingState: 'not_charging' as const,
    chargingPower: -1,
    motorPower: -1,
    headlights: false,
    doors: { fl: false, fr: false, rl: false, rr: false, trunk: false },
    tpms: { fl: 235, fr: 233, rl: 230, rr: 232 },
    batteryVoltage: 13.8,
  },

  /** Dizel araç */
  diesel: {
    speed: 55,
    rpm: 1800,
    engineTemp: 85,
    fuelLevel: 70,
    throttle: 20,
    intakeTemp: 20,
    boostPressure: 120,
    egt: 450,
    batteryLevel: -1,
    batteryTemp: -1,
    range: -1,
    chargingState: 'not_charging' as const,
    chargingPower: -1,
    motorPower: -1,
    headlights: false,
    doors: { fl: false, fr: false, rl: false, rr: false, trunk: false },
    tpms: { fl: 240, fr: 238, rl: 236, rr: 237 },
    batteryVoltage: 13.9,
  },

  /** Elektrikli araç */
  ev: {
    speed: 70,
    rpm: -1,
    engineTemp: -1,
    fuelLevel: -1,
    throttle: 30,
    intakeTemp: -1,
    boostPressure: -1,
    egt: -1,
    batteryLevel: 75,
    batteryTemp: 28,
    range: 320,
    chargingState: 'not_charging' as const,
    chargingPower: -1,
    motorPower: 45,
    headlights: false,
    doors: { fl: false, fr: false, rl: false, rr: false, trunk: false },
    tpms: { fl: 240, fr: 238, rl: 236, rr: 237 },
    batteryVoltage: 13.8,
  },

  /** Hibrit araç */
  hybrid: {
    speed: 45,
    rpm: 1200,
    engineTemp: 80,
    fuelLevel: 55,
    throttle: 15,
    intakeTemp: 22,
    boostPressure: -1,
    egt: -1,
    batteryLevel: 60,
    batteryTemp: 30,
    range: 180,
    chargingState: 'not_charging' as const,
    chargingPower: -1,
    motorPower: 25,
    headlights: false,
    doors: { fl: false, fr: false, rl: false, rr: false, trunk: false },
    tpms: { fl: 233, fr: 231, rl: 228, rr: 230 },
    batteryVoltage: 13.7,
  },

  /** Sınır değerleri — hız eşiği */
  speedThresholds: {
    idle: 0,
    normalMin: 1,
    normalMax: 19,
    drivingMin: 20,
    drivingMax: 300,
  },

  /** Sınır değerleri — RPM eşiği */
  rpmThresholds: {
    idle: 0,
    normalMin: 650,
    normalMax: 7000,
    maxJump: 5000, // bir poll cycle'da max 5000 RPM değişim
  },
} as const;

/* ═══════════════════════════════════════════════════════════════════════════
   GPS DATA FIXTURES
   ═══════════════════════════════════════════════════════════════════════════ */

export const GPS_FIXTURES = {
  /** İstanbul, Türkiye */
  istanbul: {
    latitude: 41.0082,
    longitude: 28.9784,
    accuracy: 5.0,
    speed: 0,
    heading: 0,
    altitude: 50,
    timestamp: Date.now(),
  },

  /** Hareket halinde (70 km/s) */
  moving: {
    latitude: 41.0100,
    longitude: 28.9800,
    accuracy: 3.5,
    speed: 19.44, // m/s → 70 km/h
    heading: 90,
    altitude: 45,
    timestamp: Date.now(),
  },

  /** Otoyol (120 km/s) */
  highway: {
    latitude: 41.0150,
    longitude: 29.0000,
    accuracy: 2.0,
    speed: 33.33, // m/s → 120 km/h
    heading: 180,
    altitude: 100,
    timestamp: Date.now(),
  },
} as const;

/* ═══════════════════════════════════════════════════════════════════════════
   VEHICLE STATE FIXTURES
   ═══════════════════════════════════════════════════════════════════════════ */

export const VEHICLE_FIXTURES = {
  /** Standart ICE profil */
  standardIce: {
    id: 'standard-ice',
    name: 'Standart Benzin',
    vehicleType: 'ice' as const,
    fuelTankL: 50,
    engineCapacityL: 2.0,
    motorPowerKw: 110,
    vehicleMassKg: 1500,
    maxSpeedKmh: 200,
    maxRpm: 7000,
    avgConsumptionL100: 8.0,
    idleRpm: 700,
    normalTemp: 90,
    oilType: 'synthetic' as const,
  },

  /** Standart EV profil */
  standardEv: {
    id: 'standard-ev',
    name: 'Standart Elektrik',
    vehicleType: 'ev' as const,
    batteryCapacityKwh: 60,
    motorPowerKw: 150,
    vehicleMassKg: 1800,
    maxSpeedKmh: 180,
    avgConsumptionL100: 18, // kWh/100km
  },

  /** Hibrit profil */
  standardHybrid: {
    id: 'standard-hybrid',
    name: 'Standart Hibrit',
    vehicleType: 'hybrid' as const,
    fuelTankL: 45,
    batteryCapacityKwh: 13,
    motorPowerKw: 100,
    vehicleMassKg: 1650,
    maxSpeedKmh: 190,
    maxRpm: 6000,
    avgConsumptionL100: 5.5,
    idleRpm: 800,
    normalTemp: 85,
  },
} as const;

/* ═══════════════════════════════════════════════════════════════════════════
   STORE FIXTURES (Zustand)
   ═══════════════════════════════════════════════════════════════════════════ */

export const STORE_FIXTURES = {
  defaultSettings: {
    language: 'tr',
    unitSystem: 'metric',
    brightness: 100,
    volume: 60,
    volumeStyle: 'minimal_pro' as const,
    theme: 'dark' as const,
    themePack: 'tesla' as const,
    themeStyle: 'glass' as const,
    widgetStyle: 'elevated' as const,
    wallpaper: 'none',
    hiddenApps: [],
    appOrder: [],
    folders: {},
    use24Hour: true,
    showSeconds: false,
    clockStyle: 'digital' as const,
    gridColumns: 3,
    defaultNav: 'maps' as const,
    defaultMusic: 'spotify' as const,
    sleepMode: false,
    offlineMap: true,
    widgetVisible: { nav: true, media: true, shortcuts: true, obd: true },
    widgetOrder: ['nav', 'speed', 'media'],
    widgetSizes: { media: 'medium', shortcuts: 'small' },
    activeMapSourceId: null,
    hasCompletedSetup: false,
    performanceMode: false,
    maintenance: {
      lastOilChangeKm: 0,
      nextOilChangeKm: 10000,
      lastServiceDate: new Date().toISOString().split('T')[0],
      fuelConsumptionAvg: 8.5,
      inspectionDate: '',
      insuranceExpiry: '',
      kaskoExpiry: '',
    },
    tpms: {
      fl: { pressure: 32, temp: 24, status: 'normal' as const },
      fr: { pressure: 32, temp: 24, status: 'normal' as const },
      rl: { pressure: 31, temp: 25, status: 'normal' as const },
      rr: { pressure: 31, temp: 25, status: 'normal' as const },
    },
    parkingLocation: null,
    wakeWordEnabled: false,
    wakeWord: 'hey car',
    breakReminderEnabled: false,
    breakReminderIntervalMin: 120,
    autoBrightnessEnabled: true,
    autoThemeEnabled: true,
    autoBrightnessMin: 15,
    autoBrightnessMax: 100,
    gestureVolumeSide: 'left' as const,
    homeLocation: null,
    workLocation: null,
    recentDestinations: [],
    smartContextEnabled: true,
    pinnedCards: [],
    dayNightMode: 'day' as const,
    editMode: false,
    obdAutoSleep: false,
    obdSleepDelayMin: 5,
    weatherFallbackCity: null,
    vehicleProfiles: [],
    activeVehicleProfileId: null,
    autoNavOnStart: false,
    activeMediaSourceKey: 'spotify',
    musicFavorites: [],
    aiVoiceProvider: 'gemini' as const,
    geminiApiKey: '',
    claudeHaikuApiKey: '',
    hotspotMode: 'ask' as const,
    runtimeOverride: 'AUTO' as const,
  },
} as const;

/* ═══════════════════════════════════════════════════════════════════════════
   PERFORMANCE MODE FIXTURES
   ═══════════════════════════════════════════════════════════════════════════ */

export const PERFORMANCE_FIXTURES = {
  /** Balanced mod (varsayılan) */
  balanced: {
    obdPollInterval: 3000,
    obdListenerDebounce: 100,
    gpsUpdateMs: 1000,
    uiFpsTarget: 60,
    enableBlur: true,
    enableAnimations: true,
    enableRecommendations: true,
    recCooldownMs: 30_000,
  },

  /** Performans modu (güçlü cihaz) */
  performance: {
    obdPollInterval: 2000,
    obdListenerDebounce: 50,
    gpsUpdateMs: 500,
    uiFpsTarget: 120,
    enableBlur: true,
    enableAnimations: true,
    enableRecommendations: true,
    recCooldownMs: 15_000,
  },

  /** Pil tasarrufu modu */
  powerSave: {
    obdPollInterval: 5000,
    obdListenerDebounce: 200,
    gpsUpdateMs: 3000,
    uiFpsTarget: 30,
    enableBlur: false,
    enableAnimations: false,
    enableRecommendations: false,
    recCooldownMs: 60_000,
  },

  /** Güvenli mod (crash sonrası) */
  safeMode: {
    obdPollInterval: 10000,
    obdListenerDebounce: 500,
    gpsUpdateMs: 10000,
    uiFpsTarget: 15,
    enableBlur: false,
    enableAnimations: false,
    enableRecommendations: false,
    recCooldownMs: 0,
  },
} as const;

/* ═══════════════════════════════════════════════════════════════════════════
   HELPER FUNCTIONS
   ═══════════════════════════════════════════════════════════════════════════ */

/** localStorage temizle (tüm testlerden önce çağrılmalı) */
export function clearAllStorage(): void {
  localStorage.clear();
  sessionStorage.clear();
}

/** Belirli key'leri temizle */
export function clearStorageKeys(...keys: string[]): void {
  keys.forEach((key) => localStorage.removeItem(key));
}

/** localStorage'a veri yaz */
export function setStorageItem(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value));
}

/** localStorage'dan veri oku */
export function getStorageItem<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

/** Belirli bir süre bekle (async test helper) */
export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Mock tarih/saat ayarla */
export function mockDate(year: number, month: number, day: number, hour = 0): void {
  const date = new Date(year, month - 1, day, hour);
  vi.useFakeTimers();
  vi.setSystemTime(date);
}

/** Mock tarihi sıfırla */
export function resetMockDate(): void {
  vi.useRealTimers();
}

/** Benzersiz ID oluştur (test için) */
export function createTestId(prefix = 'test'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** OBD mock veri üret (tüm alanlarla) */
export function createOBDData(overrides: Partial<typeof OBD_FIXTURES.ice> = {}): typeof OBD_FIXTURES.ice {
  return { ...OBD_FIXTURES.ice, ...overrides };
}

/** GPS mock veri üret */
export function createGPSData(overrides: Partial<typeof GPS_FIXTURES.istanbul> = {}): typeof GPS_FIXTURES.istanbul {
  return { ...GPS_FIXTURES.istanbul, ...overrides };
}

/* ═══════════════════════════════════════════════════════════════════════════
   MOCK SETUP HELPERS
   ═══════════════════════════════════════════════════════════════════════════ */

/** Tüm kritik mock'ları tek seferde ayarla */
export function setupAllMocks() {
  return {
    ...createCapacitorWebMock(),
    ...createCarLauncherMock(),
  };
}

/** Test için cleanup fonksiyonu */
export function createCleanup() {
  const cleanups: Array<() => void> = [];

  return {
    add(fn: () => void): void {
      cleanups.push(fn);
    },
    cleanup(): void {
      cleanups.forEach((fn) => fn());
      cleanups.length = 0;
    },
  };
}