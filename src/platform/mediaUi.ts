/**
 * mediaUi.ts — Müzik drawer'ını açmak için global event bus.
 *
 * Prop drilling olmadan herhangi bir bileşenden openMusicDrawer() çağrılabilir.
 * MainLayout mount olduğunda registerMusicDrawerHandler ile handler kaydeder.
 */

let _handler: (() => void) | null = null;

export function registerMusicDrawerHandler(fn: () => void): void {
  _handler = fn;
}

export function unregisterMusicDrawerHandler(): void {
  _handler = null;
}

/** Müzik drawer'ını aç — herhangi bir bileşenden çağrılabilir */
export function openMusicDrawer(): void {
  _handler?.();
}
