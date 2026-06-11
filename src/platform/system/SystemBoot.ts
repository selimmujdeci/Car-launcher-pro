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
import { hydrateExpertTrustStore } from '../../store/useExpertStore';
import { hydrateSafetyBrainFromStorage } from '../safety/SafetyBrain';
import { isNative }                from '../bridge';
import { CarLauncher }             from '../nativePlugin';
import { startNativeGuardBridge }  from '../native/NativeGuardBridge';
import { useUnifiedVehicleStore as useVehicleStore } from '../vehicleDataLayer/UnifiedVehicleStore';
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
import { startOtaService, stopOtaService } from '../otaUpdateService';
import { startRemoteLogService }   from '../remoteLogService';
import { startMemoryWatchdog, stopMemoryWatchdog } from '../memoryWatchdog';
import {
  startSmartCardEngine,
  stopSmartCardEngine,
}                                  from '../ai/smartCardEngine';
import { initPushService }         from '../pushService';
import { startBatteryProtection }  from '../power/BatteryProtectionService';
import { startVehicleIntelligenceService } from '../vehicleIntelligenceService';
import { logError }                from '../crashLogger';
import { showToast, dismissToast } from '../errorBus';
import { healthMonitor }           from './SystemHealthMonitor';
import { initCommunityService, stopCommunityService } from '../communityService';
import { stopVoiceService }        from '../voiceService';
import {
  startCompanionEngine,
  stopCompanionEngine,
}                                  from '../companion/companionEngine';
import { restoreNavigationAsync }  from '../navigationService';
import { startCognitiveEngine, stopCognitiveEngine } from './CognitivePriorityEngine';
import { useCognitiveStore }       from '../../store/useCognitiveStore';

// ── Yardımcılar ───────────────────────────────────────────────────────────────

type Cleanup = () => void;

/** Kısmi kayıt log satırı */
function _log(msg: string): void {
  console.info(`[Boot] ${msg}`);
}

// ─────────────────────────────────────────────────────────────────────────────

class SystemBoot {

  private _started       = false;
  private _cleanups:     Cleanup[] = [];
  /** İsimli servis cleanup'ları — restart ve limp mekanizması için */
  private _namedCleanups = new Map<string, Cleanup>();
  /** Worker crash exponential backoff — sayaç + cool-off timer */
  private _backoffState = new Map<string, { count: number; cooloffTimer: ReturnType<typeof setTimeout> | null }>();
  /** LIMP_HOME izleme durumu */
  private _limpActive  = false;
  private _cogUnsub:   (() => void) | null = null;
  /** LIMP_HOME kullanıcı uyarısı (GlobalAlert) toast id — Zero-Leak: çıkışta kapatılır */
  private _limpToastId: string | null = null;
  /**
   * Boot iptal denetleyicisi. start() sırasında stop() tetiklenirse abort()
   * edilir; havada bekleyen async start adımları erken çıkar ve geç tamamlanan
   * servisler anında temizlenir (zombi servis önleme).
   */
  private _bootAbort: AbortController | null = null;

  /** Boot şu an iptal edilmiş mi? */
  private get _aborted(): boolean {
    return this._bootAbort?.signal.aborted ?? false;
  }

  /**
   * Cleanup kaydı — ama boot iptal edildiyse servisi kaydetmeden anında durdur.
   * Async adımdan SONRA dönen cleanup için: stop() çoktan geçtiyse zombi kalmaz.
   */
  private _regOrAbort(fn: Cleanup | void | undefined): void {
    if (this._aborted) {
      if (typeof fn === 'function') {
        try { fn(); } catch (e) { logError('SystemBoot:abortCleanup', e); }
      }
      return;
    }
    this._reg(fn);
  }

  // ── Cleanup kaydı ─────────────────────────────────────────────────────────

  /** Cleanup thunk'ı LIFO stack'ine ekle. */
  private _reg(fn: Cleanup | void | undefined): void {
    if (typeof fn === 'function') this._cleanups.push(fn);
  }

  /** İsimli servis cleanup'ı — LIFO stack + named map'e ekle. */
  private _regNamed(name: string, fn: Cleanup | void | undefined): void {
    if (typeof fn !== 'function') return;
    this._cleanups.push(fn);
    this._namedCleanups.set(name, fn);
  }

