/**
 * deviceCapabilities — Cihaz yeteneklerinin TEK OTORİTESİ (single source of truth).
 *
 * NEDEN: Önceden donanım tespiti 4 ayrı yerde, FARKLI eşiklerle kopyalanmıştı
 * (`runtimeConfig` detection, `performanceMode`, `headUnitCompat`, `deviceDetection`).
 * `performanceMode` kendi içinde bile çelişiyordu (loadPerformanceMode cores>6 vs
 * enableAutoMode cores>4). Bu fragmantasyon "bir yerde low, bir yerde mid" tutarsızlığı
 * (ör. blur kasma bug'ı) üretiyordu.
 *
 * ARTIK: donanım BİR KEZ burada problanır, tek kanonik `DeviceTier` üretilir; tüm
 * performans/uyumluluk sistemleri bunun TÜREVİDİR (kendi sniff'lerini yapmazlar).
 *
 * Not: Runtime MODE (AdaptiveRuntimeManager) ayrı bir EKSEN ölçer (threading: Worker+SAB,
 * + dinamik thermal/güç) → o kendi mantığını korur ama zayıf-GPU kararını yine buradaki
 * paylaşılan `hasWeakGpu` ile alır. DeviceTier "ham donanım sınıfı"dır; runtime mode
 * "anlık çalışma profili"dir — kasıtlı olarak ayrı, ama tek tespit kaynağından beslenir.
 */

import { hasWeakGpu } from '../utils/detectWeakGpu';

export type DeviceTier = 'low' | 'mid' | 'high';

export interface DeviceCapabilities {
  /** CPU çekirdek sayısı (bilinmiyorsa 0). */
  cores: number;
  /** Tahmini RAM (MB; bilinmiyorsa 0). deviceMemory deprecated ama bazı WebView'lerde var. */
  memoryMb: number;
  /** WebGL UNMASKED_RENDERER Mali-400 sınıfı / yazılım render mı (backdrop-filter HW yok). */
  weakGpu: boolean;
  /** WebGL bağlamı oluşturulabiliyor mu. */
  supportsWebGL: boolean;
  /** backdrop-filter: blur() destekleniyor mu. */
  supportsBackdropFilter: boolean;
  /** CSS dvh birimi (height: 1dvh) destekleniyor mu. */
  supportsDvh: boolean;
  /** @layer cascade layers (Chrome 99+) — Tailwind v4 için şart. */
  supportsCssLayer: boolean;
  /** Head unit tipi düşük çözünürlük / düşük DPR / ultra-wide ekran. */
  lowEndScreen: boolean;
  /** Worker + (crossOriginIsolated) SharedArrayBuffer birlikte kullanılabiliyor mu. */
  hasWorkerSAB: boolean;
  /** Android sürümü (UA'dan; 0 = bilinmiyor / Android değil). */
  androidVersion: number;
  /** Chromium/WebView ana sürümü (UA'dan; 0 = bilinmiyor). */
  webViewVersion: number;
}

/* ── Probe yardımcıları (yalnızca bu modül) ──────────────────────────── */

function _androidVersion(ua: string): number {
  const m = ua.match(/Android\s+(\d+)/i);
  return m ? parseInt(m[1], 10) : 0;
}

