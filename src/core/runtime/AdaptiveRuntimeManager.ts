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

/* ── Mod sıralaması (sayısal karşılaştırma) ─────────────────────── */

const MODE_RANK: Readonly<Record<RuntimeMode, number>> = {
  [RuntimeMode.SAFE_MODE]:   0,
  [RuntimeMode.BASIC_JS]:    1,
  [RuntimeMode.BALANCED]:    2,
  [RuntimeMode.PERFORMANCE]: 3,
} as const;

/* ── Sabitler ────────────────────────────────────────────────────── */

const UPGRADE_DELAY_MS = 30_000; // 30 saniye stabilite penceresi

/** Crash-recovery: son aktif modu safeStorage'a yazarız; yeniden başlatmada okuruz. */
const PERSIST_KEY = 'rt-last-mode';

/* ── Tip tanımları ───────────────────────────────────────────────── */

/** setMode() çağrısının hangi kaynaktan geldiğini belirtir. */
export type ModeReason = string;

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

  private readonly _listeners = new Set<ModeChangeListener>();

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
    const hasWorker = typeof Worker            !== 'undefined';
    const hasSAB    = typeof SharedArrayBuffer !== 'undefined';

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

    console.info(`[Runtime] started: mode=${this._mode}`);
  }

  /* ── Upgrade timer temizleyici ──────────────────────────────── */

  private _cancelUpgrade(): void {
    if (this._upgradeTimer !== null) {
      clearTimeout(this._upgradeTimer);
      this._upgradeTimer = null;
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
  destroy(): void {
    this._cancelUpgrade();
    this._listeners.clear();

    this._started = false;

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
