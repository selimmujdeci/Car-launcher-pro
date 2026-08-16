/**
 * Tema Stüdyo — YERLEŞİM + DOKUN&DÜZENLE kilitleri (PWA).
 *
 * Kilitlenen davranışlar:
 *  - Yerleşim düzenleme reducer'ı: patch / reset / undo / geçmiş.
 *  - Yerleşim önizlemesi GERÇEK `layoutSolver`dan gelir (ikinci motor yok).
 *  - Solver kullanmayan temada (horizon/tesla) yerleşim arayüzü YOK.
 *  - Ölçüm (probe) zero-trust: hayalet kimlik ve bozuk kutu düşürülür.
 *  - Dokunulan kutu → bileşen listesiyle AYNI seçim yolu.
 *  - v2 kalıcı veri (layoutOverrides'sız) sorunsuz yüklenir (geri-uyum).
 *  - 4 tema PARİTESİ: hepsi aynı editör altyapısını kullanır.
 */

import { describe, it, expect } from 'vitest';
import {
  canRedo,
  canUndo,
  cardLayoutOf,
  createStudioState,
  customizationCount,
  deserializeStudio,
  serializeStudio,
  studioReducer,
  type StudioState,
} from '@/lib/theme/themeStudioState';
import {
  manifestToLayoutIntent,
  parseIncomingManifest,
  THEME_BASE_IDS,
  THEME_SCHEMA_VERSION,
} from '@/lib/theme/themeManifest';
import {
  isLayoutCapableTheme,
  layoutCardIdFor,
  layoutComponentsForTheme,
  propsForComponent,
  getThemeComponent,
  THEME_COMPONENTS,
} from '@/lib/theme/themeComponentRegistry';
import { solvePreview, solverEntry, solverManifestFor, ZONE_LABEL } from '@/lib/theme/themeLayoutBridge';
import { resolveProbeSelection, sanitizeProbeItems } from '@/lib/theme/themeProbe';

function run(actions: Parameters<typeof studioReducer>[1][], start?: StudioState): StudioState {
  return actions.reduce((s, a) => studioReducer(s, a), start ?? createStudioState());
}

/* ── Reducer ──────────────────────────────────────────────────────── */

describe('Stüdyo — yerleşim düzenleme', () => {
  it('yerleşim override\'ı yazılır ve sayaca girer', () => {
    const s = run([
      { type: 'select-theme', themeId: 'pro' },
      { type: 'patch-layout', cardId: 'clock', patch: { ord: 5 } },
    ]);
    expect(cardLayoutOf(s.manifests.pro, 'clock').ord).toBe(5);
    expect(customizationCount(s.manifests.pro)).toBe(1);
  });

  it('boşa dönen yerleşim override\'ı manifest\'ten DÜŞER', () => {
    let s = run([{ type: 'patch-layout', cardId: 'map', patch: { grow: 3 } }]);
    expect(s.manifests.expedition.layoutOverrides.map).toBeDefined();
    s = studioReducer(s, { type: 'patch-layout', cardId: 'map', patch: { grow: null } });
    expect(s.manifests.expedition.layoutOverrides.map).toBeUndefined();
  });

  it('yerleşim değişikliği GERİ ALINABİLİR', () => {
    let s = run([{ type: 'patch-layout', cardId: 'music', patch: { visible: false } }]);
    expect(cardLayoutOf(s.manifests.expedition, 'music').visible).toBe(false);
    expect(canUndo(s)).toBe(true);
    s = studioReducer(s, { type: 'undo' });
    expect(s.manifests.expedition.layoutOverrides.music).toBeUndefined();
    expect(canRedo(s)).toBe(true);
    s = studioReducer(s, { type: 'redo' });
    expect(cardLayoutOf(s.manifests.expedition, 'music').visible).toBe(false);
  });

  it('tek kart sıfırlama yalnız o kartı siler', () => {
    let s = run([
      { type: 'patch-layout', cardId: 'music', patch: { ord: 1 } },
      { type: 'patch-layout', cardId: 'vehicle', patch: { ord: 2 } },
    ]);
    s = studioReducer(s, { type: 'reset-layout', cardId: 'music' });
    expect(s.manifests.expedition.layoutOverrides.music).toBeUndefined();
    expect(s.manifests.expedition.layoutOverrides.vehicle?.ord).toBe(2);
  });

  it('tüm yerleşimi sıfırlama diğer katmanlara DOKUNMAZ', () => {
    let s = run([
      { type: 'patch-tokens', patch: { accentPrimary: '#112233' } },
      { type: 'patch-component', componentId: 'expedition.map', patch: { radius: 4 } },
      { type: 'patch-layout', cardId: 'music', patch: { ord: 1 } },
    ]);
    s = studioReducer(s, { type: 'reset-all-layout' });
    expect(s.manifests.expedition.layoutOverrides).toEqual({});
    expect(s.manifests.expedition.tokens.accentPrimary).toBe('#112233');
    expect(s.manifests.expedition.componentOverrides['expedition.map']?.radius).toBe(4);
  });

  it('tema sıfırlama yerleşimi de temizler', () => {
    let s = run([{ type: 'patch-layout', cardId: 'music', patch: { ord: 1 } }]);
    s = studioReducer(s, { type: 'reset-theme' });
    expect(s.manifests.expedition.layoutOverrides).toEqual({});
  });

  it('temalar arası yerleşim EMEĞİ karışmaz', () => {
    const s = run([
      { type: 'select-theme', themeId: 'pro' },
      { type: 'patch-layout', cardId: 'clock', patch: { ord: 7 } },
      { type: 'select-theme', themeId: 'expedition' },
      { type: 'patch-layout', cardId: 'music', patch: { ord: 1 } },
    ]);
    expect(s.manifests.pro.layoutOverrides.clock?.ord).toBe(7);
    expect(s.manifests.pro.layoutOverrides.music).toBeUndefined();
    expect(s.manifests.expedition.layoutOverrides.music?.ord).toBe(1);
  });
});

