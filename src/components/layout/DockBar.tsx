import { memo } from 'react';
import {
  LayoutGrid, SlidersHorizontal, Camera, Route, ShieldAlert,
  Bell, Music2, Phone, Cloud, Shield, Tv2, AlertTriangle,
  Wrench, Zap, SplitSquareHorizontal,
} from 'lucide-react';
import { useNotificationState } from '../../platform/notificationService';
import { useDragScroll } from '../../hooks/useDragScroll';
import type { AppItem } from '../../data/apps';
import type { useSmartEngine } from '../../platform/smartEngine';

export type DrawerType =
  | 'none' | 'apps' | 'settings' | 'dashcam' | 'triplog' | 'dtc'
  | 'notifications' | 'weather' | 'sport' | 'security' | 'entertainment'
  | 'traffic' | 'music' | 'phone' | 'vehicle-reminder';

interface Props {
  smart: ReturnType<typeof useSmartEngine>;
  appMap: Record<string, AppItem>;
  onLaunch: (id: string) => void;
  onOpenDrawer: (d: DrawerType) => void;
  onOpenApps: () => void;
  onOpenSettings: () => void;
  onOpenSplit: () => void;
  onOpenRearCam: () => void;
}

const SKIP_IDS = new Set(['phone', 'spotify', 'music', 'contacts']);

/* Tema-duyarlı tile bileşeni */
function T({ fn, label, color, icon, badge }: {
  fn: () => void; label: string; color: string;
  icon: React.ReactNode; badge?: number;
}) {
  return (
    <button
      onClick={fn}
      style={{
        flexShrink: 0,
        width: 72,
        height: 68,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 5,
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        position: 'relative',
        borderRadius: 'var(--radius-tile, 0)',
        transition: 'background 0.2s ease',
      }}
      onMouseEnter={e => (e.currentTarget.style.background = 'var(--tile-hover-bg, rgba(255,255,255,0.05))')}
      onMouseLeave={e => (e.currentTarget.style.background = 'none')}
    >
      <div style={{
        color,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 28,
        height: 28,
        filter: 'var(--btn-glow, none)',
      }}>
        {icon}
      </div>
      <span style={{
        fontSize: 10,
        fontWeight: 'var(--font-weight-ui, 700)' as React.CSSProperties['fontWeight'],
        fontFamily: 'var(--font-ui, system-ui)',
        color: 'rgba(255,255,255,0.55)',
        textTransform: 'uppercase',
        letterSpacing: 'var(--letter-spacing-ui, 0.05em)',
        lineHeight: 1,
      }}>
        {label}
      </span>
      {!!badge && (
        <span style={{
          position: 'absolute', top: 8, right: 10,
          minWidth: 16, height: 16,
          background: 'var(--accent-primary, #3b82f6)',
          color: '#fff', fontSize: 9, fontWeight: 900,
          borderRadius: 8,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '0 3px',
        }}>
          {badge > 9 ? '9+' : badge}
        </span>
      )}
    </button>
  );
}

/* Tema-duyarlı bölücü */
function D() {
  return (
    <div style={{
      flexShrink: 0,
      width: 1,
      height: 32,
      background: 'var(--divider-color, rgba(255,255,255,0.10))',
      margin: '0 2px',
    }} />
  );
}

