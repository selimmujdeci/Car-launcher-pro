/**
 * Tema Manifesti v2 — sözleşme kilitleri.
 *
 * Kilitlenen davranışlar:
 *  - 4 GERÇEK tema (expedition/horizon/tesla/pro) manifest sözleşmesinde VAR.
 *  - NULL = DOKUNMA: hiç özelleştirme yoksa tek bir CSS değişkeni bile üretilmez
 *    (araç görünümü aynen kalır).
 *  - Fail-CLOSED taşıma: bozuk/ileri şema REDDEDİLİR, sebebiyle birlikte.
 *  - Fail-SOFT depo: bozuk yerel veri THROW ETMEZ, clamp'lenir.
 *  - CSS injection yapısal olarak imkânsız (renkler allowlist; CSS metni üretilir).
 */

import { describe, it, expect } from 'vitest';
import {
  coerceComponentStyle,
  coerceThemeManifest,
  colorToRgbTriplet,
  componentStyleToCss,
  createThemeManifest,
  EMPTY_COMPONENT_STYLE,
  isSafeColor,
  isSafeComponentId,
  makeSolid,
  manifestToCss,
  manifestToCssVars,
  migrateLegacyThemeVars,
  paintToCss,
  parseIncomingManifest,
  parseThemeManifestJson,
  screenOverrideToCss,
  serializeThemeManifest,
  THEME_BASE_IDS,
  THEME_PRESETS,
  THEME_SCHEMA_VERSION,
  type ComponentStyle,
} from '../platform/theme/themeManifest';

describe('themeManifest — 4 gerçek tema', () => {
  it('tam olarak 4 baz tema vardır ve hepsinin hazır tanımı bulunur', () => {
    expect(THEME_BASE_IDS).toEqual(['expedition', 'horizon', 'tesla', 'pro']);
    for (const id of THEME_BASE_IDS) {
      const p = THEME_PRESETS[id];
      expect(p.id).toBe(id);
      expect(p.label.length).toBeGreaterThan(0);
      // Hazır palet değerleri GERÇEK renk olmalı (uydurma metin değil)
      expect(isSafeColor(p.base.accentPrimary)).toBe(true);
      expect(isSafeColor(p.base.bgPrimary)).toBe(true);
      expect(isSafeColor(p.base.textPrimary)).toBe(true);
    }
  });

  it('araç uygulamasındaki tema id\'leriyle aynı adları kullanır', () => {
    // useCarTheme.CORE_THEMES içindeki render edilebilir 4 tema.
    expect(new Set(THEME_BASE_IDS)).toEqual(new Set(['pro', 'tesla', 'expedition', 'horizon']));
  });
});

describe('themeManifest — NULL = DOKUNMA', () => {
  it('yeni manifest hiçbir CSS değişkeni üretmez', () => {
    for (const id of THEME_BASE_IDS) {
      const m = createThemeManifest(id);
      expect(Object.keys(manifestToCssVars(m))).toHaveLength(0);
      expect(manifestToCss(m)).toBe('');
    }
  });

  it('tek bir token verilince yalnız ona bağlı değişkenler çıkar', () => {
    const m = createThemeManifest('pro');
    m.tokens.accentPrimary = '#FF0000';
    const vars = manifestToCssVars(m);
    expect(vars['--accent-primary']).toBe('#FF0000');
    expect(vars['--accent-rgb']).toBe('255, 0, 0');
    expect(vars['--bg-primary']).toBeUndefined();
    expect(vars['--text-primary']).toBeUndefined();
  });
});

