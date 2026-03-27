import maplibregl, { Map as MapLibreMap, GeoJSONSource } from 'maplibre-gl';
import type { LngLatLike } from 'maplibre-gl';
import { create } from 'zustand';
import { registerOfflineServiceWorker } from './serviceWorkerManager';
import { initializeMapSources, getMapStyle } from './mapSourceManager';

/**
 * Detect if running on Capacitor native platform
 */
function isNativePlatform(): boolean {
  try {
    const cap = (window as any).Capacitor;
    return typeof cap?.isNativePlatform === 'function' && cap.isNativePlatform();
  } catch {
    return false;
  }
}

export interface MapConfig {
  offline: boolean;
  style?: string;
  tileUrl?: string;
}

interface MapState {
  mapInstance: MapLibreMap | null;
  isReady: boolean;
  error: string | null;
  tileError: boolean;
  drivingMode: boolean;
}

const useMapStore = create<MapState>(() => ({
  mapInstance: null,
  isReady: false,
  error: null,
  tileError: false,
  drivingMode: false,
}));

let initInProgress = false;
let offlineInitialized = false;

const getOnlineTileStyle = (): maplibregl.StyleSpecification => ({
  version: 8,
  name: 'OSM Online',
  sources: {
    'osm-tiles': {
      type: 'raster' as const,
      tiles: [
        'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
        'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
        'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png',
      ],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
      minzoom: 0,
      maxzoom: 19,
    },
  },
  layers: [
    {
      id: 'background',
      type: 'background' as const,
      paint: { 'background-color': '#0d1628' },
    },
    {
      id: 'osm-layer',
      type: 'raster' as const,
      source: 'osm-tiles',
      paint: { 'raster-opacity': 1 },
    },
  ],
});

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
    // Initialize offline systems on first use
    if (config.offline && !offlineInitialized) {
      // Only run Capacitor-dependent offline init on native platform
      // On web, these monkey-patch fetch with Filesystem calls that always fail
      if (isNativePlatform()) {
        try {
          const { initializeOfflineMapStorage, initializeTileInterceptor } = await import('./offlineMapService');
          const { initializeOfflineTileServer } = await import('./offlineTileServer');
          try { await initializeOfflineMapStorage(); } catch (e) {
            console.warn('Offline map storage init skipped:', e);
          }
          try { await initializeOfflineTileServer(); } catch (e) {
            console.warn('Offline tile server init skipped:', e);
          }
          try { initializeTileInterceptor(); } catch (e) {
            console.warn('Tile interceptor init skipped:', e);
          }
        } catch (e) {
          console.warn('Native offline init skipped:', e);
        }
      }

      try { await initializeMapSources(); } catch (e) {
        console.warn('Map sources init skipped:', e);
      }

      registerOfflineServiceWorker().catch((err) => {
        console.warn('Service worker registration failed:', err);
      });

      offlineInitialized = true;
    }

    // Use resolved tile source: local > cached > online
    // After initializeMapSources() the active source is determined
    const style = getMapStyle() as maplibregl.StyleSpecification;

    // Default: Turkey center
    const TURKEY_CENTER: [number, number] = [35, 39];
    const TURKEY_ZOOM = 6;

    const map = new MapLibreMap({
      container,
      style,
      center: TURKEY_CENTER,
      zoom: TURKEY_ZOOM,
      pitch: 0,
      bearing: 0,
      antialias: true,
      attributionControl: false,
    });

    map.on('style.load', () => {
      useMapStore.setState({ isReady: true });
    });

    let tileFailCount = 0;
    map.on('error', (e) => {
      const msg = e.error?.message || '';
      // Track tile load failures for UI feedback
      if (msg.includes('404') || msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('403')) {
        tileFailCount++;
        // After multiple tile failures, flag it so UI can show a message
        if (tileFailCount >= 4 && !useMapStore.getState().tileError) {
          useMapStore.setState({ tileError: true });
        }
        return;
      }
      console.warn('MapLibre error:', msg);
    });

    // Reset tileError on successful tile load
    map.on('data', (e) => {
      if (e.dataType === 'source' && map.isSourceLoaded('map-tiles')) {
        if (useMapStore.getState().tileError) {
          useMapStore.setState({ tileError: false });
        }
        tileFailCount = 0;
      }
    });

    useMapStore.setState({ mapInstance: map, error: null });
    return map;
  } catch (err) {
    console.warn('Map init error, falling back to empty dark map:', err);

    // Last-resort fallback: create a minimal dark map
    try {
      const fallbackMap = new MapLibreMap({
        container,
        style: getOnlineTileStyle(),
        center: [35, 39],
        zoom: 6,
        attributionControl: false,
      });

      fallbackMap.on('error', () => {}); // suppress all errors on fallback
      useMapStore.setState({ mapInstance: fallbackMap, error: null });
      return fallbackMap;
    } catch (fallbackErr) {
      const msg = fallbackErr instanceof Error ? fallbackErr.message : 'Map init failed';
      useMapStore.setState({ error: msg });
      throw fallbackErr;
    }
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

const HEADING_IMAGE_ID = 'heading-cone';
const USER_LAYERS = [
  'user-accuracy',
  'user-heading-cone',
  'user-glow-outer',
  'user-glow',
  'user-glow-core',
  'user-marker',
  'user-dot',
];

function ensureHeadingImage(map: MapLibreMap) {
  if (map.hasImage(HEADING_IMAGE_ID)) return;

  const size = 96;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const cx = size / 2;

  // Upward-pointing direction cone with curved base
  ctx.beginPath();
  ctx.moveTo(cx, 6);
  ctx.lineTo(cx + 22, size * 0.58);
  ctx.quadraticCurveTo(cx, size * 0.46, cx - 22, size * 0.58);
  ctx.closePath();

  const grad = ctx.createLinearGradient(cx, 6, cx, size * 0.58);
  grad.addColorStop(0, 'rgba(96, 165, 250, 0.95)');
  grad.addColorStop(0.5, 'rgba(59, 130, 246, 0.45)');
  grad.addColorStop(1, 'rgba(59, 130, 246, 0.0)');
  ctx.fillStyle = grad;
  ctx.fill();

  const imgData = ctx.getImageData(0, 0, size, size);
  map.addImage(HEADING_IMAGE_ID, {
    width: size,
    height: size,
    data: new Uint8Array(imgData.data.buffer),
  });
}

export function addUserMarker(
  map: MapLibreMap,
  latitude: number,
  longitude: number,
  heading?: number
) {
  if (!map) return;

  const sourceId = 'user-location';

  // Remove old layers + source
  if (map.getSource(sourceId)) {
    for (const id of USER_LAYERS) {
      if (map.getLayer(id)) map.removeLayer(id);
    }
    map.removeSource(sourceId);
  }

  ensureHeadingImage(map);

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
    data: { type: 'FeatureCollection', features: [feature] },
  } as any);

  // 1. Accuracy ring — subtle, zoom-adaptive
  map.addLayer({
    id: 'user-accuracy',
    type: 'circle',
    source: sourceId,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 20, 14, 50, 18, 85],
      'circle-color': '#60a5fa',
      'circle-opacity': 0.08,
      'circle-stroke-width': 1,
      'circle-stroke-color': '#60a5fa',
      'circle-stroke-opacity': 0.15,
    },
  });

  // 2. Ultra Outer Bloom — very soft, wide glow
  map.addLayer({
    id: 'user-glow-outer',
    type: 'circle',
    source: sourceId,
    paint: {
      'circle-radius': 48,
      'circle-color': '#3b82f6',
      'circle-opacity': 0.15,
      'circle-blur': 1.8,
    },
  });

  // 3. Inner Bloom — strong neon glow
  map.addLayer({
    id: 'user-glow',
    type: 'circle',
    source: sourceId,
    paint: {
      'circle-radius': 24,
      'circle-color': '#60a5fa',
      'circle-opacity': 0.35,
      'circle-blur': 0.8,
    },
  });

  // 4. Core Neon Glow — sharp center glow
  map.addLayer({
    id: 'user-glow-core',
    type: 'circle',
    source: sourceId,
    paint: {
      'circle-radius': 14,
      'circle-color': '#93c5fd',
      'circle-opacity': 0.6,
      'circle-blur': 0.2,
    },
  });

  // 5. Heading cone — rotated symbol, larger for visibility
  map.addLayer({
    id: 'user-heading-cone',
    type: 'symbol',
    source: sourceId,
    layout: {
      'icon-image': HEADING_IMAGE_ID,
      'icon-size': ['interpolate', ['linear'], ['zoom'], 8, 0.45, 14, 0.78, 18, 1.1],
      'icon-rotate': ['get', 'heading'],
      'icon-rotation-alignment': 'map',
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      'icon-offset': [0, -35],
    },
  });

  // 6. Main marker — sleek blue with thin sharp border
  map.addLayer({
    id: 'user-marker',
    type: 'circle',
    source: sourceId,
    paint: {
      'circle-radius': 10,
      'circle-color': '#2563eb',
      'circle-opacity': 1,
      'circle-stroke-width': 2,
      'circle-stroke-color': '#ffffff',
    },
  });

  // 7. Inner bright center dot
  map.addLayer({
    id: 'user-dot',
    type: 'circle',
    source: sourceId,
    paint: {
      'circle-radius': 3.5,
      'circle-color': '#ffffff',
      'circle-opacity': 1,
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

/**
 * Switch the map to a new style. Caller must re-add user marker after
 * the 'style.load' event fires (all sources/layers are removed on setStyle).
 */
export function switchMapStyle(map: MapLibreMap, style: any) {
  if (!map) return;
  map.setStyle(style);
}

// ── Driving mode ─────────────────────────────────────────────

/** km/h → zoom level (smooth car-optimized curve) */
function speedToZoom(speedKmh: number): number {
  // 0-40 km/h: detailed street view (16.5-15.5)
  // 40-100 km/h: city/district view (15.5-13.5)
  // 100+ km/h: highway/regional view (13.5-12.0)
  if (speedKmh <= 0) return 16.5;
  return Math.max(12.0, Math.min(16.5, 16.5 - (speedKmh * 0.045)));
}

let _lastDrivingZoom = 15.5;

/**
 * Navigation (driving) view: vehicle offset lower on screen, map rotates with
 * heading, zoom adapts to speed. Includes 3D pitch for perspective.
 */
export function setDrivingView(
  map: MapLibreMap,
  lat: number,
  lng: number,
  heading: number,
  speedKmh: number,
  containerHeight: number,
) {
  if (!map || !map.isStyleLoaded()) return;

  const targetZoom = speedToZoom(speedKmh);
  // Hysteresis: only commit zoom change when difference is meaningful to prevent jitter
  const zoom = Math.abs(targetZoom - _lastDrivingZoom) > 0.15
    ? targetZoom
    : _lastDrivingZoom;
  _lastDrivingZoom = zoom;

  // Top padding pushes the visual center downward (lower ~65% of viewport)
  const topPad = Math.round(containerHeight * 0.42);
  
  // 3D Tilt: increased at higher speeds for better horizon view
  const pitch = Math.min(65, 45 + (speedKmh * 0.15));

  map.easeTo({
    center: [lng, lat],
    bearing: heading,
    zoom,
    pitch,
    padding: { top: topPad, bottom: 0, left: 0, right: 0 },
    duration: 1000,
    essential: true,
  });
}

/**
 * Reset bearing, zoom, pitch and padding after leaving driving mode.
 */
export function exitDrivingView(map: MapLibreMap) {
  if (!map) return;
  _lastDrivingZoom = 15.5;
  map.easeTo({
    bearing: 0,
    zoom: 15.5,
    pitch: 0,
    padding: { top: 0, bottom: 0, left: 0, right: 0 },
    duration: 800,
  });
}

export function setDrivingMode(enabled: boolean) {
  useMapStore.setState({ drivingMode: enabled });
}

export function useDrivingMode() {
  return useMapStore((s) => s.drivingMode);
}

export function destroyMap() {
  const map = useMapStore.getState().mapInstance;
  if (map) {
    map.remove();
  }
  useMapStore.setState({ mapInstance: null, isReady: false });
}
