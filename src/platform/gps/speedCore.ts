import { _haversineMeters } from './gpsMath';

/** Durağan araç jitter bastırma eşiği (km/h) — altındaki değerler 0 sayılır.
 *  0.8 km/h: trafik sürünmesi Doppler'den geçer; park/otopark GPS kaymasını bastırır. */
export const GPS_SPEED_DEADZONE_KMH = 0.8;
/** Bu süreden eski GPS fix'inden gelen hız kabul edilmez */
export const GPS_SPEED_MAX_AGE_MS   = 4000;
/** GPS Doppler spike / uydu lock jitter: bu değerin üstü fiziksel olarak imkansız */
export const GPS_SPEED_MAX_KMH      = 280;

/**
 * Ham GPS hızına deadzone + stale + spike filtresi uygular.
 * EMA kasıtlı olarak yok — Doppler hızı donanım seviyesinde filtreli;
 * yazılım EMA sadece gecikme ekler.
 *
 * @param rawSpeedMs Ham hız m/s (GPS Doppler veya delta hesabı)
 * @param dataAgeMs  Timestamp yaşı ms — GPS fix'in ne kadar eski olduğu
 * @returns Filtrelenmiş hız m/s, veya undefined (stale / spike)
 */
export function applySpeedFilters(
  rawSpeedMs: number,
  dataAgeMs: number,
): number | undefined {
  if (dataAgeMs > GPS_SPEED_MAX_AGE_MS) return undefined;

  const rawKmh = rawSpeedMs * 3.6;
  if (rawKmh > GPS_SPEED_MAX_KMH) return undefined;

  // Deadzone: durağan araç jitter'ı bastır, ama 0'a HEMEN düş (EMA yok)
  return (rawKmh < GPS_SPEED_DEADZONE_KMH ? 0 : rawKmh) / 3.6;
}

export interface PrevPosition {
  lat: number;
  lng: number;
  ts: number;
}

/**
 * İki konum arasındaki hızı Haversine delta ile hesaplar.
 * Tamamen saf — state mutasyonu yok; çağıran _prevForSpeed'i yönetir.
 *
 * @param lat   Mevcut enlem
 * @param lng   Mevcut boylam
 * @param ts    Mevcut timestamp (ms, genellikle Date.now())
 * @param prev  Bir önceki konum kaydı; ilk çağrıda null
 * @returns Hız m/s veya undefined (yetersiz dt veya ilk fix)
 */
export function computeSpeedDelta(
  lat: number,
  lng: number,
  ts: number,
  prev: PrevPosition | null,
): number | undefined {
  if (!prev) return undefined;
  const dt = (ts - prev.ts) / 1000; // saniye
  if (dt < 0.5 || dt > 10) return undefined;
  const distM = _haversineMeters(prev.lat, prev.lng, lat, lng);
  if (!Number.isFinite(distM)) return undefined;
  return distM / dt; // m/s
}
