/**
 * AdaptiveRuntimeManager.ts — Adaptive Runtime Engine · Singleton Manager
 *
 * CLAUDE.md §1 Zero-Leak Memory Management:
 *   - Yükseltme (upgrade) timer'ı her zaman önce iptal edilir, sonra yeniden kurulur.
 *   - destroy() tüm timer ve listener'ları temizler.
 *   - subscribe() → her zaman cleanup thunk döner.
 *
 * Histerezis Kuralı:
 *   Downgrade (düşük rank'a geçiş) → anlık, güvenlik ve termal baskı beklemez.
 *   Upgrade   (yüksek rank'a geçiş) → 30 sn boyunca yeni talep gelmezse uygula.
 *   → Orta yolda yeni bir downgrade gelirse pending upgrade iptal edilir.
 *
 * CSS Çıktısı (:root üzerine):
 *   --rt-blur: 0 | 1   →  backdrop-filter blur aktif mi?  (Mali-400 GPU guard)
 *   --rt-anim: 0 | 1   →  CSS/JS animasyonlar aktif mi?
 *
 * Capability Detection (açılış):
 *   Worker      yoksa → BASIC_JS  (arka plan iş parçacığı desteği yok)
 *   SharedArrayBuffer yoksa → BASIC_JS  (çok iş parçacıklı bellek paylaşımı yok)
 *   Her ikisi de mevcut → BALANCED
 */

import { RuntimeMode, type RuntimeConfig } from './runtimeTypes';
import { getRuntimeConfig }                from './runtimeConfig';
import { safeGetRaw, safeSetRaw }          from '../../utils/safeStorage';
import { hasWeakGpu }                      from '../../utils/detectWeakGpu';
import { getDeviceTier }                   from '../../platform/deviceCapabilities';

/* ── Mod sıralaması (sayısal karşılaştırma) ─────────────────────── */

const MODE_RANK: Readonly<Record<RuntimeMode, number>> = {
  [RuntimeMode.SAFE_MODE]:   0,
  [RuntimeMode.POWER_SAVE]:  1,  // akü koruma — BASIC_JS'den bir adım aşağı
  [RuntimeMode.BASIC_JS]:    2,  // eski 1 → 2
  [RuntimeMode.BALANCED]:    3,  // eski 2 → 3
  [RuntimeMode.PERFORMANCE]: 4,  // eski 3 → 4
} as const;

/* ── Sabitler ────────────────────────────────────────────────────── */

const UPGRADE_DELAY_MS   = 30_000; // 30 saniye stabilite penceresi
/** Termal kısıtlama recovery için aynı süre (soğuma 30s stabil kaldıktan sonra kısıt kaldırılır) */
const THERMAL_RECOVERY_MS = 30_000;
/** Zombie Detection: worker'lara PING gönderme aralığı */
const ZOMBIE_PING_INTERVAL_MS = 10_000;
/** Zombie Detection: art arda kaç PING yanıtsız kalırsa worker zombie sayılır */
const ZOMBIE_MAX_MISSES = 3;

/**
 * Termal seviyeye karşılık gelen mod tavanı.
 * L0 = null (serbest), L1–L3 artan kısıtlama.
 * Not: Modül scope'unda tanımlandı; RuntimeMode import'tan önce değil.
 */
const _THERMAL_CEILING: readonly (RuntimeMode | null)[] = [
  null,                    // L0 — kısıtlama yok
  RuntimeMode.BALANCED,    // L1 (≥45°C) — BALANCED üstüne çıkış yasak
  RuntimeMode.BASIC_JS,    // L2 (≥55°C) — BASIC_JS üstüne çıkış yasak
  RuntimeMode.POWER_SAVE,  // L3 (≥65°C) — POWER_SAVE üstüne çıkış yasak
];

/** Crash-recovery: son aktif modu safeStorage'a yazarız; yeniden başlatmada okuruz. */
const PERSIST_KEY = 'rt-last-mode';

/* ── Tip tanımları ───────────────────────────────────────────────── */

/** setMode() çağrısının hangi kaynaktan geldiğini belirtir. */
export type ModeReason = string;

