/**
 * mapDayNightStyle.test.ts — Harita gündüz/gece stil karar zinciri.
 *
 * Kök neden regresyon koruması:
 *  - MapCore init eskiden sabit gece OSM_STYLE kullanıyordu ('osm-tiles' layer id'si)
 *    → applyMapDayNight ('tiles-layer' arar) no-op kalıyor, gündüz temada harita gece
 *    kalıyordu. Artık init getMapStyle() (tek kaynaklı resolver) kullanmak ZORUNDA.
 *  - FullMapView canvas CSS filtresi autoBrightness.phase'e bağlıydı (farklı sinyal);
 *    artık harita stiliyle aynı mapNight (settings.dayNightMode) sinyaline bağlı.
 *
 * Test kapsamı:
 *  1. theme='light'  → getMapStyle gündüz raster paleti (RASTER_PAINT_DAY + açık bg)
 *  2. theme='dark'   → getMapStyle gece raster paleti  (RASTER_PAINT_NIGHT + grafit bg)
 *  3. auto saat kuralı (isNightHour) — 07–19 gündüz bandı, useDayNightManager ile aynı
 *  4. vector + gündüz → gündüz raster fallback (koyu vektör palet GÜNDÜZ asla dönmez)
 *  5. son çare fallback (getOnlineTileStyle) varsayılanı GÜNDÜZ; night=true ile gece
 *  6. resolver deterministik — minimap/fullmap geçişi stili değiştirmez
 *  7. kaynak sözleşmeleri — MapCore init getMapStyle(), FullMapView filtresi mapNight
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/* ── Mock'lar — DOM'suz ortamda maplibre/serviceWorker kullanılamaz ── */

vi.mock('maplibre-gl', () => ({
  default: { addProtocol: vi.fn(), removeProtocol: vi.fn() },
  Map: class {},
  Marker: class {},
}));

vi.mock('../platform/serviceWorkerManager', () => ({
  getTileCacheStats: vi.fn().mockResolvedValue({ totalTiles: 0, cacheSize: 0 }),
}));

/* ── Import ── */

import type { StyleSpecification } from 'maplibre-gl';
import {
  getMapStyle,
  setMapNight,
  getMapNight,
  isNightHour,
  useMapSourceStore,
} from '../platform/mapSourceManager';
import { getOnlineTileStyle } from '../platform/map/_mapState';
import { RASTER_PAINT_DAY, RASTER_PAINT_NIGHT } from '../platform/mapStyleBuilders';

/* ── Yardımcılar ── */

function tilesPaint(style: StyleSpecification): Record<string, unknown> | undefined {
  const layer = style.layers.find((l) => l.id === 'tiles-layer') as { paint?: Record<string, unknown> } | undefined;
  return layer?.paint;
}

function backgroundColor(style: StyleSpecification): unknown {
  const layer = style.layers.find((l) => l.id === 'background') as { paint?: Record<string, unknown> } | undefined;
  return layer?.paint?.['background-color'];
}

/* ── 1-2. theme → raster palet ───────────────────────────────── */

describe('getMapStyle — gündüz/gece raster paleti', () => {
  it("theme='light' (mapNight=false) → GÜNDÜZ paleti: doğal açık raster + açık arka plan", () => {
    useMapSourceStore.setState({ mapMode: 'road', tileRender: 'raster' });
    setMapNight(false);
    const style = getMapStyle();
    expect(getMapNight()).toBe(false);
    expect(tilesPaint(style)).toEqual({ ...RASTER_PAINT_DAY });
    expect(backgroundColor(style)).toBe('#e9eef3');
  });

  it("theme='dark' (mapNight=true) → GECE paleti: grafit raster + koyu arka plan", () => {
    useMapSourceStore.setState({ mapMode: 'road', tileRender: 'raster' });
    setMapNight(true);
    const style = getMapStyle();
    expect(getMapNight()).toBe(true);
    expect(tilesPaint(style)).toEqual({ ...RASTER_PAINT_NIGHT });
    expect(backgroundColor(style)).toBe('#131822');
  });
});

/* ── 3. auto mod saat kuralı ─────────────────────────────────── */

describe('isNightHour — otomatik gün/gece saat bandı (07–19)', () => {
  it('gündüz saatleri (07–18) → false (day style)', () => {
    for (const h of [7, 9, 12, 15, 18]) {
      expect(isNightHour(h)).toBe(false);
    }
  });

  it('gece saatleri (19–06) → true (night style)', () => {
    for (const h of [19, 21, 23, 0, 3, 6]) {
      expect(isNightHour(h)).toBe(true);
    }
  });
});

