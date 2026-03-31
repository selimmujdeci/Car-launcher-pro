/**
 * WiFi Service — bağlı ağ adı (SSID) ve bağlantı durumu.
 *
 * Android: CarLauncherPlugin.getDeviceStatus() üzerinden ACCESS_WIFI_STATE
 *          izniyle SSID ve bağlantı durumu alır.
 * Web:     navigator.onLine ile sadece online/offline durumu bilinir.
 *
 * 30 saniyede bir poll eder; web'de online/offline eventlerini de yakalar.
 */
import { useState, useEffect } from 'react';
import { isNative } from './bridge';
import { CarLauncher } from './nativePlugin';

/* ── Types ───────────────────────────────────────────────── */

export interface WifiState {
  connected: boolean;
  ssid:      string;   // bağlı ağ adı; bilinmiyorsa ya da bağlı değilse ''
  polling:   boolean;
}

/* ── Module state ────────────────────────────────────────── */

const INITIAL: WifiState = {
  connected: typeof navigator !== 'undefined' ? navigator.onLine : true,
  ssid:      '',
  polling:   false,
};

let _state: WifiState = { ...INITIAL };
const _listeners = new Set<(s: WifiState) => void>();
let _pollTimer: ReturnType<typeof setInterval> | null = null;

function push(partial: Partial<WifiState>): void {
  _state = { ..._state, ...partial };
  _listeners.forEach((fn) => fn(_state));
}

/* ── Core poll ───────────────────────────────────────────── */

async function poll(): Promise<void> {
  try {
    if (isNative) {
      try {
        const status = await CarLauncher.getDeviceStatus();
        push({ connected: status.wifiConnected, ssid: status.wifiName });
      } catch {
        // Plugin erişilemez — mevcut durumu koru
      }
    } else {
      push({ connected: navigator.onLine, ssid: '' });
    }
  } catch { /* outer guard: push failure must not crash the poll */ }
}

/* ── Web event listeners (online/offline) ────────────────── */

let _onOnline:  (() => void) | null = null;
let _onOffline: (() => void) | null = null;

function attachWebEvents(): void {
  if (isNative || _onOnline) return;
  _onOnline  = () => { try { push({ connected: true }); } catch { /* ignore */ } };
  _onOffline = () => { try { push({ connected: false, ssid: '' }); } catch { /* ignore */ } };
  try {
    window.addEventListener('online',  _onOnline);
    window.addEventListener('offline', _onOffline);
  } catch { /* window.addEventListener failure must not crash service init */ }
}

function detachWebEvents(): void {
  if (_onOnline)  { window.removeEventListener('online',  _onOnline);  _onOnline  = null; }
  if (_onOffline) { window.removeEventListener('offline', _onOffline); _onOffline = null; }
}

/* ── Public API ──────────────────────────────────────────── */

export function startWifiService(): void {
  if (_pollTimer !== null) return;
  push({ polling: true });
  void poll(); // anında ilk veriyi al
  _pollTimer = setInterval(() => { void poll(); }, 30_000);
  attachWebEvents();
}

export function stopWifiService(): void {
  if (_pollTimer !== null) { clearInterval(_pollTimer); _pollTimer = null; }
  detachWebEvents();
  push({ polling: false });
}

export function getWifiState(): WifiState { return _state; }

/* ── React hook ──────────────────────────────────────────── */

export function useWifiState(): WifiState {
  const [state, setState] = useState<WifiState>(_state);
  useEffect(() => {
    setState(_state);
    _listeners.add(setState);
    return () => { _listeners.delete(setState); };
  }, []);
  return state;
}
