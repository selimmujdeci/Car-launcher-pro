import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  NavStatus,
  startNavigation,
  stopNavigation,
  activateNavigation,
  getNavigationState,
  updateNavigationProgress,
  formatDistance,
  formatEta
} from '../platform/navigationService';
import {
  fetchRoute,
  updateRouteProgress,
  registerReroutingCallback,
  normalizeCoords,
  getRouteState,
} from '../platform/routingService';

// Mock dependencies
vi.mock('../platform/gpsService', () => ({
  getGPSSpeedKmh: vi.fn(() => 50),
}));

vi.mock('../platform/addressBookService', () => ({}));

vi.mock('../platform/sensitiveKeyStore', () => ({
  sensitiveKeyStore: {
    get: vi.fn(),
    set: vi.fn(),
  },
}));

vi.mock('../platform/offlineRoutingService', () => ({
  tryLocalDaemon: vi.fn(() => Promise.resolve(null)),
  computeOfflineRoute: vi.fn(() => Promise.resolve(null)),
  straightLineRoute: vi.fn((fromLat: number, fromLon: number, toLat: number, toLon: number) => ({
    geometry: [[fromLon, fromLat], [toLon, toLat]] as [number, number][],
    distanceM: 1000,
    durationS: 60,
  })),
}));

vi.mock('../platform/bridge', () => ({
  isNative: false,
}));

// ── 1. OSRM Response Parse ──────────────────────────────────────

describe('OSRM response parse', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should parse distance, duration and geometry from OSRM response', async () => {
    const mockResponse = {
      code: 'Ok',
      routes: [
        {
          distance: 24600,
          duration: 1200,
          geometry: {
            coordinates: [[34.6, 36.8], [34.7, 36.9]] as [number, number][],
          },
          legs: [
            {
              steps: [
                {
                  distance: 500,
                  name: 'Test Sokak',
                  maneuver: { type: 'depart', modifier: 'straight' },
                  geometry: { coordinates: [[34.6, 36.8]] },
                },
              ],
            },
          ],
        },
        {
          distance: 27000,
          duration: 1400,
          geometry: {
            coordinates: [[34.6, 36.8], [34.65, 36.85], [34.7, 36.9]] as [number, number][],
          },
          legs: [{ steps: [] }],
        },
      ],
    };

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    } as Response);

    await fetchRoute(36.8, 34.6, 36.9, 34.7);

    const state = getRouteState();
    expect(state.totalDistanceMeters).toBe(24600);
    expect(state.totalDurationSeconds).toBe(1200);
    expect(state.geometry).toEqual([[34.6, 36.8], [34.7, 36.9]]);
    expect(state.alternatives).toHaveLength(1);
    expect(state.alternatives[0]).toHaveLength(3);
    expect(state.error).toBeNull();
    expect(state.loading).toBe(false);
  });

  it('should fall back to straight-line when all servers fail', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('Network error'));

    await fetchRoute(36.8, 34.6, 36.9, 34.7);

    const state = getRouteState();
    expect(state.geometry).not.toBeNull();
    expect(state.serverUsed).toBe('straight-line');
    expect(state.loading).toBe(false);
  });
});

// ── 2. Format fonksiyonları ─────────────────────────────────────

describe('formatDistance', () => {
  it('800m → "800 m"',     () => expect(formatDistance(800)).toBe('800 m'));
  it('1000m → "1.0 km"',  () => expect(formatDistance(1000)).toBe('1.0 km'));
  it('24600m → "24.6 km"', () => expect(formatDistance(24600)).toBe('24.6 km'));
  it('0m → "0 m"',         () => expect(formatDistance(0)).toBe('0 m'));
});

describe('formatEta', () => {
  it('1200s → "20 dk"',          () => expect(formatEta(1200)).toBe('20 dk'));
  it('60s → "1 dk"',             () => expect(formatEta(60)).toBe('1 dk'));
  it('16680s → "4 sa 38 dk"',    () => expect(formatEta(16680)).toBe('4 sa 38 dk'));
  it('3600s → "1 sa 0 dk"',      () => expect(formatEta(3600)).toBe('1 sa 0 dk'));
  it('NaN → "—"',                () => expect(formatEta(NaN)).toBe('—'));
  it('negatif → "—"',            () => expect(formatEta(-1)).toBe('—'));
});

// ── 3. Koordinat normalizasyonu ─────────────────────────────────

