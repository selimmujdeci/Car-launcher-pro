/**
 * Theme Layout Engine
 *
 * Her tema paketi = farklı fiziksel layout.
 * CSS grid/flex/order ile DOM hiyerarşisi değiştirmeden layout değişir.
 *
 * Layout variants:
 *   map-first  — Tesla: harita dominan, speedo ince sol
 *   cockpit    — BMW/Porsche: speedo büyük sol, harita sağ küçük
 *   glass      — Mercedes/Pro: dengeli 2-sütun, geniş radius
 *   sport      — Audi: eşit sütunlar, keskin köşeler
 *
 * CSS variables applied per layout variant + screen ratio:
 *   --l-flex-dir     container flex direction (row / column)
 *   --l-map-flex     flex shorthand for map panel (e.g. "1.8 1 0%")
 *   --l-right-panel  right panel width in row mode
 *   --l-grid-cols    grid-template-columns string for 3-col layouts
 *   --l-map-basis    map-first için map flex-basis
 */

import type { ThemePack } from '../store/useStore';
import { useStore } from '../store/useStore';
import { useEffect } from 'react';
import { useScreenSense } from '../hooks/useScreenSense';
import type { ScreenRatio } from '../hooks/useScreenSense';

/* ── Types ────────────────────────────────────────────────── */

export type LayoutVariant =
  | 'map-first'  // Tesla: harita dominan
  | 'cockpit'    // BMW: speedo dominan
  | 'glass'      // Mercedes, Glass Pro: dengeli cam
  | 'sport';     // Audi: agresif eşit

export interface LayoutRatioConfig {
  /** Container flex-direction ('row' | 'column') */
  flexDir?:    string;
  /** Flex shorthand for map panel — used in map-first (Tesla) */
  mapFlex?:    string;
  /** Width of right/side panel in row mode */
  rightPanel?: string;
  /** grid-template-columns — used in cockpit/glass/sport (BMW/Mercedes/Audi) */
  gridCols?:   string;
}

export interface LayoutConfig {
  variant:     LayoutVariant;
  label:       string;
  description: string;
  /** Map flex-basis percentage (e.g. "45%") — legacy ref */
  mapBasis:    string;
  /** Speedometer basis / rem width hint — legacy ref */
  speedoBasis: string;
  /** Preview accent color (theme primary) */
  accentHex:   string;
  /** Preview theme background */
  bgHex:       string;
  /** Per-ratio CSS var overrides */
  ratioOverrides?: Partial<Record<ScreenRatio, LayoutRatioConfig>>;
}

/* ── Theme → Layout map (Active 5 themes) ───────────────────── */

export const THEME_LAYOUTS: Record<ThemePack, LayoutConfig> = {
  tesla: {
    variant:     'map-first',
    label:       'Tesla',
    description: 'Geniş harita, ince speedo, sıfır gürültü',
    mapBasis:    '45%',
    speedoBasis: '13rem',
    accentHex:   '#e8e8e8',
    bgHex:       '#050505',
    ratioOverrides: {
      portrait:     { flexDir: 'column', mapFlex: '1 1 52%', rightPanel: '100%' },
      square:       { flexDir: 'row',    mapFlex: '1 1 48%', rightPanel: '180px' },
      // wide: default (no override needed)
      'ultra-wide': { flexDir: 'row',    mapFlex: '1 1 62%', rightPanel: '240px' },
    },
  },
  bmw: {
    variant:     'cockpit',
    label:       'BMW M',
    description: 'Speedo egemen, agresif cockpit',
    mapBasis:    '26%',
    speedoBasis: '22rem',
    accentHex:   '#1d4ed8',
    bgHex:       '#010410',
    ratioOverrides: {
      portrait:     { flexDir: 'column', gridCols: '1fr' },
      square:       { flexDir: 'row',    gridCols: 'minmax(0,1fr) minmax(0,1fr)' },
      // wide: default (no override)
      'ultra-wide': { flexDir: 'row',    gridCols: 'minmax(0,0.75fr) minmax(0,1.45fr) minmax(0,0.80fr)' },
    },
  },
  mercedes: {
    variant:     'glass',
    label:       'Mercedes',
    description: 'Dengeli 2-sütun, altın cam efekti',
    mapBasis:    '38%',
    speedoBasis: '18rem',
    accentHex:   '#d4af37',
    bgHex:       '#090907',
    ratioOverrides: {
      portrait:     { flexDir: 'column', gridCols: '1fr' },
      square:       { flexDir: 'row',    gridCols: 'minmax(0,1fr) minmax(0,1fr)' },
      'ultra-wide': { flexDir: 'row',    gridCols: 'minmax(0,1.15fr) minmax(0,1.15fr) minmax(0,0.70fr)' },
    },
  },
  audi: {
    variant:     'sport',
    label:       'Audi',
    description: 'Teknik hassasiyet, net grid',
    mapBasis:    '36%',
    speedoBasis: '20rem',
    accentHex:   '#c0392b',
    bgHex:       '#030608',
    ratioOverrides: {
      portrait:     { flexDir: 'column', gridCols: '1fr' },
      square:       { flexDir: 'row',    gridCols: 'minmax(0,1fr) minmax(0,1fr)' },
      'ultra-wide': { flexDir: 'row',    gridCols: 'minmax(0,1fr) minmax(0,1.25fr) minmax(0,0.75fr)' },
    },
  },
  'glass-pro': {
    variant:     'glass',
    label:       'Glass Pro',
    description: 'Tam frosted glass deneyimi',
    mapBasis:    '40%',
    speedoBasis: '18rem',
    accentHex:   '#38bdf8',
    bgHex:       '#050a14',
    ratioOverrides: {
      portrait:     { flexDir: 'column' },
      'ultra-wide': { flexDir: 'row' },
    },
  },
};

