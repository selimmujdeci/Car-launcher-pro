/**
 * pushEngine — Browser Push API yöneticisi (native, paket bağımlılığı yok).
 *
 * Sorumluluklar:
 *   1. Service Worker kaydı (idempotent — duplicate registration önlenir)
 *   2. Bildirim izni isteme (Notification.requestPermission)
 *   3. PushManager.subscribe ile VAPID aboneliği
 *   4. Aboneliği Supabase push_subscriptions tablosuna kaydetme
 *
 * ── ÖLÇÜLEN KUSUR (F5.1) ─────────────────────────────────────────────────
 * `saveToDB` TÜM hataları yutuyordu ve `subscribe()` yine `'subscribed'`
 * dönüyordu. Yani backend kaydı HİÇ oluşmasa bile rozet "Bildirimler Aktif"
 * diyordu. Üstelik `push_subscriptions` tablosu canlı şemada YOK
 * (`docs/db/CANONICAL_SCHEMA_INVENTORY.md` §3.2: isim drift'i) → yazma
 * İSTİSNASIZ düşüyor, kullanıcı bunu HİÇ öğrenmiyordu.
 *
 * Ayrıca `user_id: user?.id ?? null` yazılıyordu: oturumsuz kullanıcıda RLS
 * (`user_id = auth.uid()`) zaten reddeder — sessiz başarısızlığın ikinci yolu.
 *
 * ARTIK: tarayıcı izni TEK BAŞINA ACTIVE DEĞİLDİR. ACTIVE yalnız backend
 * kaydı GERİ OKUNARAK kanıtlandığında verilir (§8: kanıtsız success yok).
 * localStorage yalnız yerel kolaylıktır — ASLA kayıt kanıtı sayılmaz.
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

/**
 * Push kaydının GERÇEK durumu.
 *
 * `ACTIVE` bir İDDİA değil, KANIT'tır: tarayıcı aboneliği VE backend kaydı
 * birlikte doğrulandığında verilir. İzin verilmiş olması yetmez.
 */
export type PushState =
  | 'UNSUPPORTED'           // Tarayıcı Push/Notification desteklemiyor
  | 'PERMISSION_REQUIRED'   // Henüz sorulmadı — kullanıcı eylemi bekleniyor
  | 'DENIED'                // Kullanıcı izni reddetti
  | 'REGISTERING'           // Kayıt sürüyor
  | 'ACTIVE'                // Tarayıcı aboneliği + backend kaydı DOĞRULANDI
  | 'FAILED';               // Kayıt tamamlanamadı — sebep `reason`da

/**
 * Başarısızlık sebebi. Kullanıcıya gösterilebilir olmalıdır:
 * endpoint, anahtar veya token GİBİ hassas hiçbir alan TAŞIMAZ.
 */
export type PushFailureReason =
  | 'NO_VAPID_KEY'            // Sunucu anahtarı yapılandırılmamış
  | 'SW_REGISTRATION_FAILED'  // Service Worker kaydedilemedi
  | 'SUBSCRIBE_FAILED'        // PushManager.subscribe düştü
  | 'NOT_AUTHENTICATED'       // Oturum yok → sahiplik bağlanamaz
  | 'BACKEND_UNAVAILABLE'     // Supabase istemcisi yok
  | 'BACKEND_PERSIST_FAILED'; // Yazma reddedildi / tablo yok / geri okunamadı

export interface PushEngineResult {
  state: PushState;
  /** Yalnız `FAILED`/`UNSUPPORTED` durumlarında anlamlıdır. */
  reason?: PushFailureReason;
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

type PersistOutcome =
  | { ok: true }
  | { ok: false; reason: PushFailureReason };

/**
 * Aboneliği backend'e yazar ve YAZILDIĞINI GERİ OKUYARAK kanıtlar.
 *
 * Sessiz yutma YOK: her başarısızlık sebebiyle birlikte döner ve çağıran
 * bunu `FAILED` durumuna çevirir. `.select()` şart — PostgREST hata
 * döndürmediği hâlde satır oluşmamışsa (RLS sessiz filtresi) bunu yalnız
 * geri okuma yakalar.
 *
 * GÜVENLİK: `endpoint` ve abonelik anahtarları hassas kabul edilir —
 * hiçbir dalda loglanmaz, hata nesnesine konmaz.
 */
async function persistSubscription(sub: PushSubscription): Promise<PersistOutcome> {
  const json     = sub.toJSON();
  const endpoint = json.endpoint ?? '';
  if (!endpoint) return { ok: false, reason: 'BACKEND_PERSIST_FAILED' };

  if (!supabaseBrowser) return { ok: false, reason: 'BACKEND_UNAVAILABLE' };

  let outcome: PersistOutcome;
  try {
    /* Sahiplik ZORUNLU: RLS `user_id = auth.uid()` ister. Oturumsuz yazma
       `user_id: null` ile denenirse RLS zaten reddeder — o yolu sessizce
       denemek yerine burada fail-closed duruyoruz. */
    const { data: { user } } = await supabaseBrowser.auth.getUser();
    if (!user?.id) {
      outcome = { ok: false, reason: 'NOT_AUTHENTICATED' };
    } else {
      const { data, error } = await supabaseBrowser
        .from('push_subscriptions')
        .upsert(
          {
            endpoint,
            subscription: json,
            user_id:      user.id,
            updated_at:   new Date().toISOString(),
          },
          { onConflict: 'endpoint' },
        )
        .select('id')
        .maybeSingle();

      outcome = (error || !data)
        ? { ok: false, reason: 'BACKEND_PERSIST_FAILED' }
        : { ok: true };
    }
  } catch {
    outcome = { ok: false, reason: 'BACKEND_PERSIST_FAILED' };
  }

  /* Yerel kopya YALNIZ kolaylıktır (unsubscribe/temizlik yüzeyi). Kayıt
     KANITI DEĞİLDİR: backend düştüyse durum yine FAILED'dir. */
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(json));
  } catch { /* QuotaExceeded — yok sayılır */ }

  return outcome;
}

