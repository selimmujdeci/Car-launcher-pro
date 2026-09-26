/** Fotoğraftan tema — renk çıkarma + okunur palet (2026-09-26). */
import { describe, it, expect } from 'vitest';
import { extractPhotoColors, palettesFromPhoto } from '@/lib/theme/photoPalette';
import { contrastRatio, parseColor } from '@/lib/theme/colorMath';

/** [r,g,b,oran] bloklarından RGBA piksel dizisi. */
function img(parts: Array<[number, number, number, number]>, n = 1000): Uint8ClampedArray {
  const out: number[] = [];
  for (const [r, g, b, share] of parts) for (let i = 0; i < Math.round(n * share); i++) out.push(r, g, b, 255);
  return new Uint8ClampedArray(out);
}
const cr = (a: string, b: string) => contrastRatio(parseColor(a)!, parseColor(b)!);
const solidOf = (p: unknown) => (p as { from: string }).from;

describe('baskın renk', () => {
  it('küçük ama canlı kırmızı araba, geniş soluk gökyüzünü yener', () => {
    const c = extractPhotoColors(img([[200, 20, 25, 0.2], [170, 190, 205, 0.5], [60, 60, 60, 0.3]]));
    expect(c.length).toBeGreaterThan(0);
    expect(c[0].hue < 20 || c[0].hue > 340).toBe(true);
  });
  it('geniş, orta doygun mavi gökyüzü + daha küçük kırmızı araba → KIRMIZI (yerel deneme 2026-09-26)', () => {
    const c = extractPhotoColors(img([[135, 180, 215, 0.6], [190, 25, 30, 0.25], [70, 70, 72, 0.15]]));
    expect(c[0].hue < 20 || c[0].hue > 340).toBe(true);
  });
  it('gri/siyah/beyaz fotoğrafta belirgin renk YOK → boş (zorlama tema üretilmez)', () => {
    expect(extractPhotoColors(img([[128, 128, 128, 0.6], [20, 20, 20, 0.2], [240, 240, 240, 0.2]]))).toEqual([]);
    expect(palettesFromPhoto([])).toEqual([]);
  });
  it('komşu tonlar tek renk sayılır; farklı renkler ayrı gelir', () => {
    const c = extractPhotoColors(img([[210, 30, 30, 0.3], [220, 50, 40, 0.3], [30, 90, 200, 0.3]]));
    expect(c.length).toBe(2);
  });
});

describe('fotoğraftan 4 palet', () => {
  const ps = palettesFromPhoto(extractPhotoColors(img([[20, 110, 60, 0.4], [230, 180, 40, 0.2], [90, 90, 90, 0.4]])));
  it('Canlı · Sade · Gece · Gündüz', () => {
    expect(ps.map((p) => p.name)).toEqual(['Canlı', 'Sade', 'Gece', 'Gündüz']);
  });
  it('her palet sürüşte okunur (hazır taslaklarla aynı eşikler)', () => {
    for (const p of ps) {
      const t = p.tokens;
      const card = solidOf(t.bgCard); const bg = solidOf(t.bgPrimary);
      expect(cr(t.textPrimary!, card), `${p.name} yazı/kart`).toBeGreaterThanOrEqual(7);
      expect(cr(t.textPrimary!, bg), `${p.name} yazı/zemin`).toBeGreaterThanOrEqual(7);
      expect(cr(t.textSecondary!, card), `${p.name} ikincil`).toBeGreaterThanOrEqual(4.5);
      expect(cr(t.accentPrimary!, card), `${p.name} vurgu/kart`).toBeGreaterThanOrEqual(3);
    }
  });
});
