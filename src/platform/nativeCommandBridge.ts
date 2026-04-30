/**
 * nativeCommandBridge.ts — H-4 Native Command Service Köprüsü
 *
 * Bu modül üç görevi üstlenir:
 *   1. MCU Komut Dispatch: commandListener.ts'deki TODO'yu doldurur.
 *      bridge.ts üzerinden CarLauncherPlugin'in MCU metodlarını çağırır.
 *
 *   2. Native Kuyruk Okuma: CommandService.java (FCM) WebView yokken
 *      komut aldığında SharedPreferences'a yazar. WebView açılınca bu
 *      modül kuyruğu boşaltır ve komutları commandListener'a iletir.
 *
 *   3. Anahtar Senkronizasyonu: commandCrypto.ts'in safeStorage'a yazdığı
 *      E2E JWK private key'ini Android EncryptedSharedPreferences'a aktarır.
 *      Bu sayede CommandService.java (FCM) WebView yokken E2E komutları
 *      NativeCryptoManager üzerinden çözebilir.
 *
 * Güvenlik:
 *   - MCU dispatch: hız > 5 km/h ise lock/unlock reddedilir (commandListener garantisi)
 *   - Whitelist: sadece CarLauncherPlugin'de tanımlı 6 komut (Java McuCommandFactory)
 *   - Kuyruk TTL: MAX_QUEUE_AGE_MS üzeri girdiler atılır
 *   - JWK: düz metin olarak loglanmaz; yalnızca EncryptedSharedPreferences'a yazılır
 */

import { useState, useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { CarLauncher } from './nativePlugin';
import { safeGetRaw } from '../utils/safeStorage';
import type { CommandType } from './commandListener';

// ── Sabitler ─────────────────────────────────────────────────────────────────

/** CommandService.java'daki MAX_QUEUE_SIZE ile uyumlu */
const MAX_QUEUE_AGE_MS = 5 * 60_000; // 5 dakika — commandListener TTL ile aynı

// ── MCU Komut Dispatch ───────────────────────────────────────────────────────

/**
 * Komut tipini native MCU komutuna çevirir.
 * CarLauncherPlugin.java metodlarını doğrudan çağırır.
 *
 * @returns 'completed' | 'failed'
 */
export async function executeMcuCommand(
  type: CommandType,
): Promise<'completed' | 'failed'> {
  if (!Capacitor.isNativePlatform()) {
    // Web/dev modda MCU yok — simüle et
    console.log(`[NativeCmdBridge] Web modu — MCU simüle: ${type}`);
    return 'completed';
  }

  try {
    switch (type) {
      case 'lock':      await CarLauncher.lockDoors();    break;
      case 'unlock':    await CarLauncher.unlockDoors();  break;
      case 'horn':      await CarLauncher.honkHorn();     break;
      case 'lights_on': await CarLauncher.flashLights();  break;
      case 'alarm_on':  await CarLauncher.triggerAlarm(); break;
      case 'alarm_off': await CarLauncher.stopAlarm();    break;
      default:
        console.warn(`[NativeCmdBridge] MCU desteklemez: ${type}`);
        return 'failed';
    }
    console.log(`[NativeCmdBridge] MCU OK: ${type}`);
    return 'completed';
  } catch (err) {
    console.error(`[NativeCmdBridge] MCU hatası (${type}):`, err);
    return 'failed';
  }
}

// ── Native Kuyruk — CommandService.java çıktısı ───────────────────────────────

export interface QueuedNativeCommand {
  id:         string;
  type:       string;
  vehicle_id: string;
  ts:         number;   // System.currentTimeMillis()
}

export interface NativeCommandResult {
  id:     string;
  type:   string;
  status: 'completed' | 'failed';
  ts:     number;
}

/**
 * CommandService.java'nın WebView yokken yazdığı komut kuyruğunu okur.
 * Sadece native platformda geçerlidir; web modda boş dizi döner.
 */
export async function getQueuedNativeCommands(): Promise<QueuedNativeCommand[]> {
  if (!Capacitor.isNativePlatform()) return [];

  try {
    const result = await (CarLauncher as unknown as {
      getQueuedNativeCommands(): Promise<{ commands: string }>;
    }).getQueuedNativeCommands();

    const raw = JSON.parse(result.commands ?? '[]') as QueuedNativeCommand[];

    // TTL filtresi — 5 dakikadan eski girdileri at
    const now = Date.now();
    return raw.filter((c) => now - c.ts < MAX_QUEUE_AGE_MS);
  } catch {
    return [];
  }
}

/**
 * CommandService.java'nın kuyruğunu ve sonuç listesini temizler.
 */
export async function clearNativeCommandQueue(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await (CarLauncher as unknown as {
      clearNativeCommandQueue(): Promise<void>;
    }).clearNativeCommandQueue();
  } catch { /* non-critical */ }
}

/**
 * CommandService.java'nın MCU çalıştırıp yazdığı sonuçları okur.
 * Bu sonuçlar Supabase'e status güncellemesi göndermek için kullanılır.
 */
