/// <reference lib="webworker" />

declare const self: ServiceWorkerGlobalScope;

const OFFLINE_TILES_DB = 'offline_tiles_cache';

/**
 * Service Worker for offline tile serving
 * Intercepts fetch requests and serves tiles from local storage
 */

// Handle tile requests
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Handle custom tile:// protocol (converted to http by browser)
  if (
    url.pathname.match(/\/tiles\/\d+\/\d+\/\d+\.png$/) ||
    url.pathname.match(/^\/tile\/\d+\/\d+\/\d+$/)
  ) {
    event.respondWith(handleTileRequest(event.request));
  }

  // Handle OSM tiles with offline fallback
  if (url.hostname.includes('tile.openstreetmap.org')) {
    event.respondWith(handleOsmTileRequest(event.request));
  }
});

/**
 * Handle custom tile protocol requests
 */
async function handleTileRequest(request: Request): Promise<Response> {
  try {
    const match = new URL(request.url).pathname.match(/\/tiles?\/(\d+)\/(\d+)\/(\d+)/);
    if (!match) {
      return new Response('Invalid tile URL', { status: 400 });
    }

    const [, z, x, y] = match;
    const tile = await getOfflineTile(parseInt(z), parseInt(x), parseInt(y));

    if (tile) {
      return new Response(tile, {
        status: 200,
        headers: {
          'Content-Type': 'image/png',
          'Cache-Control': 'public, max-age=31536000',
        },
      });
    }

    // Try network if offline tile not found
    if (self.navigator.onLine) {
      try {
        const response = await fetch(request);
        if (response.ok) {
          // Cache successful response
          const blob = await response.blob();
          await cacheTileData(parseInt(z), parseInt(x), parseInt(y), blob);
        }
        return response;
      } catch {
        return new Response('Tile not found', { status: 404 });
      }
    }

    return new Response('Tile not found', { status: 404 });
  } catch (err) {
    console.error('Tile request error:', err);
    return new Response('Server error', { status: 500 });
  }
}

/**
 * Handle OSM tile requests with offline fallback
 */
async function handleOsmTileRequest(request: Request): Promise<Response> {
  try {
    const match = new URL(request.url).pathname.match(/\/(\d+)\/(\d+)\/(\d+)\.png/);
    if (!match) {
      return fetch(request);
    }

    const [, z, x, y] = match;
    const cachedTile = await getOfflineTile(parseInt(z), parseInt(x), parseInt(y));

    // Return cached tile if available
    if (cachedTile) {
      return new Response(cachedTile, {
        status: 200,
        headers: {
          'Content-Type': 'image/png',
          'Cache-Control': 'public, max-age=31536000',
        },
      });
    }

    // Try network
    if (self.navigator.onLine) {
      try {
        const response = await fetch(request);
        if (response.ok) {
          const blob = await response.blob();
          await cacheTileData(parseInt(z), parseInt(x), parseInt(y), blob);
        }
        return response;
      } catch {
        // Network failed, check cache again
        const cached = await getOfflineTile(parseInt(z), parseInt(x), parseInt(y));
        if (cached) {
          return new Response(cached, {
            status: 200,
            headers: { 'Content-Type': 'image/png' },
          });
        }
        return new Response('Tile not found', { status: 404 });
      }
    }

    // Network unavailable
    const cached = await getOfflineTile(parseInt(z), parseInt(x), parseInt(y));
    if (cached) {
      return new Response(cached, {
        status: 200,
        headers: { 'Content-Type': 'image/png' },
      });
    }

    return new Response('Tile not found', { status: 404 });
  } catch (err) {
    console.error('OSM tile request error:', err);
    return fetch(request).catch(() => new Response('Tile not found', { status: 404 }));
  }
}

/**
 * Get offline tile from IndexedDB
 */
async function getOfflineTile(z: number, x: number, y: number): Promise<Blob | null> {
  try {
    const db = await openTileDatabase();
    const tx = db.transaction(OFFLINE_TILES_DB, 'readonly');
    const store = tx.objectStore(OFFLINE_TILES_DB);
    const key = `${z}/${x}/${y}`;

    return new Promise((resolve, reject) => {
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result?.data || null);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('Failed to get offline tile:', err);
    return null;
  }
}

/**
 * Cache tile data in IndexedDB
 */
async function cacheTileData(z: number, x: number, y: number, blob: Blob): Promise<void> {
  try {
    const db = await openTileDatabase();
    const tx = db.transaction(OFFLINE_TILES_DB, 'readwrite');
    const store = tx.objectStore(OFFLINE_TILES_DB);
    const key = `${z}/${x}/${y}`;

    return new Promise((resolve, reject) => {
      const req = store.put({ key, data: blob, timestamp: Date.now() });
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('Failed to cache tile:', err);
  }
}

/**
 * Open IndexedDB database for tiles
 */
function openTileDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('offline-tiles', 1);

    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);

    req.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(OFFLINE_TILES_DB)) {
        const store = db.createObjectStore(OFFLINE_TILES_DB, { keyPath: 'key' });
        store.createIndex('timestamp', 'timestamp');
      }
    };
  });
}

// Handle install event
self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

// Handle activate event
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
