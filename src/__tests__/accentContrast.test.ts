/**
 * accentContrast.test — vurgu rengi okunabilirlik kapısı (WCAG metin dışı 3:1).
 */
import { describe, it, expect } from 'vitest';
import { contrastRatio, accentVerdict } from '../platform/theme/accentContrast';

describe('accentContrast', () => {
  it('bilinen oranlar', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBe(21);
    expect(contrastRatio('#fff', '#ffffff')).toBe(1);
    expect(contrastRatio('rgb(0, 0, 0)', '#FFF')).toBe(21);
  });
  it('🔒 koyu zeminde koyu mavi reddedilir, turuncu uygun', () => {
    expect(accentVerdict('#1D4ED8', '#14171F')).toBe('LOW_CONTRAST');
    expect(accentVerdict('#F2871C', '#14171F')).toBe('OK');
  });
  it('🔒 açık zeminde sarı reddedilir', () => {
    expect(accentVerdict('#E0A23C', '#EEF1F5')).toBe('LOW_CONTRAST');
  });
  it('🔒 zemin okunamazsa "uygun" denmez', () => {
    expect(accentVerdict('#F2871C', null)).toBe('UNKNOWN_BACKGROUND');
    expect(accentVerdict('#F2871C', 'linear-gradient(red, blue)')).toBe('UNKNOWN_BACKGROUND');
  });
});

describe('iki kip birden (gündüz + gece)', () => {
  it('🔒 paletteki her renk gündüz ve gece zemininde 3:1 geçer', async () => {
    const { DRIVER_ACCENTS, accentVerdictAllModes } = await import('../platform/theme/accentContrast');
    for (const c of DRIVER_ACCENTS) expect(accentVerdictAllModes(c, '#F4F6FA')).toBe('OK');
  });
  it('🔒 yalnız bir kipte okunan renk reddedilir', async () => {
    const { accentVerdictAllModes } = await import('../platform/theme/accentContrast');
    expect(accentVerdictAllModes('#1D4ED8', '#F4F6FA')).toBe('LOW_CONTRAST');  // gece okunmaz
    expect(accentVerdictAllModes('#F2871C', '#14171F')).toBe('LOW_CONTRAST');  // gündüz okunmaz
  });
});
