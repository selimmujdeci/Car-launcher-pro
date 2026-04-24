/**
 * Car Launcher Pro — Service Worker
 *
 * Responsibilities:
 *   1. push        → self.registration.showNotification (app-closed support)
 *   2. notificationclick → focus existing tab or open /dashboard
 *   3. activate    → clients.claim() — take control immediately (no reload needed)
 *
 * Zero-Leak: no caches opened; stateless — all data comes from push payload.
 */

'use strict';

const APP_URL = '/dashboard';

/* ── Activate: claim all clients immediately ─────────────────── */

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

/* ── Push: parse payload and show notification ───────────────── */

self.addEventListener('push', (event) => {
  let data = {};
  if (event.data) {
    try { data = event.data.json(); }
    catch { data = { body: event.data.text() }; }
  }

  const title   = data.title   ?? 'Car Launcher Pro';
  const body    = data.body    ?? 'Araç uyarısı alındı';
  const tag     = data.tag     ?? 'clp-alarm';
  const url     = data.url     ?? APP_URL;
  const urgent  = data.urgent  ?? false;

  const options = {
    body,
    icon:               '/icons/icon-192.png',
    badge:              '/icons/badge-72.png',
    tag,
    data:               { url },
    vibrate:            urgent ? [300, 100, 300, 100, 600] : [200, 100, 200],
    requireInteraction: urgent,
    silent:             false,
    // OLED-friendly dark notification (Android)
    // color is applied as notification accent on supported platforms
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

/* ── Notification click: focus or open dashboard ─────────────── */

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url ?? APP_URL;

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Focus existing tab if already open
        for (const client of clientList) {
          if (new URL(client.url).pathname.startsWith('/dashboard') && 'focus' in client) {
            return client.focus();
          }
        }
        // Open new tab
        return self.clients.openWindow(targetUrl);
      })
  );
});
