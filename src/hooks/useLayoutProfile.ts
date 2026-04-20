import type { DeviceCategory } from '../platform/screenAnalyzer';

export interface LayoutProfile {
  category: DeviceCategory;
  // Dock
  dockHeight: number;
  tileW: number;
  tileH: number;
  dockIconSize: number;
  // Header
  headerHeight: number;
  // Icons
  iconSize: number;
  iconSizeSm: number;
  // Font sizes (px)
  fontXs: number;
  fontSm: number;
  fontBase: number;
  fontLg: number;
  fontXl: number;
  font2xl: number;
  // Spacing (px)
  spaceXs: number;
  spaceSm: number;
  spaceMd: number;
  spaceLg: number;
  spaceXl: number;
  // Border radius (px)
  radiusSm: number;
  radiusMd: number;
  radiusLg: number;
  // Components
  speedoSize: number;
  albumArtSize: number;
  rightPanelWidth: number;
  musicCardHeight: number;
  // Ultra-wide extras
  maxContentWidth: number | null;
  sidePadding: number;
}

const PROFILES: Record<DeviceCategory, LayoutProfile> = {
  /** 7" budget HU (800×480, 1024×600) */
  COMPACT: {
    category: 'COMPACT',
    dockHeight: 52, tileW: 48, tileH: 46, dockIconSize: 18,
    headerHeight: 40,
    iconSize: 18, iconSizeSm: 14,
    fontXs: 9, fontSm: 11, fontBase: 12, fontLg: 15, fontXl: 20, font2xl: 30,
    spaceXs: 2, spaceSm: 4, spaceMd: 8, spaceLg: 12, spaceXl: 16,
    radiusSm: 4, radiusMd: 8, radiusLg: 12,
    speedoSize: 130, albumArtSize: 40, rightPanelWidth: 145, musicCardHeight: 105,
    maxContentWidth: null, sidePadding: 0,
  },
  /** 10" standard HU (1024×600, 1280×720) */
  NORMAL: {
    category: 'NORMAL',
    dockHeight: 68, tileW: 64, tileH: 60, dockIconSize: 24,
    headerHeight: 52,
    iconSize: 22, iconSizeSm: 16,
    fontXs: 10, fontSm: 12, fontBase: 14, fontLg: 17, fontXl: 23, font2xl: 36,
    spaceXs: 3, spaceSm: 6, spaceMd: 10, spaceLg: 16, spaceXl: 24,
    radiusSm: 6, radiusMd: 10, radiusLg: 16,
    speedoSize: 175, albumArtSize: 52, rightPanelWidth: 200, musicCardHeight: 155,
    maxContentWidth: null, sidePadding: 0,
  },
  /** 12-14" premium HU (1440×768, 1920×720) */
  WIDE: {
    category: 'WIDE',
    dockHeight: 76, tileW: 72, tileH: 68, dockIconSize: 26,
    headerHeight: 58,
    iconSize: 24, iconSizeSm: 18,
    fontXs: 10, fontSm: 13, fontBase: 15, fontLg: 19, fontXl: 25, font2xl: 40,
    spaceXs: 4, spaceSm: 7, spaceMd: 12, spaceLg: 20, spaceXl: 32,
    radiusSm: 8, radiusMd: 12, radiusLg: 20,
    speedoSize: 200, albumArtSize: 60, rightPanelWidth: 220, musicCardHeight: 175,
    maxContentWidth: null, sidePadding: 0,
  },
  /** 17-21" ultra-wide (2560×720, 3840×1080, aspect > 2.4) */
  ULTRA_WIDE: {
    category: 'ULTRA_WIDE',
    dockHeight: 84, tileW: 80, tileH: 74, dockIconSize: 28,
    headerHeight: 62,
    iconSize: 26, iconSizeSm: 20,
    fontXs: 11, fontSm: 13, fontBase: 15, fontLg: 19, fontXl: 26, font2xl: 42,
    spaceXs: 4, spaceSm: 8, spaceMd: 14, spaceLg: 22, spaceXl: 36,
    radiusSm: 8, radiusMd: 12, radiusLg: 22,
    speedoSize: 220, albumArtSize: 64, rightPanelWidth: 255, musicCardHeight: 190,
    maxContentWidth: 1800, sidePadding: 80,
  },
};

export function getLayoutProfile(category: DeviceCategory): LayoutProfile {
  return PROFILES[category];
}
