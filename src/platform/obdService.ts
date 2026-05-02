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

import { useSyncExternalStore } from 'react';
import { Capacitor } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';
import { CarLauncher } from './nativePlugin';
import type { NativeOBDData } from './nativePlugin';
import { getConfig, onPerformanceModeChange } from './performanceMode';
import { runtimeManager }                     from '../core/runtime/AdaptiveRuntimeManager';
import { logError } from './crashLogger';
import { useRafSmoothed } from './rafSmoother';
import { parseBinaryOBDFrame, hasBinaryFrame } from './obdBinaryParser';
import {
  hydrateCanSnapshotSync,
  hydrateCanSnapshotAsync,
  scheduleCanSnapshot,
  flushCanSnapshotNow,
  stopCanSnapshot,
} from './canSnapshotService';

/* ── Types ───────────────────────────────────────────────── */

export type OBDConnectionState =
  | 'idle'
  | 'scanning'
  | 'connecting'
  | 'connected'
  | 'reconnecting'   // exponential-backoff retry in progress
  | 'error';

export type VehicleType = 'ice' | 'diesel' | 'ev' | 'hybrid' | 'phev';

export interface OBDData {
  connectionState: OBDConnectionState;
  source: 'real' | 'mock' | 'none';
  deviceName: string;
  vehicleType: VehicleType;  // aktif araç tipi
  /** Unix ms — son gerçek (native) veri paketi alındığında güncellenir. 0 = hiç alınmadı. */
  lastSeenMs: number;

  // ── Universal ─────────────────────────────────
  speed: number;        // km/h
  headlights: boolean;  // far açık/kapalı

  // ── ICE / Diesel / Hybrid ─────────────────────
  rpm: number;          // motor RPM  (-1 = EV'de yok)
  engineTemp: number;   // °C         (-1 = EV'de yok)
  fuelLevel: number;    // 0–100%     (-1 = tam EV'de yok)
  throttle: number;     // 0–100%     (-1 = desteklenmiyor)
  intakeTemp: number;   // °C         (-1 = desteklenmiyor)
  boostPressure: number; // kPa turbo (-1 = yok)
  egt: number;          // °C egzoz   (-1 = yok)

  // ── EV / Hybrid ───────────────────────────────
  batteryLevel: number;   // % SoC   (-1 = ICE'de yok)
  batteryTemp: number;    // °C      (-1 = ICE'de yok)
  range: number;          // km      (-1 = ICE'de yok)
  chargingState: 'not_charging' | 'charging' | 'fast_charging' | 'unknown';
  chargingPower: number;  // kW      (-1 = şarj değil)
  motorPower: number;     // kW çıkış / regen (-1 = desteklenmiyor)

  // ── Computed fuel metrics ─────────────────────
  /** Kalan yakıt (litre) — fuelTankL config ile hesaplanır; -1 = config eksik / EV */
  fuelRemainingL: number;
  /** Tahmini menzil (km) — ortalama tüketim + kalan yakıt; -1 = hesaplanamadı */
  estimatedRangeKm: number;

  // ── 12V Akü (tüm araç tipleri) ───────────────
  /** 12V kurşun-asit akü voltajı (V) — PID 0x42 System Voltage / CAN bus.
   *  -1 = desteklenmiyor; undefined = henüz okunmadı. */
  batteryVoltage?: number;

  // ── Body status (CAN bus / extended OBD) ──────
  /** Kapı açıklık durumu — CAN bus kaynaklı; undefined = desteklenmiyor */
  doors?: {
    fl:    boolean;  // ön-sol (sürücü)
    fr:    boolean;  // ön-sağ (yolcu)
    rl:    boolean;  // arka-sol
    rr:    boolean;  // arka-sağ
    trunk: boolean;  // bagaj
  };
  /** TPMS lastik basınçları (kPa) — undefined = sensör yok */
  tpms?: {
    fl: number;  // ön-sol
    fr: number;  // ön-sağ
    rl: number;  // arka-sol
    rr: number;  // arka-sağ
  };
}

/* ── Module state ────────────────────────────────────────── */

const INITIAL: OBDData = {
  connectionState: 'idle',
  source: 'none',
  deviceName: '',
  vehicleType: 'ice',
  lastSeenMs: 0,
  // Universal
  speed: 0,
  headlights: false,
  // ICE / Diesel — tüm değerler -1: ELM327 bağlanana kadar sensör verisi yok
  rpm: -1,
  engineTemp: -1,
  fuelLevel: -1,
  throttle: -1,
  intakeTemp: -1,
  boostPressure: -1,
  egt: -1,
  // EV / Hybrid
  batteryLevel: -1,
  batteryTemp: -1,
  range: -1,
  chargingState: 'unknown',
  chargingPower: -1,
  motorPower: -1,
  // Computed
  fuelRemainingL: -1,
  estimatedRangeKm: -1,
  // Body status — undefined until CAN bus data arrives
  doors: undefined,
  tpms:  undefined,
};

