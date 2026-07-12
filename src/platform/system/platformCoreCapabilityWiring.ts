/**
 * platformCoreCapabilityWiring — Capability Registry RUNTIME WIRING (PR-W3).
 *
 * AMAÇ: Daha önce foundation olarak hazırlanmış Capability Provider Adapter + runtime
 * provider'ları, ilk kez gerçek `capabilityRegistry` singleton'ına — SALT-OKUNUR AYNA
 * MODUNDA — bağlar. Zincir:
 *
 *   createRuntimeCapabilityProviders({ env: { navigator, deviceTier } })  (gerçek browser-API kanıtı)
 *     → createCapabilityProviderAdapter({ registry, providers })          (kanıt → registry.resolveCapability)
 *     → capabilityRegistry                                                (singleton; kimse tüketmez — migrasyon AYRI PR)
 *
 * EN KÜÇÜK GÜVENLİ AKTİVASYON (bilinçli kapsam): YALNIZ yan-etkisiz, salt-okunur
 * browser-API + `deviceTier` kanıtı bağlanır (device.gps/microphone/bluetooth/wifi/cellular,
 * navigation.gps). PROBE-TABANLI provider'lar (secureStorage / AI BYOK config / modül
 * runtime hazırlığı / offline map-routing) BİLİNÇLİ OLARAK BAĞLANMAZ → ilgili capability'ler
 * Registry'de `unknown` KALIR (dürüst boşluk, zero-trust). Bu, yeni yan etki / yeni modül
 * import'u / native çağrı eklemeden en küçük gerçek-kanıt akışını sağlar; gerçek probe'lar
 * sonraki PR'da eklenir (foundation'ın tasarımı da bu — `runtimeCapabilityProviders` probe DI).
 *
 * NE YAPMAZ (bilinçli — PR-W3 yalnız Registry kanıt girişini aktive eder):
 *  - Event Bus'a YAYINLAMAZ · Deep Scan'i BAĞLAMAZ · Platform Kernel'e servis KAYDETMEZ ·
 *    tüketicileri Registry'ye TAŞIMAZ · UI/SQL/native/OBD/CAN'e DOKUNMAZ · yeni timer/polling
 *    AÇMAZ · Registry KARAR KURALLARINI değiştirmez (yalnız kanıt besler; status'ü Registry çözer).
 *  - Registry/adapter/provider'ı DOĞRUDAN import etse de yapıcılar YAN ETKİSİZDİR — `start...()`
 *    çağrılana dek hiçbir provider okunmaz, Registry beslenmez, navigator'a dokunulmaz.
 *
 * TEK INSTANCE (duplicate/HMR koruması): modül-düzeyi `_active` kaydı → wiring AKTİFKEN ikinci
 * `start...()` çağrısı YENİ adapter OLUŞTURMAZ (no-op cleanup döner). Bayat kayıt (adapter
 * disposed) otomatik temizlenir. Cleanup yalnız KENDİ kaydını siler → boot→shutdown→boot güvenli.
 *
 * SAHİPLİK: adapter bu wiring'e aittir (cleanup'ta dispose edilir). `capabilityRegistry`
 * PAYLAŞILAN modül singleton'ıdır → cleanup Registry'yi DISPOSE ETMEZ (çift-dispose yok).
 *
 * FAIL-SOFT: başlatma dışarı EXCEPTION KAÇIRMAZ — init hatası bir kez `logError` ile kaydedilir
 * ve güvenli no-op cleanup döner (ham kanıt/anahtar/PII LOGLANMAZ). ZERO-LEAK: cleanup adapter'ı
 * dispose eder; İDEMPOTENT (ikinci çağrı no-op). Adapter kendi refresh'ini fail-soft yürütür.
 */

import { logError } from '../crashLogger';
import {
  createCapabilityProviderAdapter,
  createRuntimeCapabilityProviders,
  capabilityRegistry,
  type CapabilityProviderAdapter,
  type CapabilityProvider,
  type CapabilityRegistryTarget,
  type NavigatorLike,
} from '../capability';
import { getDeviceTier } from '../deviceCapabilities';
import type { DeviceTier } from '../deviceCapabilities';

/** Wiring bağımlılıkları — hepsi opsiyonel (test enjeksiyonu); üretimde güvenli varsayılanlar. */
export interface CapabilityWiringDeps {
  /** Test için Registry hedefi; verilmezse üretim `capabilityRegistry` singleton'ı. */
  readonly registry?: CapabilityRegistryTarget | null;
  /** Test için hazır provider listesi; verilmezse navigator+deviceTier'dan gerçek provider'lar. */
  readonly providers?: readonly CapabilityProvider[] | null;
  /** Test için navigator; verilmezse `globalThis.navigator` (yalnız `read()`'te okunur). */
  readonly navigator?: NavigatorLike | null;
  /** Test için deviceTier; verilmezse `getDeviceTier()` (cache'li, salt-okunur). */
  readonly deviceTier?: DeviceTier;
  /** Test için monotonik zaman; verilmezse `Date.now`. */
  readonly now?: () => number;
}