  /**
   * Worker crash olduğunda çağrılır — max 2 deneme sonrası vazgeçer.
   */
  private _handleWorkerCrash(workerKey: string, restartServiceName: string): void {
    const MAX_RESTARTS    = 2;
    const BACKOFF_BASE_MS = 5_000;        // 5s → 10s → 20s (her denemede 2x)
    const BACKOFF_MAX_MS  = 160_000;      // üst limit ~2.5 dakika
    const COOLOFF_MS      = 5 * 60_000;  // max limit sonrası 5 dk bekleme

    const state = this._backoffState.get(workerKey) ?? { count: 0, cooloffTimer: null };

    // Zaten cool-off dönemindeyse — reset öncesi gelen crash'i yok say
    if (state.cooloffTimer) {
      _log(`Worker crash: ${workerKey} — cool-off aktif, yok sayıldı`);
      return;
    }

    state.count++;
    this._backoffState.set(workerKey, state);

    const delayMs = Math.min(BACKOFF_BASE_MS * Math.pow(2, state.count - 1), BACKOFF_MAX_MS);

    if (state.count <= MAX_RESTARTS) {
      _log(`Worker crash: ${workerKey} (attempt ${state.count}/${MAX_RESTARTS}) — ${delayMs / 1000}s sonra yeniden deneniyor`);
      setTimeout(() => {
        void this.restartService(restartServiceName).catch((e) => logError(`SystemBoot:restart:${restartServiceName}`, e));
      }, delayMs);
    } else {
      _log(`  › ${workerKey} max restart limitine ulaştı — ${COOLOFF_MS / 60_000}dk cool-off başlatıldı`);
      state.cooloffTimer = setTimeout(() => {
        _log(`  › ${workerKey} cool-off bitti — sayaç sıfırlandı`);
        this._backoffState.set(workerKey, { count: 0, cooloffTimer: null });
      }, COOLOFF_MS);
      this._backoffState.set(workerKey, state);
    }
  }

  /**
   * İsimli servisi durdur ve yeniden başlat.
   * HealthMonitor'ın restartFn'i bu metodu çağırır.
   * Bilinmeyen isim → no-op.
   */
  async restartService(name: string): Promise<void> {
    _log(`Restarting service: ${name}`);

    // Mevcut cleanup'ı çalıştır ve orijinal LIFO pozisyonunu kaydet
    const cleanup = this._namedCleanups.get(name);
    let _insertIdx = this._cleanups.length; // varsayılan: sona ekle
    if (cleanup) {
      try { cleanup(); } catch (e) { logError(`SystemBoot:Restart:cleanup:${name}`, e); }
      this._namedCleanups.delete(name);
      const idx = this._cleanups.indexOf(cleanup);
      if (idx >= 0) {
        _insertIdx = idx; // orijinal pozisyonu koru → LIFO sırası bozulmaz
        this._cleanups.splice(idx, 1);
      }
    }

    // Kısa bekleme — cleanup settle
    await new Promise<void>((resolve) => setTimeout(resolve, 500));

    switch (name) {
      case 'VehicleDataLayer': {
        const newCleanup = startVehicleDataLayer({
          onWorkerCrash: () => this._handleWorkerCrash('VehicleCompute', 'VehicleDataLayer'),
        });
        if (typeof newCleanup === 'function') {
          // push() yerine splice ile orijinal pozisyona yerleştir — LIFO korunur
          this._cleanups.splice(_insertIdx, 0, newCleanup);
          this._namedCleanups.set('VehicleDataLayer', newCleanup);
        }
        _log(`  › VehicleDataLayer restarted`);
        break;
      }
      case 'VisionCompute': {
        const { restartVisionWorker } = await import('../vision/visionCore');
        restartVisionWorker();
        _log(`  › VisionCompute worker restarted`);
        break;
      }
      case 'NavigationCompute': {
        const { restartNavWorker } = await import('../offlineRoutingService');
        restartNavWorker();
        _log(`  › NavigationCompute worker restarted`);
        break;
      }
      default:
        _log(`  › Unknown service for restart: ${name}`);
    }
  }

  // ── LIMP_HOME servis yönetimi ──────────────────────────────────────────────

