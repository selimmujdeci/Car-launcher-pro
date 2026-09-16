/**
 * WiFi Service — bağlı ağ adı (SSID) ve bağlantı durumu.
 *
 * Android: CarLauncherPlugin.getDeviceStatus() üzerinden ACCESS_WIFI_STATE
 *          izniyle SSID ve bağlantı durumu alır.
 * Web:     Wi-Fi API'si yoktur; kanonik `ConnectivityAuthority`nin bildirdiği
 *          AKTİF TAŞIMA okunur (`transport === 'WIFI'`).
 *
 * ⚠️ BU SERVİS İNTERNET GERÇEĞİ ÜRETMEZ (§22). "Wi-Fi bağlı" ile "internet var"
 * AYNI ŞEY DEĞİLDİR ve tersi de doğrudur: Wi-Fi yokken Ethernet üzerinden
 * çevrimiçi olunabilir. Bir işin yapılıp yapılamayacağı YALNIZ
 * `ConnectivityPolicy`den sorulur.
 *
 * 30 saniyede bir poll eder (SSID için); web'de kanonik hükmü dinler.
 */
import { useState, useEffect } from 'react';
import { isNative } from './bridge';
import { CarLauncher } from './nativePlugin';
import { getConnectivitySnapshot, subscribeConnectivity } from './connectivity/connectivityAuthority';

/* ── Types ───────────────────────────────────────────────── */

export interface WifiState {
  connected: boolean;
  ssid:      string;   // bağlı ağ adı; bilinmiyorsa ya da bağlı değilse ''
  polling:   boolean;
}

/* ── Module state ────────────────────────────────────────── */

/** Kanonik hükmün bildirdiği aktif taşıma Wi-Fi mi (web yolu için). */
function _canonicalWifi(): boolean {
  return getConnectivitySnapshot().transport === 'WIFI';
}

const INITIAL: WifiState = {
  connected: _canonicalWifi(),
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
      push({ connected: _canonicalWifi(), ssid: '' });
    }
  } catch { /* outer guard: push failure must not crash the poll */ }
}

/* ── Web event listeners (online/offline) ────────────────── */

let _connectivityUnsub: (() => void) | null = null;

function attachWebEvents(): void {
  if (isNative || _connectivityUnsub) return;
  /* F7-B: tarayıcı `online`/`offline` olayları DİNLENMEZ — kanonik hüküm
     dinlenir; ikinci ağ gözlemcisi AÇILMAZ (§29). */
  try {
    _connectivityUnsub = subscribeConnectivity(() => {
      try { push({ connected: _canonicalWifi(), ssid: '' }); } catch { /* ignore */ }
    });
  } catch { /* abonelik hatası servis kurulumunu ASLA kırmaz */ }
}

function detachWebEvents(): void {
  if (_connectivityUnsub) { _connectivityUnsub(); _connectivityUnsub = null; }
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
