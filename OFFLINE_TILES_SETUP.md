# Offline Tiles Implementation Guide

## Overview

The offline tile system provides true offline-first map rendering using a custom tile protocol (`tile://`). Maps can be rendered without internet connection using locally cached tiles.

## Architecture

### Core Components

1. **offlineTileServer.ts** - Custom tile protocol handler and file serving
2. **bootstrapOfflineTiles.ts** - Initial offline tile population
3. **mapService.ts** - MapLibre GL with offline source integration
4. **offlineMapService.ts** - Tile caching (fallback strategy)
5. **MiniMapWidget.tsx** & **FullMapView.tsx** - Both use same offline source

## How It Works

### Tile Request Flow

```
MapLibre GL requests tile
    ↓
tile:// protocol handler intercepts
    ↓
Check local storage: offline_tiles/default/z/x/y.png
    ↓
If found → serve from local
If not found → 404 (or fallback to network if available)
```

### Storage Structure

```
Documents/
  offline_tiles/
    default/                    ← default offline source
      {z}/
        {x}/
          {y}.png              ← cached tiles
    [other-sources]/           ← alternative tile sources
      {z}/{x}/{y}.png
```

## Setup & Usage

### 1. Initialize System

The offline system initializes automatically when the map loads:

```typescript
import { initializeMap } from '@/platform/mapService';

// This automatically:
// - Creates offline_tiles directory
// - Registers tile:// protocol handler
// - Sets up fetch interceptor for caching
const map = await initializeMap(container, { offline: true });
```

### 2. Bootstrap Offline Tiles (First Run)

Pre-populate with low-zoom tiles for world view:

```typescript
import { bootstrapOfflineTiles } from '@/platform/bootstrapOfflineTiles';

// Call once during app startup
await bootstrapOfflineTiles();
```

This downloads tiles for zoom 0-2 (world overview) to enable offline map viewing immediately.

### 3. Pre-Cache a Region

Download tiles for specific area before going offline:

```typescript
import { preCacheRegion } from '@/platform/bootstrapOfflineTiles';

// Cache São Paulo area at zoom 12-14
const result = await preCacheRegion(
  23.5,    // north latitude
  -23.5,   // south latitude
  -46.2,   // east longitude
  -46.4,   // west longitude
  12,      // zoom level
  (cached, total) => {
    console.log(`Cached ${cached}/${total} tiles`);
  }
);

console.log(`Cached ${result.cached}, Failed ${result.failed}`);
```

### 4. Import Tile Package

Import pre-downloaded tiles from filesystem:

```typescript
import { importTilePackage } from '@/platform/offlineTileServer';

// Import from Documents/offline_import/tiles (z/x/y.png structure)
const result = await importTilePackage(
  'offline_import/tiles',
  'myregion',  // source name
  (processed, total) => {
    console.log(`Importing: ${processed}/${total}`);
  }
);

console.log(`Imported ${result.imported} tiles`);
```

## Offline-First Behavior

### When Network is Available
- Maps load with normal OpenStreetMap tiles
- Tiles are cached automatically for offline use
- Cache provides faster subsequent loads

### When Network is Unavailable
- Maps load from local cache only
- Full functionality maintained
- No degradation in user experience (if tiles are cached)

## File Locations

- **Offline Tiles**: `Documents/offline_tiles/{source}/{z}/{x}/{y}.png`
- **Tile Cache**: `Documents/offline_maps/tile_cache/{z}/{x}/{y}.png`
- **Bootstrap Marker**: `Documents/offline_tiles/default/.bootstrap`

## API Reference

### offlineTileServer.ts

```typescript
// Get tile from local storage
getTileFromLocal(z: number, x: number, y: number): Promise<ArrayBuffer | null>

// Save tile to local storage
saveTile(z: number, x: number, y: number, data: ArrayBuffer | Blob, source?: string): Promise<void>

// Create offline source for MapLibre GL
createOfflineMapSource(sourceName?: string): any

// List all offline tile sources
listOfflineTileSources(): Promise<TileSource[]>

// Set active tile source
setActiveTileSource(source: TileSource | null): void

// Check if offline tiles available
hasOfflineTiles(): Promise<boolean>

// Import tile package from filesystem
importTilePackage(sourceDir: string, sourceName: string, onProgress?: (processed, total) => void): Promise<{imported, failed}>
```

### bootstrapOfflineTiles.ts

```typescript
// Bootstrap with sample tiles
bootstrapOfflineTiles(): Promise<void>

// Pre-cache tiles for region
preCacheRegion(north: number, south: number, east: number, west: number, zoom: number, onProgress?: (cached, total) => void): Promise<{cached, failed}>
```

## Performance Considerations

1. **Tile Loading**: Event-driven, no render loop
2. **Memory**: Zustand state management for minimal overhead
3. **Storage**: Tiles stored in compressed PNG format
4. **Network**: Automatic fallback to cache on network failure

## Limitations & Future Work

Current:
- ✅ Offline tile rendering from local source
- ✅ Automatic tile caching
- ✅ Custom tile:// protocol
- ✅ Region pre-caching
- ✅ Multiple tile sources

Planned:
- ⏳ MBTiles format support
- ⏳ Tile compression
- ⏳ Incremental downloads
- ⏳ Cloud sync

## Troubleshooting

### No Map Display Offline

1. Check if tiles are cached:
   ```bash
   # Look in Documents/offline_tiles/default/
   # Should have z/x/y.png structure
   ```

2. Verify offline system initialized:
   ```typescript
   import { isOfflineTileServerReady } from '@/platform/offlineTileServer';
   console.log(isOfflineTileServerReady()); // Should be true
   ```

3. Bootstrap tiles:
   ```typescript
   import { bootstrapOfflineTiles } from '@/platform/bootstrapOfflineTiles';
   await bootstrapOfflineTiles();
   ```

### Slow Tile Loading

1. Check device storage space
2. Reduce number of pre-cached zoom levels
3. Increase tile request timeout

### Import Failures

1. Verify source directory exists: `Documents/offline_import/tiles/`
2. Check tile structure: `z/x/y.png`
3. Ensure PNG format is valid
4. Check device has write permissions

## Example: Complete Offline Setup

```typescript
import { initializeMap, startGPSTracking } from '@/platform/mapService';
import { bootstrapOfflineTiles, preCacheRegion } from '@/platform/bootstrapOfflineTiles';

// 1. Bootstrap system
await bootstrapOfflineTiles();

// 2. Pre-cache specific region (São Paulo)
await preCacheRegion(
  -23.5,   // north
  -23.6,   // south
  -46.3,   // east
  -46.4,   // west
  14       // zoom
);

// 3. Initialize map (works offline)
const map = await initializeMap(containerElement, { offline: true });

// 4. Start GPS
await startGPSTracking();

// Map is now fully functional offline with cached tiles
```

## Sharing Offline Maps

To share offline maps between devices:

1. Export tiles from source device:
   ```bash
   # Copy Documents/offline_tiles/{source}/ to portable storage
   # Structure: {source}/z/x/y.png
   ```

2. Import on target device:
   ```typescript
   import { importTilePackage } from '@/platform/offlineTileServer';
   await importTilePackage('offline_import/tiles', 'shared_source');
   ```

3. Both devices can now use same offline tiles
