/**
 * Tema Stüdyo (PWA) — durum çekirdeği kilitleri.
 *
 * Kilitlenen davranışlar:
 *  - Stüdyo 4 GERÇEK temayı taşır; tema değiştirmek diğerinin emeğini SİLMEZ.
 *  - Geri al / yinele gerçekten çalışır ve seçim/gezinme geçmişe GİRMEZ.
 *  - Sıfırlama SEVİYELİDİR (bileşen → ekran → tema).
 *  - Kalıcılık round-trip'i "NULL = DOKUNMA"yı bozmaz.
 *  - Stüdyo'nun ürettiği paket, aracın fail-closed kapısından GEÇER.
 */

import { describe, it, expect } from 'vitest';
import {
  canRedo,
  canUndo,
  componentStyleOf,
  createStudioState,
  customizationCount,
  deserializeStudio,
  emptyManifestSet,
  migrateLegacyStudio,
  serializeStudio,
  studioReducer,
  type StudioState,
} from '@/lib/theme/themeStudioState';
import {
  manifestToCssVars,
  parseIncomingManifest,
  THEME_BASE_IDS,
  THEME_PRESETS,
} from '@/lib/theme/themeManifest';
import {
  componentsForSurface,
  componentsForTheme,
  propsForComponent,
  surfacesForTheme,
  THEME_COMPONENTS,
} from '@/lib/theme/themeComponentRegistry';

function run(actions: Parameters<typeof studioReducer>[1][], start?: StudioState): StudioState {
  return actions.reduce((s, a) => studioReducer(s, a), start ?? createStudioState());
}

describe('Tema Stüdyo — 4 tema', () => {
  it('4 temanın hepsi stüdyoda vardır (2 değil)', () => {
    const s = createStudioState();
    expect(Object.keys(s.manifests).sort()).toEqual(['expedition', 'horizon', 'pro', 'tesla']);
    for (const id of THEME_BASE_IDS) {
      expect(s.manifests[id].themeId).toBe(id);
      expect(THEME_PRESETS[id].label.length).toBeGreaterThan(0);
    }
  });

  it('başlangıçta hiç özelleştirme yoktur (araç görünümü değişmez)', () => {
    const s = createStudioState();
    for (const id of THEME_BASE_IDS) {
      expect(customizationCount(s.manifests[id])).toBe(0);
      expect(Object.keys(manifestToCssVars(s.manifests[id]))).toHaveLength(0);
    }
  });

  it('tema değiştirmek diğer temanın emeğini SİLMEZ', () => {
    const s = run([
      { type: 'select-theme', themeId: 'tesla' },
      { type: 'patch-tokens', patch: { accentPrimary: '#AA0000' } },
      { type: 'select-theme', themeId: 'horizon' },
      { type: 'patch-tokens', patch: { accentPrimary: '#00AA00' } },
      { type: 'select-theme', themeId: 'tesla' },
    ]);
    expect(s.manifests.tesla.tokens.accentPrimary).toBe('#AA0000');
    expect(s.manifests.horizon.tokens.accentPrimary).toBe('#00AA00');
    expect(s.manifests.pro.tokens.accentPrimary).toBeNull();
  });
});

describe('Tema Stüdyo — geri al / yinele', () => {
  it('değişiklik geri alınır ve yinelenir', () => {
    let s = run([{ type: 'patch-tokens', patch: { accentPrimary: '#123456' } }]);
    expect(s.manifests.expedition.tokens.accentPrimary).toBe('#123456');
    expect(canUndo(s)).toBe(true);

    s = studioReducer(s, { type: 'undo' });
    expect(s.manifests.expedition.tokens.accentPrimary).toBeNull();
    expect(canRedo(s)).toBe(true);

    s = studioReducer(s, { type: 'redo' });
    expect(s.manifests.expedition.tokens.accentPrimary).toBe('#123456');
  });

  it('boş geçmişte geri al/yinele durumu BOZMAZ', () => {
    const s0 = createStudioState();
    expect(studioReducer(s0, { type: 'undo' })).toEqual(s0);
    expect(studioReducer(s0, { type: 'redo' })).toEqual(s0);
  });

  it('gezinme (ekran/tema seçimi) geçmişe GİRMEZ', () => {
    const s = run([
      { type: 'select-surface', surface: 'settings' },
      { type: 'select-theme', themeId: 'pro' },
      { type: 'open-editor', componentId: 'pro.clock' },
    ]);
    expect(canUndo(s)).toBe(false);
  });

  it('yeni değişiklik yinele yığınını temizler', () => {
    let s = run([{ type: 'patch-tokens', patch: { accentPrimary: '#111111' } }]);
    s = studioReducer(s, { type: 'undo' });
    expect(canRedo(s)).toBe(true);
    s = studioReducer(s, { type: 'patch-tokens', patch: { textPrimary: '#FFFFFF' } });
    expect(canRedo(s)).toBe(false);
  });
});

