/**
 * #659 — "ARAÇ BU ALANI TANIMIYOR" raporu + genişletilmiş durum stilleri.
 *
 * ── KAPATILAN BOŞLUK ──────────────────────────────────────────────────────
 * Manifest şema sürümü BİLEREK yükseltilmiyor: yükseltilseydi eski APK'lı araç
 * `sv > VERSION` kapısında manifestin TAMAMINI reddeder ve tema komple ölürdü
 * (#654). Bunun bedeli, yeni bir stil alanının eski araçta SESSİZCE düşmesiydi —
 * kullanıcı Stüdyo'da bulanıklığı açıyor, araçta hiçbir şey olmuyor ve hiçbir
 * yerde sebebi yazmıyordu.
 *
 * Artık araç tanımadığı alanların ADLARINI ölçüp bildiriyor. Bu kilitler o
 * raporun dürüstlüğünü korur: sahte "hepsi tamam" YOK, kullanıcı verisi YOK.
 */
import { describe, it, expect } from 'vitest';
import {
  collectUnsupportedKeys,
  componentStyleToCss,
  coerceStateStyle,
  EMPTY_COMPONENT_STYLE,
  EMPTY_STATE_STYLE,
  THEME_SCHEMA_VERSION,
} from '../platform/theme/themeManifest';

describe('tanınmayan alan raporu', () => {
  it('KİLİT: bilinen manifest hiçbir alanı "tanınmıyor" diye işaretlemez', () => {
    const m = {
      schemaVersion: THEME_SCHEMA_VERSION,
      themeId: 'pro',
      themeVersion: 3,
      tokens: {},
      componentOverrides: { 'pro.clock': { bg: null, radius: 12 } },
      screenOverrides: {},
      layoutOverrides: {},
      zoneWidths: { 'left-rail': 1.2 },
      metadata: {},
    };
    expect(collectUnsupportedKeys(m), 'geçerli alanlar "tanınmıyor" sayıldı — yalancı uyarı').toEqual([]);
  });

  it('KİLİT: GELECEKTEN gelen alan yakalanır (asıl senaryo)', () => {
    const m = {
      schemaVersion: THEME_SCHEMA_VERSION,
      themeId: 'pro',
      componentOverrides: {
        'pro.clock': { radius: 12, holograficParlaklik: 3 },
      },
      gelecekBolumu: {},
    };
    const k = collectUnsupportedKeys(m);
    expect(k, 'bileşen içindeki bilinmeyen alan kaçtı').toContain('holograficParlaklik');
    expect(k, 'kök seviyedeki bilinmeyen alan kaçtı').toContain('gelecekBolumu');
  });

  it('KİLİT: durum içindeki bilinmeyen alan da yakalanır ve etiketlenir', () => {
    const k = collectUnsupportedKeys({
      componentOverrides: { 'pro.clock': { states: { active: { titresim: 4 } } } },
    });
    expect(k).toContain('states.titresim');
  });

  it('KİLİT: rapor YALNIZ anahtar adı taşır — kullanıcı DEĞERİ sızmaz', () => {
    const k = collectUnsupportedKeys({
      componentOverrides: { 'pro.clock': { gizliAlan: 'KULLANICI-SIRRI-42' } },
    });
    expect(k).toContain('gizliAlan');
    expect(k.join('|'), 'değer rapora sızmış — gizlilik kuralı 6 ihlali')
      .not.toContain('KULLANICI-SIRRI-42');
  });

  it('KİLİT: liste tavanlıdır (defter şişmez)', () => {
    const stil: Record<string, unknown> = {};
    for (let i = 0; i < 60; i++) stil[`bilinmeyen${i}`] = 1;
    const k = collectUnsupportedKeys({ componentOverrides: { 'pro.clock': stil } });
    expect(k.length).toBeLessThanOrEqual(12);
  });

  it('KİLİT: bozuk girdi çökertmez (zero-trust)', () => {
    expect(collectUnsupportedKeys(null)).toEqual([]);
    expect(collectUnsupportedKeys('metin')).toEqual([]);
    expect(collectUnsupportedKeys({ componentOverrides: 'bozuk' })).toEqual([]);
  });
});

describe('genişletilmiş durum stilleri', () => {
  it('KİLİT: durum başına kenarlık/köşe/parıltı uygulanır', () => {
    const css = componentStyleToCss('pro.clock', {
      ...EMPTY_COMPONENT_STYLE,
      accentColor: '#00FF00',
      states: {
        active: { ...EMPTY_STATE_STYLE, borderWidth: 3, radius: 24, glowLevel: 2 },
      },
    });
    expect(css).toMatch(/border-width:\s*3px/);
    expect(css).toMatch(/border-radius:\s*24px/);
    expect(css, 'parıltı yazılmadı — durum çeşidi eksik kaldı').toMatch(/box-shadow:/);
  });

  it('KİLİT: parıltı için renk YOKSA sahte gölge yazılmaz', () => {
    const css = componentStyleToCss('pro.clock', {
      ...EMPTY_COMPONENT_STYLE,
      states: { active: { ...EMPTY_STATE_STYLE, glowLevel: 2 } },
    });
    expect(css, 'renksiz parıltı yazılmış — kaynaksız efekt').not.toMatch(/box-shadow:/);
  });

  it('KİLİT: yeni alanlar normalleştiriciden geçer ve sınırlanır', () => {
    const st = coerceStateStyle({ borderWidth: 99, radius: -5, glowLevel: 7 });
    expect(st.borderWidth).toBe(6);
    expect(st.radius).toBe(0);
    expect(st.glowLevel).toBe(3);
  });

  it('KİLİT: yalnız yeni alanı olan durum BOŞ sayılmaz (sessizce düşmez)', () => {
    const css = componentStyleToCss('pro.clock', {
      ...EMPTY_COMPONENT_STYLE,
      states: { active: { ...EMPTY_STATE_STYLE, radius: 20 } },
    });
    expect(css, 'yalnız köşe içeren durum düşürülmüş — isEmptyState eski alan listesinde kalmış')
      .toMatch(/border-radius:\s*20px/);
  });
});
