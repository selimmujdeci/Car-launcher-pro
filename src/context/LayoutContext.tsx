import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { analyzeScreen, type ScreenProfile } from '../platform/screenAnalyzer';
import { getLayoutProfile, type LayoutProfile } from '../hooks/useLayoutProfile';
import { initScale } from '../utils/scale';
import { useSystemStore } from '../store/useSystemStore';

interface LayoutContextValue {
  screen: ScreenProfile;
  profile: LayoutProfile;
  /** Geri vites aktifken true — ağır widget'lar render skip için kullanabilir */
  reverseActive: boolean;
}

const LayoutContext = createContext<LayoutContextValue | null>(null);

function applyCSSVars(p: LayoutProfile, s: ScreenProfile) {
  const root = document.documentElement;
  const set = (k: string, v: string) => root.style.setProperty(k, v);
  const px = (n: number) => `${n}px`;

  // Dock
  set('--lp-dock-h', px(p.dockHeight));
  set('--lp-tile-w', px(p.tileW));
  set('--lp-tile-h', px(p.tileH));
  set('--lp-dock-icon', px(p.dockIconSize));

  // Header
  set('--lp-header-h', px(p.headerHeight));

  // Icons
  set('--lp-icon', px(p.iconSize));
  set('--lp-icon-sm', px(p.iconSizeSm));

  // Fonts
  set('--lp-font-xs', px(p.fontXs));
  set('--lp-font-sm', px(p.fontSm));
  set('--lp-font-base', px(p.fontBase));
  set('--lp-font-lg', px(p.fontLg));
  set('--lp-font-xl', px(p.fontXl));
  set('--lp-font-2xl', px(p.font2xl));
  // Speed display font — large number in speedometer
  set('--lp-speed-font', px(Math.round(p.speedoSize * 0.33)));

  // Spacing
  set('--lp-space-xs', px(p.spaceXs));
  set('--lp-space-sm', px(p.spaceSm));
  set('--lp-space-md', px(p.spaceMd));
  set('--lp-space-lg', px(p.spaceLg));
  set('--lp-space-xl', px(p.spaceXl));

  // Radius
  set('--lp-radius-sm', px(p.radiusSm));
  set('--lp-radius-md', px(p.radiusMd));
  set('--lp-radius-lg', px(p.radiusLg));

  // Components
  set('--lp-speedo', px(p.speedoSize));
  set('--lp-album', px(p.albumArtSize));
  set('--lp-right-panel', px(p.rightPanelWidth));
  set('--lp-music-card', px(p.musicCardHeight));

  // Ultra-wide
  set('--lp-max-w', p.maxContentWidth ? px(p.maxContentWidth) : '100%');
  set('--lp-side-pad', px(p.sidePadding));

  // Safe area insets (env() fallback: 0)
  set('--sat', px(s.safeArea.top));
  set('--sab', px(s.safeArea.bottom));
  set('--sal', px(s.safeArea.left));
  set('--sar', px(s.safeArea.right));

  // Raw screen dimensions (CSS pixels)
  set('--lp-screen-w', px(s.width));
  set('--lp-screen-h', px(s.height));

  // Computed content area: screen minus header, dock, dock-gradient, and content padding
  const dockTotal = p.dockHeight + 12; // tiles + fade gradient
  const contentH = Math.max(s.height - p.headerHeight - dockTotal - 24, 200);
  set('--lp-content-h', px(contentH));

  // Top row gets ~62% of content height (speedo + music), bottom row gets rest
  set('--lp-top-row-h', px(Math.max(Math.floor(contentH * 0.62), 180)));

  // Right sidebar / music panel width: proportional to screen width
  const rightW = Math.max(Math.min(Math.floor(s.width * 0.33), 380), 220);
  set('--lp-panel-r', px(rightW));

  // Device category attribute for CSS targeting
  root.setAttribute('data-layout', s.category.toLowerCase());
}

export function LayoutProvider({ children }: { children: ReactNode }) {
  const [screen, setScreen] = useState<ScreenProfile>(() => analyzeScreen());
  const profile        = getLayoutProfile(screen.category);
  const reverseActive  = useSystemStore((s) => s.isReverseActive);
  const rafRef = useRef<number | null>(null);

  const handleResize = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      const next = analyzeScreen();
      setScreen(prev => {
        // Only re-render if category changes or size changes significantly (>5px)
        if (
          prev.category !== next.category ||
          Math.abs(prev.width - next.width) > 5 ||
          Math.abs(prev.height - next.height) > 5
        ) {
          return next;
        }
        return prev;
      });
      rafRef.current = null;
    });
  }, []);

  useEffect(() => {
    initScale(screen.width, screen.height);
    applyCSSVars(profile, screen);
  }, [screen, profile]);

  useEffect(() => {
    window.addEventListener('resize', handleResize, { passive: true });
    screen.safeArea; // referenced to suppress lint — insets re-read on analyzeScreen
    return () => {
      window.removeEventListener('resize', handleResize);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [handleResize]);

  return (
    <LayoutContext.Provider value={{ screen, profile, reverseActive }}>
      {children}
    </LayoutContext.Provider>
  );
}

export function useLayout(): LayoutContextValue {
  const ctx = useContext(LayoutContext);
  if (!ctx) throw new Error('useLayout must be used within LayoutProvider');
  return ctx;
}
