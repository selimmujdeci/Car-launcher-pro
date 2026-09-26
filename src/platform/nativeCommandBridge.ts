/**
 * nativeCommandBridge.ts — H-4 Native Command Service Köprüsü
 *
 * Bu modül kanonik `commandListener` yolunun native yüzüdür:
 *   1. MCU Komut Dispatch: commandListener kararını verdikten SONRA
 *      CarLauncherPlugin'in MCU metodlarını çağırır (icra kararı burada değil).
 *   2. Cross-channel nonce: JS ve native aynı replay store'unu paylaşır.
 *   3. Cihaz sürümü ve OTA indirme/kurulum köprüleri.
 *
 * MRI F-02: native komut kuyruğu okuma ve E2E anahtar senkronizasyonu
 * kaldırıldı — ikinci (native) fiziksel yürütücü kalktığı için üreticileri yok.
 *
 * Güvenlik:
 *   - MCU dispatch: hız > 5 km/h ise lock/unlock reddedilir (commandListener garantisi)
 *   - Whitelist: sadece CarLauncherPlugin'de tanımlı 6 komut (Java McuCommandFactory)
 *   - Native sonuç "gönderildi" yüklemi TEK yerde: nativePlugin.isNativeCommandSent
 */

import { useState, useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { CarLauncher, isNativeCommandSent } from './nativePlugin';
import type { NativeVehicleCommandResult } from './nativePlugin';
import type {
  AppVersionInfo,
  OtaDownloadOptions,
  OtaDownloadResult,
  OtaDownloadProgressEvent,
  OtaInstallResult,
} from './nativePlugin';
import type { CommandType } from './commandListener';
import { logInfo } from './debug';

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
    logInfo(`[NativeCmdBridge] Web modu — MCU simüle: ${type}`);
    return 'completed';
  }

  try {
    /* ⚠️ FAIL-CLOSED: native sonucu OKUNUR. Daha önce çağrı yalnız `await`
     * ediliyor ve promise çözüldüğü an 'completed' dönülüyordu → MCU bağlı
     * değilken uzaktaki kullanıcıya komut "tamamlandı" olarak raporlanıyordu.
     * Doğruluk yüklemi `nativePlugin.isNativeCommandSent` ile TEK yerdedir (bu yol ve
     * `vehicleCommandQueue` aynı gerçeği kullanır — paralel kural yok). */
    let native: NativeVehicleCommandResult;
    switch (type) {
      case 'lock':      native = await CarLauncher.lockDoors();    break;
      case 'unlock':    native = await CarLauncher.unlockDoors();  break;
      case 'horn':      native = await CarLauncher.honkHorn();     break;
      case 'lights_on': native = await CarLauncher.flashLights();  break;
      case 'alarm_on':  native = await CarLauncher.triggerAlarm(); break;
      case 'alarm_off': native = await CarLauncher.stopAlarm();    break;
      default:
        console.warn(`[NativeCmdBridge] MCU desteklemez: ${type}`);
        return 'failed';
    }
    if (!isNativeCommandSent(native)) {
      // Neden kodu loglanır; "gönderildi" İDDİA EDİLMEZ.
      console.warn(`[NativeCmdBridge] MCU'ya GÖNDERİLEMEDİ (${type}): ${native?.reason ?? 'malformed_native_result'}`);
      return 'failed';
    }
    logInfo(`[NativeCmdBridge] MCU OK: ${type}`);
    return 'completed';
  } catch (err) {
    console.error(`[NativeCmdBridge] MCU hatası (${type}):`, err);
    return 'failed';
  }
}

// ── Cross-channel Nonce Tüketimi (replay koruması) ────────────────────────────

