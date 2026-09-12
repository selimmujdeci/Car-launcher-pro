/**
 * colorMath.ts — renk dönüşümlerinin SAF matematiği (Tema Stüdyo).
 *
 * ── NEDEN AYRI DOSYA ────────────────────────────────────────────────────────
 * Kullanıcı: *"renkler yeterli değil sınırsız renk lazım ve yazılarda da renk
 * az."* Sınırsız renk için gerçek bir seçici (HSV alanı + ton + saydamlık)
 * gerekiyor; o seçicinin matematiği React'ten ve DOM'dan BAĞIMSIZ olmalı ki
 * test edilebilsin. Bu dosya yalnız sayıdır: **I/O YOK · DOM YOK · React YOK ·
 * `Date.now` YOK · modül durumu YOK.**
 *
 * Manifest sözleşmesi (`themeManifest.isSafeColor`) `#RGB · #RGBA · #RRGGBB ·
 * #RRGGBBAA · rgb()/rgba() · hsl()/hsla()` kabul eder — yani saydamlık ZATEN
 * destekleniyordu; eksik olan tek şey arayüzdü. Bu modül o üç biçimi de OKUR,
 * ama yalnız hex ÜRETİR (tek kanonik yazım; kıyaslama ve `===` güvenli kalır).
 */

export interface Rgba {
  /** 0–255 */
  r: number;
  /** 0–255 */
  g: number;
  /** 0–255 */
  b: number;
  /** 0–1 */
  a: number;
}

export interface Hsva {
  /** 0–360 */
  h: number;
  /** 0–1 */
  s: number;
  /** 0–1 */
  v: number;
  /** 0–1 */
  a: number;
}

const clamp = (n: number, lo: number, hi: number) => (n < lo ? lo : n > hi ? hi : n);
const round255 = (n: number) => clamp(Math.round(n), 0, 255);

/** 0–1 alfayı en çok 3 basamağa yuvarla (kayan nokta gürültüsü yazıya sızmasın). */
export function normalizeAlpha(a: number): number {
  if (!Number.isFinite(a)) return 1;
  return clamp(Math.round(a * 1000) / 1000, 0, 1);
}

function hex2(n: number): string {
  return round255(n).toString(16).padStart(2, '0');
}

/**
 * Herhangi bir desteklenen yazımı RGBA'ya çevir. Tanınmayan girdi `null`
 * döner — UYDURMA renk üretilmez (kanıtsız bilgi yasağı).
 */
export function parseColor(input: string | null | undefined): Rgba | null {
  if (typeof input !== 'string') return null;
  const s = input.trim().toLowerCase();
  if (s.length === 0) return null;

  // ── hex ──
  if (s.charCodeAt(0) === 35 /* # */) {
    const h = s.slice(1);
    if (!/^[0-9a-f]+$/.test(h)) return null;
    if (h.length === 3 || h.length === 4) {
      const r = parseInt(h[0] + h[0], 16);
      const g = parseInt(h[1] + h[1], 16);
      const b = parseInt(h[2] + h[2], 16);
      const a = h.length === 4 ? parseInt(h[3] + h[3], 16) / 255 : 1;
      return { r, g, b, a: normalizeAlpha(a) };
    }
    if (h.length === 6 || h.length === 8) {
      const r = parseInt(h.slice(0, 2), 16);
      const g = parseInt(h.slice(2, 4), 16);
      const b = parseInt(h.slice(4, 6), 16);
      const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
      return { r, g, b, a: normalizeAlpha(a) };
    }
    return null;
  }

  // ── rgb() / rgba() ──
  const rgb = /^rgba?\(([^)]+)\)$/.exec(s);
  if (rgb) {
    const parts = rgb[1].split(',').map((x) => x.trim());
    if (parts.length < 3 || parts.length > 4) return null;
    const n = parts.map(Number);
    if (n.slice(0, 3).some((x) => !Number.isFinite(x))) return null;
    const a = parts.length === 4 ? Number(parts[3]) : 1;
    if (!Number.isFinite(a)) return null;
    return { r: round255(n[0]), g: round255(n[1]), b: round255(n[2]), a: normalizeAlpha(a) };
  }

  // ── hsl() / hsla() ──
  const hsl = /^hsla?\(([^)]+)\)$/.exec(s);
  if (hsl) {
    const parts = hsl[1].split(',').map((x) => x.trim());
    if (parts.length < 3 || parts.length > 4) return null;
    const h = Number(parts[0]);
    const sPct = Number(parts[1].replace('%', ''));
    const lPct = Number(parts[2].replace('%', ''));
    const a = parts.length === 4 ? Number(parts[3]) : 1;
    if (![h, sPct, lPct, a].every(Number.isFinite)) return null;
    return hslToRgba(h, sPct / 100, lPct / 100, normalizeAlpha(a));
  }

  return null;
}