export async function getNativeCommandResults(): Promise<NativeCommandResult[]> {
  if (!Capacitor.isNativePlatform()) return [];
  try {
    const result = await (CarLauncher as unknown as {
      getNativeCommandResults(): Promise<{ results: string }>;
    }).getNativeCommandResults();
    return JSON.parse(result.results ?? '[]') as NativeCommandResult[];
  } catch {
    return [];
  }
}

// ── Startup Kuyruk Boşaltma ───────────────────────────────────────────────────

/**
 * Uygulama açılınca çağrılır.
 * CommandService.java'nın offline çalıştırdığı komutların status'larını
 * Supabase'e güncellemek için sonuçları JS katmanına teslim eder.
 *
 * @param onResult — (commandId, status) → Supabase PATCH gönderme fonksiyonu
 */
export async function drainNativeCommandQueue(
  onResult: (id: string, status: 'completed' | 'failed') => Promise<void>,
): Promise<void> {
  const results = await getNativeCommandResults();
  if (results.length === 0) return;

  console.log(`[NativeCmdBridge] ${results.length} native sonuç boşaltılıyor`);

  for (const r of results) {
    // TTL kontrolü (5 dakika)
    if (Date.now() - r.ts > MAX_QUEUE_AGE_MS) continue;
    try {
      await onResult(r.id, r.status);
    } catch (e) {
      console.warn(`[NativeCmdBridge] Sonuç bildirimi başarısız (${r.id}):`, e);
    }
  }

  await clearNativeCommandQueue();
  console.log('[NativeCmdBridge] Native kuyruk temizlendi');
}

// ── E2E Anahtar Senkronizasyonu ───────────────────────────────────────────────

const E2E_PRIVATE_KEY_STORAGE_KEY = 'car-e2e-private-key'; // commandCrypto.ts ile aynı

/**
 * commandCrypto.ts'in safeStorage'a yazdığı ECDH P-256 private key JWK'ını
 * Android EncryptedSharedPreferences'a kopyalar.
 *
 * Bu, CommandService.java'nın WebView yokken FCM üzerinden gelen E2E şifreli
 * komutları NativeCryptoManager aracılığıyla çözebilmesi için gereklidir.
 *
 * Güvenlik: JWK değeri hiçbir zaman console'a basılmaz; yalnızca Keystore
 * tarafından şifrelenen EncryptedSharedPreferences'a yazılır.
 *
 * Çağrı zamanı: loadOrCreateDeviceKey() tamamlandıktan hemen sonra.
 */
export async function syncKeysToNative(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  try {
    const jwkJson = safeGetRaw(E2E_PRIVATE_KEY_STORAGE_KEY);
    if (!jwkJson) {
      console.warn('[NativeCmdBridge] syncKeysToNative: JWK henüz oluşturulmamış');
      return;
    }

    // secureStoreSet: EncryptedSharedPreferences → CarLauncherSecureStore
    // NativeCryptoManager.java "car-e2e-private-key" key'ini bu alias'tan okur
    await (CarLauncher as unknown as {
      secureStoreSet(opts: { key: string; value: string }): Promise<void>;
    }).secureStoreSet({ key: E2E_PRIVATE_KEY_STORAGE_KEY, value: jwkJson });

    console.log('[NativeCmdBridge] E2E JWK native katmana senkronize edildi');
  } catch (err) {
    // Non-fatal: native E2E çözümü devre dışı kalır, JS tarafı devralır
    console.warn('[NativeCmdBridge] syncKeysToNative başarısız:', err);
  }
}

// ── Servis Durum Hook ─────────────────────────────────────────────────────────

export interface NativeServiceStatus {
  /** FCM (CommandService) OS tarafından kayıtlı mı */
  running:          boolean;
  /** CarLauncherForegroundService aktif mi */
  fgServiceRunning: boolean;
}

const STATUS_POLL_INTERVAL_MS = 30_000; // 30s — CPU bütçesi < %0.1

/**
 * CommandService (FCM) ve CarLauncherForegroundService çalışma durumunu
 * periyodik olarak sorgulayan React hook'u.
 *
 * Web modda sabit { running: false, fgServiceRunning: false } döner.
 * Native'de 30 saniyede bir CarLauncherPlugin.getCommandServiceStatus() çağırır.
 */
export function useNativeServiceStatus(): NativeServiceStatus {
  const [status, setStatus] = useState<NativeServiceStatus>({
    running:          false,
    fgServiceRunning: false,
  });
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let cancelled = false;

    const poll = async () => {
      try {
        const res = await (CarLauncher as unknown as {
          getCommandServiceStatus(): Promise<NativeServiceStatus>;
        }).getCommandServiceStatus();
        if (!cancelled) setStatus(res);
      } catch {
        /* servis durumu non-critical — sessizce atla */
      }
    };

    void poll();
    timerRef.current = setInterval(() => { void poll(); }, STATUS_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  return status;
}
