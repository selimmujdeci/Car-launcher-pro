/**
 * Performance Service — Sport Mode Pro hesaplamaları.
 *
 * Hesaplanan metrikler:
 *   - Boyuna G-kuvveti (longitudinal): ivme / frenleme
 *   - Yanal G-kuvveti (lateral): GPS heading değişimi × hız
 *   - 0-100 km/h sayacı: milisaniye doğruluğunda
 *   - Çeyrek mil (400 m) testi: süre + bitiş hızı
 *
 * Veri kaynakları:
 *   - OBD hızı (km/h) → boyuna G
 *   - GPS heading + hız → yanal G + mesafe
 */

import { useState, useEffect } from 'react';
import { useOBDState }  from './obdService';
import { useGPSLocation } from './gpsService';

/* ── Sabitler ────────────────────────────────────────────── */

const G            = 9.81;          // m/s²
const LAUNCH_SPEED = 5;             // km/h — test başlangıcı
const TARGET_100   = 100;           // km/h — sprint hedefi
const QM_DISTANCE  = 402.336;       // m — çeyrek mil
const SMOOTH_ALPHA = 0.25;          // exponential moving average

/* ── Tipler ──────────────────────────────────────────────── */

export type SprintState = 'idle' | 'waiting' | 'running' | 'done';
export type QMState     = 'idle' | 'waiting' | 'running' | 'done';

export interface SprintResult {
  timeMs: number;          // 0→100 süresi (ms)
  launchRPM?: number;      // çıkış devri
}

export interface QMResult {
  timeMs: number;          // toplam süre (ms)
  finishSpeedKmh: number;  // 400m'deki bitiş hızı
}

export interface PerformanceState {
  longitudinalG: number;     // −5 … +5 g (negatif = frenleme)
  lateralG:      number;     // −3 … +3 g (sol/sağ)
  peakAccelG:    number;     // oturum boyunca en yüksek ivme
  peakBrakeG:    number;     // oturum boyunca en güçlü frenleme

  sprintState:   SprintState;
  sprintElapsedMs: number;   // canlı sayaç (ms)
  sprintResult:  SprintResult | null;

  qmState:       QMState;
  qmElapsedMs:   number;
  qmDistanceM:   number;     // kat edilen mesafe (m)
  qmResult:      QMResult | null;
}

/* ── Modül durumu ────────────────────────────────────────── */

const INITIAL: PerformanceState = {
  longitudinalG: 0,
  lateralG:      0,
  peakAccelG:    0,
  peakBrakeG:    0,
  sprintState:   'idle',
  sprintElapsedMs: 0,
  sprintResult:  null,
  qmState:       'idle',
  qmElapsedMs:   0,
  qmDistanceM:   0,
  qmResult:      null,
};

let _state: PerformanceState = { ...INITIAL };
const _listeners = new Set<(s: PerformanceState) => void>();

function push(partial: Partial<PerformanceState>): void {
  _state = { ..._state, ...partial };
  _listeners.forEach((fn) => fn(_state));
}

/* ── İç hesaplama durumu ─────────────────────────────────── */

let _prevSpeedKmh  = 0;
let _prevTimestamp = 0;
let _prevHeading   = 0;

let _sprintStartMs  = 0;
let _sprintRafId: ReturnType<typeof setInterval> | null = null;

let _qmStartMs      = 0;
let _qmStartLat     = 0;
let _qmStartLng     = 0;
let _qmRafId: ReturnType<typeof setInterval> | null = null;

/* ── Haversine mesafe (m) ────────────────────────────────── */

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R  = 6371000;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lng2 - lng1) * Math.PI) / 180;
  const a  = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/* ── Sprint sayaç RAF ────────────────────────────────────── */

function startSprintTicker(): void {
  if (_sprintRafId) return;
  _sprintRafId = setInterval(() => {
    try {
      if (_state.sprintState === 'running') {
        push({ sprintElapsedMs: Date.now() - _sprintStartMs });
      }
    } catch { /* interval must never crash */ }
  }, 50);
}

function stopSprintTicker(): void {
  if (_sprintRafId) { clearInterval(_sprintRafId); _sprintRafId = null; }
}

/* ── QM sayaç ────────────────────────────────────────────── */

function startQMTicker(): void {
  if (_qmRafId) return;
  _qmRafId = setInterval(() => {
    try {
      if (_state.qmState === 'running') {
        push({ qmElapsedMs: Date.now() - _qmStartMs });
      }
    } catch { /* interval must never crash */ }
  }, 50);
}

function stopQMTicker(): void {
  if (_qmRafId) { clearInterval(_qmRafId); _qmRafId = null; }
}

/* ── Ana güncelleme ──────────────────────────────────────── */

/**
 * OBD hızı ve GPS konumu değişince çağrılır.
 * G-kuvvetlerini, sprint ve çeyrek mil testini günceller.
 */
