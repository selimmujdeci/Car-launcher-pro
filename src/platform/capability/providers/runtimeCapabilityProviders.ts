/**
 * runtimeCapabilityProviders — İLK gerçek Capability Provider kaynakları — FOUNDATION.
 *
 * KÖPRÜ: (gerçek runtime/browser/native kanıtları) → Capability Provider sözleşmesi
 * (`{id, domain, source, read()}`) → Capability Provider Adapter → Capability Registry.
 *
 * ⚠️ KANIT SINIFLANDIRMASI (zero-trust — modül varlığı ≠ available):
 *  - **Browser API presence** (navigator.geolocation/mediaDevices/bluetooth/connection):
 *    yalnız "API var" der → donanımı KESİNLEŞTİRMEZ → `degraded` / düşük confidence.
 *    API YOK → `null` (unknown), çünkü WebView kısıtı donanım yokluğu anlamına GELMEZ.
 *  - **navigator.connection.type** kesin `wifi`/`cellular` ise o an o bağlantı GERÇEKTEN
 *    aktif → `available` (orta confidence); başka tip/eksik → `null` (unknown).
 *  - **Native authoritative probe** (secure storage): gerçek native kanıt → `available`
 *    (authoritative, yüksek confidence).
 *  - **Modül runtime readiness** (deep_scan/vehicle_learning/assistant_context/ota/
 *    safety_kernel/offline_commands/offline_conversation/push/cloud_commands): modül VAR
 *    ama runtime bağlı DEĞİL → `degraded` (experimental); runtime hazır → `available`;
 *    modül yok/kaynak yok → `null` (unknown). "Dosya/export var" TEK BAŞINA available DEĞİL.
 *  - **AI provider config (BYOK)** (gemini/groq/claude/cloud): configured + network usable
 *    → `available`; configured ama kullanılamaz → `degraded`; configured değil → `unavailable`.
 *  - **Kaynak YOK:** `ai.grok` (xAI entegrasyonu yok → provider HİÇ ÜRETİLMEZ),
 *    `ai.local_model` (gerçek yerel LLM yok → probe yoksa unknown, modelLoaded=false → unavailable).
 *
 * NE YAPMAZ (bilinçli — bu PR yalnız provider FOUNDATION'ıdır):
 *  - Ağır modülleri IMPORT ETMEZ (yalnız TYPE import) → import YAN ETKİSİZDİR. Modül/config/
 *    native kanıtları DI ile enjekte edilen `probes` fonksiyonlarından okunur (wiring PR
 *    gerçek prob'ları geçirir). Browser API'leri yalnız `read()` çağrılınca okunur.
 *  - Event Bus'a YAYINLAMAZ · SystemBoot'a BAĞLANMAZ · Registry'yi otomatik başlatmaz ·
 *    native tarama/OBD-CAN sorgusu BAŞLATMAZ · UI/SQL/persistence YOK · timer/polling YOK.
 *  - GLOBAL SINGLETON üretmez; provider'lar yalnız fabrika çağrılınca oluşur.
 *
 * PERFORMANS/MALİ-400: fabrika probe ÇAĞIRMAZ (yan etkisiz); okuma yalnız `read()`'te,
 * bounded (tek navigator/probe okuması); low-tier'da AĞIR provider (local_model) OLUŞTURULMAZ.
 * FAIL-SOFT: her `read()` kendi probe'unu try/catch ile sarar → ASLA throw etmez, hata→null.
 * GİZLİLİK: sonuçlar yalnız sabit literal reason/details taşır (VIN/MAC/koordinat/anahtar YOK).
 */

import type { CapabilityDomain, CapabilitySource } from '../capabilityRegistry';
import type { CapabilityProvider, CapabilityProviderResult, CapabilityRefreshPolicy } from '../capabilityProviderAdapter';
import type { DeviceTier } from '../../deviceCapabilities';

/* ══════════════════════════════════════════════════════════════════════════
 * Enjekte kanıt tipleri (DI — wiring PR gerçek prob'ları geçirir)
 * ════════════════════════════════════════════════════════════════════════ */

/** Native/runtime authoritative depolama kanıtı. */
export interface SecureStorageEvidence {
  readonly available: boolean;
  /** Gerçek native secure storage mı (authoritative). */
  readonly native?: boolean;
}

/** BYOK AI sağlayıcı kanıtı — anahtar payload'ı DEĞİL, yalnız durum. */
export interface AiProviderEvidence {
  readonly configured: boolean;
  /** Ağ/erişim ile GERÇEKTEN kullanılabilir mi. */
  readonly usable?: boolean;
}

