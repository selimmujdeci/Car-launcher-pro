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

function buildProfile(): CompatProfile {
  var ua = navigator.userAgent || '';
  var androidVersion    = detectAndroidVersion(ua);
  var webViewVersion    = detectWebViewVersion(ua);
  var cpuCores          = navigator.hardwareConcurrency || 0;
  var memoryGb          = (navigator as any).deviceMemory || 0;
  var supportsBackdropFilter = checkBackdropFilter();
  var supportsDvh            = checkDvh();
  var supportsCssLayer       = checkCssLayerSupport();

  var isHeadUnit =
    (androidVersion > 0 && androidVersion < 11) ||
    (webViewVersion > 0 && webViewVersion < 80) ||
    (cpuCores > 0 && cpuCores <= 2) ||
    (memoryGb > 0 && memoryGb <= 2) ||
    !supportsBackdropFilter ||
    !supportsDvh ||
    !supportsCssLayer;

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

var _profile: CompatProfile | null = null;

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

export function applyCompatMode(): void {
  const profile = getCompatProfile();

  if (profile.isHeadUnit) {
    // CSS override için data attribute
    document.documentElement.setAttribute('data-compat-mode', 'true');

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
  const onVisible = () => { if (!document.hidden) forceRepaint(); };
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('focus', forceRepaint);
  // Capacitor resume eventi
  document.addEventListener('resume', forceRepaint);
}

/**
 * Kullanıcı settings'ten performance mode seçtiğinde bunu işaretle,
 * böylece auto-detect bu tercihi ezmez.
 */
export function markUserSetPerformanceMode(): void {
  try { localStorage.setItem('cl_performanceMode_userSet', '1'); } catch { /* quota */ }
}
