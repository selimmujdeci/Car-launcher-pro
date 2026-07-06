/**
 * SystemHealthMonitor — Merkezi Watchdog (Automotive Grade §2 Sensor Resiliency)
 *
 * Sessiz çökmeleri (silent failures) tespit eder ve kullanıcıyı uyarır.
 * Servisler ya aktif olarak beat() çağırır, ya da pasif store abonelikleri
 * üzerinden otomatik izlenir.
 *
 * Çalışma akışı:
 *   1. SystemBoot servisleri register() ile kaydeder.
 *   2. Pasif izleyiciler (VehicleDataLayer, GPS) store değişimlerini dinler.
 *   3. Her 5s'de _tick() tüm servisleri kontrol eder.
 *   4. deadlineMs aşılırsa → ERROR_BUS kalıcı toast + isteğe bağlı restart.
 *   5. Servis geri gelirse (beat gelirse) → toast otomatik kapanır.
 *
 * Restart Koruması:
 *   maxRestarts kez denendikten sonra restart denenmez.
 *   Restart denemesi arasında RESTART_COOLDOWN_MS beklenir.
 *
 * Zero-Leak (CLAUDE.md §1):
 *   stop() tüm interval + abonelik referanslarını temizler.
 */

import { useUnifiedVehicleStore }   from '../vehicleDataLayer/UnifiedVehicleStore';
import { onGPSLocation, getGPSState } from '../gpsService';
import { getOBDStatusSnapshot }     from '../obdService';
import { showToast, dismissToast }  from '../errorBus';
import { logError }                 from '../crashLogger';
import { useCognitiveStore }        from '../../store/useCognitiveStore';
import { capturePanicSnapshot }     from './SystemPanicHandler';
import { thermalJournal }           from './ThermalJournal';
import { getEmmcWriteCount }        from '../../utils/safeStorage';
import { getAppVersionInfo }        from '../nativeCommandBridge';

// ── Uygulama Sürümü (OTA v1 / Commit 1 — device version truth) ───────────────
// Eski bug: VITE_APP_VERSION hiçbir yerde set edilmiyordu → ?? '1.0.0' fallback'i
// her cihazı sahte '1.0.0' raporlatıyor, RolloutCenter getRolloutHealth'ün
// appVersion filtresini (circuit breaker) kör bırakıyordu.
// Yeni sıra: native PackageManager (kurulu gerçek) > build-time enjeksiyon
// (vite.config define ← version.properties) > '0.0.0-unknown' (görünür körlük —
// asla gerçek sürüm gibi davranan sahte değer değil).
let _appVersion: string =
  (import.meta.env.VITE_APP_VERSION as string | undefined) ?? '0.0.0-unknown';

/** start() çağırır — native sürüm gelince build-time değeri ezilir (fire-and-forget). */
function _primeAppVersion(): void {
  void getAppVersionInfo()
    .then((info) => { if (info?.versionName) _appVersion = info.versionName; })
    .catch(() => { /* web/dev veya köprü hatası — build-time değer kalır */ });
}

/**
 * BUG FIX (SAHA): GPS izni KESİN reddedildiğinde gpsService.unavailable=true +
 * spesifik hata mesajı basar (bkz. gpsService.startNativeGPSTracking) — ama
 * heartbeat bazlı `healthy` hesaplaması bunu YOK SAYIYORDU: kayıt anına
 * (register()) yakın bir lastBeat varsa deadlineMs dolmadığı için "healthy:true"
 * görünüyordu, saha raporunda "GPS healthy:true" + "permission denied" çelişkisi
 * buradan geliyordu. Fail-soft: GPS state API'sine erişilemezse false (eski
 * davranış — heartbeat tek başına karar verir).
 */
function _isGpsPermissionDenied(): boolean {
  try {
    const s = getGPSState();
    return s.unavailable === true && s.error === 'GPS permission denied';
  } catch {
    return false;
  }
}

