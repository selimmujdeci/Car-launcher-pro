/**
 * Service Worker for offline tile serving
 * Handles fetch interception and IndexedDB tile caching
 */

const OFFLINE_TILES_DB = 'offline_tiles_cache';

// Handle tile requests
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Handle custom tile:// protocol or tile paths
  if (
    url.pathname.match(/\/tiles\/\d+\/\d+\/\d+\.png$/) ||
    url.pathname.match(/^\/tile\/\d+\/\d+\/\d+$/)
  ) {
    event.respondWith(handleTileRequest(event.request));
  } else if (url.hostname.includes('tile.openstreetmap.org')) {
    // Handle OSM tiles with offline fallback
    event.respondWith(handleOsmTileRequest(event.request));
  }
});

/**
 * Handle custom tile protocol requests
 */
async function handleTileRequest(request) {
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
          const blob = await response.blob();
          cacheTileData(parseInt(z), parseInt(x), parseInt(y), blob).catch(() => {});
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
async function handleOsmTileRequest(request) {
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

    // Try network if online
    if (self.navigator.onLine) {
      try {
        const response = await fetch(request);
        if (response.ok) {
          const blob = await response.blob();
          cacheTileData(parseInt(z), parseInt(x), parseInt(y), blob).catch(() => {});
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

    // Network unavailable, check cache
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
async function getOfflineTile(z, x, y) {
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
async function cacheTileData(z, x, y, blob) {
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
function openTileDatabase() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('offline-tiles', 1);

    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);

    req.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(OFFLINE_TILES_DB)) {
        const store = db.createObjectStore(OFFLINE_TILES_DB, { keyPath: 'key' });
        store.createIndex('timestamp', 'timestamp');
      }
    };
  });
}

// Handle install event - claim immediately
self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

// Handle activate event - take over all pages
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// ── Web Push — bildirim göster ────────────────────────────────────────────────

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let data = {};
  try { data = event.data.json(); } catch { return; }

  const {
    title = 'CockpitOS',
    body  = '',
    icon  = '/icons/icon-192.png',
    tag   = 'cockpitos',
    renotify = false,
    data: notifData = {},
  } = data;

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon,
      badge:    '/icons/badge-72.png',
      tag,
      renotify,
      vibrate:  [100, 50, 100],
      data:     notifData,
      actions:  notifData.url ? [{ action: 'open', title: 'Aç' }] : [],
    })
  );
});

// ── Bildirime tıklandığında ilgili sayfayı aç ─────────────────────────────────

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const url = event.notification.data?.url ?? '/kumanda';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Açık pencere varsa oraya odaklan
      for (const client of clients) {
        if (client.url.includes(new URL(url, self.location.origin).pathname)) {
          return client.focus();
        }
      }
      // Yoksa yeni sekme aç
      return self.clients.openWindow(url);
    })
  );
});
