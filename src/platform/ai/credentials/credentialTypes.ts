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
export type ApiCredentialId = 'openrouter' | 'gemini' | 'groq' | 'tavily';

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
}
