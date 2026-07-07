/**
 * Tema Belgesi v1 — Faz 0 kilitleri.
 * Zero-trust validate/clamp + registry parite + güvenlik kilidi + round-trip.
 * Bu davranışlar araç tarafı fail-soft apply'ın sözleşmesidir — ZAYIFLATMA.
 */
import { describe, it, expect } from 'vitest';
import { EDITABLE_REGISTRY } from '../store/useEditStore';
import {
  THEME_DOC_VERSION,
  LAYOUT_DEFAULTS,
  ZONES,
  createDefaultThemeDoc,
  validateThemeDoc,
  clampElementStyle,
  clampLayoutMeta,
  serializeThemeDoc,
  parseThemeDoc,
} from '../platform/theme/themeDocument';

describe('themeDocument — registry parite', () => {
  it('her EDITABLE_REGISTRY id için LAYOUT_DEFAULTS girişi var', () => {
    const missing = Object.keys(EDITABLE_REGISTRY).filter((id) => !(id in LAYOUT_DEFAULTS));
    expect(missing).toEqual([]);
  });

  it('LAYOUT_DEFAULTS bilinmeyen id içermez (registry ile birebir)', () => {
    const orphan = Object.keys(LAYOUT_DEFAULTS).filter((id) => !(id in EDITABLE_REGISTRY));
    expect(orphan).toEqual([]);
  });

  it('tüm varsayılan zone değerleri geçerli', () => {
    for (const meta of Object.values(LAYOUT_DEFAULTS)) {
      expect(ZONES).toContain(meta.zone);
    }
  });
});

describe('themeDocument — createDefaultThemeDoc', () => {
  it('v1, geçerli base, tüm registry id\'leri mevcut', () => {
    const doc = createDefaultThemeDoc('pro');
    expect(doc.version).toBe(THEME_DOC_VERSION);
    expect(doc.base).toBe('pro');
    expect(Object.keys(doc.elements).sort()).toEqual(Object.keys(EDITABLE_REGISTRY).sort());
  });

  it('her eleman boş stil + varsayılan layout ile başlar', () => {
    const doc = createDefaultThemeDoc();
    expect(doc.elements['map-card'].style).toEqual({});
    expect(doc.elements['map-card'].layout.zone).toBe(LAYOUT_DEFAULTS['map-card'].zone);
  });
});

describe('themeDocument — validateThemeDoc zero-trust', () => {
  it('obje olmayan girdide throw etmez, varsayılan belge döner', () => {
    for (const bad of [null, undefined, 42, 'x', true, []]) {
      const doc = validateThemeDoc(bad as unknown);
      expect(doc.version).toBe(THEME_DOC_VERSION);
      expect(doc.base).toBe('pro');
    }
  });

  it('bilinmeyen base → fallback', () => {
    expect(validateThemeDoc({ base: 'hackerman' }).base).toBe('pro');
    expect(validateThemeDoc({ base: 'tesla' }).base).toBe('tesla');
    expect(validateThemeDoc({}, 'horizon').base).toBe('horizon');
  });

  it('bilinmeyen eleman id\'si düşürülür (hayalet render yok)', () => {
    const doc = validateThemeDoc({ elements: { 'evil-widget': { style: {} }, 'map-card': { style: {} } } });
    expect(doc.elements['evil-widget']).toBeUndefined();
    expect(doc.elements['map-card']).toBeDefined();
  });

  it('out-of-range stil değerleri clamp\'lenir', () => {
    const doc = validateThemeDoc({
      elements: { 'obd-panel': { style: { bgOpacity: 999, borderWidth: -5, glowLevel: 9, opacity: 10 } } },
    });
    const s = doc.elements['obd-panel'].style;
    expect(s.bgOpacity).toBe(95);
    expect(s.borderWidth).toBe(0);
    expect(s.glowLevel).toBe(3);
    expect(s.opacity).toBe(40);
  });

  it('geçersiz renk → null, geçerli renk korunur', () => {
    const doc = validateThemeDoc({
      elements: { 'obd-panel': { style: { bgColor: 'not-a-color', textColor: '#ff0000' } } },
    });
    expect(doc.elements['obd-panel'].style.bgColor).toBeNull();
    expect(doc.elements['obd-panel'].style.textColor).toBe('#ff0000');
  });

  it('geçersiz zone/sizeClass varsayılana düşer', () => {
    const doc = validateThemeDoc({
      elements: { 'map-card': { layout: { zone: 'moon', sizeClass: 'XXL', priority: 500 } } },
    });
    const l = doc.elements['map-card'].layout;
    expect(l.zone).toBe(LAYOUT_DEFAULTS['map-card'].zone);
    expect(l.sizeClass).toBe(LAYOUT_DEFAULTS['map-card'].sizeClass);
    expect(l.priority).toBe(100); // 500 → clamp 100
  });
});

