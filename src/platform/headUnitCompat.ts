/**
 * Head Unit Compatibility Layer
 *
 * Eski Android / eski WebView / düşük donanımlı cihazları otomatik tespit eder.
 * Tespit edilirse:
 *  - data-compat-mode="true" → <html> etiketine eklenir (CSS override tetikler)
 *  - performanceMode 'lite' olarak zorlanır
 *  - dvh height sorunu düzeltilir
 *  - İzin diyaloğu sonrası siyah ekran için agresif repaint uygulanır
 *
 * applyCompatMode() → main.tsx'te React render öncesi çağrılmalı
 */

import { setPerformanceMode, getPerformanceMode } from './performanceMode';

// Listener'ların tek seferlik kaydedilmesini sağlar — HMR / re-entry'ye karşı guard
let _compatListenersAttached = false;

export interface CompatProfile {
  isHeadUnit: boolean;
  supportsBackdropFilter: boolean;
  supportsDvh: boolean;
  cpuCores: number;
  memoryGb: number;
  androidVersion: number;
  webViewVersion: number;
}

/* ── Detection helpers ─────────────────────────────────────── */

function detectAndroidVersion(ua: string): number {
  const m = ua.match(/Android\s+(\d+)/i);
  return m ? parseInt(m[1], 10) : 0;
}

