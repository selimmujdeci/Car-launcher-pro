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
 *   odometer persist → safeStorage 1s debounce (_SAFETY_DEBOUNCE_KEYS).
 *   Kritik anlarda (speed=0 veya 1 km artış) safeFlushKey ile anında mühürlenir.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { openRearCamera, closeRearCamera } from '../cameraService';
import type { VehicleState, GPSLocation } from './types';
import { safeStorage, safeFlushKey } from '../../utils/safeStorage';

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

export interface CanExtrasPatch {
  // Kapı / aydınlatma
  doorOpen?:          boolean;
  headlightsOn?:      boolean;
  // TPMS
  tpms?:              [number, number, number, number]; // [fl,fr,rl,rr] kPa
  // Motor
  rpm?:               number | null;
  coolantTemp?:       number | null;
  oilTemp?:           number | null;
  throttle?:          number | null;
  // Elektrik
  batteryVolt?:       number | null;
  // Vites
  gearPos?:           number | null;
  // Çevre
  ambientTemp?:       number | null;
  // Şasi güvenliği
  abs?:               boolean;
  tractionControl?:   boolean;
  stabilityControl?:  boolean;
  // Gövde / konfor
  parkingBrake?:      boolean;
  seatbelt?:          boolean;
  wipers?:            boolean;
  airCondition?:      boolean;
  cruiseControl?:     boolean;
}

export interface UnifiedVehicleState {
  // ── Worker / OBD / CAN sinyalleri ────────────────────────────────────
  speed:    number | null;   // km/h, fused; null = sensör yok
  rpm:      number | undefined;
  fuel:     number | null;   // 0–100 %
  odometer: number;          // km (persisted)
  reverse:  boolean;

  // ── CAN extras: kapı / far / TPMS ────────────────────────────────────────
  canDoorOpen:   boolean;
  canHeadlights: boolean;
  canTpmsKpa:    readonly [number, number, number, number] | null;

  // ── CAN extras: motor ─────────────────────────────────────────────────────
  canRpm:         number | null;
  canCoolantTemp: number | null;
  canOilTemp:     number | null;
  canThrottle:    number | null;

  // ── CAN extras: elektrik / vites / çevre ──────────────────────────────────
  canBatteryVolt: number | null;
  canGearPos:     number | null;   // -1=R, 0=N/P, 1–8=ileri
  canAmbientTemp: number | null;

  // ── CAN extras: güvenlik ──────────────────────────────────────────────────
  canAbs:              boolean;
  canTractionControl:  boolean;
  canStabilityControl: boolean;
  canParkingBrake:     boolean;
  canSeatbelt:         boolean;

  // ── CAN extras: konfor ────────────────────────────────────────────────────
  canWipers:       boolean;
  canAirCondition: boolean;
  canCruiseControl:boolean;

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
  updateCanExtras:    (patch: CanExtrasPatch) => void;
  /** CAN transport kesildiğinde tüm CAN-kaynaklı alanları sıfırlar. GPS/konum etkilenmez. */
  resetCanData:       () => void;
}

// ── Odometer critical-flush tracker ──────────────────────────────────────
// safeStorage._SAFETY_DEBOUNCE_KEYS → 1s baz koruma.
// Araç durduğunda (speed=0) veya her 1km artışta debounce bypass ile mühürlenir.
let _lastOdometerFlushKm = 0;

// ── Store ─────────────────────────────────────────────────────────────────

