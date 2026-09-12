'use client';

/**
 * GECE / GÜNDÜZ ANAHTARI (#662).
 *
 * Attribute `<html>` üzerine yazılır (boot script'in bastığı yerin AYNISI) —
 * ikinci bir kök seçilirse ilk boyamadaki tema ile React'in uyguladığı tema
 * ayrışır ve kullanıcı bir kare yanlış temayı görür.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  CONSOLE_THEME_ATTR,
  readStoredTheme,
  storeTheme,
  themeLabel,
  toggleTheme,
  type ConsoleTheme,
} from '@/lib/console/consoleTheme';

export default function ConsoleThemeToggle() {
  const [theme, setTheme] = useState<ConsoleTheme>('night');

  /* İlk render SSR'da çalıştığı için depo burada okunur; boot script zaten
     DOM'a doğru temayı basmıştır, bu yalnız React durumunu SENKRONLAR. */
  useEffect(() => { setTheme(readStoredTheme()); }, []);

  const flip = useCallback(() => {
    setTheme((current) => {
      const next = toggleTheme(current);
      storeTheme(next);
      if (typeof document !== 'undefined') {
        document.documentElement.setAttribute(CONSOLE_THEME_ATTR, next);
      }
      return next;
    });
  }, []);

  return (
    <button
      onClick={flip}
      title={`${themeLabel(theme)} tema — değiştirmek için tıkla`}
      aria-label={`Tema: ${themeLabel(theme)}. Değiştir.`}
      className="cn-bezel flex items-center gap-2 px-2.5 h-9 hover:bg-panel transition-colors"
    >
      {theme === 'night' ? (
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path d="M13.5 9.5A6 6 0 0 1 6.5 2.5a6 6 0 1 0 7 7z"
            stroke="var(--cn-copper)" strokeWidth="1.3" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
          <circle cx="8" cy="8" r="3.1" stroke="var(--cn-copper)" strokeWidth="1.3" />
          <path d="M8 1v1.8M8 13.2V15M1 8h1.8M13.2 8H15M3 3l1.3 1.3M11.7 11.7L13 13M13 3l-1.3 1.3M4.3 11.7L3 13"
            stroke="var(--cn-copper)" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      )}
      <span className="cn-num text-[10px] tracking-[0.16em] uppercase text-t2">
        {themeLabel(theme)}
      </span>
    </button>
  );
}
