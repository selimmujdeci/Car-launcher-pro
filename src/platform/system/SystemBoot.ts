/**
 * SystemBoot — Uygulama Önyükleme Çekirdeği (Singleton)
 *
 * Servisleri dört dalgada bağımlılık sırasına göre başlatır.
 * Her dalga, bir öncekinin tüm Promise'leri çözülmeden başlamaz.
 * Cleanup LIFO sırasıyla yapılır (Wave 4 → Wave 1).
 *
 * Dalgalar:
 *   Wave 1 (Core)        : runtimeManager · safeStorage · NativeGuardBridge · crash recovery
 *   Wave 2 (Backbone)    : VehicleDataLayer · SystemOrchestrator
 *   Wave 3 (Intelligence): MaintenanceBrain · FuelAdvisor · BlackBox · Geofence · Radar · Battery
 *   Wave 4 (UI Services) : TheaterService · SmartCardEngine · PushService
 *
 * Kullanım (App.tsx):
 *   useEffect(() => {
 *     void systemBoot.start();
 *     return () => systemBoot.stop();
 *   }, []);
 */

import { runtimeManager }          from '../../core/runtime/AdaptiveRuntimeManager';
import { initSafeStorageAsync }    from '../../utils/safeStorage';
import { isNative }                from '../bridge';
import { CarLauncher }             from '../nativePlugin';
import { startNativeGuardBridge }  from '../native/NativeGuardBridge';
import { useVehicleStore }         from '../vehicleDataLayer/VehicleStateStore';
import {
  startVehicleDataLayer,
  restoreOdometer,
}                                  from '../vehicleDataLayer';
import { startSystemOrchestrator } from './SystemOrchestrator';
import { startMaintenanceBrain }   from '../diagnostic/maintenanceBrain';
import { startFuelAdvisor }        from '../diagnostic/fuelAdvisorService';
import { startBlackBox }           from '../security/blackBoxService';
import {
  startGeofenceService,
  stopGeofenceService,
}                                  from '../security/geofenceService';
import {
  startRadarEngine,
  stopRadarEngine,
}                                  from '../radar/radarEngine';
import { turkiyeStaticRadars }     from '../radar/staticRadarData';
import { startTheaterService }     from '../theaterModeService';
import {
  startSmartCardEngine,
  stopSmartCardEngine,
}                                  from '../ai/smartCardEngine';
import { initPushService }         from '../pushService';
import { startBatteryProtection }  from '../power/BatteryProtectionService';
import { logError }                from '../crashLogger';

// ── Yardımcılar ───────────────────────────────────────────────────────────────

type Cleanup = () => void;

/** Kısmi kayıt log satırı */
function _log(msg: string): void {
  console.info(`[Boot] ${msg}`);
}

// ─────────────────────────────────────────────────────────────────────────────

class SystemBoot {

  private _started  = false;
  private _cleanups: Cleanup[] = [];

  // ── Cleanup kaydı ─────────────────────────────────────────────────────────

