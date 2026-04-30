/**
 * useRadarMapLayer.ts — Eagle Eye MapLibre GeoJSON symbol layer.
 *
 * Adds a 'ee-radar-src' GeoJSON source and 'ee-radar-sym' symbol layer.
 * Icons are canvas-generated (48×48). Re-registers on every style.load so
 * the layer survives road/satellite/hybrid style switches.
 */

import { useEffect, useRef }                      from 'react';
import type { Map as MapLibreMap, GeoJSONSource } from 'maplibre-gl';
import { useRadarStore }                          from '../platform/radar/radarStore';
import type { RadarPoint }                        from '../platform/radar/radarStore';

const SOURCE_ID = 'ee-radar-src';
const LAYER_ID  = 'ee-radar-sym';
const SZ        = 48; // canvas size in CSS pixels

// ── Icon descriptors ──────────────────────────────────────────────────────────

interface IconDef { type: string; color: string; label: string }

const ICON_DEFS: IconDef[] = [
  { type: 'speed',    color: '#f97316', label: 'H' },
  { type: 'redlight', color: '#ef4444', label: 'K' },
  { type: 'mobile',   color: '#eab308', label: 'M' },
  { type: 'average',  color: '#3b82f6', label: 'Ø' },
];

// ── Canvas icon generation ────────────────────────────────────────────────────

function makeIcon(color: string, label: string, live: boolean): ImageData {
  const canvas    = document.createElement('canvas');
  canvas.width    = SZ;
  canvas.height   = SZ;
  const ctx       = canvas.getContext('2d')!;
  const cx        = SZ / 2;
  const r         = SZ / 2 - 3;

  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur  = 5;
  ctx.beginPath();
  ctx.arc(cx, cx, r, 0, 2 * Math.PI);
  ctx.fillStyle = color;
  ctx.fill();

  ctx.shadowBlur  = 0;
  ctx.lineWidth   = live ? 3 : 2;
  ctx.strokeStyle = live ? '#ffffff' : 'rgba(255,255,255,0.55)';
  if (live) ctx.setLineDash([4, 3]);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle    = '#ffffff';
  ctx.font         = `bold ${Math.round(SZ * 0.38)}px sans-serif`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, cx, cx + 1);

  return ctx.getImageData(0, 0, SZ, SZ);
}

function registerIcons(map: MapLibreMap): void {
  for (const { type, color, label } of ICON_DEFS) {
    if (!map.hasImage(`ee-${type}`))
      map.addImage(`ee-${type}`, makeIcon(color, label, false));
    if (!map.hasImage(`ee-${type}-live`))
      map.addImage(`ee-${type}-live`, makeIcon(color, label, true));
  }
}

// ── GeoJSON builder ───────────────────────────────────────────────────────────

interface RFeature {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: { radarType: string; isLive: boolean; confidence: number };
}
interface RCollection { type: 'FeatureCollection'; features: RFeature[] }

function toGeoJSON(points: RadarPoint[]): RCollection {
  return {
    type: 'FeatureCollection',
    features: points.map((p) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
      properties: {
        radarType:  p.type,
        isLive:     p.isLive === true,
        confidence: p.confidenceScore ?? 1,
      },
    })),
  };
}

// ── Layer setup ───────────────────────────────────────────────────────────────

function setupLayer(map: MapLibreMap, points: RadarPoint[]): void {
  registerIcons(map);
  if (map.getSource(SOURCE_ID)) return; // already present (should not happen after style.load)

  map.addSource(SOURCE_ID, {
    type: 'geojson',
    data: toGeoJSON(points) as Parameters<GeoJSONSource['setData']>[0],
  });

  map.addLayer({
    id:     LAYER_ID,
    type:   'symbol',
    source: SOURCE_ID,
    layout: {
      'icon-image': [
        'concat',
        'ee-',
        ['get', 'radarType'],
        ['case', ['==', ['get', 'isLive'], true], '-live', ''],
      ],
      'icon-size':          0.85,
      'icon-allow-overlap': false,
      'icon-padding':       4,
      // Lower sort-key = higher placement priority when overlap is off.
      // Live high-confidence reports take precedence over static.
      'symbol-sort-key': [
        'case',
        ['==', ['get', 'isLive'], true],
        ['*', -1, ['get', 'confidence']],
        0,
      ],
    },
  });
}

// ── Public hook ───────────────────────────────────────────────────────────────

export function useRadarMapLayer(
  mapHandle: { current: MapLibreMap | null },
  mapStyleReady: boolean,
): void {
  const allPoints    = useRadarStore((s) => s.allPoints);
  const pointsRef    = useRef(allPoints);
  pointsRef.current  = allPoints;

  // Register source + layer once the map style is ready.
  // Re-register on style.load because every style switch wipes custom sources/layers.
  useEffect(() => {
    const map = mapHandle.current;
    if (!map || !mapStyleReady) return;

    function onStyleLoad(): void {
      const m = mapHandle.current;
      if (m) setupLayer(m, pointsRef.current);
    }

    setupLayer(map, pointsRef.current);
    map.on('style.load', onStyleLoad);
    return () => { map.off('style.load', onStyleLoad); };
  }, [mapStyleReady]); // mapHandle is a stable ref — omitting from deps is intentional

  // Push updated GeoJSON into the source whenever allPoints changes
  useEffect(() => {
    const map = mapHandle.current;
    if (!map || !mapStyleReady) return;
    const src = map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
    if (!src) return;
    src.setData(toGeoJSON(allPoints) as Parameters<GeoJSONSource['setData']>[0]);
  }, [allPoints, mapStyleReady]); // mapHandle is a stable ref
}
