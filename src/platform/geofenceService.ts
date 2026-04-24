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
import { sensitiveKeyStore } from './sensitiveKeyStore';
import { addSystemNotification } from './notificationService';
import { speakAlert } from './ttsService';
import { telemetryService } from './telemetryService';

/* ── Tipler ──────────────────────────────────────────────── */

export interface GeofenceZone {
  id: string;
  name: string;
  type: 'polygon' | 'circle';
  polygon?: [number, number][]; // [lat, lng]
  center?: { lat: number; lng: number };
  radiusKm?: number;
}

export interface ZoneStatus {
  isOutside: boolean;
  currentDistKm: number;
  lastAlertExit?: number;
  lastAlertEnter?: number;
}

export interface GeofenceAlert {
  zoneId: string;
  zoneName: string;
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
  zones:          GeofenceZone[];
  zoneStatus:     Record<string, ZoneStatus>;
  lastAlert:      GeofenceAlert | null;

  // Legacy compatibility (synced with 'default' zone)
  isOutside:      boolean;
  currentDistKm:  number;
  center:         { lat: number; lng: number } | null;
  radiusKm:       number;

  valeModeActive: boolean;
  valeSpeedLimit: number;       // km/h
  valeAlert:      ValeModeAlert | null;
  valeViolations: ValeModeAlert[];

  pinLockEnabled: boolean;
  pinUnlocked:    boolean;
}

/* ── Sabitler ────────────────────────────────────────────── */

const GEOFENCE_HYSTERESIS_METERS = 20;
const GEOFENCE_HYSTERESIS_KM     = GEOFENCE_HYSTERESIS_METERS / 1000;
const GEOFENCE_MIN_ALERT_GAP_MS  = 30000; // 30 seconds

/* ── Modül durumu ────────────────────────────────────────── */

const INITIAL: GeofenceState = {
  enabled:        false,
  zones:          [],
  zoneStatus:     {},
  lastAlert:      null,
  isOutside:      false,
  currentDistKm:  0,
  center:         null,
  radiusKm:       5,
  valeModeActive: false,
  valeSpeedLimit: 50,
  valeAlert:      null,
  valeViolations: [],
  pinLockEnabled: false,
  pinUnlocked:    true,
};

let _state: GeofenceState = { ...INITIAL };
const _listeners = new Set<(s: GeofenceState) => void>();

let _saveTimeout: ReturnType<typeof setTimeout> | null = null;

async function _saveToStore() {
  try {
    await sensitiveKeyStore.set('geofence_zones', JSON.stringify(_state.zones));
    await sensitiveKeyStore.set('geofence_enabled', String(_state.enabled));
    await sensitiveKeyStore.set('geofence_vale_active', String(_state.valeModeActive));
    await sensitiveKeyStore.set('geofence_vale_limit', String(_state.valeSpeedLimit));
  } catch (e) {
    console.error('Geofence save error:', e);
  }
}

/**
 * Servis açılışında kayıtlı değerleri yükle.
 */
export async function initGeofence(): Promise<void> {
  try {
    const zonesStr = await sensitiveKeyStore.get('geofence_zones');
    const enabledStr = await sensitiveKeyStore.get('geofence_enabled');
    const valeActiveStr = await sensitiveKeyStore.get('geofence_vale_active');
    const valeLimitStr = await sensitiveKeyStore.get('geofence_vale_limit');

    const updates: Partial<GeofenceState> = {};
    if (zonesStr) updates.zones = JSON.parse(zonesStr);
    if (enabledStr) updates.enabled = enabledStr === 'true';
    if (valeActiveStr) updates.valeModeActive = valeActiveStr === 'true';
    if (valeLimitStr) updates.valeSpeedLimit = parseFloat(valeLimitStr);

    if (Object.keys(updates).length > 0) {
      const zones = updates.zones || _state.zones;
      const defaultZone = zones.find(z => z.id === 'default');
      
      _state = { 
        ..._state, 
        ...updates,
        center: defaultZone?.center || null,
        radiusKm: defaultZone?.radiusKm || 5
      };
      
      // Initialize zoneStatus for loaded zones
      const zoneStatus: Record<string, ZoneStatus> = {};
      _state.zones.forEach(z => {
        zoneStatus[z.id] = { isOutside: false, currentDistKm: 0 };
      });
      _state.zoneStatus = zoneStatus;

      _listeners.forEach((fn) => fn(_state));
    }
  } catch (e) {
    console.error('Geofence init error:', e);
  }
}

