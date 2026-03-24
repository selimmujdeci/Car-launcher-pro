import { Filesystem, Directory } from '@capacitor/filesystem';
import { saveTile } from './offlineTileServer';

/**
 * Bootstrap offline tile cache with sample tiles
 * This creates a minimal set of tiles for the app to work offline
 * Typically called once during app initialization
 */
export async function bootstrapOfflineTiles(): Promise<void> {
  try {
    // Check if bootstrap already done
    const bootstrapMarker = await Filesystem.stat({
      path: 'offline_tiles/default/.bootstrap',
      directory: Directory.Documents,
    }).catch(() => null);

    if (bootstrapMarker) {
      return; // Already bootstrapped
    }

    // Pre-populate with sample tiles from a CDN or local source
    // These are low-zoom tiles for world view
    const sampleTiles = getSampleTiles();

    for (const tile of sampleTiles) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        try {
          const response = await fetch(tile.url, { signal: controller.signal });
          if (response.ok) {
            const blob = await response.blob();
            await saveTile(tile.z, tile.x, tile.y, blob, 'default');
          }
        } finally {
          clearTimeout(timeout);
        }
      } catch (err) {
        console.warn(`Failed to cache tile ${tile.z}/${tile.x}/${tile.y}:`, err);
      }
    }

    // Mark bootstrap as complete
    await Filesystem.writeFile({
      path: 'offline_tiles/default/.bootstrap',
      data: new Date().toISOString(),
      directory: Directory.Documents,
    }).catch(() => {});
  } catch (err) {
    console.warn('Offline tiles bootstrap failed:', err);
  }
}

/**
 * Get list of sample tiles to bootstrap
 * Includes low-zoom tiles covering common regions
 */
function getSampleTiles(): Array<{
  z: number;
  x: number;
  y: number;
  url: string;
}> {
  // OpenStreetMap tile URLs for zoom 0-4 (world overview)
  // These cover the entire world at lower zoom levels
  const tiles = [];

  // Zoom 0 (world in 1 tile)
  tiles.push({
    z: 0,
    x: 0,
    y: 0,
    url: 'https://a.tile.openstreetmap.org/0/0/0.png',
  });

  // Zoom 1 (4 tiles)
  for (let x = 0; x < 2; x++) {
    for (let y = 0; y < 2; y++) {
      tiles.push({
        z: 1,
        x,
        y,
        url: `https://a.tile.openstreetmap.org/1/${x}/${y}.png`,
      });
    }
  }

  // Zoom 2 (16 tiles)
  for (let x = 0; x < 4; x++) {
    for (let y = 0; y < 4; y++) {
      tiles.push({
        z: 2,
        x,
        y,
        url: `https://a.tile.openstreetmap.org/2/${x}/${y}.png`,
      });
    }
  }

  return tiles;
}

/**
 * Pre-cache tiles for a specific region
 * Used to download tiles for offline use before going offline
 */
export async function preCacheRegion(
  north: number,
  south: number,
  east: number,
  west: number,
  zoom: number,
  onProgress?: (cached: number, total: number) => void
): Promise<{ cached: number; failed: number }> {
  const tileCoords = getTileCoordinatesForBounds(north, south, east, west, zoom);
  let cached = 0;
  let failed = 0;

  for (let i = 0; i < tileCoords.length; i++) {
    const tile = tileCoords[i];
    try {
      const url = `https://a.tile.openstreetmap.org/${tile.z}/${tile.x}/${tile.y}.png`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      try {
        const response = await fetch(url, { signal: controller.signal });

        if (response.ok) {
          const blob = await response.blob();
          await saveTile(tile.z, tile.x, tile.y, blob, 'default');
          cached++;
        } else {
          failed++;
        }
      } finally {
        clearTimeout(timeout);
      }
    } catch (err) {
      failed++;
    }

    if (onProgress) {
      onProgress(cached + failed, tileCoords.length);
    }

    // Add small delay to avoid overwhelming the tile server
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return { cached, failed };
}

/**
 * Get tile coordinates for a bounding box at a specific zoom
 */
function getTileCoordinatesForBounds(
  north: number,
  south: number,
  east: number,
  west: number,
  zoom: number
): Array<{ z: number; x: number; y: number }> {
  const tiles: Array<{ z: number; x: number; y: number }> = [];
  const n = Math.pow(2, zoom);

  const getTileX = (lon: number) => Math.floor(((lon + 180) / 360) * n);
  const getTileY = (lat: number) => {
    const y = Math.floor(
      ((1 -
        Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) /
        2) *
        n
    );
    return y;
  };

  const minX = getTileX(west);
  const maxX = getTileX(east);
  const minY = getTileY(north);
  const maxY = getTileY(south);

  for (let x = minX; x <= maxX && x < n; x++) {
    for (let y = minY; y <= maxY && y < n; y++) {
      tiles.push({ z: zoom, x: x >= 0 ? x : x + n, y });
    }
  }

  return tiles;
}
