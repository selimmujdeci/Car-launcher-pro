/**
 * overspeedWarningRuntime — hız sınırı aşımının TEK SEFERLİK sesli uyarısı.
 *
 * Karar `core/overspeedModel`de (saf). Defter MODÜL düzeyindedir: hook kaç
 * yerde çağrılırsa çağrılsın aynı sınır için ikinci anons YOKTUR.
 * Girdi: gösterilen hız (`useDisplaySpeed` — OBD/CAN/GPS füzyonu) ve
 * gösterilebilir etkin sınır (`useEffectiveSpeedLimit` — rota/OSM + araç sınıfı).
 * Yeni zamanlayıcı YOK: hız/sınır değiştikçe değerlendirilir.
 */
import { useEffect } from 'react';
import { speakNavigation } from '../ttsService';
import { useDisplaySpeed } from '../../hooks/useDisplaySpeed';
import { useEffectiveSpeedLimit } from './useEffectiveSpeedLimit';
import { isEffectiveLimitDisplayable } from './core/vehicleAwareSpeedLimitAuthority';
import { EMPTY_OVERSPEED_LEDGER, stepOverspeed, type OverspeedLedger } from './core/overspeedModel';

let _ledger: OverspeedLedger = EMPTY_OVERSPEED_LEDGER;
let _warnings = 0;

/** Bir örnek işler; anons yapıldıysa metni döndürür. */
export function noteOverspeedSample(
  speedKmh: number | null, limitKmh: number | null, nowMs: number,
  speak: (t: string) => void = speakNavigation,
): string | null {
  const r = stepOverspeed(_ledger, speedKmh, limitKmh, nowMs);
  _ledger = r.ledger;
  if (r.speak) {
    _warnings++;
    try { speak(r.speak); } catch { /* TTS yoksa sessiz */ }
  }
  return r.speak;
}

/** Salt-okunur gözlem (LAB). */
export function getOverspeedWarningSnapshot(): { readonly ledger: OverspeedLedger; readonly warnings: number } {
  return { ledger: _ledger, warnings: _warnings };
}

/** @internal testler için. */
export function _resetOverspeedWarningForTest(): void { _ledger = EMPTY_OVERSPEED_LEDGER; _warnings = 0; }

/** Uygulama düzeyinde BİR KEZ bağlanır (useLayoutServices). */
export function useOverspeedWarning(): void {
  const speed = useDisplaySpeed();
  const limit = useEffectiveSpeedLimit();
  const shownLimit = isEffectiveLimitDisplayable(limit) ? limit.effectiveLimitKmh : null;
  useEffect(() => {
    try { noteOverspeedSample(speed, shownLimit, performance.now()); } catch { /* fail-soft */ }
  }, [speed, shownLimit]);
}
