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
/* ── Sürücü ekranı renk ve görünüm seçenekleri (kullanıcı isteği 2026-09-27) ── */

export const COCKPIT_ACCENT_IDS = ['blue', 'red', 'green', 'orange', 'purple', 'ice'] as const;
export type CockpitAccentId = typeof COCKPIT_ACCENT_IDS[number];
export const COCKPIT_ACCENT_LABELS: Readonly<Record<CockpitAccentId, string>> = Object.freeze({
  blue: 'Mavi', red: 'Kırmızı', green: 'Yeşil', orange: 'Turuncu', purple: 'Mor', ice: 'Buz',
});

export const COCKPIT_STYLE_IDS = ['road', 'minimal', 'analog', 'retro', 'digital'] as const;
export type CockpitStyleId = typeof COCKPIT_STYLE_IDS[number];
export const COCKPIT_STYLE_LABELS: Readonly<Record<CockpitStyleId, string>> = Object.freeze({
  road: 'Yol', minimal: 'Sade', analog: 'Analog', retro: 'Retro', digital: 'Dijital',
});

/** Sürüş ekranındaki "değiştir" düğmesi: sıradaki görünüm (sonda başa döner). */
export function nextCockpitStyle(id: CockpitStyleId): CockpitStyleId {
  const i = COCKPIT_STYLE_IDS.indexOf(id);
  return COCKPIT_STYLE_IDS[(i + 1) % COCKPIT_STYLE_IDS.length]!;
}

type Accent = Pick<CockpitTokens, 'accent' | 'accentHigh' | 'accentSoft' | 'glow'>;
/** Vurgu setleri: gece parlak (koyu zemin), gündüz koyulaştırılmış (açık zeminde okunur). */
const ACCENTS: Readonly<Record<CockpitAccentId, { night: Accent; day: Accent }>> = Object.freeze({
  blue:   { night: { accent: '#2F8CFF', accentHigh: '#5FB4FF', accentSoft: '#12325C', glow: '#1E6FE0' },
            day:   { accent: '#0B63CE', accentHigh: '#1F7FE8', accentSoft: '#CFE2FA', glow: '#6FA8EE' } },
  red:    { night: { accent: '#E5322D', accentHigh: '#FF6A5E', accentSoft: '#4A1414', glow: '#B81E1A' },
            day:   { accent: '#C4201B', accentHigh: '#E0433B', accentSoft: '#F8D3D1', glow: '#EE8E88' } },
  green:  { night: { accent: '#1FB86A', accentHigh: '#4FE08F', accentSoft: '#0F3A24', glow: '#138A4E' },
            day:   { accent: '#0E8A4B', accentHigh: '#16A35B', accentSoft: '#CDEEDB', glow: '#7FD3A5' } },
  orange: { night: { accent: '#F2871C', accentHigh: '#FFB35C', accentSoft: '#4A2A0C', glow: '#C86A10' },
            day:   { accent: '#C25E05', accentHigh: '#DE7414', accentSoft: '#FBE1C6', glow: '#F2B06E' } },
  purple: { night: { accent: '#8B5CF6', accentHigh: '#B69BFF', accentSoft: '#2A1B55', glow: '#6A3FD8' },
            day:   { accent: '#6A3FD8', accentHigh: '#7E55E8', accentSoft: '#E2D8FB', glow: '#B39BF2' } },
  ice:    { night: { accent: '#9FD4EA', accentHigh: '#E3F4FB', accentSoft: '#1D3440', glow: '#5E9CB6' },
            day:   { accent: '#2B6F8C', accentHigh: '#3C86A6', accentSoft: '#D3E8F1', glow: '#8DC2D8' } },
});

/** Nötr taban (renkten bağımsız): gece koyu enstrüman, gündüz açık zemin + koyu yazı. */
const NIGHT_BASE = Object.freeze({
  canvas: '#010306', surfaceTop: '#08121F', surfaceBottom: '#03080F',
  shelf: '#050B13', textPrimary: '#E4ECF6', textSecondary: '#8F9DB2', detail: '#C48A2E',
  border: '#152133', edge: '#1D2C42', track: '#121B27',
  horizon: '#08111D', horizonLine: '#0A1524', warningRed: '#FF5A4E', sign: '#E8ECF0', muted: '#66758A',
});
const DAY_BASE = Object.freeze({
  canvas: '#DDE4EC', surfaceTop: '#F6F8FB', surfaceBottom: '#E3E9F0',
  shelf: '#EDF1F6', textPrimary: '#0B1220', textSecondary: '#3D4A5E', detail: '#9A5B06',
  border: '#C3CEDB', edge: '#B4C1D1', track: '#C8D2DE',
  horizon: '#CBD5E1', horizonLine: '#B9C5D4', warningRed: '#D42A20', sign: '#FFFFFF', muted: '#5F6D82',
});

export function cockpitTokensFor(mode: 'day' | 'night', accent: CockpitAccentId = 'blue'): CockpitTokens {
  const a = (ACCENTS[accent] ?? ACCENTS.blue)[mode];
  return Object.freeze({ ...(mode === 'night' ? NIGHT_BASE : DAY_BASE), ...a });
}

/** Geriye uyum: varsayılan (mavi) setler. */
export const COCKPIT_DAY_TOKENS: CockpitTokens = cockpitTokensFor('day');
export const COCKPIT_NIGHT_TOKENS: CockpitTokens = cockpitTokensFor('night');

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
