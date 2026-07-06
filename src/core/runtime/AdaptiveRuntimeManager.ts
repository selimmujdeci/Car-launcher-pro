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

/* ── §L.0 Hibrit Runtime Scheduler — mod çarpanı tablosu ─────────
   docs/CAROS_VEHICLE_INTELLIGENCE_ARCHITECTURE.md:1176-1241.
   SAFETY görevlere ASLA uygulanmaz (sabit — CLAUDE.md "güvenlik-kritik HER
   tier'da garanti açık"); yalnız NORMAL görevlerin periodMs'ini ölçekler. */
const MODE_MULTIPLIER: Readonly<Record<RuntimeMode, number>> = {
  [RuntimeMode.PERFORMANCE]: 1,
  [RuntimeMode.BALANCED]:    1,
  [RuntimeMode.BASIC_JS]:    2,
  [RuntimeMode.POWER_SAVE]:  3,
  [RuntimeMode.SAFE_MODE]:   4,
} as const;

/* ── Sabitler ────────────────────────────────────────────────────── */

const UPGRADE_DELAY_MS   = 30_000; // 30 saniye stabilite penceresi
/** Termal kısıtlama recovery için aynı süre (soğuma 30s stabil kaldıktan sonra kısıt kaldırılır) */
const THERMAL_RECOVERY_MS = 30_000;
/** Zombie Detection: worker'lara PING gönderme aralığı.
 *  PERF 2026-06-11: 10s → 30s. Zayıf head unit'te her PING bir postMessage
 *  round-trip'i = main thread + worker uyanışı; 10 sn'lik kilitlenme
 *  dönemlerinde gereksiz trafik ekliyordu. Tespit penceresi 30s×3=90s'e
 *  çıkar — zombie worker zaten dakikalar mertebesinde bir arıza durumudur. */
const ZOMBIE_PING_INTERVAL_MS = 30_000;
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

/* ── §L.0 Hibrit Runtime Scheduler — tek "tick-wheel" sabiti ─────
   Tek master timer ~3Hz'te döner; her görev KENDİ periodMs'ini bildirir,
   wheel bunu en yakın tik katına yuvarlar (dört-beş ayrı interval yerine
   tek uyanış — zayıf HU'da termal/pil kazancı, aynı zombie-ping ilkesi).
   FAZ 16 DEĞİŞİKLİĞİ: eskiden görevler 4 sabit "frekans sınıfı" (HOT/WARM/
   COOL/IDLE, taban tik sayısı önceden sabitlenmiş) ile kaydoluyordu — bu
   sınıf modeli >15s'lik gerçek periyotları (community sync 5dk, brightness
   60s, breakReminder 30s) TEMSİL EDEMİYORDU: taşınan tüketiciler kendi
   gerçek periyotlarından çok daha hızlı bir sınıfa yuvarlanıp orta/yüksek
   tier'da OLMASI GEREKENDEN ÇOK DAHA SIK çalışmaya başladı (ör. community
   sync 5dk yerine COOL sınıfının ~5s tabanına düştü — 20× fazla ağ senkronu,
   CPU/pil kazancı yerine KAYIP). Çözüm: her görev kendi `periodMs`'ini verir
   (yüksek-tier'da ORİJİNAL periyot birebir korunur), mod çarpanı yalnız
   düşük-tier'da bunu YAVAŞLATIR — asla bir sınıf tablosuna zorla sığdırılmaz. */
const MASTER_TICK_MS = 333; // ~3Hz — wheel çözünürlüğü

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

/* ── §L.0 Hibrit Runtime Scheduler — tipler (FAZ 13 iskelet, FAZ 16 periodMs) ──
   docs/CAROS_VEHICLE_INTELLIGENCE_ARCHITECTURE.md:1176-1241. */

/**
 * Görev kritiklik sınıfı:
 *   SAFETY  — overheat/yağ basıncı/reverse gibi güvenlik uyarıları; HER tier'da
 *             `periodMs` AYNEN korunur, mod çarpanıyla ASLA kısılmaz.
 *   NORMAL  — geri kalan tüm analiz/intelligence görevleri; mod çarpanına tabi
 *             (yüksek-tier'da `periodMs` birebir, düşük-tier'da yavaşlar).
 */
export type TaskCriticality = 'SAFETY' | 'NORMAL';

/** scheduleTask() ile kaydedilen periyodik görev tanımı. */
export interface ScheduledTask {
  /** Benzersiz kimlik — çift kayıt öncekini DEĞİŞTİRİR (idempotent, sızıntı yok). */
  id:          string;
  /** İstenen taban periyot (ms) — BALANCED/PERFORMANCE'ta (mod çarpanı=1) AYNEN uygulanır. */
  periodMs:    number;
  /** SAFETY → her tier'da periodMs sabit, ASLA kısılmaz. */
  criticality: TaskCriticality;
  /** Saf, zero-alloc gövde beklenir — hot-path'te çalışabilir. */
  fn:          () => void;
  /** true → tetiklenince fn requestIdleCallback'e ötelenir (varsa); yoksa senkron çalışır. */
  deferIdle?:  boolean;
}

