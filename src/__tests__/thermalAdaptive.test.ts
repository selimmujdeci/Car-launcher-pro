import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { 
  startThermalWatchdog, 
  stopThermalWatchdog, 
  injectDeviceTemp, 
  getThermalLevel,
} from '../platform/thermalWatchdog';
import { runtimeManager } from '../core/runtime/AdaptiveRuntimeManager';
import { RuntimeMode } from '../core/runtime/runtimeTypes';

// Import mocked functions to assert on them
import { setBrightness } from '../platform/systemSettingsService';
import { speakAlert } from '../platform/ttsService';

// Mocking dependencies
vi.mock('../platform/obdService', () => ({
  onOBDData: vi.fn(() => () => {}),
}));

vi.mock('../platform/systemSettingsService', () => ({
  setBrightness: vi.fn(),
}));

vi.mock('../platform/radar/radarCommunityService', () => ({
  stopCommunitySync: vi.fn(),
  startCommunitySync: vi.fn(),
  isCommunitySync: vi.fn(() => true),
}));

vi.mock('../platform/errorBus', () => ({
  showToast: vi.fn(),
}));

vi.mock('../platform/ttsService', () => ({
  speakAlert: vi.fn(),
}));

describe('Thermal Adaptive UI — Level Transitions & Side Effects', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Ensure clean DOM
    document.documentElement.classList.remove('is-thermal-throttling');
    document.documentElement.style.removeProperty('--thermal-level');
    startThermalWatchdog();
  });

  afterEach(() => {
    stopThermalWatchdog();
  });

  it('L0 (Normal): < 45°C -> kısıtlama yok', () => {
    injectDeviceTemp(40);
    expect(getThermalLevel()).toBe(0);
    expect(document.documentElement.classList.contains('is-thermal-throttling')).toBe(false);
    expect(runtimeManager.getMode()).not.toBe(RuntimeMode.SAFE_MODE);
  });

  it('L1 (Warm): >= 45°C -> BASIC_JS zorla', () => {
    injectDeviceTemp(46);
    expect(getThermalLevel()).toBe(1);
    expect(runtimeManager.getMode()).toBe(RuntimeMode.BASIC_JS);
    expect(document.documentElement.style.getPropertyValue('--thermal-level')).toBe('1');
  });

  it('L2 (Hot): >= 55°C -> SAFE_MODE + Throttling Class + Brightness 50', () => {
    injectDeviceTemp(56);
    expect(getThermalLevel()).toBe(2);
    expect(runtimeManager.getMode()).toBe(RuntimeMode.SAFE_MODE);
    expect(document.documentElement.classList.contains('is-thermal-throttling')).toBe(true);
    
    expect(setBrightness).toHaveBeenCalledWith(50);
  });

  it('L3 (Critical): >= 65°C -> Brightness 30 + speakAlert', () => {
    injectDeviceTemp(66);
    expect(getThermalLevel()).toBe(3);
    
    expect(setBrightness).toHaveBeenCalledWith(30);
    expect(speakAlert).toHaveBeenCalled();
  });

  it('Histerezis: 55°C (L2) -> 52°C -> Hala L2 kalmalı (Exit threshold 50°C)', () => {
    injectDeviceTemp(56); // Enter L2
    expect(getThermalLevel()).toBe(2);
    
    injectDeviceTemp(52); // Drop but stay in L2
    expect(getThermalLevel()).toBe(2);
    
    injectDeviceTemp(49); // Exit L2 to L1
    expect(getThermalLevel()).toBe(1);
  });

  it('Self-healing: 70°C -> 35°C -> Tüm kısıtlamalar kalkmalı', () => {
    injectDeviceTemp(70); // L3
    expect(getThermalLevel()).toBe(3);
    
    injectDeviceTemp(35); // back to L0
    expect(getThermalLevel()).toBe(0);
    expect(document.documentElement.classList.contains('is-thermal-throttling')).toBe(false);
  });
});
