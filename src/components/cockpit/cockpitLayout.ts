/**
 * Digital Cockpit sunum geometrisi. Ana hedef 1024×600 head unit.
 * Tek SVG aynı oranla büyür; tema kararı settings.dayNightMode'dan gelir.
 * Bu dosya yalnız geometri/renk taşır, araç veya tema durumu üretmez.
 */
export const COCKPIT_CANVAS = Object.freeze({ width: 1024, height: 600 });

/** Sunum 1280×720 referans koordinatlarında yazılır; tuvale tek tip ölçek + dikey ortalama. */
export const COCKPIT_DESIGN_SCALE = 0.8;
export const COCKPIT_DESIGN_OFFSET_Y = 12;

export function cockpitScale(viewportWidth: number, viewportHeight: number): number {
  if (!Number.isFinite(viewportWidth) || !Number.isFinite(viewportHeight)) return 1;
  if (viewportWidth <= 0 || viewportHeight <= 0) return 1;
  return Math.min(viewportWidth / COCKPIT_CANVAS.width, viewportHeight / COCKPIT_CANVAS.height);
}

/**
 * Bölge kutuları TUVAL koordinatında (tasarım 1280×720 → ×0.8, +12 dikey).
 * Sunum `DigitalCockpitScreen`: solda hız, sağda devir, ortada dekoratif yol,
 * üstte dönüş kartı, altta menzil · kilometre · müzik.
 */
export const COCKPIT_REGIONS = Object.freeze({
  topBar:       { x: 0,   y: 0,   w: 1024, h: 60 },
  speedCluster: { x: 47,  y: 120, w: 264,  h: 300 },
  rightCluster: { x: 713, y: 120, w: 264,  h: 300 },
  roadScene:    { x: 216, y: 212, w: 592,  h: 388 },
  maneuverBar:  { x: 376, y: 23,  w: 272,  h: 77 },
  leftCluster:  { x: 62,  y: 490, w: 224,  h: 70 },
  assistCard:   { x: 800, y: 470, w: 162,  h: 60 },
  musicCard:    { x: 344, y: 530, w: 336,  h: 70 },
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
  canvas: '#03060B', surfaceTop: '#0D1C31', surfaceBottom: '#060D17',
  shelf: '#0A1420', textPrimary: '#EEF4FF', textSecondary: '#9FB0C8',
  accent: '#2F8CFF', accentSoft: '#12325C', detail: '#E0A23C',
  border: '#1E2C40', edge: '#2A3B54', track: '#1A2433',
  horizon: '#0C1829', horizonLine: '#0E1C30', warningRed: '#FF5A4E', sign: '#FFFFFF',
  accentHigh: '#5FB4FF', glow: '#1E6FE0', muted: '#7A8BA3',
});

export const COCKPIT_NIGHT_TOKENS: CockpitTokens = Object.freeze({
  canvas: '#010306', surfaceTop: '#08121F', surfaceBottom: '#03080F',
  shelf: '#050B13', textPrimary: '#D9E3F0', textSecondary: '#8796AD',
  accent: '#2677DB', accentSoft: '#0D2647', detail: '#C48A2E',
  border: '#152133', edge: '#1D2C42', track: '#121B27',
  horizon: '#08111D', horizonLine: '#0A1524', warningRed: '#E0544A', sign: '#D6DCE3',
  accentHigh: '#4D9FEA', glow: '#1757B0', muted: '#66758A',
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