/* ── 4. vector + gündüz → raster fallback ────────────────────── */

describe('getMapStyle — vector modda gündüz fallback', () => {
  it("tileRender='vector' + gündüz → koyu vektör DEĞİL, gündüz raster döner", () => {
    useMapSourceStore.setState({ mapMode: 'road', tileRender: 'vector' });
    setMapNight(false);
    const style = getMapStyle();
    // Gündüzde vektör (Automotive Dark) asla dönmez — raster fallback
    expect(style.name).not.toBe('Vector (Automotive Dark)');
    expect(tilesPaint(style)).toEqual({ ...RASTER_PAINT_DAY });
    expect(backgroundColor(style)).toBe('#e9eef3');
  });
});

/* ── 5. Son çare fallback stili ──────────────────────────────── */

describe('getOnlineTileStyle — son çare fallback', () => {
  it('varsayılan (parametresiz) → GÜNDÜZ paleti (fallback asla koyu kurulmaz)', () => {
    const style = getOnlineTileStyle();
    expect(tilesPaint(style)).toEqual({ ...RASTER_PAINT_DAY });
    expect(backgroundColor(style)).toBe('#e9eef3');
  });

  it('night=true → GECE paleti', () => {
    const style = getOnlineTileStyle(true);
    expect(tilesPaint(style)).toEqual({ ...RASTER_PAINT_NIGHT });
    expect(backgroundColor(style)).toBe('#131822');
  });

  it("layer id 'tiles-layer' — applyMapDayNight canlı geçişi fallback haritada da çalışır", () => {
    const style = getOnlineTileStyle();
    expect(style.layers.some((l) => l.id === 'tiles-layer')).toBe(true);
    expect(Object.keys(style.sources)).toContain('map-tiles');
  });
});

/* ── 6. Resolver deterministik — görünüm geçişi stili değiştirmez ── */

describe('getMapStyle — minimap/fullmap geçişinde stil kararlı', () => {
  it('aynı state ile ardışık iki çözümleme birebir aynı stili döner', () => {
    useMapSourceStore.setState({ mapMode: 'road', tileRender: 'raster' });
    setMapNight(false);
    const a = getMapStyle();
    const b = getMapStyle(); // ikinci view (minimap→fullmap) aynı resolver'ı çağırır
    expect(b).toEqual(a);
  });
});

/* ── 7. Kaynak sözleşmeleri — init zinciri + CSS filtre sinyali ── */

describe('kaynak sözleşmeleri — stil karar zinciri tek kaynaklı', () => {
  const mapCoreSrc = readFileSync(
    join(process.cwd(), 'src', 'platform', 'map', 'MapCore.ts'), 'utf-8');
  const fullMapSrc = readFileSync(
    join(process.cwd(), 'src', 'components', 'map', 'FullMapView.tsx'), 'utf-8');
  const layerMgrSrc = readFileSync(
    join(process.cwd(), 'src', 'platform', 'map', 'MapLayerManager.ts'), 'utf-8');

  it('MapCore init stili getMapStyle() resolver\'ından alır (sabit OSM_STYLE değil)', () => {
    expect(mapCoreSrc).toMatch(/const style = getMapStyle\(\)/);
    expect(mapCoreSrc).not.toMatch(/const style = OSM_STYLE/);
  });

  it('MapCore tile-error kurtarması da resolver kullanır', () => {
    expect(mapCoreSrc).toMatch(/switchMapStyle\(map, getMapStyle\(\)\)/);
    expect(mapCoreSrc).not.toMatch(/switchMapStyle\(map, OSM_STYLE\)/);
  });

  it('MapCore son çare fallback gün/gece farkındadır', () => {
    expect(mapCoreSrc).toMatch(/getOnlineTileStyle\(getMapNight\(\)\)/);
  });

  it('FullMapView canvas CSS filtresi mapNight sinyaline bağlı — gündüzde filtre yok', () => {
    expect(fullMapSrc).toMatch(/filter: mapNight\s*\?/);
    expect(fullMapSrc).not.toMatch(/filter: isNight/);
    // Eski farklı sinyal (autoBrightness.phase) filtre kararında kullanılmıyor
    expect(fullMapSrc).not.toMatch(/autoBrightness\.phase === 'night'/);
  });

  it("applyMapDayNight standart 'tiles-layer' id'sini canlı patch'ler", () => {
    expect(layerMgrSrc).toMatch(/'tiles-layer'/);
  });
});
