'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useNotificationStore } from '@/store/notificationStore';

const navItems = [
  {
    href: '/dashboard',
    label: 'Dashboard',
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <rect x="2" y="2" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
        <rect x="10" y="2" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
        <rect x="2" y="10" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
        <rect x="10" y="10" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
      </svg>
    ),
  },
  {
    href: '/dashboard/vehicles',
    label: 'Araçlarım',
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <path d="M3 11V8.5L5.5 4h7L15 8.5V11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M2 11h14v3a1 1 0 01-1 1H3a1 1 0 01-1-1v-3z" stroke="currentColor" strokeWidth="1.4"/>
        <circle cx="5.5" cy="11" r="1.5" stroke="currentColor" strokeWidth="1.4"/>
        <circle cx="12.5" cy="11" r="1.5" stroke="currentColor" strokeWidth="1.4"/>
      </svg>
    ),
  },
  {
    href: '/dashboard/map',
    label: 'Harita',
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <path d="M9 2C6.239 2 4 4.239 4 7c0 3.75 5 9 5 9s5-5.25 5-9c0-2.761-2.239-5-5-5z" stroke="currentColor" strokeWidth="1.4"/>
        <circle cx="9" cy="7" r="1.75" stroke="currentColor" strokeWidth="1.4"/>
      </svg>
    ),
  },
  {
    href: '/dashboard/notifications',
    label: 'Bildirimler',
    badge: true,
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <path d="M9 2a5 5 0 015 5v3l1.5 2H2.5L4 10V7a5 5 0 015-5z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
        <path d="M7 14a2 2 0 004 0" stroke="currentColor" strokeWidth="1.4"/>
      </svg>
    ),
  },
  {
    href: '/dashboard/diagnostic',
    label: 'Diagnostic',
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <rect x="2" y="4" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.4"/>
        <path d="M5 9l2.5 2.5L10 7l2.5 2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
  },
  {
    href: '/dashboard/settings',
    label: 'Ayarlar',
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <circle cx="9" cy="9" r="2.5" stroke="currentColor" strokeWidth="1.4"/>
        <path d="M9 2v1.5M9 14.5V16M2 9h1.5M14.5 9H16M3.757 3.757l1.06 1.06M13.182 13.182l1.061 1.061M3.757 14.243l1.06-1.06M13.182 4.818l1.061-1.061" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
      </svg>
    ),
  },
];

interface SidebarProps {
  onClose?: () => void;
}

export default function Sidebar({ onClose }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const unreadCount = useNotificationStore((s) => s.unreadCount());

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  };

  const isActive = (href: string) =>
    href === '/dashboard' ? pathname === '/dashboard' : pathname.startsWith(href);

  return (
    <aside className="w-60 flex-shrink-0 h-full bg-[#070e1c] border-r border-white/[0.06] flex flex-col">
      {/* Logo + mobile close button */}
      <div className="h-16 flex items-center px-5 border-b border-white/[0.06] flex-shrink-0">
        <div className="flex items-center gap-2.5 flex-1 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-accent/20 border border-accent/30 flex items-center justify-center flex-shrink-0">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M7 1C4.791 1 3 2.791 3 5c0 2.917 4 7 4 7s4-4.083 4-7c0-2.209-1.791-4-4-4z" stroke="#3b82f6" strokeWidth="1.3"/>
              <circle cx="7" cy="5" r="1.4" stroke="#3b82f6" strokeWidth="1.3"/>
            </svg>
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-white leading-none">Caros</p>
            <p className="text-[10px] text-accent leading-none mt-0.5">Pro Panel</p>
          </div>
        </div>

        {/* Close button — mobile drawer only */}
        {onClose && (
          <button
            onClick={onClose}
            className="lg:hidden w-8 h-8 rounded-lg bg-white/[0.04] border border-white/[0.07] flex items-center justify-center text-white/40 hover:text-white hover:bg-white/[0.07] transition-all flex-shrink-0 ml-2"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 flex flex-col gap-0.5 overflow-y-auto">
        <p className="text-[9px] font-semibold tracking-widest text-white/20 uppercase px-2 mb-2">Menü</p>
        {navItems.map(({ href, label, icon, badge }) => {
          const active = isActive(href);
          return (
            <Link
              key={href}
              href={href}
              onClick={onClose}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 relative ${
                active
                  ? 'bg-accent/15 text-accent'
                  : 'text-white/45 hover:text-white/80 hover:bg-white/[0.04]'
              }`}
            >
              <span className="flex-shrink-0">{icon}</span>
              <span>{label}</span>
              {badge && !active && unreadCount > 0 && (
                <span className="ml-auto text-[10px] font-semibold bg-red-500/80 text-white rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center flex-shrink-0">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
              {active && (
                <span className="ml-auto w-1 h-4 rounded-full bg-accent flex-shrink-0" />
              )}
            </Link>
          );
        })}
      </nav>

      {/* User + Logout */}
      <div className="px-3 py-4 border-t border-white/[0.06] flex-shrink-0">
        <div className="flex items-center gap-3 px-2 mb-3">
          <div className="w-7 h-7 rounded-full bg-accent/25 border border-accent/30 flex items-center justify-center flex-shrink-0 text-xs font-semibold text-accent">
            A
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-white/80 truncate">Admin</p>
            <p className="text-[10px] text-white/30 truncate">Süper Admin</p>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm text-white/35 hover:text-red-400 hover:bg-red-500/[0.08] transition-all duration-150 min-h-[44px]"
        >
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
            <path d="M9 2H5a2 2 0 00-2 2v7a2 2 0 002 2h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            <path d="M11 10l2.5-2.5L11 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M13.5 7.5H7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
          </svg>
          Çıkış Yap
        </button>
      </div>
    </aside>
  );
}
