/**
 * Trip Log Service — Automatic journey recording via OBD data.
 *
 * Architecture:
 *  - Module-level push state (same pattern as obdService)
 *  - Trip detection: starts when OBD speed > 5 km/h, ends after 60s idle
 *  - Distance via speed × time integration (Euler method, ~3s OBD interval)
 *  - Persists last 100 trips to localStorage
 *  - startTripLog() subscribes to OBD data — call once at app startup
 */

import { useState, useEffect } from 'react';
import { onOBDData } from './obdService';

/* ── Types ───────────────────────────────────────────────── */

export interface TripRecord {
  id: string;
  startTime: number;
  endTime: number;
  distanceKm: number;
  durationMin: number;
  avgSpeedKmh: number;
  maxSpeedKmh: number;
  fuelConsumptionL: number;  // estimated
  fuelCostTL: number;        // estimated
  drivingScore: number;      // 0–100 aggressiveness analysis
  harshEvents: number;       // count of sudden acceleration/braking
}

interface ActiveTrip {
  startTime: number;
  distanceKm: number;
  maxSpeedKmh: number;
  speedSum: number;
  speedCount: number;
  fuelAtStart: number;
  lastUpdateTime: number;
  lastSpeed: number;         // for acceleration delta calculation
  harshEvents: number;       // sudden speed changes > 15 km/h per sample
}

export interface TripState {
  active: boolean;
  current: (ActiveTrip & { liveDurationMin: number }) | null;
  history: TripRecord[];
  totalDistanceKm: number;
  totalTrips: number;
}

/* ── Config ──────────────────────────────────────────────── */

const STORAGE_KEY              = 'car-launcher-trip-log';
const MAX_STORED_TRIPS         = 100;
const TRIP_START_SPEED_KMH     = 5;     // start trip above this speed
const TRIP_END_IDLE_MS         = 60_000; // end trip after 60s at zero speed
const FUEL_L_PER_100KM         = 8.5;   // avg fuel consumption (configurable)
const FUEL_PRICE_TL_PER_L      = 45;    // avg pump price (TL)

/* ── Persistence ─────────────────────────────────────────── */

function _load(): TripRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as TripRecord[]) : [];
  } catch {
    return [];
  }
}

function _save(records: TripRecord[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records.slice(0, MAX_STORED_TRIPS)));
  } catch {
    // storage quota exceeded — ignore
  }
}

/* ── Module state ────────────────────────────────────────── */

const _history = _load();

let _state: TripState = {
  active: false,
  current: null,
  history: _history,
  totalDistanceKm: _sumDistance(_history),
  totalTrips: _history.length,
};

const _listeners = new Set<(s: TripState) => void>();
let _active: ActiveTrip | null = null;
let _idleTimer: ReturnType<typeof setTimeout> | null = null;
let _liveClock: ReturnType<typeof setInterval> | null = null;
let _started = false;

function _sumDistance(records: TripRecord[]): number {
  return Math.round(records.reduce((s, r) => s + r.distanceKm, 0) * 10) / 10;
}

/**
 * Driving score 0-100.
 * Penalties: harsh events, high max speed, high average speed.
 * 100 = perfect smooth driver, 0 = very aggressive.
 */
function _calcScore(maxSpeed: number, harshEvents: number, avgSpeed: number): number {
  let score = 100;
  // Harsh acceleration/braking events
  score -= Math.min(harshEvents * 8, 40);
  // Max speed penalty (above 120 km/h)
  if (maxSpeed > 180) score -= 25;
  else if (maxSpeed > 150) score -= 15;
  else if (maxSpeed > 130) score -= 8;
  else if (maxSpeed > 120) score -= 4;
  // High average speed
  if (avgSpeed > 100) score -= 10;
  else if (avgSpeed > 80) score -= 5;
  return Math.max(0, Math.round(score));
}

/* ── Core ────────────────────────────────────────────────── */

function _notify(): void {
  const snap: TripState = {
    ..._state,
    history: [..._state.history],
    current: _active
      ? {
          ..._active,
          liveDurationMin: Math.floor((Date.now() - _active.startTime) / 60_000),
        }
      : null,
  };
  _listeners.forEach((fn) => fn(snap));
}

function _setState(partial: Partial<TripState>): void {
  _state = { ..._state, ...partial };
  _notify();
}

function _startTrip(speed: number, fuelLevel: number): void {
  if (_active) return;

  _active = {
    startTime: Date.now(),
    distanceKm: 0,
    maxSpeedKmh: speed,
    speedSum: speed,
    speedCount: 1,
    fuelAtStart: fuelLevel,
    lastUpdateTime: Date.now(),
    lastSpeed: speed,
    harshEvents: 0,
  };

  // Live duration clock — updates UI every 10s
  if (_liveClock) clearInterval(_liveClock);
  _liveClock = setInterval(() => _notify(), 10_000);

  _setState({ active: true });
}