describe('themeDocument — güvenlik kilidi', () => {
  it('kilitli eleman (speedometer) doc gizlemeye çalışsa da görünür kalır', () => {
    const doc = validateThemeDoc({
      elements: { speedometer: { style: { visible: false }, layout: { locked: false } } },
    });
    expect(doc.elements.speedometer.style.visible).toBe(true);
    expect(doc.elements.speedometer.layout.locked).toBe(true); // kilit açılamaz
  });

  it('kilitli eleman doc\'ta hiç gelmese de görünür zorlanır', () => {
    const doc = validateThemeDoc({ elements: {} });
    expect(doc.elements.dock.style.visible).toBe(true);
    expect(doc.elements.dock.layout.locked).toBe(true);
  });

  it('normal eleman kullanıcı tarafından kilitlenebilir', () => {
    const doc = validateThemeDoc({ elements: { 'obd-panel': { layout: { locked: true } } } });
    expect(doc.elements['obd-panel'].layout.locked).toBe(true);
  });
});

describe('themeDocument — clamp yardımcıları', () => {
  it('clampElementStyle obje olmayanda boş döner', () => {
    expect(clampElementStyle(null)).toEqual({});
    expect(clampElementStyle('x')).toEqual({});
  });

  it('clampElementStyle yalnız geçerli anahtarları taşır', () => {
    const out = clampElementStyle({ size: 'large', junk: 1, fontScale: 5 });
    expect(out.size).toBe('large');
    expect(out.fontScale).toBe(1.5); // clamp
    expect('junk' in out).toBe(false);
  });

  it('clampLayoutMeta eksik alanı varsayılandan tamamlar', () => {
    const l = clampLayoutMeta({ priority: 20 }, 'trip-log');
    expect(l.priority).toBe(20);
    expect(l.zone).toBe(LAYOUT_DEFAULTS['trip-log'].zone);
    expect(l.sizeClass).toBe(LAYOUT_DEFAULTS['trip-log'].sizeClass);
  });
});

describe('themeDocument — serialize round-trip', () => {
  it('createDefault → serialize → parse yapısal olarak eşit', () => {
    const doc = createDefaultThemeDoc('tesla');
    const round = parseThemeDoc(serializeThemeDoc(doc));
    expect(round).toEqual(doc);
  });

  it('parseThemeDoc bozuk JSON\'da fail-soft varsayılan döner', () => {
    const doc = parseThemeDoc('{ bozuk json', 'horizon');
    expect(doc.version).toBe(THEME_DOC_VERSION);
    expect(doc.base).toBe('horizon');
  });

  it('düzenlenmiş belge round-trip\'te override\'ları korur', () => {
    const doc = createDefaultThemeDoc();
    doc.tokens.accent = '#D4AF37';
    doc.elements['obd-panel'].style = { bgOpacity: 50, size: 'large' };
    doc.elements['obd-panel'].layout = { zone: 'right-rail', sizeClass: 'S', priority: 20 };
    const round = parseThemeDoc(serializeThemeDoc(doc));
    expect(round.tokens.accent).toBe('#D4AF37');
    expect(round.elements['obd-panel'].style.bgOpacity).toBe(50);
    expect(round.elements['obd-panel'].layout.zone).toBe('right-rail');
  });
});
