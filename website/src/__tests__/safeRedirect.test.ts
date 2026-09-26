/** safeRedirect.test — giriş `next` parametresi açık yönlendirme üretemez. */
import { describe, it, expect } from 'vitest';
import { safeNextPath } from '@/lib/safeRedirect';

describe('safeNextPath', () => {
  it('kendi kökümüzdeki göreli yolu geçirir', () => {
    expect(safeNextPath('/kumanda')).toBe('/kumanda');
    expect(safeNextPath('/kumanda?tab=1#x')).toBe('/kumanda?tab=1#x');
  });
  it('🔒 dış siteye götüren her biçimi reddeder', () => {
    for (const bad of ['//evil.com', '/\\evil.com', '/\\/evil.com', 'https://evil.com',
      'evil.com', '/ok\\..\\evil', '/\t/evil.com', '/\n/evil.com', '', null, undefined]) {
      expect(safeNextPath(bad as string)).toBe('/dashboard');
    }
  });
  it('geri dönüş değeri verilebilir', () => {
    expect(safeNextPath('//x', '/kumanda')).toBe('/kumanda');
  });
});
