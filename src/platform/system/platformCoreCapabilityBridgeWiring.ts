/**
 * platformCoreCapabilityBridgeWiring — Capability Registry → Event Bus BRIDGE RUNTIME WIRING (W4).
 *
 * AMAÇ: Mevcut `CapabilityEventBridge` foundation'ını (PR #54) gerçek `capabilityRegistry`
 * singleton'ına ve W3'ün TEK aktif `appEventBus` örneğine bağlar. Zincir tamamlanır:
 *
 *   runtime kanıtları → CapabilityProviderAdapter → capabilityRegistry
 *     → CapabilityEventBridge → appEventBus   (abone YOK — consumer migration AYRI PR)
 *
 * Bu, W4C'nin (Vehicle HAL → Event Bus bridge) capability EŞLENİĞİDİR — birebir aynı desen.
 *
 * ⚠️ KOD GERÇEĞİ (salt-okunur analiz):
 *  - `createCapabilityEventBridge({registry, bus})` fabrikadır; GLOBAL SINGLETON YOK; yapıcı YAN
 *    ETKİSİZ (abonelik + sayım tohumlama yalnız `start()`'ta) — `capabilityEventBridge.ts:283-288`.
 *  - Bridge kaynakların SAHİBİ DEĞİL: `dispose()` Registry'yi/Bus'ı dispose ETMEZ (`:271-277`).
 *  - Bridge'te timer/polling YOK; throttle/debounce YOK — yalnız imza-tabanlı dedupe (`:216-218`)
 *    + O(1) incremental sayım (değişiklik başına full snapshot allocation YOK). Publish hızı =
 *    gerçek capability değişim hızı (capability'ler boot'ta tohumlanır, sonra NADİR değişir →
 *    Mali-400 hot-path riski YOK; HAL sinyal frekansından bağımsız).
 *  - `capabilityRegistry` yapısal olarak `CapabilityRegistrySource`'a uyar (subscribe/getCapability/
 *    createSnapshot — `capabilityRegistry.ts:713, 637, 692`); `PlatformEventBus` `EventBusPublishTarget`'a.
 *
 * NE YAPMAZ (bilinçli — W4 yalnız WIRING'dir):
 *  - Vehicle HAL bridge/wiring'e DOKUNMAZ (W4C/W2 aynen kalır) · Deep Scan · Driver DNA ·
 *    Prediction Engine · Assistant Context · consumer/abone · Kernel servis kaydı · legacy event
 *    migration · yeni event catalog girdisi · throttle/debounce/coalescing · native/OBD/CAN/SQL/UI —
 *    HİÇBİRİ.
 *  - İKİNCİ bus YARATMAZ: W3'ün sahiplendiği tek `appEventBus`'ı `getAppEventBus()` ile TÜKETİR.
 *
 * SAHİPLİK: bridge bu modülündür → cleanup YALNIZ bridge'i dispose eder. `capabilityRegistry`
 * (W3 wiring'in beslediği singleton) ve `appEventBus` (W3'ün sahibi olduğu bus) DISPOSE EDİLMEZ.
 * TEK INSTANCE: aktif bridge varken ikinci `start` YENİ Registry aboneliği açmaz; bayat (disposed)
 * kayıt otomatik serbest bırakılır; cleanup yalnız KENDİ kaydını siler → boot→shutdown→boot güvenli.
 *
 * FAIL-SOFT: bus YOKSA (W3 wiring çalışmadıysa) sessizce no-op cleanup döner — boot sürer. Public
 * API dışarı EXCEPTION KAÇIRMAZ; hata bir kez `logError` ile kaydedilir (ham capability/reason/VIN
 * LOGLANMAZ). ZERO-LEAK: cleanup bridge aboneliğini bırakır; timer yok.
 */

import { logError } from '../crashLogger';
import {
  createCapabilityEventBridge,
  type CapabilityEventBridge,
  type CapabilityEventBridgeDeps,
  type PlatformEventBus,
  type PlatformEventDomain,
  type PlatformEventSource,
} from '../eventBus';
import { capabilityRegistry } from '../capability';
import { getAppEventBus } from './platformCoreEventBusWiring';

type BridgeRegistrySource = CapabilityEventBridgeDeps['registry'];
type BridgePublishTarget = CapabilityEventBridgeDeps['bus'];

