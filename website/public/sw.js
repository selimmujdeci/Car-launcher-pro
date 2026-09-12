/**
 * Car Launcher Pro — Service Worker
 *
 * Responsibilities:
 *   1. install      → skipWaiting() — yeni SW hemen aktifleşir
 *   2. activate     → clients.claim() — açık tabları hemen kontrol al
 *   3. push         → showNotification (uygulama kapalıyken de çalışır)
 *   4. notificationclick → ilgili sayfayı aç veya odaklan
 *
 * Zero-Leak: no caches; stateless — all data from push payload.
 */

'use strict';

const APP_URL  = '/dashboard';
const ICON_URL = '/icons/icon-192.svg';
const BADGE_URL = '/icons/badge-72.svg';

function safeNotificationTarget(rawUrl) {
  try {
    const parsed = new URL(rawUrl ?? APP_URL, self.location.origin);
    if (parsed.origin !== self.location.origin) return APP_URL;
    if (parsed.pathname !== '/dashboard' && !parsed.pathname.startsWith('/dashboard/')) {
      return APP_URL;
    }
    // Account, vehicle and command context from an old notification is never
    // carried across sessions. The client-side cleanup boot gate re-authorizes
    // the protected path before mounting it.
    return parsed.pathname;
  } catch {
    return APP_URL;
  }
}

/* ── Install: skip waiting so new SW activates immediately ──── */

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

/* ── Activate: claim all clients ────────────────────────────── */

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

/* ── Push: parse payload and show notification ──────────────── */

self.addEventListener('push', (event) => {
  let data = {};
  if (event.data) {
    try { data = event.data.json(); }
    catch { data = { body: event.data.text() }; }
  }

  // Edge Function sends flat object: { title, body, icon, badge, tag, url, urgent }
  const title   = data.title   ?? 'Car Launcher Pro';
  const body    = data.body    ?? 'Araç uyarısı alındı';
  const icon    = data.icon    ?? ICON_URL;
  const badge   = data.badge   ?? BADGE_URL;
  const tag     = data.tag     ?? 'clp-default';
  // url is at top-level (not nested in data.data)
  const url     = safeNotificationTarget(data.url);
  const urgent  = data.urgent  ?? false;

  const options = {
    body,
    icon,
    badge,
    tag,
    renotify:           true,
    data:               { url },
    vibrate:            urgent ? [300, 100, 300, 100, 600] : [200, 100, 200],
    requireInteraction: urgent,
    silent:             false,
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

/* ── Notification click: focus tab or open URL ──────────────── */

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  // url stored in notification.data.url (set above)
  const targetUrl = safeNotificationTarget(event.notification.data?.url);

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Focus any open tab whose path starts with the target
        const target = new URL(targetUrl, self.location.origin);
        for (const client of clientList) {
          try {
            const clientPath = new URL(client.url).pathname;
            if (clientPath.startsWith(target.pathname) && 'focus' in client) {
              return client.focus();
            }
          } catch { /* invalid URL — skip */ }
        }
        return self.clients.openWindow(targetUrl);
      })
  );
});
