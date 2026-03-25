/**
 * OBD Service — Bluetooth ELM327 OBD-II with mock fallback.
 *
 * Architecture:
 *  - Module-level push state (same pattern as deviceApi / mediaService)
 *  - Connection state machine: idle → scanning → connecting → connected | error
 *  - Native path: CarLauncher.scanOBD() → connectOBD() → obdData events (every ~3 s)
 *  - Mock fallback: setInterval every 5 s — activated when no native or on error
 *  - useOBDState() hook only subscribes; no timers inside React
 *  - startOBD() is idempotent; stopOBD() fully cleans up
 */

import { useState, useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';
import { CarLauncher } from './nativePlugin';
import type { NativeOBDData, OBDStatusEvent } from './nativePlugin';
import { getConfig, onPerformanceModeChange } from './performanceMode';

/* ── Types ───────────────────────────────────────────────── */

export type OBDConnectionState = 'idle' | 'scanning' | 'connecting' | 'connected' | 'error';

export interface OBDData {
  connectionState: OBDConnectionState;
  source: 'real' | 'mock' | 'none';
  deviceName: string;
  speed: number;       // km/h
  rpm: number;         // engine RPM
  engineTemp: number;  // °C
  fuelLevel: number;   // 0–100 %
}

/* ── Module state ────────────────────────────────────────── */

const INITIAL: OBDData = {
  connectionState: 'idle',
  source: 'none',
  deviceName: '',
  speed: 0,
  rpm: 750,
  engineTemp: 88,
  fuelLevel: 65,
};

// Realistic starting values for mock mode
const MOCK_BASE: Pick<OBDData, 'speed' | 'rpm' | 'engineTemp' | 'fuelLevel'> = {
  speed: 42,
  rpm: 1450,
  engineTemp: 90,
  fuelLevel: 68,
};

let _current: OBDData        = { ...INITIAL };
const _listeners             = new Set<(d: OBDData) => void>();
let _mockTimerId: ReturnType<typeof setInterval> | null = null;
let _nativeHandles: PluginListenerHandle[] = [];
let _running                 = false;
let _lastNotifyTime          = 0;

// Listen for performance mode changes and restart mock with new interval
onPerformanceModeChange(() => {
  if (_running && _current.source === 'mock' && _mockTimerId !== null) {
    clearInterval(_mockTimerId);
    _mockTimerId = null;
    const pollMs = getConfig().obdPollInterval;
    _mockTimerId = setInterval(_tickMock, pollMs);
  }
});

/* ── Core helpers ────────────────────────────────────────── */

function _notify(): void {
  const now = Date.now();
  const debounceMs = getConfig().obdListenerDebounce;
  if (now - _lastNotifyTime < debounceMs) return;
  _lastNotifyTime = now;
  const snap = { ..._current };
  _listeners.forEach((fn) => fn(snap));
}

function _merge(partial: Partial<OBDData>): void {
  _current = { ..._current, ...partial };
  _notify();
}

function _clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/* ── Mock simulation ─────────────────────────────────────── */

function _tickMock(): void {
  _merge({
    speed:      _clamp(Math.round(_current.speed      + (Math.random() * 14 - 7)),   0,   180),
    rpm:        _clamp(Math.round(_current.rpm        + (Math.random() * 300 - 150)), 650, 4000),
    engineTemp: _clamp(Math.round(_current.engineTemp + (Math.random() * 2  - 1)),   75,   105),
    fuelLevel:  _clamp(Math.round(_current.fuelLevel  - Math.random() * 0.3),        0,   100),
  });
}

function _startMock(): void {
  if (_mockTimerId !== null) return;
  _merge({
    connectionState: 'connected',
    source: 'mock',
    deviceName: '',
    ...MOCK_BASE,
  });
  const pollMs = getConfig().obdPollInterval;
  _mockTimerId = setInterval(_tickMock, pollMs);
}

function _stopMock(): void {
  if (_mockTimerId !== null) {
    clearInterval(_mockTimerId);
    _mockTimerId = null;
  }
}

/* ── Native OBD helpers ──────────────────────────────────── */

async function _removeNativeHandles(): Promise<void> {
  const handles = _nativeHandles.splice(0);
  for (const h of handles) {
    try { await h.remove(); } catch { /* ignore */ }
  }
}

async function _startNative(): Promise<void> {
  _merge({ connectionState: 'scanning' });

  // 1. Get paired Bluetooth devices
  const { devices } = await CarLauncher.scanOBD();

  // Prefer devices whose name suggests an OBD/ELM327 adapter
  const candidate =
    devices.find((d) => /obd|elm|vlink|obdii|kw|veepeak/i.test(d.name)) ??
    devices[0];

  if (!candidate) {
    throw new Error('Eşleşmiş OBD adaptörü bulunamadı');
  }

  _merge({ connectionState: 'connecting', deviceName: candidate.name });

  // 2. Register disconnect / error listener (fires on subsequent state changes)
  const statusHandle = await CarLauncher.addListener(
    'obdStatus',
    (_event: OBDStatusEvent) => {
      // Connection lost while running → fall back to mock
      void _removeNativeHandles().then(() => {
        _stopMock(); // no-op if already stopped
        _startMock();
      });
    },
  );

  // 3. Register data listener — throttled by the native 3 s polling interval
  const dataHandle = await CarLauncher.addListener(
    'obdData',
    (data: NativeOBDData) => {
      const patch: Partial<OBDData> = {};
      if (data.speed      >= 0) patch.speed      = data.speed;
      if (data.rpm        >= 0) patch.rpm        = data.rpm;
      if (data.engineTemp >= 0) patch.engineTemp = data.engineTemp;
      if (data.fuelLevel  >= 0) patch.fuelLevel  = data.fuelLevel;
      if (Object.keys(patch).length) _merge(patch);
    },
  );

  _nativeHandles = [statusHandle, dataHandle];

  // 4. Connect — resolves when ELM327 init completes, rejects on failure
  await CarLauncher.connectOBD({ address: candidate.address });

  // 5. Mark as live
  _merge({ connectionState: 'connected', source: 'real' });
}

/* ── Public API ──────────────────────────────────────────── */

/**
 * Start OBD.
 * Tries native Bluetooth first; silently falls back to mock on any failure.
 * Idempotent — safe to call multiple times.
 */
export function startOBD(): void {
  if (_running) return;
  _running = true;

  void (async () => {
    if (Capacitor.isNativePlatform()) {
      try {
        await _startNative();
        return; // success — don't start mock
      } catch {
        // Native failed → fall through to mock
        await _removeNativeHandles();
        _merge({ connectionState: 'error', source: 'none', deviceName: '' });
        // Brief pause so the UI can show the error state before switching to mock
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
    _startMock();
  })();
}

/**
 * Stop all OBD activity and reset state.
 */
export function stopOBD(): void {
  _running = false;
  _stopMock();
  void _removeNativeHandles().then(() => {
    if (Capacitor.isNativePlatform()) {
      CarLauncher.disconnectOBD().catch(() => { /* ignore */ });
    }
  });
  _merge({ connectionState: 'idle', source: 'none', deviceName: '' });
}

/**
 * Push live data directly from the native plugin (alternative to listener pattern).
 */
export function updateOBDData(partial: Partial<NativeOBDData>): void {
  const patch: Partial<OBDData> = { source: 'real', connectionState: 'connected' };
  if (partial.speed      !== undefined && partial.speed      >= 0) patch.speed      = partial.speed;
  if (partial.rpm        !== undefined && partial.rpm        >= 0) patch.rpm        = partial.rpm;
  if (partial.engineTemp !== undefined && partial.engineTemp >= 0) patch.engineTemp = partial.engineTemp;
  if (partial.fuelLevel  !== undefined && partial.fuelLevel  >= 0) patch.fuelLevel  = partial.fuelLevel;
  _merge(patch);
}

/* ── External subscription ───────────────────────────────── */

/**
 * Subscribe to every OBD state push from outside React.
 * Returns a cleanup function. Used by obdAlerts.ts.
 */
export function onOBDData(fn: (d: OBDData) => void): () => void {
  _listeners.add(fn as Parameters<typeof _listeners.add>[0]);
  return () => _listeners.delete(fn as Parameters<typeof _listeners.delete>[0]);
}

/* ── React hook ──────────────────────────────────────────── */

export function useOBDState(): OBDData {
  const [state, setState] = useState<OBDData>(() => ({ ..._current }));

  useEffect(() => {
    setState({ ..._current }); // sync on mount
    _listeners.add(setState);
    return () => { _listeners.delete(setState); };
  }, []);

  return state;
}