  /** Cleanup thunk'ı LIFO stack'ine ekle. */
  private _reg(fn: Cleanup | void | undefined): void {
    if (typeof fn === 'function') this._cleanups.push(fn);
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Tüm servisleri sıralı dalgalarla başlatır.
   * İkinci çağrı no-op'tur (idempotent).
   */
  async start(): Promise<void> {
    if (this._started) return;
    this._started = true;

    try {
      await this._wave1();
      await this._wave2();
      await this._wave3();
      await this._wave4();
      _log('Boot complete ✓');
    } catch (e) {
      logError('SystemBoot', e);
      this.stop(); // kısmi başlatma geri alınır
      throw e;
    }
  }

  /**
   * Tüm servisleri Wave 4 → Wave 1 sırasıyla durdurur.
   * start() sonrasında yeniden çağrılabilir (stop → start döngüsü güvenli).
   */
  stop(): void {
    _log('Stopping all services (LIFO)...');
    // LIFO: son başlayan ilk durur — bağımlılık zincirine saygı
    for (let i = this._cleanups.length - 1; i >= 0; i--) {
      try { this._cleanups[i]!(); } catch (e) { logError('SystemBoot:stop', e); }
    }
    this._cleanups = [];
    this._started  = false;
  }

  // ── Wave 1: Core ──────────────────────────────────────────────────────────

  private async _wave1(): Promise<void> {
    _log('Starting Wave 1 (Core)...');

    // runtimeManager: crash recovery + ilk mod logu
    _log('  › runtimeManager.start()');
    runtimeManager.start();

    // safeStorage: native FS önbelleği yükle (idempotent — main.tsx'de zaten çağrıldı)
    _log('  › initSafeStorageAsync');
    await initSafeStorageAsync();

    // NativeGuardBridge: heartbeat (1s) + odo persist (5s) + mode sync
    _log('  › NativeGuardBridge');
    this._reg(startNativeGuardBridge());

    // Crash recovery: native odo > Zustand odo → worker'a gönder
    await this._crashRecovery();

    _log('Wave 1 ready ✓');
  }

  // ── Wave 2: Data Backbone ─────────────────────────────────────────────────

  private async _wave2(): Promise<void> {
    _log('Starting Wave 2 (Data Backbone)...');

    // VehicleDataLayer: OBD / GPS / CAN worker (SAB zero-copy)
    _log('  › VehicleDataLayer');
    this._reg(startVehicleDataLayer());

    // SystemOrchestrator: VDL event'lerini UI sinyallerine dönüştürür
    _log('  › SystemOrchestrator');
    this._reg(startSystemOrchestrator());

    _log('Wave 2 ready ✓');
  }

  // ── Wave 3: Sensors & Intelligence ───────────────────────────────────────

  private async _wave3(): Promise<void> {
    _log('Starting Wave 3 (Sensors & Intelligence)...');

    _log('  › MaintenanceBrain');
    this._reg(startMaintenanceBrain());

    _log('  › FuelAdvisor');
    this._reg(startFuelAdvisor());

    _log('  › BlackBox');
    this._reg(startBlackBox());

    // BatteryProtection: 12V voltaj izleme + power ceiling
    _log('  › BatteryProtection');
    this._reg(startBatteryProtection());

    // GeofenceService: async (Supabase zona sorgusu)
    _log('  › GeofenceService (async)');
    const geofenceCleanup = await startGeofenceService().catch((e: unknown) => {
      logError('SystemBoot:Geofence', e);
      return stopGeofenceService; // fallback cleanup
    });
    this._reg(geofenceCleanup ?? stopGeofenceService);

    // RadarEngine: Türkiye statik radar veritabanı
    _log('  › RadarEngine');
    startRadarEngine(turkiyeStaticRadars);
    this._reg(stopRadarEngine);

    _log('Wave 3 ready ✓');
  }

  // ── Wave 4: UI Services ───────────────────────────────────────────────────

  private async _wave4(): Promise<void> {
    _log('Starting Wave 4 (UI Services)...');

    _log('  › TheaterService');
    this._reg(startTheaterService());

    _log('  › SmartCardEngine');
    startSmartCardEngine();
    this._reg(stopSmartCardEngine);

    // PushService: FCM token kaydı (async)
    _log('  › PushService (async)');
    const pushCleanup = await initPushService().catch((e: unknown) => {
      logError('SystemBoot:Push', e);
      return undefined;
    });
    this._reg(pushCleanup);

    _log('Wave 4 ready ✓');
  }

  // ── Crash recovery yardımcısı ─────────────────────────────────────────────

  private async _crashRecovery(): Promise<void> {
    if (!isNative) return;
    try {
      const result = await CarLauncher.getPersistedOdometer?.();
      if (!result) return;
      const nativeKm = result.km;
      if (!Number.isFinite(nativeKm) || nativeKm <= 0) return;
      const storeKm = useVehicleStore.getState().odometer ?? 0;
      if (nativeKm > storeKm + 0.1) { // 100m tolerans
        useVehicleStore.getState().updateVehicle({ odometer: nativeKm });
        restoreOdometer(nativeKm); // çalışan worker'a da bildir
        _log(`  › Crash recovery: odo ${storeKm.toFixed(3)} → ${nativeKm.toFixed(3)} km`);
      }
    } catch { /* native metot henüz implement edilmemişse sessizce geç */ }
  }
}

// ── Singleton export ──────────────────────────────────────────────────────────

export const systemBoot = new SystemBoot();
