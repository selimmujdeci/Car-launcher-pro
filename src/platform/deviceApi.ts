/**
 * Device Service — central state for Bluetooth, Wi-Fi, battery, and charging.
 *
 * Demo:  DEMO_STATUS mock, no timers.
 * Native migration:
 *   Network.addListener('networkStatusChange', s =>
 *     updateDeviceStatus({ wifiConnected: s.connected })
 *   );
 *   Battery.addListener('batteryInfoChange', b =>
 *     updateDeviceStatus({ battery: Math.round(b.batteryLevel * 100), charging: b.isCharging })
 *   );
 *   BluetoothLe.addListener('onDeviceConnected', d =>
 *     updateDeviceStatus({ btConnected: true, btDevice: d.name ?? 'Bağlı Cihaz' })
 *   );
 */
import { useState, useEffect } from 'react';
import { isNative } from './bridge';
import { CarLauncher } from './nativePlugin';

/* ── Types ───────────────────────────────────────────────── */

export interface DeviceStatus {
  ready: boolean;        // false only during native init; always true on web
  btConnected: boolean;
  btDevice: string;      // connected device name; '' when disconnected
  wifiConnected: boolean;
  wifiName: string;      // SSID; '' when disconnected or unavailable
  battery: number;       // 0–100
  charging: boolean;     // true when plugged in / charging
}

/* ── Defaults ────────────────────────────────────────────── */

const SAFE_DEFAULTS: DeviceStatus = {
  ready: false,
  btConnected: false,
  btDevice: '',
  wifiConnected: false,
  wifiName: '',
  battery: 0,
  charging: false,
};

const DEMO_STATUS: DeviceStatus = {
  ready: true,
  btConnected: true,
  btDevice: 'iPhone 14',
  wifiConnected: true,
  wifiName: 'Araç Wi-Fi',
  battery: 87,
  charging: true,
};

/* ── Module-level state ──────────────────────────────────── */

let _current: DeviceStatus = isNative ? { ...SAFE_DEFAULTS } : { ...DEMO_STATUS };
const _listeners = new Set<(s: DeviceStatus) => void>();

/* ── Push API ────────────────────────────────────────────── */

export function updateDeviceStatus(partial: Partial<DeviceStatus>): void {
  _current = {
    ..._current,
    ...partial,
    // Defensive: strings never undefined, battery clamped 0–100
    btDevice: typeof partial.btDevice === 'string' ? partial.btDevice : _current.btDevice,
    wifiName: typeof partial.wifiName === 'string' ? partial.wifiName : _current.wifiName,
    battery:  typeof partial.battery  === 'number'
      ? Math.max(0, Math.min(100, Math.round(partial.battery)))
      : _current.battery,
  };
  _listeners.forEach((fn) => fn(_current));
}

/* ── React hook ──────────────────────────────────────────── */

export function useDeviceStatus(): DeviceStatus {
  const [status, setStatus] = useState<DeviceStatus>(_current);

  useEffect(() => {
    setStatus(_current);
    _listeners.add(setStatus);

    // Native: fetch real device state on mount; mark ready regardless of outcome
    if (isNative) {
      CarLauncher.getDeviceStatus()
        .then((s) => updateDeviceStatus({ ...s, ready: true }))
        .catch(() => updateDeviceStatus({ ready: true }));
    }

    return () => { _listeners.delete(setStatus); };
  }, []);

  return status;
}
