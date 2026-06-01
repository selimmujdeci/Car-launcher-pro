import maplibregl, { Map as MapLibreMap, GeoJSONSource, Marker } from 'maplibre-gl';
import type { LngLatLike } from 'maplibre-gl';
import { logInfo } from './debug';
import { create } from 'zustand';
import { handleSatelliteTileError, setActiveMapSource, setMapNight } from './mapSourceManager';
import { searchOffline } from './offlineSearchService';
import type { StoredLocation } from './offlineSearchService';
import { searchGlobal }  from './poi/offlinePoiService';
import { cacheLRUManager } from '../core/storage/CacheLRUManager';
import { NAV_SUPPRESS_LAYERS, NAV_SUPPRESS_TIERS, RASTER_PAINT_DAY, RASTER_PAINT_NIGHT } from './mapStyleBuilders';
import { useHazardStore }    from '../store/useHazardStore';
import { useSafetyStore }    from '../store/useSafetyStore';
import { useCognitiveStore } from '../store/useCognitiveStore';
import {
  CAMERA_CFG,
  resetCameraSmooth,
  computeCameraTarget,
  dampCameraToward,
  computeAnticipatedBearing,
} from './cameraEngine';

// Single tile source — caros-tile:// interceptor handles caching transparently
const OSM_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    'osm': {
      type: 'raster',
      tiles: ['caros-tile://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
      maxzoom: 19,
    },
  },
  layers: [
    // Tile yüklenemeyince siyah kanvas yerine OEM sıcak grafit arka plan görünür
    { id: 'background', type: 'background', paint: { 'background-color': '#131822' } },
    // OEM gece tonu: ham OSM raster'ı sıcak-koyu grafite indirger (--map-bg-1 #131822).
    // Tam desatürasyon yerine hafif sıcaklık (-0.82) + hue sıcağa döndürülür (25°).
    { id: 'osm-tiles',  type: 'raster',     source: 'osm',
      paint: {
        'raster-opacity': 1,
        'raster-contrast': 0.5,
        'raster-brightness-min': 0,
        'raster-brightness-max': 0.30,
        'raster-saturation': -0.82,
        'raster-hue-rotate': 25,
      } },
  ],
};

// Ensure smart-tile protocol is never active
try { maplibregl.removeProtocol('smart-tile'); } catch { /* not registered */ }
// Register caros-tile cache interceptor (idempotent)
cacheLRUManager.init();
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

/** JS Heap anlık snapshot — Chrome/Android WebView destekli; diğer ortamlarda no-op. */
function _logHeap(prefix: string): void {
  const mem = (performance as any).memory;
  if (mem) {
    console.info(
      `[MAP] ${prefix} JS Heap: ${(mem.usedJSHeapSize / 1_048_576).toFixed(1)} MB` +
      ` / ${(mem.totalJSHeapSize / 1_048_576).toFixed(1)} MB total`,
    );
  }
}

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

  _logHeap('pre-destroy');

  // ── Mali-400 Agresif GPU Kaynak Temizliği ────────────────────────────────────
  // map.remove() öncesinde GPU slot'larını tek tek serbest bırak.
  // Mali-400 GPU driver'ı kaynaklara sahip texture'ları tek seferde silmek yerine
  // ayrı ayrı serbest bırakınca VRAM'i daha güvenilir geri alır.
  if (map.isStyleLoaded()) {
    try {
      // 1. Custom image texture'larını boşalt (HEADING_CONE, ALT_BADGE vb.)
      //    map.listImages() MapLibre 4.x'te yerleşik; tüm sprite+addImage kaydını döner.
      const imageIds = map.listImages();
      for (const id of imageIds) {
        try { map.removeImage(id); } catch { /* ignore — already removed */ }
      }

      const style = map.getStyle();

      // 2. Layer'ları ters sırayla kaldır (üstten alta — bağımlılık sırası korunur)
      if (style?.layers) {
        for (const layer of [...style.layers].reverse()) {
          try { map.removeLayer(layer.id); } catch { /* ignore */ }
        }
      }

      // 3. Source'ları kaldır (tüm layer'lar kaldırıldıktan sonra referans sıfır)
      if (style?.sources) {
        for (const sourceId of Object.keys(style.sources)) {
          try { map.removeSource(sourceId); } catch { /* ignore */ }
        }
      }
    } catch { /* style may already be destroyed — race with map.remove() */ }
  }

  // 4. Bilinen event aboneliklerini kaldır — map.remove() tüm listener'ları zaten temizler;
  //    ancak _cleanupRouteInteractions() tarafından sahiplenilmemiş olanları burada
  //    açıkça kaldırarak React closure referanslarını erken serbest bırakırız (Zero-Leak).
  // Not: map.off(type) handler referansı olmadan MapLibre 4.x'te geçerli değildir;
  //      bu nedenle handler'ların tamamı map.remove() içindeki Evented.destroy() ile temizlenir.
  // route click/mouseenter/mouseleave → _cleanupRouteInteractions() tarafından zaten kaldırılmış.

  try { map.remove(); } catch { /* canvas already removed */ }

  // GPU'ya context kaybını bildir — slot hemen serbest kalır
  try { gl?.getExtension('WEBGL_lose_context')?.loseContext(); } catch { /* ignore */ }

  // 2 rAF frame: GPU sürücüsünün context'i işlemesi için minimum bekleme
  await new Promise<void>(resolve =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );

  _logHeap('post-destroy');
}