/** Tek cleanup thunk — İDEMPOTENT + fail-soft. Registry'yi dispose ETMEZ. */
export type CapabilityWiringCleanup = () => void;

/** Bounded teşhis görünümü — ham kanıt YOK (yalnız sayaç/bayrak). */
export interface CapabilityWiringStatus {
  readonly started: boolean;
  readonly lastRefreshAt: number | null;
  /** Adapter'a verilen provider sayısı (bağlı kanıt kaynağı adedi). */
  readonly providerCount: number;
  /** Registry'ye en az bir kez çözülmüş AYRI capability sayısı. */
  readonly resolvedCount: number;
  /** refresh çağrı sayısı. */
  readonly refreshCount: number;
  /** Sabit, sanitize hata kodu (ham hata/telemetri değil). */
  readonly lastErrorCode: 'init_failed' | 'cleanup_failed' | null;
}

const NOOP_CLEANUP: CapabilityWiringCleanup = () => { /* no-op */ };

/** Tek runtime wiring kaydı (duplicate/HMR koruması). */
let _active: CapabilityProviderAdapter | null = null;
let _lastErrorCode: CapabilityWiringStatus['lastErrorCode'] = null;

const IDLE_STATUS: CapabilityWiringStatus = Object.freeze({
  started: false,
  lastRefreshAt: null,
  providerCount: 0,
  resolvedCount: 0,
  refreshCount: 0,
  lastErrorCode: null,
});

/**
 * Capability kanıt girişini kurar ve adapter'ı başlatır. YALNIZ cleanup thunk döner.
 * Dışarı exception KAÇIRMAZ (init hatası → tek `logError` + no-op cleanup).
 * İDEMPOTENT: aktif wiring varken ikinci çağrı YENİ adapter açmaz.
 */
export function startPlatformCoreCapabilityWiring(deps: CapabilityWiringDeps = {}): CapabilityWiringCleanup {
  let adapter: CapabilityProviderAdapter | null = null;
  try {
    // HMR/restart artığı: cleanup'sız kalan bayat kayıt → serbest bırak.
    if (_active && _active.isDisposed) _active = null;
    // Zaten aktif → ikinci adapter OLUŞTURULMAZ.
    if (_active) return NOOP_CLEANUP;

    const registry: CapabilityRegistryTarget = deps.registry ?? capabilityRegistry;

    // Provider'lar: test override YOKSA navigator + deviceTier'dan gerçek browser-API
    // provider'ları üretilir (probe DI GEÇİLMEZ → yalnız yan-etkisiz kanıt; en küçük kapsam).
    // Fabrika YAN ETKİSİZ: navigator yalnız adapter `read()`'inde okunur.
    const providers: readonly CapabilityProvider[] = deps.providers ?? createRuntimeCapabilityProviders({
      env: {
        navigator: 'navigator' in deps
          ? deps.navigator
          : (typeof navigator !== 'undefined' ? (navigator as unknown as NavigatorLike) : null),
        deviceTier: deps.deviceTier ?? getDeviceTier(),
      },
    });

    adapter = createCapabilityProviderAdapter({
      registry,
      providers,
      now: deps.now,
    });

    _active = adapter;
    adapter.start();          // adapter içi fail-soft (provider hatası izole; async refresh)
    _lastErrorCode = null;

    const started = adapter;
    let disposed = false;
    return () => {
      if (disposed) return;   // İDEMPOTENT
      disposed = true;
      try {
        started.dispose();    // adapter kilitlenir; Registry PAYLAŞILAN → dispose EDİLMEZ
      } catch (e) {
        _lastErrorCode = 'cleanup_failed';   // cleanup hatası shutdown'ı ENGELLEMEZ
        logError('capabilityWiring:cleanup', e);
      }
      if (_active === started) _active = null;   // yalnız KENDİ kaydını siler
    };
  } catch (e) {
    // Init hatası: wiring sınırında BİR KEZ kaydet (ham kanıt/anahtar/PII YOK), boot'u çökertme.
    if (adapter && _active === adapter) _active = null;   // yarım kayıt bırakma
    _lastErrorCode = 'init_failed';
    logError('capabilityWiring:init', e);
    return NOOP_CLEANUP;
  }
}

/** Bounded teşhis görünümü (prod log spam YOK). Throw ETMEZ. */
export function getPlatformCoreCapabilityWiringStatus(): CapabilityWiringStatus {
  const a = _active;
  if (!a || a.isDisposed) {
    return _lastErrorCode ? Object.freeze({ ...IDLE_STATUS, lastErrorCode: _lastErrorCode }) : IDLE_STATUS;
  }
  try {
    const s = a.getStatus();
    return Object.freeze({
      started: s.started,
      lastRefreshAt: s.lastRefreshAt,
      providerCount: s.providerCount,
      resolvedCount: s.resolvedCount,
      refreshCount: s.refreshCount,
      lastErrorCode: _lastErrorCode,
    });
  } catch {
    return IDLE_STATUS;   // teşhis yolu asla çökmez
  }
}