/* ── Solver köprüsü ───────────────────────────────────────────────── */

describe('Stüdyo — yerleşim önizlemesi GERÇEK solver\'dan', () => {
  it('solver kullanmayan temada manifest YOK (arayüz göstermez)', () => {
    expect(solverManifestFor('horizon')).toBeNull();
    expect(solverManifestFor('tesla')).toBeNull();
    expect(solvePreview('horizon', createStudioState().manifests.horizon)).toBeNull();
  });

  it('pro/expedition için çözülmüş bölgeler gelir', () => {
    const s = createStudioState();
    const solved = solvePreview('pro', s.manifests.pro);
    expect(solved).not.toBeNull();
    const zones = solved!.zones.map((z) => z.zone);
    expect(zones).toContain('left-rail');
    expect(zones).toContain('center-stage');
    expect(ZONE_LABEL['left-rail']).toBe('Sol Ray');
  });

  it('sıra değişikliği çözülmüş çıktıya YANSIR', () => {
    const s = run([
      { type: 'select-theme', themeId: 'pro' },
      { type: 'patch-layout', cardId: 'settings', patch: { ord: 0 } },
      { type: 'patch-layout', cardId: 'clock', patch: { ord: 9 } },
    ]);
    const solved = solvePreview('pro', s.manifests.pro)!;
    const left = solved.zones.find((z) => z.zone === 'left-rail')!.items.map((i) => i.id);
    expect(left[0]).toBe('settings');
    expect(left[left.length - 1]).toBe('clock');
  });

  it('kilitli kart gizlenemez — çözülmüş çıktıda KALIR', () => {
    const s = run([
      { type: 'select-theme', themeId: 'pro' },
      { type: 'patch-layout', cardId: 'gauge', patch: { visible: false } },
    ]);
    const solved = solvePreview('pro', s.manifests.pro)!;
    const left = solved.zones.find((z) => z.zone === 'left-rail')!;
    expect(left.items.map((i) => i.id)).toContain('gauge');
    expect(left.items.find((i) => i.id === 'gauge')?.locked).toBe(true);
  });

  it('solverEntry gerçek bölge/boyut bilgisini verir', () => {
    expect(solverEntry('pro', 'nav')?.zone).toBe('center-stage');
    expect(solverEntry('expedition', 'range')?.zone).toBe('left-rail');
    expect(solverEntry('horizon', 'map')).toBeNull();
  });

  it('manifest → ham niyet yalnız dokunulanı taşır', () => {
    const s = run([{ type: 'patch-layout', cardId: 'music', patch: { size: 'L' } }]);
    expect(manifestToLayoutIntent(s.manifests.expedition)).toEqual({ music: { size: 'L' } });
  });
});

/* ── Dokun & Düzenle (ölçüm → seçim) ──────────────────────────────── */

describe('Stüdyo — dokunma ölçümü zero-trust', () => {
  it('kayıt defterinde olmayan kimlik ÇİZİLMEZ', () => {
    const items = sanitizeProbeItems([
      { id: 'pro.clock', x: 0, y: 0, w: 10, h: 10 },
      { id: 'uydurma.kart', x: 0, y: 0, w: 10, h: 10 },
    ]);
    expect(items.map((i) => i.id)).toEqual(['pro.clock']);
  });

  it('bozuk kutu (sıfır boyut / sayı olmayan) düşürülür', () => {
    const items = sanitizeProbeItems([
      { id: 'pro.clock', x: 0, y: 0, w: 0, h: 10 },
      { id: 'pro.gauge', x: 'a', y: 0, w: 10, h: 10 },
      { id: 'pro.map', x: 1, y: 2, w: 3, h: 4 },
    ]);
    expect(items.map((i) => i.id)).toEqual(['pro.map']);
  });

  it('yinelenen kimlik tek kutuya iner', () => {
    const items = sanitizeProbeItems([
      { id: 'pro.clock', x: 0, y: 0, w: 10, h: 10 },
      { id: 'pro.clock', x: 5, y: 5, w: 20, h: 20 },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].x).toBe(0);
  });

  it('dizi olmayan/boş girdi THROW ETMEZ', () => {
    for (const bad of [null, undefined, 42, 'x', {}]) {
      expect(() => sanitizeProbeItems(bad)).not.toThrow();
      expect(sanitizeProbeItems(bad)).toEqual([]);
    }
  });

  it('dokunulan kutu bileşen listesiyle AYNI seçimi üretir', () => {
    const info = resolveProbeSelection('horizon.media');
    expect(info).not.toBeNull();
    expect(info!.surface).toBe('home');
    // Stüdyo bu bilgiyle ekranı seçip editörü açar
    const s = run([
      { type: 'select-theme', themeId: 'horizon' },
      { type: 'select-surface', surface: info!.surface },
      { type: 'open-editor', componentId: info!.id },
    ]);
    expect(s.surface).toBe('home');
    expect(s.editingComponentId).toBe('horizon.media');
  });

  it('bilinmeyen kimlik seçim üretmez', () => {
    expect(resolveProbeSelection('yok.boyle.bir.sey')).toBeNull();
  });
});

