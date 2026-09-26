/** Google'ın güvencesi: elle seçilen yazı rengi sürüşte okunur mu (WCAG 4,5:1). */
import { describe, it, expect } from 'vitest';
import { readabilityOf, ensureReadable, READABLE_MIN_CONTRAST } from '@/lib/theme/colorMath';

describe('okunabilirlik', () => {
  it('gri üstüne gri zor okunur; beyaz üstüne siyah okunur', () => {
    expect(readabilityOf('#777777', '#666666')!).toBeLessThan(READABLE_MIN_CONTRAST);
    expect(readabilityOf('#000000', '#ffffff')!).toBeGreaterThan(20);
  });
  it('tek renge çözülemeyen zemin için karar UYDURULMAZ', () => {
    expect(readabilityOf('#fff', 'linear-gradient(#000,#111)')).toBeNull();
    expect(readabilityOf(null, '#000')).toBeNull();
  });
  it('"Okunur yap" en az 4,5:1 verir, tonu korumaya çalışır', () => {
    for (const [fg, bg] of [['#777777', '#666666'], ['#d4a017', '#f5f0e8'], ['#1e3a8a', '#0f172a']]) {
      const fixed = ensureReadable(fg, bg);
      expect(readabilityOf(fixed, bg)!).toBeGreaterThanOrEqual(READABLE_MIN_CONTRAST);
    }
    expect(ensureReadable('#ffffff', '#000000')).toBe('#ffffff');
  });
});