// ── Sabitler ─────────────────────────────────────────────────────────────────

const WATCHDOG_INTERVAL_MS        = 5_000;          // watchdog tick aralığı
const ALERT_COOLDOWN_MS           = 60_000;          // aynı servis için uyarı yenileme süresi
const RESTART_COOLDOWN_MS         = 10_000;          // restart denemeleri arası minimum bekleme
const MAX_RESTARTS_DEFAULT        = 2;
const STARTUP_GRACE_MS            = 45_000;          // uygulama açılışta GPS fix almadan önce uyarı basılmaz
/** Critical servislerde zorla restart eşiği — 30s sessizlik = process killer devreye girer */
const CRITICAL_FORCE_RESTART_MS   = 30_000;
/** Soak Test: her 1 saatte bir rastgele OPTIONAL servis restart edilir */
const SOAK_TEST_INTERVAL_MS       = 60 * 60 * 1_000;
/** UI Thread Watchdog — 8s eşiği: düşük segment cihazlarda harita yükü sırasında false-alarm engeli */
const UI_FREEZE_THRESHOLD_MS      = 8_000;
const UI_FREEZE_CHECK_INTERVAL_MS = 8_100; // eşikten biraz fazla → false-alarm engeli

// ── Tipler ────────────────────────────────────────────────────────────────────

export type ServiceCriticality = 'critical' | 'warning';

export interface GlobalHealthSnapshot {
  ts:                  number;
  thermalLevel:        0|1|2|3;
  /** JS heap kullanım oranı 0.0–1.0 (performance.memory yoksa 0) */
  ramPressureRatio:    number;
  workerRestartTotal:  number;
  uiFreezeCount:       number;
  /** eMMC disk yazma sayacı — filodaki her araç için bağımsız periyodik sıfırlama */
  emmcWriteCount:      number;
  /** emmcWriteCount'un sıfırlandığı andan bu yana geçen süre (ms) */
  emmcWriteSinceMs:    number;
  appVersion:          string;
  services: Array<{
    name:         string;
    healthy:      boolean;
    restartCount: number;
    criticality:  ServiceCriticality;
    /** Yalnız healthy=false iken ve nedeni heartbeat DIŞI bir sinyalse dolu (örn. GPS izni reddedildi). */
    unhealthyReason?: string;
  }>;
  overallHealth: 'healthy' | 'degraded' | 'critical';
}

export interface ServiceConfig {
  /** Servis adı — beat() çağrısında kullanılır */
  name:          string;
  /** critical: error toast; warning: warning toast */
  criticality:   ServiceCriticality;
  /** Bu süre boyunca sinyal gelmezse alarm tetiklenir (ms) */
  deadlineMs:    number;
  /** ERROR_BUS toast başlığı */
  alertTitle:    string;
  /** ERROR_BUS toast mesajı */
  alertMsg:      string;
  /** Servis yeniden başlatma fonksiyonu (opsiyonel) */
  restartFn?:    () => Promise<void>;
  /** Maksimum restart denemesi */
  maxRestarts?:  number;
}

interface WatchEntry extends Required<Pick<ServiceConfig, 'maxRestarts'>> {
  name:          string;
  criticality:   ServiceCriticality;
  deadlineMs:    number;
  alertTitle:    string;
  alertMsg:      string;
  restartFn?:    () => Promise<void>;
  lastBeat:      number;  // performance.now()
  alertId:       string | null;
  alertedAt:     number;  // performance.now()
  restartCount:  number;
  lastRestartAt: number;  // performance.now()
}

// ── SystemHealthMonitor ────────────────────────────────────────────────────────

