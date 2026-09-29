/**
 * Tema Manifesti — gündüz / gece katmanı (kullanıcı isteği 2026-09-28:
 * "Tema Stüdyo'da düzenleme hem gece hem gündüz için oluyor; gündüz ayrı gece
 * ayrı olmalı").
 *
 * Sözleşme: ortak katman iki modda geçerli; `modeOverrides.day|night` içinde
 * null OLMAYAN alan o modda ortağın üstüne geçer. Şema sürümü yükseltilmez —
 * eski araç alanı tanımaz, raporlar ve ortak katmanı uygular.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  THEME_SCHEMA_VERSION,
  coerceThemeManifest,
  collectUnsupportedKeys,
  createThemeManifest,
  makeSolid,
  parseIncomingManifest,
  resolveManifestForMode,
} from '../platform/theme/themeManifest';
import {
  applyIncomingThemeManifest,
  clearAppliedDom,
  clearStoredManifest,
  getStoredManifest,
  initThemeRuntime,
  __resetThemeRuntimeForTest,
} from '../platform/theme/themeRuntime';
import { useStore } from '../store/useStore';

const accent = () => document.documentElement.style.getPropertyValue('--accent-primary');

function payload(extra: Record<string, unknown> = {}) {
  return {
    schemaVersion: THEME_SCHEMA_VERSION,
    themeId: 'expedition',
    themeVersion: 7,
    tokens: { accentPrimary: '#111111', textPrimary: '#222222' },
    componentOverrides: { 'expedition.clock': { radius: 20, textColor: '#333333' } },
    screenOverrides: {},
    layoutOverrides: {},
    zoneWidths: {},
    metadata: { name: 'Test', origin: 'pwa-studio', updatedAt: null },
    ...extra,
  };
}

describe('mod çözümü (resolveManifestForMode)', () => {
  it('katman yoksa manifest AYNEN döner (bugünkü davranış)', () => {
    const m = coerceThemeManifest(payload());
    expect(m.modeOverrides).toEqual({});
    expect(resolveManifestForMode(m, 'day')).toBe(m);
    expect(resolveManifestForMode(m, 'night')).toBe(m);
  });

  it('alan düzeyinde birleşir: katmanda dolu alan kazanır, boş alan ortağı korur', () => {
    const m = coerceThemeManifest(payload({
      modeOverrides: {
        day: {
          tokens: { accentPrimary: '#AAAAAA' },
          componentOverrides: {
            'expedition.clock': { textColor: '#BBBBBB', states: { active: { opacity: 50 } } },
            'expedition.map': { radius: 8 },
          },
        },
      },
    }));
    const day = resolveManifestForMode(m, 'day');
    expect(day.tokens.accentPrimary).toBe('#AAAAAA');
    expect(day.tokens.textPrimary).toBe('#222222');                     // ortak korunur
    expect(day.componentOverrides['expedition.clock'].textColor).toBe('#BBBBBB');
    expect(day.componentOverrides['expedition.clock'].radius).toBe(20);  // ortak korunur
    expect(day.componentOverrides['expedition.clock'].states?.active?.opacity).toBe(50);
    expect(day.componentOverrides['expedition.map'].radius).toBe(8);
    const night = resolveManifestForMode(m, 'night');
    expect(night.tokens.accentPrimary).toBe('#111111');
    expect(night.componentOverrides['expedition.map']).toBeUndefined();
    // Yerleşim ve meta ortak katmandan aynen
    expect(day.layoutOverrides).toBe(m.layoutOverrides);
    expect(day.metadata).toBe(m.metadata);
  });

  it('boş katman taşınmaz; bilinmeyen mod düşer', () => {
    const m = coerceThemeManifest(payload({ modeOverrides: { day: { tokens: {} }, evening: { tokens: { accentPrimary: '#FFFFFF' } } } }));
    expect(m.modeOverrides).toEqual({});
  });

  it('boya (Paint) katmanda da yapısal kalır', () => {
    const m = createThemeManifest('pro');
    m.modeOverrides = { night: { tokens: { ...m.tokens, bgPrimary: makeSolid('#000000') }, componentOverrides: {}, screenOverrides: {} } };
    const back = coerceThemeManifest(JSON.parse(JSON.stringify(m)));
    expect(resolveManifestForMode(back, 'night').tokens.bgPrimary?.from).toBe('#000000');
    expect(resolveManifestForMode(back, 'day').tokens.bgPrimary).toBeNull();
  });
});

describe('taşıma kapısı (fail-closed)', () => {
  it('şema sürümü YÜKSELMEDİ: eski araç paketi reddetmez', () => {
    expect(THEME_SCHEMA_VERSION).toBe(3);
  });

  it('bozuk modeOverrides reddedilir', () => {
    expect(parseIncomingManifest(payload({ modeOverrides: 'x' })).ok).toBe(false);
    expect(parseIncomingManifest(payload({ modeOverrides: { day: 5 } })).ok).toBe(false);
    expect(parseIncomingManifest(payload({ modeOverrides: { night: { tokens: 'x' } } })).ok).toBe(false);
    expect(parseIncomingManifest(payload({ modeOverrides: { day: { tokens: { accentPrimary: '#ABCDEF' } } } })).ok).toBe(true);
  });

  it('modeOverrides tanınan anahtar; katmandaki bilinmeyen stil alanı raporlanır', () => {
    expect(collectUnsupportedKeys(payload({ modeOverrides: {} }))).toEqual([]);
    expect(collectUnsupportedKeys(payload({
      modeOverrides: { night: { componentOverrides: { 'expedition.clock': { yeniAlan: 1 } } } },
    }))).toEqual(['yeniAlan']);
  });
});

describe('araç: o anki moda göre uygular, mod değişince yeniden uygular', () => {
  beforeEach(() => {
    __resetThemeRuntimeForTest();
    clearAppliedDom();
    for (const id of ['expedition', 'horizon', 'tesla', 'pro'] as const) clearStoredManifest(id);
    document.documentElement.removeAttribute('style');
  });

  it('gündüz rengi gündüzde, gece rengi gecede; saklanan TAM manifesttir', () => {
    useStore.getState().updateSettings({ dayNightMode: 'night' });
    initThemeRuntime();
    const r = applyIncomingThemeManifest(payload({
      modeOverrides: { day: { tokens: { accentPrimary: '#FFAA00' } }, night: { tokens: { accentPrimary: '#0055FF' } } },
    }), 'command');
    expect(r.ok).toBe(true);
    expect(r.unsupportedKeys).toEqual([]);
    expect(accent()).toBe('#0055FF');

    useStore.getState().updateSettings({ dayNightMode: 'day' });
    expect(accent()).toBe('#FFAA00');
    useStore.getState().updateSettings({ dayNightMode: 'night' });
    expect(accent()).toBe('#0055FF');

    const stored = getStoredManifest('expedition')!;
    expect(stored.tokens.accentPrimary).toBe('#111111');
    expect(stored.modeOverrides.day?.tokens.accentPrimary).toBe('#FFAA00');
  });

  it('mod katmanı olmayan eski paket iki modda da aynı', () => {
    useStore.getState().updateSettings({ dayNightMode: 'day' });
    initThemeRuntime();
    applyIncomingThemeManifest(payload(), 'command');
    expect(accent()).toBe('#111111');
    useStore.getState().updateSettings({ dayNightMode: 'night' });
    expect(accent()).toBe('#111111');
  });
});