/**
 * Worker kritiklik sınıfı:
 *   CRITICAL  — VehicleCompute: her koşulda çalışır, bellek baskısında dokunulmaz.
 *   OPTIONAL  — VisionCompute, NavigationCompute: MODERATE/CRITICAL'da askıya alınır.
 */
export type WorkerCriticality = 'CRITICAL' | 'OPTIONAL';

interface WorkerEntry {
  worker:       Worker | null;
  criticality:  WorkerCriticality;
}

/** subscribe() callback imzası. */
export type ModeChangeListener = (
  mode:   RuntimeMode,
  config: RuntimeConfig,
  reason: ModeReason,
) => void;

/* ══════════════════════════════════════════════════════════════════
   AdaptiveRuntimeManager
══════════════════════════════════════════════════════════════════ */

class AdaptiveRuntimeManager {

  /* ── Singleton ──────────────────────────────────────────────── */

  private static _instance: AdaptiveRuntimeManager | null = null;

  static getInstance(): AdaptiveRuntimeManager {
    if (!AdaptiveRuntimeManager._instance) {
      AdaptiveRuntimeManager._instance = new AdaptiveRuntimeManager();
    }
    return AdaptiveRuntimeManager._instance;
  }

  /** Test ortamında instance sıfırla — prod kodu ASLA çağırmamalı. */
  static _resetForTest(): void {
    AdaptiveRuntimeManager._instance?.destroy();
    AdaptiveRuntimeManager._instance = null;
  }

  /* ── Instance state ─────────────────────────────────────────── */

  private _mode: RuntimeMode;

  /** Bekleyen yükseltme timer handle — Zero-Leak: destroy()'da temizlenir. */
  private _upgradeTimer: ReturnType<typeof setTimeout> | null = null;

  /** start() idempotency guard — birden fazla çağrıya karşı. */
  private _started = false;

  /** Akü voltaj tavanı — bu mod üstüne çıkış engellenir; null = kısıtlama yok. */
  private _powerCeiling: RuntimeMode | null = null;

  /** Anlık termal kısıtlama seviyesi (0–3). */
  private _thermalActiveLevel: 0|1|2|3 = 0;

  /** Termal recovery (kısıt gevşeme) timer handle. */
  private _thermalConstraintTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly _listeners = new Set<ModeChangeListener>();

  /** Worker registry: key → {worker, criticality} */
  private readonly _workers = new Map<string, WorkerEntry>();

  /** Zombie Detection state */
  private _zombiePingTimer:        ReturnType<typeof setInterval> | null = null;
  private readonly _pingPendingCounts   = new Map<string, number>();
  private readonly _workerMsgHandlers   = new Map<string, (e: MessageEvent) => void>();
  private readonly _pendingTerminateTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private _zombieRestartCallback: ((key: string) => void) | null = null;

  /* ── Constructor ────────────────────────────────────────────── */

  private constructor() {
    // Açılışta donanım yeteneklerini denetle
    this._mode = this._detectCapabilities();
    this._applyCSS(this._mode);
  }

  /* ══════════════════════════════════════════════════════════════
     Capability Detection
  ══════════════════════════════════════════════════════════════ */

