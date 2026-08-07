/**
 * phoneHubFieldProbe — PHONE-HUB P0.8 native saha gözlem önbelleği (SALT-OKUNUR).
 *
 * Desen `phoneHubHardwareProbe.ts` (P0.5) ile BİREBİR aynıdır — yeni desen icat
 * EDİLMEZ:
 *   · `refreshPhoneHubFieldProbe()` → ASYNC native pull, modül önbelleğini doldurur.
 *   · `getPhoneHubFieldProbe()`     → SENKRON, YAN ETKİSİZ; yalnız önbelleği okur.
 *
 * ── BU MODÜL NE YAPMAZ ──────────────────────────────────────────────────────
 * Eşleştirme · keşif/tarama · BLE scan · RFCOMM · GATT · adapter aç-kapat · SCO ·
 * ses yolu/modu değişimi · medya veya transport komutu · çağrı · SMS · izin isteği ·
 * vendor bind/broadcast · OBD müdahalesi — HİÇBİRİ. Timer/abonelik KURMAZ.
 *
 * ── FAIL-SOFT ───────────────────────────────────────────────────────────────
 * Native metot yoksa (eski APK) veya çağrı patlarsa önbellek `present:false` kalır →
 * tüketici "okunamadı" görür, SAHTE varsayılan ÜRETİLMEZ.
 */

import { CarLauncher } from '../nativePlugin';
import type { NativePhoneHubFieldProbe } from '../nativePlugin';

/** Önbellek — modül seviyesinde tek kayıt. Başlangıçta KANIT YOK. */
let _cache: NativePhoneHubFieldProbe = { present: false };
/** Önbelleğin JS tarafında ne zaman yazıldığı (duvar saati). 0 = hiç yazılmadı. */
let _cachedAt = 0;

/** Senkron, yan etkisiz okuma. Native'e GİTMEZ. */
export function getPhoneHubFieldProbe(): NativePhoneHubFieldProbe {
  return _cache;
}

/** Önbelleğin JS damgası (ms). 0 = hiç tazelenmedi — "şimdi" UYDURULMAZ. */
export function getPhoneHubFieldProbeCachedAt(): number {
  return _cachedAt;
}

/**
 * Native salt-okunur saha gözlemini çeker ve önbelleği tazeler.
 * Hata durumunda önbellek `present:false` yapılır (eski kanıt YANLIŞLIKLA taze
 * görünmesin diye) ve istisna YUTULUR — çağıran çökmez.
 */
export async function refreshPhoneHubFieldProbe(): Promise<NativePhoneHubFieldProbe> {
  try {
    const fn = CarLauncher.getPhoneHubFieldProbe;
    if (typeof fn !== 'function') {
      // Eski APK: metot yok. "Kanıt yok" DÜRÜSTÇE bildirilir.
      _cache = { present: false };
      _cachedAt = Date.now();
      return _cache;
    }
    const raw = await CarLauncher.getPhoneHubFieldProbe!();
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
export function _resetPhoneHubFieldProbeForTest(): void {
  _cache = { present: false };
  _cachedAt = 0;
}
