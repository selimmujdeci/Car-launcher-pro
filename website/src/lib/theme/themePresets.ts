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
 * UYUM KURALI (v2, 2026-09-27): her taslak bir marka vurgusu + bir nötr
 * zemin tonundan oluşur; zemin/kart/kenarlık/yazı HCT ton paletinin SABİT
 * tone basamaklarından gelir (bkz. `TONES`). Tüm paletler aynı okunabilirlik
 * disiplinini taşır (test: yazı/zemin ≥ 7:1, ikincil yazı ≥ 4.5:1,
 * vurgu/kart ≥ 3:1; güneş altında 15 / 7 / 4.5).
 */
import { Hct, TonalPalette, argbFromHex, hexFromArgb } from '@material/material-color-utilities';
import type { GlobalTokens, Paint, ScreenOverride, ThemeBaseId } from './themeManifest';

/** night: gece · day: gündüz · sun: GÜNEŞ ALTI — en yüksek kontrast (kullanıcı 2026-09-26). */
export type PresetMode = 'night' | 'day' | 'sun';

export interface ColorPresetSpec {
  readonly id: string;
  readonly name: string;
  /** Kısa, somut tarif (kart altında). */
  readonly mood: string;
  readonly mode: PresetMode;
  /** Marka vurgusu (düğme, ibre, seçili durum). Tonu moda göre ayarlanır, RENGİ korunur. */
  readonly accent: string;
  /** Nötr zemin tonu (0-360) ve tonlama gücü (0-1 → HCT kroması 0-16). */
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

/* ── Renk türetme (v2 · 2026-09-27) ───────────────────────────────────────
 * ESKİ YÖNTEM: HSL parlaklık basamakları + döngüyle kontrast zorlama. HSL
 * algısal olarak düzgün değildir: aynı "parlaklık" sarıda parlak, mavide koyu
 * görünür → paletler birbirinden farklı disiplinde ve yer yer "neon" çıkıyordu.
 *
 * YENİ YÖNTEM: Google Material Color Utilities · HCT (hue-chroma-tone). Tone
 * algısal parlaklıktır ve kontrast doğrudan tone farkından gelir; bu yüzden
 * zemin/kart/kenarlık/yazı her palette AYNI tone basamaklarında durur (OEM
 * gösterge disiplini) ve vurgu yalnız TONU ayarlanarak okunur kılınır — marka
 * rengi (hue + chroma) korunur. Kontrast eşikleri yapıdan gelir, döngüyle değil. */

interface ModeTones {
  bg: number; card: number; border: number; text: number; text2: number;
  /** Vurgu tonu aralığı: marka rengi bu aralığa kıstırılır. */
  accentMin: number; accentMax: number; accent2: number;
}

const TONES: Record<PresetMode, ModeTones> = {
  /* Gece: neredeyse siyah zemin (OLED'de yansıma yok), kart bir basamak açık. */
  night: { bg: 6, card: 13, border: 26, text: 95, text2: 78, accentMin: 64, accentMax: 80, accent2: 50 },
  /* Gündüz: kâğıt beyazı kart, çok açık zemin, mürekkep yazı. */
  day:   { bg: 94, card: 99, border: 80, text: 10, text2: 32, accentMin: 34, accentMax: 46, accent2: 60 },
  /* Güneş altı: saf beyaz kart, koyu kenarlık, en koyu yazı ve vurgu. */
  sun:   { bg: 96, card: 100, border: 38, text: 4, text2: 22, accentMin: 28, accentMax: 38, accent2: 22 },
};

const hex = (argb: number): string => hexFromArgb(argb).toUpperCase();
const solid = (c: string): Paint => ({ kind: 'solid', from: c, to: null, angle: 180, stopA: 0, stopB: 100, alpha: 100 });
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export function buildColorPreset(spec: ColorPresetSpec): ColorPreset {
  const t = TONES[spec.mode];
  /* Nötr palet: güneş altında tonlama yarıya iner (renkli zemin parlamada kirli görünür). */
  const chroma = clamp(spec.sat, 0, 1) * (spec.mode === 'sun' ? 8 : 16);
  const neutral = TonalPalette.fromHueAndChroma(spec.hue, chroma);
  const bg = hex(neutral.tone(t.bg));
  const card = spec.mode === 'sun' ? '#FFFFFF' : hex(neutral.tone(t.card));
  const border = hex(neutral.tone(t.border));
  const text = hex(TonalPalette.fromHueAndChroma(spec.hue, Math.min(chroma, 6)).tone(t.text));
  const text2 = hex(TonalPalette.fromHueAndChroma(spec.hue, Math.min(chroma, 10)).tone(t.text2));

  const brand = Hct.fromInt(argbFromHex(spec.accent));
  /* Renkli vurgu soluklaşmasın (≥24 kroma); gümüş/grafit gibi NÖTR vurgu ise
     nötr kalır — ona renk eklemek markayı değiştirir. */
  const neutralAccent = brand.chroma < 12;
  const accentHct = Hct.from(brand.hue, neutralAccent ? brand.chroma : Math.max(brand.chroma, 24),
    clamp(brand.tone, t.accentMin, t.accentMax));
  const accent = hex(accentHct.toInt());
  const accent2 = hex(Hct.from(brand.hue, neutralAccent ? brand.chroma : Math.max(brand.chroma * 0.8, 20), t.accent2).toInt());

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
    /* DÜZ renk: zayıf GPU modunda (`perf-low`) tüm background-image'lar kapatılır —
       gradyan zemin head unit'te TAMAMEN kayboluyordu (başsız Chrome'da ölçüldü). */
    bgPrimary: solid(bg),
    bgCard: solid(card),
  };
  return { ...spec, tokens, swatch: [bg, card, accent, text] };
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

/* ── Tema başına renk taslakları (her tema 14: 8 gece · 2 gündüz · 4 güneş altı) ──
 * KÜRATÖRLÜ LİSTE (2026-09-27): birbirine benzeyen ve "neon" taslaklar çıkarıldı;
 * her taslak bir OEM kabin paletine karşılık gelir. İlk taslak temanın özgün
 * paletidir. İsimler renk + malzeme; tarif tek cümle ve somut. */

const C = (id: string, name: string, mood: string, accent: string, hue: number, sat: number, mode: PresetMode = 'night'): ColorPresetSpec =>
  ({ id, name, mood, accent, hue, sat, mode });

const SPECS: Record<ThemeBaseId, readonly ColorPresetSpec[]> = {
  expedition: [
    C('exp-zeytin-amber', 'Zeytin · Amber', 'Temanın özgün paleti', '#F2871C', 110, 0.55),
    C('exp-grafit-turuncu', 'Grafit · Turuncu', 'Nötr koyu gri, turuncu vurgu', '#F07A2A', 60, 0.08),
    C('exp-kum-bakir', 'Kum · Bakır', 'Sıcak kum tonu, bakır vurgu', '#D98A4E', 60, 0.5),
    C('exp-orman', 'Orman · Yosun', 'Koyu çam yeşili, yosun vurgu', '#8DB85A', 140, 0.6),
    C('exp-buzul', 'Buzul · Gök', 'Soğuk gri, gök mavisi vurgu', '#5AAEE0', 230, 0.35),
    C('exp-toprak', 'Toprak · Kiremit', 'Kahve zemin, kiremit vurgu', '#D2643C', 40, 0.45),
    C('exp-gece-kirmizi', 'Gece · Kırmızı', 'Gece sürüşü: göz kamaştırmayan kırmızı', '#E04A3C', 20, 0.1),
    C('exp-gece-mavi', 'Gece · Çelik Mavisi', 'Nötr koyu gri, çelik mavisi vurgu', '#6FA3D8', 60, 0.08),
    C('exp-sabah', 'Sabah · Zeytin', 'Gündüz: açık zeytin, turuncu vurgu', '#C46A12', 110, 0.4, 'day'),
    C('exp-kumtasi', 'Kumtaşı', 'Gündüz: sıcak bej, kiremit vurgu', '#B5501F', 60, 0.5, 'day'),
    C('exp-gunes-turuncu', 'Güneş · Turuncu', 'Güneş altı: beyaz, koyu turuncu', '#C2410C', 60, 0.3, 'sun'),
    C('exp-gunes-orman', 'Güneş · Orman', 'Güneş altı: beyaz, koyu yeşil', '#166534', 140, 0.3, 'sun'),
    C('exp-gunes-mavi', 'Güneş · Kobalt', 'Güneş altı: beyaz, koyu mavi', '#1D4ED8', 250, 0.3, 'sun'),
    C('exp-gunes-kirmizi', 'Güneş · Kırmızı', 'Güneş altı: beyaz, koyu kırmızı', '#B91C1C', 20, 0.2, 'sun'),
  ],
  horizon: [
    C('hor-gece-yarisi', 'Lacivert · Amber', 'Temanın özgün paleti', '#F2871C', 260, 0.7),
    C('hor-okyanus', 'Okyanus · Turkuaz', 'Derin petrol, turkuaz vurgu', '#2EC4B6', 220, 0.6),
    C('hor-arktik', 'Arktik · Buz', 'Soğuk gri-mavi, buz mavisi', '#7CB9F0', 250, 0.35),
    C('hor-safir', 'Safir', 'Koyu lacivert, kobalt vurgu', '#4A7FF0', 265, 0.7),
    C('hor-zumrut', 'Zümrüt', 'Koyu petrol, zümrüt vurgu', '#2FB57E', 190, 0.5),
    C('hor-sampanya', 'Grafit · Şampanya', 'Grafit zemin, şampanya altını', '#D8B878', 260, 0.12),
    C('hor-gece-kirmizi', 'Gece · Kırmızı', 'Gece sürüşü: göz kamaştırmayan kırmızı', '#E04A3C', 260, 0.15),
    C('hor-grafit-mavi', 'Grafit · Elektrik Mavisi', 'Nötr grafit, net mavi vurgu', '#4F8CFF', 250, 0.08),
    C('hor-buz-beyazi', 'Buz Beyazı', 'Gündüz: soğuk beyaz, lacivert vurgu', '#1E5FD9', 255, 0.45, 'day'),
    C('hor-gunduz-kum', 'Gündüz · Kum', 'Gündüz: sıcak kâğıt, amber vurgu', '#B85C0A', 70, 0.4, 'day'),
    C('hor-gunes-lacivert', 'Güneş · Lacivert', 'Güneş altı: beyaz, lacivert', '#1E3A8A', 260, 0.35, 'sun'),
    C('hor-gunes-amber', 'Güneş · Amber', 'Güneş altı: beyaz, koyu amber', '#B45309', 70, 0.3, 'sun'),
    C('hor-gunes-petrol', 'Güneş · Petrol', 'Güneş altı: beyaz, petrol mavisi', '#0F766E', 200, 0.3, 'sun'),
    C('hor-gunes-grafit', 'Güneş · Grafit', 'Güneş altı: beyaz, siyah vurgu', '#374151', 260, 0.1, 'sun'),
  ],
  tesla: [
    C('tes-espresso', 'Espresso · Karamel', 'Temanın özgün paleti', '#E0822E', 50, 0.45),
    C('tes-karbon-kirmizi', 'Karbon · Kırmızı', 'Saf siyah, yarış kırmızısı', '#E8324A', 0, 0),
    C('tes-gece-gumusu', 'Gece Gümüşü', 'Metalik gri, gümüş vurgu', '#C3CAD4', 250, 0.15),
    C('tes-derin-mavi', 'Derin Mavi', 'Metalik lacivert, elektrik mavisi', '#3E86F5', 260, 0.55),
    C('tes-titanyum', 'Titanyum · Buz', 'Soğuk titanyum, buz mavisi', '#8CC8F0', 230, 0.12),
    C('tes-obsidyen-altin', 'Obsidyen · Altın', 'Volkanik cam siyahı, altın', '#D9AE52', 60, 0.06),
    C('tes-bordo', 'Bordo Deri', 'Koyu bordo deri, bakır dikiş', '#D97A55', 10, 0.55),
    C('tes-grafit-yesil', 'Grafit · Yeşil', 'Grafit zemin, sakin elektrik yeşili', '#4CC38A', 250, 0.08),
    C('tes-inci', 'İnci', 'Gündüz: inci beyazı, kırmızı vurgu', '#C8102E', 60, 0.15, 'day'),
    C('tes-kum-beji', 'Kum Beji', 'Gündüz: sıcak bej, espresso vurgu', '#A5541E', 60, 0.5, 'day'),
    C('tes-gunes-kirmizi', 'Güneş · Kırmızı', 'Güneş altı: beyaz, koyu kırmızı', '#B91C1C', 20, 0.2, 'sun'),
    C('tes-gunes-grafit', 'Güneş · Grafit', 'Güneş altı: beyaz, siyah vurgu', '#374151', 250, 0.1, 'sun'),
    C('tes-gunes-mavi', 'Güneş · Mavi', 'Güneş altı: beyaz, koyu mavi', '#1D4ED8', 250, 0.3, 'sun'),
    C('tes-gunes-yesil', 'Güneş · Yeşil', 'Güneş altı: beyaz, koyu yeşil', '#047857', 170, 0.25, 'sun'),
  ],
  pro: [
    C('pro-buz-mavisi', 'Antrasit · Buz Mavisi', 'Temanın özgün paleti', '#5B8DFF', 260, 0.3),
    C('pro-ambiyans-mor', 'Ambiyans · Mor', 'Gece kabin ışığı, lavanta', '#A98AF5', 290, 0.35),
    C('pro-turkuaz', 'Antrasit · Turkuaz', 'Antrasit zemin, turkuaz çizgi', '#2CC6DA', 220, 0.25),
    C('pro-gul-altin', 'Gül Altın', 'Sıcak antrasit, gül altın', '#E0A28A', 30, 0.2),
    C('pro-spor-mavi', 'Motor Sporu Mavisi', 'Keskin mavi, siyah zemin', '#2F6FE0', 260, 0.1),
    C('pro-yesil-ambiyans', 'Ambiyans · Yeşil', 'Sakin gece yeşili', '#4CC792', 170, 0.25),
    C('pro-grafit-sade', 'Grafit Sade', 'En sade: gri üstüne beyaz', '#E3E7EE', 250, 0.06),
    C('pro-gece-kirmizi', 'Gece · Kırmızı', 'Gece sürüşü: göz kamaştırmayan kırmızı', '#E04A3C', 260, 0.1),
    C('pro-kristal', 'Beyaz Kristal', 'Gündüz: parlak beyaz, mavi vurgu', '#2F6BFF', 260, 0.3, 'day'),
    C('pro-gunduz-gri', 'Gündüz · Gri', 'Gündüz: nötr gri, grafit vurgu', '#3F4A5A', 250, 0.08, 'day'),
    C('pro-gunes-mavi', 'Güneş · Mavi', 'Güneş altı: beyaz, koyu mavi', '#1D4ED8', 260, 0.25, 'sun'),
    C('pro-gunes-mor', 'Güneş · Mor', 'Güneş altı: beyaz, koyu mor', '#6D28D9', 290, 0.25, 'sun'),
    C('pro-gunes-yesil', 'Güneş · Yeşil', 'Güneş altı: beyaz, koyu yeşil', '#047857', 170, 0.25, 'sun'),
    C('pro-gunes-grafit', 'Güneş · Grafit', 'Güneş altı: beyaz, siyah vurgu', '#374151', 260, 0.1, 'sun'),
  ],
};

const _cache: Partial<Record<ThemeBaseId, readonly ColorPreset[]>> = {};

/** Galeride grup başlığı ve sırası. */
export const PRESET_MODE_LABEL: Record<PresetMode, string> = {
  night: 'Gece', day: 'Gündüz', sun: 'Güneş altı',
};

/** Temanın renk taslakları (türetilmiş, önbellekli). */
export function colorPresetsFor(themeId: ThemeBaseId): readonly ColorPreset[] {
  return (_cache[themeId] ??= SPECS[themeId].map(buildColorPreset));
}

/* ── Kart şekli taslakları (tüm temalarda ortak — geometri tema renginden bağımsız) ── */

const S = (id: string, name: string, mood: string, card: number, btn: number, tile: number, dock: number, blur: number, glow: number): ShapePreset =>
  ({ id, name, mood, tokens: { radiusCard: card, radiusBtn: btn, radiusTile: tile, radiusDock: dock, cardBlurPx: blur, glowIntensity: glow } });

export const SHAPE_PRESETS: readonly ShapePreset[] = [
  S('shape-klasik', 'Klasik', 'Dengeli köşeler, her temaya uyar', 12, 10, 12, 16, 8, 20),
  S('shape-minimal', 'Minimal', 'Az yuvarlak, gölgesiz, düz', 6, 6, 6, 8, 0, 0),
  S('shape-keskin', 'Keskin', 'Köşesiz teknik düzen', 2, 2, 2, 4, 0, 0),
  S('shape-endustriyel', 'Teknik', 'Hafif pahlı metal plaka', 4, 4, 4, 6, 0, 10),
  S('shape-kokpit', 'Kokpit', 'Gösterge paneli, hafif ışık', 8, 6, 8, 12, 4, 40),
  S('shape-mat', 'Mat', 'Yumuşak köşe, ışımasız', 12, 10, 12, 16, 0, 0),
  S('shape-premium', 'Premium', 'İnce cam, zarif ışık', 14, 12, 14, 18, 16, 20),
  S('shape-yumusak', 'Yumuşak', 'Geniş köşeler, sakin', 18, 14, 18, 22, 10, 20),
  S('shape-cam', 'Buzlu Cam', 'Kalın buzlu cam, derinlik', 16, 12, 16, 20, 24, 30),
  S('shape-kapsul', 'Kapsül', 'Hap düğmeler, oval dock', 20, 32, 20, 32, 8, 20),
  S('shape-oval', 'Oval', 'En yuvarlak kartlar', 24, 20, 24, 28, 8, 20),
  S('shape-gece-isigi', 'Gece Işığı', 'Belirgin vurgu ışıması', 12, 10, 12, 16, 0, 60),
];