// ICE mock starting values
const MOCK_BASE_ICE = {
  speed: 42, rpm: 1450, engineTemp: 90, fuelLevel: 68,
  throttle: 18, intakeTemp: 22, boostPressure: -1, egt: -1,
  batteryLevel: -1, batteryTemp: -1, range: -1,
  chargingState: 'not_charging' as const, chargingPower: -1, motorPower: -1,
  headlights: new Date().getHours() >= 20 || new Date().getHours() < 6,
  doors: { fl: false, fr: false, rl: false, rr: false, trunk: false },
  tpms:  { fl: 235, fr: 233, rl: 230, rr: 232 },
  batteryVoltage: 13.8, // alternator şarj ediyor
};

// EV mock starting values
const MOCK_BASE_EV = {
  speed: 42, rpm: -1, engineTemp: -1, fuelLevel: -1,
  throttle: 15, intakeTemp: -1, boostPressure: -1, egt: -1,
  batteryLevel: 74, batteryTemp: 28, range: 185,
  chargingState: 'not_charging' as const, chargingPower: -1, motorPower: 35,
  headlights: new Date().getHours() >= 20 || new Date().getHours() < 6,
  doors: { fl: false, fr: false, rl: false, rr: false, trunk: false },
  tpms:  { fl: 240, fr: 238, rl: 236, rr: 237 },
  batteryVoltage: 13.8,
};

// Hybrid mock starting values
const MOCK_BASE_HYBRID = {
  speed: 42, rpm: 800, engineTemp: 85, fuelLevel: 55,
  throttle: 12, intakeTemp: 20, boostPressure: -1, egt: -1,
  batteryLevel: 48, batteryTemp: 32, range: 290,
  chargingState: 'not_charging' as const, chargingPower: -1, motorPower: 18,
  headlights: new Date().getHours() >= 20 || new Date().getHours() < 6,
  doors: { fl: false, fr: false, rl: false, rr: false, trunk: false },
  tpms:  { fl: 233, fr: 231, rl: 228, rr: 230 },
  batteryVoltage: 13.8,
};

function _getMockBase(type: VehicleType) {
  if (type === 'ev') return MOCK_BASE_EV;
  if (type === 'hybrid' || type === 'phev') return MOCK_BASE_HYBRID;
  return MOCK_BASE_ICE;
}

// Active mock base (set when mock starts)
let _mockBase = MOCK_BASE_ICE;

// Tier 1 (sync): localStorage'dan anlık hydration — sıfır gecikme.
let _current: OBDData = { ...INITIAL, ...hydrateCanSnapshotSync() };
let _asyncHydrated = false; // Tier 2 hydration'ın tek sefer çalışmasını garantiler

// Two-set listener pattern — avoids `as any` casts for useSyncExternalStore.
// Data consumers (onOBDData) receive the full snapshot; React hooks only need a notify ping.
const _dataListeners         = new Set<(d: OBDData) => void>();
const _storeListeners        = new Set<() => void>();
/** @deprecated internal alias kept for _tickMock idle-skip guard */
const _listeners             = { get size() { return _dataListeners.size + _storeListeners.size; } };
let _mockTimerId: ReturnType<typeof setInterval> | null = null;
let _nativeHandles: PluginListenerHandle[] = [];
let _running                 = false;
let _lastNotifyTime          = 0;

// Exponential back-off reconnect state
const MAX_RECONNECT_ATTEMPTS = 5;  // 1 s, 2 s, 4 s, 8 s, 16 s
const CONNECT_TIMEOUT_MS     = 30_000; // 30 s — prevent indefinite BT hang
let _reconnectAttempts       = 0;
let _reconnectTimer: ReturnType<typeof setTimeout> | null = null;

// Generation counter — prevents stale in-flight _startNative() from writing
// state after a stop/restart cycle. Each startOBD() call increments this.
let _nativeGeneration = 0;

// ── Stale-data watchdog ──────────────────────────────────────
// ISO 15031-5 §6.3.3: ECU response timeout ≤ 50 ms per frame;
// ELM327 poll cycle ≤ 3 s. After 12 s without a real frame the
// RFCOMM socket has silently dropped — declare disconnected.
const STALE_THRESHOLD_MS  = 12_000;
const WATCHDOG_INTERVAL_MS = 5_000;
let _lastRealDataMs        = 0;
let _staleWatchdogTimer: ReturnType<typeof setInterval> | null = null;

// ── Direct-reconnect: last known BT MAC ─────────────────────
// Persisted to localStorage so app restart skips full BT INQUIRY scan.
// BT INQUIRY = 10-30 s contention → GPS ±15 m jitter + A2DP glitch every ~10 s.
const OBD_ADDRESS_KEY = 'obd:lastAddress';
let _lastKnownAddress: string | null =
  (() => { try { return localStorage.getItem(OBD_ADDRESS_KEY); } catch { return null; } })();

// ── Fuel computation config ──────────────────────────────────
// Set via setObdFuelConfig() whenever the active vehicle profile changes.
let _fuelTankL        = 0;   // 0 = not configured
let _avgConsumL100    = 0;   // 0 = not configured (L per 100 km)

