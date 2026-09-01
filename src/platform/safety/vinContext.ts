/**
 * vinContext — OBD el sıkışmasından gelen VIN'e ERİŞİM KABUĞU.
 *
 * ── P0-OBD-09: OTORİTE TAŞINDI, İKİNCİ DEPO KURULMADI ─────────────────────
 * Bu dosya eskiden VIN'in TEK deposuydu ve **hiçbir doğrulama yapmıyordu**:
 *   `_handshakeVin = vin?.trim().toUpperCase() ?? null`
 * Yani kısmi/bozuk bir VIN (`"VF1RJL00"`) deposu doldurabiliyor ve oradan
 * `saveObdFuelCalib(...)` anahtarına kadar gidebiliyordu — yanlış araca
 * kalibrasyon. Kaynak, ECU, oturum bilgisi de yoktu.
 *
 * Depo artık `vehicle/vehicleIdentity`tedir (doğrulama + provenance + çelişki +
 * oturum kapısı). Bu dosya YALNIZ mevcut çağıranlar için ince bir kabuktur —
 * ikinci bir depo DEĞİL. API şekli korunduğu için hiçbir tüketici değişmedi.
 */

import {
  recordVinObservation, getCanonicalVin, resetVehicleIdentity, currentVinEpoch,
} from '../vehicle/vehicleIdentity';

/**
 * El sıkışması VIN'ini kaydeder.
 *
 * FAIL-CLOSED: 17 haneli ISO 3779 biçimi tutmayan girdi **kabul edilmez** ve
 * `getHandshakeVin()` `null` döndürmeye devam eder. Eskiden bozuk değer kabul
 * ediliyor ve aşağı akışa sızıyordu.
 *
 * `null` girdi kimliği SIFIRLAR (el sıkışması başarısız → önceki aracın VIN'i
 * taşınmamalı).
 */
export function setHandshakeVin(vin: string | null): void {
  if (vin === null) { resetVehicleIdentity(); return; }
  recordVinObservation(vin, 'mode09', currentVinEpoch(), Date.now());
}

/**
 * KANONİK VIN — doğrulanmış, bu oturuma ait ve çelişkisiz. Aksi hâlde `null`.
 *
 * Davranış değişikliği bilinçlidir: çelişkili ya da bayat bir VIN döndürmek,
 * yanlış araca profil/kalibrasyon yazmak demektir.
 */
export function getHandshakeVin(): string | null {
  return getCanonicalVin(currentVinEpoch(), new Date().getFullYear());
}
