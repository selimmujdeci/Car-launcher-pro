/**
 * routeGlide.test — rotaya oturtulmuş araç işareti GPS örnekleri ARASINDA
 * rota boyunca akar (routeGlideModel).
 *
 * Saha 2026-09-24 (telefon, 50 km/sa sahte sürüş, CDP kare ölçümü): kamera
 * karelerin %68'inde kıpırdamıyordu — oturtulmuş konum yalnız 1 Hz GPS
 * tick'inde değişiyordu (kullanıcı: "takıla takıla gidiyor").
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../platform/bridge', () => ({ isNative: false }));

import {
  EMPTY_GLIDE, GLIDE_MAX_EXTRAP_MS, glideAlongAt, pointAtAlongRemaining, pushGlideSample,
  type GlideState,
} from '../platform/navigation/core/routeGlideModel';
import {
  startNavigation, activateNavigation, stopNavigation, updateNavigationProgress,
  getSnappedMarkerPosition, getGlidingMarkerPosition,
} from '../platform/navigationService';
import { writeActiveRoute, updateRouteProgress, clearRoute, getRouteState } from '../platform/routingService';
import { useUnifiedVehicleStore } from '../platform/vehicleDataLayer/UnifiedVehicleStore';

const V = 50 / 3.6 / 1000;            // 50 km/sa, m/ms
const FRAME = 1000 / 60;

/** GPS örnekleri + rAF kareleri (varsayılan 60 fps). */
function simulate(gpsTimes: number[], alongAt: (t: number) => number, untilMs: number, frameMs = FRAME) {
  let s: GlideState = EMPTY_GLIDE;
  let gi = 0;
  const frames: { t: number; along: number | null }[] = [];
  for (let t = 0; t <= untilMs; t += frameMs) {
    while (gi < gpsTimes.length && gpsTimes[gi]! <= t) {
      const ts = gpsTimes[gi++]!;
      s = pushGlideSample(s, { alongRemainingM: alongAt(ts), ts });
    }
    frames.push({ t, along: glideAlongAt(s, t) });
  }
  return frames;
}

const steps = (f: { t: number; along: number | null }[], fromMs: number) => {
  const out: number[] = [];
  for (let i = 1; i < f.length; i++) {
    if (f[i]!.t < fromMs) continue;
    out.push(f[i - 1]!.along! - f[i]!.along!);        // + = ileri
  }
  return out;
};

describe('routeGlideModel — kareler arası akış', () => {
  it('🔒 sabit 50 km/sa, 1 Hz GPS: ikinci örnekten sonra HİÇBİR karede durmaz, geri gitmez', () => {
    const gps = Array.from({ length: 10 }, (_, i) => i * 1000);
    const f = simulate(gps, (t) => 4000 - V * t, 9000);
    const d = steps(f, 1000 + FRAME);
    expect(d.filter((x) => x < 0.01).length).toBe(0);  // eskiden karelerin çoğu 0 m
    expect(Math.min(...d)).toBeGreaterThan(0);
    // İlk hız bulunduktan sonra (yakalama bitince) sabit adım, gerçekten sapma < 0,5 m
    const steady = steps(f, 2000 + FRAME);
    expect(Math.max(...steady)).toBeLessThan(1.5 * V * FRAME);
    expect(Math.min(...steady)).toBeGreaterThan(0.5 * V * FRAME);
    for (const x of f) if (x.t >= 2000) expect(Math.abs(x.along! - (4000 - V * x.t))).toBeLessThan(0.5);
  });

  it('🔒 düzensiz GPS aralığı (900–1100 ms): örnek karenin arasına düşse de durmaz, geri gitmez', () => {
    const gaps = [1000, 930, 1070, 900, 1100, 960, 1040, 910];
    const gps = [0];
    for (const g of gaps) gps.push(gps[gps.length - 1]! + g);
    const f = simulate(gps, (t) => 4000 - V * t, gps[gps.length - 1]!);
    const d = steps(f, gps[1]! + FRAME);
    expect(d.filter((x) => x < 0.01).length).toBe(0);
    expect(Math.min(...d)).toBeGreaterThan(0);
  });

  it('🔒 gösterilen konum kare hızından BAĞIMSIZ (30 fps ile 60 fps aynı anda aynı yer)', () => {
    const gps = [0, 1000, 1930, 3000, 3900];
    const at = (fr: { t: number; along: number | null }[]) =>
      new Map(fr.map((x) => [Math.round(x.t), x.along]));
    const f60 = at(simulate(gps, (t) => 4000 - V * t, 4500, 1000 / 60));
    for (const [t, a] of at(simulate(gps, (t) => 4000 - V * t, 4500, 1000 / 30))) {
      expect(f60.get(t)).toBeCloseTo(a!, 9);
    }
  });

  it('🔒 100 ms içinde gelen ikinci örnek (iki konum kaynağı) hızı sıfırlamaz', () => {
    let s = EMPTY_GLIDE;
    for (const ts of [0, 1000, 2000, 3000, 3040]) s = pushGlideSample(s, { alongRemainingM: 4000 - V * ts, ts });
    expect(glideAlongAt(s, 3540)!).toBeCloseTo(4000 - V * 3540, 1);
  });

  it('🔒 GPS kesilirse en fazla GLIDE_MAX_EXTRAP_MS kadar ilerler, sonra DONAR', () => {
    const f = simulate([0, 1000], (t) => 4000 - V * t, 6000);
    const cap = 4000 - V * (1000 + GLIDE_MAX_EXTRAP_MS);
    for (const x of f) expect(x.along!).toBeGreaterThanOrEqual(cap - 1e-9);
    for (const x of f.filter((x) => x.t >= 4000)) expect(x.along!).toBeCloseTo(cap, 3);
  });

  it('🔒 duran araç kaydırılmaz; tek örnekten hız UYDURULMAZ', () => {
    for (const x of simulate([0, 1000, 2000], () => 3000, 4000)) expect(x.along).toBe(3000);
    for (const x of simulate([0], () => 3000, 3000)) expect(x.along).toBe(3000);
  });

  it('örnek yoksa null (çağıran oturtulmuş konuma düşer)', () => {
    expect(glideAlongAt(EMPTY_GLIDE, 123)).toBeNull();
  });

  it('🔒 büyük sıçrama (>30 m) süzülmez — gerçeğe ANINDA geçilir', () => {
    let s = pushGlideSample(EMPTY_GLIDE, { alongRemainingM: 4000, ts: 0 });
    s = pushGlideSample(s, { alongRemainingM: 3900, ts: 1000 });
    expect(glideAlongAt(s, 1000)).toBe(3900);
  });

  it('🔒 3 sn üstü boşluktan sonra gelen örnek çifti hız vermez', () => {
    let s = pushGlideSample(EMPTY_GLIDE, { alongRemainingM: 4000, ts: 0 });
    s = pushGlideSample(s, { alongRemainingM: 3950, ts: 5000 });
    expect(glideAlongAt(s, 5500)).toBe(3950);
  });

  it('rota sonunu geçmez (kalan < 0 olmaz)', () => {
    const f = simulate([0, 1000], (t) => Math.max(0, 10 - V * t), 3000);
    for (const x of f) expect(x.along!).toBeGreaterThanOrEqual(0);
  });
});

