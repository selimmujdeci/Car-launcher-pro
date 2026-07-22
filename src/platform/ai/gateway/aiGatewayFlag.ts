/**
 * aiGatewayFlag — Mavi'nin AI Gateway hattı için TEK anahtar (rollback şalteri).
 *
 * VARSAYILAN: KAPALI. Kapalıyken mevcut sağlayıcı zinciri (Gemini → Groq →
 * Haiku) BİREBİR eskisi gibi çalışır — tek satır davranış değişmez. Açıkken
 * zincirin BAŞINA gateway adayı eklenir; kalan zincir yedek olarak DURUR
 * (kaldırılmaz) → her an geri dönülebilir.
 *
 * İki kaynak (MAVI3 takeover deseniyle aynı):
 *   1) Uzak bayrak `mavi_ai_gateway` (remoteConfigService; bilinmeyen anahtar → false)
 *   2) Yerel geliştirme kaldıracı `localStorage['mavi.aiGateway.enabled']`
 *      — YALNIZ tam `"true"` açar; `"1"`/`"yes"`/bozuk değer AÇMAZ (fail-closed).
 *
 * Değer İLK OKUMADA ÖNBELLEĞE ALINIR: karar bir konuşma turunun ortasında
 * değişip zinciri yarı-yolda değiştiremez (deterministik tur). Şalteri
 * çevirdikten sonra uygulama yeniden başlatılır.
 */

import { getFlag } from '../../remoteConfigService';

/** Uzak yapılandırma bayrağı anahtarı. */
export const AI_GATEWAY_REMOTE_FLAG = 'mavi_ai_gateway';
/** Yerel geliştirme kaldıracı anahtarı. */
export const AI_GATEWAY_LOCAL_FLAG  = 'mavi.aiGateway.enabled';

let _cached: boolean | null = null;

function readLocalOverride(): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem(AI_GATEWAY_LOCAL_FLAG) === 'true';   // YALNIZ tam "true"
  } catch {
    return false;                                                     // depo kilitli/kotalı
  }
}

function readRemoteFlag(): boolean {
  try {
    return getFlag(AI_GATEWAY_REMOTE_FLAG) === true;
  } catch {
    return false;                                                     // yapılandırma yoksa KAPALI
  }
}

/**
 * Mavi AI Gateway hattı açık mı? Varsayılan `false` (mevcut davranış).
 * İlk çağrıda okunur ve önbelleğe alınır.
 */
export function isAiGatewayEnabled(): boolean {
  if (_cached === null) _cached = readRemoteFlag() || readLocalOverride();
  return _cached;
}

/**
 * Şalteri kullanıcı tercihine göre AÇAR/KAPATIR (ayarlar ekranı).
 *
 * Yalnız YEREL kaldıracı yazar — uzak bayrak filoya aittir, cihazdan
 * değiştirilmez. Önbellek hemen tazelenir ki kullanıcı ayarı çevirince bir
 * sonraki konuşma turu yeni değeri görsün (yeniden başlatma gerekmez).
 *
 * ⚠️ Bu fonksiyon anahtarın GEÇERLİ olduğunu DOĞRULAMAZ — çağıran taraf
 * (openRouterKeyService) fail-closed kapıyı uygular.
 */
export function setAiGatewayEnabled(enabled: boolean): void {
  try {
    if (typeof localStorage !== 'undefined') {
      if (enabled) localStorage.setItem(AI_GATEWAY_LOCAL_FLAG, 'true');
      else         localStorage.removeItem(AI_GATEWAY_LOCAL_FLAG);
    }
  } catch { /* depo kilitli/kotalı — yalnız bellek içi karar güncellenir */ }
  // Uzak bayrak AÇIKSA kullanıcı yerelden kapatamaz (filo politikası üstündür).
  _cached = enabled || readRemoteFlag();
}

/** @internal — testler arası izolasyon (üretim yolunda çağrılmaz). */
export function _resetAiGatewayFlagForTest(): void {
  _cached = null;
}
