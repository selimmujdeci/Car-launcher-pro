/**
 * themePresets — Tema Stüdyo'nun HAZIR taslakları (kullanıcı isteği 2026-09-26:
 * "hazır, birbiriyle uyumlu renk taslakları + ayrı kart şekli taslakları; her
 * tema için 10-15 tane; tüm temaya ya da tek bir ekrana uygulanabilsin").
 *
 * YENİ BİR TEMA MOTORU DEĞİLDİR. Taslak yalnız MEVCUT manifest alanlarına
 * (`GlobalTokens` · `ScreenOverride`) bir YAMA üretir; uygulama mevcut
 * `patch-tokens` / `patch-screen` eylemleriyle olur → geri al, önizleme ve
 * "Araca Gönder" hiçbir değişiklik olmadan çalışır.
 *
 * UYUM KURALI (el ile hex yığını yerine TÜRETİM): her renk taslağı bir vurgu
 * rengi + bir zemin tonundan (hue/doygunluk) oluşur; zemin, kart, kenarlık ve
 * yazı renkleri o tondan sabit parlaklık basamaklarıyla türetilir. Böylece 48
 * palet de aynı okunabilirlik disiplinini taşır (test: yazı/zemin ≥ 7:1,
 * ikincil yazı ≥ 4.5:1, vurgu/zemin ≥ 3:1).
 */
import { contrastRatio, hslToRgba, parseColor, rgbaToHex, rgbToHsv, hsvToRgb } from './colorMath';
import type { GlobalTokens, Paint, ScreenOverride, ThemeBaseId } from './themeManifest';

export type PresetMode = 'night' | 'day';

export interface ColorPresetSpec {
  readonly id: string;
  readonly name: string;
  /** Kısa his cümlesi (kart altında). */
  readonly mood: string;
  readonly mode: PresetMode;
  /** Vurgu (düğme, ibre, seçili durum). */
  readonly accent: string;
  /** Zemin tonu (0-360) ve doygunluğu (0-1) — zemin/kart/kenarlık/yazı bundan türer. */
  readonly hue: number;
  readonly sat: number;
}

export interface ColorPreset extends ColorPresetSpec {
  readonly tokens: Partial<GlobalTokens>;
  /** Önizleme şeridi: zemin · kart · vurgu · yazı. */
  readonly swatch: readonly [string, string, string, string];
}

export interface ShapePreset {
  readonly id: string;
  readonly name: string;
  readonly mood: string;
  readonly tokens: Pick<GlobalTokens, 'radiusCard' | 'radiusBtn' | 'radiusTile' | 'radiusDock' | 'cardBlurPx' | 'glowIntensity'>;
}

/* ── Renk türetme ─────────────────────────────────────────────────────── */

const hsl = (h: number, s: number, l: number): string => rgbaToHex(hslToRgba(h, s, l));
const solid = (c: string): Paint => ({ kind: 'solid', from: c, to: null, angle: 180, stopA: 0, stopB: 100, alpha: 100 });
const linear = (a: string, b: string): Paint => ({ kind: 'linear', from: a, to: b, angle: 160, stopA: 0, stopB: 100, alpha: 100 });

/** Vurguyu zemine karşı en az `min` kontrasta çeker (gündüzde koyulaştır, gecede aç). */
function ensureContrast(accent: string, bg: string, min: number, mode: PresetMode): string {
  const a = parseColor(accent); const b = parseColor(bg);
  if (!a || !b) return accent;
  let hsv = rgbToHsv(a);
  for (let i = 0; i < 20 && contrastRatio(hsvToRgb(hsv), b) < min; i++) {
    hsv = mode === 'day' ? { ...hsv, v: Math.max(0, hsv.v - 0.05) } : { ...hsv, v: Math.min(1, hsv.v + 0.05), s: Math.max(0, hsv.s - 0.03) };
  }
  return rgbaToHex(hsvToRgb(hsv));
}

