/**
 * SignalNormalizer — Durumsuz Birim Dönüşüm Katmanı
 *
 * Ham adaptör verisini sistem standart birimlerine çevirir.
 * Önceden GpsAdapter.ts (m/s → km/h) ve obdService.ts'de dağınık olan
 * dönüşüm mantığı burada merkezi olarak yönetilir.
 *
 * Standart birimler:
 *   Hız       → km/h
 *   Yakıt     → % (0–100)
 *   Sıcaklık  → °C
 *   Basınç    → kPa (TPMS)
 *   Voltaj    → V
 *
 * Güven skoru (confidence):
 *   Her kaynak için temel skor × anlık tazelik faktörü.
 *   Çağıran taraf `ts = Date.now()` geçirir; fusion `effectiveConf` hesaplar.
 */

import type {
  IVehicleSignal,
  NormalizedVehicleData,
} from '../../platform/vehicleDataLayer/valTypes';
import type {
  CanAdapterData,
  ObdAdapterData,
  VehicleHALData,
} from '../../platform/vehicleDataLayer/types';

/* ── Dahili ham GPS tipi (m/s speed) ────────────────────────────────────── */

export interface RawGpsData {
  speedMs?:  number;   // m/s — Doppler ham değer
  heading?:  number;   // derece
  location?: { lat: number; lng: number; accuracy: number };
}

/* ── Güven sabitleri ─────────────────────────────────────────────────────── */

const CONF_HAL = 0.98;
const CONF_CAN = 0.92;
const CONF_OBD = 0.85;
const CONF_GPS = 0.70;

/** GPS konum güveni: accuracy arttıkça düşer. 5m → ~0.95, 30m → ~0.70, 100m → ~0.40 */
function _locationConf(accuracyM: number): number {
  return Math.max(0.20, Math.min(1.0, 1 / (1 + accuracyM / 20)));
}

/** GPS Doppler hız güveni: konum accuracy bağımsız ama yüksek hızda daha güvenilir */
function _gpsSpeedConf(speedKmh: number): number {
  // 0 km/h → 0.50 (durmak belirsiz), 30 km/h+ → 0.70 (tam GPS güveni)
  return CONF_GPS * Math.min(1.0, 0.5 + speedKmh / 60);
}

/* ── Sinyal oluşturucuları (inline — zero-allocation) ────────────────────── */

function sig<T>(value: T, ts: number, confidence: number): IVehicleSignal<T> {
  return { value, ts, confidence: Math.max(0, Math.min(1, confidence)) };
}

/* ── Hidden-class kararlılığı (V8 TurboFan) ──────────────────────────────────
   Tüm `from*` metodları bu tam-şablon nesnesini döndürür. Tek literal kaynağı
   → V8 için tek "Hidden Class" (Map). Özellikler koşullu eklenince "transition"
   yaşanmaz; ayrıca dört metodun da çıktısı AYNI Map olduğundan tüketici tarafı
   (worker `_emitSpeed` vb.) `signals.speed` erişiminde monomorfik kalır.
   Anahtar SIRASI = NormalizedVehicleData arayüz sırası (değiştirme). */
