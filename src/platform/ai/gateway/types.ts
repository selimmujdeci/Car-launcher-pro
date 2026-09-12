/**
 * AI Gateway — SAĞLAYICI-BAĞIMSIZ SÖZLEŞMELER (tek tip kaynağı).
 *
 * Bu dosya Mavi ile model sağlayıcıları arasındaki SINIRDIR. Buradaki hiçbir
 * tip OpenRouter'a (veya başka bir sağlayıcıya) ait bir kavram İÇERMEZ —
 * `stream`, `messages`, `model` gibi kavramlar sağlayıcı-nötrdür. Yeni bir
 * sağlayıcı eklemek = bu dosyadaki `AiProvider` arayüzünü uygulayan YENİ BİR
 * DOSYA yazmak; gateway ve Mavi DEĞİŞMEZ (OCP).
 *
 * ── KATMANLAR ───────────────────────────────────────────────────────────────
 *   Mavi → AiGateway.generateResponse() → AiProvider[] → (HTTP) → model
 * Mavi `AiProvider`ı, sağlayıcı da Mavi'yi BİLMEZ (DIP: her iki taraf da bu
 * soyutlamaya bağlıdır).
 *
 * ── FAIL-CLOSED ─────────────────────────────────────────────────────────────
 * Hiçbir fonksiyon "sanki cevap üretmiş gibi" davranmaz: sonuç ya `ok:true` +
 * gerçek metin, ya da `ok:false` + TİPLİ hata. Belirsizlikte uydurma metin
 * ÜRETİLMEZ. Hata mesajları kullanıcıya gösterilebilir olmalıdır ve API
 * ANAHTARI/gizli veri İÇEREMEZ.
 */

import type { AiOfflineDetail } from '../aiOfflineReason';

/* ── Konuşma (conversation) ────────────────────────────────────────────────── */

/** Konuşma rolleri — sağlayıcıdan bağımsız kanonik küme. */
export type AiRole = 'system' | 'user' | 'assistant';

/** Tek bir konuşma mesajı (immutable). */
export interface AiMessage {
  readonly role:    AiRole;
  readonly content: string;
}

/** Model kimliği — sağlayıcı-nötr string (ör. `anthropic/claude-3.5-sonnet`).
 *  Sabit DEĞİLDİR: istek başına verilebilir, verilmezse gateway varsayılanı. */
export type AiModelId = string;

/* ── İstek / seçenekler ────────────────────────────────────────────────────── */

export interface AiGenerateRequest {
  /** Konuşma geçmişi (system/user/assistant sırası KORUNUR, yeniden sıralanmaz). */
  readonly messages:     readonly AiMessage[];
  /** Bu istek için model; verilmezse gateway varsayılan modeli kullanılır. */
  readonly model?:       AiModelId;
  /**
   * OPSİYONEL sağlayıcı kısıtı: verilirse gateway YALNIZ bu kimliğe sahip
   * sağlayıcıyı dener (kendi fallback zincirini UYGULAMAZ). Orchestrator gibi
   * dışarıda zincir yöneten çağıranlar için; verilmezse davranış BİREBİR eskisi
   * (kayıtlı sağlayıcılar sırayla denenir).
   */
  readonly providerId?:  string;
  /**
   * Modele bildirilecek araçlar. Verilmezse tool YOK (varsayılan davranış).
   * Sağlayıcı desteklemiyorsa SESSİZCE yok sayılır (sahte destek yok).
   */
  readonly tools?:       readonly AiToolSpec[];
  /** 0..2 — verilmezse sağlayıcı varsayılanı. */
  readonly temperature?: number;
  /** Üretilecek azami token; verilmezse sağlayıcı varsayılanı. */
  readonly maxTokens?:   number;
  /** Bu istek için timeout; verilmezse gateway varsayılanı. */
  readonly timeoutMs?:   number;
}

/**
 * Modele bildirilecek araç TANIMI — sağlayıcı-nötr. `parameters` JSON Schema
 * nesnesidir (Tool Router'ın `providerToolSchema` çeviricileri üretir); gateway
 * ve provider bu şemayı YORUMLAMAZ, yalnız taşır.
 */
export interface AiToolSpec {
  readonly name:        string;
  readonly description: string;
  readonly parameters:  Readonly<Record<string, unknown>>;
}

/** Modelin talep ettiği araç çağrısı — argümanlar HAM'dır, router doğrular. */
export interface AiToolCall {
  readonly id?:        string;
  readonly name:       string;
  /** Ayrıştırılmış argüman nesnesi; ayrıştırılamadıysa `undefined`. */
  readonly arguments?: unknown;
}

