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
  address: string; // MAC address of the OBD adapter
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
 * A value of -1 means the vehicle does not support that PID.
 */
export interface NativeOBDData {
  speed: number;        // km/h  or -1
  rpm: number;          // RPM   or -1
  engineTemp: number;   // °C    or -1
  fuelLevel: number;    // 0–100 or -1
  headlights?: boolean; // far durumu (opsiyonel — destekleyen araçlarda gelir)
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

/* ── Plugin interface ────────────────────────────────────── */

export interface CarLauncherPlugin {
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

  addListener(
    event: 'obdStatus',
    handler: (data: OBDStatusEvent) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    event: 'obdData',
    handler: (data: NativeOBDData) => void,
  ): Promise<PluginListenerHandle>;
}

// Plugin is resolved by Capacitor on native; undefined on web (bridge handles fallback)
export const CarLauncher = registerPlugin<CarLauncherPlugin>('CarLauncher');
