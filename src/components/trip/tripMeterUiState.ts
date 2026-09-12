/**
 * tripMeterUiState.ts — TripMeterRow'un SAF UI faz makinesi (AŞAMA B).
 *
 * SAF: I/O yok · timer yok · React importu YOK · global durum yok. Bu proje
 * `@testing-library/react` KULLANMAZ ve jsdom'da `react-dom/client` createRoot
 * çalışmaz (bkz. `safetyContext.test.tsx`, `carosLabActionAuthority.test.tsx`)
 * — bu yüzden etkileşimli davranış (buton bas → onay çıkar → VAZGEÇ/SIFIRLA)
 * React render'ı olmadan, doğrudan bu saf faz geçişleriyle test edilir.
 *
 * KURAL: MODAL/POPUP YOK — "onay" yalnızca `phase === 'confirm'` durumudur,
 * kartın kendi içinde satır içi (inline) gösterilir.
 */

import { canResetTripMeter } from '../../platform/trip/tripMeterModel';

export type TripMeterUiPhase = 'idle' | 'confirm';

/** Reset butonuna basıldı. Hareket hâlinde/hız bilinmiyorsa (fail-closed) hiçbir şey açılmaz. */
export function tripMeterUiPressReset(phase: TripMeterUiPhase, speedKmh: number | null): TripMeterUiPhase {
  if (phase === 'confirm') return phase;
  return canResetTripMeter(speedKmh).allowed ? 'confirm' : 'idle';
}

/** `VAZGEÇ` — onayı kapatır, reset ÇAĞRILMAZ. */
export function tripMeterUiCancel(_phase: TripMeterUiPhase): TripMeterUiPhase {
  return 'idle';
}

/** `SIFIRLA` sonrası — onay kapanır (reset çağrısı bileşende ayrıca yapılır). */
export function tripMeterUiConfirmed(_phase: TripMeterUiPhase): TripMeterUiPhase {
  return 'idle';
}

/**
 * Hız değişti. Onay AÇIKKEN araç hareket etmeye başlarsa (veya hız bilinmez
 * hâle gelirse) onay kendiliğinden kapanır — reset YAPILMAZ. `idle` fazında
 * hız değişimi hiçbir şeyi etkilemez (buton zaten her render'da yeniden
 * gate'lenir).
 */
export function tripMeterUiSpeedChanged(phase: TripMeterUiPhase, speedKmh: number | null): TripMeterUiPhase {
  if (phase !== 'confirm') return phase;
  return canResetTripMeter(speedKmh).allowed ? phase : 'idle';
}
