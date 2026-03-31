import { Capacitor } from '@capacitor/core';
import { NAV_OPTIONS, MUSIC_OPTIONS } from '../data/apps';
import type { AppItem, NavOptionKey, MusicOptionKey } from '../data/apps';
import { CarLauncher } from './nativePlugin';
import { logError } from './crashLogger';
import { showToast } from './errorBus';
import { openInApp } from './inAppBrowser';

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
  /** Open native dialer with number pre-filled. Falls back to tel: link on web. */
  callNumber(number: string): void;
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
  launchSystemSettings()     { /* no browser equivalent */ },
  launchBluetoothSettings()  { /* no browser equivalent */ },
  callNumber(number)         { _open(`tel:${number}`); },
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
    // Supply package, action and category — plugin decides fallback order
    const data = app.url || undefined;
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

  launchSystemSettings() {
    _nativeLaunch(undefined, 'android.settings.SETTINGS');
  },

  launchBluetoothSettings() {
    _nativeLaunch(undefined, 'android.settings.BLUETOOTH_SETTINGS');
  },

  callNumber(number) {
    CarLauncher.callNumber({ number }).catch((e: unknown) => {
      logError('Bridge:CallNumber', e);
      // Fallback: open tel: via intent
      _nativeLaunch(undefined, 'android.intent.action.DIAL', `tel:${number}`);
    });
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
