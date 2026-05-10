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
import { showToast } from './errorBus';

/* ── Platform capability flag ────────────────────────────── */

/**
 * Parlaklık ve ses kontrolünün gerçekten çalışıp çalışmadığını döner.
 * Capacitor native platform'da true, web/PWA'da false.
 * UI bileşenleri bu flag ile işlevsiz kontrollerini gizler.
 */
export function isSystemControlSupported(): boolean {
  return Capacitor.isNativePlatform();
}

/* ── Thermal Brightness Lock ─────────────────────────────── */

/**
 * Termal izin verilen maksimum parlaklık (0–100).
 * null = kısıtlama yok (L0/L1).
 * thermalWatchdog.ts tarafından set/clear edilir — döngüsel import önlenmiş.
 */
let _thermalBrightnessCap: number | null = null;

/**
 * Termal koruma kilidini etkinleştirir.
 * thermalWatchdog L2/L3 girişinde çağırır — SET SONRA değil, applyBrightness'tan ÖNCE.
 */
export function setThermalBrightnessLock(maxPercent: number): void {
  _thermalBrightnessCap = Math.max(0, Math.min(100, maxPercent));
}

/** Termal koruma kilidini kaldırır — L1/L0'a inerken çağırılır. */
export function clearThermalBrightnessLock(): void {
  _thermalBrightnessCap = null;
}

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

/** percent: 0–100  →  native 0–255, with WRITE_SETTINGS permission guard */
async function _applyBrightnessNative(percent: number): Promise<void> {
  try {
    const { granted } = await CarLauncher.checkWriteSettings();
    if (!granted) {
      await CarLauncher.requestWriteSettings();
      return; // User will need to retry after granting
    }
    const value = Math.round((percent / 100) * 255);
    await CarLauncher.setBrightness({ value });
  } catch (e: unknown) {
    logError('systemSettings:setBrightness', e);
  }
}

const _applyBrightnessDebounced = debounce((percent: number) => {
  if (Capacitor.isNativePlatform()) {
    void _applyBrightnessNative(percent);
  }
  // web: sessiz no-op — UI sliders isSystemControlSupported() ile zaten gizlenir
}, 80);

/* ── Manual Override Hysteresis (Far otomasyonu) ─────────── */

/**
 * Far açıkken kullanıcı manuel ayar yaptıktan sonra otomasyonun
 * kaç ms boyunca yeniden kısmaması gerektiği.
 */
const MANUAL_HYSTERESIS_MS = 60_000; // 60 saniye

/** Farlar açıkken son manuel parlaklık değişiminin zamanı (Date.now). */
let _headlightManualOverrideTs = 0;

/**
 * Sistem kaynaklı parlaklık uygulama (far otomasyonu, termal watchdog).
 *   - Termal kapa sessizce clamp eder (toast yok, blok yok).
 *   - Manuel override takibini ATLAR — histerezisi bozmaz.
 *
 * Dışa açılır çünkü thermalWatchdog.ts bu yolu kullanır.
 */
export function setBrightnessAuto(percent: number): void {
  const clamped   = Math.max(0, Math.min(100, percent));
  const effective = _thermalBrightnessCap !== null
    ? Math.min(clamped, _thermalBrightnessCap)
    : clamped;
  _applyBrightnessDebounced(effective);
}

/**
 * Set screen brightness — KULLANICI ÇAĞRISI.
 * @param percent 0–100 (matches store value)
 *
 * Termal Override Guard: _thermalBrightnessCap aktifken cap üstü talepler
 * reddedilir ve toast uyarısı verilir.
 *
 * Headlight Manual Override: farlar açıkken çağrılırsa manuel override
 * kaydedilir; otomasyon bir sonraki headlight-ON döngüsünde MANUAL_HYSTERESIS_MS
 * boyunca yeniden kısmaz ve kaydedilen restorasyon değeri güncellenir.
 */
export function setBrightness(percent: number): void {
  const clamped = Math.max(0, Math.min(100, percent));

  // ── Termal kap kontrolü ─────────────────────────────────────────────────
  if (_thermalBrightnessCap !== null && clamped > _thermalBrightnessCap) {
    showToast({
      type:     'warning',
      title:    'Termal Koruma',
      message:  `Termal koruma aktif, parlaklık kısıtlandı (maks. ${_thermalBrightnessCap}%)`,
      duration: 3000,
    });
    return;
  }

  // ── Headlight Manual Override takibi ───────────────────────────────────
  // Farlar açıkken kullanıcı değiştirirse:
  //   1. Histerezis başlatılır (otomasyon 60s boyunca yeniden kısmaz)
  //   2. Restorasyon değeri güncellenir (far söndüğünde kullanıcının tercihi geri yüklenir)
  if (_lastHeadlightState) {
    _headlightManualOverrideTs = Date.now();
    if (_brightnessBeforeHeadlights !== null) {
      _brightnessBeforeHeadlights = clamped; // kullanıcı tercihi kayıt
    }
  }

  _applyBrightnessDebounced(clamped);
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
  // web: sessiz no-op — UI sliders isSystemControlSupported() ile zaten gizlenir
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
 * Manual Override Hysteresis:
 *   Kullanıcı farlar açıkken parlaklığı manuel değiştirirse, bir sonraki
 *   headlight-ON döngüsünde MANUAL_HYSTERESIS_MS boyunca otomatik kısma yapılmaz.
 *   Restorasyon değeri de kullanıcı tercihine güncellenir.
 *
 * @param getUserBrightness  Şu anki kullanıcı parlaklığını döndüren fonksiyon (0–100)
 */
export function startHeadlightAutoBrightness(getUserBrightness: () => number): void {
  if (_headlightUnsub) return; // zaten çalışıyor

  _headlightUnsub = onOBDData((data) => {
    const headlightsOn = data.headlights;
    if (headlightsOn === _lastHeadlightState) return; // durum değişmedi
    _lastHeadlightState = headlightsOn;

    if (headlightsOn) {
      // Mevcut parlaklığı her zaman kaydet (manual override olsa bile — restorasyon için)
      _brightnessBeforeHeadlights = getUserBrightness();

      // ── Manual Override Hysteresis ───────────────────────────────────────
      // Kullanıcı son MANUAL_HYSTERESIS_MS içinde farlar açıkken değiştirdiyse,
      // bu döngüde otomatik kısma yapma.
      if (Date.now() - _headlightManualOverrideTs < MANUAL_HYSTERESIS_MS) return;

      // Yalnızca parlaklık hedefin üstündeyse kıs (sistem çağrısı → setBrightnessAuto)
      if (_brightnessBeforeHeadlights > HEADLIGHT_DIM_PERCENT) {
        setBrightnessAuto(HEADLIGHT_DIM_PERCENT);
      }
    } else {
      // Far söndü — kullanıcının tercihine geri dön (sistem çağrısı → setBrightnessAuto)
      // _brightnessBeforeHeadlights; setBrightness() tarafından kullanıcı değişiminde güncellenir
      const restore = _brightnessBeforeHeadlights ?? getUserBrightness();
      _brightnessBeforeHeadlights = null;
      setBrightnessAuto(restore);
    }
  });
}

/** Headlight otomasyon aboneliğini durdurur ve histerezis durumunu sıfırlar. */
export function stopHeadlightAutoBrightness(): void {
  _headlightUnsub?.();
  _headlightUnsub           = null;
  _brightnessBeforeHeadlights = null;
  _lastHeadlightState         = null;
  _headlightManualOverrideTs  = 0;
}
