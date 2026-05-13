import { memo, useRef, useEffect } from 'react';
import {
  LayoutGrid, SlidersHorizontal, Camera, Route, ShieldAlert,
  Bell, Music2, Phone, Cloud, Shield, Tv2, AlertTriangle,
  Wrench, Zap, SplitSquareHorizontal, Wind,
} from 'lucide-react';
import { useNotificationState } from '../../platform/notificationService';
import { openDrawer } from '../../platform/drawerBus';
import { openMusicDrawer } from '../../platform/mediaUi';
import type { AppItem } from '../../data/apps';

export type DrawerType =
  | 'none' | 'apps' | 'settings' | 'dashcam' | 'triplog' | 'dtc'
  | 'notifications' | 'weather' | 'sport' | 'security' | 'entertainment'
  | 'traffic' | 'music' | 'phone' | 'vehicle-reminder' | 'climate';

interface Props {
  appMap: Record<string, AppItem>;
  dockIds: string[];
  onLaunch: (id: string) => void;
  onOpenApps: () => void;
  onOpenSettings: () => void;
  onOpenSplit?: () => void;
  onOpenRearCam?: () => void;
}

const SKIP_IDS = new Set(['phone', 'spotify', 'music', 'contacts']);

/* ── Dock item ─────────────────────────────────────────────── */
function Btn({ fn, label, color, icon, badge }: {
  fn: () => void;
  label: string;
  color: string;
  icon: React.ReactNode;
  badge?: number;
}) {
  return (
    <div
      data-dock-item
      style={{
        flexShrink: 0,
        scrollSnapAlign: 'center',
        willChange: 'transform',
        display: 'flex',
      }}
    >
      <button
        onClick={fn}
        onPointerDown={e => { e.currentTarget.style.filter = 'brightness(1.4)'; }}
        onPointerUp={e => { e.currentTarget.style.filter = ''; }}
        onPointerCancel={e => { e.currentTarget.style.filter = ''; }}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 'var(--dock-gap, 8px)',
          width: 'var(--dock-tile-w, 64px)',
          height: 'var(--dock-h, 72px)',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          borderRadius: 'var(--radius-tile, 0)',
          position: 'relative',
          padding: 0,
          transition: 'filter 80ms ease-out',
        }}
      >
        <div style={{
          color,
          width: 'var(--dock-icon, 28px)',
          height: 'var(--dock-icon, 28px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          filter: 'var(--btn-glow, none)',
          flexShrink: 0,
        }}>
          {icon}
        </div>
        <span style={{
          fontSize: 'var(--dock-font, 11px)',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: 'var(--letter-spacing-ui, 0.05em)',
          color: 'rgba(255,255,255,0.60)',
          fontFamily: 'var(--font-ui, system-ui)',
          lineHeight: 1,
          whiteSpace: 'nowrap',
        }}>
          {label}
        </span>
        {!!badge && (
          <span style={{
            position: 'absolute',
            top: 8,
            right: 6,
            minWidth: 16,
            height: 16,
            background: 'var(--accent, #3b82f6)',
            color: '#fff',
            fontSize: 9,
            fontWeight: 900,
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '0 3px',
          }}>
            {badge > 9 ? '9+' : badge}
          </span>
        )}
      </button>
    </div>
  );
}

/* ── Divider ───────────────────────────────────────────────── */
function Div() {
  return (
    <div style={{
      flexShrink: 0,
      width: 1,
      height: 28,
      margin: '0 4px',
      alignSelf: 'center',
      background: 'var(--divider-color, rgba(255,255,255,0.13))',
    }} />
  );
}