/** Modül varlığı ↔ runtime hazırlığı ayrımı. */
export interface ModuleRuntimeEvidence {
  /** Modül kod/export olarak MEVCUT mu (tek başına available DEĞİL). */
  readonly moduleExists?: boolean;
  /** Runtime GERÇEKTEN bağlı/hazır mı. */
  readonly runtimeReady?: boolean;
}

/** Yerel LLM model kanıtı. */
export interface LocalModelEvidence {
  readonly modelLoaded: boolean;
}

/** Offline harita/graf gibi kaynak varlığı kanıtı. */
export interface ResourcePresenceEvidence {
  /** Gerçek paket/dosya/graf MEVCUT mu. */
  readonly present: boolean;
  /** Runtime kullanıma hazır mı (aksi hâlde degraded). */
  readonly ready?: boolean;
}

export type AiProviderId = 'gemini' | 'groq' | 'claude';

/** navigator alt-kümesi (test için enjekte edilebilir; varsayılan globalThis.navigator). */
export interface NavigatorLike {
  readonly geolocation?: unknown;
  readonly mediaDevices?: { getUserMedia?: unknown } | undefined;
  readonly bluetooth?: unknown;
  readonly connection?: { type?: string; effectiveType?: string } | undefined;
  readonly permissions?: { query?: (desc: { name: string }) => Promise<{ state: string }> } | undefined;
}

export interface RuntimeProbeEnv {
  /** navigator kaynağı (varsayılan: globalThis.navigator). Test için enjekte edilir. */
  readonly navigator?: NavigatorLike | null;
  /** DeviceTier — low/mid'de AĞIR provider (local_model) oluşturulmaz. */
  readonly deviceTier?: DeviceTier;
}

/** Enjekte runtime prob'ları — hiçbiri verilmezse ilgili provider unknown/atlanır. */
export interface RuntimeProbes {
  readonly secureStorage?: () => SecureStorageEvidence | null;
  readonly aiProvider?: (id: AiProviderId) => AiProviderEvidence | null;
  readonly offlineCommands?: () => ModuleRuntimeEvidence | null;
  readonly offlineConversation?: () => ModuleRuntimeEvidence | null;
  readonly localModel?: () => LocalModelEvidence | null;
  readonly safetyKernel?: () => ModuleRuntimeEvidence | null;
  readonly deepScan?: () => ModuleRuntimeEvidence | null;
  readonly vehicleLearning?: () => ModuleRuntimeEvidence | null;
  readonly assistantContext?: () => ModuleRuntimeEvidence | null;
  readonly ota?: () => ModuleRuntimeEvidence | null;
  readonly offlineMap?: () => ResourcePresenceEvidence | null;
  readonly offlineRouting?: () => ResourcePresenceEvidence | null;
  readonly pushNotifications?: () => ModuleRuntimeEvidence | null;
  readonly cloudCommands?: () => ModuleRuntimeEvidence | null;
}

export interface RuntimeCapabilityProvidersDeps {
  readonly env?: RuntimeProbeEnv;
  readonly probes?: RuntimeProbes;
}

/** Adapter MAX_CAPABILITY_PROVIDERS (128) ile uyumlu — bu foundation çok daha az üretir. */
export const MAX_RUNTIME_CAPABILITY_PROVIDERS = 64;

/* ══════════════════════════════════════════════════════════════════════════
 * Sonuç kurucular (dondurulmuş — Registry source/confidence modeli ile uyumlu)
 * ════════════════════════════════════════════════════════════════════════ */

/** API var ama donanım doğrulanamıyor → degraded, düşük confidence. */
function _apiPresent(reason: string, source: CapabilitySource = 'runtime'): CapabilityProviderResult {
  return Object.freeze({ status: 'degraded', quality: 'low', confidence: 0.4, source, reason });
}

/** O an aktif kesin bağlantı (wifi/cellular) → available, orta confidence. */
function _liveAvailable(reason: string, source: CapabilitySource = 'runtime', confidence = 0.7): CapabilityProviderResult {
  return Object.freeze({ status: 'available', available: true, quality: 'medium', confidence, source, reason });
}

/** Native authoritative kanıt → available, yüksek confidence. */
function _authoritativeAvailable(reason: string, source: CapabilitySource = 'native', confidence = 0.95): CapabilityProviderResult {
  return Object.freeze({ status: 'available', available: true, quality: 'high', confidence, source, reason });
}

function _degraded(reason: string, source: CapabilitySource = 'runtime', confidence = 0.5): CapabilityProviderResult {
  return Object.freeze({ status: 'degraded', quality: 'low', confidence, source, reason });
}