  /** CognitiveStore'u izle — LIMP_HOME geçişlerinde servisleri durdur/başlat. */
  private _startLimpMonitor(): void {
    let _prevMode = useCognitiveStore.getState().currentMode;
    this._cogUnsub = useCognitiveStore.subscribe((state) => {
      const mode = state.currentMode;
      if (mode === _prevMode) return;
      const wasLimp = _prevMode === 'LIMP_HOME';
      const isLimp  = mode     === 'LIMP_HOME';
      _prevMode = mode;
      if (isLimp && !wasLimp)  this._enterLimp();
      if (!isLimp && wasLimp)  void this._exitLimp();
    });
  }

  /** LIMP_HOME girişi: opsiyonel servisleri durdur. */
  private _enterLimp(): void {
    if (this._limpActive) return;
    this._limpActive = true;
    _log('LIMP_HOME: Opsiyonel servisler durduruluyor...');

    // GlobalAlert: kullanıcıyı kalıcı uyarıyla bilgilendir (kritik veriler açık kalır)
    if (!this._limpToastId) {
      this._limpToastId = showToast({
        type:     'warning',
        title:    'Sistem Kısıtlı Modda',
        message:  'Bazı özellikler güvenlik için devre dışı. Hız, harita ve temel OBD aktif.',
        duration: 0,
      });
    }

    const OPTIONAL = ['RadarEngine', 'FuelAdvisor', 'MaintenanceBrain', 'CommunityService', 'VoiceService'] as const;
    for (const name of OPTIONAL) {
      const fn = this._namedCleanups.get(name);
      if (fn) {
        try { fn(); } catch (e) { logError(`LIMP:stop:${name}`, e); }
        this._namedCleanups.delete(name);
        const idx = this._cleanups.indexOf(fn);
        if (idx >= 0) this._cleanups.splice(idx, 1);
        _log(`  › ${name} durduruldu`);
      }
    }
  }