/** Vurgunun eşlikçisi: gecede biraz koyu, gündüzde biraz açık ton. */
function companion(accent: string, mode: PresetMode): string {
  const c = parseColor(accent);
  if (!c) return accent;
  const hsv = rgbToHsv(c);
  return rgbaToHex(hsvToRgb(mode === 'night'
    ? { ...hsv, v: Math.max(0, hsv.v * 0.74) }
    : { ...hsv, s: Math.max(0, hsv.s * 0.7), v: Math.min(1, hsv.v * 1.12) }));
}

export function buildColorPreset(spec: ColorPresetSpec): ColorPreset {
  const { hue: h, sat: s, mode } = spec;
  const night = mode === 'night';
  const bgA = night ? hsl(h, s, 0.065) : hsl(h, s * 0.45, 0.93);
  const bgB = night ? hsl(h, s * 0.9, 0.105) : hsl(h, s * 0.35, 0.965);
  const card = night ? hsl(h, s * 0.8, 0.14) : hsl(h, s * 0.25, 0.995);
  const border = night ? hsl(h, s * 0.6, 0.25) : hsl(h, s * 0.3, 0.8);
  const text = night ? hsl(h, 0.16, 0.93) : hsl(h, 0.3, 0.11);
  const text2 = night ? hsl(h, 0.12, 0.7) : hsl(h, 0.18, 0.34);
  const accent = ensureContrast(spec.accent, card, 3, mode);
  const accent2 = companion(accent, mode);
  const tokens: Partial<GlobalTokens> = {
    accentPrimary: accent,
    accentSecondary: accent2,
    textPrimary: text,
    textSecondary: text2,
    borderColor: border,
    glowColor: accent,
    iconNav: accent,
    iconMedia: accent,
    iconDock: accent,
    bgPrimary: linear(bgA, bgB),
    bgCard: solid(card),
  };
  return { ...spec, tokens, swatch: [bgA, card, accent, text] };
}

/** Taslağın TEK EKRANA uygulanan kısmı — ekran override'ı yalnız bu alanları taşır. */
export function screenPatchOf(p: ColorPreset): Partial<ScreenOverride> {
  return {
    accentPrimary: p.tokens.accentPrimary ?? null,
    textPrimary: p.tokens.textPrimary ?? null,
    textSecondary: p.tokens.textSecondary ?? null,
    bg: p.tokens.bgPrimary ?? null,
  };
}

/* ── Tema başına renk taslakları (her tema 12) ────────────────────────── */

const C = (id: string, name: string, mood: string, accent: string, hue: number, sat: number, mode: PresetMode = 'night'): ColorPresetSpec =>
  ({ id, name, mood, accent, hue, sat, mode });

