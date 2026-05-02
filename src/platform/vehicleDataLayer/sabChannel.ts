/**
 * sabChannel — SharedArrayBuffer UI Köprüsü
 *
 * VehicleSignalResolver SAB'ı oluşturduğunda initSABChannel() çağırır.
 * Gauge bileşenleri bu modülü import ederek SAB dizilerine doğrudan erişir.
 *
 * Layout (Worker ile senkron — VehicleCompute.worker.ts ile aynı sabitler):
 *   Float64[0] = speed (km/h)
 *   Float64[1] = rpm
 *   Float64[2] = fuel (%)
 *   Float64[3] = odometer (km)
 *   Float64[4] = reverse (0/1)
 *   Int32[12]  = generation counter (Atomics.store ile artar)
 */

export const SAB_IDX = {
  SPEED:   0,
  RPM:     1,
  FUEL:    2,
  ODO:     3,
  REVERSE: 4,
} as const;

export const SAB_GEN_IDX = 12; // Int32 indeksi (byte 48)

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