/**
 * Cross-channel replay fix: JS ve Native ayrı nonce depoları tutuyordu
 * (commandCrypto `car-nonce-store-v1` ↔ NativeCryptoManager `native_e2e_nonces`).
 * Bu fonksiyon JS yolunu da Native'in TEK store'una bağlar: JS bir nonce'u
 * işlerken native store'da atomik check-and-mark yapılır. Native uyku yolu
 * (CommandService.java → NativeCryptoManager) zaten aynı store'u kullandığından
 * artık hangi kanal önce işlerse diğeri replay görür.
 *
 * Web/dev'de native yoktur → undefined döner (commandCrypto local store'a düşer).
 *
 * @returns true → nonce daha önce kullanılmış (replay, REDDET);
 *          false → taze (native store'a işaretlendi);
 *          undefined → native yok / köprü hatası (local store otoritedir).
 */
export async function checkCrossChannelNonceReplay(
  nonce: string,
): Promise<boolean | undefined> {
  if (!Capacitor.isNativePlatform()) return undefined;
  try {
    const res = await (CarLauncher as unknown as {
      checkCommandNonce: (o: { nonce: string }) => Promise<{ replay: boolean }>;
    }).checkCommandNonce({ nonce });
    return res?.replay === true;
  } catch (err) {
    // Köprü hatası: güvenli taraf — local store yine de kontrol eder.
    console.warn('[NativeCmdBridge] checkCommandNonce köprü hatası:', err);
    return undefined;
  }
}

// ── Uygulama Sürümü (OTA v1 / Commit 1 — device version truth) ────────────────

/** Sürüm oturum boyunca değişmez — tek native çağrı, sonrası cache. */
let _appVersionCache: AppVersionInfo | undefined;

/**
 * Cihazda KURULU gerçek uygulama sürümü (PackageManager üzerinden).
 * Web/dev'de veya köprü hatasında undefined döner — çağıran build-time
 * enjekte edilen VITE_APP_VERSION'a düşer (vite.config.ts define,
 * kaynak: version.properties).
 */
export async function getAppVersionInfo(): Promise<AppVersionInfo | undefined> {
  if (!Capacitor.isNativePlatform()) return undefined;
  if (_appVersionCache) return _appVersionCache;
  try {
    const info = await CarLauncher.getAppVersionInfo();
    if (info && typeof info.versionName === 'string' && info.versionName.length > 0) {
      _appVersionCache = info;
      return info;
    }
    return undefined;
  } catch (err) {
    console.warn('[NativeCmdBridge] getAppVersionInfo köprü hatası:', err);
    return undefined;
  }
}

// ── OTA APK İndirme (OTA v1 / Commit 4) ──────────────────────────────────────

/**
 * İndirme girdilerini doğrular — native'deki kontrollerin JS aynası
 * (defense-in-depth + cihazsız test edilebilirlik). Hata varsa mesaj,
 * geçerliyse null döner.
 */
export function validateOtaDownloadInput(opts: OtaDownloadOptions): string | null {
  if (!opts.url || !opts.url.startsWith('https://')) {
    return 'url https:// olmalı';
  }
  if (!/^[0-9a-fA-F]{64}$/.test(opts.expectedSha256 ?? '')) {
    return 'expectedSha256 64-hex olmalı';
  }
  if (!Number.isFinite(opts.expectedSize) || opts.expectedSize <= 0) {
    return 'expectedSize > 0 olmalı';
  }
  const name = opts.fileName ?? '';
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) || name.includes('..')) {
    return `Geçersiz fileName (path traversal/ayraç reddi): ${name}`;
  }
  return null;
}

/**
 * OTA APK'sını native tarafta indirir ve doğrular (OtaDownloadManager.java).
 * - Web/dev → fail-soft { ok:false, ERR_NO_NATIVE } (asla throw etmez)
 * - Progress: onProgress callback'i otaDownloadProgress eventlerini alır;
 *   listener her durumda (başarı/hata) kaldırılır (Zero-Leak §1).
 * - KURULUM YOK — yalnız indirme + hash doğrulama (Commit 5 ayrı).
 */
