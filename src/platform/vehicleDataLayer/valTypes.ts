/**
 * valTypes.ts — Vehicle Abstraction Layer (VAL) Type Definitions
 *
 * `IVehicleSignal<T>`: Tüm araç sinyalleri için normalize edilmiş kapsayıcı.
 *   value      — Her zaman sistem standart birimleri (km/h, %, °C, kPa, V).
 *   ts         — Kaynakta ölçüm zamanı (Date.now() ms).
 *   confidence — 0.0–1.0 sinyal güvenilirliği (kaynak kalitesi + tazelik).
 *
 * `NormalizedVehicleData`: Tüm araç metriklerini kapsayan normalize edilmiş veri seti.
 *   Tüm birimler sistemde sabittir:
 *     Hız       → km/h
 *     Yakıt     → % (0–100)
 *     Sıcaklık  → °C
 *     Basınç    → kPa
 *     Voltaj    → V
 *
 * `SignalSource`: Veriyi üreten fiziksel kaynak.
 *   CAN    — Araç CAN bus (en güvenilir, doğrudan ECU)
 *   OBD    — OBD-II serial adapter (güvenilir, ~0.3s gecikme)
 *   GPS    — GNSS alıcısı (konum hassas, hız için ikincil)
 *   FUSED  — Birden fazla kaynaktan sentezlenmiş (confidence en yüksek kullanılır)
 */

/* ── Sinyal kapsayıcı ────────────────────────────────────────────────────── */

export interface IVehicleSignal<T> {
  /** Sistem standardı birimde değer (km/h, %, °C, kPa, V…) */
  readonly value:      T;
  /** Kaynakta ölçüm zamanı — Date.now() ms */
  readonly ts:         number;
  /**
   * Sinyal güvenilirliği: 0.0 (geçersiz) – 1.0 (mükemmel).
   *
   * Temel değerler (tazelik azaldıkça düşer):
   *   CAN  → 0.95   (doğrudan ECU, düşük gecikme)
   *   OBD  → 0.85   (serial, ~300ms gecikme)
   *   GPS  → 0.70   (Doppler hız, konum daha güvenilir)
   *
   * Fusion: `effectiveConf = baseConf × max(0, 1 - age_ms / timeout_ms)`
   */
  readonly confidence: number;
}

/* ── Kaynak tanımlayıcı ──────────────────────────────────────────────────── */

export type SignalSource = 'CAN' | 'OBD' | 'GPS' | 'FUSED';

/* ── Normalize edilmiş araç verisi ───────────────────────────────────────── */

export interface NormalizedVehicleData {
  // ── Sürüş ────────────────────────────────────────────────────────────────
  /** Araç hızı (km/h) */
  speed?:          IVehicleSignal<number>;
  /** Geri vites aktif mi */
  reverse?:        IVehicleSignal<boolean>;
  /** Yakıt seviyesi (0–100 %) */
  fuel?:           IVehicleSignal<number>;

  // ── Motor ────────────────────────────────────────────────────────────────
  /** Motor devri (RPM) */
  rpm?:            IVehicleSignal<number>;
  /** Motor soğutma suyu sıcaklığı (°C) */
  coolantTemp?:    IVehicleSignal<number>;
  /** Motor yağ sıcaklığı (°C) */
  oilTemp?:        IVehicleSignal<number>;
  /** Gaz pedalı konumu (0–100 %) */
  throttle?:       IVehicleSignal<number>;

  // ── Elektrik ─────────────────────────────────────────────────────────────
  /** 12V akü voltajı (V) */
  batteryVolt?:    IVehicleSignal<number>;

  // ── Vites ────────────────────────────────────────────────────────────────
  /** Vites konumu (-1=R, 0=N/P, 1–8=ileri) */
  gearPos?:        IVehicleSignal<number>;

  // ── Çevre ────────────────────────────────────────────────────────────────
  /** Dış ortam sıcaklığı (°C) */
  ambientTemp?:    IVehicleSignal<number>;

  // ── Konum & Yön ──────────────────────────────────────────────────────────
  /** GPS konumu */
  location?:       IVehicleSignal<{ lat: number; lng: number; accuracy: number }>;
  /** Araç yönü (derece, 0–360) */
  heading?:        IVehicleSignal<number>;

  // ── Mesafe ───────────────────────────────────────────────────────────────
  /** Araç kümülatif kat edilen mesafe (km) */
  totalDistance?:  IVehicleSignal<number>;

  // ── TPMS ─────────────────────────────────────────────────────────────────
  /** Lastik basınçları (kPa), [FL, FR, RL, RR] */
  tpms?:           IVehicleSignal<number[]>;
}

/* ── Kaynak yapılandırması (VehicleProfile için) ─────────────────────────── */

export interface SignalSourceConfig {
  /** Temel güvenilirlik skoru (tazelik azaldıkça çarpılır) */
  baseConfidence:  number;
  /** Bu kadar ms geçince sinyal stale sayılır */
  timeoutMs:       number;
}

export const SIGNAL_SOURCE_DEFAULTS: Readonly<Record<SignalSource, SignalSourceConfig>> = {
  CAN:   { baseConfidence: 0.95, timeoutMs: 3_000 },
  OBD:   { baseConfidence: 0.85, timeoutMs: 2_000 },
  GPS:   { baseConfidence: 0.70, timeoutMs: 5_000 },
  FUSED: { baseConfidence: 1.00, timeoutMs: 5_000 },
};
