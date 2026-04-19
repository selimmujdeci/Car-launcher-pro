import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { logError } from './crashLogger';

export interface TileSource {
  name: string;
  minZoom: number;
  maxZoom: number;
  bounds?: {
    north: number;
    south: number;
    east: number;
    west: number;
  };
}

const OFFLINE_TILES_DIR = 'offline_tiles';
let tileServerReady = false;
let activeTileSource: TileSource | null = null;

/**
 * Initialize offline tile server
 * Sets up directories and loads available tile sources
 */
export async function initializeOfflineTileServer(): Promise<void> {
  try {
    // Create offline tiles directory (already-exists error is expected, ignore it)
    await Filesystem.mkdir({
      path: OFFLINE_TILES_DIR,
      directory: Directory.Documents,
      recursive: true,
    }).catch((e: unknown) => {
      // "Directory exists" hataları normaldir; diğerlerini logla
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.toLowerCase().includes('exist')) logError('offlineTileServer:mkdir', e);
    });

    // Register custom protocol handler
    registerTileProtocolHandler();

    tileServerReady = true;
  } catch (err) {
    logError('offlineTileServer:initialize', err);
  }
}

/**
 * Register custom tile:// protocol handler
 * Intercepts MapLibre GL tile requests and serves from local storage
 */
function registerTileProtocolHandler(): void {
  // Monkey-patch fetch for tile:// protocol
  const originalFetch = globalThis.fetch;

  // globalThis.fetch monkey-patch — TypeScript fetch override
  (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = async function (
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> {
    const url = input instanceof URL ? input.toString() : input.toString();

    // Handle custom tile protocol
    if (url.startsWith('tile://')) {
      return serveTileFromLocal(url);
    }

    // Handle OpenStreetMap tiles with offline fallback
    const osmMatch = url.match(/\/tiles\/(\d+)\/(\d+)\/(\d+)\.png$/);
    if (osmMatch) {
      const [, z, x, y] = osmMatch;
      const localTile = await getTileFromLocal(parseInt(z), parseInt(x), parseInt(y));
      if (localTile) {
        return new Response(localTile, {
          status: 200,
          headers: { 'Content-Type': 'image/png' },
        });
      }
    }

    // Fall through to original fetch
    return originalFetch.call(this, input, init);
  };
}

/**
 * Serve a tile from local storage
 * Protocol: tile://z/x/y
 */
async function serveTileFromLocal(url: string): Promise<Response> {
  try {
    const match = url.match(/tile:\/\/(\d+)\/(\d+)\/(\d+)/);
    if (!match) {
      return new Response('Invalid tile URL', { status: 400 });
    }

    const [, z, x, y] = match;
    const tile = await getTileFromLocal(parseInt(z), parseInt(x), parseInt(y));

    if (tile) {
      return new Response(tile, {
        status: 200,
        headers: {
          'Content-Type': 'image/png',
          'Cache-Control': 'public, max-age=31536000',
        },
      });
    }

    return new Response('Tile not found', { status: 404 });
  } catch (err) {
    console.error('Tile serve error:', err);
    return new Response('Server error', { status: 500 });
  }
}

/**
 * Get tile from local storage
 * Checks multiple locations: custom source, cache, bundled
 */
export async function getTileFromLocal(
  z: number,
  x: number,
  y: number
): Promise<ArrayBuffer | null> {
  // Try active tile source first
  if (activeTileSource) {
    const tile = await readTileFile(
      `${OFFLINE_TILES_DIR}/${activeTileSource.name}/${z}/${x}/${y}.png`
    );
    if (tile) return tile;
  }

  // Try default offline tiles
  const tile = await readTileFile(`${OFFLINE_TILES_DIR}/default/${z}/${x}/${y}.png`);
  if (tile) return tile;

  // Try cache directory
  const cached = await readTileFile(`offline_maps/tile_cache/${z}/${x}/${y}.png`);
  if (cached) return cached;

  return null;
}

/**
 * Read tile file from filesystem
 */
async function readTileFile(path: string): Promise<ArrayBuffer | null> {
  try {
    const file = await Filesystem.readFile({
      path,
      directory: Directory.Documents,
      encoding: Encoding.UTF8,
    });

    if (!file.data) return null;

    const binaryString = atob(file.data as string);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    return bytes.buffer;
  } catch {
    return null;
  }
}

/**
 * Save a tile to local storage
 */
export async function saveTile(
  z: number,
  x: number,
  y: number,
  data: ArrayBuffer | Blob,
  source?: string
): Promise<void> {
  const sourceName = source || 'default';
  try {
    const path = `${OFFLINE_TILES_DIR}/${sourceName}/${z}/${x}/${y}.png`;
    const dir = `${OFFLINE_TILES_DIR}/${sourceName}/${z}/${x}`;

    // Create directory structure
    await Filesystem.mkdir({
      path: dir,
      directory: Directory.Documents,
      recursive: true,
    }).catch(() => {});

    // Convert to base64
    let base64: string;
    if (data instanceof Blob) {
      base64 = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => {
          resolve((reader.result as string).split(',')[1]);
        };
        reader.readAsDataURL(data);
      });
    } else {
      const view = new Uint8Array(data);
      let binary = '';
      for (let i = 0; i < view.length; i++) {
        binary += String.fromCharCode(view[i]);
      }
      base64 = btoa(binary);
    }

    await Filesystem.writeFile({
      path,
      data: base64,
      directory: Directory.Documents,
      encoding: Encoding.UTF8,
    });
  } catch (err) {
    console.warn('Failed to save tile:', err);
  }
}