  /**
   * Worker ve SharedArrayBuffer desteğini kontrol eder.
   *
   * Worker yoksa → arka plan iş parçacığı yok → BASIC_JS
   * SAB    yoksa → çok iş parçacıklı paylaşımlı bellek yok → BASIC_JS
   * Her ikisi var → BALANCED (termal ve kullanıcı sinyalleri daha sonra ayarlar)
   */
  private _detectCapabilities(): RuntimeMode {
    // Kanonik düşük donanım sınıfı (deviceCapabilities) → BASIC_JS. getDeviceTier()
    // GPU probe'una EK olarak ekran/çekirdek/RAM/WebView/Android/CSS sinyallerini de
    // değerlendirir; maskeli WebGL renderer'da hasWeakGpu yanılsa bile (örn. K24:
    // Android 15 / 6GB RAM ama Mali-400 + düşük çözünürlük) lowEndScreen/cores yakalar →
    // blur/animation açık kalmaz.
    if (getDeviceTier() === 'low') {
      return RuntimeMode.BASIC_JS;
    }

    // GPU sınıfı önce: CPU'da SAB/Worker olsa BİLE zayıf GPU (Mali-400 sınıfı
    // Utgard / yazılım render) backdrop-filter blur'u software path'te çalıştırır →
    // her kare GPU stall → "aşırı kasma". Böyle cihazlarda BASIC_JS tavanına in
    // (enableBlur=false → --rt-blur=0 → tüm cam/blur efektleri app genelinde kapanır).
    if (hasWeakGpu()) {
      return RuntimeMode.BASIC_JS;
    }

    const hasWorker = typeof Worker !== 'undefined';
    // typeof tek başına yetmez: SAB yalnızca crossOriginIsolated=true (COOP+COEP)
    // ortamında gerçekten kullanılabilir; aksi halde runtime'da hata fırlatır.
    const hasSAB =
      typeof SharedArrayBuffer !== 'undefined' &&
      typeof self !== 'undefined' && self.crossOriginIsolated === true;

    if (!hasWorker || !hasSAB) {
      return RuntimeMode.BASIC_JS;
    }
    return RuntimeMode.BALANCED;
  }

  /* ══════════════════════════════════════════════════════════════
     setMode — Histerezis Mantığı
  ══════════════════════════════════════════════════════════════ */

  /**
   * Yeni mod ister.
   *
   * Downgrade (rank düşüyor) → anlık uygula.
   *   Bekleyen upgrade varsa iptal edilir; güvenlik/termal sinyali beklemez.
   *
   * Upgrade (rank artıyor) → 30 sn stabilite bekle.
   *   Süre içinde yeni bir downgrade veya farklı upgrade gelirse timer sıfırlanır.
   *   30 sn dolunca mod uygulanır.
   *
   * Aynı mod → no-op.
   *
   * @param newMode  İstenen RuntimeMode
   * @param reason   Değişikliği tetikleyen kaynak (ör. 'thermal', 'user', 'auto')
   */
  setMode(newMode: RuntimeMode, reason: ModeReason): void {
    // Power ceiling (akü koruma): voltaj düşükse yüksek moda çıkmayı engelle
    if (this._powerCeiling !== null && MODE_RANK[newMode] > MODE_RANK[this._powerCeiling]) {
      newMode = this._powerCeiling;
    }

    if (newMode === this._mode) {
      // Hedef zaten aktif mod — bekleyen upgrade'i de iptal et (stabilize oldu)
      this._cancelUpgrade();
      return;
    }

    const isDowngrade = MODE_RANK[newMode] < MODE_RANK[this._mode];

    if (isDowngrade) {
      // ── Anlık downgrade ───────────────────────────────────────
      this._cancelUpgrade();
      this._commit(newMode, reason);
    } else {
      // ── Gecikmeli upgrade ─────────────────────────────────────
      // Önceki bekleyen upgrade'i iptal et (farklı hedef veya sıfırla)
      this._cancelUpgrade();

      this._upgradeTimer = setTimeout(() => {
        this._upgradeTimer = null;
        this._commit(newMode, reason);
      }, UPGRADE_DELAY_MS);
    }
  }

  /* ── Commit — mod uygula ve bildir ─────────────────────────── */

  private _commit(mode: RuntimeMode, reason: ModeReason): void {
    const prev = this._mode;
    this._mode = mode;
    this._applyCSS(mode);

    // Her mod değişimini logla — downgrade warn, upgrade info (adb logcat görünürlüğü)
    const isDowngrade = MODE_RANK[mode] < MODE_RANK[prev];
    (isDowngrade ? console.warn : console.info)(
      `[Runtime] runtime_mode_changed: ${prev} → ${mode} | reason=${reason}`,
    );

    // Crash recovery için son modu disk'e yaz (4 s debounce — mod geçişi yüksek frekanslı değil)
    safeSetRaw(PERSIST_KEY, mode);

    const config = getRuntimeConfig(mode);
    this._listeners.forEach(cb => cb(mode, config, reason));
  }

  /* ══════════════════════════════════════════════════════════════
     start() — Uygulama hazır olduğunda çağrılır (App.tsx useEffect)
  ══════════════════════════════════════════════════════════════ */

