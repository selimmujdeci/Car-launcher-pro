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

/**
 * OKLCH → sRGB `rgb()/rgba()` dizgisi. `oklch()` Chrome 111+; K24 WebView'ı
 * Chrome 101 → inline stilde `oklch(...)` içeren bildirim SESSİZCE düşer (renk,
 * degrade, çerçeve kaybolur). .css dosyaları derlemede düşürülür; bu yardımcı
 * yalnız çalışma zamanında üretilen (dinamik ton) inline renkler içindir.
 * `l` 0–1 (yüzde değil), `c` kroma, `h` derece, `a` 0–1.
 */
export function oklchRgb(l: number, c: number, h: number, a = 1): string {
  const hr = (h * Math.PI) / 180;
  const A = c * Math.cos(hr), B = c * Math.sin(hr);
  const l_ = l + 0.3963377774 * A + 0.2158037573 * B;
  const m_ = l - 0.1055613458 * A - 0.0638541728 * B;
  const s_ = l - 0.0894841775 * A - 1.2914855480 * B;
  const L = l_ ** 3, M = m_ ** 3, S = s_ ** 3;
  const lin = [
    4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
    -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
    -0.0041960863 * L - 0.7034186147 * M + 1.7076147010 * S,
  ];
  const [r, g, b] = lin.map((x) => {
    const v = x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
    return Math.round(Math.min(1, Math.max(0, v)) * 255);
  });
  return a >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${+a.toFixed(3)})`;
}
