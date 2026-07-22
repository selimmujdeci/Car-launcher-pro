/**
 * apiCredentialManager — TÜM kullanıcı API anahtarları için tek yönetim kapısı.
 *
 * Sağlayıcıya özel kod İÇERMEZ: her işlem kayıt defterindeki tanım üzerinden
 * yürür. Yeni sağlayıcı eklemek yalnız kayıt defterine bir satır eklemektir
 * (bkz. `credentialRegistry.ts`).
 *
 * ── SAKLAMA (yeni sistem YAZILMADI — mevcut mimari yeniden kullanıldı) ──────
 * Tek otorite `sensitiveKeyStore`:
 *   native  → EncryptedSharedPreferences + Android Keystore (donanım destekli)
 *   web/dev → Web Crypto AES-256-GCM (oturuma özgü anahtar)
 * Plain text saklama YOK. Kurtarma katmanları da mevcut yapıdan gelir:
 *   1) Recovery Store  → Android Auto Backup (Google hesabı)
 *   2) Cihaz-içi blob  → Google'sız head unit'ler için dosya yedeği
 * Bu yönetici bunların HİÇBİRİNİ yeniden yazmaz; yalnız aynı depo API'sini
 * kullanır → tüm kayıtlı anahtarlar kurtarma kapsamına OTOMATİK girer
 * (`RECOVERY_KEYS` ile kilitli, testle doğrulanır).
 *
 * ── GİZLİLİK SÖZLEŞMESİ ────────────────────────────────────────────────────
 *  - Tam anahtar bu modülden DIŞARI ÇIKMAZ: okuma yalnız {configured, masked}.
 *  - Loglama / telemetri / URL query / bundle yazımı YOK.
 *  - Doğrulama isteklerinde anahtar YALNIZ header'da (bkz. credentialVerifiers).
 *  - Silme tüm katmanları temizler; silinen anahtar geri gelmez.
 */

import { sensitiveKeyStore } from '../../sensitiveKeyStore';
import { getCredentialDescriptor } from './credentialRegistry';
import type {
  ApiCredentialId,
  ApiCredentialInfo,
  ApiCredentialStatus,
  CredentialVerifyOptions,
  KeyFormatError,
  KeyFormatResult,
} from './credentialTypes';

/** C0/C1 kontrol karakterleri — bozuk kopyala/yapıştır işareti. */
const CONTROL_CHARS_RE = new RegExp('[\\u0000-\\u001F\\u007F-\\u009F]');

/**
 * HAFİF istemci doğrulaması. PREFIX ZORUNLU TUTULMAZ — sağlayıcılar anahtar
 * biçimini değiştirdiğinde ürün kilitlenmesin. Gerçek geçerlilik yalnız
 * bağlantı testiyle belirlenir.
 */
export function validateKeyFormat(raw: string, minLength = 16): KeyFormatResult {
  const key = typeof raw === 'string' ? raw.trim() : '';
  if (!key)                        return { ok: false, reason: 'empty' };
  if (CONTROL_CHARS_RE.test(key))  return { ok: false, reason: 'control_chars' };
  if (key.length < minLength)      return { ok: false, reason: 'too_short' };
  return { ok: true, key };
}

/** Kullanıcıya gösterilecek Türkçe biçim hatası (anahtar İÇERMEZ). */
export function keyFormatMessage(reason: KeyFormatError): string {
  if (reason === 'empty')         return 'Anahtar boş olamaz.';
  if (reason === 'control_chars') return 'Anahtar geçersiz karakter içeriyor — kopyalarken bir sorun olmuş olabilir.';
  return 'Anahtar çok kısa görünüyor — tamamını yapıştırdığınızdan emin olun.';
}

/**
 * Anahtarı maskeler: baş + son 4. Tüm anahtarı asla döndürmez; çok kısa
 * girdilerde hiçbir parça sızdırmaz.
 */
export function maskApiKey(key: string): string {
  const k = (key ?? '').trim();
  if (!k) return '';
  if (k.length <= 8) return '•'.repeat(k.length);
  return `${k.slice(0, 6)}${'•'.repeat(10)}${k.slice(-4)}`;
}