// ── Sensor sanity bounds (ISO 15031-5 §6.3 + SAE J1979) ──────
// Physically impossible readings → ELM327 glitch / adapter failure.
// RPM jump guard: ELM327 polls every 3s; >5000 RPM change in one cycle
// is impossible in any production engine (max realistic blip: ~2000 RPM/s).
const _BOUNDS = {
  speed:       [0,   300] as const,  // km/h
  rpm:         [0, 8_000] as const,  // RPM — covers all ICE/hybrid
  engineTemp:  [-40, 130] as const,  // °C — NTC sensor range
  fuelLevel:   [0,   100] as const,  // %
} as const;
const RPM_JUMP_LIMIT = 5_000;  // RPM/sample

let _prevRpm: number | null = null;

// performanceMode değişiminde yalnızca reconnect timer'ı iptal et.
// Mock interval yönetimi merkezi RuntimeEngine (_unsubRuntime) tarafından yapılır.
const _unsubPerfMode = onPerformanceModeChange(() => {
  if (_reconnectTimer !== null) {
    clearTimeout(_reconnectTimer);
    _reconnectTimer = null;
  }
});

// RuntimeEngine mod değişimini dinle — obdPollingMs mock interval'ını güncelle.
// Zero-Leak: HMR dispose'da _unsubRuntime çağrılır.
const _unsubRuntime = runtimeManager.subscribe((_mode, config) => {
  if (!_running || _current.source !== 'mock' || _mockTimerId === null) return;
  // Merkezi runtime config'den gelen polling hızı → mock timer'ı yeniden kur
  clearInterval(_mockTimerId);
  _mockTimerId = setInterval(_tickMock, config.obdPollingMs);
});

/* ── Core helpers ────────────────────────────────────────── */

function _notify(): void {
  const now = Date.now();
  const debounceMs = getConfig().obdListenerDebounce;
  if (now - _lastNotifyTime < debounceMs) return;
  _lastNotifyTime = now;
  const snap = { ..._current };
  _dataListeners.forEach((fn) => fn(snap));
  _storeListeners.forEach((fn) => fn());
  // Gerçek CAN verisi geldiğinde WebView çökmesine karşı snapshot al.
  // scheduleCanSnapshot içeride 4s debounce ile safeStorage'a yazar.
  if (_current.source === 'real') scheduleCanSnapshot(_current);
}

/** ISO 15031-5 §6.3: Fuel Tank Level (PID 0x2F) → litres + range */
function _computeFuelMetrics(fuelPct: number): { fuelRemainingL: number; estimatedRangeKm: number } {
  if (fuelPct < 0 || _fuelTankL <= 0) return { fuelRemainingL: -1, estimatedRangeKm: -1 };
  const fuelRemainingL   = (fuelPct / 100) * _fuelTankL;
  const estimatedRangeKm = _avgConsumL100 > 0.01
    ? Math.round((fuelRemainingL / _avgConsumL100) * 100)
    : -1;
  return { fuelRemainingL: Math.round(fuelRemainingL * 10) / 10, estimatedRangeKm };
}

function _merge(partial: Partial<OBDData>): void {
  // Recompute fuel metrics whenever fuelLevel is updated
  if (partial.fuelLevel !== undefined && partial.fuelLevel >= 0) {
    const computed = _computeFuelMetrics(partial.fuelLevel);
    partial = { ...partial, ...computed };
  }
  _current = { ..._current, ...partial };
  _notify();
}

function _clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Sanitize a raw native OBD packet before merging into state.
 *
 * Each field is validated against ISO 15031-5 physical bounds.
 * RPM additionally checked for impossible inter-sample jumps.
 * Returns null if no valid field was found (discard entire packet).
 */
function _sanitizeNative(data: Partial<NativeOBDData>): Partial<OBDData> | null {
  // Safety Gate: non-finite veya fiziksel sınırı aşan hız → tüm paketi reddet
  if (data.speed !== undefined && (!Number.isFinite(data.speed) || data.speed > 300)) {
    console.warn('[SafetyGate] Rejected Speed:', data.speed);
    return null;
  }

  const patch: Partial<OBDData> = {};
  let accepted = false;

  if (data.speed !== undefined && data.speed >= 0) {
    const [lo, hi] = _BOUNDS.speed;
    if (data.speed <= hi && data.speed >= lo) {
      patch.speed = data.speed;
      accepted = true;
    } else {
      logError('OBD:Sanitize', new Error(`speed=${data.speed} km/h out of bounds [${lo},${hi}]`));
    }
  }

  if (data.rpm !== undefined && data.rpm >= 0) {
    const [lo, hi] = _BOUNDS.rpm;
    const jump = _prevRpm !== null ? Math.abs(data.rpm - _prevRpm) : 0;
    if (data.rpm >= lo && data.rpm <= hi && jump < RPM_JUMP_LIMIT) {
      patch.rpm = data.rpm;
      _prevRpm  = data.rpm;
      accepted  = true;
    } else {
      logError('OBD:Sanitize', new Error(`rpm=${data.rpm} invalid (prev=${_prevRpm ?? 'none'}, jump=${jump})`));
    }
  }

  if (data.engineTemp !== undefined && data.engineTemp >= 0) {
    const [lo, hi] = _BOUNDS.engineTemp;
    if (data.engineTemp >= lo && data.engineTemp <= hi) {
      patch.engineTemp = data.engineTemp;
      accepted = true;
    }
  }

  if (data.fuelLevel !== undefined && data.fuelLevel >= 0) {
    const [lo, hi] = _BOUNDS.fuelLevel;
    if (data.fuelLevel >= lo && data.fuelLevel <= hi) {
      patch.fuelLevel = data.fuelLevel;
      accepted = true;
    }
  }

  if (data.headlights !== undefined) {
    patch.headlights = data.headlights;
    accepted = true;
  }

  return accepted ? patch : null;
}

