/**
 * Capacitor plugin interface for CarLauncher native bridge.
 * Android implementation: CarLauncherPlugin.java
 */
import { registerPlugin } from '@capacitor/core';

export interface LaunchAppOptions {
  packageName?: string; // startActivity by package
  action?: string;      // startActivity by intent action
  data?: string;        // optional URI / data for the intent
}

export interface NativeDeviceStatus {
  btConnected: boolean;
  btDevice: string;      // connected BT device name (empty if none)
  wifiConnected: boolean;
  wifiName: string;      // SSID (requires ACCESS_FINE_LOCATION on API 26+)
  battery: number;       // 0–100
  charging: boolean;     // true when plugged in
}

export interface CarLauncherPlugin {
  launchApp(options: LaunchAppOptions): Promise<void>;
  getDeviceStatus(): Promise<NativeDeviceStatus>;
}

// Plugin is resolved by Capacitor on native; undefined on web (bridge handles fallback)
export const CarLauncher = registerPlugin<CarLauncherPlugin>('CarLauncher');
