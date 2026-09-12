/**
 * validationFlag — Saha Doğrulama Modu'nun TEK anahtarı (rollback şalteri).
 *
 * VARSAYILAN: KAPALI. Kapalıyken üretim davranışı BİREBİR aynıdır: hiçbir
 * abonelik açılmaz, hiçbir zamanlayıcı kurulmaz, hiçbir kayıt tutulmaz.
 *
 * ÜÇ KAPI (hepsi gerekli — fail-closed):
 *   1) `DEBUG_ENABLED` — yalnız debug/developer yapısı (satış build'inde ASLA).
 *   2) Uzak bayrak `caros_validation_mode` (bilinmeyen anahtar → false).
 *   3) Yerel kaldıraç `localStorage['caros.validationMode.enabled']`
 *      — YALNIZ tam `"true"` açar; `"1"`/`"yes"`/bozuk değer AÇMAZ.
 *
 * Not: aiGatewayFlag'ten farklı olarak değer ÖNBELLEĞE ALINIP dondurulmaz —
 * teknisyen sahada şalteri çevirip uygulamayı yeniden başlatmak zorunda
 * kalmasın. Okuma ucuzdur ve YALNIZ panel açılışında/oturum başlatmada yapılır
 * (sıcak yolda çağrılmaz).
 */

import { DEBUG_ENABLED } from '../debug';
import { getFlag } from '../remoteConfigService';

/** Uzak yapılandırma bayrağı anahtarı. */
export const VALIDATION_REMOTE_FLAG = 'caros_validation_mode';
/** Yerel geliştirme kaldıracı anahtarı. */
export const VALIDATION_LOCAL_FLAG  = 'caros.validationMode.enabled';

function readLocalOverride(): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem(VALIDATION_LOCAL_FLAG) === 'true';   // YALNIZ tam "true"
  } catch {
    return false;                                                     // depo kilitli/kotalı
  }
}

function readRemoteFlag(): boolean {
  try {
    return getFlag(VALIDATION_REMOTE_FLAG) === true;
  } catch {
    return false;                                                     // yapılandırma yoksa KAPALI
  }
}

/**
 * Saha Doğrulama Modu kullanılabilir mi? Varsayılan `false`.
 * Debug kapısı geçilmeden diğer kaynaklar TEK BAŞINA açamaz (fail-closed).
 */
export function isValidationModeEnabled(): boolean {
  if (!DEBUG_ENABLED) return false;
  return readRemoteFlag() || readLocalOverride();
}

/** Şalteri çevirir (yalnız YEREL kaldıraç yazılır — uzak bayrak filoya aittir). */
export function setValidationModeEnabled(enabled: boolean): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (enabled) localStorage.setItem(VALIDATION_LOCAL_FLAG, 'true');
    else         localStorage.removeItem(VALIDATION_LOCAL_FLAG);
  } catch { /* depo kilitli — sessiz geç */ }
}
