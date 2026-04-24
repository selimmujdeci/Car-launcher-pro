'use client';

import { useNotificationStore } from '@/store/notificationStore';
import { formatLastSeen } from '@/lib/utils';

const typeLabel: Record<string, string> = {
  speed: 'Hız',
  fuel: 'Yakıt',
  temp: 'Motor',
  geofence: 'Bölge',
};

const severityStyle = {
  critical: { bg: 'bg-red-500/[0.08]',    border: 'border-red-500/22',    dot: 'bg-red-400',    badge: 'bg-red-500/15 text-red-400 border-red-500/20'    },
  warning:  { bg: 'bg-amber-500/[0.07]',  border: 'border-amber-500/20',  dot: 'bg-amber-400',  badge: 'bg-amber-500/15 text-amber-400 border-amber-500/20'  },
  info:     { bg: 'bg-white/[0.03]',      border: 'border-white/[0.07]',  dot: 'bg-blue-400',   badge: 'bg-blue-500/10 text-blue-400 border-blue-500/20'   },
};

export default function NotificationsPage() {
  const { notifications, markRead, markAllRead, unreadCount } = useNotificationStore();
  const unread = unreadCount();

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-white/80">Bildirimler</h2>
          {unread > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-red-500/15 border border-red-500/25 text-[11px] text-red-400 font-semibold">
              {unread} okunmamış
            </span>
          )}
        </div>
        {unread > 0 && (
          <button
            onClick={markAllRead}
            className="text-xs text-accent/70 hover:text-accent transition-colors"
          >
            Tümünü okundu işaretle
          </button>
        )}
      </div>

      {/* List */}
      <div className="flex flex-col gap-2.5">
        {notifications.map((n) => {
          const s = severityStyle[n.severity];
          return (
            <div
              key={n.id}
              onClick={() => markRead(n.id)}
              className={`flex items-start gap-4 p-4 rounded-2xl border transition-all cursor-pointer ${
                n.read ? 'bg-white/[0.02] border-white/[0.05] opacity-55 hover:opacity-75' : `${s.bg} ${s.border} hover:brightness-110`
              }`}
            >
              <div className={`w-2 h-2 rounded-full flex-shrink-0 mt-1.5 ${n.read ? 'bg-white/15' : s.dot}`} />

              <div className="flex-1 min-w-0">
                <p className={`text-sm leading-relaxed ${n.read ? 'text-white/40' : 'text-white/80'}`}>
                  {n.message}
                </p>
                <p className="text-[11px] text-white/25 mt-1">{formatLastSeen(n.timestamp)}</p>
              </div>

              <span className={`text-[10px] font-semibold tracking-wide uppercase px-2 py-0.5 rounded-full border flex-shrink-0 ${
                n.read ? 'bg-white/[0.04] text-white/20 border-white/[0.08]' : s.badge
              }`}>
                {typeLabel[n.type] ?? n.type}
              </span>
            </div>
          );
        })}
      </div>

      {notifications.length === 0 || notifications.every((n) => n.read) ? (
        <div className="text-center py-16 text-white/25 text-sm">
          {notifications.length === 0 ? 'Bildirim yok' : 'Tüm bildirimler okundu'}
        </div>
      ) : null}
    </>
  );
}