const SPECS: Record<ThemeBaseId, readonly ColorPresetSpec[]> = {
  expedition: [
    C('exp-zeytin-amber', 'Zeytin & Amber', 'Temanın ruhu, daha derin', '#F2871C', 95, 0.28),
    C('exp-col-kumu', 'Çöl Kumu', 'Sıcak kum, güneşte yanmış turuncu', '#E8A04A', 36, 0.3),
    C('exp-kanyon', 'Kanyon Kızılı', 'Kızıl kaya, bakır vurgu', '#E4572E', 14, 0.34),
    C('exp-orman', 'Orman Yeşili', 'Çam gölgesi, taze yaprak', '#8BC34A', 120, 0.3),
    C('exp-volkan', 'Volkanik Gri', 'Bazalt siyahı, lav turuncusu', '#FF6B2C', 20, 0.06),
    C('exp-kamp-atesi', 'Kamp Ateşi', 'Kor kırmızısı, is kokusu', '#FF4F2E', 8, 0.26),
    C('exp-buzul', 'Buzul Mavisi', 'Dağ gölü, soğuk sabah', '#5CC8FF', 205, 0.3),
    C('exp-safari', 'Safari Haki', 'Haki kumaş, pirinç düğme', '#D9B44A', 60, 0.24),
    C('exp-bakir', 'Bakır Toprak', 'Kızıl toprak, eskitilmiş bakır', '#C8733B', 24, 0.24),
    C('exp-devriye', 'Gece Devriyesi', 'Taktik yeşil, düşük ışık', '#9BE15D', 150, 0.2),
    C('exp-sis', 'Sabah Sisi', 'Gündüz · açık zeytin, net okunur', '#C46A12', 90, 0.22, 'day'),
    C('exp-kumtasi', 'Kumtaşı', 'Gündüz · sıcak bej, kiremit vurgu', '#B5501F', 36, 0.3, 'day'),
  ],
  horizon: [
    C('hor-gece-yarisi', 'Gece Yarısı', 'Temanın ruhu: lacivert + amber', '#F2871C', 218, 0.42),
    C('hor-okyanus', 'Okyanus', 'Derin mavi, turkuaz ışık', '#2ED3C6', 200, 0.5),
    C('hor-arktik', 'Arktik', 'Buz mavisi, beyaz nefes', '#7CC7FF', 210, 0.35),
    C('hor-kraliyet', 'Kraliyet Moru', 'Mor kadife, lavanta vurgu', '#B38CFF', 262, 0.4),
    C('hor-sampanya', 'Şampanya', 'Grafit zemin, altın kabarcık', '#E6C27A', 220, 0.18),
    C('hor-grafit-turuncu', 'Grafit Turuncu', 'Nötr grafit, canlı turuncu', '#FF8A3D', 222, 0.12),
    C('hor-nordik', 'Nordik', 'Fiyort mavisi, kuzey ışığı yeşili', '#5EE6A8', 196, 0.34),
    C('hor-safir', 'Safir', 'Koyu safir, parlak kobalt', '#4D8BFF', 226, 0.5),
    C('hor-zumrut', 'Zümrüt', 'Koyu petrol, zümrüt parıltı', '#2FD08A', 175, 0.4),
    C('hor-gun-batimi', 'Gün Batımı', 'Mor akşam, mercan ufuk', '#FF7A6B', 250, 0.35),
    C('hor-gumus-ay', 'Gümüş Ay', 'Gece mavisi, ay gümüşü', '#C9D6EA', 216, 0.3),
    C('hor-buz-beyazi', 'Buz Beyazı', 'Gündüz · soğuk beyaz, lacivert yazı', '#1E5FD9', 214, 0.35, 'day'),
  ],
  tesla: [
    C('tes-espresso', 'Espresso Amber', 'Temanın ruhu, koyu kavrulmuş', '#E0822E', 32, 0.28),
    C('tes-kutup-kirmizi', 'Kırmızı Kutup', 'Karbon siyah, çok katmanlı kırmızı', '#E31937', 0, 0.04),
    C('tes-ultra-red', 'Ultra Red', 'Şarap kırmızısı derinlik', '#FF3B4E', 350, 0.3),
    C('tes-midnight-silver', 'Midnight Silver', 'Metalik gri, gümüş çizgi', '#C7CCD4', 215, 0.08),
    C('tes-deep-blue', 'Deep Blue', 'Metalik lacivert, elektrik mavisi', '#3E8BFF', 222, 0.4),
    C('tes-kahve-krema', 'Kahve Krema', 'Sütlü kahve, karamel vurgu', '#D9A066', 28, 0.22),
    C('tes-yesil-grafit', 'Yeşil Grafit', 'Grafit zemin, elektrik yeşili', '#3DDC84', 160, 0.08),
    C('tes-titanyum', 'Titanyum', 'Soğuk titanyum, buz mavisi', '#8FD3FF', 205, 0.1),
    C('tes-obsidyen-altin', 'Obsidyen Altın', 'Volkanik cam, altın kenar', '#E8B84A', 40, 0.1),
    C('tes-bordo', 'Bordo Deri', 'Koyu bordo deri, bakır dikiş', '#E07B4F', 355, 0.3),
    C('tes-inci', 'İnci', 'Gündüz · inci beyazı, kırmızı vurgu', '#C8102E', 30, 0.15, 'day'),
    C('tes-kum-beji', 'Kum Beji', 'Gündüz · sıcak bej, espresso yazı', '#A5541E', 34, 0.35, 'day'),
  ],
  pro: [
    C('pro-buz-mavisi', 'Buz Mavisi', 'Temanın ruhu: antrasit + mavi', '#5B8DFF', 225, 0.14),
    C('pro-ambiyans-mor', 'Ambiyans Mor', 'Gece ambiyans ışığı, mor', '#A77BFF', 262, 0.2),
    C('pro-turkuaz', 'Turkuaz', 'Antrasit zemin, turkuaz çizgi', '#22D3EE', 190, 0.16),
    C('pro-gul-altin', 'Gül Altın', 'Sıcak antrasit, gül altın', '#E8A38C', 15, 0.1),
    C('pro-m-mavi', 'M Mavisi', 'Motor sporu mavisi, keskin', '#1C69D4', 218, 0.3),
    C('pro-yesil-ambiyans', 'Yeşil Ambiyans', 'Sakin gece yeşili', '#34D399', 158, 0.14),
    C('pro-kirmizi-spor', 'Kırmızı Spor', 'Karbon + yarış kırmızısı', '#FF3D3D', 0, 0.06),
    C('pro-antrasit-altin', 'Antrasit Altın', 'Lüks: siyah + altın', '#D4AF37', 45, 0.08),
    C('pro-neon-cyan', 'Neon Cyan', 'Gece şehri, neon', '#00E5FF', 200, 0.3),
    C('pro-gece-pembe', 'Gece Pembesi', 'Koyu mor zemin, pembe ışık', '#FF6FB5', 300, 0.22),
    C('pro-grafit-sade', 'Grafit Sade', 'En sade: gri üstüne beyaz', '#E6EAF0', 220, 0.05),
    C('pro-kristal', 'Beyaz Kristal', 'Gündüz · parlak beyaz, mavi vurgu', '#2F6BFF', 220, 0.2, 'day'),
  ],
};

