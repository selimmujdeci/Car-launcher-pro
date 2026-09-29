/** Web'de cihaz köprüsü yok → sahte "iPhone 14 bağlı · %87 şarjda" basılmaz. */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.defineProperty(navigator, 'userAgent', { value: 'Vitest', configurable: true }));

import { useDeviceStatus, type DeviceStatus } from '../platform/deviceApi';

describe('deviceApi — web başlangıç durumu', () => {
  it('ready=false, BT/Wi-Fi bağlı DEĞİL, uydurma cihaz adı yok', () => {
    let seen: DeviceStatus | null = null;
    function Probe() { seen = useDeviceStatus(); return null; }
    const el = document.createElement('div');
    const root = createRoot(el);
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    act(() => root.render(<Probe />));
    expect(seen).toMatchObject({ ready: false, btConnected: false, btDevice: '', wifiName: '' });
    act(() => root.unmount());
  });
});