class SystemHealthMonitor {
  private _registry    = new Map<string, WatchEntry>();
  private _timer:        ReturnType<typeof setInterval> | null = null;
  private _unsubs:       Array<() => void> = [];
  private _startedAt   = 0;
  /** Hiç heartbeat almamış servisler — cold-start false-alarm koruması */
  private _neverBeaten = new Set<string>();
  /** Soak Test Mode — her 1 saatte bir rastgele OPTIONAL servis restart eder */
  private _soakTestActive = false;
  private _soakTestTimer: ReturnType<typeof setInterval> | null = null;
  /** UI Thread Watchdog state */
  private _uiRafId:      number | null = null;
  private _uiRafLastMs   = 0;
  private _uiCheckTimer: ReturnType<typeof setInterval> | null = null;
  /** Oturum boyunca tespit edilen toplam UI donma olayı sayısı */
  private _uiFreezeCount = 0;
  /** Görünürlük değişimi (arka plan/uyku) sonrası bir sonraki UI ölçümünü atla —
   *  askıya alınan setInterval sahte "donma" üretmesin (saha 2026-07-07: 210s). */
  private _uiVisibilitySuspect = false;
  /** visibilitychange dinleyicisi — stop()'ta sökülür (zero-leak). */
  private _onUiVisibility: (() => void) | null = null;
  /** Worker GPS kalite arızası — aktif toast id + durum (setGpsQuality yönetir) */
  private _gpsQualityToastId: string | null = null;
  private _gpsQualityBad     = false;

  /**
   * Bir servisi izleme listesine ekle.
   * lastBeat = şu an (servis henüz başlamamış olsa da false-alarm olmaz).
   */
  register(config: ServiceConfig): void {
    this._registry.set(config.name, {
      name:          config.name,
      criticality:   config.criticality,
      deadlineMs:    config.deadlineMs,
      alertTitle:    config.alertTitle,
      alertMsg:      config.alertMsg,
      restartFn:     config.restartFn,
      maxRestarts:   config.maxRestarts ?? MAX_RESTARTS_DEFAULT,
      lastBeat:      performance.now(),
      alertId:       null,
      alertedAt:     0,
      restartCount:  0,
      lastRestartAt: 0,
    });
    // Servis kaydedilince "henüz hiç beat almadı" listesine ekle
    this._neverBeaten.add(config.name);
  }

  /** Servisten "yaşıyorum" sinyali — lastBeat güncellenir, aktif alert varsa kapatılır. */
  beat(name: string): void {
    const entry = this._registry.get(name);
    if (!entry) return;

    // İlk beat: cold-start korumasından çıkar
    this._neverBeaten.delete(name);

    entry.lastBeat = performance.now();

    if (entry.alertId) {
      dismissToast(entry.alertId);
      entry.alertId     = null;
      entry.restartCount = 0; // recovery → restart sayacı sıfırla
      if (import.meta.env.DEV) {
        console.info(`[HealthMonitor] ${name} recovered`);
      }
    }
  }

  /**
   * Worker GPS kalite arızası bildirimi (VehicleCompute → resolver → buraya).
   *
   * GPS "canlı" görünebilir (bozuk fix'ler bile location'ı değiştirip beat üretir);
   * bu yüzden kalite arızası deadline mekanizmasından bağımsız, kendi kalıcı
   * uyarısıyla bildirilir.
   *
   * @param ok        true = kalite normal, false = accuracy > 100m / NaN (20s)
   * @param accuracy  son ölçülen accuracy (m) — uyarı metni için (opsiyonel)
   */
  setGpsQuality(ok: boolean, accuracy?: number): void {
    if (ok) {
      if (!this._gpsQualityBad) return;
      this._gpsQualityBad = false;
      if (this._gpsQualityToastId) { dismissToast(this._gpsQualityToastId); this._gpsQualityToastId = null; }
      if (import.meta.env.DEV) console.info('[HealthMonitor] GPS quality recovered');
      return;
    }
    if (this._gpsQualityBad) return; // zaten bildirildi (tek-emit)
    this._gpsQualityBad = true;
    const accStr = Number.isFinite(accuracy ?? NaN) ? ` (~${Math.round(accuracy!)}m)` : '';
    this._gpsQualityToastId = showToast({
      type:     'warning',
      title:    'GPS Doğruluğu Düşük',
      message:  `Konum doğruluğu yetersiz${accStr} — navigasyon sapabilir.`,
      duration: 0,
    });
    logError('HealthMonitor:GPSQuality', new Error(`GPS accuracy degraded${accStr}`));
  }