function _endTrip(): void {
  if (!_active) return;

  const now = Date.now();
  const durationMs  = now - _active.startTime;
  const durationMin = Math.round(durationMs / 60_000);

  // Discard trips shorter than 1 min or 100 m
  if (durationMin < 1 || _active.distanceKm < 0.1) {
    _active = null;
    if (_liveClock) { clearInterval(_liveClock); _liveClock = null; }
    _setState({ active: false, current: null });
    return;
  }

  const avgSpeed         = _active.speedCount > 0 ? Math.round(_active.speedSum / _active.speedCount) : 0;
  const fuelL            = Math.round((_active.distanceKm / 100) * FUEL_L_PER_100KM * 10) / 10;
  const fuelCost         = Math.round(fuelL * FUEL_PRICE_TL_PER_L);
  const drivingScore     = _calcScore(_active.maxSpeedKmh, _active.harshEvents, avgSpeed);

  const record: TripRecord = {
    id: `trip-${_active.startTime}`,
    startTime: _active.startTime,
    endTime: now,
    distanceKm: Math.round(_active.distanceKm * 10) / 10,
    durationMin,
    avgSpeedKmh: avgSpeed,
    maxSpeedKmh: Math.round(_active.maxSpeedKmh),
    fuelConsumptionL: fuelL,
    fuelCostTL: fuelCost,
    drivingScore,
    harshEvents: _active.harshEvents,
  };

  _active = null;
  if (_liveClock) { clearInterval(_liveClock); _liveClock = null; }

  const newHistory = [record, ..._state.history];
  _save(newHistory);

  _setState({
    active: false,
    current: null,
    history: newHistory,
    totalDistanceKm: _sumDistance(newHistory),
    totalTrips: newHistory.length,
  });
}

function _onOBD(speed: number, fuelLevel: number): void {
  const now = Date.now();

  if (speed > TRIP_START_SPEED_KMH) {
    // Clear idle timer
    if (_idleTimer) { clearTimeout(_idleTimer); _idleTimer = null; }

    if (!_active) {
      _startTrip(speed, fuelLevel);
    } else {
      // Update running trip
      const dtHours = (now - _active.lastUpdateTime) / 3_600_000;
      const deltKm  = speed * dtHours;

      // Sanity check: skip if delta > 1 km (corrupt sample or clock jump)
      if (deltKm >= 0 && deltKm < 1) {
        _active.distanceKm   += deltKm;
        _active.maxSpeedKmh   = Math.max(_active.maxSpeedKmh, speed);
        _active.speedSum     += speed;
        _active.speedCount   += 1;
        // Harsh event: speed delta > 15 km/h between consecutive samples
        if (Math.abs(speed - _active.lastSpeed) > 15) {
          _active.harshEvents += 1;
        }
        _active.lastSpeed = speed;
      }
      _active.lastUpdateTime = now;
      _notify();
    }

  } else if (_active && speed === 0) {
    // Start idle timer to end trip
    if (!_idleTimer) {
      _idleTimer = setTimeout(() => {
        _idleTimer = null;
        _endTrip();
      }, TRIP_END_IDLE_MS);
    }
  }
}

/* ── Public API ──────────────────────────────────────────── */

let _obdUnsub: (() => void) | null = null;

export function startTripLog(): void {
  if (_started) return;
  _started = true;
  _obdUnsub = onOBDData((data) => {
    try { _onOBD(data.speed, data.fuelLevel); } catch { /* OBD callback must never crash trip log */ }
  });
}

export function stopTripLog(): void {
  if (!_started) return;
  _started = false;
  if (_obdUnsub) { try { _obdUnsub(); } catch { /* ignore */ } _obdUnsub = null; }
  if (_idleTimer) { clearTimeout(_idleTimer); _idleTimer = null; }
  _endTrip();
}

export function deleteTrip(id: string): void {
  const newHistory = _state.history.filter((t) => t.id !== id);
  _save(newHistory);
  _setState({
    history: newHistory,
    totalDistanceKm: _sumDistance(newHistory),
    totalTrips: newHistory.length,
  });
}

export function clearAllTrips(): void {
  _save([]);
  _setState({ history: [], totalDistanceKm: 0, totalTrips: 0 });
}

export function onTripState(fn: (s: TripState) => void): () => void {
  _listeners.add(fn);
  fn({ ..._state, history: [..._state.history], current: null });
  return () => { _listeners.delete(fn); };
}

export function useTripState(): TripState {
  const [s, setS] = useState<TripState>({ ..._state, history: [..._state.history], current: null });
  useEffect(() => onTripState(setS), []);
  return s;
}
