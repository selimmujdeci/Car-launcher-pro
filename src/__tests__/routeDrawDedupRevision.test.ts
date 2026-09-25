/**
 * routeDrawDedupRevision.test — telefon smoke 2026-09-25: "ROTA SEÇ" + navigasyon
 * sonrası sokak adı etiketleri çizginin olmadığı sokakta kaldı.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { routeHash } from '../components/map/hooks/_mapSurfaceInternals';

describe('rota çizim dedup anahtarı', () => {
  it('kök neden: aynı uçlu/aynı uzunlukta iki FARKLI rota aynı özeti verir', () => {
    const fastest: [number, number][] = [[34.862, 36.917], [34.870, 36.920], [34.898, 36.935]];
    const alternative: [number, number][] = [[34.862, 36.917], [34.861, 36.918], [34.898, 36.935]];
    expect(routeHash(fastest)).toBe(routeHash(alternative));
  });
  it('🔒 bu yüzden anahtar rota revizyonunu da içerir (her kayıtta yeniden çizilir)', () => {
    const src = readFileSync('src/components/map/hooks/useRouteDrawingLifecycle.ts', 'utf8');
    expect(src).toContain('#${route.routeRevision}');
    expect(src).toMatch(/route\.routeRevision, mapStatus, styleKey, navStatus\]\);/);
  });
});
