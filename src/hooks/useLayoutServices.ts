import { useEffect } from 'react';
import { enableWakeWord, disableWakeWord } from '../platform/wakeWordService';
import { startTrafficService, updateTrafficLocation } from '../platform/trafficService';
import { initializeContacts } from '../platform/contactsService';
import {
  startAutoBrightness, stopAutoBrightness, updateAutoBrightnessLocation,
} from '../platform/autoBrightnessService';
import { startTripLog } from '../platform/tripLogService';
import {
  startNotificationService, stopNotificationService,
} from '../platform/notificationService';
import { startWeatherService, stopWeatherService } from '../platform/weatherService';
import { startSpeedLimitService, stopSpeedLimitService } from '../platform/speedLimitService';
import {
  setBrightness,
  startHeadlightAutoBrightness, stopHeadlightAutoBrightness,
} from '../platform/systemSettingsService';
import { feedBackgroundLocation } from '../platform/gpsService';
import { startWifiService, stopWifiService } from '../platform/wifiService';
import { isNative } from '../platform/bridge';
import { CarLauncher } from '../platform/nativePlugin';
import { showToast } from '../platform/errorBus';
import { initializeAddressBook } from '../platform/addressBookService';
import { useStore } from '../store/useStore';
import type { GPSLocation } from '../platform/gpsService';
import type { AppSettings } from '../store/useStore';

interface UseLayoutServicesParams {
  settings: AppSettings;
  updateSettings: (partial: Partial<AppSettings>) => void;
  location: GPSLocation | null;
}

export function useLayoutServices({
  settings,
  updateSettings,
  location,
}: UseLayoutServicesParams): void {
  // Wake word
  useEffect(() => {
    if (settings.wakeWordEnabled) enableWakeWord(settings.wakeWord ?? 'hey car');
    else disableWakeWord();
    return () => { disableWakeWord(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.wakeWordEnabled]);

  // Contacts
  useEffect(() => { initializeContacts(); }, []);

  // GPS warning (native only, once)
  useEffect(() => {
    if (!location && isNative) {
      const t = setTimeout(() => {
        showToast({ type: 'warning', title: 'GPS İzni Gerekli', message: 'Konum izni verilmeden harita ve navigasyon çalışmaz.', duration: 8000 });
      }, 5000);
      return () => clearTimeout(t);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Background GPS service + break reminder (native only, once)
  useEffect(() => {
    if (!isNative) return;
    CarLauncher.startBackgroundService().catch(() => {
      showToast({ type: 'warning', title: 'Arka Plan GPS', message: 'Foreground servis başlatılamadı.', duration: 5000 });
    });
    let handle:      { remove(): void } | null = null;
    let breakHandle: { remove(): void } | null = null;
    CarLauncher.addListener('backgroundLocation', (loc) => {
      feedBackgroundLocation(loc);
      if (settings.autoBrightnessEnabled) updateAutoBrightnessLocation(loc.lat, loc.lng);
      updateTrafficLocation(loc.lat);
    }).then((h) => { handle = h; }).catch(() => undefined);
    CarLauncher.addListener('breakReminder', () => {
      if (settings.breakReminderEnabled) {
        showToast({ type: 'warning', title: 'Mola Zamanı', message: '2 saattir kesintisiz sürüş yapıyorsunuz.', duration: 0 });
      }
    }).then((h) => { breakHandle = h; }).catch(() => undefined);
    return () => {
      handle?.remove();
      breakHandle?.remove();
      CarLauncher.stopBackgroundService().catch(() => undefined);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Wifi service
  useEffect(() => { startWifiService(); return () => { stopWifiService(); }; }, []);

  // Traffic service startup + location updates
  useEffect(() => { startTrafficService(location?.latitude); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (location?.latitude) updateTrafficLocation(location.latitude); }, [location?.latitude]);

  // Auto brightness start/stop
  useEffect(() => {
    if (settings.autoBrightnessEnabled && location?.latitude) {
      startAutoBrightness({
        lat: location.latitude, lng: location.longitude,
        onThemeChange: settings.autoThemeEnabled ? (theme) => updateSettings({ theme }) : undefined,
      });
    } else {
      stopAutoBrightness();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.autoBrightnessEnabled, settings.autoThemeEnabled]);

  // Auto brightness location update
  useEffect(() => {
    if (settings.autoBrightnessEnabled && location?.latitude) {
      updateAutoBrightnessLocation(location.latitude, location.longitude);
    }
  }, [location?.latitude, location?.longitude, settings.autoBrightnessEnabled]);

  // Speed limit, trip log, notifications, weather, brightness, headlight auto brightness
  useEffect(() => {
    initializeAddressBook().catch(() => undefined);
    startSpeedLimitService();
    startTripLog();
    startNotificationService();
    startWeatherService();
    setBrightness(useStore.getState().settings.brightness);
    startHeadlightAutoBrightness(() => useStore.getState().settings.brightness);
    return () => {
      stopSpeedLimitService();
      stopNotificationService();
      stopWeatherService();
      stopHeadlightAutoBrightness();
    };
  }, []);
}
