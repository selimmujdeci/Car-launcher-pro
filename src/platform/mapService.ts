import maplibregl, { Map as MapLibreMap, GeoJSONSource, Marker } from 'maplibre-gl';
import type { LngLatLike } from 'maplibre-gl';
import { create } from 'zustand';
import { registerOfflineServiceWorker } from './serviceWorkerManager';
import { initializeMapSources, getMapStyle, handleSatelliteTileError, setActiveMapSource, hasOfflineMapData } from './mapSourceManager';
import { logError } from './crashLogger';

declare global {
  interface Window {
    Capacitor?: { isNativePlatform(): boolean };
  }
}

/**
 * Detect if running on Capacitor native platform
 */
function isNativePlatform(): boolean {
  try {
    return typeof window.Capacitor?.isNativePlatform === 'function'
      && window.Capacitor.isNativePlatform();
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

let offlineInitialized = false;
let _initPromise:    Promise<MapLibreMap> | null = null;
let _initContainer:  HTMLElement | null          = null; // container being initialised

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
      paint: {
        'raster-opacity': 1,
        'raster-contrast': 0.7,
        'raster-brightness-min': 0,
        'raster-brightness-max': 0.22,
        'raster-saturation': -1,
        'raster-hue-rotate': 195,
      },
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

export function initializeMap(
  container: HTMLElement,
  config: MapConfig = { offline: true }
): Promise<MapLibreMap> {
  // WebGL olmayan cihazlarda harita açılamaz — erken hata ver
  if (!isWebGLAvailable()) {
    const msg = 'Bu cihazda WebGL desteklenmiyor. Harita görüntülenemiyor.';
    useMapStore.setState({ error: msg, isReady: false });
    return Promise.reject(new Error(msg));
  }

  // ── Idempotency ──────────────────────────────────────────────────────────
  if (_initPromise) {
    // Same container requested again — share the in-flight promise
    if (_initContainer === container) return _initPromise;
    // Different container — wait for current init to settle, then re-enter
    return _initPromise.then(() => initializeMap(container, config));
  }

  const existing = useMapStore.getState().mapInstance;
  if (existing) {
    if (existing.getContainer() === container) {
      // Already initialised for this container — return immediately
      return Promise.resolve(existing);
    }
    // Different container: destroy old instance (zombie prevention)
    destroyMap();
  }

  _initContainer  = container;

  _initPromise = Promise.race<MapLibreMap>([
    _initCore(container, config),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Map init timeout (12s)')), 12_000)
    ),
  ]).finally(() => {
    _initPromise    = null;
    _initContainer  = null;
  });

  return _initPromise;
}

async function _initCore(
  container: HTMLElement,
  config: MapConfig,
): Promise<MapLibreMap> {
  try {
    // Initialize offline systems on first use
    if (config.offline && !offlineInitialized) {
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

    // Offline tile yoksa (telefon/ilk kurulum) direkt online'a geç — siyah ekran önlenir
    if (!hasOfflineMapData()) {
      setActiveMapSource('online');
    }

    const style = getMapStyle() as maplibregl.StyleSpecification;
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
    let _satelliteFailCount = 0;
    map.on('error', (e) => {
      const msg = e.error?.message || '';
      if (msg.includes('404') || msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('403')) {
        tileFailCount++;
        if (msg.includes('arcgisonline') || msg.includes('arcgis')) {
          _satelliteFailCount++;
          if (_satelliteFailCount >= 3) { _satelliteFailCount = 0; handleSatelliteTileError(); }
        }
        if (tileFailCount >= 4 && !useMapStore.getState().tileError) {
          useMapStore.setState({ tileError: true });
          setTimeout(() => {
            if (setActiveMapSource('online')) {
              switchMapStyle(map, getMapStyle());
              tileFailCount = 0;
            }
          }, 3_000);
        }
        return;
      }
      logError('Map:LibreError', new Error(msg));
    });

    map.on('data', (e) => {
      if (e.dataType === 'source' && map.isSourceLoaded('map-tiles')) {
        if (useMapStore.getState().tileError) {
          useMapStore.setState({ tileError: false });
        }
        tileFailCount = 0;
      }
    });

    // WebGL context loss — sessiz yeniden başlatma (Mali-400 ısınma koruması)
    let _ctxLostTimer: ReturnType<typeof setTimeout> | null = null;
    let _ctxRecoveryAttempts = 0;
    const MAX_RECOVERY_ATTEMPTS = 3;

    map.on('webglcontextlost', (e) => {
      if (e && typeof (e as unknown as { preventDefault?: () => void }).preventDefault === 'function') {
        (e as unknown as { preventDefault: () => void }).preventDefault();
      }
      logError('Map:WebGLContextLost', new Error('WebGL context lost'));
      useMapStore.setState({ isReady: false, tileError: true });

      const savedCenter   = map.getCenter();
      const savedZoom     = map.getZoom();
      const savedBearing  = map.getBearing();
      const savedPitch    = map.getPitch();
      const recoveryEl    = map.getContainer(); // param 'container' gizlemesini önle

      _ctxLostTimer = setTimeout(() => {
        _ctxLostTimer = null;
        if (_ctxRecoveryAttempts >= MAX_RECOVERY_ATTEMPTS) {
          logError('Map:WebGLRecoveryGiveUp', new Error('Max recovery attempts reached'));
          return;
        }

        _ctxRecoveryAttempts++;
        const backoffMs = Math.pow(2, _ctxRecoveryAttempts) * 1000;

        setTimeout(() => {
          if (!recoveryEl || !document.body.contains(recoveryEl)) return;
          destroyMap();
          initializeMap(recoveryEl, config).then((newMap) => {
            newMap.once('style.load', () => {
              newMap.jumpTo({
                center:  savedCenter,
                zoom:    savedZoom,
                bearing: savedBearing,
                pitch:   savedPitch,
              });
              _ctxRecoveryAttempts = 0;
            });
          }).catch((e: unknown) => {
            logError('Map:WebGLRecoveryFailed', e);
          });
        }, backoffMs);
      }, 1500);
    });

    map.on('webglcontextrestored', () => {
      if (_ctxLostTimer !== null) {
        clearTimeout(_ctxLostTimer);
        _ctxLostTimer = null;
      }
      _ctxRecoveryAttempts = 0;
      useMapStore.setState({ tileError: false, isReady: true });
      map.resize();
    });

    useMapStore.setState({ mapInstance: map, error: null });
    return map;
  } catch (err) {
    logError('Map:InitFallback', err);

    // Son çare fallback: minimal koyu harita
    try {
      const fallbackMap = new MapLibreMap({
        container,
        style: getOnlineTileStyle(),
        center: [35, 39],
        zoom: 6,
        attributionControl: false,
      });

      fallbackMap.on('error', () => {});
      useMapStore.setState({ mapInstance: fallbackMap, error: null });
      return fallbackMap;
    } catch (fallbackErr) {
      const msg = fallbackErr instanceof Error ? fallbackErr.message : 'Map init failed';
      useMapStore.setState({ error: msg });
      throw fallbackErr;
    }
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
  // B38: WebGL context loss sonrası yeni haritada source yok — yeniden ekle
  if (!rawSource) {
    if (map.isStyleLoaded()) addUserMarker(map, latitude, longitude, heading);
    return;
  }
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
 * Switch the map to a new style.
 * setStyle() removes ALL sources and layers. After style.load fires:
 *   - isReady is reset to true via the persistent style.load listener in _initCore
 *   - _cachedRoute is replayed automatically here so the route survives style switches
 * Caller is still responsible for re-adding the user marker.
 */
export function switchMapStyle(map: MapLibreMap, style: any, retryCount = 0) {
  if (!map) return;
  useMapStore.setState({ isReady: false });

  const onError = (e: any) => {
    logError('Map:StyleSwitchError', e.error || new Error('Style load failed'));
    if (retryCount < 1) {
      setTimeout(() => switchMapStyle(map, style, retryCount + 1), 2000);
    }
  };

  map.once('error', onError);
  map.setStyle(style);
  map.once('style.load', () => {
    map.off('error', onError);
    useMapStore.setState({ isReady: true });
    if (_cachedRoute) {
      _applyRouteGeometry(map, _cachedRoute.coords, _cachedRoute.alts);
    }
  });
}

// ── Driving mode ─────────────────────────────────────────────

/** km/h → zoom level (sokak görünümü öncelikli)
 *
 *  0-30 km/h  : 17.0 — tek tek binalar, şeritler net
 *  30-60 km/h : 16.5-15.5 — şehir içi sokaklar
 *  60-100 km/h: 15.0-14.0 — ana yollar
 *  100+ km/h  : 13.5 — otoyol/bölge
 */
function speedToZoom(speedKmh: number): number {
  if (speedKmh <= 0)  return 17.0;
  if (speedKmh <= 30) return 17.0 - (speedKmh / 30) * 0.5;   // 17.0 → 16.5
  if (speedKmh <= 60) return 16.5 - ((speedKmh - 30) / 30) * 1.0; // 16.5 → 15.5
  if (speedKmh <= 100) return 15.5 - ((speedKmh - 60) / 40) * 1.5; // 15.5 → 14.0
  return Math.max(13.0, 14.0 - (speedKmh - 100) * 0.01);    // 14.0 → 13.0+
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
 * Navigation entry animation — called ONCE when the user taps "Başlat".
 * Smoothly transitions from the current free-browse view to a 3D driving
 * perspective: tilt 0→45°, zoom →17, bearing aligned to the route.
 *
 * @param bearing  Initial bearing in degrees (first route step direction or GPS heading)
 */
export function enterNavigationView(
  map: MapLibreMap,
  lat: number,
  lng: number,
  bearing: number,
  containerHeight: number,
) {
  if (!map || !map.isStyleLoaded()) return;

  const TARGET_ZOOM    = 17;
  const TARGET_PITCH   = 45;
  const DURATION_MS    = 500;

  // Look-ahead offset so road ahead is visible, not just the car icon
  const lookAheadDeg = 30 / 111_320; // ~30 m forward
  const headRad      = (bearing * Math.PI) / 180;
  const cosLat       = Math.max(0.001, Math.cos((lat * Math.PI) / 180));
  const centerLat    = lat + lookAheadDeg * Math.cos(headRad);
  const centerLng    = lng + lookAheadDeg * Math.sin(headRad) / cosLat;

  const topPad = Math.round(containerHeight * 0.42);

  _lastDrivingZoom = TARGET_ZOOM;

  map.easeTo({
    center:  [centerLng, centerLat],
    bearing,
    zoom:    TARGET_ZOOM,
    pitch:   TARGET_PITCH,
    padding: { top: topPad, bottom: 0, left: 0, right: 0 },
    duration: DURATION_MS,
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

const ROUTE_SRC   = 'car-route';
const ROUTE_GLOW  = 'car-route-glow';
const ROUTE_CASE  = 'car-route-casing';
const ROUTE_FILL  = 'car-route-fill';
const ALT_SRC     = 'car-route-alt';
const ALT_FILL    = 'car-route-alt-fill';
const DEBUG_SRC   = 'car-route-debug';
const DEBUG_LAYER = 'car-route-debug-line';

// Module-level cache — harita style sıfırlandığında re-apply için
let _cachedRoute: { coords: [number, number][]; alts: [number, number][][] } | null = null;

/**
 * Haritada rota çizgisi göster ya da güncelle (hardened).
 *
 * Render pipeline korumaları:
 *   - style yüklü değilse → 'styledata' olayında kuyrukla
 *   - source varsa sadece setData (yeniden addSource/addLayer yok)
 *   - layer sırası: ALT_FILL → ROUTE_GLOW → ROUTE_CASE → ROUTE_FILL (fill en üstte)
 *   - style sıfırlansa bile cached geometry ile yeniden çizilir
 *   - addLayer/addSource hata verirse → debug kırmızı çizgi (failsafe)
 */
export function setRouteGeometry(
  map:          MapLibreMap,
  coordinates:  [number, number][],
  alternatives: [number, number][][] = [],
): void {
  if (!map || !coordinates.length) return;

  console.log('[ROUTE] coords length:', coordinates.length);
  console.log('[ROUTE] source exists:', !!map.getSource('car-route'));
  console.log('[ROUTE] layer exists:',  !!map.getLayer('car-route-fill'));
  console.log('[ROUTE] style loaded:',  map.isStyleLoaded());

  _cachedRoute = { coords: coordinates, alts: alternatives };

  if (!map.isStyleLoaded()) {
    // style.load fires exactly once when the full style is ready for addSource/addLayer.
    // styledata fires multiple times during loading and is too early for layer operations.
    map.once('style.load', () => {
      if (_cachedRoute) {
        _applyRouteGeometry(map, _cachedRoute.coords, _cachedRoute.alts);
      }
    });
    return;
  }

  _applyRouteGeometry(map, coordinates, alternatives);
}

function _buildGeoJSON(coordinates: [number, number][]) {
  return {
    type: 'Feature' as const,
    geometry: { type: 'LineString' as const, coordinates },
    properties: {},
  };
}

function _buildAltGeoJSON(alternatives: [number, number][][]) {
  return {
    type: 'FeatureCollection' as const,
    features: alternatives.map(coords => ({
      type: 'Feature' as const,
      geometry: { type: 'LineString' as const, coordinates: coords },
      properties: {},
    })),
  };
}

function _safeEnsureSource(
  map:  MapLibreMap,
  id:   string,
  data: object,
): boolean {
  if (!map.getSource(id)) {
    try {
      map.addSource(id, { type: 'geojson', data } as any);
      return true;
    } catch (e) {
      console.error('[ROUTE] SOURCE CREATE FAILED', id, e);
      return false;
    }
  }
  // Source var — veriyi güncelle; hata gelirse hard-reset
  try {
    (map.getSource(id) as GeoJSONSource).setData(data as any);
    return true;
  } catch {
    console.warn('[ROUTE] Source bozuk, hard-reset:', id);
    try { map.removeSource(id); } catch { /* ignore */ }
    try {
      map.addSource(id, { type: 'geojson', data } as any);
      return true;
    } catch (e2) {
      console.error('[ROUTE] SOURCE CREATE FAILED after reset', id, e2);
      return false;
    }
  }
}

/**
 * Idempotent layer add — stilden bağımsız, saf güvenli.
 * Mevcut katman varsa önce kaldırılır, ardından yeniden eklenir.
 * Bu sayede:
 *   - Stil geçişlerinde (Day→Night, vector↔raster) eski layer kalıntıları temizlenir.
 *   - Z-order (moveLayer) her seferinde doğru yeniden kurulur.
 *   - setRouteGeometry zaten FullMapView tarafından hash+styleKey ile dedup edildiğinden
 *     bu fonksiyon navigasyon sırasında gereksiz yere çağrılmaz — flash riski yok.
 */
function _safeAddLayer(map: MapLibreMap, layer: Parameters<MapLibreMap['addLayer']>[0]): void {
  if (map.getLayer(layer.id)) {
    try { map.removeLayer(layer.id); } catch { /* stale — ignore, attempt fresh add */ }
  }
  try { map.addLayer(layer); } catch (e) { console.error('[ROUTE] addLayer failed:', layer.id, e); }
}

function _applyRouteGeometry(
  map:          MapLibreMap,
  coordinates:  [number, number][],
  alternatives: [number, number][][],
): void {
  if (coordinates.length < 2) {
    logError('MapRoute:InvalidGeometry', new Error(`Geometri reddedildi: ${coordinates.length} nokta (min 2)`));
    return;
  }

  // Style must be fully loaded before addSource/addLayer — queue if not
  if (!map.isStyleLoaded()) {
    map.once('style.load', () => _applyRouteGeometry(map, coordinates, alternatives));
    return;
  }

  const mainData = _buildGeoJSON(coordinates);
  const altData  = _buildAltGeoJSON(alternatives);

  // ── 1) SOURCE GUARANTEE — her iki source önce oluşturulur / güncellenir ──
  const altOk  = _safeEnsureSource(map, ALT_SRC,   altData);
  const mainOk = _safeEnsureSource(map, ROUTE_SRC, mainData);

  if (!mainOk) {
    console.error('[ROUTE] SOURCE CREATE FAILED — fallback debug line');
    _drawDebugLine(map, coordinates);
    return;
  }

  // ── 2) LAYER GUARANTEE — source sonrası, eksik layer'lar eklenir ──
  if (altOk) {
    _safeAddLayer(map, {
      id: ALT_FILL, type: 'line', source: ALT_SRC,
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': '#64748b',
        'line-width': ['interpolate', ['linear'], ['zoom'], 12, 2, 16, 4, 20, 5],
        'line-opacity': 0.5,
      },
    });
  }

  _safeAddLayer(map, {
    id: ROUTE_GLOW, type: 'line', source: ROUTE_SRC,
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': '#3b82f6',
      'line-width': ['interpolate', ['linear'], ['zoom'], 12, 16, 16, 32, 20, 48],
      'line-opacity': 0.15,
      'line-blur': ['interpolate', ['linear'], ['zoom'], 12, 4, 16, 8, 20, 12],
    },
  });

  _safeAddLayer(map, {
    id: ROUTE_CASE, type: 'line', source: ROUTE_SRC,
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': '#ffffff',
      'line-width': ['interpolate', ['linear'], ['zoom'], 12, 6, 16, 14, 20, 20],
      'line-opacity': 0.4,
    },
  });

  _safeAddLayer(map, {                    // beforeId YOK — FILL her zaman en üstte
    id: ROUTE_FILL, type: 'line', source: ROUTE_SRC,
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': '#2563eb',
      'line-width': ['interpolate', ['linear'], ['zoom'], 12, 3, 16, 8, 20, 12],
      'line-opacity': 1,
    },
  });

  // ── 3) Z-order: rota katmanları user-marker'ın altına taşınır ──
  const firstUserLayer = USER_LAYERS.find(id => map.getLayer(id));
  if (firstUserLayer) {
    try { map.moveLayer(ALT_FILL,   firstUserLayer); } catch { /* ignore */ }
    try { map.moveLayer(ROUTE_GLOW, firstUserLayer); } catch { /* ignore */ }
    try { map.moveLayer(ROUTE_CASE, firstUserLayer); } catch { /* ignore */ }
    try { map.moveLayer(ROUTE_FILL, firstUserLayer); } catch { /* ignore */ }
  }

  // ── 4) FAILSAFE: anlık + 800ms ──
  const fillOk = !!map.getLayer(ROUTE_FILL);
  console.log('[ROUTE] fill layer after setup:', fillOk);
  if (!fillOk) {
    console.error('[ROUTE] FAILSAFE: fill layer eksik — kırmızı debug çizgi çiziliyor');
    _drawDebugLine(map, coordinates);
  }

  setTimeout(() => {
    if (_cachedRoute && !map.getSource(ROUTE_SRC)) {
      console.error('[ROUTE] SOURCE CREATE FAILED — 800ms sonra kayboldu');
      _drawDebugLine(map, coordinates);
    }
  }, 800);
}

/** Failsafe: kırmızı debug çizgisi — normal render başarısız olduğunda. */
function _drawDebugLine(map: MapLibreMap, coordinates: [number, number][]): void {
  try {
    if (map.getLayer(DEBUG_LAYER)) map.removeLayer(DEBUG_LAYER);
    if (map.getSource(DEBUG_SRC))  map.removeSource(DEBUG_SRC);
    map.addSource(DEBUG_SRC, {
      type: 'geojson',
      data: { type: 'Feature', geometry: { type: 'LineString', coordinates }, properties: {} },
    });
    map.addLayer({
      id: DEBUG_LAYER,
      type: 'line',
      source: DEBUG_SRC,
      paint: { 'line-color': '#ef4444', 'line-width': 6, 'line-opacity': 0.9 },
    });
    console.warn('[MapRoute] Debug (red) line rendered — investigate render pipeline');
  } catch { /* son çare de başarısız */ }
}

/** Rota çizgilerini (ana + alternatifler + debug) ve cache'i temizle. */
export function clearRouteGeometry(map: MapLibreMap): void {
  _cachedRoute = null;
  if (!map) return;
  try {
    if (map.getLayer(DEBUG_LAYER)) map.removeLayer(DEBUG_LAYER);
    if (map.getSource(DEBUG_SRC))  map.removeSource(DEBUG_SRC);
    if (map.getLayer(ROUTE_FILL))  map.removeLayer(ROUTE_FILL);
    if (map.getLayer(ROUTE_CASE))  map.removeLayer(ROUTE_CASE);
    if (map.getLayer(ROUTE_GLOW))  map.removeLayer(ROUTE_GLOW);
    if (map.getSource(ROUTE_SRC))  map.removeSource(ROUTE_SRC);
    if (map.getLayer(ALT_FILL))    map.removeLayer(ALT_FILL);
    if (map.getSource(ALT_SRC))    map.removeSource(ALT_SRC);
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
  // Clear init state first — prevents in-flight _initCore from writing to store
  _initPromise   = null;
  _initContainer = null;

  const map = useMapStore.getState().mapInstance;
  if (map) {
    try {
      // Force WebGL context release to prevent memory leaks/zombie instances
      const extension = map.getCanvas().getContext('webgl')?.getExtension('WEBGL_lose_context');
      if (extension) extension.loseContext();
      map.remove();
    } catch { /* canvas already removed */ }
  }
  useMapStore.setState({ mapInstance: null, isReady: false, drivingMode: false });
}

/**
 * Zombi harita tespiti — WebGL context'in hâlâ geçerli olup olmadığını kontrol eder.
 * Android 9 düşük bellek durumunda GPU driver WebGL context'i sessizce öldürebilir.
 * Context kaybolmuşsa destroyMap() çağrılır; bileşen yeniden mount edilince
 * initializeMap() taze bir instance oluşturur.
 *
 * Kullanım: MiniMapWidget içinde useEffect + interval ile çağrılır.
 * @returns true → context sağlıklı, false → zombi tespit edildi, harita yok edildi
 */
export function checkAndHealMapContext(): boolean {
  const map = useMapStore.getState().mapInstance;
  if (!map) return false;

  try {
    const canvas = map.getCanvas();
    if (!canvas) { destroyMap(); return false; }

    // WebGL context kaybı kontrolü
    const gl = canvas.getContext('webgl') ?? canvas.getContext('experimental-webgl');
    if (!gl) { destroyMap(); return false; }

    const webgl = gl as WebGLRenderingContext;
    if (webgl.isContextLost()) {
      logError('Map:ZombieGuard', new Error('WebGL context lost — yeniden başlatılıyor'));
      destroyMap();
      return false;
    }

    return true;
  } catch (e) {
    logError('Map:ZombieGuard', e);
    destroyMap();
    return false;
  }
}
