/**
 * Capacitor plugin interface for CarLauncher native bridge.
 * Android implementation: CarLauncherPlugin.java
 */
import { registerPlugin } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';
import type { VehicleHALData } from './vehicleDataLayer/types';

export interface LaunchAppOptions {
  packageName?: string; // startActivity by package
  action?: string;      // startActivity by intent action
  data?: string;        // optional URI / data for the intent
  category?: string;    // optional standard category (e.g. android.intent.category.APP_MAPS)
}

export interface NativeApp {
  name: string;
  packageName: string;
  className: string;
  isSystemApp: boolean;
  /** Base64 PNG data URI (96×96) — native taraftan gelirse emoji bypass */
  icon?: string;
}

export interface GetAppsResult {
  apps: NativeApp[];
}

export interface NativeDeviceStatus {
  btConnected: boolean;
  btDevice: string;      // connected BT device name (empty if none)
  wifiConnected: boolean;
  wifiName: string;      // SSID (requires ACCESS_FINE_LOCATION on API 26+)
  battery: number;       // 0–100
  charging: boolean;     // true when plugged in
}

/* ── OBD types ───────────────────────────────────────────── */

export interface OBDDevice {
  name: string;    // Bluetooth device display name
  address: string; // MAC address (XX:XX:XX:XX:XX:XX)
}

export interface OBDScanResult {
  devices: OBDDevice[];
}

export interface OBDConnectOptions {
  address: string;    // MAC address of the OBD adapter
  /**
   * SAE J1979 Mode 01 PID listesi — native taraf bu PID'leri ELM327'ye sırayla gönderir.
   * Boş bırakılırsa native kendi varsayılan setini kullanır.
   *
   * EV'de ICE PID'leri dahil etme: 0x0C/0x05/0x2F her biri 200 ms NO-DATA timeout
   * yiyor; 3 PID × 200 ms = 600 ms kayıp / döngü. ISO 15031-5 §6.3.3.
   *
   * Örnekler:
   *   ICE/Diesel: ['0x0D', '0x0C', '0x05', '0x2F', '0x11', '0x0F']
   *   EV:         ['0x0D']   ← sadece hız; batarya OEM-specific komutlarla
   */
  pids?: string[];
  /**
   * ELM327 AT SP (Set Protocol) protokol numarası.
   * '0' = otomatik (ATSP0, varsayılan), '6' = ISO 15765-4 CAN 11-bit/500k.
   * T507 gibi ATSP0'da başarısız olan adaptörler için retry denemesinde '6' zorla.
   */
  protocol?: string;
  /**
   * Bluetooth PIN kodu — cihaz eşleştirilmemiş (BOND_NONE) iken silent pairing için.
   * V-LINK, bazı ELM327 klonları: '0000' veya '1234'.
   */
  pin?: string;
  /**
   * Bağlantı taşıma katmanı.
   * 'classic' = Classic Bluetooth SPP/RFCOMM (varsayılan), 'ble' = Bluetooth Low Energy GATT.
   * Belirtilmezse native taraf mevcut Classic RFCOMM yolunu kullanır (geriye dönük uyumlu).
   */
  transport?: 'classic' | 'ble';
}

/**
 * Fired by the native plugin when connection state changes AFTER initial connect.
 * (Initial connection result is signalled by connectOBD() resolve/reject.)
 */
export interface OBDStatusEvent {
  state: 'disconnected' | 'error';
  message?: string;
}

/**
 * Per-frame OBD data pushed by the native plugin.
 * A value of -1 means the vehicle does not support that PID (unsupported PID).
 *
 * Standard PIDs (SAE J1979 / ISO 15031-5):
 *   0x0C → rpm          0x0D → speed       0x05 → engineTemp
 *   0x2F → fuelLevel    0x0F → intakeTemp  0x11 → throttle
 *   0x10 → maf          0x0B → manifoldPressure
 *
 * EV / Extended (OEM-specific, varies by manufacturer):
 *   batteryLevel, batteryTemp, range, chargingState, chargingPower, motorPower
 *
 * Diesel extra:
 *   boostPressure (manifold/turbo), egt (exhaust gas temperature)
 */
export interface NativeOBDData {
  // ── Universal (OBD-II standard) ──────────────────────────
  speed: number;        // PID 0x0D — km/h   (-1 = not supported)
  rpm: number;          // PID 0x0C — RPM    (-1 = EV / not supported)
  engineTemp: number;   // PID 0x05 — °C     (-1 = EV / not supported)
  fuelLevel: number;    // PID 0x2F — 0–100% (-1 = EV / not supported)
  headlights?: boolean; // Manufacturer-specific — optional
  throttle?: number;    // PID 0x11 — 0–100% (-1 = not supported)
  intakeTemp?: number;  // PID 0x0F — °C     (-1 = not supported)
  maf?: number;         // PID 0x10 — g/s    (-1 = not supported)