function _unavailable(reason: string, source: CapabilitySource = 'runtime', confidence = 0.6): CapabilityProviderResult {
  return Object.freeze({ status: 'unavailable', available: false, quality: 'unknown', confidence, source, reason });
}

function _restricted(reason: string, source: CapabilitySource = 'runtime', confidence = 0.6): CapabilityProviderResult {
  return Object.freeze({ status: 'restricted', quality: 'low', confidence, source, reason });
}

/** Modül varlığı ↔ runtime hazırlığı → available/degraded/null. */
function _moduleResult(e: ModuleRuntimeEvidence | null, source: CapabilitySource = 'runtime', confidence = 0.8): CapabilityProviderResult | null {
  if (!e || typeof e !== 'object') return null;                   // kaynak yok → unknown
  if (e.runtimeReady === true) return Object.freeze({ status: 'available', available: true, quality: 'medium', confidence, source, reason: 'runtime_ready' });
  if (e.moduleExists === true) return Object.freeze({ status: 'degraded', quality: 'low', confidence: 0.5, source, reason: 'module_exists_unwired', details: Object.freeze({ module: 'exists', runtime: 'unwired' }) });
  return null;                                                    // modül yok → unknown
}

/* ══════════════════════════════════════════════════════════════════════════
 * navigator erişimi (yalnız read()'te; fabrika okumaz)
 * ════════════════════════════════════════════════════════════════════════ */

