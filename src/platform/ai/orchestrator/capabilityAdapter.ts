/**
 * capabilityAdapter — kayıtlı sağlayıcılardan `AiProviderCapability` üretir.
 *
 * ── UYDURMA YOK (en önemli kural) ───────────────────────────────────────────
 * Bir yetenek KANITLI DEĞİLSE bildirilmez. Bilinmeyen alan `undefined` bırakılır
 * (karar çekirdeği bunu NÖTR sayar); boolean yetenekler yalnız açıkça bildirilmişse
 * `true` olur. Özellikle:
 *   - `freeTier` varsayılan FALSE → ücretsiz erişim VARSAYILMAZ.
 *   - `reliabilityTier` varsayılan TANIMSIZ → yüksek güvenilirlik VARSAYILMAZ.
 *   - `supportsVision`/`supportsTools` kanıt olmadan `true` YAPILMAZ.
 *
 * ── SAĞLAYICI ADI NEREDE ────────────────────────────────────────────────────
 * Yetenek ipuçları BU DOSYADAKİ veri tablosunda durur (kayıt defteri deseni).
 * Karar çekirdeği (`maviModelOrchestrator`) ve yürütücü bu adları GÖRMEZ.
 * Yeni sağlayıcı = tabloya bir satır; ipucu yoksa konservatif varsayılan uygulanır.
 */

import type { AiProviderCapability, MaviTaskType } from './orchestratorTypes';

/** Bir sağlayıcı için elle doğrulanmış yetenek ipuçları. */
export interface CapabilityHints {
  readonly supportsStreaming?:   boolean;
  readonly supportsReasoning?:   boolean;
  readonly supportsVision?:      boolean;
  readonly supportsTools?:       boolean;
  readonly supportsLongContext?: boolean;
  readonly supportsOffline?:     boolean;
  readonly costTier?:            AiProviderCapability['costTier'];
  readonly latencyTier?:         AiProviderCapability['latencyTier'];
  readonly reliabilityTier?:     AiProviderCapability['reliabilityTier'];
  readonly freeTier?:            boolean;
  readonly modelsByTask?:        Partial<Record<MaviTaskType, string>>;
}

/**
 * KANITA DAYALI ipuçları. Yalnız kod tabanında/uç nokta sözleşmesinde
 * doğrulanmış nitelikler yazılır — pazarlama iddiaları değil.
 *
 * Şu an tek gerçek gateway sağlayıcısı var; yine de tablo çok-sağlayıcılıdır.
 */
const CAPABILITY_HINTS: Readonly<Record<string, CapabilityHints>> = {
  /* Tek anahtarla çok-model yönlendirme; SSE akışı provider'da uygulanmış
     (openRouterProvider streaming ayrıştırıcısı). Gecikme/güvenilirlik seçilen
     modele göre DEĞİŞTİĞİ için tier BİLDİRİLMEZ (uydurma olurdu). */
  openrouter: {
    supportsStreaming:   true,     // kanıt: provider SSE ayrıştırıcısı
    supportsLongContext: true,     // kanıt: yönlendirdiği modeller uzun bağlam sunar
    // supportsReasoning: modele göre değişir → BİLDİRİLMEZ
    // costTier/latencyTier/reliabilityTier: modele göre değişir → BİLDİRİLMEZ
    freeTier:            false,    // kullanıcı hesabı ücretlendirilir
  },
};

export interface ProviderRegistryEntry {
  /** Gateway sağlayıcı kimliği. */
  readonly id:            string;
  /** Bu sağlayıcının varsayılan modeli. */
  readonly defaultModel:  string;
}

export interface CapabilityAdapterInput {
  /** Gateway'de KAYITLI sağlayıcılar (kimlik + varsayılan model). */
  readonly providers:            readonly ProviderRegistryEntry[];
  /** Anahtarı yapılandırılmış sağlayıcı kimlikleri. */
  readonly credentialConfiguredIds: readonly string[];
  /** Test/uzaktan yapılandırma için ipucu tablosunu ezme. */
  readonly hints?:               Readonly<Record<string, CapabilityHints>>;
}

/** Kararın gördüğü yetenek + yürütücünün ihtiyaç duyduğu uygunluk bilgisi. */
export interface AdaptedProvider extends AiProviderCapability {
  /** Anahtarı kayıtlı mı (uygunluk kapısının girdisi). */
  readonly credentialConfigured: boolean;
  /** Şu an aday olabilir mi (kimlik + model + anahtar var). */
  readonly available:            boolean;
}

/**
 * Kayıtlı sağlayıcıları yetenek tanımlarına çevirir.
 *
 * Bozuk/eksik kayıtlar (kimliksiz, modelsiz) SESSİZCE ATLANIR — uydurma tanım
 * üretilmez. ASLA throw etmez.
 */
export function adaptProviderCapabilities(input: CapabilityAdapterInput): readonly AdaptedProvider[] {
  const providers = Array.isArray(input?.providers) ? input.providers : [];
  const configured = new Set(input?.credentialConfiguredIds ?? []);
  const hintTable = input?.hints ?? CAPABILITY_HINTS;

  const out: AdaptedProvider[] = [];
  for (const entry of providers) {
    if (!entry || typeof entry.id !== 'string' || !entry.id) continue;
    if (typeof entry.defaultModel !== 'string' || !entry.defaultModel) continue;

    const hints = hintTable[entry.id] ?? {};
    const credentialConfigured = configured.has(entry.id);

    out.push({
      id:           entry.id,
      defaultModel: entry.defaultModel,
      ...(hints.modelsByTask ? { modelsByTask: hints.modelsByTask } : {}),

      // Boolean yetenekler: yalnız AÇIKÇA bildirilmişse true.
      supportsStreaming:   hints.supportsStreaming   === true,
      supportsReasoning:   hints.supportsReasoning   === true,
      supportsVision:      hints.supportsVision      === true,
      supportsTools:       hints.supportsTools       === true,
      supportsLongContext: hints.supportsLongContext === true,
      supportsOffline:     hints.supportsOffline     === true,

      // Tier'lar: bilinmiyorsa TANIMSIZ (çekirdek nötr 0.5 sayar) — "yüksek
      // güvenilirlik"/"düşük maliyet" VARSAYILMAZ.
      ...(hints.costTier        ? { costTier:        hints.costTier }        : {}),
      ...(hints.latencyTier     ? { latencyTier:     hints.latencyTier }     : {}),
      ...(hints.reliabilityTier ? { reliabilityTier: hints.reliabilityTier } : {}),

      freeTier: hints.freeTier === true,          // ücretsiz erişim VARSAYILMAZ

      credentialConfigured,
      available: credentialConfigured,
    });
  }
  return out;
}

/** Karar çekirdeğine geçilecek `availableProviderIds` listesi. */
export function availableProviderIdsOf(providers: readonly AdaptedProvider[]): readonly string[] {
  return providers.filter((p) => p.available).map((p) => p.id);
}
