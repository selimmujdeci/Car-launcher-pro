/**
 * ecuRoleProfiles — P0-OBD-08 · ÜRETİCİ-ÖZEL ECU ROL EŞLEMELERİ (VERİ KATMANI).
 *
 * SAF: I/O YOK · timer YOK · global durum YOK.
 *
 * ── NEDEN AYRI DOSYA ──────────────────────────────────────────────────────
 * Görev kuralı: *"Manufacturer-specific eşlemeleri ayrı profil/veri katmanında
 * tut; generic çekirdeğe tahmin gömme."* `ecuRoleModel` bu tabloyu BİLMEZ —
 * profil rolünü çağıran buradan alır ve modele PARAMETRE olarak verir. Böylece
 * çekirdek mantık üretici bilgisinden tamamen bağımsız kalır ve tek satır
 * "Renault'ta 7A ABS'tir" bilgisi bile çekirdeğe sızamaz.
 *
 * ── TABLO NEDEN BOŞ ───────────────────────────────────────────────────────
 * **Kasıtlı.** Bir eşleme buraya ancak GERÇEK BİR ARAÇTA doğrulandıktan sonra
 * girer. "Çoğu Renault'ta 18DAF17A ABS'dir" cümlesi yaygın bir GELENEKTİR,
 * ölçüm değildir; onu tabloya yazmak, kaçındığımız tahmini başka bir dosyaya
 * taşımaktan ibaret olurdu.
 *
 * Mekanizma HAZIR: bir eşleme sahada `deriveEcuRole` ile ÇELİŞMEDEN
 * doğrulandığında (ECU kendi adını bildirmiyor ama araç servis belgesi ya da
 * tekrarlanabilir gözlem rolü kanıtlıyorsa) buraya `verifiedOn` damgasıyla
 * eklenir. Damgasız satır kabul EDİLMEZ (`validateEcuRoleProfiles` düşer).
 *
 * ── EŞLEME NASIL UYGULANIR ────────────────────────────────────────────────
 * Yalnız üretici KANITLA biliniyorsa (VIN'in WMI öneki) ve adres + adresleme
 * kipi birebir tutuyorsa. Üretici bilinmiyorsa profil HİÇ denenmez —
 * "muhtemelen Renault'tur" bir kanıt değildir.
 */

import { foldAscii, type EcuRole } from './ecuRoleModel';

export interface EcuRoleProfileEntry {
  /** VIN'in ilk 3 hanesi (WMI) — üreticinin TEK kanıtlanabilir işareti. */
  readonly wmi: string;
  /** ECU yanıt adresi (rx), büyük harf hex. */
  readonly rxHeader: string;
  readonly addressBits: 11 | 29;
  readonly role: EcuRole;
  /**
   * Bu eşlemenin GERÇEK ARAÇTA doğrulandığı tarih (YYYY-MM-DD) ve kısa kanıt.
   * ZORUNLU: damgasız eşleme, tahminin başka dosyaya taşınmasıdır.
   */
  readonly verifiedOn: string;
  readonly evidenceNote: string;
}

/**
 * Doğrulanmış eşlemeler. **Şu an BOŞ** — sahada doğrulanmış tek eşleme yok.
 *
 * Boş olması bir eksiklik DEĞİL, dürüstlüktür: tablo dolmadan da rol çıkarımı
 * çalışır (ECU kendi adını bildiriyorsa `declared`, 7E8 ise `standard`).
 */
export const ECU_ROLE_PROFILES: readonly EcuRoleProfileEntry[] = [];

/**
 * Tablo tutarlılığı — kilit testi bunu çağırır.
 *
 * Damgasız / biçimsiz / yinelenen satır kabul edilmez. Bir gün tablo dolduğunda
 * bu kapı, "hızlıca bir satır ekleyeyim" yoluyla doğrulanmamış tahmin girmesini
 * engeller.
 */
export function validateEcuRoleProfiles(
  entries: readonly EcuRoleProfileEntry[] = ECU_ROLE_PROFILES,
): readonly string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  entries.forEach((e, i) => {
    if (!/^[0-9A-Z]{3}$/.test(e.wmi)) errors.push(`[${i}] wmi 3 haneli büyük harf/rakam olmalı`);
    if (!/^[0-9A-F]{3}$|^[0-9A-F]{8}$/.test(e.rxHeader)) {
      errors.push(`[${i}] rxHeader 3 (11-bit) veya 8 (29-bit) hex hane olmalı`);
    }
    if (e.addressBits !== 11 && e.addressBits !== 29) errors.push(`[${i}] addressBits 11 veya 29 olmalı`);
    if (e.role === 'unknown') errors.push(`[${i}] 'unknown' eşlemesi anlamsız — satırı SİL`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.verifiedOn)) {
      errors.push(`[${i}] verifiedOn ZORUNLU (YYYY-MM-DD) — doğrulanmamış eşleme kabul edilmez`);
    }
    if (e.evidenceNote.trim().length < 10) errors.push(`[${i}] evidenceNote çok kısa — kanıt yazılmalı`);
    const key = `${e.wmi}|${e.addressBits}|${e.rxHeader}`;
    if (seen.has(key)) errors.push(`[${i}] yinelenen eşleme: ${key}`);
    seen.add(key);
  });
  return errors;
}

/**
 * Üretici profilinden rol arar.
 *
 * @param vin  Araç VIN'i; `null`/kısa ise profil HİÇ denenmez (üretici kanıtı yok).
 * @returns eşleşen rol, ya da `null` (eşleme yok — çağıran `unknown` bırakır).
 */
export function lookupProfileRole(
  vin: string | null | undefined,
  rxHeader: string,
  addressBits: 11 | 29,
  entries: readonly EcuRoleProfileEntry[] = ECU_ROLE_PROFILES,
): EcuRole | null {
  if (typeof vin !== 'string' || vin.trim().length < 3) return null;
  const wmi = foldAscii(vin.trim()).slice(0, 3);
  const rx = foldAscii(rxHeader);
  for (const e of entries) {
    if (e.wmi === wmi && e.addressBits === addressBits && e.rxHeader === rx) return e.role;
  }
  return null;
}