  /** LIMP_HOME çıkışı: opsiyonel servisleri Wave sırasına göre yeniden başlat. */
  private async _exitLimp(): Promise<void> {
    if (!this._limpActive) return;
    this._limpActive = false;
    _log('LIMP_HOME çıkışı: Servisler yeniden başlatılıyor...');

    // GlobalAlert kapat — kısıtlı mod sona erdi
    if (this._limpToastId) { dismissToast(this._limpToastId); this._limpToastId = null; }

    await new Promise<void>((r) => setTimeout(r, 500));

    const mbCleanup = startMaintenanceBrain();
    if (typeof mbCleanup === 'function') {
      this._cleanups.push(mbCleanup);
      this._namedCleanups.set('MaintenanceBrain', mbCleanup);
      _log('  › MaintenanceBrain yeniden başlatıldı');
    }

    const faCleanup = startFuelAdvisor();
    if (typeof faCleanup === 'function') {
      this._cleanups.push(faCleanup);
      this._namedCleanups.set('FuelAdvisor', faCleanup);
      _log('  › FuelAdvisor yeniden başlatıldı');
    }

    void startRadarEngine(turkiyeStaticRadars); // async — singleton guard içinde
    this._cleanups.push(stopRadarEngine);
    this._namedCleanups.set('RadarEngine', stopRadarEngine);
    _log('  › RadarEngine yeniden başlatıldı');

    // Wave 3/4 hiyerarşisi: CommunityService (sync) → VoiceService (module-level)
    initCommunityService();
    this._cleanups.push(stopCommunityService);
    this._namedCleanups.set('CommunityService', stopCommunityService);
    _log('  › CommunityService yeniden başlatıldı');

    // VoiceService modül seviyesinde daima canlı — cleanup kaydı yenilendi
    // startListening() çağrıldığında AudioContext sıfırdan açılır
    this._cleanups.push(stopVoiceService);
    this._namedCleanups.set('VoiceService', stopVoiceService);
    _log('  › VoiceService yeniden etkinleştirildi');
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Tüm servisleri sıralı dalgalarla başlatır.
   * İkinci çağrı no-op'tur (idempotent).
   */
  async start(): Promise<void> {
    if (this._started) return;
    this._started = true;
    this._bootAbort = new AbortController();

    try {
      await this._wave1(); if (this._aborted) return this._onBootAborted();
      await this._wave2(); if (this._aborted) return this._onBootAborted();
      await this._wave3(); if (this._aborted) return this._onBootAborted();
      await this._wave4(); if (this._aborted) return this._onBootAborted();
      window.__APP_READY__ = true;
      _log('Boot complete ✓');

      // Soak Test: window.__START_SOAK_TEST__ bayrağı ile DEV + üretimde opsiyonel olarak tetiklenir.
      // Üretimde varsayılan kapalı; DevTools'ta "window.__START_SOAK_TEST__ = true" ile açılır.
      if (window.__START_SOAK_TEST__) {
        healthMonitor.enableSoakTest();
        _log('SoakTest etkinleştirildi (window.__START_SOAK_TEST__)');
      }
    } catch (e) {
      // critical: boot çökmesi → bir sonraki açılışta remote drain ile raporlanır
      logError('SystemBoot', e, 'critical');
      this.stop(); // kısmi başlatma geri alınır
      throw e;
    }
  }

  /**
   * Boot, ortasında stop() ile iptal edildiğinde çağrılır.
   * stop() cleanup'ları zaten çalıştırdı; burada yalnızca güvenli çıkış loglanır.
   * Geç tamamlanan wave adımları _aborted kontrolleri sayesinde servis kaydetmez.
   */
  private _onBootAborted(): void {
    _log('Boot aborted (stop() çağrıldı) — kısmi başlatma iptal edildi');
  }

  /**
   * Tüm servisleri Wave 4 → Wave 1 sırasıyla durdurur.
   * start() sonrasında yeniden çağrılabilir (stop → start döngüsü güvenli).
   */
  stop(): void {
    _log('Stopping all services (LIFO)...');
    // Havada bekleyen async boot adımlarını iptal et (zombi servis önleme)
    this._bootAbort?.abort();
    // CognitivePriorityEngine + LIMP izleyici
    if (this._cogUnsub) { this._cogUnsub(); this._cogUnsub = null; }
    stopCognitiveEngine();
    this._limpActive = false;
    if (this._limpToastId) { dismissToast(this._limpToastId); this._limpToastId = null; }
    healthMonitor.stop();
    // LIFO: son başlayan ilk durur — bağımlılık zincirine saygı
    for (let i = this._cleanups.length - 1; i >= 0; i--) {
      try { this._cleanups[i]!(); } catch (e) { logError('SystemBoot:stop', e); }
    }
    this._cleanups     = [];
    this._namedCleanups.clear();
    this._backoffState.forEach((s) => { if (s.cooloffTimer) clearTimeout(s.cooloffTimer); });
    this._backoffState.clear();
    this._bootAbort    = null;
    this._started      = false;
  }

  // ── Wave 1: Core ──────────────────────────────────────────────────────────

  private async _wave1(): Promise<void> {
    _log('Starting Wave 1 (Core)...');

    // runtimeManager: crash recovery + ilk mod logu
    _log('  › runtimeManager.start()');
    runtimeManager.setZombieRestartCallback((key) => {
      void this.restartService(key).catch((e) => logError('SystemBoot:ZombieRestart', e));
    });
    runtimeManager.start();

    // safeStorage: native FS önbelleği yükle (idempotent — main.tsx'de zaten çağrıldı)
    _log('  › initSafeStorageAsync');
    await initSafeStorageAsync();

    _log('  › hydrateExpertTrustStore');
    await hydrateExpertTrustStore();
    if (this._aborted) return; // stop() async sırasında geldi → erken çık

    _log('  › hydrateSafetyBrainFromStorage');
    hydrateSafetyBrainFromStorage();

    _log('  › initCommunityService');
    initCommunityService();
    this._regNamed('CommunityService', stopCommunityService);

    // Offline auto-cache: GPS konumuna abone ol → internet varken bulunulan bölgenin
    // POI verisini arka planda sessizce indir ("offline harita kendiliğinden çalışır").
    _log('  › startOfflineAutoCache');
    const { startOfflineAutoCache, stopOfflineAutoCache } = await import('../offlineAutoCache');
    startOfflineAutoCache();
    this._regNamed('OfflineAutoCache', stopOfflineAutoCache);

    // NativeGuardBridge: heartbeat (1s) + odo persist (5s) + mode sync
    _log('  › NativeGuardBridge');
    this._reg(startNativeGuardBridge());

    // Crash recovery: native odo > Zustand odo → worker'a gönder
    await this._crashRecovery();
    if (this._aborted) return; // stop() async sırasında geldi → erken çık

    // MemoryWatchdog: native LMK baskı event'lerini yakala
    _log('  › MemoryWatchdog');
    startMemoryWatchdog();
    this._reg(stopMemoryWatchdog);

    // SystemHealthMonitor: tüm servislerden önce başlat
    _log('  › SystemHealthMonitor');
    healthMonitor.start();

    _log('Wave 1 ready ✓');
  }

  // ── Wave 2: Data Backbone ─────────────────────────────────────────────────

  private async _wave2(): Promise<void> {
    _log('Starting Wave 2 (Data Backbone)...');

    // VehicleDataLayer: OBD / GPS / CAN worker (SAB zero-copy)
    _log('  › VehicleDataLayer');
    this._regNamed('VehicleDataLayer', startVehicleDataLayer({
      onWorkerCrash: () => this._handleWorkerCrash('VehicleCompute', 'VehicleDataLayer'),
    }));

    healthMonitor.register({
      name:        'VehicleDataLayer',
      criticality: 'critical',
      deadlineMs:  15_000,
      alertTitle:  'Sistem Limitli Modda',
      alertMsg:    'Sensör verisi dondu — OBD/GPS bağlantısı kontrol edin.',
      restartFn:   () => this.restartService('VehicleDataLayer'),
      maxRestarts: 2,
    });

    healthMonitor.register({
      name:        'GPS',
      criticality: 'warning',
      deadlineMs:  20_000,
      alertTitle:  'GPS Sinyali Yok',
      alertMsg:    'Konum verisi alınamıyor — tünel veya sinyal kesintisi.',
    });

    // SystemOrchestrator: VDL event'lerini UI sinyallerine dönüştürür
    _log('  › SystemOrchestrator');
    this._reg(startSystemOrchestrator());

    _log('Wave 2 ready ✓');
  }

  // ── Wave 3: Sensors & Intelligence ───────────────────────────────────────

  private async _wave3(): Promise<void> {
    _log('Starting Wave 3 (Sensors & Intelligence)...');

    _log('  › MaintenanceBrain');
    this._regNamed('MaintenanceBrain', startMaintenanceBrain());

    _log('  › FuelAdvisor');
    this._regNamed('FuelAdvisor', startFuelAdvisor());

    _log('  › BlackBox');
    this._reg(startBlackBox());

    // BatteryProtection: 12V voltaj izleme + power ceiling
    _log('  › BatteryProtection');
    this._reg(startBatteryProtection());

    // VehicleIntelligenceService: SPE sensör plausibility + güven skoru
    _log('  › VehicleIntelligenceService');
    this._reg(startVehicleIntelligenceService());

    // GeofenceService: async (Supabase zona sorgusu)
    _log('  › GeofenceService (async)');
    const geofenceCleanup = await startGeofenceService().catch((e: unknown) => {
      logError('SystemBoot:Geofence', e);
      return stopGeofenceService; // fallback cleanup
    });
    // Async sırasında stop() geldiyse servisi kaydetme, anında durdur (zombi önle)
    this._regOrAbort(geofenceCleanup ?? stopGeofenceService);
    if (this._aborted) return;

    // RadarEngine: Türkiye statik radar veritabanı
    _log('  › RadarEngine');
    startRadarEngine(turkiyeStaticRadars);
    this._regNamed('RadarEngine', stopRadarEngine);

    // CognitivePriorityEngine + LIMP_HOME izleyici
    _log('  › CognitivePriorityEngine');
    startCognitiveEngine();
    this._startLimpMonitor();

    _log('Wave 3 ready ✓');
  }

  // ── Wave 4: UI Services ───────────────────────────────────────────────────

  private async _wave4(): Promise<void> {
    _log('Starting Wave 4 (UI Services)...');

    // On-demand OPTIONAL worker'lar için lifecycle placeholder'ları
    runtimeManager.registerWorker('VisionCompute',     null, 'OPTIONAL');
    runtimeManager.registerWorker('NavigationCompute', null, 'OPTIONAL');

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
    // Async sırasında stop() geldiyse servisi kaydetme, anında durdur (zombi önle)
    this._regOrAbort(pushCleanup);
    if (this._aborted) return;

    // VoiceService: modül-düzeyi singleton — cleanup'ı LIFO + namedCleanups'a kaydet
    _log('  › VoiceService (named cleanup)');
    this._regNamed('VoiceService', stopVoiceService);

    // CompanionEngine: proaktif motor + uyku önleyici (Faz 4 — 60s PromptScheduler).
    // Gate zinciri PROTECTION+ modlarda kendini susturur; LIMP_HOME'da ekstra
    // kayda gerek yok. companionEnabled kapalıysa tick no-op (ayar runtime izlenir).
    _log('  › CompanionEngine');
    startCompanionEngine();
    this._regNamed('CompanionEngine', stopCompanionEngine);

    // OTA güncelleme servisi: boot kontrolü + 6 saatlik poll (OTA v1 / Commit 6)
    _log('  › OtaUpdateService');
    startOtaService();
    this._reg(stopOtaService);

    // Uzak log hattı: crashLogger sink kaydı + önceki oturum crash drain'i
    // (Remote Log v1 / Commit 2)
    _log('  › RemoteLogService');
    this._reg(startRemoteLogService());

    // Vosk STT modelini boot sonrası arka planda ısıt — eskiden ilk mikrofon
    // basışında unpack+load (zayıf head unit CPU'sunda 20-40 sn) ödeniyor,
    // JS failsafe 14 sn'de pes edip "Dinliyorum"da takılı kalıyordu.
    // 8 sn gecikme: boot I/O'su ile yarışmasın. Fail-soft: preload başarısız
    // olsa da ilk basışta normal yol (artık kuyruklu) devreye girer.
    if (isNative) {
      const voskWarmTimer = setTimeout(() => {
        try {
          CarLauncher.preloadVoskModel?.()
            .then(() => _log('  › Vosk model preloaded ✓'))
            .catch((e: unknown) => logError('SystemBoot:VoskPreload', e));
        } catch (e) { logError('SystemBoot:VoskPreload', e); }
      }, 8_000);
      this._reg(() => clearTimeout(voskWarmTimer));
    }

    // ChaosReceiver: yalnızca DEV ortamında — BroadcastChannel üzerinden komut dinler
    if (import.meta.env.DEV) {
      this._reg(this._startChaosReceiver());
    }

    _log('Wave 4 ready ✓');
  }

  // ── Chaos Receiver (DEV ONLY) ──────────────────────────────────────────────

  /**
   * BroadcastChannel('caros-chaos') üzerinden admin panelinden gelen kaos
   * komutlarını alır ve main app context'inde çalıştırır.
   *
   * Desteklenen komutlar:
   *   trigger_zombie        — OPTIONAL zombie worker oluştur; ZombieDetection'ı test et
   *   trigger_bitflip       — VehicleCompute _odoTMR'a bit-flip enjekte et; median recovery testi
   *   force_thermal_l3      — injectDeviceTemp(70) → ThermalWatchdog L3
   *   simulate_ui_freeze    — 6s synchronous busy-loop → UIWatchdog tetiklenir
   *   memory_pressure_high  — runtimeManager.handleMemoryPressure('CRITICAL')
   *   corrupt_nav_state     — nav_crash_state'i NaN/null koordinatla boz; reload'da reddedilmeli
   *
   * Zero-Leak: dönen cleanup fn BroadcastChannel'ı kapatır.
   */
  private _startChaosReceiver(): () => void {
    if (typeof BroadcastChannel === 'undefined') return () => {};

    const bc = new BroadcastChannel('caros-chaos');

    bc.onmessage = (e: MessageEvent) => {
      const cmd = (e.data as { cmd: string }).cmd;
      console.info(`[ChaosReceiver] Komut: ${cmd}`);

      switch (cmd) {
        case 'trigger_zombie': {
          try {
            const script  = 'self.onmessage=function(){/* zombie: PONG hiçbir zaman gönderilmez */}';
            const blobUrl = URL.createObjectURL(new Blob([script], { type: 'text/javascript' }));
            const zombie  = new Worker(blobUrl);
            URL.revokeObjectURL(blobUrl); // Worker constructor iç referansı tutar — erken revoke güvenli
            runtimeManager.registerWorker('ChaosZombie', zombie, 'OPTIONAL');
            console.warn('[ChaosReceiver] Escalation Step X: Zombie Worker Registered — ChaosZombie (OPTIONAL) kayıtlı, ZombieDetection ~30s içinde tespit edecek');
          } catch (err) {
            console.error('[ChaosReceiver] Zombie worker oluşturulamadı:', err);
          }
          break;
        }

        case 'trigger_bitflip': {
          // VehicleCompute worker'ında _odoTMR bit-flip → median recovery worker loglarında görünür
          void import('../vehicleDataLayer').then(({ chaosTriggerBitflip }) => {
            chaosTriggerBitflip();
            console.warn('[ChaosReceiver] Escalation Step X: Bit-Flip Injected — VehicleCompute _odoTMR bozuldu; worker loglarında "[Chaos:BitFlip] … TMR BAŞARILI" satırı doğrulanmalı');
          }).catch((err) => console.error('[ChaosReceiver] trigger_bitflip başarısız:', err));
          break;
        }

        case 'force_thermal_l3': {
          void import('../thermalWatchdog').then(({ injectDeviceTemp }) => {
            injectDeviceTemp(70); // ≥65°C → L3 eşiği
            console.warn('[ChaosReceiver] Escalation Step X: Force Thermal L3 — injectDeviceTemp(70) uygulandı');
          });
          break;
        }

        case 'simulate_ui_freeze': {
          // setTimeout ile kısa gecikme — BroadcastChannel işlemi tamamlansın
          setTimeout(() => {
            console.warn('[ChaosReceiver] Escalation Step X: UI Freeze Start — main thread 6s bloke edilecek');
            const end = Date.now() + 6_000;
            while (Date.now() < end) { /* synchronous busy-wait: UIWatchdog (5s eşiği) tetiklenmeli */ }
            console.info('[ChaosReceiver] UI Freeze bitti — UIWatchdog PANIC_MARKER ThermalJournal\'a yazmalıydı');
          }, 100);
          break;
        }

        case 'memory_pressure_high': {
          runtimeManager.handleMemoryPressure('CRITICAL');
          console.warn('[ChaosReceiver] Escalation Step X: Memory Pressure High — handleMemoryPressure(CRITICAL) uygulandı');
          break;
        }

        case 'corrupt_nav_state': {
          // nav_crash_state'i gerçekten boz: null koordinatlar (Number.isFinite=false).
          // Reload'da restoreNavigationAsync bütünlük denetiminden geçemez → temiz başlangıç.
          try {
            const corrupt = JSON.stringify({
              destination: { latitude: null, longitude: null, label: 'CHAOS_CORRUPT' },
              stepIndex:   0,
              wasActive:   true,
              ts:          Date.now(),
            });
            localStorage.setItem('nav_crash_state', corrupt);
            console.warn('[ChaosReceiver] Escalation Step X: Nav State Corrupted — nav_crash_state null koordinatlarla bozuldu; uygulamayı yenileyin, restoreNavigationAsync reddedip temiz başlamalı');
          } catch (err) {
            console.error('[ChaosReceiver] corrupt_nav_state başarısız:', err);
          }
          break;
        }

        default:
          console.warn(`[ChaosReceiver] Bilinmeyen komut: ${cmd}`);
      }
    };

    console.info('[ChaosReceiver] BroadcastChannel(caros-chaos) başlatıldı — kaos komutları bekleniyor');
    return () => { bc.close(); };
  }

  // ── Crash recovery yardımcısı ─────────────────────────────────────────────

  private async _crashRecovery(): Promise<void> {
    // Odometer recovery — sadece native platformda
    if (isNative) {
      try {
        const result = await CarLauncher.getPersistedOdometer?.();
        if (result) {
          const nativeKm = result.km;
          if (Number.isFinite(nativeKm) && nativeKm > 0) {
            const storeKm = useVehicleStore.getState().odometer ?? 0;
            if (nativeKm > storeKm + 0.1) { // 100m tolerans
              useVehicleStore.getState().updateVehicleState({ odometer: nativeKm });
              restoreOdometer(nativeKm); // çalışan worker'a da bildir
              _log(`  › Crash recovery: odo ${storeKm.toFixed(3)} → ${nativeKm.toFixed(3)} km`);
            }
          }
        }
      } catch { /* native metot henüz implement edilmemişse sessizce geç */ }
    }

    // Navigation crash recovery — platform-agnostic (web + native)
    _log('  › Navigation recovery kontrol ediliyor...');
    try {
      const navRestored = await restoreNavigationAsync();
      if (navRestored) {
        _log('  › Navigation recovery: rota başarıyla geri yüklendi');
      }
    } catch (e) {
      logError('SystemBoot:NavRestore', e);
    }
  }
}

// ── Singleton export ──────────────────────────────────────────────────────────

export const systemBoot = new SystemBoot();

declare global {
  interface Window {
    __APP_READY__:       boolean;
    /** DevTools veya fleet araçlarında Soak Test'i etkinleştirmek için set edilir. */
    __START_SOAK_TEST__?: boolean;
  }
}