/** Dahili görev kaydı — kullanıcı ScheduledTask'ına önceden hesaplanmış tik periyodu eklenir. */
interface InternalScheduledTask extends ScheduledTask {
  /** _rescaleTasks() içinde mod değişince yeniden hesaplanan tik periyodu (zero-alloc hot-path cache). */
  _effectiveTicks: number;
}

/**
 * Bir görevin SAFETY önceliğini (0=önce) NORMAL'e (1) göre sıralar.
 * Eşitlikte (aynı kritiklik) `periodMs` ARTAN sıralanır (§L.0 FAZ 16) — kısa
 * periyot = daha zaman-hassas görev, wheel'de önce dispatch edilir.
 */
function _taskPriority(t: ScheduledTask): number {
  return t.criticality === 'SAFETY' ? 0 : 1;
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

  /* ── §L.0 Hibrit Runtime Scheduler state (FAZ 13 iskelet) ──────
     Tek yazar invaryantı: bu wheel, runtimeManager'ın PARÇASI — ikinci bir
     paralel zamanlayıcı otoritesi doğmaz. */

  /** Kayıtlı görevler (id → görev + önbelleklenmiş tik periyodu). */
  private readonly _tasks = new Map<string, InternalScheduledTask>();

  /** Önceden hesaplanmış, önceliğe göre sıralı görev dizisi — yalnız görev
   *  ekleme/çıkarmada yeniden kurulur (zero-alloc hot-path: _tick() içinde
   *  hiçbir dizi/obje yaratılmaz). */
  private _taskOrder: ReadonlyArray<InternalScheduledTask> = [];

  /** Tek master timer handle — 0 görevde kurulmaz (boşta uyanış yok). */
  private _wheelTimer: ReturnType<typeof setInterval> | null = null;

  /** Master tik sayacı — her MASTER_TICK_MS'de bir artar. */
  private _tickCounter = 0;

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

    // §L.0 Scheduler: mod değişince NORMAL görevlerin tik periyodunu yeniden
    // ölçekle (SAFETY sabit kalır — _computeEffectiveTicks içinde).
    this._rescaleTasks();
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

    // Aynı değeri her tikte yeniden YAZMA: html style attr mutasyonu zayıf
    // GPU'da (PowerVR GE8300 saha bulgusu) geniş style invalidation + ~60ms
    // tam boyama tetikliyor. Değer değişmediyse DOM'a dokunma.
    const rtBlur   = config.enableBlur       ? '1' : '0';
    const rtAnim   = config.enableAnimations ? '1' : '0';
    const rtShadow = config.enableShadows    ? '1' : '0';
    if (root.style.getPropertyValue('--rt-blur')   !== rtBlur)   root.style.setProperty('--rt-blur',   rtBlur);
    if (root.style.getPropertyValue('--rt-anim')   !== rtAnim)   root.style.setProperty('--rt-anim',   rtAnim);
    if (root.style.getPropertyValue('--rt-shadow') !== rtShadow) root.style.setProperty('--rt-shadow', rtShadow);
    // box-shadow string'i calc(var()) ile ölçeklenemez → CSS sınıf anahtarı.
    // enableShadows=false (BASIC_JS/POWER_SAVE/SAFE_MODE) → html.rt-no-shadow →
    // index.css tüm box-shadow'ları sıfırlar (Mali-400 kompozit katman tasarrufu).
    root.classList.toggle('rt-no-shadow', !config.enableShadows);
    if (root.getAttribute('data-runtime') !== mode) root.setAttribute('data-runtime', mode);
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
     §L.0 Hibrit Runtime Scheduler — tek "tick-wheel" (FAZ 13 iskelet)
  ══════════════════════════════════════════════════════════════ */

  /**
   * Periyodik bir görevi tek tik-wheel üstünde kaydeder.
   *
   * Aynı `id` ile yeniden çağrılırsa önceki görev GÜNCELLENİR (registerWorker
   * ile aynı idempotent desen — çift kayıt/sızıntı yok). İlk görev eklenince
   * wheel timer'ı LAZY başlar; son görev silinince durur (boşta uyanış yok).
   *
   * `periodMs` — istenen taban periyot; BALANCED/PERFORMANCE'ta (mod
   * çarpanı=1) AYNEN uygulanır, düşük-tier'da moda göre yavaşlatılır (§L.0
   * FAZ 16). SAFETY görevler periodMs'i HER tier'da sabit korur, ASLA
   * kısılmaz (§L.1, CLAUDE.md "güvenlik-kritik HER tier'da garanti açık").
   *
   * @param task  Kaydedilecek periyodik görev
   * @returns     Cleanup thunk — görevi wheel'den kaldırır (subscribe deseni)
   */
  scheduleTask(task: ScheduledTask): () => void {
    const wasEmpty = this._tasks.size === 0;
    this._tasks.set(task.id, { ...task, _effectiveTicks: this._computeEffectiveTicks(task) });
    this._rebuildTaskOrder();
    if (wasEmpty) this._startWheel();
    return () => this._unscheduleTask(task.id);
  }

  private _unscheduleTask(id: string): void {
    if (!this._tasks.delete(id)) return; // zaten kaldırılmış — no-op
    this._rebuildTaskOrder();
    if (this._tasks.size === 0) this._stopWheel();
  }

  /**
   * Bir görevin efektif tik periyodunu hesaplar.
   *   SAFETY  → effectiveMs = periodMs (sabit, mod ne olursa olsun kısılmaz).
   *   NORMAL  → effectiveMs = periodMs × MODE_MULTIPLIER[mode].
   * Wheel çözünürlüğü MASTER_TICK_MS olduğundan sonuç en yakın tike yuvarlanır
   * (min 1 tik — asla 0/negatif periyot).
   */
  private _computeEffectiveTicks(task: ScheduledTask): number {
    const effectiveMs = task.criticality === 'SAFETY'
      ? task.periodMs
      : task.periodMs * MODE_MULTIPLIER[this._mode];
    return Math.max(1, Math.round(effectiveMs / MASTER_TICK_MS));
  }

  /**
   * Mod değişince tüm görevlerin efektif tik periyodunu yeniden hesaplar.
   * `_commit()` içinden çağrılır — self-subscribe GEREKMEZ, scheduler zaten
   * manager'ın bir parçası. Sık çağrılmaz (mod geçişi yüksek frekanslı değil);
   * hot-path olan `_tick()` bu maliyeti ASLA taşımaz (cache önceden hesaplı).
   */
  private _rescaleTasks(): void {
    if (this._tasks.size === 0) return;
    for (const [id, task] of this._tasks) {
      this._tasks.set(id, { ...task, _effectiveTicks: this._computeEffectiveTicks(task) });
    }
    this._rebuildTaskOrder();
  }

  /**
   * Görev dizisini önceliğe göre yeniden kurar: SAFETY önce, NORMAL sonra;
   * eşitlikte periodMs ARTAN (kısa periyot = daha zaman-hassas, önce dispatch).
   */
  private _rebuildTaskOrder(): void {
    this._taskOrder = Array.from(this._tasks.values())
      .sort((a, b) => {
        const pa = _taskPriority(a), pb = _taskPriority(b);
        return pa !== pb ? pa - pb : a.periodMs - b.periodMs;
      });
  }

  /** Wheel'i lazy başlatır — yalnız ilk görev eklenince çağrılır (idempotent). */
  private _startWheel(): void {
    if (this._wheelTimer !== null) return;
    this._tickCounter = 0;
    this._wheelTimer = setInterval(() => this._tick(), MASTER_TICK_MS);
  }

  /** Wheel'i durdurur — son görev silinince veya destroy()'da çağrılır (idempotent). */
  private _stopWheel(): void {
    if (this._wheelTimer !== null) {
      clearInterval(this._wheelTimer);
      this._wheelTimer = null;
    }
    this._tickCounter = 0;
  }

  /**
   * Master tik gövdesi — zero-alloc, monomorfik dispatch.
   * Önceden hesaplı `_taskOrder` dizisi üstünde döner; tik başına yeni
   * obje/dizi/closure YARATILMAZ (#4 Zero-Allocation Hot-Paths).
   *
   * Sıra: SAFETY görevler önce (safety preemption, §L.0 #5), ardından NORMAL
   * (eşitlikte kısa periodMs önce). Bir görev fırlatırsa yakalanır+loglanır —
   * diğer görevler ETKİLENMEZ (fail-soft).
   */
  private _tick(): void {
    this._tickCounter++;
    const order = this._taskOrder;
    for (let i = 0; i < order.length; i++) {
      const task = order[i];
      if (this._tickCounter % task._effectiveTicks !== 0) continue;
      this._dispatchTask(task);
    }
  }

  /** deferIdle=true görevleri requestIdleCallback varsa ona öteler; yoksa senkron çalıştırır. */
  private _dispatchTask(task: InternalScheduledTask): void {
    if (task.deferIdle === true && typeof requestIdleCallback === 'function') {
      requestIdleCallback(() => this._invokeTask(task));
      return;
    }
    this._invokeTask(task);
  }

  private _invokeTask(task: InternalScheduledTask): void {
    try {
      task.fn();
    } catch (err) {
      console.error(`[Runtime:Scheduler] görev '${task.id}' fırlattı — diğer görevler etkilenmedi`, err);
    }
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
   * MODERATE veya CRITICAL → tüm OPTIONAL worker'lar (VisionCompute + NavigationCompute,
   * ikisi de OPTIONAL) sonlandırılır; yalnız CRITICAL (VehicleCompute) hayatta kalır.
   * NOT: criticality yalnız 2 seviye olduğundan (#8) iki baskı seviyesi şu an AYNI agresif
   * davranışı uygular — MODERATE'de navigasyonu korumak ayrı bir 3. seviye gerektirir.
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
    // §L.0 Scheduler: wheel timer'ı durdur + görev kaydını temizle (Zero-Leak).
    this._stopWheel();
    this._tasks.clear();
    this._taskOrder = [];
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
    root.style.removeProperty('--rt-shadow');
    root.classList.remove('rt-no-shadow');
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
