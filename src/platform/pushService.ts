/**
 * pushService.ts — FCM Push Token Kaydı ve Push-to-Wake Entegrasyonu (S-2).
 *
 * Akış:
 *   1. App açılınca → izin al → FCM token'ı register_push_token RPC ile Supabase'e kaydet
 *   2. Bildirim gelince → data.command_id veya wake sinyali kontrol et
 *   3. CommandListener aktifse → triggerPendingPoll() (anlık DB sorgusu, Realtime gap koruması)
 *      CommandListener yoksa   → startCommandListener() (tam wake, bağlantı + pending poll)
 *   4. 30 saniyelik idle timer → stopCommandListener() (akü + ağ tasarrufu)
 *
 * Zero-Leak: tüm addListener handle'ları cleanup'ta .remove() edilir.
 * _isWaking flag'i: async start devam ederken çift init'i engeller.
 */

import { Capacitor }         from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { logInfo }           from './debug';
import { sensitiveKeyStore } from './sensitiveKeyStore';
import { getSupabaseClient } from './supabaseClient';
import {
  startCommandListener,
  stopCommandListener,
  isCommandListenerActive,
  triggerPendingPoll,
} from './commandListener';

// ── Sabitler ─────────────────────────────────────────────────────────────────

const WAKE_TIMEOUT_MS = 30_000;  // 30s işlem yoksa CommandListener uyutulur

// ── Modül state ───────────────────────────────────────────────────────────────

let _initialized = false;
let _wakeTimer: ReturnType<typeof setTimeout> | null = null;
let _isWaking   = false;  // async wake devam ederken çift çağrıyı engeller
let _listenerOwned  = false; // kalıcı CommandListener bu servis tarafından açıldı mı

/**
 * Push/GApps durumu — teşhis kartı (DeviceDiagnosticCard) okur.
 *   web         : native değil (tarayıcı) — push yok
 *   active      : FCM token alındı, push-to-wake çalışıyor
 *   unavailable : FCM register başarısız → Play Services YOK olabilir; uzak
 *                 komutlar kalıcı WS fallback ile sürüyor (push-to-wake yerine)
 *   denied      : kullanıcı push iznini reddetti
 *   unpaired    : cihaz eşlenmemiş — uzak komut yok, fallback gereksiz
 */
export type PushStatus = 'web' | 'active' | 'unavailable' | 'denied' | 'unpaired';
let _status: PushStatus = 'web';
export function getPushStatus(): PushStatus { return _status; }

/**
 * Cihaz EŞLİYSE komut dinleyicisini KALICI açar.
 *
 * ── ÖLÇÜLEN KUSUR (#647, 2026-08-19) ────────────────────────────────────────
 * Bu fonksiyon eskiden YALNIZ "FCM kaydı başarısız" dalında çağrılıyordu; yani
 * dinleyicinin ömrü *push'ın çalışmamasına* bağlıydı. Prod ölçümü:
 * `vehicle_push_tokens` tablosunda **0 satır** — hiçbir araç için token YOK.
 * Dolayısıyla push-to-wake HİÇ tetiklenmiyor; FCM kaydı "başarılı" görünen bir
 * cihazda ise fallback de çağrılmıyordu → **dinleyici hiç açılmıyordu**.
 * Komut yazılıyor, kimse dinlemiyordu.
 *
 * Doğru sahiplik: dinleyicinin ömrü CİHAZ EŞLİ Mİ sorusuna bağlıdır, push'ın
 * durumuna değil. Push çalışıyorsa yalnızca HIZLANDIRICIDIR (anlık poll
 * tetikler), tek taşıyıcı değildir.
 *
 * Head unit sürekli beslemeli olduğundan kalıcı bağlantının akü riski düşüktür
 * (§HEAD_UNIT_MATRIX §3.5); yoklama aralığı da 15 sn'dir (hot-path DEĞİL).
 */
async function _ensureCommandListener(): Promise<void> {
  if (_listenerOwned) return;
  const vehicleId = await sensitiveKeyStore.get('veh_vehicle_id');
  if (!vehicleId) { _status = 'unpaired'; return; } // eşli değil → uzak komut yok
  _listenerOwned = true;
  startCommandListener(vehicleId, { permanent: true });
  logInfo('[PushService] Uzak komut dinleyicisi KALICI açıldı (eşleşmiş cihaz)');
}

// ── FCM Token kaydı ───────────────────────────────────────────────────────────

async function _saveFcmToken(token: string): Promise<void> {
  const vehicleId = await sensitiveKeyStore.get('veh_vehicle_id');
  if (!vehicleId) return;

  const supabase = getSupabaseClient();
  if (!supabase) return;

  try {
    await supabase.rpc('register_push_token', {
      p_vehicle_id: vehicleId,
      p_fcm_token:  token,
      p_platform:   Capacitor.getPlatform(),
    });
    logInfo('[PushService] FCM token kaydedildi');
  } catch (err) {
    console.warn('[PushService] Token kayıt hatası:', err);
  }
}

// ── Wake Timer yönetimi ───────────────────────────────────────────────────────

function _resetWakeTimer(): void {
  /* Kalıcı dinleyici bu servise aitse boşta-kapatma sayacı KURULMAZ: onu
     uyandıracak bir push gelmeyeceği için uyutmak = sağır kalmak. */
  if (_listenerOwned) return;
  if (_wakeTimer) clearTimeout(_wakeTimer);
  _wakeTimer = setTimeout(() => {
    _wakeTimer = null;
    stopCommandListener();
    logInfo('[PushService] Wake timeout — CommandListener uyutuldu (30s idle)');
  }, WAKE_TIMEOUT_MS);
}

