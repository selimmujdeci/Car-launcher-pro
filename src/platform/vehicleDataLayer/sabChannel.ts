/**
 * sabChannel — SharedArrayBuffer UI Köprüsü
 *
 * VehicleSignalResolver SAB'ı oluşturduğunda initSABChannel() çağırır.
 * Gauge bileşenleri bu modülü import ederek SAB dizilerine doğrudan erişir.
 *
 * Layout (Worker + Resolver ile senkron — CACHE-LINE PADDING + SEQLOCK):
 *   Her 64-bit değer AYRI 64-byte cache line'da → CPU "False Sharing" yok.
 *   (8 Float64 slot = 64 byte aralık.)
 *     Float64[0]  = speed (km/h)      byte 0
 *     Float64[8]  = rpm               byte 64
 *     Float64[16] = fuel (%)          byte 128
 *     Float64[24] = odometer (km)     byte 192
 *     Float64[32] = reverse (0/1)     byte 256
 *     Float64[40] = lastUpdateTs      byte 320 (Worker-only)
 *     Int32[96]   = generation counter byte 384 — AYRI cache line (veriden uzak)
 *
 *   Seqlock: GEN tek=yazım sürüyor, çift=yazım bitti. Okuyucu baş/son GEN
 *   karşılaştırıp Torn Read'i tespit eder. SAB_BYTES = 512.
 */

export const SAB_IDX = {
  SPEED:   0,
  RPM:     8,
  FUEL:    16,
  ODO:     24,
  REVERSE: 32,
} as const;

export const SAB_GEN_IDX = 96; // Int32 indeksi (byte 384) — ayrı cache line

export interface SABChannel {
  f64: Float64Array | null;
  i32: Int32Array   | null;
}

/** Modül düzeyi singleton — tüm gauge bileşenleri bu referansı paylaşır. */
export const sabChannel: SABChannel = { f64: null, i32: null };

/** VehicleSignalResolver.start() tarafından SAB oluşturulunca çağrılır. */
export function initSABChannel(f64: Float64Array, i32: Int32Array): void {
  sabChannel.f64 = f64;
  sabChannel.i32 = i32;
}

/** VehicleSignalResolver.stop() tarafından çağrılır. */
export function clearSABChannel(): void {
  sabChannel.f64 = null;
  sabChannel.i32 = null;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Vision / AR SAB — İkinci Kanal
   VisionCompute.worker → ana thread zero-copy AR veri köprüsü.

   Layout (48 bytes, 6 × Float64 + Int32 generation counter):
     Float64[0] = lateralOffsetM   (şerit orta kayması, metre; NaN=bilinmiyor)
     Float64[1] = laneConfidence   (0.0–1.0)
     Float64[2] = leftLaneX2       (işleme canvas px, mevcut değilse -1)
     Float64[3] = rightLaneX2      (işleme canvas px, mevcut değilse -1)
     Float64[4] = signType         (0=yok, 1=speed_limit)
     Float64[5] = signValue        (hız değeri km/h; 0=bilinmiyor)
     Int32[12]  = generation counter (Atomics.store → AR bileşeni yeni veriyi yakalar)
   ════════════════════════════════════════════════════════════════════════ */

export const VSAB_IDX = {
  LATERAL_OFFSET:   0,
  LANE_CONFIDENCE:  1,
  LEFT_LANE_X2:     2,
  RIGHT_LANE_X2:    3,
  SIGN_TYPE:        4,
  SIGN_VALUE:       5,
} as const;

export const VSAB_GEN_IDX = 12; // Int32 index at byte 48

export interface VisionSABChannel {
  f64: Float64Array | null;
  i32: Int32Array   | null;
}

export const visionSabChannel: VisionSABChannel = { f64: null, i32: null };

/**
 * Vision SAB kanalını başlatır.
 * VisionCore.startVision() sırasında crossOriginIsolated=true ortamında çağrılır.
 * @param sab  En az 128 byte SharedArrayBuffer
 */
export function initVisionSAB(sab: SharedArrayBuffer): void {
  visionSabChannel.f64 = new Float64Array(sab);
  visionSabChannel.i32 = new Int32Array(sab);
}

/** VisionCore.stopVision() tarafından çağrılır. */
export function clearVisionSAB(): void {
  visionSabChannel.f64 = null;
  visionSabChannel.i32 = null;
}

/**
 * VisionFrame sonucunu Vision SAB'a yazar.
 * Ana thread'de VisionCompute worker mesajı alınca çağrılır.
 * crossOriginIsolated=false ortamında no-op (SAB kullanılamaz).
 */
export function writeVisionSAB(
  lateralOffsetM: number | null,
  laneConfidence: number,
  leftLaneX2:     number,
  rightLaneX2:    number,
  signType:       number,
  signValue:      number,
  gen:            number,
): void {
  const f64 = visionSabChannel.f64;
  const i32 = visionSabChannel.i32;
  if (!f64 || !i32) return;

  f64[VSAB_IDX.LATERAL_OFFSET]  = lateralOffsetM ?? NaN;
  f64[VSAB_IDX.LANE_CONFIDENCE] = laneConfidence;
  f64[VSAB_IDX.LEFT_LANE_X2]   = leftLaneX2;
  f64[VSAB_IDX.RIGHT_LANE_X2]  = rightLaneX2;
  f64[VSAB_IDX.SIGN_TYPE]       = signType;
  f64[VSAB_IDX.SIGN_VALUE]      = signValue;
  Atomics.store(i32, VSAB_GEN_IDX, (gen + 1) | 0);
}
