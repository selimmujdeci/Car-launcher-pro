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
    console.log('[PushService] FCM token kaydedildi');
  } catch (err) {
    console.warn('[PushService] Token kayıt hatası:', err);
  }
}

// ── Wake Timer yönetimi ───────────────────────────────────────────────────────

function _resetWakeTimer(): void {
  if (_wakeTimer) clearTimeout(_wakeTimer);
  _wakeTimer = setTimeout(() => {
    _wakeTimer = null;
    stopCommandListener();
    console.log('[PushService] Wake timeout — CommandListener uyutuldu (30s idle)');
  }, WAKE_TIMEOUT_MS);
}

// ── Wake sinyal işleyicisi ────────────────────────────────────────────────────

async function _onWakeSignal(commandId?: string): Promise<void> {
  _resetWakeTimer(); // Her sinyalde timer sıfırla — komut işlenene kadar uyanık kal

  if (isCommandListenerActive()) {
    // Listener zaten canlı → Realtime channel açık, ama push push anında DB poll yap
    // (Realtime bağlantısında geçici gap olabilir — bu güvence kaplaması)
    triggerPendingPoll();
    if (commandId) console.log(`[PushService] Pending poll tetiklendi: command_id=${commandId}`);
    return;
  }

  // Listener yoksa → tam wake: bağlan + pending komutları işle
  if (_isWaking) return;  // async start sürerken ikinci çağrıyı engelle
  _isWaking = true;

  try {
    const vehicleId = await sensitiveKeyStore.get('veh_vehicle_id');
    if (!vehicleId) return;
    startCommandListener(vehicleId);
    console.log(`[PushService] Push-to-Wake: CommandListener başlatıldı${commandId ? ` (command_id=${commandId})` : ''}`);
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
    return () => {};
  }

  await PushNotifications.register();

  // Token alındığında Supabase'e kaydet
  const tokenL = await PushNotifications.addListener(
    'registration',
    ({ value }) => void _saveFcmToken(value),
  );

  // Token hatası — servisi durdurmaz, sadece loglar
  const errL = await PushNotifications.addListener(
    'registrationError',
    (err) => console.error('[PushService] FCM kayıt hatası:', err),
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

  return () => {
    tokenL.remove();
    errL.remove();
    pushL.remove();
    actionL.remove();
    if (_wakeTimer) { clearTimeout(_wakeTimer); _wakeTimer = null; }
    _initialized = false;
  };
}