const getOnlineTileStyle = (): maplibregl.StyleSpecification => ({
  version: 8,
  name: 'OSM Online',
  sources: {
    'osm-tiles': {
      type: 'raster' as const,
      tiles: [
        'caros-tile://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
        'caros-tile://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
        'caros-tile://c.tile.openstreetmap.org/{z}/{x}/{y}.png',
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
      paint: { 'background-color': '#131822' },
    },
    {
      id: 'osm-layer',
      type: 'raster' as const,
      source: 'osm-tiles',
      paint: {
        // OEM sıcak grafit gece tonu — OSM_STYLE ile birebir aynı
        'raster-opacity': 1,
        'raster-contrast': 0.5,
        'raster-brightness-min': 0,
        'raster-brightness-max': 0.30,
        'raster-saturation': -0.82,
        'raster-hue-rotate': 25,
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
    logInfo('[MAP_INIT] different container — cancelling in-flight init');
    _initGen++;
    _initPromise = null;
    _currentContainer = null;
  }

  const existing = useMapStore.getState().mapInstance;
  if (existing) {
    logInfo('[MAP_DESTROY] clearing existing instance before re-init');
    destroyMap();
  }

  _currentContainer = container;
  const myGen = _initGen;

  _initPromise = Promise.race<MapLibreMap>([
    _initCore(container, config, myGen),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Map init timeout (30s)')), 30_000)
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

    logInfo('[MAP_STYLE] OSM raster');
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
      maxPitch: 50,  // 50°+ üzerinde MapLibre siyah köşe oluşturur
      antialias: true,
      attributionControl: false,
    });

    map.on('style.load', () => {
      useMapStore.setState({ isReady: true });
      logInfo('[MAP_READY]');
      _setupRouteInteractions(map); // C7.2 — ilk yüklemede etkileşimleri kur
      if (_cachedRoute && _cachedRoute.coords?.length > 2) {
        _applyRouteGeometry(map, _cachedRoute.coords, _cachedRoute.alts, _cachedRoute.altIdx);
        logInfo('[ROUTE_LAYER_RECREATED] after style.load');
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
      if (e.dataType === 'source' && map.getSource('map-tiles') && map.isSourceLoaded('map-tiles')) {
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
          // FullMapView'a re-init sinyali gönder — initializedRef sıfırlansın
          window.dispatchEvent(new CustomEvent('map:reinit-needed'));
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

// ── CarOS Rover konum göstergesi (marka imzası) ──────────────────────────
// Klasik mavi ok yerine üstten görünüş CarOS Rover; heading'e göre kendi
// ekseninde döner, altında amber konum halkası + parlayan glow. Gündüz sade,
// gece güçlü amber glow (CarOS Expedition ışık dili).
const ROVER_IMG_DAY   = 'rover-veh-day';
const ROVER_IMG_NIGHT = 'rover-veh-night';
const USER_LAYERS = [
  'user-glow',     // alt: yumuşak amber hale
  'user-ring',     // amber konum halkası
  'user-vehicle',  // üstte dönen Rover
];

// C7.1: hysteresis state — icon-size yalnızca ≥3 km/h değişimde güncellenir
let _lastScaleSpeedKmh = -1;
// Marker durum makinesi — gündüz/gece teması + navigasyon aktifliği + pulse throttle
let _markerNight     = false;
let _markerNavActive = false;
let _lastRingPulseMs = 0;

// C7.2: rota etkileşim motoru — listener cleanup + seçim callback
let _routeInteractionCleanup: (() => void) | null = null;
let _onAltRouteSelect: ((realIdx: number) => void) | null = null;

/**
 * Alternatif rota seçim callback'ini kaydet.
 * FullMapView mount'unda bir kez çağrılır; dönen fonksiyon kaydı iptal eder.
 */
export function registerAltRouteSelectCallback(cb: (realIdx: number) => void): () => void {
  _onAltRouteSelect = cb;
  return () => { if (_onAltRouteSelect === cb) _onAltRouteSelect = null; };
}

/** Zombi listener'ları temizle. */
function _cleanupRouteInteractions(): void {
  _routeInteractionCleanup?.();
  _routeInteractionCleanup = null;
}

const ALT_TOUCH_PAD = 24; // px — dokunmatik dostu hitbox genişlemesi

/**
 * Alternatif rota katmanına dokunmatik dostu tıklama + hover etkileşimleri kur.
 * style.load sonrası her çağrıda önceki listener'lar temizlenerek yeniden kurulur.
 * 24px bbox padding: sürüş anında ince gri hatta dokunmayı tolere eder.
 */
function _setupRouteInteractions(map: MapLibreMap): void {
  _cleanupRouteInteractions();

  const onMapClick = (e: maplibregl.MapMouseEvent) => {
    if (!map.getLayer(ALT_FILL)) return;
    const pt = e.point;
    const features = map.queryRenderedFeatures(
      [
        [pt.x - ALT_TOUCH_PAD, pt.y - ALT_TOUCH_PAD],
        [pt.x + ALT_TOUCH_PAD, pt.y + ALT_TOUCH_PAD],
      ],
      { layers: [ALT_FILL] },
    );
    const feat = features[0];
    if (!feat?.properties) return;
    const realIdx = feat.properties.altRealIdx;
    if (realIdx !== undefined && _onAltRouteSelect) {
      _onAltRouteSelect(Number(realIdx));
    }
  };

  const onEnter = () => { map.getCanvas().style.cursor = 'pointer'; };
  const onLeave = () => { map.getCanvas().style.cursor = ''; };

  map.on('click', onMapClick);
  map.on('mouseenter', ALT_FILL, onEnter);
  map.on('mouseleave', ALT_FILL, onLeave);

  _routeInteractionCleanup = () => {
    try { map.off('click', onMapClick); } catch { /* ignore */ }
    try { map.off('mouseenter', ALT_FILL, onEnter); } catch { /* ignore */ }
    try { map.off('mouseleave', ALT_FILL, onLeave); } catch { /* ignore */ }
    try { map.getCanvas().style.cursor = ''; } catch { /* ignore */ }
  };
}

/** Köşeleri yuvarlatılmış dikdörtgen yolu — ctx.roundRect tüm WebView'larda yok, kendi çiziyoruz. */
function _roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y,     x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x,     y + h, rr);
  ctx.arcTo(x,     y + h, x,     y,     rr);
  ctx.arcTo(x,     y,     x + w, y,     rr);
  ctx.closePath();
}

/**
 * Üstten görünüş CarOS Rover'ı verilen context'e çizer (ön = yukarı = heading 0°).
 * Gerçekçi off-road SUV: zemin gölgesi, şampanya metalik gövde (genişlik+boy gradyanı),
 * jantlı iri lastikler, greenhouse (ön cam/tavan/arka cam), tavan rafı, yan aynalar,
 * amber CAROS ön ışık barı + farlar, arka stop lambaları. night=true → koyu gövde,
 * amber kenar ışığı, parlayan far/ışık barı (CarOS Expedition gece dili).
 * Çizim 144 birimlik referansa göre ölçeklenir; rotation origin = size/2 (symbol anchor 'center').
 */
function _drawRover(ctx: CanvasRenderingContext2D, size: number, night: boolean) {
  const cx = size / 2;
  const s  = size / 144;              // ölçek faktörü
  const P  = (n: number) => n * s;    // birim → piksel
  const X  = (n: number) => cx + n * s; // merkeze göre yatay
  const Y  = (n: number) => n * s;       // tepeden dikey (144-uzayı)
  ctx.clearRect(0, 0, size, size);
  ctx.lineJoin = 'round';

  const amber     = night ? '#FFB347' : '#E0A23C';
  const amberGlow = night ? 'rgba(255,170,60,0.95)' : 'rgba(224,162,60,0.55)';
  const glass     = night ? 'rgba(30,36,46,0.95)' : 'rgba(22,28,38,0.92)';
  const tireCol   = '#141417';

  // 1) Zemin gölgesi — radyal gradyan (filter'sız, tüm WebView'larda çalışır), aracı kaldırır
  const sh = ctx.createRadialGradient(cx, Y(78), 0, cx, Y(78), P(58));
  sh.addColorStop(0,   night ? 'rgba(0,0,0,0.50)' : 'rgba(30,22,10,0.36)');
  sh.addColorStop(0.7, night ? 'rgba(0,0,0,0.22)' : 'rgba(30,22,10,0.15)');
  sh.addColorStop(1,   'rgba(0,0,0,0)');
  ctx.fillStyle = sh;
  ctx.beginPath();
  ctx.ellipse(cx, Y(78), P(44), P(60), 0, 0, Math.PI * 2);
  ctx.fill();

  // 2) Tekerler — koyu lastik + tread çizgileri (off-road geniş duruş)
  const wheel = (wx: number, wy: number) => {
    ctx.fillStyle = tireCol;
    _roundRectPath(ctx, wx - P(7.5), wy - P(16), P(15), P(32), P(5));
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = P(1);
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.moveTo(wx + i * P(4), wy - P(13));
      ctx.lineTo(wx + i * P(4), wy + P(13));
      ctx.stroke();
    }
  };
  wheel(X(-31), Y(42)); wheel(X(31), Y(42));    // ön
  wheel(X(-31), Y(102)); wheel(X(31), Y(102));  // arka

  // 3) Gövde — şampanya metalik (genişlik gradyanı: koyu kenar → parlak merkez)
  _roundRectPath(ctx, X(-30), Y(14), P(60), P(116), P(13));
  const wg = ctx.createLinearGradient(X(-30), 0, X(30), 0);
  if (night) {
    wg.addColorStop(0, '#2b2820'); wg.addColorStop(0.5, '#6a6353'); wg.addColorStop(1, '#2b2820');
  } else {
    wg.addColorStop(0, '#998969'); wg.addColorStop(0.5, '#e4d6b8'); wg.addColorStop(1, '#998969');
  }
  ctx.fillStyle = wg;
  ctx.fill();

  // 3b) Boy gradyanı (ön aydınlık → arka koyu) — gövde yoluna clip'lenir
  ctx.save();
  ctx.clip();
  const lg = ctx.createLinearGradient(0, Y(14), 0, Y(130));
  lg.addColorStop(0,   night ? 'rgba(255,200,120,0.12)' : 'rgba(255,255,255,0.18)');
  lg.addColorStop(0.4, 'rgba(0,0,0,0)');
  lg.addColorStop(1,   night ? 'rgba(0,0,0,0.38)' : 'rgba(60,45,25,0.22)');
  ctx.fillStyle = lg;
  ctx.fillRect(0, 0, size, size);
  ctx.restore();

  // 3c) Kenar ışığı (rim light)
  _roundRectPath(ctx, X(-30), Y(14), P(60), P(116), P(13));
  ctx.lineWidth = P(1.6);
  ctx.strokeStyle = night ? 'rgba(255,185,90,0.6)' : 'rgba(255,255,255,0.5)';
  ctx.stroke();

  // 4) Panel/kapı dikişleri
  ctx.strokeStyle = night ? 'rgba(0,0,0,0.4)' : 'rgba(70,55,35,0.35)';
  ctx.lineWidth = P(1);
  for (const seam of [[-26, 26, 46], [-30, 30, 74], [-26, 26, 112]]) {
    ctx.beginPath(); ctx.moveTo(X(seam[0]), Y(seam[2])); ctx.lineTo(X(seam[1]), Y(seam[2])); ctx.stroke();
  }

  // 5) Kaput havalandırma yarıkları
  ctx.fillStyle = night ? 'rgba(0,0,0,0.32)' : 'rgba(80,62,38,0.3)';
  _roundRectPath(ctx, X(-8), Y(30), P(16), P(3), P(1.5)); ctx.fill();
  _roundRectPath(ctx, X(-8), Y(35), P(16), P(3), P(1.5)); ctx.fill();

  // 6) Greenhouse — ön cam, tavan paneli, arka cam
  ctx.fillStyle = glass;
  _roundRectPath(ctx, X(-23), Y(48), P(46), P(12), P(4)); ctx.fill(); // ön cam
  ctx.fillStyle = night ? '#5a5343' : '#d8c9a8';
  _roundRectPath(ctx, X(-22), Y(60), P(44), P(40), P(6)); ctx.fill(); // tavan
  ctx.fillStyle = glass;
  _roundRectPath(ctx, X(-23), Y(100), P(46), P(10), P(4)); ctx.fill(); // arka cam

  // 6b) Tavan rafı (yan raylar + çapraz barlar)
  ctx.strokeStyle = night ? '#1f1c16' : '#6a5c42';
  ctx.lineWidth = P(2);
  ctx.beginPath(); ctx.moveTo(X(-19), Y(62)); ctx.lineTo(X(-19), Y(98)); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(X(19),  Y(62)); ctx.lineTo(X(19),  Y(98)); ctx.stroke();
  ctx.lineWidth = P(1.5);
  for (const yy of [68, 78, 88]) {
    ctx.beginPath(); ctx.moveTo(X(-19), Y(yy)); ctx.lineTo(X(19), Y(yy)); ctx.stroke();
  }

  // 7) Yan aynalar
  ctx.fillStyle = night ? '#4a4536' : '#b6a684';
  _roundRectPath(ctx, X(-35), Y(54), P(6), P(5), P(2)); ctx.fill();
  _roundRectPath(ctx, X(29),  Y(54), P(6), P(5), P(2)); ctx.fill();

  // 8) Ön tampon + CAROS amber ışık barı + farlar (Expedition imzası)
  ctx.fillStyle = night ? 'rgba(20,17,12,0.9)' : 'rgba(70,56,36,0.7)';
  _roundRectPath(ctx, X(-27), Y(16), P(54), P(6), P(3)); ctx.fill();
  ctx.save();
  ctx.shadowColor = amberGlow; ctx.shadowBlur = night ? P(11) : P(5);
  ctx.fillStyle = amber;
  _roundRectPath(ctx, X(-20), Y(18), P(40), P(3), P(1.5)); ctx.fill();      // ışık barı
  ctx.fillStyle = night ? '#FFD27A' : '#F0B85A';
  _roundRectPath(ctx, X(-26), Y(23), P(9), P(4), P(2)); ctx.fill();          // sol far
  _roundRectPath(ctx, X(17),  Y(23), P(9), P(4), P(2)); ctx.fill();          // sağ far
  ctx.restore();

  // 9) Arka stop lambaları
  ctx.save();
  if (night) { ctx.shadowColor = 'rgba(255,40,30,0.8)'; ctx.shadowBlur = P(6); }
  ctx.fillStyle = night ? 'rgba(255,70,55,0.95)' : 'rgba(190,55,42,0.85)';
  _roundRectPath(ctx, X(-25), Y(122), P(8), P(4), P(2)); ctx.fill();
  _roundRectPath(ctx, X(17),  Y(122), P(8), P(4), P(2)); ctx.fill();
  ctx.restore();
}

/**
 * Gündüz + gece Rover GPU image'larını kayıt eder.
 * force=true (stil reload / WebGL restore): GPU belleğini tazele, yeniden çiz.
 */
function ensureRoverImages(map: MapLibreMap, force?: boolean) {
  const size = 144;
  for (const [id, night] of [[ROVER_IMG_DAY, false], [ROVER_IMG_NIGHT, true]] as const) {
    if (!force && map.hasImage(id)) continue;
    if (map.hasImage(id)) { try { map.removeImage(id); } catch { /* ignore */ } }
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;
    _drawRover(ctx, size, night);
    const imgData = ctx.getImageData(0, 0, size, size);
    map.addImage(id, { width: size, height: size, data: new Uint8Array(imgData.data.buffer) });
  }
}

export function addUserMarker(
  map: MapLibreMap,
  latitude: number,
  longitude: number,
  heading?: number
) {
  if (!map) return;

  // Stil yeniden yüklenince icon-size expression sıfırlanır —
  // bir sonraki updateUserMarker hız farkı ne olursa olsun yeniden uygulasın.
  _lastScaleSpeedKmh = -1;

  const sourceId = 'user-location';

  // Remove old layers + source
  if (map.getSource(sourceId)) {
    for (const id of USER_LAYERS) {
      if (map.getLayer(id)) map.removeLayer(id);
    }
    map.removeSource(sourceId);
  }

  // Stil geçişi veya WebGL context yenilenmesinde GPU görseli bayatlar — zorla yenile
  ensureRoverImages(map, true);

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

  // 1. Amber glow halesi (en altta) — gece güçlü, gündüz sade. circle-blur ile yumuşak parıltı.
  map.addLayer({
    id: 'user-glow',
    type: 'circle',
    source: sourceId,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 16, 15, 26, 18, 34],
      'circle-color': _markerNight ? '#FF9E2C' : '#E0A23C',
      'circle-blur': 1,
      'circle-opacity': _markerNight ? 0.42 : 0.22,
      'circle-pitch-alignment': 'map',
    } as any,
  });

  // 2. Amber konum halkası — aracın altında çepeçevre, pulse/expand burada animasyonlu
  map.addLayer({
    id: 'user-ring',
    type: 'circle',
    source: sourceId,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 11, 15, 17, 18, 22],
      'circle-color': 'rgba(0,0,0,0)',
      'circle-stroke-width': 2.5,
      'circle-stroke-color': _markerNight ? '#FFB347' : '#E0A23C',
      'circle-stroke-opacity': 0.9,
      'circle-pitch-alignment': 'map',
    } as any,
  });

  // 3. CarOS Rover — heading'e göre döner. pitch-alignment:map → 3D nav görünümünde
  // zemine yatık "decal" gibi durur. icon-size dar aralık: çok büyümez/küçülmez.
  map.addLayer({
    id: 'user-vehicle',
    type: 'symbol',
    source: sourceId,
    layout: {
      'icon-image': _markerNight ? ROVER_IMG_NIGHT : ROVER_IMG_DAY,
      'icon-size': ['interpolate', ['linear'], ['zoom'], 10, 0.30, 14, 0.41, 18, 0.51],
      'icon-rotate': ['get', 'heading'],
      'icon-rotation-alignment': 'map',
      'icon-pitch-alignment': 'map',
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      'icon-offset': [0, 0],
    } as any,
  });

  // Katmanları en üste taşı — raster/vektör geçişlerinde veya OOM sonrası
  // diğer katmanların (rota, POI) üzerinde kalması garantilenir.
  try { map.moveLayer('user-glow'); }    catch { /* stil geçişi sırasında güvenli */ }
  try { map.moveLayer('user-ring'); }    catch { /* stil geçişi sırasında güvenli */ }
  try { map.moveLayer('user-vehicle'); } catch { /* stil geçişi sırasında güvenli */ }
}

export function updateUserMarker(latitude: number, longitude: number, heading?: number, speedKmh?: number) {
  const map = useMapStore.getState().mapInstance;
  if (!map) return;

  const sourceId  = 'user-location';
  const rawSource = map.getSource(sourceId);
  const layerExists = !!map.getLayer('user-vehicle');
  // Self-Healing: source kayıpsa VEYA ana katman WebGL/OOM baskısında düştüyse yeniden oluştur.
  // Anti-Flicker: addUserMarker ağır işlemdir; yalnızca gerçekten eksikse tetiklenir.
  if (!rawSource || !layerExists) {
    if (map.isStyleLoaded()) addUserMarker(map, latitude, longitude, heading);
    return;
  }
  const source = rawSource as GeoJSONSource;

  // ── Durum makinesi: Park / Hareket / Navigasyon ──────────────────────────
  // Hareket veya nav aktifken alt halkada hafif pulse; nav aktifken halka genişler.
  // Park (hız≈0, nav yok): statik glow — pulse yok, GPS tick'i de durduğundan CPU sıfır.
  const moving = (speedKmh ?? 0) > 1.5;
  const now    = performance.now();
  if ((moving || _markerNavActive) && now - _lastRingPulseMs > 150) {
    _lastRingPulseMs = now;
    const pulse    = Math.sin(now / 450) * 0.5 + 0.5;        // 0..1, ~2.8s periyot
    const navBoost = _markerNavActive ? 1.18 : 1.0;          // nav: halka genişler
    const rScale   = navBoost * (1 + pulse * 0.10);
    try {
      map.setPaintProperty('user-ring', 'circle-radius', [
        'interpolate', ['linear'], ['zoom'],
        10, 11 * rScale,
        15, 17 * rScale,
        18, 22 * rScale,
      ]);
      const baseOp = _markerNight ? 0.42 : 0.22;
      map.setPaintProperty('user-glow', 'circle-opacity', baseOp * (0.8 + pulse * 0.4) * navBoost);
    } catch { /* stil yeniden yükleniyor */ }
  }

  // C7.1 — hıza duyarlı ince ölçekleme (±3 km/h hysteresis) — araç çok az büyür
  if (speedKmh !== undefined && Math.abs(speedKmh - _lastScaleSpeedKmh) >= 3) {
    _lastScaleSpeedKmh = speedKmh;
    const clamped = Math.max(0, Math.min(100, speedKmh));
    const sf      = 0.95 + (clamped / 100) * 0.12;
    try {
      map.setLayoutProperty('user-vehicle', 'icon-size', [
        'interpolate', ['linear'], ['zoom'],
        10, 0.30 * sf,
        14, 0.41 * sf,
        18, 0.51 * sf,
      ]);
    } catch { /* stil yeniden yükleniyor */ }
  }

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

/**
 * Gündüz/gece temasını değiştir — Rover image variantını + halka/glow rengini günceller.
 * Idempotent; değişim yoksa hiçbir GPU işi yapmaz (re-render tetiklemez).
 */
export function setMarkerTheme(night: boolean): void {
  if (_markerNight === night) return;
  _markerNight = night;
  const map = useMapStore.getState().mapInstance;
  if (!map || !map.getLayer('user-vehicle')) return;
  try {
    map.setLayoutProperty('user-vehicle', 'icon-image', night ? ROVER_IMG_NIGHT : ROVER_IMG_DAY);
    map.setPaintProperty('user-ring', 'circle-stroke-color', night ? '#FFB347' : '#E0A23C');
    map.setPaintProperty('user-glow', 'circle-color',   night ? '#FF9E2C' : '#E0A23C');
    map.setPaintProperty('user-glow', 'circle-opacity', night ? 0.42 : 0.22);
  } catch { /* stil yeniden yükleniyor — sonraki addUserMarker doğru variantı kurar */ }
}

/**
 * Harita gün/gece geçişi — RESTYLE OLMADAN canlı paint güncellemesi (rota katmanları korunur).
 *
 * - Raster (OSM) aktifse: 'tiles-layer' paint'ini gündüz (doğal açık) / gece (grafit) setine
 *   geçirir + arka plan rengini günceller. setStyle() çağrılmaz → navigasyon rota/ok katmanları silinmez.
 * - Marker (rover) gün/gece variantı da güncellenir.
 * - mapSourceManager night state'i set edilir → sonraki stil yeniden inşası (kaynak değişimi vb.) doğru palet kullanır.
 *
 * Vektör (offline .pbf) aktifken gündüze geçiş raster temsiline gerektirir (buildVectorStyle
 * gündüzde raster'a düşer); bu durum bir sonraki stil yeniden inşasında uygulanır.
 */
export function applyMapDayNight(night: boolean, mapArg?: ReturnType<typeof useMapStore.getState>['mapInstance']): void {
  setMapNight(night);
  setMarkerTheme(night);
  const map = mapArg ?? useMapStore.getState().mapInstance;
  if (!map) return;
  try {
    if (map.getLayer('tiles-layer')) {
      // RASTER (OSM) → canlı paint: restyle yok, rota/marker korunur (en yaygın yol).
      const paint = night ? RASTER_PAINT_NIGHT : RASTER_PAINT_DAY;
      for (const [prop, val] of Object.entries(paint)) {
        map.setPaintProperty('tiles-layer', prop as any, val as any);
      }
      if (map.getLayer('background')) {
        map.setPaintProperty('background', 'background-color', night ? '#131822' : '#e9eef3');
      }
    }
    // NOT: Vektör (offline .pbf) veya uydu/hibrit → burada setStyle ÇAĞIRMA. setStyle,
    // mapStatus-tetiklemeli effect'te reload↔restyle döngüsü yaratıp birkaç dakikada
    // bellek/CPU şişmesine → çökmeye yol açabiliyordu. _mapNight yine güncellendiği için
    // bir sonraki DOĞAL stil inşası (kaynak/mod değişimi) doğru gün/gece paletini kurar.
  } catch { /* stil yeniden yükleniyor — sonraki getMapStyle doğru paleti kurar */ }
}

/**
 * Navigasyon aktiflik durumunu işaretle — alt halka genişler, glow güçlenir.
 * Yalnızca bayrak günceller; görsel etki updateUserMarker'ın pulse döngüsünde uygulanır.
 */
export function setMarkerNavActive(active: boolean): void {
  _markerNavActive = active;
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

    // Tek rAF: resize + rota replay'i MapLibre'nin fully-loaded state'inde çalıştır.
    // Stil yüklenmesi ile katmanların render hazırlığı arasındaki ~1 frame boşluğu kapatır.
    requestAnimationFrame(() => {
      const canvas = map.getCanvas();
      if (canvas && canvas.offsetWidth > 0 && canvas.offsetHeight > 0) {
        try { map.resize(); } catch { /* ignore */ }
      }

      // _pendingRouteGeometry null ise _cachedRoute fallback — stil geçişinde rota kaybolmaz
      const _routeToReplay = _pendingRouteGeometry ?? _cachedRoute;
      if (_routeToReplay) {
        _applyRouteGeometry(
          map,
          _routeToReplay.coords,
          _routeToReplay.alts,
          _routeToReplay.altIdx,
          0,
          _routeToReplay.altDurs,
          _routeToReplay.mainDur,
        );
      }

      // C7.2 — stil geçişi sonrası etkileşimleri yenile (zombi listener önleme)
      _setupRouteInteractions(map);
    });
  });
}

// ── Driving mode ─────────────────────────────────────────────
// Kamera hesaplamaları cameraEngine.ts'e taşındı (Faz 3.1).
// speedToZoom, _lastDrivingZoom, _inTurnApproach → cameraEngine.resetCameraSmooth/_sm

// Movement jitter — GPS mikro titremeleri (cameraEngine'de değil, pozisyon mantığı)
let _lastJumpLat = 0;
let _lastJumpLng = 0;

/**
 * Navigation (driving) view — Faz 3.1 cinematic camera.
 *
 * Kamera pipeline:
 *   1. computeCameraTarget()    → anlık hedef (zoom, pitch, lookAhead, topPad)
 *   2. dampCameraToward()       → EMA smooth (yumuşak geçişler, zıplama yok)
 *   3. computeLookAheadCenter() → map merkezi + turn anticipation bearing
 *   4. map.jumpTo()             → tek frame update (rAF zaten 60fps smooth)
 *   5. elevation / perspective / maneuver blocks (değiştirilmedi)
 *
 * @param turnApproachM  Bir sonraki manevra noktasına mesafe (metre)
 * @param obdSpeedKmh    GPS hız sıfırsa OBD fallback
 * @param nextTurnBearing Manevra sonrası yön — turn anticipation için (opsiyonel)
 */
export function setDrivingView(
  map: MapLibreMap,
  lat: number,
  lng: number,
  heading: number,
  speedKmh: number,
  containerHeight: number,
  turnApproachM?: number,
  obdSpeedKmh?: number,
  nextTurnBearing?: number,
) {
  if (!map || !map.isStyleLoaded()) return;

  // ── Dead Reckoning speed fusion ──────────────────────────────────────────
  const effectiveSpeed = speedKmh > 0 ? speedKmh : (obdSpeedKmh ?? 0);

  // ── Movement jitter filter — düşük hızda GPS mikro titremeleri ───────────
  if (effectiveSpeed < CAMERA_CFG.JITTER_SPEED_KMH) {
    const dLat  = (lat - _lastJumpLat) * 111_320;
    const dLng  = (lng - _lastJumpLng) * 111_320 * Math.cos((lat * Math.PI) / 180);
    if (Math.sqrt(dLat * dLat + dLng * dLng) < CAMERA_CFG.JITTER_THRESHOLD_M) return;
  }
  _lastJumpLat = lat;
  _lastJumpLng = lng;

  // ── Camera target → smooth (Faz 3.1/3.3/3.4) ───────────────────────────
  const target = computeCameraTarget(effectiveSpeed, turnApproachM);

  // Turn anticipation + inertia + momentum model (Faz 3.4)
  const anticipatedBearing = computeAnticipatedBearing(heading, turnApproachM, nextTurnBearing);
  const smooth             = dampCameraToward(target, anticipatedBearing, effectiveSpeed);

  // Route energy: hız + acceleration delta ile senkron pulse (Faz 3.4)
  _updateFlowSpeed(effectiveSpeed, smooth.deltaSpeed);

  // ── Camera Lockdown (Phase H4) ────────────────────────────────────────────
  // ATTENTION durumunda: look-ahead %50 kısalt + pitch 45°'de kilitle.
  // Bu "yakın ve sakin" perspektif, sürücünün engele odaklanmasını sağlar.
  // Zoom hysteresis: yüksek risk sırasında hız dalgalanmasından kaynaklanan
  // zoom titremesini sınırlandırır (risk 0.4+ → maxDelta küçülür).
  const { globalRiskScore: _hzRisk, hazardStatus: _hzStatus } = useHazardStore.getState();
  const _isLockdown = _hzStatus === 'ATTENTION';

  const _lookAhead = _isLockdown ? smooth.lookAheadM * 0.5 : smooth.lookAheadM;
  const _pitch     = _isLockdown ? Math.min(smooth.pitch, 45) : smooth.pitch;

  let _zoom = smooth.zoom;
  if (_hzRisk > 0.4 && _lastHazardZoom > 0) {
    // Risk arttıkça izin verilen max zoom değişimi küçülür: 0.4→0.06, 1.0→0.02
    const maxDelta = Math.max(0.02, 0.10 * (1 - _hzRisk));
    _zoom = _lastHazardZoom + Math.max(-maxDelta, Math.min(maxDelta, _zoom - _lastHazardZoom));
  }
  _lastHazardZoom = _zoom;

  // Look-ahead centre — kilitli değerler ile hesaplanır
  const _lookDeg   = _lookAhead / 111_320;
  const _cosLat    = Math.max(0.001, Math.cos((lat * Math.PI) / 180));
  const _bearRad   = (smooth.bearing * Math.PI) / 180;
  const centerLat  = lat + _lookDeg * Math.cos(_bearRad);
  const centerLng  = lng + _lookDeg * Math.sin(_bearRad) / _cosLat;

  const topPad = Math.round(containerHeight * target.topPadFrac);

  // jumpTo: tek frame — rAF loop 150ms throttle zaten smooth hissettiriyor.
  map.jumpTo({
    center:  [centerLng, centerLat],
    bearing: smooth.bearing,
    zoom:    _zoom,
    pitch:   _pitch,
    padding: { top: topPad, bottom: 0, left: 0, right: 0 },
  });

  // Smooth pitch tek kaynak — elevation + perspective aynı değeri kullanır ✓
  const pitch = smooth.pitch;

  // ── Elevation pass — dynamic shadow offset & blur (pitch + speed + zoom) ────
  const _currentZoom = map.getZoom();
  const _pitchChanged = Math.abs(pitch - _lastShadowPitch) >= 3;
  const _zoomChanged  = Math.abs(_currentZoom - _lastShadowZoom) >= 0.5;
  if ((_pitchChanged || _zoomChanged) && map.getLayer(ROUTE_SHADOW)) {
    _lastShadowPitch = pitch;
    _lastShadowZoom  = _currentZoom;
    _lastBlurReduced = effectiveSpeed > 20;

    const shadowOffset  = Math.round(2 + (pitch / 72) * 10);
    const pitchBlur     = 5 + (pitch / 72) * 6;
    const speedScale    = effectiveSpeed > 20 ? 0.45 : 1.0;
    const zoomSharpness = 1 - Math.max(0, Math.min(1, (_currentZoom - 12) / 6)) * 0.65;
    const shadowBlur    = Math.max(1.5, Math.round(pitchBlur * speedScale * zoomSharpness));
    const glowBlur      = Math.max(2.5, Math.round((8 + (pitch / 72) * 4) * speedScale * zoomSharpness));
    try {
      map.setPaintProperty(ROUTE_SHADOW,   'line-offset', shadowOffset);
      map.setPaintProperty(ROUTE_SHADOW,   'line-blur',   shadowBlur);
      map.setPaintProperty(ROUTE_GLOW_SEL, 'line-blur',   glowBlur);
    } catch { /* style reloading */ }
  }

  // ── Perspective correction ─────────────────────────────────────────────────
  const perspScale = 1 + (pitch / 72) * 0.4;
  if (Math.abs(perspScale - _lastPerspectiveScale) >= 0.06 && map.getLayer(SEL_LAYER)) {
    _lastPerspectiveScale = perspScale;
    const cW = Math.round(8  * perspScale);  const cW18 = Math.round(32 * perspScale);
    const kW = Math.round(14 * perspScale);  const kW18 = Math.round(38 * perspScale);
    try {
      map.setPaintProperty(SEL_LAYER,  'line-width', ['interpolate', ['linear'], ['zoom'], 12, cW, 18, cW18]);
      map.setPaintProperty(ROUTE_CASE, 'line-width', ['interpolate', ['linear'], ['zoom'], 12, kW, 18, kW18]);
    } catch { /* style reloading */ }
  }

  // ── Maneuver emphasis — tier-based route styling ───────────────────────────
  // Dönüşe yaklaşınca casing rengi amber'a döner; 50m altında glow da değişir.
  // Sadece tier geçişlerinde setPaintProperty çağrılır (state-machine, saniyede 6-7 kez değil).
  const _mTier = !turnApproachM || turnApproachM >= 200 ? 0
    : turnApproachM >= 50 ? 1
    : 2;
  if (_mTier !== _lastManeuverTier && map.getLayer(SEL_LAYER)) {
    _lastManeuverTier = _mTier;
    try {
      if (_mTier === 0) {
        map.setPaintProperty(SEL_LAYER,      'line-opacity', 1.0);
        map.setPaintProperty(ROUTE_CASE,     'line-color',   '#ffffff');
        map.setPaintProperty(ROUTE_GLOW_SEL, 'line-color',   '#4285f4');
      } else if (_mTier === 1) {
        // Yaklaşıyor (200–50m): casing amber → sürücü dikkatini çeker
        map.setPaintProperty(ROUTE_CASE,     'line-color',   '#f59e0b');
      } else {
        // Kritik (<50m): amber glow + casing — kontrast road suppression'dan gelir artık
        map.setPaintProperty(ROUTE_CASE,     'line-color',   '#f59e0b');
        map.setPaintProperty(ROUTE_GLOW_SEL, 'line-color',   '#f59e0b');
        map.setPaintProperty(SEL_LAYER,      'line-opacity', 1.0); // Faz 3.2: tam opacity — lane clarity
      }
    } catch { /* style reloading */ }
  }

  // ── Intersection road suppression + tunnel glow (Faz 3.2) ──────────────────
  if (_focusModeActive && _mTier !== _lastIntersectionTier) {
    _lastIntersectionTier = _mTier;
    _applyIntersectionSuppression(map, _mTier);
    const _glowOp = [0.20, 0.27, 0.36][_mTier] ?? 0.20;
    if (map.getLayer(ROUTE_GLOW_SEL)) {
      try { map.setPaintProperty(ROUTE_GLOW_SEL, 'line-opacity', _glowOp); } catch { /* ignore */ }
    }
  }

  // ── External Risk Alert (Phase H3) ────────────────────────────────────────
  // globalRiskScore > 0.5 → casing + glow amber ("Dış Tehlike Uyarısı").
  // State machine: sadece geçişte tetiklenir; mevcut maneuver tier korunur.
  const _hazardRisk = useHazardStore.getState().globalRiskScore;
  const _isHighRisk = _hazardRisk > 0.5;
  if (_isHighRisk !== _lastExternalRiskAlert && map.getLayer(ROUTE_CASE)) {
    _lastExternalRiskAlert = _isHighRisk;
    try {
      if (_isHighRisk) {
        map.setPaintProperty(ROUTE_CASE,     'line-color', '#f59e0b');
        map.setPaintProperty(ROUTE_GLOW_SEL, 'line-color', '#f59e0b');
      } else if (_mTier === 0) {
        // Sadece tier 0'da (kavşak yokken) orijinal renklere dön
        map.setPaintProperty(ROUTE_CASE,     'line-color', '#ffffff');
        map.setPaintProperty(ROUTE_GLOW_SEL, 'line-color', '#4285f4');
      }
    } catch { /* style reloading */ }
  }
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

  const TARGET_ZOOM    = 18.0; // Yakın yol detayı
  const TARGET_PITCH   = 38;   // 40°+ üzerinde siyah köşe riski artar
  const DURATION_MS    = 1000; // Yumuşak giriş animasyonu

  // Smooth camera state'i giriş noktasıyla eşitle — ilk tick'te jump olmasın
  resetCameraSmooth({ zoom: TARGET_ZOOM, pitch: TARGET_PITCH, lookAheadM: 30, bearing });

  const lookAheadDeg = 30 / 111_320;
  const headRad      = (bearing * Math.PI) / 180;
  const cosLat       = Math.max(0.001, Math.cos((lat * Math.PI) / 180));
  const centerLat    = lat + lookAheadDeg * Math.cos(headRad);
  const centerLng    = lng + lookAheadDeg * Math.sin(headRad) / cosLat;

  const topPad = Math.round(containerHeight * 0.48);

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
 * Route layer paint properties are restored so style changes from maneuver
 * emphasis / perspective correction don't leak into browse mode.
 */
export function exitDrivingView(map: MapLibreMap) {
  if (!map) return;
  _lastPerspectiveScale  = 1.0;
  _lastManeuverTier      = 0;
  _lastShadowPitch       = -1.0;
  _lastShadowZoom        = -1.0;
  _lastMoodScore         = -1.0;
  _lastExternalRiskAlert = false;
  _lastHazardZoom        = 0;
  // Camera smooth state'i sıfırla — sonraki navigasyonda jump olmasın
  resetCameraSmooth({ zoom: 15.5, pitch: 0, lookAheadM: 0, bearing: 0 });
  // Route layer state restore
  if (map.isStyleLoaded()) {
    try {
      if (map.getLayer(SEL_LAYER))      map.setPaintProperty(SEL_LAYER,      'line-opacity', 1.0);
      if (map.getLayer(ROUTE_CASE))     map.setPaintProperty(ROUTE_CASE,     'line-color',   '#ffffff');
      if (map.getLayer(ROUTE_GLOW_SEL)) map.setPaintProperty(ROUTE_GLOW_SEL, 'line-color',   '#4285f4');
    } catch { /* ignore */ }
  }
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

const ROUTE_SHADOW    = 'car-route-shadow';      // Layer 0 — depth shadow
const ROUTE_GLOW_SEL  = 'car-route-glow-sel';   // Layer 1 — neon outer glow
const ROUTE_CASE      = 'car-route-casing';      // Layer 2 — contrast border
const SEL_LAYER       = 'selected-route-layer';  // Layer 3 — gradient core
const ROUTE_FLOW      = 'car-route-flow';        // Layer 4 — marching-ants flow
const ALT_SRC         = 'car-route-alt';
const ALT_FILL        = 'car-route-alt-fill';
const ALT_BADGE_SRC   = 'car-route-alt-badge';
const ALT_BADGE_LAYER = 'car-route-alt-badge-labels';
const DEBUG_SRC       = 'car-route-debug';
const DEBUG_LAYER     = 'car-route-debug-line';
const SEL_SRC         = 'selected-route-source';
const BADGE_IMAGE_ID  = 'alt-badge-bg'; // C7.3 — premium glassmorphic badge arkaplanı

/* ── Cinematic light trail (rAF + line-gradient) ─────────────────────────────
 * requestAnimationFrame — shifts a white pulse along the route via line-gradient
 * color-stop animation. Throttled to 80ms (~12.5 fps) — Mali-400 safe.
 * line-dasharray omitted; gradient gives a smoother and GPU-cheaper result.
 */
let _flowRafId:   number | null = null;
let _flowProgress = 0.0;

/* ── _buildPulseGradient — GC-optimized (H5) ─────────────────────────────
 * Renk string'leri (rgba...) riskScore nadiren değişir; önbelleklenerek
 * her 80ms'de yeniden oluşturulmaları önlenir → Mali-400 GC baskısı azalır.
 * Konum değerleri (t0-t5) her çağrıda p ile hesaplanır — kaçınılmaz.
 */
const _PULSE_TRANSPARENT = 'rgba(255,255,255,0)';
let _pCacheRisk    = -1;
let _pCacheAttn    = false;
let _pPeakStr      = 'rgba(255,255,255,0.80)';
let _pShoulderStr  = 'rgba(255,255,255,0.22)';

/**
 * @param p           Pulse ilerlemesi [0,1)
 * @param riskScore   Global tehlike skoru — pulse genişliği ve parlaklığını etkiler
 * @param isAttention ATTENTION durumunda pulse daha keskin ve parlak olur
 */
function _buildPulseGradient(p: number, riskScore = 0, isAttention = false): unknown[] {
  // Renk string'leri: sadece risk veya attention değişince yeniden oluştur
  if (Math.abs(riskScore - _pCacheRisk) > 0.01 || isAttention !== _pCacheAttn) {
    _pCacheRisk  = riskScore;
    _pCacheAttn  = isAttention;
    const peak   = isAttention ? 0.96 : 0.80 + 0.15 * riskScore;
    const shldr  = 0.22 + 0.10 * riskScore;
    _pPeakStr    = `rgba(255,255,255,${peak.toFixed(2)})`;
    _pShoulderStr = `rgba(255,255,255,${shldr.toFixed(2)})`;
  }

  const W  = 0.10 - 0.04 * riskScore;
  const t0 = 0;
  const t1 = Math.max(0.001, p - W * 1.5);
  const t2 = Math.max(t1 + 0.001, p - W);
  const t3 = Math.max(t2 + 0.001, p);
  const t4 = Math.min(0.998, Math.max(t3 + 0.001, p + W * 0.4));
  const t5 = 1;

  if (t3 >= t4) {
    return ['interpolate', ['linear'], ['line-progress'],
      0, _PULSE_TRANSPARENT, 1, _PULSE_TRANSPARENT];
  }
  return [
    'interpolate', ['linear'], ['line-progress'],
    t0, _PULSE_TRANSPARENT,
    t1, _PULSE_TRANSPARENT,
    t2, _pShoulderStr,
    t3, _pPeakStr,
    t4, _PULSE_TRANSPARENT,
    t5, _PULSE_TRANSPARENT,
  ];
}

/**
 * Glow nefes animasyonu — H5: psikologik tempo (derin nefes modeli).
 * period = 2500 − risk × 1000  →  risk=0: 2.5s, risk=1: 1.5s
 * Eski 250-600ms aralığı panik hissi yaratıyordu; yeni 1.5-2.5s sakin.
 */
function _applyBreathingGlow(map: MapLibreMap, nowMs: number, hazardRisk: number): void {
  if (!map.getLayer(ROUTE_GLOW_SEL)) return;

  // Bilişsel mod kısıtı: PROTECTION → genlik %70 azaltılır; CRITICAL/LIMP_HOME → glow kapalı
  const cogMode = useCognitiveStore.getState().currentMode;
  if (cogMode === 'CRITICAL' || cogMode === 'LIMP_HOME') return;
  const cogAmplitudeFactor = cogMode === 'PROTECTION' ? 0.30 : 1.0; // %70 azaltma

  // S4: Safety state'ten görsel risk katkısı — INTERVENTION en yüksek öncelik
  const { safetyState } = useSafetyStore.getState();
  const safetyRisk = safetyState === 'INTERVENTION' ? 0.85
    : safetyState === 'CAUTION'    ? 0.55
    : 0;

  // Blend: safety büyükse güvenlik görsel önceliği kazanır
  const visualRisk = Math.max(hazardRisk, safetyRisk);
  if (visualRisk < 0.05) return;

  // Period: Safety durumu hazard tabanlı zamandan önce gelir
  //   INTERVENTION → 1500ms (hızlı/acil nefes)
  //   CAUTION      → 2000ms (orta nefes)
  //   Hazard only  → 2500–1500ms (mevcut davranış)
  let period: number;
  if      (safetyState === 'INTERVENTION') period = 1500;
  else if (safetyState === 'CAUTION')      period = 2000;
  else                                      period = 2500 - hazardRisk * 1000;

  const breath         = Math.sin((nowMs / period) * Math.PI * 2); // −1 → +1
  // INTERVENTION: genlik ×1.4 — daha belirgin titreşim; PROTECTION: kısıtlı genlik
  const amplitudeScale = (safetyState === 'INTERVENTION' ? 1.4 : 1.0) * cogAmplitudeFactor;
  const width          = Math.max(10, 22 + breath * 12 * visualRisk * amplitudeScale);

  try { map.setPaintProperty(ROUTE_GLOW_SEL, 'line-width', width); }
  catch { /* style reloading */ }
}

/**
 * ALT_BADGE_LAYER için glassmorphic badge arkaplan imajı oluşturur ve haritaya kaydeder.
 * MALI-400 safe: gerçek blur yok; %88 opak koyu navy + ince mavi çerçeve.
 * icon-text-fit:'both' ile her badge, metin boyutuna göre otomatik ölçeklenir.
 * Style geçişinde hasImage kontrolü ile gereksiz yeniden oluşturma önlenir.
 */
function _ensureBadgeImage(map: MapLibreMap): void {
  if (map.hasImage(BADGE_IMAGE_ID)) return;
  const W = 80, H = 32, R = 8;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // Yuvarlatılmış dikdörtgen — glassmorphic dark navy zemin
  ctx.beginPath();
  ctx.moveTo(R, 0);
  ctx.lineTo(W - R, 0); ctx.arcTo(W, 0,  W, R,     R);
  ctx.lineTo(W, H - R); ctx.arcTo(W, H,  W - R, H, R);
  ctx.lineTo(R, H);     ctx.arcTo(0, H,  0, H - R, R);
  ctx.lineTo(0, R);     ctx.arcTo(0, 0,  R, 0,     R);
  ctx.closePath();

  ctx.fillStyle = 'rgba(14,28,48,0.88)';
  ctx.fill();

  ctx.strokeStyle = 'rgba(224,162,60,0.45)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  const imgData = ctx.getImageData(0, 0, W, H);
  map.addImage(BADGE_IMAGE_ID, {
    width:  W,
    height: H,
    data:   new Uint8Array(imgData.data.buffer),
  });
}

function _startLightTrail(): void {
  if (_flowRafId !== null) return;
  let lastMs = 0;
  const TICK_MS = 80;

  const frame = (nowMs: number) => {
    _flowRafId = requestAnimationFrame(frame);
    if (nowMs - lastMs < TICK_MS) return;
    lastMs = nowMs;

    const map = useMapStore.getState().mapInstance;
    if (!map || !map.isStyleLoaded() || !map.getLayer(ROUTE_FLOW)) return;

    // Tehlike durumu — her tick'te store snapshot (sıfır allocation, sadece referans okuma)
    const { globalRiskScore, hazardStatus } = useHazardStore.getState();
    const isAttention = hazardStatus === 'ATTENTION';

    // PROTECTION modunda flow hızı ve risk boost dondurulur — sürücüyü yormama prensibi
    const cogMode     = useCognitiveStore.getState().currentMode;
    const isProtected = cogMode === 'PROTECTION' || cogMode === 'CRITICAL';
    const riskBoost   = isProtected ? 0 : 0.023 * globalRiskScore;
    const flowStep    = isProtected ? 0.010 : 0.022 * _flowSpeedFactor; // sabit yavaş akış
    _flowProgress = (_flowProgress + flowStep + riskBoost) % 1;

    // Pulse gradyanı (risk ve dikkat durumuna duyarlı)
    try {
      map.setPaintProperty(
        ROUTE_FLOW,
        'line-gradient',
        _buildPulseGradient(_flowProgress, globalRiskScore, isAttention),
      );
    } catch { /* style reloading */ }

    // Glow nefes animasyonu
    _applyBreathingGlow(map, nowMs, globalRiskScore);

    // Harita mood güncellemesi (200ms iç kısıtlama ile korunuyor)
    updateMapMood(map, globalRiskScore);
  };

  _flowRafId = requestAnimationFrame(frame);
}

function _stopLightTrail(): void {
  if (_flowRafId !== null) { cancelAnimationFrame(_flowRafId); _flowRafId = null; }
  _flowProgress = 0;
}

/* ── Movement Energy — pulse speed scales with vehicle velocity (Faz 3.3) ───
 * Dur → 0.4× (yavaş, ortam nabzı)
 * 60 km/h → 1.0× (şehir içi enerji)
 * 120 km/h → 1.6× (otoyol akışı)
 * Hysteresis: 5 km/h altındaki değişimler güncelleme tetiklemez.
 */
let _flowSpeedFactor  = 1.0;
let _lastFlowSpeedKmh = -1.0;

function _updateFlowSpeed(speedKmh: number, deltaSpeed: number): void {
  // Hysteresis: hız veya delta değişmediğinde güncelleme atla
  if (Math.abs(speedKmh - _lastFlowSpeedKmh) < 3 && Math.abs(deltaSpeed) < 2) return;
  _lastFlowSpeedKmh = speedKmh;
  const baseSpeed   = Math.max(0.4, Math.min(1.4, 0.4 + speedKmh / 100));
  // Pozitif delta (hızlanma) → anlık pulse burst; negatif delta etkisiz (braking sönük)
  const accelBoost  = Math.max(0, deltaSpeed * 0.018);
  _flowSpeedFactor  = Math.min(1.8, baseSpeed + accelBoost);
}

/* ── Map Mood Controller (Phase H3) ─────────────────────────────────────────
 * globalRiskScore arttıkça harita görsel karakteri değişir:
 *   - place-city etiketleri sönümlenir (intersection tier ile çakışmaz)
 *   - background hafif karartılır (kontrast artar)
 *   - road-primary/secondary rengi nötr griye kayar (rota "öne çıkar")
 *
 * 200ms iç kısıt + 0.05 hysteresis → GPU paint spam koruması.
 */
let _lastMoodScore        = -1.0;
let _lastMoodMs           = 0;
let _lastMoodSafetyState  = '';   // S4: safety state hysteresis
const MOOD_THROTTLE_MS    = 200;
const MOOD_HYSTERESIS     = 0.05;

export function updateMapMood(map: MapLibreMap, riskScore: number): void {
  if (!map || !map.isStyleLoaded()) return;
  const nowMs = performance.now();
  if (nowMs - _lastMoodMs < MOOD_THROTTLE_MS) return;

  // PROTECTION modunda harita mood güncellemesi askıya alınır — GPU overdraw azaltılır
  const cogMode = useCognitiveStore.getState().currentMode;
  if (cogMode === 'PROTECTION' || cogMode === 'CRITICAL' || cogMode === 'LIMP_HOME') return;

  // S4: Safety state'i hysteresis'e dahil et — durum değişince mood güncellenir
  const { safetyState } = useSafetyStore.getState();
  if (Math.abs(riskScore - _lastMoodScore) < MOOD_HYSTERESIS
    && safetyState === _lastMoodSafetyState) return;
  _lastMoodMs          = nowMs;
  _lastMoodScore       = riskScore;
  _lastMoodSafetyState = safetyState;

  // S4: Safety durumu → ek baskı (CAUTION +%15, INTERVENTION +%30)
  const safetyBoost = safetyState === 'INTERVENTION' ? 0.30
    : safetyState === 'CAUTION'    ? 0.15
    : 0;
  const r = Math.max(0, Math.min(1, riskScore + safetyBoost));

  // place-city — intersection tier listesinde YOK; mood'un özel hedefi
  if (map.getLayer('place-city')) {
    try { map.setPaintProperty('place-city', 'text-opacity', Math.max(0, 0.85 * (1 - r))); }
    catch { /* noop */ }
  }

  // road-label — min 0.60 (H5): sürücü tehlike anında bile cadde adını okuyabilmeli.
  // Sadece tier=0 (kavşak yaklaşımı yok) durumunda uygulanır; çakışmayı önler.
  if (map.getLayer('road-label') && _lastIntersectionTier === 0) {
    // risk=0 → 1.0, risk=1 → 0.60 (minimum okunabilirlik garanti)
    try { map.setPaintProperty('road-label', 'text-opacity', Math.max(0.60, 1.0 - 0.40 * r)); }
    catch { /* noop */ }
  }

  // Background: OEM --map-bg-1 #131822 → riskte hafif koyulaşır (#0c0f19)
  const bR = Math.round(19 - 7 * r);
  const bG = Math.round(24 - 9 * r);
  const bB = Math.round(34 - 9 * r);
  if (map.getLayer('background')) {
    try { map.setPaintProperty('background', 'background-color', `rgb(${bR},${bG},${bB})`); }
    catch { /* noop */ }
  }

  // Road colors — OEM grafit paletiyle hizalı (style base ile aynı çıpa)
  // road-primary: #44444f (--map-art-a) → riskte #303037
  if (map.getLayer('road-primary')) {
    const pR = Math.round(68 - 20 * r);
    const pG = Math.round(68 - 20 * r);
    const pB = Math.round(79 - 24 * r);
    try { map.setPaintProperty('road-primary', 'line-color', `rgb(${pR},${pG},${pB})`); }
    catch { /* noop */ }
  }
  // road-secondary: #383840 → riskte #262630
  if (map.getLayer('road-secondary')) {
    const sR = Math.round(56 - 18 * r);
    const sG = Math.round(56 - 18 * r);
    const sB = Math.round(64 - 20 * r);
    try { map.setPaintProperty('road-secondary', 'line-color', `rgb(${sR},${sG},${sB})`); }
    catch { /* noop */ }
  }
}

/* ── External Risk Alert state (Phase H3) ────────────────────────────────── */
let _lastExternalRiskAlert = false;

/* ── Camera Lockdown state (Phase H4) ────────────────────────────────────── */
let _lastHazardZoom = 0; // zoom hysteresis referansı (0 = henüz init edilmedi)

/* ── Navigation Focus Mode — adaptive road suppression (Faz 3.1 / 3.2) ──────
 * Tier state machine:
 *   0 = normal navigation  → NAV_SUPPRESS_TIERS[0]
 *   1 = turn approach 50-200m → NAV_SUPPRESS_TIERS[1]
 *   2 = junction <50m       → NAV_SUPPRESS_TIERS[2]
 *
 * _lastIntersectionTier transitions are fired by setDrivingView on turnApproachM change.
 * Route glow opacity scales with tier for "tunnel focus" effect.
 */
let _focusModeActive    = false;
let _lastIntersectionTier = 0; // -1 = force re-apply on next tick

function _applyFocusMode(map: MapLibreMap, active: boolean): void {
  if (!map || !map.isStyleLoaded()) return;
  for (const [id, prop, suppressedVal] of NAV_SUPPRESS_LAYERS) {
    if (map.getLayer(id)) {
      try { map.setPaintProperty(id, prop, active ? suppressedVal : 1.0); } catch { /* ignore */ }
    }
  }
}

/**
 * Intersection tier'a göre yol katmanlarını bastır.
 * NAV_SUPPRESS_TIERS[tier] set'indeki tüm katmanlara tier değerini uygular.
 */
function _applyIntersectionSuppression(map: MapLibreMap, tier: number): void {
  if (!map || !map.isStyleLoaded()) return;
  const entries = NAV_SUPPRESS_TIERS[Math.min(tier, NAV_SUPPRESS_TIERS.length - 1)] ?? NAV_SUPPRESS_TIERS[0];
  for (const [id, prop, val] of entries) {
    if (map.getLayer(id)) {
      try { map.setPaintProperty(id, prop as 'line-opacity' | 'text-opacity', val); } catch { /* ignore */ }
    }
  }
}

/** İsNavigating durumuna göre yol katmanlarının opaklığını güncelle. */
export function updateNavigationStyle(map: MapLibreMap, active: boolean): void {
  if (_focusModeActive === active) return;
  _focusModeActive = active;
  if (!active) {
    _lastIntersectionTier = 0; // sonraki nav oturumu için sıfırla
  }
  _applyFocusMode(map, active);
}

/** setNavigationFocusMode → updateNavigationStyle alias (backward compat). */
export const setNavigationFocusMode = updateNavigationStyle;

/** Style switch sonrası mevcut focus + intersection tier'ı yeniden uygula. */
export function reapplyNavigationFocus(map: MapLibreMap): void {
  _applyFocusMode(map, _focusModeActive);
  // Style switch tüm paint'leri sıfırlar — intersection tier'ı yeniden uygula
  if (_focusModeActive) {
    _applyIntersectionSuppression(map, _lastIntersectionTier);
  }
  // Sonraki setDrivingView tick'inde forced re-apply olmadan çalışır ✓
}

/* ── Perspective correction + Maneuver emphasis state ───────────────────── */
let _lastPerspectiveScale = 1.0;
let _lastManeuverTier     = 0;  // 0=none, 1=approach ≤200m, 2=critical ≤50m

/* ── Dynamic shadow elevation + GPU blur state ──────────────────────────── */
let _lastShadowPitch = -1.0;   // −1 forces first-frame apply
let _lastShadowZoom  = -1.0;   // zoom-based sharpening tracker
let _lastBlurReduced = false;  // speed > 20 km/h → halved blur

// Module-level cache — harita style sıfırlandığında re-apply için
let _cachedRoute: { coords: [number, number][]; alts: [number, number][][]; altIdx?: number[]; altDurs?: number[]; mainDur?: number } | null = null;
let _pendingRouteGeometry: { coords: [number, number][]; alts: [number, number][][]; altIdx?: number[]; altDurs?: number[]; mainDur?: number } | null = null;
let _isStyleChanging = false;

/** mapService._isStyleChanging'i FullMapView mutex ile senkronize et. */
export function setMapStyleChanging(active: boolean): void {
  _isStyleChanging = active;
}


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
  altDurations?:   number[],
  mainDuration?:   number,
): void {
  if (!map || !coordinates.length) return;

  // routingService.normalizeCoords() already ensures [lon, lat] (GeoJSON standard).
  // Do NOT swap here — Turkey's longitude (26-45) overlaps with latitude range and any
  // heuristic guard incorrectly re-swaps already-correct coords for central/east Turkey.

  _cachedRoute          = { coords: coordinates, alts: alternatives, altIdx: altRealIndices, altDurs: altDurations, mainDur: mainDuration };
  _pendingRouteGeometry = { coords: coordinates, alts: alternatives, altIdx: altRealIndices, altDurs: altDurations, mainDur: mainDuration };

  // Visibility / Deadlock Watchdog — Android low-memory can silently drop layers while
  // style stays loaded. If SEL_LAYER is missing despite style being ready, clear stuck flag.
  if (map.isStyleLoaded() && !map.getLayer(SEL_LAYER)) {
    // STUCK-FLAG DEADLOCK: stil TAM yüklü + rota katmanı yok ama _isStyleChanging hâlâ true →
    // bir style.load kaçırılmış / bayrak temizlenmemiş demektir. Bayrak takılı kalırsa rota
    // "hesaplandı ama çizgi hiç çizilmez" (kullanıcı raporu). Güvenli: yalnız stil yüklüyken
    // (gerçek setStyle sırasında isStyleLoaded()=false olur, buraya girilmez) temizleyip çiziyoruz.
    if (_isStyleChanging) _isStyleChanging = false;
  }

  if (_isStyleChanging) return;

  // NOT: Stil "yüklü değil" görünse bile burada 'style.load' beklemiyoruz —
  // zaten yüklü stilde tetiklenmez ve Android'de isStyleLoaded() false-negative
  // verebilir. _applyRouteGeometry kendi içinde frame-poll ile hazır olana kadar
  // bekler, böylece rota askıda kalmaz ve geç gelmez.
  _applyRouteGeometry(map, coordinates, alternatives, altRealIndices, 0, altDurations, mainDuration);
}


function _applyRouteGeometry(
  map:             MapLibreMap,
  coordinates:     [number, number][],
  alternatives:    [number, number][][],
  altRealIndices?: number[],
  retryCount       = 0,
  altDurations?:   number[],
  mainDuration?:   number,
): void {
  if (!map) return;

  if (!map.isStyleLoaded()) {
    // Android WebView: isStyleLoaded() sık sık FALSE-NEGATIVE döner (stil görsel
    // olarak hazır olsa bile) ve ZATEN YÜKLÜ bir stilde 'style.load' bir daha
    // tetiklenmez. style.load beklemek rota çizimini kalıcı askıya alıyordu →
    // çizgi yalnızca 3sn'lik failsafe ile, GEÇ geliyordu. Çözüm: bir sonraki
    // frame'de poll ile yeniden dene; isStyleLoaded genelde 1-2 frame'de true'ya
    // döner → çizgi ~100ms içinde çizilir, saniyelerce beklenmez.
    if (retryCount < 40) {
      setTimeout(
        () => _applyRouteGeometry(map, coordinates, alternatives, altRealIndices, retryCount + 1, altDurations, mainDuration),
        50,
      );
    }
    return;
  }

  try {
    // routingService.normalizeCoords() already guarantees [lon, lat] order.
    const coords: [number, number][] = coordinates;

    // ── Alternatif rotalar (gri, arkada) ─────────────────────────
    const fixedAlts = alternatives;
    const altFeatures = fixedAlts.map((altCoords, i) => ({
      type: 'Feature' as const,
      geometry: { type: 'LineString' as const, coordinates: altCoords },
      properties: { altRealIdx: altRealIndices?.[i] ?? (i + 1) },
    }));
    const altData = { type: 'FeatureCollection' as const, features: altFeatures };
    // Robust: source orphan veya layer silinmiş → ikisini birden yeniden oluştur
    if (!map.getSource(ALT_SRC) || !map.getLayer(ALT_FILL)) {
      try { if (map.getLayer(ALT_FILL)) map.removeLayer(ALT_FILL); } catch { /* ignore */ }
      try { if (map.getSource(ALT_SRC)) map.removeSource(ALT_SRC); } catch { /* ignore */ }
      map.addSource(ALT_SRC, { type: 'geojson', data: altData } as any);
      map.addLayer({
        id: ALT_FILL,
        type: 'line',
        source: ALT_SRC,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#94a3b8', 'line-width': 6, 'line-opacity': 0.50 },
      } as any);
    } else {
      (map.getSource(ALT_SRC) as any).setData(altData);
    }

    // ── Alternatif rota zaman etiketleri (midpoint badge) ────────────────────
    const badgeFeatures = fixedAlts.map((altCoords, i) => {
      const mid = altCoords[Math.floor(altCoords.length / 2)] ?? altCoords[0];
      const altDur  = altDurations?.[i];
      const diffSec = altDur !== undefined && mainDuration !== undefined ? altDur - mainDuration : null;
      let label = '';
      if (diffSec !== null) {
        const mins = Math.round(Math.abs(diffSec) / 60);
        label = diffSec > 0 ? `+${mins} dk` : mins === 0 ? '' : `-${mins} dk`;
      }
      return {
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: mid },
        properties: { label },
      };
    }).filter(f => (f.properties.label as string).length > 0);
    const badgeData = { type: 'FeatureCollection' as const, features: badgeFeatures };
    if (!map.getSource(ALT_BADGE_SRC) || !map.getLayer(ALT_BADGE_LAYER)) {
      try { if (map.getLayer(ALT_BADGE_LAYER)) map.removeLayer(ALT_BADGE_LAYER); } catch { /* ignore */ }
      try { if (map.getSource(ALT_BADGE_SRC)) map.removeSource(ALT_BADGE_SRC); } catch { /* ignore */ }
      map.addSource(ALT_BADGE_SRC, { type: 'geojson', data: badgeData } as any);
      _ensureBadgeImage(map); // C7.3 — badge arkaplan imajını hazırla
      map.addLayer({
        id:      ALT_BADGE_LAYER,
        type:    'symbol',
        source:  ALT_BADGE_SRC,
        minzoom: 10, // çok düşük zoom'da etiket gizlenir — kalabalık önleme
        layout: {
          'text-field':  ['get', 'label'],
          'text-font':   ['Open Sans Bold', 'Arial Unicode MS Bold'],
          // Zoom'a göre okunabilir boyut — 10: min (10px), 15: standart (14px)
          'text-size':   ['interpolate', ['linear'], ['zoom'], 10, 10, 15, 14],
          // Glassmorphic badge arkaplanı — icon-text-fit ile metne göre ölçeklenir
          'icon-image':            BADGE_IMAGE_ID,
          'icon-text-fit':         'both',
          'icon-text-fit-padding': [5, 10, 5, 10], // üst, sağ, alt, sol padding (px)
          // Akıllı yerleşim: rota çizgisiyle çakışmamak için 4 pozisyon dener
          'text-variable-anchor': ['top', 'bottom', 'left', 'right'],
          'text-justify':         'center',
          'text-letter-spacing':   0.03,
          'text-allow-overlap':    false,
          'text-ignore-placement': false,
        },
        paint: {
          'text-color':      '#ffffff',
          // Güneş altında okunabilirlik — minimum 2px hare
          'text-halo-color': 'rgba(0,0,0,0.70)',
          'text-halo-width': 2,
          'icon-opacity':    0.92,
          'text-opacity':    1,
        },
      } as any);
    } else {
      (map.getSource(ALT_BADGE_SRC) as any).setData(badgeData);
    }

    // Head unit / düşük GPU tespiti — line-blur, line-gradient ve ekstra katmanlar atlanır
    const _isLowEnd = typeof document !== 'undefined' &&
      document.documentElement.classList.contains('perf-low');

    // ── Step 3: route stack — source + layer re-creation (robust) ──
    // perf-low: yalnızca CASE + SEL_LAYER zorunlu. Aksi: 5-katman tam.
    const _selSrcOk    = !!map.getSource(SEL_SRC);
    const _selLayersOk = _isLowEnd
      ? (!!map.getLayer(ROUTE_CASE) && !!map.getLayer(SEL_LAYER))
      : (!!map.getLayer(ROUTE_SHADOW)
         && !!map.getLayer(ROUTE_GLOW_SEL)
         && !!map.getLayer(ROUTE_CASE)
         && !!map.getLayer(SEL_LAYER)
         && !!map.getLayer(ROUTE_FLOW));

    if (!_selSrcOk || !_selLayersOk) {
      // Temizle — ters sırayla (üstten alta) kaldır
      for (const id of [ROUTE_FLOW, SEL_LAYER, ROUTE_CASE, ROUTE_GLOW_SEL, ROUTE_SHADOW]) {
        try { if (map.getLayer(id)) map.removeLayer(id); } catch { /* ignore */ }
      }
      try { if (map.getSource(SEL_SRC)) map.removeSource(SEL_SRC); } catch { /* ignore */ }

      // Source — lineMetrics: true, line-gradient ve line-progress için zorunlu
      map.addSource(SEL_SRC, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
        lineMetrics: !_isLowEnd, // perf-low'da gerekmiyor (gradient yok)
      } as any);

      // Layer 0 — Shadow: line-blur GPU yoğun, head unit'lerde atla
      if (!_isLowEnd) {
        map.addLayer({
          id: ROUTE_SHADOW,
          type: 'line',
          source: SEL_SRC,
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color':  '#000000',
            'line-width':  ['interpolate', ['linear'], ['zoom'], 12, 8, 18, 22],
            'line-opacity': 0.20,
            'line-blur':    8,
            'line-offset':  3,
          },
        } as any);

        // Layer 1 — Outer Glow: blur ile neon halo, head unit'lerde atla
        map.addLayer({
          id: ROUTE_GLOW_SEL,
          type: 'line',
          source: SEL_SRC,
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color':  '#4285f4',
            'line-width':  ['interpolate', ['linear'], ['zoom'], 12, 10, 18, 24],
            'line-opacity': 0.20,
            'line-blur':    10,
          },
        } as any);
      }

      // Layer 2 — Casing: beyaz sınır (Google Maps tarzı — ince ve net)
      map.addLayer({
        id: ROUTE_CASE,
        type: 'line',
        source: SEL_SRC,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color':  '#ffffff',
          'line-width':  ['interpolate', ['linear'], ['zoom'], 12, 6, 18, 14],
          'line-opacity': 0.95,
        },
      } as any);
      const _coreFillPaint: any = {
        'line-width':  ['interpolate', ['linear'], ['zoom'], 12, 4, 18, 10],
        'line-opacity': 1,
      };
      if (_isLowEnd) {
        _coreFillPaint['line-color'] = '#1A73E8'; // Solid Google blue — head unit safe
      } else {
        _coreFillPaint['line-gradient'] = [
          'interpolate', ['linear'], ['line-progress'],
          0,   '#1A73E8',  // departure — Google blue
          0.5, '#4F46E5',  // mid — indigo
          1,   '#10b981',  // arrival — emerald
        ];
      }
      map.addLayer({
        id: SEL_LAYER,
        type: 'line',
        source: SEL_SRC,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: _coreFillPaint,
      } as any);

      // Layer 4 — Flow: cinematic light trail. Head unit'lerde rAF + line-gradient
      // çift maliyetli → atla, pil ve GPU tasarrufu için.
      if (!_isLowEnd) {
        map.addLayer({
          id: ROUTE_FLOW,
          type: 'line',
          source: SEL_SRC,
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-width':    ['interpolate', ['linear'], ['zoom'], 12, 4, 18, 14],
            'line-opacity':  0.85,
            'line-gradient': _buildPulseGradient(0.5),
          },
        } as any);

        // Light trail rAF loop başlat (singleton — çift çağrı güvenli)
        _startLightTrail();
      }

    } else {
      // Tüm katmanlar mevcut — sadece maneuver/perspective state sıfırla.
      // setDrivingView bir sonraki tick'te yeniden uygular.
      _lastPerspectiveScale = 1.0;
      _lastManeuverTier     = 0;
      try {
        map.setPaintProperty(SEL_LAYER,      'line-opacity', 1);
        map.setPaintProperty(ROUTE_CASE,     'line-color',   '#ffffff');
        map.setPaintProperty(ROUTE_GLOW_SEL, 'line-color',   '#4285f4');
      } catch { /* style may be reloading */ }
    }

    // ── Step 4: set data ─────────────────────────────────────────
    const routeFeature = {
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: coords },
    };
    (map.getSource(SEL_SRC) as any).setData(routeFeature);

    // ── Step 5: z-ordering — alt→üst: shadow→glow→case→core→flow→araç ────────
    try { map.moveLayer(ALT_FILL); }        catch { /* ignore */ }
    try { map.moveLayer(ALT_BADGE_LAYER); } catch { /* ignore */ }
    try { map.moveLayer(ROUTE_SHADOW); }    catch { /* ignore */ }
    try { map.moveLayer(ROUTE_GLOW_SEL); } catch { /* ignore */ }
    try { map.moveLayer(ROUTE_CASE); }     catch { /* ignore */ }
    try { map.moveLayer(SEL_LAYER); }      catch { /* ignore */ }
    try { map.moveLayer(ROUTE_FLOW); }     catch { /* ignore */ }
    // Araç marker'ı tüm rota katmanlarının üstünde
    try { map.moveLayer('user-glow'); }    catch { /* ignore */ }
    try { map.moveLayer('user-ring'); }    catch { /* ignore */ }
    try { map.moveLayer('user-vehicle'); } catch { /* ignore */ }

    // ── Step 6: fit bounds (sadece preview modda — driving modda setDrivingView ile çatışır) ───
    if (!useMapStore.getState().drivingMode) {
      try {
        if (coords.length >= 2) {
          const bounds = coords.reduce(
            (b, c) => b.extend(c as [number, number]),
            new maplibregl.LngLatBounds(coords[0] as [number, number], coords[0] as [number, number]),
          );
          map.fitBounds(bounds, { padding: 80, maxZoom: 15, duration: 500 });
        }
      } catch { /* fitBounds geometry hatası — yoksay */ }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[MAP_WEBGL_ERROR]', msg);
    if (retryCount < 1) {
      setTimeout(() => _applyRouteGeometry(map, coordinates, alternatives, altRealIndices, 1, altDurations, mainDuration), 500);
    }
    return;
  }

  _pendingRouteGeometry = null;
}


