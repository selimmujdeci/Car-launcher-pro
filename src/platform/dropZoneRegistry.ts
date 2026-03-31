/**
 * Drop zone kayıt servisi — dock → ana ekran sürükleme için.
 * PinnedShortcuts bileşeni mount sırasında elementini kaydeder.
 * MainLayout pointer handler'ı hit test için bu servisi kullanır.
 */

let _dropZoneEl: HTMLElement | null = null;

export function registerDropZone(el: HTMLElement | null): void {
  _dropZoneEl = el;
}

export function isOverDropZone(x: number, y: number): boolean {
  if (!_dropZoneEl) return false;
  const r = _dropZoneEl.getBoundingClientRect();
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}
