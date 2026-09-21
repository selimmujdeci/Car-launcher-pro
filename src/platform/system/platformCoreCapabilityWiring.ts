/**
 * platformCoreCapabilityWiring — Capability Registry RUNTIME WIRING (PR-W3 + HYBRID-F3).
 *
 * AMAÇ: Daha önce foundation olarak hazırlanmış Capability Provider Adapter + runtime
 * provider'ları, ilk kez gerçek `capabilityRegistry` singleton'ına — SALT-OKUNUR AYNA
 * MODUNDA — bağlar. Zincir:
 *
 *   deviceCapabilities (getDeviceTier/getNativeResourceEvidence)   (kanonik cihaz kanıtı, F0)
 *     → decideLocalModelEligibility()                              (kanonik eligibility, F1)
 *     → createRuntimeCapabilityProviders({ env, probes: { localModel } })  (kanıt → provider)
 *     → createCapabilityProviderAdapter({ registry, providers })   (provider → registry.resolveCapability)
 *     → capabilityRegistry                                         (singleton, PAYLAŞILAN)
 *
 * EN KÜÇÜK GÜVENLİ AKTİVASYON (bilinçli kapsam, PR-W3): yan-etkisiz, salt-okunur browser-API +
 * `deviceTier` kanıtı bağlanır (device.gps/microphone/bluetooth/wifi/cellular, navigation.gps).
 * PROBE-TABANLI provider'lardan YALNIZ `ai.local_model` (HYBRID-F3) bağlanır — o da hiçbir yeni
 * ölçüm/native çağrı EKLEMEZ, yalnız ZATEN VAR OLAN F0 (`deviceCapabilities`) + F1
 * (`localModelEligibility`) kanonik kanıtını `runtimeCapabilityProviders`'a AKTARIR. Diğer
 * probe-tabanlı provider'lar (secureStorage / AI BYOK config / modül runtime hazırlığı /
 * offline map-routing) BİLİNÇLİ OLARAK BAĞLANMAZ → ilgili capability'ler Registry'de `unknown`
 * KALIR (dürüst boşluk, zero-trust); onlar AYRI PR'ların kapsamıdır.
 *
 * ── HYBRID-F3 · TIER OTORİTE DÜZELTMESİ (kanıtlanmış bug) ──────────────────────────────────
 * `capabilityRegistry` singleton'ı `deviceTier` DI'sı OLMADAN oluşturulduğu için `_tierProvider`
 * SABİT `'low'`a düşüyordu (bkz. `capabilityRegistry.ts` `setDeviceTierProvider` docblock'u) —
 * `deviceTierMinimum` kısıtlı HER capability (`ai.local_model` dahil) provider `available` dese
 * BİLE ASLA `available` OLAMIYORDU (hep `restricted`). Bu İKİNCİ bir karar mantığı DEĞİLDİ —
 * VAR OLAN TEK DI noktasının hiç BESLENMEMİŞ olmasıydı. Bu wiring artık singleton'a GERÇEK
 * `getDeviceTier()`'ı bağlar (`registry.setDeviceTierProvider(...)`) — Registry'nin karar
 * kuralları (TIER_RANK karşılaştırması) DEĞİŞMEDİ, yalnız okuduğu kaynak DOĞRU hale geldi.
 *
 * NE YAPMAZ (bilinçli — PR-W3 yalnız Registry kanıt girişini aktive eder):
 *  - Event Bus'a YAYINLAMAZ · Deep Scan'i BAĞLAMAZ · Platform Kernel'e servis KAYDETMEZ ·
 *    tüketicileri Registry'ye TAŞIMAZ · UI/SQL/native/OBD/CAN'e DOKUNMAZ · yeni timer/polling
 *    AÇMAZ · Registry KARAR KURALLARINI değiştirmez (yalnız kanıt besler; status'ü Registry çözer).
 *  - Registry/adapter/provider'ı DOĞRUDAN import etse de yapıcılar YAN ETKİSİZDİR — `start...()`
 *    çağrılana dek hiçbir provider okunmaz, Registry beslenmez, navigator'a dokunulmaz.
 *  - `ai.local_model` probe'u model YÜKLEMEZ, runtime BAŞLATMAZ, inference routing DEĞİŞTİRMEZ —
 *    `runtimeAvailable`/`modelLoaded` bu fazda SABİT `false` (gerçek runtime/model henüz yok).
 *
 * TEK INSTANCE (duplicate/HMR koruması): modül-düzeyi `_active` kaydı → wiring AKTİFKEN ikinci
 * `start...()` çağrısı YENİ adapter OLUŞTURMAZ (no-op cleanup döner). Bayat kayıt (adapter
 * disposed) otomatik temizlenir. Cleanup yalnız KENDİ kaydını siler → boot→shutdown→boot güvenli.
 *
 * SAHİPLİK: adapter bu wiring'e aittir (cleanup'ta dispose edilir). `capabilityRegistry`
 * PAYLAŞILAN modül singleton'ıdır → cleanup Registry'yi DISPOSE ETMEZ (çift-dispose yok).
 * `setDeviceTierProvider` çağrısı da Registry'yi DISPOSE ETMEZ/sıfırlamaz — yalnız gelecek
 * `_tier()` okumalarını etkiler (cleanup'ta GERİ ALINMAZ, çünkü singleton PAYLAŞILAN kalır).
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
  type LocalModelEvidence,
} from '../capability';
import { getDeviceTier, getNativeResourceEvidence } from '../deviceCapabilities';
import type { DeviceTier } from '../deviceCapabilities';
import { decideLocalModelEligibility } from '../ai/local/localModelEligibility';

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
    const tierSnapshot: DeviceTier = deps.deviceTier ?? getDeviceTier();

    /* HYBRID-F3 · TIER OTORİTE DÜZELTMESİ: yalnız GERÇEK singleton kullanılıyorsa (test'te
     * DI edilen izole registry DEĞİL) `_tierProvider`ı GERÇEK `getDeviceTier()`'a bağla.
     * `deps.deviceTier` sabit verilmişse (test/gelecekteki DI) o SABİT değeri kapsayan bir
     * fonksiyon verilir — Registry'nin kendi kararı hâlâ TEK kaynaktan (bu wiring'in gördüğü
     * AYNI tier) beslenir, ikinci bir tier hesaplaması KURULMAZ. Registry'yi dispose ETMEZ,
     * cleanup'ta GERİ ALINMAZ (singleton PAYLAŞILAN kalır — dosya başlığına bkz.). */
    if (registry === capabilityRegistry) {
      capabilityRegistry.setDeviceTierProvider(
        deps.deviceTier !== undefined ? () => deps.deviceTier as DeviceTier : getDeviceTier,
      );
    }

    /**
     * HYBRID-F3 · `ai.local_model` kanıt köprüsü. YENİ ölçüm/eligibility hesabı YAPMAZ:
     * F0 (`getNativeResourceEvidence`) + F1 (`decideLocalModelEligibility`) kanonik zincirini
     * OLDUĞU GİBİ okuyup `LocalModelEvidence`'a çevirir. `runtimeAvailable`/`modelLoaded`
     * bu fazda SABİT `false`'tur (gerçek runtime/model YOK) — F5/F6'da gerçek kanıtla
     * değiştirilecek TEK NOKTA burasıdır (provider/Registry sözleşmesi DEĞİŞMEZ).
     */
    const localModelProbe = (): LocalModelEvidence | null => {
      try {
        const resEv = getNativeResourceEvidence();
        const eligibility = decideLocalModelEligibility({
          deviceTier:      tierSnapshot,
          isLowRamDevice:  resEv?.isLowRamDevice,
          supportedAbis:   resEv?.supportedAbis,
          totalRamMb:      resEv?.totalRamMb,
          availMemMb:      resEv?.availMemMb,
          usableStorageMb: resEv?.usableStorageMb,
          cpuCoreCount:    resEv?.cpuCoreCount,
          sdkInt:          resEv?.sdkInt,
        });
        return {
          eligibilityStatus: eligibility.status,
          eligibilityReason: eligibility.status !== 'eligible' ? eligibility.reason : undefined,
          runtimeAvailable:  false,
          modelLoaded:       false,
        };
      } catch {
        return null;   // fail-soft → capability unknown (adapter zaten ayrıca try/catch sarar)
      }
    };

    // Provider'lar: test override YOKSA navigator + deviceTier'dan gerçek browser-API
    // provider'ları + `ai.local_model` (HYBRID-F3) üretilir. Diğer probe'lar BİLİNÇLİ
    // OLARAK geçilmez (dosya başlığı — en küçük kapsam korunur). Fabrika YAN ETKİSİZ:
    // navigator/probe yalnız adapter `read()`'inde okunur.
    const providers: readonly CapabilityProvider[] = deps.providers ?? createRuntimeCapabilityProviders({
      env: {
        navigator: 'navigator' in deps
          ? deps.navigator
          : (typeof navigator !== 'undefined' ? (navigator as unknown as NavigatorLike) : null),
        deviceTier: tierSnapshot,
      },
      probes: { localModel: localModelProbe },
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
