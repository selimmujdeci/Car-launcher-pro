/**
 * credentialTypes — API Credential Manager sözleşmeleri (sağlayıcı-BAĞIMSIZ).
 *
 * Kullanıcının kendi API anahtarlarını (BYOK) tek tek değil TEK BİR kayıt
 * defteri üzerinden yönetmek için ortak tipler. Yeni bir sağlayıcı eklemek
 * (Anthropic, OpenAI, DeepSeek, Qwen, Mistral, Perplexity, Fireworks,
 * Together AI, Ollama, xAI Grok…) = kayıt defterine YENİ BİR TANIM eklemek;
 * yönetici, ayarlar akışı ve kurtarma katmanı DEĞİŞMEZ.
 *
 * Bu dosya IO İÇERMEZ — yalnız tipler.
 */

import type { SensitiveKey } from '../../sensitiveKeyStore';

/** Kayıtlı sağlayıcı kimlikleri. Yeni sağlayıcı = buraya bir değer + kayıt. */
export type ApiCredentialId = 'openrouter' | 'gemini' | 'groq' | 'haiku' | 'tavily';

/**
 * Bir kimlik bilgisinin doğrulama durumu — kullanıcıya gösterilebilir.
 * TEKNİK KOD (HTTP durumu, hata sınıfı) İÇERMEZ.
 */
export type ApiCredentialStatus =
  | 'not_configured'
  | 'checking'
  | 'connected'
  | 'invalid_key'
  | 'rate_limited'
  | 'offline'
  | 'service_unavailable'
  | 'unknown_error';

/** Biçim doğrulama hataları (hafif istemci kontrolü). */
export type KeyFormatError = 'empty' | 'too_short' | 'control_chars';

export type KeyFormatResult =
  | { readonly ok: true;  readonly key: string }
  | { readonly ok: false; readonly reason: KeyFormatError };

/** Anahtarın depodaki KAYIT durumu — tam anahtar ASLA taşınmaz. */
export interface ApiCredentialInfo {
  readonly id:         ApiCredentialId;
  readonly configured: boolean;
  /** `sk-or-••••••••••4F9A` biçiminde özet; kayıtlı değilse boş string. */
  readonly masked:     string;
}

/** Anahtarın nereden geldiği. `environment` YALNIZ geliştirme yedeğidir. */
export type CredentialSource = 'secure_store' | 'environment' | 'none';

/**
 * Bir kimlik bilgisinin GÜVENLİ metadata özeti — toplu okumanın çıktı birimi.
 *
 * ⚠️ SÖZLEŞME: bu tipte anahtar materyali TAŞIYAN alan BULUNAMAZ (`value`,
 * `rawKey`, `secret`, `apiKey`…). Yapısal testle kilitlidir. `maskedSummary`
 * yalnız kısa bir önek + madde işaretleri + son 4 karakter içerir.
 */
export interface CredentialStatus {
  readonly keyId:              ApiCredentialId;
  /** GÜVENLİ DEPODA kayıtlı mı (env yedeği bunu `true` YAPMAZ — bkz. `source`). */
  readonly configured:         boolean;
  readonly source:             CredentialSource;
  /** Yalnız `secure_store` kaynağında üretilir; env değeri MASKELENMEZ/okunmaz. */
  readonly maskedSummary?:     string;
  /** Anahtar reinstall kurtarma kapsamında mı (statik metadata). */
  readonly recoveryAvailable?: boolean;
  /** true → okuma sırasında hata oldu; fail-closed olarak `configured:false`. */
  readonly readError?:         boolean;
}

/** Kimlik → durum haritası (`ApiCredentialId` anahtarlı). */
export type CredentialStatusMap = Readonly<Record<string, CredentialStatus>>;

export interface CredentialVerifyOptions {
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

/**
 * Bir sağlayıcının kimlik bilgisi tanımı.
 *
 * `verify` KURALLARI (hepsi zorunlu):
 *  - STREAMING YOK · MİNİMUM ağ trafiği · token harcamayan uç nokta tercih edilir
 *  - timeout DESTEKLER · ASLA throw ETMEZ (fail-closed: belirsizlik → hata durumu)
 *  - anahtar YALNIZ header'da gider; URL query'ye/gövdeye/loga YAZILMAZ
 */
export interface ApiCredentialDescriptor {
  readonly id:        ApiCredentialId;
  /** Güvenli depodaki (Android Keystore) anahtar adı. */
  readonly storeKey:  SensitiveKey;
  /** Ayarlarda gösterilecek ad. */
  readonly label:     string;
  /** Anahtar alma sayfası (harici tarayıcıda açılır). */
  readonly docsUrl:   string;
  /** Hafif biçim kontrolü için makul alt sınır. */
  readonly minLength: number;
  /**
   * Doğrulamanın kullanıcı hesabına maliyeti var mı? (Tavily'de arama kredisi
   * harcanır — UI bunu kullanıcıya söyleyebilsin diye tanımda taşınır.)
   */
  readonly verifyCostsQuota: boolean;
  verify(apiKey: string, options?: CredentialVerifyOptions): Promise<ApiCredentialStatus>;

  /* ── Opsiyonel UI metadata (ayarlar paneli tamamen tanımdan sürülür) ────── */

  /** Kullanıcıya bu anahtarın NE İŞE YARADIĞINI anlatan tek cümle. */
  readonly roleHint?: string;
  /** `true` → "Gelişmiş" bölümünde gizli; `false`/yok → ana listede görünür. */
  readonly advanced?: boolean;
  /** Giriş alanı ipucu (biçim ÖRNEĞİ — doğrulama kuralı DEĞİL). */
  readonly placeholder?: string;
  /**
   * Panoda bu desene uyan metin görülürse anahtar OTOMATİK algılanır.
   * Yalnız KOLAYLIK içindir — kaydetme doğrulaması prefix'e BAĞLI DEĞİLDİR
   * (sağlayıcı biçimi değişirse kullanıcı elle yapıştırmaya devam edebilir).
   */
  readonly clipboardPattern?: RegExp;
  /** QR ile telefondan anahtar aktarımı destekleniyorsa `keyBeamService` türü. */
  readonly keyBeamKind?: 'gemini' | 'groq' | 'haiku' | 'tavily';
  /**
   * `.env` yedeği okuyucusu (yalnız GELİŞTİRME kolaylığı). Değer döndürürse UI
   * ".env'den okunuyor" rozetini gösterir. Anahtar DEĞERİ UI state'ine girmez —
   * yalnız "dolu mu" bilgisi kullanılır.
   */
  readonly getEnvKey?: () => string;
}