export interface AiGenerateOptions {
  /**
   * Verilirse STREAMING açılır: her token geldiğinde çağrılır (Mavi token-token
   * konuşabilir). Verilmezse tek seferlik (non-streaming) yanıt alınır.
   * Dinleyici hatası İZOLE edilir — akışı ve isteği DÜŞÜRMEZ.
   */
  readonly onToken?: (token: string) => void;
  /** Barge-in/iptal için dış iptal sinyali (kullanıcı sözü kesti vb.). */
  readonly signal?:  AbortSignal;
}

/* ── Hata taksonomisi ──────────────────────────────────────────────────────── */

/**
 * Tipli hata sınıfları. `retryable` KARARI buradan türetilir; çağıran taraf
 * string eşleştirmesi yapmak ZORUNDA DEĞİLDİR.
 */
export type AiErrorKind =
  | 'no_provider'         // hiç sağlayıcı kayıtlı değil (wiring hatası)
  | 'no_api_key'          // BYOK anahtarı yok — ağa ÇIKILMAZ
  | 'offline'             // cihaz çevrimdışı — ağa ÇIKILMAZ
  | 'circuit_open'        // AI devre kesicisi açık — ağa ÇIKILMAZ
  | 'invalid_request'     // sözleşme ihlali (boş mesaj, geçersiz rol/parametre)
  | 'auth'                // 401/403 — anahtar geçersiz/yetkisiz
  /**
   * 402 — anahtar GEÇERLİ ama hesapta kredi yok (kütük #421).
   * SAHADA ÖLÇÜLDÜ: 15 dakikada `402 openrouter.ai` × 11. Bu durum `auth` ile
   * aynı kovaya düşüyordu; kullanıcı "anahtar geçersiz" mi "kredi bitti" mi
   * ayırt edemiyordu. Üçü AYRI eylem gerektirir:
   *   auth → anahtarı yenile · insufficient_credit → bakiye yükle · rate_limited → bekle.
   */
  | 'insufficient_credit'
  | 'rate_limited'        // 429 — kota/hız sınırı
  | 'server'              // 5xx — sağlayıcı tarafı
  | 'network'             // bağlantı hatası
  | 'timeout'             // süre aşımı
  | 'aborted'             // çağıran iptal etti (barge-in)
  | 'malformed_response'  // beklenen şekilde olmayan yanıt
  | 'unknown';

export interface AiError {
  readonly kind:      AiErrorKind;
  /** Kullanıcıya gösterilebilir kısa açıklama. API ANAHTARI İÇEREMEZ. */
  readonly message:   string;
  /** true → aynı sağlayıcıda tekrar denemek anlamlı (429/5xx/ağ/timeout). */
  readonly retryable: boolean;
  /** HTTP durum kodu (varsa). */
  readonly status?:   number;
  /** Hatayı üreten sağlayıcı kimliği (varsa). */
  readonly provider?: string;
  /**
   * Sağlayıcının BİLDİRDİĞİ bekleme penceresi (ms) — ör. 429 gövdesindeki
   * `retryDelay`/`Retry-After`. Yalnız GÜVENİLİR kaynaktan gelir; tahmin
   * EDİLMEZ. Yürütücü bunu sağlık deposuna aynen taşır.
   */
  readonly retryAfterMs?: number;
}

/* ── Sonuç ─────────────────────────────────────────────────────────────────── */

export interface AiUsage {
  readonly promptTokens?:     number;
  readonly completionTokens?: number;
  readonly totalTokens?:      number;
}

export interface AiGenerateSuccess {
  readonly ok:            true;
  /** Üretilen tam metin (streaming'de tüm token'ların birleşimi). */
  readonly text:          string;
  readonly model:         AiModelId;
  readonly provider:      string;
  /** true → yanıt token-token akıtıldı. */
  readonly streamed:      boolean;
  readonly finishReason?: string;
  readonly usage?:        AiUsage;
  /**
   * Model araç çağırdıysa doldurulur. Bu durumda `text` BOŞ olabilir —
   * çağıran taraf (tool loop) araçları çalıştırıp yeniden sorar.
   */
  readonly toolCalls?:    readonly AiToolCall[];
}

/** Tek bir denemenin kaydı — teşhis/telemetri için (gizli veri YOK). */
export interface AiAttemptLog {
  readonly provider:  string;
  readonly model:     AiModelId;
  /** 1'den başlar (aynı sağlayıcı içindeki deneme sırası). */
  readonly attempt:   number;
  readonly errorKind: AiErrorKind;
  readonly status?:   number;
}

export interface AiGenerateFailure {
  readonly ok:        false;
  readonly error:     AiError;
  /** Denenen sağlayıcı/tekrarların kaydı (fallback teşhisi). */
  readonly attempts?: readonly AiAttemptLog[];
}

export type AiGenerateResult = AiGenerateSuccess | AiGenerateFailure;

/* ── Sağlayıcı portu (yeni sağlayıcı = bu arayüzü uygulayan yeni dosya) ────── */