  /** Watchdog ve pasif izleyicileri başlat. start() → stop() idempotent. */
  start(): void {
    if (this._timer) return;
    this._startedAt = performance.now();
    _primeAppVersion();
    this._setupPassiveMonitoring();
    this._timer = setInterval(() => { this._tick(); }, WATCHDOG_INTERVAL_MS);
    this._startUiWatchdog();
  }

  /** Tüm kaynakları serbest bırak. */
  stop(): void {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    this._stopUiWatchdog();
    this.disableSoakTest();
    this._unsubs.forEach((fn) => fn());
    this._unsubs = [];

    // Açık toastları kapat — stop = intentional shutdown, uyarı gösterme
    for (const entry of this._registry.values()) {
      if (entry.alertId) { dismissToast(entry.alertId); entry.alertId = null; }
    }
    // GPS kalite uyarısını da kapat
    if (this._gpsQualityToastId) { dismissToast(this._gpsQualityToastId); this._gpsQualityToastId = null; }
    this._gpsQualityBad = false;
    this._neverBeaten.clear();
  }

  // ── Soak Test Mode ────────────────────────────────────────────────────────────

  /**
   * Soak Test'i etkinleştir.
   * Her 1 saatte bir rastgele bir OPTIONAL (warning criticality) servisi
   * requestIdleCallback üzerinden restart eder.
   * Amaç: 12 saatlik vardiyada sistemin 'resilience' kapasitesini ölçmek.
   * UI thread asla bloke olmaz (Zero-Overhead).
   */
  enableSoakTest(): void {
    if (this._soakTestActive) return;
    this._soakTestActive = true;
    console.info('[HealthMonitor:SoakTest] Etkinleştirildi — her 1 saatte bir rastgele servis restart edilecek');
    this._soakTestTimer = setInterval(() => {
      this._runSoakTestTick();
    }, SOAK_TEST_INTERVAL_MS);
  }

  disableSoakTest(): void {
    this._soakTestActive = false;
    if (this._soakTestTimer) { clearInterval(this._soakTestTimer); this._soakTestTimer = null; }
  }

  /**
   * Soak Test tick — kritik altyapı (VehicleDataLayer, GPS) hariç,
   * restartFn'i olan OPTIONAL servisleri rastgele seçer ve restart eder.
   */
  private _runSoakTestTick(): void {
    const INDESTRUCTIBLE = new Set(['VehicleDataLayer', 'GPS']);
    const candidates = [...this._registry.values()].filter(
      (e) => e.restartFn && !INDESTRUCTIBLE.has(e.name) && e.criticality !== 'critical',
    );
    if (candidates.length === 0) return;

    const target = candidates[Math.floor(Math.random() * candidates.length)];
    console.info(`[HealthMonitor:SoakTest] Hedef: ${target.name} — restart başlatılıyor`);

    const doRestart = () => {
      target.restartCount++;
      target.lastRestartAt = performance.now();
      void target.restartFn!().then(() => {
        console.info(`[HealthMonitor:SoakTest] ${target.name} başarıyla restart edildi`);
        target.restartCount = 0; // soak-test restart'ı production sayacını kirletmez
      }).catch((e: unknown) => {
        logError(`HealthMonitor:SoakTest:${target.name}`, e);
      });
    };

    if (typeof requestIdleCallback !== 'undefined') {
      requestIdleCallback(doRestart, { timeout: 5_000 });
    } else {
      setTimeout(doRestart, 0);
    }
  }

  // ── UI Thread Watchdog ────────────────────────────────────────────────────────

