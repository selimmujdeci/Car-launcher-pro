/**
 * platformCoreVehicleHalBridgeWiring — Vehicle HAL → Event Bus BRIDGE RUNTIME WIRING (W4C).
 *
 * AMAÇ: Mevcut `VehicleHalEventBridge` foundation'ını (PR #54) gerçek `vehicleHal` singleton'ına
 * ve W3'ün TEK aktif `appEventBus` örneğine bağlar. Zincir tamamlanır:
 *
 *   UnifiedVehicleStore → VehicleHalProviderAdapter → vehicleHal
 *     → VehicleHalEventBridge → appEventBus   (abone YOK — consumer migration AYRI PR)
 *
 * ⚠️ KOD GERÇEĞİ (salt-okunur analiz):
 *  - `createVehicleHalEventBridge({hal, bus})` fabrikadır; GLOBAL SINGLETON YOK; yapıcı YAN
 *    ETKİSİZ (abonelik yalnız `start()`'ta) — `vehicleHalEventBridge.ts:283-289`.
 *  - Bridge kaynakların SAHİBİ DEĞİL: `dispose()` HAL'i/Bus'ı dispose ETMEZ (`:272-278`).
 *  - Bridge'te timer/polling YOK; throttle/debounce YOK — yalnız imza-tabanlı DIFF/dedupe
 *    (`:123-126, 184`). Publish hızı = gerçek sinyal değişim hızı. Ölçüm W4D kararına girdi.
 *  - `PlatformEventBus.publish()` SENKRON dispatch eder (`platformEventBus.ts:425-426`) →
 *    ileride eklenecek consumer'lar HAL/store hot-path stack'inde çalışır. Bu PR'da abone YOK.
 *  - `vehicleHal` yapısal olarak `VehicleHalSource`'a uyar (subscribe/getSnapshot/
 *    getVehicleIdentity — `vehicleHal.ts:344, 391`); `PlatformEventBus` `EventBusPublishTarget`'a.
 *
 * NE YAPMAZ (bilinçli — W4C yalnız WIRING'dir):
 *  - throttle · debounce · microtask/frame coalescing · DeviceTier frekans politikası ·
 *    Event Bus async queue → **W4D** (ölçümden SONRA).
 *  - consumer/abone EKLEMEZ · Capability bridge/Registry · Deep Scan · Kernel servis kaydı ·
 *    yeni event catalog girdisi · HAL stale sweeper · native `canStatus` wiring · worker
 *    source-health expose · UI/SQL değişikliği — HİÇBİRİ.
 *  - Foundation davranışını (bridge/bus/HAL/adapter/provider) DEĞİŞTİRMEZ.
 *
 * SAHİPLİK: bridge bu modülündür → cleanup YALNIZ bridge'i dispose eder. `vehicleHal` (Wave 2
 * wiring'in beslediği singleton) ve `appEventBus` (W3'ün sahibi olduğu bus) DISPOSE EDİLMEZ.
 * TEK INSTANCE: aktif bridge varken ikinci `start` YENİ HAL aboneliği açmaz; bayat (disposed)
 * kayıt otomatik serbest bırakılır; cleanup yalnız KENDİ kaydını siler → boot→shutdown→boot güvenli.
 *
 * FAIL-SOFT: bus YOKSA (W3 wiring çalışmadıysa) sessizce no-op cleanup döner — boot sürer.
 * Public API dışarı EXCEPTION KAÇIRMAZ; hata bir kez `logError` ile kaydedilir (ham event/araç
 * sinyali/VIN/koordinat LOGLANMAZ). ZERO-LEAK: cleanup bridge aboneliğini bırakır; timer yok.
 */

import { logError } from '../crashLogger';
import {
  createVehicleHalEventBridge,
  type VehicleHalEventBridge,
  type VehicleHalEventBridgeDeps,
  type PlatformEventBus,
  type PlatformEventDomain,
  type PlatformEventSource,
} from '../eventBus';
import { vehicleHal } from '../vehicleHal';
import { getAppEventBus } from './platformCoreEventBusWiring';

type BridgeHalSource = VehicleHalEventBridgeDeps['hal'];
type BridgePublishTarget = VehicleHalEventBridgeDeps['bus'];

/** Test için opsiyonel DI; üretimde `vehicleHal` singleton + `getAppEventBus()`. */
export interface VehicleHalBridgeWiringDeps {
  readonly hal?: BridgeHalSource;
  readonly bus?: BridgePublishTarget;
}

/**
 * Bridge'in publish sözleşmesi `domain`/`source`'u GENİŞ (`string`) tiple alır; `PlatformEventBus`
 * ise DAR birlik tipleri (`PlatformEventDomain`/`PlatformEventSource`) bekler → bus doğrudan hedef
 * olarak GEÇEMEZ (property-syntax → kontravaryans). Bu ince sarmalayıcı, foundation'a HİÇ DOKUNMADAN
 * daraltmayı wiring katmanında yapar. Doğrulama ZAYIFLAMAZ: Bus geçersiz domain/source değerlerini
 * zaten kendi beyaz listesiyle reddeder/`unknown`'a düşürür.
 */