/** Gateway tarafından ÇÖZÜLMÜŞ (model/timeout belirlenmiş) istek. */
export interface AiProviderRequest {
  readonly messages:     readonly AiMessage[];
  readonly model:        AiModelId;
  readonly timeoutMs:    number;
  readonly stream:       boolean;
  readonly temperature?: number;
  readonly maxTokens?:   number;
  /** Modele bildirilecek araçlar; desteklemeyen sağlayıcı YOK SAYAR. */
  readonly tools?:       readonly AiToolSpec[];
}

export interface AiProviderCallOptions {
  readonly onToken?: (token: string) => void;
  readonly signal?:  AbortSignal;
}

/** Anahtar doğrulama sonucu — hata tipi `generate` ile AYNI taksonomiden. */
export interface AiKeyVerification {
  readonly ok:     boolean;
  readonly error?: AiError;
}

export interface AiKeyVerifyOptions {
  readonly timeoutMs?: number;
  readonly signal?:    AbortSignal;
}

/**
 * Sağlayıcı sözleşmesi. UYGULAYAN TARAF İÇİN KURAL: `generate` ASLA throw
 * ETMEZ — her hata `ok:false` + tipli `AiError` olarak döner (fail-closed).
 */
export interface AiProvider {
  /** Kararlı kimlik (log/telemetri/fallback sırası için) — ör. `openrouter`. */
  readonly id: string;
  /**
   * BU SAĞLAYICININ KENDİ adlandırmasındaki varsayılan modeli.
   *
   * ⚠️ SAHA 2026-07-24 (cihazda yakalandı): gateway zincir boyunca TEK model adı
   * kullanıyordu → OpenRouter düşünce (402) Gemini'ye geçiliyor ama istek yine
   * `anthropic/claude-haiku-4.5` slug'ıyla gidiyordu → Gemini `400 unexpected
   * model name format`. Yani fallback fiilen ÖLÜYDÜ: yedek sağlayıcı HER ZAMAN
   * 400 alıyordu. Model kimlikleri sağlayıcıya özgüdür (OpenRouter `vendor/model`
   * ≠ Gemini yerel adı) — zincirde model de sağlayıcıyla birlikte değişmelidir.
   * Verilmezse gateway'in genel `defaultModel`'i kullanılır (geriye uyumlu).
   */
  readonly defaultModel?: AiModelId;
  generate(
    request:  AiProviderRequest,
    options?: AiProviderCallOptions,
  ): Promise<AiGenerateResult>;
  /**
   * OPSİYONEL: anahtarı TOKEN HARCAMADAN doğrulayan düşük maliyetli kontrol
   * (sağlayıcının metadata uç noktası). Uygulamayan sağlayıcılarda çağıran
   * taraf minimum bütçeli bir `generate` isteğine düşer. `generate` gibi ASLA
   * throw ETMEZ.
   */
  verifyKey?(options?: AiKeyVerifyOptions): Promise<AiKeyVerification>;
}

/* ── Yardımcı portlar (hepsi DI — gateway hiçbirini kendisi yaratmaz) ──────── */

/**
 * API anahtarı kaynağı (BYOK). Boş string → "anahtar yok" (fail-closed:
 * ağa çıkılmaz). Anahtar ASLA loglanmaz/serileştirilmez.
 */
export interface AiApiKeySource {
  getApiKey(): Promise<string>;
}

/** Ağ durumu portu — `navigator.onLine` gateway'e GÖMÜLÜ değildir (test edilebilirlik). */
export interface AiNetworkStatus {
  isOnline(): boolean;
}

/** AI devre kesicisi portu (mevcut `aiHealth` bu şekle uyar). */
export interface AiHealthPort {
  isHealthy():     boolean;
  recordSuccess(): void;
  /**
   * GERÇEK ağ ölümü bildirimi (yalnız network/timeout; 429/5xx ağın CANLI
   * olduğunun kanıtıdır → BURAYA GELMEZ). İstek başına EN FAZLA BİR KEZ çağrılır.
   *
   * `detail` OPSİYONELDİR: mevcut uygulamalar imzayı değiştirmeden çalışır
   * (geriye dönük uyumlu). Verildiğinde offline sebep kaydına künye olarak
   * yazılır — "sessizce offline'a düşmek yasak" kuralının veri kaynağı.
   */
  recordFailure(detail?: AiOfflineDetail): void;
}

/** Yeniden deneme beklemesi — DI (testte sahte, üretimde setTimeout). */
export type AiSleep = (ms: number) => Promise<void>;

/* ── Gateway ───────────────────────────────────────────────────────────────── */

/**
 * Mavi'nin gördüğü TEK yüzey. Mavi `AiProvider`, HTTP, OpenRouter, model
 * listesi veya anahtar yönetimi HAKKINDA HİÇBİR ŞEY BİLMEZ.
 */
export interface AiGateway {
  generateResponse(
    request:  AiGenerateRequest,
    options?: AiGenerateOptions,
  ): Promise<AiGenerateResult>;
}
