/**
 * cssCompat — eski WebView (Chrome 64–88 bandı) inline-style uyumluluğu.
 *
 * Vite `cssTarget` yalnızca .css dosyalarını transpile eder; React `style={{...}}`
 * inline stilleri runtime'da CSSOM'a yazılır ve tarayıcı desteklemediği değeri
 * SESSİZCE düşürür. Örnek saha arızası (Renault Duster head unit): clamp() içeren
 * grid-template-columns düşünce 3 kolonlu dashboard tek kolona çöküyor, harita
 * plakası 0px yüksekliğe inip hiç görünmüyordu.
 *
 * Bu modül desteği BİR KEZ ölçer (module-eval); layout'lar şablon dizgisini
 * buna göre seçer. CSS.supports Chrome 28+ — tüm hedef cihazlarda güvenli.
 */

function probe(prop: string, value: string): boolean {
  try {
    return typeof CSS !== 'undefined'
      && typeof CSS.supports === 'function'
      && CSS.supports(prop, value);
  } catch {
    return false;
  }
}

/** clamp()/min()/max() math fonksiyonları — Chrome 79+ */
export const SUPPORTS_CSS_CLAMP = probe('width', 'clamp(1px,2px,3px)');

/** aspect-ratio — Chrome 88+ */
export const SUPPORTS_ASPECT_RATIO = probe('aspect-ratio', '1');

/**
 * Kök viewport yüksekliği — dvh Chrome 108+. Eski WebView'de inline
 * `height:100dvh` düşünce kök div "auto" yüksekliğe iner, içerik ekrandan
 * taşar ve alt dock görünmez olur (Duster saha vakası). WebView'de adres
 * çubuğu olmadığından 100vh == 100dvh; fallback güvenli.
 */
export const VIEWPORT_H: string = probe('height', '100dvh') ? '100dvh' : '100vh';

/**
 * clamp(min,val,max) üretir; destek yoksa sabit fallback değeri döner.
 * Fallback, hedef head unit ekranları (1024×600 / 1280×720) için seçilmiş
 * güvenli orta değer olmalıdır.
 */
export function cssClamp(min: string, val: string, max: string, fallback: string): string {
  return SUPPORTS_CSS_CLAMP ? `clamp(${min}, ${val}, ${max})` : fallback;
}
