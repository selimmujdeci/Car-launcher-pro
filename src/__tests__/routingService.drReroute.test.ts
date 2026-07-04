/**
 * DR/tünel reroute yasağı kilidi — 2026-07-05 navigasyon denetimi P1.
 *
 * Tünelde ilerleme hattı dead-reckoning konumlarıyla beslenir (FullMapView).
 * DR projeksiyonu virajda rotadan doğal olarak sapar; sapma tespiti DR
 * konumlarında çalışırsa internet yokken sahte reroute tetiklenir ve gerçek
 * rota düz-çizgi fallback'iyle DEĞİŞTİRİLİR (geri dönüşü yok).
 *
 * KİLİT: updateRouteProgress(lat, lon, { allowReroute: false }) sapma tespitini
 * ATLAMALI; varsayılan çağrı (allowReroute verilmeden) reroute'u korumalı.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../platform/offlineRoutingService', () => ({
  tryLocalDaemon: vi.fn(() => Promise.resolve(null)),
  computeOfflineRoute: vi.fn(() => Promise.resolve(null)),
  straightLineRoute: vi.fn((fromLat: number, fromLon: number, toLat: number, toLon: number) => ({
    geometry: [[fromLon, fromLat], [toLon, toLat]] as [number, number][],
    distanceM: 1000,
    durationS: 60,
    steps: [],
    source: 'straight-line',
  })),
}));

vi.mock('../platform/bridge', () => ({
  isNative: false,
}));

vi.mock('../platform/ttsService', () => ({
  speakNavigation: vi.fn(),
}));

// Sapma tespiti hız (>3 km/h) + accuracy (<50 m) kapılarını geçmeli
vi.mock('../platform/vehicleDataLayer/UnifiedVehicleStore', () => ({
  useUnifiedVehicleStore: {
    getState: () => ({
      speed: 10, // m/s → 36 km/h
      location: { latitude: 36.80, longitude: 34.61, accuracy: 5, timestamp: Date.now() },
    }),
  },
}));

import {
  fetchRoute,
  updateRouteProgress,
  setRerouteContext,
  clearRerouteContext,
  clearRoute,
  getRouteState,
} from '../platform/routingService';

/* Doğu-batı düz rota: (36.80, 34.60) → (36.80, 34.64) */
const OSRM_OK = {
  code: 'Ok',
  routes: [
    {
      distance: 3500,
      duration: 300,
      geometry: {
        coordinates: [
          [34.60, 36.80], [34.61, 36.80], [34.62, 36.80], [34.63, 36.80], [34.64, 36.80],
        ] as [number, number][],
      },
      legs: [
        {
          steps: [
            {
              distance: 1800, duration: 150, name: 'Test Cd',
              maneuver: { type: 'depart', modifier: 'straight' },
              geometry: { coordinates: [[34.60, 36.80]] },
            },
            {
              distance: 1700, duration: 150, name: 'Hedef Sk',
              maneuver: { type: 'turn', modifier: 'right' },
              geometry: { coordinates: [[34.62, 36.80]] },
            },
            {
              distance: 0, duration: 0, name: '',
              maneuver: { type: 'arrive', modifier: 'straight' },
              geometry: { coordinates: [[34.64, 36.80]] },
            },
          ],
        },
      ],
    },
  ],
};

// Rotadan ~550 m kuzeyde bir nokta — REROUTE_THRESHOLD_M (55) + accuracy payını (5) rahat aşar
const OFF_LAT = 36.805;
const OFF_LON = 34.61;

describe('KİLİT: DR konumu (allowReroute:false) sapma tespitini atlar', () => {
  let nowMs = 0;
  let perfSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.stubGlobal('fetch', vi.fn());
    Object.defineProperty(navigator, 'onLine', { value: true, writable: true, configurable: true });

    // performance.now kontrolü: startup guard (3s) + reroute throttle (10s) aşılır
    nowMs = 0;
    perfSpy = vi.spyOn(performance, 'now').mockImplementation(() => nowMs);

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(OSRM_OK),
    } as unknown as Response);

    await fetchRoute(36.80, 34.60, 36.80, 34.64);
    setRerouteContext(36.80, 34.64); // _navContextStartMs = 0
    nowMs = 20_000; // guard + throttle penceresi geçti
    vi.mocked(fetch).mockClear();
  });

  afterEach(() => {
    clearRerouteContext();
    clearRoute();
    perfSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it('rota gerçek OSRM sunucusundan geldi (ön koşul)', () => {
    const s = getRouteState();
    expect(s.serverUsed).not.toBe('straight-line');
    expect(s.geometry?.length).toBe(5);
    expect(s.steps.length).toBe(3);
  });

  it('allowReroute:false — 5 ardışık off-route DR konumu reroute TETİKLEMEZ', async () => {
    for (let i = 0; i < 5; i++) {
      nowMs += 1_000;
      updateRouteProgress(OFF_LAT, OFF_LON, { allowReroute: false });
    }
    await Promise.resolve(); // olası async reroute mikrotask'ını boşalt
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('varsayılan çağrı — 3 ardışık off-route GPS konumu reroute TETİKLER (davranış korunur)', async () => {
    for (let i = 0; i < 3; i++) {
      nowMs += 1_000;
      updateRouteProgress(OFF_LAT, OFF_LON);
    }
    await vi.waitFor(() => {
      expect(vi.mocked(fetch)).toHaveBeenCalled();
    });
  });

  it('allowReroute:false adım ilerletmeyi KORUR (talimat hattı tünelde donmaz)', () => {
    // steps[1] manevra noktasına (34.62, 36.80) 10 m mesafede, manevrayı geçmiş konum
    updateRouteProgress(36.80, 34.6201, { allowReroute: false });
    expect(getRouteState().currentStepIndex).toBe(1);
  });
});
