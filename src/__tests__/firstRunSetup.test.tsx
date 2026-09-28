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
import { buildEmblemBoot } from '../components/layout/emblemBoot';

const set = (p: Parameters<ReturnType<typeof useStore.getState>['updateSettings']>[0]) =>
  useStore.getState().updateSettings(p);

let root: Root; let host: HTMLDivElement;
const render = (el: React.ReactElement) => { act(() => { root.render(el); }); return host; };
const byText = (t: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.trim().startsWith(t))!;
const click = (t: string) => act(() => { byText(t).click(); });
const type = (input: HTMLInputElement, v: string) => act(() => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, v);
  input.dispatchEvent(new Event('input', { bubbles: true }));
});

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
    click('Devam');   // araç (seçim yok → yazılmaz)
    expect(useStore.getState().settings.vehicleProfiles).toHaveLength(0);
    click('Devam');   // telefon
    expect(host.textContent).toContain('ev-is');
    click('Devam');   // ev/iş
    click('Devam');   // OBD
    click('Başla');
    expect(useStore.getState().settings.setupCompleted).toBe(true);
  });

  it('araç adımı: "fıat" ara → Fiat seç → anahtar açık → açılış Fiat amblemli', () => {
    set({ vehicleProfiles: [], activeVehicleProfileId: null, bootSplashStyle: 'caros' });
    render(<FirstRunSetup />);
    click('Devam');                                   // ad boş → profil yok
    const q = host.querySelector('input[aria-label="Marka ara"]') as HTMLInputElement;
    type(q, 'fıat');
    const tiles = [...host.querySelectorAll('[role="radio"]')];
    expect(tiles[0]!.textContent).toBe('Fiat');
    act(() => { (tiles[0] as HTMLButtonElement).click(); });
    const sw = host.querySelector('input[role="switch"]') as HTMLInputElement;
    expect(sw.checked).toBe(true);
    expect(host.querySelector('[aria-label="Fiat amblemi"]')).not.toBeNull();
    click('Devam');
    const st = useStore.getState().settings;
    expect(st.vehicleProfiles[0]).toMatchObject({ brandId: 'fiat', identitySource: 'user_selected' });
    expect(st.bootSplashStyle).toBe('emblem');
    const boot = buildEmblemBoot();
    expect(boot?.emblem).toMatchObject({ kind: 'logo', name: 'Fiat' });
  });

  it('araç adımı: anahtar kapatılırsa açılış CarOS Pro kalır', () => {
    set({ vehicleProfiles: [], activeVehicleProfileId: null, bootSplashStyle: 'caros' });
    render(<FirstRunSetup />);
    click('Devam');
    type(host.querySelector('input[aria-label="Marka ara"]') as HTMLInputElement, 'togg');
    act(() => { (host.querySelector('[role="radio"]') as HTMLButtonElement).click(); });
    act(() => { (host.querySelector('input[role="switch"]') as HTMLInputElement).click(); });
    click('Devam');
    expect(useStore.getState().settings.vehicleProfiles[0]?.brandId).toBe('togg');
    expect(useStore.getState().settings.bootSplashStyle).toBe('caros');
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
