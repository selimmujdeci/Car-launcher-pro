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
import { useEffect, useSyncExternalStore } from 'react';
import { isNative } from './bridge';
import { CarLauncher } from './nativePlugin';
import { showToast } from './errorBus';

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

let _lowBatteryWarned = false;

export function updateDeviceStatus(partial: Partial<DeviceStatus>): void {
  const prevBattery = _current.battery;
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

  // Batarya kritik uyarısı — %10 altına ilk düşüşte bir kez göster
  if (
    !_current.charging &&
    _current.battery <= 10 &&
    _current.battery < prevBattery &&
    !_lowBatteryWarned
  ) {
    _lowBatteryWarned = true;
    showToast({
      type: 'error',
      title: `Batarya Kritik: %${_current.battery}`,
      message: 'Cihazı şarj edin — navigasyon kapanabilir.',
      duration: 0, // kalıcı, kullanıcı kapatana kadar
    });
  }
  // Şarj başlayınca bayrağı sıfırla
  if (_current.charging) _lowBatteryWarned = false;

  _listeners.forEach((fn) => fn(_current));
}

/* ── React hook ──────────────────────────────────────────── */

export function useDeviceStatus(): DeviceStatus {
  const status = useSyncExternalStore(
    (onStoreChange) => {
      _listeners.add(onStoreChange as any);
      return () => { _listeners.delete(onStoreChange as any); };
    },
    () => _current,
    () => _current,
  );

  useEffect(() => {
    // Native: fetch real device state on mount; mark ready regardless of outcome
    if (isNative && !status.ready) {
      CarLauncher.getDeviceStatus()
        .then((s) => { try { updateDeviceStatus({ ...s, ready: true }); } catch { /* ignore */ } })
        .catch(() => { try { updateDeviceStatus({ ready: true }); } catch { /* ignore */ } });
    }
  }, [status.ready]);

  return status;
}

/* ── Accelerometer (G-Sensor) subscription ───────────────────── */

/**
 * DeviceMotionEvent'i dinler ve ham ivme vektörünü (x, y, z m/s²) + toplam
 * büyüklüğü callback'e iletir. Cleanup için dönen fonksiyonu çağır.
 *
 * iOS 13+ için izin gerektirir; tarayıcı desteklemiyorsa sessizce no-op döner.
 */
export function subscribeToAccelerometer(
  callback: (x: number, y: number, z: number, total: number) => void,
): () => void {
  if (typeof window === 'undefined' || !('DeviceMotionEvent' in window)) {
    return () => undefined;
  }

  const handler = (e: DeviceMotionEvent): void => {
    const a = e.accelerationIncludingGravity;
    if (!a) return;
    const x = a.x ?? 0;
    const y = a.y ?? 0;
    const z = a.z ?? 0;
    callback(x, y, z, Math.sqrt(x * x + y * y + z * z));
  };

  window.addEventListener('devicemotion', handler);
  return () => window.removeEventListener('devicemotion', handler);
}
