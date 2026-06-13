import { memo, useRef, useEffect } from 'react';
import {
  LayoutGrid, SlidersHorizontal, Camera, Route, ShieldAlert,
  Bell, Music2, Phone, Cloud, Shield, Tv2, AlertTriangle,
  Wrench, Zap, SplitSquareHorizontal, Wind, Mic,
} from 'lucide-react';
import { useNotificationState } from '../../platform/notificationService';
import { openDrawer } from '../../platform/drawerBus';
import { openMusicDrawer } from '../../platform/mediaUi';
import { useLivingThemeState } from '../../hooks/useLivingThemeState';
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

/* ── Dock item ─────────────────────────────────────────────── */
/* Görsel katman (zemin/renk/hover/aktif/çip parıltısı) dock-premium.css'te;
   burada yalnızca yapı + ölçü. İkonlar monokrom ink (--oem-dock-ink),
   aksan yalnızca hover/aktif'te → premium OEM tutarlılığı. */
function Btn({ fn, label, icon, badge, color }: {
  fn: () => void;
  label: string;
  icon: React.ReactNode;
  badge?: number;
  /** İkonun sinyatür rengi (referans: renkli ikonlu açık-cam dock) */
  color?: string;
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
        className="dock-btn"
        onClick={fn}
        style={{
          // İkon rengini CSS'e aktar (chip glyph + tint bunu kullanır)
          ['--dock-ic' as string]: color ?? 'var(--oem-dock-ink)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 'var(--dock-gap, 7px)',
          width: 'var(--dock-tile-w, 64px)',
          height: 'var(--dock-h, 72px)',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          position: 'relative',
          padding: 0,
        }}
      >
        <div
          className="dock-chip"
          style={{
            width: 'calc(var(--dock-icon, 28px) + 20px)',
            height: 'calc(var(--dock-icon, 28px) + 20px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {icon}
        </div>
        <span
          className="dock-label"
          style={{
            fontSize: 'var(--dock-font, 12px)',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.07em',
            fontFamily: 'var(--font-ui, system-ui)',
            lineHeight: 1,
            whiteSpace: 'nowrap',
          }}
        >
          {label}
        </span>
        {!!badge && (
          <span style={{
            position: 'absolute',
            top: 4,
            right: 8,
            minWidth: 16,
            height: 16,
            background: 'var(--oem-dock-accent, #E6A93F)',
            color: '#1A140A',
            fontSize: 9,
            fontWeight: 900,
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '0 3px',
            boxShadow: '0 2px 6px -2px rgba(0,0,0,0.6)',
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
    <div className="dock-divider" style={{
      flexShrink: 0,
      width: 1,
      height: 30,
      margin: '0 6px',
      alignSelf: 'center',
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

  // Living theme (Kanal A — paylaşılan --oem yüzeyi): araç durumu dock üst kenarında
  // STATİK ambient cue. Dock kalıcı → tüm temalarda görünür (Kanal B layout'larından
  // bağımsız). Mevcut --oem-danger/-warn token'ları, yeni namespace yok. Animasyon yok
  // (border compat-mode/K24'te hayatta kalır → Mali-safe). normal/obd-offline → cue yok.
  const { veh } = useLivingThemeState();
  const dockAccent =
    veh === 'temp-high' ? 'var(--oem-danger)' :
    veh === 'fuel-low'  ? 'var(--oem-warn)'   : null;

  /* Dock her zaman sabit/görünür — ana tema (ProDock) ile tutarlı (auto-hide kaldırıldı) */

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
        const opacity = Math.max(0.92, 1 - ratio * 0.08).toFixed(3);
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
        // Zemin / üst hairline / elevation → dock-premium.css (--oem-dock-*)
        backdropFilter: 'blur(12px) saturate(1.2)',
        WebkitBackdropFilter: 'blur(12px) saturate(1.2)',
        paddingTop: 4,
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        // Araç durumu ambient cue — statik üst kenar (yalnız temp-high/fuel-low).
        borderTop: dockAccent ? `2px solid ${dockAccent}` : undefined,
      }}
    >
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
            icon={<span style={{ fontSize: 'var(--dock-icon, 28px)', lineHeight: 1 }}>{a.icon}</span>}
          />
        ))}
        {dynamicApps.length > 0 && <Div />}

        {onVoice && (
          <>
            <Btn fn={onVoice} label="Asistan" color="#7C6CFF" icon={<Mic size={24} />} />
            <Div />
          </>
        )}
        <Btn fn={() => openDrawer('phone')}         label="Telefon"  color="#22C55E" icon={<Phone           size={24} />} />
        <Btn fn={() => openMusicDrawer()}            label="Müzik"    color="#FF4D6D" icon={<Music2          size={24} />} />
        <Btn fn={() => openDrawer('notifications')} label="Bildirim" color="#FF9F43" icon={<Bell size={24} />} badge={n.unreadCount} />
        <Div />
        <Btn fn={onOpenApps}     label="Menü"    color="#5B8DEF" icon={<LayoutGrid      size={24} />} />
        <Btn fn={onOpenSettings} label="Ayarlar" color="#8A93A6" icon={<SlidersHorizontal size={24} />} />
        <Div />
        <Btn fn={() => openDrawer('climate')}           label="Klima"    color="#2DD4BF" icon={<Wind        size={22} />} />
        <Btn fn={() => openDrawer('weather')}           label="Hava"     color="#38BDF8" icon={<Cloud       size={22} />} />
        <Btn fn={() => openDrawer('traffic')}           label="Trafik"   color="#F4B740" icon={<AlertTriangle size={22} />} />
        <Btn fn={() => openDrawer('dashcam')}           label="Dashcam"  color="#A78BFA" icon={<Camera size={22} />} />
        <Btn fn={() => openDrawer('triplog')}           label="Seyir"    color="#34D399" icon={<Route       size={22} />} />
        <Div />
        <Btn fn={() => openDrawer('dtc')}               label="Arıza"    color="#F87171" icon={<ShieldAlert size={22} />} />
        <Btn fn={() => openDrawer('vehicle-reminder')}  label="Bakım"    color="#FB923C" icon={<Wrench      size={22} />} />
        <Btn fn={() => openDrawer('security')}          label="Güvenlik" color="#60A5FA" icon={<Shield      size={22} />} />
        <Btn fn={() => openDrawer('entertainment')}     label="Eğlence"  color="#F472B6" icon={<Tv2         size={22} />} />
        <Btn fn={() => openDrawer('sport')}             label="Sport"    color="#FB7185" icon={<Zap size={22} />} />
        {onOpenRearCam && (
          <>
            <Div />
            <Btn fn={onOpenRearCam} label="Kamera" icon={<Camera size={22} />} />
          </>
        )}
        {onOpenSplit && (
          <Btn fn={onOpenSplit} label="Split" icon={<SplitSquareHorizontal size={22} />} />
        )}
      </div>
    </div>
  );
});
