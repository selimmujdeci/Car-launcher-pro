/**
 * Harita lisans atfı (2026-09-27) — görünür, DÜZ METİN; MapLibre'nin HTML atfı kapalı kalır
 * (güvenlik: maplibreXssContainmentW13).
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MapAttribution, MAP_ATTRIBUTION_TEXT } from '../components/map/MapAttribution';

describe('harita atfı', () => {
  it('OSM, OpenMapTiles, TomTom ve Esri sağlayıcılarını düz metin olarak yazar', () => {
    const el = document.createElement('div');
    el.innerHTML = renderToStaticMarkup(<MapAttribution />);
    const box = el.querySelector('[data-map-attribution]')!;
    expect(box.textContent).toBe(MAP_ATTRIBUTION_TEXT);
    for (const p of ['OpenStreetMap', 'OpenMapTiles', 'TomTom', 'Esri']) expect(box.textContent).toContain(p);
    expect(box.children.length).toBe(0);   // yalnız metin düğümü — HTML öğesi yok
  });

  it.each([
    'src/components/map/FullMapView.tsx',
    'src/components/map/MiniMapWidget.tsx',
    'src/components/traffic/TrafficMapMini.tsx',
  ])('%s haritası atfı gösterir', (f) => {
    expect(readFileSync(resolve(f), 'utf8')).toMatch(/<MapAttribution\b/);
  });
});
