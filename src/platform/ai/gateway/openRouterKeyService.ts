/**
 * openRouterKeyService — OpenRouter BYOK anahtar yaşam döngüsü (ayarlar yüzü).
 *
 * UI ile güvenli depo/gateway arasındaki TEK kapı. Ekran katmanı ne
 * `sensitiveKeyStore`u ne de gateway iç yapısını bilir; yalnız buradaki tipli
 * fonksiyonları çağırır.
 *
 * ── ANAHTAR GİZLİLİĞİ (sözleşme) ────────────────────────────────────────────
 *  - Anahtar YALNIZ `sensitiveKeyStore` üzerinden saklanır (native: Android
 *    Keystore + EncryptedSharedPreferences; web: AES-256-GCM). localStorage /
 *    dosya / Supabase / telemetri YOK.
 *  - Bu modül anahtarı DIŞARI HİÇ VERMEZ: `getOpenRouterKeyInfo()` yalnız
 *    "kayıtlı mı" + MASKELİ özet döndürür (tam anahtar fonksiyon kapsamında
 *    kalır, UI state'ine hiç girmez).
 *  - Anahtar loglanmaz, hata mesajına eklenmez, URL'ye/gövdeye yazılmaz
 *    (istekte yalnız `Authorization` başlığı — bkz. openRouterProvider).
 *  - Silme TÜM katmanları temizler (Keystore + kurtarma yedekleri) ve gateway
 *    şalterini KAPATIR.
 *
 * ── FAIL-CLOSED ─────────────────────────────────────────────────────────────
 * Anahtar yoksa/doğrulanmadıysa gateway şalteri AÇILAMAZ. Depo hatası, ağ
 * hatası veya belirsizlik daima "açma" yönünde değil "kapat" yönünde çözülür.
 */

import { sensitiveKeyStore } from '../../sensitiveKeyStore';
import { isAiGatewayEnabled, setAiGatewayEnabled } from './aiGatewayFlag';
import type { AiErrorKind } from './types';

/** Ayarlar ekranının gösterdiği bağlantı durumu (teknik kod SIZDIRMAZ). */
export type OpenRouterConnectionStatus =
  | 'not_configured'
  | 'checking'
  | 'connected'
  | 'invalid_key'
  | 'rate_limited'
  | 'offline'
  | 'service_unavailable'
  | 'unknown_error';

/** Anahtarın güvenli depodaki KAYIT durumu — tam anahtar ASLA taşınmaz. */
export interface OpenRouterKeyInfo {
  readonly configured: boolean;
  /** `sk-or-••••••••••4F9A` biçiminde özet; kayıtlı değilse boş string. */
  readonly masked:     string;
}

export type KeyFormatError = 'empty' | 'too_short' | 'control_chars';

export type KeyFormatResult =
  | { readonly ok: true;  readonly key: string }
  | { readonly ok: false; readonly reason: KeyFormatError };

const STORE_KEY = 'openRouterApiKey' as const;

/**
 * HAFİF istemci doğrulaması. Sağlayıcı anahtar biçimi zamanla değişebilir →
 * PREFIX ZORUNLU TUTULMAZ (yeni biçimler kilitlenmesin). Gerçek geçerlilik
 * yalnız bağlantı testiyle belirlenir.
 */
const MIN_KEY_LENGTH = 16;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_RE = new RegExp('[\\u0000-\\u001F\\u007F-\\u009F]');

export function validateKeyFormat(raw: string): KeyFormatResult {
  const key = typeof raw === 'string' ? raw.trim() : '';
  if (!key)                          return { ok: false, reason: 'empty' };
  if (CONTROL_CHARS_RE.test(key))    return { ok: false, reason: 'control_chars' };
  if (key.length < MIN_KEY_LENGTH)   return { ok: false, reason: 'too_short' };
  return { ok: true, key };
}

/** Kullanıcıya gösterilecek Türkçe biçim hatası (anahtar İÇERMEZ). */
export function keyFormatMessage(reason: KeyFormatError): string {
  if (reason === 'empty')         return 'Anahtar boş olamaz.';
  if (reason === 'control_chars') return 'Anahtar geçersiz karakter içeriyor — kopyalarken bir sorun olmuş olabilir.';
  return 'Anahtar çok kısa görünüyor — tamamını yapıştırdığınızdan emin olun.';
}

/**
 * Anahtarı maskeler: baş kısım + son 4 karakter. Tüm anahtarı asla döndürmez.
 * Çok kısa girdilerde hiçbir parça sızdırmaz (tamamı maskelenir).
 */
export function maskApiKey(key: string): string {
  const k = (key ?? '').trim();
  if (!k) return '';
  if (k.length <= 8) return '•'.repeat(k.length);
  const head = k.slice(0, 6);
  const tail = k.slice(-4);
  return `${head}${'•'.repeat(10)}${tail}`;
}

/**
 * Anahtarın KAYITLI olup olmadığını ve maskeli özetini döndürür.
 * Tam anahtar bu fonksiyonun kapsamında kalır — çağırana ASLA verilmez.
 */