/* ── Mock simulation ─────────────────────────────────────── */

function _tickMock(): void {
  // Skip simulation entirely when no UI is subscribed — saves CPU
  if (_listeners.size === 0) return;

  try {
    const hour = new Date().getHours();
    const headlights = hour >= 20 || hour < 6;
    const type = _current.vehicleType;

    if (type === 'ev') {
      // EV: batarya tükenir, motor gücü değişir, RPM yok
      const newSpeed = _clamp(Math.round(_current.speed + (Math.random() * 14 - 7)), 0, 180);
      const powerDraw = newSpeed > 0 ? _clamp(Math.round(newSpeed * 0.6 + (Math.random() * 20 - 10)), -30, 150) : -5;
      _merge({
        speed: newSpeed,
        headlights,
        batteryLevel: _clamp((_current.batteryLevel - Math.random() * 0.08), 0, 100),
        batteryTemp:  _clamp(Math.round(_current.batteryTemp + (Math.random() * 2 - 1)), 15, 45),
        range:        _clamp(Math.round(_current.range - Math.random() * 0.05), 0, 600),
        motorPower:   powerDraw,
        throttle:     _clamp(Math.round(Math.abs(powerDraw) / 1.5), 0, 100),
        rpm: -1, engineTemp: -1, fuelLevel: -1, boostPressure: -1, egt: -1,
      });
    } else if (type === 'hybrid' || type === 'phev') {
      // Hybrid: hem batarya hem yakıt
      _merge({
        speed:        _clamp(Math.round(_current.speed + (Math.random() * 14 - 7)), 0, 180),
        rpm:          _current.speed < 5 ? -1 : _clamp(Math.round(_current.rpm + (Math.random() * 200 - 100)), 0, 5000),
        engineTemp:   _clamp(Math.round(_current.engineTemp + (Math.random() * 2 - 1)), 60, 105),
        fuelLevel:    _clamp(_current.fuelLevel - Math.random() * 0.15, 0, 100),
        batteryLevel: _clamp(_current.batteryLevel + (Math.random() * 0.4 - 0.25), 10, 100),
        batteryTemp:  _clamp(Math.round(_current.batteryTemp + (Math.random() * 2 - 1)), 15, 45),
        range:        _clamp(Math.round(_current.range - Math.random() * 0.04), 0, 800),
        motorPower:   _clamp(Math.round(_current.motorPower + (Math.random() * 10 - 5)), -20, 80),
        throttle:     _clamp(Math.round(_current.throttle + (Math.random() * 10 - 5)), 0, 100),
        headlights,
      });
    } else if (type === 'diesel') {
      // Diesel: turbo boost basıncı + EGT ekstra
      _merge({
        speed:         _clamp(Math.round(_current.speed + (Math.random() * 14 - 7)), 0, 180),
        rpm:           _clamp(Math.round(_current.rpm + (Math.random() * 300 - 150)), 700, 4500),
        engineTemp:    _clamp(Math.round(_current.engineTemp + (Math.random() * 2 - 1)), 70, 110),
        fuelLevel:     _clamp(_current.fuelLevel - Math.random() * 0.2, 0, 100),
        throttle:      _clamp(Math.round(_current.throttle + (Math.random() * 8 - 4)), 0, 100),
        intakeTemp:    _clamp(Math.round(_current.intakeTemp + (Math.random() * 4 - 2)), 15, 65),
        boostPressure: _clamp(Math.round(_current.boostPressure + (Math.random() * 6 - 3)), 0, 220),
        egt:           _clamp(Math.round(_current.egt + (Math.random() * 20 - 10)), 200, 800),
        headlights,
      });
    } else {
      // ICE (benzin) — default
      _merge({
        speed:          _clamp(Math.round(_current.speed + (Math.random() * 14 - 7)), 0, 180),
        rpm:            _clamp(Math.round(_current.rpm + (Math.random() * 300 - 150)), 650, 7000),
        engineTemp:     _clamp(Math.round(_current.engineTemp + (Math.random() * 2 - 1)), 75, 105),
        fuelLevel:      _clamp(_current.fuelLevel - Math.random() * 0.3, 0, 100),
        throttle:       _clamp(Math.round(_current.throttle + (Math.random() * 10 - 5)), 0, 100),
        intakeTemp:     _clamp(Math.round(_current.intakeTemp + (Math.random() * 3 - 1.5)), 10, 55),
        headlights,
        // 12V akü voltajı: alternator şarj → 13.6–14.4V arası küçük dalgalanma
        batteryVoltage: parseFloat(_clamp(
          (_current.batteryVoltage ?? 13.8) + (Math.random() * 0.16 - 0.08),
          13.2, 14.6,
        ).toFixed(2)),
      });
    }
  } catch (e) {
    logError('OBD:MockTick', e);
  }
}

