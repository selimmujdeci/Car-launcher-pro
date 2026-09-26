/**
 * Tema Stüdyo taslakları temayı KOMPLE değiştirir (saha 2026-09-26: taslak seçince
 * yalnız ikon rengi değişiyordu — temalar kartı sabit dokularla çiziyordu).
 * Türetilmiş tonlar yalnız ilgili token set ise yazılır → özelleştirme yoksa görünüm AYNI.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createThemeManifest, manifestToCssVars } from '../platform/theme/themeManifest';

describe('türetilmiş tema tonları', () => {
  it('özelleştirme yoksa hiçbir değişken yazılmaz', () => {
    expect(manifestToCssVars(createThemeManifest('expedition'))).toEqual({});
  });

  it('kart rengi → kabartma/gömme/ışık tonları; kenarlık/zemin → rgb üçlüsü', () => {
    const m = createThemeManifest('tesla');
    m.tokens.bgCard = { kind: 'solid', from: '#203040', to: null, angle: 180, stopA: 0, stopB: 100, alpha: 100 };
    m.tokens.borderColor = '#405060';
    m.tokens.bgPrimary = { kind: 'solid', from: '#101820', to: null, angle: 180, stopA: 0, stopB: 100, alpha: 100 };
    const v = manifestToCssVars(m);
    expect(v['--card-rgb']).toBe('32, 48, 64');
    expect(v['--card-hi']).toBe('#32414f');      // beyaza %8
    expect(v['--card-lo']).toBe('#121a23');      // siyaha %45
    expect(v['--card-sunk']).toBe('#0e161d');
    expect(v['--edge-rgb']).toBe('64, 80, 96');
    expect(v['--bg-rgb']).toBe('16, 24, 32');
  });

  it.each(['ExpeditionLayout', 'HorizonLayout', 'TeslaLayout', 'ProLayout'])(
    '%s kart köşesini ve yüzey tonlarını tokenlardan okur (yedek = eski değer)', (name) => {
      const src = readFileSync(`src/components/themes/${name}.tsx`, 'utf8');
      expect(src).toContain("var(--radius-card,");
      expect(src).toMatch(/var\(--card-(hi|lo|raised|sunk|rgb)/);
      expect(src).toContain('var(--border-color,');
      expect(src).toContain('var(--glow-intensity, 0)');
    });

  it('kart rengi verilip yazı verilmezse yazı ZEMİNE GÖRE otomatik seçilir; açık seçim ezilmez', () => {
    const dark = createThemeManifest('horizon');
    dark.tokens.bgCard = { kind: 'solid', from: '#1a2230', to: null, angle: 180, stopA: 0, stopB: 100, alpha: 100 };
    expect(manifestToCssVars(dark)['--text-primary']).toBe('#F2F4F8');
    const light = createThemeManifest('horizon');
    light.tokens.bgCard = { kind: 'solid', from: '#f2f4f8', to: null, angle: 180, stopA: 0, stopB: 100, alpha: 100 };
    expect(manifestToCssVars(light)['--text-primary']).toBe('#14181F');
    light.tokens.textPrimary = '#ff0000';
    expect(manifestToCssVars(light)['--text-primary']).toBe('#ff0000');
  });
});