describe('Tema Stüdyo — seviyeli sıfırlama', () => {
  it('bileşen sıfırlama YALNIZ o bileşeni siler', () => {
    let s = run([
      { type: 'patch-component', componentId: 'expedition.speed', patch: { radius: 20 } },
      { type: 'patch-component', componentId: 'expedition.map', patch: { radius: 8 } },
      { type: 'patch-tokens', patch: { accentPrimary: '#123456' } },
    ]);
    s = studioReducer(s, { type: 'reset-component', componentId: 'expedition.speed' });
    const m = s.manifests.expedition;
    expect(m.componentOverrides['expedition.speed']).toBeUndefined();
    expect(m.componentOverrides['expedition.map']?.radius).toBe(8);
    expect(m.tokens.accentPrimary).toBe('#123456');
  });

  it('ekran sıfırlama yalnız ekran override\'ını siler', () => {
    let s = run([
      { type: 'patch-screen', surface: 'settings', patch: { accentPrimary: '#ABCDEF' } },
      { type: 'patch-component', componentId: 'settings-page', patch: { radius: 6 } },
    ]);
    s = studioReducer(s, { type: 'reset-surface', surface: 'settings' });
    expect(s.manifests.expedition.screenOverrides.settings).toBeUndefined();
    expect(s.manifests.expedition.componentOverrides['settings-page']?.radius).toBe(6);
  });

  it('tema sıfırlama yalnız AKTİF temayı sıfırlar ve geri alınabilir', () => {
    let s = run([
      { type: 'patch-tokens', patch: { accentPrimary: '#111111' } },
      { type: 'select-theme', themeId: 'pro' },
      { type: 'patch-tokens', patch: { accentPrimary: '#222222' } },
      { type: 'reset-theme' },
    ]);
    expect(customizationCount(s.manifests.pro)).toBe(0);
    expect(s.manifests.expedition.tokens.accentPrimary).toBe('#111111');
    s = studioReducer(s, { type: 'undo' });
    expect(s.manifests.pro.tokens.accentPrimary).toBe('#222222');
  });
});

describe('Tema Stüdyo — bileşen ve durum stilleri', () => {
  it('boşa dönen bileşen override\'ı manifest\'ten DÜŞER', () => {
    let s = run([{ type: 'patch-component', componentId: 'pro.clock', patch: { radius: 10 } }]);
    expect(s.manifests.expedition.componentOverrides['pro.clock']).toBeDefined();
    s = studioReducer(s, { type: 'patch-component', componentId: 'pro.clock', patch: { radius: null } });
    expect(s.manifests.expedition.componentOverrides['pro.clock']).toBeUndefined();
  });

  it('durum stili eklenir ve boşalınca temizlenir', () => {
    let s = run([{ type: 'patch-component-state', componentId: 'pro.dock', stateKey: 'active', patch: { textColor: '#FF0000' } }]);
    expect(componentStyleOf(s.manifests.expedition, 'pro.dock').states?.active?.textColor).toBe('#FF0000');
    s = studioReducer(s, { type: 'patch-component-state', componentId: 'pro.dock', stateKey: 'active', patch: { textColor: null } });
    expect(s.manifests.expedition.componentOverrides['pro.dock']).toBeUndefined();
  });
});

describe('Tema Stüdyo — kopyalama ve sürüm', () => {
  it('başka temadan kopyalama hedefin KİMLİĞİNİ korur', () => {
    const s = run([
      { type: 'select-theme', themeId: 'tesla' },
      { type: 'patch-tokens', patch: { accentPrimary: '#AA00AA' } },
      { type: 'select-theme', themeId: 'pro' },
      { type: 'copy-from', sourceThemeId: 'tesla' },
    ]);
    expect(s.manifests.pro.tokens.accentPrimary).toBe('#AA00AA');
    expect(s.manifests.pro.themeId).toBe('pro');
  });

  it('araca gönderim sürümü artırır ve damga düşer', () => {
    const s = run([{ type: 'mark-sent', at: '2026-08-15T12:00:00.000Z' }]);
    expect(s.manifests.expedition.themeVersion).toBe(2);
    expect(s.manifests.expedition.metadata.updatedAt).toBe('2026-08-15T12:00:00.000Z');
  });
});

