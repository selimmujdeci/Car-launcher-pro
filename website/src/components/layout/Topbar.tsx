'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { useVehicleStore } from '@/store/vehicleStore';
import { useNotificationStore } from '@/store/notificationStore';
import { PushNotificationWidget } from '@/components/dashboard/PushNotificationWidget';
import { useRouter } from 'next/navigation';

const pageTitles: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/dashboard/vehicles': 'Araçlarım',
  '/dashboard/map': 'Harita',
  '/dashboard/notifications': 'Bildirimler',
  '/dashboard/diagnostic': 'Diagnostic',
  '/dashboard/settings': 'Ayarlar',
};

export default function Topbar() {
  const pathname = usePathname();
  const router = useRouter();
  const title = pageTitles[pathname] ?? 'Panel';
  const onlineCount = useVehicleStore((s) => s.getList().filter((v) => v.status !== 'offline').length);
  const connectionStatus = useVehicleStore((s) => s.connectionStatus);
  const unreadCount = useNotificationStore((s) => s.unreadCount());

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  };

  return (
    <header className="h-16 flex-shrink-0 flex items-center justify-between px-6 border-b border-white/[0.06] bg-[#070e1c]/80 backdrop-blur-sm">
      {/* Title */}
      <div>
        <h1 className="text-sm font-semibold text-white">{title}</h1>
        <p className="text-[11px] text-white/30 mt-0.5">Car Launcher Pro — Yönetim Paneli</p>
      </div>

      {/* Right side */}
      <div className="flex items-center gap-2">
        {/* Push notification widget */}
        <PushNotificationWidget />

        {/* Connection status pill */}
        <div className={`hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full transition-colors ${
          connectionStatus === 'connected'
            ? 'bg-emerald-500/[0.08] border border-emerald-500/20'
            : connectionStatus === 'connecting'
            ? 'bg-amber-500/[0.08] border border-amber-500/20'
            : 'bg-red-500/[0.08] border border-red-500/20'
        }`}>
          <span className={`w-1.5 h-1.5 rounded-full ${
            connectionStatus === 'connected'
              ? 'bg-emerald-400 animate-pulse'
              : connectionStatus === 'connecting'
              ? 'bg-amber-400 animate-pulse'
              : 'bg-red-400'
          }`} />
          <span className={`text-[11px] font-medium ${
            connectionStatus === 'connected' ? 'text-emerald-400'
            : connectionStatus === 'connecting' ? 'text-amber-400'
            : 'text-red-400'
          }`}>
            {connectionStatus === 'connected'
              ? `${onlineCount} araç aktif`
              : connectionStatus === 'connecting'
              ? 'Bağlanıyor…'
              : 'Bağlantı kopuk'}
          </span>
        </div>

        {/* Notifications */}
        <Link
          href="/dashboard/notifications"
          className="relative w-9 h-9 rounded-xl bg-white/[0.04] border border-white/[0.07] flex items-center justify-center text-white/50 hover:text-white hover:bg-white/[0.07] transition-all"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M8 1.5a4.5 4.5 0 014.5 4.5v2.5l1.25 1.75H2.25L3.5 8.5V6A4.5 4.5 0 018 1.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
            <path d="M6.5 12.5a1.5 1.5 0 003 0" stroke="currentColor" strokeWidth="1.3"/>
          </svg>
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-[9px] text-white font-bold flex items-center justify-center">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </Link>

        {/* Avatar + logout */}
        <button
          onClick={handleLogout}
          title="Çıkış Yap"
          className="w-9 h-9 rounded-xl bg-accent/20 border border-accent/30 flex items-center justify-center text-xs font-semibold text-accent cursor-pointer hover:bg-red-500/20 hover:border-red-500/30 hover:text-red-400 transition-colors"
        >
          A
        </button>
      </div>
    </header>
  );
}
