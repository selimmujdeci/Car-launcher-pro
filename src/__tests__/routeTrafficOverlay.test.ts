/**
 * routeTrafficOverlay.test — rota trafiği katmanı: yalnız bildirilen bölümler,
 * kat edilen kısım kırpılır (rota çizgisi gibi).
 */
import { describe, it, expect } from 'vitest';
import { buildRouteTrafficFeatures } from '../platform/map/routeTrafficOverlay';

const g: [number, number][] = Array.from({ length: 11 }, (_, i) => [34 + i * 0.001, 36] as [number, number]);
const sec = [
  { startIdx: 2, endIdx: 5, level: 'heavy' as const, kind: 'JAM' as const, delayS: 60 },
  { startIdx: 7, endIdx: 9, level: 'moderate' as const, kind: 'ROAD_WORK' as const, delayS: null },
];

describe('rota trafiği katmanı', () => {
  it('bölüm yoksa çizim YOK (akıcı uydurulmaz)', () => {
    expect(buildRouteTrafficFeatures(g, [], null).features).toHaveLength(0);
  });

  it('tam rota: bölümler kendi noktalarıyla, renkleriyle', () => {
    const f = buildRouteTrafficFeatures(g, sec, null).features;
    expect(f).toHaveLength(2);
    expect(f[0]!.geometry.coordinates).toHaveLength(4);
    expect(f[0]!.properties!.color).toBe('#E53935');
  });

  it('🔒 araç ilerleyince geride kalan bölüm silinir, içindeki bölüm araçtan başlar', () => {
    const f = buildRouteTrafficFeatures(g, sec, { segIdx: 3, lon: 34.0035, lat: 36 }).features;
    expect(f).toHaveLength(2);
    expect(f[0]!.geometry.coordinates[0]).toEqual([34.0035, 36]);
    expect(f[0]!.geometry.coordinates).toHaveLength(3);   // araç + 4 + 5
    const later = buildRouteTrafficFeatures(g, sec, { segIdx: 6, lon: 34.0065, lat: 36 }).features;
    expect(later).toHaveLength(1);
    expect(later[0]!.properties!.kind).toBe('ROAD_WORK');
  });
});
