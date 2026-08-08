/**
 * locationContextAccess — konum bağlamına SIFIR BAĞIMLILIKLI okuma noktası.
 *
 * NEDEN VAR: `companionChatProvider.buildInterpretedVehicleContext()` SENKRON
 * bir fonksiyondur ve yedi yerden çağrılır. `locationContextService`i oraya
 * statik import etmek `gpsService` + `navigationSessionRuntime` +
 * `geocodingService` kenarlarını Mavi'nin bağlam grafiğine ekler; o graf zaten
 * 350+ modüldür ve `regression.guards` içindeki dinamik-import kilidi
 * varsayılan 5 sn timeout'un **hemen dibinde** ölçüldü (4720 ms).
 *
 * ÇÖZÜM: bağımlılık TERS çevrildi — bu modülün ÇALIŞMA ZAMANI bağımlılığı
 * YOKTUR (yalnız `import type`, derlemede silinir). Aynı desen Trip PR'ında
 * `tripSessionAccess` ile kurulmuştur.
 *
 * FAIL-SOFT: kayıt yoksa `null` → çağıran konum satırını HİÇ eklemez.
 * Sahte konum ÜRETİLMEZ.
 */

import type { LocationContext } from './locationContextModel';

type Reader = () => LocationContext;

let _read: Reader | null = null;

/**
 * Okuyucuyu kaydet — YALNIZ `locationContextService.startLocationContext()`
 * çağırır. İkinci bir konum sahibi doğmasın diye dışarıdan kullanılmaz.
 */
export function _registerLocationContextReader(fn: Reader | null): void {
  _read = typeof fn === 'function' ? fn : null;
}

/**
 * Konum bağlamını oku. Kayıt yoksa, okuma patlarsa veya kanıt yetersizse
 * `null` — çağıran bunu "konum bilgisi yok" olarak yorumlar.
 */
export function readLocationContextOrNull(): LocationContext | null {
  if (_read === null) return null;
  try {
    const c = _read();
    return c && c.availability === 'available' ? c : null;
  } catch {
    return null;
  }
}
