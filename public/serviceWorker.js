"use strict";
/// <reference lib="webworker" />
/* ═══════════════════════════════════════════════════════════════════════════
 * TEK KAYNAK (single source of truth): src/serviceWorker.ts
 * public/serviceWorker.js bu dosyadan ÜRETİLİR — elle düzenleme!
 * Üretim: `npm run build:sw` (npm run build içinde zincirli).
 * Kayıt: serviceWorkerManager.ts → navigator.serviceWorker.register('/serviceWorker.js')
 * ═══════════════════════════════════════════════════════════════════════════ */
// lib.webworker `var self` tanımladığı için redeclare edilemez (TS2451);
// tipli alias hem proje (tsc -b, DOM lib) hem CLI (build:sw) derlemesinde çalışır.
const sw = self;
const OFFLINE_TILES_DB = 'offline_tiles_cache';
/**
 * Service Worker for offline tile serving
 * Handles fetch interception and IndexedDB tile caching
 */
// Handle tile requests
sw.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    // Handle custom tile:// protocol or tile paths
    if (url.pathname.match(/\/tiles\/\d+\/\d+\/\d+\.png$/) ||
        url.pathname.match(/^\/tile\/\d+\/\d+\/\d+$/)) {
        event.respondWith(handleTileRequest(event.request));
    }
    else if (url.hostname.includes('tile.openstreetmap.org')) {
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
        if (sw.navigator.onLine) {
            try {
                const response = await fetch(request);
                if (response.ok) {
                    const blob = await response.blob();
                    // Fire-and-forget: cache yazımı yanıtı BLOKLAMAZ, hatası yutulur
                    // (canlı davranış — await edilirse cache hatası yanıtı 404/500'e çevirir)
                    void cacheTileData(parseInt(z), parseInt(x), parseInt(y), blob).catch(() => { });
                }
                return response;
            }
            catch {
                return new Response('Tile not found', { status: 404 });
            }
        }
        return new Response('Tile not found', { status: 404 });
    }
    catch (err) {
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
        if (sw.navigator.onLine) {
            try {
                const response = await fetch(request);
                if (response.ok) {
                    const blob = await response.blob();
                    // Fire-and-forget (yukarıdaki not)
                    void cacheTileData(parseInt(z), parseInt(x), parseInt(y), blob).catch(() => { });
                }
                return response;
            }
            catch {
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
    }
    catch (err) {
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
    }
    catch (err) {
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
    }
    catch (err) {
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
sw.addEventListener('install', (event) => {
    event.waitUntil(sw.skipWaiting());
});
// Handle activate event - take over all pages
sw.addEventListener('activate', (event) => {
    event.waitUntil(sw.clients.claim());
});
sw.addEventListener('push', (event) => {
    if (!event.data)
        return;
    let payload;
    try {
        payload = event.data.json();
    }
    catch {
        return;
    }
    const { title = 'Caros Pro', body = '', icon = '/icons/icon-192.png', tag = 'cockpitos', renotify = false, data: notifData = {}, } = payload;
    // vibrate/renotify/actions standart TS lib tanımında yok ama Chromium'da
    // destekli — assertion ile geçirilir, runtime davranışı canlı JS ile birebir.
    const options = {
        body,
        icon,
        badge: '/icons/badge-72.png',
        tag,
        renotify,
        vibrate: [100, 50, 100],
        data: notifData,
        actions: notifData.url ? [{ action: 'open', title: 'Aç' }] : [],
    };
    event.waitUntil(sw.registration.showNotification(title, options));
});
// ── Bildirime tıklandığında ilgili sayfayı aç ─────────────────────────────────
sw.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const url = event.notification.data?.url ?? '/kumanda';
    event.waitUntil(sw.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
        // Açık pencere varsa oraya odaklan
        for (const client of clients) {
            if (client.url.includes(new URL(url, sw.location.origin).pathname)) {
                return client.focus();
            }
        }
        // Yoksa yeni sekme aç
        return sw.clients.openWindow(url);
    }));
});
