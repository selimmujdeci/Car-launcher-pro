/**
 * Trip Log Service — GPS-primary, OBD-secondary journey recording.
 *
 * Architecture:
 *  - PRIMARY km source: GPS haversine distance between consecutive fixes
 *    → accurate, independent of OBD connection
 *  - SECONDARY: OBD speed×time integration when GPS unavailable
 *  - Trip detection: speed > 5 km/h (GPS or OBD) → start; 60s idle → end
 *  - Live UI clock: 1s interval (not 10s)
 *  - Persists last 100 trips to localStorage
 */

import { useState, useEffect } from 'react';
import { onOBDData }       from './obdService';
import { onGPSLocation }   from './gpsService';
import type { GPSLocation } from './gpsService';
import { safeSetRaw, safeGetRaw } from '../utils/safeStorage';

/* ── Types ───────────────────────────────────────────────── */

export interface TripRecord {
  id:               string;
  startTime:        number;
  endTime:          number;
  distanceKm:       number;
  durationMin:      number;
  avgSpeedKmh:      number;
  maxSpeedKmh:      number;
  fuelConsumptionL: number;
  fuelCostTL:       number;
  drivingScore:     number;
  harshEvents:      number;
}

interface ActiveTrip {
  startTime:   number;   // Date.now()        — display/storage timestamp only
  startPerfMs: number;   // performance.now() — monotonic trip duration source
  distanceKm:  number;
  maxSpeedKmh: number;
  speedSum:    number;
  speedCount:  number;
  fuelAtStart: number;
  lastPerfMs:  number;   // monotonic — for OBD fallback distance calc
  lastSpeed:   number;   // for harsh-event detection
  harshEvents: number;
  // GPS primary distance tracking
  lastGPSLat:  number | null;
  lastGPSLng:  number | null;
  lastGPSTs:   number | null;   // performance.now() of last GPS fix used
}

export interface TripState {
  active:          boolean;
  current:         (ActiveTrip & { liveDurationMin: number; liveDistanceKm: number }) | null;
  history:         TripRecord[];
  totalDistanceKm: number;
  totalTrips:      number;
}

/* ── Config ──────────────────────────────────────────────── */

const STORAGE_KEY          = 'car-launcher-trip-log';
const MAX_STORED_TRIPS     = 100;
const TRIP_START_SPEED_KMH = 5;
const TRIP_END_IDLE_MS     = 60_000;
const FUEL_L_PER_100KM     = 8.5;
const FUEL_PRICE_TL_PER_L  = 45;

// GPS mesafe filtreleri
const GPS_MIN_ACCURACY_M   = 50;   // 50m'den kötü fix mesafeye eklenmez
const GPS_MAX_JUMP_M       = 300;  // tek seferde 300m'den fazla sıçrama → atlat
const GPS_MIN_DIST_M       = 5;    // 5m'den küçük delta → gürültü, atlat

/* ── Haversine ───────────────────────────────────────────── */