  /**
   * Runtime Engine'i devreye alır.
   * İdempotent — birden fazla çağrı güvenlidir.
   *
   * Crash Recovery:
   *   Önceki oturum SAFE_MODE'da kapandıysa (veya crash ettiyse)
   *   safeStorage bu bilgiyi tutar ve uygulama doğrudan SAFE_MODE'da başlar.
   *   Böylece sürekli crash döngüsü kırılır.
   */
  start(): void {
    if (this._started) return;
    this._started = true;

    const saved = safeGetRaw(PERSIST_KEY) as RuntimeMode | null;
    if (saved === RuntimeMode.SAFE_MODE) {
      console.warn(
        '[Runtime] crash-recovery: previous session ended in SAFE_MODE — starting in SAFE_MODE',
      );
      this._commit(RuntimeMode.SAFE_MODE, 'crash-recovery');
      return;
    }

    this._startZombieDetection();
    console.info(`[Runtime] started: mode=${this._mode}`);
  }

  /**
   * SystemBoot tarafından çağrılır — zombie tespit edilince hangi restart
   * mekanizmasını kullanacağını bağlar.
   */
  setZombieRestartCallback(cb: (key: string) => void): void {
    this._zombieRestartCallback = cb;
  }

  /* ── Upgrade timer temizleyici ──────────────────────────────── */

  private _cancelUpgrade(): void {
    if (this._upgradeTimer !== null) {
      clearTimeout(this._upgradeTimer);
      this._upgradeTimer = null;
    }
  }

  private _cancelThermalRecovery(): void {
    if (this._thermalConstraintTimer !== null) {
      clearTimeout(this._thermalConstraintTimer);
      this._thermalConstraintTimer = null;
    }
  }

  /* ══════════════════════════════════════════════════════════════
     CSS Injection — :root CSS değişkenleri
  ══════════════════════════════════════════════════════════════ */

  /**
   * :root üzerine CSS değişkenlerini yazar.
   *   --rt-blur:  0 = backdrop-filter kapalı (Mali-400 GPU guard)
   *               1 = açık
   *   --rt-anim:  0 = animasyonlar kapalı
   *               1 = açık
   *
   * Ayrıca `data-runtime` attribute debug ve CSS selector'ları için.
   */
  private _applyCSS(mode: RuntimeMode): void {
    if (typeof document === 'undefined') return; // SSR / test guard

    const config = getRuntimeConfig(mode);
    const root   = document.documentElement;

    root.style.setProperty('--rt-blur',  config.enableBlur       ? '1' : '0');
    root.style.setProperty('--rt-anim',  config.enableAnimations ? '1' : '0');
    root.setAttribute('data-runtime', mode);
  }

  /* ══════════════════════════════════════════════════════════════
     Power Ceiling API (Akü Koruma)
  ══════════════════════════════════════════════════════════════ */

  /**
   * Akü voltajı bazlı mod tavanı.
   *
   * ceiling !== null olduğunda setMode() bu modun üstüne çıkamaz.
   * Mevcut mod tavan üstündeyse anlık downgrade uygulanır (güvenlik).
   *
   * @param ceiling  Maksimum izin verilen RuntimeMode; null = kısıtlama yok
   */
  setPowerCeiling(ceiling: RuntimeMode | null): void {
    this._powerCeiling = ceiling;
    if (ceiling !== null && MODE_RANK[this._mode] > MODE_RANK[ceiling]) {
      // Mevcut mod tavan üstünde — bekleyen upgrade iptal, anlık downgrade
      this._cancelUpgrade();
      this._commit(ceiling, 'power-ceiling');
    }
  }

  /** Aktif güç tavanını döner (null = kısıtlama yok). */
  getPowerCeiling(): RuntimeMode | null {
    return this._powerCeiling;
  }

  /* ══════════════════════════════════════════════════════════════
     Thermal Constraint API
  ══════════════════════════════════════════════════════════════ */

