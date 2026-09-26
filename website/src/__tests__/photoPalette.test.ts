/** Fotoğraftan tema — Google Material Color Utilities yöntemi (2026-09-26). */
import { describe, it, expect } from 'vitest';
import { extractPhotoColors, palettesFromColor } from '@/lib/theme/photoPalette';
import { contrastRatio, parseColor, rgbToHsv } from '@/lib/theme/colorMath';

/** [r,g,b,oran] bloklarından RGBA piksel dizisi. */
function img(parts: Array<[number, number, number, number]>, n = 2000): Uint8ClampedArray {
  const out: number[] = [];
  for (const [r, g, b, share] of parts) for (let i = 0; i < Math.round(n * share); i++) out.push(r, g, b, 255);
  return new Uint8ClampedArray(out);
}
const cr = (a: string, b: string) => contrastRatio(parseColor(a)!, parseColor(b)!);
const solidOf = (p: unknown) => (p as { from: string }).from;
const hueOf = (hex: string) => rgbToHsv(parseColor(hex)!).h;
const isRed = (hex: string) => { const h = hueOf(hex); return h < 20 || h > 340; };

describe('fotoğraftaki renkler (Google Score)', () => {
  it('mavi gökyüzü + kırmızı araba → İKİSİ de seçenek (tek renge bahis yok)', () => {
    const c = extractPhotoColors(img([[135, 180, 215, 0.6], [190, 25, 30, 0.25], [70, 70, 72, 0.15]]));
    expect(c.length).toBeGreaterThanOrEqual(2);
    expect(c.some((x) => isRed(x.hex))).toBe(true);
    expect(c.some((x) => { const h = hueOf(x.hex); return h > 180 && h < 240; })).toBe(true);
  });
  it('gri/siyah/beyaz fotoğraf → boş (Google mavisi yedeği renk diye SUNULMAZ)', () => {
    expect(extractPhotoColors(img([[128, 128, 128, 0.6], [20, 20, 20, 0.2], [240, 240, 240, 0.2]]))).toEqual([]);
  });
  it('aynı gökyüzünün iki yakın mavi tonu TEK seçenek (yerel deneme)', () => {
    const c = extractPhotoColors(img([[145, 176, 210, 0.3], [133, 175, 197, 0.3], [200, 24, 18, 0.25], [60, 120, 50, 0.15]]));
    const blues = c.filter((x) => { const h = hueOf(x.hex); return h > 180 && h < 240; });
    expect(blues.length).toBe(1);
  });
  it('en fazla 4 renk', () => {
    const c = extractPhotoColors(img([[200, 30, 30, 0.2], [30, 160, 60, 0.2], [30, 70, 200, 0.2], [230, 190, 30, 0.2], [150, 40, 170, 0.2]]));
    expect(c.length).toBeLessThanOrEqual(4);
  });
});

describe('seçilen renkten 4 stil (HCT / Material şemaları)', () => {
  const red = extractPhotoColors(img([[190, 25, 30, 1]]))[0];
  const ps = palettesFromColor(red);
  it('Canlı · Sade · Sürüş · Gündüz', () => {
    expect(ps.map((p) => p.name)).toEqual(['Canlı', 'Sade', 'Sürüş', 'Gündüz']);
  });
  it('her stil sürüşte okunur (hazır taslaklarla aynı eşikler)', () => {
    for (const p of ps) {
      const t = p.tokens;
      const card = solidOf(t.bgCard); const bg = solidOf(t.bgPrimary);
      expect(cr(t.textPrimary!, card), `${p.name} yazı/kart`).toBeGreaterThanOrEqual(7);
      expect(cr(t.textPrimary!, bg), `${p.name} yazı/zemin`).toBeGreaterThanOrEqual(7);
      expect(cr(t.textSecondary!, card), `${p.name} ikincil`).toBeGreaterThanOrEqual(4.5);
      expect(cr(t.accentPrimary!, card), `${p.name} vurgu/kart`).toBeGreaterThanOrEqual(3);
    }
  });
  it('Sürüş: zemin neredeyse renksiz (Google "siyahtan kur"), vurgu kırmızı', () => {
    const surus = ps.find((p) => p.name === 'Sürüş')!;
    const bg = rgbToHsv(parseColor(solidOf(surus.tokens.bgPrimary))!);
    expect(bg.v).toBeLessThan(0.15);
    expect(isRed(surus.tokens.accentPrimary!)).toBe(true);
  });
});