/** Durum → sade Türkçe açıklama (teknik terim/HTTP kodu YOK). */
export function credentialStatusMessage(status: ApiCredentialStatus): string {
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

/* ── Yaşam döngüsü (sağlayıcıdan bağımsız) ────────────────────────────────── */

/**
 * Anahtarın KAYITLI olup olmadığını + maskeli özetini döndürür.
 * Tam anahtar bu fonksiyonun kapsamında kalır — çağırana ASLA verilmez.
 * Depo hatası → fail-closed (yapılandırılmadı).
 */
export async function getCredentialInfo(id: ApiCredentialId): Promise<ApiCredentialInfo> {
  const desc = getCredentialDescriptor(id);
  if (!desc) return { id, configured: false, masked: '' };
  try {
    const stored = (await sensitiveKeyStore.get(desc.storeKey)).trim();
    return stored
      ? { id, configured: true,  masked: maskApiKey(stored) }
      : { id, configured: false, masked: '' };
  } catch {
    return { id, configured: false, masked: '' };
  }
}

/** Tüm kayıtlı sağlayıcıların durumu (ayarlar listesi için). */
export async function getAllCredentialInfo(): Promise<readonly ApiCredentialInfo[]> {
  const { API_CREDENTIALS } = await import('./credentialRegistry');
  return Promise.all(API_CREDENTIALS.map((c) => getCredentialInfo(c.id)));
}

/**
 * Anahtarı doğrular ve güvenli depoya yazar. Biçim hatasında YAZMAZ.
 * Başarıda yalnız maskeli özet döner (çağıran tam anahtarı tutmaz).
 */
export async function saveCredential(id: ApiCredentialId, raw: string): Promise<
  { ok: true; masked: string } | { ok: false; reason: KeyFormatError }
> {
  const desc = getCredentialDescriptor(id);
  if (!desc) return { ok: false, reason: 'empty' };
  const parsed = validateKeyFormat(raw, desc.minLength);
  if (!parsed.ok) return parsed;
  await sensitiveKeyStore.set(desc.storeKey, parsed.key);
  return { ok: true, masked: maskApiKey(parsed.key) };
}

/**
 * Anahtarı TÜM katmanlardan siler (Keystore + Recovery Store + cihaz blob'u).
 * Silme `sensitiveKeyStore.remove()` üzerinden yapılır; o da yedek katmanları
 * senkronlar → silinen anahtar bir sonraki açılışta GERİ GELMEZ.
 */
export async function removeCredential(id: ApiCredentialId): Promise<void> {
  const desc = getCredentialDescriptor(id);
  if (!desc) return;
  try {
    await sensitiveKeyStore.remove(desc.storeKey);
  } catch { /* depo hatası — fail-soft; üst katman durumu yine 'not_configured' okur */ }
}

/**
 * Kayıtlı anahtarla GERÇEK doğrulama isteği yapar.
 *
 * Anahtar yoksa AĞA ÇIKMAZ (`not_configured`). İstek sağlayıcının en düşük
 * maliyetli yolunu kullanır; streaming YOK, kullanıcı/araç verisi GÖNDERİLMEZ.
 * ASLA throw etmez (fail-closed).
 */
export async function verifyCredential(
  id: ApiCredentialId,
  options?: CredentialVerifyOptions,
): Promise<ApiCredentialStatus> {
  const desc = getCredentialDescriptor(id);
  if (!desc) return 'unknown_error';

  let key = '';
  try {
    key = (await sensitiveKeyStore.get(desc.storeKey)).trim();
  } catch {
    return 'not_configured';                       // depo okunamadı → fail-closed
  }
  if (!key) return 'not_configured';               // ağa ÇIKILMAZ

  try {
    return await desc.verify(key, options);
  } catch {
    return 'unknown_error';                        // doğrulayıcı throw etse bile
  }
}

export type {
  ApiCredentialId,
  ApiCredentialInfo,
  ApiCredentialStatus,
  KeyFormatError,
  KeyFormatResult,
} from './credentialTypes';
