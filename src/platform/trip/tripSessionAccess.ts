/**
 * tripSessionAccess — seyahat oturumuna SIFIR BAĞIMLILIKLI okuma noktası.
 *
 * NEDEN VAR: `companionChatProvider.buildInterpretedVehicleContext()` SENKRON
 * bir fonksiyondur (string döndürür) → `await import` kullanamaz. Oturumu
 * doğrudan statik import etmek ise `tripSessionService` → `tripLogService`
 * kenarını Mavi'nin bağlam grafiğine ekliyordu; bu graf zaten 400+ modül ve
 * `regression.guards` içindeki dinamik-import kilidi ölçülebilir biçimde
 * yavaşladı (varsayılan 5 sn timeout'ta düşmeye başladı).
 *
 * ÇÖZÜM: bağımlılık TERS çevrildi. Bu modülün ÇALIŞMA ZAMANI bağımlılığı
 * YOKTUR (yalnız `import type` — derlemede silinir). Okuyucuyu
 * `tripSessionService` başlarken KAYDEDER; tüketici yalnız bu ince kapıyı
 * import eder.
 *
 * FAIL-SOFT: kayıt yapılmadıysa `null` döner → çağıran eski davranışına düşer.
 * Sahte oturum ÜRETİLMEZ.
 */

import type { TripSessionProjection } from './core/tripSessionModel';

type Reader = () => TripSessionProjection;

let _read: Reader | null = null;

/**
 * Okuyucuyu kaydet — YALNIZ `tripSessionService.startTripSession()` çağırır.
 * İkinci bir sahip doğmasın diye dışarıdan kullanılmaz.
 */
export function _registerTripSessionReader(fn: Reader | null): void {
  _read = typeof fn === 'function' ? fn : null;
}

/**
 * Oturumu oku. Kayıt yoksa, okuma patlarsa ya da oturum HİÇ başlamadıysa
 * `null` — çağıran bunu "veri yok" olarak yorumlar.
 */
export function readTripSessionOrNull(): TripSessionProjection | null {
  if (_read === null) return null;
  try {
    const s = _read();
    return s && s.sessionId !== null ? s : null;
  } catch {
    return null;
  }
}