  // ── EV / Hybrid ─────────────────────────────────────────
  batteryLevel?: number;      // % SoC (0–100)         (-1 = not supported)
  batteryTemp?: number;       // °C HV battery pack    (-1 = not supported)
  range?: number;             // km remaining           (-1 = not supported)
  chargingState?: 'not_charging' | 'charging' | 'fast_charging' | 'unknown';
  chargingPower?: number;     // kW AC/DC              (-1 = not supported)
  motorPower?: number;        // kW output (can be neg for regen) (-1 = not supported)

  // ── Diesel / Turbo extra ─────────────────────────────────
  boostPressure?: number;     // kPa turbo boost        (-1 = not supported)
  egt?: number;               // °C exhaust gas temp    (-1 = not supported)
}

export interface MediaActionOptions {
  action: 'play' | 'pause' | 'next' | 'previous';
}

export interface SetBrightnessOptions {
  value: number; // 0–255 (Android WindowManager.LayoutParams.screenBrightness)
}

export interface SetVolumeOptions {
  value: number; // 0–15 (Android AudioManager STREAM_MUSIC max index)
}

export interface SpeechRecognitionOptions {
  preferOffline: boolean;     // EXTRA_PREFER_OFFLINE — yalnızca true ise offline'a zorlanır
  /** Offline başarısız olursa online ile bir kez daha denensin mi (varsayılan true).
   *  Head unit'lerde offline TR modeli yok → online fallback şart. Wake word'de false. */
  onlineFallback?: boolean;
  language?: string;          // BCP-47, e.g. 'tr-TR'
  maxResults?: number;
  /** Vosk yazılım kazancı çarpanı — native 1.0–4.0 clamp'ler (varsayılan 2.0).
   *  Tek kaynak: voiceTuning.ts. Verilmezse native varsayılanı (wake word yolu). */
  gain?: number;
  /** Vosk maksimum dinleme penceresi ms — native 5000–20000 clamp'ler (varsayılan 9000).
   *  Sessizlik endpoint'i konuşma bitince daha erken çözer; bu yalnız üst sınır. */
  maxListenMs?: number;
}

export interface SpeechRecognitionResult {
  transcript: string; // top recognition result
}

/* ── Contacts types ──────────────────────────────────────── */

export interface NativeContactPhone {
  number: string;
  type:   'MOBILE' | 'HOME' | 'WORK' | 'OTHER';
}

export interface NativeContact {
  id:     string;
  name:   string;
  phones: NativeContactPhone[];
}

export interface GetContactsResult {
  contacts: NativeContact[];
}

/* ── Passenger control types ─────────────────────────────── */

export interface PassengerServerResult {
  ip:    string;
  port:  number;
  token: string;
}

export interface PassengerStateOptions {
  title:   string;
  artist:  string;
  appName: string;
  playing: boolean;
}

export interface PassengerCommandEvent {
  action: 'play' | 'pause' | 'next' | 'previous';
}

/* ── Media session types ─────────────────────────────────── */

/**
 * Aktif medya oturumu bilgisi — Android MediaSessionManager'dan okunur.
 * Hangi uygulama çalıyorsa (Spotify, YouTube, vb.) bu yapı döner.
 */
export interface NativeMediaInfo {
  packageName: string;  // com.spotify.music, com.google.android.youtube, vb.
  appName:     string;  // kullanıcıya görünen uygulama adı
  title:       string;  // parça / video başlığı
  artist:      string;  // sanatçı / kanal adı
  albumArt?:   string;  // base64 data URI (JPEG)
  playing:     boolean;
  durationMs:  number;  // 0 = bilinmiyor
  positionMs:  number;  // 0 = bilinmiyor
}

/* ── Local music types ───────────────────────────────────── */

/** MediaStore'dan gelen tek şarkı kaydı */
export interface LocalMusicTrack {
  id:          string;
  uri:         string;   // content://media/external/audio/media/<id>
  title:       string;
  artist:      string;
  album:       string;
  albumArtUri: string;   // content://media/external/audio/albumart/<albumId>
  durationMs:  number;
}

export interface GetMusicTracksResult {
  tracks: LocalMusicTrack[];
}