function _webViewVersion(ua: string): number {
  const m = ua.match(/Chrome\/(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

function _cssSupports(property: string, value: string): boolean {
  try {
    return typeof CSS !== 'undefined' && CSS.supports(property, value);
  } catch {
    return false;
  }
}

function _supportsBackdrop(): boolean {
  return _cssSupports('backdrop-filter', 'blur(1px)') ||
         _cssSupports('-webkit-backdrop-filter', 'blur(1px)');
}

function _supportsWebGL(): boolean {
  try {
    if (typeof document === 'undefined') return false;
    const c = document.createElement('canvas');
    return !!c.getContext('webgl') || !!c.getContext('webgl2') ||
           !!c.getContext('experimental-webgl');
  } catch {
    return false;
  }
}

function _supportsCssLayer(): boolean {
  try {
    if (typeof document === 'undefined') return false;
    const style = document.createElement('style');
    style.textContent = '@layer _test_ {}';
    document.head.appendChild(style);
    const ok = !!(style.sheet && style.sheet.cssRules.length > 0);
    document.head.removeChild(style);
    return ok;
  } catch {
    return false;
  }
}

/**
 * Head unit tipi ekran: düşük çözünürlük / düşük DPR / ultra-wide.
 *
 * ── KÜTÜK #599 · CİHAZDA ÖLÇÜLEN KUSUR (2026-08-16) ────────────────────────
 * Eşikler (800×480 · 1024×600 · 1280×480) gerçek head unit panellerinin
 * **FİZİKSEL** çözünürlükleridir, ama karşılaştırma `innerWidth/innerHeight`
 * ile — yani **CSS px** ile — yapılıyordu. DPR>1 olan her cihazda CSS px
 * fiziksel pikselin 1/dpr'ı olduğu için modern paneller bu eşiklerin ALTINA
 * düşüyordu:
 *
 *   Xiaomi 23090RA98I — fiziksel 2712×1220, dpr 3 → CSS 904×407
 *   → `maxDim(904) <= 1024 && minDim(407) <= 600` → **TRUE** (yanlış)
 *
 * Sonuç ölçüldü: `getDeviceTier()` → `low` → `TIER_FAST_MS.low = 1000ms`
 * (250ms yerine) → OBD hız/RPM kadansı p50 **2361 ms**, en kötü **5570 ms**.
 * 122 km/h'te bu, gösterge güncellemeleri arası ~80 metre demektir. Aynı
 * yanlış sınıf `low` olan her yerde (blur/animasyon/UI Hz) da bedel ödetir.
 *
 * DÜZELTME: eşikler fiziksel piksel eşiği olduğu için karşılaştırma da
 * **fiziksel pikselde** yapılır (`css × dpr`). Gerçek head unit'lerde sonuç
 * DEĞİŞMEZ (1024×600@dpr1 → 1024×600; 1280×480@dpr1.5 → 1280×480 → yine
 * yakalanır); yalnız yüksek-DPR panellerin sahte `low` sınıfı düşer.
 *
 * En/boy oranı kuralı dpr'dan bağımsızdır (oran sadeleşir) — olduğu gibi
 * kalır, ama okuyanın "neden bu ölçüde değil" diye durmaması için fiziksel
 * ölçüler üzerinden yazılır.
 */
function _lowEndScreen(): boolean {
  if (typeof window === 'undefined') return false;
  const cssW = window.innerWidth  || (typeof screen !== 'undefined' ? screen.width  : 0) || 0;
  const cssH = window.innerHeight || (typeof screen !== 'undefined' ? screen.height : 0) || 0;
  const dpr  = window.devicePixelRatio || 1;
  if (cssW === 0 || cssH === 0) return false;
  if (dpr <= 1.0) return true;                              // head unit nadiren > 1.5 DPR

  // Eşikler FİZİKSEL panel çözünürlükleridir → ölçü de fiziksel olmalı.
  const w = cssW * dpr;
  const h = cssH * dpr;
  const maxDim = Math.max(w, h);
  const minDim = Math.min(w, h);
  if (maxDim <= 1024 && minDim <= 600) return true;         // 800×480, 1024×600
  if (maxDim <= 1280 && minDim <= 480) return true;         // 1280×480
  if (maxDim / Math.max(1, minDim) >= 2.5) return true;     // ultra-wide 1920×720 vb.
  return false;
}

function _hasWorkerSAB(): boolean {
  const hasWorker = typeof Worker !== 'undefined';
  const hasSAB =
    typeof SharedArrayBuffer !== 'undefined' &&
    typeof self !== 'undefined' && self.crossOriginIsolated === true;
  return hasWorker && hasSAB;
}

/* ── Cache'li probe ──────────────────────────────────────────────────── */

let _caps: DeviceCapabilities | null = null;

/** Tüm yetenekleri BİR KEZ problar (sonuç donanım sabiti → cache'lenir). */
export function getCapabilities(): DeviceCapabilities {
  if (_caps) return _caps;
  const ua       = typeof navigator !== 'undefined' ? (navigator.userAgent || '') : '';
  const cores    = (typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : 0) || 0;
  const memGb    = typeof navigator !== 'undefined'
    ? ((navigator as { deviceMemory?: number }).deviceMemory ?? 0)
    : 0;
  _caps = {
    cores,
    memoryMb:               memGb > 0 ? memGb * 1024 : 0,
    weakGpu:                hasWeakGpu(),
    supportsWebGL:          _supportsWebGL(),
    supportsBackdropFilter: _supportsBackdrop(),
    supportsDvh:            _cssSupports('height', '1dvh'),
    supportsCssLayer:       _supportsCssLayer(),
    lowEndScreen:           _lowEndScreen(),
    hasWorkerSAB:           _hasWorkerSAB(),
    androidVersion:         _androidVersion(ua),
    webViewVersion:         _webViewVersion(ua),
  };
  return _caps;
}

/* ── Kanonik tier ────────────────────────────────────────────────────── */

let _tier: DeviceTier | null = null;

/**
 * Tek kanonik cihaz sınıfı. TÜM performans/uyumluluk sistemleri bunu kullanır.
 *
 * LOW (head unit / zayıf): aşağıdakilerden HERHANGİ biri →
 *   zayıf GPU · WebGL/backdrop/dvh/@layer eksik · düşük ekran · ≤4 çekirdek ·
 *   ≤3GB RAM · Android < 12. (RAM/çekirdek BİLİNMİYORSA (0) bu kriterler tetiklemez.)
 * HIGH: > 6 çekirdek VE > 4GB RAM (ve LOW değil).
 * MID: diğer her şey (varsayılan).
 */
export function getDeviceTier(): DeviceTier {
  if (_tier) return _tier;
  const c = getCapabilities();
  const low =
    c.weakGpu ||
    !c.supportsWebGL ||
    !c.supportsBackdropFilter ||
    !c.supportsDvh ||
    !c.supportsCssLayer ||
    c.lowEndScreen ||
    (c.cores > 0 && c.cores <= 4) ||
    (c.memoryMb > 0 && c.memoryMb <= 3072) ||
    (c.androidVersion > 0 && c.androidVersion < 12) ||
    (c.webViewVersion > 0 && c.webViewVersion < 90);
  if (low) {
    _tier = 'low';
  } else if (c.cores > 6 && c.memoryMb > 4096) {
    _tier = 'high';
  } else {
    _tier = 'mid';
  }
  return _tier;
}

/**
 * Modül worker (`new Worker(url, { type: 'module' })`) desteği.
 *
 * Modül worker'lar **Chrome 80+** gerektirir. Duster T507 (Chrome 64-79) ve
 * 8227L (52-74) gibi eski head unit WebView'larında `new Worker(...,{type:'module'})`
 * YÜKLENMEZ (bazı WebView'larda constructor senkron throw eder → boot ölümü).
 *
 * Bu yüzden dinamik `import()` / WASM gerektiren ve bu nedenle classic IIFE'ye
 * çevrilemeyen worker'lar (ör. NavigationCompute → sql.js) bu kapıdan geçmeli;
 * kapı kapalıysa ana-thread fallback'e düşülür. Classic (IIFE) worker'lar
 * (VehicleCompute / VisionCompute) bu kısıta tabi DEĞİLDİR — Chrome 52+'da yüklenir.
 */
export function supportsModuleWorker(): boolean {
  if (typeof Worker === 'undefined') return false;
  const c = getCapabilities();
  // webViewVersion 0 = bilinmiyor (Android değil / masaüstü dev) → engelleme.
  if (c.webViewVersion > 0 && c.webViewVersion < 80) return false;
  return true;
}

/** Test/teşhis için cache sıfırla. Prod kodu çağırmamalı. */
export function _resetCapabilitiesForTest(): void {
  _caps = null;
  _tier = null;
}