function _haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R  = 6_371_000;
  const dL = ((lat2 - lat1) * Math.PI) / 180;
  const dG = ((lng2 - lng1) * Math.PI) / 180;
  const a  = Math.sin(dL / 2) ** 2 +
             Math.cos((lat1 * Math.PI) / 180) *
             Math.cos((lat2 * Math.PI) / 180) *
             Math.sin(dG / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/* ── Trip ID ─────────────────────────────────────────────── */

let _tripSeq = performance.now();
function generateTripId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `trip-${crypto.randomUUID()}`;
  }
  _tripSeq += 1;
  return `trip-${Math.floor(_tripSeq)}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/* ── Persistence ─────────────────────────────────────────── */

function _load(): TripRecord[] {
  try {
    const raw = safeGetRaw(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as TripRecord[]) : [];
  } catch {
    return [];
  }
}

function _save(records: TripRecord[]): void {
  safeSetRaw(STORAGE_KEY, JSON.stringify(records.slice(0, MAX_STORED_TRIPS)));
}

/* ── Module state ────────────────────────────────────────── */

const _history = _load();

function _sumDistance(records: TripRecord[]): number {
  return Math.round(records.reduce((s, r) => s + r.distanceKm, 0) * 10) / 10;
}

let _state: TripState = {
  active:          false,
  current:         null,
  history:         _history,
  totalDistanceKm: _sumDistance(_history),
  totalTrips:      _history.length,
};

const _listeners = new Set<(s: TripState) => void>();
let _active:    ActiveTrip | null = null;
let _idleTimer: ReturnType<typeof setTimeout>  | null = null;
let _liveClock: ReturnType<typeof setInterval> | null = null;
let _started  = false;

// Son OBD verisini cache'le — GPS olmadığında fallback için
let _lastObdFuel = -1;

/* ── Driving score ───────────────────────────────────────── */

function _calcScore(maxSpeed: number, harshEvents: number, avgSpeed: number): number {
  let score = 100;
  score -= Math.min(harshEvents * 8, 40);
  if      (maxSpeed > 180) score -= 25;
  else if (maxSpeed > 150) score -= 15;
  else if (maxSpeed > 130) score -= 8;
  else if (maxSpeed > 120) score -= 4;
  if      (avgSpeed > 100) score -= 10;
  else if (avgSpeed > 80)  score -= 5;
  return Math.max(0, Math.round(score));
}

/* ── Notify ──────────────────────────────────────────────── */

function _notify(): void {
  const snap: TripState = {
    ..._state,
    history: [..._state.history],
    current: _active
      ? {
          ..._active,
          liveDurationMin: Math.floor((performance.now() - _active.startPerfMs) / 60_000),
          liveDistanceKm:  Math.round(_active.distanceKm * 100) / 100,
        }
      : null,
  };
  _listeners.forEach((fn) => fn(snap));
}

function _setState(partial: Partial<TripState>): void {
  _state = { ..._state, ...partial };
  _notify();
}

/* ── Trip lifecycle ──────────────────────────────────────── */

function _startTrip(speedKmh: number, fuelLevel: number): void {
  if (_active) return;
  const perfNow = performance.now();
  _active = {
    startTime:   Date.now(),
    startPerfMs: perfNow,
    distanceKm:  0,
    maxSpeedKmh: speedKmh,
    speedSum:    speedKmh,
    speedCount:  1,
    fuelAtStart: fuelLevel,
    lastPerfMs:  perfNow,
    lastSpeed:   speedKmh,
    harshEvents: 0,
    lastGPSLat:  null,
    lastGPSLng:  null,
    lastGPSTs:   null,
  };

  // Live clock: 1s — kullanıcı canlı km artışını görsün
  if (_liveClock) clearInterval(_liveClock);
  _liveClock = setInterval(_notify, 1_000);

  _setState({ active: true });
}

function _endTrip(): void {
  if (!_active) return;

  const durationMs  = performance.now() - _active.startPerfMs;
  const durationMin = Math.round(durationMs / 60_000);

  // 1 dakika veya 100m altındaki yolculukları kaydetme
  if (durationMin < 1 || _active.distanceKm < 0.1) {
    _active = null;
    if (_liveClock) { clearInterval(_liveClock); _liveClock = null; }
    _setState({ active: false, current: null });
    return;
  }

  const avgSpeed     = _active.speedCount > 0 ? Math.round(_active.speedSum / _active.speedCount) : 0;
  const fuelL        = Math.round((_active.distanceKm / 100) * FUEL_L_PER_100KM * 10) / 10;
  const fuelCost     = Math.round(fuelL * FUEL_PRICE_TL_PER_L);
  const drivingScore = _calcScore(_active.maxSpeedKmh, _active.harshEvents, avgSpeed);

  const record: TripRecord = {
    id:               generateTripId(),
    startTime:        _active.startTime,
    endTime:          Date.now(),
    distanceKm:       Math.round(_active.distanceKm * 10) / 10,
    durationMin,
    avgSpeedKmh:      avgSpeed,
    maxSpeedKmh:      Math.round(_active.maxSpeedKmh),
    fuelConsumptionL: fuelL,
    fuelCostTL:       fuelCost,
    drivingScore,
    harshEvents:      _active.harshEvents,
  };

  _active = null;
  if (_liveClock) { clearInterval(_liveClock); _liveClock = null; }

  const newHistory = [record, ..._state.history];
  _save(newHistory);

  _setState({
    active:          false,
    current:         null,
    history:         newHistory,
    totalDistanceKm: _sumDistance(newHistory),
    totalTrips:      newHistory.length,
  });
}

/* ── GPS handler (primary km source) ────────────────────── */

function _onGPS(loc: GPSLocation | null): void {
  if (!loc) return;

  const speedKmh = loc.speed != null ? loc.speed * 3.6 : 0;

  // Trip başlat (GPS hızıyla)
  if (speedKmh > TRIP_START_SPEED_KMH) {
    if (_idleTimer) { clearTimeout(_idleTimer); _idleTimer = null; }

    if (!_active) {
      _startTrip(speedKmh, _lastObdFuel);
    }
  } else if (_active && speedKmh < 1) {
    // Durdu — idle timer
    if (!_idleTimer) {
      _idleTimer = setTimeout(() => { _idleTimer = null; _endTrip(); }, TRIP_END_IDLE_MS);
    }
  }

  if (!_active) return;

  // ── GPS haversine mesafe ─────────────────────────────────
  const hasGoodAccuracy = loc.accuracy > 0 && loc.accuracy <= GPS_MIN_ACCURACY_M;

  if (
    hasGoodAccuracy &&
    _active.lastGPSLat !== null &&
    _active.lastGPSLng !== null
  ) {
    const distM = _haversineMeters(
      _active.lastGPSLat, _active.lastGPSLng,
      loc.latitude,       loc.longitude,
    );

    // Gürültü ve GPS sıçramalarını filtrele
    if (distM >= GPS_MIN_DIST_M && distM <= GPS_MAX_JUMP_M) {
      _active.distanceKm += distM / 1000;
    }
  }

  // Sonraki delta için bu fix'i kaydet
  if (hasGoodAccuracy) {
    _active.lastGPSLat = loc.latitude;
    _active.lastGPSLng = loc.longitude;
    _active.lastGPSTs  = performance.now();
  }

  // Max hız ve ortalama hız güncelle
  if (speedKmh > 0) {
    _active.maxSpeedKmh = Math.max(_active.maxSpeedKmh, speedKmh);
    _active.speedSum   += speedKmh;
    _active.speedCount += 1;

    // Sert manevra tespiti (≥15 km/h delta)
    if (Math.abs(speedKmh - _active.lastSpeed) > 15) {
      _active.harshEvents += 1;
    }
    _active.lastSpeed = speedKmh;
  }

  // OBD fallback zaman damgasını güncelle — GPS gelince Euler sayacını sıfırla
  _active.lastPerfMs = performance.now();
}

/* ── OBD handler (secondary — yakıt + harsh events + fallback km) ── */

function _onOBD(speedKmh: number, fuelLevel: number): void {
  if (speedKmh < 0 || speedKmh > 300) return;
  if (fuelLevel < -1 || fuelLevel > 100) return;

  if (fuelLevel >= 0) _lastObdFuel = fuelLevel;

  // GPS yoksa OBD hızını trip tespiti için kullan
  const activeSnap = _active;
  const gpsRecent = activeSnap !== null &&
    activeSnap.lastGPSTs !== null &&
    (performance.now() - activeSnap.lastGPSTs) < 5_000;

  if (speedKmh > TRIP_START_SPEED_KMH) {
    if (_idleTimer) { clearTimeout(_idleTimer); _idleTimer = null; }
    if (!_active) _startTrip(speedKmh, fuelLevel);
  } else if (_active && speedKmh === 0) {
    if (!_idleTimer) {
      _idleTimer = setTimeout(() => { _idleTimer = null; _endTrip(); }, TRIP_END_IDLE_MS);
    }
  }

  const trip = _active;
  if (!trip) return;

  // GPS güncel değilse OBD speed×time fallback (Euler integration)
  if (!gpsRecent && speedKmh > TRIP_START_SPEED_KMH) {
    const perfNow = performance.now();
    const dtHours = (perfNow - trip.lastPerfMs) / 3_600_000;
    const deltKm  = speedKmh * dtHours;

    // Makul delta (< 1 km per OBD tick) — resume/background koruması
    if (deltKm >= 0 && deltKm < 1) {
      trip.distanceKm += deltKm;
    }
    trip.lastPerfMs = perfNow;
    _notify();
  }
}

/* ── Public API ──────────────────────────────────────────── */

let _gpsUnsub: (() => void) | null = null;
let _obdUnsub: (() => void) | null = null;

export function startTripLog(): void {
  if (_started) return;
  _started = true;

  // GPS primary — haversine mesafe
  _gpsUnsub = onGPSLocation((loc) => {
    try { _onGPS(loc); } catch { /* trip log must never crash */ }
  });

  // OBD secondary — yakıt + fallback km
  _obdUnsub = onOBDData((data) => {
    try { _onOBD(data.speed, data.fuelLevel); } catch { /* trip log must never crash */ }
  });
}

export function stopTripLog(): void {
  if (!_started) return;
  _started = false;
  if (_gpsUnsub) { try { _gpsUnsub(); } catch { /* ignore */ } _gpsUnsub = null; }
  if (_obdUnsub) { try { _obdUnsub(); } catch { /* ignore */ } _obdUnsub = null; }
  if (_idleTimer) { clearTimeout(_idleTimer); _idleTimer = null; }
  if (_liveClock) { clearInterval(_liveClock); _liveClock = null; }
  _endTrip();
}

export function deleteTrip(id: string): void {
  const newHistory = _state.history.filter((t) => t.id !== id);
  _save(newHistory);
  _setState({
    history:         newHistory,
    totalDistanceKm: _sumDistance(newHistory),
    totalTrips:      newHistory.length,
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