// ── Wake sinyal işleyicisi ────────────────────────────────────────────────────

async function _onWakeSignal(commandId?: string): Promise<void> {
  _resetWakeTimer(); // Her sinyalde timer sıfırla — komut işlenene kadar uyanık kal

  if (isCommandListenerActive()) {
    // Listener zaten canlı → Realtime channel açık, ama push push anında DB poll yap
    // (Realtime bağlantısında geçici gap olabilir — bu güvence kaplaması)
    triggerPendingPoll();
    if (commandId) logInfo(`[PushService] Pending poll tetiklendi: command_id=${commandId}`);
    return;
  }

  // Listener yoksa → tam wake: bağlan + pending komutları işle
  if (_isWaking) return;  // async start sürerken ikinci çağrıyı engelle
  _isWaking = true;

  try {
    const vehicleId = await sensitiveKeyStore.get('veh_vehicle_id');
    if (!vehicleId) return;
    startCommandListener(vehicleId);
    logInfo(`[PushService] Push-to-Wake: CommandListener başlatıldı${commandId ? ` (command_id=${commandId})` : ''}`);
  } finally {
    _isWaking = false;
  }
}

// ── Push payload ayrıştırıcı ─────────────────────────────────────────────────

function _isWakeData(data: Record<string, string>): boolean {
  return !!(
    data.command_id                        ||  // Belirli komut ID'si
    data.event === 'new_command'           ||  // Yeni komut eklendi
    data.event === 'command_pending'       ||  // Bekleyen komut var
    data.wake  === '1'                        // Genel wake sinyali
  );
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Push bildirim servisini başlatır.
 * App.tsx'de mount sırasında bir kez çağrılır.
 * Dönen fonksiyon unmount cleanup'ında çağrılmalı (listener'ları temizler).
 *
 * Native olmayan platformlarda (web) anında no-op cleanup döner.
 */
export async function initPushService(): Promise<() => void> {
  if (!Capacitor.isNativePlatform()) return () => {};
  if (_initialized)                  return () => {};
  _initialized = true;

  // İzin iste
  let permResult: { receive: string };
  try {
    permResult = await PushNotifications.requestPermissions();
  } catch {
    _initialized = false;
    return () => {};
  }

  if (permResult.receive !== 'granted') {
    console.warn('[PushService] Push bildirimi izni reddedildi');
    _initialized = false;
    _status = 'denied';
    return () => {};
  }

  // Dinleyiciler register'DAN ÖNCE bağlanır — registrationError ASYNC gelir
  // (Play Services yok olan bir ROM'da register() resolve edip sonra hata basabilir).
  // Token alındığında Supabase'e kaydet + push aktif işaretle
  const tokenL = await PushNotifications.addListener(
    'registration',
    ({ value }) => {
      _status = 'active';
      void _saveFcmToken(value);
      /* Push ÇALIŞSA BİLE dinleyici kalıcıdır: push yalnız hızlandırıcıdır
         (#647 — token kaydı sessizce düşerse tek taşıyıcı ölürdü). */
      void _ensureCommandListener();
    },
  );

  // Token hatası — Play Services YOK olabilir. Servisi durdurmaz; uzak komutları
  // kalıcı WS fallback'ine devret (push-to-wake yerine).
  const errL = await PushNotifications.addListener(
    'registrationError',
    (err) => {
      console.error('[PushService] FCM kayıt hatası — Play Services yok olabilir:', err);
      _status = 'unavailable';
      void _ensureCommandListener();
    },
  );

  // Ön plan (foreground) push — en hızlı wake yolu
  const pushL = await PushNotifications.addListener(
    'pushNotificationReceived',
    (notification) => {
      const data = (notification.data ?? {}) as Record<string, string>;
      if (_isWakeData(data)) void _onWakeSignal(data.command_id);
    },
  );

  // Arka plan (background) push tap — kullanıcı bildirime dokundu
  const actionL = await PushNotifications.addListener(
    'pushNotificationActionPerformed',
    (action) => {
      const data = (action.notification.data ?? {}) as Record<string, string>;
      if (_isWakeData(data)) void _onWakeSignal(data.command_id);
    },
  );

  // FCM register — Play Services YOK olan dağıtıcı ROM'unda SENKRON throw edebilir.
  // Yakalanmazsa initPushService reject eder → boot servisi kırılır. Yakala ve
  // uzak komutları kalıcı WS fallback'ine devret (registrationError async yolu da aynı yere gider).
  try {
    await PushNotifications.register();
  } catch (e) {
    console.warn('[PushService] FCM register başarısız — Play Services yok olabilir:', e);
    _status = 'unavailable';
    void _ensureCommandListener();
  }

  /* Kayıt sonucundan BAĞIMSIZ garanti: eşli cihazda dinleyici açık olmalı.
     (registration/registrationError geri çağrıları asenkron gelir; hiçbiri
     gelmezse bile araç sağır kalmaz.) */
  await _ensureCommandListener();

  return () => {
    tokenL.remove();
    errL.remove();
    pushL.remove();
    actionL.remove();
    if (_wakeTimer) { clearTimeout(_wakeTimer); _wakeTimer = null; }
    // Gerçek sökülüş → kalıcı dinleyici de kapatılır (force).
    if (_listenerOwned) { stopCommandListener(true); _listenerOwned = false; }
    _initialized = false;
  };
}