function _startMock(): void {
  if (!MOCK_ENABLED) return;  // mock kapalıysa asla sahte veri başlatma
  if (_mockTimerId !== null) return;
  _mockBase = _getMockBase(_current.vehicleType);
  _merge({
    connectionState: 'connected',
    source: 'mock',
    deviceName: '',
    ..._mockBase,
  });
  // Merkezi RuntimeEngine config — getConfig().obdPollInterval yerine
  _mockTimerId = setInterval(_tickMock, runtimeManager.getConfig().obdPollingMs);
}

/**
 * Yakıt hesaplama konfigürasyonunu güncelle.
 * useLayoutServices.ts'ten aktif profil değiştiğinde çağrılır.
 *
 * @param tankL        Depo hacmi (litre) — 0 = hesaplama devre dışı
 * @param avgL100      Ortalama tüketim (L/100 km) — 0 = menzil hesaplanamaz
 * @param knownAddress Önceden bilinen BT MAC adresi — scan'ı atlamak için
 */
export function setObdFuelConfig(tankL: number, avgL100: number, knownAddress?: string): void {
  _fuelTankL     = tankL;
  _avgConsumL100 = avgL100;
  if (knownAddress) _lastKnownAddress = knownAddress;
  // Anlık fuelLevel ile metrikleri yeniden hesapla
  if (_current.fuelLevel >= 0) {
    const computed = _computeFuelMetrics(_current.fuelLevel);
    _merge(computed);
  }
}

/** Aktif araç tipini güncelle ve mock verisini resetle */
export function setObdVehicleType(type: VehicleType): void {
  _merge({ vehicleType: type });
  if (_current.source === 'mock') {
    _stopMock();
    _startMock();
  }
}

function _stopMock(): void {
  if (_mockTimerId !== null) {
    clearInterval(_mockTimerId);
    _mockTimerId = null;
  }
}

/* ── Stale-data watchdog ─────────────────────────────────── */

function _startStaleWatchdog(): void {
  if (_staleWatchdogTimer !== null) return;
  _lastRealDataMs = Date.now();
  _staleWatchdogTimer = setInterval(() => {
    if (!_running || _current.source !== 'real') return;
    if (Date.now() - _lastRealDataMs > STALE_THRESHOLD_MS) {
      // RFCOMM socket sessizce düştü — reconnect tetikle
      logError('OBD:StaleData', new Error(`${STALE_THRESHOLD_MS / 1000}s boyunca veri alınamadı`));
      _stopStaleWatchdog();
      void _removeNativeHandles().then(() => _scheduleReconnect());
    }
  }, WATCHDOG_INTERVAL_MS);
}

function _stopStaleWatchdog(): void {
  if (_staleWatchdogTimer !== null) {
    clearInterval(_staleWatchdogTimer);
    _staleWatchdogTimer = null;
  }
}

/* ── Exponential back-off reconnect ──────────────────────── */

/**
 * Schedule a reconnect attempt.
 * Delays: 1 s, 2 s, 4 s, 8 s, 16 s — then gives up and falls back to mock.
 * Mock data continues flowing between attempts so OBD panels stay alive.
 */
function _scheduleReconnect(): void {
  if (!_running) return;

  // OBD disconnect → RuntimeEngine'e bildir (bir adım downgrade — hysteresis bypass)
  runtimeManager.reportFailure('OBD');

  // Guard: BT INQUIRY scan reconnect sırasında yasak — GPS jitter + A2DP kesintisi.
  // Kayıtlı MAC yoksa kullanıcı manuel olarak OBDConnectModal'dan cihaz seçmelidir.
  if (!_lastKnownAddress) {
    _reconnectAttempts = 0;
    _merge({ connectionState: 'error', source: 'none' });
    if (MOCK_ENABLED) _startMock();
    return;
  }

  if (_reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    _reconnectAttempts = 0;
    if (MOCK_ENABLED) {
      _startMock();
    } else {
      _merge({ connectionState: 'error', source: 'none' });
    }
    return;
  }

  const delayMs = Math.pow(2, _reconnectAttempts) * 1_000; // 1 s, 2 s, 4 s, 8 s, 16 s
  _reconnectAttempts++;

  // source: mock yalnızca mock aktifse; aksi halde 'none' göster (sahte veri yok)
  _merge({ connectionState: 'reconnecting', source: MOCK_ENABLED ? 'mock' : 'none', deviceName: '' });
  _startMock(); // MOCK_ENABLED=false ise no-op

  if (_reconnectTimer) clearTimeout(_reconnectTimer);
  _reconnectTimer = setTimeout(() => {
    _reconnectTimer = null;
    if (!_running) return;

    _stopMock();
    _startNative().then(() => {
      // Success — reset counter
      _reconnectAttempts = 0;
    }).catch(async (e: unknown) => {
      logError('OBD:Reconnect', e);
      await _removeNativeHandles(); // await so handles are gone before next attempt
      _scheduleReconnect();
    });
  }, delayMs);
}

/* ── Native OBD helpers ──────────────────────────────────── */

async function _removeNativeHandles(): Promise<void> {
  const handles = _nativeHandles.splice(0);
  for (const h of handles) {
    try { await h.remove(); } catch { /* ignore */ }
  }
}