export const useUnifiedVehicleStore = create<UnifiedVehicleState>()(
  persist(
    (set, get) => ({
      speed:          null,
      rpm:            undefined,
      fuel:           null,
      odometer:       0,
      reverse:        false,
      canDoorOpen:    false,
      canHeadlights:  false,
      canTpmsKpa:     null,
      canRpm:         null,
      canCoolantTemp: null,
      canOilTemp:     null,
      canThrottle:    null,
      canBatteryVolt: null,
      canGearPos:     null,
      canAmbientTemp: null,
      canAbs:              false,
      canTractionControl:  false,
      canStabilityControl: false,
      canParkingBrake:     false,
      canSeatbelt:         false,
      canWipers:           false,
      canAirCondition:     false,
      canCruiseControl:    false,
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
          if (patch.reverse) { openRearCamera(); } else { closeRearCamera(); }
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
        if ('odometer' in patch && patch.odometer != null) {
          if (patch.odometer < cur.odometer) {
            // Monotonicity guard — Son savunma hattı: Worker zaten kontrol eder; Store da doğrular
            if (import.meta.env.DEV) console.warn('[SafetyGate] Odometer rollback rejected:', patch.odometer, '<', cur.odometer);
          } else if (patch.odometer !== cur.odometer) {
            u.odometer = patch.odometer; dirty = true;
          }
        }
        if ('reverse' in patch && !!patch.reverse !== cur.reverse) {
          u.reverse = !!patch.reverse; dirty = true;
        }
        // heading ve location: GPS tarafı yetkilidir, worker patch'leri yok sayılır.

        if (dirty) {
          set(u as Partial<UnifiedVehicleState>);

          // Odometer KM mühürleme: araç durduğunda veya 1 km artışta 1s debounce bypass
          // set() sonrası çağrılır — persist middleware buffer'a yazmış olur, flush anında çalışır
          const newSpeed = 'speed' in u ? u.speed : cur.speed;
          const newOdom  = ('odometer' in u ? u.odometer : cur.odometer) ?? 0;
          if (newSpeed === 0 || Math.floor(newOdom) > Math.floor(_lastOdometerFlushKm)) {
            _lastOdometerFlushKm = newOdom;
            safeFlushKey('car-launcher-vehicle-state');
          }
        }
      },

      // ── GPS state update (from gpsService mirror subscriber) ──────────────

      updateGPSState(gpsPatch) {
        const cur = get();
        const u: Partial<UnifiedVehicleState> = {};
        let dirty = false;

        if ('location' in gpsPatch) {
          const next = gpsPatch.location ?? null;
          const prev = cur.location;
          // Shallow-equal guard: koordinat ve hız değişmediyse referansı DEĞİŞTİRME.
          // GPS standstill'de aynı fix tekrar tekrar gelir; yeni referans yaymak
          // tüm store subscriber'larını (NavigationHUD, FullMapView onGPSLocation)
          // gereksiz tetikler → CPU/termal yükü. Aynıysa ref'i sabit tut.
          const sameLoc =
            prev === next ||
            (prev != null && next != null &&
              prev.latitude === next.latitude &&
              prev.longitude === next.longitude &&
              prev.speed === next.speed);
          if (!sameLoc) {
            u.location = next;
            dirty = true;
          }

          // Smooth handover: worker hızı stale → GPS location.speed'den devral
          const stale = performance.now() - cur._vehicleSpeedTs > OBD_SPEED_STALE_MS;
          if (stale && next?.speed != null) {
            const kmh = Math.round(next.speed * 3.6);
            const clamped = kmh >= 0 ? kmh : 0;
            if (clamped !== cur.speed) { u.speed = clamped; dirty = true; }
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

      // ── CAN extras update (tüm CAN sinyalleri) ───────────────────────────

      updateCanExtras(patch) {
        const cur = get();
        const u: Partial<UnifiedVehicleState> = {};
        let dirty = false;

        function chk<K extends keyof UnifiedVehicleState>(
          key: K, val: UnifiedVehicleState[K] | undefined | null,
        ) {
          if (val == null) return;
          if (val !== cur[key]) { (u as Record<string, unknown>)[key] = val; dirty = true; }
        }
        function chkBool(key: keyof UnifiedVehicleState, val: boolean | undefined) {
          if (val == null) return;
          if (!!val !== !!(cur[key] as boolean)) {
            (u as Record<string, unknown>)[key] = val; dirty = true;
          }
        }

        // Kapı / aydınlatma
        if (patch.doorOpen     != null) chkBool('canDoorOpen',   patch.doorOpen);
        if (patch.headlightsOn != null) chkBool('canHeadlights', patch.headlightsOn);
        if (patch.tpms != null)         { u.canTpmsKpa = patch.tpms; dirty = true; }

        // Motor
        chk('canRpm',         patch.rpm);
        chk('canCoolantTemp', patch.coolantTemp);
        chk('canOilTemp',     patch.oilTemp);
        chk('canThrottle',    patch.throttle);

        // Elektrik / vites / çevre
        chk('canBatteryVolt', patch.batteryVolt);
        chk('canGearPos',     patch.gearPos);
        chk('canAmbientTemp', patch.ambientTemp);

        // Şasi güvenliği
        if (patch.abs              != null) chkBool('canAbs',              patch.abs);
        if (patch.tractionControl  != null) chkBool('canTractionControl',  patch.tractionControl);
        if (patch.stabilityControl != null) chkBool('canStabilityControl', patch.stabilityControl);

        // Gövde / konfor
        if (patch.parkingBrake  != null) chkBool('canParkingBrake',  patch.parkingBrake);
        if (patch.seatbelt      != null) chkBool('canSeatbelt',      patch.seatbelt);
        if (patch.wipers        != null) chkBool('canWipers',        patch.wipers);
        if (patch.airCondition  != null) chkBool('canAirCondition',  patch.airCondition);
        if (patch.cruiseControl != null) chkBool('canCruiseControl', patch.cruiseControl);

        if (dirty) set(u as Partial<UnifiedVehicleState>);
      },

      // ── CAN data reset (transport disconnect) ─────────────────────────────

      resetCanData() {
        set({
          // Numerik CAN sinyalleri
          canRpm:         null,
          canCoolantTemp: null,
          canOilTemp:     null,
          canThrottle:    null,
          canBatteryVolt: null,
          canGearPos:     null,
          canAmbientTemp: null,
          canTpmsKpa:     null,
          // Boolean CAN sinyalleri — bilinmiyor → güvenli varsayılan
          canDoorOpen:         false,
          canHeadlights:       false,
          canAbs:              false,
          canTractionControl:  false,
          canStabilityControl: false,
          canParkingBrake:     false,
          canSeatbelt:         false,
          canWipers:           false,
          canAirCondition:     false,
          canCruiseControl:    false,
        });
      },
    }),
    {
      name:       'car-launcher-vehicle-state',
      storage:    createJSONStorage(() => safeStorage), // _SAFETY_DEBOUNCE_KEYS: 1s baz koruma
      partialize: (s) => ({ odometer: s.odometer }),
      onRehydrateStorage: () => (state) => {
        // Rehydrasyon sonrası başlangıç km'ini senkronize et — ilk güncellemede yanlış 1km tick önlenir
        if (state) _lastOdometerFlushKm = state.odometer;
      },
    },
  ),
);
