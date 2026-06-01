import type { StyleSpecification } from 'maplibre-gl';
import { getTileCacheStats } from './serviceWorkerManager';
import type { MapMode, TileRenderMode, MapSource, MapSourceState } from './mapSourceTypes';
import {
  buildVectorStyle,
  buildRoadStyle,
  buildSatelliteStyle,
  buildHybridStyle,
} from './mapStyleBuilders';
import {
  probeLocalTiles,
  writeOfflinePref,
  detectLocalSources,
} from './mapTileProbe';
import {
  useMapSourceStore,
  attachNetworkListeners,
  detachNetworkListeners,
  setForcedDowngradeFrom,
} from './mapSourceStore';
import {
  registerSmartTileProtocol,
  registerGlyphCacheProtocol,
  unregisterProtocols,
  resetProtocolHits,
} from './mapProtocols';

export type { MapMode, TileRenderMode, MapSource, MapSourceState };
export { useMapSourceStore, buildVectorStyle, buildRoadStyle, buildSatelliteStyle, buildHybridStyle };
export { detachNetworkListeners };

/**
 * Initialize map sources — detects local tiles, IndexedDB cache, and online
 */
export async function initializeMapSources(): Promise<void> {
  attachNetworkListeners();
  registerSmartTileProtocol();
  registerGlyphCacheProtocol();

  try {
    useMapSourceStore.setState({ isLoading: true });

    const sources = new Map<string, MapSource>();

    // Always register online source as ultimate fallback
    sources.set('online', {
      id: 'online',
      name: 'OpenStreetMap',
      type: 'online',
      description: 'Online harita (OSM)',
      isAvailable: true,
    });

    // 1) Probe for local tile dataset at /maps/{z}/{x}/{y}.png
    //    Öncelik: Capacitor Filesystem (SD kart / iç depo) → APK asset → online.
    //    Optimistic offline-first: if we've ever seen local tiles on this device,
    //    register the source immediately (no probe wait) so the map starts offline.
    //    A background probe then verifies and updates the preference.

    const { source: localSource, hadLocalBefore } = await detectLocalSources();
    if (localSource) {
      sources.set('local', localSource);
    }

    // Background probe — verifies actual tile presence and updates localStorage
    probeLocalTiles().then((hasLocal) => {
      writeOfflinePref(hasLocal);
      const { sources: currentSources, activeSourceId } = useMapSourceStore.getState();
      const updated = new Map(currentSources);
      if (hasLocal) {
        updated.set('local', {
          id: 'local',
          name: 'Yerel Harita',
          type: 'offline',
          description: 'Cihazda yüklü offline harita verileri',
          isAvailable: true,
        });
        // If we were forced online (no cached pref), switch to local now
        if (activeSourceId === 'online' && !updated.has('local')) {
          useMapSourceStore.setState({ sources: updated, activeSourceId: 'local', servingFrom: 'local' });
        } else {
          useMapSourceStore.setState({ sources: updated });
        }
      } else if (!hasLocal && !hadLocalBefore) {
        // Never had local tiles — nothing to change
      } else {
        // Had local before but tiles are gone now (e.g. storage cleared)
        updated.delete('local');
        const newActive = updated.has('cached') ? 'cached' : 'online';
        useMapSourceStore.setState({
          sources: updated,
          activeSourceId: activeSourceId === 'local' ? newActive : activeSourceId,
          servingFrom: (activeSourceId === 'local' ? newActive : activeSourceId) as 'cached' | 'online',
        });
      }
    }).catch(() => { /* probe failed — keep existing state */ });

    // 2) Check IndexedDB / service worker cache
    try {
      const stats = await getTileCacheStats();
      if (stats.totalTiles > 0) {
        sources.set('cached', {
          id: 'cached',
          name: 'Önbellek',
          type: 'offline',
          description: 'Daha önce indirilen harita karoları',
          isAvailable: true,
          cacheSize: stats.cacheSize,
          tileCount: stats.totalTiles,
          lastUpdated: Date.now(),
        });
      }
    } catch {
      // cache check failed, skip
    }

    // Determine priority: local > cached > online
    // (local is already added optimistically above if localStorage says it exists)
    let activeId: string;
    if (sources.has('local')) {
      activeId = 'local';
    } else if (sources.has('cached')) {
      activeId = 'cached';
    } else {
      activeId = 'online';
    }

    // Reset tile hit counters
    resetProtocolHits();

    useMapSourceStore.setState({
      sources,
      activeSourceId: activeId,
      servingFrom: activeId as 'local' | 'cached' | 'online',
      initialized: true,
      isLoading: false,
      error: null,
    });
  } catch {
    // Even on total failure, ensure online source is always available
    const fallbackSources = new Map<string, MapSource>();
    fallbackSources.set('online', {
      id: 'online',
      name: 'OpenStreetMap',
      type: 'online',
      description: 'Online harita',
      isAvailable: true,
    });
    useMapSourceStore.setState({
      sources: fallbackSources,
      activeSourceId: 'online',
      servingFrom: 'online',
      isLoading: false,
      error: null,
      initialized: true,
    });
  }
}

