/**
 * Tema Stüdyo hazır taslakları — her tema ≥10 renk taslağı, ayrı şekil
 * taslakları; hepsi okunur ve manifest doğrulamasından DEĞİŞMEDEN geçer.
 */
import { describe, it, expect } from 'vitest';
import { colorPresetsFor, SHAPE_PRESETS, screenPatchOf } from '../lib/theme/themePresets';
import { THEME_BASE_IDS, coerceTokens, EMPTY_TOKENS, isSafeColor } from '../lib/theme/themeManifest';
import { contrastRatio, parseColor } from '../lib/theme/colorMath';

const cr = (a: string, b: string): number => contrastRatio(parseColor(a)!, parseColor(b)!);

describe('renk taslakları', () => {
  it.each(THEME_BASE_IDS)('%s: 10-15 taslak, kimlikler tekil', (id) => {
    const ps = colorPresetsFor(id);
    expect(ps.length).toBeGreaterThanOrEqual(10);
    expect(ps.length).toBeLessThanOrEqual(15);
    expect(new Set(ps.map((p) => p.id)).size).toBe(ps.length);
    expect(ps.some((p) => p.mode === 'day')).toBe(true);
  });

  const all = THEME_BASE_IDS.flatMap((id) => colorPresetsFor(id).map((p) => [id, p] as const));

  it.each(all)('%s · %o okunur', (_id, p) => {
    const t = p.tokens;
    const card = t.bgCard!.from;
    const bg = t.bgPrimary!.from;
    expect(cr(t.textPrimary!, card), 'yazı/kart').toBeGreaterThanOrEqual(7);
    expect(cr(t.textPrimary!, bg), 'yazı/zemin').toBeGreaterThanOrEqual(7);
    expect(cr(t.textSecondary!, card), 'ikincil yazı/kart').toBeGreaterThanOrEqual(4.5);
    expect(cr(t.accentPrimary!, card), 'vurgu/kart').toBeGreaterThanOrEqual(3);
  });

  it.each(all)('%s · %o manifest doğrulamasından değişmeden geçer', (_id, p) => {
    const coerced = coerceTokens({ ...EMPTY_TOKENS, ...p.tokens });
    for (const [k, v] of Object.entries(p.tokens)) {
      expect((coerced as unknown as Record<string, unknown>)[k], k).toEqual(v);
    }
    for (const c of p.swatch) expect(isSafeColor(c)).toBe(true);
  });

  it('tek ekrana uygulanan kısım yalnız ekran alanlarını taşır', () => {
    const p = colorPresetsFor('horizon')[1];
    expect(Object.keys(screenPatchOf(p)).sort()).toEqual(['accentPrimary', 'bg', 'textPrimary', 'textSecondary']);
  });
});

describe('kart şekli taslakları', () => {
  it('10-15 şekil, geometri manifest sınırlarında', () => {
    expect(SHAPE_PRESETS.length).toBeGreaterThanOrEqual(10);
    for (const s of SHAPE_PRESETS) {
      const coerced = coerceTokens({ ...EMPTY_TOKENS, ...s.tokens });
      for (const [k, v] of Object.entries(s.tokens)) {
        expect((coerced as unknown as Record<string, unknown>)[k], `${s.id}.${k}`).toBe(v);
      }
      // Şekil taslağı RENGE dokunmaz.
      expect(Object.keys(s.tokens).some((k) => /color|accent|text|bg/i.test(k))).toBe(false);
    }
  });
});