  /**
   * Termal seviyeye göre runtime mod tavanını günceller.
   *
   * Eskalasyon (level artıyor) → anlık; mevcut mod tavan üstündeyse hemen düşürür.
   * Kurtarma (level düşüyor)   → 30s stabilite bekler; bu sürede yeni eskalasyon
   *   gelirse timer iptal edilir (erken çıkış önlenir).
   *
   * Circular bağımlılık: thermalWatchdog → runtimeManager (mevcut) zinciri korunur.
   * Bu metod thermalWatchdog'u import ETMEZ — çağıran (SystemOrchestrator) kablo kurar.
   *
   * @param level  ThermalLevel: 0 (soğuk) → 3 (kritik)
   */
  setThermalConstraint(level: 0|1|2|3): void {
    if (level === this._thermalActiveLevel) return;

    const isEscalation = level > this._thermalActiveLevel;
    this._thermalActiveLevel = level;

    if (isEscalation) {
      // Anlık uygula — bekleyen recovery iptal
      this._cancelThermalRecovery();
      this.setPowerCeiling(_THERMAL_CEILING[level]);
    } else {
      // Kurtarma: 30s stabilite bekle, sonra kısıtı gevşet
      this._cancelThermalRecovery();
      this._thermalConstraintTimer = setTimeout(() => {
        this._thermalConstraintTimer = null;
        this.setPowerCeiling(_THERMAL_CEILING[this._thermalActiveLevel]);
      }, THERMAL_RECOVERY_MS);
    }
  }

  /* ══════════════════════════════════════════════════════════════
     Public Read API
  ══════════════════════════════════════════════════════════════ */

  /** Aktif modu döner. */
  getMode(): RuntimeMode {
    return this._mode;
  }

  /** Aktif mod için RuntimeConfig döner. */
  getConfig(): RuntimeConfig {
    return getRuntimeConfig(this._mode);
  }

  /**
   * Bileşen arızası sinyal — mevcut moddan bir adım aşağı indirir.
   *
   * Kullanım: OBD disconnect, GPS kayıp, CAN timeout gibi servis
   * katmanı hataları bu metodu çağırarak sistemi koruyucu moda geçirir.
   *
   * Downgrade anında uygulanır (hysteresis bypass — güvenlik olayı).
   *
   * @param component  Arıza bildiren servis adı ('OBD', 'GPS', 'CAN' ...)
   */
  reportFailure(component: string): void {
    const rankOrder: RuntimeMode[] = [
      RuntimeMode.SAFE_MODE,
      RuntimeMode.POWER_SAVE,  // akü koruma basamağı
      RuntimeMode.BASIC_JS,
      RuntimeMode.BALANCED,
      RuntimeMode.PERFORMANCE,
    ];
    const currentRank = MODE_RANK[this._mode];
    if (currentRank > 0) {
      // Bir adım aşağı — SAFE_MODE'dan aşağısı yok
      const downgraded = rankOrder[currentRank - 1];
      this.setMode(downgraded, `failure:${component}`);
    }
  }

  /* ══════════════════════════════════════════════════════════════
     Observer API
  ══════════════════════════════════════════════════════════════ */

  /**
   * Mod değişimlerine abone ol.
   *
   * Her mod değişiminde `cb(mode, config, reason)` çağrılır.
   * Dönen thunk aboneliği iptal eder — useEffect cleanup'ında kullan.
   *
   * CLAUDE.md §1 Zero-Leak:
   *   Her subscribe() çağrısı bir cleanup thunk döner.
   *   Thunk çağrılmadan bileşen unmount olursa listener sızıntısı oluşur.
   *
   * @example
   * useEffect(() => {
   *   return runtimeManager.subscribe((mode, cfg) => {
   *     setGpsInterval(cfg.gpsUpdateMs);
   *   });
   * }, []);
   */
  subscribe(cb: ModeChangeListener): () => void {
    this._listeners.add(cb);
    return () => { this._listeners.delete(cb); };
  }

  /* ══════════════════════════════════════════════════════════════
     Kaynak Temizleme — Zero-Leak garantisi
  ══════════════════════════════════════════════════════════════ */