function _nav(env?: RuntimeProbeEnv): NavigatorLike | null {
  if (env && env.navigator !== undefined) return env.navigator; // enjekte (null dahil)
  try {
    return typeof navigator !== 'undefined' ? (navigator as unknown as NavigatorLike) : null;
  } catch {
    return null;
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * Provider inşa yardımcısı
 * ════════════════════════════════════════════════════════════════════════ */

interface ProviderSpec {
  readonly id: string;
  readonly domain: CapabilityDomain;
  readonly source: CapabilitySource;
  readonly authoritative?: boolean;
  readonly refreshPolicy?: CapabilityRefreshPolicy;
  readonly read: () => CapabilityProviderResult | null | Promise<CapabilityProviderResult | null>;
}

/** read()'i try/catch ile sarar → provider ASLA throw etmez (fail-soft izolasyon). */
function _makeProvider(spec: ProviderSpec): CapabilityProvider {
  return {
    id: spec.id,
    domain: spec.domain,
    source: spec.source,
    authoritative: spec.authoritative,
    refreshPolicy: spec.refreshPolicy,
    read: () => {
      try {
        const r = spec.read();
        if (r && typeof (r as Promise<unknown>).then === 'function') {
          return (r as Promise<CapabilityProviderResult | null>).catch(() => null);
        }
        return r as CapabilityProviderResult | null;
      } catch {
        return null;                                             // probe throw → güvenli unknown
      }
    },
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * Fabrika
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * DI ile gerçek runtime/browser/native provider'larını üretir. YAN ETKİSİZ: hiçbir probe
 * ÇAĞRILMAZ, navigator OKUNMAZ (yalnız `read()`'te) → import/oluşturma davranış değiştirmez.
 * Kaynağı olmayan capability için provider ÜRETİLMEZ (ör. ai.grok) → dürüst boşluk.
 */
export function createRuntimeCapabilityProviders(
  deps: RuntimeCapabilityProvidersDeps = {},
): CapabilityProvider[] {
  const env = deps.env;
  const probes = deps.probes ?? {};
  const tier: DeviceTier | undefined = env?.deviceTier;
  const out: CapabilityProvider[] = [];
  const push = (s: ProviderSpec) => {
    if (out.length < MAX_RUNTIME_CAPABILITY_PROVIDERS) out.push(_makeProvider(s));
  };

  /* ── Device: browser API presence (degraded) / connection type (available) ── */

  // device.gps — navigator.geolocation presence (donanım doğrulanamaz → degraded).
  const gpsRead = (): CapabilityProviderResult | null => {
    const nav = _nav(env);
    return nav && nav.geolocation != null ? _apiPresent('geolocation_api_present') : null;
  };
  push({ id: 'device.gps', domain: 'device', source: 'runtime', refreshPolicy: 'once', read: gpsRead });

  // navigation.gps — device.gps'e BAĞIMLI (aynı kanıt, navigation domain).
  push({ id: 'navigation.gps', domain: 'navigation', source: 'runtime', refreshPolicy: 'once', read: gpsRead });

  // device.microphone — API presence + permission (izin verilmedikçe available YAPMA).
  push({
    id: 'device.microphone', domain: 'device', source: 'runtime', refreshPolicy: 'on_refresh',
    read: async () => {
      const nav = _nav(env);
      const hasApi = !!(nav && nav.mediaDevices && typeof nav.mediaDevices.getUserMedia !== 'undefined');
      if (!hasApi) return null;                                   // API yok → unknown
      // Permission durumu (varsa) — granted olmadan available OLMAZ.
      let state: string | null = null;
      try {
        if (nav?.permissions?.query) {
          const res = await nav.permissions.query({ name: 'microphone' });
          state = res && typeof res.state === 'string' ? res.state : null;
        }
      } catch { state = null; }
      if (state === 'denied') return _restricted('microphone_permission_denied');
      if (state === 'granted') return Object.freeze({ status: 'available', available: true, quality: 'medium', confidence: 0.6, source: 'runtime', reason: 'microphone_permission_granted' });
      return _apiPresent('microphone_api_present_permission_unknown'); // prompt/unknown → degraded
    },
  });

  // device.bluetooth — Web Bluetooth API presence (native adaptör doğrulanamaz → degraded).
  push({
    id: 'device.bluetooth', domain: 'device', source: 'runtime', refreshPolicy: 'once',
    read: () => {
      const nav = _nav(env);
      return nav && nav.bluetooth != null ? _apiPresent('web_bluetooth_api_present') : null;
    },
  });

  // device.wifi — navigator.connection.type === 'wifi' → available; aksi hâlde unknown.
  push({
    id: 'device.wifi', domain: 'device', source: 'runtime', refreshPolicy: 'on_refresh',
    read: () => {
      const nav = _nav(env);
      const t = nav?.connection?.type;
      if (t === 'wifi') return _liveAvailable('connection_type_wifi');
      return null;                                               // başka tip/eksik → unknown
    },
  });

  // device.cellular — navigator.connection.type === 'cellular' → available; aksi unknown.
  push({
    id: 'device.cellular', domain: 'device', source: 'runtime', refreshPolicy: 'on_refresh',
    read: () => {
      const nav = _nav(env);
      const t = nav?.connection?.type;
      if (t === 'cellular') return _liveAvailable('connection_type_cellular');
      return null;
    },
  });

  /* ── Secure storage (authoritative native) — device + platform ── */

  const secureStorageRead = (): CapabilityProviderResult | null => {
    const e = probes.secureStorage ? probes.secureStorage() : null;
    if (!e || typeof e !== 'object') return null;                // kaynak yok → unknown
    if (e.available && e.native) return _authoritativeAvailable('native_secure_storage');
    if (e.available) return _degraded('secure_storage_non_native', 'runtime', 0.5);
    return _unavailable('secure_storage_unavailable');
  };
  if (probes.secureStorage) {
    push({ id: 'device.storage.secure', domain: 'device', source: 'native', authoritative: true, refreshPolicy: 'once', read: secureStorageRead });
    push({ id: 'platform.secure_storage', domain: 'platform', source: 'native', authoritative: true, refreshPolicy: 'once', read: secureStorageRead });
  }

  /* ── Platform modülleri: varlık ↔ runtime hazırlığı ── */

  if (probes.deepScan) push({ id: 'platform.deep_scan', domain: 'platform', source: 'runtime', refreshPolicy: 'on_refresh', read: () => _moduleResult(probes.deepScan!()) });
  if (probes.vehicleLearning) push({ id: 'platform.vehicle_learning', domain: 'platform', source: 'runtime', refreshPolicy: 'on_refresh', read: () => _moduleResult(probes.vehicleLearning!()) });
  if (probes.assistantContext) push({ id: 'platform.assistant_context', domain: 'platform', source: 'runtime', refreshPolicy: 'on_refresh', read: () => _moduleResult(probes.assistantContext!()) });
  if (probes.ota) push({ id: 'platform.ota', domain: 'platform', source: 'runtime', refreshPolicy: 'on_refresh', read: () => _moduleResult(probes.ota!()) });

  /* ── AI: offline (local) ── */

  if (probes.offlineCommands) push({ id: 'ai.offline_commands', domain: 'ai', source: 'runtime', refreshPolicy: 'on_refresh', read: () => _moduleResult(probes.offlineCommands!(), 'runtime', 0.85) });
  if (probes.offlineConversation) push({ id: 'ai.offline_conversation', domain: 'ai', source: 'runtime', refreshPolicy: 'on_refresh', read: () => _moduleResult(probes.offlineConversation!(), 'runtime', 0.8) });

  // ai.safety_kernel — güvenlik-kritik yerel modül (runtime availability).
  if (probes.safetyKernel) push({ id: 'ai.safety_kernel', domain: 'ai', source: 'runtime', refreshPolicy: 'on_refresh', read: () => _moduleResult(probes.safetyKernel!(), 'runtime', 0.85) });

  /* ── AI: cloud (BYOK configured + usable) ── */

  const aiProviderRead = (id: AiProviderId) => (): CapabilityProviderResult | null => {
    const e = probes.aiProvider ? probes.aiProvider(id) : null;
    if (!e || typeof e !== 'object') return null;                // kaynak yok → unknown
    if (e.configured && e.usable) return _liveAvailable(`${id}_configured_usable`, 'config', 0.75);
    if (e.configured) return _degraded(`${id}_configured_unusable`, 'config', 0.5);
    return _unavailable(`${id}_not_configured`, 'config');
  };
  if (probes.aiProvider) {
    push({ id: 'ai.gemini', domain: 'ai', source: 'config', refreshPolicy: 'on_refresh', read: aiProviderRead('gemini') });
    push({ id: 'ai.groq', domain: 'ai', source: 'config', refreshPolicy: 'on_refresh', read: aiProviderRead('groq') });
    push({ id: 'ai.claude', domain: 'ai', source: 'config', refreshPolicy: 'on_refresh', read: aiProviderRead('claude') });
    // ai.cloud — en az bir cloud provider configured + usable ise available.
    push({
      id: 'ai.cloud', domain: 'ai', source: 'config', refreshPolicy: 'on_refresh',
      read: () => {
        const ids: AiProviderId[] = ['gemini', 'groq', 'claude'];
        let anyConfigured = false;
        for (const id of ids) {
          const e = probes.aiProvider!(id);
          if (e && typeof e === 'object') {
            if (e.configured && e.usable) return _liveAvailable('cloud_provider_usable', 'config', 0.75);
            if (e.configured) anyConfigured = true;
          }
        }
        return anyConfigured ? _degraded('cloud_configured_unusable', 'config', 0.5) : _unavailable('no_cloud_provider', 'config');
      },
    });
  }

  // ai.grok — xAI entegrasyonu YOK → provider HİÇ ÜRETİLMEZ (dürüst boşluk → Registry unknown kalır).

  // ai.local_model — gerçek yerel LLM yok; yalnız yüksek tier'da VE probe verilmişse üret (Mali-400/low AĞIR provider yok).
  if (probes.localModel && tier === 'high') {
    push({
      id: 'ai.local_model', domain: 'ai', source: 'runtime', refreshPolicy: 'on_refresh',
      read: () => {
        const e = probes.localModel!();
        if (!e || typeof e !== 'object') return null;
        return e.modelLoaded ? _liveAvailable('local_model_loaded', 'runtime', 0.7) : _unavailable('local_model_not_loaded');
      },
    });
  }

  /* ── Navigation: offline map/routing (gerçek paket/graf) ── */

  if (probes.offlineMap) {
    push({
      id: 'navigation.offline_map', domain: 'navigation', source: 'runtime', refreshPolicy: 'on_refresh',
      read: () => {
        const e = probes.offlineMap!();
        if (!e || typeof e !== 'object') return null;
        if (!e.present) return _unavailable('offline_map_package_absent');
        return e.ready === false ? _degraded('offline_map_present_not_ready') : _liveAvailable('offline_map_present', 'runtime', 0.7);
      },
    });
  }
  if (probes.offlineRouting) {
    push({
      id: 'navigation.offline_routing', domain: 'navigation', source: 'runtime', refreshPolicy: 'on_refresh',
      read: () => {
        const e = probes.offlineRouting!();
        if (!e || typeof e !== 'object') return null;
        if (!e.present) return _unavailable('offline_routing_graph_absent');
        return e.ready ? _liveAvailable('offline_routing_ready', 'runtime', 0.7) : _degraded('offline_routing_graph_present_not_ready');
      },
    });
  }

  /* ── Remote: push / cloud commands (runtime availability) ── */

  if (probes.pushNotifications) push({ id: 'remote.push_notifications', domain: 'remote', source: 'runtime', refreshPolicy: 'on_refresh', read: () => _moduleResult(probes.pushNotifications!()) });
  if (probes.cloudCommands) push({ id: 'remote.cloud_commands', domain: 'remote', source: 'runtime', refreshPolicy: 'on_refresh', read: () => _moduleResult(probes.cloudCommands!()) });

  return out;
}