export function updatePerformance(params: {
  speedKmh: number;
  lat?: number;
  lng?: number;
  heading?: number;
  rpm?: number;
}): void {
  const now     = Date.now();
  const { speedKmh, lat, lng, heading, rpm } = params;

  if (_prevTimestamp === 0) {
    _prevSpeedKmh  = speedKmh;
    _prevTimestamp = now;
    _prevHeading   = heading ?? 0;
    return;
  }

  const dtS    = Math.max((now - _prevTimestamp) / 1000, 0.05);
  const dv     = ((speedKmh - _prevSpeedKmh) / 3.6);   // m/s farkı
  const longG  = dv / (dtS * G);

  /* ── Yanal G (GPS heading + hız) ──────────────────────── */
  let latG = _state.lateralG;
  if (heading !== undefined && speedKmh > 10) {
    let dh = heading - _prevHeading;
    // Kısa yol açısı: −180…+180
    if (dh > 180) dh -= 360;
    if (dh < -180) dh += 360;
    const omega     = (dh * Math.PI) / 180 / dtS;   // rad/s
    const vMs       = speedKmh / 3.6;
    const rawLatG   = (vMs * omega) / G;
    // Exponential moving average — gürültüyü yumuşat
    latG = SMOOTH_ALPHA * rawLatG + (1 - SMOOTH_ALPHA) * _state.lateralG;
  }

  /* ── Smoothed longitudinal ───────────────────────────── */
  const smoothLong = SMOOTH_ALPHA * longG + (1 - SMOOTH_ALPHA) * _state.longitudinalG;

  /* ── Peak güncelle ───────────────────────────────────── */
  const peakAccel = Math.max(_state.peakAccelG, smoothLong);
  const peakBrake = Math.max(_state.peakBrakeG, -smoothLong);

  /* ── Sprint (0→100) ──────────────────────────────────── */
  let { sprintState, sprintResult } = _state;

  if (sprintState === 'waiting' && speedKmh >= LAUNCH_SPEED) {
    sprintState    = 'running';
    _sprintStartMs = now;
    startSprintTicker();
  }
  if (sprintState === 'running' && speedKmh >= TARGET_100) {
    const timeMs = now - _sprintStartMs;
    sprintState   = 'done';
    sprintResult  = { timeMs, launchRPM: rpm };
    stopSprintTicker();
    push({
      sprintState,
      sprintResult,
      sprintElapsedMs: timeMs,
    });
  }

  /* ── Çeyrek mil (400 m) ──────────────────────────────── */
  let { qmState, qmResult, qmDistanceM } = _state;

  if (qmState === 'waiting' && speedKmh >= LAUNCH_SPEED && lat !== undefined && lng !== undefined) {
    qmState    = 'running';
    _qmStartMs  = now;
    _qmStartLat = lat;
    _qmStartLng = lng;
    startQMTicker();
  }
  if (qmState === 'running' && lat !== undefined && lng !== undefined) {
    const dist = haversineM(_qmStartLat, _qmStartLng, lat, lng);
    qmDistanceM = dist;
    if (dist >= QM_DISTANCE) {
      const timeMs = now - _qmStartMs;
      qmState  = 'done';
      qmResult = { timeMs, finishSpeedKmh: speedKmh };
      stopQMTicker();
      push({ qmState, qmResult, qmDistanceM: dist, qmElapsedMs: timeMs });
    }
  }

  /* ── State yayını ────────────────────────────────────── */
  push({
    longitudinalG: smoothLong,
    lateralG:      latG,
    peakAccelG:    peakAccel,
    peakBrakeG:    peakBrake,
    sprintState,
    sprintResult,
    qmState,
    qmDistanceM,
  });

  _prevSpeedKmh  = speedKmh;
  _prevTimestamp = now;
  if (heading !== undefined) _prevHeading = heading;
}

/* ── Public API ──────────────────────────────────────────── */

/** 0-100 testini başlatmak için bekleme moduna al. */
export function startSprintTest(): void {
  stopSprintTicker();
  push({
    sprintState:   'waiting',
    sprintElapsedMs: 0,
    sprintResult:  null,
  });
}

/** Çeyrek mil testini başlatmak için bekleme moduna al. */
export function startQMTest(): void {
  stopQMTicker();
  push({
    qmState:     'waiting',
    qmElapsedMs: 0,
    qmDistanceM: 0,
    qmResult:    null,
  });
}

/** Aktif testi iptal et. */
export function cancelTest(): void {
  stopSprintTicker();
  stopQMTicker();
  push({
    sprintState: 'idle',
    qmState:     'idle',
  });
}

/** Peak değerleri sıfırla. */
export function resetPeaks(): void {
  push({ peakAccelG: 0, peakBrakeG: 0 });
}

/* ── React hook ──────────────────────────────────────────── */

export function usePerformanceState(): PerformanceState {
  const [state, setState] = useState<PerformanceState>(_state);
  useEffect(() => {
    setState(_state);
    _listeners.add(setState);
    return () => { _listeners.delete(setState); };
  }, []);
  return state;
}

/**
 * OBD + GPS verilerini performans servisine köprüleyen hook.
 * SportModePanel bu hook'u mount ettiğinde otomatik başlar.
 */
export function usePerformanceBridge(): void {
  const obd = useOBDState();
  const gps = useGPSLocation();

  useEffect(() => {
    updatePerformance({
      speedKmh: obd.speed,
      rpm:      obd.rpm,
      lat:      gps?.latitude,
      lng:      gps?.longitude,
      heading:  gps?.heading ?? undefined,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [obd.speed, obd.rpm, gps?.latitude, gps?.longitude, gps?.heading]);
}
