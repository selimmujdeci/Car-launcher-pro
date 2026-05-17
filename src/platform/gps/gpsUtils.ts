import { _haversineMeters } from './gpsMath';

export const LAST_KNOWN_KEY        = 'car-gps-last-known';
/** localStorage yazma throttle: 2 Hz GPS → max 5s'de-bir yaz */
export const SAVE_LAST_KNOWN_MS    = 5_000;
/** Geofence kontrolü zaman eşiği */
export const GEOFENCE_THROTTLE_MS  = 5_000;
/** Geofence kontrolü mesafe eşiği (metre) */
export const GEOFENCE_THROTTLE_METERS = 10;
/** İlk fix için bekleme süresi — sonrasında unavailable olarak işaretle */
export const GPS_FIRST_FIX_MS      = 5_000;

/**
 * localStorage kayıt için yeterli süre geçip geçmediğini döner.
 * Batarya & I/O dostu: yüksek frekanslı GPS fix'lerini throttle eder.
 */
export function shouldSaveLastKnown(lastSavePerf: number, currentPerf: number): boolean {
  return currentPerf - lastSavePerf >= SAVE_LAST_KNOWN_MS;
}

/**
 * Geofence kontrolü tetiklenip tetiklenmeyeceğini döner.
 * Zaman (5s) VEYA mesafe (10m) eşiklerinden biri aşıldığında true döner.
 * lastCheckPos null ise ilk kontrol sayılır → true.
 */
export function shouldCheckGeofence(
  lastCheckPos: { lat: number; lng: number } | null,
  currentPos:   { lat: number; lng: number },
  lastCheckTime: number,
  currentTime:   number,
): boolean {
  if (currentTime - lastCheckTime >= GEOFENCE_THROTTLE_MS) return true;
  if (!lastCheckPos) return true;
  return _haversineMeters(lastCheckPos.lat, lastCheckPos.lng, currentPos.lat, currentPos.lng)
    >= GEOFENCE_THROTTLE_METERS;
}

/**
 * Capacitor native platform tespiti.
 * window.Capacitor global'i üzerinden çalışır — native Android/iOS'ta true döner.
 */
export function isNativePlatform(): boolean {
  try {
    const cap = window.Capacitor;
    return typeof cap?.isNativePlatform === 'function' && cap.isNativePlatform();
  } catch {
    return false;
  }
}
