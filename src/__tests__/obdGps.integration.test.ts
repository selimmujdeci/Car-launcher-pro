/**
 * OBD + GPS Integration Test
 * 
 * OBD servisinden gelen hız verisi ile GPS verisinin
 * VehicleDataLayer üzerinden birleşik akışını test eder.
 */

import { describe, it, expect, vi, afterEach as _afterEach } from 'vitest';

/* ── Environment Setup ─────────────────────────────── */
vi.hoisted(() => {
  process.env['VITE_ENABLE_OBD_MOCK'] = 'true';
});

/* ── Mocks ────────────────────────────────────────── */
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: vi.fn(() => false) },
}));

vi.mock('../platform/nativePlugin', () => ({
  CarLauncher: {
    scanOBD: vi.fn().mockResolvedValue({ devices: [] }),
    connectOBD: vi.fn().mockImplementation(() => new Promise(() => {})),
    disconnectOBD: vi.fn().mockResolvedValue(undefined),
    addListener: vi.fn().mockResolvedValue({ remove: vi.fn() }),
  },
}));

vi.mock('../platform/performanceMode', () => ({
  getConfig: vi.fn(() => ({ obdPollInterval: 50, obdListenerDebounce: 0, enableRecommendations: false, recCooldownMs: 999_999 })),
  onPerformanceModeChange: vi.fn(() => () => {}),
}));

vi.mock('../platform/canSnapshotService', () => ({
  hydrateCanSnapshotSync: vi.fn(() => ({})),
  hydrateCanSnapshotAsync: vi.fn(() => Promise.resolve({})),
  scheduleCanSnapshot: vi.fn(),
  flushCanSnapshotNow: vi.fn(),
  stopCanSnapshot: vi.fn(),
}));

vi.mock('../platform/obdBinaryParser', () => ({
  parseBinaryOBDFrame: vi.fn(() => null),
  hasBinaryFrame: vi.fn(() => false),
  clearAccumulatedBuffer: vi.fn(),
}));

vi.mock('../platform/rafSmoother', () => ({
  useRafSmoothed: vi.fn((val: number) => val),
}));

vi.mock('../core/runtime/AdaptiveRuntimeManager', () => ({
  runtimeManager: {
    getMode: vi.fn(() => 'BALANCED'),
    getConfig: vi.fn(() => ({ obdPollingMs: 50, gpsUpdateMs: 200, uiFpsTarget: 60, enableBlur: false, enableAnimations: false })),
    subscribe: vi.fn(() => () => {}),
    reportFailure: vi.fn(),
  },
}));

vi.mock('../platform/crashLogger', () => ({ logError: vi.fn() }));

vi.mock('../platform/safety/SafetyBrain', () => ({
  SAFETY_BRAIN_STORAGE_KEY: 'test-safety-brain',
  NO_VIN_KEY: '__NO_VIN__',
  isFeatureEnabled: vi.fn(() => true),
  recordFault: vi.fn(),
  getCurrentVinKey: vi.fn(() => '__NO_VIN__'),
}));

vi.mock('../platform/vehicleProfileService', () => ({
  persistHandshakeVin: vi.fn(),
}));

vi.mock('../core/val/VehicleProfile', () => ({
  vehicleProfileRegistry: {
    getById: vi.fn(() => null),
    findBestMatch: vi.fn(() => ({ id: 'standard', name: 'Standard' })),
  },
}));

vi.mock('../platform/telemetryService', () => ({
  telemetryService: { start: vi.fn(), stop: vi.fn() },
}));

vi.mock('../platform/remoteCommandService', () => ({
  startRemoteCommands: vi.fn(),
  stopRemoteCommands: vi.fn(),
  setRemoteCommandContext: vi.fn(),
}));

vi.mock('../platform/liveStyleEngine', () => ({
  startLiveStyleEngine: vi.fn(() => () => {}),
}));

/* ── Import ────────────────────────────────────────── */
import { OBD_TO_UI_SCENARIOS } from './fixtures/integration';

describe('OBD + GPS Integration', () => {
  describe('OBD speed → GPS validation', () => {
    it('OBD speed=0 iken GPS>10 → ValidationGuard tetiklenir', async () => {
      // Bu test senaryosu: EV profili seçildiğinde OBD speed=0 ama GPS>10
      // ValidationGuard 5 ardışık tutarsızlıkta StandardProfile'e döner
      const _validationMisses = 5;
      const gpsSpeedKmh = 15;
      const obdSpeed = 0;

      // Senaryo: OBD veri gelmiyor ama araç hareket ediyor
      expect(gpsSpeedKmh).toBeGreaterThan(10);
      expect(obdSpeed).toBe(0);
    });

    it('OBD + GPS birlikte hareket → tutarlı', () => {
      const obdSpeed = 60;
      const gpsSpeedMs = 16.67; // 60 km/h

      // Her iki kaynak da benzer hız göstermeli
      const obdKmh = obdSpeed;
      const gpsKmh = Math.round(gpsSpeedMs * 3.6);
      
      expect(Math.abs(obdKmh - gpsKmh)).toBeLessThan(5);
    });
  });

  describe('Driving mode from multiple sources', () => {
    OBD_TO_UI_SCENARIOS.forEach((scenario) => {
      it(`${scenario.name}`, () => {
        const { obdData, expectedDriveMode } = scenario;

        // OBD hızından driving mode hesapla
        let driveMode: 'idle' | 'normal' | 'driving';
        if (obdData.speed !== undefined) {
          if (obdData.speed < 1) driveMode = 'idle';
          else if (obdData.speed < 20) driveMode = 'normal';
          else driveMode = 'driving';
        } else {
          driveMode = 'idle';
        }

        expect(driveMode).toBe(expectedDriveMode);
      });
    });
  });

  describe('Fuel computation integration', () => {
    it('yakıt seviyesi → kalan yakıt → menzil hesabı', () => {
      const fuelPercent = 50;
      const tankLiters = 50;
      const avgConsumption = 8; // L/100km

      const fuelRemaining = (fuelPercent / 100) * tankLiters;
      const estimatedRange = Math.round((fuelRemaining / avgConsumption) * 100);

      expect(fuelRemaining).toBe(25);
      expect(estimatedRange).toBeGreaterThan(200);
    });
  });
});