/** Rota çizgilerini (ana + alternatifler + debug) ve cache'i temizle. */
export function clearRouteGeometry(map: MapLibreMap): void {
  _cachedRoute          = null;
  _pendingRouteGeometry = null;
  // Light trail rAF loop durdur — cancelAnimationFrame garantili
  _stopLightTrail();
  // Perspektif / manevra / intersection durumunu sıfırla
  _lastPerspectiveScale  = 1.0;
  _lastManeuverTier      = 0;
  _lastIntersectionTier  = 0;
  // Stil değişimi sürerken MapLibre tüm layer'ları otomatik siliyor.
  // Layer kaldırma işlemi hem gereksiz hem de hata fırlatabilir — yoksay.
  if (!map || _isStyleChanging) return;
  try {
    if (map.getLayer(DEBUG_LAYER))     map.removeLayer(DEBUG_LAYER);
    if (map.getSource(DEBUG_SRC))      map.removeSource(DEBUG_SRC);
    // 5-layer stack — ters sırayla kaldır (üstten alta)
    if (map.getLayer(ROUTE_FLOW))      map.removeLayer(ROUTE_FLOW);
    if (map.getLayer(SEL_LAYER))       map.removeLayer(SEL_LAYER);
    if (map.getLayer(ROUTE_CASE))      map.removeLayer(ROUTE_CASE);
    if (map.getLayer(ROUTE_GLOW_SEL))  map.removeLayer(ROUTE_GLOW_SEL);
    if (map.getLayer(ROUTE_SHADOW))    map.removeLayer(ROUTE_SHADOW);
    if (map.getSource(SEL_SRC))        map.removeSource(SEL_SRC);
    if (map.getLayer(ALT_FILL))         map.removeLayer(ALT_FILL);
    if (map.getSource(ALT_SRC))         map.removeSource(ALT_SRC);
    if (map.getLayer(ALT_BADGE_LAYER))  map.removeLayer(ALT_BADGE_LAYER);
    if (map.getSource(ALT_BADGE_SRC))   map.removeSource(ALT_BADGE_SRC);
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
  logInfo('[MAP_DESTROY]');
  _initGen++;
  _isStyleChanging  = false;
  _initPromise      = null;
  _currentContainer = null;
  _cleanupRouteInteractions(); // C7.2 — zombi listener temizliği

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
      // Focus mode already reduces road-label opacity; only override when hiding fully
      if (!_focusModeActive || hideHighSpeed) {
        map.setPaintProperty('road-label', 'text-opacity', hideHighSpeed ? 0.25 : 1);
      }
    }
  }

  // ── GPU overdraw guard — blur zımalaması browsing modda (pitch ≈ 0) ─────────
  // setDrivingView pitch-tabanlı blur'u yönetir; bu yalnızca sürüş dışı durum içindir.
  // _lastShadowPitch ≤ 0 → sürüş modu yok → blur optimizasyonu burada yapılır.
  if (_lastShadowPitch <= 0) {
    const blurNow = speedKmh > 20;
    if (blurNow !== _lastBlurReduced) {
      _lastBlurReduced = blurNow;
      if (map.getLayer(ROUTE_SHADOW)) {
        try { map.setPaintProperty(ROUTE_SHADOW,   'line-blur', blurNow ? 3  : 8);  } catch { /* noop */ }
      }
      if (map.getLayer(ROUTE_GLOW_SEL)) {
        try { map.setPaintProperty(ROUTE_GLOW_SEL, 'line-blur', blurNow ? 5  : 10); } catch { /* noop */ }
      }
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