/**
 * Get all available map sources
 */
export function getMapSources(): MapSource[] {
  const { sources } = useMapSourceStore.getState();
  return Array.from(sources.values());
}

/**
 * Get map source by ID
 */
export function getMapSource(id: string): MapSource | null {
  const { sources } = useMapSourceStore.getState();
  return sources.get(id) || null;
}

/**
 * Set active map source
 */
export function setActiveMapSource(sourceId: string): boolean {
  const { sources } = useMapSourceStore.getState();
  if (!sources.has(sourceId)) {
    return false;
  }

  useMapSourceStore.setState({ activeSourceId: sourceId });
  return true;
}

/**
 * Get active map source
 */
export function getActiveMapSource(): MapSource | null {
  const { sources, activeSourceId } = useMapSourceStore.getState();
  if (!activeSourceId) return null;
  return sources.get(activeSourceId) || null;
}

/**
 * Get active source ID
 */
export function getActiveMapSourceId(): string | null {
  return useMapSourceStore.getState().activeSourceId;
}

/**
 * Check if offline maps available (local tiles or IndexedDB cache)
 */
export function hasOfflineMapData(): boolean {
  const { sources } = useMapSourceStore.getState();
  const hasLocal = sources.get('local')?.isAvailable === true;
  const hasCached = sources.get('cached')?.isAvailable === true;
  return hasLocal || hasCached;
}

/**
 * Get map source status for UI — reflects actual serving state
 */
export function getMapSourceStatus(): {
  status: 'offline' | 'online';
  message: string;
  source: MapSource | null;
} {
  const { servingFrom, isOnline, sources } = useMapSourceStore.getState();
  const active = getActiveMapSource();

  if (!active) {
    return {
      status: isOnline ? 'online' : 'offline',
      message: isOnline ? 'Online harita' : 'Bağlantı yok',
      source: null,
    };
  }

  // Use servingFrom for real-time accuracy
  if (servingFrom === 'local') {
    return {
      status: 'offline',
      message: isOnline
        ? 'Yerel Harita (öncelikli)'
        : 'Yerel Harita — İnternet yok',
      source: sources.get('local') || active,
    };
  }

  if (servingFrom === 'cached') {
    const cached = sources.get('cached');
    return {
      status: 'offline',
      message: `Önbellek Harita (${cached?.cacheSize || '?'})`,
      source: cached || active,
    };
  }

  return {
    status: 'online',
    message: 'Online Harita (OSM)',
    source: sources.get('online') || active,
  };
}

/**
 * Refresh source availability (re-probe local + check cache)
 */
export async function refreshMapSources(): Promise<void> {
  try {
    useMapSourceStore.setState({ isLoading: true });
    const { sources } = useMapSourceStore.getState();

    // Re-probe local tiles
    try {
      const hasLocal = await probeLocalTiles();
      if (hasLocal) {
        sources.set('local', {
          id: 'local',
          name: 'Yerel Harita',
          type: 'offline',
          description: 'Cihazda yüklü offline harita verileri',
          isAvailable: true,
        });
      } else {
        sources.delete('local');
      }
    } catch {
      sources.delete('local');
    }

    // Re-check IndexedDB cache
    try {
      const stats = await getTileCacheStats();
      if (stats.totalTiles > 0) {
        sources.set('cached', {
          id: 'cached',
          name: 'Önbellek',
          type: 'offline',
          description: 'Daha önce indirilen harita karoları',
          isAvailable: true,
          cacheSize: stats.cacheSize,
          tileCount: stats.totalTiles,
          lastUpdated: Date.now(),
        });
      } else {
        sources.delete('cached');
      }
    } catch {
      sources.delete('cached');
    }

    // Reset hit counters for fresh detection
    resetProtocolHits();

    useMapSourceStore.setState({
      sources,
      isLoading: false,
      error: null,
    });

    // Re-evaluate priority if current active source was removed
    const { activeSourceId } = useMapSourceStore.getState();
    if (!activeSourceId || !sources.has(activeSourceId)) {
      if (sources.has('local')) setActiveMapSource('local');
      else if (sources.has('cached')) setActiveMapSource('cached');
      else setActiveMapSource('online');
    }
  } catch {
    useMapSourceStore.setState({ isLoading: false });
  }
}

