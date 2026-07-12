/**
 * platformCoreVehicleHalWiring — Vehicle HAL RUNTIME WIRING (PR-W2).
 *
 * AMAÇ: Mevcut `useUnifiedVehicleStore` (fused worker/CAN/OBD/GPS) veri akışını, daha önce
 * hazırlanmış SALT-OKUNUR provider + adapter foundation'ı üzerinden gerçek `vehicleHal`
 * singleton'ına — AYNA MODUNDA — bağlar. Zincir:
 *
 *   useUnifiedVehicleStore
 *     → createUnifiedVehicleStoreProvider   (store → VehicleStoreSource)
 *     → createVehicleHalProviderAdapter     (source → HAL ingestSignal, yalnız değişen sinyal)
 *     → vehicleHal                          (singleton; kimse okumaz — tüketici migrasyonu AYRI PR)
 *
 * NE YAPMAZ (bilinçli — PR-W2 yalnız HAL veri girişini aktive eder):
 *  - Event Bus'a YAYINLAMAZ · Capability Registry'yi GÜNCELLEMEZ · Platform Kernel'e servis
 *    KAYDETMEZ · Deep Scan'i BAĞLAMAZ · tüketicileri HAL'e TAŞIMAZ · UI/SQL/native/OBD/CAN'e
 *    DOKUNMAZ · poll frekansı DEĞİŞTİRMEZ · yeni timer/polling AÇMAZ · sinyal eşlemesini
 *    (provider/adapter) DEĞİŞTİRMEZ.
 *  - Store'u DOĞRUDAN import ETMEZ (`store` DI ile gelir); `hal` opsiyonel DI (test), üretimde
 *    paylaşılan `vehicleHal` singleton'ı. Modül import'u YAN ETKİSİZDİR — `start...()` çağrılana
 *    dek store'a abone olunmaz, HAL beslenmez.
 *
 * TEK INSTANCE (duplicate koruması): modül-düzeyi `_active` kaydı → wiring zaten AKTİFKEN ikinci
 * `start...()` çağrısı YENİ provider/adapter/subscription OLUŞTURMAZ (no-op cleanup döner).
 * HMR/restart'ta bayat kayıt (adapter disposed) otomatik temizlenir. Cleanup yalnız KENDİ
 * kaydını siler (yabancı wiring'i düşürmez) → boot→shutdown→boot güvenli.
 *
 * SAHİPLİK: provider + adapter bu wiring'e aittir (cleanup'ta dispose edilir). `vehicleHal`
 * PAYLAŞILAN modül singleton'ıdır → cleanup HAL'i DISPOSE ETMEZ (çift-dispose yok).
 *
 * FAIL-SOFT: başlatma fonksiyonu dışarı EXCEPTION KAÇIRMAZ — init hatası bir kez `logError` ile
 * kaydedilir ve güvenli no-op cleanup döner (ham sinyal/VIN/CAN payload'ı LOGLANMAZ).
 * ZERO-LEAK: cleanup adapter → provider sırasıyla dispose eder; İDEMPOTENT (ikinci çağrı no-op).
 */

import { logError } from '../crashLogger';
import {
  createVehicleHalProviderAdapter,
  vehicleHal,
  type VehicleHalIngestTarget,
  type VehicleHalProviderAdapter,
} from '../vehicleHal';
import {
  createUnifiedVehicleStoreProvider,
  type UnifiedVehicleStoreLike,
  type UnifiedVehicleStoreProvider,
} from '../vehicleHal/providers';

/** Wiring bağımlılıkları — store DI zorunlu; hal opsiyonel (test), varsayılan singleton. */
export interface VehicleHalWiringDeps {
  /** `useUnifiedVehicleStore` (zustand — getState/subscribe). Yapısal DI; doğrudan import yok. */
  readonly store: UnifiedVehicleStoreLike | null | undefined;
  /** Test için HAL enjeksiyonu; verilmezse üretim `vehicleHal` singleton'ı kullanılır. */
  readonly hal?: VehicleHalIngestTarget;
}

/** Tek cleanup thunk — İDEMPOTENT + fail-soft. HAL'i dispose ETMEZ. */
export type VehicleHalWiringCleanup = () => void;

