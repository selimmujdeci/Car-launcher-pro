/**
 * themePreviewBridge — Tema Stüdyo iframe CANLI önizleme köprüsü.
 *
 * carospro.com'daki Tema Stüdyo bu uygulamayı bir iframe'e gömer; kullanıcı renk/
 * şekil/font değiştirdikçe postMessage ile tema CSS var'larını (+ opsiyonel ekran
 * düzeni intent'ini) yollar. Burada ANINDA uygulanır — bulut roundtrip yok.
 * commandListener'daki theme_change / layout_change ile AYNI davranış, yalnız
 * yerel ve gerçek-zamanlı (iframe önizlemesi için).
 *
 * Güvenlik: yalnız güvenilen origin'lerden dinler; yalnız `--` ile başlayan CSS
 * var'larını set eder (rastgele DOM/JS yok); fail-soft.
 */
import { useLayoutStore } from '../store/useLayoutStore';
import { useCarTheme, type CarTheme } from '../store/useCarTheme';

const TRUSTED = [
  /^https:\/\/carospro\.com$/,
  /^https:\/\/[a-z0-9-]+\.vercel\.app$/,
  /^http:\/\/localhost(:\d+)?$/,
  /^http:\/\/127\.0\.0\.1(:\d+)?$/,
];

let installed = false;

export function initThemePreviewBridge(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  window.addEventListener('message', (e: MessageEvent) => {
    if (!TRUSTED.some((re) => re.test(e.origin))) return;
    const data = e.data as { type?: string; vars?: Record<string, unknown>; layout?: unknown } | null;
    if (!data || data.type !== 'caros-theme-preview') return;
    try {
      const root = document.documentElement;
      const vars = data.vars;
      if (vars && typeof vars === 'object') {
        // Baz tema → gerçek kanal: useCarTheme.setTheme (React layout'u yeniden
        // seçer + data-theme uygular). Salt data-theme setAttribute layout'u
        // değiştirmez (store'dan okunur) — bu yüzden store'a yazıyoruz.
        const base = (vars as Record<string, unknown>).__baseTheme;
        if (typeof base === 'string') {
          try { useCarTheme.getState().setTheme(base as CarTheme); } catch { /* fail-soft */ }
        }
        // İnce token'lar (accent/bg/radius/font…) — CSS var'larını da uygula
        // (bazı bileşenler var kullanır; layout'lar sabit palet → kısmi yansır).
        for (const [k, v] of Object.entries(vars)) {
          if (k.startsWith('--')) root.style.setProperty(k, String(v));
        }
      }
      if (data.layout) {
        try { useLayoutStore.getState().applyIntent(data.layout); } catch { /* fail-soft */ }
      }
    } catch { /* fail-soft */ }
  });

  // Parent'a (PWA) hazır olduğumuzu bildir → ilk temayı yollasın (yalnız iframe içinde).
  try {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: 'caros-preview-ready' }, '*');
    }
  } catch { /* ignore */ }
}