export interface LocalMusicProgressEvent {
  positionMs: number;
  durationMs: number;
  playing:    boolean;
}

/* ── Local video types ───────────────────────────────────── */

/** MediaStore.Video.Media'dan gelen tek video kaydı */
export interface LocalVideoTrack {
  id:         string;
  uri:        string;   // content://media/external/video/media/<id>
  title:      string;
  durationMs: number;
  sizeBytes:  number;
}

export interface GetVideoTracksResult {
  videos: LocalVideoTrack[];
}

/* ── Native Core types ───────────────────────────────────── */

/**
 * Hardware profile returned by getDeviceProfile().
 * Used to auto-detect the correct performance mode on startup.
 */
export interface NativeDeviceProfile {
  androidVersion: string;   // e.g. "9", "12"
  sdkInt:         number;   // e.g. 28, 31
  totalRamMb:     number;   // total physical RAM in MB
  isLowRamDevice: boolean;  // ActivityManager.isLowRamDevice()
  screenWidth:    number;   // pixels
  screenHeight:   number;   // pixels
  densityDpi:     number;
  density:        number;   // e.g. 1.5, 2.0, 3.0
  webViewVersion: string;   // Chrome version string or ""
  /** 'low' | 'mid' | 'high' — mapped from RAM + SDK level */
  deviceClass:    'low' | 'mid' | 'high';
}

/**
 * Real screen dimensions from WindowManager.getRealMetrics().
 * More accurate than JS window.screen on old head-unit WebViews.
 */
export interface NativeScreenMetrics {
  widthPx:    number;
  heightPx:   number;
  densityDpi: number;
  density:    number;
  widthDp:    number;
  heightDp:   number;
}

export interface CallNumberOptions {
  number: string; // Phone number to open in dialer
}

/* ── OBD Bluetooth Auto-Pair types ──────────────────────── */

export type OBDBtState =
  | 'IDLE'
  | 'SCANNING'
  | 'CANDIDATE_FOUND'
  | 'TRY_KNOWN_DEVICE'
  | 'TRY_SILENT_PAIR_PIN_0000'
  | 'TRY_SILENT_PAIR_PIN_1234'
  | 'TRY_SILENT_PAIR_PIN_1111'
  | 'TRY_SILENT_PAIR_PIN_6789'
  | 'WAIT_BOND_RESULT'
  | 'OPEN_SPP_SOCKET'
  | 'ELM_DETECT'
  | 'CONNECTED'
  | 'FALLBACK_USER_ACTION_REQUIRED'
  | 'FAILED';

export interface OBDBtStateEvent {
  state:      OBDBtState;
  deviceName: string | null;
  mac:        string | null;
  info:       string | null;
}

export interface SavedOBDDevice {
  mac:  string;
  name: string;
}

/* ── Plugin interface ────────────────────────────────────── */

/* ── OTA types (Commit 4 — download + verify) ─────────────── */

export interface OtaDownloadOptions {
  /** Tam indirme URL'i (https zorunlu) */
  url: string;
  /** ota_releases.sha256 — 64 hex karakter */
  expectedSha256: string;
  /** ota_releases.apk_size — bayt */
  expectedSize: number;
  /** Hedef dosya adı (yalnız [A-Za-z0-9._-], traversal reddi) */
  fileName: string;
  /** Anon-key auth header'ları (apikey/Authorization) — service_role ASLA */
  headers?: Record<string, string>;
}

export interface OtaDownloadResult {
  ok: boolean;
  /** ok=true: doğrulanmış APK'nın mutlak yolu (files/ota/...) */
  path?: string;
  /** ok=true: hesaplanan SHA-256 (lowercase hex) */
  sha256?: string;
  /** ok=true: indirilen bayt */
  size?: number;
  /** ok=false: ERR_INPUT|ERR_DISK|ERR_HTTP|ERR_SIZE|ERR_HASH|ERR_RENAME|ERR_IO */
  errorCode?: string;
  errorMessage?: string;
}

export interface OtaDownloadProgressEvent {
  downloadedBytes: number;
  totalBytes: number;
  percent: number;
}

export interface OtaInstallResult {
  ok: boolean;
  /** install_prompted: sistem kurulum diyaloğu açıldı ·
   *  settings_opened: bilinmeyen-kaynak izni ayarına yönlendirildi (yeniden dene) */
  action?: 'install_prompted' | 'settings_opened';
  /** ERR_INPUT|ERR_NOT_FOUND|ERR_NO_PERMISSION|ERR_BAD_APK|ERR_PACKAGE|
   *  ERR_DOWNGRADE|ERR_SIGNATURE|ERR_NO_INSTALLER|ERR_IO */
  errorCode?: string;
  errorMessage?: string;
}

