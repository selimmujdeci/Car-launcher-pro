'use client';

import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef } from 'react';
import type { Map as MLMap, GeoJSONSource } from 'maplibre-gl';
import type { LiveVehicle } from '@/types/realtime';
import { TIMING } from '@/lib/constants';

const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
const TURKEY_CENTER: [number, number] = [32.5, 39.5];
const TURKEY_ZOOM = 5.8;

interface Props {
  vehicles: LiveVehicle[];
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  followMode?: boolean;
  className?: string;
}

interface VehicleFeature {
  type: 'Feature';
  id: string;
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: {
    id: string;
    plate: string;
    driver: string;
    speed: number;
    status: string;
    selected: number;
  };
}

function buildGeoJSON(vehicles: LiveVehicle[], selectedId?: string | null) {
  return {
    type: 'FeatureCollection' as const,
    features: vehicles
      .filter((v) => v.lat !== 0 && v.lng !== 0)
      .map<VehicleFeature>((v) => ({
        type: 'Feature',
        id: v.id,
        geometry: { type: 'Point', coordinates: [v.lng, v.lat] },
        properties: {
          id: v.id,
          plate: v.plate,
          driver: v.driver,
          speed: Math.round(v.speed),
          status: v.status,
          selected: v.id === selectedId ? 1 : 0,
        },
      })),
  };
}

export default function LiveMap({ vehicles, selectedId, onSelect, followMode, className }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef       = useRef<MLMap | null>(null);
  const loadedRef    = useRef(false);

  // Keep latest callbacks/values in refs to avoid stale closures in event handlers
  const onSelectRef   = useRef(onSelect);
  const vehiclesRef   = useRef(vehicles);
  const selectedIdRef = useRef(selectedId);
  const followModeRef = useRef(followMode);

  onSelectRef.current   = onSelect;
  vehiclesRef.current   = vehicles;
  selectedIdRef.current = selectedId;
  followModeRef.current = followMode;

  // ── Map initialisation — runs once ────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;

    import('maplibre-gl').then((ml) => {
      if (cancelled || !containerRef.current) return;

      const map = new ml.Map({
        container: containerRef.current,
        style: MAP_STYLE,
        center: TURKEY_CENTER,
        zoom: TURKEY_ZOOM,
        attributionControl: false,
        maxZoom: 18,
      }) as unknown as MLMap;

      mapRef.current = map;

      (map as unknown as { addControl(c: unknown, pos?: string): void }).addControl(
        new ml.AttributionControl({ compact: true }),
        'bottom-right',
      );
      (map as unknown as { addControl(c: unknown, pos?: string): void }).addControl(
        new ml.NavigationControl({ showCompass: false }),
        'bottom-right',
      );

      map.on('load', () => {
        if (cancelled) { map.remove(); return; }
        loadedRef.current = true;

        // Resize handling
        const resizeObserver = new ResizeObserver(() => {
          if (mapRef.current) mapRef.current.resize();
        });
        if (containerRef.current) resizeObserver.observe(containerRef.current);

        map.addSource('vehicles', {
          type: 'geojson',
          data: buildGeoJSON(vehiclesRef.current, selectedIdRef.current),
        });

        // Alarm halo
        map.addLayer({
          id: 'vehicle-halo',
          type: 'circle',
          source: 'vehicles',
          filter: ['==', ['get', 'status'], 'alarm'],
          paint: {
            'circle-radius': 20,
            'circle-color': '#f87171',
            'circle-opacity': 0.22,
            'circle-blur': 0.7,
          },
        });

        // Main dots
        map.addLayer({
          id: 'vehicles',
          type: 'circle',
          source: 'vehicles',
          paint: {
            'circle-radius': ['case', ['==', ['get', 'selected'], 1], 11, 7],
            'circle-color': [
              'match', ['get', 'status'],
              'online', '#34d399',
              'alarm',  '#f87171',
              /* offline */ '#ffffff33',
            ],
            'circle-stroke-width': ['case', ['==', ['get', 'selected'], 1], 2.5, 1.5],
            'circle-stroke-color': [
              'match', ['get', 'status'],
              'online', '#6ee7b7',
              'alarm',  '#fca5a5',
              '#ffffff22',
            ],
          },
        });

        // Plate labels — visible from zoom 10+
        map.addLayer({
          id: 'vehicle-labels',
          type: 'symbol',
          source: 'vehicles',
          minzoom: 10,
          layout: {
            'text-field': ['get', 'plate'],
            'text-size': 11,
            'text-offset': [0, -1.5],
            'text-anchor': 'bottom',
            'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'],
          },
          paint: {
            'text-color': '#ffffff',
            'text-halo-color': '#00000099',
            'text-halo-width': 1.2,
          },
        });

        // Click vehicle dot → select
        map.on('click', 'vehicles', (e) => {
          const id = (e as unknown as { features?: Array<{ properties?: { id?: string } }> })
            .features?.[0]?.properties?.id;
          onSelectRef.current?.(id ?? null);
        });

        // Click empty map → deselect
        map.on('click', (e) => {
          const features = map.queryRenderedFeatures(
            (e as unknown as { point: { x: number; y: number } }).point as unknown as [number, number],
            { layers: ['vehicles'] },
          );
          if (!features.length) onSelectRef.current?.(null);
        });

        map.on('mouseenter', 'vehicles', () => {
          (map.getCanvas() as HTMLCanvasElement).style.cursor = 'pointer';
        });
        map.on('mouseleave', 'vehicles', () => {
          (map.getCanvas() as HTMLCanvasElement).style.cursor = '';
        });
      });
    });

    return () => {
      cancelled = true;
      loadedRef.current = false;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Update GeoJSON when vehicles or selection changes ─────────────────
  useEffect(() => {
    if (!loadedRef.current || !mapRef.current) return;
    const source = mapRef.current.getSource('vehicles') as GeoJSONSource | undefined;
    source?.setData(buildGeoJSON(vehicles, selectedId) as Parameters<GeoJSONSource['setData']>[0]);
  }, [vehicles, selectedId]);

  // ── Follow mode — easeTo selected vehicle ─────────────────────────────
  useEffect(() => {
    if (!followMode || !selectedId || !loadedRef.current || !mapRef.current) return;
    const v = vehicles.find((v) => v.id === selectedId);
    if (!v || v.lat === 0) return;
    mapRef.current.easeTo({
      center: [v.lng, v.lat],
      zoom: Math.max(mapRef.current.getZoom(), 13),
      duration: TIMING.MAP_THROTTLE_MS,
    });
  }, [followMode, selectedId, vehicles]);

  return <div ref={containerRef} className={className} style={{ background: '#0d1117' }} />;
}