function push(partial: Partial<GeofenceState>): void {
  const next = { ..._state, ...partial };
  
  // Sync legacy properties from 'default' zone or aggregate
  const defaultZone = next.zones.find(z => z.id === 'default');
  if (defaultZone) {
    next.center = defaultZone.center || null;
    next.radiusKm = defaultZone.radiusKm || 5;
    const status = next.zoneStatus[defaultZone.id];
    if (status) {
      next.isOutside = status.isOutside;
      next.currentDistKm = status.currentDistKm;
    }
  } else if (next.zones.length > 0) {
    // If no default zone, use the first one for legacy props
    const firstZone = next.zones[0];
    next.center = firstZone.center || null;
    next.radiusKm = firstZone.radiusKm || 5;
    const status = next.zoneStatus[firstZone.id];
    if (status) {
      next.isOutside = status.isOutside;
      next.currentDistKm = status.currentDistKm;
    }
  }

  _state = next;
  _listeners.forEach((fn) => fn(_state));

  // Write Throttling: Ayarları 2 saniye sonra kaydet
  if (_saveTimeout) clearTimeout(_saveTimeout);
  _saveTimeout = setTimeout(() => {
    _saveTimeout = null;
    _saveToStore();
  }, 2000);
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

/* ── Polygon Helpers ─────────────────────────────────────── */

/**
 * Standard ray-casting algorithm to check if a point is inside a polygon.
 */
function isInsidePolygon(lat: number, lng: number, polygon: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [latI, lngI] = polygon[i];
    const [latJ, lngJ] = polygon[j];
    const intersect = ((lngI > lng) !== (lngJ > lng)) &&
      (lat < (latJ - latI) * (lng - lngI) / (lngJ - lngI) + latI);
    if (intersect) inside = !inside;
  }
  return inside;
}


/**
 * Calculates the minimum distance from a point to a polygon boundary in km.
 */
function distanceToPolygonBoundaryKm(lat: number, lng: number, polygon: [number, number][]): number {
  let minDistance = Infinity;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const p1 = polygon[i];
    const p2 = polygon[j];
    
    // Distance from point to line segment (approximation for small distances)
    const l2 = Math.pow(p1[0] - p2[0], 2) + Math.pow(p1[1] - p2[1], 2);
    let dist;
    if (l2 === 0) {
      dist = haversineKm(lat, lng, p1[0], p1[1]);
    } else {
      let t = ((lat - p1[0]) * (p2[0] - p1[0]) + (lng - p1[1]) * (p2[1] - p1[1])) / l2;
      t = Math.max(0, Math.min(1, t));
      dist = haversineKm(lat, lng, p1[0] + t * (p2[0] - p1[0]), p1[1] + t * (p2[1] - p1[1]));
    }
    
    if (dist < minDistance) minDistance = dist;
  }
  return minDistance;
}

/* ── Ana kontrol ─────────────────────────────────────────── */

/**
 * Her GPS güncellemesinde çağrılır (useGeofenceBridge hook'undan).
 */
