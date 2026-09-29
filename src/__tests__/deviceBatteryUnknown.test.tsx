/**
 * Pil yok (head unit) ya da okunamadı → native `battery: null` (UNKNOWN).
 * Eskiden `0` yazılıyor ve tema durum kümesi sahte "0%" gösteriyordu.
 * Kilit: null uçtan uca korunur, sahte "0%" ve sahte "Batarya Kritik" üretilmez;
 * gerçek %0 ise 0 olarak kalır.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.defineProperty(navigator, 'userAgent', { value: 'Vitest', configurable: true }));

const M = vi.hoisted(() => ({ showToast: vi.fn(() => 'id') }));
vi.mock('../platform/errorBus', () => ({ showToast: M.showToast }));

import { updateDeviceStatus, useDeviceStatus, type DeviceStatus } from '../platform/deviceApi';

function snapshot(): DeviceStatus {
  let seen: DeviceStatus | null = null;
  function Probe() { seen = useDeviceStatus(); return null; }
  const el = document.createElement('div');
  const root = createRoot(el);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  act(() => root.render(<Probe />));
  act(() => root.unmount());
  return seen!;
}

describe('cihaz pili — bilinmeyen sahte 0 değildir', () => {
  it('başlangıçta pil bilinmiyor (null), 0 değil', () => {
    expect(snapshot().battery).toBeNull();
  });

  it('native null → null kalır, kritik uyarı üretilmez', () => {
    updateDeviceStatus({ ready: true, battery: null, charging: false });
    expect(snapshot().battery).toBeNull();
    expect(M.showToast).not.toHaveBeenCalled();
  });

  it('bilinmeyenden ilk gerçek okuma uyarı üretmez; iki gerçek okuma arasında düşüş üretir', () => {
    updateDeviceStatus({ battery: 8 });            // önceki okuma yoktu (null)
    expect(snapshot().battery).toBe(8);
    expect(M.showToast).not.toHaveBeenCalled();
    updateDeviceStatus({ battery: 6 });            // gerçek düşüş
    expect(M.showToast).toHaveBeenCalledTimes(1);
  });

  it('gerçek %0 sıfır olarak kalır; alan hiç gelmezse son değer korunur', () => {
    updateDeviceStatus({ battery: 0 });
    expect(snapshot().battery).toBe(0);
    updateDeviceStatus({ wifiConnected: true });
    expect(snapshot().battery).toBe(0);
    updateDeviceStatus({ battery: null });
    expect(snapshot().battery).toBeNull();
  });

  it('pil gösteren yüzeyler null için "0%" basmaz', () => {
    const read = (f: string) => readFileSync(join(__dirname, '..', f), 'utf8');
    expect(read('components/themes/ProLayout.tsx')).toMatch(/device\.ready && device\.battery !== null &&/);
    expect(read('components/themes/TeslaLayout.tsx')).toMatch(/device\.ready && device\.battery !== null &&/);
    expect(read('components/layout/NewHomeLayout.tsx')).toMatch(/device\.ready && device\.battery !== null \?/);
    expect(read('components/settings/SettingsPage.tsx')).toMatch(/ready && battery !== null \?/);
  });
});
