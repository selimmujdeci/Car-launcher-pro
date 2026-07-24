/**
 * carosLabGate.ts — CAROS LAB geliştirici erişim kapısı (FAIL-CLOSED · saf).
 *
 * PARALEL AUTH YOK (görev §C): mevcut iki mekanizma AND'lenir —
 *  1) derleme-zamanı bayrağı `DEBUG_ENABLED` (import.meta.env.DEV veya
 *     VITE_ENABLE_DEBUG_PANEL=true) — satış build'inde kapalıdır,
 *  2) rol sistemi izni `canDebug` (technician / admin / super_admin).
 *
 * Bu, App.tsx'teki mevcut DebugPanel kapısının (DEBUG_ENABLED && canDebug) aynısıdır —
 * yeni bir entitlement sistemi KURULMAZ.
 *
 * FAIL-CLOSED: girdi boolean değilse (undefined/null/bozuk) erişim REDDEDİLİR.
 */

import { DEBUG_ENABLED } from '../debug';

export interface CarosLabGateInput {
  /** Derleme-zamanı geliştirici bayrağı. */
  readonly debugEnabled: boolean;
  /** Rol sistemi 'canDebug' izni. */
  readonly canDebug: boolean;
}

export type CarosLabGateReason = 'ok' | 'build-flag-off' | 'no-permission';

/** Erişime izin var mı? Her iki koşul da GERÇEK boolean true olmalı. */
export function isCarosLabAllowed(input: CarosLabGateInput | null | undefined): boolean {
  if (!input) return false;
  return input.debugEnabled === true && input.canDebug === true;
}

/** Reddin nedeni (teşhis/UI metni). Bayrak kapalıysa o önceliklidir. */
export function carosLabGateReason(input: CarosLabGateInput | null | undefined): CarosLabGateReason {
  if (!input || input.debugEnabled !== true) return 'build-flag-off';
  if (input.canDebug !== true) return 'no-permission';
  return 'ok';
}

/** Derleme bayrağını ortamdan alan kısayol (React tarafı yalnız izni geçirir). */
export function isCarosLabAllowedFromEnv(canDebug: boolean): boolean {
  return isCarosLabAllowed({ debugEnabled: DEBUG_ENABLED === true, canDebug: canDebug === true });
}

/**
 * ROUTE KAPISI (fail-closed): drawer 'caros-lab' olsa bile kapı kapalıysa
 * ekran RENDER EDİLMEZ. DrawerPanel bu fonksiyonu kullanır → doğrudan
 * `openDrawer('caros-lab')` çağrısı da engellenir.
 */
export function shouldRenderCarosLab(drawer: string, allowed: boolean): boolean {
  return drawer === 'caros-lab' && allowed === true;
}
