/**
 * Geofence Service — Sanal Çit + Vale Modu güvenlik servisi.
 *
 * Özellikler:
 *   - Haversine formülüyle GPS pozisyonu vs merkez mesafesi
 *   - Yarıçap ihlalinde olay yayını (geri bildirim bileşenine)
 *   - Vale modu: hız sınırı aşılınca sesli + görsel uyarı
 *   - Her GPS güncellemesinde kontrol (harici çağrı gerektirir)
 */

import { useState, useEffect } from 'react';
import { verifyPin } from './pinService';

/* ── Tipler ──────────────────────────────────────────────── */

export interface GeofenceCenter {
  lat: number;
  lng: number;
  label?: string;
}

export interface GeofenceAlert {
  type: 'exit' | 'enter';
  distanceKm: number;
  timestamp: number;
}

export interface ValeModeAlert {
  speedKmh: number;
  limitKmh: number;
  timestamp: number;
}

export interface GeofenceState {
  enabled:        boolean;
  center:         GeofenceCenter | null;
  radiusKm:       number;
  currentDistKm:  number;
  isOutside:      boolean;
  lastAlert:      GeofenceAlert | null;

  valeModeActive: boolean;
  valeSpeedLimit: number;       // km/h
  valeAlert:      ValeModeAlert | null;
  valeViolations: ValeModeAlert[];

  pinLockEnabled: boolean;
  pinUnlocked:    boolean;
}

/* ── Modül durumu ────────────────────────────────────────── */

const INITIAL: GeofenceState = {
  enabled:        false,
  center:         null,
  radiusKm:       5,
  currentDistKm:  0,
  isOutside:      false,
  lastAlert:      null,
  valeModeActive: false,
  valeSpeedLimit: 50,
  valeAlert:      null,
  valeViolations: [],
  pinLockEnabled: false,
  pinUnlocked:    true,
};

let _state: GeofenceState = { ...INITIAL };
const _listeners = new Set<(s: GeofenceState) => void>();

function push(partial: Partial<GeofenceState>): void {
  _state = { ..._state, ...partial };
  _listeners.forEach((fn) => fn(_state));
}

/* ── Haversine mesafe (km) ───────────────────────────────── */

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R  = 6371;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lng2 - lng1) * Math.PI) / 180;
  const a  = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/* ── Ana kontrol ─────────────────────────────────────────── */

/**
 * Her GPS güncellemesinde çağrılır (useGeofenceBridge hook'undan).
 */
export function checkGeofence(lat: number, lng: number, speedKmh: number): void {
  // ── Geofence kontrolü ──────────────────────────────────
  if (_state.enabled && _state.center) {
    const dist  = haversineKm(_state.center.lat, _state.center.lng, lat, lng);
    const wasIn = !_state.isOutside;
    const isOut = dist > _state.radiusKm;

    if (isOut && wasIn) {
      // İlk kez dışarı çıktı
      const alert: GeofenceAlert = { type: 'exit', distanceKm: dist, timestamp: Date.now() };
      push({ currentDistKm: dist, isOutside: true, lastAlert: alert });
    } else if (!isOut && !wasIn) {
      const alert: GeofenceAlert = { type: 'enter', distanceKm: dist, timestamp: Date.now() };
      push({ currentDistKm: dist, isOutside: false, lastAlert: alert });
    } else {
      push({ currentDistKm: dist });
    }
  }

  // ── Vale modu hız kontrolü ─────────────────────────────
  if (_state.valeModeActive && speedKmh > _state.valeSpeedLimit) {
    const alert: ValeModeAlert = {
      speedKmh,
      limitKmh: _state.valeSpeedLimit,
      timestamp: Date.now(),
    };
    // Kısa debounce: son uyarıdan 5 saniye geçmişse yeni uyarı
    const lastTs = _state.valeViolations.at(-1)?.timestamp ?? 0;
    if (Date.now() - lastTs > 5000) {
      push({
        valeAlert:      alert,
        valeViolations: [..._state.valeViolations.slice(-49), alert],
      });
      // 3 saniye sonra alert'i temizle
      setTimeout(() => push({ valeAlert: null }), 3000);
    }
  }
}

/* ── Public API ──────────────────────────────────────────── */

export function setGeofenceCenter(center: GeofenceCenter | null): void {
  push({ center, isOutside: false, lastAlert: null, currentDistKm: 0 });
}

export function setGeofenceEnabled(enabled: boolean): void {
  push({ enabled, lastAlert: null });
}

export function setGeofenceRadius(radiusKm: number): void {
  push({ radiusKm });
}

export function setValeMode(active: boolean): void {
  push({ valeModeActive: active, valeAlert: null });
}

export function setValeSpeedLimit(limit: number): void {
  push({ valeSpeedLimit: limit });
}

export function setPinLock(enabled: boolean): void {
  push({ pinLockEnabled: enabled, pinUnlocked: !enabled });
}

export async function unlockPin(attempt: string): Promise<boolean> {
  if (!_state.pinLockEnabled) {
    push({ pinUnlocked: true });
    return true;
  }
  const ok = await verifyPin(attempt);
  if (ok) push({ pinUnlocked: true });
  return ok;
}

export function lockPin(): void {
  if (_state.pinLockEnabled) push({ pinUnlocked: false });
}

export function clearValeViolations(): void {
  push({ valeViolations: [], valeAlert: null });
}

export function dismissGeofenceAlert(): void {
  push({ lastAlert: null });
}

export function getGeofenceState(): GeofenceState { return _state; }

/* ── React hook ──────────────────────────────────────────── */

export function useGeofenceState(): GeofenceState {
  const [state, setState] = useState<GeofenceState>(_state);
  useEffect(() => {
    setState(_state);
    _listeners.add(setState);
    return () => { _listeners.delete(setState); };
  }, []);
  return state;
}
