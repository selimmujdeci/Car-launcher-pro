/**
 * Digital Cockpit sunum geometrisi. Ana hedef 1024×600 head unit.
 * Tek SVG aynı oranla büyür; tema kararı settings.dayNightMode'dan gelir.
 * Bu dosya yalnız geometri/renk taşır, araç veya tema durumu üretmez.
 */
export const COCKPIT_CANVAS = Object.freeze({ width: 1024, height: 600 });

export function cockpitScale(viewportWidth: number, viewportHeight: number): number {
  if (!Number.isFinite(viewportWidth) || !Number.isFinite(viewportHeight)) return 1;
  if (viewportWidth <= 0 || viewportHeight <= 0) return 1;
  return Math.min(viewportWidth / COCKPIT_CANVAS.width, viewportHeight / COCKPIT_CANVAS.height);
}

export const COCKPIT_REGIONS = Object.freeze({
  topBar:       { x: 0,   y: 0,   w: 1024, h: 66 },
  leftCluster:  { x: 48,  y: 110, w: 240,  h: 322 },
  speedCluster: { x: 336, y: 112, w: 352,  h: 216 },
  rightCluster: { x: 736, y: 110, w: 240,  h: 322 },
  roadScene:    { x: 320, y: 320, w: 384,  h: 132 },
  maneuverBar:  { x: 350, y: 330, w: 324,  h: 88 },
  musicCard:    { x: 40,  y: 492, w: 602,  h: 72 },
  assistCard:   { x: 680, y: 492, w: 296,  h: 72 },
});

export interface CockpitTokens {
  readonly canvas: string;
  readonly surfaceTop: string;
  readonly surfaceBottom: string;
  readonly shelf: string;
  readonly textPrimary: string;
  readonly textSecondary: string;
  readonly accent: string;
  readonly accentSoft: string;
  readonly detail: string;
  readonly border: string;
  readonly edge: string;
  readonly track: string;
  readonly horizon: string;
  readonly horizonLine: string;
  readonly warningRed: string;
  readonly sign: string;
  /** Hız/devir halkasının ikinci gradyan durağı ve arka plan parıltısı. */
  readonly accentHigh: string;
  readonly glow: string;
  /** Bilinmeyen (—) değerin sakin rengi: ikincil metinle aynı kontrast sınıfı. */
  readonly muted: string;
}

// Modern dijital gösterge: iki modda da koyu enstrüman yüzeyi (OEM kümeleri gibi).
// Gündüz daha parlak/kontrastlı, gece daha az ışık yayar. Kontrast testi: birincil
// metin ≥7:1, ikincil ≥4.5:1 her yüzeyde.
export const COCKPIT_DAY_TOKENS: CockpitTokens = Object.freeze({
  canvas: '#0E141A', surfaceTop: '#18222A', surfaceBottom: '#10181F',
  shelf: '#141D24', textPrimary: '#F2F6F7', textSecondary: '#9FB0B7',
  accent: '#35C4E0', accentSoft: '#1B3A44', detail: '#E0A23C',
  border: '#27343D', edge: '#33434D', track: '#243039',
  horizon: '#15222A', horizonLine: '#24404A', warningRed: '#FF5A4E', sign: '#F5F5EF',
  accentHigh: '#8BEBFF', glow: '#1F7A90', muted: '#8A9BA3',
});

export const COCKPIT_NIGHT_TOKENS: CockpitTokens = Object.freeze({
  canvas: '#05080B', surfaceTop: '#0D1419', surfaceBottom: '#080D11',
  shelf: '#0B1116', textPrimary: '#DCE6E8', textSecondary: '#8698A0',
  accent: '#2AA9C4', accentSoft: '#123039', detail: '#C48A2E',
  border: '#1A252C', edge: '#223039', track: '#17232A',
  horizon: '#0E1A20', horizonLine: '#1B343C', warningRed: '#E0544A', sign: '#BCCAC8',
  accentHigh: '#5FD4EE', glow: '#0F4A58', muted: '#6F818A',
});

export function cockpitTokensFor(mode: 'day' | 'night'): CockpitTokens {
  return mode === 'night' ? COCKPIT_NIGHT_TOKENS : COCKPIT_DAY_TOKENS;
}

/** Gerçek ekran pikseli tabanı; küçültülmüş referans birimi değildir. */
export const COCKPIT_MIN_TOUCH_PX = 56;
export const COCKPIT_RESPONSIVE_TARGETS: readonly (readonly [number, number])[] =
  Object.freeze([[1024, 600], [1280, 720], [1920, 1080]] as const);

/** Sabit taksimat geometrisi: RPM akışında tekrar hesaplanmaz. */
export function cockpitTachoPoint(fraction: number, radius: number) {
  const angle = (145 + 250 * fraction) * Math.PI / 180;
  return { x: 168 + Math.cos(angle) * radius, y: 238 + Math.sin(angle) * radius };
}

const start = cockpitTachoPoint(0, 94);
const end = cockpitTachoPoint(1, 94);
export const COCKPIT_RPM_ARC_PATH = `M${start.x} ${start.y} A94 94 0 1 1 ${end.x} ${end.y}`;
export const COCKPIT_TACHO_TICKS = Object.freeze(Array.from({ length: 17 }, (_, i) => ({
  fraction: i / 16,
  major: i % 4 === 0,
  outer: cockpitTachoPoint(i / 16, 84),
  inner: cockpitTachoPoint(i / 16, i % 4 === 0 ? 75 : 80),
  label: cockpitTachoPoint(i / 16, 62),
})));