describe('Tema Stüdyo — kalıcılık', () => {
  it('serialize → deserialize round-trip özelleştirmeyi korur', () => {
    const s = run([
      { type: 'patch-tokens', patch: { accentPrimary: '#0F0F0F' } },
      { type: 'patch-component', componentId: 'expedition.map', patch: { radius: 30 } },
    ]);
    const back = deserializeStudio(serializeStudio(s));
    expect(back.manifests.expedition.tokens.accentPrimary).toBe('#0F0F0F');
    expect(back.manifests.expedition.componentOverrides['expedition.map'].radius).toBe(30);
    // NULL = DOKUNMA invaryantı round-trip'te de geçerli
    expect(back.manifests.expedition.tokens.radiusCard).toBeNull();
    expect(back.manifests.pro.tokens.accentPrimary).toBeNull();
  });

  it('bozuk depo THROW ETMEZ, varsayılana düşer', () => {
    for (const bad of [null, '', '{bozuk', '[]', '{"manifests":42}']) {
      expect(() => deserializeStudio(bad)).not.toThrow();
      const p = deserializeStudio(bad);
      expect(Object.keys(p.manifests).sort()).toEqual(['expedition', 'horizon', 'pro', 'tesla']);
    }
  });

  it('v1 stüdyo verisi taşınır (kullanıcının emeği çöpe gitmez)', () => {
    const legacy = JSON.stringify({
      name: 'PRO', baseTheme: 'pro',
      accentPrimary: '#D4AF37', bgPrimary: '#1C1C2E',
      radiusCard: 18, fontWeight: 900, letterSpacing: 2,
    });
    const p = migrateLegacyStudio(legacy);
    expect(p).not.toBeNull();
    expect(p?.themeId).toBe('pro');
    expect(p?.manifests.pro.tokens.accentPrimary).toBe('#D4AF37');
    expect(p?.manifests.pro.tokens.bgPrimary?.from).toBe('#1C1C2E');
    expect(p?.manifests.pro.tokens.radiusCard).toBe(18);
    // Diğer temalar dokunulmamış kalır
    expect(customizationCount(p!.manifests.tesla)).toBe(0);
  });

  it('taşınacak veri yoksa null döner', () => {
    expect(migrateLegacyStudio(null)).toBeNull();
    expect(migrateLegacyStudio('bozuk')).toBeNull();
  });
});

describe('Tema Stüdyo — araç sözleşmesiyle uyum', () => {
  it('stüdyonun ürettiği paket aracın fail-closed kapısından GEÇER', () => {
    const s = run([
      { type: 'select-theme', themeId: 'horizon' },
      { type: 'patch-tokens', patch: { accentPrimary: '#00AAFF' } },
      { type: 'patch-component', componentId: 'horizon.map', patch: { radius: 4 } },
    ]);
    const r = parseIncomingManifest(s.manifests.horizon);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.manifest.themeId).toBe('horizon');
      expect(r.manifest.componentOverrides['horizon.map'].radius).toBe(4);
    }
  });

  it('geri-uyum: aynı manifest\'ten eski araç için themeVars da üretilebilir', () => {
    const s = run([{ type: 'patch-tokens', patch: { accentPrimary: '#00AAFF' } }]);
    const vars = manifestToCssVars(s.manifests.expedition);
    expect(vars['--accent-primary']).toBe('#00AAFF');
    expect(vars['--accent-rgb']).toBe('0, 170, 255');
  });
});

describe('Tema Stüdyo — kayıt defteri gezinmesi', () => {
  it('her temanın kendi ana ekran bileşenleri gelir, başka temanınki GELMEZ', () => {
    const tesla = componentsForSurface('tesla', 'home').map((c) => c.id);
    expect(tesla).toContain('tesla.map');
    expect(tesla).not.toContain('pro.map');
    expect(tesla).not.toContain('horizon.map');
  });

  it('tema-bağımsız ekranlar her temada görünür', () => {
    for (const id of THEME_BASE_IDS) {
      const ids = componentsForTheme(id).map((c) => c.id);
      expect(ids).toContain('settings-page');
      expect(ids).toContain('dtc-panel');
    }
  });

  it('her temada birden çok ekran düzenlenebilir (yalnız ana ekran değil)', () => {
    for (const id of THEME_BASE_IDS) {
      expect(surfacesForTheme(id).length).toBeGreaterThan(5);
    }
  });

  it('bileşen tipi desteklemediği özelliği göstermez', () => {
    const map = THEME_COMPONENTS.find((c) => c.id === 'tesla.map')!;
    const props = propsForComponent(map);
    expect(props).toContain('bg');
    expect(props).not.toContain('fontScale');
    expect(props).not.toContain('visible'); // harita kilitli
  });
});

describe('Tema Stüdyo — boş manifest kümesi', () => {
  it('emptyManifestSet 4 temayı da üretir', () => {
    const set = emptyManifestSet();
    expect(Object.keys(set).sort()).toEqual(['expedition', 'horizon', 'pro', 'tesla']);
  });
});
