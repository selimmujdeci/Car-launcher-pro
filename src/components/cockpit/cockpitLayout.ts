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
}

// Gündüz mat mineral yüzey; gece daha az ışık yayan grafit ve yumuşak metin.
export const COCKPIT_DAY_TOKENS: CockpitTokens = Object.freeze({
  canvas: '#E6EBEA', surfaceTop: '#F3F5F1', surfaceBottom: '#E4EAE7',
  shelf: '#DCE3E1', textPrimary: '#1A2C33', textSecondary: '#50646A',
  accent: '#326E72', accentSoft: '#CEDDD9', detail: '#937044',
  border: '#C4CECB', edge: '#F9FAF6', track: '#CBD6D2',
  horizon: '#D5DFDB', horizonLine: '#B8C8C2', warningRed: '#B74340', sign: '#F5F5EF',
});

export const COCKPIT_NIGHT_TOKENS: CockpitTokens = Object.freeze({
  canvas: '#0C1217', surfaceTop: '#172127', surfaceBottom: '#10191E',
  shelf: '#151F25', textPrimary: '#D6E0DE', textSecondary: '#8D9FA5',
  accent: '#8DBABC', accentSoft: '#263C40', detail: '#B4956D',
  border: '#2B383E', edge: '#344148', track: '#2E3E44',
  horizon: '#1A2C31', horizonLine: '#304A50', warningRed: '#C06A61', sign: '#BCCAC8',
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