function _blankNormalized(): NormalizedVehicleData {
  return {
    speed:         undefined,
    reverse:       undefined,
    fuel:          undefined,
    rpm:           undefined,
    coolantTemp:   undefined,
    oilTemp:       undefined,
    throttle:      undefined,
    batteryVolt:   undefined,
    gearPos:       undefined,
    ambientTemp:   undefined,
    location:      undefined,
    heading:       undefined,
    totalDistance: undefined,
    tpms:          undefined,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   SignalNormalizer — Tüm metodlar static ve durumsuz
══════════════════════════════════════════════════════════════════════════ */

export class SignalNormalizer {

  /* ── CAN bus → NormalizedVehicleData ─────────────────────────────────── */

  /**
   * Ham CAN adapter verisini normalize eder.
   * CAN bus doğrudan ECU sinyalidir; birimlerin zaten doğru olduğu varsayılır.
   * TPMS: ham değer kPa olarak saklanır.
   *
   * @param raw  CanAdapterData (ham CAN frame)
   * @param ts   Ölçüm zamanı (Date.now() ms)
   */
  static fromCAN(raw: CanAdapterData, ts: number): NormalizedVehicleData {
    const out = _blankNormalized();

    // ── Hız ──────────────────────────────────────────────────────────────
    if (raw.speed != null)       out.speed       = sig(raw.speed,       ts, CONF_CAN);
    if (raw.reverse != null)     out.reverse     = sig(raw.reverse,     ts, CONF_CAN);
    if (raw.fuel != null)        out.fuel        = sig(raw.fuel,        ts, CONF_CAN);

    // ── Motor ─────────────────────────────────────────────────────────────
    if (raw.rpm != null)         out.rpm         = sig(raw.rpm,         ts, CONF_CAN);
    if (raw.coolantTemp != null) out.coolantTemp = sig(raw.coolantTemp, ts, CONF_CAN);
    if (raw.oilTemp != null)     out.oilTemp     = sig(raw.oilTemp,     ts, CONF_CAN);
    if (raw.throttle != null)    out.throttle    = sig(raw.throttle,    ts, CONF_CAN);

    // ── Elektrik ──────────────────────────────────────────────────────────
    if (raw.batteryVolt != null) out.batteryVolt = sig(raw.batteryVolt, ts, CONF_CAN);

    // ── Vites ─────────────────────────────────────────────────────────────
    if (raw.gearPos != null)     out.gearPos     = sig(raw.gearPos,     ts, CONF_CAN);

    // ── Çevre ────────────────────────────────────────────────────────────
    if (raw.ambientTemp != null) out.ambientTemp = sig(raw.ambientTemp, ts, CONF_CAN);

    // ── TPMS: ham değer kPa kabul edilir ─────────────────────────────────
    if (raw.tpms != null && raw.tpms.length === 4) {
      out.tpms = sig(raw.tpms as number[], ts, CONF_CAN);
    }

    return out;
  }

  /* ── HAL → NormalizedVehicleData ────────────────────────────────────── */

  /**
   * Native HAL verisini normalize eder.
   * fromCAN ile aynı haritalama mantığı; sinyaller CONF_HAL (0.98) güveniyle üretilir.
   * Hiyerarşi: HAL > CAN > OBD > GPS.
   *
   * @param raw  VehicleHALData (CanAdapterData uyumlu HAL frame)
   * @param ts   Ölçüm zamanı (Date.now() ms)
   */
  static fromHAL(raw: VehicleHALData, ts: number): NormalizedVehicleData {
    const out = _blankNormalized();

    if (raw.speed != null)       out.speed       = sig(raw.speed,       ts, CONF_HAL);
    if (raw.reverse != null)     out.reverse     = sig(raw.reverse,     ts, CONF_HAL);
    if (raw.fuel != null)        out.fuel        = sig(raw.fuel,        ts, CONF_HAL);

    if (raw.rpm != null)         out.rpm         = sig(raw.rpm,         ts, CONF_HAL);
    if (raw.coolantTemp != null) out.coolantTemp = sig(raw.coolantTemp, ts, CONF_HAL);
    if (raw.oilTemp != null)     out.oilTemp     = sig(raw.oilTemp,     ts, CONF_HAL);
    if (raw.throttle != null)    out.throttle    = sig(raw.throttle,    ts, CONF_HAL);

    if (raw.batteryVolt != null) out.batteryVolt = sig(raw.batteryVolt, ts, CONF_HAL);

    if (raw.gearPos != null)     out.gearPos     = sig(raw.gearPos,     ts, CONF_HAL);

    if (raw.ambientTemp != null) out.ambientTemp = sig(raw.ambientTemp, ts, CONF_HAL);

    if (raw.tpms != null && raw.tpms.length === 4) {
      out.tpms = sig(raw.tpms as number[], ts, CONF_HAL);
    }

    return out;
  }

  /* ── OBD-II → NormalizedVehicleData ─────────────────────────────────── */

  /**
   * OBD-II sinyallerini normalize eder.
   * Birimler OBD standardında; speed km/h, fuel %, rpm.
   * totalDistance varsa km olarak direkt alınır.
   *
   * @param raw  ObdAdapterData
   * @param ts   Ölçüm zamanı
   */
  static fromOBD(raw: ObdAdapterData, ts: number): NormalizedVehicleData {
    const out = _blankNormalized();

    if (raw.speed != null)         out.speed         = sig(raw.speed,         ts, CONF_OBD);
    if (raw.fuel  != null)         out.fuel          = sig(raw.fuel,          ts, CONF_OBD);
    if (raw.rpm   != null)         out.rpm           = sig(raw.rpm,           ts, CONF_OBD);
    if (raw.reverse != null)       out.reverse       = sig(raw.reverse,       ts, CONF_OBD);
    if (raw.totalDistance != null) out.totalDistance = sig(raw.totalDistance, ts, CONF_OBD);
    if (raw.coolantTemp != null)   out.coolantTemp   = sig(raw.coolantTemp,   ts, CONF_OBD);

    return out;
  }

  /* ── GPS → NormalizedVehicleData ────────────────────────────────────── */

  /**
   * Ham GPS verisini normalize eder.
   *
   * Birim dönüşümü (GpsAdapter.ts'den taşındı):
   *   speedMs (m/s) → speedKmh (km/h) = speedMs × 3.6
   *   Deadzone: < 0.8 km/h → 0 km/h (park/jitter bastırma)
   *
   * Güven: Doppler hız için GPS temel + hız büyüklüğüne göre ölçekleme.
   *        Konum için accuracy'ye göre azalan güven.
   *
   * @param raw  RawGpsData (m/s speed, heading, location)
   * @param ts   Ölçüm zamanı
   */
  static fromGPS(raw: RawGpsData, ts: number): NormalizedVehicleData {
    const out = _blankNormalized();
    const DEADZONE_KMH = 0.8;

    // ── Hız: m/s → km/h + deadzone ───────────────────────────────────────
    if (raw.speedMs != null) {
      const kmh = raw.speedMs * 3.6;
      const normalized = kmh < DEADZONE_KMH ? 0 : kmh;
      out.speed = sig(normalized, ts, _gpsSpeedConf(normalized));
    }

    // ── Yön ──────────────────────────────────────────────────────────────
    if (raw.heading != null) {
      out.heading = sig(raw.heading, ts, CONF_GPS);
    }

    // ── Konum: accuracy → confidence ─────────────────────────────────────
    if (raw.location != null) {
      const conf = _locationConf(raw.location.accuracy);
      out.location = sig(raw.location, ts, conf);
    }

    return out;
  }

  /* ── Yardımcı dönüşümler ─────────────────────────────────────────────── */

  /** m/s → km/h (ham dönüşüm, deadzone uygulamaz) */
  static mpsToKmh(mps: number): number { return mps * 3.6; }

  /** km/h → m/s */
  static kmhToMps(kmh: number): number { return kmh / 3.6; }

  /** psi → kPa */
  static psiToKpa(psi: number): number { return psi * 6.895; }

  /** °F → °C */
  static fToC(f: number): number { return (f - 32) / 1.8; }

  /**
   * Efektif güven: temel güven × tazelik faktörü.
   * Sinyal seçiminde (fusion) kullanılır.
   *
   * @param signal     IVehicleSignal<unknown>
   * @param timeoutMs  Bu kadar ms geçince sıfıra düşer
   */
  static effectiveConfidence(signal: IVehicleSignal<unknown>, timeoutMs: number): number {
    const age = Date.now() - signal.ts;
    const freshness = Math.max(0, 1 - age / timeoutMs);
    return signal.confidence * freshness;
  }
}
