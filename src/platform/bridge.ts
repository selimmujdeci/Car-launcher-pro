import { Capacitor } from '@capacitor/core';
import { useExpertStore } from '../store/useExpertStore';
import { NAV_OPTIONS, MUSIC_OPTIONS } from '../data/apps';
import type { AppItem, NavOptionKey, MusicOptionKey } from '../data/apps';
import { CarLauncher } from './nativePlugin';
import { logError } from './crashLogger';
import { showToast } from './errorBus';
import { getPhonePackage, getPlatformInfo, PHONE_FALLBACK_PACKAGES } from './headUnitPlatform';
import { openInApp } from './inAppBrowser';

/**
 * Tel: intent'e göndermeden önce numarayı temizler.
 *
 * Head unit BT stack'leri (FYT/Microntek/KSW) ham '+905321112233' formatını bekler.
 * '+90 532 111 22 33' veya '(0532) 111-22 33' gibi formatlar bazı platformlarda
 * intent data parse hatasına yol açar.
 *
 * USSD kodları (*123#, ##002#) dokunulmadan bırakılır.
 */
function sanitizePhoneNumber(raw: string): string {
  const trimmed = raw.trim();
  if (/^[*#]/.test(trimmed)) return trimmed;
  return trimmed.replace(/[\s\-().]/g, '');
}

/* ── Mode ─────────────────────────────────────────────────── */

/**
 * 'web'     — browser / local dev server (demoBridge)
 * 'android' — running inside Capacitor on device (nativeBridge)
 */
export type LauncherMode = 'web' | 'android';

/* ── Bridge interface ─────────────────────────────────────── */

export interface CarBridge {
  readonly isNative: boolean;
  launchApp(app: AppItem): void;
  launchNavigation(key: NavOptionKey): void;
  launchMusic(key: MusicOptionKey): void;
  /** Launch music app and search for a query. Spotify: spotify:search URI; YT Music: VIEW URL */
  launchMusicSearch(key: MusicOptionKey, query: string): void;
  /**
   * Launch any music app using a package + search URI.
   * pkg: Android package name ('com.spotify.music', …); '' → use ACTION_MEDIA_PLAY_FROM_SEARCH
   * searchUri: ready-to-launch URI; '' → just open the app
   * fallbackKey: MusicOptionKey used if pkg fails
   */
  launchMusicQuery(pkg: string, searchUri: string, fallbackKey: string): void;
  launchSystemSettings(): void;
  launchBluetoothSettings(): void;
  launchHotspotSettings(): void;
  /** Open native dialer with number pre-filled. Falls back to tel: link on web. */
  callNumber(number: string): void;
  /**
   * Araç kapı kilidi — VehicleCommandQueue üzerinden CAN bus komutu gönderir.
   * L2 ACK onaylanınca resolve olur; timeout/hata durumunda 'rejected'/'failed' döner.
   * Her iki taraf (web/native) vehicleCommandQueue.enqueue() kullanır; demo modda
   * 60 ms simüle round-trip ile aynı sözleşmeyi uygular.
   */
  hwLockDoors(): Promise<CommandResult>;
  /** Araç kapı kilidi açma — hwLockDoors ile aynı kuyruk sözleşmesi. */
  hwUnlockDoors(): Promise<CommandResult>;
}

/* ── Demo implementation (web / local dev) ───────────────── */

function _open(url: string) {
  if (url) openInApp(url);
}

const demoBridge: CarBridge = {
  isNative: false,
  launchApp(app)             { _open(app.url); },
  launchNavigation(key)      { const opt = NAV_OPTIONS[key]; if (!opt) return; _open(opt.url); },
  launchMusic(key)           { const opt = MUSIC_OPTIONS[key]; if (!opt) return; _open(opt.url); },
  launchMusicSearch(key, query) {
    const url = key === 'spotify'
      ? `https://open.spotify.com/search/${encodeURIComponent(query)}`
      : `https://music.youtube.com/search?q=${encodeURIComponent(query)}`;
    _open(url);
  },
  launchMusicQuery(_pkg, searchUri, fallbackKey) {
    if (searchUri) { _open(searchUri); return; }
    const opt = MUSIC_OPTIONS[fallbackKey as MusicOptionKey];
    if (opt) _open(opt.url);
  },
  launchSystemSettings()     { /* no browser equivalent */ },
  launchBluetoothSettings()  { /* no browser equivalent */ },
  launchHotspotSettings()    { /* no browser equivalent */ },
  callNumber(number)         { _open(`tel:${sanitizePhoneNumber(number)}`); },
  hwLockDoors()              { return vehicleCommandQueue.enqueue('LOCK_DOORS'); },
  hwUnlockDoors()            { return vehicleCommandQueue.enqueue('UNLOCK_DOORS'); },
};

/* ── Native implementation (Android / Capacitor) ─────────── */

// Pass all available fields — plugin chains: package → action → category → url → Play Store
function _nativeLaunch(packageName?: string, action?: string, data?: string, category?: string): void {
  CarLauncher.launchApp({ packageName, action, data, category }).catch((e: unknown) => {
    logError('Bridge:Launch', e);
    showToast({
      type:     'error',
      title:    'Uygulama açılamadı',
      message:  'Uygulama yüklü olmayabilir veya açılma izni yok.',
      duration: 4000,
    });
  });
}

const nativeBridge: CarBridge = {
  isNative: true,

  launchApp(app) {
    const data = app.url || undefined;

    // Telefon uygulaması: platform tespitine göre doğru BT paketi kullan
    // Head unit'lerde ACTION_DIAL çalışmaz — com.syu.bt / com.microntek.bluetooth gerekir
    if (app.id === 'phone' && !app.androidPackage) {
      const phonePkg = getPhonePackage()                      // tespit edildiyse
        ?? PHONE_FALLBACK_PACKAGES[0];                        // yoksa FYT varsayılan
      _nativeLaunch(phonePkg, app.androidAction, data, app.androidCategory);
      return;
    }

    if (app.androidPackage || app.androidAction || app.androidCategory) {
      _nativeLaunch(app.androidPackage, app.androidAction, data, app.androidCategory);
    } else if (app.url) {
      _nativeLaunch(undefined, 'android.intent.action.VIEW', app.url);
    }
  },

  launchNavigation(key) {
    const opt = NAV_OPTIONS[key];
    if (!opt) return;
    const action = 'androidAction' in opt ? (opt as { androidAction?: string }).androidAction : undefined;
    _nativeLaunch(opt.androidPackage, action, opt.url, opt.androidCategory);
  },

  launchMusic(key) {
    const opt = MUSIC_OPTIONS[key];
    if (!opt) return;
    const action = 'androidAction' in opt ? (opt as { androidAction?: string }).androidAction : undefined;
    _nativeLaunch(opt.androidPackage, action, opt.url, opt.androidCategory);
  },

  launchMusicSearch(key, query) {
    if (key === 'spotify') {
      _nativeLaunch('com.spotify.music', 'android.intent.action.VIEW', `spotify:search:${query}`);
    } else {
      _nativeLaunch(
        'com.google.android.apps.youtube.music',
        'android.intent.action.VIEW',
        `https://music.youtube.com/search?q=${encodeURIComponent(query)}`,
      );
    }
  },

  launchMusicQuery(pkg, searchUri, fallbackKey) {
    if (searchUri && pkg) {
      // Search URI ile paketi başlat
      _nativeLaunch(pkg, 'android.intent.action.VIEW', searchUri);
    } else if (pkg) {
      // Sadece uygulamayı aç (Poweramp gibi — search desteklenmiyor)
      _nativeLaunch(pkg);
    } else if (searchUri) {
      // Pkg yok — VIEW ile genel aç
      _nativeLaunch(undefined, 'android.intent.action.VIEW', searchUri);
    } else {
      // Son çare: varsayılan müzik kaynağını aç
      const opt = MUSIC_OPTIONS[fallbackKey as MusicOptionKey];
      if (opt) _nativeLaunch(opt.androidPackage, undefined, opt.url, opt.androidCategory);
    }
  },

  launchSystemSettings() {
    _nativeLaunch(undefined, 'android.settings.SETTINGS');
  },

  launchBluetoothSettings() {
    _nativeLaunch(undefined, 'android.settings.BLUETOOTH_SETTINGS');
  },

  launchHotspotSettings() {
    // Bluetooth Ayarları: tüm Android versiyonlarında (API 5+) garantili çalışır.
    // Kullanıcı eşleşmiş telefona tıklar → "İnternet erişimi" toggle → açık.
    _nativeLaunch(undefined, 'android.settings.BLUETOOTH_SETTINGS');
  },

  callNumber(number) {
    const sanitized = sanitizePhoneNumber(number);
    const telUri    = `tel:${sanitized}`;

    // Platform tespiti: head unit'lerde ACTION_DIAL çalışmaz.
    // Android telephony stack yoktur (modem yok) → hiçbir activity DIAL'ı handle etmez.
    // Çözüm: platform BT paketi varsa direkt oraya yönlendir, CarLauncher.callNumber'ı atla.
    const platformInfo = getPlatformInfo();
    const isHeadUnit   = platformInfo !== null && platformInfo.platform !== 'stock';

    if (isHeadUnit) {
      // Head unit yolu: BT uygulamasını direkt başlat
      // FYT (com.syu.bt), Microntek (com.microntek.bluetooth), KSW (com.kswcar.bluetooth)
      // hepsi ACTION_DIAL + tel: URI'yi kendi package context'inde handle eder.
      const phonePkg = platformInfo!.phone ?? PHONE_FALLBACK_PACKAGES[0];
      _nativeLaunch(phonePkg, 'android.intent.action.DIAL', telUri);
      return;
    }

    // Standart Android: Java ACTION_DIAL → catch → BT fallback zinciri
    CarLauncher.callNumber({ number: sanitized }).catch((e: unknown) => {
      logError('Bridge:CallNumber', e);
      const phonePkg = getPhonePackage() ?? PHONE_FALLBACK_PACKAGES[0];
      _nativeLaunch(phonePkg, 'android.intent.action.DIAL', telUri);
    });
  },
  hwLockDoors()   { return vehicleCommandQueue.enqueue('LOCK_DOORS'); },
  hwUnlockDoors() { return vehicleCommandQueue.enqueue('UNLOCK_DOORS'); },
};

/* ── Active bridge — auto-detected at runtime ─────────────── */
/*
 * Capacitor.isNativePlatform() → true on Android device, false in browser.
 * No manual flag-flipping needed; works automatically in both environments.
 */
export const bridge: CarBridge =
  Capacitor.isNativePlatform() ? nativeBridge : demoBridge;

export const launcherMode: LauncherMode = bridge.isNative ? 'android' : 'web';
export const isNative = bridge.isNative;
export const isDemo   = !bridge.isNative;

export { nativeBridge, demoBridge };

/* ═══════════════════════════════════════════════════════════════════════════
 * VehicleCommandQueue — FIFO Command-Ack mimarisi
 *
 * Akış: enqueue() → FIFO sıra → _executeNative() → 500 ms ACK penceresi
 *       → completed | rejected | failed → caller Supabase durumunu günceller
 *
 * TASARIM KARARLARI:
 *   • Promise her zaman resolve edilir (reject değil) — UI try/catch yerine
 *     CommandResult.status kontrolü yapar.
 *   • Kapı kilidi için ayrı atomic flag (_lockPending): LOCK/UNLOCK çakışmasını
 *     önler, diğer komutlar (HORN, FLASH) kuyrukta paralel bekleyebilir.
 *   • Web/demo modda 60 ms simüle gecikme → gerçek cihaz davranışını taklit eder.
 * ══════════════════════════════════════════════════════════════════════════ */

const COMMAND_TIMEOUT_MS = 500;

export type VehicleCommandType =
  | 'LOCK_DOORS'
  | 'UNLOCK_DOORS'
  | 'HONK_HORN'
  | 'FLASH_LIGHTS'
  | 'ALARM_ON'
  | 'ALARM_OFF';

export interface CommandResult {
  commandId: string;
  type:      VehicleCommandType;
  /** completed = ACK alındı; rejected = timeout/race; failed = native hata */
  status:    'completed' | 'rejected' | 'failed';
  error?:    string;
}

interface QueuedCommand {
  commandId:  string;
  type:       VehicleCommandType;
  resolve:    (result: CommandResult) => void;
  enqueuedAt: number; // performance.now() — debug/telemetry
}

function _cmdId(): string {
  return `cmd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

class VehicleCommandQueue {
  private readonly _queue: QueuedCommand[] = [];
  private _executing  = false;
  /** Kapı kilidi atomic flag — LOCK/UNLOCK aynı anda kuyrukta olmamalı. */
  private _lockPending = false;

  /**
   * Komutu kuyruğa ekle; sonuç için Promise döner.
   * commandId: Supabase komut UUID'si — sağlanmazsa otomatik üretilir.
   */
  enqueue(type: VehicleCommandType, commandId?: string): Promise<CommandResult> {
    const id = commandId ?? _cmdId();

    try {
      useExpertStore.getState().assertWritesAllowed();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return Promise.resolve({
        commandId: id,
        type,
        status:    'rejected',
        error:     msg,
      });
    }

    // Atomic gate: bir kapı kilidi işlemi tamamlanmadan yenisi reddedilir
    if ((type === 'LOCK_DOORS' || type === 'UNLOCK_DOORS') && this._lockPending) {
      return Promise.resolve({
        commandId: id,
        type,
        status:    'rejected',
        error:     'Lock operation already in progress',
      });
    }
    if (type === 'LOCK_DOORS' || type === 'UNLOCK_DOORS') {
      this._lockPending = true;
    }

    return new Promise(resolve => {
      this._queue.push({ commandId: id, type, resolve, enqueuedAt: performance.now() });
      this._processNext();
    });
  }

  /** Kuyruk derinliği (yürütülen dahil) — izleme için. */
  get size(): number {
    return this._queue.length + (this._executing ? 1 : 0);
  }

  private _processNext(): void {
    if (this._executing || this._queue.length === 0) return;

    const cmd = this._queue.shift()!;
    this._executing = true;
    let settled = false;

    const finish = (result: CommandResult): void => {
      if (settled) return;
      settled = true;
      this._executing = false;
      if (cmd.type === 'LOCK_DOORS' || cmd.type === 'UNLOCK_DOORS') {
        this._lockPending = false;
      }
      cmd.resolve(result);
      this._processNext(); // sıradaki komutu tetikle
    };

    // 500 ms ACK penceresi — araçtan yanıt gelmezse REJECTED
    const timer = setTimeout(() => {
      finish({
        commandId: cmd.commandId,
        type:      cmd.type,
        status:    'rejected',
        error:     'Hardware ACK timeout (500 ms)',
      });
    }, COMMAND_TIMEOUT_MS);

    this._executeNative(cmd.type)
      .then(() => {
        clearTimeout(timer);
        finish({ commandId: cmd.commandId, type: cmd.type, status: 'completed' });
      })
      .catch((err: unknown) => {
        clearTimeout(timer);
        finish({
          commandId: cmd.commandId,
          type:      cmd.type,
          status:    'failed',
          error:     err instanceof Error ? err.message : String(err),
        });
      });
  }

  private _executeNative(type: VehicleCommandType): Promise<void> {
    // Web/demo modu: 60 ms donanım round-trip simülasyonu
    if (!Capacitor.isNativePlatform()) {
      return new Promise(res => setTimeout(res, 60));
    }
    switch (type) {
      case 'LOCK_DOORS':   return CarLauncher.lockDoors();
      case 'UNLOCK_DOORS': return CarLauncher.unlockDoors();
      case 'HONK_HORN':    return CarLauncher.honkHorn();
      case 'FLASH_LIGHTS': return CarLauncher.flashLights();
      case 'ALARM_ON':     return CarLauncher.triggerAlarm();
      case 'ALARM_OFF':    return CarLauncher.stopAlarm();
    }
  }
}

/** Uygulama geneli singleton — tüm araç komutları bu kuyruktan geçer. */
export const vehicleCommandQueue = new VehicleCommandQueue();