/**
 * Create offline map source for MapLibre GL
 * Uses local tile protocol
 */
export function createOfflineMapSource(sourceName?: string): any {
  const source = sourceName || 'default';
  return {
    type: 'raster',
    tiles: [`tile://${source}/{z}/{x}/{y}`],
    tileSize: 256,
    attribution: 'Offline Map Data',
    minzoom: 0,
    maxzoom: 18,
  };
}

/**
 * Get available offline tile sources
 */
export async function listOfflineTileSources(): Promise<TileSource[]> {
  try {
    const result = await Filesystem.readdir({
      path: OFFLINE_TILES_DIR,
      directory: Directory.Documents,
    });

    const sources: TileSource[] = [];

    for (const dir of result.files) {
      if (dir.type === 'directory') {
        sources.push({
          name: dir.name,
          minZoom: 0,
          maxZoom: 18,
        });
      }
    }

    return sources;
  } catch (err) {
    console.warn('Failed to list tile sources:', err);
    return [];
  }
}

/**
 * Set active offline tile source
 */
export function setActiveTileSource(source: TileSource | null): void {
  activeTileSource = source;
}

/**
 * Get active offline tile source
 */
export function getActiveTileSource(): TileSource | null {
  return activeTileSource;
}

/**
 * Check if offline tile data is available
 */
export async function hasOfflineTiles(): Promise<boolean> {
  try {
    const sources = await listOfflineTileSources();
    return sources.length > 0;
  } catch {
    return false;
  }
}

/**
 * Import tiles from a package (z/x/y.png structure)
 */
export async function importTilePackage(
  sourceDir: string,
  sourceName: string,
  onProgress?: (processed: number, total: number) => void
): Promise<{ imported: number; failed: number }> {
  let imported = 0;
  let failed = 0;

  try {
    const zoomDirs = await Filesystem.readdir({
      path: sourceDir,
      directory: Directory.Documents,
    });

    let totalFiles = 0;
    let processedFiles = 0;

    // Count total files
    for (const zDir of zoomDirs.files) {
      if (zDir.type === 'directory') {
        const xDirs = await Filesystem.readdir({
          path: `${sourceDir}/${zDir.name}`,
          directory: Directory.Documents,
        });

        for (const xDir of xDirs.files) {
          if (xDir.type === 'directory') {
            const yFiles = await Filesystem.readdir({
              path: `${sourceDir}/${zDir.name}/${xDir.name}`,
              directory: Directory.Documents,
            });
            totalFiles += yFiles.files.filter((f) => f.name.endsWith('.png')).length;
          }
        }
      }
    }

    // Import tiles
    for (const zDir of zoomDirs.files) {
      if (zDir.type === 'directory') {
        const z = parseInt(zDir.name);
        if (isNaN(z)) continue;

        const xDirs = await Filesystem.readdir({
          path: `${sourceDir}/${zDir.name}`,
          directory: Directory.Documents,
        });

        for (const xDir of xDirs.files) {
          if (xDir.type === 'directory') {
            const x = parseInt(xDir.name);
            if (isNaN(x)) continue;

            const yFiles = await Filesystem.readdir({
              path: `${sourceDir}/${zDir.name}/${xDir.name}`,
              directory: Directory.Documents,
            });

            for (const yFile of yFiles.files) {
              if (yFile.name.endsWith('.png')) {
                try {
                  const y = parseInt(yFile.name.replace('.png', ''));
                  if (isNaN(y)) continue;

                  const sourceFile = await Filesystem.readFile({
                    path: `${sourceDir}/${zDir.name}/${xDir.name}/${yFile.name}`,
                    directory: Directory.Documents,
                    encoding: Encoding.UTF8,
                  });

                  if (sourceFile.data) {
                    // Convert base64 string to ArrayBuffer
                    const binaryString = atob(sourceFile.data as string);
                    const bytes = new Uint8Array(binaryString.length);
                    for (let i = 0; i < binaryString.length; i++) {
                      bytes[i] = binaryString.charCodeAt(i);
                    }
                    await saveTile(z, x, y, bytes.buffer, sourceName);
                    imported++;
                  }
                } catch (err) {
                  failed++;
                }
              }

              processedFiles++;
              if (onProgress) {
                onProgress(processedFiles, totalFiles);
              }
            }
          }
        }
      }
    }

    return { imported, failed };
  } catch (err) {
    console.error('Tile package import failed:', err);
    throw err;
  }
}

/**
 * Check if offline tile server is ready
 */
export function isOfflineTileServerReady(): boolean {
  return tileServerReady;
}