/**
 * SAE J1979 (Mode 01) PID listesini araç tipine göre döner.
 *
 * EV'de ICE PID'leri (0x0C RPM, 0x05 ECT, 0x2F Fuel) sorgulamak neden
 * tehlikelidir: ELM327 her desteklenmeyen PID için 200 ms NO-DATA bekler.
 * 3 PID × 200 ms = 600 ms kayıp / poll cycle. Bazı ELM327 klonları arka
 * arkaya NO-DATA aldıklarında RFCOMM akışını bozar (AT komutları kayar →
 * disconnected). ISO 15031-5 §6.3.3: ECU P3 timeout = 55 ms; ELM327 default
 * = 200 ms.  EV için sadece 0x0D (speed) + OEM batarya PID'leri sorgulanmalı.
 */
function _getPidList(type: VehicleType): string[] {
  const universal = ['0x0D'];                               // PID 0x0D: speed
  const iceExtra  = ['0x0C', '0x05', '0x2F', '0x11', '0x0F']; // RPM, ECT, fuel, throttle, IAT
  const dieselExtra = [...iceExtra, '0x0B'];                // + manifold pressure (boost)

  switch (type) {
    case 'ev':     return universal;           // EV: sadece hız; batarya OEM-specific
    case 'ice':    return [...universal, ...iceExtra];
    case 'diesel': return [...universal, ...dieselExtra];
    case 'hybrid':
    case 'phev':   return [...universal, ...iceExtra];     // ICM aktif olduğunda tam set
    default:       return [...universal, ...iceExtra];
  }
}

async function _startNative(): Promise<void> {
  // Capture generation at entry — if stopOBD()/startOBD() fires mid-flight,
  // _nativeGeneration changes and stale continuations bail out safely.
  const myGen = ++_nativeGeneration;
  const _stale = () => !_running || _nativeGeneration !== myGen;

  _nativeHandles = [];

  // ── Fix 3: Direct reconnect — BT INQUIRY scan atla ──────────
  // Full scanOBD() = Android BT INQUIRY mode (10–30 s, 1.6 s scan intervals).
  // Bu süre boyunca GPS combo-chip'te PLL çakışması → ±15 m GPS jitter;
  // A2DP sniff-mode askıya alınır → müzik glitch her ~10 s.
  // Bilinen MAC varsa direkt connect() dene; sadece başarısız olursa tara.
  let candidate: { name: string; address: string } | null = null;

  if (_lastKnownAddress) {
    // Bilinen adrese direkt bağlanmayı dene — scan yok
    candidate = { name: 'OBD Adaptörü', address: _lastKnownAddress };
    _merge({ connectionState: 'connecting', deviceName: candidate.name });
  } else {
    // İlk bağlantı veya adres bilinmiyor — full scan gerekli
    _merge({ connectionState: 'scanning' });
    const { devices } = await CarLauncher.scanOBD();

    if (_stale()) { void _removeNativeHandles(); return; }

    candidate =
      devices.find((d) => /obd|elm|vlink|obdii|kw|veepeak|icar|vgate/i.test(d.name)) ??
      devices[0] ??
      null;

    if (!candidate) {
      throw new Error('Eşleşmiş OBD adaptörü bulunamadı');
    }
    _merge({ connectionState: 'connecting', deviceName: candidate.name });
  }

  // 2. Register disconnect / error listener — set handle immediately to ensure cleanup
  const statusHandle = await CarLauncher.addListener(
    'obdStatus',
    () => {
      if (!_running || _nativeGeneration !== myGen) return;
      void _removeNativeHandles().then(() => _scheduleReconnect());
    },
  );

  if (_stale()) { void _removeNativeHandles(); return; }
  _nativeHandles = [statusHandle]; // track as soon as acquired

  // 3. Register data listener — throttled by the native 3 s polling interval
  const dataHandle = await CarLauncher.addListener(
    'obdData',
    (data: NativeOBDData) => {
      if (!_running || _nativeGeneration !== myGen) return;
      try {
        _lastRealDataMs = Date.now();

        // ── Binary Fast-Path ────────────────────────────────────────────────
        // Native plugin binary frame gönderirse JSON.parse tamamen atlanır.
        // DataView ile 16-byte sabit çerçeve direkt parse edilir.
        // parseBinaryOBDFrame() null döndürürse JSON fallback devreye girer.
        if (hasBinaryFrame(data)) {
          const binaryPatch = parseBinaryOBDFrame(data.binaryFrame);
          if (binaryPatch) {
            _merge({ ...binaryPatch, lastSeenMs: _lastRealDataMs, source: 'real' });
            _lastRealDataMs = Date.now();
            return; // JSON path atlandı
          }
          // Binary parse başarısız → JSON fallback ile devam et
        }

        // ── JSON Fallback Path ──────────────────────────────────────────────
        const sanitized = _sanitizeNative(data);
        if (sanitized) _merge({ ...sanitized, lastSeenMs: _lastRealDataMs });
      } catch (e) {
        logError('OBD:DataHandler', e);
      }
    },
  );

  if (_stale()) { void _removeNativeHandles(); return; }
  _nativeHandles = [statusHandle, dataHandle];

  // 4. Connect — resolves when ELM327 init completes, rejects on failure.
  //    Fix 2: araç tipine göre PID listesi iletilir — EV'de ICE PID'leri atlanır.
  //    Race against a 30 s timeout so a non-responsive BT device doesn't hang.
  const pidList = _getPidList(_current.vehicleType);
  await Promise.race([
    CarLauncher.connectOBD({ address: candidate.address, pids: pidList }),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`OBD bağlantısı zaman aşımına uğradı (${CONNECT_TIMEOUT_MS / 1000}s): ${candidate.name}`)),
        CONNECT_TIMEOUT_MS,
      )
    ),
  ]);

  if (_stale()) { void _removeNativeHandles(); return; }

  // 5. Mark as live — persist MAC so next app restart skips BT INQUIRY scan entirely
  _lastKnownAddress = candidate.address;
  try { localStorage.setItem(OBD_ADDRESS_KEY, candidate.address); } catch { /* quota */ }
  _merge({ connectionState: 'connected', source: 'real' });

  // Fix 1: stale-data watchdog'u başlat
  _startStaleWatchdog();
}

