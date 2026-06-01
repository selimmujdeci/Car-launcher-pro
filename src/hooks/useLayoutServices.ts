import { useEffect } from 'react';
import { initFcmService }           from '../platform/fcmService';
import { initConnectivityService }  from '../platform/connectivityService';
import { startVehicleDetection, stopVehicleDetection } from '../platform/vehicleProfileService';
import { enableWakeWord, disableWakeWord } from '../platform/wakeWordService';
import { startTrafficService, stopTrafficService, updateTrafficLocation } from '../platform/trafficService';
import { initializeContacts } from '../platform/contactsService';
import { startMediaHub } from '../platform/mediaService';
import {
  startAutoBrightness, stopAutoBrightness, updateAutoBrightnessLocation,
} from '../platform/autoBrightnessService';
import { startTripLog, stopTripLog } from '../platform/tripLogService';
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
import { updateDeviceStatus } from '../platform/deviceApi';
import { logError } from '../platform/crashLogger';
import { initializeAddressBook } from '../platform/addressBookService';
import { useStore } from '../store/useStore';
import { useShallow } from 'zustand/react/shallow';
import type { GPSLocation } from '../platform/gpsService';
import type { AppSettings } from '../store/useStore';
import { startThermalWatchdog, stopThermalWatchdog } from '../platform/thermalWatchdog';
import { runtimeManager }                    from '../core/runtime/AdaptiveRuntimeManager';
import { RuntimeMode }                       from '../core/runtime/runtimeTypes';

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
  // Adaptive Runtime Engine — ThermalWatchdog + store override sync
  useEffect(() => {
    startThermalWatchdog();
    return () => { stopThermalWatchdog(); };
  }, []);

  useEffect(() => {
    const override = settings.runtimeOverride;
    if (override !== 'AUTO') {
      runtimeManager.setMode(override as RuntimeMode, 'user');
    }
    // 'AUTO' → açılışta _detectCapabilities() zaten doğru modu belirledi
  }, [settings.runtimeOverride]);

  // Connectivity Service — çevrimdışı kuyruk başlat
  useEffect(() => {
    void initConnectivityService();
  }, []);

  // FCM Push-to-Wake — token kayıt ve push dinleyici
  useEffect(() => {
    let cleanup: (() => void) | undefined;
    initFcmService().then((fn) => { cleanup = fn; });
    return () => cleanup?.();
  }, []);

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
  // Narrow selector: çıplak useStore() MainLayout'un useShallow optimizasyonunu bozuyordu
  // (her smartCard/runtime güncellemesinde MainLayout re-render). Sadece bu effect'in
  // ihtiyaç duyduğu 2 alana abone ol.
  const storeSettings = useStore(useShallow((s) => ({
    vehicleProfiles:        s.settings.vehicleProfiles,
    activeVehicleProfileId: s.settings.activeVehicleProfileId,
  })));
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

  // Media polling — uygulama başlangıcında bir kez başlat (idempotent)
  useEffect(() => { startMediaHub().catch(() => {}); }, []);

  // GPS warning (native only, once)
  // Sahte bildirim koruması: location null olabilir çünkü GPS fix bekliyordur (tünel/garaj).
  // Gerçek izin durumu KONTROL edilmediyse toast atma.
  useEffect(() => {
    if (!isNative) return;
    const t = setTimeout(() => {
      // 5sn sonra hâlâ konum yoksa gerçek izin durumunu kontrol et
      void (async () => {
        try {
          const { Geolocation } = await import('@capacitor/geolocation');
          const perms = await Geolocation.checkPermissions();
          const granted = perms.location === 'granted' || perms.coarseLocation === 'granted';
          if (!granted) {
            // Gerçekten izin yok → uyar
            showToast({
              type: 'warning',
              title: 'GPS İzni Gerekli',
              message: 'Konum izni verilmeden harita ve navigasyon çalışmaz.',
              duration: 8000,
            });
          }
          // İzin var ama fix yok → sessizce bekle (GPS bekliyor olabilir)
        } catch {
          // Plugin başarısız → toast atma (false positive önle)
        }
      })();
    }, 5000);
    return () => clearTimeout(t);
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
      updateTrafficLocation(loc.lat, loc.lng);
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

  // Bluetooth araç entegrasyonu — bağlantı değişikliklerini dinle
  // Sahte bildirim koruması:
  //   1. Mount sırasında 5sn grace period — ilk listener event'i (Android replay) yutulur
  //   2. Cihaz başına 60sn cooldown — A2DP/HFP/AVRCP profil değişimleri tek toast
  //   3. Yalnızca durum DEĞİŞTİĞİNDE toast (true→true yutulur, true→false→true gerçek bağlanma)
  useEffect(() => {
    if (!isNative) return;
    let handle: { remove(): void } | null = null;
    let unmounted = false;

    const mountTime  = performance.now();
    const GRACE_MS   = 5_000;
    const COOLDOWN_MS = 60_000;

    // deviceName → son toast zamanı (ms)
    const lastShownAt = new Map<string, number>();
    let   lastConnected: boolean | null = null;

    CarLauncher.addListener('btChanged', (evt) => {
      const now = performance.now();
      updateDeviceStatus({ btConnected: evt.connected, btDevice: evt.deviceName });

      // 1. Mount grace: ilk 5sn içindeki event'leri sessizce yut (Android receiver replay'i)
      if (now - mountTime < GRACE_MS) {
        lastConnected = evt.connected;
        return;
      }

      // 2. Aynı durum tekrar geliyorsa toast atma (true→true / false→false)
      if (lastConnected === evt.connected) return;
      lastConnected = evt.connected;

      // 3. Cihaz başına cooldown (60sn)
      const key = evt.deviceName || '_';
      const last = lastShownAt.get(key) ?? 0;
      if (now - last < COOLDOWN_MS) return;
      lastShownAt.set(key, now);

      if (evt.connected) {
        showToast({
          type:     'success',
          title:    `Araç Bağlandı${evt.deviceName ? ': ' + evt.deviceName : ''}`,
          message:  'Caros Pro aktif — iyi yolculuklar!',
          duration: 4000,
        });
      } else {
        showToast({
          type:     'info',
          title:    'Araç Bağlantısı Kesildi',
          message:  'Bluetooth bağlantısı sonlandı.',
          duration: 3000,
        });
      }
    }).then((h) => {
      if (unmounted) { h.remove(); return; }
      handle = h;
    }).catch(() => {});
    return () => {
      unmounted = true;
      handle?.remove();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Araç profil algılama
  useEffect(() => {
    startVehicleDetection();
    return () => { stopVehicleDetection(); };
  }, []);

  // Traffic service startup (bir kez) + ilk konum ile başlat
  useEffect(() => {
    startTrafficService(location?.latitude, location?.longitude);
    return () => { stopTrafficService(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Konum değiştiğinde trafik servisini güncelle
  useEffect(() => {
    if (location?.latitude) updateTrafficLocation(location.latitude, location.longitude);
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
      stopTripLog();
      stopNotificationService();
      stopWeatherService();
      stopHeadlightAutoBrightness();
    };
  }, []);
}
