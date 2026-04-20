export type DeviceCategory = 'COMPACT' | 'NORMAL' | 'WIDE' | 'ULTRA_WIDE';

export interface SafeAreaInsets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface ScreenProfile {
  width: number;
  height: number;
  aspectRatio: number;
  dpr: number;
  category: DeviceCategory;
  safeArea: SafeAreaInsets;
  isLandscape: boolean;
}

function readSafeAreaInsets(): SafeAreaInsets {
  try {
    const probe = document.createElement('div');
    probe.setAttribute('style', [
      'position:fixed', 'visibility:hidden', 'pointer-events:none', 'top:0', 'left:0',
      'padding-top:env(safe-area-inset-top,0px)',
      'padding-bottom:env(safe-area-inset-bottom,0px)',
      'padding-left:env(safe-area-inset-left,0px)',
      'padding-right:env(safe-area-inset-right,0px)',
    ].join(';'));
    document.body.appendChild(probe);
    const cs = getComputedStyle(probe);
    const insets: SafeAreaInsets = {
      top: parseFloat(cs.paddingTop) || 0,
      bottom: parseFloat(cs.paddingBottom) || 0,
      left: parseFloat(cs.paddingLeft) || 0,
      right: parseFloat(cs.paddingRight) || 0,
    };
    document.body.removeChild(probe);
    return insets;
  } catch {
    return { top: 0, bottom: 0, left: 0, right: 0 };
  }
}

function categorize(w: number, h: number, ar: number): DeviceCategory {
  if (ar > 2.4 || w >= 2200) return 'ULTRA_WIDE';
  if (w >= 1400 || (w >= 1200 && ar >= 1.85)) return 'WIDE';
  if (w < 900 || h < 480) return 'COMPACT';
  return 'NORMAL';
}

export function analyzeScreen(): ScreenProfile {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const ar = w / h;
  return {
    width: w,
    height: h,
    aspectRatio: ar,
    dpr: window.devicePixelRatio || 1,
    category: categorize(w, h, ar),
    safeArea: readSafeAreaInsets(),
    isLandscape: w >= h,
  };
}
