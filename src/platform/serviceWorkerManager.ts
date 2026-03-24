/**
 * Service Worker Manager
 * Handles registration and initialization of offline service worker
 */

let registrationReady = false;
let serviceWorkerRegistration: ServiceWorkerRegistration | null = null;

/**
 * Register the offline service worker
 */
export async function registerOfflineServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  // Service workers not available on this platform
  if (!('serviceWorker' in navigator)) {
    console.warn('Service workers not supported');
    return null;
  }

  // Skip on non-HTTPS and non-localhost environments
  if (!globalThis.isSecureContext && !location.hostname.includes('localhost')) {
    console.warn('Service workers require HTTPS or localhost');
    return null;
  }

  try {
    const registration = await navigator.serviceWorker.register('/serviceWorker.js', {
      scope: '/',
      type: 'classic',
    });

    serviceWorkerRegistration = registration;
    registrationReady = true;

    // Handle updates
    registration.addEventListener('updatefound', () => {
      const newWorker = registration.installing;
      if (!newWorker) return;

      newWorker.addEventListener('statechange', () => {
        if (newWorker.state === 'activated') {
          console.log('Service worker updated and activated');
        }
      });
    });

    console.log('Service worker registered:', registration);
    return registration;
  } catch (err) {
    console.warn('Service worker registration failed:', err);
    return null;
  }
}

/**
 * Unregister the service worker
 */
export async function unregisterOfflineServiceWorker(): Promise<void> {
  if (!serviceWorkerRegistration) return;

  try {
    await serviceWorkerRegistration.unregister();
    serviceWorkerRegistration = null;
    registrationReady = false;
  } catch (err) {
    console.error('Service worker unregistration failed:', err);
  }
}

/**
 * Check if service worker is ready
 */
export function isServiceWorkerReady(): boolean {
  return registrationReady;
}

/**
 * Get service worker registration
 */
export function getServiceWorkerRegistration(): ServiceWorkerRegistration | null {
  return serviceWorkerRegistration;
}

/**
 * Cache a tile through service worker
 */
export async function cacheTileThroughServiceWorker(
  z: number,
  x: number,
  y: number,
  blob: Blob
): Promise<void> {
  if (!serviceWorkerRegistration?.active) {
    console.warn('Service worker not active');
    return;
  }

  try {
    // Send message to service worker to cache tile
    serviceWorkerRegistration.active.postMessage({
      type: 'CACHE_TILE',
      z,
      x,
      y,
      blob,
    });
  } catch (err) {
    console.warn('Failed to cache tile through service worker:', err);
  }
}

/**
 * Clear offline tile cache
 */
export async function clearOfflineTileCache(): Promise<void> {
  try {
    const db = await openTileDatabase();
    const tx = db.transaction('offline_tiles_cache', 'readwrite');
    const store = tx.objectStore('offline_tiles_cache');

    return new Promise((resolve, reject) => {
      const req = store.clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.error('Failed to clear tile cache:', err);
  }
}

/**
 * Get cache statistics
 */
export async function getTileCacheStats(): Promise<{
  totalTiles: number;
  cacheSize: string;
}> {
  try {
    const db = await openTileDatabase();
    const tx = db.transaction('offline_tiles_cache', 'readonly');
    const store = tx.objectStore('offline_tiles_cache');

    return new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => {
        const tiles = req.result;
        const sizeBytes = tiles.reduce((acc, tile) => acc + (tile.data?.size || 0), 0);
        resolve({
          totalTiles: tiles.length,
          cacheSize: formatBytes(sizeBytes),
        });
      };
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.error('Failed to get cache stats:', err);
    return { totalTiles: 0, cacheSize: '0MB' };
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
      if (!db.objectStoreNames.contains('offline_tiles_cache')) {
        const store = db.createObjectStore('offline_tiles_cache', { keyPath: 'key' });
        store.createIndex('timestamp', 'timestamp');
      }
    };
  });
}

/**
 * Format bytes to human-readable size
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + sizes[i];
}
