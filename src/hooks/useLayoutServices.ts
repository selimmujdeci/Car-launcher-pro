import { useEffect } from 'react';
import { startVehicleDetection, stopVehicleDetection } from '../platform/vehicleProfileService';
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
import { startWeatherService, stopWeatherService, setWeatherFallback, feedGPSLocation } from '../platform/weatherService';
import { startSpeedLimitService, stopSpeedLimitService } from '../platform/speedLimitService';
import {
  setBrightness,
  startHeadlightAutoBrightness, stopHeadlightAutoBrightness,
} from '../platform/systemSettingsService';
import { startGPSTracking, stopGPSTracking, feedBackgroundLocation } from '../platform/gpsService';
import { startOBD, stopOBD, setObdFuelConfig } from '../platform/obdService';
import { startWifiService, stopWifiService } from '../platform/wifiService';
import { isNative } from '../platform/bridge';
import { CarLauncher } from '../platform/nativePlugin';
import { showToast } from '../platform/errorBus';
import { logError } from '../platform/crashLogger';
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
  // GPS tracking — tek merkezden başlat/durdur
  useEffect(() => {
    startGPSTracking().catch((e: unknown) => {
      logError('useLayoutServices:startGPSTracking', e);
    });
    return () => {
      stopGPSTracking().catch((e: unknown) => {
        logError('useLayoutServices:stopGPSTracking', e);
      });
    };
  }, []);

  // OBD — tek merkezden başlat/durdur; bileşenler sadece useOBDState() ile abone olur
  useEffect(() => {
    startOBD();
    return () => { stopOBD(); };
  }, []);

  // OBD yakıt konfigürasyonu — aktif araç profili değiştiğinde güncelle
  // Fix 5: ham fuelLevel % → fuelRemainingL + estimatedRangeKm hesabı için gerekli
  const { settings: storeSettings } = useStore();
  useEffect(() => {
    const profile = storeSettings.vehicleProfiles.find(
      (p) => p.id === storeSettings.activeVehicleProfileId,
    );
    setObdFuelConfig(
      profile?.fuelTankL        ?? 0,
      profile?.avgConsumptionL100 ?? 8.0, // varsayılan: 8 L/100 km
      profile?.obdDeviceAddress,          // Fix 3: bilinen MAC → scan atla
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeSettings.activeVehicleProfileId, storeSettings.vehicleProfiles]);

  // Wake word
  useEffect(() => {
    if (settings.wakeWordEnabled) enableWakeWord(settings.wakeWord ?? 'hey car');
    else disableWakeWord();
    return () => { disableWakeWord(); };
  }, [settings.wakeWordEnabled, settings.wakeWord]);

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

  // Android 12+ / 13+ runtime izinleri — bildirim + Bluetooth (native only, once)
  useEffect(() => {
    if (!isNative) return;
    CarLauncher.requestAndroid13Permissions().catch((e: unknown) => {
      logError('useLayoutServices:requestAndroid13Permissions', e);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Background GPS service + break reminder (native only, once)
  useEffect(() => {
    if (!isNative) return;
    CarLauncher.startBackgroundService().catch((e: unknown) => {
      logError('useLayoutServices:startBackgroundService', e);
      showToast({ type: 'warning', title: 'Arka Plan GPS', message: 'Foreground servis başlatılamadı.', duration: 5000 });
    });

    // Handle'ları önce null ile tanımla; cleanup her zaman güvenli çalışsın
    let handle:      { remove(): void } | null = null;
    let breakHandle: { remove(): void } | null = null;
    // Unmount sinyali — promise resolve'dan önce cleanup çalışırsa remove'u çağır
    let unmounted = false;

    CarLauncher.addListener('backgroundLocation', (loc) => {
      feedBackgroundLocation(loc);
      if (settings.autoBrightnessEnabled) updateAutoBrightnessLocation(loc.lat, loc.lng);
      updateTrafficLocation(loc.lat);
    }).then((h) => {
      if (unmounted) { h.remove(); return; }
      handle = h;
    }).catch((e: unknown) => {
      logError('useLayoutServices:backgroundLocation', e);
    });

    CarLauncher.addListener('breakReminder', () => {
      if (settings.breakReminderEnabled) {
        showToast({ type: 'warning', title: 'Mola Zamanı', message: '2 saattir kesintisiz sürüş yapıyorsunuz.', duration: 0 });
      }
    }).then((h) => {
      if (unmounted) { h.remove(); return; }
      breakHandle = h;
    }).catch((e: unknown) => {
      logError('useLayoutServices:breakReminder', e);
    });

    return () => {
      unmounted = true;
      handle?.remove();
      breakHandle?.remove();
      CarLauncher.stopBackgroundService().catch((e: unknown) => {
        logError('useLayoutServices:stopBackgroundService', e);
      });
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Wifi service
  useEffect(() => { startWifiService(); return () => { stopWifiService(); }; }, []);

  // Araç profil algılama
  useEffect(() => {
    startVehicleDetection();
    return () => { stopVehicleDetection(); };
  }, []);

  // Traffic service startup (bir kez) + ilk konum ile başlat
  useEffect(() => {
    startTrafficService(location?.latitude);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Konum değiştiğinde trafik servisini güncelle
  useEffect(() => {
    if (location?.latitude) updateTrafficLocation(location.latitude);
  }, [location?.latitude]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // GPS konumunu weather servisine besle — Android native GPS doğruluğu için kritik
  // weatherService.ts kendi navigator.geolocation'ını kullanmaz; gpsService'ten beslenmelidir
  useEffect(() => {
    if (location?.latitude && location?.longitude) {
      feedGPSLocation(location.latitude, location.longitude);
    }
  }, [location?.latitude, location?.longitude]);

  // Weather fallback city (GPS yokken kullanılacak kullanıcı şehri)
  useEffect(() => {
    if (settings.weatherFallbackCity) {
      setWeatherFallback(settings.weatherFallbackCity.lat, settings.weatherFallbackCity.lng);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.weatherFallbackCity?.lat, settings.weatherFallbackCity?.lng]);

  // Speed limit, trip log, notifications, weather, brightness, headlight auto brightness
  useEffect(() => {
    initializeAddressBook().catch((e: unknown) => {
      logError('useLayoutServices:initializeAddressBook', e);
    });
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
