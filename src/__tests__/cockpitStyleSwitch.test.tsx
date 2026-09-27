/**
 * Sürüş ekranı "görünümü değiştir" düğmesi (kullanıcı isteği 2026-09-27):
 * sürüşte de tek dokunuşla sıradaki görünüme geçer, adı kısa süre görünür.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useStore } from '../store/useStore';
import { DigitalCockpitPage } from '../components/cockpit/DigitalCockpitPage';
import { COCKPIT_STYLE_IDS, nextCockpitStyle } from '../components/cockpit/cockpitLayout';

let root: Root; let host: HTMLDivElement;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  useStore.getState().updateSettings({ cockpitStyle: 'road' });
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
});