/** HSL → RGBA (yalnız `parseColor` için; arayüz HSV kullanır). */
export function hslToRgba(h: number, s: number, l: number, a = 1): Rgba {
  const hh = ((h % 360) + 360) % 360;
  const ss = clamp(s, 0, 1);
  const ll = clamp(l, 0, 1);
  const c = (1 - Math.abs(2 * ll - 1)) * ss;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = ll - c / 2;
  let r = 0, g = 0, b = 0;
  if (hh < 60) { r = c; g = x; }
  else if (hh < 120) { r = x; g = c; }
  else if (hh < 180) { g = c; b = x; }
  else if (hh < 240) { g = x; b = c; }
  else if (hh < 300) { r = x; b = c; }
  else { r = c; b = x; }
  return { r: round255((r + m) * 255), g: round255((g + m) * 255), b: round255((b + m) * 255), a: normalizeAlpha(a) };
}

/** RGBA → hex. Alfa 1 ise 6 hane, değilse 8 hane (kanonik tek yazım). */
export function rgbaToHex(c: Rgba): string {
  const base = `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`;
  const a = normalizeAlpha(c.a);
  return a >= 1 ? base : `${base}${hex2(a * 255)}`;
}

export function rgbToHsv(c: Rgba): Hsva {
  const r = c.r / 255, g = c.g / 255, b = c.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  return { h, s, v: max, a: normalizeAlpha(c.a) };
}

export function hsvToRgb(c: Hsva): Rgba {
  const h = ((c.h % 360) + 360) % 360;
  const s = clamp(c.s, 0, 1);
  const v = clamp(c.v, 0, 1);
  const i = Math.floor(h / 60) % 6;
  const f = h / 60 - Math.floor(h / 60);
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  let r = 0, g = 0, b = 0;
  switch (i) {
    case 0: r = v; g = t; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    default: r = v; g = p; b = q; break;
  }
  return { r: round255(r * 255), g: round255(g * 255), b: round255(b * 255), a: normalizeAlpha(c.a) };
}

/** Kolaylık: herhangi bir yazımdan HSV'ye. Tanınmazsa `null`. */
export function parseToHsv(input: string | null | undefined): Hsva | null {
  const rgba = parseColor(input);
  return rgba === null ? null : rgbToHsv(rgba);
}

/** Kolaylık: HSV'den kanonik hex'e. */
export function hsvToHex(c: Hsva): string {
  return rgbaToHex(hsvToRgb(c));
}

/* ── Okunabilirlik ölçümü (yazı renkleri için) ───────────────────────────── */

function lin(c8: number): number {
  const c = c8 / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** WCAG bağıl parlaklık (0–1). Alfa YOK SAYILIR — zemin bilinmeden karıştırılamaz. */
export function relativeLuminance(c: Rgba): number {
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
}

/** WCAG kontrast oranı (1–21). */
export function contrastRatio(a: Rgba, b: Rgba): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Nötr yazı rampası — açıktan koyuya, algısal olarak eşit adımlı.
 *
 * NEDEN VAR: kullanıcı *"yazılarda da renk az"* dedi. Mevcut 16 hazır renk
 * ağırlıkla VURGU renkleriydi; yazı için gereken şey ton değil, DOĞRU
 * PARLAKLIKTA nötr bir tondur (ve gövde metninde çoğu zaman doğru cevap
 * gri tonlarından biridir). Rampa gri değerlerini sabit adımlarla değil,
 * parlaklık algısına göre seyreltir.
 */
export const NEUTRAL_TEXT_RAMP: readonly string[] = [
  '#FFFFFF', '#F3F5F9', '#E2E6EE', '#CBD2DE',
  '#AEB6C4', '#8F97A6', '#6F7788', '#525A6B',
  '#3A4150', '#262C38', '#161A22', '#000000',
] as const;
