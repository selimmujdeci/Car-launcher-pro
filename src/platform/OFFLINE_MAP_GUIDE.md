# Offline Map System Guide

## Overview

The offline map system provides true offline-first tile rendering using local storage. The system automatically caches tiles as they're downloaded and serves them from cache on subsequent requests or when the network is unavailable.

## Architecture

### Core Components

1. **offlineMapService.ts** - Manages offline storage, tile caching, and fetch interception
2. **tileLoader.ts** - Handles importing tile packages and pre-caching strategies
3. **mapService.ts** - Initializes MapLibre GL with offline support
4. **gpsService.ts** - Provides real-time GPS tracking
5. **MiniMapWidget.tsx** - Dashboard map component
6. **FullMapView.tsx** - Full-screen map interface

### Offline-First Strategy

The system uses a fetch interceptor that:
1. Checks local cache for tiles first
2. Falls back to network if cache miss
3. Automatically caches successful network responses
4. Serves cached tiles when network is unavailable

## Usage

### Basic Initialization

```typescript
import { initializeMap } from '@/platform/mapService';
import { startGPSTracking } from '@/platform/gpsService';
import { initializeOfflineMapStorage } from '@/platform/offlineMapService';

// Initialize offline storage (called automatically in mapService)
await initializeOfflineMapStorage();

// Start GPS tracking
await startGPSTracking();

// Initialize map (automatically sets up offline system)
const map = await initializeMap(containerElement, { offline: true });
```

### Pre-Caching Tiles for a Region

```typescript
import { getTileCoordinatesForBounds, cacheTile } from '@/platform/tileLoader';

// Get tile coordinates for an area
const bounds = {
  north: 41.0,    // São Paulo latitude
  south: 40.8,
  east: -46.2,    // São Paulo longitude
  west: -46.4,
};

const tiles = getTileCoordinatesForBounds(bounds.north, bounds.south, bounds.east, bounds.west, 13);

// Pre-cache tiles (in background)
for (const tile of tiles) {
  const tileUrl = `https://a.tile.openstreetmap.org/${tile.z}/${tile.x}/${tile.y}.png`;
  const response = await fetch(tileUrl);
  const blob = await response.blob();
  await cacheTile(tile.z, tile.x, tile.y, blob);
}
```

### Importing a Tile Package

```typescript
import { importTilePackage } from '@/platform/tileLoader';

// Import tiles from a pre-downloaded package
const result = await importTilePackage('offline_maps/region_tiles', {
  name: 'São Paulo Region',
  minZoom: 8,
  maxZoom: 16,
  onProgress: (current, total) => {
    console.log(`Caching: ${current}/${total}`);
  },
});

console.log(`Cached ${result.tilesCached} tiles, ${result.errors} errors`);
```

### Checking Cache Status

```typescript
import { getTileCacheStats, useOfflineMapState } from '@/platform/offlineMapService';

// Get cache statistics
const stats = await getTileCacheStats();
console.log(`Cache size: ${stats.cacheSize}, Tiles: ${stats.totalTiles}`);

// Get offline map state
const { isAvailable, mapDataPath, error } = useOfflineMapState();
```

### Clearing Cache

```typescript
import { clearTileCache } from '@/platform/tileLoader';

// Clear all cached tiles
await clearTileCache();
```

## Local Tile Package Structure

If importing tiles from a package, organize them in this structure:

```
offline_maps/
  tiles/
    13/
      4125/
        2737.png
        2738.png
      4126/
        2737.png
        ...
    14/
      8250/
        5474.png
        ...
```

Where:
- `13` = zoom level
- `4125` = tile X coordinate
- `2737` = tile Y coordinate

## Performance Considerations

1. **Tile Cache**: Stored in device's Documents directory
2. **Max Age**: 3000ms for GPS updates (configurable)
3. **Rendering**: Event-driven, no render loop
4. **Memory**: Zustand state management for minimal overhead

## Offline Behavior

### When Network is Available
- Map tiles load from network
- Tiles are automatically cached for offline use
- Cache provides faster subsequent loads

### When Network is Unavailable
- Map renders from local cache
- Location tracking continues normally
- Full functionality maintained (no degradation)

## File Locations

- **Tile Cache**: `Documents/offline_maps/tile_cache/{z}/{x}/{y}.png`
- **Map Data**: `Documents/offline_maps/`
- **Configuration**: Auto-created on first use

## Limitations & Future Work

Current implementation:
- ✅ Offline tile caching and retrieval
- ✅ Automatic fetch interception
- ✅ GPS location tracking
- ✅ Real-time map updates
- ⏳ MBTiles format support (planned)
- ⏳ Cloud sync for tile packages (planned)
- ⏳ Tile server protocol support (planned)

## Troubleshooting

### Tiles Not Caching
- Check filesystem permissions in AndroidManifest.xml
- Verify Documents directory is accessible
- Check for storage space

### Map Not Loading Offline
- Ensure tiles are cached (check tile_cache directory)
- Verify tile coordinates match expected format
- Check map bounds are correct

### Performance Issues
- Clear old cache with `clearTileCache()`
- Reduce pre-cached zoom levels
- Monitor GPS update frequency

## API Reference

### offlineMapService

- `initializeOfflineMapStorage()` - Setup offline storage
- `initializeTileInterceptor()` - Enable fetch interception
- `cacheTile(z, x, y, data)` - Cache a tile
- `getCachedTile(z, x, y)` - Retrieve cached tile
- `listOfflineMaps()` - List available maps
- `isOfflineMapAvailable()` - Check availability
- `useOfflineMapState()` - Get state hook

### tileLoader

- `importTilePackage(path, options)` - Import tile package
- `getTileCoordinatesForBounds(n, s, e, w, z)` - Get tiles for area
- `preCacheTilesForArea(bounds, zoomLevels, fetchFn)` - Pre-cache region
- `getTileCacheStats()` - Get cache info
- `clearTileCache()` - Clear all cached tiles