  /**
   * requestAnimationFrame döngüsü ile UI thread'in yanıt verdiğini izler.
   * setInterval donma sonrası event-loop açılınca son frame gap'ini ölçer.
   * 8s eşiği → düşük segment cihazlarda harita yükü sırasındaki false-alarm'ları bastırır.
   */
  private _startUiWatchdog(): void {
    // PERF 2026-06-17: UI (ana JS thread) donma izleme artık setInterval-DRIFT ile.
    // Eski sürüm her frame requestAnimationFrame ile heartbeat atıyordu (kalıcı 60fps
    // döngü) → WebView'ı SÜREKLI composite ettirip idle'da yüksek CPU + harita sürekli
    // render yan etkisi yaratıyordu (cihaz profili: idle'da ~%50+ CPU bu döngüdendi).
    // Drift yöntemi: periyodik timer kendi GECİKMESİNİ ölçer — ana thread bloklanırsa
    // timer geç ateşler, gecikme = donma süresi. Hem ~sıfır idle CPU, hem daha doğru
    // (arka planda rAF durması artık sahte "donma" üretmez).
    this._uiRafLastMs = performance.now();

    // ARKA PLAN/UYKU GUARD (saha 2026-07-07): drift yöntemi setInterval'e geçince
    // "arka planda sahte donma üretmez" varsayıldı — YANLIŞ. Android WebView app'i
    // backgrounded/ekran-kapalı olunca setInterval'i de askıya alır; app dönünce
    // tek tick devasa boşluk ölçüp sahte "UI freeze 210s" basıyordu (panic snapshot
    // + thermal panic marker + escalation Step 0 tetikliyordu). Görünürlük her
    // değiştiğinde (iki yönde de) bir sonraki ölçümü işaretle → askı süresi donma
    // sayılmaz. Gerçek foreground donması görünürlüğü değiştirmez → yakalanmaya devam.
    if (typeof document !== 'undefined' && !this._onUiVisibility) {
      this._onUiVisibility = () => {
        this._uiVisibilitySuspect = true;
        this._uiRafLastMs = performance.now(); // taban sıfırla (askı süresini sayma)
      };
      document.addEventListener('visibilitychange', this._onUiVisibility);
    }

    this._uiCheckTimer = setInterval(() => {
      const now   = performance.now();
      const gapMs = now - this._uiRafLastMs;   // bu tick gerçekte ne kadar sonra ateşledi
      this._uiRafLastMs = now;
      // Görünürlük yakın zamanda değiştiyse VEYA şu an gizliyse: timer askıya alınmış
      // olabilir → ölçülen boşluk askı süresidir, gerçek donma DEĞİL → bu ölçümü at.
      const hidden = typeof document !== 'undefined' && document.hidden;
      if (this._uiVisibilitySuspect || hidden) {
        this._uiVisibilitySuspect = false;
        return;
      }
      // Beklenen ~UI_FREEZE_CHECK_INTERVAL_MS; üstündeki fazla gecikme = ana thread donması.
      const frozenMs = gapMs - UI_FREEZE_CHECK_INTERVAL_MS;
      if (frozenMs > UI_FREEZE_THRESHOLD_MS) {
        this._uiFreezeCount++;
        const freezeSec = (frozenMs / 1000).toFixed(1);
        console.warn(
          `[HealthMonitor:UIWatchdog] HEARTBEAT_UI_FREEZE — UI thread ${freezeSec}s dondu`,
        );
        console.warn(`[HealthMonitor:Escalation] Step 0: UI Thread Freeze Detected (${freezeSec}s)`);
        logError('HealthMonitor:UIFreeze', new Error(`UI thread frozen for ${freezeSec}s`));
        thermalJournal.addPanicMarker(`ui_freeze:${freezeSec}s`);
        void capturePanicSnapshot(`ui_freeze:${freezeSec}s`);
      }
    }, UI_FREEZE_CHECK_INTERVAL_MS);
  }