  /**
   * Manager'ı tam olarak temizler.
   *   - Bekleyen upgrade timer iptal edilir.
   *   - Tüm listener'lar kaldırılır.
   *   - DOM CSS değişkenleri ve attribute temizlenir.
   *
   * Singleton sıfırlama için `_resetForTest()` kullan;
   * bu metod sadece uygulama kapatma / test teardown için.
   */
  /* ══════════════════════════════════════════════════════════════
     Worker Lifecycle Registry
  ══════════════════════════════════════════════════════════════ */

  /**
   * Worker'ı kayıt altına al.
   * null worker da kabul edilir (crash sonrası referans temizliği için).
   *
   * @param key           Benzersiz isim ('VisionCompute', 'NavigationCompute', …)
   * @param worker        Worker instance veya null
   * @param criticality   CRITICAL = her zaman çalışır; OPTIONAL = RAM baskısında sonlandırılır
   */
  registerWorker(key: string, worker: Worker | null, criticality: WorkerCriticality): void {
    this._workers.set(key, { worker, criticality });

    // Önceki listener'ı temizle (registerWorker yeniden çağrılabilir)
    this._detachPongListener(key);

    if (worker) {
      // PONG mesajı gelince pending sayacını sıfırla
      const handler = (e: MessageEvent): void => {
        if (e.data?.type === 'PONG') {
          this._pingPendingCounts.set(key, 0);
        }
      };
      worker.addEventListener('message', handler);
      this._workerMsgHandlers.set(key, handler);
      this._pingPendingCounts.set(key, 0);
    }
  }

  /** Worker kaydını kaldır. stopVision / stopNavigation çağrılarında kullanılır. */
  unregisterWorker(key: string): void {
    this._detachPongListener(key);
    this._pingPendingCounts.delete(key);
    this._workers.delete(key);
  }

  private _detachPongListener(key: string): void {
    const existing = this._workerMsgHandlers.get(key);
    if (!existing) return;
    const entry = this._workers.get(key);
    if (entry?.worker) {
      try { entry.worker.removeEventListener('message', existing); } catch { /* noop */ }
    }
    this._workerMsgHandlers.delete(key);
  }

  /**
   * Kayıtlı worker'ların salt okunur görünümü.
   * Yüklenebilirlik farkındalığı için termal watchdog tarafından sorgulanır.
   * worker=null ise o worker crash etmiş veya RAM baskısında sonlandırılmıştır.
   */
  getWorkers(): ReadonlyMap<string, { readonly worker: Worker | null; readonly criticality: WorkerCriticality }> {
    return this._workers;
  }

  /**
   * Bellek baskısı bildirimi — memoryWatchdog tarafından çağrılır.
   * (Döngüsel bağımlılığı önlemek için memoryWatchdog buraya import yapılmaz;
   *  memoryWatchdog runtimeManager referansını alıp bu metodu çağırır.)
   *
   * MODERATE → OPTIONAL worker'ları sonlandır (VisionCompute vb.)
   * CRITICAL → tüm OPTIONAL + NavigationCompute sonlandır; sadece CRITICAL hayatta kalır
   */
  handleMemoryPressure(level: 'MODERATE' | 'CRITICAL'): void {
    console.warn(`[Runtime] memory pressure: ${level} — adjusting worker lifecycle`);

    for (const [key, entry] of this._workers.entries()) {
      if (entry.criticality === 'CRITICAL') continue; // VehicleCompute korunur

      if (level === 'MODERATE' || level === 'CRITICAL') {
        this._terminateWorkerEntry(key, entry);
      }
    }
  }

  private _terminateWorkerEntry(key: string, entry: WorkerEntry): void {
    if (!entry.worker) return;

    // PONG listener'ı temizle — terminate öncesi, yoksa dangling ref kalır
    this._detachPongListener(key);
    this._pingPendingCounts.delete(key);

    console.info(`[Runtime] Worker.terminate() dispatched: ${key}`);
    try {
      entry.worker.postMessage({ type: 'STOP' }); // Temiz kapatma denemesi
      // Zero-Leak: timer handle saklanır — destroy()'da temizlenir
      const timerId = setTimeout(() => {
        this._pendingTerminateTimers.delete(key);
        try { entry.worker?.terminate(); } catch { /* zaten kapanmış */ }
        console.info(`[Runtime] Worker.terminate() confirmed: ${key}`);
      }, 500);
      this._pendingTerminateTimers.set(key, timerId);
    } catch {
      try { entry.worker.terminate(); } catch { /* noop */ }
    }
    this._workers.set(key, { ...entry, worker: null }); // referansı null yap
    console.info(`[Runtime] Worker reference nulled: ${key} — memory released`);
  }

