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

import { isRecoveryKey, sensitiveKeyStore } from '../../sensitiveKeyStore';
import { getCredentialDescriptor } from './credentialRegistry';
import type {
  ApiCredentialDescriptor,
  ApiCredentialId,
  ApiCredentialInfo,
  ApiCredentialStatus,
  CredentialStatus,
  CredentialStatusMap,
  CredentialVerifyOptions,
  KeyFormatError,
  KeyFormatResult,
} from './credentialTypes';
import { hasControlChars } from '../controlChars';

/**
 * HAFİF istemci doğrulaması. PREFIX ZORUNLU TUTULMAZ — sağlayıcılar anahtar
 * biçimini değiştirdiğinde ürün kilitlenmesin. Gerçek geçerlilik yalnız
 * bağlantı testiyle belirlenir.
 */
export function validateKeyFormat(raw: string, minLength = 16): KeyFormatResult {
  const key = typeof raw === 'string' ? raw.trim() : '';
  if (!key)                        return { ok: false, reason: 'empty' };
  // C0/C1 kontrol karakteri = bozuk kopyala/yapıştır işareti (görünmez bayt).
  if (hasControlChars(key))        return { ok: false, reason: 'control_chars' };
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

/* ── Toplu durum okuma (panel açılışının TEK giriş noktası) ───────────────── */

/**
 * Aynı anda açık tutulacak azami güvenli-depo okuması.
 *
 * Neden 3: her okuma native köprüde ayrı bir IPC turudur. Sınırsız
 * `Promise.all` sağlayıcı sayısı büyüdükçe düşük uçlu head unit'te (2-4 çekirdek,
 * tek WebView thread'i) köprüyü tıkar; tamamen seri okuma ise N tur gecikme
 * ekler. 3, tipik head unit çekirdek sayısının altında kalarak turları
 * örtüştürür ama köprüyü doldurmaz. Kayıt defteri büyüse bile eşzamanlı yük
 * SABİT kalır.
 */
const STATUS_READ_CONCURRENCY = 3;

/**
 * Süreç-belleği durum önbelleği — YALNIZ güvenli metadata (configured/source/
 * maskedSummary). Anahtar materyali ASLA önbelleklenmez. Kalıcı depo (localStorage
 * vb.) KULLANILMAZ: uygulama yeniden başladığında boş başlar.
 */
const _statusCache = new Map<ApiCredentialId, CredentialStatus>();

/** Tek kaydı önbellekten düşür (kaydetme/silme sonrası). */
export function invalidateCredentialStatus(id: ApiCredentialId): void {
  _statusCache.delete(id);
}

/** Tüm önbelleği temizle (oturum/profil değişimi, testler arası izolasyon). */
export function clearCredentialStatusCache(): void {
  _statusCache.clear();
}

/** Depo hatası / bilinmeyen kayıt → fail-closed durum. */
function failClosedStatus(id: ApiCredentialId, recoveryAvailable: boolean): CredentialStatus {
  return { keyId: id, configured: false, source: 'none', recoveryAvailable, readError: true };
}

/**
 * TEK bir kimlik bilgisinin güvenli durumunu üretir.
 *
 * ⚠️ Ham anahtar YALNIZ bu fonksiyonun yerel kapsamında yaşar: okunur, hemen
 * maskeye çevrilir ve dışarı YALNIZ maske çıkar. Hiçbir toplu nesnede/dizide
 * ham değer biriktirilmez.
 */
async function readStatus(desc: ApiCredentialDescriptor): Promise<CredentialStatus> {
  const recoveryAvailable = isRecoveryKey(desc.storeKey);
  let stored = '';
  try {
    stored = (await sensitiveKeyStore.get(desc.storeKey)).trim();
  } catch {
    return failClosedStatus(desc.id, recoveryAvailable);
  }

  if (stored) {
    const masked = maskApiKey(stored);
    // `stored` bu noktadan sonra KULLANILMAZ; yalnız maske taşınır.
    return { keyId: desc.id, configured: true, source: 'secure_store', maskedSummary: masked, recoveryAvailable };
  }

  // Depoda yok → `.env` yedeği VAR MI (yalnız doluluk; DEĞER okunmaz/maskelenmez).
  let hasEnv = false;
  try {
    hasEnv = (desc.getEnvKey?.() ?? '').trim().length > 0;
  } catch {
    hasEnv = false;
  }

  return {
    keyId:      desc.id,
    configured: false,                                  // env, güvenli depo kaydı SAYILMAZ
    source:     hasEnv ? 'environment' : 'none',
    recoveryAvailable,
  };
}

/** Sınırlı eşzamanlılıkla çalıştıran küçük havuz (sınırsız Promise.all YOK). */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;
  const runners = new Array(Math.min(limit, items.length)).fill(null).map(async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      out[index] = await worker(items[index] as T);
    }
  });
  await Promise.all(runners);
  return out;
}

export interface ListCredentialStatusesOptions {
  /** true → önbellek atlanır ve her kayıt yeniden okunur. */
  readonly force?: boolean;
}

