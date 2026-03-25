import { Capacitor } from '@capacitor/core';
import { NAV_OPTIONS, MUSIC_OPTIONS } from '../data/apps';
import type { AppItem, NavOptionKey, MusicOptionKey } from '../data/apps';
import { CarLauncher } from './nativePlugin';

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
  launchSystemSettings(): void;
  launchBluetoothSettings(): void;
}

/* ── Demo implementation (web / local dev) ───────────────── */

function _open(url: string) {
  if (url) window.open(url, '_blank');
}

const demoBridge: CarBridge = {
  isNative: false,
  launchApp(app)             { _open(app.url); },
  launchNavigation(key)      { _open(NAV_OPTIONS[key].url); },
  launchMusic(key)           { _open(MUSIC_OPTIONS[key].url); },
  launchSystemSettings()     { /* no browser equivalent */ },
  launchBluetoothSettings()  { /* no browser equivalent */ },
};

/* ── Native implementation (Android / Capacitor) ─────────── */

// Pass all available fields — plugin chains: package → action → category → url → Play Store
function _nativeLaunch(packageName?: string, action?: string, data?: string, category?: string): void {
  CarLauncher.launchApp({ packageName, action, data, category }).catch((e) => {
    if (import.meta.env.DEV) console.warn('[CarLauncher] launchApp failed:', e);
  });
}

const nativeBridge: CarBridge = {
  isNative: true,

  launchApp(app) {
    // Supply package, action and category — plugin decides fallback order
    const data = app.url || undefined;
    if (app.androidPackage || app.androidAction || app.androidCategory) {
      _nativeLaunch(app.androidPackage, app.androidAction, data, app.androidCategory);
    } else if (app.url) {
      _nativeLaunch(undefined, 'android.intent.action.VIEW', app.url);
    }
  },

  launchNavigation(key) {
    const opt = NAV_OPTIONS[key] as any;
    _nativeLaunch(opt.androidPackage, opt.androidAction, opt.url, opt.androidCategory);
  },

  launchMusic(key) {
    const opt = MUSIC_OPTIONS[key] as any;
    _nativeLaunch(opt.androidPackage, opt.androidAction, opt.url, opt.androidCategory);
  },

  launchSystemSettings() {
    _nativeLaunch(undefined, 'android.settings.SETTINGS');
  },

  launchBluetoothSettings() {
    _nativeLaunch(undefined, 'android.settings.BLUETOOTH_SETTINGS');
  },
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
