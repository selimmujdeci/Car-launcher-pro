# Service Worker Offline Map System

## Overview

Real offline-first map rendering using service worker and IndexedDB. Maps work completely offline after initial load, with automatic tile caching and network fallback.

## Architecture

### Components

1. **serviceWorker.js** (public/) - Service worker with fetch interception
2. **serviceWorkerManager.ts** - Registration and lifecycle management
3. **mapService.ts** - Integration with map initialization
4. **IndexedDB** - Persistent offline tile storage

### How It Works

```
User opens map
    ↓
mapService initializes → registers service worker
    ↓
MapLibre GL requests tiles (OSM)
    ↓
Service worker intercepts fetch
    ↓
Check IndexedDB cache
    ├─ Found → serve from cache (instant, offline works)
    └─ Not found → fetch from network + auto-cache
    ↓
Cached tile available
    ↓
Subsequent offline requests served from cache
```

## Key Features

### Offline-First Strategy
- **Primary Source**: IndexedDB cache (instant)
- **Fallback**: Network (auto-caches on success)
- **Offline**: Cache available immediately without network

### Automatic Tile Caching
- Every successfully downloaded tile automatically cached
- No explicit pre-caching needed
- Tiles persist across app restarts

### Service Worker Benefits
- Runs on separate thread (non-blocking)
- Intercepts all fetch requests transparently
- Full control over cache logic
- Works offline without app interaction

### Storage
- **IndexedDB**: Async, persistent, large capacity
- **Structure**: `{z}/{x}/{y}` as key
- **Metadata**: Timestamp for future cleanup
- **Capacity**: Depends on device (typically 50MB+)

## Usage

### Automatic

No explicit setup needed - service worker registers automatically when map initializes:

```typescript
import { initializeMap } from '@/platform/mapService';

const map = await initializeMap(container, { offline: true });
// Service worker is now registered and caching tiles
```

### Check Cache Status

```typescript
import { getTileCacheStats } from '@/platform/serviceWorkerManager';

const stats = await getTileCacheStats();
console.log(`Cached tiles: ${stats.totalTiles}, Size: ${stats.cacheSize}`);
```

### Clear Cache

```typescript
import { clearOfflineTileCache } from '@/platform/serviceWorkerManager';

await clearOfflineTileCache();
```

## Offline Behavior

### Network Available
```
OSM tile request
  → Service worker intercepts
  → Check IndexedDB
  → Miss: fetch from network
  → Cache response automatically
  → Return to map
```

### Network Unavailable
```
OSM tile request
  → Service worker intercepts
  → Check IndexedDB
  → Hit: serve from cache instantly
  → Return to map
```

### Network Flaky
```
OSM tile request
  → Service worker intercepts
  → Check IndexedDB
  → Hit: serve from cache
  → (Background: try network for next time)
  → Return to map
```

## Integration Points

### GPS + Heading
- GPS location updates work offline
- Heading/bearing independent of tiles
- User marker renders with cached tiles

### Mini Map
- Uses same service worker cache
- Loads tiles from IndexedDB
- Works offline with cached data

### Full Screen Map
- Identical offline support
- Shares cache with mini map
- Full zoom/pan/heading offline

## Performance Considerations

1. **Async I/O**: IndexedDB operations non-blocking
2. **Worker Thread**: Service worker doesn't block main thread
3. **Cache Hit Rate**: Improves over time as tiles are visited
4. **Storage**: Monitor via `getTileCacheStats()`

## Technical Details

### Service Worker Lifecycle

```javascript
install → claim → activate → fetch interception
```

1. **Install**: Skip waiting, take control immediately
2. **Claim**: Claim all pages without reload
3. **Activate**: Take control of requests
4. **Fetch**: Intercept and handle requests

### IndexedDB Schema

```
Database: offline-tiles (version 1)
ObjectStore: offline_tiles_cache
  keyPath: key (z/x/y format)
  indexes:
    - timestamp (for future cleanup)

Entry:
  {
    key: "13/4125/2737",
    data: Blob(PNG data),
    timestamp: 1234567890
  }
```

### Cache Hit Flow

```typescript
// In service worker
const key = `${z}/${x}/${y}`;
const cachedTile = await db.get(key);
if (cachedTile) {
  return new Response(cachedTile.data, {
    headers: { 'Content-Type': 'image/png' }
  });
}
```

## Troubleshooting

### Service Worker Not Registering
- Check browser console for errors
- Verify HTTPS or localhost (service workers require secure context)
- Ensure public/serviceWorker.js is accessible

### Tiles Not Caching
- Check browser's IndexedDB in DevTools
- Verify device has available storage
- Check network requests are successful

### Offline Map Blank
- Bootstrap initial tiles first:
  ```typescript
  import { bootstrapOfflineTiles } from '@/platform/bootstrapOfflineTiles';
  await bootstrapOfflineTiles();
  ```
- Pre-cache region:
  ```typescript
  import { preCacheRegion } from '@/platform/bootstrapOfflineTiles';
  await preCacheRegion(-23.5, -23.6, -46.3, -46.4, 14);
  ```

### Cache Growing Too Large
- Monitor with `getTileCacheStats()`
- Clear periodically: `clearOfflineTileCache()`
- Implement cleanup by timestamp (future)

## Browser Support

- Modern browsers (Chrome, Firefox, Safari, Edge)
- Requires HTTPS or localhost
- IndexedDB support required
- Service Workers API required

## Limitations & Future

Current:
- ✅ Offline tile caching
- ✅ Automatic cache on network request
- ✅ Offline-first fallback
- ✅ GPS + heading work offline
- ✅ Full map zoom/pan offline

Planned:
- ⏳ Intelligent pre-caching based on route
- ⏳ Periodic cache cleanup
- ⏳ Cache expiration by age
- ⏳ Compression for storage efficiency
- ⏳ Sync tiles from cloud when online

## Advanced Usage

### Pre-cache a Route

```typescript
// Before going offline, pre-cache route area
const routeStart = { lat: -23.55, lon: -46.35 };
const routeEnd = { lat: -23.60, lon: -46.40 };

// Cache multiple zoom levels
for (let zoom = 12; zoom <= 14; zoom++) {
  await preCacheRegion(
    Math.max(routeStart.lat, routeEnd.lat),
    Math.min(routeStart.lat, routeEnd.lat),
    Math.max(routeStart.lon, routeEnd.lon),
    Math.min(routeStart.lon, routeEnd.lon),
    zoom
  );
}
```

### Monitor Cache Growth

```typescript
setInterval(async () => {
  const stats = await getTileCacheStats();
  console.log(`Cache: ${stats.totalTiles} tiles, ${stats.cacheSize}`);
}, 10000);
```

### Clear Old Tiles (Future)

```typescript
// When implemented
import { clearOldTiles } from '@/platform/serviceWorkerManager';
await clearOldTiles(7 * 24 * 60 * 60 * 1000); // 7 days
```

## Integration with Existing Systems

- **GPS**: Independent, works offline
- **Heading**: Independent, compass-based
- **Navigation**: Uses same cached tiles
- **MapLibre GL**: Transparent integration
- **User Marker**: Renders with cached tiles

## File Locations

- **Service Worker Code**: `src/serviceWorker.ts`, `public/serviceWorker.js`
- **Manager**: `src/platform/serviceWorkerManager.ts`
- **IndexedDB**: Browser's IndexedDB (automatic)
- **Registration**: `src/platform/mapService.ts`