/* ── Default fallback ─────────────────────────────────────── */

const DEFAULT_LAYOUT: LayoutConfig = {
  variant:     'glass',
  label:       'Glass Pro',
  description: 'Dengeli modern cam arayüzü',
  mapBasis:    '40%',
  speedoBasis: '18rem',
  accentHex:   '#38bdf8',
  bgHex:       '#050a14',
};

/* ── Default ratio config per variant ────────────────────── */

const VARIANT_DEFAULTS: Record<LayoutVariant, LayoutRatioConfig> = {
  'map-first': { flexDir: 'row', mapFlex: '1.8 1 0%', rightPanel: 'var(--lp-right-panel, 200px)' },
  cockpit:     { flexDir: 'row', gridCols: 'minmax(0,0.85fr) minmax(0,1.20fr) minmax(0,0.95fr)' },
  glass:       { flexDir: 'row', gridCols: 'minmax(0,1fr) minmax(0,1fr) minmax(0,0.85fr)' },
  sport:       { flexDir: 'row', gridCols: 'minmax(0,1fr) minmax(0,1.1fr) minmax(0,0.85fr)' },
};

/* ── Public API ───────────────────────────────────────────── */

export function getLayoutConfig(pack: ThemePack): LayoutConfig {
  return THEME_LAYOUTS[pack] ?? DEFAULT_LAYOUT;
}

/**
 * React hook — returns layout config for the currently active theme.
 * Automatically updates when the theme pack changes.
 */
export function useThemeLayout(): LayoutConfig {
  const pack = useStore((s) => s.settings.themePack);
  return getLayoutConfig(pack);
}

/**
 * React hook — syncs theme pack + screen ratio changes to the DOM.
 * Injects CSS custom properties:
 *   --l-flex-dir, --l-map-flex, --l-right-panel, --l-grid-cols
 * Mount once at the app root level (e.g. in MainLayout or App).
 */
export function useLayoutSync(): void {
  const pack  = useStore((s) => s.settings.themePack);
  const sense = useScreenSense();

  useEffect(() => {
    const config  = getLayoutConfig(pack);
    const base    = VARIANT_DEFAULTS[config.variant];
    const override = config.ratioOverrides?.[sense.ratio] ?? {};
    const effective: LayoutRatioConfig = { ...base, ...override };

    const root = document.documentElement;
    root.setAttribute('data-layout', config.variant);
    // data-screen-ratio is managed by useScreenSense — no double-write needed

    root.style.setProperty('--l-flex-dir',    effective.flexDir    ?? 'row');
    root.style.setProperty('--l-map-flex',    effective.mapFlex    ?? '1.8 1 0%');
    root.style.setProperty('--l-right-panel', effective.rightPanel ?? 'var(--lp-right-panel, 200px)');
    root.style.setProperty('--l-grid-cols',   effective.gridCols   ?? '');
  }, [pack, sense.ratio]);
}