describe('pointAtAlongRemaining', () => {
  // Kuzeye 100 m, sonra doğuya 100 m (dik açı). cum = sona kalan.
  const g: [number, number][] = [[29, 41], [29, 41.0009], [29.0012, 41.0009]];
  const cum = [200, 100, 0];

  it('kalan mesafeye karşılık gelen noktayı segment içinde verir', () => {
    expect(pointAtAlongRemaining(g, cum, 150)).toEqual({ lon: 29, lat: 41.00045 });
    const p = pointAtAlongRemaining(g, cum, 50)!;
    expect(p.lat).toBeCloseTo(41.0009, 9);
    expect(p.lon).toBeCloseTo(29.0006, 9);
  });

  it('uçlarda sıkıştırır; bozuk girdide null', () => {
    expect(pointAtAlongRemaining(g, cum, 999)).toEqual({ lon: 29, lat: 41 });
    expect(pointAtAlongRemaining(g, cum, -5)).toEqual({ lon: 29.0012, lat: 41.0009 });
    expect(pointAtAlongRemaining(g, [200, 0], 50)).toBeNull();
    expect(pointAtAlongRemaining([g[0]!], [0], 0)).toBeNull();
    expect(pointAtAlongRemaining(g, cum, NaN)).toBeNull();
  });
});

describe('navigationService.getGlidingMarkerPosition', () => {
  afterEach(() => { vi.restoreAllMocks(); stopNavigation(); clearRoute(); });

  // Kuzeye düz ~2 km.
  const geom: [number, number][] = [[29.0, 41.0], [29.0, 41.009], [29.0, 41.018]];
  const M_PER_DEG = 6_371_000 * Math.PI / 180;

  function drive(): { setClock: (t: number) => void; fix: (lat: number, lon?: number) => void } {
    writeActiveRoute({ geometry: geom, distanceM: 2000, durationS: 150 });
    startNavigation({ id: 'g1', name: 'G', latitude: 41.018, longitude: 29.0, type: 'history' as const }, false, 'USER_SEARCH');
    activateNavigation();
    let clock = 50_000;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    return {
      setClock: (t) => { clock = t; },
      fix: (lat, lon = 29.0) => {
        useUnifiedVehicleStore.setState({
          heading: 0, speed: 50,
          location: { latitude: lat, longitude: lon, accuracy: 5, heading: 0, speed: 13.9, timestamp: Date.now() } as never,
        });
        updateRouteProgress(lat, lon);
        updateNavigationProgress(lat, lon, 0, getRouteState().geometry as [number, number][]);
      },
    };
  }

  it('🔒 ACTIVE navda iki GPS örneği arasında rota üzerinde ileri kayar', () => {
    const d = drive();
    const step = 13.9 / M_PER_DEG;                      // 1 sn'de 13,9 m kuzey
    d.fix(41.001);
    d.setClock(51_000);
    d.fix(41.001 + step);
    const snap = getSnappedMarkerPosition()!;
    const mid = getGlidingMarkerPosition(51_500)!;
    expect(mid.lon).toBeCloseTo(29.0, 7);               // rota çizgisinde
    expect((mid.lat - snap.lat) * M_PER_DEG).toBeGreaterThan(5);
    expect((mid.lat - snap.lat) * M_PER_DEG).toBeLessThan(9);
  });

  it('🔒 aynı güven kapısı: rotadan >20 m uzakta / nav kapalıyken null', () => {
    const d = drive();
    d.fix(41.001);
    d.setClock(51_000);
    d.fix(41.0011, 29.0004);                             // ~34 m doğuda
    expect(getSnappedMarkerPosition()).toBeNull();
    expect(getGlidingMarkerPosition(51_500)).toBeNull();
    stopNavigation();
    expect(getGlidingMarkerPosition(52_000)).toBeNull();
  });
});
