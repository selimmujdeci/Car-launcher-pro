/**
 * Sürücü ekranı görünümleri + renkleri (kullanıcı isteği 2026-09-27).
 * Her görünümde AYNI dürüstlük: veri yoksa ibre/dolgu yok, "0" yok; hız sınırı
 * levhası kuralı (kesin değilse kesikli) ortak.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DigitalCockpitScreen } from '../components/cockpit/DigitalCockpitScreen';
import { EMPTY_COCKPIT_STATE, EM_DASH } from '../components/cockpit/cockpitDataModel';
import {
  COCKPIT_ACCENT_IDS, COCKPIT_STYLE_IDS, cockpitTokensFor, type CockpitStyleId,
} from '../components/cockpit/cockpitLayout';
import { COCKPIT_REFERENCE_STATE, COCKPIT_REFERENCE_CLOCK } from './fixtures/cockpitReferenceState';

function render(node: React.ReactElement): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = renderToStaticMarkup(node);
  return el;
}
const measurement = (el: HTMLElement) =>
  [...el.querySelectorAll('text:not([data-cockpit-scale]), [data-cockpit-copy]')].map((n) => (n.textContent ?? '').trim());

describe('görünüm × renk × gündüz/gece', () => {
  it.each(COCKPIT_STYLE_IDS)('%s: veri yokken ibre/dolgu çizilmez, hiçbir değer "0" değil', (styleId) => {
    for (const mode of ['day', 'night'] as const) {
      const el = render(<DigitalCockpitScreen state={EMPTY_COCKPIT_STATE} mode={mode} styleId={styleId as CockpitStyleId}
        clock={{ time: '--:--', date: '' }} />);
      expect(el.querySelector('[data-cockpit-needle], [data-cockpit-rpm-marker], [data-cockpit-speed-fill]')).toBeNull();
      expect(el.querySelector('[data-cockpit-value="speed"]')?.textContent).toBe(EM_DASH);
      expect(measurement(el)).not.toContain('0');
    }
  });

  it.each(COCKPIT_STYLE_IDS)('%s: kesin olmayan hız sınırı kesikli; veri varken hız çizilir', (styleId) => {
    const el = render(<DigitalCockpitScreen state={{ ...COCKPIT_REFERENCE_STATE, speedLimitDefinitive: false }} mode="night"
      styleId={styleId as CockpitStyleId} clock={COCKPIT_REFERENCE_CLOCK} />);
    const sign = el.querySelector('[data-cockpit-speedlimit]');
    expect(sign?.getAttribute('data-cockpit-speedlimit')).toBe('uncertain');
    expect(sign?.querySelector('circle')?.getAttribute('stroke-dasharray')).toBeTruthy();
    expect(el.querySelector('[data-cockpit-value="speed"]')?.textContent).toContain('72');
  });

  it('analog/retro: ölçüm varken ibre VAR, yokken YOK', () => {
    for (const styleId of ['analog', 'retro'] as const) {
      const on = render(<DigitalCockpitScreen state={COCKPIT_REFERENCE_STATE} mode="day" styleId={styleId} clock={COCKPIT_REFERENCE_CLOCK} />);
      expect(on.querySelectorAll('[data-cockpit-needle]').length).toBe(2);
      const off = render(<DigitalCockpitScreen state={{ ...COCKPIT_REFERENCE_STATE, rpm: null }} mode="day" styleId={styleId} clock={COCKPIT_REFERENCE_CLOCK} />);
      expect(off.querySelectorAll('[data-cockpit-needle]').length).toBe(1);   // yalnız hız
    }
  });

  it('her renk her modda okunur (yazı ≥7:1, ikincil ≥4.5:1)', () => {
    const lum = (hex: string) => {
      const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    const cr = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    for (const id of COCKPIT_ACCENT_IDS) {
      for (const mode of ['day', 'night'] as const) {
        const t = cockpitTokensFor(mode, id);
        expect(cr(t.textPrimary, t.surfaceTop), `${id}/${mode}`).toBeGreaterThanOrEqual(7);
        expect(cr(t.textSecondary, t.surfaceTop), `${id}/${mode}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

describe('ayar deposu ↔ ekran seçenekleri', () => {
  it('depodaki görünüm/renk birlikleri ekrandaki listelerle aynı', () => {
    const store = readFileSync(resolve('src/store/useStore.ts'), 'utf8');
    for (const id of COCKPIT_STYLE_IDS) expect(store).toMatch(new RegExp(`cockpitStyle: [^;]*'${id}'`));
    for (const id of COCKPIT_ACCENT_IDS) expect(store).toMatch(new RegExp(`cockpitAccent: [^;]*'${id}'`));
    expect(store).toContain("cockpitStyle: 'road',");
    expect(store).toContain("cockpitAccent: 'blue',");
  });

  it('gösterge sayfası seçimi ekrana iletir', () => {
    const page = readFileSync(resolve('src/components/cockpit/DigitalCockpitPage.tsx'), 'utf8');
    expect(page).toContain('styleId={cockpitStyle}');
    expect(page).toContain('accent={cockpitAccent}');
  });
});

describe('ayarlar önizlemesi ikon boyuna ezilmez (saha 2026-09-27)', () => {
  it('sürücü ekranı svg\'si ayarlar sayfasının 28px ikon kuralını geçersiz kılar', () => {
    const css = readFileSync(resolve('src/components/cockpit/digitalCockpit.css'), 'utf8');
    expect(css).toMatch(/\[data-editable="settings-page"\]\[data-editable\] svg\.caros-cockpit-screen \{\s*width: 100% !important;\s*height: 100% !important;/);
  });
});
