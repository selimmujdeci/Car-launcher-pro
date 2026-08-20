'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { useVehicleStore } from '@/store/vehicleStore';
import { useNotificationStore } from '@/store/notificationStore';
import { PushNotificationWidget } from '@/components/dashboard/PushNotificationWidget';
import ConsoleThemeToggle from '@/components/console/ConsoleThemeToggle';
import { useRouter } from 'next/navigation';
import { requestCanonicalLogout } from
  '@/security/accountCleanup/canonicalLogout';

const pageTitles: Record<string, string> = {
  '/dashboard': 'Panel',
  '/dashboard/vehicles': 'Araçlarım',
  '/dashboard/fleet': 'Filo',
  '/dashboard/map': 'Harita',
  '/dashboard/notifications': 'Bildirimler',
  '/dashboard/diagnostic': 'Tanı',
  '/dashboard/settings': 'Ayarlar',
};

const CONNECTION_COLOR: Record<string, string> = {
  connected:    'var(--cn-verified)',
  connecting:   'var(--cn-warning)',
  disconnected: 'var(--cn-critical)',
  error:        'var(--cn-critical)',
};

/** Alt rotalarda da başlık bulunur (`/dashboard/fleet/records` -> Filo). */
function titleFor(pathname: string): string {
  if (pageTitles[pathname]) return pageTitles[pathname];
  const hit = Object.keys(pageTitles)
    .filter((k) => k !== '/dashboard' && pathname.startsWith(k))
    .sort((a, b) => b.length - a.length)[0];
  return hit ? pageTitles[hit] : 'Panel';
}

interface TopbarProps {
  onMenuClick?: () => void;
}

export default function Topbar({ onMenuClick }: TopbarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const title = titleFor(pathname);
  const onlineCount = useVehicleStore((s) => s.getList().filter((v) => v.status !== 'offline').length);
  const connectionStatus = useVehicleStore((s) => s.connectionStatus);
  const unreadCount = useNotificationStore((s) => s.unreadCount());

  const handleLogout = async () => {
    const result = await requestCanonicalLogout();
    if (result.ok) router.push('/login');
  };

  return (
    <header
      className="h-14 lg:h-16 flex-shrink-0 flex items-center gap-3 px-4 lg:px-6 border-b border-hair"
      style={{ background: 'var(--cn-bg-panel)' }}
    >
      {/* Hamburger — mobile only */}
      <button
        onClick={onMenuClick}
        className="lg:hidden w-9 h-9 cn-bezel flex items-center justify-center text-t2 hover:text-t1 transition-colors flex-shrink-0"
        aria-label="Menüyü aç"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
        </svg>
      </button>

      {/* Title */}
      <div className="flex-1 min-w-0">
        <h1 className="cn-display text-[15px] text-t1 leading-none truncate">{title}</h1>
        <p className="cn-eyebrow mt-1 hidden sm:block">CAROS PRO · KANIT KONSOLU</p>
      </div>

      {/* Right side */}
      <div className="flex items-center gap-2">
        {/* Gece/Gündüz — konsolun tamamı için tek anahtar */}
        <ConsoleThemeToggle />

        {/* Push notification widget */}
        <PushNotificationWidget />

        {/* Connection status pill — sm+ only */}
        <div
          className="hidden sm:flex items-center gap-2 px-3 py-1.5"
          style={{
            borderRadius: 2,
            border: `1px solid ${CONNECTION_COLOR[connectionStatus] ?? 'var(--cn-unknown)'}`,
            background: 'var(--cn-bg-bezel)',
          }}
        >
          <span
            aria-hidden
            style={{
              width: 6,
              height: 6,
              background: CONNECTION_COLOR[connectionStatus] ?? 'var(--cn-unknown)',
            }}
          />
          <span
            className="cn-num text-[10px] uppercase tracking-[0.14em]"
            style={{ color: CONNECTION_COLOR[connectionStatus] ?? 'var(--cn-unknown)' }}
          >
            {connectionStatus === 'connected'
              ? `${onlineCount} ARAÇ`
              : connectionStatus === 'connecting'
              ? 'BAĞLANIYOR'
              : 'KOPUK'}
          </span>
        </div>

        {/* Notifications — hidden on mobile (in bottom nav) */}
        <Link
          href="/dashboard/notifications"
          className="hidden lg:flex relative w-9 h-9 cn-bezel items-center justify-center text-t2 hover:text-t1 transition-colors"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M8 1.5a4.5 4.5 0 014.5 4.5v2.5l1.25 1.75H2.25L3.5 8.5V6A4.5 4.5 0 018 1.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
            <path d="M6.5 12.5a1.5 1.5 0 003 0" stroke="currentColor" strokeWidth="1.3"/>
          </svg>
          {unreadCount > 0 && (
            <span
              className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 cn-num text-[9px] flex items-center justify-center"
              style={{ background: 'var(--cn-critical)', color: 'var(--cn-bg-void)', borderRadius: 2 }}
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </Link>

        {/* Avatar + logout */}
        <button
          onClick={handleLogout}
          title="Çıkış Yap"
          className="w-9 h-9 cn-num text-[11px] flex items-center justify-center cursor-pointer transition-colors"
          style={{
            background: 'var(--cn-copper-bg)',
            border: '1px solid var(--cn-copper)',
            color: 'var(--cn-copper)',
            borderRadius: 2,
          }}
        >
          A
        </button>
      </div>
    </header>
  );
}
