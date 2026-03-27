import { create } from 'zustand';
import maplibregl from 'maplibre-gl';
import { getTileCacheStats } from './serviceWorkerManager';

export type MapMode = 'road' | 'hybrid' | 'satellite';

export interface MapSource {
  id: string;
  name: string;
  type: 'offline' | 'online';
  description: string;
  isAvailable: boolean;
  cacheSize?: string;
  tileCount?: number;
  lastUpdated?: number;
}

interface MapSourceState {
  sources: Map<string, MapSource>;
  activeSourceId: string | null;
  /** Which source is actually serving tiles right now */
  servingFrom: 'local' | 'online' | 'cached' | null;
  isOnline: boolean;
  isLoading: boolean;
  error: string | null;
  initialized: boolean;
  mapMode: MapMode;
}

const useMapSourceStore = create<MapSourceState>(() => ({
  sources: new Map(),
  activeSourceId: null,
  servingFrom: null,
  isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
  isLoading: false,
  error: null,
  initialized: false,
  mapMode: 'road',
}));

// ── Network detection ───────────────────────────────────────
let networkListenersAttached = false;

function attachNetworkListeners() {
  if (networkListenersAttached || typeof window === 'undefined') return;
  networkListenersAttached = true;

  window.addEventListener('online', () => {
    useMapSourceStore.setState({ isOnline: true });
  });
  window.addEventListener('offline', () => {
    useMapSourceStore.setState({ isOnline: false });
    // Satellite/hybrid require network — fall back to road when offline
    const { mapMode } = useMapSourceStore.getState();
    if (mapMode !== 'road') {
      useMapSourceStore.setState({ mapMode: 'road' });
    }
  });
}

// ── Local tile probing ──────────────────────────────────────

// Known probe tiles at different zoom levels covering Turkey
const PROBE_TILES = [
  { z: 6, x: 37, y: 24 },  // Turkey overview
  { z: 8, x: 150, y: 97 }, // Istanbul area
  { z: 10, x: 601, y: 389 }, // Istanbul closer
  { z: 4, x: 9, y: 6 },    // Wide view
];

/**
 * Probe /maps/ directory for local tile data.
 * Returns true if at least one tile is found.
 */
async function probeLocalTiles(): Promise<boolean> {
  for (const { z, x, y } of PROBE_TILES) {
    try {
      const resp = await fetch(`/maps/${z}/${x}/${y}.png`, { method: 'HEAD' });
      if (resp.ok && resp.status === 200) {
        return true;
      }
    } catch {
      // continue to next probe
    }
  }
  return false;
}

// ── Smart tile protocol ─────────────────────────────────────
// Registered once via maplibre addProtocol. Tries local tile
// first, falls back to OSM online when tile is missing locally.

let protocolRegistered = false;
/** Track recent tile hits for UI status */
let localHits = 0;
let onlineHits = 0;
let lastStatusUpdate = 0;

const OSM_SUBDOMAINS = ['a', 'b', 'c'];

function updateServingStatus() {
  const now = Date.now();
  if (now - lastStatusUpdate < 500) return; // debounce
  lastStatusUpdate = now;

  if (localHits > 0 && onlineHits === 0) {
    useMapSourceStore.setState({ servingFrom: 'local' });
  } else if (localHits > 0 && onlineHits > 0) {
    // Mixed: primarily local with some online fallback
    useMapSourceStore.setState({ servingFrom: 'local' });
  } else if (onlineHits > 0) {
    useMapSourceStore.setState({ servingFrom: 'online' });
  }
}

function registerSmartTileProtocol() {
  if (protocolRegistered) return;
  protocolRegistered = true;

  maplibregl.addProtocol('smart-tile', async (params: { url: string }, _abortController: AbortController) => {
    // URL format: smart-tile://{z}/{x}/{y}
    const path = params.url.replace('smart-tile://', '');
    const { isOnline, sources } = useMapSourceStore.getState();
    const hasLocal = sources.has('local') && sources.get('local')!.isAvailable;

    // Strategy 1: Local tiles available → try local first
    if (hasLocal) {
      try {
        const localResp = await fetch(`/maps/${path}.png`);
        if (localResp.ok) {
          localHits++;
          updateServingStatus();
          const data = await localResp.arrayBuffer();
          return { data };
        }
      } catch {
        // local fetch failed, try online fallback
      }
    }

    // Strategy 2: Online fallback (only if network available)
    if (isOnline) {
      try {
        const sub = OSM_SUBDOMAINS[Math.floor(Math.random() * 3)];
        const onlineResp = await fetch(
          `https://${sub}.tile.openstreetmap.org/${path}.png`
        );
        if (onlineResp.ok) {
          onlineHits++;
          updateServingStatus();
          const data = await onlineResp.arrayBuffer();
          return { data };
        }
      } catch {
        // online fetch also failed
      }
    }

    // Both failed — return a 1x1 transparent PNG so MapLibre doesn't throw
    const EMPTY_PNG = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00,
      0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01,
      0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f,
      0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
      0x54, 0x78, 0x9c, 0x62, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01,
      0xe5, 0x27, 0xde, 0xfc, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45,
      0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ]).buffer;
    return { data: EMPTY_PNG };
  });
}

