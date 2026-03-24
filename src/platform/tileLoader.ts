import { Filesystem, Directory } from '@capacitor/filesystem';
import { cacheTile } from './offlineMapService';

export interface TileLoaderOptions {
  name: string;
  minZoom?: number;
  maxZoom?: number;
  bounds?: {
    north: number;
    south: number;
    east: number;
    west: number;
  };
  onProgress?: (current: number, total: number) => void;
}

/**
 * Import tiles from a tile package/archive
 * Supports flat directory structure: z/x/y.png
 */
export async function importTilePackage(
  packagePath: string,
  options: TileLoaderOptions
): Promise<{ tilesCached: number; errors: number }> {
  const { onProgress } = options;

  try {
    const files = await Filesystem.readdir({
      path: packagePath,
      directory: Directory.Documents,
    });

    let tilesCached = 0;
    let errors = 0;
    let processed = 0;
    const totalFiles = files.files.length;

    for (const file of files.files) {
      if (file.type === 'directory') {
        const zLevel = parseInt(file.name);
        if (isNaN(zLevel)) continue;

        // Read zoom level directory
        const xFiles = await Filesystem.readdir({
          path: `${packagePath}/${file.name}`,
          directory: Directory.Documents,
        });

        for (const xFile of xFiles.files) {
          if (xFile.type === 'directory') {
            const x = parseInt(xFile.name);
            if (isNaN(x)) continue;

            // Read x directory
            const yFiles = await Filesystem.readdir({
              path: `${packagePath}/${file.name}/${xFile.name}`,
              directory: Directory.Documents,
            });

            for (const yFile of yFiles.files) {
              if (yFile.name.endsWith('.png')) {
                try {
                  const y = parseInt(yFile.name.replace('.png', ''));
                  if (isNaN(y)) continue;

                  // Read tile file
                  const tilePath = `${packagePath}/${file.name}/${xFile.name}/${yFile.name}`;
                  const tileData = await Filesystem.readFile({
                    path: tilePath,
                    directory: Directory.Documents,
                  });

                  // Cache the tile
                  if (tileData.data) {
                    const binaryString = atob(tileData.data as string);
                    const bytes = new Uint8Array(binaryString.length);
                    for (let i = 0; i < binaryString.length; i++) {
                      bytes[i] = binaryString.charCodeAt(i);
                    }
                    await cacheTile(zLevel, x, y, bytes.buffer);
                    tilesCached++;
                  }
                } catch (err) {
                  errors++;
                }
              }

              processed++;
              if (onProgress) {
                onProgress(processed, totalFiles);
              }
            }
          }
        }
      }
    }

    return { tilesCached, errors };
  } catch (err) {
    console.error('Tile package import failed:', err);
    throw err;
  }
}

/**
 * Generate tile coordinates for a bounding box at a specific zoom level
 * Used to pre-cache tiles for an area
 */
export function getTileCoordinatesForBounds(
  north: number,
  south: number,
  east: number,
  west: number,
  zoom: number
): Array<{ z: number; x: number; y: number }> {
  const tiles: Array<{ z: number; x: number; y: number }> = [];

  const n = Math.pow(2, zoom);

  // Convert lat/lon to tile coordinates
  const getTileX = (lon: number) => Math.floor(((lon + 180) / 360) * n);
  const getTileY = (lat: number) => {
    const y = Math.floor(((1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2) * n);
    return y;
  };

  const minX = getTileX(west);
  const maxX = getTileX(east);
  const minY = getTileY(north);
  const maxY = getTileY(south);

  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      tiles.push({ z: zoom, x: x % n, y });
    }
  }

  return tiles;
}

/**
 * Pre-cache tiles for a specific area
 * Useful for offline maps of known routes
 */
export async function preCacheTilesForArea(
  bounds: { north: number; south: number; east: number; west: number },
  zoomLevels: number[] = [8, 9, 10, 11, 12, 13, 14],
  fetchTileUrl: (z: number, x: number, y: number) => Promise<ArrayBuffer | null>
): Promise<{ cached: number; failed: number }> {
  let cached = 0;
  let failed = 0;

  for (const zoom of zoomLevels) {
    const tiles = getTileCoordinatesForBounds(bounds.north, bounds.south, bounds.east, bounds.west, zoom);

    for (const tile of tiles) {
      try {
        const tileData = await fetchTileUrl(tile.z, tile.x, tile.y);
        if (tileData) {
          await cacheTile(tile.z, tile.x, tile.y, tileData);
          cached++;
        } else {
          failed++;
        }
      } catch (err) {
        failed++;
      }
    }
  }

  return { cached, failed };
}

/**
 * Get cache statistics
 */
export async function getTileCacheStats(): Promise<{
  totalTiles: number;
  cacheSize: string;
}> {
  try {
    let totalTiles = 0;
    let totalSize = 0;

    // This is a simplified implementation
    // In production, you'd walk the cache directory structure
    // and sum up file sizes

    return {
      totalTiles,
      cacheSize: `${(totalSize / 1024 / 1024).toFixed(2)}MB`,
    };
  } catch (err) {
    console.error('Failed to get cache stats:', err);
    return { totalTiles: 0, cacheSize: '0MB' };
  }
}

/**
 * Clear all cached tiles
 */
export async function clearTileCache(): Promise<void> {
  try {
    await Filesystem.rmdir({
      path: 'offline_maps/tile_cache',
      directory: Directory.Documents,
      recursive: true,
    });

    await Filesystem.mkdir({
      path: 'offline_maps/tile_cache',
      directory: Directory.Documents,
    });
  } catch (err) {
    console.error('Failed to clear tile cache:', err);
  }
}