function detectWebViewVersion(ua: string): number {
  // Chromium/WebView sürümü
  const m = ua.match(/Chrome\/(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

function checkCssSupport(property: string, value: string): boolean {
  try {
    return typeof CSS !== 'undefined' && CSS.supports(property, value);
  } catch {
    return false;
  }
}

function checkBackdropFilter(): boolean {
  return (
    checkCssSupport('backdrop-filter', 'blur(1px)') ||
    checkCssSupport('-webkit-backdrop-filter', 'blur(1px)')
  );
}

function checkDvh(): boolean {
  return checkCssSupport('height', '1dvh');
}

function checkCssLayerSupport(): boolean {
  // @layer cascade layers: Chrome 99+
  // Yoksa Tailwind v4 CSS tamamen görmezden gelinir
  try {
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

/* ── Profile builder ───────────────────────────────────────── */

/** Head unit ekran karakteristik tespiti — düşük çözünürlüklü/non-standart oranlar */
function detectHeadUnitScreen(): boolean {
  if (typeof window === 'undefined') return false;
  const w   = window.innerWidth  || screen.width  || 0;
  const h   = window.innerHeight || screen.height || 0;
  const dpr = window.devicePixelRatio || 1;
  if (w === 0 || h === 0) return false;

  // Düşük DPR (head unit'lerde nadiren > 1.5)
  if (dpr <= 1.0) return true;

  // Klasik head unit çözünürlükleri (800x480, 1024x600, 1280x720, 1280x480)
  const maxDim = Math.max(w, h);
  const minDim = Math.min(w, h);
  if (maxDim <= 1024 && minDim <= 600) return true;
  if (maxDim <= 1280 && minDim <= 480) return true;

  // Aşırı geniş aspect ratio (ultra-wide head unit'ler: 1920x720, 2560x720)
  const aspect = maxDim / Math.max(1, minDim);
  if (aspect >= 2.5) return true;

  return false;
}

function buildProfile(): CompatProfile {
  const ua = navigator.userAgent || '';
  const androidVersion    = detectAndroidVersion(ua);
  const webViewVersion    = detectWebViewVersion(ua);
  const cpuCores          = navigator.hardwareConcurrency || 0;
  const memoryGb          = (navigator as any).deviceMemory || 0;
  const supportsBackdropFilter = checkBackdropFilter();
  const supportsDvh            = checkDvh();
  const supportsCssLayer       = checkCssLayerSupport();
  const lowEndScreen           = detectHeadUnitScreen();

  // Sıkılaştırılmış eşikler:
  //   Android < 12      → eski cihaz
  //   Chromium < 90     → eski WebView (modern blur işleri tutmaz)
  //   cpuCores ≤ 4      → çoğu head unit Cortex-A53 quad-core
  //   memoryGb ≤ 3      → 4GB advertised olsa bile sistem 3.x GB raporlar
  //   lowEndScreen      → düşük çözünürlük / düşük DPR / ultra-wide
  const isHeadUnit =
    (androidVersion > 0 && androidVersion < 12) ||
    (webViewVersion > 0 && webViewVersion < 90) ||
    (cpuCores > 0 && cpuCores <= 4) ||
    (memoryGb > 0 && memoryGb <= 3) ||
    !supportsBackdropFilter ||
    !supportsDvh ||
    !supportsCssLayer ||
    lowEndScreen;

  return {
    isHeadUnit: isHeadUnit,
    supportsBackdropFilter: supportsBackdropFilter,
    supportsDvh: supportsDvh,
    cpuCores: cpuCores,
    memoryGb: memoryGb,
    androidVersion: androidVersion,
    webViewVersion: webViewVersion,
  };
}

/* ── Runtime state ─────────────────────────────────────────── */

let _profile: CompatProfile | null = null;

export function getCompatProfile(): CompatProfile {
  if (!_profile) _profile = buildProfile();
  return _profile;
}

export function isLowEndDevice(): boolean {
  return getCompatProfile().isHeadUnit;
}

export function supportsBackdropFilter(): boolean {
  return getCompatProfile().supportsBackdropFilter;
}

/* ── Dynamic Scaling Engine ─────────────────────────────────── */
// Cihaz ekran genişliğine göre piecewise-linear --scale-factor hesaplar:
//   ≤ 800 px → 0.8  |  1280 px → 1.0  |  ≥ 1920 px → 1.5
// html font-size bu değerle ayarlanır; rem/em tabanlı tüm ölçüler otomatik uyar.

function _computeScaleFactor(width: number): number {
  if (width <= 800)  return 0.8;
  if (width <= 1280) return 0.8 + ((width - 800)  / 480) * 0.2;
  if (width <= 1920) return 1.0 + ((width - 1280) / 640) * 0.5;
  return 1.5;
}

function _applyScaleFactor(): void {
  const width = window.innerWidth || document.documentElement.clientWidth;
  const scale = _computeScaleFactor(width);
  document.documentElement.style.setProperty('--scale-factor', scale.toFixed(3));
  // rem tabanlı ölçekleme: 1rem = 16px × scale-factor
  document.documentElement.style.fontSize = (16 * scale).toFixed(2) + 'px';
}

let _scaleListenerAttached = false;

function _startDynamicScaling(): void {
  _applyScaleFactor();
  if (!_scaleListenerAttached) {
    _scaleListenerAttached = true;
    window.addEventListener('resize', _applyScaleFactor, { passive: true });
  }
}

/* ── Repaint helper — izin diyaloğu sonrası siyah ekran fix ── */

function forceRepaint(): void {
  try {
    requestAnimationFrame(() => {
      // GPU layer yeniden oluştur
      document.documentElement.style.transform = 'translateZ(0)';
      requestAnimationFrame(() => {
        document.documentElement.style.transform = '';
        // Layout recalc tetikle
        void document.documentElement.offsetHeight;
        // Takılı theme crossfade overlay'i temizle
        const overlay = document.getElementById('theme-crossfade-overlay');
        if (overlay) {
          overlay.style.transition = 'none';
          overlay.style.opacity = '0';
          overlay.style.pointerEvents = 'none';
        }
        // Takılı brightness filter'ı temizle
        const filterVal = document.documentElement.style.filter;
        if (filterVal && filterVal !== 'none') {
          document.documentElement.style.filter = '';
        }
        // Root'un height'ı 0 kalmışsa düzelt
        const root = document.getElementById('root');
        if (root && root.offsetHeight < 10) {
          root.style.height = '100vh';
          requestAnimationFrame(() => { root.style.height = ''; });
        }
      });
    });
  } catch {
    // requestAnimationFrame yoksa veya hata olursa sessizce devam et
  }
}

/* ── applyCompatMode — main.tsx'ten React render öncesi çağır ── */

function applyCompatThemeDefaults(): void {
  // Eski cihazlarda glass/neon tema → minimal/flat zorla (blur yok, performanslı)
  // Kullanıcı daha önce kendi tercihi varsa dokunma
  if (localStorage.getItem('cl_themeStyle_userSet') === '1') return;
  try {
    const key = 'car-launcher-storage';
    const raw = localStorage.getItem(key);
    if (!raw) return;
    const data = JSON.parse(raw) as { state?: { settings?: { themeStyle?: string; widgetStyle?: string } } };
    if (!data?.state?.settings) return;
    const s = data.state.settings;
    if (s.themeStyle === 'glass' || s.themeStyle === 'neon') {
      s.themeStyle = 'minimal';
      s.widgetStyle = 'flat';
      localStorage.setItem(key, JSON.stringify(data));
    }
  } catch { /* quota veya parse hatası — devam et */ }
}

/** Önceki başlatmada head unit tespit edildiyse hemen compat-mode aç (FOUC önler) */
function applyCachedHeadUnitFlag(): boolean {
  try {
    if (localStorage.getItem('cl_isHeadUnit') === '1') {
      document.documentElement.setAttribute('data-compat-mode', 'true');
      document.documentElement.classList.add('perf-low');
      return true;
    }
  } catch { /* ignore */ }
  return false;
}

export function applyCompatMode(): void {
  // Cache'den anında uygula — React render öncesi blur/animation kapanır
  applyCachedHeadUnitFlag();

  // Dinamik ölçekleme — compat/normal tüm cihazlarda çalışır
  _startDynamicScaling();

  const profile = getCompatProfile();

  // Cache: sonraki açılış için tespit sonucunu sakla
  try {
    localStorage.setItem('cl_isHeadUnit', profile.isHeadUnit ? '1' : '0');
  } catch { /* quota */ }

  if (profile.isHeadUnit) {
    // CSS override için data attribute + perf-low class
    document.documentElement.setAttribute('data-compat-mode', 'true');
    document.documentElement.classList.add('perf-low');

    // Kullanıcı manuel olarak perf mode ayarlamamışsa 'lite' zorla
    const hasUserPref = (() => {
      try { return localStorage.getItem('cl_performanceMode_userSet') === '1'; } catch { return false; }
    })();
    if (!hasUserPref && getPerformanceMode() !== 'lite') {
      setPerformanceMode('lite');
    }

    // Eski cihazda glass/neon temayı minimal'a zorla — blur rendera zarar verir
    applyCompatThemeDefaults();

    // dvh desteği yoksa height'ı düzelt
    if (!profile.supportsDvh) {
      document.documentElement.style.height = '100%';
      document.body.style.height = '100%';
      const root = document.getElementById('root');
      if (root) root.style.height = '100%';
    }
  }

  // Tüm cihazlarda: izin diyaloğu / focus dönüşü için agresif repaint
  // Guard: main.tsx HMR ya da çift çağrı durumunda listener kümülenmesini engelle
  if (!_compatListenersAttached) {
    _compatListenersAttached = true;
    const onVisible = () => { if (!document.hidden) forceRepaint(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', forceRepaint);
    // Capacitor resume eventi
    document.addEventListener('resume', forceRepaint);
  }

  // Force Resize: bazı head unit'ler ilk açılışta WebView boyutunu yanlış hesaplar.
  // 500ms sonra resize zorla → layout yeniden hesaplanır, siyah ekran düzelir.
  setTimeout(function() {
    try { window.dispatchEvent(new Event('resize')); } catch { /* ignore */ }
  }, 500);
}

/**
 * Kullanıcı settings'ten performance mode seçtiğinde bunu işaretle,
 * böylece auto-detect bu tercihi ezmez.
 */
export function markUserSetPerformanceMode(): void {
  try { localStorage.setItem('cl_performanceMode_userSet', '1'); } catch { /* quota */ }
}
