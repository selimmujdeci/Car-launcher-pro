/**
 * carosLabEntry.ts — CAROS LAB'ı açmanın TEK giriş noktası (fail-closed).
 *
 * Yeni router YOK: mevcut `drawerBus` üzerinden 'caros-lab' çekmecesi açılır.
 * Kapı kapalıysa `openDrawer` HİÇ çağrılmaz (doğrudan route erişimi de engellenir;
 * ikinci savunma hattı DrawerPanel'deki `shouldRenderCarosLab`'dır).
 *
 * ── 2026-07-26: ROL BAĞIMLILIĞI KALDIRILDI ─────────────────────────────────
 * Kapı artık yalnız derleme-zamanı kararına bakar (`DEVELOPER_FEATURES_ENABLED`),
 * bu yüzden `useRoleStore` importu ve `canDebug` enjeksiyonu KALDIRILDI —
 * kullanılmayan bir parametreyi taşımak "hâlâ rol kontrol ediliyor" yanılsaması
 * yaratırdı. Rol sistemi ve `canDebug` izni yerinde duruyor; yalnız GÖRÜNÜRLÜK
 * kararı ondan ayrıldı.
 *
 * KASITLI: `screenRegistry`'ye EKLENMEZ — sesli asistan CAROS LAB'ı açamaz
 * ('super-admin' ile aynı gerekçe: korumalı geliştirici yüzeyi).
 */

import { openDrawer } from '../drawerBus';
import { isCarosLabAllowedFromEnv } from './carosLabGate';
import type { DrawerType } from '../../components/layout/DockBar';

export const CAROS_LAB_DRAWER = 'caros-lab' as const;

export interface CarosLabEntryDeps {
  /** Çekmece açıcı (test için enjekte edilebilir). */
  readonly open?: (drawer: string) => void;
  /**
   * Kapı geçersiz kılma — YALNIZ TEST İÇİN. Verilmezse gerçek derleme kararı
   * kullanılır. Üretim kodundan geçilmez.
   */
  readonly allowed?: () => boolean;
}

/**
 * CAROS LAB'ı açar. @returns açıldı mı — kapı kapalıysa false (ve hiçbir yan etki yok).
 */
export function openCarosLab(deps: CarosLabEntryDeps = {}): boolean {
  const allowed = typeof deps.allowed === 'function'
    ? deps.allowed() === true
    : isCarosLabAllowedFromEnv();
  if (!allowed) return false;
  const open = typeof deps.open === 'function' ? deps.open : (d: string) => openDrawer(d as DrawerType);
  open(CAROS_LAB_DRAWER);
  return true;
}
