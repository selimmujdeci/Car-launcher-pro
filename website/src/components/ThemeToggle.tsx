'use client';

import { useEffect, useState } from 'react';

type Theme = 'light' | 'dark';

/**
 * Tema geçiş düğmesi — güneş/ay. Tercihi localStorage'a yazar, ilk yüklemede
 * no-flash script (layout <head>) tarafından uygulanır. Geçiş yalnız tıklama
 * anında `theme-switching` sınıfıyla animasyonlanır (ambient animasyon yok).
 */
export default function ThemeToggle({ className = '' }: { className?: string }) {
  const [theme, setTheme] = useState<Theme>('dark');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const current = (document.documentElement.getAttribute('data-theme') as Theme) || 'dark';
    setTheme(current);
    setMounted(true);
  }, []);

  const toggle = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    const root = document.documentElement;
    root.classList.add('theme-switching');
    root.setAttribute('data-theme', next);
    // Tarayıcı/PWA sistem çubuğunu tema ile senkron tut.
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', next === 'light' ? '#f6f8fb' : '#060d1a');
    try {
      localStorage.setItem('caros-theme', next);
    } catch {
      /* storage engellenebilir — sessiz geç */
    }
    setTheme(next);
    window.setTimeout(() => root.classList.remove('theme-switching'), 450);
  };

  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? 'Aydınlık temaya geç' : 'Karanlık temaya geç'}
      title={isDark ? 'Aydınlık tema' : 'Karanlık tema'}
      className={`relative inline-flex h-9 w-9 items-center justify-center rounded-lg border border-line text-ink-3 hover:text-ink hover:bg-surface-2 transition-colors ${className}`}
    >
      {/* mounted olmadan ikon sabitlenir → hydration uyumsuzluğu yok */}
      <span className="relative block h-[18px] w-[18px]" suppressHydrationWarning>
        {/* Güneş */}
        <svg
          width="18" height="18" viewBox="0 0 18 18" fill="none"
          className={`absolute inset-0 transition-all duration-300 ${
            mounted && !isDark ? 'opacity-100 rotate-0 scale-100' : 'opacity-0 -rotate-90 scale-50'
          }`}
        >
          <circle cx="9" cy="9" r="3.4" stroke="currentColor" strokeWidth="1.5" />
          <path
            d="M9 1.5v2M9 14.5v2M1.5 9h2M14.5 9h2M3.7 3.7l1.4 1.4M12.9 12.9l1.4 1.4M14.3 3.7l-1.4 1.4M5.1 12.9l-1.4 1.4"
            stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
          />
        </svg>
        {/* Ay */}
        <svg
          width="18" height="18" viewBox="0 0 18 18" fill="none"
          className={`absolute inset-0 transition-all duration-300 ${
            !mounted || isDark ? 'opacity-100 rotate-0 scale-100' : 'opacity-0 rotate-90 scale-50'
          }`}
        >
          <path
            d="M15 10.3A6.2 6.2 0 017.7 3a6.3 6.3 0 103 12 6.2 6.2 0 004.3-4.7z"
            stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"
          />
        </svg>
      </span>
    </button>
  );
}
