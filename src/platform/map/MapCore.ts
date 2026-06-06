// ══════════════════════════════════════════════════════════════════════════
// CarOS Pro — MapCore
//
// Sorumluluk: harita instance lifecycle (MapLibre init/destroy), WebGL context
// yönetimi ve GPU kaynak temizliği. En kritik fonksiyon _freeContext
// (WEBGL_lose_context — Mali-400 VRAM koruması) BURADA ve DEĞİŞTİRİLMEDİ.
//
// Bağımlılık: _mapState + MapLayerManager (_applyRouteGeometry) +
// MapInteractionManager (route interaction setup/cleanup). Davranış değişikliği
// YOK; mapService.ts'ten birebir taşındı.
// ══════════════════════════════════════════════════════════════════════════
import maplibregl, { Map as MapLibreMap } from 'maplibre-gl';
import { logInfo } from '../debug';
import { logError } from '../crashLogger';
import { handleSatelliteTileError, setActiveMapSource } from '../mapSourceManager';
import { cacheLRUManager } from '../../core/storage/CacheLRUManager';
import { M, useMapStore, OSM_STYLE, getOnlineTileStyle, type MapConfig } from './_mapState';
import { _applyRouteGeometry } from './MapLayerManager';
import { _setupRouteInteractions, _cleanupRouteInteractions } from './MapInteractionManager';

// Ensure smart-tile protocol is never active
try { maplibregl.removeProtocol('smart-tile'); } catch { /* not registered */ }
// Register caros-tile cache interceptor (idempotent)
cacheLRUManager.init();

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

// ── GPU context serbest bırakma (KRİTİK — DEĞİŞTİRİLMEDİ) ─────────────────────
// destroyMap() sonrası WEBGL_lose_context ile GPU slot serbest bırakılır,
// ardından 2 rAF frame beklenerek yeni context talebi güvenli hale gelir.
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
  if (map.isStyleLoaded()) {
    try {
      // 1. Custom image texture'larını boşalt (HEADING_CONE, ALT_BADGE vb.)
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

  // 4. Bilinen event aboneliklerini kaldır — map.remove() tüm listener'ları zaten temizler.

  try { map.remove(); } catch { /* canvas already removed */ }

  // GPU'ya context kaybını bildir — slot hemen serbest kalır
  try { gl?.getExtension('WEBGL_lose_context')?.loseContext(); } catch { /* ignore */ }

  // 2 rAF frame: GPU sürücüsünün context'i işlemesi için minimum bekleme
  await new Promise<void>(resolve =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );

  _logHeap('post-destroy');
}

/**
 * WebGL desteğini kontrol eder.
 * Returns: true → WebGL kullanılabilir, false → harita açılamaz.
 */
export function isWebGLAvailable(): boolean {
  if (M.webglAvailableCache !== null) return M.webglAvailableCache;
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('webgl') ?? canvas.getContext('experimental-webgl');
    if (!ctx) { M.webglAvailableCache = false; return false; }
    const gl = ctx as WebGLRenderingContext;
    const ok = typeof gl.createShader === 'function';
    // Kontrol canvas'ını hemen serbest bırak — context slotunu tıkama
    try { (gl.getExtension('WEBGL_lose_context') as any)?.loseContext(); } catch { /* ignore */ }
    M.webglAvailableCache = ok;
    return ok;
  } catch {
    M.webglAvailableCache = false;
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
  if (M.initPromise) {
    if (M.currentContainer === container) {
      // Aynı container, aynı init in-flight → bekle
      return M.initPromise;
    }
    // Farklı container → mevcut init'i iptal et (_initGen++ → _initCore erken çıkar)
    logInfo('[MAP_INIT] different container — cancelling in-flight init');
    M.initGen++;
    M.initPromise = null;
    M.currentContainer = null;
  }

  const existing = useMapStore.getState().mapInstance;
  if (existing) {
    logInfo('[MAP_DESTROY] clearing existing instance before re-init');
    destroyMap();
  }

  M.currentContainer = container;
  const myGen = M.initGen;

  M.initPromise = Promise.race<MapLibreMap>([
    _initCore(container, config, myGen),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Map init timeout (30s)')), 30_000)
    ),
  ]).finally(() => {
    if (M.initGen === myGen) {
      M.initPromise    = null;
      M.currentContainer = null;
    }
  });

  return M.initPromise;
}