/* ── Public API ──────────────────────────────────────────── */

/**
 * Eşleşmiş Bluetooth cihazlarını tara — SetupWizard için.
 * Sonuç { name, address }[] döner.
 */
export async function scanOBD(): Promise<Array<{ name: string; address: string }>> {
  if (!Capacitor.isNativePlatform()) return [];
  const { devices } = await CarLauncher.scanOBD();
  return devices;
}

/**
 * Belirli bir BT adresiyle OBD bağlantısı kur — SetupWizard için.
 */
export async function connectOBD(address: string): Promise<void> {
  await CarLauncher.connectOBD({ address });
}

/**
 * Mock varsayılan olarak KAPALI — otomotiv dürüstlüğü ilkesi.
 * Yalnızca geliştirme kolaylığı için VITE_ENABLE_OBD_MOCK=true ile açılır.
 * Gerçek ELM327 bağlı değilken kullanıcı asla sahte 42 km/h görmemeli.
 */
const MOCK_ENABLED = import.meta.env['VITE_ENABLE_OBD_MOCK'] === 'true'
  || import.meta.env['VITE_ENABLE_OBD_MOCK'] === '1';

/**
 * Start OBD.
 * Tries native Bluetooth first; falls back to mock on any failure
 * unless VITE_DISABLE_OBD_MOCK=true is set.
 *
 * @param address — optional MAC address (from OBDConnectModal device selection).
 *   Provided → address is persisted and BT INQUIRY scan is skipped entirely;
 *   direct connectOBD() is attempted immediately (<3 s).
 *   If the service is already running but not yet connected, the in-flight
 *   scan/connect is cancelled and restarted with the given address.
 *   Omitted → uses _lastKnownAddress from localStorage (also skips scan);
 *   only falls back to full scan if no address was ever saved.
 */
export function startOBD(address?: string): void {
  if (address) {
    _lastKnownAddress = address;
    try { localStorage.setItem(OBD_ADDRESS_KEY, address); } catch { /* quota */ }
  }

  if (_running) {
    // address provided while service is already running but not connected:
    // cancel the in-flight operation (scan / failed connect) and direct-connect.
    if (address && _current.connectionState !== 'connected') {
      if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null; }
      _reconnectAttempts = 0;
      _nativeGeneration++; // invalidate any stale _startNative() continuation
      void _removeNativeHandles().then(() => {
        if (!_running) return;
        void _startNative().catch(async (e: unknown) => {
          logError('OBD:DirectConnect', e);
          await _removeNativeHandles();
          _merge({ connectionState: 'error', source: 'none' });
        });
      });
    }
    return;
  }
  _running = true;

  // Tier 2 async hydration — bir kez çalışır, BT bağlantısıyla yarışmaz.
  // Filesystem okuma (~50-150ms) tamamlandığında gerçek veri henüz yoksa patch uygular.
  if (!_asyncHydrated) {
    _asyncHydrated = true;
    hydrateCanSnapshotAsync().then((patch) => {
      if (Object.keys(patch).length === 0) return;
      if (_current.source !== 'none') return; // gerçek veri zaten aktıysa dokunma
      _current = { ..._current, ...patch };
      _storeListeners.forEach((fn) => fn()); // React hook'larını tetikle
    }).catch(() => { /* Tier 1 localStorage fallback yeterli */ });
  }

  void (async () => {
    try {
      if (Capacitor.isNativePlatform()) {
        try {
          await _startNative();
          return; // success — don't start mock
        } catch (e) {
          // Native failed → log and fall through to mock (unless disabled)
          logError('OBD:StartNative', e);
          await _removeNativeHandles();
          _merge({ connectionState: 'error', source: 'none', deviceName: '' });
          if (!MOCK_ENABLED) return; // Production: bağlanamadı → idle kalır
          // Brief pause so the UI can show the error state before switching to mock
          await new Promise((r) => setTimeout(r, 1500));
        }
      }
      if (MOCK_ENABLED) {
        _startMock();
      }
    } catch (e) {
      // Outer guard — startMock itself should never throw but just in case
      logError('OBD:StartOBD', e);
      _merge({ connectionState: 'error', source: 'none' });
    }
  })();
}

