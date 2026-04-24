/**
 * pushEngine — Browser Push API yöneticisi (native, paket bağımlılığı yok).
 *
 * Sorumluluklar:
 *   1. Service Worker kaydı (idempotent — duplicate registration önlenir)
 *   2. Bildirim izni isteme (Notification.requestPermission)
 *   3. PushManager.subscribe ile VAPID aboneliği
 *   4. Aboneliği Supabase push_subscriptions tablosuna kaydetme
 *      (demo modda localStorage fallback)
 *
 * Zero-Leak:
 *   - SW kaydı önce getRegistration() ile kontrol edilir
 *   - getSubscription() mevcut aboneliği yeniden kullanır
 *   - Tüm async operasyonlar try/catch ile sarılmıştır
 *
 * Kullanım:
 *   const state = await initPushEngine();   // mount'ta bir kez
 *   const state = await subscribe();        // kullanıcı tıklayınca
 *   unsubscribe();                          // cleanup
 */

import { supabaseBrowser } from './supabase';

const SW_URL      = '/sw.js';
const SW_SCOPE    = '/';
const STORAGE_KEY = 'clp_push_sub';

/* ── Types ───────────────────────────────────────────────────── */

export type PushState =
  | 'unsupported'   // Browser doesn't support Push
  | 'denied'        // User denied permission
  | 'prompt'        // Not yet asked
  | 'subscribed'    // Active subscription
  | 'error';        // Unexpected failure

export interface PushEngineResult {
  state: PushState;
  subscription?: PushSubscription;
}

/* ── VAPID helper ────────────────────────────────────────────── */

function urlBase64ToArrayBuffer(base64: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64     = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw     = atob(b64);
  const buf     = new ArrayBuffer(raw.length);
  const view    = new Uint8Array(buf);
  for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i);
  return buf;
}

/* ── Supabase persistence ────────────────────────────────────── */

async function saveToDB(sub: PushSubscription): Promise<void> {
  const json    = sub.toJSON();
  const endpoint = json.endpoint ?? '';

  if (supabaseBrowser) {
    try {
      await supabaseBrowser.from('push_subscriptions').upsert(
        { endpoint, subscription: json, updated_at: new Date().toISOString() },
        { onConflict: 'endpoint' },
      );
    } catch { /* non-critical — localStorage fallback below */ }
  }

  // Always persist locally for resilience
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(json));
  } catch { /* QuotaExceeded — ignore */ }
}

async function removeFromDB(endpoint: string): Promise<void> {
  if (supabaseBrowser) {
    try {
      await supabaseBrowser.from('push_subscriptions').delete().eq('endpoint', endpoint);
    } catch { /* non-critical */ }
  }
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

/* ── SW registration (idempotent) ────────────────────────────── */

async function getOrRegisterSW(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  try {
    // Check for existing registration first — prevent duplicate
    const existing = await navigator.serviceWorker.getRegistration(SW_URL);
    if (existing) return existing;
    return await navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE });
  } catch {
    return null;
  }
}

/* ── Public API ──────────────────────────────────────────────── */

/**
 * initPushEngine — Call once on mount.
 * Returns current state without prompting the user.
 */
export async function initPushEngine(): Promise<PushEngineResult> {
  if (typeof window === 'undefined') return { state: 'unsupported' };
  if (!('Notification' in window) || !('PushManager' in window)) {
    return { state: 'unsupported' };
  }

  const permission = Notification.permission;
  if (permission === 'denied') return { state: 'denied' };
  if (permission === 'default') return { state: 'prompt' };

  // permission === 'granted' — check for active subscription
  const reg = await getOrRegisterSW();
  if (!reg) return { state: 'error' };

  const existing = await reg.pushManager.getSubscription();
  if (existing) return { state: 'subscribed', subscription: existing };

  // Granted but no subscription — unusual; treat as prompt to re-subscribe
  return { state: 'prompt' };
}

/**
 * subscribe — Request permission + create PushSubscription + persist.
 * Safe to call multiple times — reuses existing subscription if available.
 */
export async function subscribe(): Promise<PushEngineResult> {
  if (typeof window === 'undefined') return { state: 'unsupported' };
  if (!('Notification' in window) || !('PushManager' in window)) {
    return { state: 'unsupported' };
  }

  // 1. Request permission (no-op if already granted/denied)
  const permission = await Notification.requestPermission();
  if (permission === 'denied')  return { state: 'denied' };
  if (permission !== 'granted') return { state: 'prompt' };

  // 2. Register SW (idempotent)
  const reg = await getOrRegisterSW();
  if (!reg) return { state: 'error' };

  // 3. Reuse existing subscription or create new one
  try {
    let sub = await reg.pushManager.getSubscription();

    if (!sub) {
      const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      // Without a VAPID key, subscription will fail — fall back to notification-only mode
      const subscribeOptions: PushSubscriptionOptionsInit = {
        userVisibleOnly: true,
        ...(vapidKey ? { applicationServerKey: urlBase64ToArrayBuffer(vapidKey) } : {}),
      };
      sub = await reg.pushManager.subscribe(subscribeOptions);
    }

    await saveToDB(sub);
    return { state: 'subscribed', subscription: sub };
  } catch {
    return { state: 'error' };
  }
}

/**
 * unsubscribe — Cancel active subscription and remove from DB.
 */
export async function unsubscribe(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration(SW_URL);
    if (!reg) return;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return;
    const endpoint = sub.endpoint;
    await sub.unsubscribe();
    await removeFromDB(endpoint);
  } catch { /* best-effort */ }
}