  private _stopUiWatchdog(): void {
    if (this._uiRafId !== null) { cancelAnimationFrame(this._uiRafId); this._uiRafId = null; }
    if (this._uiCheckTimer !== null) { clearInterval(this._uiCheckTimer); this._uiCheckTimer = null; }
    if (this._onUiVisibility && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this._onUiVisibility);
    }
    this._onUiVisibility = null;
    this._uiVisibilitySuspect = false;
  }

  // ── Pasif İzleyiciler ────────────────────────────────────────────────────────

  /**
   * VehicleDataLayer: speed veya fuel değişimi → worker + OBD hattı sağlıklı.
   * GPS: location değişimi → GPS servisi sağlıklı (DR güncellemeleri de sayılır).
   */
  private _setupPassiveMonitoring(): void {
    let _prevSpeed: number | null | undefined = undefined;
    let _prevFuel:  number | null | undefined = undefined;
    let _prevLoc    = useUnifiedVehicleStore.getState().location;

    const unsub1 = useUnifiedVehicleStore.subscribe((state) => {
      // VehicleDataLayer: speed/fuel değişimi VEYA GPS location değişimi
      // OBD bağlı değilse GPS location güncellemesi de "sistem sağlıklı" demektir
      const locationChanged = state.location !== _prevLoc;
      if (state.speed !== _prevSpeed || state.fuel !== _prevFuel || locationChanged) {
        _prevSpeed = state.speed;
        _prevFuel  = state.fuel;
        this.beat('VehicleDataLayer');
      }
      // GPS: location referans değişimi (DR güncellemelerini de kapsar)
      if (locationChanged) {
        _prevLoc = state.location;
        this.beat('GPS');
      }
    });

    // GPS servisinin onGPSLocation kanalı — store'un bir adım önündeki ham sinyal
    const unsub2 = onGPSLocation((loc) => {
      if (loc) this.beat('GPS');
    });

    this._unsubs.push(unsub1, unsub2);
  }

  // ── Watchdog Tick ─────────────────────────────────────────────────────────────

  private _tick(): void {
    const now = performance.now();

    // Startup grace: GPS cold-start takes up to 45s — no alerts during this window
    if (now - this._startedAt < STARTUP_GRACE_MS) return;

    for (const entry of this._registry.values()) {
      const elapsed = now - entry.lastBeat;
      const isDead  = elapsed > entry.deadlineMs;

      if (!isDead) continue;

      // Cold-start koruması: servis hiç heartbeat göndermemişse (donanım hiç bağlanmadı)
      // → alert basma. Sadece bağlıyken kopan servisler için alert tetiklenir.
      if (this._neverBeaten.has(entry.name)) continue;

      // GPS intentionally unavailable → uyarı sustur
      if (entry.name === 'GPS' && useUnifiedVehicleStore.getState().gpsUnavailable) continue;

      // B: Suppress GPS alert when native GPS has a fresh fix — passive monitor may have missed ticks
      // (e.g. fallback fired once then went static, but real GPS is actually delivering)
      if (entry.name === 'GPS') {
        const { location } = useUnifiedVehicleStore.getState();
        if (
          location &&
          Number.isFinite(location.latitude) &&
          Number.isFinite(location.longitude) &&
          (Date.now() - location.timestamp) < 30_000
        ) {
          entry.lastBeat = now;
          continue;
        }
      }

      // C: VehicleDataLayer — GPS fresh = data layer alive. OBD missing alone must not block.
      if (entry.name === 'VehicleDataLayer') {
        const { location } = useUnifiedVehicleStore.getState();
        if (
          location &&
          Number.isFinite(location.latitude) &&
          Number.isFinite(location.longitude) &&
          (Date.now() - location.timestamp) < 30_000
        ) {
          entry.lastBeat = now;
          continue;
        }
      }

      // Aktif uyarı ve cooldown süresi dolmadıysa → sessiz kal
      if (entry.alertId && (now - entry.alertedAt) < ALERT_COOLDOWN_MS) continue;

      // Önceki uyarıyı kapat (yenileme)
      if (entry.alertId) {
        dismissToast(entry.alertId);
        entry.alertId = null;
      }

      // Uyarı fırlat — kalıcı (duration: 0)
      entry.alertId  = showToast({
        type:     entry.criticality === 'critical' ? 'error' : 'warning',
        title:    entry.alertTitle,
        message:  entry.alertMsg,
        duration: 0,
      });
      entry.alertedAt = now;

      logError(
        `HealthMonitor:${entry.name}`,
        new Error(`No heartbeat for ${(elapsed / 1000).toFixed(0)}s`),
      );

      // Restart dene — UI thread asla bloke edilmez (requestIdleCallback)
      if (
        entry.restartFn &&
        entry.restartCount < entry.maxRestarts &&
        (now - entry.lastRestartAt) > RESTART_COOLDOWN_MS
      ) {
        const isCriticalForce =
          entry.criticality === 'critical' && elapsed > CRITICAL_FORCE_RESTART_MS;

        entry.restartCount++;
        entry.lastRestartAt = now;

        const attempt  = entry.restartCount;
        const svcName  = entry.name;
        const elapsedS = (elapsed / 1000).toFixed(0);

        // ── Escalation Ladder ──────────────────────────────────────────────────
        // attempt 1: sessiz restart
        // attempt 2: CRITICAL moduna geç (medya + opsiyonel sistemler kapanır)
        if (attempt === 1) {
          console.warn(`[HealthMonitor:Escalation] Step 1: Silent Restart — ${svcName}`);
        } else if (attempt >= 2) {
          console.warn(`[HealthMonitor:Escalation] Step 2: CRITICAL Mode Activated — ${svcName}`);
          useCognitiveStore.getState().setMode('CRITICAL');
        }

        console.warn(
          isCriticalForce
            ? `[HealthMonitor:Watchdog] ${svcName} ${elapsedS}s sessiz → zorla yeniden başlatılıyor`
            : `[HealthMonitor] Restarting ${svcName} (attempt ${attempt}/${entry.maxRestarts})`,
        );

        const doRestart = () => {
          void entry.restartFn!().then(() => {
            if (import.meta.env.DEV) {
              console.info(`[HealthMonitor] ${svcName} restart tamamlandı`);
            }
          }).catch((e: unknown) => {
            logError(`HealthMonitor:Restart:${svcName}`, e);
          });
        };

        if (typeof requestIdleCallback !== 'undefined') {
          requestIdleCallback(doRestart, { timeout: isCriticalForce ? 1_000 : 5_000 });
        } else {
          setTimeout(doRestart, 0);
        }
      } else if (entry.restartFn && entry.restartCount >= entry.maxRestarts) {
        // ── Ladder Step 3: restart limiti doldu ──────────────────────────────
        const svcName = entry.name;
        console.warn(`[HealthMonitor:Escalation] Step 3: Panic Snapshot + User Toast — ${svcName} max restarts exceeded`);
        showToast({
          type:     'warning',
          title:    'Güvenli Sürüş Modu Aktif',
          message:  'Sistem kendini yeniledi. Sürüşünüz korunuyor.',
          duration: 5_000,
        });
        void capturePanicSnapshot(`watchdog_max_restarts:${svcName}`);
      }
    }
  }

  /**
   * Mevcut sistem sağlık durumunun anlık görüntüsünü döner.
   * Supabase telemetri push'u ve Super Admin HealthCenter tarafından kullanılır.
   */
  getGlobalHealthSnapshot(): GlobalHealthSnapshot {
    const now = performance.now();

    // Termal seviye — ThermalJournal son kaydedilen seviyeyi tutar
    const thermalLevel = thermalJournal.getLastLevel();

    // RAM baskısı — Chrome/Android WebView'da performance.memory mevcuttur
    type PerfWithMemory = Performance & {
      memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number };
    };
    const mem = (performance as PerfWithMemory).memory;
    const ramPressureRatio = mem && mem.jsHeapSizeLimit > 0
      ? Math.min(1, mem.usedJSHeapSize / mem.jsHeapSizeLimit)
      : 0;

    let restartTotal = 0;
    const services: GlobalHealthSnapshot['services'] = [];
    // STARTUP_GRACE_MS geçmeden izin-reddi kesinleşmemiş sayılır (cold-start koruması
    // ile aynı pencere) — erken "healthy:false" false-alarm olmasın.
    const gpsDenied = (now - this._startedAt >= STARTUP_GRACE_MS) && _isGpsPermissionDenied();
    for (const e of this._registry.values()) {
      restartTotal += e.restartCount;
      const heartbeatHealthy = (now - e.lastBeat) < e.deadlineMs;
      const isGpsDenied = e.name === 'GPS' && gpsDenied;
      services.push({
        name:         e.name,
        healthy:      isGpsDenied ? false : heartbeatHealthy,
        restartCount: e.restartCount,
        criticality:  e.criticality,
        ...(isGpsDenied ? { unhealthyReason: 'gps_permission_denied' } : {}),
      });
    }

    // ── Beklenen-yokluk (fail-soft rollup) ─────────────────────────────────
    // Pasif monitörler (GPS/VehicleDataLayer) araçta HİÇ veri kaynağı yokken
    // unhealthy olması BEKLENEN — bu "critical sistem arızası" DEĞİL, araç bağlı
    // değil. Alert/restart tarafı cold-start (_neverBeaten) ile ayrıca susturulur;
    // snapshot rollup'ı da aynı posture'ı yansıtmalı, yoksa OBD/GPS'siz HER cihaz
    // (tezgah/telefon/ilk boot) tanıda sahte 'critical' gösterir (saha bulgusu
    // 2026-07-06). Servis DETAYI ham/dürüst kalır (healthy=false görünür); yalnız
    // rollup yumuşar. KAYNAK VARKEN kopma (OBD bağlı→error) yine gerçek 'critical'.
    const vs  = useUnifiedVehicleStore.getState();
    const loc = vs.location;
    const freshLocation = !!(
      loc &&
      Number.isFinite(loc.latitude) &&
      Number.isFinite(loc.longitude) &&
      (Date.now() - loc.timestamp) < 30_000
    );
    let obdPresent = false;
    try { obdPresent = getOBDStatusSnapshot().source !== 'none'; } catch { /* fail-soft */ }
    const noVehicleSource = !obdPresent && !freshLocation;
    const PASSIVE_MONITORS = new Set(['GPS', 'VehicleDataLayer']);
    const isExpectedAbsence = (name: string): boolean => {
      if (!PASSIVE_MONITORS.has(name)) return false;
      if (name === 'GPS' && vs.gpsUnavailable) return true;
      return noVehicleSource;
    };

    const hasCritical = services.some(
      (s) => !s.healthy && s.criticality === 'critical' && !isExpectedAbsence(s.name),
    );
    const hasDegraded = services.some((s) => !s.healthy);
    const overallHealth: GlobalHealthSnapshot['overallHealth'] = hasCritical
      ? 'critical'
      : hasDegraded ? 'degraded' : 'healthy';

    const emmc = getEmmcWriteCount();

    return {
      ts:                 Date.now(),
      thermalLevel,
      ramPressureRatio,
      workerRestartTotal: restartTotal,
      uiFreezeCount:      this._uiFreezeCount,
      emmcWriteCount:     emmc.count,
      emmcWriteSinceMs:   emmc.sinceMs,
      appVersion:         _appVersion,
      services,
      overallHealth,
    };
  }
}

export const healthMonitor = new SystemHealthMonitor();
