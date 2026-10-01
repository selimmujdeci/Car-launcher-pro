/**
 * headUnitNativeGnss.test.ts — araç ünitesinde Google konum eklentisi (Fused) çağrılmaz.
 *
 * Saha 2026-10-01 (NWD K2401 / Megane): @capacitor/geolocation her konum isteğinde
 * Play Services kontrolü yapıyor → GMS chimera sağlayıcısını bekliyor; GMS'i çökük
 * ünitede ActivityManager CarOS'u "dying proc'a bağlı istemci" olarak öldürüyordu.
 * Head-unit'te konum yerel GPS_PROVIDER akışından (backgroundLocation) gelir.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const getInstalledPackages = vi.fn();
vi.mock('../platform/nativePlugin', () => ({
  CarLauncher: {
    getInstalledPackages: (...a: unknown[]) => getInstalledPackages(...a),
    setBackgroundGpsGeneration: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@capacitor/geolocation', () => ({
  Geolocation: {
    checkPermissions:   vi.fn().mockResolvedValue({ location: 'granted' }),
    requestPermissions: vi.fn(),
    getCurrentPosition: vi.fn(),
    watchPosition:      vi.fn().mockResolvedValue('fused-1'),
    clearWatch:         vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../platform/crashLogger', () => ({ logError: vi.fn() }));

import { Geolocation } from '@capacitor/geolocation';
import {
  isVehicleHeadUnit,
  VEHICLE_HEAD_UNIT_PACKAGES,
  _resetVehicleHeadUnitForTest,
} from '../platform/headUnitPlatform';
import { startGPSTracking, stopGPSTracking } from '../platform/gpsService';

function setNative(val: boolean) {
  (globalThis as any).Capacitor = { isNativePlatform: () => val };
}

describe('isVehicleHeadUnit', () => {
  beforeEach(() => { _resetVehicleHeadUnitForTest(); getInstalledPackages.mockReset(); });

  it('üretici paketi yüklüyse true', async () => {
    getInstalledPackages.mockResolvedValue({ installed: ['com.nwd.can.setting'] });
    expect(await isVehicleHeadUnit()).toBe(true);
  });

  it('hiçbiri yoksa false', async () => {
    getInstalledPackages.mockResolvedValue({ installed: [] });
    expect(await isVehicleHeadUnit()).toBe(false);
  });

  it('native okunamazsa false (fail-closed → Fused kalır)', async () => {
    getInstalledPackages.mockRejectedValue(new Error('not implemented'));
    expect(await isVehicleHeadUnit()).toBe(false);
  });

  it('NWD paketleri listede', () => {
    expect(VEHICLE_HEAD_UNIT_PACKAGES).toContain('com.nwd.can.setting');
  });

  it('manifest <queries> her paketi içerir (API 30+ görünürlük)', () => {
    const manifest = readFileSync(resolve(__dirname, '../../android/app/src/main/AndroidManifest.xml'), 'utf8');
    for (const pkg of VEHICLE_HEAD_UNIT_PACKAGES) {
      expect(manifest, pkg).toContain(`<package android:name="${pkg}" />`);
    }
  });
});

describe('gpsService — araç ünitesinde Fused yok', () => {
  beforeEach(async () => {
    await stopGPSTracking();
    _resetVehicleHeadUnitForTest();
    vi.mocked(Geolocation.watchPosition).mockClear();
    vi.mocked(Geolocation.getCurrentPosition).mockClear();
    vi.mocked(Geolocation.clearWatch).mockClear();
    setNative(true);
  });

  it('head-unit: watchPosition/getCurrentPosition çağrılmaz, stop clearWatch çağırmaz', async () => {
    getInstalledPackages.mockResolvedValue({ installed: ['com.nwd.statusbarbottom'] });
    await startGPSTracking();
    await startGPSTracking(); // idempotent — izleme aktif sayılır
    expect(Geolocation.watchPosition).not.toHaveBeenCalled();
    expect(Geolocation.getCurrentPosition).not.toHaveBeenCalled();
    await stopGPSTracking();
    expect(Geolocation.clearWatch).not.toHaveBeenCalled();
  });

  it('telefon (paket yok): Fused izlemesi açılır', async () => {
    getInstalledPackages.mockResolvedValue({ installed: [] });
    await startGPSTracking();
    expect(Geolocation.watchPosition).toHaveBeenCalledTimes(1);
    await stopGPSTracking();
    expect(Geolocation.clearWatch).toHaveBeenCalledTimes(1);
  });
});
