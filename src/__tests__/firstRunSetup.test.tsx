/**
 * firstRunSetup.test — ilk kurulum sihirbazı: yalnız yeni kurulumda, mevcut
 * kullanıcıyı rahatsız etmez, adımlar mevcut kanonik yolları kullanır.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const moving = vi.hoisted(() => ({ v: false }));
vi.mock('../platform/driverPhoneRecognition', async (orig) => ({
  ...(await orig<object>()), isVehicleMovingNow: () => moving.v,
}));
vi.mock('../components/obd/OBDConnectModal', () => ({ OBDConnectModal: () => null }));
vi.mock('../components/settings/HomeWorkAddressPanel', () => ({ HomeWorkAddressPanel: () => <div>ev-is</div> }));

import { useStore } from '../store/useStore';
import { FirstRunSetup } from '../components/setup/FirstRunSetup';

const set = (p: Parameters<ReturnType<typeof useStore.getState>['updateSettings']>[0]) =>
  useStore.getState().updateSettings(p);

let root: Root; let host: HTMLDivElement;
const render = (el: React.ReactElement) => { act(() => { root.render(el); }); return host; };
const byText = (t: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.trim().startsWith(t))!;
const click = (t: string) => act(() => { byText(t).click(); });

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  moving.v = false;
  set({ setupCompleted: false, driverProfiles: [], activeDriverProfileId: null });
  host = document.createElement('div'); document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe('ilk kurulum', () => {
  it('🔒 v18 geçişi: mevcut kullanıcı kurmuş sayılır (sihirbaz çıkmaz)', () => {
    const migrate = useStore.persist.getOptions().migrate!;
    const out = migrate({ settings: {} }, 17) as { settings: { setupCompleted: boolean } };
    expect(out.settings.setupCompleted).toBe(true);
  });

  it('adla profil oluşturur, adımları gezer ve bitince bir daha çıkmaz', () => {
    render(<FirstRunSetup />);
    const input = host.querySelector('input')!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, 'Selim');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    click('Devam');
    expect(useStore.getState().settings.driverProfiles.map((d) => d.name)).toEqual(['Selim']);
    click('Devam');   // telefon
    expect(host.textContent).toContain('ev-is');
    click('Devam');   // ev/iş
    click('Devam');   // OBD
    click('Başla');
    expect(useStore.getState().settings.setupCompleted).toBe(true);
  });

  it('"Kurulumu atla" tek dokunuşla kapatır, profil oluşturmaz', () => {
    render(<FirstRunSetup />);
    click('Kurulumu atla');
    expect(useStore.getState().settings.setupCompleted).toBe(true);
    expect(useStore.getState().settings.driverProfiles).toHaveLength(0);
  });

  it('🔒 araç hareket hâlindeyken görünmez', () => {
    moving.v = true;
    render(<FirstRunSetup />);
    expect(host.innerHTML).toBe('');
  });
});
