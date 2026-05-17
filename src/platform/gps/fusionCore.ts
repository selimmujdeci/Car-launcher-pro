import { _haversineMeters } from './gpsMath';

export const FUSION_RAMP_MS        = 3_000; // DR→GPS geçiş yumuşatma süresi (ms)
export const JUMP_GUARD_METERS     = 100;   // maksimum kabul edilebilir fix atlama (m)
export const JUMP_GUARD_ACCURACY_M = 30;    // accuracy bu değerin üstündeyse jump guard aktif
/** GPS sessizlik eşiği — bu kadar ms geçince DR başlatılır */
export const DR_THRESHOLD_MS       = 2_000;
/** DR hız eşiği: 2 km/h (m/s) — durakta drift yok */
export const DR_MIN_SPEED_MS       = 2 / 3.6;

export interface FusedPosition {
  lat: number;
  lng: number;
}

/**
 * Jump Guard: gürültülü tünel çıkışı fix'ini reddeder.
 * accuracy > JUMP_GUARD_ACCURACY_M VE mesafe > JUMP_GUARD_METERS → fix noise'lu, geçersiz.
 * Pure — state mutasyonu yok.
 */
export function isJumpInvalid(
  prevLoc: { latitude: number; longitude: number },
  newCoords: { latitude: number; longitude: number; accuracy: number },
): boolean {
  if (newCoords.accuracy <= JUMP_GUARD_ACCURACY_M) return false;
  const jumpM = _haversineMeters(
    prevLoc.latitude, prevLoc.longitude,
    newCoords.latitude, newCoords.longitude,
  );
  return jumpM > JUMP_GUARD_METERS;
}

/**
 * DR→GPS geçiş rampa karışımı hesaplar (tünel çıkışı yumuşatma).
 * finalPos = drLastPos*(1-α) + newCoords*α  →  araç haritada "akarak" geçer, zıplamaz.
 *
 * @param elapsedMs   Geçiş başlangıcından bu yana geçen ms
 * @param drLastPos   DR'nin son bilinen konumu
 * @param newCoords   Yeni GPS fix koordinatları
 * @returns           Füzyonlanmış konum, veya null (ramp tamamlandı — çağıran state'i sıfırlamalı)
 */
export function calculateFusionRamp(
  elapsedMs: number,
  drLastPos: FusedPosition,
  newCoords: { latitude: number; longitude: number },
): FusedPosition | null {
  if (elapsedMs >= FUSION_RAMP_MS) return null;
  const alpha = elapsedMs / FUSION_RAMP_MS;
  return {
    lat: drLastPos.lat * (1 - alpha) + newCoords.latitude  * alpha,
    lng: drLastPos.lng * (1 - alpha) + newCoords.longitude * alpha,
  };
}
