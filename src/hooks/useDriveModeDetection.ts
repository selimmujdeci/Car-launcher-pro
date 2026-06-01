import { useEffect, useRef } from 'react';
import { setDrivingMode } from '../platform/mapService';
import type { GPSLocation } from '../platform/gpsService';
import type { AppSettings } from '../store/useStore';

interface UseDriveModeDetectionParams {
  location: GPSLocation | null;
  settings: AppSettings;
}

export function useDriveModeDetection({
  location,
  settings,
}: UseDriveModeDetectionParams): void {
  // Aktivasyon: hız > 15 km/h için 3 saniye stabilite → setDrivingMode(true)
  const activateTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Deaktivasyon hysteresis: hız ≤ 15 km/h için 2 saniye stabilite → setDrivingMode(false)
  // Stop-and-go trafikte kısa yavaşlamalarda mod geçişini engeller.
  const deactivateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!settings.smartContextEnabled) return;
    const speedKmh = location?.speed != null ? location.speed * 3.6 : 0;

    if (speedKmh > 15) {
      // Hız eşiğin üzerinde — deaktivasyon timer'ını iptal et
      if (deactivateTimerRef.current) { clearTimeout(deactivateTimerRef.current); deactivateTimerRef.current = null; }
      // Aktivasyon timer'ı yoksa başlat
      if (!activateTimerRef.current) {
        activateTimerRef.current = setTimeout(() => {
          setDrivingMode(true);
          activateTimerRef.current = null;
        }, 3000);
      }
    } else {
      // Hız eşiğin altında — aktivasyon timer'ını iptal et
      if (activateTimerRef.current) { clearTimeout(activateTimerRef.current); activateTimerRef.current = null; }
      // Deaktivasyon timer'ı yoksa 2s hysteresis ile başlat
      if (!deactivateTimerRef.current) {
        deactivateTimerRef.current = setTimeout(() => {
          setDrivingMode(false);
          deactivateTimerRef.current = null;
        }, 2000);
      }
    }

    return () => {
      if (activateTimerRef.current)   { clearTimeout(activateTimerRef.current);   activateTimerRef.current   = null; }
      if (deactivateTimerRef.current) { clearTimeout(deactivateTimerRef.current); deactivateTimerRef.current = null; }
    };
  }, [location?.speed, settings.smartContextEnabled]);
}
