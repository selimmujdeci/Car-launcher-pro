/**
 * SafetyBrain birim testleri
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: vi.fn(() => false) },
  registerPlugin: vi.fn(() => ({})),
}));

vi.mock('@capacitor/filesystem', () => ({
  Filesystem: {
    readdir:    vi.fn().mockResolvedValue({ files: [] }),
    readFile:   vi.fn().mockResolvedValue({ data: '' }),
    writeFile:  vi.fn().mockResolvedValue({}),
    deleteFile: vi.fn().mockResolvedValue({}),
    rename:     vi.fn().mockResolvedValue({}),
    stat:       vi.fn().mockResolvedValue({ size: 10 }),
  },
  Directory: { Data: 'DATA' },
  Encoding:  { UTF8: 'utf8' },
}));

vi.mock('../platform/obdService', () => ({
  setObdVehicleType: vi.fn(),
}));

import {
  NO_VIN_KEY,
  SAFETY_BRAIN_STORAGE_KEY,
  __unsafeFlushSafetyBrainForTests,
  __unsafeGetRootForTests,
  __unsafeResetSafetyBrainForTests,
  getCurrentVinKey,
  hydrateSafetyBrainFromStorage,
  isFeatureEnabled,
  listSafetyDisabledFeatureWarnings,
  recordFault,
  resetVinProfile,
} from '../platform/safety/SafetyBrain';
import { setHandshakeVin } from '../platform/safety/vinContext';
import { useStore } from '../store/useStore';
import {
  safeGetRaw,
  safeRemoveRaw,
  safeFlushAll,
} from '../utils/safeStorage';

const TEST_VIN = '1HGBH41JXMN109186';

describe('SafetyBrain', () => {
  beforeEach(() => {
    __unsafeResetSafetyBrainForTests();
    safeRemoveRaw(SAFETY_BRAIN_STORAGE_KEY);
    setHandshakeVin(null);
    useStore.setState({
      settings: {
        ...useStore.getState().settings,
        activeVehicleProfileId: null,
        vehicleProfiles: [],
      },
    });
  });

  afterEach(() => {
    safeFlushAll();
    safeRemoveRaw(SAFETY_BRAIN_STORAGE_KEY);
    __unsafeResetSafetyBrainForTests();
    setHandshakeVin(null);
    try {
      localStorage.clear();
    } catch { /* ignore */ }
  });

  it('aynı fault 3 kez → ilgili özellik kapanır (__NO_VIN__)', () => {
    expect(getCurrentVinKey()).toBe(NO_VIN_KEY);
    expect(isFeatureEnabled('offlineTileAutoRollback')).toBe(true);
    recordFault('TILE_ROLLBACK');
    recordFault('TILE_ROLLBACK');
    expect(isFeatureEnabled('offlineTileAutoRollback')).toBe(true);
    recordFault('TILE_ROLLBACK');
    expect(isFeatureEnabled('offlineTileAutoRollback')).toBe(false);
    const p = __unsafeGetRootForTests().profiles[NO_VIN_KEY];
    expect(p?.faults['TILE_ROLLBACK']?.count).toBe(3);
    expect(p?.disabledFeatures).toContain('offlineTileAutoRollback');
    const msgs = listSafetyDisabledFeatureWarnings();
    expect(msgs.length).toBeGreaterThan(0);
    expect(msgs[0]).toContain('Güvenlik nedeniyle');
    expect(msgs[0]).toContain('geçici olarak kapatıldı');
  });

  it('farklı fault ayrı özelliği etkiler', () => {
    recordFault('MAP_TILE_CRC_FAIL');
    recordFault('MAP_TILE_CRC_FAIL');
    recordFault('MAP_TILE_CRC_FAIL');
    expect(isFeatureEnabled('mapManifestIntegrityVerify')).toBe(false);
    expect(isFeatureEnabled('offlineTileAutoRollback')).toBe(true);
  });

  it('VIN anahtarı: aktif profil VIN öncelikli', () => {
    useStore.setState({
      settings: {
        ...useStore.getState().settings,
        vehicleProfiles: [
          {
            id:         'p1',
            name:       'Test',
            vin:        TEST_VIN,
            createdAt:  new Date().toISOString(),
            lastUsedAt: null,
          },
        ],
        activeVehicleProfileId: 'p1',
      },
    });
    expect(getCurrentVinKey()).toBe(TEST_VIN);
    recordFault('OBD_DATA_GATE_TIMEOUT');
    recordFault('OBD_DATA_GATE_TIMEOUT');
    recordFault('OBD_DATA_GATE_TIMEOUT');
    expect(__unsafeGetRootForTests().profiles[TEST_VIN]?.faults['OBD_DATA_GATE_TIMEOUT']?.count).toBe(3);
  });

  it('hydrate + depo round-trip', () => {
    recordFault('TILE_ROLLBACK');
    __unsafeFlushSafetyBrainForTests();
    __unsafeResetSafetyBrainForTests();
    const raw = safeGetRaw(SAFETY_BRAIN_STORAGE_KEY);
    expect(raw).toBeTruthy();
    hydrateSafetyBrainFromStorage();
    expect(__unsafeGetRootForTests().profiles[NO_VIN_KEY]?.faults['TILE_ROLLBACK']?.count).toBeGreaterThanOrEqual(1);
  });

  it('resetVinProfile temizler', () => {
    recordFault('TILE_ROLLBACK');
    resetVinProfile(TEST_VIN);
    setHandshakeVin(TEST_VIN);
    useStore.setState({
      settings: {
        ...useStore.getState().settings,
        vehicleProfiles: [
          {
            id:         'p1',
            name:       'Test',
            vin:        TEST_VIN,
            createdAt:  new Date().toISOString(),
            lastUsedAt: null,
          },
        ],
        activeVehicleProfileId: 'p1',
      },
    });
    recordFault('TILE_ROLLBACK');
    expect(__unsafeGetRootForTests().profiles[TEST_VIN]).toBeDefined();
    resetVinProfile(TEST_VIN);
    expect(__unsafeGetRootForTests().profiles[TEST_VIN]).toBeUndefined();
  });
});
