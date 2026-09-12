/**
 * phoneHubHardwareProbe — PHONE-HUB P0.5 native gözlem önbelleği (SALT-OKUNUR).
 *
 * Desen `platform/obd/extendedPollEvidence.ts` ile BİREBİR aynıdır:
 *   · `refreshPhoneHubProbe()` → ASYNC native pull, modül önbelleğini doldurur.
 *   · `getPhoneHubProbe()`     → SENKRON, YAN ETKİSİZ; yalnız önbelleği okur.
 * Yeni desen icat EDİLMEZ.
 *
 * ── BU MODÜL NE YAPMAZ ──────────────────────────────────────────────────────
 * Bluetooth keşfi/taraması · eşleştirme · soket/GATT · adapter aç-kapat · SCO ·
 * ses yolu değişimi · medya komutu · çağrı · izin isteği · vendor bind/broadcast ·
 * OBD müdahalesi — HİÇBİRİ. Timer/abonelik KURMAZ.
 *
 * ── FAIL-SOFT ───────────────────────────────────────────────────────────────
 * Native metot yoksa (eski APK) veya çağrı patlarsa önbellek `present:false`
 * kalır → tüketici "okunamadı" görür, SAHTE varsayılan ÜRETİLMEZ.
 */

import { CarLauncher } from '../nativePlugin';
import type { NativePhoneHubProbe } from '../nativePlugin';

/** Önbellek — modül seviyesinde tek kayıt. Başlangıçta KANIT YOK. */
let _cache: NativePhoneHubProbe = { present: false };
/** Önbelleğin JS tarafında ne zaman yazıldığı (duvar saati). 0 = hiç yazılmadı. */
let _cachedAt = 0;

/** Senkron, yan etkisiz okuma. Native'e GİTMEZ. */
export function getPhoneHubProbe(): NativePhoneHubProbe {
  return _cache;
}

/** Önbelleğin JS damgası (ms). 0 = hiç tazelenmedi — "şimdi" UYDURULMAZ. */
export function getPhoneHubProbeCachedAt(): number {
  return _cachedAt;
}

/**
 * Native salt-okunur gözlemi çeker ve önbelleği tazeler.
 * Hata durumunda önbellek `present:false` yapılır (eski kanıt YANLIŞLIKLA taze
 * görünmesin diye) ve istisna YUTULUR — çağıran çökmez.
 */
export async function refreshPhoneHubProbe(): Promise<NativePhoneHubProbe> {
  try {
    const fn = CarLauncher.getPhoneHubHardwareProbe;
    if (typeof fn !== 'function') {
      // Eski APK: metot yok. "Kanıt yok" DÜRÜSTÇE bildirilir.
      _cache = { present: false };
      _cachedAt = Date.now();
      return _cache;
    }
    const raw = await CarLauncher.getPhoneHubHardwareProbe!();
    _cache = raw && raw.present === true ? raw : { present: false };
    _cachedAt = Date.now();
    return _cache;
  } catch {
    _cache = { present: false };
    _cachedAt = Date.now();
    return _cache;
  }
}

/** @internal — testler arası izolasyon. */
export function _resetPhoneHubProbeForTest(): void {
  _cache = { present: false };
  _cachedAt = 0;
}
