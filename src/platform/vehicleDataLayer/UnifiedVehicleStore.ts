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
import { stampProvenance } from './vehicleProvenance';
import { persist, createJSONStorage } from 'zustand/middleware';
import { openRearCamera, closeRearCamera } from '../cameraService';
import type { VehicleState, GPSLocation } from './types';
import { safeStorage, safeFlushKey } from '../../utils/safeStorage';

export type { GPSLocation };

/**
 * Hız değerinin MUTLAK son kullanma süresi (ms) — "son savunma hattı".
 *
 * Asıl tazelik kapısı `obdService.getObdSpeedFresh()`tir (protokol kadansına göre
 * uyarlanır). Bu sabit, o kapı hiç çalışmazsa (OBD servisi ölürse, yama akışı
 * kesilirse) hızın ekranda SONSUZA DEK donmasını engeller. En yavaş protokol
 * tabanının (ISO9141 20 s) üstünde seçildi → sağlıklı KWP/ISO kadansında sahte
 * "bilinmiyor" üretmez.
 */
const SPEED_EXPIRY_MS = 30_000;

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
  highBeam?:          boolean;
  turnLeft?:          boolean;
  turnRight?:         boolean;
  hazard?:            boolean;
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
  canHighBeam:   boolean;
  canTurnLeft:   boolean;
  canTurnRight:  boolean;
  canHazard:     boolean;
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
      canHighBeam:    false,
      canTurnLeft:    false,
      canTurnRight:   false,
      canHazard:      false,
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
          // Final Gate: bozuk hız değerlerinin UI'a ulaşmasını önle.
          //
          // `undefined` = "bu yamada hız YOK". Eskiden koşulsuz `cur.speed` geri
          // yazılırdı → değer SONSUZA DEK canlı kalırdı (saha: `[SafetyGate] Rejected
          // Speed: undefined` sn'de ~1, ekranda donuk hız). Artık eski değer YALNIZ
          // tazelik penceresi içinde korunur; pencere dolunca `null` (bilinmiyor) olur.
          const valid = typeof patch.speed === 'number' && isFinite(patch.speed) && patch.speed <= 300;
          let safeSpeed: number | null;
          if (valid) {
            safeSpeed = patch.speed as number;
          } else if (patch.speed === null) {
            safeSpeed = null;                                   // kaynak açıkça "bilinmiyor" dedi
          } else if (patch.speed === undefined) {
            // Son savunma hattı: asıl kapı obdService/ObdAdapter tazelik damgasıdır.
            const age = performance.now() - cur._vehicleSpeedTs;
            safeSpeed = age > SPEED_EXPIRY_MS ? null : cur.speed;
          } else {
            safeSpeed = null;                                   // bozuk/aralık dışı → ASLA korunmaz
          }
          if (!valid && patch.speed !== undefined && patch.speed !== null) {
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
          /* V-12 — KAYNAK İZİ. Damga YAMA BAŞINA bir kez alınır (alan başına
             DEĞİL): bu yol saniyede birkaç kez çalışır ve `Date.now()` alan
             başına çağrılsaydı hot-path'e gereksiz yük binerdi.
             `speed` FUSED'dır — tek bir üreticiye indirgemek yalan olurdu. */
          const _pAt = Date.now();
          if ('speed' in u)    stampProvenance('speed', 'fused', _pAt);
          if ('rpm' in u)      stampProvenance('rpm', 'obd', _pAt);
          if ('fuel' in u)     stampProvenance('fuel', 'obd', _pAt);
          if ('odometer' in u) stampProvenance('odometer', 'derived', _pAt);
          if ('reverse' in u)  stampProvenance('reverse', 'obd', _pAt);

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

          // ⛔ HAYALET HIZ KALDIRILDI (P0, saha 2026-07-22 · Trafic/KWP):
          // Burada "smooth handover" adı altında GPS Doppler hızı ARAÇ HIZI alanına
          // yazılıyordu. Araç dururken GPS gürültüsü (fix doğruluğu 400 m ölçüldü)
          // hız alanını kendi kendine değiştiriyordu; kaynak işaretlenmediği ve
          // `_vehicleSpeedTs` tazelenmediği için devralma KALICI hale geliyor, ayrıca
          // yeniden gönderilen eski OBD değeriyle salınıma giriyordu.
          //
          // GÜVENLİK SÖZLEŞMESİ: `speed` = ARACIN kendi doğrulanmış hızıdır. Araçtan
          // taze/geçerli hız yoksa değer `null`dır ("bilinmiyor") — GPS'ten TÜRETİLMEZ.
          // GPS hızı KAYBOLMADI: `location.speed` alanında ham haliyle durur; navigasyon
          // gibi GPS hızını meşru kullanan tüketiciler oradan okur.
          //
          // NOT: worker tarafındaki `_resolveSpeedSource()` GPS fallback'i AYRI bir
          // yoldur ve bu commit'in kapsamı DIŞINDADIR (navigasyon/odometre/sürüş
          // olaylarını taşır → ayrı atomik değişiklik gerektirir).
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

        if (dirty) {
          const _pAt = Date.now();
          if ('location' in u) stampProvenance('location', 'gps', _pAt);
          if ('heading' in u)  stampProvenance('heading', 'gps', _pAt);
          set(u as Partial<UnifiedVehicleState>);
        }
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
        // TPMS: patch.tpms her CAN frame'inde YENİ bir tuple referansıyla gelir
        // (JSON parse/map'ten üretilir) — referans eşitliği hiçbir zaman tutmaz.
        // Diğer alanlar gibi ELEMAN ELEMAN kıyaslanır; 4 değer de aynıysa dirty
        // tetiklenmez (gereksiz set() → gereksiz store aboneliği uyanışı önlenir).
        function chkTpms(val: readonly [number, number, number, number] | undefined) {
          if (val == null) return;
          const prev = cur.canTpmsKpa;
          if (prev != null
            && prev[0] === val[0] && prev[1] === val[1]
            && prev[2] === val[2] && prev[3] === val[3]) {
            return; // 4 tekerlek de (fl/fr/rl/rr) aynı — dirty YOK
          }
          u.canTpmsKpa = val; dirty = true;
        }

        // Kapı / aydınlatma
        if (patch.doorOpen     != null) chkBool('canDoorOpen',   patch.doorOpen);
        if (patch.headlightsOn != null) chkBool('canHeadlights', patch.headlightsOn);
        if (patch.highBeam     != null) chkBool('canHighBeam',   patch.highBeam);
        if (patch.turnLeft     != null) chkBool('canTurnLeft',   patch.turnLeft);
        if (patch.turnRight    != null) chkBool('canTurnRight',  patch.turnRight);
        if (patch.hazard       != null) chkBool('canHazard',     patch.hazard);
        chkTpms(patch.tpms);

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

        if (dirty) {
          /* V-12 — CAN kaynaklı alanların izi. Tek damga, alan başına değil. */
          const _pAt = Date.now();
          for (const k of ['canRpm', 'canCoolantTemp', 'canOilTemp', 'canThrottle',
                           'canBatteryVolt', 'canGearPos', 'canAmbientTemp', 'canTpmsKpa'] as const) {
            if (k in u) stampProvenance(k, 'can', _pAt);
          }
          set(u as Partial<UnifiedVehicleState>);
        }
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
          canHighBeam:         false,
          canTurnLeft:         false,
          canTurnRight:        false,
          canHazard:           false,
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
