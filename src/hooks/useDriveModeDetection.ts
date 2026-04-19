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
  // Auto drive mode — activate when speed > 15 km/h for 3 consecutive seconds
  const autoDriveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!settings.smartContextEnabled) return;
    const speedKmh = location?.speed != null ? location.speed * 3.6 : 0;
    if (speedKmh > 15) {
      if (!autoDriveTimerRef.current) {
        autoDriveTimerRef.current = setTimeout(() => { setDrivingMode(true); autoDriveTimerRef.current = null; }, 3000);
      }
    } else {
      if (autoDriveTimerRef.current) { clearTimeout(autoDriveTimerRef.current); autoDriveTimerRef.current = null; }
    }
    return () => {
      if (autoDriveTimerRef.current) { clearTimeout(autoDriveTimerRef.current); autoDriveTimerRef.current = null; }
    };
  }, [location?.speed, settings.smartContextEnabled]);
}