  // ── Zombie Detection ──────────────────────────────────────────────────────────

  /**
   * Her 10 saniyede tüm aktif (non-CRITICAL) worker'lara PING gönderir.
   * Worker 3 ping'e yanıt vermezse zombie sayılır → terminate + restart callback.
   *
   * CRITICAL worker'lar (VehicleCompute) asla terminate edilmez.
   */
  private _startZombieDetection(): void {
    if (this._zombiePingTimer) return; // idempotent
    this._zombiePingTimer = setInterval(() => {
      for (const [key, entry] of this._workers.entries()) {
        if (!entry.worker) continue;
        if (entry.criticality === 'CRITICAL') continue; // VehicleCompute asla dokunulmaz

        const misses = this._pingPendingCounts.get(key) ?? 0;

        if (misses >= ZOMBIE_MAX_MISSES) {
          console.warn(
            `[Runtime:ZombieDetect] ${key} — ${misses} PING yanıtsız → zombie tespiti, terminate ediliyor`,
          );
          this._terminateWorkerEntry(key, entry);
          if (this._zombieRestartCallback) {
            this._zombieRestartCallback(key);
          }
          continue;
        }

        // PING gönder; pending sayacını artır (PONG gelince sıfırlanır)
        try {
          entry.worker.postMessage({ type: 'PING' });
          this._pingPendingCounts.set(key, misses + 1);
        } catch {
          // Worker erişilemiyorsa terminate et
          console.warn(`[Runtime:ZombieDetect] ${key} — postMessage başarısız → terminate`);
          this._terminateWorkerEntry(key, entry);
          if (this._zombieRestartCallback) {
            this._zombieRestartCallback(key);
          }
        }
      }
    }, ZOMBIE_PING_INTERVAL_MS);
  }

  private _stopZombieDetection(): void {
    if (this._zombiePingTimer) {
      clearInterval(this._zombiePingTimer);
      this._zombiePingTimer = null;
    }
  }

  destroy(): void {
    this._cancelUpgrade();
    this._cancelThermalRecovery();
    this._stopZombieDetection();
    // Zero-Leak: pending terminate timer'larını temizle
    for (const timerId of this._pendingTerminateTimers.values()) {
      clearTimeout(timerId);
    }
    this._pendingTerminateTimers.clear();
    this._listeners.clear();

    // Tüm worker'ları temizle
    for (const [key, entry] of this._workers.entries()) {
      this._terminateWorkerEntry(key, entry);
    }
    this._workers.clear();
    this._pingPendingCounts.clear();
    this._workerMsgHandlers.clear();
    this._zombieRestartCallback = null;

    this._started            = false;
    this._powerCeiling       = null;
    this._thermalActiveLevel = 0;

    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    root.style.removeProperty('--rt-blur');
    root.style.removeProperty('--rt-anim');
    root.removeAttribute('data-runtime');
  }
}

/* ══════════════════════════════════════════════════════════════════
   Export — Singleton instance
══════════════════════════════════════════════════════════════════ */

/**
 * Uygulama genelinde paylaşılan tek RuntimeManager instance'ı.
 *
 * İmport ve kullanım:
 *   import { runtimeManager } from '../core/runtime/AdaptiveRuntimeManager';
 *   runtimeManager.setMode(RuntimeMode.BASIC_JS, 'thermal');
 *   runtimeManager.getConfig().gpsUpdateMs;
 *
 * Modül ilk import edildiğinde constructor çalışır:
 *   1. _detectCapabilities() → Worker/SAB yoksa BASIC_JS
 *   2. _applyCSS() → --rt-blur / --rt-anim DOM'a yazılır
 */
export const runtimeManager = AdaptiveRuntimeManager.getInstance();

/** Sınıfı test resetleme için de export et. */
export { AdaptiveRuntimeManager };
