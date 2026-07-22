/**
 * orchestratorTypes — Mavi Model Orchestrator sözleşmeleri (SAĞLAYICI-BAĞIMSIZ).
 *
 * Orchestrator, bir isteği HANGİ sağlayıcı + HANGİ modelin karşılayacağına karar
 * verir. Bu dosyada (ve karar çekirdeğinde) `openrouter`, `gemini`, `groq`,
 * `anthropic` gibi HİÇBİR SAĞLAYICI ADI GEÇMEZ — karar YALNIZ yetenek
 * tanımlarından (capability descriptor) üretilir. Yeni sağlayıcı eklemek =
 * yeni bir tanım geçirmek; karar kodu DEĞİŞMEZ.
 *
 * Bu dosya IO İÇERMEZ — yalnız tipler.
 */

/** Faz 1 görev sınıfları. Yeni tip eklemek = strateji tablosuna bir satır. */
export type MaviTaskType =
  | 'general_chat'        // genel sohbet
  | 'vehicle_question'    // araç soruları
  | 'technical_analysis'  // teknik analiz
  | 'code_analysis'       // kod analizi
  | 'short_answer'        // kısa cevap
  | 'long_explanation';   // uzun açıklama

/** Üç kademeli nitelik. Yorum yönü alana göre değişir (bkz. alan açıklamaları). */
export type CapabilityTier = 'low' | 'medium' | 'high';

/**
 * Bir sağlayıcının YETENEK TANIMI. Orchestrator'ın gördüğü TEK sağlayıcı bilgisi.
 * `id` yalnız kimlik/telemetri içindir; karar mantığı ASLA `id` değerine bakmaz.
 */
export interface AiProviderCapability {
  /** Kararlı kimlik (gateway sağlayıcı kimliğiyle aynı olmalı). */
  readonly id:                  string;
  /** Bu sağlayıcının varsayılan modeli (görev eşlemesi yoksa kullanılır). */
  readonly defaultModel:        string;
  /** Göreve özel model tercihi — yoksa `defaultModel`. */
  readonly modelsByTask?:       Partial<Record<MaviTaskType, string>>;

  readonly supportsStreaming?:   boolean;
  readonly supportsReasoning?:   boolean;
  readonly supportsVision?:      boolean;
  readonly supportsTools?:       boolean;
  readonly supportsLongContext?: boolean;
  /** İnternetsiz çalışabilir mi (ör. cihaz-içi model). */
  readonly supportsOffline?:     boolean;

  /** `low` = ucuz (İYİ), `high` = pahalı. */
  readonly costTier?:        CapabilityTier;
  /** `low` = hızlı (İYİ), `high` = yavaş. */
  readonly latencyTier?:     CapabilityTier;
  /** `high` = güvenilir (İYİ). */
  readonly reliabilityTier?: CapabilityTier;

  /** Ücretsiz katman mı (ücretli erişim yoksa tercih edilir). */
  readonly freeTier?:        boolean;
}

/* ── Sağlık / kota durumu (DI ile gelir — orchestrator ölçüm YAPMAZ) ───────── */

export interface ProviderHealthSnapshot {
  readonly providerId: string;
  /** Art arda başarısızlık sayısı (başarıda sıfırlanır). */
  readonly consecutiveFailures: number;
  /** Bu zamana kadar sağlayıcı DENENMEZ (kota/devre kesici). 0 = engel yok. */
  readonly blockedUntilMs: number;
  /** Engelin nedeni (telemetri/teşhis; kullanıcıya ham gösterilmez). */
  readonly blockReason?: 'rate_limited' | 'auth' | 'network' | 'server' | 'timeout' | 'unknown';
  /** Son timeout zamanı (0 = hiç). */
  readonly lastTimeoutAtMs: number;
}

export type ProviderHealthMap = Readonly<Record<string, ProviderHealthSnapshot>>;

/* ── Karar girdisi ─────────────────────────────────────────────────────────── */