/* ── Geri-uyum ────────────────────────────────────────────────────── */

describe('Stüdyo — geri-uyum', () => {
  it('v2 kalıcı veri (layoutOverrides YOK) sorunsuz yüklenir', () => {
    const legacyV2 = JSON.stringify({
      themeId: 'pro',
      manifests: {
        pro: {
          schemaVersion: 2, themeId: 'pro', themeVersion: 3,
          tokens: { accentPrimary: '#AABBCC' },
          componentOverrides: { 'pro.clock': { radius: 9 } },
          screenOverrides: {},
          metadata: { name: 'Glass Pro', origin: 'pwa-studio', updatedAt: null },
        },
      },
    });
    const p = deserializeStudio(legacyV2);
    expect(p.themeId).toBe('pro');
    expect(p.manifests.pro.schemaVersion).toBe(THEME_SCHEMA_VERSION);
    expect(p.manifests.pro.layoutOverrides).toEqual({});
    expect(p.manifests.pro.tokens.accentPrimary).toBe('#AABBCC');
    expect(p.manifests.pro.componentOverrides['pro.clock'].radius).toBe(9);
  });

  it('yerleşimli manifest round-trip\'i korunur', () => {
    const s = run([
      { type: 'select-theme', themeId: 'pro' },
      { type: 'patch-layout', cardId: 'clock', patch: { ord: 4, size: 'L' } },
      { type: 'patch-tokens', patch: { accentPrimary: '#010203' } },
    ]);
    const back = deserializeStudio(serializeStudio(s));
    expect(back.manifests.pro.layoutOverrides.clock).toMatchObject({ ord: 4, size: 'L' });
    expect(back.manifests.pro.tokens.accentPrimary).toBe('#010203');
  });

  it('stüdyonun ürettiği v3 paket aracın kapısından GEÇER', () => {
    const s = run([
      { type: 'select-theme', themeId: 'expedition' },
      { type: 'patch-layout', cardId: 'range', patch: { ord: 0 } },
      { type: 'patch-screen', surface: 'home', patch: { accentPrimary: '#00FF00' } },
    ]);
    const r = parseIncomingManifest(s.manifests.expedition);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.manifest.layoutOverrides.range.ord).toBe(0);
      expect(r.manifest.screenOverrides.home.accentPrimary).toBe('#00FF00');
    }
  });
});

/* ── 4 tema paritesi ──────────────────────────────────────────────── */

describe('Stüdyo — 4 tema paritesi', () => {
  it('her temanın her bileşeni aynı editör altyapısını kullanır', () => {
    for (const t of THEME_BASE_IDS) {
      const comps = THEME_COMPONENTS.filter((c) => c.themes === null || c.themes.includes(t));
      expect(comps.length).toBeGreaterThan(0);
      for (const c of comps) {
        // Her bileşenin en az bir düzenlenebilir alanı olmalı (boş editör YOK)
        expect(propsForComponent(c).length).toBeGreaterThan(0);
      }
    }
  });

  it('yerleşim yeteneği tema başına DOĞRU raporlanır', () => {
    const capable = THEME_BASE_IDS.filter(isLayoutCapableTheme);
    expect(capable.sort()).toEqual(['expedition', 'pro']);
    for (const t of THEME_BASE_IDS) {
      const n = layoutComponentsForTheme(t).length;
      if (isLayoutCapableTheme(t)) expect(n).toBeGreaterThan(0);
      else expect(n).toBe(0);
    }
  });

  it('tema farkları korunur — bir temada olmayan bileşen uydurulmaz', () => {
    expect(getThemeComponent('tesla.fuel')?.themes).toEqual(['tesla']);
    expect(layoutCardIdFor(getThemeComponent('tesla.fuel')!, 'tesla')).toBeNull();
    expect(THEME_COMPONENTS.find((c) => c.id === 'horizon.consumption')?.themes).toEqual(['horizon']);
  });
});
