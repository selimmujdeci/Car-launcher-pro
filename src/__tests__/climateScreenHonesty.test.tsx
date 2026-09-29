/**
 * İklim ekranı — komut yolu yokken araç durumu UYDURMAZ.
 * Eskiden kabin sıcaklığı setInterval ile simüle ediliyor, A/C/koltuk ısıtma
 * açık görünüyor ve dokunuşlar araca gitmeden "uygulandı" gibi duruyordu.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.defineProperty(navigator, 'userAgent', { value: 'Vitest', configurable: true }));

const source = vi.hoisted(() => ({ ambient: null as number | null }));
vi.mock('../hooks/useCanonicalVehicleSignal', () => ({ useAmbientTemp: () => source.ambient }));

import { ClimateScreen } from '../components/climate/ClimateScreen';

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  source.ambient = null;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
});

describe('ClimateScreen — bağlı değil', () => {
  it('bildirim görünür, kontroller devre dışı, sıcaklıklar "—"; kabin simülasyonu yok', () => {
    act(() => root.render(<ClimateScreen onClose={() => {}} />));
    expect(container.querySelector('[data-testid="climate-not-linked"]')).not.toBeNull();
    expect(container.textContent).not.toMatch(/kabin/i);
    expect(container.textContent).not.toContain('22.0');
    expect(container.textContent).not.toContain('HIZ 3');
    const plus = [...container.querySelectorAll('button')].filter((b) => b.textContent === '+');
    expect(plus).toHaveLength(2);
    expect(plus.every((b) => b.disabled)).toBe(true);
    expect((container.querySelector('button[aria-label="Klima gücü"]') as HTMLButtonElement).disabled).toBe(true);
    expect(container.querySelector('[data-testid="climate-outside-temp"]')?.textContent).toBe('—');
  });

  it('dış sıcaklık yalnız kanonik canlı sinyalden gelir', () => {
    source.ambient = 17.6;
    act(() => root.render(<ClimateScreen />));
    expect(container.querySelector('[data-testid="climate-outside-temp"]')?.textContent).toBe('18°C');
  });

  it('komut yolu varsa (linked) kontroller çalışır', () => {
    act(() => root.render(<ClimateScreen linked />));
    expect(container.querySelector('[data-testid="climate-not-linked"]')).toBeNull();
    const plus = [...container.querySelectorAll('button')].find((b) => b.textContent === '+')!;
    expect(plus.disabled).toBe(false);
    act(() => plus.click());
    expect(container.textContent).toContain('22.5');
  });

  it('kaynakta zamanlayıcılı kabin simülasyonu kalmadı', () => {
    const src = readFileSync(join(__dirname, '../components/climate/ClimateScreen.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    expect(src).not.toMatch(/setInterval/);
    expect(src).not.toMatch(/\b[ps]\.cabin\b|\bcabin:/);
  });
});