/** Test için opsiyonel DI; üretimde `capabilityRegistry` singleton + `getAppEventBus()`. */
export interface CapabilityBridgeWiringDeps {
  readonly registry?: BridgeRegistrySource;
  readonly bus?: BridgePublishTarget;
}

/**
 * Bridge'in publish sözleşmesi `domain`/`source`'u GENİŞ (`string`) tiple alır; `PlatformEventBus`
 * ise DAR birlik tipleri bekler → bus doğrudan hedef olarak GEÇEMEZ (kontravaryans). Bu ince
 * sarmalayıcı, foundation'a HİÇ DOKUNMADAN daraltmayı wiring katmanında yapar (W4C ile aynı yaklaşım).
 * Doğrulama ZAYIFLAMAZ: Bus geçersiz domain/source'u kendi beyaz listesiyle `unknown`'a düşürür.
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
    }),
  };
}

/** Tek cleanup thunk — İDEMPOTENT. YALNIZ bridge'i dispose eder (Registry/Bus'a DOKUNMAZ). */
export type CapabilityBridgeWiringCleanup = () => void;

/** Bounded teşhis görünümü — event payload'ı / record detayı / topic TAŞIMAZ. */
export interface CapabilityBridgeWiringStatus {
  /** Bridge runtime'da kurulu mu (false → "ölçülemiyor", 0 event ile KARIŞTIRILMAZ). */
  readonly present: boolean;
  readonly started: boolean;
  readonly disposed: boolean;
  readonly publishedCount: number | null;
  readonly droppedCount: number | null;
  readonly lastPublishAt: number | null;
}

const NOOP_CLEANUP: CapabilityBridgeWiringCleanup = () => { /* no-op */ };

const ABSENT_STATUS: CapabilityBridgeWiringStatus = Object.freeze({
  present: false, started: false, disposed: false,
  publishedCount: null, droppedCount: null, lastPublishAt: null,
});

let _active: CapabilityEventBridge | null = null;

/** Bayat kayıt (HMR/restart artığı: dispose edilmiş bridge) → serbest bırak. */
function _pruneStale(): void {
  if (_active && _active.isDisposed) _active = null;
}

/**
 * Bridge'i oluşturur, Registry'ye abone eder ve TEK aktif bus'a publish etmesini sağlar.
 * YALNIZ cleanup thunk döner. Dışarı exception KAÇIRMAZ. İDEMPOTENT (ikinci çağrı yeni
 * Registry aboneliği AÇMAZ). Bus yoksa fail-soft no-op.
 */
export function startPlatformCoreCapabilityBridgeWiring(
  deps: CapabilityBridgeWiringDeps = {},
): CapabilityBridgeWiringCleanup {
  let bridge: CapabilityEventBridge | null = null;
  try {
    _pruneStale();
    if (_active) return NOOP_CLEANUP;              // zaten aktif → ikinci abonelik YOK

    const appBus = getAppEventBus();               // W3'ün TEK aktif bus'ı
    const bus: BridgePublishTarget | null = deps.bus ?? (appBus ? _toPublishTarget(appBus) : null);
    if (!bus) return NOOP_CLEANUP;                 // bus yok → sessiz no-op (boot sürer)
    const registry = deps.registry ?? capabilityRegistry; // W3 wiring'in beslediği singleton

    bridge = createCapabilityEventBridge({ registry, bus });
    const own = bridge;
    _active = own;
    own.start();                                   // Registry aboneliği + sayım tohumlama (bridge içi fail-soft)

    let disposed = false;
    return () => {
      if (disposed) return;                        // İDEMPOTENT
      disposed = true;
      try {
        own.dispose();                             // YALNIZ bridge — Registry/Bus DISPOSE EDİLMEZ
      } catch (e) {
        logError('capabilityBridgeWiring:cleanup', e);   // cleanup hatası shutdown'ı engellemez
      }
      if (_active === own) _active = null;         // yalnız KENDİ kaydını siler
    };
  } catch (e) {
    if (bridge && _active === bridge) _active = null;    // yarım kayıt bırakma
    logError('capabilityBridgeWiring:init', e);          // ham event/capability/VIN LOGLANMAZ
    return NOOP_CLEANUP;                                 // boot devam eder (fail-soft)
  }
}

/** Bounded teşhis görünümü. Bridge yoksa `present:false` + null sayaçlar. Throw ETMEZ. */
export function getCapabilityBridgeStatus(): CapabilityBridgeWiringStatus {
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
