/**
 * Sürüş ekranı "görünümü değiştir" düğmesi (kullanıcı isteği 2026-09-27):
 * sürüşte de tek dokunuşla sıradaki görünüme geçer, adı kısa süre görünür.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useStore } from '../store/useStore';
import { DigitalCockpitPage } from '../components/cockpit/DigitalCockpitPage';
import {
  COCKPIT_ACCENT_IDS, COCKPIT_ALWAYS_DARK_STYLES, COCKPIT_STYLE_IDS, cockpitSurfaceMode, nextCockpitAccent, nextCockpitStyle,
} from '../components/cockpit/cockpitLayout';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let root: Root; let host: HTMLDivElement;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  useStore.getState().updateSettings({ cockpitStyle: 'road', cockpitAccent: 'blue', dayNightMode: 'day' });
  host = document.createElement('div'); document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); });

describe('sürüş ekranı görünüm düğmesi', () => {
  it('sıradaki görünüm; sonda başa döner', () => {
    expect(COCKPIT_STYLE_IDS.map(nextCockpitStyle)).toEqual([...COCKPIT_STYLE_IDS.slice(1), COCKPIT_STYLE_IDS[0]]);
  });

  it('tek dokunuş görünümü değiştirir ve adını kısa süre gösterir; sayfa kaydırmayı başlatmaz', () => {
    act(() => root.render(<DigitalCockpitPage />));
    const btn = host.querySelector('[data-testid="cockpit-style-switch"]') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.hasAttribute('data-no-page-swipe')).toBe(true);
    expect(btn.getAttribute('aria-label')).toContain('Yol');

    act(() => btn.click());
    expect(useStore.getState().settings.cockpitStyle).toBe('minimal');
    expect(host.querySelector('[data-testid="cockpit-style-toast"]')?.textContent).toBe('Sade');
    expect(btn.textContent).toContain('Sade');

    act(() => { vi.advanceTimersByTime(1500); });
    expect(host.querySelector('[data-testid="cockpit-style-toast"]')).toBeNull();
  });

  /* Saha 2026-09-28 (telefon, gündüz · Neon): imza görünümler gündüz de koyu
     çizildiği için gündüz renkli (koyu) düğme koyu zeminde görünmüyordu. */
  it('düğme görünümün GERÇEK zeminine göre renklenir: koyu imza görünümde gündüz de açık renk', () => {
    expect(COCKPIT_ALWAYS_DARK_STYLES.map((s) => cockpitSurfaceMode(s, 'day'))).toEqual(['night', 'night', 'night', 'night']);
    expect(cockpitSurfaceMode('road', 'day')).toBe('day');
    expect(cockpitSurfaceMode('road', 'night')).toBe('night');

    useStore.getState().updateSettings({ dayNightMode: 'day', cockpitStyle: 'neon' });
    act(() => root.render(<DigitalCockpitPage />));
    const btn = () => host.querySelector('[data-testid="cockpit-style-switch"]') as HTMLButtonElement;
    const screenMode = () => host.querySelector('[data-caros-cockpit="screen"]');
    expect(btn().style.color).toBe('rgba(255, 255, 255, 0.86)');                 // koyu zeminde açık
    act(() => btn().click());                                                     // neon → spor (yine koyu)
    expect(host.querySelector('[data-testid="cockpit-style-toast"]')!.getAttribute('style')).toContain('color: rgb(255, 255, 255)');

    useStore.getState().updateSettings({ cockpitStyle: 'minimal' });
    act(() => root.render(<DigitalCockpitPage />));
    expect(btn().style.color).toBe('rgba(0, 0, 0, 0.78)');                        // açık zeminde koyu
    expect(screenMode()).not.toBeNull();
  });

  it('bilinmeyen/eski görünüm kimliğinde etiket "undefined" olmaz', () => {
    useStore.getState().updateSettings({ cockpitStyle: 'eski-bir-gorunum' as never });
    act(() => root.render(<DigitalCockpitPage />));
    const btn = host.querySelector('[data-testid="cockpit-style-switch"]') as HTMLButtonElement;
    expect(btn.getAttribute('aria-label')).toBe('Sürüş ekranı görünümünü değiştir (şu an Yol)');
    expect(btn.textContent).not.toContain('undefined');
  });
});

/* Kullanıcı isteği 2026-09-28: renk de sürüş ekranından değişir; Ayarlar'daki
   "Sürücü Ekranı" seçicisi kaldırıldı (görünüm + renk artık tek yerde). */
describe('sürüş ekranı renk düğmesi', () => {
  it('sıradaki renk; sonda başa döner', () => {
    expect(COCKPIT_ACCENT_IDS.map(nextCockpitAccent)).toEqual([...COCKPIT_ACCENT_IDS.slice(1), COCKPIT_ACCENT_IDS[0]]);
  });

  it('tek dokunuş rengi değiştirir, adını gösterir; sayfa kaydırmayı başlatmaz; koyu zeminde de açık renk', () => {
    act(() => root.render(<DigitalCockpitPage />));
    const btn = () => host.querySelector('[data-testid="cockpit-accent-switch"]') as HTMLButtonElement;
    expect(btn().hasAttribute('data-no-page-swipe')).toBe(true);
    expect(btn().getAttribute('aria-label')).toBe('Sürüş ekranı rengini değiştir (şu an Mavi)');
    act(() => btn().click());
    expect(useStore.getState().settings.cockpitAccent).toBe('red');
    expect(host.querySelector('[data-testid="cockpit-style-toast"]')?.textContent).toBe('Kırmızı');
    expect(btn().textContent).toContain('Kırmızı');

    useStore.getState().updateSettings({ cockpitStyle: 'aurora' });                 // gündüz ama koyu zemin
    act(() => root.render(<DigitalCockpitPage />));
    expect(btn().style.color).toBe('rgba(255, 255, 255, 0.86)');
  });

  it('Ayarlar\'da ayrı "Sürücü Ekranı" seçicisi yok', () => {
    const src = readFileSync(resolve(__dirname, '../components/settings/SettingsPage.tsx'), 'utf8');
    expect(src).not.toMatch(/CockpitStylePicker/);
    expect(src).not.toMatch(/title="Sürücü Ekranı"/);
  });
});
