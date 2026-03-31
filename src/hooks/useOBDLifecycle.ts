import { useEffect, useRef } from 'react';
import { showToast } from '../platform/errorBus';
import type { OBDData } from '../platform/obdService';
import type { GPSLocation } from '../platform/gpsService';
import type { AppSettings } from '../store/useStore';
import type { ParkingLocation } from '../store/useStore';

interface UseOBDLifecycleParams {
  obd: OBDData;
  location: GPSLocation | null;
  settings: AppSettings;
  updateSettings: (partial: Partial<AppSettings>) => void;
  updateParking: (location: ParkingLocation | null) => void;
}

export function useOBDLifecycle({
  obd,
  location,
  settings,
  updateSettings,
  updateParking,
}: UseOBDLifecycleParams): void {
  // OBD connection state toast notifications
  useEffect(() => {
    const state = obd.connectionState;
    if (state === 'error') {
      showToast({ type: 'error', title: 'OBD Bağlantı Hatası', message: 'Simüle veri kullanılıyor.', duration: 5000 });
    } else if (state === 'reconnecting') {
      showToast({ type: 'warning', title: 'OBD Yeniden Bağlanıyor...', duration: 4000 });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [obd.connectionState]);

  // Park location — save when RPM drops to 0
  const lastRpmRef = useRef(0);
  useEffect(() => {
    if (lastRpmRef.current > 0 && obd.rpm === 0 && location) {
      updateParking({ lat: location.latitude, lng: location.longitude, timestamp: Date.now() });
    }
    lastRpmRef.current = obd.rpm;
  }, [obd.rpm, location, updateParking]);

  // OBD auto sleep — RPM=0 → sleep after N minutes; RPM>0 → wake up
  useEffect(() => {
    if (!settings.obdAutoSleep) return;
    if (obd.rpm > 0) {
      if (settings.sleepMode) updateSettings({ sleepMode: false });
      return;
    }
    // RPM = 0 and not yet in sleep mode → start countdown
    if (settings.sleepMode) return;
    const timer = setTimeout(
      () => updateSettings({ sleepMode: true }),
      settings.obdSleepDelayMin * 60_000,
    );
    return () => clearTimeout(timer);
  }, [obd.rpm, settings.obdAutoSleep, settings.sleepMode, settings.obdSleepDelayMin, updateSettings]);
}
