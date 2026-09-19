/**
 * fcmService.ts — FCM Push Token kaydı ve Push-to-Wake dinleyicisi.
 *
 * Akış:
 *   1. App açılınca requestPermission() → FCM token al
 *   2. Token'ı ARAÇ CİHAZ kimliğiyle kaydet (`register_vehicle_push_token`)
 *   3. Data-only push gelince → CommandListener'ı kısa süreli uyan
 *   4. 30 saniye işlem yoksa → CommandListener kapanır (akü tasarrufu)
 *
 * Zero-Leak: her listener, cleanup fonksiyonu döner.
 */

import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { logInfo } from './debug';
import { sensitiveKeyStore }  from './sensitiveKeyStore';
// Statik import — dynamic import INEFFECTIVE_DYNAMIC_IMPORT uyarısını tetikler
import { ensureDevicePushTokenRegistered } from './vehicleIdentityService';
import {
  startCommandListener, stopCommandListener,
  isCommandListenerActive, triggerPendingPoll,
} from './commandListener';
import { drainNativeCommandQueue }                   from './nativeCommandBridge';

const WAKE_TIMEOUT_MS = 30_000; // 30s işlem yoksa WS kapat

let _registered       = false;
let _wakeTimer: ReturnType<typeof setTimeout> | null = null;
let _listenerActive   = false;
let _isWaking         = false; // async start devam ederken ikinci çağrıyı engeller

// ── Wake on push ─────────────────────────────────────────────────────────────

function wakeCommandListener(): void {
  /* Dinleyici zaten canlıysa (pushService kalıcı açmış olabilir) YENİDEN
     KURULMAZ — yalnız bekleyen komutlar ANINDA yoklanır (#647). Aksi hâlde
     bu modül ötekinin bağlantısını kesip dedup kümesini sıfırlardı. */
  if (isCommandListenerActive()) {
    triggerPendingPoll();
    return;
  }

  // Zaten uyanıksa timer'ı sıfırla
  if (_wakeTimer) {
    clearTimeout(_wakeTimer);
  }

  // _isWaking: async start devam ederken yeni bir wake başlatılmaz
  if (!_listenerActive && !_isWaking) {
    _isWaking = true;
    sensitiveKeyStore.get('veh_vehicle_id')
      .then((vehicleId) => {
        _isWaking = false;
        if (!vehicleId) return;
        _listenerActive = true;
        startCommandListener(vehicleId);
        logInfo('[FCM] Push-to-Wake: CommandListener başlatıldı');
      })
      .catch(() => { _isWaking = false; });
  }

  // 30s sonra tekrar kapat
  _wakeTimer = setTimeout(() => {
    _wakeTimer = null;
    _listenerActive = false;
    stopCommandListener();
    logInfo('[FCM] Push-to-Wake: CommandListener uyutuldu (idle timeout)');
  }, WAKE_TIMEOUT_MS);
}

// ── FCM Token kaydı ───────────────────────────────────────────────────────────

/**
 * FCM token'ını ARAÇ CİHAZ kimliğiyle kaydeder (PROD-1A1).
 *
 * Eskiden `register_push_token(p_vehicle_id, …)` çağrılıyordu; o RPC
 * `auth.uid()` ister ve head unit OTURUMSUZ bağlandığı için HER çağrı
 * `{ok:false,'Yetkisiz.'}` dönüyordu — ama istisna atmadığı için hemen
 * ardından "Token kaydedildi" loglanıyordu. Production ölçümü:
 * `vehicle_push_tokens` = 0 satır.
 *
 * Kayıt otoritesi TEKTİR: `vehicleIdentityService`. Bu modül ile `pushService`
 * aynı token'ı ayrı ayrı teslim edebilir; ikinci çağrı orada ağa hiç çıkmadan
 * karşılanır (RPC zaten idempotenttir, bu yalnız israfı keser).
 *
 * GİZLİLİK: token DEĞERİ loglanmaz; yalnız başarısızlık KATEGORİSİ yazılır.
 */