/** Backend'de bu endpoint için kayıt GERÇEKTEN duruyor mu? */
async function backendHasSubscription(endpoint: string): Promise<boolean> {
  if (!supabaseBrowser || !endpoint) return false;
  try {
    const { data, error } = await supabaseBrowser
      .from('push_subscriptions')
      .select('id')
      .eq('endpoint', endpoint)
      .maybeSingle();
    return !error && !!data;
  } catch {
    return false;
  }
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
  if (typeof window === 'undefined') return { state: 'UNSUPPORTED' };
  if (!('Notification' in window) || !('PushManager' in window)) {
    return { state: 'UNSUPPORTED' };
  }

  const permission = Notification.permission;
  if (permission === 'denied')  return { state: 'DENIED' };
  if (permission === 'default') return { state: 'PERMISSION_REQUIRED' };

  // permission === 'granted' — tarayıcı aboneliği var mı?
  const reg = await getOrRegisterSW();
  if (!reg) return { state: 'FAILED', reason: 'SW_REGISTRATION_FAILED' };

  const existing = await reg.pushManager.getSubscription();
  if (!existing) {
    // İzin verilmiş ama abonelik yok → yeniden kayıt gerekir.
    return { state: 'PERMISSION_REQUIRED' };
  }

  /* KRİTİK (§8): tarayıcı aboneliği ACTIVE için YETMEZ. Gönderici backend
     kaydını okur; kayıt yoksa bildirim ASLA ulaşmaz. "İzin verildi" ile
     "bildirim gelir" aynı şey DEĞİLDİR — kanıt backend'dedir. */
  if (!(await backendHasSubscription(existing.endpoint))) {
    return { state: 'FAILED', reason: 'BACKEND_PERSIST_FAILED', subscription: existing };
  }

  return { state: 'ACTIVE', subscription: existing };
}

/**
 * subscribe — Request permission + create PushSubscription + persist.
 * Safe to call multiple times — reuses existing subscription if available.
 */
export async function subscribe(): Promise<PushEngineResult> {
  if (typeof window === 'undefined') return { state: 'UNSUPPORTED' };
  if (!('Notification' in window) || !('PushManager' in window)) {
    return { state: 'UNSUPPORTED' };
  }

  // 1. İzin (zaten verilmiş/reddedilmişse no-op)
  const permission = await Notification.requestPermission();
  if (permission === 'denied')  return { state: 'DENIED' };
  if (permission !== 'granted') return { state: 'PERMISSION_REQUIRED' };

  // 2. Service Worker (idempotent)
  const reg = await getOrRegisterSW();
  if (!reg) return { state: 'FAILED', reason: 'SW_REGISTRATION_FAILED' };

  // 3. Mevcut aboneliği yeniden kullan, yoksa kur
  let sub: PushSubscription | null;
  try {
    sub = await reg.pushManager.getSubscription();

    if (!sub) {
      const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      /* VAPID anahtarı OLMADAN `subscribe()` ÇALIŞMAZ: Chromium
         `applicationServerKey` zorunlu kılar ve çağrı fırlatır. Eski kod bunu
         "notification-only mode"a düşüş diye yorumluyordu — böyle bir düşüş
         YOKTUR. Yapılandırma eksikse bunu açıkça söylüyoruz. */
      if (!vapidKey) return { state: 'FAILED', reason: 'NO_VAPID_KEY' };

      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToArrayBuffer(vapidKey),
      });
    }
  } catch {
    return { state: 'FAILED', reason: 'SUBSCRIBE_FAILED' };
  }

  // 4. Backend kaydı — ACTIVE'in TEK kanıtı budur
  const persisted = await persistSubscription(sub);
  if (!persisted.ok) {
    return { state: 'FAILED', reason: persisted.reason, subscription: sub };
  }

  return { state: 'ACTIVE', subscription: sub };
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