export interface OrchestratorContext {
  /** Cihaz çevrimiçi mi. `false` → yalnız `supportsOffline` adaylar kalır. */
  readonly online:              boolean;
  /** Araç (OBD) bağlı mı — araç sorularında bağlam güvenilirliği için taşınır. */
  readonly vehicleConnected?:   boolean;
  /** Anahtarı KAYITLI olan sağlayıcı kimlikleri. Listede olmayan aday ELENİR. */
  readonly availableProviderIds: readonly string[];
  /** Kullanıcı ücretli erişime sahip mi. `false` → yalnız `freeTier` adaylar. */
  readonly paidAccess?:         boolean;
  /** Kullanıcının tercih ettiği sağlayıcı (varsa puan avantajı — garanti DEĞİL). */
  readonly preferredProviderId?: string;
  /** Kullanıcının tercih ettiği model (seçilen sağlayıcıya aitse kullanılır). */
  readonly preferredModel?:     string;
  /** Sağlık/kota durumu (yoksa tüm sağlayıcılar sağlıklı sayılır). */
  readonly health?:             ProviderHealthMap;
  /** Karar anı (DI saat) — `Date.now` GÖMÜLÜ DEĞİLDİR. */
  readonly nowMs:               number;
}

export interface OrchestratorRequest {
  readonly task:      MaviTaskType;
  readonly context:   OrchestratorContext;
  readonly providers: readonly AiProviderCapability[];
  /** Görev stratejilerini ezmek için (test/uzaktan yapılandırma). */
  readonly policy?:   OrchestratorPolicy;
}

/* ── Strateji ──────────────────────────────────────────────────────────────── */

/** Bir görev tipinin seçim stratejisi. Ağırlıklar 0..1 aralığında beklenir. */
export interface TaskStrategy {
  /** Bu görev için ZORUNLU yetenekler — sağlamayan aday ELENİR (fail-closed). */
  readonly required: readonly (keyof AiProviderCapability)[];
  /** Düşük gecikmenin önemi. */
  readonly weightLatency:     number;
  /** Düşük maliyetin önemi. */
  readonly weightCost:        number;
  /** Güvenilirliğin önemi. */
  readonly weightReliability: number;
  /** Akıl yürütme yeteneğinin önemi (varsa puan ekler; zorunlu değilse elemez). */
  readonly weightReasoning:   number;
  /** Uzun bağlam yeteneğinin önemi. */
  readonly weightLongContext: number;
}

export type OrchestratorPolicy = Readonly<Partial<Record<MaviTaskType, TaskStrategy>>>;

/* ── Karar çıktısı ─────────────────────────────────────────────────────────── */

/** Bir adayın seçilme/elenme gerekçesi — kullanıcı verisi İÇERMEZ. */
export type DecisionReason =
  | 'preferred_by_user'
  | 'best_score'
  | 'only_candidate'
  | 'offline_capable'
  | 'no_providers'
  | 'no_credentials'
  | 'all_blocked'
  | 'capability_mismatch'
  | 'offline_no_offline_provider'
  | 'paid_access_required';

export interface DecisionCandidate {
  readonly providerId: string;
  readonly model:      string;
  /** 0..1 — sıralama puanı (deterministik). */
  readonly score:      number;
}

export interface MaviModelDecision {
  readonly ok:        boolean;
  readonly task:      MaviTaskType;
  /** Seçilen sağlayıcı (ok=false ise boş string). */
  readonly providerId: string;
  /** Seçilen model (ok=false ise boş string). */
  readonly model:      string;
  readonly reason:     DecisionReason;
  /**
   * Sıradaki denenecek adaylar (BİRİNCİ eleman seçilen adaydır). Sonlu ve
   * tekrarsızdır → sonsuz döngü YAPISAL OLARAK imkânsızdır.
   */
  readonly fallbackChain: readonly DecisionCandidate[];
  /** Elenen adaylar ve nedenleri (teşhis; kullanıcı verisi YOK). */
  readonly rejected: readonly { readonly providerId: string; readonly reason: DecisionReason }[];
}

/* ── Telemetri (YALNIZ güvenli metadata) ──────────────────────────────────── */

/**
 * ⚠️ SÖZLEŞME: prompt, mesaj, kullanıcı metni, araç verisi veya anahtar
 * TAŞIYAN alan BULUNAMAZ. Yapısal testle kilitlidir.
 */
export interface DecisionTelemetry {
  readonly taskType:     MaviTaskType;
  readonly providerId:   string;
  readonly model:        string;
  /** Birincil aday dışında bir sağlayıcıya düşüldü mü. */
  readonly usedFallback: boolean;
  /** Karar süresi (ms) — DI saatten türetilir. */
  readonly decisionMs:   number;
  readonly candidateCount: number;
  readonly ok:           boolean;
}