describe('themeManifest — fail-CLOSED taşıma kapısı', () => {
  it('nesne olmayan girdi reddedilir', () => {
    for (const bad of [null, undefined, 42, 'x', [], true]) {
      const r = parseIncomingManifest(bad);
      expect(r.ok).toBe(false);
    }
  });

  it('schemaVersion eksikse reddedilir', () => {
    const r = parseIncomingManifest({ themeId: 'pro' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('schemaVersion');
  });

  it('ileri şema sürümü reddedilir (araç uydurmaz)', () => {
    const r = parseIncomingManifest({ schemaVersion: 99, themeId: 'pro' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('ileri şema');
  });

  it('bilinmeyen themeId reddedilir', () => {
    const r = parseIncomingManifest({ schemaVersion: 2, themeId: 'dark' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('themeId');
  });

  it('tokens nesne değilse reddedilir', () => {
    const r = parseIncomingManifest({ schemaVersion: 2, themeId: 'pro', tokens: 'kırmızı' });
    expect(r.ok).toBe(false);
  });

  it('geçerli manifest kabul edilir ve clamp\'lenir', () => {
    const r = parseIncomingManifest({
      schemaVersion: 2,
      themeId: 'horizon',
      themeVersion: 7,
      tokens: { accentPrimary: '#00FF00', radiusCard: 9999 },
      componentOverrides: {},
      screenOverrides: {},
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.manifest.themeId).toBe('horizon');
      expect(r.manifest.themeVersion).toBe(7);
      expect(r.manifest.tokens.radiusCard).toBe(48); // üst sınıra clamp
    }
  });

  it('bozuk JSON metni reddedilir (parse hatası sessizce yutulmaz)', () => {
    const r = parseThemeManifestJson('{bu json değil');
    expect(r.ok).toBe(false);
  });

  it('round-trip: serialize → parse aynı içeriği verir', () => {
    const m = createThemeManifest('tesla');
    m.tokens.accentPrimary = '#123456';
    m.componentOverrides['tesla.clock'] = { ...EMPTY_COMPONENT_STYLE, radius: 24 };
    const r = parseThemeManifestJson(serializeThemeManifest(m));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.manifest.tokens.accentPrimary).toBe('#123456');
      expect(r.manifest.componentOverrides['tesla.clock'].radius).toBe(24);
    }
  });
});

describe('themeManifest — fail-SOFT yerel depo', () => {
  it('tamamen bozuk girdi varsayılan manifest üretir, THROW ETMEZ', () => {
    for (const bad of [null, 0, 'x', [], { themeId: 'yok' }]) {
      expect(() => coerceThemeManifest(bad)).not.toThrow();
      expect(coerceThemeManifest(bad).schemaVersion).toBe(THEME_SCHEMA_VERSION);
    }
  });

  it('geçersiz renk override\'ı DÜŞÜRÜLÜR (ham metin geçmez)', () => {
    const m = coerceThemeManifest({
      themeId: 'pro',
      tokens: { accentPrimary: 'red; } body { display:none } .x{color:blue' },
    });
    expect(m.tokens.accentPrimary).toBeNull();
  });

  it('boş bileşen override\'ı manifest\'e yazılmaz', () => {
    const m = coerceThemeManifest({
      themeId: 'pro',
      componentOverrides: { 'pro.clock': {} },
    });
    expect(m.componentOverrides['pro.clock']).toBeUndefined();
  });
});

describe('themeManifest — CSS injection kapalı', () => {
  it('güvenli renk allowlist\'i yalnız hex/rgb/hsl kabul eder', () => {
    expect(isSafeColor('#fff')).toBe(true);
    expect(isSafeColor('#AABBCCDD')).toBe(true);
    expect(isSafeColor('rgb(1,2,3)')).toBe(true);
    expect(isSafeColor('rgba(1, 2, 3, 0.5)')).toBe(true);
    expect(isSafeColor('hsl(200, 50%, 40%)')).toBe(true);
    // reddedilenler
    expect(isSafeColor('url(javascript:alert(1))')).toBe(false);
    expect(isSafeColor('red')).toBe(false);
    expect(isSafeColor('var(--x)')).toBe(false);
    expect(isSafeColor('#fff; } html { display:none')).toBe(false);
    expect(isSafeColor('expression(alert(1))')).toBe(false);
  });

  it('componentId seçiciyi kıramaz', () => {
    expect(isSafeComponentId('pro.clock')).toBe(true);
    expect(isSafeComponentId('trip-log')).toBe(true);
    expect(isSafeComponentId('a"] , * { color: red } [x="')).toBe(false);
    expect(isSafeComponentId('')).toBe(false);
    expect(isSafeComponentId('a'.repeat(65))).toBe(false);
  });

  it('üretilen CSS blok kaçışı içermez', () => {
    const style: ComponentStyle = {
      ...EMPTY_COMPONENT_STYLE,
      bg: makeSolid('#101010'),
      textColor: '#ffffff',
      radius: 12,
    };
    const css = componentStyleToCss('pro.clock', style);
    expect(css).toContain('[data-editable="pro.clock"]');
    expect(css).toContain('background: #101010 !important;');
    // Süslü parantez dengesi bozulmamış olmalı
    expect((css.match(/{/g) ?? []).length).toBe((css.match(/}/g) ?? []).length);
  });

  it('güvensiz componentId hiç CSS üretmez', () => {
    expect(componentStyleToCss('a"]{}', { ...EMPTY_COMPONENT_STYLE, radius: 4 })).toBe('');
    expect(screenOverrideToCss('a"]{}', {
      accentPrimary: '#fff', textPrimary: null, textSecondary: null, bg: null, radiusCard: null,
    })).toBe('');
  });
});

describe('themeManifest — Paint (gradient) yapısal', () => {
  it('düz renk aynen döner', () => {
    expect(paintToCss(makeSolid('#123456'))).toBe('#123456');
  });

  it('doğrusal gradient yön + duraklarla üretilir', () => {
    const p = { kind: 'linear' as const, from: '#000000', to: '#ffffff', angle: 90, stopA: 10, stopB: 80, alpha: 100 };
    expect(paintToCss(p)).toBe('linear-gradient(90deg, #000000 10%, #ffffff 80%)');
  });

  it('duraklar ters verilirse sıralanır (bozuk CSS üretilmez)', () => {
    const p = { kind: 'linear' as const, from: '#000000', to: '#ffffff', angle: 0, stopA: 90, stopB: 10, alpha: 100 };
    expect(paintToCss(p)).toBe('linear-gradient(0deg, #000000 10%, #ffffff 90%)');
  });

  it('alfa uygulanınca renkler rgba\'ya çevrilir', () => {
    expect(paintToCss({ ...makeSolid('#ff0000'), alpha: 50 })).toBe('rgba(255, 0, 0, 0.5)');
  });

  it('ikinci rengi olmayan gradient solid\'e düşer', () => {
    const m = coerceThemeManifest({
      themeId: 'pro',
      tokens: { bgCard: { kind: 'linear', from: '#111111' } },
    });
    expect(m.tokens.bgCard?.kind).toBe('solid');
  });

  it('hex → rgb üçlüsü (3/6/8 haneli)', () => {
    expect(colorToRgbTriplet('#fff')).toBe('255, 255, 255');
    expect(colorToRgbTriplet('#102030')).toBe('16, 32, 48');
    expect(colorToRgbTriplet('rgb(1, 2, 3)')).toBe('1, 2, 3');
    expect(colorToRgbTriplet('hsl(1, 2%, 3%)')).toBeNull();
  });
});

describe('themeManifest — durum (state) stilleri gerçek DOM kancalarına bağlanır', () => {
  it('yalnız gerçek seçiciler üretilir, uydurma data-state YOK', () => {
    const style = coerceComponentStyle({
      states: { active: { textColor: '#ff0000' }, disabled: { opacity: 40 } },
    });
    const css = componentStyleToCss('pro.dock', style);
    expect(css).toContain('[data-editable="pro.dock"][data-editable]:active');
    expect(css).toContain('[data-editable="pro.dock"][data-editable]:disabled');
    expect(css).toContain('[aria-disabled="true"]');
    expect(css).not.toContain('data-state=');
  });

  /**
   * SAHA KİLİDİ (cihazda ölçüldü): seçici özgüllüğü, uygulamadaki
   * `html[data-compat-mode="true"] *` (0,1,1) kuralını GEÇMELİDİR. Aksi hâlde
   * kullanıcının seçtiği arka plan/gradient/köşe araca gider, CSS üretilir ama
   * ekranda hiçbir şey olmaz (sessiz başarısızlık — telefonda gözlendi).
   */
  it('KİLİT: seçici özgüllüğü compat katmanını geçecek kadar yüksektir', () => {
    const css = componentStyleToCss('pro.clock', { ...EMPTY_COMPONENT_STYLE, radius: 12 });
    // html + iki öznitelik → (0,2,1) > compat (0,1,1)
    expect(css).toContain('html [data-editable="pro.clock"][data-editable]');
    const screenCss = screenOverrideToCss('home', {
      accentPrimary: '#ffffff', textPrimary: null, textSecondary: null, bg: null, radiusCard: null,
    });
    expect(screenCss).toContain('html [data-theme-surface="home"][data-theme-surface]');
  });

  it('boş durum bloğu manifest\'e yazılmaz', () => {
    const style = coerceComponentStyle({ states: { active: {} } });
    expect(style.states).toBeNull();
  });
});

describe('themeManifest — v1 taşıma', () => {
  it('eski themeVars torbası tokenlara çevrilir', () => {
    const m = migrateLegacyThemeVars({
      '--accent-primary': '#D4AF37',
      '--bg-primary': '#1C1C2E',
      '--radius-card': '18px',
      '--font-weight-ui': '900',
      '--bilinmeyen': 'yok sayılır',
    }, 'pro');
    expect(m.tokens.accentPrimary).toBe('#D4AF37');
    expect(m.tokens.bgPrimary?.from).toBe('#1C1C2E');
    expect(m.tokens.radiusCard).toBe(18);
    expect(m.tokens.fontWeight).toBe(900);
    expect(m.schemaVersion).toBe(THEME_SCHEMA_VERSION);
  });

  it('torba yoksa boş manifest döner (uydurma değer yok)', () => {
    const m = migrateLegacyThemeVars(undefined, 'tesla');
    expect(m.themeId).toBe('tesla');
    expect(Object.keys(manifestToCssVars(m))).toHaveLength(0);
  });
});

describe('yazı rengi gerçekten uygulanır (#650 — saha: "yazılar renk değiştirmiyor")', () => {
  /* KÖK: tema düzenleri yazı rengini INLINE STYLE ile verir ve değeri paletten
   * alır; palet değişkene bağlıdır (`ink: 'var(--text-primary, …)'`). Yani her
   * yazı düğümü kendi `color`unu KENDİ üzerinde tanımlar → kartın kökündeki
   * `color` bildirimi ona miras KALMAZ. Eski üretici yalnız `color` yazıyordu,
   * `--text-primary` YAZMIYORDU → seçilen renk hiçbir yazıya ulaşmıyordu. */

  it('KİLİT: textColor `--text-primary` değişkenini de yazar (paletin okuduğu kanal)', () => {
    const css = componentStyleToCss('expedition.vehicle', {
      ...EMPTY_COMPONENT_STYLE, textColor: '#FF0000',
    });
    expect(css, 'color bildirimi kayboldu — değişkeni kullanmayan düğümler boyanmaz')
      .toMatch(/color:\s*#FF0000\s*!important/);
    expect(css, '--text-primary yazılmıyor — palet var(--text-primary) okuduğu için hiçbir yazı değişmez')
      .toMatch(/--text-primary:\s*#FF0000/);
  });

  it('KİLİT: textSecondaryColor `--text-secondary` yazar', () => {
    const css = componentStyleToCss('expedition.vehicle', {
      ...EMPTY_COMPONENT_STYLE, textSecondaryColor: '#00FF00',
    });
    expect(css).toMatch(/--text-secondary:\s*#00FF00/);
  });

  it('KİLİT: blanket `sel *` renk kuralı KURULMAZ — uyarı/kritik renkleri ezerdi', () => {
    /* Kolay çözüm `${sel} * { color: X !important }` olurdu ve ÇALIŞIRDI, ama
     * `var(--oem-warn)` ile boyanan düşük akü değerini ve `inkCritical` ile
     * boyanan kritik metni de ezerdi → güvenlik anlamı yok olurdu. Değişken
     * yolu bu renkleri doğası gereği korur. Bu kilit kolay çözüme dönüşü
     * engeller. */
    const css = componentStyleToCss('expedition.vehicle', {
      ...EMPTY_COMPONENT_STYLE, textColor: '#FF0000',
    });
    expect(css, 'blanket alt-öğe renk kuralı eklenmiş — anlamlı renkler (uyarı/kritik) eziliyor')
      .not.toMatch(/\*\s*\{[^}]*color:\s*#FF0000/);
  });

  it('KİLİT: renk seçilmemişse yazı değişkeni HİÇ yazılmaz (sahte varsayılan yok)', () => {
    const css = componentStyleToCss('expedition.vehicle', {
      ...EMPTY_COMPONENT_STYLE, radius: 10,
    });
    expect(css).not.toMatch(/--text-primary/);
    expect(css).not.toMatch(/--text-secondary/);
  });
});
