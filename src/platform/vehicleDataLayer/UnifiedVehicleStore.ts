/**
 * UnifiedVehicleStore — Sistemin tek "Veri Evi"
 *
 * useVehicleStore (OBD/CAN/Worker sinyalleri) ve useGPSStore (GPS metadata)
 * bu store'da birleştirildi. Uygulama genelinde tek bir Zustand instance'ı.
 *
 * Hız Füzyonu (Smooth Handover):
 *   VehicleCompute.worker zaten OBD→GPS kademeli geçişi yapar.
 *   Ek güvence olarak: worker'dan 5s'den uzun süredir hız gelmiyorsa
 *   GPS location.speed (m/s) doğrudan km/h'e çevrilip store'a yazılır.
 *
 * Yazma Koruma:
 *   odometer persist → 4s debounce (eMMC ömrü koruması — CLAUDE.md §3)
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { openRearCamera, closeRearCamera } from '../cameraService';
import type { VehicleState, GPSLocation } from './types';
import { safeStorage } from '../../utils/safeStorage';

export type { GPSLocation };

const OBD_SPEED_STALE_MS = 5_000;

export interface GPSStatePatch {
  location?:    GPSLocation | null;
  heading?:     number | null;
  isTracking?:  boolean;
  error?:       string | null;
  unavailable?: boolean;
  source?:      'native' | 'web' | 'last_known' | 'default' | null;
}

export interface UnifiedVehicleState {
  // ── Worker / OBD / CAN sinyalleri ────────────────────────────────────
  speed:    number | null;   // km/h, fused; null = sensör yok
  rpm:      number | undefined;
  fuel:     number | null;   // 0–100 %
  odometer: number;          // km (persisted)
  reverse:  boolean;

  // ── GPS sinyalleri (gpsService → updateGPSState) ──────────────────────
  heading:  number | null;   // blended GPS+compass (°)
  location: GPSLocation | null;

  // ── GPS metadata ───────────────────────────────────────────────────────
  gpsTracking:    boolean;
  gpsError:       string | null;
  gpsUnavailable: boolean;
  gpsSource:      'native' | 'web' | 'last_known' | 'default' | null;

  // ── Fusion guard (not persisted) ──────────────────────────────────────
  _vehicleSpeedTs: number; // performance.now() of last non-null worker speed

  // ── Actions ────────────────────────────────────────────────────────────
  updateVehicleState: (patch: Partial<VehicleState>) => void;
  updateGPSState:     (patch: GPSStatePatch) => void;
}

// ── 4s write throttle — eMMC write protection ────────────────────────────

let _pendingWrite: (() => void) | null = null;
let _writeTimer: ReturnType<typeof setTimeout> | null = null;

const throttledStorage = createJSONStorage(() => ({
  getItem:    (name: string)               => safeStorage.getItem(name),
  setItem:    (name: string, value: string) => {
    _pendingWrite = () => safeStorage.setItem(name, value);
    if (!_writeTimer) {
      _writeTimer = setTimeout(() => {
        _writeTimer   = null;
        _pendingWrite?.();
        _pendingWrite = null;
      }, 4000);
    }
  },
  removeItem: (name: string)               => safeStorage.removeItem(name),
}));

// ── Store ─────────────────────────────────────────────────────────────────

export const useUnifiedVehicleStore = create<UnifiedVehicleState>()(
  persist(
    (set, get) => ({
      speed:          null,
      rpm:            undefined,
      fuel:           null,
      odometer:       0,
      reverse:        false,
      heading:        null,
      location:       null,
      gpsTracking:    false,
      gpsError:       null,
      gpsUnavailable: false,
      gpsSource:      null,
      _vehicleSpeedTs: 0,

      // ── Vehicle signal update (from VehicleCompute.worker via index.ts) ──

      updateVehicleState(patch) {
        const cur = get();

        // Güvenlik kritik: reverse → anında kamera tetikle (RAF'ı beklemez)
        if ('reverse' in patch && !!patch.reverse !== cur.reverse) {
          patch.reverse ? openRearCamera() : closeRearCamera();
        }

        const u: Partial<UnifiedVehicleState> = {};
        let dirty = false;

        if ('speed' in patch) {
          // Final Gate: bozuk hız değerlerinin UI'a ulaşmasını önle
          const safeSpeed = (typeof patch.speed === 'number' && isFinite(patch.speed) && patch.speed <= 300)
            ? patch.speed
            : (patch.speed === null ? null : cur.speed);
          if (safeSpeed !== patch.speed) {
            console.warn('[SafetyGate] Rejected Speed:', patch.speed);
          }
          if (safeSpeed !== cur.speed) {
            u.speed = safeSpeed;
            if (safeSpeed !== null) u._vehicleSpeedTs = performance.now();
            dirty = true;
          }
        }
        if ('rpm' in patch && patch.rpm !== cur.rpm) {
          u.rpm = patch.rpm; dirty = true;
        }
        if ('fuel' in patch && patch.fuel !== cur.fuel) {
          u.fuel = patch.fuel; dirty = true;
        }
        if ('odometer' in patch && patch.odometer != null && patch.odometer !== cur.odometer) {
          u.odometer = patch.odometer; dirty = true;
        }
        if ('reverse' in patch && !!patch.reverse !== cur.reverse) {
          u.reverse = !!patch.reverse; dirty = true;
        }
        // heading ve location: GPS tarafı yetkilidir, worker patch'leri yok sayılır.

        if (dirty) set(u as Partial<UnifiedVehicleState>);
      },

      // ── GPS state update (from gpsService mirror subscriber) ──────────────

      updateGPSState(gpsPatch) {
        const cur = get();
        const u: Partial<UnifiedVehicleState> = {};
        let dirty = false;

        if ('location' in gpsPatch) {
          u.location = gpsPatch.location ?? null;
          dirty = true;

          // Smooth handover: worker hızı stale → GPS location.speed'den devral
          const stale = performance.now() - cur._vehicleSpeedTs > OBD_SPEED_STALE_MS;
          if (stale && gpsPatch.location?.speed != null) {
            const kmh = Math.round(gpsPatch.location.speed * 3.6);
            const clamped = kmh >= 0 ? kmh : 0;
            if (clamped !== cur.speed) u.speed = clamped;
          }
        }
        if ('heading' in gpsPatch && (gpsPatch.heading ?? null) !== cur.heading) {
          u.heading = gpsPatch.heading ?? null; dirty = true;
        }
        if ('isTracking' in gpsPatch && !!gpsPatch.isTracking !== cur.gpsTracking) {
          u.gpsTracking = !!gpsPatch.isTracking; dirty = true;
        }
        if ('error' in gpsPatch && (gpsPatch.error ?? null) !== cur.gpsError) {
          u.gpsError = gpsPatch.error ?? null; dirty = true;
        }
        if ('unavailable' in gpsPatch && !!gpsPatch.unavailable !== cur.gpsUnavailable) {
          u.gpsUnavailable = !!gpsPatch.unavailable; dirty = true;
        }
        if ('source' in gpsPatch && (gpsPatch.source ?? null) !== cur.gpsSource) {
          u.gpsSource = gpsPatch.source ?? null; dirty = true;
        }

        if (dirty) set(u as Partial<UnifiedVehicleState>);
      },
    }),
    {
      name:       'car-launcher-vehicle-state', // aynı key → sorunsuz migrasyon
      storage:    throttledStorage,
      partialize: (s) => ({ odometer: s.odometer }),
    },
  ),
);
