'use client';

/**
 * FİLO BÖLÜMÜ KABUĞU — sekme şeridi (#662, #663'te sadeleşti).
 *
 * #663'te dashboard kabuğunun TAMAMI konsol diline geçtiği için buradaki
 * negatif kenar boşluğu hilesi ve ikinci başlık çubuğu KALDIRILDI: tema
 * anahtarı artık Topbar'da, zemin de kökte. Geriye yalnız filo sekmeleri
 * kaldı — iki ayrı başlık çubuğu kullanıcıya aynı bilgiyi iki kez gösteriyordu.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';

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

  const isActive = (href: string) =>
    href === '/dashboard/fleet' ? pathname === href : pathname.startsWith(href);

  return (
    <div className="-mx-4 lg:-mx-6 -mt-4 lg:-mt-6 flex flex-col">
      {/* Sekmeler — mobilde yatay kaydırılır */}
      <nav
        className="flex items-stretch gap-0 overflow-x-auto border-b flex-shrink-0 sticky top-0 z-10"
        style={{ borderColor: 'var(--cn-line)', background: 'var(--cn-bg-panel)' }}
        aria-label="Filo bölümleri"
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

      <div className="p-3 sm:p-4 lg:p-6">{children}</div>
    </div>
  );
}