/**
 * Get the tile URL(s) for the currently active source.
 *
 * ALWAYS returns caros-tile:// so all fetches go through CacheLRUManager's JS
 * protocol handler instead of MapLibre's internal XHR.  MapLibre's XHR is
 * blocked by Capacitor Android WebView's CORS/mixed-content policy when the
 * origin is capacitor:// or file://.  The caros-tile handler uses the JS
 * fetch() API (which Capacitor's native bridge allows) and adds a 500 MB LRU
 * disk cache on top — this is the single tile pipeline the app uses (matches
 * OSM_STYLE in mapService.ts). The legacy smart-tile protocol is no longer
 * registered, so emitting it here produced "scheme not supported" → black map.
 */
export function getActiveTileUrls(): string[] {
  return ['caros-tile://tile.openstreetmap.org/{z}/{x}/{y}.png'];
}

/**
 * Get map style based on active source, map mode, and tile render mode.
 *
 * Road mode applies the tile render strategy:
 *   tileRender='raster' → raster OSM (navigation / AR)
 *   tileRender='vector' → OMT vector (browse / idle)
 *
 * Satellite/hybrid are always raster regardless of tileRender.
 */
/** Harita gün/gece durumu — getMapStyle ve canlı paint geçişi (applyMapDayNight) okur.
 *  Varsayılan gece (mevcut davranış korunur); FullMapView mount'ta isNight'e göre set eder. */
let _mapNight = true;
export function setMapNight(night: boolean): void { _mapNight = night; }
export function getMapNight(): boolean { return _mapNight; }

export function getMapStyle(): StyleSpecification {
  const { mapMode, tileRender, sources, activeSourceId } = useMapSourceStore.getState();
  if (mapMode === 'satellite') return buildSatelliteStyle();
  if (mapMode === 'hybrid')    return buildHybridStyle();
  const roadFallback = () => buildRoadStyle(activeSourceId, sources, getActiveTileUrls, _mapNight);
  if (tileRender === 'vector') return buildVectorStyle(sources, roadFallback, _mapNight);
  return buildRoadStyle(activeSourceId, sources, getActiveTileUrls, _mapNight);
}

/**
 * Subscribe to source changes
 */
export function subscribeToMapSources(
  callback: (state: MapSourceState) => void
): () => void {
  return useMapSourceStore.subscribe((state) => callback(state));
}

/**
 * Use hook for map sources
 */
export function useMapSources() {
  return useMapSourceStore();
}

/**
 * Use hook for active source
 */
export function useActiveMapSource() {
  const { activeSourceId, sources } = useMapSourceStore();
  return activeSourceId ? sources.get(activeSourceId) || null : null;
}

/**
 * Use hook for network + serving status
 */
export function useMapNetworkStatus() {
  const isOnline = useMapSourceStore((s) => s.isOnline);
  const servingFrom = useMapSourceStore((s) => s.servingFrom);
  return { isOnline, servingFrom };
}

/**
 * Set map display mode. Satellite/hybrid are silently forced to road when offline.
 * Stores the user's intention so the mode is restored when connectivity returns.
 */
export function setMapMode(mode: MapMode): void {
  const { isOnline } = useMapSourceStore.getState();

  if ((mode === 'satellite' || mode === 'hybrid') && !isOnline) {
    // User wants satellite/hybrid but we're offline — downgrade gracefully
    // and remember so we restore automatically when online.
    setForcedDowngradeFrom(mode);
    useMapSourceStore.setState({ mapMode: 'road' });
  } else {
    // Explicit user choice — clear any pending restore to avoid overriding it.
    setForcedDowngradeFrom(null);
    useMapSourceStore.setState({ mapMode: mode });
  }
}

