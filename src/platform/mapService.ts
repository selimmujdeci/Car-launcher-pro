import maplibregl, { Map as MapLibreMap, GeoJSONSource } from 'maplibre-gl';
import type { LngLatLike } from 'maplibre-gl';
import { create } from 'zustand';

export interface MapConfig {
  offline: boolean;
  style?: string;
  tileUrl?: string;
}

interface MapState {
  mapInstance: MapLibreMap | null;
  isReady: boolean;
  error: string | null;
}

const useMapStore = create<MapState>(() => ({
  mapInstance: null,
  isReady: false,
  error: null,
}));

let initInProgress = false;

const DEFAULT_OFFLINE_STYLE = {
  version: 8,
  name: 'Offline Map',
  metadata: { 'mapbox:autocomposite': false },
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://a.tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [
    {
      id: 'osm-tiles',
      type: 'raster',
      source: 'osm',
      paint: { 'raster-opacity': 1 },
    },
  ],
} as const;

export async function initializeMap(
  container: HTMLElement,
  config: MapConfig = { offline: true }
): Promise<MapLibreMap> {
  if (initInProgress) {
    return new Promise((resolve, reject) => {
      const checkReady = setInterval(() => {
        const map = useMapStore.getState().mapInstance;
        if (map) {
          clearInterval(checkReady);
          resolve(map);
        }
      }, 50);
      setTimeout(() => {
        clearInterval(checkReady);
        reject(new Error('Map init timeout'));
      }, 5000);
    });
  }

  const existing = useMapStore.getState().mapInstance;
  if (existing && existing.getContainer() === container) {
    return existing;
  }

  initInProgress = true;

  try {
    const style = config.style ? { version: 8, sources: {}, layers: [] } : DEFAULT_OFFLINE_STYLE;

    const map = new MapLibreMap({
      container,
      style: style as maplibregl.StyleSpecification,
      center: [0, 0],
      zoom: 3,
      pitch: 0,
      bearing: 0,
      antialias: true,
      attributionControl: false,
    });

    map.on('style.load', () => {
      useMapStore.setState({ isReady: true });
    });

    map.on('error', (e) => {
      useMapStore.setState({ error: e.error?.message || 'Map error' });
    });

    useMapStore.setState({ mapInstance: map, error: null });
    return map;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Map init failed';
    useMapStore.setState({ error: msg });
    throw err;
  } finally {
    initInProgress = false;
  }
}

export function setMapCenter(map: MapLibreMap, center: LngLatLike, zoom?: number, animated = true) {
  if (!map) return;

  if (animated) {
    map.flyTo({
      center,
      zoom: zoom ?? map.getZoom(),
      duration: 1000,
    });
  } else {
    map.setCenter(center);
    if (zoom !== undefined) map.setZoom(zoom);
  }
}

export function setMapHeading(map: MapLibreMap, heading: number) {
  if (!map || !isFinite(heading)) return;
  map.setBearing(heading);
}

export function addUserMarker(
  map: MapLibreMap,
  latitude: number,
  longitude: number,
  heading?: number
) {
  if (!map) return;

  const sourceId = 'user-location';
  const markerLayerId = 'user-marker';
  const headingLayerId = 'user-heading';

  // Remove old markers if exist
  if (map.getSource(sourceId)) {
    if (map.getLayer(markerLayerId)) map.removeLayer(markerLayerId);
    if (map.getLayer(headingLayerId)) map.removeLayer(headingLayerId);
    map.removeSource(sourceId);
  }

  const feature = {
    type: 'Feature' as const,
    geometry: {
      type: 'Point' as const,
      coordinates: [longitude, latitude],
    },
    properties: { heading: heading ?? 0 },
  };

  map.addSource(sourceId, {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: [feature],
    },
  } as any);

  // Circle outline (heading indicator)
  if (isFinite(heading || 0)) {
    map.addLayer({
      id: headingLayerId,
      type: 'circle',
      source: sourceId,
      paint: {
        'circle-radius': 12,
        'circle-color': '#3b82f6',
        'circle-opacity': 0.2,
        'circle-stroke-width': 2,
        'circle-stroke-color': '#3b82f6',
      },
    });
  }

  // Center marker
  map.addLayer({
    id: markerLayerId,
    type: 'circle',
    source: sourceId,
    paint: {
      'circle-radius': 6,
      'circle-color': '#3b82f6',
      'circle-opacity': 1,
      'circle-stroke-width': 2,
      'circle-stroke-color': '#ffffff',
    },
  });
}

export function updateUserMarker(latitude: number, longitude: number, heading?: number) {
  const map = useMapStore.getState().mapInstance;
  if (!map) return;

  const sourceId = 'user-location';
  const source = map.getSource(sourceId) as GeoJSONSource;
  if (!source) return;

  const feature = {
    type: 'Feature' as const,
    geometry: {
      type: 'Point' as const,
      coordinates: [longitude, latitude],
    },
    properties: { heading: heading ?? 0 },
  };

  source.setData({
    type: 'FeatureCollection',
    features: [feature],
  } as any);
}

export function getMapInstance(): MapLibreMap | null {
  return useMapStore.getState().mapInstance;
}

export function useMapState() {
  return useMapStore();
}

export function destroyMap() {
  const map = useMapStore.getState().mapInstance;
  if (map) {
    map.remove();
  }
  useMapStore.setState({ mapInstance: null, isReady: false });
}