async function saveFcmToken(token: string): Promise<void> {
  const result = await ensureDevicePushTokenRegistered(token, 'android');
  if (result.ok) {
    logInfo('[FCM] Token kaydedildi (cihaz kimliği doğrulandı)');
    return;
  }
  console.warn(`[FCM] Token kaydedilemedi (${result.reason}) — push-to-wake yok`);
}

// ── İzin & kayıt ─────────────────────────────────────────────────────────────

export async function initFcmService(): Promise<() => void> {
  if (!Capacitor.isNativePlatform()) {
    // Browser modda FCM yok — CommandListener normal WS ile çalışır
    return () => {};
  }

  if (_registered) return () => {};
  _registered = true;

  // İzin iste (Play Services yok olan ROM'da bile permission Android-seviyesi → try/catch güvenlik)
  let receive: string;
  try {
    ({ receive } = await PushNotifications.requestPermissions());
  } catch (e) {
    console.warn('[FCM] İzin isteği başarısız:', e);
    _registered = false;
    return () => {};
  }
  if (receive !== 'granted') {
    console.warn('[FCM] Push izni reddedildi');
    _registered = false;
    return () => {};
  }

  // Play Services YOK olan dağıtıcı ROM'unda register() throw edebilir. Yakalanmazsa
  // bu fonksiyon reject eder; useLayoutServices .catch()'siz .then() ile çağırdığından
  // unhandled rejection olurdu. Uzak komut fallback'ini pushService yönetir (§Faz 3).
  try {
    await PushNotifications.register();
  } catch (e) {
    console.warn('[FCM] register başarısız — Play Services yok olabilir:', e);
    _registered = false;
    return () => {};
  }

  // H-4: Startup kuyruk boşaltma — CommandService.java'nın offline çalıştırdığı
  // MCU komutlarının sonuçlarını Supabase'e bildir.
  void drainNativeCommandQueue(async (id, status) => {
    const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL      as string | undefined;
    const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
    if (!SUPABASE_URL || !SUPABASE_ANON) return;
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/vehicle_commands?id=eq.${id}`, {
        method:  'PATCH',
        headers: {
          'Content-Type':  'application/json',
          'apikey':        SUPABASE_ANON,
          'Authorization': `Bearer ${SUPABASE_ANON}`,
          'Prefer':        'return=minimal',
        },
        body: JSON.stringify({ status, finished_at: new Date().toISOString() }),
      });
    } catch { /* fire-and-forget */ }
  });

  // Token alındığında Supabase'e kaydet
  const tokenListener = await PushNotifications.addListener(
    'registration',
    ({ value }) => void saveFcmToken(value),
  );

  // Token hatası
  const errListener = await PushNotifications.addListener(
    'registrationError',
    (err) => console.error('[FCM] Kayıt hatası:', err),
  );

  // Data-only push gelince → CommandListener'ı uyandır
  const pushListener = await PushNotifications.addListener(
    'pushNotificationReceived',
    (notification) => {
      const data = notification.data as Record<string, string> | undefined;
      const event = data?.event ?? '';

      if (event === 'new_command' || event === 'command_pending') {
        logInfo('[FCM] Push-to-Wake tetiklendi:', event);
        wakeCommandListener();
      }
    },
  );

  // Background push tap (foreground için pushNotificationReceived yeterli)
  const actionListener = await PushNotifications.addListener(
    'pushNotificationActionPerformed',
    (action) => {
      const data = action.notification.data as Record<string, string> | undefined;
      if (data?.event === 'new_command') wakeCommandListener();
    },
  );

  return () => {
    tokenListener.remove();
    errListener.remove();
    pushListener.remove();
    actionListener.remove();
    if (_wakeTimer) { clearTimeout(_wakeTimer); _wakeTimer = null; }
    _registered = false;
  };
}
