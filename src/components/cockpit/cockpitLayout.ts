/**
 * cockpitLayout — Digital Cockpit GEOMETRİ OTORİTESİ (SAF VERİ).
 *
 * ── KAYNAK ────────────────────────────────────────────────────────────────
 * Bu dosya `CAROS_DIGITAL_COCKPIT_IMPLEMENTATION_PACK/cockpit.layout.json` +
 * `cockpit-ui-overlay.svg` dosyalarının BİREBİR kod karşılığıdır. Sayılar
 * TAHMİN EDİLMEDİ; referans PNG'lerine bakıp "yaklaşık" değer yazılmadı.
 * Bir ölçü değişecekse önce paket dosyası değişir, sonra burası.
 *
 * ── REFERANS TUVAL ────────────────────────────────────────────────────────
 * Tüm koordinatlar 1648×928 referans tuvalinde MUTLAK pikseldir. Ekranda
 * `scale = min(vw/1648, vh/928)` ile TEK bir transform uygulanır → her
 * çözünürlükte geometri birebir korunur, cluster'lar crop edilmez.
 *
 * ── GÜN/GECE ──────────────────────────────────────────────────────────────
 * Geometri gün ve gecede AYNIDIR. Yalnız `dayTokens`/`nightTokens` değişir.
 * Tema kararı bu dosyada ÜRETİLMEZ — CarOS'un mevcut `settings.dayNightMode`
 * otoritesinden okunur (ikinci tema state'i YOK).
 *
 * SAF: I/O YOK · React YOK · timer YOK · global durum YOK.
 */

/* ══════════════════════════════════════════════════════════════════════════
 * Referans tuval + ölçekleme
 * ════════════════════════════════════════════════════════════════════════ */

export const COCKPIT_CANVAS = Object.freeze({ width: 1648, height: 928 });

/**
 * Paketteki formülün birebir uygulaması: `s = min(vw/1648, vh/928)`.
 * Sıfır/negatif viewport (jsdom, ölçüm öncesi ilk kare) → `0` yerine güvenli
 * taban döner; aksi hâlde ekran tek karelik "sıfır boyut" çakmasıyla açılırdı.
 */
export function cockpitScale(viewportWidth: number, viewportHeight: number): number {
  if (!Number.isFinite(viewportWidth) || !Number.isFinite(viewportHeight)) return 1;
  if (viewportWidth <= 0 || viewportHeight <= 0) return 1;
  return Math.min(viewportWidth / COCKPIT_CANVAS.width, viewportHeight / COCKPIT_CANVAS.height);
}

/* ══════════════════════════════════════════════════════════════════════════
 * Bölgeler (cockpit.layout.json → regions)
 * ════════════════════════════════════════════════════════════════════════ */

export interface CockpitRegion {
  readonly x: number; readonly y: number;
  readonly w: number; readonly h: number;
  readonly z: number;
}

export type CockpitRegionId =
  | 'topBar' | 'leftCluster' | 'speedCluster' | 'rightCluster'
  | 'roadScene' | 'maneuverBar' | 'musicCard' | 'assistCard';

export const COCKPIT_REGIONS: Readonly<Record<CockpitRegionId, CockpitRegion>> = Object.freeze({
  topBar:        { x:    0, y:   0, w: 1648, h:  74, z: 90 },
  leftCluster:   { x:   20, y: 120, w:  445, h: 520, z: 30 },
  speedCluster:  { x:  585, y:  94, w:  480, h: 235, z: 50 },
  rightCluster:  { x: 1183, y: 120, w:  445, h: 520, z: 30 },
  roadScene:     { x:    0, y:  76, w: 1648, h: 650, z:  5 },
  maneuverBar:   { x:  500, y: 635, w:  650, h:  78, z: 60 },
  musicCard:     { x:   42, y: 728, w:  665, h: 145, z: 60 },
  assistCard:    { x:  940, y: 728, w:  665, h: 145, z: 60 },
});

/** Bölgeyi mutlak konumlandırma stiline çevirir (referans piksel). */
export function regionStyle(id: CockpitRegionId): React.CSSProperties {
  const r = COCKPIT_REGIONS[id];
  return { position: 'absolute', left: r.x, top: r.y, width: r.w, height: r.h, zIndex: r.z };
}

/* ══════════════════════════════════════════════════════════════════════════
 * Tipografi / yarıçap (cockpit.layout.json → typography, radii)
 * ════════════════════════════════════════════════════════════════════════ */

export const COCKPIT_TYPE = Object.freeze({
  speed:          { size: 128, weight: 800, lineHeight: 0.9 },
  unit:           { size:  28, weight: 500 },
  primaryValue:   { size:  48, weight: 700 },
  panelTitle:     { size:  24, weight: 600 },
  secondaryValue: { size:  22, weight: 500 },
  status:         { size:  18, weight: 600 },
  topBar:         { size:  22, weight: 600 },
});

export const COCKPIT_RADII = Object.freeze({ cluster: 54, card: 28, pill: 22 });

/* ══════════════════════════════════════════════════════════════════════════
 * Tema tokenları — geometri DEĞİL, yalnız renk
 * ════════════════════════════════════════════════════════════════════════ */

export interface CockpitTokens {
  readonly canvas: string;
  readonly textPrimary: string;
  readonly textSecondary: string;
  readonly panel: string;
  readonly panelText: string;
  readonly accentOrange: string;
  readonly accentGreen: string;
  readonly warningRed: string;
  readonly border: string;
}

export const COCKPIT_DAY_TOKENS: CockpitTokens = Object.freeze({
  canvas:        '#EEF5FB',
  textPrimary:   '#0F172A',
  textSecondary: '#475569',
  panel:         'rgba(32,44,56,0.88)',
  panelText:     '#F8FAFC',
  accentOrange:  '#F59E0B',
  accentGreen:   '#10B981',
  warningRed:    '#EF4444',
  border:        'rgba(226,232,240,0.78)',
});

