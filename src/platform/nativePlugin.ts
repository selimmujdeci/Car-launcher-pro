/**
 * Capacitor plugin interface for CarLauncher native bridge.
 * Android implementation: CarLauncherPlugin.java
 */
import { registerPlugin } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';

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
  preferOffline: boolean; // EXTRA_PREFER_OFFLINE
  language?: string;      // BCP-47, e.g. 'tr-TR'
  maxResults?: number;
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

/* ── Plugin interface ────────────────────────────────────── */

export interface CarLauncherPlugin {
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

  // On-device speech recognition (EXTRA_PREFER_OFFLINE)
  startSpeechRecognition(options: SpeechRecognitionOptions): Promise<SpeechRecognitionResult>;

  // OBD-II Bluetooth Serial
  scanOBD(): Promise<OBDScanResult>;
  connectOBD(options: OBDConnectOptions): Promise<void>;
  disconnectOBD(): Promise<void>;

  // Android contacts (READ_CONTACTS permission required)
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
}

// Plugin is resolved by Capacitor on native; undefined on web (bridge handles fallback)
export const CarLauncher = registerPlugin<CarLauncherPlugin>('CarLauncher');
