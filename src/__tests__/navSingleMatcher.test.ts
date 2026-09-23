/**
 * navSingleMatcher.test — kalan mesafe / işaret TEK eşleştiriciden (matchToRoute) gelir.
 *
 * Kusur (analiz 2026-09-24): navigationService yöne kör "en yakın segment" ile
 * AYRI eşleştiriyordu. Rota bölünmüş yolda gidip karşı şeritten dönünce, GPS
 * noktası dönüş şeridine birkaç metre daha yakın düştüğünde kalan mesafe ve
 * işaret DÖNÜŞ bacağına atlıyordu (ör. 2 km yerine 200 m).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../platform/bridge', () => ({ isNative: false }));

import {
  startNavigation, activateNavigation, stopNavigation, updateNavigationProgress,
  getNavigationState, getSnappedMarkerPosition,
} from '../platform/navigationService';
import { writeActiveRoute, updateRouteProgress, clearRoute } from '../platform/routingService';
import { useUnifiedVehicleStore } from '../platform/vehicleDataLayer/UnifiedVehicleStore';

// Kuzeye çık (x=29.0000), 25 m doğudaki karşı şeritten güneye dön (x=29.0003).
const geom: [number, number][] = [
  [29.0, 41.0], [29.0, 41.005], [29.0, 41.01],
  [29.0003, 41.01], [29.0003, 41.005], [29.0003, 41.0],
];

afterEach(() => { stopNavigation(); clearRoute(); });

describe('tek eşleştirme otoritesi', () => {
  it('🔒 kuzeye giden araç, dönüş şeridine daha yakın olsa da GİDİŞ bacağında sayılır', () => {
    writeActiveRoute({ geometry: geom, distanceM: 2250, durationS: 200 });
    startNavigation({ id: 'm1', name: 'M', latitude: 41.0, longitude: 29.0003, type: 'history' as const }, false, 'USER');
    activateNavigation();

    // Araç gidiş bacağında, kuzeye 60 km/s; GPS noktası doğuya kaymış (dönüş şeridine 8 m, gidişe 17 m).
    const lat = 41.002, lon = 29.0002;
    useUnifiedVehicleStore.setState({
      heading: 0, speed: 60,
      location: { latitude: lat, longitude: lon, accuracy: 5, heading: 0, speed: 16.7, timestamp: Date.now() } as never,
    });
    updateRouteProgress(lat, lon);
    updateNavigationProgress(lat, lon, 0, geom);

    const d = getNavigationState().distanceMeters!;
    // Gidiş kalanı ≈ 890 + 25 + 1113 ≈ 2030 m; yanlış (dönüş) bacak ≈ 220 m.
    expect(d).toBeGreaterThan(1900);
    expect(d).toBeLessThan(2150);
    const snap = getSnappedMarkerPosition();
    expect(snap).not.toBeNull();
    expect(snap!.lon).toBeCloseTo(29.0, 5);   // işaret gidiş şeridinde
  });
});
