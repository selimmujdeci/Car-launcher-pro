import maplibregl, { Map as MapLibreMap, GeoJSONSource, Marker } from 'maplibre-gl';
import type { LngLatLike } from 'maplibre-gl';
import { create } from 'zustand';
import { registerOfflineServiceWorker } from './serviceWorkerManager';
import { initializeMapSources, getMapStyle } from './mapSourceManager';
import { logError } from './crashLogger';

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

/**
 * WebGL desteğini kontrol eder.
 * Eski head unit'lerde (MediaTek/Allwinner GPU'suz) WebGL hiç olmayabilir.
 * Returns: true → WebGL kullanılabilir, false → harita açılamaz.
 */
export function isWebGLAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('webgl') ?? canvas.getContext('experimental-webgl');
    if (!ctx) return false;
    // Context'in gerçekten çalıştığını doğrula
    const gl = ctx as WebGLRenderingContext;
    return typeof gl.createShader === 'function';
  } catch {
    return false;
  }
}

export async function initializeMap(
  container: HTMLElement,
  config: MapConfig = { offline: true }
): Promise<MapLibreMap> {
  // WebGL olmayan cihazlarda harita açılamaz — erken hata ver
  if (!isWebGLAvailable()) {
    const msg = 'Bu cihazda WebGL desteklenmiyor. Harita görüntülenemiyor.';
    useMapStore.setState({ error: msg, isReady: false });
    throw new Error(msg);
  }

  if (initInProgress) {
    return new Promise((resolve, reject) => {
      const checkReady = setInterval(() => {
        const map = useMapStore.getState().mapInstance;
        if (map) {
          clearInterval(checkReady);
          clearTimeout(timeoutHandle);
          resolve(map);
        }
      }, 150);
      const timeoutHandle = setTimeout(() => {
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
          try { await initializeOfflineMapStorage(); } catch { /* offline storage unavailable — continue */ }
          try { await initializeOfflineTileServer(); } catch { /* tile server unavailable — continue */ }
          try { initializeTileInterceptor(); } catch { /* interceptor unavailable — continue */ }
        } catch (e) {
          logError('Map:OfflineInit', e);
        }
      }

      try { await initializeMapSources(); } catch (e) {
        logError('Map:SourcesInit', e);
      }

      registerOfflineServiceWorker().catch((err) => {
        logError('Map:ServiceWorker', err);
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
      logError('Map:LibreError', new Error(msg));
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

    // WebGL context loss — harita çökmesini yakala ve yeniden başlat
    map.on('webglcontextlost', () => {
      logError('Map:WebGLContextLost', new Error('WebGL context lost'));
      useMapStore.setState({ isReady: false, tileError: true });

      // 2 saniye sonra haritayı yeniden başlatmayı dene
      setTimeout(() => {
        const currentContainer = useMapStore.getState().mapInstance?.getContainer();
        if (!currentContainer) return;
        destroyMap();
        initializeMap(currentContainer, getMapStyle()).catch((e: unknown) => {
          logError('Map:WebGLRecoveryFailed', e);
        });
      }, 2000);
    });

    map.on('webglcontextrestored', () => {
      useMapStore.setState({ tileError: false });
      map.resize();
    });

    useMapStore.setState({ mapInstance: map, error: null });
    return map;
  } catch (err) {
    logError('Map:InitFallback', err);

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
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
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
  const rawSource = map.getSource(sourceId);
  if (!rawSource) return;
  const source = rawSource as GeoJSONSource;

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
let _inTurnApproach  = false;

/**
 * Navigation (driving) view: vehicle offset lower on screen, map rotates with
 * heading, zoom adapts to speed. Includes 3D pitch, look-ahead offset,
 * and turn approach zoom-in for premium driving feel.
 *
 * @param turnApproachM — metres to next turn (undefined = no active route step)
 */
export function setDrivingView(
  map: MapLibreMap,
  lat: number,
  lng: number,
  heading: number,
  speedKmh: number,
  containerHeight: number,
  turnApproachM?: number,
) {
  if (!map || !map.isStyleLoaded()) return;

  // ── Base zoom (speed-adaptive) with hysteresis ────────────
  const baseZoom = speedToZoom(speedKmh);
  const smoothed = Math.abs(baseZoom - _lastDrivingZoom) > 0.15 ? baseZoom : _lastDrivingZoom;

  // ── Turn approach zoom-in ──────────────────────────────────
  // Boost zoom by up to +1.8 levels as we close within 180 m of the next turn.
  const approaching = turnApproachM !== undefined && turnApproachM > 0 && turnApproachM < 180;
  let targetZoom = smoothed;
  if (approaching) {
    const factor = Math.pow(Math.max(0, (180 - turnApproachM) / 180), 1.5);
    targetZoom   = Math.min(18.5, smoothed + factor * 1.8);
    _inTurnApproach = true;
  } else if (_inTurnApproach) {
    _inTurnApproach = false;
    // zoom naturally recovers to smoothed on next GPS tick
  }
  _lastDrivingZoom = targetZoom;

  // ── Look-ahead offset (camera sees road ahead, not just car) ──
  // Shift center forward along heading: 0 m at rest → 55 m at 110 km/h
  const lookAheadM   = Math.min(55, speedKmh * 0.5);
  const lookAheadDeg = lookAheadM / 111_320;
  const headRad      = (heading * Math.PI) / 180;
  const cosLat       = Math.max(0.001, Math.cos((lat * Math.PI) / 180));
  const centerLat    = lat + lookAheadDeg * Math.cos(headRad);
  const centerLng    = lng + lookAheadDeg * Math.sin(headRad) / cosLat;

  // ── Pitch & padding ───────────────────────────────────────
  const topPad = Math.round(containerHeight * 0.42);
  const pitch  = Math.min(65, 45 + speedKmh * 0.15);

  map.easeTo({
    center:  [centerLng, centerLat],
    bearing: heading,
    zoom:    targetZoom,
    pitch,
    padding:  { top: topPad, bottom: 0, left: 0, right: 0 },
    duration: approaching ? 1200 : 1000,
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

/* ── Rota çizgisi ───────────────────────────────────────────── */

const ROUTE_SRC  = 'car-route';
const ROUTE_GLOW = 'car-route-glow';
const ROUTE_CASE = 'car-route-casing';
const ROUTE_FILL = 'car-route-fill';

/**
 * Haritada premium rota çizgisi göster ya da güncelle.
 * Beyaz dış casing + mavi iç çizgi — GPS marker'ının altında durur.
 */
export function setRouteGeometry(
  map:         MapLibreMap,
  coordinates: [number, number][],
): void {
  if (!map?.isStyleLoaded() || !coordinates.length) return;

  const data = {
    type: 'Feature' as const,
    geometry: { type: 'LineString' as const, coordinates },
    properties: {},
  };

  // Kaynak zaten varsa sadece veri güncelle
  if (map.getSource(ROUTE_SRC)) {
    (map.getSource(ROUTE_SRC) as GeoJSONSource).setData(data);
    return;
  }

  map.addSource(ROUTE_SRC, { type: 'geojson', data });

  // Alt glow katmanı — daha geniş ve yumuşak neon hale efekti (32px, blur 8)
  map.addLayer({
    id: ROUTE_GLOW,
    type: 'line',
    source: ROUTE_SRC,
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': '#3b82f6',
      'line-width': ['interpolate', ['linear'], ['zoom'], 12, 16, 16, 32, 20, 48],
      'line-opacity': 0.15,
      'line-blur': ['interpolate', ['linear'], ['zoom'], 12, 4, 16, 8, 20, 12],
    },
  });

  // Dış beyaz/cam casing (14px)
  map.addLayer({
    id: ROUTE_CASE,
    type: 'line',
    source: ROUTE_SRC,
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': '#ffffff',
      'line-width': ['interpolate', ['linear'], ['zoom'], 12, 6, 16, 14, 20, 20],
      'line-opacity': 0.4,
    },
  });

  // İç ana premium çizgi (8px) — canlı mavi
  map.addLayer({
    id: ROUTE_FILL,
    type: 'line',
    source: ROUTE_SRC,
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': '#2563eb',
      'line-width': ['interpolate', ['linear'], ['zoom'], 12, 3, 16, 8, 20, 12],
      'line-opacity': 1,
    },
  }, ROUTE_CASE);

  // Kullanıcı marker'ının altına taşı: GLOW → CASE → FILL → car-accuracy
  try {
    if (map.getLayer('car-accuracy')) {
      map.moveLayer(ROUTE_GLOW, 'car-accuracy');
      map.moveLayer(ROUTE_CASE, 'car-accuracy');
      map.moveLayer(ROUTE_FILL, 'car-accuracy');
    }
  } catch { /* best effort */ }
}

/** Rota çizgisini ve kaynağını haritadan kaldır. */
export function clearRouteGeometry(map: MapLibreMap): void {
  if (!map) return;
  try {
    if (map.getLayer(ROUTE_FILL)) map.removeLayer(ROUTE_FILL);
    if (map.getLayer(ROUTE_CASE)) map.removeLayer(ROUTE_CASE);
    if (map.getLayer(ROUTE_GLOW)) map.removeLayer(ROUTE_GLOW);
    if (map.getSource(ROUTE_SRC)) map.removeSource(ROUTE_SRC);
  } catch { /* ignore — style may already be reset */ }
  clearTurnFocus();
}

/* ── Dönüş odak noktası (turn focus marker) ────────────────── */

let _turnFocusMarker: Marker | null = null;

/**
 * Bir sonraki dönüş noktasını haritada vurgula (CSS animasyonlu DOM marker).
 * Aynı noktayı tekrar geçince sadece konum güncellenir — yeniden oluşturulmaz.
 */
export function setTurnFocus(map: MapLibreMap, lon: number, lat: number): void {
  if (!map) return;
  if (_turnFocusMarker) {
    _turnFocusMarker.setLngLat([lon, lat]);
    return;
  }
  const el = document.createElement('div');
  el.style.cssText = [
    'width:36px',
    'height:36px',
    'border-radius:50%',
    'background:rgba(245,158,11,0.22)',
    'border:2px solid rgba(245,158,11,0.82)',
    'box-shadow:0 0 18px rgba(245,158,11,0.45),0 0 6px rgba(245,158,11,0.7)',
    'animation:turnFocusPulse 1.4s ease-in-out infinite',
    'pointer-events:none',
  ].join(';');
  _turnFocusMarker = new Marker({ element: el, anchor: 'center' })
    .setLngLat([lon, lat])
    .addTo(map);
}

/** Dönüş odak marker'ını kaldır. */
export function clearTurnFocus(): void {
  if (_turnFocusMarker) {
    _turnFocusMarker.remove();
    _turnFocusMarker = null;
  }
}

export function destroyMap() {
  const map = useMapStore.getState().mapInstance;
  if (map) {
    map.remove();
  }
  useMapStore.setState({ mapInstance: null, isReady: false });
}