const _cache: Partial<Record<ThemeBaseId, readonly ColorPreset[]>> = {};

/** Temanın renk taslakları (türetilmiş, önbellekli). */
export function colorPresetsFor(themeId: ThemeBaseId): readonly ColorPreset[] {
  return (_cache[themeId] ??= SPECS[themeId].map(buildColorPreset));
}

/* ── Kart şekli taslakları (tüm temalarda ortak — geometri tema renginden bağımsız) ── */

const S = (id: string, name: string, mood: string, card: number, btn: number, tile: number, dock: number, blur: number, glow: number): ShapePreset =>
  ({ id, name, mood, tokens: { radiusCard: card, radiusBtn: btn, radiusTile: tile, radiusDock: dock, cardBlurPx: blur, glowIntensity: glow } });

export const SHAPE_PRESETS: readonly ShapePreset[] = [
  S('shape-keskin', 'Keskin', 'Köşesiz, askeri düzen', 2, 2, 2, 4, 0, 0),
  S('shape-endustriyel', 'Endüstriyel', 'Hafif pahlı metal plaka', 4, 3, 4, 6, 0, 10),
  S('shape-minimal', 'Minimal Düz', 'Az yuvarlak, gölgesiz', 6, 6, 6, 8, 0, 0),
  S('shape-kokpit', 'Kokpit', 'Gösterge paneli, hafif ışıma', 8, 4, 8, 12, 4, 60),
  S('shape-klasik', 'Klasik', 'Dengeli, her temaya uyar', 12, 10, 12, 16, 8, 25),
  S('shape-mat', 'Mat', 'Yumuşak köşe, parıltısız', 12, 10, 12, 16, 0, 0),
  S('shape-premium', 'Premium', 'İnce cam, zarif ışık', 14, 12, 14, 18, 16, 20),
  S('shape-yumusak', 'Yumuşak', 'Oval kartlar, sakin', 18, 14, 18, 22, 12, 30),
  S('shape-cam', 'Buzlu Cam', 'Kalın buzlu cam, derinlik', 16, 12, 16, 20, 24, 40),
  S('shape-neon', 'Neon', 'Güçlü ışıma, gece için', 12, 10, 12, 16, 0, 100),
  S('shape-balon', 'Balon', 'Çok yuvarlak, oyuncak gibi', 26, 20, 26, 28, 10, 25),
  S('shape-kapsul', 'Kapsül', 'Hap düğmeler, oval dock', 22, 32, 22, 32, 8, 20),
];
