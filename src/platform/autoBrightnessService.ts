/**
 * Auto Brightness Service — Gün doğumu/batımına göre otomatik parlaklık.
 *
 * Özellikler:
 *   - GPS koordinatından astronomik güneş zamanlarını hesaplar
 *   - Gün içi parlaklık eğrisi: gün doğumu → zirve → gün batımı → gece
 *   - Tema otomasyonu: gün batımında OLED, gün doğumunda dark'a geçer
 *   - OBD far sensörüyle entegre çalışır (headlightAutoBrightness ile çakışmaz)
 *   - Her dakika güncellenir, yeni GPS gelince güneş zamanlarını yeniden hesaplar
 *
 * Güneş zamanı algoritması:
 *   NOAA Solar Calculator formülünün basitleştirilmiş uyarlaması.
 *   ±5 dk doğruluk — araç kullanımı için yeterli.
 */

import { useState, useEffect } from 'react';
import { setBrightness } from './systemSettingsService';
import { onOBDData } from './obdService';

/* ── Tipler ──────────────────────────────────────────────── */

export type DayPhase =
  | 'night'          // gece karanlığı
  | 'dawn'           // şafak (gün doğumu öncesi 30 dk)
  | 'morning'        // sabah (gün doğumu → öğlen)
  | 'afternoon'      // öğleden sonra (öğlen → akşam)
  | 'dusk'           // alacakaranlık (gün batımı öncesi 30 dk)
  | 'evening';       // akşam

export interface SunTimes {
  sunrise:  number;  // günlük dakika (0-1440)
  sunset:   number;
  solar_noon: number;
}

export interface AutoBrightnessState {
  enabled:       boolean;
  autoTheme:     boolean;          // gün/gece temasını da yönet
  phase:         DayPhase;
  sunTimes:      SunTimes | null;
  currentBrightness: number;       // 0-100
  minNight:      number;           // gece min parlaklık (varsayılan 15)
  maxDay:        number;           // gün max parlaklık (varsayılan 100)
  overridden:    boolean;          // kullanıcı manüel ayarladı mı?
}

/* ── Güneş hesaplaması ────────────────────────────────────── */

/** Günün kaçıncı günü (1-366) */
function dayOfYear(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 0);
  const diff  = date.getTime() - start.getTime();
  return Math.floor(diff / 86_400_000);
}

/**
 * NOAA benzeri basit güneş zamanı hesabı.
 * Dönen değer: dakika cinsinden günlük süre (UTC + local offset dahil).
 */
export function calcSunTimes(lat: number, lng: number, date: Date): SunTimes {
  const n   = dayOfYear(date);
  const rad = Math.PI / 180;

  // Güneşin ortalama anomalisi (derece)
  const g   = 357.529 + 0.98560028 * n;
  // Güneşin ekliptik boylamı (derece)
  const q   = 280.459 + 0.98564736 * n;
  const L   = q + 1.915 * Math.sin(g * rad) + 0.020 * Math.sin(2 * g * rad);

  // Güneşin deklinasyonu (derece)
  const e       = 23.439 - 0.0000004 * n;
  const sinDec  = Math.sin(e * rad) * Math.sin(L * rad);
  const dec     = Math.asin(sinDec) / rad;

  // Saat açısı — deniz ufku (-0.83°)
  const cosH = (Math.cos(90.833 * rad) - sinDec * Math.sin(lat * rad))
             / (Math.cos(dec * rad) * Math.cos(lat * rad));

  // Kutup gecesi/gündüzü kontrolü
  const hasCycle = Math.abs(cosH) <= 1;

  // Güneş öğleni (dakika, yerel)
  const eot        = 0.0000075 + 0.001868 * Math.cos(g * rad)
                   - 0.032077 * Math.sin(g * rad)
                   - 0.014615 * Math.cos(2 * g * rad)
                   - 0.04089  * Math.sin(2 * g * rad);
  const solar_noon = 720 - 4 * lng - eot * 229.18 + date.getTimezoneOffset() * -1;

  if (!hasCycle) {
    const isAlwaysDay = sinDec > 0 === lat > 0;
    return {
      sunrise:    isAlwaysDay ? 0   : 720,
      sunset:     isAlwaysDay ? 1440 : 720,
      solar_noon,
    };
  }

  const H        = Math.acos(cosH) / rad;
  const sunrise  = solar_noon - 4 * H;
  const sunset   = solar_noon + 4 * H;

  return {
    sunrise:   Math.round(sunrise),
    sunset:    Math.round(sunset),
    solar_noon: Math.round(solar_noon),
  };
}

