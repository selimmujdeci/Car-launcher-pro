/**
 * themeAccentOemTokens.test — vurgu rengi OEM tasarım sistemine de yansır
 * (telefon smoke 2026-09-25: yalnız eski değişkenler değişiyordu).
 */
import { describe, it, expect } from 'vitest';
import { createThemeManifest, manifestToCssVars, ALL_MANAGED_CSS_VARS } from '../platform/theme/themeManifest';

const withAccent = (c: string) => {
  const m = createThemeManifest('expedition');
  return manifestToCssVars({ ...m, tokens: { ...m.tokens, accentPrimary: c } });
};

describe('vurgu → OEM tokenları', () => {
  it('--oem-accent ve yumuşak/parıltı türevleri yazılır', () => {
    const v = withAccent('#1C7ED6');
    expect(v['--oem-accent']).toBe('#1C7ED6');
    expect(v['--oem-accent-soft']).toBe('rgba(28, 126, 214, 0.18)');
    expect(v['--oem-accent-glow']).toBe('rgba(28, 126, 214, 0.34)');
  });
  it('🔒 vurgu zemindeki yazı rengi okunur: koyu vurguda beyaz, açıkta koyu', () => {
    expect(withAccent('#4F6BED')['--oem-accent-ink']).toBe('#FFFFFF');
    expect(withAccent('#F2C94C')['--oem-accent-ink']).toBe('#1A140A');
  });
  it('🔒 yeni değişkenler yönetilen listede (tema değişince temizlenir)', () => {
    for (const k of ['--oem-accent', '--oem-accent-soft', '--oem-accent-glow', '--oem-accent-ink']) {
      expect(ALL_MANAGED_CSS_VARS).toContain(k);
    }
  });
  it('vurgu yoksa OEM tokenlarına dokunulmaz (tema rengi kalır)', () => {
    const m = createThemeManifest('expedition');
    expect(manifestToCssVars(m)['--oem-accent']).toBeUndefined();
  });
});
