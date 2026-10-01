/**
 * phoneLinkDeviceRole.ts — Phone Link'te bu cihazın rolü.
 *
 * ── TEK UYGULAMA, İKİ ROL (ürün kararı 2026-10-01) ──────────────────────────
 * Ayrı bir telefon (companion) uygulaması YOKTUR. Telefona da aynı CarOS Pro
 * kurulur:
 *   · ARAÇ (car)   — hibrit sunucu: Bluetooth + yerel Wi-Fi dinler, açılışta hazırlanır
 *   · TELEFON (phone) — istemci: kullanıcı "Araca bağlan" der; iki yol yarışır
 *
 * ── ROL NASIL BELİRLENİR ────────────────────────────────────────────────────
 * Kullanıcı seçimi (`settings.phoneLinkRole`) her zaman kazanır. 'auto' iken:
 *   1. head unit üretici paketleri tespit edildiyse (FYT/Microntek/KSW/NWD…) → araç
 *   2. ekranın KISA kenarı < 600 dp (CSS px) → telefon
 *   3. aksi hâlde → araç (CarOS'un asıl yeri araç ekranıdır)
 * `android.hardware.type.automotive` gibi teknik sinyaller birçok head unit'te
 * YOKTUR (K24: yok) — bu yüzden onlara dayanılmaz. Öneri yanlışsa kullanıcı
 * Ayarlar › Bağlantı'dan değiştirir; yanlış rol güvenliği etkilemez (her
 * eşleştirme iki ekranda kod onayı ister).
 */
import { useStore } from '../../store/useStore';
import { getPlatformInfo } from '../headUnitPlatform';

export type PhoneLinkDeviceRole = 'car' | 'phone';
export type PhoneLinkRoleSetting = 'auto' | PhoneLinkDeviceRole;

export const PHONE_MAX_SHORT_SIDE_DP = 600;

/** Saf öneri. `vendorHeadUnit`: üretici head unit paketleri tespit edildi mi. */
export function suggestPhoneLinkRole(shortSideDp: number | null, vendorHeadUnit: boolean): PhoneLinkDeviceRole {
  if (vendorHeadUnit) return 'car';
  if (shortSideDp === null || !Number.isFinite(shortSideDp) || shortSideDp <= 0) return 'car';
  return shortSideDp < PHONE_MAX_SHORT_SIDE_DP ? 'phone' : 'car';
}

/** Saf çözüm: açık seçim kazanır, 'auto' öneriye düşer. */
export function resolvePhoneLinkRole(
  setting: PhoneLinkRoleSetting | undefined,
  shortSideDp: number | null,
  vendorHeadUnit: boolean,
): PhoneLinkDeviceRole {
  if (setting === 'car' || setting === 'phone') return setting;
  return suggestPhoneLinkRole(shortSideDp, vendorHeadUnit);
}

/** Ekranın kısa kenarı (CSS px ≈ dp); okunamazsa null. */
export function currentShortSideDp(): number | null {
  if (typeof window === 'undefined' || !window.screen) return null;
  const w = window.screen.width;
  const h = window.screen.height;
  if (!(w > 0) || !(h > 0)) return null;
  return Math.min(w, h);
}

export function isVendorHeadUnit(): boolean {
  const info = getPlatformInfo();
  return info !== null && info.platform !== 'stock';
}

/** Bu cihazın şu anki Phone Link rolü. */
export function getPhoneLinkDeviceRole(): PhoneLinkDeviceRole {
  return resolvePhoneLinkRole(
    useStore.getState().settings.phoneLinkRole, currentShortSideDp(), isVendorHeadUnit(),
  );
}
