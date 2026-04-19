/**
 * gpsService.test.ts — GPS service state machine testleri.
 *
 * Test kapsamı:
 *  - Web modunda GPS unavailable olarak işaretlenir
 *  - Native modda izin granted → watchPosition çağrılır
 *  - Native modda izin denied → hata state set edilir, watchPosition çağrılmaz
 *  - İzin API timeout (null) → watchPosition yine de çağrılır (graceful fallback)
 *  - startGPSTracking idempotent: watchId doluyken ikinci çağrı watchPosition çağırmaz
 *  - stopGPSTracking: clearWatch çağrılır, isTracking=false, location=null
 *  - stopGPSTracking idempotent: watch yokken hata fırlatmaz
 *  - native watchPosition throws → web fallback devreye girer
 *  - web fallback idempotent guard
 *  - feedBackgroundLocation: geçerli data store'a yazılır
 *  - feedBackgroundLocation: NaN koordinat yoksayılır
 *  - feedBackgroundLocation: range dışı enlem yoksayılır
 *  - feedBackgroundLocation: null/undefined data güvenle işlenir
 *  - getGPSSpeedKmh: konum yokken null, geçerli speed km/h'e dönüşür, speed=0 → null
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/* ── Mocks ───────────────────────────────────────────────── */

vi.mock('@capacitor/geolocation', () => ({
  Geolocation: {
    checkPermissions:   vi.fn(),
    requestPermissions: vi.fn(),
    watchPosition:      vi.fn(),
    clearWatch:         vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../platform/crashLogger', () => ({
  logError: vi.fn(),
}));

/* ── Platform helper ─────────────────────────────────────── */

function setNative(val: boolean) {
  (globalThis as any).Capacitor = { isNativePlatform: () => val };
}

function mockNavigatorGeolocation(watchId = 42) {
  Object.defineProperty(globalThis, 'navigator', {
    value: {
      geolocation: {
        watchPosition: vi.fn().mockReturnValue(watchId),
        clearWatch:    vi.fn(),
      },
    },
    writable: true,
    configurable: true,
  });
}

/* ── Imports ─────────────────────────────────────────────── */

import { Geolocation } from '@capacitor/geolocation';
import {
  startGPSTracking,
  stopGPSTracking,
  feedBackgroundLocation,
  getGPSState,
  getGPSSpeedKmh,
} from '../platform/gpsService';

/* ── Web modu ────────────────────────────────────────────── */

describe('gpsService — web modu', () => {
  beforeEach(async () => {
    setNative(false);
    await stopGPSTracking();
  });
  afterEach(async () => {
    await stopGPSTracking();
    vi.clearAllMocks();
  });

  it('startGPSTracking → unavailable=true set edilir', async () => {
    await startGPSTracking();
    expect(getGPSState().unavailable).toBe(true);
  });

  it('native API hiç çağrılmaz', async () => {
    await startGPSTracking();
    expect(vi.mocked(Geolocation.checkPermissions)).not.toHaveBeenCalled();
    expect(vi.mocked(Geolocation.watchPosition)).not.toHaveBeenCalled();
  });
});

/* ── Native modu — izin granted ─────────────────────────── */

describe('gpsService — native modu, izin granted', () => {
  beforeEach(async () => {
    setNative(true);
    vi.mocked(Geolocation.checkPermissions).mockResolvedValue(
      { location: 'granted', coarseLocation: 'granted' } as any,
    );
    vi.mocked(Geolocation.watchPosition).mockResolvedValue('watch-1');
    await stopGPSTracking();
  });
  afterEach(async () => {
    await stopGPSTracking();
    vi.clearAllMocks();
  });

  it('checkPermissions çağrılır, watchPosition başlatılır', async () => {
    await startGPSTracking();
    expect(vi.mocked(Geolocation.checkPermissions)).toHaveBeenCalled();
    expect(vi.mocked(Geolocation.watchPosition)).toHaveBeenCalledTimes(1);
  });

  it('startGPSTracking idempotent — ikinci çağrıda watchPosition tekrar çağrılmaz', async () => {
    await startGPSTracking();
    await startGPSTracking();
    expect(vi.mocked(Geolocation.watchPosition)).toHaveBeenCalledTimes(1);
  });
});

/* ── Native modu — izin denied ──────────────────────────── */

describe('gpsService — native modu, izin denied', () => {
  beforeEach(async () => {
    setNative(true);
    vi.mocked(Geolocation.checkPermissions).mockResolvedValue(
      { location: 'denied', coarseLocation: 'denied' } as any,
    );
    vi.mocked(Geolocation.requestPermissions).mockResolvedValue(
      { location: 'denied', coarseLocation: 'denied' } as any,
    );
    await stopGPSTracking();
  });
  afterEach(async () => {
    await stopGPSTracking();
    vi.clearAllMocks();
  });

  it('izin reddinde hata state set edilir', async () => {
    await startGPSTracking();
    expect(getGPSState().error).toBe('GPS permission denied');
  });

  it('izin reddinde watchPosition çağrılmaz', async () => {
    await startGPSTracking();
    expect(vi.mocked(Geolocation.watchPosition)).not.toHaveBeenCalled();
  });
});

/* ── Native modu — izin API timeout ─────────────────────── */

describe('gpsService — native modu, izin API timeout', () => {
  beforeEach(async () => {
    setNative(true);
    // checkPermissions asla resolve etmez → 6 s timeout → null → devam et
    vi.mocked(Geolocation.checkPermissions).mockImplementation(
      () => new Promise(() => {}),
    );
    vi.mocked(Geolocation.watchPosition).mockResolvedValue('watch-timeout');
    vi.useFakeTimers();
    await stopGPSTracking();
  });
  afterEach(async () => {
    vi.useRealTimers();
    await stopGPSTracking();
    vi.clearAllMocks();
  });

  it('6 s timeout sonrası watchPosition yine de çağrılır', async () => {
    const startPromise = startGPSTracking();
    await vi.advanceTimersByTimeAsync(7_000);
    await startPromise;
    expect(vi.mocked(Geolocation.watchPosition)).toHaveBeenCalledTimes(1);
  });
});

/* ── stopGPSTracking ─────────────────────────────────────── */

describe('gpsService — stopGPSTracking', () => {
  beforeEach(async () => {
    setNative(true);
    vi.mocked(Geolocation.checkPermissions).mockResolvedValue(
      { location: 'granted', coarseLocation: 'granted' } as any,
    );
    vi.mocked(Geolocation.watchPosition).mockResolvedValue('watch-stop-test');
    await stopGPSTracking();
  });
  afterEach(async () => {
    await stopGPSTracking();
    vi.clearAllMocks();
  });

  it('stopGPSTracking sonrası isTracking=false', async () => {
    await startGPSTracking();
    await stopGPSTracking();
    expect(getGPSState().isTracking).toBe(false);
  });

  it('stopGPSTracking sonrası location=null', async () => {
    await startGPSTracking();
    await stopGPSTracking();
    expect(getGPSState().location).toBeNull();
  });

  it('stopGPSTracking clearWatch çağırır', async () => {
    await startGPSTracking();
    await stopGPSTracking();
    expect(vi.mocked(Geolocation.clearWatch)).toHaveBeenCalled();
  });

  it('stopGPSTracking idempotent — watch yokken hata fırlatmaz', async () => {
    await expect(stopGPSTracking()).resolves.not.toThrow();
    await expect(stopGPSTracking()).resolves.not.toThrow();
  });
});

/* ── Native watchPosition throws → web fallback ─────────── */

describe('gpsService — native hata → web fallback', () => {
  beforeEach(async () => {
    setNative(true);
    vi.mocked(Geolocation.checkPermissions).mockResolvedValue(
      { location: 'granted', coarseLocation: 'granted' } as any,
    );
    vi.mocked(Geolocation.watchPosition).mockRejectedValue(
      new Error('BT connection lost'),
    );
    mockNavigatorGeolocation(99);
    await stopGPSTracking();
  });
  afterEach(async () => {
    await stopGPSTracking();
    vi.clearAllMocks();
  });

  it('native hata → web navigator.geolocation.watchPosition çağrılır', async () => {
    await startGPSTracking();
    expect(navigator.geolocation.watchPosition).toHaveBeenCalledTimes(1);
  });

  it('web fallback sonrası startGPSTracking idempotent', async () => {
    await startGPSTracking();
    await startGPSTracking();
    expect(navigator.geolocation.watchPosition).toHaveBeenCalledTimes(1);
  });
});

/* ── feedBackgroundLocation ──────────────────────────────── */

describe('gpsService — feedBackgroundLocation', () => {
  beforeEach(async () => {
    setNative(false);
    await stopGPSTracking(); // _lastPositionMs sıfırla
  });
  afterEach(async () => {
    await stopGPSTracking();
    vi.clearAllMocks();
  });

  it('geçerli data store\'a yazılır', () => {
    feedBackgroundLocation({
      lat: 41.015, lng: 28.979, speed: 72, bearing: 90, accuracy: 5,
    });
    const loc = getGPSState().location;
    expect(loc).not.toBeNull();
    expect(loc?.latitude).toBe(41.015);
    expect(loc?.longitude).toBe(28.979);
    expect(loc?.heading).toBe(90);
    expect(loc?.speed).toBeCloseTo(72 / 3.6, 2); // km/h → m/s
  });

  it('NaN enlem yoksayılır — location değişmez', () => {
    const before = getGPSState().location; // null after stopGPSTracking
    feedBackgroundLocation({ lat: NaN, lng: 28.979, speed: 0, bearing: 0, accuracy: 0 });
    expect(getGPSState().location).toBe(before);
  });

  it('range dışı enlem (>90) yoksayılır', () => {
    const before = getGPSState().location;
    feedBackgroundLocation({ lat: 95, lng: 28.979, speed: 0, bearing: 0, accuracy: 0 });
    expect(getGPSState().location).toBe(before);
  });

  it('range dışı boylam (>180) yoksayılır', () => {
    const before = getGPSState().location;
    feedBackgroundLocation({ lat: 41.0, lng: 200, speed: 0, bearing: 0, accuracy: 0 });
    expect(getGPSState().location).toBe(before);
  });

  it('null data güvenle işlenir — hata fırlatmaz', () => {
    expect(() => feedBackgroundLocation(null as any)).not.toThrow();
  });
});

/* ── getGPSSpeedKmh ──────────────────────────────────────── */

describe('gpsService — getGPSSpeedKmh', () => {
  beforeEach(async () => {
    setNative(false);
    await stopGPSTracking(); // location=null, _lastPositionMs=0
  });
  afterEach(async () => {
    await stopGPSTracking();
  });

  it('konum yokken null döner', () => {
    expect(getGPSSpeedKmh()).toBeNull();
  });

  it('geçerli speed → km/h dönüşümü', () => {
    feedBackgroundLocation({ lat: 41.0, lng: 29.0, speed: 90, bearing: 0, accuracy: 3 });
    expect(getGPSSpeedKmh()).toBeCloseTo(90, 0);
  });

  it('speed=0 → null döner', async () => {
    // Her test beforeEach ile throttle sıfırlanır
    feedBackgroundLocation({ lat: 41.0, lng: 29.0, speed: 0, bearing: 0, accuracy: 3 });
    expect(getGPSSpeedKmh()).toBeNull();
  });

  it('negatif speed → null döner', async () => {
    feedBackgroundLocation({ lat: 41.0, lng: 29.0, speed: -10, bearing: 0, accuracy: 3 });
    // negatif km/h → m/s negatif → speed <= 0 → null
    expect(getGPSSpeedKmh()).toBeNull();
  });
});