export const DockBar = memo(function DockBar({
  smart, appMap, onLaunch, onOpenDrawer, onOpenApps, onOpenSettings, onOpenSplit, onOpenRearCam,
}: Props) {
  const n = useNotificationState();
  const s = useDragScroll();

  const apps = smart.dockIds
    .filter(id => !SKIP_IDS.has(id))
    .slice(0, 4)
    .map(id => appMap[id])
    .filter(Boolean) as AppItem[];

  /* Tema-duyarlı ikon renkleri (CSS değişkenleri çalışmadığında fallback) */
  const c1  = 'var(--icon-color-1, #60a5fa)';   /* ana vurgu */
  const c2  = 'var(--icon-color-2, #94a3b8)';   /* ikincil */
  const nav = 'var(--icon-color-nav, #60a5fa)';  /* navigasyon */
  const med = 'var(--icon-color-media, #34d399)'; /* medya */

  return (
    <div
      data-dock="main"
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 100,
        /* Üstten içeriğe doğru eriyen gradient — yapıştırma hissi yok */
        background: 'linear-gradient(to bottom, transparent 0%, var(--dock-bg, rgba(6,8,16,0.92)) 28%)',
        backdropFilter: 'blur(28px) saturate(1.5)',
        WebkitBackdropFilter: 'blur(28px) saturate(1.5)',
        borderTop: 'none',
        paddingTop: 12,
        transition: 'background 0.4s ease',
      }}
    >
      {/* Tema renkli ince çizgi — kenar değil, vurgu */}
      <div style={{
        position: 'absolute',
        top: 12,
        left: '8%',
        right: '8%',
        height: 1,
        background: 'linear-gradient(90deg, transparent, var(--accent-primary, rgba(255,255,255,0.12)), transparent)',
        opacity: 0.5,
        pointerEvents: 'none',
      }} />
      <div
        ref={s.ref}
        onPointerDown={s.onPointerDown}
        onPointerMove={s.onPointerMove}
        onPointerUp={s.onPointerUp}
        onPointerCancel={s.onPointerUp}
        onClick={s.onClick}
        style={{
          display: 'flex',
          alignItems: 'center',
          height: 68,
          overflowX: 'auto',
          overflowY: 'hidden',
          paddingLeft: 4,
          paddingRight: 4,
          scrollbarWidth: 'none',
        }}
      >
        {/* Dinamik uygulama kısayolları */}
        {apps.map(a => (
          <T
            key={a.id}
            fn={() => onLaunch(a.id)}
            label={a.name}
            color={c1}
            icon={<span style={{ fontSize: 22 }}>{a.icon}</span>}
          />
        ))}
        <D />

        {/* İletişim */}
        <T fn={() => onOpenDrawer('phone')} label="Telefon" color={nav}  icon={<Phone size={24} />} />
        <T fn={() => onOpenDrawer('music')} label="Müzik"   color={med}  icon={<Music2 size={24} />} />
        <T
          fn={() => onOpenDrawer('notifications')}
          label="Bildirim"
          color={n.unreadCount > 0 ? c1 : c2}
          icon={<Bell size={24} />}
          badge={n.unreadCount}
        />
        <D />

        {/* Sürüş bilgileri */}
        <T fn={() => onOpenDrawer('weather')} label="Hava"    color="var(--icon-color-1, #38bdf8)" icon={<Cloud size={24} />} />
        <T fn={() => onOpenDrawer('traffic')} label="Trafik"  color="var(--icon-color-2, #fb923c)" icon={<AlertTriangle size={24} />} />
        <T fn={() => onOpenDrawer('dashcam')} label="Dashcam" color="var(--accent-red, #f87171)"   icon={<Camera size={24} />} />
        <T fn={() => onOpenDrawer('triplog')} label="Seyir"   color={med}                          icon={<Route size={24} />} />
        <D />

        {/* Araç bakım */}
        <T fn={() => onOpenDrawer('dtc')}              label="Arıza"    color="var(--icon-color-2, #fbbf24)" icon={<ShieldAlert size={24} />} />
        <T fn={() => onOpenDrawer('vehicle-reminder')} label="Bakım"    color={c2}                           icon={<Wrench size={24} />} />
        <T fn={() => onOpenDrawer('security')}         label="Güvenlik" color={med}                          icon={<Shield size={24} />} />
        <T fn={() => onOpenDrawer('entertainment')}    label="Eğlence"  color={c1}                           icon={<Tv2 size={24} />} />
        <T fn={() => onOpenDrawer('sport')}            label="Sport"    color="var(--accent-red, #f87171)"   icon={<Zap size={24} />} />
        <D />

        {/* Sistem */}
        <T fn={onOpenApps}     label="Menü"    color={c1} icon={<LayoutGrid size={24} />} />
        <T fn={onOpenRearCam}  label="Kamera"  color={c2} icon={<Camera size={24} />} />
        <T fn={onOpenSplit}    label="Split"   color={c2} icon={<SplitSquareHorizontal size={24} />} />
        <T fn={onOpenSettings} label="Ayarlar" color={c2} icon={<SlidersHorizontal size={24} />} />
      </div>
    </div>
  );
});
