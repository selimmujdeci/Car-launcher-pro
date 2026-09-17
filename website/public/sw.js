/**
 * Service Worker — İKİ ÜRÜNE HİZMET EDER, İKİSİNİ KARIŞTIRMAZ.
 *
 * Responsibilities:
 *   1. install      → skipWaiting() — yeni SW hemen aktifleşir
 *   2. activate     → clients.claim() — açık tabları hemen kontrol al
 *   3. push         → showNotification (uygulama kapalıyken de çalışır)
 *   4. notificationclick → ilgili sayfayı aç veya odaklan
 *
 * ── ÖLÇÜLEN KUSUR (2026-09-17) ────────────────────────────────────────────
 * `push-notify` Edge Function bildirim hedefini ürüne göre ZATEN ayırıyor
 * (`${appUrl}/kumanda` tüketici, `${appUrl}/dashboard` filo). Ama buradaki
 * allowlist YALNIZ `/dashboard`'a izin veriyordu: Arabam Cebimde kullanıcısının
 * bildirimi sessizce filo paneline düşürülüyordu — kullanıcı kendi ürününden
 * çıkıp hiç kullanmadığı bir panele atılıyordu.
 *
 * Artık iki ürün yüzeyi de tanınır; ikisi de tanınmazsa filo kökü FAIL-SAFE
 * hedeftir (açık yönlendirme üretmemek için allowlist dışı her şey reddedilir).
 *
 * Zero-Leak: no caches; stateless — all data from push payload.
 */

'use strict';

/** Tüketici ürünü (Arabam Cebimde) kökü. */
const CONSUMER_URL = '/kumanda';
/** Filo/CarOS paneli kökü. */
const FLEET_URL    = '/dashboard';
const ICON_URL  = '/icons/icon-192.svg';
const BADGE_URL = '/icons/badge-72.svg';

/** Yol, verilen ürün kökünün içinde mi? (`/kumandaXYZ` eşleşmez) */
function isWithin(pathname, root) {
  return pathname === root || pathname.startsWith(`${root}/`);
}

function safeNotificationTarget(rawUrl) {
  try {
    const parsed = new URL(rawUrl ?? FLEET_URL, self.location.origin);
    if (parsed.origin !== self.location.origin) return FLEET_URL;
    // Account, vehicle and command context from an old notification is never
    // carried across sessions. The client-side cleanup boot gate re-authorizes
    // the protected path before mounting it.
    if (isWithin(parsed.pathname, CONSUMER_URL)) return parsed.pathname;
    if (isWithin(parsed.pathname, FLEET_URL))    return parsed.pathname;
    return FLEET_URL;
  } catch {
    return FLEET_URL;
  }
}

/** Hedef yola göre ürün adı — başlıksız bildirimde yanlış marka gösterilmez. */
function productTitleFor(targetUrl) {
  return isWithin(targetUrl, CONSUMER_URL) ? 'Arabam Cebimde' : 'CarOS Pro';
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
  // url is at top-level (not nested in data.data)
  const url     = safeNotificationTarget(data.url);
  const title   = data.title   ?? productTitleFor(url);
  const body    = data.body    ?? 'Araç uyarısı alındı';
  const icon    = data.icon    ?? ICON_URL;
  const badge   = data.badge   ?? BADGE_URL;
  const tag     = data.tag     ?? 'clp-default';
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