export interface AppVersionInfo {
  /** PackageManager longVersionCode — version.properties VERSION_CODE'un kurulu hali */
  versionCode: number;
  /** PackageManager versionName — version.properties VERSION_NAME'in kurulu hali */
  versionName: string;
  packageName: string;
}

export interface CarLauncherPlugin {
  /** OTA v1: cihazda KURULU gerçek sürüm (PackageManager — drift imkânsız) */
  getAppVersionInfo(): Promise<AppVersionInfo>;
  /** OTA v1: streaming APK indirme + SHA-256/boyut doğrulama (kurulum ayrı) */
  downloadOtaApk(options: OtaDownloadOptions): Promise<OtaDownloadResult>;
  /** OTA v1: güvenli kurulum kapısı — paket/sürüm/imza ön-kontrol + sistem diyaloğu */
  installOtaApk(options: { fileName: string }): Promise<OtaInstallResult>;
  addListener(
    event: 'otaDownloadProgress',
    handler: (data: OtaDownloadProgressEvent) => void,
  ): Promise<PluginListenerHandle>;
  /** Native Core: hardware profile for performance-mode detection */
  getDeviceProfile(): Promise<NativeDeviceProfile>;
  /** Native Core: real screen dimensions from WindowManager */
  getScreenMetrics(): Promise<NativeScreenMetrics>;
  /** Native Core: open native dialer with number pre-filled */
  callNumber(options: CallNumberOptions): Promise<void>;

  /** Launcher'ı arka plana al — çift geri basış sonrası çağrılır */
  exitApp(): Promise<void>;
  launchApp(options: LaunchAppOptions): Promise<void>;
  getApps(): Promise<GetAppsResult>;
  getDeviceStatus(): Promise<NativeDeviceStatus>;

  // Media playback control
  sendMediaAction(options: MediaActionOptions): Promise<void>;

  // System hardware controls
  setBrightness(options: SetBrightnessOptions): Promise<void>;
  setVolume(options: SetVolumeOptions): Promise<void>;

  // Sistem ayar panelleri — WiFi/Bluetooth (Android 10+ doğrudan toggle'ı engeller,
  // panel açmak satışa-uygun tek yol). Opsiyonel: eski plugin sürümlerinde bulunmayabilir.
  openWifiSettings?(): Promise<{ opened: boolean }>;
  openBluetoothSettings?(): Promise<{ opened: boolean }>;

  // On-device speech recognition (EXTRA_PREFER_OFFLINE)
  startSpeechRecognition(options: SpeechRecognitionOptions): Promise<SpeechRecognitionResult>;

  // Vosk modelini boot'ta arka planda ısıtır — ilk mikrofon basışı unpack+load
  // maliyetini (zayıf head unit CPU'sunda 20-40 sn) ödemesin. Opsiyonel: eski
  // plugin sürümlerinde bulunmayabilir (çağıran try/catch ile korur).
  preloadVoskModel?(): Promise<{ ready: boolean }>;

  // OBD-II Bluetooth Serial
  scanOBD(): Promise<OBDScanResult>;
  connectOBD(options: OBDConnectOptions): Promise<void>;
  disconnectOBD(): Promise<void>;
  readDTC(): Promise<{ codes: string[] }>;
  clearDTC(): Promise<void>;

  // Uygulama içi OBD cihaz tarama (pair gerektirmeden keşfeder)
  startOBDDiscovery(): Promise<void>;
  stopOBDDiscovery(): Promise<void>;

  // Eşleşmiş (bonded) bir OBD cihazının pairing'ini siler (unpair) — taramada
  // kalan eski/erişilemez "Eşli" kaydı kaldırır; sonraki taramada listelenmez.
  forgetOBDDevice(opts: { address: string }): Promise<{ success: boolean }>;

  // Bir cihazın Android bonding (eşleşme) durumunu sorgular — PIN Resilience için:
  // bağlantı sonrası cihaz bonded ise PIN'e bir daha gerek yoktur (bonding kalıcı).
  // Opsiyonel: eski plugin sürümlerinde bulunmayabilir (obdService try/catch ile çağırır).
  getObdBondState?(opts: { address: string }): Promise<{ bonded: boolean }>;

  // Bluetooth bağlantı değişiklikleri — araç BT sistemine bağlan/bağlantı kes
  addListener(
    event: 'btChanged',
    handler: (data: { connected: boolean; deviceName: string }) => void,
  ): Promise<PluginListenerHandle>;

