import { memo, useRef, useEffect } from 'react';
import {
  LayoutGrid, SlidersHorizontal, Camera, Route, ShieldAlert,
  Bell, Music2, Phone, Cloud, Shield, Tv2, AlertTriangle,
  Wrench, Zap, SplitSquareHorizontal, Wind, Mic,
} from 'lucide-react';
import { useNotificationState } from '../../platform/notificationService';
import { openDrawer } from '../../platform/drawerBus';
import { openMusicDrawer } from '../../platform/mediaUi';
import type { AppItem } from '../../data/apps';

export type DrawerType =
  | 'none' | 'apps' | 'settings' | 'dashcam' | 'triplog' | 'dtc'
  | 'notifications' | 'weather' | 'sport' | 'security' | 'entertainment'
  | 'traffic' | 'music' | 'phone' | 'vehicle-reminder' | 'climate'
  | 'super-admin';

interface Props {
  appMap: Record<string, AppItem>;
  dockIds: string[];
  onLaunch: (id: string) => void;
  onOpenApps: () => void;
  onOpenSettings: () => void;
  onVoice?: () => void;
  onOpenSplit?: () => void;
  onOpenRearCam?: () => void;
}

const SKIP_IDS = new Set(['phone', 'spotify', 'music', 'contacts']);

/* ── OEM dimensions — bigger than the previous --dock-* defaults.
 * We bump inline to guarantee size regardless of theme-pack overrides.
 * Theme packs that set --dock-h still affect spacing-aware children,
 * but the touch targets here are locked to automotive-safe minimums. */
const OEM_DIMS = {
  height:    96,   // was 72; bigger touch zone
  tileW:     96,   // was 64; OEM thumb-comfortable
  tileH:     88,   // tile body fits comfortably inside dock
  iconBox:   44,   // icon container; circular bg in active state
  iconSize:  30,   // glyph stroke size (was 22-28)
  fontSize:  13,   // label text
  gapInside: 8,    // gap between icon and label
};

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
        alignItems: 'center',
      }}
    >
      <button
        onClick={fn}
        onPointerDown={e => {
          e.currentTarget.style.filter   = 'brightness(1.35)';
          e.currentTarget.style.transform = 'translate3d(0,0,0) scale(0.96)';
        }}
        onPointerUp={e => {
          e.currentTarget.style.filter   = '';
          e.currentTarget.style.transform = '';
        }}
        onPointerCancel={e => {
          e.currentTarget.style.filter   = '';
          e.currentTarget.style.transform = '';
        }}
        className="oem-dock-btn"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: OEM_DIMS.gapInside,
          width:  OEM_DIMS.tileW,
          height: OEM_DIMS.tileH,
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          borderRadius: 'var(--radius-tile, 18px)',
          position: 'relative',
          padding: 0,
          transition: 'filter 120ms ease-out, transform 120ms ease-out',
        }}
      >
        {/* Icon box — circular subtle backdrop, becomes ambient halo on hover */}
        <span
          aria-hidden
          style={{
            position: 'relative',
            width:  OEM_DIMS.iconBox,
            height: OEM_DIMS.iconBox,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color,
            borderRadius: '50%',
            // Layered ambient glow: solid radial + faint outer halo
            background:
              'radial-gradient(circle at 50% 45%, rgba(255,255,255,0.04), transparent 70%)',
            filter: 'var(--btn-glow, none)',
            flexShrink: 0,
          }}
        >
          {/* Amber outer halo — opt-in via --oem-amber-glow.
              Default theme tokens fall back to "none" cleanly. */}
          <span
            aria-hidden
            style={{
              position: 'absolute',
              inset: -6,
              borderRadius: '50%',
              background:
                'radial-gradient(circle, var(--oem-amber-glow, transparent) 0%, transparent 70%)',
              opacity: 0,
              transition: 'opacity 160ms ease-out',
              pointerEvents: 'none',
            }}
            data-oem-halo
          />
          {/* The actual lucide icon */}
          <span style={{
            width:  OEM_DIMS.iconSize,
            height: OEM_DIMS.iconSize,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
            zIndex: 1,
          }}>
            {icon}
          </span>
        </span>

        {/* Label — bolder, slightly larger, ultra-readable */}
        <span style={{
          fontSize: OEM_DIMS.fontSize,
          fontWeight: 800,
          textTransform: 'uppercase',
          letterSpacing: 'var(--letter-spacing-ui, 0.05em)',
          color: '#ffffff',
          fontFamily: 'var(--font-ui, system-ui)',
          lineHeight: 1,
          whiteSpace: 'nowrap',
          textShadow: '0 2px 10px rgba(0,0,0,0.85), 0 1px 2px rgba(0,0,0,0.95)',
          maxWidth: OEM_DIMS.tileW - 4,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>
          {label}
        </span>

        {!!badge && (
          <span style={{
            position: 'absolute',
            top: 6,
            right: 8,
            minWidth: 18,
            height: 18,
            background: 'var(--accent, #3b82f6)',
            color: '#fff',
            fontSize: 10,
            fontWeight: 900,
            borderRadius: 9,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '0 4px',
            boxShadow: '0 0 0 2px var(--dock-bg, #060810)',
          }}>
            {badge > 9 ? '9+' : badge}
          </span>
        )}
      </button>
    </div>
  );
}