function _toPublishTarget(bus: PlatformEventBus): BridgePublishTarget {
  return {
    publish: (input) => bus.publish({
      name: input.name,
      payload: input.payload,
      domain: input.domain as PlatformEventDomain | undefined,
      source: input.source as PlatformEventSource | undefined,
      transient: input.transient,
      retained: input.retained,
      vehicleFingerprintHash: input.vehicleFingerprintHash,
    }),
  };
}

/** Tek cleanup thunk — İDEMPOTENT. YALNIZ bridge'i dispose eder (HAL/Bus'a DOKUNMAZ). */
export type VehicleHalBridgeWiringCleanup = () => void;

/** Bounded teşhis görünümü — event payload'ı / sinyal değeri / topic detayı TAŞIMAZ. */
export interface VehicleHalBridgeWiringStatus {
  /** Bridge runtime'da kurulu mu (false → "ölçülemiyor", 0 event ile KARIŞTIRILMAZ). */
  readonly present: boolean;
  readonly started: boolean;
  readonly disposed: boolean;
  readonly publishedCount: number | null;
  readonly droppedCount: number | null;
  readonly lastPublishAt: number | null;
}

const NOOP_CLEANUP: VehicleHalBridgeWiringCleanup = () => { /* no-op */ };

const ABSENT_STATUS: VehicleHalBridgeWiringStatus = Object.freeze({
  present: false, started: false, disposed: false,
  publishedCount: null, droppedCount: null, lastPublishAt: null,
});

let _active: VehicleHalEventBridge | null = null;

/** Bayat kayıt (HMR/restart artığı: dispose edilmiş bridge) → serbest bırak. */
function _pruneStale(): void {
  if (_active && _active.isDisposed) _active = null;
}

/**
 * Bridge'i oluşturur, HAL'e abone eder ve TEK aktif bus'a publish etmesini sağlar.
 * YALNIZ cleanup thunk döner. Dışarı exception KAÇIRMAZ. İDEMPOTENT (ikinci çağrı yeni
 * HAL aboneliği AÇMAZ). Bus yoksa fail-soft no-op.
 */
export function startPlatformCoreVehicleHalBridgeWiring(
  deps: VehicleHalBridgeWiringDeps = {},
): VehicleHalBridgeWiringCleanup {
  let bridge: VehicleHalEventBridge | null = null;
  try {
    _pruneStale();
    if (_active) return NOOP_CLEANUP;              // zaten aktif → ikinci abonelik YOK

    const appBus = getAppEventBus();               // W3'ün TEK aktif bus'ı
    const bus: BridgePublishTarget | null = deps.bus ?? (appBus ? _toPublishTarget(appBus) : null);
    if (!bus) return NOOP_CLEANUP;                 // bus yok → sessiz no-op (boot sürer)
    const hal = deps.hal ?? vehicleHal;            // Wave 2 wiring'in beslediği singleton

    bridge = createVehicleHalEventBridge({ hal, bus });
    const own = bridge;
    _active = own;
    own.start();                                   // HAL aboneliği + ilk snapshot (bridge içi fail-soft)

    let disposed = false;
    return () => {
      if (disposed) return;                        // İDEMPOTENT
      disposed = true;
      try {
        own.dispose();                             // YALNIZ bridge — HAL/Bus DISPOSE EDİLMEZ
      } catch (e) {
        logError('vehicleHalBridgeWiring:cleanup', e);   // cleanup hatası shutdown'ı engellemez
      }
      if (_active === own) _active = null;         // yalnız KENDİ kaydını siler
    };
  } catch (e) {
    if (bridge && _active === bridge) _active = null;    // yarım kayıt bırakma
    logError('vehicleHalBridgeWiring:init', e);          // ham event/sinyal/VIN LOGLANMAZ
    return NOOP_CLEANUP;                                 // boot devam eder (fail-soft)
  }
}

/** Bounded teşhis görünümü. Bridge yoksa `present:false` + null sayaçlar. Throw ETMEZ. */
export function getVehicleHalBridgeStatus(): VehicleHalBridgeWiringStatus {
  _pruneStale();
  const b = _active;
  if (!b) return ABSENT_STATUS;
  try {
    const s = b.getStatus();
    return Object.freeze({
      present: true,
      started: s.started === true,
      disposed: s.disposed === true,
      publishedCount: Number.isFinite(s.publishedCount) ? s.publishedCount : null,
      droppedCount: Number.isFinite(s.droppedCount) ? s.droppedCount : null,
      lastPublishAt: typeof s.lastPublishAt === 'number' && Number.isFinite(s.lastPublishAt)
        ? s.lastPublishAt
        : null,
    });
  } catch {
    return ABSENT_STATUS;   // teşhis yolu asla çökmez
  }
}
