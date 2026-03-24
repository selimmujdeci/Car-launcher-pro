import { create } from 'zustand';
import { getTileCacheStats } from './serviceWorkerManager';

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
  isLoading: boolean;
  error: string | null;
  initialized: boolean;
}

const useMapSourceStore = create<MapSourceState>(() => ({
  sources: new Map(),
  activeSourceId: null,
  isLoading: false,
  error: null,
  initialized: false,
}));

/**
 * Initialize map sources
 */
export async function initializeMapSources(): Promise<void> {
  try {
    useMapSourceStore.setState({ isLoading: true });

    const sources = new Map<string, MapSource>();

    // Default online source (OSM with service worker cache)
    sources.set('online', {
      id: 'online',
      name: 'OpenStreetMap',
      type: 'online',
      description: 'Online maps with automatic offline caching',
      isAvailable: true,
    });

    // Check cache status
    try {
      const stats = await getTileCacheStats();
      if (stats.totalTiles > 0) {
        sources.set('cached', {
          id: 'cached',
          name: 'Offline Cache',
          type: 'offline',
          description: 'Previously cached map tiles',
          isAvailable: true,
          cacheSize: stats.cacheSize,
          tileCount: stats.totalTiles,
          lastUpdated: Date.now(),
        });
      }
    } catch (err) {
      console.warn('Failed to check cache status:', err);
    }

    useMapSourceStore.setState({
      sources,
      initialized: true,
      isLoading: false,
      error: null,
    });

    // Set default source
    const hasCache = sources.has('cached');
    setActiveMapSource(hasCache ? 'cached' : 'online');
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to initialize sources';
    useMapSourceStore.setState({
      isLoading: false,
      error: msg,
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
 * Check if offline maps available
 */
export function hasOfflineMapData(): boolean {
  const { sources } = useMapSourceStore.getState();
  return sources.has('cached') && sources.get('cached')!.isAvailable;
}

/**
 * Get map source status for UI
 */
export function getMapSourceStatus(): {
  status: 'offline' | 'online' | 'no-data';
  message: string;
  source: MapSource | null;
} {
  const active = getActiveMapSource();

  if (!active) {
    return {
      status: 'no-data',
      message: 'No map source available',
      source: null,
    };
  }

  if (active.type === 'offline') {
    return {
      status: 'offline',
      message: `Offline: ${active.name} (${active.cacheSize || 'unknown size'})`,
      source: active,
    };
  }

  // Check if network available
  if (navigator.onLine) {
    return {
      status: 'online',
      message: `Online: ${active.name}`,
      source: active,
    };
  }

  return {
    status: 'offline',
    message: `Offline (network unavailable)`,
    source: active,
  };
}

/**
 * Refresh source availability (check cache again)
 */
export async function refreshMapSources(): Promise<void> {
  try {
    useMapSourceStore.setState({ isLoading: true });

    const stats = await getTileCacheStats();
    const { sources } = useMapSourceStore.getState();

    if (stats.totalTiles > 0) {
      sources.set('cached', {
        id: 'cached',
        name: 'Offline Cache',
        type: 'offline',
        description: 'Previously cached map tiles',
        isAvailable: true,
        cacheSize: stats.cacheSize,
        tileCount: stats.totalTiles,
        lastUpdated: Date.now(),
      });
    } else {
      sources.delete('cached');
    }

    useMapSourceStore.setState({
      sources,
      isLoading: false,
      error: null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to refresh sources';
    useMapSourceStore.setState({ isLoading: false, error: msg });
  }
}

/**
 * Get map style based on active source
 */
export function getMapStyle(): any {
  return {
    version: 8,
    name: 'Offline-First Map',
    metadata: { 'mapbox:autocomposite': false },
    sources: {
      tiles: {
        type: 'raster',
        tiles: ['https://a.tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        attribution: '© OpenStreetMap | Cached Offline',
        minzoom: 0,
        maxzoom: 18,
      },
    },
    layers: [
      {
        id: 'map-tiles',
        type: 'raster',
        source: 'tiles',
        paint: { 'raster-opacity': 1 },
      },
    ],
  };
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