/* ── Divider — taller, warmer ───────────────────────────────── */
function Div() {
  return (
    <div style={{
      flexShrink: 0,
      width: 1,
      height: 40,
      margin: '0 8px',
      alignSelf: 'center',
      background:
        'linear-gradient(180deg, transparent, var(--divider-color, rgba(255,255,255,0.13)) 25%, var(--divider-color, rgba(255,255,255,0.13)) 75%, transparent)',
    }} />
  );
}

/* ── DockBar ───────────────────────────────────────────────── */
export const DockBar = memo(function DockBar({
  appMap, dockIds, onLaunch, onOpenApps, onOpenSettings, onVoice, onOpenSplit, onOpenRearCam,
}: Props) {
  const n = useNotificationState();
  const scrollRef = useRef<HTMLDivElement>(null);
  const dockRef   = useRef<HTMLDivElement>(null);

  /* Fisheye scroll effect — throttled via rAF.
   * Preserved exactly from original DockBar — same scale ramp. */
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
        const scale  = (1.12 - ratio * 0.22).toFixed(3);
        const opacity = Math.max(0.92, 1 - ratio * 0.08).toFixed(3);
        item.style.transform = `translate3d(0,0,0) scale(${scale})`;
        item.style.opacity   = opacity;

        // Subtle amber halo strengthens as the item nears center.
        const halo = item.querySelector<HTMLElement>('[data-oem-halo]');
        if (halo) {
          halo.style.opacity = (Math.max(0, 1 - ratio * 1.6) * 0.55).toFixed(3);
        }
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
        // Existing --dock-bg is preserved — theme packs (Tesla/Mercedes/Audi/...)
        // continue to drive base color. We layer OEM lighting ON TOP.
        background: 'var(--dock-bg, rgba(5,7,14,0.98))',
        backdropFilter: 'blur(calc(var(--rt-blur, 1) * 8px)) saturate(115%)',
        WebkitBackdropFilter: 'blur(calc(var(--rt-blur, 1) * 8px)) saturate(115%)',
        borderTop: 'var(--dock-border-top, 1px solid rgba(255,255,255,0.10))',
        paddingTop: 6,
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        // Drop shadow upward — anchors the dock as a physical dashboard element
        boxShadow: '0 -8px 32px -12px rgba(0,0,0,0.55)',
      }}
    >
      {/* OEM premium glass overlay — sits inside the dock, additive only.
       * Three layers: cool sheen at top edge, warm under-glow at center,
       * deep shadow at the very bottom. Pointer-none. */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          background:
            // Cool brushed-aluminum sheen near the top edge
            'linear-gradient(180deg, rgba(255,255,255,0.06) 0%, transparent 18%),' +
            // Warm amber bloom under the center — driver glance zone
            'radial-gradient(70% 140% at 50% 110%, var(--oem-amber-soft, transparent), transparent 70%),' +
            // Subtle floor darkening at very bottom
            'linear-gradient(0deg, rgba(0,0,0,0.20) 0%, transparent 35%)',
        }}
      />

      {/* Top accent shimmer — uses theme accent var so each pack flavours its own line.
       * Additive to --dock-border-top, sits 1px below it. */}
      <div aria-hidden style={{
        position: 'absolute',
        top: 1,
        left: '6%',
        right: '6%',
        height: 1,
        opacity: 0.55,
        pointerEvents: 'none',
        background:
          'linear-gradient(90deg, transparent, var(--accent, rgba(255,255,255,0.20)), transparent)',
      }} />

      {/* Warm pillar ambient — left & right edges, evokes door-trim glow.
       * Falls back to transparent when SAFE_MODE / OLED / sunlight strip --oem-amber-glow. */}
      <div aria-hidden style={{
        position: 'absolute',
        top: 0, bottom: 0, left: 0,
        width: 90,
        pointerEvents: 'none',
        background: 'radial-gradient(60% 100% at 0% 50%, var(--oem-amber-glow, transparent), transparent 70%)',
        mixBlendMode: 'screen',
      }} />
      <div aria-hidden style={{
        position: 'absolute',
        top: 0, bottom: 0, right: 0,
        width: 90,
        pointerEvents: 'none',
        background: 'radial-gradient(60% 100% at 100% 50%, var(--oem-amber-glow, transparent), transparent 70%)',
        mixBlendMode: 'screen',
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
          height: OEM_DIMS.height,
          paddingLeft: 12,
          paddingRight: 12,
          position: 'relative', // above the absolute lighting layers
          zIndex: 1,
        }}
      >
        {dynamicApps.map(a => (
          <Btn
            key={a.id}
            fn={() => onLaunch(a.id)}
            label={a.name}
            color={c1}
            icon={<span style={{ fontSize: OEM_DIMS.iconSize, lineHeight: 1 }}>{a.icon}</span>}
          />
        ))}
        {dynamicApps.length > 0 && <Div />}

        {onVoice && (
          <>
            <Btn fn={onVoice} label="Asistan" color="var(--accent-red, #f87171)" icon={<Mic size={OEM_DIMS.iconSize} />} />
            <Div />
          </>
        )}
        <Btn fn={() => openDrawer('phone')}         label="Telefon"  color={c1}  icon={<Phone           size={OEM_DIMS.iconSize} />} />
        <Btn fn={() => openMusicDrawer()}            label="Müzik"    color={med} icon={<Music2          size={OEM_DIMS.iconSize} />} />
        <Btn fn={() => openDrawer('notifications')} label="Bildirim" color={n.unreadCount > 0 ? c1 : c2} icon={<Bell size={OEM_DIMS.iconSize} />} badge={n.unreadCount} />
        <Div />
        <Btn fn={onOpenApps}     label="Menü"    color={c1} icon={<LayoutGrid       size={OEM_DIMS.iconSize} />} />
        <Btn fn={onOpenSettings} label="Ayarlar" color={c2} icon={<SlidersHorizontal size={OEM_DIMS.iconSize} />} />
        <Div />
        <Btn fn={() => openDrawer('climate')}           label="Klima"    color={c1}             icon={<Wind        size={OEM_DIMS.iconSize - 2} />} />
        <Btn fn={() => openDrawer('weather')}           label="Hava"     color="#38bdf8"         icon={<Cloud       size={OEM_DIMS.iconSize - 2} />} />
        <Btn fn={() => openDrawer('traffic')}           label="Trafik"   color="#fb923c"         icon={<AlertTriangle size={OEM_DIMS.iconSize - 2} />} />
        <Btn fn={() => openDrawer('dashcam')}           label="Dashcam"  color="var(--accent-red, #f87171)" icon={<Camera size={OEM_DIMS.iconSize - 2} />} />
        <Btn fn={() => openDrawer('triplog')}           label="Seyir"    color={med}             icon={<Route       size={OEM_DIMS.iconSize - 2} />} />
        <Div />
        <Btn fn={() => openDrawer('dtc')}               label="Arıza"    color="#fbbf24"         icon={<ShieldAlert size={OEM_DIMS.iconSize - 2} />} />
        <Btn fn={() => openDrawer('vehicle-reminder')}  label="Bakım"    color={c2}              icon={<Wrench      size={OEM_DIMS.iconSize - 2} />} />
        <Btn fn={() => openDrawer('security')}          label="Güvenlik" color={med}             icon={<Shield      size={OEM_DIMS.iconSize - 2} />} />
        <Btn fn={() => openDrawer('entertainment')}     label="Eğlence"  color={c1}              icon={<Tv2         size={OEM_DIMS.iconSize - 2} />} />
        <Btn fn={() => openDrawer('sport')}             label="Sport"    color="var(--accent-red, #f87171)" icon={<Zap size={OEM_DIMS.iconSize - 2} />} />
        {onOpenRearCam && (
          <>
            <Div />
            <Btn fn={onOpenRearCam} label="Kamera" color={c2} icon={<Camera size={OEM_DIMS.iconSize - 2} />} />
          </>
        )}
        {onOpenSplit && (
          <Btn fn={onOpenSplit} label="Split" color={c2} icon={<SplitSquareHorizontal size={OEM_DIMS.iconSize - 2} />} />
        )}
      </div>
    </div>
  );
});
