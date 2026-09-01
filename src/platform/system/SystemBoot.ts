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
import { startUiActivityRecorder } from '../uiActivityRecorder';
import { startDiagnosticTrail }    from '../diagnosticTrail';
import { startPerfSeries }         from '../perfSeriesRecorder';
import {
  resetBootTiming, recordBootStart, recordBootWave, recordBootComplete,
  /* ARCH-06/F1 — SALT GÖZLEM: sıra, bağımlılık ve abort davranışı DEĞİŞMEZ. */
  markBootMilestone, measureBootService,
} from '../bootTimingRecorder';
/* ARCH-06/F2 — ERTELEME SINIRI. İkinci boot otoritesi DEĞİLDİR: işi bu sınıf
   TESLİM EDER, `bootDeferral` yalnız "ne zaman" sorusunu F1'in ZATEN ölçtüğü
   kilometre taşlarına bağlar. Cleanup sahipliği burada KALIR (LIFO). */
import { bootDeferral } from '../boot/bootDeferral';
/* P0-VDK-F5F — boşluk sicilinin açılış adımı (yükleme YAPMAZ, ölçüm üretir). */
import { beginGapLedgerBoot } from '../obd/gapRegistry';
import { useUnifiedVehicleStore as useVehicleStore } from '../vehicleDataLayer/UnifiedVehicleStore';
import {
  startVehicleDataLayer,
  restoreOdometer,
}                                  from '../vehicleDataLayer';
import { dispatchSpeedLimitExceeded } from '../vehicleDataLayer/VehicleEventHub';
import { startAutoDidWatcher }     from '../obd/autoDidDiscovery';
import { startEarlyIdentityWatcher } from '../obd/identity/earlyIdentityRuntime';
import { startSystemOrchestrator } from './SystemOrchestrator';
import { startPlatformCoreVehicleHalWiring } from './platformCoreVehicleHalWiring';
import { startPlatformCoreVehicleHalBridgeWiring } from './platformCoreVehicleHalBridgeWiring';
import { startPlatformCoreCapabilityWiring } from './platformCoreCapabilityWiring';
import { startPlatformCoreCapabilityBridgeWiring } from './platformCoreCapabilityBridgeWiring';
import { startPlatformCoreDeepScanWiring, triggerDeepScanOfflinePass } from './platformCoreDeepScanWiring';
import {
  startPlatformCoreEventBusWiring,
  publishRuntimeStarted,
  publishRuntimeStopped,
} from './platformCoreEventBusWiring';
import { initPanicHandler }       from './SystemPanicHandler';
import { startMediaAuthority, stopMediaAuthority } from '../media/authority/mediaAuthorityRuntime';
import { startProviderReadiness } from '../ai/gateway/aiProviderReadinessService';
import { startPlatformCoreAiRuntimeWiring } from './platformCoreAiRuntimeWiring';
import { startMaintenanceBrain }   from '../diagnostic/maintenanceBrain';
import { startBatteryEvidenceSource } from '../reasoning/batteryEvidenceSource';
import { startBatteryVerdictService } from '../reasoning/batteryVerdictService';
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
import { ensureDeviceRegistered }  from '../vehicleIdentityService';
import { startMemoryWatchdog, stopMemoryWatchdog } from '../memoryWatchdog';
import {
  startSmartCardEngine,
  stopSmartCardEngine,
}                                  from '../ai/smartCardEngine';
import { initPushService }         from '../pushService';
import { startBatteryProtection }  from '../power/BatteryProtectionService';
import { startVehicleIntelligenceService } from '../vehicleIntelligenceService';
import { startGuardianRuntime } from '../navigation/guardian/runtime/guardianRuntime';
import { startSpeedAlertRuntime, setSpeedAlertPushChannel } from '../speedAlertRuntime';
import { updateCurrentSpeed, notifyVehicleEvent } from '../commandListener';
import { startAutomaticVehicleFingerprint } from '../vehicleFingerprintBuilder';
import { startVehicleClassRuntime } from '../vehicle/vehicleClassRuntime';
import { stopVehicleIdentityCoordinator } from '../telemetry/vehicleIdentityRuntime';
import { startLocationEngine } from '../location/locationEngineRuntime';
import { startNavigationSessionRuntime } from '../navigation/navigationSessionRuntime';
import { startTripUpload } from '../trip/tripUploadRuntime';
import { startFleetReadback } from '../fleet/fleetReadbackService';
import { startPredictionRuntime } from '../obd/predictionRuntime';
import { startAutoLearningEngine } from '../autoLearningEngine';
import { startVehicleKnowledgeBase } from '../vehicleKnowledgeBase';
import { startVehicleLearningEvidenceBridge } from '../vehicleLearningEvidenceBridge';
import { logError }                from '../crashLogger';
import { showToast, dismissToast } from '../errorBus';
import { healthMonitor }           from './SystemHealthMonitor';
import { initCommunityService, stopCommunityService } from '../communityService';
import { stopVoiceService }        from '../voiceService';
import { startWakeWordService, notifyVoskModelReady } from '../wakeWordService';
import { startBackgroundPowerGate } from '../power/backgroundPowerGate';
import { startIncomingLocationBridge } from '../navigation/incomingLocationBridge';
import { startMaviVoiceWiring } from './platformCoreMaviVoiceWiring';
import {
  startCompanionEngine,
  stopCompanionEngine,
}                                  from '../companion/companionEngine';
import { restoreNavigationAsync }  from '../navigationService';
import { wireGrammarContext }      from '../voice/contextGrammarWiring';
import { startCognitiveEngine, stopCognitiveEngine } from './CognitivePriorityEngine';
import { useCognitiveStore }       from '../../store/useCognitiveStore';
import { runtimeRecoverySupervisor } from '../runtime/runtimeRecoverySupervisor';
import { SYSTEM_BOOT_SERVICE_DESCRIPTORS } from '../runtime/runtimeServiceRegistry';
import { beginSystemBootShutdown, finishSystemBootShutdown, noteStaleRecoveryCompletion, recordSystemBootCleanup } from '../runtime/runtimeShutdownEvidence';

// ── Yardımcılar ───────────────────────────────────────────────────────────────

type Cleanup = () => void;

/* ── Yaşam döngüsü teşhisi (B-1) ──────────────────────────────────────────────
   SALT GÖZLEM: aşağıdaki sayaçlar ve `getLifecycleDiagnostics()` hiçbir karar
   veya kontrol akışında OKUNMAZ; backoff süreleri, kapı koşulları ve cleanup
   sırası bunlardan ETKİLENMEZ. */

/**
 * Teşhis sayaçlarının DOYGUN üst sınırı. Sayaç bu değere ulaşınca artmaz →
 * sınırsız büyüme / taşma yok.
 */
export const DIAG_COUNTER_MAX = 1_000_000;

/** Doygun artış — `DIAG_COUNTER_MAX`'ta sabitlenir. */
function _satInc(n: number): number {
  return n >= DIAG_COUNTER_MAX ? DIAG_COUNTER_MAX : n + 1;
}

