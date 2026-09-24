/**
 * curveAdvisory.test — rotadaki virajın güvenli hızı (geometriden).
 */
import { describe, it, expect } from 'vitest';
import { decideCurveAdvisory } from '../platform/navigation/core/curveAdvisoryModel';

const LAT0 = 36.9, LON0 = 34.9;
const kx = 111_320 * Math.cos(LAT0 * Math.PI / 180), ky = 110_540;
const toLL = (x: number, y: number): [number, number] => [LON0 + x / kx, LAT0 + y / ky];

/** Kuzeye 400 m düz, sonra R yarıçaplı 90° SAĞ viraj, sonra doğuya 300 m düz. */
function road(R: number): [number, number][] {
  const pts: [number, number][] = [];
  for (let y = 0; y <= 400; y += 20) pts.push(toLL(0, y));
  for (let a = 5; a <= 90; a += 5) {                     // merkez (R, 400)
    const t = (180 - a) * Math.PI / 180;
    pts.push(toLL(R + R * Math.cos(t), 400 + R * Math.sin(t)));
  }
  for (let x = R + 20; x <= R + 300; x += 20) pts.push(toLL(x, 400 + R));
  return pts;
}

function suffix(g: [number, number][]): Float64Array {
  const c = new Float64Array(g.length);
  for (let i = g.length - 2; i >= 0; i--) {
    const [a, b] = [g[i]!, g[i + 1]!];
    c[i] = c[i + 1]! + Math.hypot((b[0] - a[0]) * kx, (b[1] - a[1]) * ky);
  }
  return c;
}

const base = (g: [number, number][], along: number, over = {}) => ({
  geometry: g, cumulativeDistances: suffix(g), vehicleAlongRemainingM: along,
  lookaheadM: 600, maneuverAlongRemainingM: [], limitKmh: 90, ...over,
});

describe('viraj önerisi', () => {
  it('🔒 50 m yarıçaplı sağ viraj → ≈40 km/sa, yön sağ, mesafe ≈ düzlük sonu', () => {
    const g = road(50);
    const total = suffix(g)[0]!;
    const a = decideCurveAdvisory(base(g, total - 100))!;   // araç 100. metrede
    expect(a.direction).toBe('right');
    expect(a.advisoryKmh).toBe(40);                          // √(3·50)·3,6 ≈ 44 → 40
    expect(a.distanceM).toBeGreaterThan(250);
    expect(a.distanceM).toBeLessThan(320);
  });

  it('dar viraj daha düşük hız: R=20 → 20 km/sa', () => {
    const g = road(20);
    expect(decideCurveAdvisory(base(g, suffix(g)[0]! - 200))!.advisoryKmh).toBe(20);
  });

  it('🔒 sınırda rahat alınan / geniş viraj önerilmez', () => {
    const g = road(200);                                     // √(3·200)·3,6 ≈ 88 → 80
    expect(decideCurveAdvisory(base(g, suffix(g)[0]! - 100, { limitKmh: 70 }))).toBeNull();
    expect(decideCurveAdvisory(base(g, suffix(g)[0]! - 100, { limitKmh: 90 }))!.advisoryKmh).toBe(80);
  });

  it('🔒 KAVŞAK DÖNÜŞÜ viraj sayılmaz (manevra noktasına yakın tepe)', () => {
    const g = road(20);
    const cum = suffix(g);
    const apex = decideCurveAdvisory(base(g, cum[0]! - 200))!.apexAlongRemainingM;
    expect(decideCurveAdvisory(base(g, cum[0]! - 200, { maneuverAlongRemainingM: [apex + 10] }))).toBeNull();
  });

  it('düz yol / rota yok / konum yok → öneri YOK', () => {
    const straight: [number, number][] = Array.from({ length: 40 }, (_, i) => toLL(0, i * 20));
    expect(decideCurveAdvisory(base(straight, 500))).toBeNull();
    expect(decideCurveAdvisory({ ...base(straight, 500), geometry: null })).toBeNull();
    expect(decideCurveAdvisory({ ...base(road(50), 500), vehicleAlongRemainingM: null })).toBeNull();
  });

  it('viraj geçildikten sonra öneri kalkar', () => {
    const g = road(50);
    expect(decideCurveAdvisory(base(g, 150))).toBeNull();   // son düzlükte
  });
});

describe('runtime (ses + yayın)', () => {
  it('🔒 hızlıysa BİR KEZ uyarır; yavaşsa sadece gösterir; Türkçe ek doğru', async () => {
    const { noteCurveTick, resetCurveAdvisory, getCurveAdvisory, datSuffix } = await import('../platform/navigation/curveAdvisoryRuntime');
    resetCurveAdvisory();
    const g = road(50); const cum = suffix(g); const total = cum[0]!;
    const spoken: string[] = [];
    const tick = (along: number, speed: number) => noteCurveTick({
      sessionId: 1, routeRevision: 1, geometry: g, cumulativeDistances: cum, vehicleAlongRemainingM: along,
      maneuverAlongRemainingM: [], limitKmh: 90, speedKmh: speed,
    }, (t) => spoken.push(t));
    tick(total - 100, 35);                 // yavaş → ses yok, levha var
    expect(spoken).toHaveLength(0);
    expect(getCurveAdvisory()?.advisoryKmh).toBe(40);
    tick(total - 260, 70); tick(total - 280, 70); tick(total - 300, 70);
    // Pencereye (70 km/sa → 150 m) ilk girildiği tick'te BİR KEZ; sonraki tick'ler sessiz.
    expect(spoken).toHaveLength(1);
    expect(spoken[0]).toMatch(/^1[05]0 metre sonra keskin sağ viraj, hızınızı 40'a düşürün\.$/);
    expect(datSuffix(50)).toBe('ye');
    expect(datSuffix(70)).toBe('e');
    expect(datSuffix(20)).toBe('ye');
    resetCurveAdvisory();
    expect(getCurveAdvisory()).toBeNull();
  });
});
