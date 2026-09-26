/**
 * Telefon Merkezi · Bağlantı — Bluetooth izni yokken İZİN VERİLEBİLİR (saha 2026-09-26:
 * head unit müşterisi "Bluetooth izni yok" görüyordu; tek düğme Bluetooth ayarlarını
 * açıyor, kullanıcı telefonu yeniden eşleştirmeye çalışıp ünite tarafından reddediliyordu).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const requestAndroid13Permissions = vi.fn(async () => ({ requested: 1 }));
const requestNotificationAccess = vi.fn(async () => undefined);
const launchApp = vi.fn(async () => undefined);
vi.mock('../platform/bridge', () => ({ isNative: true }));
vi.mock('../platform/nativePlugin', () => ({
  CarLauncher: {
    getBluetoothPhones: async () => ({ state: 'NO_PERMISSION' }),
    requestAndroid13Permissions: (...a: unknown[]) => requestAndroid13Permissions(...(a as [])),
    requestNotificationAccess: (...a: unknown[]) => requestNotificationAccess(...(a as [])),
    launchApp: (...a: unknown[]) => launchApp(...(a as [])),
  },
}));
vi.mock('../platform/notificationService', () => ({ useNotificationState: () => ({ hasPermission: true, listenerConnected: true }) }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null; let host: HTMLDivElement | null = null;
afterEach(() => { act(() => root?.unmount()); host?.remove(); });

describe('Bluetooth izni yok', () => {
  it('"İzin ver" izni ister, "Uygulama izinleri" izin sayfasını açar; eşleştirmeye yönlendirmez', async () => {
    const { PhoneConnectionTab } = await import('../components/phone/PhoneConnectionTab');
    host = document.createElement('div'); document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root!.render(<PhoneConnectionTab />); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    const btn = (t: string) => [...host!.querySelectorAll('button')].find((b) => b.textContent?.includes(t));
    expect(host.textContent).toContain('Bluetooth izni yok');
    expect(btn('Bluetooth Ayarlarını Aç')).toBeUndefined();
    await act(async () => { btn('İzin ver')!.click(); });
    expect(requestAndroid13Permissions).toHaveBeenCalledTimes(1);
    act(() => { btn('Uygulama izinleri')!.click(); });
    expect(requestNotificationAccess).toHaveBeenCalledWith({ step: 'appDetails' });
    expect(launchApp).not.toHaveBeenCalled();
  });
});
