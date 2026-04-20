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

/* Dock tile — Tailwind sınıf tabanlı */
function T({ fn, label, color, icon, badge }: {
  fn: () => void; label: string; color: string;
  icon: React.ReactNode; badge?: number;
}) {
  return (
    <button
      onClick={fn}
      onPointerDown={e => (e.currentTarget.style.transform = 'scale(0.95)')}
      onPointerUp={e => (e.currentTarget.style.transform = '')}
      onPointerCancel={e => (e.currentTarget.style.transform = '')}
      className="relative flex flex-col items-center justify-center gap-[5px] flex-shrink-0 bg-transparent border-0 cursor-pointer rounded-[var(--radius-tile,0)] transition-[background,transform] duration-[150ms,120ms] ease-out hover:bg-[var(--tile-hover-bg,rgba(255,255,255,0.06))] active:opacity-80"
      style={{
        width: 'var(--lp-tile-w, 64px)',
        height: 'var(--lp-dock-h, 68px)',
      }}
    >
      <div
        className="flex items-center justify-center"
        style={{
          color,
          width: 'var(--lp-dock-icon, 24px)',
          height: 'var(--lp-dock-icon, 24px)',
          filter: 'var(--btn-glow, none)',
        }}
      >
        {icon}
      </div>
      <span
        className="uppercase leading-none text-[length:var(--lp-font-xs,10px)] font-[number:var(--font-weight-ui,700)] tracking-[var(--letter-spacing-ui,0.05em)] text-white/65"
        style={{ fontFamily: 'var(--font-ui, system-ui)' }}
      >
        {label}
      </span>
      {!!badge && (
        <span className="absolute top-2 right-2.5 min-w-4 h-4 bg-[var(--accent-primary,#3b82f6)] text-white text-[9px] font-black rounded-lg flex items-center justify-center px-[3px]">
          {badge > 9 ? '9+' : badge}
        </span>
      )}
    </button>
  );
}

/* Bölücü */
function D() {
  return (
    <div className="flex-shrink-0 w-px h-8 mx-0.5 bg-[var(--divider-color,rgba(255,255,255,0.13))]" />
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

  const c1  = 'var(--icon-color-1, #60a5fa)';
  const c2  = 'var(--icon-color-2, #94a3b8)';
  const nav = 'var(--icon-color-nav, #60a5fa)';
  const med = 'var(--icon-color-media, #34d399)';

  return (
    <div
      data-dock="main"
      className="fixed bottom-0 left-0 right-0 z-[100] pt-3 transition-[background] duration-400 ease-out"
      style={{
        background: 'linear-gradient(to bottom, transparent 0%, var(--dock-bg, rgba(6,8,16,0.92)) 28%)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
      }}
    >
      {/* Vurgu çizgisi — temaya göre renk alır */}
      <div
        aria-hidden
        className="absolute top-3 left-[8%] right-[8%] h-px opacity-50 pointer-events-none"
        style={{ background: 'linear-gradient(90deg, transparent, var(--accent-primary, rgba(255,255,255,0.12)), transparent)' }}
      />

      <div
        ref={s.ref}
        onPointerDown={s.onPointerDown}
        onPointerMove={s.onPointerMove}
        onPointerUp={s.onPointerUp}
        onPointerCancel={s.onPointerUp}
        onClick={s.onClick}
        className="flex items-center overflow-x-auto overflow-y-hidden px-1 scrollbar-none"
        style={{ height: 'var(--lp-dock-h, 68px)' }}
      >
        {apps.map(a => (
          <T
            key={a.id}
            fn={() => onLaunch(a.id)}
            label={a.name}
            color={c1}
            icon={<span className="text-[22px]">{a.icon}</span>}
          />
        ))}
        <D />

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

        <T fn={() => onOpenDrawer('weather')} label="Hava"    color="var(--icon-color-1, #38bdf8)" icon={<Cloud size={24} />} />
        <T fn={() => onOpenDrawer('traffic')} label="Trafik"  color="var(--icon-color-2, #fb923c)" icon={<AlertTriangle size={24} />} />
        <T fn={() => onOpenDrawer('dashcam')} label="Dashcam" color="var(--accent-red, #f87171)"   icon={<Camera size={24} />} />
        <T fn={() => onOpenDrawer('triplog')} label="Seyir"   color={med}                          icon={<Route size={24} />} />
        <D />

        <T fn={() => onOpenDrawer('dtc')}              label="Arıza"    color="var(--icon-color-2, #fbbf24)" icon={<ShieldAlert size={24} />} />
        <T fn={() => onOpenDrawer('vehicle-reminder')} label="Bakım"    color={c2}                           icon={<Wrench size={24} />} />
        <T fn={() => onOpenDrawer('security')}         label="Güvenlik" color={med}                          icon={<Shield size={24} />} />
        <T fn={() => onOpenDrawer('entertainment')}    label="Eğlence"  color={c1}                           icon={<Tv2 size={24} />} />
        <T fn={() => onOpenDrawer('sport')}            label="Sport"    color="var(--accent-red, #f87171)"   icon={<Zap size={24} />} />
        <D />

        <T fn={onOpenApps}     label="Menü"    color={c1} icon={<LayoutGrid size={24} />} />
        <T fn={onOpenRearCam}  label="Kamera"  color={c2} icon={<Camera size={24} />} />
        <T fn={onOpenSplit}    label="Split"   color={c2} icon={<SplitSquareHorizontal size={24} />} />
        <T fn={onOpenSettings} label="Ayarlar" color={c2} icon={<SlidersHorizontal size={24} />} />
      </div>
    </div>
  );
});