/**
 * Initialize map sources — detects local tiles, IndexedDB cache, and online
 */
export async function initializeMapSources(): Promise<void> {
  attachNetworkListeners();
  registerSmartTileProtocol();

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
      }
    } catch {
      // probe failed, skip local
    }

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
    let activeId: string;
    if (sources.has('local')) {
      activeId = 'local';
    } else if (sources.has('cached')) {
      activeId = 'cached';
    } else {
      activeId = 'online';
    }

    // Reset tile hit counters
    localHits = 0;
    onlineHits = 0;

    useMapSourceStore.setState({
      sources,
      activeSourceId: activeId,
      servingFrom: activeId === 'online' ? 'online' : activeId as any,
      initialized: true,
      isLoading: false,
      error: null,
    });
  } catch (err) {
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
  const hasLocal = sources.has('local') && sources.get('local')!.isAvailable;
  const hasCached = sources.has('cached') && sources.get('cached')!.isAvailable;
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
    localHits = 0;
    onlineHits = 0;

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
  } catch (err) {
    useMapSourceStore.setState({ isLoading: false });
  }
}

/**
 * Get the tile URL(s) for the currently active source.
 *
 * When local tiles are detected, uses the `smart-tile://` custom protocol
 * which tries local first then falls back to online per-tile.
 *
 * When no local tiles: 'cached' and 'online' use standard OSM URLs.
 */
export function getActiveTileUrls(): string[] {
  const { activeSourceId, sources } = useMapSourceStore.getState();
  const hasLocal = sources.has('local') && sources.get('local')!.isAvailable;

  // Smart protocol: local-first with online fallback per tile
  if (hasLocal || activeSourceId === 'local') {
    return ['smart-tile://{z}/{x}/{y}'];
  }

  // Pure online (cached relies on service worker intercepting OSM URLs)
  return [
    'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
    'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
    'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png',
  ];
}

// ── Private style builders ───────────────────────────────────

function buildRoadStyle(): any {
  const tiles = getActiveTileUrls();
  const { activeSourceId, sources } = useMapSourceStore.getState();
  const hasLocal = sources.has('local') && sources.get('local')!.isAvailable;
  const usingSmart = hasLocal || activeSourceId === 'local';

  return {
    version: 8,
    name: usingSmart ? 'Smart Offline/Online Map' : 'OSM Map',
    sources: {
      'map-tiles': {
        type: 'raster',
        tiles,
        tileSize: 256,
        attribution: '© OpenStreetMap contributors',
        minzoom: 0,
        maxzoom: 19,
      },
    },
    layers: [
      { 
        id: 'background', 
        type: 'background', 
        paint: { 'background-color': '#020408' } 
      },
      { 
        id: 'tiles-layer', 
        type: 'raster', 
        source: 'map-tiles', 
        paint: { 
          'raster-opacity': 0.92,
          'raster-contrast': 0.55,
          'raster-brightness-min': 0,
          'raster-brightness-max': 0.9,
          'raster-saturation': -0.85,
          'raster-hue-rotate': 20
        } 
      },
    ],
  };
}

function buildSatelliteStyle(): any {
  return {
    version: 8,
    name: 'Uydu',
    sources: {
      'satellite-tiles': {
        type: 'raster',
        tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
        tileSize: 256,
        attribution: '© Esri',
        maxzoom: 19,
      },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#0d1628' } },
      { id: 'satellite-layer', type: 'raster', source: 'satellite-tiles', paint: { 'raster-opacity': 1 } },
    ],
  };
}

function buildHybridStyle(): any {
  return {
    version: 8,
    name: 'Hibrit',
    sources: {
      'satellite-tiles': {
        type: 'raster',
        tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
        tileSize: 256,
        attribution: '© Esri',
        maxzoom: 19,
      },
      'road-overlay': {
        type: 'raster',
        tiles: [
          'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
          'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
          'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png',
        ],
        tileSize: 256,
        attribution: '© OpenStreetMap contributors',
        maxzoom: 19,
      },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#0d1628' } },
      { id: 'satellite-layer', type: 'raster', source: 'satellite-tiles', paint: { 'raster-opacity': 1 } },
      { id: 'road-overlay-layer', type: 'raster', source: 'road-overlay', paint: { 'raster-opacity': 0.55 } },
    ],
  };
}

/**
 * Get map style based on active source and current map mode.
 * Road mode uses smart-tile protocol (offline-first).
 * Satellite/hybrid use Esri World Imagery; hybrid adds a road label overlay.
 */
export function getMapStyle(): any {
  const { mapMode } = useMapSourceStore.getState();
  if (mapMode === 'satellite') return buildSatelliteStyle();
  if (mapMode === 'hybrid') return buildHybridStyle();
  return buildRoadStyle();
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
 */
export function setMapMode(mode: MapMode): void {
  const { isOnline } = useMapSourceStore.getState();
  const effective: MapMode =
    (mode === 'satellite' || mode === 'hybrid') && !isOnline ? 'road' : mode;
  useMapSourceStore.setState({ mapMode: effective });
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