/**
 * Stop all OBD activity and reset state.
 */
export function stopOBD(): void {
  // Son gerçek CAN verisini native storage'a atomik olarak flush et
  // (bağlantı kesilmeden önce en güncel değerler korunur).
  if (_current.source === 'real') flushCanSnapshotNow(_current);
  stopCanSnapshot(); // Filesystem throttle timer'ı temizle (bellek sızıntısı önleme)

  _running = false;
  _nativeGeneration++; // invalidate any in-flight _startNative() continuations
  _lastNotifyTime = 0; // debounce sıfırla — sonraki bildirim her zaman geçer
  _prevRpm = null;     // jump-detection sıfırla — reconnect'te stale eşik kalmasın
  if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null; }
  _reconnectAttempts = 0;
  // Fix 4: stale watchdog'u durdur — uzun sürüş sonrası unmount'ta sızıntı önle
  _stopStaleWatchdog();
  _stopMock();
  void _removeNativeHandles().then(() => {
    if (Capacitor.isNativePlatform()) {
      CarLauncher.disconnectOBD().catch(() => { /* ignore */ });
    }
  });
  _merge({ connectionState: 'idle', source: 'none', deviceName: '', lastSeenMs: 0 });
}

/**
 * Push live data directly from the native plugin (alternative to listener pattern).
 */
export function updateOBDData(partial: Partial<NativeOBDData>): void {
  const sanitized = _sanitizeNative(partial);
  if (sanitized) _merge({ ...sanitized, source: 'real', connectionState: 'connected' });
}

/* ── External subscription ───────────────────────────────── */

/**
 * Subscribe to every OBD state push from outside React.
 * Returns a cleanup function. Used by obdAlerts.ts.
 */
export function onOBDData(fn: (d: OBDData) => void): () => void {
  _dataListeners.add(fn);
  return () => _dataListeners.delete(fn);
}

/* ── HMR cleanup — dev modda Hot Reload'da OBD timer/listener sızıntısını önle ── */
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    stopOBD();
    _unsubPerfMode();           // modül-seviyesi performans modu listener'ı temizle
    _unsubRuntime();            // modül-seviyesi runtime listener'ı temizle
    _dataListeners.clear();
    _storeListeners.clear();
  });
}

/* ── React hook ──────────────────────────────────────────── */

export function useOBDState(): OBDData {
  return useSyncExternalStore(
    (onStoreChange) => {
      _storeListeners.add(onStoreChange);
      return () => { _storeListeners.delete(onStoreChange); };
    },
    () => _current,
    () => INITIAL,
  );
}

/* ── Narrow selector hooks ───────────────────────────────────
 * Each hook only triggers a re-render when its specific field
 * changes. Use these instead of useOBDState() in components
 * that need only one or two OBD values (e.g. speedometer).
 * ─────────────────────────────────────────────────────────── */

function useOBDField<K extends keyof OBDData>(field: K): OBDData[K] {
  return useSyncExternalStore(
    (onStoreChange) => {
      _storeListeners.add(onStoreChange);
      return () => { _storeListeners.delete(onStoreChange); };
    },
    () => _current[field],
    () => INITIAL[field],
  );
}

/**
 * OBD hız hook'u — RAF linear interpolation ile 60 fps akıcılığı.
 * SADECE gösterge iğnesi (SVG arc, needle) için kullan.
 * Sayısal ekran için useOBDSpeedRaw() kullan — animasyon gecikme yaratır.
 *
 * lerpFactor=0.15: OBD 3 Hz poll rate'te bile gösterge iğnesi gibi kayar.
 */
export function useOBDSpeed(): number {
  const raw = useOBDField('speed');
  return useRafSmoothed(raw, 0.15);
}

/**
 * OBD anlık hız — animasyonsuz, gecikmesiz.
 * Sayısal hız ekranı bu hook'u kullanmalı.
 */
export function useOBDSpeedRaw(): number {
  return useOBDField('speed');
}

/** Only re-renders on connection state changes. */
export function useOBDConnectionState(): OBDConnectionState { return useOBDField('connectionState'); }

/**
 * RPM hook'u — RAF linear interpolation (α=0.20 — motor ibresi hızlı tepki).
 *
 * lerpFactor=0.20: RPM ani değişir (gaz kesmede hızlı düşüş, basımda hızlı yükseliş).
 * 0.15'ten daha agresif → gösterge "canlı" hissi verir, sürüklenme olmaz.
 */
export function useOBDRPM(): number {
  const raw = useOBDField('rpm');
  return useRafSmoothed(raw, 0.20);
}

/** Only re-renders when engine temp changes. */
export function useOBDEngineTemp(): number     { return useOBDField('engineTemp'); }
/** Only re-renders when fuel level changes. */
export function useOBDFuelLevel(): number      { return useOBDField('fuelLevel'); }
/** Only re-renders when headlight state toggles. */
export function useOBDHeadlights(): boolean    { return useOBDField('headlights'); }
/** Only re-renders when data source changes (real/mock/none). */
export function useOBDSource(): OBDData['source'] { return useOBDField('source'); }