export async function downloadOtaApk(
  opts: OtaDownloadOptions,
  onProgress?: (ev: OtaDownloadProgressEvent) => void,
): Promise<OtaDownloadResult> {
  const inputError = validateOtaDownloadInput(opts);
  if (inputError) {
    return { ok: false, errorCode: 'ERR_INPUT', errorMessage: inputError };
  }
  if (!Capacitor.isNativePlatform()) {
    return { ok: false, errorCode: 'ERR_NO_NATIVE', errorMessage: 'OTA indirme yalnız cihazda' };
  }

  let listener: { remove: () => Promise<void> } | undefined;
  try {
    if (onProgress) {
      listener = await CarLauncher.addListener('otaDownloadProgress', onProgress);
    }
    return await CarLauncher.downloadOtaApk(opts);
  } catch (err) {
    console.warn('[NativeCmdBridge] downloadOtaApk köprü hatası:', err);
    return {
      ok: false,
      errorCode: 'ERR_BRIDGE',
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  } finally {
    await listener?.remove().catch(() => { /* listener zaten düşmüş olabilir */ });
  }
}

// ── OTA Kurulum Kapısı (OTA v1 / Commit 5) ───────────────────────────────────

/** İndirme ile aynı fileName kuralı — kurulum yalnız files/ota içinden. */
const SAFE_OTA_FILENAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Hash-doğrulanmış OTA APK'sı için native kurulum kapısını çağırır
 * (OtaInstallManager.java: konum/paket/sürüm/imza ön-kontrol + izin
 * yönlendirme + sistem kurulum diyaloğu — SESSİZ KURULUM YOK).
 * - Web/dev → fail-soft { ok:false, ERR_NO_NATIVE }
 * - action: 'settings_opened' dönerse kullanıcı izni verdikten sonra
 *   yeniden çağrılmalı (Commit 6 orkestrasyonu).
 */
export async function installOtaApk(fileName: string): Promise<OtaInstallResult> {
  if (!SAFE_OTA_FILENAME_RE.test(fileName ?? '') || (fileName ?? '').includes('..')) {
    return {
      ok: false, errorCode: 'ERR_INPUT',
      errorMessage: `Geçersiz fileName (path traversal/ayraç reddi): ${fileName}`,
    };
  }
  if (!Capacitor.isNativePlatform()) {
    return { ok: false, errorCode: 'ERR_NO_NATIVE', errorMessage: 'OTA kurulum yalnız cihazda' };
  }
  try {
    return await CarLauncher.installOtaApk({ fileName });
  } catch (err) {
    console.warn('[NativeCmdBridge] installOtaApk köprü hatası:', err);
    return {
      ok: false,
      errorCode: 'ERR_BRIDGE',
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}

/* ── Native Komut Kuyruğu / Sonuç Drenajı — MRI F-02'de KALDIRILDI ──────────
 *
 * `getQueuedNativeCommands` · `getNativeCommandResults` ·
 * `clearNativeCommandQueue` · `drainNativeCommandQueue` yalnız
 * CommandService.java'nın native fiziksel yürütücüsünün SharedPreferences
 * çıktısını okuyordu. O yürütücü kaldırıldı → kuyruğun ÜRETİCİSİ kalmadı.
 *
 * `drainNativeCommandQueue`ın tek tüketicisi (`fcmService`) sonuçları anon
 * apikey ile `PATCH /rest/v1/vehicle_commands` yapıyordu: bu, cihaz kimliği
 * doğrulamayan İKİNCİ bir komut-durumu otoritesiydi. Kanonik tek kapı
 * `commandListener` → `update_command_status` RPC'sidir (api_key kimlikli).
 *
 * `syncKeysToNative` da kaldırıldı: E2E private key'i native
 * EncryptedSharedPreferences'a yalnız native decrypt yolu için kopyalıyordu ve
 * zaten hiçbir yerden çağrılmıyordu (anahtar yönetimi `sensitiveKeyStore`ta).
 */

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
