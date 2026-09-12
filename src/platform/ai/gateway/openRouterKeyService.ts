/**
 * openRouterKeyService — OpenRouter'a özgü ayar akışı (ince sarmalayıcı).
 *
 * ⚠️ ANAHTAR YAŞAM DÖNGÜSÜ ARTIK BURADA DEĞİL: kaydetme/okuma/maskeleme/silme/
 * doğrulama sağlayıcı-BAĞIMSIZ `apiCredentialManager` üzerinden yürür. Bu dosya
 * yalnız OpenRouter'a ÖZGÜ olan kısmı taşır: Mavi'nin AI Gateway şalteri.
 *
 * Public API'si KORUNDU (geriye uyum): `MaviGatewayPanel` ve mevcut testler
 * değişmeden çalışır.
 *
 * ── FAIL-CLOSED ─────────────────────────────────────────────────────────────
 * Anahtar yoksa/doğrulanmadıysa gateway şalteri AÇILAMAZ. Depo hatası, ağ
 * hatası veya belirsizlik daima "kapat" yönünde çözülür.
 */

import { isAiGatewayEnabled, setAiGatewayEnabled } from './aiGatewayFlag';
import {
  credentialStatusMessage,
  getCredentialInfo,
  keyFormatMessage,
  maskApiKey,
  removeCredential,
  saveCredential,
  validateKeyFormat,
} from '../credentials/apiCredentialManager';
import { statusFromGatewayErrorKind } from '../credentials/credentialVerifiers';
import type {
  ApiCredentialStatus,
  KeyFormatError,
  KeyFormatResult,
} from '../credentials/credentialTypes';
import type { AiErrorKind } from './types';

/** OpenRouter kimliği — kayıt defterindeki tanım. */
const CREDENTIAL_ID = 'openrouter' as const;

/* ── Geriye uyumlu tip/yardımcı yeniden dışa aktarımları ──────────────────── */

/** @deprecated Sağlayıcı-bağımsız `ApiCredentialStatus` ile aynı birlik. */
export type OpenRouterConnectionStatus = ApiCredentialStatus;
export type { KeyFormatError, KeyFormatResult };

/** Anahtarın depodaki KAYIT durumu — tam anahtar ASLA taşınmaz. */
export interface OpenRouterKeyInfo {
  readonly configured: boolean;
  readonly masked:     string;
}

export { keyFormatMessage, maskApiKey, validateKeyFormat, isAiGatewayEnabled };

/** Gateway hata sınıfı → kullanıcı durumu (sağlayıcı-bağımsız eşleme). */
export function statusFromErrorKind(kind: AiErrorKind): OpenRouterConnectionStatus {
  return statusFromGatewayErrorKind(kind);
}

/** Durum → sade Türkçe açıklama (teknik terim/HTTP kodu YOK). */
export function connectionStatusMessage(status: OpenRouterConnectionStatus): string {
  return credentialStatusMessage(status);
}

/* ── Anahtar yaşam döngüsü (yöneticiye devredilir) ────────────────────────── */

export async function getOpenRouterKeyInfo(): Promise<OpenRouterKeyInfo> {
  const info = await getCredentialInfo(CREDENTIAL_ID);
  return { configured: info.configured, masked: info.masked };
}

export async function saveOpenRouterKey(raw: string): Promise<
  { ok: true; masked: string } | { ok: false; reason: KeyFormatError }
> {
  return saveCredential(CREDENTIAL_ID, raw);
}

/**
 * Anahtarı TÜM katmanlardan siler ve gateway şalterini KAPATIR.
 * Eski sağlayıcı yolu (Gemini/Groq/Haiku) etkilenmez — Mavi susmaz.
 */
export async function removeOpenRouterKey(): Promise<void> {
  setAiGatewayEnabled(false);        // önce şalter: silme yarıda kalsa bile açık kalmasın
  await removeCredential(CREDENTIAL_ID);
}

/** Bağlantı testi için kısa bütçe — ayarlar ekranında kullanıcı bekliyor. */
const CONNECTION_TEST_TIMEOUT_MS = 8_000;

/**
 * Kayıtlı anahtarla GERÇEK doğrulama isteği yapar (SIFIR token: `GET /key`).
 * Anahtar yoksa AĞA ÇIKMAZ. ASLA throw etmez.
 */
export async function testOpenRouterConnection(): Promise<OpenRouterConnectionStatus> {
  const info = await getOpenRouterKeyInfo();
  if (!info.configured) return 'not_configured';

  try {
    const { verifyDefaultAiConnection } = await import('./concrete/defaultAiGateway');
    const result = await verifyDefaultAiConnection(CONNECTION_TEST_TIMEOUT_MS, CREDENTIAL_ID);
    if (result.ok) return 'connected';
    return result.error ? statusFromErrorKind(result.error.kind) : 'unknown_error';
  } catch {
    return 'unknown_error';
  }
}

/* ── Şalter (fail-closed kapı) ────────────────────────────────────────────── */

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
