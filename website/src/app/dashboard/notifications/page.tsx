'use client';

/**
 * BİLDİRİMLER — Kanıt Konsolu dili (#663).
 *
 * ⚠️ KAYNAK AYRIMI (beyan): bu ekran `notificationStore`u okur — telemetri
 * akışından İSTEMCİDE üretilen uyarılardır ve sekme kapanınca kaybolur.
 * Sunucuda saklanan bildirimler (`notifications` tablosu) Filo → Uyarılar
 * ekranındadır. İki kaynak BİRLEŞTİRİLMEDİ; birleştirmek, kalıcı olmayan
 * kaydı kalıcı gibi göstermek olurdu. Ekran bunu açıkça yazar.
 */

import Link from 'next/link';
import { useNotificationStore } from '@/store/notificationStore';
import { formatLastSeen } from '@/lib/utils';
import { ProGate } from '@/components/plan/ProGate';
import { Panel, PanelHead, EmptyState, TOKEN_COLOR } from '@/components/console/primitives';

const typeLabel: Record<string, string> = {
  speed: 'HIZ',
  fuel: 'YAKIT',
  temp: 'MOTOR',
  geofence: 'BÖLGE',
};

const SEVERITY_TOKEN = {
  critical: 'critical',
  warning: 'warning',
  info: 'unknown',
} as const;

const SEVERITY_LABEL = {
  critical: 'KRİTİK',
  warning: 'UYARI',
  info: 'BİLGİ',
} as const;

function NotificationsContent() {
  const { notifications, markRead, markAllRead, unreadCount } = useNotificationStore();
  const unread = unreadCount();

  return (
    <div className="flex flex-col gap-3 lg:gap-4">
      <Panel>
        <PanelHead
          title="Oturum bildirimleri"
          meta={unread > 0 ? `${unread} okunmamış` : 'tümü okundu'}
          action={
            unread > 0 ? (
              <button
                onClick={markAllRead}
                className="cn-num text-[9px] uppercase tracking-[0.16em] px-2 py-1 border border-hair text-t2 hover:text-t1"
                style={{ borderRadius: 2 }}
              >
                TÜMÜNÜ OKUNDU İŞARETLE
              </button>
            ) : null
          }
        />

        <p className="px-4 py-2 text-[11px] text-t3 leading-relaxed border-b border-hair-soft">
          Bu liste <strong className="text-t2">bu oturumda</strong> telemetriden üretilen
          uyarıları gösterir; sunucuda saklanmaz ve sekme kapanınca kaybolur. Kalıcı
          bildirimler{' '}
          <Link href="/dashboard/fleet/alerts" style={{ color: 'var(--cn-copper)' }}>
            Filo → Uyarılar
          </Link>{' '}
          ekranındadır.
        </p>

        {notifications.length === 0 ? (
          <EmptyState
            title="BİLDİRİM YOK"
            detail="Araçlardan gelen telemetri henüz eşik aşımı üretmedi."
          />
        ) : (
          <ul className="divide-y" style={{ borderColor: 'var(--cn-line-soft)' }}>
            {notifications.map((n) => {
              const token = SEVERITY_TOKEN[n.severity];
              return (
                <li key={n.id}>
                  <button
                    onClick={() => markRead(n.id)}
                    className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-bezel transition-colors"
                    style={{ opacity: n.read ? 0.55 : 1 }}
                  >
                    <span
                      aria-hidden
                      className="mt-1 flex-shrink-0"
                      style={{
                        width: 4,
                        height: 28,
                        background: n.read ? 'var(--cn-line)' : TOKEN_COLOR[token],
                      }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span
                          className="cn-num text-[9px] uppercase tracking-[0.14em]"
                          style={{ color: n.read ? 'var(--cn-text-3)' : TOKEN_COLOR[token] }}
                        >
                          {SEVERITY_LABEL[n.severity]}
                        </span>
                        <span className="cn-num text-[9px] uppercase tracking-[0.14em] text-t3">
                          {typeLabel[n.type] ?? n.type}
                        </span>
                        {!n.read && (
                          <span
                            className="cn-num text-[9px] px-1.5 py-0.5"
                            style={{
                              color: 'var(--cn-copper)',
                              border: '1px solid var(--cn-copper)',
                              borderRadius: 2,
                            }}
                          >
                            YENİ
                          </span>
                        )}
                      </div>
                      <p className="text-[13px] text-t1 mt-1 leading-relaxed">{n.message}</p>
                      <p className="cn-num text-[10px] text-t3 mt-1">
                        {n.plate} · {formatLastSeen(n.timestamp)}
                      </p>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}

export default function NotificationsPage() {
  return (
    <ProGate feature="notifications">
      <NotificationsContent />
    </ProGate>
  );
}