/* ── DockBar ───────────────────────────────────────────────── */
export const DockBar = memo(function DockBar({
  appMap, dockIds, onLaunch, onOpenApps, onOpenSettings, onOpenSplit, onOpenRearCam,
}: Props) {
  const n = useNotificationState();
  const scrollRef = useRef<HTMLDivElement>(null);
  const dockRef   = useRef<HTMLDivElement>(null);

  /* Fisheye scroll effect — throttled via rAF */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    let ticking = false;

    const applyFisheye = () => {
      const containerCenter = el.scrollLeft + el.clientWidth / 2;
      const maxDist = el.clientWidth / 2;
      const items = el.querySelectorAll<HTMLElement>('[data-dock-item]');
      items.forEach(item => {
        const center = item.offsetLeft + item.offsetWidth / 2;
        const dist   = Math.abs(containerCenter - center);
        const ratio  = Math.min(dist / (maxDist || 1), 1);
        const scale  = (1.15 - ratio * 0.30).toFixed(3);
        const opacity = Math.max(0.40, 1 - ratio * 0.60).toFixed(3);
        item.style.transform = `translate3d(0,0,0) scale(${scale})`;
        item.style.opacity   = opacity;
      });
      ticking = false;
    };

    const onScroll = () => {
      if (!ticking) {
        requestAnimationFrame(applyFisheye);
        ticking = true;
      }
    };

    applyFisheye();
    el.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', applyFisheye, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', applyFisheye);
    };
  }, []);

  /* Sync --lp-dock-h so content spacer stays accurate */
  useEffect(() => {
    const el = dockRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      document.documentElement.style.setProperty('--lp-dock-h', `${el.offsetHeight}px`);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const dynamicApps = dockIds
    .filter(id => !SKIP_IDS.has(id))
    .slice(0, 2)
    .map(id => appMap[id])
    .filter(Boolean) as AppItem[];

  const c1  = 'var(--accent, #60a5fa)';
  const c2  = 'var(--icon-color-2, #94a3b8)';
  const med = 'var(--icon-color-media, #34d399)';

  return (
    <div
      ref={dockRef}
      data-dock="main"
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 100,
        background: 'linear-gradient(to bottom, transparent 0%, var(--dock-bg, rgba(6,8,16,0.94)) 28%)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        borderTop: 'var(--dock-border-top, 1px solid rgba(255,255,255,0.10))',
        paddingTop: 4,
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}
    >
      {/* Accent shimmer line */}
      <div aria-hidden style={{
        position: 'absolute',
        top: 0,
        left: '8%',
        right: '8%',
        height: 1,
        opacity: 0.45,
        pointerEvents: 'none',
        background: 'linear-gradient(90deg, transparent, var(--accent, rgba(255,255,255,0.14)), transparent)',
      }} />

      {/* Scrollable items row */}
      <div
        ref={scrollRef}
        style={{
          display: 'flex',
          flexWrap: 'nowrap',
          alignItems: 'center',
          overflowX: 'auto',
          overflowY: 'hidden',
          scrollSnapType: 'x mandatory',
          msOverflowStyle: 'none',
          scrollbarWidth: 'none',
          height: 'var(--dock-h, 72px)',
          paddingLeft: 8,
          paddingRight: 8,
        }}
      >
        {dynamicApps.map(a => (
          <Btn
            key={a.id}
            fn={() => onLaunch(a.id)}
            label={a.name}
            color={c1}
            icon={<span style={{ fontSize: 'var(--dock-icon, 28px)', lineHeight: 1 }}>{a.icon}</span>}
          />
        ))}
        {dynamicApps.length > 0 && <Div />}

        <Btn fn={() => openDrawer('phone')}         label="Telefon"  color={c1}  icon={<Phone           size={24} />} />
        <Btn fn={() => openMusicDrawer()}            label="Müzik"    color={med} icon={<Music2          size={24} />} />
        <Btn fn={() => openDrawer('notifications')} label="Bildirim" color={n.unreadCount > 0 ? c1 : c2} icon={<Bell size={24} />} badge={n.unreadCount} />
        <Div />
        <Btn fn={onOpenApps}     label="Menü"    color={c1} icon={<LayoutGrid      size={24} />} />
        <Btn fn={onOpenSettings} label="Ayarlar" color={c2} icon={<SlidersHorizontal size={24} />} />
        <Div />
        <Btn fn={() => openDrawer('climate')}           label="Klima"    color={c1}             icon={<Wind        size={22} />} />
        <Btn fn={() => openDrawer('weather')}           label="Hava"     color="#38bdf8"         icon={<Cloud       size={22} />} />
        <Btn fn={() => openDrawer('traffic')}           label="Trafik"   color="#fb923c"         icon={<AlertTriangle size={22} />} />
        <Btn fn={() => openDrawer('dashcam')}           label="Dashcam"  color="var(--accent-red, #f87171)" icon={<Camera size={22} />} />
        <Btn fn={() => openDrawer('triplog')}           label="Seyir"    color={med}             icon={<Route       size={22} />} />
        <Div />
        <Btn fn={() => openDrawer('dtc')}               label="Arıza"    color="#fbbf24"         icon={<ShieldAlert size={22} />} />
        <Btn fn={() => openDrawer('vehicle-reminder')}  label="Bakım"    color={c2}              icon={<Wrench      size={22} />} />
        <Btn fn={() => openDrawer('security')}          label="Güvenlik" color={med}             icon={<Shield      size={22} />} />
        <Btn fn={() => openDrawer('entertainment')}     label="Eğlence"  color={c1}              icon={<Tv2         size={22} />} />
        <Btn fn={() => openDrawer('sport')}             label="Sport"    color="var(--accent-red, #f87171)" icon={<Zap size={22} />} />
        {onOpenRearCam && (
          <>
            <Div />
            <Btn fn={onOpenRearCam} label="Kamera" color={c2} icon={<Camera size={22} />} />
          </>
        )}
        {onOpenSplit && (
          <Btn fn={onOpenSplit} label="Split" color={c2} icon={<SplitSquareHorizontal size={22} />} />
        )}
      </div>
    </div>
  );
});
