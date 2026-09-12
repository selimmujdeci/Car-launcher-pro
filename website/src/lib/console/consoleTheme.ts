/**
 * KONSOL TEMASI — gece/gündüz (#662).
 *
 * Kapsam bilinçli DAR: konsolun kendi teması, sitenin `caros-theme`
 * tercihinden AYRIDIR. Pazarlama sayfaları koyu kimliğini korurken filo
 * yöneticisi konsolu güneş altında açık temaya alabilmelidir; iki tercihi tek
 * anahtara bağlamak, birini değiştirenin ötekini sessizce bozmasına yol açar.
 *
 * Okuma/yazma TEK yerdedir (ikinci otorite kurulmaz).
 */

export type ConsoleTheme = 'night' | 'day';

export const CONSOLE_THEME_KEY = 'caros-console-theme';
export const CONSOLE_THEME_ATTR = 'data-console';
export const DEFAULT_CONSOLE_THEME: ConsoleTheme = 'night';

/** Bilinmeyen/bozuk değer varsayılana düşer — asla `undefined` sızmaz. */
export function normalizeTheme(raw: unknown): ConsoleTheme {
  return raw === 'day' || raw === 'night' ? raw : DEFAULT_CONSOLE_THEME;
}

export function readStoredTheme(): ConsoleTheme {
  if (typeof window === 'undefined') return DEFAULT_CONSOLE_THEME;
  try {
    return normalizeTheme(window.localStorage.getItem(CONSOLE_THEME_KEY));
  } catch {
    return DEFAULT_CONSOLE_THEME;
  }
}

/** Yazma başarısız olabilir (özel mod / kota) — sessizce yutulur, UI çalışır. */
export function storeTheme(theme: ConsoleTheme): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CONSOLE_THEME_KEY, theme);
  } catch {
    /* fail-soft: tercih kalıcı olmaz ama oturum içinde çalışır */
  }
}

export function toggleTheme(theme: ConsoleTheme): ConsoleTheme {
  return theme === 'night' ? 'day' : 'night';
}

export function themeLabel(theme: ConsoleTheme): string {
  return theme === 'night' ? 'Gece' : 'Gündüz';
}

/**
 * İlk boyamadan ÖNCE koşan senkron script.
 *
 * Neden gerekli: React ilk render'da `localStorage`ı okuyamaz (SSR); tema
 * effect'te uygulanırsa kullanıcı bir kare boyunca YANLIŞ temayı görür
 * (gündüz tercih edilmişken siyah flaş). Bu script attribute'u DOM hazır
 * olmadan basar.
 */
export const CONSOLE_THEME_BOOT_SCRIPT =
  `(function(){try{var t=localStorage.getItem('${CONSOLE_THEME_KEY}');` +
  `if(t!=='day'&&t!=='night'){t='${DEFAULT_CONSOLE_THEME}';}` +
  `document.documentElement.setAttribute('${CONSOLE_THEME_ATTR}',t);}` +
  `catch(e){document.documentElement.setAttribute('${CONSOLE_THEME_ATTR}','${DEFAULT_CONSOLE_THEME}');}})();`;
