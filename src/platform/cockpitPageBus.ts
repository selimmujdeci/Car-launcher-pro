/**
 * cockpitPageBus.ts — Kokpit sayfasını (yolculuk bilgisayarı · OBD canlı ·
 * göstergeler) sesle açmak için global veri yolu.
 *
 * `drawerBus` / `mapViewBus` deseninin BİREBİR aynısı; ikinci bir mekanizma
 * kurulmaz. Sayfa durumunun TEK sahibi `CockpitPager`dır; burası yalnız isteği
 * iletir. Sahip güvenlik kapısını (geri vites · tiyatro · uyku) KENDİSİ uygular
 * ve reddederse `false` döner — çağıran "açtım" demez.
 */

export type CockpitPageTarget = 'trip' | 'obd' | 'cockpit' | 'home';

let _handler: ((page: CockpitPageTarget) => boolean) | null = null;

export function registerCockpitPageHandler(fn: (page: CockpitPageTarget) => boolean): void {
  _handler = fn;
}

export function unregisterCockpitPageHandler(): void {
  _handler = null;
}

/** Kokpit sayfasını iste. Sahip yoksa ya da güvenlik reddettiyse `false`. */
export function requestCockpitPage(page: CockpitPageTarget): boolean {
  try { return _handler?.(page) ?? false; } catch { return false; }
}
