import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Use vi.hoisted for all mocks to ensure they're available during hoisting
const { mocks } = vi.hoisted(() => {
  const RuntimeMode = { PERFORMANCE: 'PERFORMANCE', BASIC_JS: 'BASIC_JS', SAFE_MODE: 'SAFE_MODE' };
  const mockSetBrightness = vi.fn();
  const mockSpeakAlert = vi.fn();
  
  return {
    RuntimeMode,
    mocks: {
      RuntimeMode,
      setBrightness: mockSetBrightness,
      speakAlert: mockSpeakAlert,
    }
  };
});

// Mock dependencies BEFORE importing thermalWatchdog
vi.mock('../platform/obdService', () => ({
  onOBDData: vi.fn(() => () => {}),
}));

vi.mock('../platform/systemSettingsService', () => ({
  setBrightness: mocks.setBrightness,
  setBrightnessAuto: vi.fn(),
  setThermalBrightnessLock: vi.fn(),
  clearThermalBrightnessLock: vi.fn(),
}));

vi.mock('../platform/radar/radarCommunityService', () => ({
  stopCommunitySync: vi.fn(),
  startCommunitySync: vi.fn().mockResolvedValue(undefined),
  isCommunitySync: vi.fn(() => false),
}));

vi.mock('../platform/errorBus', () => ({
  showToast: vi.fn(),
}));

vi.mock('../platform/ttsService', () => ({
  speakAlert: mocks.speakAlert,
}));

vi.mock('../core/runtime/AdaptiveRuntimeManager', () => ({
  runtimeManager: {
    subscribe: vi.fn(() => () => {}),
    setMode: vi.fn(),
    getMode: vi.fn(() => mocks.RuntimeMode.PERFORMANCE),
    getWorkers: vi.fn(() => new Map()),
    getConfig: vi.fn(() => ({ gpsUpdateMs: 500, thermalFloor: 0 })),
  },
}));

vi.mock('../utils/safeStorage', () => ({
  safeGetRaw: vi.fn(() => null),
  safeSetRaw: vi.fn(),
  safeSetRawImmediate: vi.fn(),
}));

// Now import the module under test
import {
  startThermalWatchdog,
  stopThermalWatchdog,
  injectDeviceTemp,
  getThermalLevel,
} from '../platform/thermalWatchdog';

describe('Thermal Adaptive UI — Level Transitions & Side Effects', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    // Ensure clean DOM
    document.documentElement.classList.remove('is-thermal-throttling');
    document.documentElement.style.removeProperty('--thermal-level');
    startThermalWatchdog();
  });

  afterEach(() => {
    stopThermalWatchdog();
    vi.useRealTimers();
  });

  it('L0 (Normal): < 45°C -> kısıtlama yok', () => {
    injectDeviceTemp(40);
    vi.advanceTimersByTime(2100); // Wait for debounce
    expect(getThermalLevel()).toBe(0);
    expect(document.documentElement.classList.contains('is-thermal-throttling')).toBe(false);
  });

  it('L1 (Warm): >= 45°C -> BASIC_JS zorla', () => {
    injectDeviceTemp(46);
    vi.advanceTimersByTime(2100); // Wait for debounce
    expect(getThermalLevel()).toBe(1);
    expect(document.documentElement.style.getPropertyValue('--thermal-level')).toBe('1');
  });

  it('L2 (Hot): >= 55°C -> SAFE_MODE + Throttling Class', () => {
    injectDeviceTemp(56);
    vi.advanceTimersByTime(2100); // Wait for debounce
    expect(getThermalLevel()).toBe(2);
    expect(document.documentElement.classList.contains('is-thermal-throttling')).toBe(true);
    // Verify --thermal-level CSS variable is set
    expect(document.documentElement.style.getPropertyValue('--thermal-level')).toBe('2');
  });

  it('L3 (Critical): >= 65°C -> Brightness 30 + speakAlert', () => {
    injectDeviceTemp(66);
    vi.advanceTimersByTime(2100); // Wait for debounce
    expect(getThermalLevel()).toBe(3);
    expect(document.documentElement.style.getPropertyValue('--thermal-level')).toBe('3');
    // verify mocks were called - check via spies
    expect(mocks.speakAlert).toHaveBeenCalled();
  });

  it('Histerezis: 55°C (L2) -> 52°C -> Hala L2 kalmalı (Exit threshold 50°C)', () => {
    injectDeviceTemp(56); // Enter L2
    vi.advanceTimersByTime(2100);
    expect(getThermalLevel()).toBe(2);

    injectDeviceTemp(52); // Drop but stay in L2
    vi.advanceTimersByTime(100);
    expect(getThermalLevel()).toBe(2);

    injectDeviceTemp(49); // Exit L2 to L1
    vi.advanceTimersByTime(2100);
    expect(getThermalLevel()).toBe(1);
  });

  it('Self-healing: 70°C -> 35°C -> Tüm kısıtlamalar kalkmalı', () => {
    injectDeviceTemp(70); // L3
    vi.advanceTimersByTime(2100);
    expect(getThermalLevel()).toBe(3);

    injectDeviceTemp(35); // back to L0
    vi.advanceTimersByTime(100);
    expect(getThermalLevel()).toBe(0);
    expect(document.documentElement.classList.contains('is-thermal-throttling')).toBe(false);
  });
});