export function checkGeofence(lat: number, lng: number, speedKmh: number): void {
  // ── Geofence kontrolü ──────────────────────────────────
  if (_state.enabled && _state.zones.length > 0) {
    const now = Date.now();
    const newZoneStatus = { ..._state.zoneStatus };
    let statusChanged = false;

    for (const zone of _state.zones) {
      const status = newZoneStatus[zone.id] || { isOutside: false, currentDistKm: 0 };
      let isInside = false;
      let distToBoundaryKm = 0;
      let currentDistKm = 0;

      if (zone.type === 'circle' && zone.center && zone.radiusKm) {
        currentDistKm = haversineKm(zone.center.lat, zone.center.lng, lat, lng);
        isInside = currentDistKm <= zone.radiusKm;
        distToBoundaryKm = Math.abs(currentDistKm - zone.radiusKm);
      } else if (zone.type === 'polygon' && zone.polygon) {
        isInside = isInsidePolygon(lat, lng, zone.polygon);
        distToBoundaryKm = distanceToPolygonBoundaryKm(lat, lng, zone.polygon);
        currentDistKm = isInside ? 0 : distToBoundaryKm; // Simplify for polygon
      }

      const wasOutside = status.isOutside;
      const isCurrentlyOutside = !isInside;

      // Hysteresis logic: 20m beyond boundary AND 30s gap
      if (isCurrentlyOutside && !wasOutside) {
        // Potential Exit
        const timeSinceLastExit = now - (status.lastAlertExit || 0);
        if (distToBoundaryKm >= GEOFENCE_HYSTERESIS_KM && timeSinceLastExit >= GEOFENCE_MIN_ALERT_GAP_MS) {
          status.isOutside = true;
          status.lastAlertExit = now;
          statusChanged = true;

          const alert: GeofenceAlert = { 
            zoneId: zone.id, 
            zoneName: zone.name, 
            type: 'exit', 
            distanceKm: currentDistKm, 
            timestamp: now 
          };
          push({ lastAlert: alert });

          const msg = `Güvenlik uyarısı: Araç ${zone.name} bölgesinden ayrıldı.`;
          addSystemNotification('Güvenlik', msg, true);
          speakAlert(msg);

          telemetryService.pushAlert('geofence_alert', {
            zoneId: zone.id,
            zoneName: zone.name,
            violation: 'exit',
            distanceKm: currentDistKm,
            lat,
            lng,
            speedKmh,
            timestamp: now,
          });
        }
      } else if (!isCurrentlyOutside && wasOutside) {
        // Potential Enter
        const timeSinceLastEnter = now - (status.lastAlertEnter || 0);
        if (distToBoundaryKm >= GEOFENCE_HYSTERESIS_KM && timeSinceLastEnter >= GEOFENCE_MIN_ALERT_GAP_MS) {
          status.isOutside = false;
          status.lastAlertEnter = now;
          statusChanged = true;

          const alert: GeofenceAlert = { 
            zoneId: zone.id, 
            zoneName: zone.name, 
            type: 'enter', 
            distanceKm: currentDistKm, 
            timestamp: now 
          };
          push({ lastAlert: alert });
          
          const msg = `Güvenlik uyarısı: Araç ${zone.name} bölgesine girdi.`;
          addSystemNotification('Güvenlik', msg, false);
          // speakAlert(msg); // Optional for entry
        }
      }

      // Always update current distance for UI
      if (status.currentDistKm !== currentDistKm) {
        status.currentDistKm = currentDistKm;
        statusChanged = true;
      }
      
      newZoneStatus[zone.id] = status;
    }

    if (statusChanged) {
      push({ zoneStatus: newZoneStatus });
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

      // Vale ihlali uyarısı
      const msg = `Vale uyarısı: Hız sınırı ${Math.round(speedKmh)} kilometre ile aşıldı.`;
      addSystemNotification('Vale Modu', msg, true);
      speakAlert(msg);

      // Telemetri: throttle bypass — valet ihlali anında push
      telemetryService.pushAlert('valet_alert', {
        violation:  'speed_limit',
        speedKmh,
        limitKmh:   _state.valeSpeedLimit,
        lat,
        lng,
        timestamp:  Date.now(),
      });

      // 3 saniye sonra alert'i temizle
      setTimeout(() => push({ valeAlert: null }), 3000);
    }
  }
}

/* ── Public API ──────────────────────────────────────────── */

export function addGeofenceZone(zone: GeofenceZone): void {
  const zones = [..._state.zones, zone];
  const zoneStatus = { ..._state.zoneStatus, [zone.id]: { isOutside: false, currentDistKm: 0 } };
  push({ zones, zoneStatus });
}

export function removeGeofenceZone(id: string): void {
  const zones = _state.zones.filter(z => z.id !== id);
  const zoneStatus = { ..._state.zoneStatus };
  delete zoneStatus[id];
  push({ zones, zoneStatus });
}

export function updateGeofenceZone(id: string, partial: Partial<GeofenceZone>): void {
  const zones = _state.zones.map(z => z.id === id ? { ...z, ...partial } : z);
  push({ zones });
}

export function setGeofenceEnabled(enabled: boolean): void {
  push({ enabled, lastAlert: null });
}

export function setGeofenceCenter(center: { lat: number; lng: number } | null): void {
  if (!center) return;
  
  const existing = _state.zones.find(z => z.id === 'default');
  if (existing) {
    updateGeofenceZone('default', { center });
  } else {
    addGeofenceZone({
      id: 'default',
      name: 'Park Bölgesi',
      type: 'circle',
      center,
      radiusKm: 5
    });
  }
}

export function setGeofenceRadius(radiusKm: number): void {
  updateGeofenceZone('default', { radiusKm });
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
