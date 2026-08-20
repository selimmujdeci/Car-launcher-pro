'use client';

/**
 * KANIT KONSOLU — filo panelinin kabuğu (#662).
 *
 * Konsol, dashboard kabuğunun İÇİNDE tam alanı kaplar: üstteki `p-4/lg:p-6`
 * dolgusu negatif kenar boşluğuyla iptal edilir, böylece enstrüman paneli
 * kenardan kenara oturur (kart içinde kart görüntüsü olmaz).
 *
 * Tema: `data-console` attribute'u `<html>` üzerine yazılır — boot script'in
 * bastığı yerin AYNISI (iki ayrı kök seçilirse ilk kare yanlış temada boyanır).
 */

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import ConsoleThemeToggle from '@/components/console/ConsoleThemeToggle';
import { CONSOLE_THEME_ATTR, readStoredTheme } from '@/lib/console/consoleTheme';

const TABS: Array<{ href: string; label: string }> = [
  { href: '/dashboard/fleet',          label: 'Genel Bakış' },
  { href: '/dashboard/fleet/vehicles', label: 'Araçlar' },
  { href: '/dashboard/fleet/records',  label: 'Kayıtlar' },
  { href: '/dashboard/fleet/alerts',   label: 'Uyarılar' },
  { href: '/dashboard/fleet/reports',  label: 'Raporlar' },
  { href: '/dashboard/fleet/manage',   label: 'Yönetim' },
  { href: '/dashboard/fleet/settings', label: 'Ayarlar' },
  { href: '/dashboard/fleet/lab',      label: 'LAB' },
];

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  /* Tema attribute'u konsol açıkken garanti altına alınır: kullanıcı doğrudan
     bu rotaya girdiyse boot script zaten basmıştır, ama istemci tarafı
     gezinmede (`/dashboard` → `/dashboard/fleet`) attribute hiç yazılmamış
     olabilir; o durumda tokenlar çözümlenmez ve ekran renksiz kalır. */
  useEffect(() => {
    const root = document.documentElement;
    if (!root.getAttribute(CONSOLE_THEME_ATTR)) {
      root.setAttribute(CONSOLE_THEME_ATTR, readStoredTheme());
    }
  }, []);

  const isActive = (href: string) =>
    href === '/dashboard/fleet' ? pathname === href : pathname.startsWith(href);

  return (
    <div
      data-console-root
      className="-m-4 lg:-m-6 min-h-full flex flex-col"
      style={{ background: 'var(--cn-bg-void)', color: 'var(--cn-text-1)' }}
    >
      {/* Konsol başlığı */}
      <header
        className="flex items-center justify-between gap-3 px-4 lg:px-6 h-14 border-b"
        style={{ borderColor: 'var(--cn-line)', background: 'var(--cn-bg-panel)' }}
      >
        <div className="flex items-baseline gap-3 min-w-0">
          <span className="cn-display text-[15px] tracking-tight" style={{ color: 'var(--cn-text-1)' }}>
            Kanıt Konsolu
          </span>
          <span className="cn-eyebrow hidden sm:inline">FİLO / EVIDENCE CONSOLE</span>
        </div>
        <ConsoleThemeToggle />
      </header>

      {/* Sekmeler — mobilde yatay kaydırılır */}
      <nav
        className="flex items-stretch gap-0 overflow-x-auto border-b flex-shrink-0"
        style={{ borderColor: 'var(--cn-line)', background: 'var(--cn-bg-panel)' }}
        aria-label="Konsol bölümleri"
      >
        {TABS.map(({ href, label }) => {
          const active = isActive(href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              className="cn-num text-[10px] uppercase tracking-[0.16em] px-4 h-10 flex items-center whitespace-nowrap transition-colors"
              style={{
                color: active ? 'var(--cn-copper)' : 'var(--cn-text-2)',
                borderBottom: `2px solid ${active ? 'var(--cn-copper)' : 'transparent'}`,
                background: active ? 'var(--cn-copper-bg)' : 'transparent',
              }}
            >
              {label}
            </Link>
          );
        })}
      </nav>

      <main className="flex-1 min-h-0 p-3 sm:p-4 lg:p-6">{children}</main>
    </div>
  );
}
