/**
 * drawerBus.ts — Drawer açmak için global event bus.
 * Prop drilling olmadan herhangi bir bileşenden openDrawer() çağrılabilir.
 * MainLayout mount olduğunda registerDrawerHandler ile handler kaydeder.
 */
import type { DrawerType } from '../components/layout/DockBar';
import { pushTrail } from './diagnosticTrail';

let _handler: ((d: DrawerType) => void) | null = null;

export function registerDrawerHandler(fn: (d: DrawerType) => void): void {
  _handler = fn;
}

export function unregisterDrawerHandler(): void {
  _handler = null;
}

export function openDrawer(d: DrawerType): void {
  // Tanı olay izi — ekran/çekmece geçişi ("soruna ne yol açtı" hikâyesi).
  try { pushTrail('screen', d === 'none' ? 'çekmece kapandı' : `ekran: ${d}`); } catch { /* fail-soft */ }
  _handler?.(d);
}
