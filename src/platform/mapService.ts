import maplibregl, { Map as MapLibreMap, GeoJSONSource, Marker } from 'maplibre-gl';
import type { LngLatLike } from 'maplibre-gl';
import { create } from 'zustand';
import { handleSatelliteTileError, setActiveMapSource } from './mapSourceManager';
import { searchOffline } from './offlineSearchService';
import type { StoredLocation } from './offlineSearchService';
import { searchGlobal }  from './poi/offlinePoiService';

// Single tile source — no smart-tile, no offline
// Real street map style using OSM raster tiles
const OSM_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    'osm': {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
      maxzoom: 19,
    },
  },
  layers: [
    { id: 'osm-tiles', type: 'raster', source: 'osm' },
  ],
};

// Ensure smart-tile protocol is never active
try { maplibregl.removeProtocol('smart-tile'); } catch { /* not registered */ }
import { logError } from './crashLogger';

declare global {
  interface Window {
    Capacitor?: { isNativePlatform(): boolean };
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

// offlineInitialized removed — offline tile server disabled
let _initPromise:       Promise<MapLibreMap> | null = null;
let _initGen            = 0;               // incremented on every destroyMap
let _currentContainer:  HTMLElement | null = null; // hangi container için init açık

// ── Initialization Mutex ─────────────────────────────────────────────────────
// Android WebView WebGL context limiti (1-2) aşılmasını önler.
// destroyMap() sonrası WEBGL_lose_context ile GPU slot serbest bırakılır,
// ardından 2 rAF frame beklenerek yeni context talebi güvenli hale gelir.
let _destroyLock: Promise<void> = Promise.resolve();

async function _freeContext(map: MapLibreMap): Promise<void> {
  // Canvas ve GL referansını remove() öncesinde al — sonrasında erişilemeyebilir
  let gl: WebGLRenderingContext | null = null;
  try {
    const canvas = map.getCanvas();
    gl = (
      canvas.getContext('webgl2') ??
      canvas.getContext('webgl') ??
      canvas.getContext('experimental-webgl')
    ) as WebGLRenderingContext | null;
  } catch { /* ignore */ }

  try { map.remove(); } catch { /* canvas already removed */ }

  // GPU'ya context kaybını bildir — slot hemen serbest kalır
  try { gl?.getExtension('WEBGL_lose_context')?.loseContext(); } catch { /* ignore */ }

  // 2 rAF frame: GPU sürücüsünün context'i işlemesi için minimum bekleme
  await new Promise<void>(resolve =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
}

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
// Bir kez hesapla, sakla — her render'da yeni WebGL context AÇMA
let _webglAvailableCache: boolean | null = null;

export function isWebGLAvailable(): boolean {
  if (_webglAvailableCache !== null) return _webglAvailableCache;
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('webgl') ?? canvas.getContext('experimental-webgl');
    if (!ctx) { _webglAvailableCache = false; return false; }
    const gl = ctx as WebGLRenderingContext;
    const ok = typeof gl.createShader === 'function';
    // Kontrol canvas'ını hemen serbest bırak — context slotunu tıkama
    try { (gl.getExtension('WEBGL_lose_context') as any)?.loseContext(); } catch { /* ignore */ }
    _webglAvailableCache = ok;
    return ok;
  } catch {
    _webglAvailableCache = false;
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

  // ── Idempotency + container guard ────────────────────────────────────────
  if (_initPromise) {
    if (_currentContainer === container) {
      // Aynı container, aynı init in-flight → bekle
      return _initPromise;
    }
    // Farklı container (ör. FullMap açıldı, MiniMap init devam ediyor) →
    // mevcut init'i iptal et (_initGen++ → _initCore erken çıkar), sıfırla
    console.log('[MAP_INIT] different container — cancelling in-flight init');
    _initGen++;
    _initPromise = null;
    _currentContainer = null;
  }

  const existing = useMapStore.getState().mapInstance;
  if (existing) {
    console.log('[MAP_DESTROY] clearing existing instance before re-init');
    destroyMap();
  }

  _currentContainer = container;
  const myGen = _initGen;

  _initPromise = Promise.race<MapLibreMap>([
    _initCore(container, config, myGen),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Map init timeout (12s)')), 12_000)
    ),
  ]).finally(() => {
    if (_initGen === myGen) {
      _initPromise    = null;
      _currentContainer = null;
    }
  });

  return _initPromise;
}

async function _initCore(
  container: HTMLElement,
  _config: MapConfig,
  gen: number,
): Promise<MapLibreMap> {
  // ── Mutex: önceki context tamamen serbest kalana kadar bekle ──────────────
  await _destroyLock;
  if (gen !== _initGen) throw new Error('Map init cancelled');

  // ── Dimension guard: 0×0 container'da WebGL context asla talep edilmez ───
  if (container.offsetWidth === 0 || container.offsetHeight === 0) {
    // Tek rAF daha bekle — CSS transition henüz bitmemiş olabilir
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    if (gen !== _initGen) throw new Error('Map init cancelled');
    if (container.offsetWidth === 0 || container.offsetHeight === 0) {
      throw new Error('Container has zero dimensions — WebGL context refused');
    }
  }

  try {
    // Offline tile server DISABLED — device has no tiles, interceptor causes 404 spam
    // offlineInitialized stays false intentionally
    setActiveMapSource('online');

    console.log('[MAP_STYLE] OSM raster');
    const style = OSM_STYLE;
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
      console.log('[MAP_READY]');
      if (_cachedRoute && _cachedRoute.coords?.length > 2) {
        _applyRouteGeometry(map, _cachedRoute.coords, _cachedRoute.alts, _cachedRoute.altIdx);
        console.log('[ROUTE_LAYER_RECREATED] after style.load');
      }
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
        if (tileFailCount >= 20 && !useMapStore.getState().tileError) {
          useMapStore.setState({ tileError: true });
          setTimeout(() => {
            if (setActiveMapSource('online')) {
              switchMapStyle(map, OSM_STYLE);
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

    // WebGL context loss — permanent loss detection + heal attempt
    let _contextLossTimer: ReturnType<typeof setTimeout> | null = null;

    map.on('webglcontextlost', () => {
      console.error('[MAP_WEBGL_ERROR] context lost');
      useMapStore.setState({ isReady: false, tileError: true });

      // 5s içinde restore gelmezse → kalıcı kayıp → destroyMap + re-init sinyali
      _contextLossTimer = setTimeout(() => {
        _contextLossTimer = null;
        if (useMapStore.getState().mapInstance === map) {
          console.error('[MAP_WEBGL_ERROR] context lost permanently — destroying instance');
          destroyMap();
        }
      }, 5_000);
    });

    map.on('webglcontextrestored', () => {
      if (_contextLossTimer !== null) {
        clearTimeout(_contextLossTimer);
        _contextLossTimer = null;
      }
      console.warn('[MAP] WebGL context restored');
      useMapStore.setState({ tileError: false });

      const healMap = () => {
        requestAnimationFrame(() => {
          try { map.resize(); } catch { /* ignore */ }
        });
        if (_cachedRoute && _cachedRoute.coords?.length > 2) {
          _applyRouteGeometry(map, _cachedRoute.coords, _cachedRoute.alts, _cachedRoute.altIdx);
        }
        useMapStore.setState({ isReady: true });
      };

      if (map.isStyleLoaded()) {
        healMap();
      } else {
        map.once('style.load', healMap);
      }
    });

    if (gen !== _initGen) {
      try { map.remove(); } catch { /* already removed */ }
      throw new Error('Map init cancelled');
    }
    useMapStore.setState({ mapInstance: map, error: null });
    return map;
  } catch (err) {
    if (gen !== _initGen) throw err; // cancelled — skip fallback

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
      if (gen !== _initGen) {
        try { fallbackMap.remove(); } catch { /* already removed */ }
        throw new Error('Map init cancelled');
      }
      useMapStore.setState({ mapInstance: fallbackMap, error: null });
      return fallbackMap;
    } catch (fallbackErr) {
      if (gen !== _initGen) throw fallbackErr;
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
  'user-heading-cone',
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

  // Glow halo behind the arrow
  const halo = ctx.createRadialGradient(cx, cx, 0, cx, cx, 44);
  halo.addColorStop(0,   'rgba(26,115,232,0.40)');
  halo.addColorStop(0.6, 'rgba(26,115,232,0.12)');
  halo.addColorStop(1,   'rgba(26,115,232,0.00)');
  ctx.beginPath();
  ctx.arc(cx, cx, 44, 0, Math.PI * 2);
  ctx.fillStyle = halo;
  ctx.fill();

  // Solid Google Maps–style navigation arrow (pointing up = heading 0°)
  ctx.beginPath();
  ctx.moveTo(cx,      7);           // tip
  ctx.lineTo(cx + 22, cx + 20);    // right wing tip
  ctx.lineTo(cx + 11, cx + 12);    // right inner notch
  ctx.lineTo(cx + 11, cx + 34);    // right base
  ctx.lineTo(cx - 11, cx + 34);    // left base
  ctx.lineTo(cx - 11, cx + 12);    // left inner notch
  ctx.lineTo(cx - 22, cx + 20);    // left wing tip
  ctx.closePath();

  ctx.fillStyle = '#1A73E8';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  ctx.stroke();

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

  // 1. Heading cone — rotated symbol, larger for visibility
  map.addLayer({
    id: 'user-heading-cone',
    type: 'symbol',
    source: sourceId,
    layout: {
      'icon-image': HEADING_IMAGE_ID,
      'icon-size': ['interpolate', ['linear'], ['zoom'], 8, 0.55, 14, 0.90, 18, 1.30],
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
    } else {
      // Retries exhausted — style.load will never fire; release the lock.
      _isStyleChanging = false;
      useMapStore.setState({ isReady: true });
    }
  };

  map.once('error', onError);
  _isStyleChanging = true;
  try { map.resize(); } catch { /* container may be transitioning */ }
  map.setStyle(style);
  map.once('style.load', () => {
    map.off('error', onError);
    _isStyleChanging = false;
    useMapStore.setState({ isReady: true });
    // rAF içinde resize — container 0×0 ise atla
    requestAnimationFrame(() => {
      const canvas = map.getCanvas();
      if (canvas && canvas.offsetWidth > 0 && canvas.offsetHeight > 0) {
        try { map.resize(); } catch { /* ignore */ }
      }
    });
    if (_pendingRouteGeometry) {
      _applyRouteGeometry(map, _pendingRouteGeometry.coords, _pendingRouteGeometry.alts, _pendingRouteGeometry.altIdx);
    }
  });
}

// ── Driving mode ─────────────────────────────────────────────

/** km/h → zoom level (Google Maps standartları)
 *
 *  0 km/h    : 18.2 — sokak içi detay
 *  60 km/h   : 16.5 — şehir içi akış
 *  100 km/h  : 15.2 — otoyol perspektifi
 *  100+ km/h : 15.2'den devam azalır
 */
function speedToZoom(speedKmh: number): number {
  if (speedKmh <= 0)   return 18.5;
  if (speedKmh <= 30)  return 18.5  - (speedKmh / 30) * 1.0;          // 18.5 → 17.5
  if (speedKmh <= 60)  return 17.5  - ((speedKmh - 30) / 30) * 0.8;   // 17.5 → 16.7
  if (speedKmh <= 100) return 16.7  - ((speedKmh - 60) / 40) * 1.2;   // 16.7 → 15.5
  return Math.max(14.5, 15.5 - (speedKmh - 100) * 0.013);             // 15.5 → 14.5+
}

let _lastDrivingZoom = 15.5;
let _inTurnApproach  = false;
// Movement hysteresis — 5 km/h altında küçük titremeleri önler
let _lastJumpLat = 0;
let _lastJumpLng = 0;

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
  obdSpeedKmh?: number,    // GPS hız null → OBD fallback
) {
  if (!map || !map.isStyleLoaded()) return;

  // ── Dead Reckoning speed fusion — GPS hız sıfırsa OBD'ye geç ────────────
  const effectiveSpeed = speedKmh > 0 ? speedKmh : (obdSpeedKmh ?? 0);

  // ── Base zoom (speed-adaptive) with hysteresis ────────────
  const baseZoom = speedToZoom(effectiveSpeed);
  const smoothed = Math.abs(baseZoom - _lastDrivingZoom) > 0.05 ? baseZoom : _lastDrivingZoom;

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

  // ── Movement Hysteresis — 5 km/h altında mikro titremeleri filtrele ─────
  if (effectiveSpeed < 5) {
    const dLat = (lat - _lastJumpLat) * 111_320;
    const dLng = (lng - _lastJumpLng) * 111_320 * Math.cos((lat * Math.PI) / 180);
    const movedM = Math.sqrt(dLat * dLat + dLng * dLng);
    if (movedM < 0.8) return;
  }
  _lastJumpLat = lat;
  _lastJumpLng = lng;

  // ── Logaritmik look-ahead — otoyol kalibrasyonu ──────────────────────────
  // Otoyolda çok daha ilerisini gör: 0→0 m, 60→85 m, 120→115 m
  const lookAheadM   = Math.min(115, Math.log1p(effectiveSpeed * 0.5) * 38);
  const lookAheadDeg = lookAheadM / 111_320;
  const headRad      = (heading * Math.PI) / 180;
  const cosLat       = Math.max(0.001, Math.cos((lat * Math.PI) / 180));
  const centerLat    = lat + lookAheadDeg * Math.cos(headRad);
  const centerLng    = lng + lookAheadDeg * Math.sin(headRad) / cosLat;

  // ── Adaptive Pitch — 45°-72° otoyol sürüş kalibrasyonu ───────────────────
  // Hız arttıkça ufuk çizgisi daha fazla yatar (Tesla/Mercedes stili)
  const pitchFactor = Math.min(1, effectiveSpeed / 120);
  let pitch = 45 + (pitchFactor * 27); // 45° → 72°

  // Kavşağa yaklaşınca pitch azalt — kesişimi görmek için
  if (turnApproachM !== undefined && turnApproachM > 0 && turnApproachM < 150) {
    const closeFactor = Math.max(0, (150 - turnApproachM) / 150);
    pitch             = Math.max(25, pitch * (1 - closeFactor * 0.6));
    targetZoom        = Math.min(18.5, targetZoom + closeFactor * 1.5);
    _lastDrivingZoom  = targetZoom;
  }

  // topPad: hızla araç alt kısma kayar — otoyolda daha fazla ön yol
  const topPad = Math.round(containerHeight * Math.min(0.68, 0.50 + effectiveSpeed * 0.0015));

  // jumpTo: anlık güncelleme (60fps rAF zaten smooth gösteriyor)
  // easeTo 1000ms + 200ms interval = animasyon yarıda kesiliyor, pitch asla ulaşamıyor
  map.jumpTo({
    center:  [centerLng, centerLat],
    bearing: heading,
    zoom:    targetZoom,
    pitch,
    padding: { top: topPad, bottom: 0, left: 0, right: 0 },
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

  const TARGET_ZOOM    = 18.5; // Yakın yol detayı
  const TARGET_PITCH   = 55;   // Google Maps sürüş perspektifi
  const DURATION_MS    = 1200; // Yumuşak giriş animasyonu

  const lookAheadDeg = 40 / 111_320;
  const headRad      = (bearing * Math.PI) / 180;
  const cosLat       = Math.max(0.001, Math.cos((lat * Math.PI) / 180));
  const centerLat    = lat + lookAheadDeg * Math.cos(headRad);
  const centerLng    = lng + lookAheadDeg * Math.sin(headRad) / cosLat;

  const topPad = Math.round(containerHeight * 0.55);

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
const SEL_SRC     = 'selected-route-source';
const SEL_LAYER   = 'selected-route-layer';

// Module-level cache — harita style sıfırlandığında re-apply için
let _cachedRoute: { coords: [number, number][]; alts: [number, number][][]; altIdx?: number[] } | null = null;
let _pendingRouteGeometry: { coords: [number, number][]; alts: [number, number][][]; altIdx?: number[] } | null = null;
let _isStyleChanging = false;


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
  map:             MapLibreMap,
  coordinates:     [number, number][],
  alternatives:    [number, number][][] = [],
  altRealIndices?: number[],
): void {
  if (!map || !coordinates.length) return;

  console.log('[ROUTE_RENDER_START]', { pts: coordinates.length, first: coordinates[0], alts: alternatives.length });
  console.log('[ROUTE_GEOMETRY_COORDS_COUNT]', coordinates.length);

  // routingService.normalizeCoords() already ensures [lon, lat] (GeoJSON standard).
  // Do NOT swap here — Turkey's longitude (26-45) overlaps with latitude range and any
  // heuristic guard incorrectly re-swaps already-correct coords for central/east Turkey.

  _cachedRoute          = { coords: coordinates, alts: alternatives, altIdx: altRealIndices };
  _pendingRouteGeometry = { coords: coordinates, alts: alternatives, altIdx: altRealIndices };

  if (_isStyleChanging) return;

  if (!map.isStyleLoaded()) {
    map.once('style.load', () => {
      if (_cachedRoute) {
        _applyRouteGeometry(map, _cachedRoute.coords, _cachedRoute.alts, _cachedRoute.altIdx);
      }
    });
    return;
  }

  _applyRouteGeometry(map, coordinates, alternatives, altRealIndices);
}


function _applyRouteGeometry(
  map:             MapLibreMap,
  coordinates:     [number, number][],
  alternatives:    [number, number][][],
  altRealIndices?: number[],
): void {
  if (!map) return;

  if (!map.isStyleLoaded()) {
    map.once('style.load', () => _applyRouteGeometry(map, coordinates, alternatives, altRealIndices));
    return;
  }

  try {
    // routingService.normalizeCoords() already guarantees [lon, lat] order.
    const coords: [number, number][] = coordinates;
    console.log('[ROUTE_RENDER] pts:', coords.length, 'first:', coords[0], 'last:', coords[coords.length - 1]);

    // ── Alternatif rotalar (gri, arkada) ─────────────────────────
    const fixedAlts = alternatives;
    const altFeatures = fixedAlts.map((altCoords, i) => ({
      type: 'Feature' as const,
      geometry: { type: 'LineString' as const, coordinates: altCoords },
      properties: { altRealIdx: altRealIndices?.[i] ?? (i + 1) },
    }));
    const altData = { type: 'FeatureCollection' as const, features: altFeatures };
    if (!map.getSource(ALT_SRC)) {
      map.addSource(ALT_SRC, { type: 'geojson', data: altData } as any);
    } else {
      (map.getSource(ALT_SRC) as any).setData(altData);
    }
    console.log('[ROUTE_ALTERNATIVES_SOURCE_SET]', { count: fixedAlts.length, first: fixedAlts[0]?.[0] });
    if (!map.getLayer(ALT_FILL)) {
      map.addLayer({
        id: ALT_FILL,
        type: 'line',
        source: ALT_SRC,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#94a3b8', 'line-width': 6, 'line-opacity': 0.50 },
      } as any);
      console.log('[ROUTE_LAYER_ADDED]', { id: ALT_FILL });
    }

    // ── Step 3: force source/layer creation ──────────────────────
    if (!map.getSource(SEL_SRC)) {
      map.addSource(SEL_SRC, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      } as any);
    }
    // Glow layer — mavi ışıma (casing'in altında)
    if (!map.getLayer('car-route-glow-sel')) {
      map.addLayer({
        id: 'car-route-glow-sel',
        type: 'line',
        source: SEL_SRC,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#4285f4', 'line-width': 24, 'line-opacity': 0.18, 'line-blur': 4 },
      } as any);
    }
    if (!map.getLayer('car-route-casing')) {
      map.addLayer({
        id: 'car-route-casing',
        type: 'line',
        source: SEL_SRC,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#ffffff', 'line-width': 16, 'line-opacity': 0.95 },
      } as any);
    }
    if (!map.getLayer(SEL_LAYER)) {
      map.addLayer({
        id: SEL_LAYER,
        type: 'line',
        source: SEL_SRC,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#1A73E8', 'line-width': 10, 'line-opacity': 1 },
      } as any);
    } else {
      map.setPaintProperty(SEL_LAYER, 'line-color', '#1A73E8');
      map.setPaintProperty(SEL_LAYER, 'line-width', 10);
      map.setPaintProperty(SEL_LAYER, 'line-opacity', 1);
    }

    // ── Step 4: set data ─────────────────────────────────────────
    const routeFeature = {
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: coords },
    };
    (map.getSource(SEL_SRC) as any).setData(routeFeature);
    console.log('[ROUTE_SELECTED_SOURCE_SET]', { pts: coords.length, first: coords[0] });

    // ── Step 5: move layer to top (sıra: alt→üst) ──────────────────
    try { map.moveLayer(ALT_FILL); } catch { /* ignore */ }
    try { map.moveLayer('car-route-glow-sel'); } catch { /* ignore */ }
    try { map.moveLayer('car-route-casing'); } catch { /* ignore */ }
    try { map.moveLayer(SEL_LAYER); } catch { /* ignore */ }

    // ── Step 6: fit bounds (sadece preview modda — driving modda setDrivingView ile çatışır) ───
    if (!useMapStore.getState().drivingMode) {
      try {
        if (coords.length >= 2) {
          const bounds = coords.reduce(
            (b, c) => b.extend(c as [number, number]),
            new maplibregl.LngLatBounds(coords[0] as [number, number], coords[0] as [number, number]),
          );
          map.fitBounds(bounds, { padding: 80, maxZoom: 15, duration: 500 });
          console.log('[ROUTE_DEBUG] fitBounds applied');
        }
      } catch(e) { console.warn('[ROUTE_DEBUG] fitBounds err:', e instanceof Error ? e.message : e); }
    }

    console.log('[ROUTE_RENDER_DONE]', { pts: coords.length, alts: fixedAlts.length });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[MAP_WEBGL_ERROR]', msg, '| stack:', e instanceof Error ? e.stack?.split('\n')[1] : '');
    console.warn('[ROUTE_LAYER_RECREATED] retry in 300ms');
    setTimeout(() => _applyRouteGeometry(map, coordinates, alternatives, altRealIndices), 300);
    return;
  }

  _pendingRouteGeometry = null;
}


/** Rota çizgilerini (ana + alternatifler + debug) ve cache'i temizle. */
export function clearRouteGeometry(map: MapLibreMap): void {
  _cachedRoute = null;
  _pendingRouteGeometry = null;
  if (!map) return;
  try {
    if (map.getLayer(DEBUG_LAYER))    map.removeLayer(DEBUG_LAYER);
    if (map.getSource(DEBUG_SRC))     map.removeSource(DEBUG_SRC);
    if (map.getLayer(ROUTE_FILL))     map.removeLayer(ROUTE_FILL);
    if (map.getLayer(ROUTE_CASE))     map.removeLayer(ROUTE_CASE);
    if (map.getLayer(ROUTE_GLOW))     map.removeLayer(ROUTE_GLOW);
    if (map.getSource(ROUTE_SRC))     map.removeSource(ROUTE_SRC);
    if (map.getLayer(ALT_FILL))        map.removeLayer(ALT_FILL);
    if (map.getSource(ALT_SRC))        map.removeSource(ALT_SRC);
    if (map.getLayer('car-route-glow-sel')) map.removeLayer('car-route-glow-sel');
    if (map.getLayer('car-route-casing')) map.removeLayer('car-route-casing');
    if (map.getLayer(SEL_LAYER))          map.removeLayer(SEL_LAYER);
    if (map.getSource(SEL_SRC))           map.removeSource(SEL_SRC);
    if (map.getLayer('route-layer'))   map.removeLayer('route-layer');
    if (map.getSource('route-source')) map.removeSource('route-source');
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
  console.log('[MAP_DESTROY]');
  _initGen++;
  _isStyleChanging  = false;
  _initPromise      = null;
  _currentContainer = null;

  const map = useMapStore.getState().mapInstance;
  useMapStore.setState({ mapInstance: null, isReady: false, drivingMode: false });

  if (map) {
    // _destroyLock: WEBGL_lose_context + 2 rAF bekleme — yeni context talep edilmeden önce çözülür
    _destroyLock = _freeContext(map);
  } else {
    _destroyLock = Promise.resolve();
  }
}

/**
 * Sahiplik doğrulamalı yıkım — yalnızca çağıran instance hâlâ store'daki
 * instance ile eşleşiyorsa global destroyMap() çağrılır.
 * Eşleşmiyorsa (FullMapView sahipliği almışsa) sadece DOM'dan kaldırılır.
 * Bu sayede MiniMap cleanup FullMapView'in haritasını yanlışlıkla yıkamaz.
 */
export function destroyOwnedMap(instance: MapLibreMap): void {
  if (useMapStore.getState().mapInstance === instance) {
    destroyMap();
  } else {
    try { instance.remove(); } catch { /* already removed */ }
  }
}

/**
 * mapInstance değişimlerine abone ol — MiniMapWidget'ın stale-ref tespiti için.
 * FullMapView sahipliği devralınca MiniMap bunu anında öğrenir.
 */
export function subscribeMapInstance(
  cb: (instance: MapLibreMap | null) => void,
): () => void {
  return useMapStore.subscribe((state, prev) => {
    if (state.mapInstance !== prev.mapInstance) cb(state.mapInstance);
  });
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

    // MapLibre 4.x WebGL2 tercih eder — webgl2 önce dene, yoksa webgl1'e geç
    // (webgl2 context varken canvas.getContext('webgl') null döner — yanlış zombie tespiti yapar)
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl') ?? canvas.getContext('experimental-webgl');
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

// ── Driving Layer Updater ────────────────────────────────────────────────────
// GPS update useEffect'inden çağrılır (~1–3s arası, rAF değil → CPU dostu)
let _lastSpeedHide = false;

/**
 * Hız ve konuma göre harita katmanlarını dinamik güncelle:
 *  • > 80 km/h → 3D binalar ve sokak etiketleri gizlenir (dikkat dağınıklığı önleme)
 *  • POI'lara < 500m → ilgili katman ön plana çıkar (glow)
 */
/* ── Unified Place Search ───────────────────────────────────────────────────
 * Katmanlı offline-önce arama:
 *   1. offlineSearchService  — IndexedDB geçmiş/favoriler (<10ms)
 *   2. offlinePoiService     — SQLite FTS5 global POI DB (offline)
 *   3. Nominatim geocoder    — OSM online (son çare, internet gerekli)
 *
 * Tüm sonuçlar StoredLocation[] olarak döner; çakışan koordinatlar deduplicate edilir.
 */

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const NOMINATIM_UA  = 'CockpitOS/1.0 (aybarsselimaybars@gmail.com)';

async function _nominatimSearch(
  query:      string,
  maxResults: number,
): Promise<StoredLocation[]> {
  try {
    const params = new URLSearchParams({
      q:              query,
      format:         'jsonv2',
      limit:          String(maxResults),
      addressdetails: '1',
    });
    const res = await fetch(`${NOMINATIM_URL}?${params}`, {
      headers: { 'User-Agent': NOMINATIM_UA },
      signal:  AbortSignal.timeout(5_000),
    });
    if (!res.ok) return [];

    const data = await res.json() as Array<{
      place_id: number;
      display_name: string;
      lat: string;
      lon: string;
      address?: { road?: string; city?: string; country?: string };
    }>;

    return data.map((item): StoredLocation => ({
      id:        `nominatim_${item.place_id}`,
      name:      item.display_name.split(',')[0]?.trim() ?? item.display_name,
      address:   item.display_name,
      lat:       parseFloat(item.lat),
      lng:       parseFloat(item.lon),
      source:    'search',
      timestamp: Date.now(),
      useCount:  0,
    }));
  } catch {
    return [];
  }
}

function _dedup(list: StoredLocation[]): StoredLocation[] {
  const seen = new Set<string>();
  return list.filter((loc) => {
    const key = `${loc.lat.toFixed(4)}_${loc.lng.toFixed(4)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Unified yer arama: IndexedDB → SQLite POI → Nominatim geocoder.
 *
 * @param query      Kullanıcı arama metni
 * @param userLat    Mevcut konum (mesafe sıralaması + Nominatim bias için)
 * @param userLng    Mevcut konum
 * @param maxResults Toplam maksimum sonuç (varsayılan 8)
 */
export async function searchPlaces(
  query:      string,
  userLat?:   number,
  userLng?:   number,
  maxResults: number = 8,
): Promise<StoredLocation[]> {
  if (!query.trim()) return [];

  const combined: StoredLocation[] = [];

  // 1 — IndexedDB geçmiş/favoriler
  const offlineHits = await searchOffline(query, maxResults);
  for (const hit of offlineHits) combined.push(hit.location);

  if (combined.length >= maxResults) return _dedup(combined).slice(0, maxResults);

  // 2 — SQLite FTS5 global POI DB
  const poiHits = await searchGlobal(query, userLat, userLng, maxResults - combined.length);
  combined.push(...poiHits);

  if (combined.length >= maxResults) return _dedup(combined).slice(0, maxResults);

  // 3 — Nominatim online geocoder (son çare)
  const onlineHits = await _nominatimSearch(query, maxResults - combined.length);
  combined.push(...onlineHits);

  return _dedup(combined).slice(0, maxResults);
}

export function updateDrivingLayers(
  map: MapLibreMap,
  speedKmh: number,
  lat: number,
  lng: number,
): void {
  if (!map || !map.isStyleLoaded()) return;

  // ── Hız bazlı katman gizleme ─────────────────────────────
  const hideHighSpeed = speedKmh > 80;
  if (hideHighSpeed !== _lastSpeedHide) {
    _lastSpeedHide = hideHighSpeed;
    if (map.getLayer('building-3d')) {
      map.setPaintProperty('building-3d', 'fill-extrusion-opacity', hideHighSpeed ? 0 : 0.4);
    }
    if (map.getLayer('road-label')) {
      map.setPaintProperty('road-label', 'text-opacity', hideHighSpeed ? 0.25 : 1);
    }
  }

  // ── POI Proximity Glow — queryRenderedFeatures (~500m yarıçap) ───────────
  const poiLayers = ['poi-gas', 'poi-parking', 'poi-hospital', 'poi-police'];
  const visiblePOI = poiLayers.filter((l) => map.getLayer(l));
  if (visiblePOI.length === 0) return;

  const center = map.project([lng, lat]);
  const R_PX   = 120; // ~300–500m at nav zoom 17-18
  const nearby = map.queryRenderedFeatures(
    [[center.x - R_PX, center.y - R_PX], [center.x + R_PX, center.y + R_PX]],
    { layers: visiblePOI },
  );
  const nearbyByLayer = new Set(nearby.map((f) => f.layer.id));

  const glowStroke: Record<string, string> = {
    'poi-gas':      '#fde68a',
    'poi-parking':  '#93c5fd',
    'poi-hospital': '#fca5a5',
    'poi-police':   '#c4b5fd',
  };
  for (const layer of visiblePOI) {
    const hot = nearbyByLayer.has(layer);
    map.setPaintProperty(layer, 'circle-stroke-width', hot ? 3.5 : 1.5);
    map.setPaintProperty(layer, 'circle-opacity',      hot ? 1.0 : 0.55);
    if (hot) map.setPaintProperty(layer, 'circle-stroke-color', glowStroke[layer] ?? '#ffffff');
  }
}