  addListener(
    event: 'obdDeviceFound',
    handler: (data: {
      name: string;
      address: string;
      bonded: boolean;
      // Opsiyonel — native taraf "classic" (Classic Bluetooth SPP) veya
      // "ble" (Bluetooth Low Energy) gönderir. Eski yol transport olmadan da çalışır.
      transport?: 'classic' | 'ble';
    }) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    event: 'obdDiscoveryFinished',
    handler: (data: { finished: boolean }) => void,
  ): Promise<PluginListenerHandle>;

  // Recovery key store — Android Auto Backup ile yedeklenir, reinstall sonrası geri gelir
  saveRecoveryKey(options: { key: string; value: string }): Promise<void>;
  loadRecoveryKey(options: { key: string }): Promise<{ value: string }>;

  // Native TTS — Android TextToSpeech API (WebView speechSynthesis'den daha güvenilir)
  speak(options: { text: string; rate?: number }): Promise<void>;
  ttsStop(): Promise<void>;

  // Android contacts (READ_CONTACTS permission required)
  requestContactsPermission(): Promise<{ contacts: 'granted' | 'denied' | 'prompt' }>;
  getContacts(): Promise<GetContactsResult>;

  // Background GPS + break reminder foreground service
  startBackgroundService(): Promise<void>;
  stopBackgroundService():  Promise<void>;

  // Special Android system permissions
  checkWriteSettings():     Promise<{ granted: boolean }>;
  requestWriteSettings():   Promise<void>;
  checkNotificationAccess():  Promise<{ granted: boolean }>;
  requestNotificationAccess(): Promise<void>;

  /**
   * Android 12+ BLUETOOTH_CONNECT ve Android 13+ POST_NOTIFICATIONS için
   * runtime izin diyaloğunu tetikler. Uygulama başlangıcında bir kez çağrılır.
   */
  requestAndroid13Permissions(): Promise<{ requested: number }>;

  // Active media session (Android MediaSessionManager)
  getMediaInfo(options?: { preferredPackage?: string }): Promise<NativeMediaInfo>;

  /**
   * URI bazlı kapak resmini base64 data URI olarak çeker.
   * content://, file://, http(s):// destekler. Yerel MediaStore albumart URI'leri için kullanılır.
   * Native tarafta cache'lenir — aynı URI tekrar sorgulanırsa hemen döner.
   */
  getMediaArtDataUri(options: { uri: string }): Promise<{ dataUri: string }>;