async function _initCore(
  container: HTMLElement,
  _config: MapConfig,
  gen: number,
): Promise<MapLibreMap> {
  // ── Mutex: önceki context tamamen serbest kalana kadar bekle ──────────────
  await M.destroyLock;
  if (gen !== M.initGen) throw new Error('Map init cancelled');

  // ── Dimension guard: 0×0 container'da WebGL context asla talep edilmez ───
  if (container.offsetWidth === 0 || container.offsetHeight === 0) {
    // Tek rAF daha bekle — CSS transition henüz bitmemiş olabilir
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    if (gen !== M.initGen) throw new Error('Map init cancelled');
    if (container.offsetWidth === 0 || container.offsetHeight === 0) {
      throw new Error('Container has zero dimensions — WebGL context refused');
    }
  }

  try {
    // Offline tile server DISABLED — device has no tiles, interceptor causes 404 spam
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
      if (M.cachedRoute && M.cachedRoute.coords?.length > 2) {
        _applyRouteGeometry(map, M.cachedRoute.coords, M.cachedRoute.alts, M.cachedRoute.altIdx);
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
        if (M.cachedRoute && M.cachedRoute.coords?.length > 2) {
          _applyRouteGeometry(map, M.cachedRoute.coords, M.cachedRoute.alts, M.cachedRoute.altIdx);
        }
        useMapStore.setState({ isReady: true });
      };

      if (map.isStyleLoaded()) {
        healMap();
      } else {
        map.once('style.load', healMap);
      }
    });

    if (gen !== M.initGen) {
      try { map.remove(); } catch { /* already removed */ }
      throw new Error('Map init cancelled');
    }
    useMapStore.setState({ mapInstance: map, error: null });
    return map;
  } catch (err) {
    if (gen !== M.initGen) throw err; // cancelled — skip fallback

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
      if (gen !== M.initGen) {
        try { fallbackMap.remove(); } catch { /* already removed */ }
        throw new Error('Map init cancelled');
      }
      useMapStore.setState({ mapInstance: fallbackMap, error: null });
      return fallbackMap;
    } catch (fallbackErr) {
      if (gen !== M.initGen) throw fallbackErr;
      const msg = fallbackErr instanceof Error ? fallbackErr.message : 'Map init failed';
      useMapStore.setState({ error: msg });
      throw fallbackErr;
    }
  }
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
      M.isStyleChanging = false;
      useMapStore.setState({ isReady: true });
    }
  };

  map.once('error', onError);
  M.isStyleChanging = true;
  try { map.resize(); } catch { /* container may be transitioning */ }
  map.setStyle(style);
  map.once('style.load', () => {
    map.off('error', onError);
    M.isStyleChanging = false;
    useMapStore.setState({ isReady: true });

    // Tek rAF: resize + rota replay'i MapLibre'nin fully-loaded state'inde çalıştır.
    requestAnimationFrame(() => {
      const canvas = map.getCanvas();
      if (canvas && canvas.offsetWidth > 0 && canvas.offsetHeight > 0) {
        try { map.resize(); } catch { /* ignore */ }
      }

      // _pendingRouteGeometry null ise _cachedRoute fallback — stil geçişinde rota kaybolmaz
      const _routeToReplay = M.pendingRouteGeometry ?? M.cachedRoute;
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

export function getMapInstance(): MapLibreMap | null {
  return useMapStore.getState().mapInstance;
}

export function useMapState() {
  return useMapStore();
}

export function destroyMap() {
  logInfo('[MAP_DESTROY]');
  M.initGen++;
  M.isStyleChanging  = false;
  M.initPromise      = null;
  M.currentContainer = null;
  _cleanupRouteInteractions(); // C7.2 — zombi listener temizliği

  const map = useMapStore.getState().mapInstance;
  useMapStore.setState({ mapInstance: null, isReady: false, drivingMode: false });

  if (map) {
    // _destroyLock: WEBGL_lose_context + 2 rAF bekleme — yeni context talep edilmeden önce çözülür
    M.destroyLock = _freeContext(map);
  } else {
    M.destroyLock = Promise.resolve();
  }
}

/**
 * Sahiplik doğrulamalı yıkım — yalnızca çağıran instance hâlâ store'daki
 * instance ile eşleşiyorsa global destroyMap() çağrılır.
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
 * @returns true → context sağlıklı, false → zombi tespit edildi, harita yok edildi
 */
export function checkAndHealMapContext(): boolean {
  const map = useMapStore.getState().mapInstance;
  if (!map) return false;

  try {
    const canvas = map.getCanvas();
    if (!canvas) { destroyMap(); return false; }

    // MapLibre 4.x WebGL2 tercih eder — webgl2 önce dene, yoksa webgl1'e geç
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
