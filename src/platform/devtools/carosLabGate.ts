/**
 * carosLabGate.ts — CAROS LAB geliştirici erişim kapısı (FAIL-CLOSED · saf).
 *
 * ── DEĞİŞİKLİK (2026-07-26): ROL KAPISI → BUILD KAPISI ──────────────────────
 * ESKİ kural: `DEBUG_ENABLED && canDebug` (rol sistemi izni ŞARTTI).
 * Bu, geliştirme/test aşamasında GERÇEK BİR ENGELDİ: test APK'sını kuran her
 * cihaz varsayılan `driver` rolüyle açılıyor, `canDebug` yalnız
 * technician/admin/super_admin rollerinde bulunuyordu → CAROS LAB ve Debug Panel
 * görünmüyordu. Rolü elle yükseltmek veya localStorage taşımak gerekiyordu.
 *
 * YENİ kural: TEK derleme-zamanı otoritesi `DEVELOPER_FEATURES_ENABLED`.
 * Ürün gerçeği (aile içi saha testi, Play Store dağıtımı YOK) bunu gerektirir:
 * test build'ini kuran HER cihazda geliştirici yüzeyleri açıktır — ROLDEN
 * BAĞIMSIZ. Satış build'inde bayrak derleme-zamanında `false`'a katlanır →
 * kapı KAPALI ve korumalı dallar ölü kod olarak elenir.
 *
 * KAPI SİLİNMEDİ, DÖNÜŞTÜRÜLDÜ: hem menü kapısı hem doğrudan route/render kapısı
 * AYNI merkezi kararı kullanır (bkz. `shouldRenderCarosLab`).
 *
 * NOT: rol sistemindeki `canDebug` izni KALDIRILMADI — satış sonrası "mühendis
 * modu" için korunuyor. Yalnız geliştirici yüzeyi GÖRÜNÜRLÜĞÜ ondan ayrıldı.
 *
 * FAIL-CLOSED: girdi boolean değilse (undefined/null/bozuk) erişim REDDEDİLİR.
 */

import { DEVELOPER_FEATURES_ENABLED } from '../debug/developerFeatures';

export interface CarosLabGateInput {
  /** Derleme-zamanı geliştirici bayrağı — TEK koşul. */
  readonly developerFeaturesEnabled: boolean;
}

export type CarosLabGateReason = 'ok' | 'build-flag-off';

/** Erişime izin var mı? Koşul GERÇEK boolean true olmalı (fail-closed). */
export function isCarosLabAllowed(input: CarosLabGateInput | null | undefined): boolean {
  if (!input) return false;
  return input.developerFeaturesEnabled === true;
}

/** Reddin nedeni (teşhis/UI metni). */
export function carosLabGateReason(input: CarosLabGateInput | null | undefined): CarosLabGateReason {
  return isCarosLabAllowed(input) ? 'ok' : 'build-flag-off';
}

/**
 * Derleme bayrağını ortamdan alan kısayol.
 *
 * ARGÜMAN ALMAZ: rol/izin artık görünürlüğü ETKİLEMEZ. İmza bilinçli olarak
 * daraltıldı — kullanılmayan bir `canDebug` parametresini sessizce yutmak, çağrı
 * noktalarında "hâlâ rol kontrol ediliyor" yanılsaması yaratırdı (ve derleyici
 * eski çağrıları yakalayamazdı).
 */
export function isCarosLabAllowedFromEnv(): boolean {
  return isCarosLabAllowed({ developerFeaturesEnabled: DEVELOPER_FEATURES_ENABLED === true });
}

/**
 * ROUTE KAPISI (fail-closed): drawer 'caros-lab' olsa bile kapı kapalıysa
 * ekran RENDER EDİLMEZ. DrawerPanel bu fonksiyonu kullanır → doğrudan
 * `openDrawer('caros-lab')` çağrısı da engellenir.
 */
export function shouldRenderCarosLab(drawer: string, allowed: boolean): boolean {
  return drawer === 'caros-lab' && allowed === true;
}
