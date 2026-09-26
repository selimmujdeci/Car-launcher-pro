/**
 * navArrivalPark.test — hedefin yanına park edince varış; bilinmeyen hız "duruyor" değildir.
 *
 * Kusurlar (analiz 2026-09-24):
 *   · Varış yalnız rota SONUNA 20 m içinde durunca oluyordu → 40 m ötedeki
 *     otoparka girince navigasyon hiç bitmiyordu.
 *   · Araç hızı (OBD) yokken hız 0 sayılıyordu → OBD'siz araç her zaman "duruyor".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../platform/bridge', () => ({ isNative: false }));

import {
  startNavigation, activateNavigation, stopNavigation, updateNavigationProgress,
  getNavigationState, NavStatus,
} from '../platform/navigationService';
import { useUnifiedVehicleStore } from '../platform/vehicleDataLayer/UnifiedVehicleStore';

// Güneyden hedefe (41.0, 29.0) çıkan ~1,1 km düz rota.
const geom: [number, number][] = [[29.0, 40.99], [29.0, 41.0]];
const dest = { id: 'park', name: 'Park', latitude: 41.0, longitude: 29.0, type: 'history' as const };
// Rota sonundan ~40 m doğuda otopark; rota üzerinde izdüşümü sondan ~35 m önce.
const PARK = { lat: 40.9997, lon: 29.0005 };

let now = 0;
const at = (ms: number, lat: number, lon: number) => { now = ms; updateNavigationProgress(lat, lon, 0, geom); };

beforeEach(() => {
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  startNavigation(dest, false, 'USER_SEARCH');
  activateNavigation();
  at(0, 40.99, 29.0);                      // başlangıç, 1,1 km
});
afterEach(() => {
  stopNavigation();
  vi.restoreAllMocks();
  useUnifiedVehicleStore.setState({ speed: null, location: null });
});

describe('park ederek varış', () => {
  it('🔒 hedefe ~40 m ötede 20 sn duran araç VARMIŞ sayılır', () => {
    useUnifiedVehicleStore.setState({ speed: 0 });
    for (let t = 1_000; t <= 21_000; t += 1_000) at(t, PARK.lat, PARK.lon);
    expect(getNavigationState().status).toBe(NavStatus.ARRIVED);
  });

  it('aynı yerde kısa duruş (kırmızı ışık, 10 sn) varış DEĞİLDİR', () => {
    useUnifiedVehicleStore.setState({ speed: 0 });
    for (let t = 1_000; t <= 10_000; t += 1_000) at(t, PARK.lat, PARK.lon);
    expect(getNavigationState().status).toBe(NavStatus.ACTIVE);
  });
});

describe('bilinmeyen hız', () => {
  it('🔒 OBD ve GPS hızı yoksa "duruyor" sayılmaz — park varışı tetiklenmez', () => {
    useUnifiedVehicleStore.setState({ speed: null, location: null });
    for (let t = 1_000; t <= 30_000; t += 1_000) at(t, PARK.lat, PARK.lon);
    expect(getNavigationState().status).toBe(NavStatus.ACTIVE);
  });

  it('OBD yoksa GPS hızı kullanılır (m/s)', () => {
    useUnifiedVehicleStore.setState({
      speed: null,
      location: { latitude: PARK.lat, longitude: PARK.lon, accuracy: 5, speed: 0.2, timestamp: Date.now() },
    });
    for (let t = 1_000; t <= 21_000; t += 1_000) at(t, PARK.lat, PARK.lon);
    expect(getNavigationState().status).toBe(NavStatus.ARRIVED);
  });
});

describe('sürüşte hedef değişimi', () => {
  it('🔒 eski hedefin ETA/mesafesi taşınmaz; yeni ETA yazılır', async () => {
    const { writeActiveRoute, updateRouteProgress, clearRoute } = await import('../platform/routingService');
    const drive = (id: string) => {
      startNavigation({ ...dest, id }, false, 'USER_SEARCH');
      activateNavigation();
      writeActiveRoute({ geometry: geom, distanceM: 1100, durationS: 120 });
      useUnifiedVehicleStore.setState({
        speed: 40,
        location: { latitude: 40.995, longitude: 29.0, accuracy: 5, heading: 0, speed: 11, timestamp: Date.now() },
      });
      now += 10_000;
      updateRouteProgress(40.995, 29.0);
      updateNavigationProgress(40.995, 29.0, 0, geom);
      return getNavigationState().etaSeconds;
    };
    const first = drive('a');
    expect(first).toBeGreaterThan(0);
    // Hedef değişti (stop çağrılmadan): ESKİ hedefin ETA/mesafesi taşınmaz…
    startNavigation({ ...dest, id: 'b', latitude: 41.01 }, false, 'USER_SEARCH');
    expect(getNavigationState().etaSeconds).toBeUndefined();
    expect(getNavigationState().distanceMeters).toBeUndefined();
    // …ve yeni oturumun ETA'sı (eskisine çok yakın olsa da) yazılır.
    const second = drive('b');
    expect(second).toBeGreaterThan(0);
    clearRoute();
  });
});
