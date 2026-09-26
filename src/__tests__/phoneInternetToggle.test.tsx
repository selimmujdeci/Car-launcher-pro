/**
 * Ayarlar · Bluetooth İnternet — "Telefon Bluetooth ile bağlanınca internetini kullansın mı?"
 * Evet/Hayır tercihi native'e yazılır; ölçülemeyen "bağlı" denmez.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

let pref = false;
const setPhoneInternet = vi.fn(async (o: { enabled: boolean }) => { pref = o.enabled; return { enabled: o.enabled, attempt: 'STARTED' as const }; });
vi.mock('../platform/bridge', () => ({ isNative: true }));
vi.mock('../platform/nativePlugin', () => ({
  CarLauncher: {
    getPhoneInternet: async () => ({ enabled: pref, state: 'DISCONNECTED' }),
    setPhoneInternet: (o: { enabled: boolean }) => setPhoneInternet(o),
  },
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null; let host: HTMLDivElement | null = null;
afterEach(() => { act(() => root?.unmount()); host?.remove(); });

describe('PhoneInternetToggle', () => {
  it('Evet → native tercihi açar, Hayır → kapatır', async () => {
    const { PhoneInternetToggle } = await import('../components/settings/PhoneInternetToggle');
    host = document.createElement('div'); document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root!.render(<PhoneInternetToggle />); });
    const btn = (t: string) => [...host!.querySelectorAll('button')].find((b) => b.textContent === t)!;
    await act(async () => { btn('Evet').click(); });
    expect(setPhoneInternet).toHaveBeenLastCalledWith({ enabled: true });
    expect(host.textContent).toContain('Bluetooth ile internet paylaşımı');
    await act(async () => { btn('Hayır').click(); });
    expect(setPhoneInternet).toHaveBeenLastCalledWith({ enabled: false });
  });

  it('durum cümleleri: yalnız ölçülen CONNECTED "kullanılıyor" der', async () => {
    const { describePhoneInternet } = await import('../components/settings/PhoneInternetToggle');
    expect(describePhoneInternet('CONNECTED', null)).toContain('kullanılıyor');
    expect(describePhoneInternet('DISCONNECTED', 'STARTED')).not.toContain('kullanılıyor');
    expect(describePhoneInternet('UNSUPPORTED', null)).toContain('hotspot');
    expect(describePhoneInternet('DISCONNECTED', 'NO_PHONE')).toContain('eşleşmiş telefon yok');
  });
});
