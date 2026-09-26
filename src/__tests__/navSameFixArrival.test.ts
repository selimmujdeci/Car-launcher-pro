/**
 * navSameFixArrival.test — duran araçta BİREBİR AYNI fix tekrarı navigasyonu
 * dondurmaz: varış değerlendirilir, GPS "bayat" sayılmaz.
 *
 * Smoke 2026-09-24 (telefon, sahte GPS): araç hedefte durup aynı fix'i vermeye
 * devam edince `onGPSLocation` susuyordu (konum DEĞİŞMEDİ) → varış tetikleyicileri
 * (ardışık fix + 20 sn duruş) hiç değerlendirilmiyor, navigasyon bitmiyor, rota
 * çizgisi haritada kalıyordu; 5 sn sonra da DR "GPS kayıp" diye devreye giriyordu.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const H = vi.hoisted(() => ({ fixAgeMs: null as number | null }));

vi.mock('../platform/bridge', () => ({ isNative: false }));
vi.mock('../platform/gpsService', async (orig) => ({
  ...(await orig<typeof import('../platform/gpsService')>()),
  /* Kanonik "son KABUL EDİLEN fix" yaşı — aynı fix gelse de tazelenir. */
  getLocationEvidence: () => ({ fixAgeMs: H.fixAgeMs }),
}));

import {
  startNavigation, activateNavigation, stopNavigation, getNavigationState, NavStatus,
} from '../platform/navigationService';
import { writeActiveRoute, clearRoute } from '../platform/routingService';
import { useUnifiedVehicleStore } from '../platform/vehicleDataLayer/UnifiedVehicleStore';
import {
  startNavigationSessionRuntime, _resetNavigationSessionRuntimeForTest, _drTickForTest,
  getNavigationSessionRuntimeSnapshot,
} from '../platform/navigation/navigationSessionRuntime';

// Güneyden hedefe (41.0, 29.0) çıkan ~1,1 km düz rota.
const geom: [number, number][] = [[29.0, 40.99], [29.0, 41.0]];
const dest = { id: 'same', name: 'S', latitude: 41.0, longitude: 29.0, type: 'history' as const };
/** Rota üzerinde, hedefe ~35 m (20 m anlık varış eşiğinin DIŞI, 60 m park yarıçapının İÇİ). */
const PARK_LAT = 40.999685;

let now = 0;
const loc = (lat: number, speedMs: number) =>
  ({ latitude: lat, longitude: 29.0, accuracy: 5, heading: 0, speed: speedMs, timestamp: Date.now() });

/** Yeni (DEĞİŞEN) fix → `onGPSLocation` → runtime. */
const newFix = (lat: number, kmh: number) =>
  useUnifiedVehicleStore.setState({ speed: kmh, location: loc(lat, kmh / 3.6) });

/** N saniye boyunca 1 Hz DR tick'i; `fixAgeMs(i)` = o anki kanonik fix yaşı. */
function tick(secs: number, fixAgeMs: (i: number) => number | null) {
  for (let i = 1; i <= secs; i++) { now += 1_000; H.fixAgeMs = fixAgeMs(i); _drTickForTest(); }
}

beforeEach(() => {
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  H.fixAgeMs = null;
  writeActiveRoute({ geometry: geom, distanceM: 1100, durationS: 120 });
  startNavigation(dest, false, 'USER_SEARCH');
  activateNavigation();
  startNavigationSessionRuntime();
  newFix(40.99, 40);                                   // başlangıç, hareket hâlinde
  now = 60_000;
  newFix(PARK_LAT, 0);                                 // hedefin yanında durdu
});
afterEach(() => {
  _resetNavigationSessionRuntimeForTest();
  stopNavigation();
  clearRoute();
  vi.restoreAllMocks();
  useUnifiedVehicleStore.setState({ speed: null, location: null });
});

describe('aynı fix tekrarı (duran araç)', () => {
  it('🔒 aynı fix gelmeye devam ederken 20 sn duran araç VARMIŞ sayılır', () => {
    tick(25, () => 200);                               // fix'ler geliyor, konum aynı
    expect(getNavigationState().status).toBe(NavStatus.ARRIVED);
  });

  it('🔒 aynı fix gelirken GPS "bayat" sayılmaz (DR devreye girmez)', () => {
    tick(8, () => 200);
    expect(getNavigationSessionRuntimeSnapshot().drState).toBe('GPS_FRESH');
  });

  it('🔒 fix GELMİYORSA (tünel) aynı konum yeniden işlenmez — varış uydurulmaz', () => {
    const t0 = getNavigationSessionRuntimeSnapshot().tickCount;
    tick(30, (i) => i * 1_000);                        // son kabul edilen fix eskiyor
    expect(getNavigationSessionRuntimeSnapshot().tickCount).toBe(t0);
    expect(getNavigationState().status).toBe(NavStatus.ACTIVE);
  });

  it('kanıt okunamazsa (null) eski davranış: yeniden işleme yok', () => {
    const t0 = getNavigationSessionRuntimeSnapshot().tickCount;
    tick(10, () => null);
    expect(getNavigationSessionRuntimeSnapshot().tickCount).toBe(t0);
  });

  it('🔒 harita ve sağlık izleyicisi de "fix geldi mi"yi kanonik yaştan okur', async () => {
    const map = (await import('../components/map/FullMapView.tsx?raw')).default;
    const health = (await import('../platform/system/SystemHealthMonitor.ts?raw')).default;
    /* Harita: "KONUM N sn" + DR'ye düşme kararı aynı-fix'te bayatlamasın. */
    expect(map).toMatch(/now - lastFixTsRef\.current > LOCATION_STALE_MS[\s\S]{0,400}getLocationEvidence\(\)\.fixAgeMs/);
    /* Sağlık: OBD yokken durakta "Sensör verisi dondu" basılmasın. */
    expect(health).toMatch(/entry\.name === 'VehicleDataLayer'[\s\S]{0,1200}getLocationEvidence\(\)\.fixAgeMs/);
  });

  it('🔒 konum DEĞİŞİRKEN fix bir kez işlenir (DR tick\'i ikinci kez işlemez)', () => {
    const t0 = getNavigationSessionRuntimeSnapshot().tickCount;
    for (let i = 1; i <= 5; i++) {
      now += 1_000;
      newFix(PARK_LAT + i * 0.00001, 5);
      H.fixAgeMs = 0;
      _drTickForTest();
    }
    expect(getNavigationSessionRuntimeSnapshot().tickCount - t0).toBe(5);
  });
});
