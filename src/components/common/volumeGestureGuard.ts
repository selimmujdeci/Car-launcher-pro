/** Kenar ses jesti ile kaydırma çakışması koruması (VolumeGestureLayer). */
/**
 * Dokunuş GERÇEKTEN kaydırılabilen bir alanın içinde mi başladı?
 * SAHA 2026-09-23 (telefon): müzik paneli sol kenardan kaydırılırken bu jest
 * sesi 0'a indiriyordu (YouTube sessiz çalıyordu). Kaydırılabilir alanda dikey
 * hareket KAYDIRMADIR; kenar ses jesti yalnız kaydırılamayan yüzeyde çalışır.
 */
export function startsInScrollable(target: EventTarget | null): boolean {
  let el = target instanceof Element ? target : null;
  while (el && el !== document.body && el !== document.documentElement) {
    const oy = getComputedStyle(el).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 1) return true;
    el = el.parentElement;
  }
  return false;
}