describe('normalizeCoords', () => {
  it('doğru [lon, lat] sırasını bozmaz', () => {
    const coords: [number, number][] = [[34.6, 36.8], [34.7, 36.9]];
    expect(normalizeCoords(coords)).toEqual(coords);
  });

  it('[lat, lon] gelirse [lon, lat] formatına çevirir (lon > 90)', () => {
    // Mersin: lat=36.8, lon=34.6 → ama burada [36.8, 34.6] yanlış sıra değil
    // Gerçek senaryo: lat=5, lon=120 gibi — ikinci eleman >90
    const swapped: [number, number][] = [[5.0, 120.0], [5.1, 120.1]];
    const result = normalizeCoords(swapped);
    expect(result[0]).toEqual([120.0, 5.0]);
    expect(result[1]).toEqual([120.1, 5.1]);
  });

  it('boş dizi döner', () => {
    expect(normalizeCoords([])).toEqual([]);
  });

  it('Türkiye koordinatlarını ([lon≈34, lat≈36]) bozmaz', () => {
    const coords: [number, number][] = [[34.6, 36.8], [34.7, 36.9]];
    expect(normalizeCoords(coords)).toEqual([[34.6, 36.8], [34.7, 36.9]]);
  });
});

// ── 4. Navigation State Machine ─────────────────────────────────

describe('Navigation Logic & State Machine', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    stopNavigation();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should follow correct state transition: IDLE -> PREVIEW -> ACTIVE', () => {
    const dest = { id: '1', name: 'Test Dest', latitude: 41.0, longitude: 29.0, type: 'history' as const };

    let state = getNavigationState();
    expect(state.isNavigating).toBe(false);
    expect(state.status).toBe(NavStatus.IDLE);

    startNavigation(dest);
    state = getNavigationState();
    expect(state.status).toBe(NavStatus.PREVIEW);
    expect(state.destination).toEqual(dest);

    activateNavigation();
    state = getNavigationState();
    expect(state.status).toBe(NavStatus.ACTIVE);
  });

  it('should transition to ARRIVED when close to destination', () => {
    const dest = { id: '1', name: 'Test Dest', latitude: 41.0, longitude: 29.0, type: 'history' as const };
    startNavigation(dest);
    activateNavigation();

    updateNavigationProgress(41.00001, 29.00001, 0);

    const state = getNavigationState();
    expect(state.status).toBe(NavStatus.ARRIVED);

    vi.advanceTimersByTime(5100);
    expect(getNavigationState().status).toBe(NavStatus.IDLE);
  });

  it('should calculate remaining distance along route geometry, not straight line', () => {
    const dest = { id: '1', name: 'Test Dest', latitude: 41.1, longitude: 29.1, type: 'history' as const };
    startNavigation(dest);
    activateNavigation();

    // Route geometry: [lon, lat] sırası
    const routeGeometry: [number, number][] = [
      [29.0, 41.0],
      [29.05, 41.05],
      [29.1, 41.1],
    ];

    updateNavigationProgress(41.0, 29.0, 0, routeGeometry);
    const state = getNavigationState();
    // Rota üzerinde kalan mesafe > 0 ve makul bir değer
    expect(state.distanceMeters).toBeGreaterThan(0);
    expect(state.distanceMeters).toBeLessThan(20_000);
  });

  it('formatDistance ve formatEta Tesla standartlarına uygun', () => {
    expect(formatDistance(800)).toBe('800 m');
    expect(formatDistance(1250)).toBe('1.3 km');
    expect(formatDistance(24600)).toBe('24.6 km');

    expect(formatEta(120)).toBe('2 dk');
    expect(formatEta(3600 + 600)).toBe('1 sa 10 dk');
    expect(formatEta(4 * 3600 + 38 * 60)).toBe('4 sa 38 dk');
  });

  it('should prevent ETA jitter using 5s hysteresis', () => {
    const dest = { id: '1', name: 'Test Dest', latitude: 41.0, longitude: 29.0, type: 'history' as const };
    startNavigation(dest);

    updateNavigationProgress(40.9, 28.9, 0);
    const firstEta = getNavigationState().etaSeconds;

    vi.advanceTimersByTime(2000);
    updateNavigationProgress(40.901, 28.901, 0);
    // 2s içinde ETA değişmemeli (5s hysteresis)
    expect(getNavigationState().etaSeconds).toBe(firstEta);
  });

  it('should clean up all resources on stopNavigation (Zero-Leak)', () => {
    const dest = { id: '1', name: 'Test Dest', latitude: 41.0, longitude: 29.0, type: 'history' as const };
    startNavigation(dest);

    stopNavigation();

    const state = getNavigationState();
    expect(state.isNavigating).toBe(false);
    expect(state.destination).toBeNull();
    expect(state.status).toBe(NavStatus.IDLE);
  });
});
