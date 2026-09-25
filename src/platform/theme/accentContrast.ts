/**
 * accentContrast — sürücü vurgu rengi için okunabilirlik kapısı (WCAG 2.x).
 *
 * Vurgu rengi düğme/ikon/çizgi gibi arayüz öğelerinde kullanılır → WCAG 1.4.11
 * "metin dışı kontrast" alt sınırı 3:1. Arka plan okunamazsa (null) renk
 * "uygun" SAYILMAZ; karar verilemediği açıkça döner.
 */

export const MIN_ACCENT_CONTRAST = 3;

/** Araç içinden seçilebilen vurgu renkleri. */
export const DRIVER_ACCENTS: readonly string[] = [
  '#F2871C', '#E0A23C', '#22C55E', '#14B8A6', '#38BDF8', '#5B8DFF', '#A78BFA', '#F472B6', '#EF4444', '#1D4ED8',
];

function parseColor(c: string): [number, number, number] | null {
  const s = c.trim();
  let m = /^#([0-9a-f]{3})$/i.exec(s);
  if (m) return [0, 1, 2].map((i) => parseInt(m![1][i] + m![1][i], 16)) as [number, number, number];
  m = /^#([0-9a-f]{6})$/i.exec(s);
  if (m) return [0, 2, 4].map((i) => parseInt(m![1].slice(i, i + 2), 16)) as [number, number, number];
  m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(s);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  return null;
}

function luminance([r, g, b]: [number, number, number]): number {
  const ch = (v: number) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

/** İki rengin kontrast oranı (1..21); çözülemeyen renkte `null`. */
export function contrastRatio(a: string, b: string): number | null {
  const pa = parseColor(a), pb = parseColor(b);
  if (!pa || !pb) return null;
  const la = luminance(pa), lb = luminance(pb);
  return Math.round(((Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)) * 100) / 100;
}

export type AccentVerdict = 'OK' | 'LOW_CONTRAST' | 'UNKNOWN_BACKGROUND';

export function accentVerdict(accent: string, background: string | null): AccentVerdict {
  if (!background) return 'UNKNOWN_BACKGROUND';
  const r = contrastRatio(accent, background);
  if (r === null) return 'UNKNOWN_BACKGROUND';
  return r >= MIN_ACCENT_CONTRAST ? 'OK' : 'LOW_CONTRAST';
}
