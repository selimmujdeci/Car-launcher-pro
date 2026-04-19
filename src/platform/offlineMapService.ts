import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import type { FileInfo } from '@capacitor/filesystem';
import { create } from 'zustand';

export interface OfflineMapTile {
  z: number;
  x: number;
  y: number;
  data?: ArrayBuffer | Blob;
}

interface OfflineMapState {
  isAvailable: boolean;
  mapDataPath: string | null;
  loadedMaps: Map<string, boolean>;
  error: string | null;
}

const useOfflineMapStore = create<OfflineMapState>(() => ({
  isAvailable: false,
  mapDataPath: null,
  loadedMaps: new Map(),
  error: null,
}));

const OFFLINE_MAP_DIR = 'offline_maps';
const TILE_CACHE_DIR = 'tile_cache';

/**
 * Initialize offline map storage directory
 */
export async function initializeOfflineMapStorage(): Promise<void> {
  try {
    // Check if documents directory exists
    const docsDir = await Filesystem.stat({
      path: OFFLINE_MAP_DIR,
      directory: Directory.Documents,
    }).catch(() => null);

    if (!docsDir) {
      await Filesystem.mkdir({
        path: OFFLINE_MAP_DIR,
        directory: Directory.Documents,
        recursive: true,
      });
    }

    // Create tile cache directory
    await Filesystem.mkdir({
      path: `${OFFLINE_MAP_DIR}/${TILE_CACHE_DIR}`,
      directory: Directory.Documents,
      recursive: true,
    }).catch(() => {}); // May already exist

    useOfflineMapStore.setState({
      isAvailable: true,
      mapDataPath: `${OFFLINE_MAP_DIR}`,
      error: null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to initialize offline storage';
    useOfflineMapStore.setState({ error: msg, isAvailable: false });
    console.warn('Offline map storage init failed:', err);
  }
}

/**
 * Cache a tile locally
 */
export async function cacheTile(
  z: number,
  x: number,
  y: number,
  data: ArrayBuffer | Blob
): Promise<void> {
  try {
    const path = `${OFFLINE_MAP_DIR}/${TILE_CACHE_DIR}/${z}/${x}/${y}.png`;

    // Ensure directory structure exists
    const dirPath = `${OFFLINE_MAP_DIR}/${TILE_CACHE_DIR}/${z}/${x}`;
    await Filesystem.mkdir({
      path: dirPath,
      directory: Directory.Documents,
      recursive: true,
    }).catch(() => {}); // May already exist

    // Write tile data
    const blob = data instanceof Blob ? data : new Blob([data]);
    const reader = new FileReader();

    reader.onload = async () => {
      const base64 = (reader.result as string).split(',')[1];
      try {
        await Filesystem.writeFile({
          path,
          data: base64,
          directory: Directory.Documents,
          encoding: Encoding.UTF8,
        });
      } catch (err) {
        console.warn('Failed to cache tile:', path, err);
      }
    };

    reader.readAsDataURL(blob);
  } catch (err) {
    console.warn('Tile caching error:', err);
  }
}

/**
 * Retrieve a cached tile from local storage
 */
export async function getCachedTile(
  z: number,
  x: number,
  y: number
): Promise<ArrayBuffer | null> {
  try {
    const path = `${OFFLINE_MAP_DIR}/${TILE_CACHE_DIR}/${z}/${x}/${y}.png`;

    const file = await Filesystem.readFile({
      path,
      directory: Directory.Documents,
      encoding: Encoding.UTF8,
    }).catch(() => null);

    if (!file) return null;

    // Convert base64 to ArrayBuffer
    const binaryString = atob(file.data as string);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  } catch (err) {
    console.warn('Tile retrieval error:', err);
    return null;
  }
}

/**
 * Create a custom tile URL handler for offline tiles
 * Maps tile requests to local storage or network fallback
 */
export function createOfflineTileUrl(z: number, x: number, y: number): string {
  // Use a data URI or blob URL for local tiles
  // In production, this would resolve from local storage
  return `tile://${z}/${x}/${y}`;
}

/**
 * Get offline map source configuration
 * Returns a raster source that uses local tiles
 */
export function getOfflineMapSource() {
  const offlineUrl = `tile-protocol://{z}/{x}/{y}`;

  return {
    type: 'raster' as const,
    tiles: [offlineUrl],
    tileSize: 256,
    attribution: 'Offline Map Data',
    scheme: 'tms' as const,
  };
}

/**
 * List all available offline maps
 */
export async function listOfflineMaps(): Promise<string[]> {
  try {
    const result = await Filesystem.readdir({
      path: `${OFFLINE_MAP_DIR}`,
      directory: Directory.Documents,
    });

    return result.files
      .filter((f: FileInfo) => f.type === 'directory' && f.name !== TILE_CACHE_DIR)
      .map((f: FileInfo) => f.name);
  } catch (err) {
    console.warn('Failed to list offline maps:', err);
    return [];
  }
}

/**
 * Initialize tile interceptor for offline-first strategy
 * This hooks into fetch to serve cached tiles before network requests
 */
export function initializeTileInterceptor(): void {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async function (
    input: RequestInfo | URL,
    init?: RequestInit
  ) {
    const url = input instanceof URL ? input.toString() : input.toString();

    // Check if this is a tile request (OpenStreetMap format)
    const tileMatch = url.match(/\/(\d+)\/(\d+)\/(\d+)\.png$/);
    if (tileMatch) {
      const [, z, x, y] = tileMatch;
      const cachedTile = await getCachedTile(parseInt(z), parseInt(x), parseInt(y));

      if (cachedTile) {
        // Return cached tile
        return new Response(cachedTile, {
          status: 200,
          headers: { 'Content-Type': 'image/png' },
        });
      }
    }

    // Fall back to original fetch
    try {
      const response = await originalFetch(input, init);

      // Cache successful tile responses
      if (response.ok && tileMatch) {
        const [, z, x, y] = tileMatch;
        const blob = await response.clone().blob();
        cacheTile(parseInt(z), parseInt(x), parseInt(y), blob).catch(() => {});
      }

      return response;
    } catch (err) {
      // Network error - try to serve cached tile
      if (tileMatch) {
        const [, z, x, y] = tileMatch;
        const cachedTile = await getCachedTile(parseInt(z), parseInt(x), parseInt(y));
        if (cachedTile) {
          return new Response(cachedTile, {
            status: 200,
            headers: { 'Content-Type': 'image/png' },
          });
        }
      }

      throw err;
    }
  } as typeof globalThis.fetch;
}

export function useOfflineMapState() {
  return useOfflineMapStore();
}

export function getOfflineMapDataPath(): string | null {
  return useOfflineMapStore.getState().mapDataPath;
}

export function isOfflineMapAvailable(): boolean {
  return useOfflineMapStore.getState().isAvailable;
}