  // Yerel müzik — cihaz depolamasından MediaPlayer ile çalma
  getMusicTracks(): Promise<GetMusicTracksResult>;
  playLocalTrack(options: { uri: string }): Promise<void>;
  pauseLocalTrack(): Promise<void>;
  resumeLocalTrack(): Promise<void>;
  stopLocalTrack(): Promise<void>;
  seekLocalTrack(options: { positionMs: number }): Promise<void>;
  getLocalTrackPosition(): Promise<{ positionMs: number; durationMs: number; playing: boolean }>;
  addListener(event: 'localMusicProgress', handler: (data: LocalMusicProgressEvent) => void): Promise<PluginListenerHandle>;
  addListener(event: 'localMusicStarted',  handler: (data: { durationMs: number; playing: boolean }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'localMusicCompleted',handler: (data: Record<string, never>) => void): Promise<PluginListenerHandle>;
  addListener(event: 'localMusicError',    handler: (data: { error: string }) => void): Promise<PluginListenerHandle>;

  // Yerel video — cihaz depolamasından native VideoView overlay ile oynatma
  getVideoTracks(): Promise<GetVideoTracksResult>;
  playVideoNative(options: { uri: string; title?: string }): Promise<void>;
  closeVideoNative(): Promise<void>;
  addListener(event: 'videoStarted',   handler: (data: { durationMs: number }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'videoCompleted', handler: (data: Record<string, never>) => void): Promise<PluginListenerHandle>;
  addListener(event: 'videoError',     handler: (data: { error: string }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'videoClosed',    handler: (data: Record<string, never>) => void): Promise<PluginListenerHandle>;

  // Camera2 API — geri görüş kamerası (CAMERA permission required)
  openCamera(options: { facing: 'back' | 'front' }): Promise<{ cameraId: string }>;
  closeCamera(): Promise<void>;
  captureFrame(): Promise<{ imageData: string }>; // base64 JPEG, data URI prefix yok

  // Dashcam kayıt durumunu foreground servis bildirimine yansıt
  setDashcamActive(options: { active: boolean }): Promise<void>;

  /**
   * PIN güvenliği — Android Keystore + EncryptedSharedPreferences
   *
   * Java implementasyonu (CarLauncherPlugin.java):
   *   setPinHash   → EncryptedSharedPreferences.putString("pin_hash", hash)
   *   verifyPin    → hash(attempt).equals(prefs.getString("pin_hash"))
   *   clearPin     → EncryptedSharedPreferences.remove("pin_hash")
   *
   * Bu metodlar TypeScript'te tanımlıdır; Java tarafı yoksa
   * pinService.ts sessionStorage fallback'ine düşer.
   */
  setPinHash(options: { hash: string }): Promise<void>;
  verifyPin(options: { attempt: string }): Promise<{ match: boolean }>;
  clearPin(): Promise<void>;

  /**
   * Expert Trust mühürü — HMAC-SHA256 anahtarı Android Keystore'da tutulur (ham seed WebView'da yok).
   */
  expertTrustHmacSign?(options: { canonical: string }): Promise<{ sigHex: string }>;
  expertTrustHmacVerify?(options: { canonical: string; sigHex: string }): Promise<{ valid: boolean }>;

  addListener(
    event: 'obdStatus',
    handler: (data: OBDStatusEvent) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    event: 'obdData',
    handler: (data: NativeOBDData) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    event: 'mediaChanged',
    handler: (data: NativeMediaInfo) => void,
  ): Promise<PluginListenerHandle>;

  // Passenger HTTP server — yolcu müzik kontrolü
  startPassengerServer(): Promise<PassengerServerResult>;
  stopPassengerServer(): Promise<void>;
  updatePassengerState(options: PassengerStateOptions): Promise<void>;

  addListener(
    event: 'passengerCommand',
    handler: (data: PassengerCommandEvent) => void,
  ): Promise<PluginListenerHandle>;

  /** Arka planda GPS konum güncellemesi (CarLauncherForegroundService'den) */
  addListener(
    event: 'backgroundLocation',
    handler: (data: {
      lat: number; lng: number;
      speed: number; bearing: number; accuracy: number;
    }) => void,
  ): Promise<PluginListenerHandle>;

  /** Mola hatırlatıcısı — 2 saatlik kesintisiz sürüşte tetiklenir */
  addListener(
    event: 'breakReminder',
    handler: (data: { drivingMinutes: number }) => void,
  ): Promise<PluginListenerHandle>;

  // ── OBD Bluetooth Auto-Pair ──────────────────────────────────────────────
  /**
   * OBD BT otomatik eşleştirme ve bağlantı sürecini başlatır.
   * userConfirmed=true → silent PIN pairing etkin (kullanıcı onayladı).
   * userConfirmed=false → yalnızca bilinen + bonded cihaz denenir.
   */
  startOBDBluetooth?(opts: { userConfirmed: boolean }): Promise<void>;
  stopOBDBluetooth?(): Promise<void>;
  /** FALLBACK_USER_ACTION_REQUIRED durumunda kullanıcı "Bağlan" butonuna bastı. */
  userConnectOBD?(): Promise<void>;
  /** Kayıtlı OBD cihaz bilgisini döner (mac + name). Kayıt yoksa boş obje. */
  getSavedOBDDevice?(): Promise<Partial<SavedOBDDevice>>;
  clearSavedOBD?(): Promise<void>;

  addListener(
    event: 'obdBtState',
    handler: (data: OBDBtStateEvent) => void,
  ): Promise<PluginListenerHandle>;

  startCanBus?(): Promise<void>;
  stopCanBus?(): Promise<void>;
  /** MCU event sniffer — K250/Hiworld keşif modu */
  startMcuSniff?(): Promise<void>;
  stopMcuSniff?(): Promise<void>;
  /**
   * Test protokolü marker — canDiag kanalına "[MARKER] name ts=…" yazar.
   * Fiziksel olay öncesi çağrılır; log korelasyonu için kullanılır.
   */
  insertTestMarker?(opts: { marker: string }): Promise<void>;

  /**
   * ELM327 iCar'ı ATMA (Monitor All) moduna geçirir.
   * OBD bağlı olmalı. Tüm CAN frame'leri canDiag kanalına akar (diff + throttle filtreli).
   * CAN write yapmaz — sadece dinler.
   */
  startRawCanScan?(): Promise<void>;
  stopRawCanScan?(): Promise<void>;
  /** USB serial adaptörler için izin ister (CH340, CP2102, FTDI, CDC ACM) */
  requestUsbCanPermission?(): Promise<{ requested: number }>;

  /** Araç CAN ID yapılandırmasını günceller ve SharedPreferences'a kalıcı yazar. */
  setCanIds?(ids: Partial<CanIdConfig>): Promise<void>;
  /** Mevcut CAN ID yapılandırmasını döner. */
  getCanIds?(): Promise<CanIdConfig>;
  /** CAN sniffer'ı açar/kapatır — aktifken her frame `canRawFrame` olarak emit edilir. */
  setCanSnifferEnabled?(options: { enabled: boolean }): Promise<void>;

  // ── Native Guard Bridge ───────────────────────────────────────────────
  /** WebView yaşıyor sinyali — native taraf 3s heartbeat görmezse WebView crashed kabul eder */
  sendHeartbeat?():                                  Promise<void>;
  /** RuntimeMode değişimini native taraf bildirimine yansıt */
  setNativeMode?(opts: { mode: string }):            Promise<void>;
  /** Odometer km değerini Android SharedPreferences'a atomik yaz */
  persistOdometer?(opts: { km: number }):            Promise<void>;
  /** Son persist edilen odometer değerini oku — crash sonrası kurtarma için */
  getPersistedOdometer?():                           Promise<{ km: number }>;

  // H-4 MCU komutları — CAN bus üzerinden araç kontrolü
  lockDoors():    Promise<void>;
  unlockDoors():  Promise<void>;
  honkHorn():     Promise<void>;
  flashLights():  Promise<void>;
  triggerAlarm(): Promise<void>;
  stopAlarm():    Promise<void>;

  // H-4 Native Command Service — CommandService.java kuyruk okuma
  /** CommandService.java'nın WebView yokken biriktirdiği komut kuyruğunu okur (JSON) */
  getQueuedNativeCommands?(): Promise<{ commands: string }>;
  /** MCU sonuç listesini okur — startup'ta Supabase status sync için */
  getNativeCommandResults?(): Promise<{ results: string }>;
  /** Hem komut kuyruğunu hem sonuç listesini temizler */
  clearNativeCommandQueue?(): Promise<void>;

  /**
   * OBD El Sıkışması — bağlantı ısınma sonrası çağrılır.
   * Native katman iki komut gönderir:
   *   • `09 02` → SAE J1979 Mode 09 PID 02 — VIN (ASCII)
   *   • `01 00` → SAE J1979 Mode 01 PID 00 — Desteklenen PID bitmask
   *
   * @returns raw09   — ELM327 `09 02` ham ASCII yanıtı
   *          raw0100 — ELM327 `01 00` ham ASCII yanıtı
   *
   * Opsiyonel (`?`): eski plugin versiyonlarında graceful degrade için.
   * Eğer çağrı başarısız olursa obdService try/catch ile yakalayıp devam eder.
   */
  performHandshake?(): Promise<{ raw09: string; raw0100: string }>;

  /** CAN bus araç sinyalleri — read-only, native katmandan gelir */
  addListener(
    event: 'canData',
    handler: (data: CanData) => void,
  ): Promise<PluginListenerHandle>;

  /** CAN bus bağlantı durumu — port açıldı/kapandı bilgisi */
  addListener(
    event: 'canStatus',
    handler: (data: CanStatus) => void,
  ): Promise<PluginListenerHandle>;

  /** CAN sniffer — her CAN frame'ini ham olarak iletir (teşhis için) */
  addListener(
    event: 'canRawFrame',
    handler: (data: CanRawFrame) => void,
  ): Promise<PluginListenerHandle>;

  /** K24 ContentProvider tanı mesajları — Bakım ekranında gösterilir */
  addListener(
    event: 'canDiag',
    handler: (data: { msg: string }) => void,
  ): Promise<PluginListenerHandle>;

  /** Android bellek baskısı — system trim callback (CRITICAL / MODERATE) */
  addListener(
    event: 'memoryPressure',
    handler: (data: { level?: string }) => void,
  ): Promise<PluginListenerHandle>;
}

export interface CanData {
  // ── Temel sürüş ──────────────────────────────────────────────────────────
  speed?:            number;    // km/h
  reverse?:          boolean;
  fuel?:             number;    // 0–100 %
  // ── Motor ─────────────────────────────────────────────────────────────────
  rpm?:              number;    // devir/dak
  coolantTemp?:      number;    // soğutucu °C
  oilTemp?:          number;    // motor yağı °C
  throttle?:         number;    // gaz pedalı 0–100 %
  // ── Elektrik ──────────────────────────────────────────────────────────────
  batteryVolt?:      number;    // 12V akü gerilimi (V)
  // ── Vites ─────────────────────────────────────────────────────────────────
  gearPos?:          number;    // -1=R, 0=N/P, 1–8=ileri vitesler
  // ── Çevre ─────────────────────────────────────────────────────────────────
  ambientTemp?:      number;    // dış hava °C
  // ── Kapı / aydınlatma ─────────────────────────────────────────────────────
  doorOpen?:         boolean;
  headlightsOn?:     boolean;
  // ── Şasi güvenliği ────────────────────────────────────────────────────────
  abs?:              boolean;
  tractionControl?:  boolean;
  stabilityControl?: boolean;
  // ── Gövde / konfor ────────────────────────────────────────────────────────
  parkingBrake?:     boolean;
  seatbelt?:         boolean;
  wipers?:           boolean;
  airCondition?:     boolean;
  cruiseControl?:    boolean;
  // ── TPMS ──────────────────────────────────────────────────────────────────
  tpms?:             number[];  // [fl, fr, rl, rr] kPa
}

export interface CanStatus {
  connected: boolean;
  mode:      'uart' | 'usb' | 'bluetooth' | 'none'; // dahili UART, USB serial, BT RFCOMM, bağlı değil
  port:      string;                                 // açık port adı veya cihaz tanımı
}

/** Her CAN sinyalinin ağ üzerindeki ID'si. Araç başına yapılandırılır. */
export interface CanIdConfig {
  // Temel sürüş
  speed:    number;  // Hız       (varsayılan: 0x0C9)
  gear:     number;  // Vites yön (varsayılan: 0x0E8)
  fuel:     number;  // Yakıt     (varsayılan: 0x145)
  // Motor
  rpm:      number;  // Motor devri  (varsayılan: 0x316)
  coolant:  number;  // Soğutucu     (varsayılan: 0x294)
  oilTemp:  number;  // Yağ sıcaklığı(varsayılan: 0x280)
  throttle: number;  // Gaz pedalı   (varsayılan: 0x201)
  // Elektrik
  battVolt: number;  // Akü gerilimi (varsayılan: 0x3A0)
  // Vites pozisyonu
  gearPos:  number;  // Vites konum  (varsayılan: 0x1D0)
  // Çevre
  ambient:  number;  // Dış hava     (varsayılan: 0x350)
  // Kapı / far / TPMS
  doors:    number;  // Kapı bitmask (varsayılan: 0x3B0)
  lights:   number;  // Far bitmask  (varsayılan: 0x1A0)
  tpms:     number;  // TPMS kPa     (varsayılan: 0x385)
  // Şasi bayrakları (ABS/TCS/ESC)
  chassis:  number;  // Şasi bayrak  (varsayılan: 0x0C0)
  // Gövde bayrakları (el freni/kemer/silecek/klima/seyir)
  body:     number;  // Gövde bayrak (varsayılan: 0x3D0)
}

/** CAN sniffer'dan gelen ham frame — teşhis/yapılandırma için */
export interface CanRawFrame {
  id:   number;  // integer CAN ID
  hex:  string;  // örn. "0x1A0"
  data: string;  // hex baytlar, örn. "04 00 FF 00"
}

// Plugin is resolved by Capacitor on native; undefined on web (bridge handles fallback)
export const CarLauncher = registerPlugin<CarLauncherPlugin>('CarLauncher');

/* ══════════════════════════════════════════════════════════════════
   VehicleHAL — AAOS VHAL Capacitor Plugin (READ-ONLY)
   Android impl: com.cockpitos.pro.hal.VehicleHALPlugin
   ══════════════════════════════════════════════════════════════ */

/**
 * `getSignal()` dönüş tipi:
 *   • `connected`  — AAOS bağlı mı; false ise diğer alanlar tanımsızdır.
 *   • `VehicleHALData` alanları canonical (km/h, %) birimlerde olmalıdır;
 *     mevcut Java iskeletinde raw AAOS birimleri (m/s, litre) gelir.
 *     NativeHALAdapter bu dönüşümü yaparak VAL pipeline'ına iletir.
 */
export interface VehicleHALPlugin {
  startHAL(): Promise<{ connected: boolean }>;
  stopHAL():  Promise<void>;
  getSignal(): Promise<VehicleHALData & { connected: boolean; ts?: number }>;
}

export const VehicleHAL = registerPlugin<VehicleHALPlugin>('VehicleHAL');
