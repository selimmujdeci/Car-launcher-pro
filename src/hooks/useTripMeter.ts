/**
 * useTripMeter — RESETLENEBİLİR YOL SAYACI için React köprüsü.
 *
 * Tüm mantık `platform/trip/tripMeterService.ts` içindedir (persist + tek
 * abonelik); bu hook yalnız snapshot'ı React state'ine yansıtır. Timer YOK,
 * reset burada ÇAĞRILMAZ — yalnız `requestTripMeterReset` dışa verilir.
 */

import { useEffect, useRef, useState } from 'react';
import {
  getTripMeterSnapshot, subscribeTripMeter, requestTripMeterReset,
  type TripMeterSnapshot, type TripMeterResetResult,
} from '../platform/trip/tripMeterService';

export type { TripMeterSnapshot, TripMeterResetResult } from '../platform/trip/tripMeterService';

export interface UseTripMeterResult extends TripMeterSnapshot {
  readonly requestReset: () => TripMeterResetResult;
}

export function useTripMeter(): UseTripMeterResult {
  const mountedRef = useRef(false);
  const [snapshot, setSnapshot] = useState<TripMeterSnapshot>(() => getTripMeterSnapshot());

  useEffect(() => {
    mountedRef.current = true;
    setSnapshot(getTripMeterSnapshot());

    const unsub = subscribeTripMeter((s) => {
      if (mountedRef.current) setSnapshot(s);
    });

    return () => {
      mountedRef.current = false;
      unsub();
    };
  }, []);

  return { ...snapshot, requestReset: requestTripMeterReset };
}