/** SystemBoot yaşam döngüsü teşhis anlık görüntüsü (salt-okunur, bounded). */
export interface SystemBootLifecycleDiagnostics {
  /** Yaşam döngüsü şu an aktif mi. */
  readonly started: boolean;
  /** Gerçekleşen start() sayısı (idempotent no-op çağrılar SAYILMAZ). */
  readonly starts: number;
  /** stop() çağrısı sayısı (her çağrı sayılır — stop() idempotent gövdedir). */
  readonly stops: number;
  /** LIFO cleanup yığınındaki kayıt sayısı. */
  readonly activeCleanupCount: number;
  /** İsimli cleanup anahtarları (servis adları; hassas veri yok). */
  readonly namedCleanupKeys: readonly string[];
  /** Sayaç doygunluk sınırı (tüketici doygunluğu ayırt edebilsin). */
  readonly counterMax: number;
}

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

  /* ── Yaşam döngüsü teşhis sayaçları (B-1 · SALT GÖZLEM) ─────────────────────
     Hiçbir karar/kontrol akışı bu alanları OKUMAZ. Hepsi `_satInc` ile doygun
     artar; `getLifecycleDiagnostics()` dışında tüketicisi yoktur. */
  private _diagStarts           = 0;
  private _diagStops            = 0;

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

  /* ══════════════════════════════════════════════════════════════
     Yaşam döngüsü teşhisi (B-1) — SALT-OKUMA
  ══════════════════════════════════════════════════════════════ */

  /**
   * Yaşam döngüsü sayaçlarının ve bekleyen restart planlarının anlık görüntüsü.
   *
   * YAN ETKİSİZ: hiçbir alanı değiştirmez, timer kurmaz/iptal etmez, servis
   *   başlatmaz/durdurmaz; yalnız mevcut durumu okur ve DONDURULMUŞ kopya döner.
   *   Tekrarlanan çağrılar durumu MUTASYONA UĞRATMAZ.
   * BOUNDED: `namedCleanupKeys` isimli cleanup haritası boyutundadır.
   * GİZLİLİK: yalnız servis/worker anahtarları + sayılar. VIN · GPS · OBD verisi ·
   *   kimlik bilgisi · kullanıcı verisi İÇERMEZ.
   */
  getLifecycleDiagnostics(): SystemBootLifecycleDiagnostics {
    return Object.freeze({
      started:                  this._started,
      starts:                   this._diagStarts,
      stops:                    this._diagStops,
      activeCleanupCount:       this._cleanups.length,
      namedCleanupKeys:         Object.freeze([...this._namedCleanups.keys()]),
      counterMax:               DIAG_COUNTER_MAX,
    });
  }

  /** Worker crash is evidence; bounded recovery policy belongs to the supervisor. */
  private _handleWorkerCrash(workerKey: string, restartServiceName: string): void {
    if (!this._started) {
      _log(`Worker crash: ${workerKey} — SystemBoot durmuş, yok sayıldı`);
      return;
    }
    runtimeRecoverySupervisor.request({ requestId: `worker:${workerKey}:${Date.now()}`, serviceId: restartServiceName, source: 'RESOURCE_RUNTIME', faultDomain: 'VEHICLE_DATA', observedLifecycle: 'FAILED', observedReadiness: 'NOT_READY', observedHealth: 'FAILED', reason: 'worker_crash', lifecycleEpoch: this._diagStarts, faultEvidenceRef: `SystemBoot.worker:${workerKey}`, requestedAt: Date.now(), provenance: ['SystemBoot._handleWorkerCrash'] });
  }

  /**
   * İsimli servisi durdur ve yeniden başlat.
   * RuntimeRecoverySupervisor execution adapter'ı bu metodu çağırır.
   * Bilinmeyen isim → no-op.
   */
  async restartService(name: string): Promise<void> {
    // KAPI 1 — yaşam döngüsü kapalı/iptal edilmişse diriltme YOK. Gecikmeli restart
    // geri çağrısı, HealthMonitor veya worker onerror yolu stop() sonrası buraya
    // ulaşabilir; kapanmış bir sistemde yeni servis doğurmak zombi üretir.
    if (!this._started || this._aborted) {
      _log(`Restart reddedildi (SystemBoot aktif değil): ${name}`);
      return;
    }

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

    // KAPI 2 — settle penceresi sırasında stop()/abort gelmiş olabilir. Eski cleanup
    // zaten çalıştı ve kayıtlardan düştü; burada erken çıkmak servisi KAPALI bırakır
    // (doğru davranış: sistem kapanıyor).
    if (!this._started || this._aborted) {
      _log(`  › Restart iptal edildi (settle sırasında kapanış): ${name}`);
      return;
    }

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
    runtimeRecoverySupervisor.setShutdownActive(false);
    this._diagStarts = _satInc(this._diagStarts);   // TEŞHİS (idempotent no-op sayılmaz)
    this._bootAbort = new AbortController();

    // Boot Zaman Çizelgesi (tanı genişliği) — yalnız ölçüm, dalga sırası/mantığı DEĞİŞMEZ.
    resetBootTiming();
    recordBootStart();

    /* ARCH-06/F2: erteleme turunu AÇ. Nesil `_diagStarts`tir — YENİ bir epoch
       otoritesi kurulmadı, mevcut boot sayacı kullanıldı. Ertelenen işin
       döndürdüğü cleanup, AYNI LIFO yığınına adıyla teslim edilir; sahiplik
       SystemBoot'ta kalır. */
    bootDeferral.begin(this._diagStarts, (jobId, cleanup) => {
      this._regNamed(jobId, cleanup);
    });

    try {
      let _t0 = performance.now();
      await this._wave1(); if (this._aborted) return this._onBootAborted();
      recordBootWave('Wave 1 (Core)', performance.now() - _t0);
      _t0 = performance.now();
      await this._wave2(); if (this._aborted) return this._onBootAborted();
      recordBootWave('Wave 2 (Backbone)', performance.now() - _t0);
      _t0 = performance.now();
      await this._wave3(); if (this._aborted) return this._onBootAborted();
      recordBootWave('Wave 3 (Intelligence)', performance.now() - _t0);
      _t0 = performance.now();
      await this._wave4(); if (this._aborted) return this._onBootAborted();
      recordBootWave('Wave 4 (UI Services)', performance.now() - _t0);
      recordBootComplete();
      /* ARCH-06/F1 · BACKGROUND_COMPLETE — MEVCUT `__APP_READY__` anı kullanılır.
         İkinci bir boot-complete bayrağı KURULMADI (tek boot otoritesi). */
      markBootMilestone('BACKGROUND_COMPLETE', 'SystemBoot:__APP_READY__');
      window.__APP_READY__ = true;
      _log('Boot complete ✓');

      // platform.runtime.started (retained) — YALNIZ tüm dalgalar başarıyla bittiğinde, BİR KEZ.
      // Yarım/iptal edilen boot bu satıra ULAŞMAZ → sahte "started" yayınlanmaz. Fail-soft.
      publishRuntimeStarted();

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
    // F6 interlock: once shutdown begins, recovery cannot race LIFO cleanup.
    runtimeRecoverySupervisor.setShutdownActive(true);
    if (!this._started && this._cleanups.length === 0) return;
    this._diagStops = _satInc(this._diagStops);   // TEŞHİS (her çağrı sayılır)
    const shutdownAt = Date.now();
    beginSystemBootShutdown(`system-boot:${this._diagStarts}:${this._diagStops}`, this._diagStarts, shutdownAt);
    _log('Stopping all services (LIFO)...');
    // platform.runtime.stopped — LIFO cleanup'lardan (ve bus dispose'undan) ÖNCE, BİR KEZ.
    // "started" hiç yayınlanmadıysa (hiç başlamamış / yarım boot) SESSİZ kalır; tekrar stop()
    // duplicate üretmez. Publish hatası shutdown'ı ENGELLEMEZ (fonksiyon throw etmez).
    publishRuntimeStopped();
    // Havada bekleyen async boot adımlarını iptal et (zombi servis önleme)
    this._bootAbort?.abort();
    /* ARCH-06/F2: bekleyen ERTELENMİŞ işler de iptal edilir. Tetikleyici
       bundan SONRA düşse bile iş BAŞLAMAZ — "stop sonrası sıfır yan etki"
       kuralı LIFO cleanup'tan ÖNCE uygulanır ki yeni servis kaydı doğmasın. */
    bootDeferral.abort('SystemBoot.stop()');
    // CognitivePriorityEngine + LIMP izleyici
    if (this._cogUnsub) { this._cogUnsub(); this._cogUnsub = null; }
    stopCognitiveEngine();
    this._limpActive = false;
    if (this._limpToastId) { dismissToast(this._limpToastId); this._limpToastId = null; }
    healthMonitor.stop();
    // LIFO: son başlayan ilk durur — bağımlılık zincirine saygı
    for (let i = this._cleanups.length - 1; i >= 0; i--) {
      const cleanup = this._cleanups[i]!; const serviceId = [...this._namedCleanups.entries()].find(([, fn]) => fn === cleanup)?.[0] ?? 'UNKNOWN_CLEANUP'; const startedAt = Date.now();
      try { cleanup(); recordSystemBootCleanup({ serviceId, phase: 'DISPOSING', startedAt, finishedAt: Date.now(), durationMs: Date.now() - startedAt, executionKind: 'SYNC', quiesce: 'UNSUPPORTED', drain: 'UNSUPPORTED', cancel: 'UNSUPPORTED', boundedTimeout: 'UNSUPPORTED', inFlightBefore: null, inFlightAfter: null, stopOutcome: 'SUCCEEDED', disposeOutcome: 'SUCCEEDED', timeout: false, failureReason: null, dependencyOrderSource: 'LIFO_FALLBACK', provenance: ['SystemBoot._cleanups'] }); } catch (e) { logError('SystemBoot:stop', e); recordSystemBootCleanup({ serviceId, phase: 'FAILED', startedAt, finishedAt: Date.now(), durationMs: Date.now() - startedAt, executionKind: 'SYNC', quiesce: 'UNSUPPORTED', drain: 'UNSUPPORTED', cancel: 'UNSUPPORTED', boundedTimeout: 'UNSUPPORTED', inFlightBefore: null, inFlightAfter: null, stopOutcome: 'FAILED', disposeOutcome: 'FAILED', timeout: false, failureReason: e instanceof Error ? e.message : 'cleanup_error', dependencyOrderSource: 'LIFO_FALLBACK', provenance: ['SystemBoot._cleanups'] }); }
    }
    this._cleanups     = [];
    this._namedCleanups.clear();
    this._bootAbort    = null;
    this._started      = false;
    finishSystemBootShutdown(Date.now());
  }

  // ── Wave 1: Core ──────────────────────────────────────────────────────────

  private async _wave1(): Promise<void> {
    _log('Starting Wave 1 (Core)...');

    // Panik yakalayıcı — HER ŞEYDEN ÖNCE. Boot'un geri kalanında (ve tüm oturum
    // boyunca) yakalanmayan `window.onerror` / `unhandledrejection` hataları
    // ancak bu hook kuruluysa post-mortem snapshot'a dönüşür. Denetim E-34:
    // fonksiyon yazılmıştı ama ürün yolunda ÇAĞIRANI YOKTU → sahada çöken
    // cihazdan geriye tanı verisi kalmıyordu. `_reg` (İSİMSİZ) ile kaydedilir:
    // restart adayı DEĞİL (yeniden kurulum hook zincirini bozardı) ve LIFO
    // shutdown'da EN SON dispose olur → kapanış hataları da yakalanır.
    _log('  › initPanicHandler()');
    try {
      this._reg(initPanicHandler());
    } catch (e) {
      logError('SystemBoot:panicHandler', e);   // fail-soft: boot panic yüzünden DURMAZ
    }

    // Platform Event Bus (PR-W3) — EN ÖNCE kurulur: publisher/bridge/Kernel'den ÖNCE var olmalı.
    // _reg (İSİMSİZ) ile kaydedilir → restartService adayı DEĞİL (restart = sessiz abonelik ölümü).
    // İlk kaydedilen olduğu için LIFO shutdown'da EN SON dispose olur → bridge/publisher'lar
    // kapanırken bus hâlâ ayaktadır. Bu PR'da bus'a publisher/consumer BAĞLANMAZ (W4 ayrı PR).
    _log('  › Platform Event Bus (ownership)');
    try {
      this._reg(startPlatformCoreEventBusWiring());
    } catch (e) {
      logError('SystemBoot:eventBusWiring', e);   // wiring zaten fail-soft; bu yalnız sözleşme ihlali için
    }

    // UI aktivite kaydedici (zamansız-modal avcısı) — EN ERKEN kurulur ki
    // disclaimer gibi boot-time modaller de yakalansın; kurulumda zaten açık
    // yüzeyler seed taramasıyla alınır. Yan-etkisiz gözlem (MutationObserver).
    _log('  › startUiActivityRecorder()');
    /* ARCH-06/F2 · DEFERABLE → AFTER_FIRST_FRAME.
       Kullanıcı etkinliği kaydı, ilk boyamadan ÖNCE kaydedilecek hiçbir
       etkinliği kaçırmaz: ilk boyama olmadan kullanıcı zaten dokunamaz.
       Cleanup LIFO yığınına adıyla teslim edilir. */
    bootDeferral.schedule({
      jobId: 'UiActivityRecorder', wave: 1, bootClass: 'DEFERABLE',
      trigger: 'AFTER_FIRST_FRAME', run: () => startUiActivityRecorder(),
    });

    // Olay izi (breadcrumb) — mod/OBD/ekran/hata/modal kronolojik hikâyesi.
    _log('  › startDiagnosticTrail()');
    /* ARCH-06/F2 · DEFERABLE → AFTER_FIRST_FRAME.
       Olay izi bir TANI genişliğidir; ilk kareden önceki birkaç yüz ms'lik
       breadcrumb kaybı kabul edilir — boot süresinin kendisi zaten
       `bootTimingRecorder` ile ÖLÇÜLÜYOR (o W1'de KALIR). */
    bootDeferral.schedule({
      jobId: 'DiagnosticTrail', wave: 1, bootClass: 'DEFERABLE',
      trigger: 'AFTER_FIRST_FRAME', run: () => startDiagnosticTrail(),
    });

    // Perf zaman serisi — oturum boyu termal/bellek/fps/lag halka tamponu (trend).
    // Düşük frekans (12s) + düşük-tier'da fps salvosu atlanır (ısı/CPU dostu).
    /* ⚠️ ARCH-06/F2 · ERTELENMEZ — BİLİNÇLİ.
       Perf zaman serisi boot'un KENDİSİNİ ölçer; ilk kareye ertelenirse
       açılışın en pahalı penceresi ölçüm dışı kalır ve F2'nin öncesi/sonrası
       karşılaştırması anlamsızlaşırdı. Maliyeti zaten düşüktür: 12 s aralık
       ve düşük-tier'da fps salvosu ATLANIR. */
    _log('  › startPerfSeries()');
    this._cleanups.push(startPerfSeries());

    // Runtime recovery policy is canonical; SystemBoot remains execution-only.
    runtimeRecoverySupervisor.configure(SYSTEM_BOOT_SERVICE_DESCRIPTORS, {
      currentEpoch: () => this._started && !this._aborted ? this._diagStarts : null,
      dependencyBlocker: () => null, // F3 has no proven runtime HARD edge in this registry snapshot.
      onStaleCompletion: noteStaleRecoveryCompletion,
      executeRestart: async (serviceId) => {
        if (serviceId !== 'VehicleDataLayer') return false;
        await this.restartService(serviceId);
        return this._started && !this._aborted;
      },
    });

    // runtimeManager: resource/zombie evidence only
    _log('  › runtimeManager.start()');
    runtimeManager.setZombieRestartCallback((key) => {
      this._handleWorkerCrash(key, key === 'VehicleCompute' ? 'VehicleDataLayer' : key);
    });
    runtimeManager.start();

    // safeStorage: native FS önbelleği yükle (idempotent — main.tsx'de zaten çağrıldı)
    _log('  › initSafeStorageAsync');
    await measureBootService('initSafeStorageAsync', 1, true, () => initSafeStorageAsync());

    // Medya otoritesi Mavi/UI mount'una bağlı değildir: boot lifecycle'ın
    // deterministik parçasıdır. Fonksiyon idempotent, cleanup LIFO güvenlidir.
    _log('  › Media playback authority');
    try {
      await measureBootService('startMediaAuthority', 1, true, () => startMediaAuthority());
      this._regNamed('media-authority', stopMediaAuthority);
      /* ARCH-06/F1: otorite KURULDU. Bu "çalma kullanılabilir" DEMEK DEĞİLDİR —
         native oturum kanıtı ayrı bir taştır (MEDIA_AUTHORITY_AVAILABLE) ve
         onu yalnız sahibi (media authority runtime) damgalayabilir. */
      markBootMilestone('MEDIA_AUTHORITY_INITIALIZED', 'SystemBoot:wave1:startMediaAuthority');
    } catch (e) {
      logError('SystemBoot:mediaAuthority', e);
    }

    /* P0-VDK-F5F — BOŞLUK SİCİLİ AÇILIŞ ADIMI.
       ⚠️ BİLEREK HİÇBİR ŞEY YÜKLEMEZ: açılışta araç kimliği HENÜZ ölçülmemiştir
       (parmak izi ancak OBD bağlanıp ECU'lar yanıt verdikten sonra kurulur).
       Global bir sicili "şimdilik" yüklemek, bir sonraki araca BAŞKA bir aracın
       tanı geçmişini taşımak olurdu. Bu adım yalnız ÖLÇÜM üretir: "geri yükleme
       denendi mi / ne zaman / hangi kapsamda". Gerçek hidrasyon araç kimliği
       ölçülünce `productionDiscovery` içinde yapılır. */
    _log('  › beginGapLedgerBoot (araç kimliği YOK — hidrasyon ERTELENDİ)');
    try {
      beginGapLedgerBoot(Date.now());
    } catch (e) {
      logError('SystemBoot:gapLedgerBoot', e);   // fail-soft: boot DURMAZ
    }

    /* ⚠️ ARCH-06/F2 · ERTELENMEZ — GÜVENLİK KARARI (ARCH-05 > boot hızı).
       F0 bunu DEFERABLE önermişti; F2'de kod OKUNDU ve öneri ÇÜRÜTÜLDÜ:
       `useExpertStore.assertWritesAllowed()` ilk satırında
       `if (!s.hydrated) return;` yapar — yani hidrasyon TAMAMLANMADAN kapı
       AÇIKTIR (fail-open). Ertelemek, o fail-open penceresini ilk kareye
       kadar UZATIRDI ve `writeLocked` bir cihazda kilitli olması gereken
       uzman yazımları geçebilirdi.
       Karar: BOOT_CRITICAL olarak W1'de KALIR. Hız için güvenlik feda edilmez. */
    _log('  › hydrateExpertTrustStore (BOOT_CRITICAL — ARCH-05 fail-open koruması)');
    await measureBootService('hydrateExpertTrustStore', 1, true, () => hydrateExpertTrustStore());
    if (this._aborted) return; // stop() async sırasında geldi → erken çık

    _log('  › hydrateSafetyBrainFromStorage');
    hydrateSafetyBrainFromStorage();

    /* ARCH-06/F2 · IDLE_ONLY. Topluluk verisi ilk ekranda GÖRÜNMEZ ve ağ
       işidir; ana döngü boşalınca kurulur. Cleanup adı KORUNUR ki LIFO
       kapanışında aynı kimlikle görünsün. */
    _log('  › initCommunityService → IDLE');
    bootDeferral.schedule({
      jobId: 'CommunityService', wave: 1, bootClass: 'IDLE_ONLY',
      trigger: 'IDLE',
      run: () => { initCommunityService(); return stopCommunityService; },
    });

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

    // MAVI-STT-CONTEXT-GRAMMAR: offline Vosk gramerinin bağlam sağlayıcılarını bağla.
    // YALNIZ salt-okunur senkron getter KAYDEDER — servis başlatmaz, timer açmaz,
    // durum kopyalamaz. Ağır import (nav/media/obd) BİLEREK burada durur: `voiceService`
    // grafiğine girerse obd/store zinciri sıcak tarafa sızar ve voice testleri yüklenemez
    // (ölçüldü — bkz. contextGrammarProviders.ts). Bağlanmazsa gramer tam sözlükte kalır
    // (fail-soft), bu yüzden kayıt boot'u bloklamaz. Yalnız fonksiyon referansı tutulduğu
    // için LIFO shutdown'da geri alınacak bir kaynak YOKTUR.
    _log('  › Grammar context providers');
    wireGrammarContext();

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
      recoveryRequest: ({ serviceId, reason, evidenceRef }) => {
        runtimeRecoverySupervisor.request({ requestId: `health:${serviceId}:${Date.now()}`, serviceId, source: 'HEALTH_MONITOR', faultDomain: 'VEHICLE_DATA', observedLifecycle: 'FAILED', observedReadiness: 'NOT_READY', observedHealth: 'FAILED', reason, lifecycleEpoch: this._diagStarts, faultEvidenceRef: evidenceRef, requestedAt: Date.now(), provenance: ['SystemHealthMonitor'] });
      },
      maxRestarts: 2,
    });

    healthMonitor.register({
      name:        'GPS',
      criticality: 'warning',
      deadlineMs:  20_000,
      alertTitle:  'GPS Sinyali Yok',
      alertMsg:    'Konum verisi alınamıyor — tünel veya sinyal kesintisi.',
    });

    // Otomatik marka-DID keşfi (VIN başına 1 kez, cache'li, nazik). Bağlantı stabil
    // sağlıklı olunca 2200-22FF'i tarar, yanıt veren DID + ham değerleri persist eder.
    // Sağlık bozulursa abort → çekirdek poll'u (RPM) boğmaz. Fail-soft; salt-okuma.
    _log('  › Auto DID discovery watcher');
    this._reg(startAutoDidWatcher());

    /* P0-VDK-F5H — ERKEN ARAÇ KİMLİĞİ. Tam araç taramasını BEKLEMEDEN, bağlantı
     * kısa süre kesintisiz sağlıklı olunca en çok ÜÇ salt-okunur kimlik DID'i
     * okur, değerin KARMASINI alır (ham değer saklanmaz), F4-C parmak izini
     * üretir ve F5-G bağlama noktasını çağırır → boşluk sicili ve yetenek
     * bölümü DOĞRU araca ERKEN hydrate olur. Ölçüm düşerse normal OBD akışı
     * ETKİLENMEZ (kullanılabilirlik kapısı DEĞİLDİR). Fail-soft; salt-okuma. */
    _log('  › Early vehicle identity watcher');
    this._reg(startEarlyIdentityWatcher());

    // Platform Core: Vehicle HAL runtime wiring (PR-W2) — store→provider→adapter→HAL AYNA modu.
    // Additive; Wave sırası bozulmaz. VehicleDataLayer'dan SONRA kaydedilir → LIFO shutdown'da
    // VDL'den ÖNCE kapanır (store hâlâ ayaktayken adapter dispose olur). Wiring fonksiyonu init
    // hatasını kendi içinde yutar (fail-soft); buradaki savunmacı catch YALNIZ sözleşme ihlali
    // (dışarı exception) için — çift-log YOK. HAL beslenir ama okuyan yok (tüketici migrasyonu W7).
    _log('  › Vehicle HAL wiring (Platform Core)');
    try {
      this._reg(startPlatformCoreVehicleHalWiring({ store: useVehicleStore }));
    } catch (e) {
      logError('SystemBoot:vehicleHalWiring', e);
    }

    // Platform Core: Vehicle HAL → Event Bus bridge (W4C). HAL wiring'den SONRA kaydedilir →
    // LIFO shutdown'da bridge, HAL wiring'den ve (Wave 1'deki) Event Bus'tan ÖNCE dispose olur,
    // yani bridge kapanırken HAL ve Bus hâlâ AYAKTA. Bus yoksa wiring sessizce no-op döner
    // (fail-soft). Bu PR'da bus'a ABONE YOK (consumer migration ayrı PR); throttle/coalescing W4D.
    _log('  › Vehicle HAL → Event Bus bridge (Platform Core)');
    try {
      this._reg(startPlatformCoreVehicleHalBridgeWiring());
    } catch (e) {
      logError('SystemBoot:vehicleHalBridgeWiring', e);   // wiring zaten fail-soft; sözleşme ihlali koruması
    }

    // Platform Core: Capability Registry runtime wiring (PR-W3) — providers→adapter→registry
    // AYNA modu. Additive; Wave sırası bozulmaz. Vehicle store'a BAĞIMSIZDIR (yalnız navigator +
    // deviceTier okur). Wiring fonksiyonu init hatasını kendi içinde yutar (fail-soft); buradaki
    // savunmacı catch YALNIZ sözleşme ihlali (dışarı exception) için — çift-log YOK. Registry
    // beslenir ama okuyan yok (tüketici migrasyonu ayrı PR); yalnız yan-etkisiz browser-API kanıtı.
    _log('  › Capability Registry wiring (Platform Core)');
    try {
      this._reg(startPlatformCoreCapabilityWiring());
    } catch (e) {
      logError('SystemBoot:capabilityWiring', e);
    }

    // Platform Core: Capability Registry → Event Bus bridge (W4). Capability wiring'den SONRA
    // kaydedilir → registry önce beslenir, bridge sonra abone olur; LIFO shutdown'da bridge,
    // registry wiring'den ve (Wave 1'deki) Event Bus'tan ÖNCE dispose olur → bridge kapanırken
    // Registry ve Bus hâlâ AYAKTA. Bus yoksa wiring sessizce no-op döner (fail-soft). Bu PR'da
    // bus'a ABONE YOK (consumer migration ayrı PR); capability değişimleri NADİR → hot-path yok.
    _log('  › Capability → Event Bus bridge (Platform Core)');
    try {
      this._reg(startPlatformCoreCapabilityBridgeWiring());
    } catch (e) {
      logError('SystemBoot:capabilityBridgeWiring', e);   // wiring zaten fail-soft; sözleşme ihlali koruması
    }

    // Platform Core: Deep Scan runtime ownership wiring (W5-1). HAL/Capability/Event Bus
    // wiring'lerden SONRA, intelligence servislerinden ÖNCE. YALNIZ sahiplik: orchestrator'ı
    // paylaşılan runtime/persistence/ignition singleton'larıyla KURAR ama ÇALIŞTIRMAZ (start/run
    // YOK, handler YOK, aktif sorgu YOK, tarama YOK). Ignition kaynağı yok → ignitionConfirmed
    // null → aktif fazlar (ileride başlatılırsa) fail-closed bloke. LIFO shutdown'da orchestrator
    // önce dispose olur; paylaşılan singleton'lar (başka tüketicileri olabilir) DISPOSE EDİLMEZ.
    _log('  › Deep Scan runtime ownership (Platform Core)');
    try {
      this._reg(startPlatformCoreDeepScanWiring());
    } catch (e) {
      logError('SystemBoot:deepScanWiring', e);   // wiring zaten fail-soft; sözleşme ihlali koruması
    }

    // SystemOrchestrator: VDL event'lerini UI sinyallerine dönüştürür
    _log('  › SystemOrchestrator');
    this._reg(startSystemOrchestrator());

    /* ARCH-06/F1 · VEHICLE_CORE_INITIALIZED — ALT YAPI ayakta.
       ⚠️ Bu taş "araç verisi var" DEMEZ: VDL ve adaptörler kurulmuş olabilir
       ama araç bağlı olmayabilir. Gerçek sinyal kanıtı AYRI bir taştır
       (`VEHICLE_DATA_FIRST_OBSERVATION`) ve onu ölçümün sahibi damgalar. */
    markBootMilestone('VEHICLE_CORE_INITIALIZED', 'SystemBoot:wave2:complete');

    _log('Wave 2 ready ✓');
  }

  // ── Wave 3: Sensors & Intelligence ───────────────────────────────────────

  private async _wave3(): Promise<void> {
    _log('Starting Wave 3 (Sensors & Intelligence)...');

    /* ARCH-06/F2 · DEFERABLE → AFTER_VEHICLE_CORE.
       BAĞIMLILIK DENETİMİ: Wave 3'te hiçbir servis MaintenanceBrain'e
       bağlanmıyor (tüketicisi yok, üreticisi OBD olay akışı). Bakım hükmü
       aracın ilk saniyesinde GEREKMEZ. */
    _log('  › MaintenanceBrain → AFTER_VEHICLE_CORE');
    bootDeferral.schedule({
      jobId: 'MaintenanceBrain', wave: 3, bootClass: 'DEFERABLE',
      trigger: 'AFTER_VEHICLE_CORE', run: () => startMaintenanceBrain(),
    });

    /* Cihazda kanıt üretimi (#490 · ADR-286 Adım 3/1). Kendi timer'ı YOKTUR —
       OBD olayına biner. HÜKÜM ÜRETMEZ; motoru bağlamak ikinci parçadır. */
    _log('  › BatteryEvidenceSource');
    this._regNamed('BatteryEvidenceSource', startBatteryEvidenceSource());

    /* Motorun İLK üretim bağlantısı (#490 · ADR-286 Adım 3/2). Kanıt üretimi
       olayına biner — OBD hot-path'ine DEĞİL (#283 kesişim kuralı). Sıra
       önemli: kanıt kaynağı ÖNCE kurulmalı ki abonelik yakalansın. */
    _log('  › BatteryVerdictService');
    this._regNamed('BatteryVerdictService', startBatteryVerdictService());

    /* ARCH-06/F2 · DEFERABLE → AFTER_VEHICLE_CORE.
       BAĞIMLILIK DENETİMİ: Wave 3'te tüketicisi yok; yakıt önerisi mevcut
       veri akışına biner ve gecikmesi güvenlik etkisi ÜRETMEZ. */
    _log('  › FuelAdvisor → AFTER_VEHICLE_CORE');
    bootDeferral.schedule({
      jobId: 'FuelAdvisor', wave: 3, bootClass: 'DEFERABLE',
      trigger: 'AFTER_VEHICLE_CORE', run: () => startFuelAdvisor(),
    });

    _log('  › BlackBox');
    this._reg(startBlackBox());

    // BatteryProtection: 12V voltaj izleme + power ceiling
    _log('  › BatteryProtection');
    this._reg(startBatteryProtection());

    // VehicleIntelligenceService: SPE sensör plausibility + güven skoru
    _log('  › VehicleIntelligenceService');
    this._reg(startVehicleIntelligenceService());

    /* GuardianRuntime (GUARDIAN-AI-G16): Guardian çekirdeğinin TICK SAHİBİ.
       Kendi timer'ı YOKTUR — §L.0 tik-wheel'ine `scheduleTask` ile biner
       (taban 1000 ms · NORMAL · deferIdle KAPALI; gerekçe guardianTickPolicy.ts).
       Bu tur Guardian'a KALP ATIŞI verir, SES vermez: çıktı yalnız CAROS LAB'da
       gözlenir, sürücüye sunulmaz → aşırı ısınma/akü uyarısının ürün otoritesi
       (VehicleCompute.worker → SystemOrchestrator) DEĞİŞMEDİ, ikinci eylem
       otoritesi doğmaz. Fail-soft + zero-leak (cleanup _reg'le). */
    _log('  › GuardianRuntime');
    this._regNamed('GuardianRuntime', startGuardianRuntime());

    /* SpeedAlertRuntime (2026-08-14): "Arabam Cebimde" hız uyarısının araç ucu.
       Kendi timer'ı YOKTUR — mevcut veri akışlarına biner: BİRİNCİL füzyon hız
       otoritesi (`UnifiedVehicleStore.speed`, HAL>CAN>OBD>GPS), YEDEK doğrudan
       OBD akışı. Üç tüketici, TEK karar:
         (1) uzaktan lock/unlock'un sürüş kapısını besler (`updateCurrentSpeed`
             bugüne dek HİÇ çağrılmıyordu → kapı kördü; ilk turda yalnız OBD'ye
             bağlanmıştı → dongle'sız araçta HÂLÂ kördü),
         (2) ARAÇ İÇİNDEKİ sürücüyü uyarır — sunum otoritesi `SystemOrchestrator`
             (ikinci eylem otoritesi kurulmaz; ses/banner/geri-vites bastırma
             kararı orada, mevcut uyarı ailesiyle aynı yerde verilir),
         (3) eşleşmiş telefona bildirim gönderir.
       Fail-soft + zero-leak (cleanup _reg'le). */
    _log('  › SpeedAlertRuntime');
    setSpeedAlertPushChannel(notifyVehicleEvent);
    this._reg(startSpeedAlertRuntime({
      onSpeed:       updateCurrentSpeed,
      onDriverAlert: dispatchSpeedLimitExceeded,
    }));

    // AutomaticVehicleFingerprint (PR-26): araç bağlanınca VID+Discovery'den otomatik
    // fingerprint üret. Fail-soft + kimlik-imza guard (hot-path'e girmez); cleanup _reg'le.
    _log('  › AutomaticVehicleFingerprint');
    this._reg(startAutomaticVehicleFingerprint());

    // VehicleClassRuntime (VEHICLE_AWARE_SPEED_LIMIT P0): aracın YASAL sınıfını
    // (M1/N1 · otomobil/kamyonet/panelvan) çözer — uygulanabilir hız sınırı
    // bundan türer. Ağ çağrısı YALNIZ araç kimliği değişince ve backend proxy
    // yapılandırılmışsa yapılır; navigasyon tick'ine GİRMEZ. Fail-soft.
    /* ARCH-06/F2 · DEFERABLE → AFTER_VEHICLE_CORE.
       BAĞIMLILIK DENETİMİ: kendi yorumu "ağ çağrısı YALNIZ araç kimliği
       değişince" der ve navigasyon tick'ine GİRMEZ; Wave 3'te tüketicisi yok.
       Araç sınıfı ancak araç kimliği çözülünce anlamlıdır — o da bu taştan
       SONRA olur. */
    _log('  › VehicleClassRuntime → AFTER_VEHICLE_CORE');
    bootDeferral.schedule({
      jobId: 'VehicleClassRuntime', wave: 3, bootClass: 'DEFERABLE',
      trigger: 'AFTER_VEHICLE_CORE', run: () => startVehicleClassRuntime(),
    });

    // Konum Motoru (P1): mevcut gpsService'i GÖZLEMLER (değiştirmez/yeniden
    // başlatmaz) ve çok kaynaklı hakem kararını üretir. Fix akışı gpsService'in
    // kendi hızında devam eder; buradaki timer YALNIZ kaynak seçimi içindir.
    _log('  › LocationEngine');
    this._reg(startLocationEngine());

    // Navigasyon Oturum Runtime (SESSION CONTINUITY P0): rota ilerlemesinin
    // GÖRÜNÜMDEN BAĞIMSIZ tek tick sahibi. Eskiden bu tick FullMapView'ın kendi
    // GPS aboneliğindeydi → tam ekran kapanınca mesafe/ETA/adım/ses/reroute/varış
    // topluca DONUYORDU. Yeni motor/eşik YOK, yalnız sahiplik taşındı; timer YOK
    // (kadans GPS fix'inin kendi kadansı). LocationEngine'den SONRA kaydedilir →
    // LIFO shutdown'da ondan ÖNCE kapanır. Fail-soft + zero-leak (cleanup _reg'le).
    _log('  › NavigationSessionRuntime');
    this._regNamed('NavigationSessionRuntime', startNavigationSessionRuntime());

    // Trip yukleme kablolamasi (P1): tripLogService'i GOZLER (degistirmez) ve
    // YALNIZ kapanan trip icin tek kanonik ozet yukler. Canli olcum GONDERILMEZ.
    /* ARCH-06/F2 · IDLE_ONLY. Ağ yüklemesi; kapanan trip'i gözler ve canlı
       ölçüm GÖNDERMEZ. İlk ekranda hiçbir katkısı yok. */
    bootDeferral.schedule({
      jobId: 'TripUpload', wave: 3, bootClass: 'IDLE_ONLY',
      trigger: 'IDLE', run: () => startTripUpload(),
    });

    // Fleet geri-okuma köprüsü (kütük #690): `driverSnapshotRuntime.capture()`
    // yazılmıştı ama ÇAĞIRANI YOKTU → Fleet Driver Identity ekranı yapısal olarak
    // boştu. Köprü trip başına TEK ağ çağrısı yapar (yalnız active false→true
    // kenarında); TİMER YOK, polling YOK, hot-path'e girmez. Eşleşmemiş cihazda
    // çağrı HİÇ yapılmaz. Fail-soft: yolculuk akışını asla etkilemez.
    /* ARCH-06/F2 · IDLE_ONLY. Kendi yorumu "trip başına TEK ağ çağrısı,
       TİMER YOK, eşleşmemiş cihazda çağrı HİÇ yapılmaz" der — açılışta
       kurulması için hiçbir sebep yok. */
    _log('  › FleetReadback → IDLE');
    bootDeferral.schedule({
      jobId: 'FleetReadback', wave: 3, bootClass: 'IDLE_ONLY',
      trigger: 'IDLE', run: () => startFleetReadback(),
    });

    // Prediction Engine koşucusu (V-09): anayasanın 6. kapısı ("5 dk sonra ne
    // olacak?") fiilen kapalıydı — motor yazılı, üretimde 0 çağrı. Koşucu SOĞUK
    // YOLDA örnekler (15 sn; 3 Hz hot-path'e HİÇ dokunmaz) ama görev SAFETY
    // kritikliğinde kaydedilir: aşırı ısınma uyarısı düşük-uçta yavaşlatılmaz.
    // Fail-soft + zero-leak (cleanup _reg'le).
    _log('  › PredictionRuntime');
    this._reg(startPredictionRuntime());

    // Fleet Vehicle Identity koordinatörü (P1): üretici YUKARIDAKİ abonelik olduğu
    // için burada BAŞLATILACAK bir şey yok — yalnız kapatma kaydı gerekir, çünkü
    // koordinatör backoff'lu retry timer'ı tutabilir (zero-leak).
    this._reg(() => stopVehicleIdentityCoordinator());

    // AutoLearningEngine (PR-27): discovery gözlemlerini fingerprint'e bağlayıp öğren
    // (PID/DID seenCount/confidence) + staged VIN merge. Additive + fail-soft; cleanup _reg'le.
    _log('  › AutoLearningEngine');
    this._reg(startAutoLearningEngine());

    // VehicleKnowledgeBase (PR-28): öğrenilen bilgiyi araç bazlı yerel bilgi tabanına
    // (istatistik + kalıcı) organize et. SALT-OKUNUR projeksiyon; additive + fail-soft.
    _log('  › VehicleKnowledgeBase');
    this._reg(startVehicleKnowledgeBase());

    // VehicleLearningEvidenceBridge (P2-6): VKB güncellenince computeEvidence() → Evidence
    // Store'a idempotent yazar (debounce'lu cold-path). VKB'DEN SONRA başlar (ona bağlı).
    // 3Hz hot-path'e girmez; fail-soft + zero-leak (cleanup _reg'le).
    _log('  › VehicleLearningEvidenceBridge');
    this._reg(startVehicleLearningEvidenceBridge());

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
    /* ARCH-06/F2 · DEFERABLE → AFTER_SHELL_INTERACTIVE.
       STATİK veri tabanı yüklemesidir (Türkiye radar listesi) ve boot'ta
       senkron koşar. Radar uyarısı ancak araç HAREKET ederken anlamlıdır;
       kabuk etkileşimli olduktan sonra kurulması yeterlidir. Wave 3'te
       tüketicisi yok. */
    _log('  › RadarEngine → AFTER_SHELL_INTERACTIVE');
    bootDeferral.schedule({
      jobId: 'RadarEngine', wave: 3, bootClass: 'DEFERABLE',
      trigger: 'AFTER_SHELL_INTERACTIVE',
      run: () => { startRadarEngine(turkiyeStaticRadars); return stopRadarEngine; },
    });

    // CognitivePriorityEngine + LIMP_HOME izleyici
    _log('  › CognitivePriorityEngine');
    startCognitiveEngine();
    this._startLimpMonitor();

    // Platform Core: Deep Scan offline pass TRIGGER (W5-3b). Wave 2'deki ownership wiring
    // KURULDUKTAN SONRA, tek deterministik giriş noktasından offline pass'i EN FAZLA bir kez
    // tetikler (hash/dedup guard). HANDLER YOK → gerçek iş yapılmaz, aktif ECU/PID/DID sorgusu
    // YOK, üretim davranışı değişmez (runtime idle→running→idle). Fire-and-forget: boot'u
    // BLOKLAMAZ; trigger fail-soft (dışarı throw kaçırmaz), yine de savunmacı .catch.
    _log('  › Deep Scan offline pass trigger (Platform Core)');
    void triggerDeepScanOfflinePass().catch((e: unknown) => logError('SystemBoot:deepScanOfflineTrigger', e));

    /* ARCH-06/F1 · NAV_RUNTIME_INITIALIZED — navigasyon/konum motoru kuruldu.
       Konum FIX'i veya rota olduğu ANLAMINA GELMEZ; ilk konum kanıtı ayrı
       taştır (`NAV_LOCATION_AVAILABLE`) ve onu gpsService damgalar. */
    markBootMilestone('NAV_RUNTIME_INITIALIZED', 'SystemBoot:wave3:complete');

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

    /* ARCH-06/F2 · IDLE_ONLY. FCM TOKEN KAYDI ağ işidir ve boot'u BEKLETİR.
       ⚠️ GELEN BİLDİRİM KAYBOLMAZ: bu çağrı token'ı KAYDEDER, gelen mesajı
       DİNLEMEZ — inbound intent/deep-link yolu Android tarafında ve
       `incomingLocation` köprüsündedir (Wave 4'te AYNEN duruyor). Ertelenen
       yalnız kayıt turudur.
       Asenkron red `bootDeferral` içinde YAKALANIR ve kanıta yazılır;
       fire-and-forget bırakılmaz. Cleanup LIFO'ya adıyla teslim edilir. */
    _log('  › PushService → IDLE');
    bootDeferral.schedule({
      jobId: 'PushService', wave: 4, bootClass: 'IDLE_ONLY',
      trigger: 'IDLE',
      run: async () => {
        const cleanup = await initPushService();
        return cleanup;
      },
    });

    // VoiceService: modül-düzeyi singleton — cleanup'ı LIFO + namedCleanups'a kaydet
    _log('  › VoiceService (named cleanup)');
    this._regNamed('VoiceService', stopVoiceService);

    // CompanionEngine: proaktif motor + uyku önleyici (Faz 4 — 60s PromptScheduler).
    // Gate zinciri PROTECTION+ modlarda kendini susturur; LIMP_HOME'da ekstra
    // kayda gerek yok. companionEnabled kapalıysa tick no-op (ayar runtime izlenir).
    _log('  › CompanionEngine');
    startCompanionEngine();
    this._regNamed('CompanionEngine', stopCompanionEngine);

    // WakeWordService: ayar-tabanlı pasif wake (companion "Mavi"/legacy "hey car").
    // Modül-düzeyi store aboneliği — React mount'una bağlı değil (eskiden yalnız
    // useLayoutServices hook'undaydı; layout takılırsa wake hiç kurulmuyordu).
    // Native'de gerçek dinleme Vosk modeli hazır olana dek ERTELENİR (aşağıdaki
    // notifyVoskModelReady) — erken start "model yok" ile sağır kalıyordu.
    _log('  › WakeWordService');
    this._reg(startWakeWordService());

    // BackgroundPowerGate: arka plan + pil ile çalışırken GPS'i kısar, pasif
    // mikrofonu susturur (ölçüm 2026-08-20: 612 mAh/h, 16 saatte 169 dk deep
    // sleep). WakeWordService'ten SONRA kaydedilir → LIFO kapanışta ONDAN ÖNCE
    // sökülür, yani kapı kapanırken wake hâlâ ayaktadır ve kısma bırakılmaz.
    // Head unit etkilenmez: harici güç varken kapı kısma kararı üretmez.
    _log('  › BackgroundPowerGate');
    this._reg(startBackgroundPowerGate());

    // IncomingLocationBridge: WhatsApp/Telegram gibi uygulamalardan paylaşılan
    // konum (geo: / harita bağlantısı) aracın KENDİ navigasyonunda açılır.
    // Kurulmazsa ürün davranışı eskisi gibi kalır (fail-soft).
    _log('  › IncomingLocationBridge');
    this._reg(startIncomingLocationBridge());

    // Mavi Çekirdeği Faz-2 wiring (SHADOW/coexistence). WakeWordService + VoiceService'ten SONRA
    // kaydedilir → LIFO shutdown'da bunlardan ÖNCE dispose olur (köprü kapanırken voiceService
    // komut akışı hâlâ ayakta). Model A: pilot handler'lar no-op → mevcut komut davranışı DEĞİŞMEZ,
    // çifte yürütme YOK; yalnız lifecycle/telemetry/context/güvenlik-kapısı/feedback gölge çalışır.
    // Wiring fonksiyonu idempotent + fail-soft; savunmacı catch yalnız sözleşme ihlali için.
    _log('  › Mavi Voice Bridge (Faz-2 shadow wiring)');
    try {
      this._reg(startMaviVoiceWiring());
    } catch (e) {
      logError('SystemBoot:maviVoiceWiring', e);
    }

    // OTA güncelleme servisi: boot kontrolü + 6 saatlik poll (OTA v1 / Commit 6)
    /* ARCH-06/F2 · IDLE_ONLY. Güncelleme YOKLAMASI açılışta gerekmez.
       ⚠️ ERTELENEN yalnız YOKLAMADIR: `startOtaService` içindeki devam/kurtarma
       mantığı servisin KENDİSİNDEDİR ve kurulduğu anda koşar — IDLE'a taşımak
       onu iptal ETMEZ, yalnız birkaç saniye geciktirir. */
    _log('  › OtaUpdateService → IDLE');
    bootDeferral.schedule({
      jobId: 'OtaUpdateService', wave: 4, bootClass: 'IDLE_ONLY',
      trigger: 'IDLE', run: () => { startOtaService(); return stopOtaService; },
    });

    // Otomatik eşleştirme: eşlenmemiş cihaz tanı/telemetri gönderemiyordu
    // ("Tanı Gönder" → not_paired, admin tablosu boş). Saha veri toplama
    // fazı için sessiz self-pair — bir kez api_key alınca RemoteLogService
    // hattı çalışır. Fire-and-forget (boot ağ beklemez); başarısızsa sonraki
    // boot yeniden dener. Supabase env yoksa no-op.
    _log('  › DeviceAutoPair');
    void ensureDeviceRegistered();

    // Uzak log hattı: crashLogger sink kaydı + önceki oturum crash drain'i
    // (Remote Log v1 / Commit 2)
    _log('  › RemoteLogService');
    this._reg(startRemoteLogService());

    // AI Core runtime (Faz-2): edge-tetikli, BOUNDED AI Usta çalıştırması. Event Bus (Wave 1) +
    // HAL bridge (Wave 2) kurulduktan SONRA kaydedilir → getAppEventBus() + vehicleHal hazır;
    // LIFO shutdown'da bunlardan ÖNCE dispose olur (runtime kapanırken bus/HAL ayakta). Bus yoksa
    // wiring sessizce no-op döner (fail-soft). Salt-okuma (Orchestrator read-only Safety Gate →
    // ECU write/coding/actuator bloke); ai.mechanic.report yayınlar + result store. İKİNCİ POLLING/
    // OTORİTE YOK (yalnız edge-tetikli HAL okuma). Savunmacı catch yalnız sözleşme ihlali için.
    _log('  › AI Core runtime wiring (Faz-2)');
    try {
      this._reg(startPlatformCoreAiRuntimeWiring());
    } catch (e) {
      logError('SystemBoot:aiRuntimeWiring', e);
    }

    /* AI SAĞLAYICI HAZIRLIĞI — "anahtar var" ile "hazır" AYRI ölçülür.
       Boot'ta BİR KEZ; poll YOK. Erişilebilirlik sondası BİLİNÇLİ olarak
       VERİLMEZ: boot sırasında dış ağa çıkmak açılışı yavaşlatır ve kota
       harcar. Sonda yokken durum `CONFIGURED`de kalır — yani "anahtar var,
       erişim DOĞRULANMADI". Sahte `READY` ASLA üretilmez. */
    _log('  › AI provider readiness (config-only ölçüm)');
    try {
      /* ⚠️ `openRouterKeyService` DİNAMİK import edilir. Statik import
         SystemBoot'un modül grafiğine kimlik-bilgisi zincirini
         (`apiCredentialManager` → `credentialRegistry` → `aiVoiceService`)
         SOKUYOR ve `aiVoiceService`i kısmi mock'layan mevcut testleri
         kırıyordu (ÖLÇÜLDÜ: SystemBoot değişikliği geri alınınca geçiyorlar).
         Sonda zaten yalnız ölçüm anında çalışır — zinciri o ana ertelemek
         hem doğru hem de boot grafiğini hafifletir. */
      this._reg(startProviderReadiness(
        async () => {
          const m = await import('../ai/gateway/openRouterKeyService');
          return { configured: (await m.getOpenRouterKeyInfo()).configured };
        },
        null,
      ));
    } catch (e) {
      logError('SystemBoot:aiProviderReadiness', e);
    }

    // Vosk STT modelini boot sonrası arka planda ısıt — eskiden ilk mikrofon
    // basışında unpack+load (zayıf head unit CPU'sunda 20-40 sn) ödeniyor,
    // JS failsafe 14 sn'de pes edip "Dinliyorum"da takılı kalıyordu.
    // PERF 2026-06-11: 8 sn → 30 sn. 8 sn'de model unpack'i hâlâ süren boot
    // I/O'su + ilk render + OBD/CAN bağlantısıyla yarışıp Capacitor Bridge'i
    // tıkıyordu (10 sn'lik UI kilitlenmeleri). 30 sn'de sistem oturmuş olur.
    // AWAIT EDİLMEZ (fire-and-forget): boot zinciri AI modeli beklemez.
    // Fail-soft: preload başarısız olsa da ilk basışta normal yol (kuyruklu) çalışır.
    if (isNative) {
      if (typeof CarLauncher.preloadVoskModel === 'function') {
        const voskWarmTimer = setTimeout(() => {
          try {
            CarLauncher.preloadVoskModel!()
              // Model hazır → wake kapısını aç (bekleyen pasif dinleme başlar).
              .then(() => { _log('  › Vosk model preloaded ✓'); notifyVoskModelReady(); })
              // Başarısız olsa da kapıyı aç: native loop kendi ensureVoskModel
              // kuyruğuyla yükler — wake sonsuza dek sağır kalmaz (fail-soft).
              .catch((e: unknown) => { logError('SystemBoot:VoskPreload', e); notifyVoskModelReady(); });
          } catch (e) { logError('SystemBoot:VoskPreload', e); notifyVoskModelReady(); }
        }, 30_000);
        this._reg(() => clearTimeout(voskWarmTimer));
      } else {
        // Eski APK: preload metodu yok → kapıyı hemen aç (gate'i bekletme).
        notifyVoskModelReady();
      }
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
