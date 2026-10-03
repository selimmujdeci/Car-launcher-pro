/**
 * useVehicleAccess — `vehicleAccess` projeksiyonunu ekran açıkken periyodik okur.
 * Yeni depo DEĞİL: her okuma native durumu + store'u yeniden yorumlar. Sıfır sızıntı:
 * bileşen kapanınca zamanlayıcı durur.
 */
import { useEffect, useState } from 'react';
import { readVehicleAccess, type VehicleAccessState } from '../platform/vehicleDataLayer/vehicleAccess';

export const VEHICLE_ACCESS_POLL_MS = 5_000;

export function useVehicleAccess(): VehicleAccessState | null {
  const [state, setState] = useState<VehicleAccessState | null>(null);
  useEffect(() => {
    let alive = true;
    const tick = (): void => {
      void readVehicleAccess().then((s) => { if (alive) setState(s); }).catch(() => { /* fail-soft */ });
    };
    tick();
    const id = setInterval(tick, VEHICLE_ACCESS_POLL_MS);
    return () => { alive = false; clearInterval(id); };
  }, []);
  return state;
}
