/**
 * signalsAvailability — Safety Assistant FAZ 4B
 *
 * Hangi opsiyonel CAN sinyalinin BU araçta gerçekten mevcut olduğunu türetir.
 * Kaynak: VehicleHandshake profili (desteklenen sinyaller) + ProfileSignalGate
 * safeMode durumu. Mapper'ın signalsAvailable gating'ini besler (seatbelt/headlights).
 *
 * NEDEN sadece profil + safeMode:
 *   Store'da per-CAN-sinyal arrival timestamp YOK; zaman-bazlı staleness için ek
 *   izleme gerekir (CAN akışına dokunmak → kapsam dışı). Bunun yerine:
 *     - Handshake yok / düşük confidence → safeMode → tüm opsiyonel sinyaller
 *       unavailable (güvenli varsayılan, reset-safe).
 *     - Profil bu sinyali decode etmiyorsa → unavailable (yanlış-alarm önlemi).
 *   Zaman-bazlı per-frame staleness bu fazda KAPSAM DIŞI (bkz. PROJECT_STATE).
 *
 * seatbelt/headlights false→alarm üreten kurallardır; bu yüzden yalnızca araçta
 * gerçekten mevcutsa (profil destekliyor + safeMode değil) aktif edilir.
 */

import { isGateSafeMode, getActiveProfileSignalNames } from '../canBus/ProfileSignalGate';

/** Mapper signalsAvailable ile yapısal uyumlu — false→alarm sinyalleri. */
export interface SafetySignalsAvailable {
  seatbelt: boolean;
  headlights: boolean;
}

/**
 * Saf türetim: gate durumundan signalsAvailable hesaplar.
 *
 * @param safeMode       - ProfileSignalGate safe mode (handshake yok/güvenilmez).
 * @param profileSignals - Aktif profilin desteklediği CAN sinyal adları.
 */
export function computeSignalsAvailable(
  safeMode: boolean,
  profileSignals: ReadonlySet<string>,
): SafetySignalsAvailable {
  // Safe mode → bilinmeyen/güvenilmez araç → hepsi unavailable (güvenli).
  if (safeMode) {
    return { seatbelt: false, headlights: false };
  }
  return {
    seatbelt:   profileSignals.has('seatbelt'),
    headlights: profileSignals.has('headlights'),
  };
}

/**
 * Anlık gate durumundan signalsAvailable türetir (SafetyProvider çağırır).
 */
export function deriveSignalsAvailable(): SafetySignalsAvailable {
  return computeSignalsAvailable(isGateSafeMode(), getActiveProfileSignalNames());
}
