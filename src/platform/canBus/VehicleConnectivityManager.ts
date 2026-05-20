/**
 * VehicleConnectivityManager — Patch 5
 *
 * Her araç sinyal kaynağının bağlantı sağlığını izler.
 * Yeni adapter veya thread oluşturmaz — mevcut servislerden okur.
 *
 * Kaynaklar ve öncelik:
 *   MCU/CANBOX  (0.92) — Hiworld canbox native CAN
 *   OBD         (0.85) — Bluetooth ELM327
 *   RAW_CAN     (0.80) — ELM327 ATMA modu
 *   GPS         (0.70) — GNSS fallback
 *
 * Bağlantı noktaları:
 *   ← useHALStatusStore : CAN phase (MCU sağlığı)
 *   ← onOBDData         : OBD veri akışı
 *   ← onGPSLocation     : GPS konum akışı
 *   ← ProfileSignalGate : Safe Mode durumu
 */

import { useHALStatusStore }       from '../vehicleDataLayer/halStatusStore';
import { onOBDData }               from '../obdService';
import { onGPSLocation }           from '../gpsService';
import { isGateSafeMode, getSafeModeReason } from './ProfileSignalGate';

// ── Tipler ───────────────────────────────────────────────────────────────────

export type ConnectivitySource = 'MCU' | 'OBD' | 'RAW_CAN' | 'GPS';

export interface SourceHealth {
  source:       ConnectivitySource;
  available:    boolean;       // kaynak cihazda mevcut mu
  connected:    boolean;       // aktif veri akışı var mı
  confidence:   number;        // 0.0–1.0 — temel güven
  lastSignalAt: number;        // epoch ms, 0 = hiç gelmedi
  safeMode:     boolean;       // gate bu kaynak için safe mod'da mı
  errorReason:  string | null; // bağlantı hatası varsa
}

// ── Sabitler ─────────────────────────────────────────────────────────────────

const BASE_CONFIDENCE: Record<ConnectivitySource, number> = {
  MCU:     0.92,
  OBD:     0.85,
  RAW_CAN: 0.80,
  GPS:     0.70,
};

/** Bu kadar ms veri gelmezse kaynak stale sayılır */
const STALE_THRESHOLD: Record<ConnectivitySource, number> = {
  MCU:     5_000,
  OBD:     4_000,
  RAW_CAN: 4_000,
  GPS:     10_000,
};

// ── Dahili state ──────────────────────────────────────────────────────────────

const _state: Record<ConnectivitySource, SourceHealth> = {
  MCU:     _makeHealth('MCU'),
  OBD:     _makeHealth('OBD'),
  RAW_CAN: _makeHealth('RAW_CAN'),
  GPS:     _makeHealth('GPS'),
};

function _makeHealth(source: ConnectivitySource): SourceHealth {
  return { source, available: false, connected: false,
           confidence: 0, lastSignalAt: 0, safeMode: true, errorReason: null };
}

// Listener'lar
const _listeners = new Set<(snapshot: Readonly<typeof _state>) => void>();

// Staleness check interval
let _staleCheckTimer: ReturnType<typeof setInterval> | null = null;
let _halUnsub:   (() => void) | null = null;
let _obdUnsub:   (() => void) | null = null;
let _gpsUnsub:   (() => void) | null = null;
let _started = false;

// ── API ───────────────────────────────────────────────────────────────────────

/**
 * Connectivity Manager'ı başlat.
 * SystemBoot Wave 2'de, VehicleDataLayer'dan sonra çağrılmalı.
 * @returns cleanup fonksiyonu
 */
export function startConnectivityManager(): () => void {
  if (_started) return () => {};
  _started = true;

  // MCU/CANBOX — HAL status store üzerinden
  _halUnsub = useHALStatusStore.subscribe((s) => {
    const phase = s.canPhase;
    const connected = phase === 'CONNECTED';
    const available = phase !== 'IDLE';
    _update('MCU', {
      available,
      connected,
      confidence: connected ? BASE_CONFIDENCE.MCU : 0,
      errorReason: phase === 'FALLBACK_ACTIVE' ? 'CAN frame alınamadı' :
                   phase === 'NO_FRAME_TIMEOUT' ? 'Timeout' : null,
    });
  });

  // OBD — veri akışı varsa connected
  _obdUnsub = onOBDData((_d) => {
    _update('OBD', {
      available:  true,
      connected:  true,
      confidence: BASE_CONFIDENCE.OBD,
      errorReason: null,
    });
  });

  // GPS
  _gpsUnsub = onGPSLocation((loc) => {
    if (!loc) return;
    _update('GPS', {
      available:  true,
      connected:  true,
      confidence: BASE_CONFIDENCE.GPS,
      errorReason: null,
    });
  });

  // Staleness checker — 3s'de bir çalış
  _staleCheckTimer = setInterval(_checkStaleness, 3_000);

  return _stop;
}

/** Anlık snapshot — tüm kaynakların sağlık durumu */
export function getConnectivitySnapshot(): Readonly<typeof _state> {
  return _state;
}

/** Bir kaynağın sağlık durumu */
export function getSourceHealth(source: ConnectivitySource): SourceHealth {
  return _state[source];
}

/** Aktif (connected + confidence > 0) kaynakları döner */
export function getActiveSources(): SourceHealth[] {
  return (Object.values(_state) as SourceHealth[]).filter(s => s.connected);
}

/** Değişiklik listener'ı ekle */
export function onConnectivityChange(fn: (s: Readonly<typeof _state>) => void): () => void {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

/** Raw CAN kaynağını manuel güncelle (ElmRawCanMonitor'dan) */
export function markRawCanSignal(): void {
  _update('RAW_CAN', {
    available: true, connected: true,
    confidence: BASE_CONFIDENCE.RAW_CAN, errorReason: null,
  });
}

// ── Yardımcılar ───────────────────────────────────────────────────────────────

function _update(source: ConnectivitySource, patch: Partial<SourceHealth>): void {
  const prev = _state[source];
  const now  = Date.now();
  _state[source] = {
    ...prev,
    ...patch,
    lastSignalAt: patch.connected ? now : prev.lastSignalAt,
    safeMode:     source === 'MCU' ? false : isGateSafeMode(),
    // Safe mode reason için log
    errorReason: patch.errorReason ?? (isGateSafeMode() ? getSafeModeReason() : null),
  };
  _notify();
}

function _checkStaleness(): void {
  const now = Date.now();
  let changed = false;
  for (const source of Object.keys(_state) as ConnectivitySource[]) {
    const h = _state[source];
    if (!h.connected) continue;
    const threshold = STALE_THRESHOLD[source];
    if (h.lastSignalAt > 0 && now - h.lastSignalAt > threshold) {
      _state[source] = { ...h, connected: false, confidence: 0, errorReason: 'Sinyal kesildi' };
      changed = true;
    }
  }
  if (changed) _notify();
}

function _notify(): void {
  _listeners.forEach(fn => {
    try { fn(_state); } catch { /* listener hataları sızdırmaz */ }
  });
}

function _stop(): void {
  _started = false;
  _halUnsub?.(); _halUnsub = null;
  _obdUnsub?.(); _obdUnsub = null;
  _gpsUnsub?.(); _gpsUnsub = null;
  if (_staleCheckTimer) { clearInterval(_staleCheckTimer); _staleCheckTimer = null; }
  _listeners.clear();
}
