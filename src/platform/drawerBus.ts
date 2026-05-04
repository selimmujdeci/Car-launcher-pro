/**
 * drawerBus.ts — Drawer açmak için global event bus.
 * Prop drilling olmadan herhangi bir bileşenden openDrawer() çağrılabilir.
 * MainLayout mount olduğunda registerDrawerHandler ile handler kaydeder.
 */
import type { DrawerType } from '../components/layout/DockBar';

let _handler: ((d: DrawerType) => void) | null = null;

export function registerDrawerHandler(fn: (d: DrawerType) => void): void {
  _handler = fn;
}

export function openDrawer(d: DrawerType): void {
  _handler?.(d);
}