/** Bounded teşhis görünümü — ham telemetri YOK (yalnız sayaç/bayrak). */
export interface VehicleHalWiringStatus {
  readonly started: boolean;
  readonly lastRefreshAt: number | null;
  /** HAL'e en az bir kez aktarılmış AYRI sinyal sayısı (adapter'ın son-değer haritası). */
  readonly ingestedSignalCount: number;
  /** Store değişikliğiyle tetiklenen refresh sayısı (ingest sayısı DEĞİL). */
  readonly refreshCount: number;
  /** Aktif store aboneliği sayısı — sağlıklı çalışmada 1 (wiring kapalıyken 0). */
  readonly activeSubscriptionCount: number;
  /** Sabit, sanitize hata kodu (ham hata/telemetri değil). */
  readonly lastErrorCode: 'init_failed' | 'cleanup_failed' | null;
}

const NOOP_CLEANUP: VehicleHalWiringCleanup = () => { /* no-op */ };

interface ActiveWiring {
  readonly adapter: VehicleHalProviderAdapter;
  readonly provider: UnifiedVehicleStoreProvider;
}

/** Tek runtime wiring kaydı (duplicate/HMR koruması). */
let _active: ActiveWiring | null = null;
let _lastErrorCode: VehicleHalWiringStatus['lastErrorCode'] = null;

const IDLE_STATUS: VehicleHalWiringStatus = Object.freeze({
  started: false,
  lastRefreshAt: null,
  ingestedSignalCount: 0,
  refreshCount: 0,
  activeSubscriptionCount: 0,
  lastErrorCode: null,
});

/**
 * HAL veri girişini kurar ve adapter'ı başlatır. YALNIZ cleanup thunk döner.
 * Dışarı exception KAÇIRMAZ (init hatası → tek `logError` + no-op cleanup).
 * İDEMPOTENT: aktif wiring varken ikinci çağrı YENİ abonelik açmaz.
 */
export function startPlatformCoreVehicleHalWiring(deps: VehicleHalWiringDeps): VehicleHalWiringCleanup {
  let active: ActiveWiring | null = null;
  try {
    // HMR/restart artığı: cleanup'sız kalan bayat kayıt → serbest bırak.
    if (_active && _active.adapter.isDisposed) _active = null;
    // Zaten aktif → ikinci provider/adapter/subscription OLUŞTURULMAZ.
    if (_active) return NOOP_CLEANUP;

    const store = deps && deps.store ? deps.store : null;
    const hal: VehicleHalIngestTarget = deps && deps.hal ? deps.hal : vehicleHal;

    const provider = createUnifiedVehicleStoreProvider({ store });
    const adapter = createVehicleHalProviderAdapter({ hal, source: provider });

    // Store yoksa wiring inert kalır (abonelik açılmaz) → aktif kayıt TUTULMAZ ki
    // store hazır olduğunda sonraki wiring bloke olmasın.
    if (store) {
      active = { adapter, provider };
      _active = active;
    }
    adapter.start();          // adapter içi fail-soft (subscribe hatası yutulur)
    _lastErrorCode = null;

    let disposed = false;
    return () => {
      if (disposed) return;   // İDEMPOTENT
      disposed = true;
      try {
        adapter.dispose();    // önce adapter (store hâlâ ayaktayken aboneliği bırakır)
        provider.dispose();
      } catch (e) {
        _lastErrorCode = 'cleanup_failed';   // cleanup hatası shutdown'ı ENGELLEMEZ
        logError('vehicleHalWiring:cleanup', e);
      }
      if (active && _active === active) _active = null;   // yalnız KENDİ kaydını siler
    };
  } catch (e) {
    // Init hatası: wiring sınırında BİR KEZ kaydet (ham veri/VIN/payload YOK), boot'u çökertme.
    if (active && _active === active) _active = null;     // yarım kayıt bırakma
    _lastErrorCode = 'init_failed';
    logError('vehicleHalWiring:init', e);
    return NOOP_CLEANUP;
  }
}

/** Bounded teşhis görünümü (prod log spam YOK). Throw ETMEZ. */
export function getVehicleHalWiringStatus(): VehicleHalWiringStatus {
  const a = _active;
  if (!a || a.adapter.isDisposed) {
    return _lastErrorCode ? Object.freeze({ ...IDLE_STATUS, lastErrorCode: _lastErrorCode }) : IDLE_STATUS;
  }
  try {
    const s = a.adapter.getStatus();
    return Object.freeze({
      started: s.started,
      lastRefreshAt: s.lastRefreshAt,
      ingestedSignalCount: s.ingestedSignalCount,
      refreshCount: s.refreshCount,
      activeSubscriptionCount: a.provider.activeSubscriptionCount,
      lastErrorCode: _lastErrorCode,
    });
  } catch {
    return IDLE_STATUS;   // teşhis yolu asla çökmez
  }
}