/** Şu anki dakika (0-1440) */
function nowMinutes(): number {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

export function calcPhase(times: SunTimes, min: number): DayPhase {
  const { sunrise, sunset, solar_noon } = times;
  const DAWN_OFFSET = 30;
  const DUSK_OFFSET = 30;

  if (min < sunrise - DAWN_OFFSET || min > sunset + DUSK_OFFSET) return 'night';
  if (min < sunrise) return 'dawn';
  if (min < solar_noon) return 'morning';
  if (min < sunset - DUSK_OFFSET) return 'afternoon';
  if (min < sunset) return 'dusk';
  return 'evening';
}

/** Parlaklık eğrisi: sabahtan akşama düzgün geçiş */
export function calcBrightness(
  times: SunTimes,
  min: number,
  minNight: number,
  maxDay: number,
): number {
  const { sunrise, sunset, solar_noon } = times;
  if (min <= sunrise || min >= sunset) return minNight;

  // Gün doğumu → öğlen: linear artış
  if (min <= solar_noon) {
    const t = (min - sunrise) / (solar_noon - sunrise);
    return Math.round(minNight + t * (maxDay - minNight));
  }
  // Öğlen → gün batımı: linear azalış
  const t = (min - solar_noon) / (sunset - solar_noon);
  return Math.round(maxDay - t * (maxDay - minNight));
}

/* ── Modül durumu ────────────────────────────────────────── */

const INITIAL: AutoBrightnessState = {
  enabled:            false,
  autoTheme:          false,
  phase:              'morning',
  sunTimes:           null,
  currentBrightness:  100,
  minNight:           15,
  maxDay:             100,
  overridden:         false,
};

let _state: AutoBrightnessState = { ...INITIAL };
const _listeners = new Set<(s: AutoBrightnessState) => void>();

function push(partial: Partial<AutoBrightnessState>): void {
  _state = { ..._state, ...partial };
  _listeners.forEach((fn) => fn(_state));
}

let _tickerId:        ReturnType<typeof setInterval> | null = null;
let _onThemeChange:   ((theme: 'dark' | 'oled') => void) | null = null;
let _obdUnsubscribe:  (() => void) | null = null;
let _prevHeadlights:  boolean | null = null;
/** Tünel modunda mı? OBD far sinyaline göre gündüz içi tünel geçişlerini tespit eder. */
let _tunnelMode = false;

// ── RAF Reflow Optimizasyonu ──────────────────────────────────────────────
//
// Tema geçişleri (oled↔dark) ve sunlight-mode CSS sınıfı değişimleri DOM
// üzerinde layout hesaplamaları tetikler. Bunlar requestAnimationFrame içine
// alınarak render döngüsüyle senkronize edilir — harita (MapLibre WebGL) ve
// araç göstergesi (Mali-400 GPU) donmaz.
//
// sunlight-mode CSS sınıfı: documentElement'e eklenir.
//   .sunlight-mode * { backdrop-filter: none !important }  (index.css)
//   Bu kural tüm blur efektlerini tek frame'de sıfırlar — GPU yükü anlık olarak düşer.

let _rafId:             number | null = null;
let _sunlightModeActive = false;

/** Bekleyen RAF'ı iptal edip yeni bir RAF kuyruğa ekle (Zero-Leak) */
function _queueRAF(fn: () => void): void {
  if (_rafId !== null) { cancelAnimationFrame(_rafId); _rafId = null; }
  _rafId = requestAnimationFrame(() => {
    _rafId = null;
    fn();
  });
}

/**
 * document.documentElement'e sunlight-mode class'ını ekler/kaldırır.
 * RAF içinden çağrılır — doğrudan render döngüsünde tek reflow.
 * GPU backdrop-filter yükü: sıfır (index.css .sunlight-mode * { backdrop-filter: none })
 */
function _setSunlightModeClass(active: boolean): void {
  if (active === _sunlightModeActive) return; // değişmedi — reflow tetikleme
  _sunlightModeActive = active;
  const root = document.documentElement;
  if (active) {
    root.classList.add('sunlight-mode');
    // CSS custom property: bileşenler bu değişkeni okuyarak blur'u kendi devre dışı bırakabilir
    root.style.setProperty('--cockpit-backdrop-filter', 'none');
  } else {
    root.classList.remove('sunlight-mode');
    root.style.removeProperty('--cockpit-backdrop-filter');
  }
}

function applyBrightness(): void {
  try {
    if (!_state.enabled || _state.overridden) return;
    if (!_state.sunTimes) return;

    const min        = nowMinutes();
    const phase      = calcPhase(_state.sunTimes, min);
    const bright     = calcBrightness(_state.sunTimes, min, _state.minNight, _state.maxDay);
    const isNight    = phase === 'night' || phase === 'evening' || phase === 'dusk';
    const isSunlight = phase === 'morning' || phase === 'afternoon';

    // ── DOM değişikliklerini RAF içinde toplu uygula ─────────────────────
    // React setTheme çağrısı + classList değişimi tek frame'de → sıfır ara reflow
    const themeTarget   = isNight ? 'oled' : 'dark';
    const themeCallback = _state.autoTheme ? _onThemeChange : null;
    _queueRAF(() => {
      if (themeCallback) {
        try { themeCallback(themeTarget); } catch { /* callback failure must not stop brightness */ }
      }
      _setSunlightModeClass(isSunlight);
    });

    setBrightness(bright);
    push({ phase, currentBrightness: bright });
  } catch { /* Never let a brightness tick crash the interval */ }
}

/* ── Tünel tespiti ───────────────────────────────────────── */

/**
 * OBD far sinyali değiştiğinde çağrılır.
 *
 * Gündüz farlar açılırsa → tünel geçişi tahmin edilir:
 *   - Ekran parlaklığı anında gece minimumuna düşürülür (göz kamaşması engeli)
 *   - autoTheme aktifse OLED temaya geçilir
 *
 * Tünel çıkışında (farlar kapanır) → gündüz parlaklık eğrisi yeniden hesaplanır.
 *
 * Gerçek gece (phase === 'night') için harekete geçilmez — sadece gündüz tünelleri.
 */
export function notifyHeadlightChange(headlightsOn: boolean): void {
  if (!_state.enabled || !_state.sunTimes) return;

  const min   = nowMinutes();
  const phase = calcPhase(_state.sunTimes, min);
  const isDaytime = phase === 'morning' || phase === 'afternoon';

  if (headlightsOn && isDaytime && !_tunnelMode) {
    // Tünel girişi — anında karart
    _tunnelMode = true;
    const tunnelBright = Math.min(100, Math.round(_state.minNight * 1.2));
    setBrightness(tunnelBright);
    push({ currentBrightness: tunnelBright });
    // Tema + sunlight-mode değişimi RAF içinde — tünel girişinde harita donması önlenir
    const themeCallback = _state.autoTheme ? _onThemeChange : null;
    _queueRAF(() => {
      if (themeCallback) {
        try { themeCallback('oled'); } catch { /* callback hatası parlaklığı durdurmaz */ }
      }
      _setSunlightModeClass(false); // tünel içinde sunlight-mode yok
    });
  } else if (!headlightsOn && _tunnelMode) {
    // Tünel çıkışı — gündüz parlaklık eğrisini geri yükle
    _tunnelMode = false;
    applyBrightness();
  }
}

/* ── Public API ──────────────────────────────────────────── */

export function startAutoBrightness(opts: {
  lat: number;
  lng: number;
  onThemeChange?: (theme: 'dark' | 'oled') => void;
}): void {
  _onThemeChange = opts.onThemeChange ?? null;
  _tunnelMode    = false;
  _prevHeadlights = null;

  const sunTimes = calcSunTimes(opts.lat, opts.lng, new Date());
  push({ enabled: true, sunTimes, overridden: false });
  applyBrightness();

  if (_tickerId) clearInterval(_tickerId);
  _tickerId = setInterval(applyBrightness, 60_000);

  // OBD far sinyalini dinle — tünel geçişleri için
  if (!_obdUnsubscribe) {
    _obdUnsubscribe = onOBDData((d) => {
      if (d.headlights !== _prevHeadlights) {
        _prevHeadlights = d.headlights;
        notifyHeadlightChange(d.headlights);
      }
    });
  }
}

export function stopAutoBrightness(): void {
  if (_tickerId)  { clearInterval(_tickerId); _tickerId = null; }
  if (_obdUnsubscribe) { _obdUnsubscribe(); _obdUnsubscribe = null; }
  // Zero-Leak: bekleyen RAF'ı iptal et + sunlight-mode CSS'i temizle
  if (_rafId !== null) { cancelAnimationFrame(_rafId); _rafId = null; }
  _setSunlightModeClass(false);
  _prevHeadlights = null;
  _tunnelMode     = false;
  if (_state.enabled) {
    // Stale brightness filter'ı temizle — aksi halde ekran karanlık kalır
    setBrightness(100);
  }
  push({ enabled: false });
}

export function updateAutoBrightnessLocation(lat: number, lng: number): void {
  if (_state.enabled) {
    const sunTimes = calcSunTimes(lat, lng, new Date());
    push({ sunTimes });
    applyBrightness();
  }
}

export function setAutoBrightnessLimits(minNight: number, maxDay: number): void {
  push({ minNight, maxDay });
  applyBrightness();
}

export function setAutoTheme(enabled: boolean): void {
  push({ autoTheme: enabled });
}

/** Kullanıcı manüel parlaklık ayarlayınca çağrılır — override flag set et */
export function notifyManualBrightnessChange(): void {
  push({ overridden: true });
}

/** Override'ı temizle — tekrar otomatik yönetime bırak */
export function clearBrightnessOverride(): void {
  push({ overridden: false });
  applyBrightness();
}

export function getAutoBrightnessState(): AutoBrightnessState { return _state; }

/* ── React hook ──────────────────────────────────────────── */

export function useAutoBrightnessState(): AutoBrightnessState {
  const [state, setState] = useState<AutoBrightnessState>(_state);
  useEffect(() => {
    setState(_state);
    _listeners.add(setState);
    return () => { _listeners.delete(setState); };
  }, []);
  return state;
}
