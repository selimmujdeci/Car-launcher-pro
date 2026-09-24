/**
 * driverSwitcher.test — durum çubuğundan hızlı sürücü değiştirme (tüm temalar).
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const sys = vi.hoisted(() => ({ setVolume: vi.fn(), setBrightness: vi.fn() }));
vi.mock('../platform/systemSettingsService', async (orig) => ({
  ...(await orig<object>()), setVolume: sys.setVolume, setBrightness: sys.setBrightness,
}));
const nav = vi.hoisted(() => ({ openDrawer: vi.fn(), focus: vi.fn() }));
vi.mock('../platform/drawerBus', async (orig) => ({ ...(await orig<object>()), openDrawer: nav.openDrawer }));
vi.mock('../platform/settingsFocusBus', async (orig) => ({ ...(await orig<object>()), focusSettingsSection: nav.focus }));

import { useStore } from '../store/useStore';
import { DriverSwitcher } from '../components/common/DriverSwitcher';

const PAL = { ink: '#fff', ink2: '#ccc', accent: '#e0a23c' };
let root: Root; let host: HTMLDivElement;
const btn = (re: RegExp) => [...host.querySelectorAll('button')].find((b) => re.test(b.textContent ?? '') || re.test(b.getAttribute('aria-label') ?? ''))!;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  useStore.getState().updateSettings({
    volume: 10, activeDriverProfileId: null,
    driverProfiles: [{ id: 'd1', name: 'Ayşe', color: '#60a5fa', createdAt: 'x', lastUsedAt: null, prefs: { volume: 66 } }],
  });
  host = document.createElement('div'); document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(<DriverSwitcher palette={PAL} size={15} />));
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe('durum çubuğu sürücü değiştirici', () => {
  it('🔒 sürücü yokken "Misafir" yazar (sahte sürücü adı yok)', () => {
    expect(host.textContent).toContain('Misafir');
  });

  it('🔒 listeden seçilen sürücü uygulanır (tek otorite: driverProfileService)', () => {
    act(() => btn(/sürücü seç/i).click());
    act(() => (host.querySelector('button[role="menuitemradio"]') as HTMLButtonElement).click());
    expect(useStore.getState().settings.activeDriverProfileId).toBe('d1');
    expect(useStore.getState().settings.volume).toBe(66);
    expect(host.textContent).toContain('Ayşe');
  });

  it('"Sürücüleri yönet" Ayarlar › Profiller açar', () => {
    act(() => btn(/sürücü seç/i).click());
    act(() => btn(/Sürücüleri yönet/).click());
    expect(nav.openDrawer).toHaveBeenCalledWith('settings');
    expect(nav.focus).toHaveBeenCalledWith('profiles');
  });
});
