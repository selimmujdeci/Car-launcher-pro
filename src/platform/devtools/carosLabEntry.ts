/**
 * carosLabEntry.ts — CAROS LAB'ı açmanın TEK giriş noktası (fail-closed).
 *
 * Yeni router YOK: mevcut `drawerBus` üzerinden 'caros-lab' çekmecesi açılır.
 * Kapı kapalıysa `openDrawer` HİÇ çağrılmaz (görev §C: doğrudan route erişimi de
 * engellenir; ikinci savunma hattı DrawerPanel'deki shouldRenderCarosLab'dır).
 *
 * KASITLI: `screenRegistry`'ye EKLENMEZ — sesli asistan CAROS LAB'ı açamaz
 * ('super-admin' ile aynı gerekçe: yetki-korumalı yüzey).
 */

import { openDrawer } from '../drawerBus';
import { useRoleStore } from '../roleSystem/RoleStore';
import { isCarosLabAllowedFromEnv } from './carosLabGate';
import type { DrawerType } from '../../components/layout/DockBar';

export const CAROS_LAB_DRAWER = 'caros-lab' as const;

export interface CarosLabEntryDeps {
  /** Rol izni okuyucu (test için enjekte edilebilir). */
  readonly canDebug?: () => boolean;
  /** Çekmece açıcı (test için enjekte edilebilir). */
  readonly open?: (drawer: string) => void;
}

function _defaultCanDebug(): boolean {
  try { return useRoleStore.getState().can('canDebug') === true; } catch { return false; }
}

/**
 * CAROS LAB'ı açar. @returns açıldı mı — kapı kapalıysa false (ve hiçbir yan etki yok).
 */
export function openCarosLab(deps: CarosLabEntryDeps = {}): boolean {
  const canDebug = typeof deps.canDebug === 'function' ? deps.canDebug() : _defaultCanDebug();
  if (!isCarosLabAllowedFromEnv(canDebug === true)) return false;
  const open = typeof deps.open === 'function' ? deps.open : (d: string) => openDrawer(d as DrawerType);
  open(CAROS_LAB_DRAWER);
  return true;
}