/**
 * Called when satellite tile loading fails (e.g. Esri rate-limited or blocked).
 * Gracefully falls back to road mode so the map stays usable.
 */
export function handleSatelliteTileError(): void {
  const { mapMode } = useMapSourceStore.getState();
  if (mapMode === 'satellite' || mapMode === 'hybrid') {
    useMapSourceStore.setState({ mapMode: 'road' });
    // Log once so the user knows why it switched
    import('./errorBus').then(({ showToast }) =>
      showToast({ type: 'warning', title: 'Uydu görüntüsü yüklenemedi', message: 'Yol görünümüne geçildi', duration: 4000 })
    ).catch(() => undefined);
  }
}

/**
 * Get current map mode
 */
export function getMapMode(): MapMode {
  return useMapSourceStore.getState().mapMode;
}

/**
 * Reactive hook for map mode
 */
export function useMapMode(): MapMode {
  return useMapSourceStore((s) => s.mapMode);
}

// ── Hybrid render auto-switch ────────────────────────────────

/**
 * Debounce timer for idle→vector transition.
 * Raster→instant; vector→debounced so brief nav pauses don't cause a
 * round-trip (vector decode stall right as the user resumes navigating).
 */
let _toVectorTimer: ReturnType<typeof setTimeout> | null = null;

// Thermal lock — FPS < 20 tespit edildiğinde raster modunu kilitler
let _thermalLock = false;

/**
 * FullMapView FPS monitöründen çağrılır.
 * isLow=true  → raster'ı kilitle, bekleyen vector geçişini iptal et.
 * isLow=false → kilidi aç (vector geçişine tekrar izin ver).
 */
export function notifyLowFPS(isLow: boolean): void {
  _thermalLock = isLow;
  if (isLow) {
    if (_toVectorTimer !== null) {
      clearTimeout(_toVectorTimer);
      _toVectorTimer = null;
    }
    const { mapMode } = useMapSourceStore.getState();
    if (mapMode === 'road') {
      useMapSourceStore.setState({ tileRender: 'raster' });
    }
  }
}

/**
 * Call this whenever navigation or AR active state changes.
 * Manages the raster ↔ vector switch automatically:
 *
 *   active (nav || ar) → 'raster' immediately
 *   idle 2500ms        → 'vector' (debounced)
 *
 * Does nothing when mapMode !== 'road' (satellite/hybrid are always raster).
 */
export function notifyNavigationRender(isNavigating: boolean, arActive: boolean): void {
  const { mapMode } = useMapSourceStore.getState();
  if (mapMode !== 'road') return;

  if (arActive || _thermalLock) {
    // AR ve thermal lock: raster (kamera overlay + performans)
    if (_toVectorTimer !== null) { clearTimeout(_toVectorTimer); _toVectorTimer = null; }
    useMapSourceStore.setState({ tileRender: 'raster' });
  } else if (isNavigating) {
    // Navigasyon: vector zorla — 3D binalar + POI + okunaklı etiketler
    if (_toVectorTimer !== null) { clearTimeout(_toVectorTimer); _toVectorTimer = null; }
    useMapSourceStore.setState({ tileRender: 'vector' });
  } else {
    // Debounce: wait 2500ms of confirmed idle before switching to vector.
    // Only if thermal lock is clear at fire time.
    if (_toVectorTimer !== null) return; // already scheduled
    _toVectorTimer = setTimeout(() => {
      _toVectorTimer = null;
      if (!_thermalLock) {
        useMapSourceStore.setState({ tileRender: 'vector' });
      }
    }, 2500);
  }
}

/**
 * Reactive hook — subscribe in FullMapView to trigger style switches.
 * Returns the current tile render mode.
 */
export function useTileRenderMode(): TileRenderMode {
  return useMapSourceStore((s) => s.tileRender);
}

// ── HMR cleanup (Vite dev mode) ─────────────────────────────
// When this module is replaced during hot-reload, tear down listeners and
// unregister the custom protocol so the new module can re-register cleanly.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    detachNetworkListeners();
    unregisterProtocols();
    if (_toVectorTimer !== null) { clearTimeout(_toVectorTimer); _toVectorTimer = null; }
  });
}