export const COCKPIT_NIGHT_TOKENS: CockpitTokens = Object.freeze({
  canvas:        '#061018',
  textPrimary:   '#F8FAFC',
  textSecondary: '#94A3B8',
  panel:         'rgba(8,17,26,0.88)',
  panelText:     '#F8FAFC',
  accentOrange:  '#F59E0B',
  accentGreen:   '#10B981',
  warningRed:    '#EF4444',
  border:        'rgba(71,85,105,0.55)',
});

/** `settings.dayNightMode` → token seti. İKİNCİ tema state'i üretmez, yalnız eşler. */
export function cockpitTokensFor(mode: 'day' | 'night'): CockpitTokens {
  return mode === 'night' ? COCKPIT_NIGHT_TOKENS : COCKPIT_DAY_TOKENS;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Cluster gövde şekilleri (cockpit-ui-overlay.svg path'leri — BİREBİR)
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Sol/sağ cluster'ın referans SVG'deki gövde path'leri. Tuval koordinatındadır
 * (bölge kutusuna GÖRE DEĞİL) — bu yüzden 1648×928 sahnesinin köküne çizilir.
 */
export const COCKPIT_LEFT_CLUSTER_PATH =
  'M32,136 Q60,108 125,110 L350,138 Q430,150 455,220 L455,535 Q438,615 350,636 L128,650 Q55,642 25,585 Z';
export const COCKPIT_RIGHT_CLUSTER_PATH =
  'M1193,220 Q1218,150 1298,138 L1522,110 Q1592,108 1620,136 L1627,585 Q1598,642 1522,650 L1300,636 Q1211,615 1193,535 Z';
/** Sol cluster devir yayı (turuncu) — overlay'deki `stroke-width:13` yay. */
export const COCKPIT_RPM_ARC_PATH = 'M77 170 Q32 290 57 528';

/**
 * Overlay'deki metin/öğe çapaları. Bileşen bunları AYNEN kullanır; "gözle
 * yaklaştırma" yapılmaz. Değerler `cockpit-ui-overlay.svg` içindeki x/y'lerdir.
 */
export const COCKPIT_ANCHORS = Object.freeze({
  topBar: {
    brandX: 55, brandY: 45, brandSize: 28, brandSpacing: 8,
    dividerX: 210, dividerY1: 18, dividerY2: 56,
    clockX: 235, clockY: 45, clockSize: 30,
    dateX: 345, dateY: 45, dateSize: 23,
    ambientTempX: 1485, ambientTempY: 45, ambientTempSize: 24,
  },
  left: {
    titleX: 205, titleY: 260, titleSize: 24,
    rpmX: 205, rpmY: 335, rpmSize: 72,
    rpmUnitX: 205, rpmUnitY: 372, rpmUnitSize: 24,
    dividerX1: 145, dividerX2: 395, dividerY: 400,
    coolantTitleX: 205, coolantTitleY: 448, coolantTitleSize: 23,
    coolantX: 205, coolantY: 495, coolantSize: 38,
    barX: 148, barY: 525, barW: 250, barH: 14,
  },
  speed: {
    valueX: 710, valueY: 245, valueSize: 128,
    unitX: 790, unitY: 285, unitSize: 30,
    limitCx: 1012, limitCy: 205, limitR: 40, limitRing: 10,
    limitTextY: 218, limitTextSize: 34,
  },
  right: {
    rangeTitleX: 1300, rangeTitleY: 260, rangeTitleSize: 24,
    rangeX: 1300, rangeY: 330, rangeSize: 62,
    rangeUnitX: 1467, rangeUnitY: 330, rangeUnitSize: 24,
    fuelBarX: 1300, fuelBarY: 355, fuelBarW: 240, fuelBarH: 16,
    dividerX1: 1285, dividerX2: 1555, dividerY: 400,
    consTitleX: 1300, consTitleY: 448, consTitleSize: 22,
    consX: 1300, consY: 486, consSize: 31,
    odoTitleX: 1300, odoTitleY: 545, odoTitleSize: 22,
    odoX: 1300, odoY: 583, odoSize: 31,
  },
  maneuver: {
    iconX: 535, iconY: 686, iconSize: 48,
    distX: 610, distY: 682, distSize: 34,
    streetX: 760, streetY: 682, streetSize: 26,
    radius: 24,
  },
  music: {
    artX: 62, artY: 748, artSize: 104, artRadius: 16,
    titleX: 190, titleY: 790, titleSize: 28,
    artistX: 190, artistY: 826, artistSize: 23,
    prevX: 385, prevY: 816, prevSize: 42,
    playCx: 505, playCy: 805, playR: 42,
    nextX: 615, nextY: 816, nextSize: 42,
    radius: 30,
  },
  assist: {
    titleX: 985, titleY: 770, titleSize: 22,
    laneX: 1005, laneY: 830, laneSize: 44,
    followX: 1190, followY: 830, followSize: 38,
    dividerX: 1420, dividerY1: 750, dividerY2: 848,
    gearX: 1500, gearY: 805, gearSize: 46,
    modeX: 1480, modeY: 842, modeSize: 24,
    radius: 30,
  },
});

/** Paketin dokunma hedefi tabanı (referans piksel) — küçültmede kilit testi bakar. */
export const COCKPIT_MIN_TOUCH_PX = 56;

/** Paket `responsive.targets` — doğrulanan çözünürlükler. */
export const COCKPIT_RESPONSIVE_TARGETS: readonly (readonly [number, number])[] =
  Object.freeze([[1024, 600], [1280, 720], [1920, 1080]] as const);
