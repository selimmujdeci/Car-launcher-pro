/**
 * System Settings Service — Android screen brightness & media volume control.
 *
 * Architecture:
 *  - On native: delegates to CarLauncher plugin (setBrightness / setVolume)
 *  - On web: brightness uses CSS filter on <body>; volume is stored only
 *  - Debounced writes prevent jitter while slider is dragged
 *  - useStore brightness/volume values are 0-100; native maps to 0-255 / 0-15
 */

import { Capacitor } from '@capacitor/core';
import { CarLauncher } from './nativePlugin';
import { onOBDData } from './obdService';
import { logError } from './crashLogger';

/* ── Debounce helper ─────────────────────────────────────── */

function debounce<T extends unknown[]>(
  fn: (...args: T) => void,
  ms: number,
): (...args: T) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (...args: T) => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; fn(...args); }, ms);
  };
}

/* ── Brightness ──────────────────────────────────────────── */

/** percent: 0–100  →  native 0–255 */
function _applyBrightnessNative(percent: number): void {
  const value = Math.round((percent / 100) * 255);
  CarLauncher.setBrightness({ value }).catch((e: unknown) => logError('systemSettings:setBrightness', e));
}

/** Web fallback: apply brightness via CSS filter on the root element */
function _applyBrightnessWeb(percent: number): void {
  const brightness = 0.3 + (percent / 100) * 0.7; // clamp between 0.3–1.0
  document.documentElement.style.filter = percent < 100
    ? `brightness(${brightness.toFixed(2)})`
    : '';
}

const _applyBrightnessDebounced = debounce((percent: number) => {
  if (Capacitor.isNativePlatform()) {
    _applyBrightnessNative(percent);
  } else {
    _applyBrightnessWeb(percent);
  }
}, 80);

/**
 * Set screen brightness.
 * @param percent 0–100 (matches store value)
 */
export function setBrightness(percent: number): void {
  _applyBrightnessDebounced(Math.max(0, Math.min(100, percent)));
}

/* ── Volume ──────────────────────────────────────────────── */

/** percent: 0–100  →  Android stream index 0–15 */
function _applyVolumeNative(percent: number): void {
  const value = Math.round((percent / 100) * 15);
  CarLauncher.setVolume({ value }).catch((e: unknown) => logError('systemSettings:setVolume', e));
}

const _applyVolumeDebounced = debounce((percent: number) => {
  if (Capacitor.isNativePlatform()) {
    _applyVolumeNative(percent);
  }
  // Web: no standard API to set system volume; skip silently
}, 80);

/**
 * Set media volume.
 * @param percent 0–100 (matches store value)
 */
export function setVolume(percent: number): void {
  _applyVolumeDebounced(Math.max(0, Math.min(100, percent)));
}

/* ── Headlight Auto-Brightness ───────────────────────────── */

/**
 * Gece sürüşü için hedef parlaklık (0–100).
 * Far açıldığında kullanıcı parlaklığı bu değerin altındaysa değişmez;
 * üstündeyse bu değere indirilir.
 */
const HEADLIGHT_DIM_PERCENT = 40;

let _headlightUnsub: (() => void) | null = null;
let _brightnessBeforeHeadlights: number | null = null;
let _lastHeadlightState: boolean | null = null;

/**
 * OBD far verisini izlemeye başlar.
 * Far açıldığında parlaklığı kısıltır; kapandığında önceki değere döner.
 *
 * @param getUserBrightness  Şu anki kullanıcı parlaklığını döndüren fonksiyon (0–100)
 */
export function startHeadlightAutoBrightness(getUserBrightness: () => number): void {
  if (_headlightUnsub) return; // zaten çalışıyor

  _headlightUnsub = onOBDData((data) => {
    const headlightsOn = data.headlights;
    if (headlightsOn === _lastHeadlightState) return; // değişme yok
    _lastHeadlightState = headlightsOn;

    if (headlightsOn) {
      // Kullanıcının mevcut parlaklığını kaydet
      _brightnessBeforeHeadlights = getUserBrightness();
      // Yalnızca parlaklık hedefin üstündeyse kıs
      if (_brightnessBeforeHeadlights > HEADLIGHT_DIM_PERCENT) {
        setBrightness(HEADLIGHT_DIM_PERCENT);
      }
    } else {
      // Far söndü — önceki parlaklığa geri dön
      const restore = _brightnessBeforeHeadlights ?? getUserBrightness();
      _brightnessBeforeHeadlights = null;
      setBrightness(restore);
    }
  });
}

/** Headlight otomasyon aboneliğini durdurur. */
export function stopHeadlightAutoBrightness(): void {
  _headlightUnsub?.();
  _headlightUnsub = null;
  _brightnessBeforeHeadlights = null;
  _lastHeadlightState = null;
}
