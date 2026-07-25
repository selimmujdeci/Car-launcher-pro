/**
 * routeTrafficGradient.test — NAV-5 saf çekirdek: gradient üretici + örnekleme + seviye.
 */
import { describe, it, expect } from 'vitest';
import {
  buildTrafficGradient, jamToLevel, sampleRouteProgress, type TrafficStop,
} from '../platform/map/routeTrafficGradient';
import { TRAFFIC_COLORS } from '../platform/trafficService';

describe('jamToLevel — jamFactor → seviye eşiği', () => {
  it('eşikler: <2 free, <5 moderate, <8 heavy, ≥8 standstill', () => {
    expect(jamToLevel(0)).toBe('free');
    expect(jamToLevel(1.9)).toBe('free');
    expect(jamToLevel(2)).toBe('moderate');
    expect(jamToLevel(4.9)).toBe('moderate');
    expect(jamToLevel(5)).toBe('heavy');
    expect(jamToLevel(7.9)).toBe('heavy');
    expect(jamToLevel(8)).toBe('standstill');
    expect(jamToLevel(10)).toBe('standstill');
  });
});

describe('buildTrafficGradient — MapLibre line-gradient ifadesi', () => {
  it('boş stop → null (çağıran dekoratife düşer)', () => {
    expect(buildTrafficGradient([])).toBeNull();
  });

  it('tek stop → tüm rota tek renk (2 stop, MapLibre ≥2 şartı)', () => {
    const g = buildTrafficGradient([{ progress: 0.5, level: 'heavy' }]);
    expect(g).toEqual(['interpolate', ['linear'], ['line-progress'], 0, TRAFFIC_COLORS.heavy, 1, TRAFFIC_COLORS.heavy]);
  });

  it('çok stop → interpolate ifadesi, renkler TRAFFIC_COLORS\'tan', () => {
    const stops: TrafficStop[] = [
      { progress: 0,   level: 'free' },
      { progress: 0.5, level: 'heavy' },
      { progress: 1,   level: 'standstill' },
    ];
    const g = buildTrafficGradient(stops) as unknown[];
    expect(g[0]).toBe('interpolate');
    expect(g).toContain(TRAFFIC_COLORS.free);
    expect(g).toContain(TRAFFIC_COLORS.heavy);
    expect(g).toContain(TRAFFIC_COLORS.standstill);
  });

  it('line-progress stop\'ları KESİN ARTAN (MapLibre şartı) — tekrar eden progress ayrılır', () => {
    const stops: TrafficStop[] = [
      { progress: 0.5, level: 'free' },
      { progress: 0.5, level: 'heavy' },   // aynı progress → ikincisi hafif ilerletilir
      { progress: 0.5, level: 'standstill' },
    ];
    const g = buildTrafficGradient(stops) as unknown[];
    // ifade: ['interpolate',['linear'],['line-progress'], p0,c0, p1,c1, p2,c2]
    const progresses = [g[3], g[5], g[7]] as number[];
    expect(progresses[0]).toBeLessThan(progresses[1]);
    expect(progresses[1]).toBeLessThan(progresses[2]);
  });

  it('progress [0,1] dışı → clamp', () => {
    const g = buildTrafficGradient([
      { progress: -0.5, level: 'free' },
      { progress: 2,    level: 'heavy' },
    ]) as unknown[];
    expect(g[3]).toBe(0); // -0.5 → 0
    expect(g[g.length - 2]).toBe(1); // 2 → 1
  });
});

describe('sampleRouteProgress — saf örnekleme (K nokta, progress 0..1)', () => {
  // Basit düz rota: 5 nokta, eşit aralıklı kuzey (kümülatif mesafe içeride hesaplanır).
  const geometry: [number, number][] = [
    [32.0, 39.0], [32.0, 39.1], [32.0, 39.2], [32.0, 39.3], [32.0, 39.4],
  ];

  it('K nokta döndürür, progress 0\'dan 1\'e (store-bağımsız)', () => {
    const pts = sampleRouteProgress(geometry, 5);
    expect(pts.length).toBe(5);
    expect(pts[0].progress).toBeCloseTo(0, 5);
    expect(pts[pts.length - 1].progress).toBeCloseTo(1, 5);
    for (let i = 1; i < pts.length; i++) expect(pts[i].progress).toBeGreaterThanOrEqual(pts[i - 1].progress);
  });

  it('geçersiz giriş → boş dizi (fail-soft)', () => {
    expect(sampleRouteProgress([], 5)).toEqual([]);
    expect(sampleRouteProgress([[0, 0]], 5)).toEqual([]); // tek nokta
  });
});