/**
 * TÜM kayıtlı sağlayıcıların durumunu TEK geçişte döndürür (panel açılışı).
 *
 * - Gerçek anahtar DÖNMEZ; hiçbir toplu nesnede ham değer tutulmaz.
 * - Sınırlı eşzamanlılık (`STATUS_READ_CONCURRENCY`) — köprü tıkanmaz.
 * - TEK sağlayıcının hatası listeyi KIRMAZ: o kayıt fail-closed döner.
 * - Önbellekteki kayıtlar tekrar OKUNMAZ (native çağrı yapılmaz).
 * - ASLA throw etmez.
 */
export async function listCredentialStatuses(
  options?: ListCredentialStatusesOptions,
): Promise<CredentialStatusMap> {
  const { API_CREDENTIALS } = await import('./credentialRegistry');
  if (options?.force) _statusCache.clear();

  const pending = API_CREDENTIALS.filter((c) => !_statusCache.has(c.id));
  const fresh = await mapWithConcurrency(pending, STATUS_READ_CONCURRENCY, async (desc) => {
    try {
      return await readStatus(desc);
    } catch {
      return failClosedStatus(desc.id, isRecoveryKey(desc.storeKey));  // izole hata
    }
  });
  for (const status of fresh) _statusCache.set(status.keyId, status);

  const map: Record<string, CredentialStatus> = {};
  for (const c of API_CREDENTIALS) {
    const cached = _statusCache.get(c.id);
    if (cached) map[c.id] = cached;
  }
  return map;
}

/**
 * Tek kimlik bilgisinin durumu (kullanıcının açıkça tetiklediği işlemler için).
 * Panel AÇILIŞINDA kullanılmaz — orada `listCredentialStatuses` tek geçiş yapar.
 */
export async function getCredentialStatus(
  id: ApiCredentialId,
  options?: ListCredentialStatusesOptions,
): Promise<CredentialStatus> {
  const desc = getCredentialDescriptor(id);
  if (!desc) return failClosedStatus(id, false);
  if (!options?.force) {
    const cached = _statusCache.get(id);
    if (cached) return cached;
  }
  let status: CredentialStatus;
  try {
    status = await readStatus(desc);
  } catch {
    status = failClosedStatus(id, isRecoveryKey(desc.storeKey));
  }
  _statusCache.set(id, status);
  return status;
}

/**
 * Anahtarı doğrular ve güvenli depoya yazar. Biçim hatasında YAZMAZ.
 * Başarıda yalnız maskeli özet döner (çağıran tam anahtarı tutmaz).
 */
export async function saveCredential(id: ApiCredentialId, raw: string): Promise<
  { ok: true; masked: string; status: CredentialStatus } | { ok: false; reason: KeyFormatError }
> {
  const desc = getCredentialDescriptor(id);
  if (!desc) return { ok: false, reason: 'empty' };
  const parsed = validateKeyFormat(raw, desc.minLength);
  if (!parsed.ok) return parsed;
  await sensitiveKeyStore.set(desc.storeKey, parsed.key);

  // Önbellek ATOMİK güncellenir → panel yeniden okuma YAPMAZ (0 native çağrı).
  const masked = maskApiKey(parsed.key);
  const status: CredentialStatus = {
    keyId:             id,
    configured:        true,
    source:            'secure_store',
    maskedSummary:     masked,
    recoveryAvailable: isRecoveryKey(desc.storeKey),
  };
  _statusCache.set(id, status);
  return { ok: true, masked, status };
}

/**
 * Anahtarı TÜM katmanlardan siler (Keystore + Recovery Store + cihaz blob'u).
 * Silme `sensitiveKeyStore.remove()` üzerinden yapılır; o da yedek katmanları
 * senkronlar → silinen anahtar bir sonraki açılışta GERİ GELMEZ.
 */
export async function removeCredential(id: ApiCredentialId): Promise<CredentialStatus> {
  const desc = getCredentialDescriptor(id);
  if (!desc) return failClosedStatus(id, false);
  try {
    await sensitiveKeyStore.remove(desc.storeKey);
  } catch { /* depo hatası — fail-soft; durum yine 'kayıtlı değil' olarak yansır */ }

  // Silme sonrası `.env` yedeği HÂLÂ olabilir (yalnız doluluk bakılır, değer değil).
  let hasEnv = false;
  try { hasEnv = (desc.getEnvKey?.() ?? '').trim().length > 0; } catch { hasEnv = false; }

  const status: CredentialStatus = {
    keyId:             id,
    configured:        false,
    source:            hasEnv ? 'environment' : 'none',
    recoveryAvailable: isRecoveryKey(desc.storeKey),
  };
  _statusCache.set(id, status);      // maskedSummary DÜŞER (alan hiç set edilmez)
  return status;
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
  CredentialSource,
  CredentialStatus,
  CredentialStatusMap,
  KeyFormatError,
  KeyFormatResult,
} from './credentialTypes';