export async function getOpenRouterKeyInfo(): Promise<OpenRouterKeyInfo> {
  try {
    const stored = (await sensitiveKeyStore.get(STORE_KEY)).trim();
    return stored
      ? { configured: true,  masked: maskApiKey(stored) }
      : { configured: false, masked: '' };
  } catch {
    return { configured: false, masked: '' };   // depo okunamadı → fail-closed
  }
}

/**
 * Anahtarı doğrular ve güvenli depoya yazar. Biçim hatasında YAZMAZ.
 * Başarıda maskeli özet döner (UI tam anahtarı elinde tutmaz).
 */
export async function saveOpenRouterKey(raw: string): Promise<
  { ok: true; masked: string } | { ok: false; reason: KeyFormatError }
> {
  const parsed = validateKeyFormat(raw);
  if (!parsed.ok) return parsed;
  await sensitiveKeyStore.set(STORE_KEY, parsed.key);
  return { ok: true, masked: maskApiKey(parsed.key) };
}

/**
 * Anahtarı TÜM katmanlardan siler ve gateway şalterini KAPATIR.
 * Eski sağlayıcı yolu (Gemini/Groq/Haiku) etkilenmez — Mavi susmaz.
 */
export async function removeOpenRouterKey(): Promise<void> {
  setAiGatewayEnabled(false);        // önce şalter: silme yarıda kalsa bile açık kalmasın
  try {
    await sensitiveKeyStore.remove(STORE_KEY);
  } catch { /* depo hatası — şalter yine de kapalı (fail-closed) */ }
}

/* ── Bağlantı doğrulama ───────────────────────────────────────────────────── */

/** Gateway hata sınıfı → kullanıcıya gösterilecek durum (teknik kod sızmaz). */
export function statusFromErrorKind(kind: AiErrorKind): OpenRouterConnectionStatus {
  switch (kind) {
    case 'no_api_key':                          return 'not_configured';
    case 'auth':                                return 'invalid_key';
    case 'rate_limited':                        return 'rate_limited';
    case 'network':
    case 'timeout':
    case 'offline':                             return 'offline';
    case 'server':
    case 'circuit_open':                        return 'service_unavailable';
    default:                                    return 'unknown_error';
  }
}

/** Durum → sade Türkçe açıklama (teknik terim/HTTP kodu YOK). */
export function connectionStatusMessage(status: OpenRouterConnectionStatus): string {
  switch (status) {
    case 'not_configured':      return 'Anahtar girilmedi.';
    case 'checking':            return 'Bağlantı doğrulanıyor…';
    case 'connected':           return 'Bağlantı başarılı — anahtar çalışıyor.';
    case 'invalid_key':         return 'Anahtar geçersiz görünüyor. Kopyaladığınız anahtarı kontrol edin.';
    case 'rate_limited':        return 'Hesabınızın kullanım sınırına ulaşılmış. Bir süre sonra tekrar deneyin.';
    case 'offline':             return 'İnternet bağlantısı kurulamadı.';
    case 'service_unavailable': return 'Servis şu an yanıt vermiyor. Daha sonra tekrar deneyin.';
    default:                    return 'Bağlantı doğrulanamadı.';
  }
}

/** Bağlantı testi için kısa bütçe — ayarlar ekranında kullanıcı bekliyor. */
const CONNECTION_TEST_TIMEOUT_MS = 8_000;

/**
 * Kayıtlı anahtarla GERÇEK bir doğrulama isteği yapar.
 *
 * Anahtar yoksa AĞA ÇIKMAZ (`not_configured`). İstek sağlayıcının düşük
 * maliyetli doğrulama yolunu kullanır (OpenRouter'da SIFIR token); streaming
 * kapalı, sohbet geçmişi/araç verisi/kişisel veri GÖNDERİLMEZ.
 * ASLA throw etmez.
 */
export async function testOpenRouterConnection(): Promise<OpenRouterConnectionStatus> {
  const info = await getOpenRouterKeyInfo();
  if (!info.configured) return 'not_configured';

  try {
    const { verifyDefaultAiConnection } = await import('./concrete/defaultAiGateway');
    const result = await verifyDefaultAiConnection(CONNECTION_TEST_TIMEOUT_MS);
    if (result.ok) return 'connected';
    return result.error ? statusFromErrorKind(result.error.kind) : 'unknown_error';
  } catch {
    return 'unknown_error';
  }
}

/* ── Şalter (fail-closed kapı) ────────────────────────────────────────────── */

export { isAiGatewayEnabled };

/**
 * Gateway şalterini kullanıcı tercihine göre çevirir.
 *
 * AÇMA fail-closed'dır: anahtar kayıtlı DEĞİLSE açılmaz (`false` döner).
 * KAPATMA her zaman başarılıdır. Dönen değer şalterin GERÇEK son durumudur.
 */
export async function setGatewayPreference(enabled: boolean): Promise<boolean> {
  if (!enabled) {
    setAiGatewayEnabled(false);
    return false;
  }
  const info = await getOpenRouterKeyInfo();
  if (!info.configured) {
    setAiGatewayEnabled(false);   // anahtarsız açma girişimi → kapalı kalır
    return false;
  }
  setAiGatewayEnabled(true);
  return true;
}
