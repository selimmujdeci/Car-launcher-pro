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

import { useUnifiedVehicleStore } from '../vehicleDataLayer/UnifiedVehicleStore';
import { onGPSLocation }          from '../gpsService';
import { showToast, dismissToast } from '../errorBus';
import { logError }               from '../crashLogger';

// ── Sabitler ─────────────────────────────────────────────────────────────────

const WATCHDOG_INTERVAL_MS = 5_000;   // watchdog tick aralığı
const ALERT_COOLDOWN_MS    = 60_000;  // aynı servis için uyarı yenileme süresi
const RESTART_COOLDOWN_MS  = 10_000;  // restart denemeleri arası minimum bekleme
const MAX_RESTARTS_DEFAULT = 2;
const STARTUP_GRACE_MS     = 45_000;  // uygulama açılışta GPS fix almadan önce uyarı basılmaz

// ── Tipler ────────────────────────────────────────────────────────────────────

export type ServiceCriticality = 'critical' | 'warning';

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
  private _registry  = new Map<string, WatchEntry>();
  private _timer:      ReturnType<typeof setInterval> | null = null;
  private _unsubs:     Array<() => void> = [];
  private _startedAt = 0;

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
  }

  /** Servisten "yaşıyorum" sinyali — lastBeat güncellenir, aktif alert varsa kapatılır. */
  beat(name: string): void {
    const entry = this._registry.get(name);
    if (!entry) return;

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

  /** Watchdog ve pasif izleyicileri başlat. start() → stop() idempotent. */
  start(): void {
    if (this._timer) return;
    this._startedAt = performance.now();
    this._setupPassiveMonitoring();
    this._timer = setInterval(() => { this._tick(); }, WATCHDOG_INTERVAL_MS);
  }

  /** Tüm kaynakları serbest bırak. */
  stop(): void {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    this._unsubs.forEach((fn) => fn());
    this._unsubs = [];

    // Açık toastları kapat — stop = intentional shutdown, uyarı gösterme
    for (const entry of this._registry.values()) {
      if (entry.alertId) { dismissToast(entry.alertId); entry.alertId = null; }
    }
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

      // Restart dene
      if (
        entry.restartFn &&
        entry.restartCount < entry.maxRestarts &&
        (now - entry.lastRestartAt) > RESTART_COOLDOWN_MS
      ) {
        entry.restartCount++;
        entry.lastRestartAt = now;

        const attempt = entry.restartCount;
        if (import.meta.env.DEV) {
          console.warn(
            `[HealthMonitor] Restarting ${entry.name} (attempt ${attempt}/${entry.maxRestarts})`,
          );
        }

        void entry.restartFn().catch((e: unknown) => {
          logError(`HealthMonitor:Restart:${entry.name}`, e);
        });
      }
    }
  }
}

export const healthMonitor = new SystemHealthMonitor();
